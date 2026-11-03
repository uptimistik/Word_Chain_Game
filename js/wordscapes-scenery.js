/**
 * Wordscapes-Style 3D Living Environment Engine
 * ---------------------------------------------
 * Authentic Three.js living environments faithfully displaying the 5 reference photos:
 *   1. 🌸 Blossom Park   - Lush park lawn, blooming trees & mountain ridges (images/scenery/sakura.jpg)
 *   2. 🌋 Volcano Night   - Erupting volcano cone & molten lava fountains (images/scenery/volcano.jpg)
 *   3. 🏔️ Winter Village  - Twilight snow valley, glowing chalet windows & lights (images/scenery/snowtown.jpg)
 *   4. ❄️ Alpine Peaks    - High-altitude powder snow peaks & ski slopes (images/scenery/peaks.jpg)
 *   5. 🏝️ Tropical Pier   - Crystal turquoise lagoon & wooden boardwalk (images/scenery/ocean.jpg)
 *
 * Full Vertical View:
 *   - The background photo fills 100% of the screen at the exact eye-level angle of the photograph!
 *   - The 3D letter board is 100% full vertical in front with ZERO perspective angle or tilt.
 *   - 3D living particles float in 3D space, passing physically IN FRONT of the playing tiles!
 *   - Locked 60 FPS, zero garbage collection.
 */
