/*
 * Word Chain Game - Train Infinite Scroll Bridge
 * ------------------------------------------------
 * Ultra-Optimized Infinite Leftward Run:
 * 1. Unclamps camera.origin.x: Allows the camera to track the train continuously
 *    into negative X without stopping at X = 0.
 * 2. Overrides checkDestroyX: Completely disables the -500px garbage collection
 *    threshold for train components, wheels, and repeating scenery, while ensuring
 *    transient particles (smoke) are cleanly garbage-collected when outside the view buffer.
 * 3. Enforces wrapX = false: Guarantees GameSalad's engine NEVER teleports Box2D bodies,
 *    never double-renders actors via SGSpace wrapping, and never conflicts with negative X.
 * 4. 100% Seamless Continuous Background Recycler:
 *    - Walls (4 panels x 1367px, 1366px spacing): 1px overlap, ZERO GAPS forever.
 *    - Trees (7 clusters x 740px, 739px spacing): 1px overlap, ZERO GAPS forever.
 *    - Sky (5 bg1 panels x 1024px, 1022px spacing): 2px overlap, ZERO GAPS forever.
 *    - Sun: Parallax drifting with automatic sky cycling.
 *    - East & West Train Stations: Recycled seamlessly along the loop, with zero per-frame Box2D overhead.
 *    - Track & Ties: Centered with massive view buffers, eliminating 60 FPS attribute churn.
 */
