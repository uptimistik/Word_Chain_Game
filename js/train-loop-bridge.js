/*
 * Word Chain Game - Train Loop Smoother Bridge
 * --------------------------------------------
 * Eliminates the violent camera jerk and wagon tearing caused by GameSalad's
 * premature X-wrapping:
 *
 * Problem in vanilla GameSalad:
 *   1. The railway scene is 5048 pixels wide.
 *   2. When Real Train P1 touches x = 0, GameSalad immediately wraps it to 5048.
 *   3. However, all trailing wagons (stretching ~800px behind) are still in the
 *      middle of the screen! Because their positions are constrained to TrainP1X,
 *      they instantly teleport 5000px, tearing the train apart.
 *   4. ControlCameraBehavior sees the train at 5048 and snaps the camera from
 *      0 to 4024 in a single frame (16ms), violently jerking the entire background.
 *
 * Solution in this bridge:
 *   1. Smooth Left Exit:
 *      Allows Real Train P1 to continue moving into negative X coordinates (down to -950px)
 *      so that the locomotive and ALL trailing wagons smoothly roll off the left edge
 *      of the screen naturally.
 *   2. Off-Screen Seamless Wrap:
 *      Only once the last wagon is completely off-screen does the train wrap to x = 5250
 *      (off-screen on the right).
 *   3. Soft Steam Transition:
 *      A gentle locomotive steam/fog curtain briefly masks the background camera shift
 *      from 0 to 4024 while the train is off-screen.
 *   4. Smooth Right Entrance:
 *      The locomotive smoothly emerges from the right edge of the screen pulling each
 *      wagon onto the track, creating a continuous, seamless loop.
 */
