/*
 * Word Chain Game - Tactile Train Switch Control Bridge (Isometric Edition)
 * --------------------------------------------------------------------------
 * Adds an isometric vintage mechanical brass console switch on the wooden table
 * on the LEFT side of the letter trays to start and stop the train:
 *   - Press once -> Train accelerates along the track ('z' / TrainP1Run = true),
 *     plays whistle, flips switch to UP/RUN, illuminates glowing emerald LED.
 *   - Press again -> Train gently decelerates to a halt ('x' / TrainP1Run = false),
 *     flips switch to DOWN/STOP, extinguishes LED to dark ruby.
 *
 * Visual & Geometry Features:
 *   1. True Isometric Tabletop Projection:
 *      - 3D chassis box angled at rotateX(48deg) rotateY(10deg) rotateZ(-3deg)
 *        matching the recession and perspective of the wooden table plane.
 *      - Extruded front and side metallic bevel facets giving real physical thickness.
 *      - Soft contact drop-shadow casting onto the wood grain behind and under the box.
 *   2. Left Tabletop Placement:
 *      - Anchored at (gameX: 108, gameY: 175), resting cleanly in the open wooden
 *        table space to the LEFT of the main letter tray rack.
 *   3. Intelligent Scene Awareness:
 *      - Automatically shows during gameplay scenes with the train (Scene 5 Solo Play & Scene 6 PvP).
 *      - Hides during menus, level select, and tile select screens.
 *   4. Multi-Sensory Feedback:
 *      - Synthesized heavy mechanical switch click (Web Audio API).
 *      - Haptic feedback integration via WordChainHaptics.
 */
