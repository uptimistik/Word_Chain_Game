/*
 * Word Chain Game - Train Infinite Scroll Bridge
 * ------------------------------------------------
 * Bypasses GameSalad scene limits and camera clamping on Scruffle Solo Play:
 * 1. Unclamps camera.origin.x: Allows the camera to track the train continuously
 *    into negative X without stopping at X = 0.
 * 2. Overrides checkDestroyX: Completely disables the -500px garbage collection
 *    threshold for train components, wheels, and repeating scenery.
 * 3. Continuous Background Recycler: Recycles background trees, wall tiles, and
 *    railroad ties ahead of the oncoming train, creating an unbroken 60 FPS
 *    infinite leftward run with ZERO camera jolts and ZERO wall tearing.
 * 4. Ground-Truth Wall Gap Exporter: Accurately identifies the single natural
 *    gorge opening between the 4 continuous 1367px wall panels (width: 416px,
 *    drawWidth: 440px with seamless 12px cliff overlap).
 */
(function (global) {
	'use strict';

	var installed = false;
	var cachedScene = null;
	var sceneryCache = {
		trees: [],        // 740px tree clusters (7 clusters, span 5180px)
		walls: [],        // 1367px background wall panels (4 panels, loopSpan 5468px)
		bg1Panels: [],    // bg1 sky/scenery panels
		stations: [],     // Train station buildings and roof pillars (East & West stations)
		trainLine: null,  // Track line (5992px)
		trainPegs: null   // Track ties (replicated 70px spacing)
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
		TRAIN_STATION: 'id113003'
	};

	// Scene 5 Wall geometry constants:
	// 4 wall panels form an unbroken 5052px wall spanning [-3.67, 5048.33].
	// At loop modulus 5468px, there is exactly ONE natural gorge gap:
	var LOOP_SPAN = 5468;
	var GAP_BASE_LEFT = 5048.333;
	var GAP_BASE_RIGHT = 5464.333;
	var GAP_CENTER = (GAP_BASE_LEFT + GAP_BASE_RIGHT) * 0.5; // 5256.333
	var GAP_WIDTH = 416.0;
	var DRAW_WIDTH = 440.0; // 416px + 24px (12px overlap onto each cliff wall)

	/**
	 * Test if a given scene contains the train.
	 */
	function isTrainScene(scene) {
		if (!scene) return false;
		var nameAttr = scene.attributes && scene.attributes.name;
		var sceneName = nameAttr ? nameAttr.getValue() : '';
		if (sceneName && sceneName.indexOf('Scruffle Solo Play') !== -1) {
			return true;
		}
		// Fallback: check if scene contains layer named 'TRAINS'
		if (scene.layers) {
			for (var i = 0; i < scene.layers.length; i++) {
				var l = scene.layers[i];
				var lName = l && l.attributes && l.attributes.name && l.attributes.name.getValue();
				if (lName === 'TRAINS') return true;
			}
		}
		return false;
	}

	/**
	 * Cache scenery actors for efficient recycling without per-frame allocations.
	 */
	function refreshSceneryCache(scene) {
		cachedScene = scene;
		sceneryCache.trees.length = 0;
		sceneryCache.walls.length = 0;
		sceneryCache.bg1Panels.length = 0;
		sceneryCache.stations.length = 0;
		sceneryCache.trainLine = null;
		sceneryCache.trainPegs = null;

		if (!scene || !scene.layers) return;

		for (var li = 0; li < scene.layers.length; li++) {
			var layer = scene.layers[li];
			var lName = layer.attributes && layer.attributes.name && layer.attributes.name.getValue();
			var isScrollable = layer.scrollable && layer.scrollable();

			// Only care about scrollable layers (Layer 0 and Layer 1: New Layer & TRAINS)
			if (!isScrollable && lName !== 'TRAINS' && lName !== 'New Layer') {
				continue;
			}

			var actors = layer.actors || [];
			for (var ai = 0; ai < actors.length; ai++) {
				var actor = actors[ai];
				var protoID = actor._prototypeID || (actor.prototype && actor.prototype.id);
				var size = actor.attributes && actor.attributes.size;
				var w = size && size.width ? size.width.getValue() : 0;

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
				} else if (isStation) {
					sceneryCache.stations.push(actor);
				}
			}
		}

		console.log('[WordChainInfiniteTrain] Scenery cached:', {
			trees: sceneryCache.trees.length,
			walls: sceneryCache.walls.length,
			bg1: sceneryCache.bg1Panels.length,
			stations: sceneryCache.stations.length,
			hasLine: !!sceneryCache.trainLine,
			hasPegs: !!sceneryCache.trainPegs
		});
	}

	/**
	 * Dynamically recycle background trees, walls, and tracks ahead of the train.
	 * Rock-solid offscreen wrapping guarantees ZERO tears and ZERO extra holes.
	 */
	function recycleScenery(scene, camX) {
		if (cachedScene !== scene) {
			refreshSceneryCache(scene);
		}

		// 1. Recycle 740px tree clusters (7 clusters, span 5180px)
		var trees = sceneryCache.trees;
		for (var t = 0; t < trees.length; t++) {
			var tree = trees[t];
			var txAttr = tree.attributes.position.x;
			var tx = txAttr.getValue();
			while (tx - camX > 1024 + 400) {
				tx -= 5180;
			}
			while (tx - camX < -400 - 5180 + 1024) {
				tx += 5180;
			}
			txAttr.fastSetValue(tx);
		}

		// 2. Recycle 1367px wall panels (4 panels, loopSpan 5468px)
		// Crucial: All walls wrap only when completely off-screen, maintaining unbroken adjacency
		var walls = sceneryCache.walls;
		for (var w = 0; w < walls.length; w++) {
			var wall = walls[w];
			var wxAttr = wall.attributes.position.x;
			var wx = wxAttr.getValue();
			while (wx - camX > 1024 + 750) {
				wx -= LOOP_SPAN;
			}
			while (wx - camX < -750 - LOOP_SPAN + 1024) {
				wx += LOOP_SPAN;
			}
			wxAttr.fastSetValue(wx);
		}

		// 3. Recycle bg1 sky panels (width ~1024)
		var bgs = sceneryCache.bg1Panels;
		for (var b = 0; b < bgs.length; b++) {
			var bg = bgs[b];
			var bxAttr = bg.attributes.position.x;
			var bx = bxAttr.getValue();
			while (bx - camX > 1024 + 600) {
				bx -= 4096;
			}
			while (bx - camX < -600 - 4096 + 1024) {
				bx += 4096;
			}
			bxAttr.fastSetValue(bx);
		}

		// 4. Center Train Line (track) under the camera so it extends 2500px on both sides
		if (sceneryCache.trainLine) {
			sceneryCache.trainLine.attributes.position.x.fastSetValue(camX + 512);
		}

		// 5. Keep railroad ties (Train Pegs) anchored ahead of the camera in exact 70px steps
		if (sceneryCache.trainPegs) {
			var basePegX = 9 + Math.floor((camX - 1000 - 9) / 70) * 70;
			sceneryCache.trainPegs.attributes.position.x.fastSetValue(basePegX);
		}

		// 6. Recycle Train Stations (East Station at X ~ 3283, West Station at X ~ 592.5)
		// Both stations cycle with the exact same LOOP_SPAN (5468px) so they appear consistently along the route!
		var stations = sceneryCache.stations;
		for (var s = 0; s < stations.length; s++) {
			var st = stations[s];
			var sxAttr = st.attributes.position.x;
			var sx = sxAttr.getValue();
			while (sx - camX > 2000) {
				sx -= LOOP_SPAN;
			}
			while (sx - camX < -2500) {
				sx += LOOP_SPAN;
			}
			sxAttr.fastSetValue(sx);
			if (st.aspects && st.aspects.motion && st.aspects.motion.currentPosition) {
				st.aspects.motion.currentPosition[0] = sx;
			}
			if (st.physics && st.physics.body && typeof st.physics.body.setPositionAndAngle === 'function') {
				st.physics.body.setPositionAndAngle(sx, st.attributes.position.y.getValue(), st.attributes.rotation ? st.attributes.rotation.getValue() : 0);
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

		// 1. Override Garbage Collection at X < -500
		var origCheckDestroyX = global.gs.MotionAspect.checkDestroyX;
		global.gs.MotionAspect.checkDestroyX = function (actor) {
			if (!actor) return;
			var scene = actor.scene;
			if (isTrainScene(scene)) {
				var protoID = actor._prototypeID;
				// Never destroy train, wagons, wheels, pegs, tracks, or background scenery
				if (protoID === PROTOS.REAL_TRAIN ||
					protoID === PROTOS.FAKE_TRAIN ||
					protoID === PROTOS.TRAIN_WAGON ||
					protoID === PROTOS.TRAIN_WHEEL ||
					protoID === PROTOS.TRAIN_LINE ||
					protoID === PROTOS.TRAIN_PEGS ||
					protoID === PROTOS.WALL_TREE ||
					protoID === PROTOS.BG1 ||
					protoID === PROTOS.TRAIN_STATION) {
					return;
				}

				// For transient particles like Smoke, allow natural self-destruction
				// but prevent abrupt clipping right at -500px
				var camX = (scene.attributes.camera && scene.attributes.camera.origin.x.getValue()) || 0;
				if (this.currentPosition[0] > camX - 1000 && this.currentPosition[0] < camX + 2500) {
					return;
				}
			}
			return origCheckDestroyX.call(this, actor);
		};

		// 2. Unclamp Camera tracking in ControlCameraBehavior
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

			// 3. Recycle background scenery ahead of the train
			recycleScenery(scene, cameraRect.x);
		};

		console.log('[WordChainInfiniteTrain] Bridge installed successfully.');
	}

	/**
	 * Compute visible gorge gaps for the waterfall renderer.
	 * Returns array of { k, left, right, width, drawWidth, center, variationIndex }
	 */
	function getVisibleWallGaps(camX) {
		var viewCenter = camX + 512;
		var kCenter = Math.round((viewCenter - GAP_CENTER) / LOOP_SPAN);
		var visibleGaps = [];

		for (var k = kCenter - 1; k <= kCenter + 1; k++) {
			var left = k * LOOP_SPAN + GAP_BASE_LEFT;
			var right = k * LOOP_SPAN + GAP_BASE_RIGHT;
			var center = k * LOOP_SPAN + GAP_CENTER;

			// Visible or within 100px buffer of screen [camX, camX + 1024]
			if (right >= camX - 100 && left <= camX + 1024 + 100) {
				visibleGaps.push({
					k: k,
					left: left,
					right: right,
					width: GAP_WIDTH,
					drawWidth: DRAW_WIDTH,
					center: center,
					variationIndex: ((k % 4) + 4) % 4
				});
			}
		}
		return visibleGaps;
	}

	function getActiveScene() {
		return cachedScene;
	}

	// Expose globally
	global.WordChainInfiniteTrain = {
		install: install,
		refreshSceneryCache: refreshSceneryCache,
		getVisibleWallGaps: getVisibleWallGaps,
		getActiveScene: getActiveScene,
		isTrainScene: isTrainScene
	};
})(window);
