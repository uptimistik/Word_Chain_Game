/*
 * Word Chain Game - Train Distance Tracker & Mini-Map Bridge
 * ----------------------------------------------------------
 * Adds a vintage brass railway distance tracker and mini-map HUD
 * displaying the train's real-time journey between the 2 train stations:
 *   - Station 1: x = 592.5 (Valley / Main Station)
 *   - Station 2: x = 3283  (Forest / Mountain Station)
 *
 * Features:
 *   1. Miniature Railway Mini-Map:
 *      - Live animated brass locomotive icon moving along the track in real-time.
 *      - Distinct station markers showing Station 1 and Station 2 with glowing arrival rings.
 *   2. Live Distance Readout:
 *      - Dynamically computes real-time distance in meters to the upcoming station ahead.
 *      - "Arriving at Station" notification when pulling in.
 *   3. Responsive Top-Center Mount:
 *      - Anchored at (gameX: 512, gameY: 742), perfectly centered between the UI keys and moves.
 *      - Tracks GameSalad canvas scaling and window resize events.
 *   4. Scene Awareness:
 *      - Visible exclusively during train gameplay scenes (Scene 5 Solo Play & Scene 6 PvP).
 *   5. Standalone & Clean:
 *      - Operates in its own decoupled bridge without modifying GameSalad project files.
 */