(function (global) {
	'use strict';

	var CONFIG = {
		sceneWidth: 5048,
		cameraWidth: 1024,
		maxCameraX: 4024,
		// Full train length buffer (locomotive + 8 wagons + wheels ~ 850px)
		exitThresholdX: -950,
		// Off-screen right entry point
		entryX: 5250
	};

	var installed = false;
	var isWrappingTransition = false;
	var steamOverlay = null;

	/**
	 * Create soft steam transition overlay for seamless camera shifts.
	 */
	function createSteamOverlay() {
		if (document.getElementById('wc-train-steam-curtain')) {
			return document.getElementById('wc-train-steam-curtain');
		}

		var style = document.createElement('style');
		style.id = 'wc-train-steam-styles';
		style.textContent = [
			'#wc-train-steam-curtain {',
			'  position: absolute;',
			'  left: 0;',
			'  top: 0;',
			'  width: 100%;',
			'  height: 55%;',
			'  pointer-events: none;',
			'  z-index: 100;',
			'  opacity: 0;',
			'  background: radial-gradient(ellipse at 50% 70%, rgba(245, 245, 245, 0.75) 0%, rgba(220, 220, 220, 0.45) 45%, transparent 75%);',
			'  filter: blur(12px);',
			'  transition: opacity 0.16s ease-in-out;',
			'}',
			'#wc-train-steam-curtain.wc-steam-active {',
			'  opacity: 1;',
			'}'
		].join('\n');
		document.head.appendChild(style);

		var curtain = document.createElement('div');
		curtain.id = 'wc-train-steam-curtain';
		var player = document.getElementById('gse-player') || document.body;
		player.appendChild(curtain);
		return curtain;
	}

	/**
	 * Check if an actor is the primary locomotive (Real Train P1).
	 */
	function isRealTrain(actor) {
		if (!actor) return false;
		if (actor.prototype && actor.prototype.id === 'id130972') return true;
		if (actor.id === 'id117918') return true;
		var name = (actor.attributes && actor.attributes.name) || actor.name || '';
		return name === 'Real Train P1';
	}

	/**
	 * Trigger the seamless off-screen wrap.
	 */
	function executeSeamlessWrap(aspect, actor, body) {
		if (isWrappingTransition) return;
		isWrappingTransition = true;

		// 1. Show soft locomotive steam curtain
		if (steamOverlay) {
			steamOverlay.classList.add('wc-steam-active');
		}

		setTimeout(function () {
			try {
				var game = window.gs && gs.Game && gs.Game.current;
				var scene = game && ((typeof game.getCurrentScene === 'function' ? game.getCurrentScene() : game.currentScene));

				// 2. Wrap Real Train P1 to the far right off-screen
				var newX = CONFIG.entryX;
				aspect.currentPosition[0] = newX;
				if (actor.attributes && actor.attributes.position && actor.attributes.position.x) {
					actor.attributes.position.x.setValue(newX);
				}
				if (body && typeof body.setPositionAndAngle === 'function') {
					body.setPositionAndAngle(newX, aspect.currentPosition[1], aspect.currentRotation || 0);
				}

				// Update global TrainP1X attribute
				if (game && game.attributes && game.attributes.id123446) {
					game.attributes.id123446.setValue(newX);
				}

				// 3. Set camera origin to right end of track (4024)
				if (scene && scene.attributes && scene.attributes.camera && scene.attributes.camera.origin) {
					scene.attributes.camera.origin.x.fastSetValue(CONFIG.maxCameraX);
				}

				// Complete finish wrap event in GameSalad
				if (actor.game && actor.game().eventCenter) {
					actor.game().eventCenter.postEvent('finishedWrap', actor, gs.Vector2.X_COMPONENT);
				}
				aspect.checkWrappingXMethod = aspect.checkStartWrappingBodyX;
			} catch (e) {}

			// 4. Fade out steam as train rolls into view from the right
			setTimeout(function () {
				if (steamOverlay) {
					steamOverlay.classList.remove('wc-steam-active');
				}
				isWrappingTransition = false;
			}, 180);

		}, 140);
	}

	/**
	 * Install MotionAspect and Camera wrapping overrides.
	 */
	function hookEngine() {
		var gs = global.gs;
		if (!gs || !gs.MotionAspect) return false;

		// 1. Override checkWrapPositionX on MotionAspect
		var origCheckWrapPositionX = gs.MotionAspect.prototype.checkWrapPositionX || gs.MotionAspect.checkWrapPositionX;

		var customCheckWrapPositionX = function (actor, body) {
			if (isRealTrain(actor)) {
				var currentX = this.currentPosition[0];

				// While moving left past x = 0, let the entire train (locomotive + 8 wagons)
				// smoothly exit off the screen into negative space
				if (currentX < 0 && currentX >= CONFIG.exitThresholdX) {
					// Update actual positions without wrapping yet
					if (actor.attributes && actor.attributes.position && actor.attributes.position.x) {
						actor.attributes.position.x.setValue(currentX);
					}
					if (body && typeof body.setPositionAndAngle === 'function') {
						body.setPositionAndAngle(currentX, this.currentPosition[1], this.currentRotation || 0);
					}
					return;
				}

				// Once the entire train has cleared off-screen (currentX < -950px), wrap to right
				if (currentX < CONFIG.exitThresholdX) {
					executeSeamlessWrap(this, actor, body);
					return;
				}

				// If train wrapped past right edge, wrap to max
				if (currentX > CONFIG.sceneWidth + 600) {
					this.currentPosition[0] = CONFIG.sceneWidth;
					if (actor.attributes && actor.attributes.position && actor.attributes.position.x) {
						actor.attributes.position.x.setValue(this.currentPosition[0]);
					}
					if (body && typeof body.setPositionAndAngle === 'function') {
						body.setPositionAndAngle(this.currentPosition[0], this.currentPosition[1], this.currentRotation || 0);
					}
					return;
				}
			}

			// Normal GameSalad wrap logic for all other actors
			if (origCheckWrapPositionX) {
				return origCheckWrapPositionX.apply(this, arguments);
			}
		};

		if (gs.MotionAspect.prototype) {
			gs.MotionAspect.prototype.checkWrapPositionX = customCheckWrapPositionX;
		}
		gs.MotionAspect.checkWrapPositionX = customCheckWrapPositionX;

		// 2. Smooth camera tracking near the wrap boundary
		if (gs.ControlCameraBehavior && gs.ControlCameraBehavior.everyFrame) {
			var origCameraEveryFrame = gs.ControlCameraBehavior.everyFrame;
			gs.ControlCameraBehavior.everyFrame = function (actor, timestamp) {
				// While wrapping transition is active, keep camera stable
				if (isWrappingTransition) return;

				var scene = actor && actor.scene;
				var positionAttr = actor && actor.attributes && actor.attributes.position;
				if (positionAttr && scene && scene.attributes && scene.attributes.camera) {
					var targetX = positionAttr.x.getValue();

					// When train is exiting off-screen left, lock camera at 0
					if (targetX < 512 && targetX >= CONFIG.exitThresholdX) {
						scene.attributes.camera.origin.x.fastSetValue(0);
						return;
					}

					// When train is entering off-screen right, lock camera at 4024
					if (targetX > CONFIG.maxCameraX + 512) {
						scene.attributes.camera.origin.x.fastSetValue(CONFIG.maxCameraX);
						return;
					}
				}

				return origCameraEveryFrame.apply(this, arguments);
			};
		}

		return true;
	}

	var WordChainTrainLoop = {
		install: function () {
			if (installed) return;
			installed = true;

			steamOverlay = createSteamOverlay();
			hookEngine();

			console.log('[WordChainTrainLoop] Installed successfully: Smooth train exit/entry loop active.');
		}
	};

	global.WordChainTrainLoop = WordChainTrainLoop;

})(window);