(function (global) {
	'use strict';

	var CONFIG = {
		// GameSalad virtual coordinate space (1024 x 768)
		gameWidth: 1024,
		gameHeight: 768,
		// Target position on the open wooden tabletop on the LEFT of the trays
		targetGameX: 108,
		targetGameY: 175,
		// Base dimensions in virtual pixels
		baseWidth: 84,
		baseHeight: 96
	};

	var switchElement = null;
	var isRunning = false;
	var switchAudioCtx = null;
	var installed = false;
	var syncRafId = null;

	/**
	 * Play a realistic mechanical switch click sound using Web Audio API.
	 */
	function playClickSound(toOnState) {
		try {
			var AudioCtx = window.AudioContext || window.webkitAudioContext;
			if (!AudioCtx) return;
			if (!switchAudioCtx) {
				switchAudioCtx = new AudioCtx();
			}
			if (switchAudioCtx.state === 'suspended') {
				switchAudioCtx.resume();
			}

			var now = switchAudioCtx.currentTime;

			// 1. High metallic spring click
			var osc = switchAudioCtx.createOscillator();
			var gain = switchAudioCtx.createGain();
			osc.type = 'triangle';
			var startFreq = toOnState ? 1500 : 950;
			var endFreq = toOnState ? 380 : 220;
			osc.frequency.setValueAtTime(startFreq, now);
			osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.035);

			gain.gain.setValueAtTime(0.28, now);
			gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

			osc.connect(gain);
			gain.connect(switchAudioCtx.destination);
			osc.start(now);
			osc.stop(now + 0.045);

			// 2. Heavy industrial mechanical clack (low resonant thud)
			var clack = switchAudioCtx.createOscillator();
			var clackGain = switchAudioCtx.createGain();
			clack.type = 'square';
			clack.frequency.setValueAtTime(toOnState ? 240 : 180, now);
			clack.frequency.exponentialRampToValueAtTime(50, now + 0.045);

			clackGain.gain.setValueAtTime(0.22, now);
			clackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

			clack.connect(clackGain);
			clackGain.connect(switchAudioCtx.destination);
			clack.start(now);
			clack.stop(now + 0.05);
		} catch (e) {
			// Ignore audio context autoplay restrictions
		}
	}

	/**
	 * Inject CSS styling for the isometric train switch.
	 */
	function injectStyles() {
		if (document.getElementById('wc-train-switch-styles')) return;

		var css = [
			'#wc-train-switch {',
			'  position: absolute;',
			'  width: 90px;',
			'  height: 104px;',
			'  box-sizing: border-box;',
			'  user-select: none;',
			'  -webkit-user-select: none;',
			'  -webkit-touch-callout: none;',
			'  touch-action: manipulation;',
			'  cursor: pointer;',
			'  z-index: 9999;',
			'  display: none;',
			'  transform-origin: center center;',
			'  pointer-events: auto;',
			'  perspective: 550px;',
			'  perspective-origin: 50% 120%;',
			'}',
			'/* Soft isometric drop shadow cast on wooden table surface */',
			'.wc-iso-shadow {',
			'  position: absolute;',
			'  left: 2px;',
			'  top: 18px;',
			'  width: 88px;',
			'  height: 76px;',
			'  background: radial-gradient(ellipse at 45% 45%, rgba(12, 6, 2, 0.78) 0%, rgba(20, 10, 3, 0.45) 55%, transparent 78%);',
			'  transform: rotateX(50deg) skewX(-14deg);',
			'  filter: blur(5px);',
			'  pointer-events: none;',
			'}',
			'/* 3D Isometric Console Box */',
			'.wc-iso-box {',
			'  position: relative;',
			'  width: 82px;',
			'  height: 94px;',
			'  transform-style: preserve-3d;',
			'  transform: rotateX(46deg) rotateY(8deg) rotateZ(-2deg);',
			'  transform-origin: center bottom;',
			'  transition: transform 0.08s ease;',
			'}',
			'#wc-train-switch:active .wc-iso-box {',
			'  transform: rotateX(46deg) rotateY(8deg) rotateZ(-2deg) translateY(2px);',
			'}',
			'/* Top Slanted Control Panel Face */',
			'.wc-switch-plate {',
			'  width: 100%;',
			'  height: 100%;',
			'  position: relative;',
			'  border-radius: 9px 9px 4px 4px;',
			'  background: linear-gradient(145deg, #f7d28c 0%, #caa15c 28%, #8e652a 75%, #593e16 100%);',
			'  border: 1.5px solid #ffdfa3;',
			'  box-shadow: inset 1px 1px 1.5px rgba(255,255,255,0.7), inset -1.5px -1.5px 2px rgba(0,0,0,0.6);',
			'  display: flex;',
			'  flex-direction: column;',
			'  align-items: center;',
			'  padding: 5px 4px 3px 4px;',
			'  box-sizing: border-box;',
			'}',
			'/* Front Beveled Extrusion (shows 3D metal thickness/depth) */',
			'.wc-iso-front {',
			'  position: absolute;',
			'  left: 0;',
			'  bottom: -12px;',
			'  width: 100%;',
			'  height: 13px;',
			'  background: linear-gradient(to bottom, #8e652a 0%, #593e16 60%, #30200a 100%);',
			'  border-radius: 0 0 6px 6px;',
			'  border: 1px solid #4a3313;',
			'  border-top: none;',
			'  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.7);',
			'}',
			'/* Right Side Facet in perspective */',
			'.wc-iso-right {',
			'  position: absolute;',
			'  right: -7px;',
			'  top: 3px;',
			'  width: 8px;',
			'  height: 96%;',
			'  background: linear-gradient(to right, #6a491c, #38240a);',
			'  transform: skewY(-42deg);',
			'  border-radius: 0 4px 4px 0;',
			'  opacity: 0.95;',
			'}',
			'.wc-screw {',
			'  position: absolute;',
			'  width: 5px;',
			'  height: 5px;',
			'  border-radius: 50%;',
			'  background: radial-gradient(circle at 35% 35%, #fbe6ba 0%, #b3833b 65%, #573a12 100%);',
			'  box-shadow: inset 0.5px 0.5px 0.5px rgba(255,255,255,0.8), 0.5px 0.5px 1px rgba(0,0,0,0.5);',
			'}',
			'.wc-screw::after {',
			'  content: "";',
			'  position: absolute;',
			'  left: 1px;',
			'  top: 2px;',
			'  width: 3px;',
			'  height: 1px;',
			'  background: #392207;',
			'}',
			'.wc-screw-tl { top: 4px; left: 4px; transform: rotate(35deg); }',
			'.wc-screw-tr { top: 4px; right: 4px; transform: rotate(-45deg); }',
			'.wc-screw-bl { bottom: 4px; left: 4px; transform: rotate(60deg); }',
			'.wc-screw-br { bottom: 4px; right: 4px; transform: rotate(-20deg); }',
			'.wc-switch-title {',
			'  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;',
			'  font-weight: 900;',
			'  font-size: 10px;',
			'  letter-spacing: 1.8px;',
			'  color: #3b2408;',
			'  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.45), 0 -0.5px 0 rgba(0, 0, 0, 0.6);',
			'  margin-top: 1px;',
			'  margin-bottom: 2px;',
			'  line-height: 1;',
			'}',
			'.wc-switch-led-row {',
			'  display: flex;',
			'  align-items: center;',
			'  gap: 4px;',
			'  margin-bottom: 2px;',
			'}',
			'.wc-switch-led-bezel {',
			'  width: 11px;',
			'  height: 11px;',
			'  border-radius: 50%;',
			'  background: radial-gradient(circle at 40% 40%, #e8e8e8 0%, #8c8c8c 60%, #444 100%);',
			'  box-shadow: 0 1px 2px rgba(0,0,0,0.6), inset 0.5px 0.5px 1px rgba(255,255,255,0.9);',
			'  display: flex;',
			'  align-items: center;',
			'  justify-content: center;',
			'}',
			'.wc-switch-led-lamp {',
			'  width: 7px;',
			'  height: 7px;',
			'  border-radius: 50%;',
			'  transition: background 0.15s ease, box-shadow 0.15s ease;',
			'}',
			'/* LED OFF State (Dark Ruby) */',
			'.wc-state-off .wc-switch-led-lamp {',
			'  background: radial-gradient(circle at 35% 35%, #ff7373 0%, #9e1414 60%, #450303 100%);',
			'  box-shadow: inset 0.5px 0.5px 1px rgba(255,255,255,0.6), 0 0 2px rgba(158, 20, 20, 0.4);',
			'}',
			'/* LED ON State (Glowing Emerald) */',
			'.wc-state-on .wc-switch-led-lamp {',
			'  background: radial-gradient(circle at 35% 35%, #b6f8b6 0%, #22c55e 55%, #14532d 100%);',
			'  box-shadow: inset 0.5px 0.5px 1px #fff, 0 0 6px #22c55e, 0 0 12px #4ade80;',
			'}',
			'.wc-switch-status-label {',
			'  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;',
			'  font-weight: 800;',
			'  font-size: 8px;',
			'  letter-spacing: 1px;',
			'  color: #3f2608;',
			'  text-shadow: 0 1px 0 rgba(255,255,255,0.4);',
			'  line-height: 1;',
			'}',
			'.wc-switch-slot-container {',
			'  width: 25px;',
			'  height: 48px;',
			'  position: relative;',
			'  border-radius: 13px;',
			'  background: #141414;',
			'  box-shadow: inset 0 2px 5px rgba(0, 0, 0, 0.95), inset 0 -1px 2px rgba(255, 255, 255, 0.1), 0 1px 1px rgba(255,255,255,0.4);',
			'  overflow: visible;',
			'  display: flex;',
			'  align-items: center;',
			'  justify-content: center;',
			'  perspective: 250px;',
			'}',
			'.wc-switch-indicator-text-top {',
			'  position: absolute;',
			'  top: 0px;',
			'  font-family: monospace;',
			'  font-size: 6.5px;',
			'  font-weight: bold;',
			'  color: #88c888;',
			'  opacity: 0.85;',
			'  letter-spacing: 0.5px;',
			'}',
			'.wc-switch-indicator-text-bot {',
			'  position: absolute;',
			'  bottom: 0px;',
			'  font-family: monospace;',
			'  font-size: 6.5px;',
			'  font-weight: bold;',
			'  color: #e58888;',
			'  opacity: 0.85;',
			'  letter-spacing: 0.5px;',
			'}',
			'.wc-switch-lever {',
			'  position: absolute;',
			'  width: 16px;',
			'  height: 32px;',
			'  transform-origin: center center;',
			'  transition: transform 0.16s cubic-bezier(0.25, 1.4, 0.5, 1);',
			'  display: flex;',
			'  flex-direction: column;',
			'  align-items: center;',
			'}',
			'/* Lever Off Position (Tilted Down) */',
			'.wc-state-off .wc-switch-lever {',
			'  transform: translateY(8px) rotateX(26deg);',
			'}',
			'/* Lever On Position (Tilted Up) */',
			'.wc-state-on .wc-switch-lever {',
			'  transform: translateY(-8px) rotateX(-26deg);',
			'}',
			'.wc-lever-shaft {',
			'  width: 7px;',
			'  height: 20px;',
			'  background: linear-gradient(90deg, #666 0%, #eee 40%, #ccc 70%, #444 100%);',
			'  border-radius: 3px;',
			'  box-shadow: 0 1px 3px rgba(0,0,0,0.7);',
			'}',
			'.wc-lever-ball {',
			'  width: 15px;',
			'  height: 15px;',
			'  border-radius: 50%;',
			'  background: radial-gradient(circle at 35% 30%, #ffffff 0%, #dcdcdc 35%, #888888 70%, #333333 100%);',
			'  box-shadow: 0 3px 6px rgba(0,0,0,0.6), inset 0 1px 1px #fff;',
			'  margin-top: -4px;',
			'}'
		].join('\n');

		var styleEl = document.createElement('style');
		styleEl.id = 'wc-train-switch-styles';
		styleEl.textContent = css;
		document.head.appendChild(styleEl);
	}

	/**
	 * Build the 3D isometric switch DOM structure.
	 */
	function createDOM() {
		if (document.getElementById('wc-train-switch')) {
			return document.getElementById('wc-train-switch');
		}

		var container = document.createElement('div');
		container.id = 'wc-train-switch';
		container.className = 'wc-state-off';
		container.setAttribute('title', 'Train Switch: Click to Start / Stop Train');

		container.innerHTML = [
			'<!-- Isometric Contact Shadow on wooden table -->',
			'<div class="wc-iso-shadow"></div>',
			'<!-- 3D Console Box -->',
			'<div class="wc-iso-box">',
			'  <div class="wc-switch-plate">',
			'    <div class="wc-screw wc-screw-tl"></div>',
			'    <div class="wc-screw wc-screw-tr"></div>',
			'    <div class="wc-screw wc-screw-bl"></div>',
			'    <div class="wc-screw wc-screw-br"></div>',
			'    <div class="wc-switch-title">TRAIN</div>',
			'    <div class="wc-switch-led-row">',
			'      <div class="wc-switch-led-bezel">',
			'        <div class="wc-switch-led-lamp"></div>',
			'      </div>',
			'      <span class="wc-switch-status-label">STOP</span>',
			'    </div>',
			'    <div class="wc-switch-slot-container">',
			'      <span class="wc-switch-indicator-text-top">RUN</span>',
			'      <div class="wc-switch-lever">',
			'        <div class="wc-lever-ball"></div>',
			'        <div class="wc-lever-shaft"></div>',
			'      </div>',
			'      <span class="wc-switch-indicator-text-bot">OFF</span>',
			'    </div>',
			'  </div>',
			'  <!-- Front & Side Extrusions for real physical 3D thickness -->',
			'  <div class="wc-iso-front"></div>',
			'  <div class="wc-iso-right"></div>',
			'</div>'
		].join('');

		// Attach tap / click handler with event isolation & touch debounce
		var lastToggleTime = 0;
		var handleToggle = function (e) {
			var now = Date.now();
			if (now - lastToggleTime < 250) {
				if (e) {
					try { e.preventDefault(); e.stopPropagation(); } catch (err) {}
				}
				return;
			}
			lastToggleTime = now;
			if (e) {
				try { e.preventDefault(); e.stopPropagation(); } catch (err) {}
			}
			toggleTrain();
		};

		container.addEventListener('pointerup', handleToggle, false);
		container.addEventListener('click', handleToggle, false);
		container.addEventListener('pointerdown', function (e) {
			e.stopPropagation();
		}, false);
		container.addEventListener('touchstart', function (e) {
			e.stopPropagation();
		}, { passive: true });

		var player = document.getElementById('gse-player') || document.body;
		player.appendChild(container);
		return container;
	}

	/**
	 * Update switch visual state (lever & LED).
	 */
	function updateSwitchVisual(on) {
		isRunning = !!on;
		if (!switchElement) return;

		if (isRunning) {
			switchElement.classList.remove('wc-state-off');
			switchElement.classList.add('wc-state-on');
		} else {
			switchElement.classList.remove('wc-state-on');
			switchElement.classList.add('wc-state-off');
		}

		var label = switchElement.querySelector('.wc-switch-status-label');
		if (label) {
			label.textContent = isRunning ? 'RUN' : 'STOP';
		}
	}

	/**
	 * Reposition switch to lock onto the canvas wooden table coordinates.
	 */
	function repositionSwitch() {
		if (!switchElement) return;

		var player = document.getElementById('gse-player');
		var canvas = (player && player.querySelector('canvas')) || document.querySelector('canvas');
		if (!canvas || !player) return;

		var canvasRect = canvas.getBoundingClientRect();
		var playerRect = player.getBoundingClientRect();

		// Position of canvas relative to #gse-player
		var canvasLeftInPlayer = canvasRect.left - playerRect.left;
		var canvasTopInPlayer = canvasRect.top - playerRect.top;

		// Convert GameSalad virtual coordinates (origin at bottom-left) to canvas screen coords
		var normX = CONFIG.targetGameX / CONFIG.gameWidth;
		var normY = (CONFIG.gameHeight - CONFIG.targetGameY) / CONFIG.gameHeight;

		var posX = canvasLeftInPlayer + normX * canvasRect.width;
		var posY = canvasTopInPlayer + normY * canvasRect.height;

		// Scale switch proportionally to canvas viewport scale
		var scale = canvasRect.width / CONFIG.gameWidth;
		if (scale <= 0) scale = 1;

		switchElement.style.left = posX + 'px';
		switchElement.style.top = posY + 'px';
		switchElement.style.transform = 'translate(-50%, -50%) scale(' + scale.toFixed(4) + ')';
	}

	/**
	 * Check whether the train is running from GameSalad game attributes.
	 */
	function getTrainRunState() {
		try {
			var game = window.gs && gs.Game && gs.Game.current;
			if (game && game.attributes && game.attributes.id128260) {
				return !!game.attributes.id128260.getValue();
			}
		} catch (e) {}
		return false;
	}

	/**
	 * Toggle the train running state in GameSalad.
	 */
	function toggleTrain() {
		var game = window.gs && gs.Game && gs.Game.current;
		var trainRunningAttr = game && game.attributes && game.attributes.id128260;
		var trainStopAttr = game && game.attributes && game.attributes.id153906;

		var currentState = trainRunningAttr ? !!trainRunningAttr.getValue() : isRunning;
		var nextState = !currentState;

		// 1. Post keyboard events to GameSalad engine
		// 'z' = Start train & whistle, 'x' = Stop train & decelerate
		var key = nextState ? 'z' : 'x';
		if (game && game.eventCenter && typeof game.eventCenter.postEvent === 'function') {
			game.eventCenter.postEvent('keyDown', null, key);
			setTimeout(function () {
				if (game && game.eventCenter && typeof game.eventCenter.postEvent === 'function') {
					game.eventCenter.postEvent('keyUp', null, key);
				}
			}, 60);
		}

		// 2. Dispatch window keyboard events as fallback
		try {
			window.dispatchEvent(new KeyboardEvent('keydown', {
				key: key,
				code: (key === 'z' ? 'KeyZ' : 'KeyX'),
				bubbles: true
			}));
			setTimeout(function () {
				window.dispatchEvent(new KeyboardEvent('keyup', {
					key: key,
					code: (key === 'z' ? 'KeyZ' : 'KeyX'),
					bubbles: true
				}));
			}, 60);
		} catch (e) {}

		// 3. Set GameSalad attributes directly for immediate response
		if (trainRunningAttr && typeof trainRunningAttr.setValue === 'function') {
			trainRunningAttr.setValue(nextState);
		}
		if (trainStopAttr && typeof trainStopAttr.setValue === 'function') {
			trainStopAttr.setValue(!nextState);
		}

		// 4. Update visual state
		updateSwitchVisual(nextState);

		// 5. Play audio feedback
		playClickSound(nextState);

		// 6. Tactile haptics
		if (window.WordChainHaptics && typeof window.WordChainHaptics.triggerTouch === 'function') {
			window.WordChainHaptics.triggerTouch(35);
		}
	}

	/**
	 * Check whether the active GameSalad scene has the train on the table.
	 */
	function isTrainGameplayScene(game) {
		if (!game) return false;

		// 1. Scene key from engine context or game
		var sceneKey = '';
		if (typeof game.getCurrentSceneKey === 'function') {
			try { sceneKey = game.getCurrentSceneKey() || ''; } catch (e) {}
		}
		if (!sceneKey && game._currentSceneKey) {
			sceneKey = game._currentSceneKey;
		}

		// Strictly hide on Menus and Selection screens
		if (/scenes\/[1234]\b|id155744|id167564|id171180|id112121/.test(sceneKey)) {
			return false;
		}

		// 2. Current scene object from GameSalad
		var scene = null;
		if (typeof game.getCurrentScene === 'function') {
			try { scene = game.getCurrentScene(); } catch (e) {}
		}
		if (!scene && game.currentScene) {
			scene = game.currentScene;
		}

		if (scene) {
			var sceneId = scene.id || scene.key || scene._objectKey || '';
			// Scene 5 (Solo Play) or Scene 6 (PvP)
			if (sceneId === 'id136667' || sceneId === 'id113015' || sceneId === 'scenes/5' || sceneId === 'scenes/6') {
				return true;
			}
			var sceneName = '';
			try {
				if (scene.attributes && scene.attributes.name) {
					sceneName = typeof scene.attributes.name.getValue === 'function' ?
						scene.attributes.name.getValue() : scene.attributes.name;
				}
			} catch (e) {}
			if (/play|pvp|solo/i.test(sceneName)) {
				return true;
			}
			if (/menu|tile select|level.*select|tray.*select/i.test(sceneName)) {
				return false;
			}
		}

		// 3. Match keys for Solo Play or PvP
		if (sceneKey === 'scenes/5' || sceneKey === 'id136667' || sceneKey === 'scenes/6' || sceneKey === 'id113015') {
			return true;
		}

		// 4. Fallback: if we have the Train attribute and are past the initial menus
		if (game.attributes && game.attributes.id128260 && sceneKey && !/scenes\/1\b/.test(sceneKey)) {
			return true;
		}

		return false;
	}

	/**
	 * Continuous sync loop:
	 *   - Checks if train gameplay scene is active.
	 *   - Shows or hides the switch element.
	 *   - Keeps visual lever/LED synced with engine attribute id128260.
	 *   - Repositions switch upon canvas resize/relayout.
	 */
	function syncLoop() {
		try {
			var game = window.gs && gs.Game && gs.Game.current;
			if (game && switchElement) {
				var isTrainScene = isTrainGameplayScene(game);

				if (isTrainScene) {
					if (switchElement.style.display !== 'block') {
						switchElement.style.display = 'block';
					}
					repositionSwitch();

					// Sync visual with engine attribute if changed elsewhere (e.g. keypress)
					var actualRunning = getTrainRunState();
					if (actualRunning !== isRunning) {
						updateSwitchVisual(actualRunning);
					}
				} else {
					if (switchElement.style.display !== 'none') {
						switchElement.style.display = 'none';
					}
				}
			}
		} catch (err) {}

		syncRafId = requestAnimationFrame(syncLoop);
	}

	/**
	 * Public API
	 */
	var WordChainTrainSwitch = {
		install: function () {
			if (installed) return;
			installed = true;

			injectStyles();
			switchElement = createDOM();

			// Initial position sync on load & resize
			window.addEventListener('resize', repositionSwitch, false);
			window.addEventListener('orientationchange', function () {
				setTimeout(repositionSwitch, 100);
			}, false);

			// Start sync loop
			syncRafId = requestAnimationFrame(syncLoop);

			console.log('[WordChainTrainSwitch] Installed successfully: Isometric train switch active at (' + CONFIG.targetGameX + ', ' + CONFIG.targetGameY + ').');
		},

		toggle: toggleTrain,
		getState: function () {
			return isRunning;
		}
	};

	global.WordChainTrainSwitch = WordChainTrainSwitch;

})(window);