(function (global) {
	'use strict';

	var CONFIG = {
		gameWidth: 1024,
		gameHeight: 768,
		// Centered at top of screen
		targetGameX: 512,
		targetGameY: 736,
		// Station coordinates in Scene 5 world space
		station1X: 592.5,
		station2X: 3283,
		sceneWidth: 5048,
		// Scale: 5 game pixels ≈ 1 meter
		pixelsPerMeter: 5
	};

	var trackerElement = null;
	var installed = false;
	var syncRafId = null;

	/**
	 * Inject CSS styling for the railway distance tracker & mini-map.
	 */
	function injectStyles() {
		if (document.getElementById('wc-train-tracker-styles')) return;

		var css = [
			'#wc-train-tracker {',
			'  position: absolute;',
			'  width: 330px;',
			'  height: 44px;',
			'  box-sizing: border-box;',
			'  user-select: none;',
			'  -webkit-user-select: none;',
			'  pointer-events: none;',
			'  z-index: 920;',
			'  display: none;',
			'  transform-origin: center center;',
			'}',
			'.wc-tracker-frame {',
			'  width: 100%;',
			'  height: 100%;',
			'  position: relative;',
			'  border-radius: 8px;',
			'  background: linear-gradient(180deg, #3d2712 0%, #221408 60%, #150b04 100%);',
			'  border: 1.5px solid #d4a359;',
			'  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.75), inset 1px 1px 1px rgba(255, 230, 180, 0.4), inset -1px -1px 2px rgba(0, 0, 0, 0.7);',
			'  display: flex;',
			'  flex-direction: column;',
			'  justify-content: space-between;',
			'  padding: 4px 10px 5px 10px;',
			'  box-sizing: border-box;',
			'}',
			'/* Top info row: Destination station & live distance */',
			'.wc-tracker-info-row {',
			'  display: flex;',
			'  align-items: center;',
			'  justify-content: space-between;',
			'  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;',
			'  font-size: 9.5px;',
			'  line-height: 1;',
			'}',
			'.wc-tracker-dest {',
			'  font-weight: 800;',
			'  color: #f7e0b5;',
			'  letter-spacing: 0.8px;',
			'  text-shadow: 0 1px 2px rgba(0,0,0,0.8);',
			'  display: flex;',
			'  align-items: center;',
			'  gap: 4px;',
			'}',
			'.wc-tracker-dist {',
			'  font-weight: 900;',
			'  font-family: monospace;',
			'  font-size: 10px;',
			'  color: #4ade80;',
			'  letter-spacing: 0.5px;',
			'  text-shadow: 0 0 6px rgba(74, 222, 128, 0.5);',
			'}',
			'/* Bottom row: Miniature railway track bar */',
			'.wc-tracker-rail-container {',
			'  width: 100%;',
			'  height: 14px;',
			'  position: relative;',
			'  display: flex;',
			'  align-items: center;',
			'}',
			'.wc-tracker-rail-track {',
			'  position: absolute;',
			'  left: 0;',
			'  right: 0;',
			'  height: 4px;',
			'  border-radius: 2px;',
			'  background: linear-gradient(180deg, #666 0%, #aaa 40%, #444 100%);',
			'  box-shadow: inset 0 1px 2px rgba(0,0,0,0.8), 0 1px 0 rgba(255,255,255,0.15);',
			'}',
			'.wc-tracker-rail-track::after {',
			'  content: "";',
			'  position: absolute;',
			'  left: 0;',
			'  top: -2px;',
			'  width: 100%;',
			'  height: 8px;',
			'  background: repeating-linear-gradient(90deg, #825a2c, #825a2c 2px, transparent 2px, transparent 10px);',
			'  opacity: 0.6;',
			'  pointer-events: none;',
			'}',
			'/* Station markers */',
			'.wc-station-pin {',
			'  position: absolute;',
			'  top: 50%;',
			'  transform: translate(-50%, -50%);',
			'  display: flex;',
			'  flex-direction: column;',
			'  align-items: center;',
			'  z-index: 2;',
			'}',
			'.wc-station-dot {',
			'  width: 8px;',
			'  height: 8px;',
			'  border-radius: 50%;',
			'  background: radial-gradient(circle at 35% 35%, #fff 0%, #eab308 60%, #854d0e 100%);',
			'  border: 1px solid #fef08a;',
			'  box-shadow: 0 1px 3px rgba(0,0,0,0.8);',
			'  transition: transform 0.15s ease, box-shadow 0.15s ease;',
			'}',
			'.wc-station-pin.wc-station-active .wc-station-dot {',
			'  transform: scale(1.35);',
			'  background: radial-gradient(circle at 35% 35%, #bbf7d0 0%, #22c55e 60%, #14532d 100%);',
			'  border-color: #86efac;',
			'  box-shadow: 0 0 8px #22c55e, 0 0 12px #4ade80;',
			'}',
			'.wc-station-tag {',
			'  position: absolute;',
			'  bottom: -10px;',
			'  font-family: -apple-system, BlinkMacSystemFont, sans-serif;',
			'  font-size: 6.5px;',
			'  font-weight: bold;',
			'  color: #d1b48c;',
			'  letter-spacing: 0.5px;',
			'  white-space: nowrap;',
			'}',
			'/* Animated train cursor icon */',
			'.wc-tracker-train-cursor {',
			'  position: absolute;',
			'  top: 50%;',
			'  left: 0%;',
			'  transform: translate(-50%, -50%);',
			'  width: 14px;',
			'  height: 14px;',
			'  border-radius: 50%;',
			'  background: radial-gradient(circle at 35% 30%, #ef4444 0%, #b91c1c 60%, #450a0a 100%);',
			'  border: 1.5px solid #fecaca;',
			'  box-shadow: 0 0 6px rgba(239, 68, 68, 0.8), 0 2px 4px rgba(0,0,0,0.9);',
			'  display: flex;',
			'  align-items: center;',
			'  justify-content: center;',
			'  font-size: 8px;',
			'  z-index: 3;',
			'  transition: left 0.08s linear;',
			'}'
		].join('\n');

		var styleEl = document.createElement('style');
		styleEl.id = 'wc-train-tracker-styles';
		styleEl.textContent = css;
		document.head.appendChild(styleEl);
	}

	/**
	 * Build tracker DOM structure.
	 */
	function createDOM() {
		if (document.getElementById('wc-train-tracker')) {
			return document.getElementById('wc-train-tracker');
		}

		var container = document.createElement('div');
		container.id = 'wc-train-tracker';

		container.innerHTML = [
			'<div class="wc-tracker-frame">',
			'  <div class="wc-tracker-info-row">',
			'    <span class="wc-tracker-dest">🚂 En route to Station 1</span>',
			'    <span class="wc-tracker-dist">--- m</span>',
			'  </div>',
			'  <div class="wc-tracker-rail-container">',
			'    <div class="wc-tracker-rail-track"></div>',
			'    <!-- Station 1 Pin (Left on map) -->',
			'    <div class="wc-station-pin wc-station-1" style="left: 18%;">',
			'      <div class="wc-station-dot"></div>',
			'      <span class="wc-station-tag">Station 1</span>',
			'    </div>',
			'    <!-- Station 2 Pin (Right on map) -->',
			'    <div class="wc-station-pin wc-station-2" style="left: 82%;">',
			'      <div class="wc-station-dot"></div>',
			'      <span class="wc-station-tag">Station 2</span>',
			'    </div>',
			'    <!-- Train Cursor -->',
			'    <div class="wc-tracker-train-cursor" title="Train Position"></div>',
			'  </div>',
			'</div>'
		].join('');

		var player = document.getElementById('gse-player') || document.body;
		player.appendChild(container);
		return container;
	}

	/**
	 * Reposition tracker based on GameSalad canvas bounding rect.
	 */
	function repositionTracker() {
		if (!trackerElement) return;

		var player = document.getElementById('gse-player');
		var canvas = (player && player.querySelector('canvas')) || document.querySelector('canvas');
		if (!canvas || !player) return;

		var canvasRect = canvas.getBoundingClientRect();
		var playerRect = player.getBoundingClientRect();

		var canvasLeftInPlayer = canvasRect.left - playerRect.left;
		var canvasTopInPlayer = canvasRect.top - playerRect.top;

		var normX = CONFIG.targetGameX / CONFIG.gameWidth;
		var normY = (CONFIG.gameHeight - CONFIG.targetGameY) / CONFIG.gameHeight;

		var posX = canvasLeftInPlayer + normX * canvasRect.width;
		var posY = canvasTopInPlayer + normY * canvasRect.height;

		var scale = canvasRect.width / CONFIG.gameWidth;
		if (scale <= 0) scale = 1;

		trackerElement.style.left = posX + 'px';
		trackerElement.style.top = posY + 'px';
		trackerElement.style.transform = 'translate(-50%, -50%) scale(' + scale.toFixed(4) + ')';
	}

	/**
	 * Check whether the active scene is a train gameplay scene.
	 */
	function isTrainScene(game) {
		if (!game) return false;
		var sceneKey = (typeof game.getCurrentSceneKey === 'function') ? game.getCurrentSceneKey() : (game._currentSceneKey || '');

		if (/scenes\/[1234]\b|id155744|id167564|id171180|id112121/.test(sceneKey)) {
			return false;
		}

		if (sceneKey === 'scenes/5' || sceneKey === 'id136667' || sceneKey === 'scenes/6' || sceneKey === 'id113015') {
			return true;
		}

		var scene = (typeof game.getCurrentScene === 'function') ? game.getCurrentScene() : game.currentScene;
		if (scene) {
			var id = scene.id || scene.key || scene._objectKey || '';
			if (id === 'id136667' || id === 'id113015' || id === 'scenes/5' || id === 'scenes/6') {
				return true;
			}
			var name = (scene.attributes && scene.attributes.name) ?
				(typeof scene.attributes.name.getValue === 'function' ? scene.attributes.name.getValue() : scene.attributes.name) : '';
			if (/play|pvp|solo/i.test(name)) return true;
		}

		return false;
	}

	/**
	 * Continuous update loop for live distance tracking & mini-map cursor.
	 */
	function updateLoop() {
		try {
			var game = window.gs && gs.Game && gs.Game.current;
			if (game && trackerElement) {
				if (isTrainScene(game)) {
					if (trackerElement.style.display !== 'block') {
						trackerElement.style.display = 'block';
					}
					repositionTracker();

					// Train X position in scene coordinates
					var trainXAttr = game.attributes && game.attributes.id123446;
					var trainX = trainXAttr ? Number(trainXAttr.getValue()) : 0;

					// Normalize train position within the loop [0, 5048]
					var normTrainX = trainX;
					while (normTrainX < 0) normTrainX += CONFIG.sceneWidth;
					while (normTrainX >= CONFIG.sceneWidth) normTrainX -= CONFIG.sceneWidth;

					// Train travels leftwards (decreasing X).
					// Station 1: x = 592.5
					// Station 2: x = 3283
					var nextStationName = '';
					var distInPixels = 0;
					var activeStationNum = 0;

					if (normTrainX >= CONFIG.station1X && normTrainX <= CONFIG.station2X) {
						// Travelling from Station 2 towards Station 1
						nextStationName = 'Station 1';
						distInPixels = normTrainX - CONFIG.station1X;
						if (distInPixels < 120) activeStationNum = 1;
					} else {
						// Travelling from Station 1 towards Station 2 (via scene wrap)
						nextStationName = 'Station 2';
						if (normTrainX < CONFIG.station1X) {
							distInPixels = normTrainX + (CONFIG.sceneWidth - CONFIG.station2X);
						} else {
							distInPixels = normTrainX - CONFIG.station2X;
						}
						if (distInPixels < 120) activeStationNum = 2;
					}

					var distMeters = Math.max(0, Math.round(distInPixels / CONFIG.pixelsPerMeter));

					// Update text readout
					var destEl = trackerElement.querySelector('.wc-tracker-dest');
					var distEl = trackerElement.querySelector('.wc-tracker-dist');

					if (activeStationNum > 0 && distMeters <= 15) {
						if (destEl) destEl.innerHTML = '🚉 <b>Arriving at ' + nextStationName + '!</b>';
						if (distEl) distEl.textContent = 'ARRIVED';
					} else {
						if (destEl) destEl.innerHTML = '🚂 En route to <b>' + nextStationName + '</b>';
						if (distEl) distEl.textContent = distMeters + ' m';
					}

					// Update station active glowing badges
					var pin1 = trackerElement.querySelector('.wc-station-1');
					var pin2 = trackerElement.querySelector('.wc-station-2');
					if (pin1) {
						if (activeStationNum === 1) pin1.classList.add('wc-station-active');
						else pin1.classList.remove('wc-station-active');
					}
					if (pin2) {
						if (activeStationNum === 2) pin2.classList.add('wc-station-active');
						else pin2.classList.remove('wc-station-active');
					}

					// Map train cursor position on the mini-map track line:
					// Station 1 is at 18%, Station 2 is at 82%
					// When at Station 1 (x=592): 18%
					// When at Station 2 (x=3283): 82%
					var cursorPercent = 18;
					if (normTrainX >= CONFIG.station1X && normTrainX <= CONFIG.station2X) {
						// Interpolate between Station 1 (18%) and Station 2 (82%)
						var progress = (normTrainX - CONFIG.station1X) / (CONFIG.station2X - CONFIG.station1X);
						cursorPercent = 18 + (progress * (82 - 18));
					} else {
						// Past Station 1 or wrapping around
						var wrapDistTotal = CONFIG.station1X + (CONFIG.sceneWidth - CONFIG.station2X);
						var wrapProgress = 0;
						if (normTrainX < CONFIG.station1X) {
							wrapProgress = (CONFIG.station1X - normTrainX) / wrapDistTotal;
							cursorPercent = Math.max(2, 18 - (wrapProgress * 16));
						} else {
							wrapProgress = (normTrainX - CONFIG.station2X) / wrapDistTotal;
							cursorPercent = Math.min(98, 82 + (wrapProgress * 16));
						}
					}

					var cursorEl = trackerElement.querySelector('.wc-tracker-train-cursor');
					if (cursorEl) {
						cursorEl.style.left = cursorPercent.toFixed(1) + '%';
					}
				} else {
					if (trackerElement.style.display !== 'none') {
						trackerElement.style.display = 'none';
					}
				}
			}
		} catch (e) {}

		syncRafId = requestAnimationFrame(updateLoop);
	}

	var WordChainTrainTracker = {
		install: function () {
			if (installed) return;
			installed = true;

			injectStyles();
			trackerElement = createDOM();

			window.addEventListener('resize', repositionTracker, false);
			window.addEventListener('orientationchange', function () {
				setTimeout(repositionTracker, 100);
			}, false);

			syncRafId = requestAnimationFrame(updateLoop);

			console.log('[WordChainTrainTracker] Installed successfully: Distance tracker & mini-map active.');
		}
	};

	global.WordChainTrainTracker = WordChainTrainTracker;

})(window);