(function (global) {
	'use strict';

	var sceneRef = null;
	var cameraRef = null;
	var rendererRef = null;
	var rootGroup = null;

	var currentScenery = 'sakura';
	var envGroups = {};
	var particleSystems = {};
	var activeEnvGroup = null;
	var activeParticles = null;

	var particleTextures = {};
	var sceneryTextures = {};

	var lastCamY = 26.0;
	var lastCenterZ = -0.3;
	var lastFov = 46;
	var lastAspect = 0.5;

	var SCENERIES = {
		sakura: {
			id: 'sakura',
			name: 'Blossom Park',
			icon: '🌸',
			photo: 'images/scenery/sakura.jpg',
			aspectRatio: 1.33,
			particleType: 'petal',
			lighting: {
				ambient: { color: 0xfff6ee, intensity: 0.95 },
				sun: { color: 0xfffaed, intensity: 0.90, pos: [4, 20, 10] },
				fill: { color: 0xbfe3ff, intensity: 0.35, pos: [-8, 8, -6] }
			}
		},
		volcano: {
			id: 'volcano',
			name: 'Volcano Night',
			icon: '🌋',
			photo: 'images/scenery/volcano.jpg',
			aspectRatio: 1.50,
			particleType: 'ember',
			lighting: {
				ambient: { color: 0x3d2028, intensity: 0.88 },
				sun: { color: 0xff5511, intensity: 0.82, pos: [0, 22, -10] },
				fill: { color: 0x221222, intensity: 0.32, pos: [-8, 8, -6] }
			}
		},
		snowtown: {
			id: 'snowtown',
			name: 'Winter Village',
			icon: '🏔️',
			photo: 'images/scenery/snowtown.jpg',
			aspectRatio: 0.80,
			particleType: 'snow',
			lighting: {
				ambient: { color: 0x263752, intensity: 0.88 },
				sun: { color: 0x7c9ec8, intensity: 0.65, pos: [4, 18, 10] },
				fill: { color: 0xffa834, intensity: 0.32, pos: [-6, 6, -10] }
			}
		},
		peaks: {
			id: 'peaks',
			name: 'Alpine Peaks',
			icon: '❄️',
			photo: 'images/scenery/peaks.jpg',
			aspectRatio: 1.50,
			particleType: 'crystal',
			lighting: {
				ambient: { color: 0xdfefff, intensity: 0.96 },
				sun: { color: 0xffffff, intensity: 1.05, pos: [5, 22, 8] },
				fill: { color: 0x8ec2f6, intensity: 0.40, pos: [-8, 8, -6] }
			}
		},
		ocean: {
			id: 'ocean',
			name: 'Tropical Pier',
			icon: '🏝️',
			photo: 'images/scenery/ocean.jpg',
			aspectRatio: 1.50,
			particleType: 'seaMote',
			lighting: {
				ambient: { color: 0xe0f7fa, intensity: 0.92 },
				sun: { color: 0xfffae0, intensity: 1.00, pos: [3, 20, 10] },
				fill: { color: 0x7ddde8, intensity: 0.38, pos: [-8, 8, -6] }
			}
		}
	};

	// Aliases for legacy saves
	SCENERIES.rain = SCENERIES.volcano;
	SCENERIES.sunlit = SCENERIES.ocean;
	SCENERIES.aurora = SCENERIES.snowtown;
	SCENERIES.autumn = SCENERIES.peaks;

	var SCENERY_CYCLE_ORDER = ['sakura', 'volcano', 'snowtown', 'peaks', 'ocean'];

	// --------------------------------------------------------------------------
	// TEXTURE MANAGEMENT
	// --------------------------------------------------------------------------
	function getSceneryTexture(path) {
		if (sceneryTextures[path]) return sceneryTextures[path];
		var loader = new THREE.TextureLoader();
		var tex = loader.load(path);
		tex.encoding = THREE.sRGBEncoding;
		tex.generateMipmaps = true;
		tex.minFilter = THREE.LinearMipmapLinearFilter;
		tex.magFilter = THREE.LinearFilter;
		sceneryTextures[path] = tex;
		return tex;
	}

	// --------------------------------------------------------------------------
	// HIGH-DPI SOFT PROCEDURAL PARTICLE TEXTURES (128x128 ANTIALIASED)
	// --------------------------------------------------------------------------
	function createParticleTexture(type) {
		if (particleTextures[type]) return particleTextures[type];

		var size = 128;
		var canvas = document.createElement('canvas');
		canvas.width = size;
		canvas.height = size;
		var ctx = canvas.getContext('2d');
		var center = size * 0.5;

		if (type === 'petal') {
			// Delicate Curved Sakura / Poui Blossom Petal
			ctx.save();
			ctx.translate(center, center);
			ctx.rotate(-0.25);

			var grad = ctx.createRadialGradient(-4, -8, 4, 0, 0, 48);
			grad.addColorStop(0.0, 'rgba(255, 245, 250, 0.98)');
			grad.addColorStop(0.35, 'rgba(255, 185, 215, 0.94)');
			grad.addColorStop(0.75, 'rgba(240, 115, 168, 0.88)');
			grad.addColorStop(0.95, 'rgba(216, 27, 96, 0.80)');
			grad.addColorStop(1.0, 'rgba(216, 27, 96, 0)');
			ctx.fillStyle = grad;

			ctx.beginPath();
			ctx.moveTo(0, -44);
			ctx.bezierCurveTo(28, -44, 44, -12, 32, 28);
			ctx.bezierCurveTo(20, 46, 6, 48, 0, 42);
			ctx.bezierCurveTo(-6, 48, -20, 46, -32, 28);
			ctx.bezierCurveTo(-44, -12, -28, -44, 0, -44);
			ctx.closePath();
			ctx.fill();

			ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
			ctx.lineWidth = 1.6;
			ctx.beginPath();
			ctx.moveTo(0, -32);
			ctx.quadraticCurveTo(3, 0, 0, 36);
			ctx.stroke();
			ctx.restore();

		} else if (type === 'ember') {
			// Intense Fiery Magma Ember
			var emberGrad = ctx.createRadialGradient(center, center, 2, center, center, center - 6);
			emberGrad.addColorStop(0.0, 'rgba(255, 255, 230, 1.0)');
			emberGrad.addColorStop(0.20, 'rgba(255, 210, 50, 0.98)');
			emberGrad.addColorStop(0.50, 'rgba(255, 90, 0, 0.85)');
			emberGrad.addColorStop(0.80, 'rgba(210, 20, 0, 0.45)');
			emberGrad.addColorStop(1.0, 'rgba(150, 0, 0, 0)');
			ctx.fillStyle = emberGrad;
			ctx.beginPath();
			ctx.arc(center, center, center - 6, 0, Math.PI * 2);
			ctx.fill();

		} else if (type === 'snow') {
			// Soft Fluffy Snowflake
			var snowGrad = ctx.createRadialGradient(center, center, 0, center, center, center - 8);
			snowGrad.addColorStop(0.0, 'rgba(255, 255, 255, 0.96)');
			snowGrad.addColorStop(0.40, 'rgba(235, 245, 255, 0.85)');
			snowGrad.addColorStop(0.75, 'rgba(195, 220, 250, 0.35)');
			snowGrad.addColorStop(1.0, 'rgba(180, 210, 245, 0)');
			ctx.fillStyle = snowGrad;
			ctx.beginPath();
			ctx.arc(center, center, center - 8, 0, Math.PI * 2);
			ctx.fill();

			ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
			ctx.lineWidth = 2.4;
			ctx.lineCap = 'round';
			for (var a = 0; a < 6; a++) {
				var rad = (a * Math.PI) / 3;
				ctx.beginPath();
				ctx.moveTo(center, center);
				var ex = center + Math.cos(rad) * 36;
				var ey = center + Math.sin(rad) * 36;
				ctx.lineTo(ex, ey);
				ctx.stroke();
			}

		} else if (type === 'crystal') {
			// Sparkling Diamond Ice Crystal
			var cryGrad = ctx.createRadialGradient(center, center, 2, center, center, center - 4);
			cryGrad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
			cryGrad.addColorStop(0.30, 'rgba(210, 240, 255, 0.85)');
			cryGrad.addColorStop(0.70, 'rgba(100, 195, 255, 0.35)');
			cryGrad.addColorStop(1.0, 'rgba(50, 160, 255, 0)');
			ctx.fillStyle = cryGrad;
			ctx.beginPath();
			ctx.arc(center, center, center - 4, 0, Math.PI * 2);
			ctx.fill();

			ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
			ctx.beginPath();
			ctx.moveTo(center, 4);
			ctx.quadraticCurveTo(center, center, size - 4, center);
			ctx.quadraticCurveTo(center, center, center, size - 4);
			ctx.quadraticCurveTo(center, center, 4, center);
			ctx.quadraticCurveTo(center, center, center, 4);
			ctx.fill();

		} else {
			// Tropical Luminous Sea Spray Mote
			var moteGrad = ctx.createRadialGradient(center, center, 2, center, center, center - 8);
			moteGrad.addColorStop(0.0, 'rgba(255, 255, 255, 0.98)');
			moteGrad.addColorStop(0.30, 'rgba(200, 255, 250, 0.85)');
			moteGrad.addColorStop(0.65, 'rgba(64, 224, 208, 0.40)');
			moteGrad.addColorStop(1.0, 'rgba(0, 180, 216, 0)');
			ctx.fillStyle = moteGrad;
			ctx.beginPath();
			ctx.arc(center, center, center - 8, 0, Math.PI * 2);
			ctx.fill();
		}

		var tex = new THREE.CanvasTexture(canvas);
		tex.generateMipmaps = true;
		tex.minFilter = THREE.LinearMipmapLinearFilter;
		particleTextures[type] = tex;
		return tex;
	}

	// --------------------------------------------------------------------------
	// 3D LIVING PHOTOGRAPHIC ENVIRONMENTS (EYE-LEVEL FULL-SCREEN PHOTO BACKDROP)
	// --------------------------------------------------------------------------
	function buildPhotographicEnvironment(scId) {
		var config = SCENERIES[scId];
		var group = new THREE.Group();
		group.name = 'Env_' + scId;

		var photoTex = getSceneryTexture(config.photo);

		// Full-screen Background Plane placed directly behind the board in the camera view
		var bgGeom = new THREE.PlaneGeometry(1, 1);
		var bgMat = new THREE.MeshBasicMaterial({
			map: photoTex,
			side: THREE.DoubleSide,
			fog: false,
			depthWrite: false
		});

		var bgMesh = new THREE.Mesh(bgGeom, bgMat);
		bgMesh.rotation.x = -Math.PI * 0.5; // Oriented face-up towards camera
		bgMesh.position.set(0, -0.35, 0);
		group.add(bgMesh);

		// Dynamic Living Light
		var dynamicLight = null;
		if (scId === 'volcano') {
			dynamicLight = new THREE.PointLight(0xff4500, 2.6, 30);
			dynamicLight.position.set(0, 2.5, -4.0);
			group.add(dynamicLight);
		} else if (scId === 'snowtown') {
			dynamicLight = new THREE.PointLight(0xffaa33, 2.0, 25);
			dynamicLight.position.set(0, 2.0, -3.0);
			group.add(dynamicLight);
		} else if (scId === 'ocean') {
			dynamicLight = new THREE.PointLight(0x40e0d0, 1.4, 25);
			dynamicLight.position.set(0, 2.0, -3.0);
			group.add(dynamicLight);
		}

		group.userData = {
			scId: scId,
			bgMesh: bgMesh,
			dynamicLight: dynamicLight
		};

		return group;
	}

	// --------------------------------------------------------------------------
	// 3D LIVING PARTICLE SYSTEM (PASSING IN FRONT OF TILES)
	// --------------------------------------------------------------------------
	function build3DParticleSystem(type) {
		var count = 80;
		var geom = new THREE.BufferGeometry();
		var positions = new Float32Array(count * 3);
		var velocities = [];

		var tex = createParticleTexture(type);

		for (var i = 0; i < count; i++) {
			var i3 = i * 3;

			// Horizontal spread (X): -9 to +9 across screen
			positions[i3] = (Math.random() - 0.5) * 18;
			// Depth corridor (Y): 0.5 to 2.4 (PHYSICALLY IN FRONT OF TILES at Y=0.34!)
			positions[i3 + 1] = Math.random() * 1.8 + 0.6;
			// Vertical screen spread (Z): -13 (top) to +11 (bottom)
			positions[i3 + 2] = Math.random() * 24 - 13;

			var vx = 0, vy = 0, vz = 0;
			if (type === 'ember') {
				// Volcanic embers rise upward on screen towards the sky (-Z)
				vz = -(1.8 + Math.random() * 2.4);
				vx = (Math.random() - 0.5) * 0.8;
				vy = (Math.random() - 0.5) * 0.4;
			} else if (type === 'petal') {
				// Blossom petals gently flutter down on screen (+Z)
				vz = 1.2 + Math.random() * 1.8;
				vx = 0.5 + Math.random() * 0.8;
				vy = (Math.random() - 0.5) * 0.4;
			} else if (type === 'snow') {
				// Soft snowflakes drift down on screen (+Z)
				vz = 1.0 + Math.random() * 1.5;
				vx = (Math.random() - 0.5) * 0.5;
				vy = (Math.random() - 0.5) * 0.3;
			} else if (type === 'crystal') {
				// Diamond ice crystals sparkle and descend (+Z)
				vz = 0.8 + Math.random() * 1.4;
				vx = (Math.random() - 0.5) * 0.5;
				vy = (Math.random() - 0.5) * 0.3;
			} else {
				// Tropical sea spray motes rise in warm breeze (-Z)
				vz = -(0.8 + Math.random() * 1.4);
				vx = 0.4 + Math.random() * 0.7;
				vy = (Math.random() - 0.5) * 0.3;
			}

			velocities.push({
				vx: vx, vy: vy, vz: vz,
				phase: Math.random() * Math.PI * 2,
				speed: 1.0 + Math.random() * 2.0
			});
		}

		geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));

		var size = (type === 'petal') ? 0.90 : ((type === 'ember') ? 0.82 : ((type === 'snow') ? 0.76 : 0.72));

		var mat = new THREE.PointsMaterial({
			size: size,
			map: tex,
			transparent: true,
			opacity: 0.94,
			sizeAttenuation: true,
			depthWrite: false, // Particles never block tile raycasts or clicks
			blending: (type === 'ember' || type === 'crystal' || type === 'seaMote') ? THREE.AdditiveBlending : THREE.NormalBlending
		});

		var points = new THREE.Points(geom, mat);
		points.userData.velocities = velocities;
		points.userData.type = type;

		return points;
	}

	// --------------------------------------------------------------------------
	// DYNAMIC FULL-SCREEN COVER SIZING FOR SCENERY PHOTO
	// --------------------------------------------------------------------------
	function onCameraUpdate(camY, centerZ, fov, aspect) {
		lastCamY = camY || lastCamY;
		lastCenterZ = (centerZ !== undefined) ? centerZ : lastCenterZ;
		lastFov = fov || lastFov;
		lastAspect = aspect || lastAspect;

		var fovRad = THREE.MathUtils.degToRad(lastFov);
		var halfTan = Math.tan(fovRad * 0.5);
		var dist = lastCamY - (-0.35);
		var visHeight = 2 * dist * halfTan;
		var visWidth = visHeight * lastAspect;

		Object.keys(envGroups).forEach(function (key) {
			var grp = envGroups[key];
			if (!grp || !grp.userData || !grp.userData.bgMesh) return;
			var cfg = SCENERIES[key];
			var photoAspect = (cfg && cfg.aspectRatio) ? cfg.aspectRatio : 1.50;

			// Cover calculation (ensures photo covers 100% of screen without letterboxing)
			var w = Math.max(visWidth, visHeight * photoAspect) * 1.04;
			var h = Math.max(visHeight, visWidth / photoAspect) * 1.04;

			grp.userData.bgMesh.scale.set(w, h, 1);
			grp.userData.bgMesh.position.set(0, -0.35, lastCenterZ);
		});
	}

	// --------------------------------------------------------------------------
	// LIFECYCLE & SCENERY SWITCHING
	// --------------------------------------------------------------------------
	function init(scene, camera, renderer) {
		sceneRef = scene;
		cameraRef = camera;
		rendererRef = renderer;

		if (rootGroup && sceneRef) {
			sceneRef.remove(rootGroup);
		}

		rootGroup = new THREE.Group();
		rootGroup.name = 'WordscapesScenery3D';

		// Build authentic photographic environments
		envGroups.sakura = buildPhotographicEnvironment('sakura');
		envGroups.volcano = buildPhotographicEnvironment('volcano');
		envGroups.snowtown = buildPhotographicEnvironment('snowtown');
		envGroups.peaks = buildPhotographicEnvironment('peaks');
		envGroups.ocean = buildPhotographicEnvironment('ocean');

		// Build matching 3D particle systems
		particleSystems.sakura = build3DParticleSystem('petal');
		particleSystems.volcano = build3DParticleSystem('ember');
		particleSystems.snowtown = build3DParticleSystem('snow');
		particleSystems.peaks = build3DParticleSystem('crystal');
		particleSystems.ocean = build3DParticleSystem('seaMote');

		// Attach to root group (initially hidden)
		Object.keys(envGroups).forEach(function (key) {
			var g = envGroups[key];
			g.visible = false;
			rootGroup.add(g);

			var p = particleSystems[key];
			p.visible = false;
			rootGroup.add(p);
		});

		if (sceneRef) {
			sceneRef.add(rootGroup);
		}

		if (cameraRef) {
			onCameraUpdate(cameraRef.position.y, lastCenterZ, cameraRef.fov, cameraRef.aspect);
		}

		// Restore saved preference or default to sakura
		var saved = null;
		try {
			saved = localStorage.getItem('word_chain_scenery');
		} catch (e) {}

		setScenery(saved && SCENERIES[saved] ? saved : 'sakura');
	}

	function applyLighting(scId) {
		var sc = SCENERIES[scId];
		if (!sc || !sc.lighting || !sceneRef) return;

		var lights = sceneRef.userData && sceneRef.userData.lights;
		if (!lights) return;

		// Ambient Light
		if (lights.ambient && sc.lighting.ambient) {
			lights.ambient.color.setHex(sc.lighting.ambient.color);
			lights.ambient.intensity = sc.lighting.ambient.intensity;
		}

		// Directional Sun Light
		if (lights.sun && sc.lighting.sun) {
			lights.sun.color.setHex(sc.lighting.sun.color);
			lights.sun.intensity = sc.lighting.sun.intensity;
			if (sc.lighting.sun.pos) {
				lights.sun.position.set(sc.lighting.sun.pos[0], sc.lighting.sun.pos[1], sc.lighting.sun.pos[2]);
			}
		}

		// Fill Light
		if (lights.fill && sc.lighting.fill) {
			lights.fill.color.setHex(sc.lighting.fill.color);
			lights.fill.intensity = sc.lighting.fill.intensity;
		}
	}

	function setScenery(id) {
		if (!SCENERIES[id]) id = 'sakura';
		var scId = SCENERIES[id].id;
		currentScenery = scId;

		try {
			localStorage.setItem('word_chain_scenery', scId);
		} catch (e) {}

		// Toggle visible 3D environment & particle system
		Object.keys(envGroups).forEach(function (key) {
			var isCurrent = (key === scId);
			if (envGroups[key]) envGroups[key].visible = isCurrent;
			if (particleSystems[key]) particleSystems[key].visible = isCurrent;
		});

		activeEnvGroup = envGroups[scId];
		activeParticles = particleSystems[scId];

		// The photo is the background; clear color and fog so the photo is 100% vibrant & unblocked!
		if (sceneRef) {
			sceneRef.background = null;
			sceneRef.fog = null;
			applyLighting(scId);
		}

		onCameraUpdate();
	}

	function setSceneryForLevel(levelIndex) {
		var idx = Math.floor(levelIndex / 5) % SCENERY_CYCLE_ORDER.length;
		setScenery(SCENERY_CYCLE_ORDER[idx]);
	}

	// --------------------------------------------------------------------------
	// PER-FRAME ANIMATION (LOCKED 60 FPS, ZERO GC)
	// --------------------------------------------------------------------------
	function update(dt, now) {
		dt = Math.min(dt || 0.016, 0.05);

		// 1. Update 3D Particles
		if (activeParticles && activeParticles.visible) {
			var geom = activeParticles.geometry;
			var posAttr = geom.getAttribute('position');
			var pos = posAttr.array;
			var vels = activeParticles.userData.velocities;
			var pType = activeParticles.userData.type;

			for (var i = 0; i < vels.length; i++) {
				var i3 = i * 3;
				var v = vels[i];

				pos[i3] += v.vx * dt;
				pos[i3 + 1] += v.vy * dt;
				pos[i3 + 2] += v.vz * dt;

				// Gentle flutter/convection sway
				pos[i3] += Math.sin(now * 0.002 * v.speed + v.phase) * 0.012;

				// Vertical screen wrapping (Z is vertical on screen!)
				if (pType === 'ember' || pType === 'seaMote') {
					// Rises upward towards top of screen (-Z)
					if (pos[i3 + 2] < -13.0) {
						pos[i3 + 2] = 11.5;
						pos[i3] = (Math.random() - 0.5) * 18;
					}
				} else {
					// Descends downward towards bottom of screen (+Z)
					if (pos[i3 + 2] > 11.5) {
						pos[i3 + 2] = -13.0;
						pos[i3] = (Math.random() - 0.5) * 18;
					}
				}

				if (pos[i3] > 10.0) pos[i3] = -10.0;
				if (pos[i3] < -10.0) pos[i3] = 10.0;
				if (pos[i3 + 1] > 2.8) pos[i3 + 1] = 0.6;
				if (pos[i3 + 1] < 0.4) pos[i3 + 1] = 2.2;
			}
			posAttr.needsUpdate = true;
		}

		// 2. Living Dynamic Lighting FX
		if (activeEnvGroup && activeEnvGroup.visible && activeEnvGroup.userData.dynamicLight) {
			var light = activeEnvGroup.userData.dynamicLight;
			if (currentScenery === 'volcano') {
				light.intensity = 2.6 + Math.sin(now * 0.007) * 0.8 + Math.sin(now * 0.017) * 0.35;
			} else if (currentScenery === 'snowtown') {
				light.intensity = 2.0 + Math.sin(now * 0.004) * 0.3;
			} else if (currentScenery === 'ocean') {
				light.intensity = 1.4 + Math.sin(now * 0.003) * 0.25;
			}
		}
	}

	// --------------------------------------------------------------------------
	// EXPORTS
	// --------------------------------------------------------------------------
	global.WordscapesScenery = {
		init: init,
		update: update,
		setScenery: setScenery,
		setSceneryForLevel: setSceneryForLevel,
		applyLighting: applyLighting,
		onCameraUpdate: onCameraUpdate,
		getCurrent: function () { return currentScenery; },
		getSceneries: function () { return SCENERIES; },
		toggleForeground: function () {}
	};

})(window);
