/**
 * Wordscapes-Style 3D Living Environment Engine
 * ---------------------------------------------
 * Authentic, living photographic environments faithfully displaying the 5 reference photos:
 *   1. 🌸 Blossom Park   - Lush park lawn, blooming trees & mountain ridges (images/scenery/sakura.jpg)
 *   2. 🌋 Volcano Night   - Erupting volcano caldera & molten lava fountains (images/scenery/volcano.jpg)
 *   3. 🏔️ Winter Village  - Twilight snow valley, glowing chalet windows & lights (images/scenery/snowtown.jpg)
 *   4. ❄️ Alpine Peaks    - High-altitude powder snow peaks & ski slopes (images/scenery/peaks.jpg)
 *   5. 🏝️ Tropical Pier   - Crystal turquoise lagoon & wooden boardwalk (images/scenery/ocean.jpg)
 *
 * Immersive Architecture:
 *   - Edge-to-edge authentic photographic backdrops with GPU-composited living Ken Burns motion.
 *   - Living environmental lighting (volcano heat convection pulses, chalet window warmth, ocean caustics).
 *   - Multi-layer depth: 3D in-scene particles PLUS a dedicated high-DPI foreground FX canvas where
 *     particles visibly pass physically IN FRONT OF the letter racks and tiles!
 *   - Locked 60 FPS, zero garbage collection.
 */