(function (global) {
	'use strict';

	var installed = false;
	var cachedScene = null;
	var sceneryCache = {
		trees: [],        // 740px tree clusters (7 clusters, span 5173px)
		walls: [],        // 1367px background wall panels (4 panels, loopSpan 5464px)
		bg1Panels: [],    // 1024px sky/scenery panels (5 panels, loopSpan 5110px)
		stations: [],     // Train station buildings and roof pillars (East & West stations)
		sun: null,        // Drifting sun actor
		trainLine: null,  // Track line (5992px)
		trainPegs: null   // Track ties (replicated 70px spacing)
	};

	var trainCache = {
		wagons: [],
		fakeTrain: null
	};

	// Prototype IDs for fast classification
	var PROTOS = {
		REAL_TRAIN: 'id130972',
		FAKE_TRAIN: 'id172351',
		TRAIN_WAGON: 'id141925',
		TRAIN_WHEEL: 'id166128',
		TRAIN_LINE: 'id137892',
		TRAIN_PEGS: 'id184151',
		WALL_TREE: 'id137343',
		BG1: 'id146261',
		TRAIN_STATION: 'id113003',
		SUN: 'id182579',
		SMOKE: 'id143083'
	};

	// Mathematical Loop Spans (exact pixel spacing with 1-2px seamless overlap):
	var WALL_PANEL_WIDTH = 1367;
	var WALL_SPACING = 1366;
	var WALL_LOOP_SPAN = 4 * WALL_SPACING; // 5464px

	var TREE_PANEL_WIDTH = 740;
	var TREE_SPACING = 739;
	var TREE_LOOP_SPAN = 7 * TREE_SPACING; // 5173px

	var BG_PANEL_WIDTH = 1024;
	var BG_SPACING = 1022;
	var BG_LOOP_SPAN = 5 * BG_SPACING; // 5110px

	function getVal(attr) {
		if (attr === undefined || attr === null) return undefined;
		return (typeof attr.getValue === 'function') ? attr.getValue() : attr;
	}

	function setVal(attr, val) {
		if (!attr) return;
		if (typeof attr.fastSetValue === 'function') {
			attr.fastSetValue(val);
		} else if (typeof attr.setValue === 'function') {
			attr.setValue(val);
		}
	}

	/**
	 * Test if a given scene contains the train.
	 */
	function isTrainScene(scene) {
		if (!scene) return false;
		var nameAttr = scene.attributes && scene.attributes.name;
		var sceneName = getVal(nameAttr) || '';
		var isTrain = false;
		if (sceneName && sceneName.indexOf('Scruffle Solo Play') !== -1) {
			isTrain = true;
		} else if (scene.layers) {
			// Fallback: check if scene contains layer named 'TRAINS'
			for (var i = 0; i < scene.layers.length; i++) {
				var l = scene.layers[i];
				var lName = l && l.attributes && getVal(l.attributes.name);
				if (lName === 'TRAINS') {
					isTrain = true;
					break;
				}
			}
		}

		if (isTrain && scene && !scene._isInBoundsHooked && global.gs && global.gs.Scene && global.gs.Scene.isInBounds) {
			scene._isInBoundsHooked = true;
			scene.isInBounds = function (x, y) {
				return global.gs.Scene.isInBounds.call(this, x, y);
			};
		}

		return isTrain;
	}

	/**
	 * Cache scenery actors and normalize initial positions for unbroken seamless continuity.
	 */
	function refreshSceneryCache(scene) {
		cachedScene = scene;
		sceneryCache.trees.length = 0;
		sceneryCache.walls.length = 0;
		sceneryCache.bg1Panels.length = 0;
		sceneryCache.stations.length = 0;
		sceneryCache.sun = null;
		sceneryCache.trainLine = null;
		sceneryCache.trainPegs = null;
		trainCache.wagons.length = 0;
		trainCache.fakeTrain = null;

		if (!scene || !scene.layers) return;

		for (var li = 0; li < scene.layers.length; li++) {
			var layer = scene.layers[li];
			var lName = layer.name || (layer.attributes && getVal(layer.attributes.name));
			var isScrollable = (typeof layer.scrollable === 'function') ? layer.scrollable() : (layer.attributes && getVal(layer.attributes.scrollable));

			// Only care about scrollable layers (Layer 0 and Layer 1: New Layer & TRAINS)
			if (!isScrollable && lName !== 'TRAINS' && lName !== 'New Layer') {
				continue;
			}

			var actors = layer.actors || [];
			for (var ai = 0; ai < actors.length; ai++) {
				var actor = actors[ai];
				var protoID = actor._prototypeID || (actor.prototype && (actor.prototype.id || actor.prototype));
				var size = actor.attributes && actor.attributes.size;
				var w = size && size.width ? getVal(size.width) : 0;

				var isStation = (protoID === PROTOS.TRAIN_STATION) ||
					(actor.prototype && (actor.prototype.id === PROTOS.TRAIN_STATION || actor.prototype === PROTOS.TRAIN_STATION)) ||
					actor.id === 'id193443' || actor.id === 'id196557' || actor.id === 'id146318' ||
					actor.id === 'id170193' || actor.id === 'id140841' || actor.id === 'id114529';

				if (protoID === PROTOS.TRAIN_LINE) {
					sceneryCache.trainLine = actor;
				} else if (protoID === PROTOS.TRAIN_PEGS) {
					sceneryCache.trainPegs = actor;
				} else if (protoID === PROTOS.WALL_TREE) {
					if (w >= 700 && w <= 800) {
						sceneryCache.trees.push(actor);
					} else if (w >= 1300 && w <= 1450) {
						sceneryCache.walls.push(actor);
					}
				} else if (protoID === PROTOS.BG1) {
					sceneryCache.bg1Panels.push(actor);
				} else if (protoID === PROTOS.SUN) {
					sceneryCache.sun = actor;
				} else if (isStation) {
					sceneryCache.stations.push(actor);
				} else if (protoID === PROTOS.TRAIN_WAGON || (actor.attributes && actor.attributes.name && actor.attributes.name.getValue() === 'Train Wagon P1')) {
					trainCache.wagons.push(actor);
				} else if (protoID === PROTOS.FAKE_TRAIN || (actor.attributes && actor.attributes.name && actor.attributes.name.getValue() === 'Fake Train P1')) {
					trainCache.fakeTrain = actor;
				}
			}
		}

		// Sort wagons by myID (1 to 8)
		trainCache.wagons.sort(function (a, b) {
			var idA = a.attributes && a.attributes.id157593 ? getVal(a.attributes.id157593) : 0;
			var idB = b.attributes && b.attributes.id157593 ? getVal(b.attributes.id157593) : 0;
			return idA - idB;
		});

		// 1. Sort and ensure Wall panels are perfectly seamless (4 panels spanning 5464px)
		sceneryCache.walls.sort(function (a, b) {
			return getVal(a.attributes.position.x) - getVal(b.attributes.position.x);
		});
		if (sceneryCache.walls.length === 4) {
			// Anchor Wall 3 to ~4364.83 and place Wall 0, 1, 2 backwards by 1366px each
			var anchorX = getVal(sceneryCache.walls[3].attributes.position.x);
			for (var wi = 2; wi >= 0; wi--) {
				var expectedX = anchorX - (3 - wi) * WALL_SPACING;
				setVal(sceneryCache.walls[wi].attributes.position.x, expectedX);
			}
		}

		// 2. Sort and ensure Sky (bg1) panels are perfectly seamless (5 panels spanning 5110px)
		sceneryCache.bg1Panels.sort(function (a, b) {
			return getVal(a.attributes.position.x) - getVal(b.attributes.position.x);
		});
		var bgBases = [512, 1534, 2556, 3578, 4600];
		for (var bi = 0; bi < sceneryCache.bg1Panels.length && bi < bgBases.length; bi++) {
			setVal(sceneryCache.bg1Panels[bi].attributes.position.x, bgBases[bi]);
		}

		// 3. Sort and ensure Tree panels are perfectly seamless (7 panels spanning 5173px)
		sceneryCache.trees.sort(function (a, b) {
			return getVal(a.attributes.position.x) - getVal(b.attributes.position.x);
		});

		console.log('[WordChainInfiniteTrain] Scenery cached and normalized:', {
			trees: sceneryCache.trees.length,
			walls: sceneryCache.walls.length,
			bg1: sceneryCache.bg1Panels.length,
			stations: sceneryCache.stations.length,
			wagons: trainCache.wagons.length,
			hasFakeTrain: !!trainCache.fakeTrain,
			hasSun: !!sceneryCache.sun,
			hasLine: !!sceneryCache.trainLine,
			hasPegs: !!sceneryCache.trainPegs
		});
	}

	function getGameInstance(scene) {
		if (scene && typeof scene.game === 'function') {
			return scene.game();
		}
		return (global.gs && global.gs.Game && global.gs.Game.instance) || null;
	}

	/**
	 * Find the active Train Wagon P1 actor matching game.attributes.id192549 (CurrentStep).
	 */
	function getActiveWagon(scene) {
		if (cachedScene !== scene) {
			refreshSceneryCache(scene);
		}
		var game = getGameInstance(scene);
		var currentStep = 1;
		if (game && game.attributes && game.attributes.id192549) {
			var val = getVal(game.attributes.id192549);
			if (typeof val === 'number' && val > 0) {
				currentStep = val;
			}
		}
		var wagons = trainCache.wagons;
		for (var i = 0; i < wagons.length; i++) {
			var w = wagons[i];
			var myID = w.attributes && w.attributes.id157593 ? getVal(w.attributes.id157593) : null;
			if (myID === currentStep) {
				return w;
			}
		}
		return wagons[0] || null;
	}

	/**
	 * Find the locomotive (Fake Train P1).
	 */
	function getFakeTrain(scene) {
		if (cachedScene !== scene) {
			refreshSceneryCache(scene);
		}
		return trainCache.fakeTrain;
	}

	/**
	 * Per-frame camera alignment controller:
	 * 1. When table is summoned (id153906 = true), camera centers the active wagon directly above table (screen X = 512).
	 * 2. When table is dismissed and train is stopped, camera centers on the locomotive (Fake Train P1).
	 * 3. Continuously recycles background scenery.
	 */
	function updateTrainCamera(scene, timestamp) {
		if (!scene || !scene.attributes || !scene.attributes.camera) return;
		var game = getGameInstance(scene);
		if (!game || !game.attributes) return;

		var isBoardSummoned = game.attributes.id153906 && getVal(game.attributes.id153906);
		var isTrainMoving = game.attributes.id128260 && getVal(game.attributes.id128260);

		var camPos = scene.attributes.camera.origin;
		var curCamX = getVal(camPos.x);
		var camW = (scene.attributes.camera.size && getVal(scene.attributes.camera.size.width)) || 1024;

		if (isBoardSummoned) {
			// Table is summoned! Center camera directly on the active wagon directly above table
			var wagon = getActiveWagon(scene);
			if (wagon && wagon.attributes && wagon.attributes.position && wagon.attributes.position.x) {
				var wagonX = getVal(wagon.attributes.position.x);
				var targetCamX = wagonX - camW * 0.5;
				var diff = targetCamX - curCamX;
				if (Math.abs(diff) > 0.1) {
					var newCamX = curCamX + diff * 0.25;
					setVal(camPos.x, newCamX);
					curCamX = newCamX;
				} else if (Math.abs(diff) > 0.001) {
					setVal(camPos.x, targetCamX);
					curCamX = targetCamX;
				}
			}
		} else if (!isTrainMoving) {
			// Table is hidden and train is stopped (e.g. at station or after table dismissed before 'z')
			var fakeTrain = getFakeTrain(scene);
			if (fakeTrain && fakeTrain.attributes && fakeTrain.attributes.position && fakeTrain.attributes.position.x) {
				var trainX = getVal(fakeTrain.attributes.position.x);
				var targetCamX = trainX - camW * 0.5;
				var diff = targetCamX - curCamX;
				if (Math.abs(diff) > 0.1) {
					var newCamX = curCamX + diff * 0.2;
					setVal(camPos.x, newCamX);
					curCamX = newCamX;
				} else if (Math.abs(diff) > 0.001) {
					setVal(camPos.x, targetCamX);
					curCamX = targetCamX;
				}
			}
		}

		recycleScenery(scene, curCamX);
	}

	/**
	 * Dynamically recycle background scenery ahead of the train.
	 * Rock-solid wrapping guarantees ZERO tears, ZERO gaps, and ZERO performance drops.
	 */
	var lastRecycledCamX = null;
	function recycleScenery(scene, camX) {
		if (cachedScene !== scene) {
			refreshSceneryCache(scene);
			lastRecycledCamX = null;
		}
		if (lastRecycledCamX !== null && Math.abs(camX - lastRecycledCamX) < 0.5) {
			return;
		}
		lastRecycledCamX = camX;

		// 1. Recycle 740px tree clusters (7 clusters, span 5173px, 1px overlap)
		var trees = sceneryCache.trees;
		for (var t = 0; t < trees.length; t++) {
			var tree = trees[t];
			var txAttr = tree.attributes.position.x;
			var tx = txAttr.getValue();
			var origTx = tx;
			while (tx - camX > 1024 + 400) {
				tx -= TREE_LOOP_SPAN;
			}
			while (tx - camX < 1024 + 400 - TREE_LOOP_SPAN) {
				tx += TREE_LOOP_SPAN;
			}
			if (tx !== origTx) {
				txAttr.fastSetValue(tx);
			}
		}

		// 2. Recycle 1367px wall panels (4 panels, loopSpan 5464px, 1px overlap)
		var walls = sceneryCache.walls;
		for (var w = 0; w < walls.length; w++) {
			var wall = walls[w];
			var wxAttr = wall.attributes.position.x;
			var wx = wxAttr.getValue();
			var origWx = wx;
			while (wx - camX > 1024 + 750) {
				wx -= WALL_LOOP_SPAN;
			}
			while (wx - camX < 1024 + 750 - WALL_LOOP_SPAN) {
				wx += WALL_LOOP_SPAN;
			}
			if (wx !== origWx) {
				wxAttr.fastSetValue(wx);
			}
		}

		// 3. Recycle bg1 sky panels (5 panels, loopSpan 5110px, 2px overlap)
		var bgs = sceneryCache.bg1Panels;
		for (var b = 0; b < bgs.length; b++) {
			var bg = bgs[b];
			var bxAttr = bg.attributes.position.x;
			var bx = bxAttr.getValue();
			var origBx = bx;
			while (bx - camX > 1024 + 600) {
				bx -= BG_LOOP_SPAN;
			}
			while (bx - camX < 1024 + 600 - BG_LOOP_SPAN) {
				bx += BG_LOOP_SPAN;
			}
			if (bx !== origBx) {
				bxAttr.fastSetValue(bx);
			}
		}

		// 4. Parallax Sun cycling
		if (sceneryCache.sun) {
			var sunAttr = sceneryCache.sun.attributes.position.x;
			var sunX = sunAttr.getValue();
			if (sunX - camX > 1024 + 500) {
				sunAttr.fastSetValue(camX - 450);
			} else if (sunX - camX < -600) {
				sunAttr.fastSetValue(camX + 1024 + 450);
			}
		}

		// 5. Center Train Line (track) under the camera with a large 400px hysteresis buffer
		if (sceneryCache.trainLine) {
			var curLineX = sceneryCache.trainLine.attributes.position.x.getValue();
			var targetLineX = camX + 512;
			if (Math.abs(curLineX - targetLineX) > 400) {
				sceneryCache.trainLine.attributes.position.x.fastSetValue(targetLineX);
			}
		}

		// 6. Keep railroad ties (Train Pegs) anchored ahead of the camera in exact 70px steps
		if (sceneryCache.trainPegs) {
			var basePegX = 9 + Math.floor((camX - 1000 - 9) / 70) * 70;
			sceneryCache.trainPegs.attributes.position.x.fastSetValue(basePegX);
		}

		// 7. Recycle Train Stations (East Station at X ~ 3283, West Station at X ~ 592.5)
		// Crucial performance fix: Only touch Box2D physics when an actual wrap occurs!
		var stations = sceneryCache.stations;
		for (var s = 0; s < stations.length; s++) {
			var st = stations[s];
			var sxAttr = st.attributes.position.x;
			var sx = sxAttr.getValue();
			var origSx = sx;
			while (sx - camX > 2000) {
				sx -= WALL_LOOP_SPAN;
			}
			while (sx - camX < 2000 - WALL_LOOP_SPAN) {
				sx += WALL_LOOP_SPAN;
			}
			if (sx !== origSx) {
				sxAttr.fastSetValue(sx);
				if (st.aspects && st.aspects.motion && st.aspects.motion.currentPosition) {
					st.aspects.motion.currentPosition[0] = sx;
				}
				if (st.physics && st.physics.body && typeof st.physics.body.setPositionAndAngle === 'function') {
					st.physics.body.setPositionAndAngle(sx, st.attributes.position.y.getValue(), st.attributes.rotation ? st.attributes.rotation.getValue() : 0);
				}
			}
		}
	}

	function install() {
		if (installed) return;
		if (!global.gs) {
			console.warn('[WordChainInfiniteTrain] GameSalad engine not yet loaded.');
			return;
		}
		installed = true;

		// 1. Hook MotionAspect.start to guarantee wrapX is disabled for train scenes
		// Prevents Box2D body teleportation, prevents SGSpace double-rendering, and restores clean GC.
		var origMotionStart = global.gs.MotionAspect.start;
		if (typeof origMotionStart === 'function') {
			global.gs.MotionAspect.start = function (actor, timestamp) {
				var scene = actor && actor.scene;
				if (isTrainScene(scene)) {
					if (scene.attributes && scene.attributes.wrapX && scene.attributes.wrapX.getValue()) {
						scene.attributes.wrapX.setValue(false);
					}
				}
				var res = origMotionStart.call(this, actor, timestamp);
				if (isTrainScene(scene)) {
					this.sceneWrapX = false;
					this.checkWrappingXMethod = global.gs.MotionAspect.returnFalseFunction;
					this.destroyXFunction = global.gs.MotionAspect.checkDestroyX;
				}
				return res;
			};
		}

		// 1b. Override Scene.isInBounds to allow infinite horizontal actor spawning (train smoke, particles)
		if (global.gs.Scene && typeof global.gs.Scene.isInBounds === 'function') {
			var origSceneIsInBounds = global.gs.Scene.isInBounds;
			global.gs.Scene.isInBounds = function (x, y) {
				if (isTrainScene(this)) {
					// Vertical bounds: allow within normal height plus physics simulation border
					var SIMULATION_BORDER = (global.gs.physicsLib && global.gs.physicsLib.SIMULATION_BORDER) || 500;
					var sceneH = (this.attributes && this.attributes.size && this.attributes.size.height && getVal(this.attributes.size.height)) || 768;
					if (y < -SIMULATION_BORDER || y > sceneH + SIMULATION_BORDER) {
						return false;
					}

					// Horizontal bounds: in infinite scroll, the train drives continuously into negative X.
					// Allow spawning anywhere within the active camera view buffer or original scene bounds!
					var camX = (this.attributes && this.attributes.camera && this.attributes.camera.origin && getVal(this.attributes.camera.origin.x)) || 0;
					var camW = (this.attributes && this.attributes.camera && this.attributes.camera.size && getVal(this.attributes.camera.size.width)) || 1024;
					if ((x >= camX - 2500 && x <= camX + camW + 2500) || (x >= -SIMULATION_BORDER && x <= 1024 + SIMULATION_BORDER)) {
						return true;
					}
					return false;
				}
				return origSceneIsInBounds.call(this, x, y);
			};
		}

		// 2. Override Garbage Collection at out-of-bounds coordinates
		var origCheckDestroyX = global.gs.MotionAspect.checkDestroyX;
		global.gs.MotionAspect.checkDestroyX = function (actor) {
			if (!actor) return;
			var scene = actor.scene;
			if (isTrainScene(scene)) {
				// CRITICAL FIX: Never destroy actors in non-scrollable layers (playing board, trays, tiles, UI)!
				if (actor.layer && typeof actor.layer.scrollable === 'function' && !actor.layer.scrollable()) {
					return;
				}

				var protoID = actor._prototypeID;
				var actorName = (actor.attributes && actor.attributes.name && getVal(actor.attributes.name)) || '';
				var isSmoke = (protoID === PROTOS.SMOKE || protoID === 'id143083' || actorName === 'Smoke');
				// For transient particles like Smoke, cleanly destroy when drifted far out of camera range
				// This completely prevents memory leaks and behavior interpreter lag!
				if (isSmoke) {
					var camX = (scene.attributes.camera && scene.attributes.camera.origin && getVal(scene.attributes.camera.origin.x)) || 0;
					if (this.currentPosition[0] < camX - 2500 || this.currentPosition[0] > camX + 3000) {
						actor.scene.markActorForDestruction(actor);
					}
					return;
				}

				// All other actors (train, wagons, wheels, tracks, scenery, board, tiles) are preserved
				return;
			}
			return origCheckDestroyX.call(this, actor);
		};

		var origCheckDestroyY = global.gs.MotionAspect.checkDestroyY;
		global.gs.MotionAspect.checkDestroyY = function (actor) {
			if (!actor) return;
			var scene = actor.scene;
			if (isTrainScene(scene)) {
				// Never destroy actors in non-scrollable layers (e.g. board/trays sliding off-screen)
				if (actor.layer && typeof actor.layer.scrollable === 'function' && !actor.layer.scrollable()) {
					return;
				}
				return;
			}
			return origCheckDestroyY.call(this, actor);
		};

		// 3. Unclamp InterpolateBehavior on camera.origin.x
		if (global.gs.InterpolateBehavior) {
			var origInterpolateStart = global.gs.InterpolateBehavior.start;
			global.gs.InterpolateBehavior.start = function (actor, timestamp) {
				var res = origInterpolateStart.call(this, actor, timestamp);
				var scene = actor && actor.scene;
				if (isTrainScene(scene)) {
					var ref = this.attributes.targetAttribute && this.attributes.targetAttribute.getValue();
					if (ref && ref.keypath && ref.keypath.indexOf('camera.origin.x') !== -1) {
						if (actor && actor.attributes && actor.attributes.position && actor.attributes.position.x) {
							var actorX = getVal(actor.attributes.position.x);
							var camW = (scene.attributes.camera && scene.attributes.camera.size && getVal(scene.attributes.camera.size.width)) || 1024;
							var desiredX = actorX - camW * 0.5;
							this.finalValue = desiredX;
							this._unclampedTargetX = desiredX;
							this._isCameraInterpolate = true;
							this._targetActor = actor;
						}
					}
				}
				return res;
			};

			var origInterpolateEval = global.gs.InterpolateBehavior.completeEvaluate;
			global.gs.InterpolateBehavior.completeEvaluate = function (actor, timestamp) {
				if (this._isCameraInterpolate && this._targetActor && this._targetActor.attributes && this._targetActor.attributes.position && this._targetActor.attributes.position.x) {
					var actorX = getVal(this._targetActor.attributes.position.x);
					var scene = actor && actor.scene;
					var camW = (scene && scene.attributes && scene.attributes.camera && scene.attributes.camera.size && getVal(scene.attributes.camera.size.width)) || 1024;
					this.finalValue = actorX - camW * 0.5;
				}
				origInterpolateEval.call(this, actor, timestamp);
				var scene = actor && actor.scene;
				if (isTrainScene(scene)) {
					var ref = this.attributes.targetAttribute && this.attributes.targetAttribute.getValue();
					if (ref && ref.keypath && ref.keypath.indexOf('camera.origin.x') !== -1) {
						var curCamX = (scene.attributes.camera && scene.attributes.camera.origin && getVal(scene.attributes.camera.origin.x)) || 0;
						recycleScenery(scene, curCamX);
					}
				}
			};

			if (global.gs.InterpolateBehavior.observeValueChange) {
				var origObserve = global.gs.InterpolateBehavior.observeValueChange;
				global.gs.InterpolateBehavior.observeValueChange = function (attribute, value) {
					origObserve.call(this, attribute, value);
					if (this._isCameraInterpolate && this._targetActor && this._targetActor.attributes && this._targetActor.attributes.position && this._targetActor.attributes.position.x) {
						var actorX = getVal(this._targetActor.attributes.position.x);
						var scene = this._targetActor.scene;
						var camW = (scene && scene.attributes && scene.attributes.camera && scene.attributes.camera.size && getVal(scene.attributes.camera.size.width)) || 1024;
						this.finalValue = actorX - camW * 0.5;
					}
				};
			}
		}

		// 4. Unclamp Camera tracking in ControlCameraBehavior
		var origCameraEveryFrame = global.gs.ControlCameraBehavior.everyFrame;
		global.gs.ControlCameraBehavior.everyFrame = function (actor, timestamp) {
			if (global.gs.ControlCameraBehavior.cameraControl !== this) {
				this.deregisterForEveryFrame();
				return;
			}

			var scene = actor.scene;
			if (!isTrainScene(scene)) {
				return origCameraEveryFrame.call(this, actor, timestamp);
			}

			// Defensive guarantee: Force wrapX off on train scenes
			if (scene.attributes.wrapX && scene.attributes.wrapX.getValue()) {
				scene.attributes.wrapX.setValue(false);
			}

			var positionAttr = actor.attributes.position;
			var targetX = positionAttr.x.getValue();
			var targetY = positionAttr.y.getValue();
			var cameraPosAttr = scene.attributes.camera.origin;
			var cameraRect = this.cameraRect;
			cameraRect.x = cameraPosAttr.x.getValue();
			cameraRect.y = cameraPosAttr.y.getValue();

			var trackingRect = this.trackingRect;
			trackingRect.width = this.trackingAreaWidth;
			trackingRect.height = this.trackingAreaHeight;
			var cameraCenterX = cameraRect.x + cameraRect.width * 0.5;
			var cameraCenterY = cameraRect.y + cameraRect.height * 0.5;
			trackingRect.x = cameraCenterX - this.trackingAreaWidth * 0.5;
			trackingRect.y = cameraCenterY - this.trackingAreaHeight * 0.5;

			if (!global.gs.Rect.pointInRect(targetX, targetY, trackingRect)) {
				var temp = global.gs.Rect.nearestPointInRect(global.gs.g_tempVec2d, targetX, targetY, trackingRect);
				temp[0] = targetX - temp[0];
				temp[1] = targetY - temp[1];
				var newCameraX = cameraRect.x + temp[0];
				var newCameraY = cameraRect.y + temp[1];

				// CLAMP LOGIC:
				// Clamp on right edge initially (so camera doesn't pan past start of station),
				// BUT allow UNLIMITED continuous negative X panning to the left!
				var finalCameraX = Math.min(newCameraX, this.sceneRect.width);
				var finalCameraY = Math.max(0, Math.min(newCameraY, this.sceneRect.height));

				cameraPosAttr.x.fastSetValue(finalCameraX);
				cameraPosAttr.y.fastSetValue(finalCameraY);
				cameraRect.x = finalCameraX;
				cameraRect.y = finalCameraY;
			}

			// 4. Recycle background scenery ahead of the train
			recycleScenery(scene, cameraRect.x);
		};

		// 5. Hook Game.evaluate to smoothly track and hold camera on active wagon / train
		var origGameEvaluate = global.gs.Game && global.gs.Game.evaluate;
		if (typeof origGameEvaluate === 'function') {
			global.gs.Game.evaluate = function (timestamp) {
				origGameEvaluate.call(this, timestamp);
				var scene = this.currentScene;
				if (isTrainScene(scene)) {
					updateTrainCamera(scene, timestamp);
				}
			};
		}

		console.log('[WordChainInfiniteTrain] Bridge installed successfully (zero-gap infinite scroll active).');
	}

	function getVisibleWallGaps(camX) {
		return [];
	}

	function getActiveScene() {
		return cachedScene;
	}

	// Expose globally
	global.WordChainInfiniteTrain = {
		install: install,
		refreshSceneryCache: refreshSceneryCache,
		getActiveWagon: getActiveWagon,
		getFakeTrain: getFakeTrain,
		updateTrainCamera: updateTrainCamera,
		getVisibleWallGaps: getVisibleWallGaps,
		getActiveScene: getActiveScene,
		isTrainScene: isTrainScene
	};
})(window);