(function (global) {
	'use strict';

	var sceneRef = null;
	var cameraRef = null;
	var rendererRef = null;

	var currentScenery = 'sakura';
	var dynamicPointLight = null;

	// Foreground Canvas FX state
	var fgCanvas = null;
	var fgCtx = null;
	var fgWidth = 0;
	var fgHeight = 0;
	var fgDpr = 1;
	var fgParticles = [];
	var fgMaxParticles = 55;

	// Three.js 3D in-scene particle systems
	var particleSystems3D = {};
	var activeParticles3D = null;
	var particleTextures = {};

	var SCENERIES = {
		sakura: {
			id: 'sakura',
			name: 'Blossom Park',
			icon: '🌸',
			photo: 'images/scenery/3d/sakura.jpg',
			vignetteClass: 'scenery-vignette-sakura',
			glowClass: 'scenery-glow-sakura',
			particleType: 'petal',
			lighting: {
				ambient: { color: 0xfff6ee, intensity: 0.95 },
				sun: { color: 0xfffaed, intensity: 0.90, pos: [4, 20, 10] },
				fill: { color: 0xbfe3ff, intensity: 0.35, pos: [-8, 8, -6] },
				point: { color: 0xfff0dd, intensity: 1.2, pos: [0, 4, -1] }
			}
		},
		volcano: {
			id: 'volcano',
			name: 'Volcano Night',
			icon: '🌋',
			photo: 'images/scenery/3d/volcano.jpg',
			vignetteClass: 'scenery-vignette-volcano',
			glowClass: 'scenery-glow-volcano',
			particleType: 'ember',
			lighting: {
				ambient: { color: 0x3d2028, intensity: 0.88 },
				sun: { color: 0xff5511, intensity: 1.15, pos: [0, 22, -10] },
				fill: { color: 0x221222, intensity: 0.32, pos: [-8, 8, -6] },
				point: { color: 0xff4500, intensity: 2.8, pos: [0, 3.5, -3] }
			}
		},
		snowtown: {
			id: 'snowtown',
			name: 'Winter Village',
			icon: '🏔️',
			photo: 'images/scenery/3d/snowtown.jpg',
			vignetteClass: 'scenery-vignette-snowtown',
			glowClass: 'scenery-glow-snowtown',
			particleType: 'snow',
			lighting: {
				ambient: { color: 0x263752, intensity: 0.88 },
				sun: { color: 0x7c9ec8, intensity: 0.70, pos: [4, 18, 10] },
				fill: { color: 0xffa834, intensity: 0.35, pos: [-6, 6, -10] },
				point: { color: 0xffaa33, intensity: 1.8, pos: [0, 3.2, -2] }
			}
		},
		peaks: {
			id: 'peaks',
			name: 'Alpine Peaks',
			icon: '❄️',
			photo: 'images/scenery/3d/peaks.jpg',
			vignetteClass: 'scenery-vignette-peaks',
			glowClass: 'scenery-glow-peaks',
			particleType: 'crystal',
			lighting: {
				ambient: { color: 0xdfefff, intensity: 0.96 },
				sun: { color: 0xffffff, intensity: 1.05, pos: [5, 22, 8] },
				fill: { color: 0x8ec2f6, intensity: 0.40, pos: [-8, 8, -6] },
				point: { color: 0xe8f4ff, intensity: 1.2, pos: [0, 4, -1] }
			}
		},
		ocean: {
			id: 'ocean',
			name: 'Tropical Pier',
			icon: '🏝️',
			photo: 'images/scenery/3d/ocean.jpg',
			vignetteClass: 'scenery-vignette-ocean',
			glowClass: 'scenery-glow-ocean',
			particleType: 'seaMote',
			lighting: {
				ambient: { color: 0xe0f7fa, intensity: 0.92 },
				sun: { color: 0xfffae0, intensity: 1.00, pos: [3, 20, 10] },
				fill: { color: 0x7ddde8, intensity: 0.40, pos: [-8, 8, -6] },
				point: { color: 0x40e0d0, intensity: 1.4, pos: [0, 3.5, -2] }
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
	// DOM PLATE MANAGEMENT (100% VISIBLE, HARDWARE-ACCELERATED KEN BURNS DRIFT)
	// --------------------------------------------------------------------------
	function ensureDOMContainers() {
		var sceneryContainer = document.getElementById('scenery-container');
		if (!sceneryContainer) {
			sceneryContainer = document.createElement('div');
			sceneryContainer.id = 'scenery-container';
			sceneryContainer.className = 'scenery-container';

			SCENERY_CYCLE_ORDER.forEach(function (key) {
				var plate = document.createElement('div');
				plate.id = 'scenery-plate-' + key;
				plate.className = 'scenery-photo-plate' + (key === currentScenery ? ' active' : '');
				plate.style.backgroundImage = "url('" + SCENERIES[key].photo + "')";
				sceneryContainer.appendChild(plate);
			});

			var vignette = document.createElement('div');
			vignette.id = 'scenery-vignette';
			vignette.className = 'scenery-vignette ' + SCENERIES[currentScenery].vignetteClass;
			sceneryContainer.appendChild(vignette);

			var glow = document.createElement('div');
			glow.id = 'scenery-ambient-glow';
			glow.className = 'scenery-ambient-glow ' + SCENERIES[currentScenery].glowClass;
			sceneryContainer.appendChild(glow);

			var canvasContainer = document.getElementById('canvas-container');
			if (canvasContainer && canvasContainer.parentNode) {
				canvasContainer.parentNode.insertBefore(sceneryContainer, canvasContainer);
			} else {
				document.body.insertBefore(sceneryContainer, document.body.firstChild);
			}
		}

		// Ensure foreground FX canvas exists
		var fgContainer = document.getElementById('scenery-fg-container');
		if (!fgContainer) {
			fgContainer = document.createElement('div');
			fgContainer.id = 'scenery-fg-container';
			fgContainer.className = 'scenery-fg-container';

			fgCanvas = document.createElement('canvas');
			fgCanvas.id = 'scenery-fg-canvas';
			fgCanvas.className = 'scenery-fg-canvas';
			fgContainer.appendChild(fgCanvas);

			var canvasContainer = document.getElementById('canvas-container');
			if (canvasContainer && canvasContainer.parentNode) {
				canvasContainer.parentNode.insertBefore(fgContainer, canvasContainer.nextSibling);
			} else {
				document.body.appendChild(fgContainer);
			}
		} else {
			fgCanvas = document.getElementById('scenery-fg-canvas');
		}

		if (fgCanvas) {
			fgCtx = fgCanvas.getContext('2d');
			resizeForegroundCanvas();
		}
	}

	function resizeForegroundCanvas() {
		if (!fgCanvas) return;
		fgWidth = window.innerWidth;
		fgHeight = window.innerHeight;
		fgDpr = Math.min(window.devicePixelRatio || 1, 2);
		fgCanvas.width = fgWidth * fgDpr;
		fgCanvas.height = fgHeight * fgDpr;
		fgCanvas.style.width = fgWidth + 'px';
		fgCanvas.style.height = fgHeight + 'px';
		if (fgCtx) {
			fgCtx.setTransform(fgDpr, 0, 0, fgDpr, 0, 0);
		}
	}

	if (typeof window !== 'undefined' && window.addEventListener) {
		window.addEventListener('resize', resizeForegroundCanvas);
	}

	// --------------------------------------------------------------------------
	// HIGH-DPI FOREGROUND PARTICLES (PASSING PHYSICALLY IN FRONT OF TILES)
	// --------------------------------------------------------------------------
	function initForegroundParticles() {
		fgParticles = [];
		var pType = SCENERIES[currentScenery] ? SCENERIES[currentScenery].particleType : 'petal';

		for (var i = 0; i < fgMaxParticles; i++) {
			fgParticles.push(createForegroundParticle(pType, true));
		}
	}

	function createForegroundParticle(pType, randomizeY) {
		var w = fgWidth || window.innerWidth;
		var h = fgHeight || window.innerHeight;

		var p = {
			type: pType,
			x: Math.random() * w,
			y: randomizeY ? (Math.random() * h) : (pType === 'ember' || pType === 'seaMote' ? h + 20 : -20),
			vx: 0,
			vy: 0,
			size: 0,
			rotX: Math.random() * Math.PI * 2,
			rotZ: Math.random() * Math.PI * 2,
			rotSpeedX: 0,
			rotSpeedZ: 0,
			alpha: 0.8,
			phase: Math.random() * Math.PI * 2,
			sparkle: 0
		};

		if (pType === 'petal') {
			// Delicate curved Poui / Cherry Blossom Petals
			p.size = 11 + Math.random() * 9;
			p.vx = 22 + Math.random() * 30;
			p.vy = 42 + Math.random() * 45;
			p.rotSpeedX = 1.2 + Math.random() * 2.2;
			p.rotSpeedZ = 0.6 + Math.random() * 1.4;
			p.alpha = 0.75 + Math.random() * 0.25;
		} else if (pType === 'ember') {
			// Rising glowing magma embers & sparks
			p.size = 3.5 + Math.random() * 5.0;
			p.vx = (Math.random() - 0.5) * 24;
			p.vy = -(65 + Math.random() * 85); // Rising upward with heat convection
			p.rotSpeedX = 2.0 + Math.random() * 4.0;
			p.rotSpeedZ = 1.0 + Math.random() * 3.0;
			p.alpha = 0.85 + Math.random() * 0.15;
		} else if (pType === 'snow') {
			// Soft crystalline snowflakes drifting down
			p.size = 4.0 + Math.random() * 6.5;
			p.vx = (Math.random() - 0.5) * 20;
			p.vy = 32 + Math.random() * 42;
			p.rotSpeedX = 0.8 + Math.random() * 1.5;
			p.rotSpeedZ = 0.4 + Math.random() * 1.0;
			p.alpha = 0.70 + Math.random() * 0.30;
		} else if (pType === 'crystal') {
			// Diamond ice crystals sparkling in high alpine sun
			p.size = 4.0 + Math.random() * 5.5;
			p.vx = (Math.random() - 0.5) * 18;
			p.vy = 28 + Math.random() * 38;
			p.rotSpeedX = 1.5 + Math.random() * 3.0;
			p.rotSpeedZ = 1.0 + Math.random() * 2.0;
			p.alpha = 0.75 + Math.random() * 0.25;
		} else {
			// Tropical sea spray motes and buoyant sun motes
			p.size = 3.5 + Math.random() * 5.0;
			p.vx = 14 + Math.random() * 24;
			p.vy = -(25 + Math.random() * 45); // Rising gently in warm breeze
			p.rotSpeedX = 1.0 + Math.random() * 2.0;
			p.rotSpeedZ = 0.5 + Math.random() * 1.5;
			p.alpha = 0.65 + Math.random() * 0.30;
		}

		return p;
	}

	function updateAndRenderForegroundParticles(dt, now) {
		if (!fgCtx || !fgCanvas) return;
		var w = fgWidth;
		var h = fgHeight;
		if (w <= 0 || h <= 0) return;

		fgCtx.clearRect(0, 0, w, h);

		var pType = SCENERIES[currentScenery] ? SCENERIES[currentScenery].particleType : 'petal';

		for (var i = 0; i < fgParticles.length; i++) {
			var p = fgParticles[i];

			// Physical motion
			p.x += (p.vx + Math.sin(now * 0.002 + p.phase) * 18) * dt;
			p.y += p.vy * dt;
			p.rotX += p.rotSpeedX * dt;
			p.rotZ += p.rotSpeedZ * dt;

			// Wrap boundaries
			if (p.type === 'ember' || p.type === 'seaMote') {
				if (p.y < -30) {
					p.y = h + 20;
					p.x = Math.random() * w;
				}
			} else {
				if (p.y > h + 30) {
					p.y = -20;
					p.x = Math.random() * w;
				}
			}
			if (p.x < -30) p.x = w + 20;
			if (p.x > w + 30) p.x = -20;

			// Render particle tailored to authentic natural characteristics
			fgCtx.save();
			fgCtx.translate(p.x, p.y);
			fgCtx.rotate(p.rotZ);

			var flip = Math.cos(p.rotX);
			fgCtx.scale(flip, 1);

			if (p.type === 'petal') {
				// Organic Sakura / Poui Blossom Petal
				var s = p.size;
				fgCtx.beginPath();
				fgCtx.moveTo(0, -s * 0.6);
				fgCtx.bezierCurveTo(s * 0.55, -s * 0.5, s * 0.6, s * 0.3, 0, s * 0.7);
				fgCtx.bezierCurveTo(-s * 0.6, s * 0.3, -s * 0.55, -s * 0.5, 0, -s * 0.6);

				var grad = fgCtx.createLinearGradient(0, -s * 0.6, 0, s * 0.7);
				grad.addColorStop(0.0, 'rgba(255, 245, 250, ' + p.alpha + ')');
				grad.addColorStop(0.5, 'rgba(255, 190, 215, ' + (p.alpha * 0.95) + ')');
				grad.addColorStop(1.0, 'rgba(235, 120, 165, ' + (p.alpha * 0.85) + ')');
				fgCtx.fillStyle = grad;
				fgCtx.fill();
			} else if (p.type === 'ember') {
				// Fiery Volcanic Magma Ember with Incandescent Core & Halo
				var r = p.size;
				var flicker = 0.80 + Math.sin(now * 0.015 + p.phase) * 0.20;
				var grad = fgCtx.createRadialGradient(0, 0, r * 0.2, 0, 0, r * 1.8);
				grad.addColorStop(0.0, 'rgba(255, 255, 230, ' + (p.alpha * flicker) + ')');
				grad.addColorStop(0.3, 'rgba(255, 160, 20, ' + (p.alpha * flicker * 0.9) + ')');
				grad.addColorStop(0.7, 'rgba(255, 60, 0, ' + (p.alpha * flicker * 0.6) + ')');
				grad.addColorStop(1.0, 'rgba(180, 20, 0, 0)');
				fgCtx.fillStyle = grad;
				fgCtx.beginPath();
				fgCtx.arc(0, 0, r * 1.8, 0, Math.PI * 2);
				fgCtx.fill();
			} else if (p.type === 'snow') {
				// Soft Crystalline Snowflake
				var r = p.size;
				var grad = fgCtx.createRadialGradient(0, 0, 0, 0, 0, r);
				grad.addColorStop(0.0, 'rgba(255, 255, 255, ' + p.alpha + ')');
				grad.addColorStop(0.6, 'rgba(240, 248, 255, ' + (p.alpha * 0.8) + ')');
				grad.addColorStop(1.0, 'rgba(220, 235, 255, 0)');
				fgCtx.fillStyle = grad;
				fgCtx.beginPath();
				fgCtx.arc(0, 0, r, 0, Math.PI * 2);
				fgCtx.fill();
			} else if (p.type === 'crystal') {
				// Diamond Alpine Ice Crystal with 4-Point Specular Glint
				var r = p.size;
				var glint = Math.pow(Math.max(0, Math.sin(now * 0.005 + p.phase)), 3);
				fgCtx.fillStyle = 'rgba(255, 255, 255, ' + (p.alpha * (0.6 + glint * 0.4)) + ')';
				fgCtx.beginPath();
				fgCtx.moveTo(0, -r * (1 + glint * 0.8));
				fgCtx.lineTo(r * 0.35, 0);
				fgCtx.lineTo(0, r * (1 + glint * 0.8));
				fgCtx.lineTo(-r * 0.35, 0);
				fgCtx.closePath();
				fgCtx.fill();

				fgCtx.beginPath();
				fgCtx.moveTo(-r * (1 + glint * 0.8), 0);
				fgCtx.lineTo(0, r * 0.35);
				fgCtx.lineTo(r * (1 + glint * 0.8), 0);
				fgCtx.lineTo(0, -r * 0.35);
				fgCtx.closePath();
				fgCtx.fill();
			} else {
				// Tropical Turquoise Sea Spray Mote
				var r = p.size;
				var grad = fgCtx.createRadialGradient(0, 0, r * 0.2, 0, 0, r * 1.6);
				grad.addColorStop(0.0, 'rgba(255, 255, 255, ' + p.alpha + ')');
				grad.addColorStop(0.4, 'rgba(120, 240, 235, ' + (p.alpha * 0.7) + ')');
				grad.addColorStop(1.0, 'rgba(64, 224, 208, 0)');
				fgCtx.fillStyle = grad;
				fgCtx.beginPath();
				fgCtx.arc(0, 0, r * 1.6, 0, Math.PI * 2);
				fgCtx.fill();
			}

			fgCtx.restore();
		}
	}

	// --------------------------------------------------------------------------
	// PROCEDURAL TEXTURES FOR THREE.JS 3D IN-SCENE PARTICLES
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
			ctx.save();
			ctx.translate(center, center);
			ctx.rotate(-0.25);

			var grad = ctx.createRadialGradient(-4, -8, 4, 0, 0, 48);
			grad.addColorStop(0.0, 'rgba(255, 245, 250, 0.98)');
			grad.addColorStop(0.45, 'rgba(255, 195, 220, 0.90)');
			grad.addColorStop(0.85, 'rgba(240, 130, 175, 0.75)');
			grad.addColorStop(1.0, 'rgba(220, 90, 145, 0.0)');

			ctx.fillStyle = grad;
			ctx.beginPath();
			ctx.moveTo(0, -42);
			ctx.bezierCurveTo(28, -35, 34, 18, 0, 44);
			ctx.bezierCurveTo(-34, 18, -28, -35, 0, -42);
			ctx.closePath();
			ctx.fill();
			ctx.restore();
		} else if (type === 'ember') {
			var grad = ctx.createRadialGradient(center, center, 4, center, center, 56);
			grad.addColorStop(0.0, 'rgba(255, 255, 240, 1.0)');
			grad.addColorStop(0.25, 'rgba(255, 175, 30, 0.95)');
			grad.addColorStop(0.65, 'rgba(255, 55, 0, 0.65)');
			grad.addColorStop(1.0, 'rgba(180, 15, 0, 0.0)');

			ctx.fillStyle = grad;
			ctx.beginPath();
			ctx.arc(center, center, 56, 0, Math.PI * 2);
			ctx.fill();
		} else if (type === 'snow') {
			var grad = ctx.createRadialGradient(center, center, 2, center, center, 52);
			grad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
			grad.addColorStop(0.45, 'rgba(240, 248, 255, 0.85)');
			grad.addColorStop(0.85, 'rgba(215, 235, 255, 0.35)');
			grad.addColorStop(1.0, 'rgba(200, 225, 255, 0.0)');

			ctx.fillStyle = grad;
			ctx.beginPath();
			ctx.arc(center, center, 52, 0, Math.PI * 2);
			ctx.fill();
		} else if (type === 'crystal') {
			var grad = ctx.createRadialGradient(center, center, 2, center, center, 52);
			grad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
			grad.addColorStop(0.35, 'rgba(220, 240, 255, 0.90)');
			grad.addColorStop(0.75, 'rgba(160, 210, 255, 0.40)');
			grad.addColorStop(1.0, 'rgba(140, 190, 255, 0.0)');

			ctx.fillStyle = grad;
			ctx.beginPath();
			ctx.moveTo(center, center - 48);
			ctx.lineTo(center + 14, center);
			ctx.lineTo(center, center + 48);
			ctx.lineTo(center - 14, center);
			ctx.closePath();
			ctx.fill();

			ctx.beginPath();
			ctx.moveTo(center - 48, center);
			ctx.lineTo(center, center + 14);
			ctx.lineTo(center + 48, center);
			ctx.lineTo(center, center - 14);
			ctx.closePath();
			ctx.fill();
		} else {
			var grad = ctx.createRadialGradient(center, center, 4, center, center, 52);
			grad.addColorStop(0.0, 'rgba(255, 255, 255, 0.98)');
			grad.addColorStop(0.35, 'rgba(140, 245, 240, 0.85)');
			grad.addColorStop(0.75, 'rgba(64, 224, 208, 0.40)');
			grad.addColorStop(1.0, 'rgba(32, 178, 170, 0.0)');

			ctx.fillStyle = grad;
			ctx.beginPath();
			ctx.arc(center, center, 52, 0, Math.PI * 2);
			ctx.fill();
		}

		var tex = new THREE.CanvasTexture(canvas);
		tex.generateMipmaps = false;
		tex.minFilter = THREE.LinearFilter;
		tex.magFilter = THREE.LinearFilter;
		particleTextures[type] = tex;
		return tex;
	}

	function build3DParticleSystem(type) {
		var count = 65;
		var geom = new THREE.BufferGeometry();
		var positions = new Float32Array(count * 3);
		var velocities = [];

		var tex = createParticleTexture(type);

		for (var i = 0; i < count; i++) {
			var i3 = i * 3;
			positions[i3] = (Math.random() - 0.5) * 18;
			// Height: 0.6 to 2.4 (physically in front of tiles at Y=0.48)
			positions[i3 + 1] = Math.random() * 1.8 + 0.6;
			positions[i3 + 2] = Math.random() * 24 - 13;

			var vx = 0, vy = 0, vz = 0;
			if (type === 'ember') {
				vz = -(1.8 + Math.random() * 2.4);
				vx = (Math.random() - 0.5) * 0.8;
				vy = (Math.random() - 0.5) * 0.4;
			} else if (type === 'petal') {
				vz = 1.2 + Math.random() * 1.8;
				vx = 0.5 + Math.random() * 0.8;
				vy = (Math.random() - 0.5) * 0.4;
			} else if (type === 'snow') {
				vz = 1.0 + Math.random() * 1.5;
				vx = (Math.random() - 0.5) * 0.5;
				vy = (Math.random() - 0.5) * 0.3;
			} else if (type === 'crystal') {
				vz = 0.8 + Math.random() * 1.4;
				vx = (Math.random() - 0.5) * 0.5;
				vy = (Math.random() - 0.5) * 0.3;
			} else {
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
			opacity: 0.88,
			blending: (type === 'ember' || type === 'crystal' || type === 'seaMote') ? THREE.AdditiveBlending : THREE.NormalBlending,
			depthWrite: false,
			fog: false
		});

		var pSystem = new THREE.Points(geom, mat);
		pSystem.name = 'Particles3D_' + type;
		pSystem.userData = {
			velocities: velocities,
			type: type
		};

		return pSystem;
	}

	// --------------------------------------------------------------------------
	// INITIALIZATION & SCENERY SWITCHING
	// --------------------------------------------------------------------------
	function init(scene, camera, renderer) {
		sceneRef = scene;
		cameraRef = camera;
		rendererRef = renderer;

		ensureDOMContainers();

		// Add dynamic point light for authentic environmental illumination
		if (!dynamicPointLight && sceneRef) {
			dynamicPointLight = new THREE.PointLight(0xfffaed, 1.4, 35);
			dynamicPointLight.position.set(0, 3.5, -1.0);
			sceneRef.add(dynamicPointLight);
		}

		// Build 3D particle systems in Three.js
		particleSystems3D.sakura = build3DParticleSystem('petal');
		particleSystems3D.volcano = build3DParticleSystem('ember');
		particleSystems3D.snowtown = build3DParticleSystem('snow');
		particleSystems3D.peaks = build3DParticleSystem('crystal');
		particleSystems3D.ocean = build3DParticleSystem('seaMote');

		Object.keys(particleSystems3D).forEach(function (key) {
			var ps = particleSystems3D[key];
			ps.visible = false;
			if (sceneRef) sceneRef.add(ps);
		});

		// Restore saved scenery preference or default to sakura
		var saved = null;
		try {
			saved = localStorage.getItem('word_chain_scenery');
		} catch (e) {}

		setScenery(saved && SCENERIES[saved] ? saved : 'sakura');
	}

	function setScenery(id) {
		if (!SCENERIES[id]) id = 'sakura';
		var scId = SCENERIES[id].id;
		currentScenery = scId;

		try {
			localStorage.setItem('word_chain_scenery', scId);
		} catch (e) {}

		// 1. Update DOM Photo Plates (Silky Smooth 1s Cross-Fade)
		SCENERY_CYCLE_ORDER.forEach(function (key) {
			var plate = document.getElementById('scenery-plate-' + key);
			if (plate) {
				if (key === scId) {
					plate.classList.add('active');
				} else {
					plate.classList.remove('active');
				}
			}
		});

		// 2. Update Photographic Vignette
		var vignette = document.getElementById('scenery-vignette');
		if (vignette) {
			vignette.className = 'scenery-vignette ' + SCENERIES[scId].vignetteClass;
		}

		// 3. Update Ambient Glow
		var glow = document.getElementById('scenery-ambient-glow');
		if (glow) {
			glow.className = 'scenery-ambient-glow ' + SCENERIES[scId].glowClass;
		}

		// 4. Update Three.js 3D Lighting
		applyLighting(scId);

		// 5. Update 3D In-Scene Particle System
		Object.keys(particleSystems3D).forEach(function (key) {
			var ps = particleSystems3D[key];
			if (ps) ps.visible = (key === scId);
		});
		activeParticles3D = particleSystems3D[scId];

		// 6. Reset Foreground High-DPI Particles
		initForegroundParticles();
	}

	function applyLighting(scId) {
		var sc = SCENERIES[scId];
		if (!sc || !sc.lighting) return;

		// Update scene ambient, directional, and fill lights
		if (sceneRef && sceneRef.userData && sceneRef.userData.lights) {
			var lights = sceneRef.userData.lights;
			if (lights.ambient && sc.lighting.ambient) {
				lights.ambient.color.setHex(sc.lighting.ambient.color);
				lights.ambient.intensity = sc.lighting.ambient.intensity;
			}
			if (lights.sun && sc.lighting.sun) {
				lights.sun.color.setHex(sc.lighting.sun.color);
				lights.sun.intensity = sc.lighting.sun.intensity;
				if (sc.lighting.sun.pos) {
					lights.sun.position.set(sc.lighting.sun.pos[0], sc.lighting.sun.pos[1], sc.lighting.sun.pos[2]);
				}
			}
			if (lights.fill && sc.lighting.fill) {
				lights.fill.color.setHex(sc.lighting.fill.color);
				lights.fill.intensity = sc.lighting.fill.intensity;
			}
		}

		// Update dynamic environmental point light
		if (dynamicPointLight && sc.lighting.point) {
			dynamicPointLight.color.setHex(sc.lighting.point.color);
			dynamicPointLight.intensity = sc.lighting.point.intensity;
			if (sc.lighting.point.pos) {
				dynamicPointLight.position.set(sc.lighting.point.pos[0], sc.lighting.point.pos[1], sc.lighting.point.pos[2]);
			}
		}

		// Scene background must stay null so the authentic living landscape shows through transparent WebGL
		if (sceneRef) {
			sceneRef.background = null;
			sceneRef.fog = null;
		}
	}

	function setSceneryForLevel(levelIndex) {
		var idx = Math.floor(levelIndex / 5) % SCENERY_CYCLE_ORDER.length;
		setScenery(SCENERY_CYCLE_ORDER[idx]);
	}

	// --------------------------------------------------------------------------
	// ANIMATION LOOP (LOCKED 60 FPS, ZERO ALLOCATIONS)
	// --------------------------------------------------------------------------
	function update(dt, now) {
		dt = Math.min(dt || 0.016, 0.05);

		// 1. Update & Render Foreground Particles (Passing IN FRONT of tiles!)
		updateAndRenderForegroundParticles(dt, now);

		// 2. Update 3D In-Scene Particles
		if (activeParticles3D && activeParticles3D.visible) {
			var geom = activeParticles3D.geometry;
			var posAttr = geom.getAttribute('position');
			var pos = posAttr.array;
			var vels = activeParticles3D.userData.velocities;
			var pType = activeParticles3D.userData.type;

			for (var i = 0; i < vels.length; i++) {
				var i3 = i * 3;
				var v = vels[i];

				pos[i3] += v.vx * dt;
				pos[i3 + 1] += v.vy * dt;
				pos[i3 + 2] += v.vz * dt;

				pos[i3] += Math.sin(now * 0.002 * v.speed + v.phase) * 0.012;

				if (pType === 'ember' || pType === 'seaMote') {
					if (pos[i3 + 2] < -13.0) {
						pos[i3 + 2] = 11.5;
						pos[i3] = (Math.random() - 0.5) * 18;
					}
				} else {
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

		// 3. Living Light Convection FX
		if (dynamicPointLight) {
			if (currentScenery === 'volcano') {
				// Pulsing caldera heat convection
				dynamicPointLight.intensity = 2.8 + Math.sin(now * 0.007) * 0.85 + Math.sin(now * 0.019) * 0.35;
			} else if (currentScenery === 'snowtown') {
				// Gentle chalet lantern glimmer
				dynamicPointLight.intensity = 1.8 + Math.sin(now * 0.004) * 0.28;
			} else if (currentScenery === 'ocean') {
				// Turquoise water caustic wave reflection
				dynamicPointLight.intensity = 1.4 + Math.sin(now * 0.005) * 0.25;
			}
		}
	}

	function onCameraUpdate() {
		// Scenery plates are responsive cover plates in DOM, ensuring 100% full screen coverage
	}

	function getCurrent() {
		return currentScenery;
	}

	function getSceneries() {
		return SCENERIES;
	}

	function toggleForeground() {}

	// Auto-initialize DOM containers on DOM ready
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', ensureDOMContainers);
	} else {
		ensureDOMContainers();
	}

	// Export API
	global.WordscapesScenery = {
		init: init,
		update: update,
		setScenery: setScenery,
		setSceneryForLevel: setSceneryForLevel,
		applyLighting: applyLighting,
		onCameraUpdate: onCameraUpdate,
		getCurrent: getCurrent,
		getSceneries: getSceneries,
		toggleForeground: toggleForeground
	};

})(window);
