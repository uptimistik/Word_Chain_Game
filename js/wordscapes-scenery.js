/**
 * Wordscapes-Style Dynamic Living Scenery Engine
 * ----------------------------------------------
 * Renders atmospheric moving sceneries (Rainy Forest Sanctuary, Alpine Sunrise Lake,
 * Cherry Blossom Shrine, Northern Lights Aurora, Autumn Golden Woods) with downward
 * perspective-aligned particle physics (rain drops, ripples, sakura petals, light motes, leaves).
 *
 * Engineered for silky smooth 60 FPS mobile performance with zero thermal overhead.
 */
(function (global) {
	'use strict';

	var canvas = null;
	var ctx = null;
	var width = 0;
	var height = 0;
	var dpr = 1;

	var currentScenery = 'sakura';
	var particles = [];
	var ripples = [];
	var animFrameId = null;
	var lastTime = 0;
	var sceneryTime = 0;

	var SCENERIES = {
		rain: {
			id: 'rain',
			name: 'Rainy Forest',
			icon: '🌧️',
			skyTop: '#18242b',
			skyBottom: '#2d3e47',
			mountains: ['#121b20', '#1b2a32', '#263a45'],
			particleType: 'rain',
			particleCount: 65,
			particleColor: 'rgba(180, 215, 235, 0.65)'
		},
		sunlit: {
			id: 'sunlit',
			name: 'Alpine Lake',
			icon: '☀️',
			skyTop: '#d97736',
			skyBottom: '#f5b56b',
			mountains: ['#2b1820', '#4a2430', '#7a3845'],
			particleType: 'sunbeam',
			particleCount: 40,
			particleColor: 'rgba(255, 238, 170, 0.75)'
		},
		sakura: {
			id: 'sakura',
			name: 'Cherry Blossom',
			icon: '🌸',
			skyTop: '#2e1c38',
			skyBottom: '#5c3866',
			mountains: ['#1a0f20', '#2d1b36', '#482c52'],
			particleType: 'petal',
			particleCount: 35,
			particleColor: 'rgba(255, 185, 205, 0.82)'
		},
		aurora: {
			id: 'aurora',
			name: 'Northern Lights',
			icon: '🌌',
			skyTop: '#060d17',
			skyBottom: '#102236',
			mountains: ['#04080e', '#091522', '#122538'],
			particleType: 'aurora',
			particleCount: 50,
			particleColor: 'rgba(120, 255, 190, 0.8)'
		},
		autumn: {
			id: 'autumn',
			name: 'Autumn Woods',
			icon: '🍂',
			skyTop: '#3b1d14',
			skyBottom: '#6e3922',
			mountains: ['#220f09', '#3d1b11', '#5e2e1c'],
			particleType: 'leaf',
			particleCount: 35,
			particleColor: 'rgba(240, 130, 40, 0.85)'
		}
	};

	function init(container) {
		if (canvas) return;

		var parent = container || document.body;
		var wrap = document.createElement('div');
		wrap.id = 'scenery-container';
		wrap.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;overflow:hidden;z-index:0;pointer-events:none;';

		canvas = document.createElement('canvas');
		canvas.id = 'scenery-canvas';
		canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;display:block;';
		wrap.appendChild(canvas);

		if (parent.firstChild) {
			parent.insertBefore(wrap, parent.firstChild);
		} else {
			parent.appendChild(wrap);
		}

		ctx = canvas.getContext('2d');
		resize();
		window.addEventListener('resize', resize);

		// Restore saved scenery preference or default to rain
		var saved = null;
		try {
			saved = localStorage.getItem('word_chain_scenery');
		} catch (e) {}
		setScenery(saved && SCENERIES[saved] ? saved : 'sakura');

		lastTime = performance.now();
		render(lastTime);
	}

	function resize() {
		if (!canvas) return;
		width = window.innerWidth;
		height = window.innerHeight;
		dpr = Math.min(window.devicePixelRatio || 1, 1.35); // Keep ultra efficient
		canvas.width = Math.floor(width * dpr);
		canvas.height = Math.floor(height * dpr);
		if (ctx) ctx.scale(dpr, dpr);
		initParticles();
	}

	function setScenery(id) {
		if (!SCENERIES[id]) id = 'rain';
		currentScenery = id;
		try {
			localStorage.setItem('word_chain_scenery', id);
		} catch (e) {}
		initParticles();
	}

	function setSceneryForLevel(levelIndex) {
		// Advance scenic worlds every 5 levels
		var ids = ['sakura', 'sunlit', 'rain', 'autumn', 'aurora'];
		var idx = Math.floor(levelIndex / 5) % ids.length;
		setScenery(ids[idx]);
	}

	function initParticles() {
		particles = [];
		ripples = [];
		var sc = SCENERIES[currentScenery] || SCENERIES.rain;
		var count = sc.particleCount || 40;

		for (var i = 0; i < count; i++) {
			particles.push(createParticle(sc.particleType, true));
		}
	}

	function createParticle(type, randomY) {
		var p = {
			type: type,
			x: Math.random() * width,
			y: randomY ? Math.random() * height : -30,
			size: 0,
			vx: 0,
			vy: 0,
			rot: Math.random() * Math.PI * 2,
			vrot: (Math.random() - 0.5) * 0.05,
			opacity: Math.random() * 0.5 + 0.5,
			color: ''
		};

		if (type === 'rain') {
			p.size = Math.random() * 16 + 14; // Length of rain streak
			p.vx = -1.2; // Gentle diagonal matching 3D perspective slant
			p.vy = Math.random() * 8 + 14;
			p.opacity = Math.random() * 0.4 + 0.25;
		} else if (type === 'sunbeam') {
			p.size = Math.random() * 4 + 2;
			p.vx = (Math.random() - 0.5) * 0.6;
			p.vy = -(Math.random() * 0.5 + 0.3); // Drifts gently upward in sunbeam
			p.pulse = Math.random() * Math.PI * 2;
		} else if (type === 'petal') {
			p.size = Math.random() * 8 + 6;
			p.vx = Math.random() * 1.5 + 0.8;
			p.vy = Math.random() * 1.2 + 1.2;
			p.sway = Math.random() * Math.PI * 2;
			p.swaySpeed = Math.random() * 0.03 + 0.02;
		} else if (type === 'leaf') {
			p.size = Math.random() * 10 + 7;
			p.vx = Math.random() * 2.0 + 0.5;
			p.vy = Math.random() * 1.5 + 1.4;
			p.sway = Math.random() * Math.PI * 2;
			p.swaySpeed = Math.random() * 0.025 + 0.015;
			p.color = Math.random() > 0.5 ? '#e65100' : '#d84315';
		} else if (type === 'aurora') {
			// Twinkling stars
			p.x = Math.random() * width;
			p.y = Math.random() * (height * 0.65);
			p.size = Math.random() * 2.2 + 0.8;
			p.twinkleSpeed = Math.random() * 0.04 + 0.02;
			p.twinklePhase = Math.random() * Math.PI * 2;
		}

		return p;
	}

	function spawnRipple(x, y) {
		if (ripples.length > 20) return;
		ripples.push({
			x: x,
			y: y,
			r: 2,
			maxR: Math.random() * 14 + 10,
			opacity: 0.45
		});
	}

	function render(now) {
		animFrameId = requestAnimationFrame(render);

		var dt = Math.min((now - lastTime) * 0.001, 0.05);
		lastTime = now;
		sceneryTime += dt;

		if (!ctx) return;

		var sc = SCENERIES[currentScenery] || SCENERIES.rain;

		// 1. Draw Scenic Atmospheric Background
		drawBackground(sc);

		// 2. Draw Scenic Horizon & Mountain Silhouettes
		drawMountains(sc);

		// 3. Draw Dynamic Atmospheric Particles
		drawParticles(sc, dt);

		// 4. Draw Ripples (Rain mode)
		if (sc.particleType === 'rain') {
			drawRipples();
		}
	}

	function drawBackground(sc) {
		var grad = ctx.createLinearGradient(0, 0, 0, height);
		grad.addColorStop(0, sc.skyTop);
		grad.addColorStop(0.7, sc.skyBottom);
		grad.addColorStop(1, '#1a1008'); // Warm parlor shadow base around bottom board
		ctx.fillStyle = grad;
		ctx.fillRect(0, 0, width, height);

		// Sunbeam aura for alpine sunrise
		if (sc.id === 'sunlit') {
			var sunG = ctx.createRadialGradient(width * 0.65, height * 0.22, 10, width * 0.65, height * 0.22, width * 0.8);
			sunG.addColorStop(0, 'rgba(255, 235, 180, 0.35)');
			sunG.addColorStop(0.4, 'rgba(255, 190, 100, 0.15)');
			sunG.addColorStop(1, 'rgba(0, 0, 0, 0)');
			ctx.fillStyle = sunG;
			ctx.fillRect(0, 0, width, height * 0.7);
		}

		// Undulating Aurora Borealis Curtains
		if (sc.id === 'aurora') {
			drawAuroraWaves();
		}
	}

	function drawAuroraWaves() {
		ctx.save();
		for (var k = 0; k < 2; k++) {
			var waveY = height * (0.16 + k * 0.08);
			var grad = ctx.createLinearGradient(0, waveY - 60, 0, waveY + 80);
			if (k === 0) {
				grad.addColorStop(0, 'rgba(34, 197, 94, 0)');
				grad.addColorStop(0.4, 'rgba(74, 222, 128, 0.28)');
				grad.addColorStop(0.8, 'rgba(56, 189, 248, 0.15)');
				grad.addColorStop(1, 'rgba(168, 85, 247, 0)');
			} else {
				grad.addColorStop(0, 'rgba(168, 85, 247, 0)');
				grad.addColorStop(0.5, 'rgba(192, 132, 252, 0.22)');
				grad.addColorStop(1, 'rgba(34, 197, 94, 0)');
			}

			ctx.fillStyle = grad;
			ctx.beginPath();
			ctx.moveTo(0, waveY);
			for (var x = 0; x <= width; x += 30) {
				var yOff = Math.sin((x * 0.008) + sceneryTime * 0.8 + k) * 35 +
				           Math.sin((x * 0.015) - sceneryTime * 0.5) * 18;
				ctx.lineTo(x, waveY + yOff);
			}
			ctx.lineTo(width, height * 0.55);
			ctx.lineTo(0, height * 0.55);
			ctx.closePath();
			ctx.fill();
		}
		ctx.restore();
	}

	function drawMountains(sc) {
		var colors = sc.mountains || ['#121b20', '#1b2a32', '#263a45'];

		// Far layer
		ctx.fillStyle = colors[0];
		ctx.beginPath();
		ctx.moveTo(0, height * 0.38);
		ctx.lineTo(width * 0.25, height * 0.30);
		ctx.lineTo(width * 0.55, height * 0.34);
		ctx.lineTo(width * 0.85, height * 0.28);
		ctx.lineTo(width, height * 0.35);
		ctx.lineTo(width, height);
		ctx.lineTo(0, height);
		ctx.closePath();
		ctx.fill();

		// Mid layer
		ctx.fillStyle = colors[1];
		ctx.beginPath();
		ctx.moveTo(0, height * 0.44);
		ctx.lineTo(width * 0.35, height * 0.38);
		ctx.lineTo(width * 0.70, height * 0.42);
		ctx.lineTo(width, height * 0.39);
		ctx.lineTo(width, height);
		ctx.lineTo(0, height);
		ctx.closePath();
		ctx.fill();

		// Near ridge
		ctx.fillStyle = colors[2];
		ctx.beginPath();
		ctx.moveTo(0, height * 0.50);
		ctx.lineTo(width * 0.45, height * 0.46);
		ctx.lineTo(width, height * 0.49);
		ctx.lineTo(width, height);
		ctx.lineTo(0, height);
		ctx.closePath();
		ctx.fill();

		// Soft fog mist drifting over lake/valley
		var fogGrad = ctx.createLinearGradient(0, height * 0.38, 0, height * 0.54);
		fogGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
		fogGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.08)');
		fogGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
		ctx.fillStyle = fogGrad;
		ctx.fillRect(0, height * 0.38, width, height * 0.16);
	}

	function drawParticles(sc, dt) {
		var type = sc.particleType;

		for (var i = 0; i < particles.length; i++) {
			var p = particles[i];

			if (type === 'rain') {
				// Rain streak
				p.x += p.vx;
				p.y += p.vy;

				ctx.strokeStyle = sc.particleColor;
				ctx.lineWidth = 1.3;
				ctx.beginPath();
				ctx.moveTo(p.x, p.y);
				ctx.lineTo(p.x + p.vx * 1.5, p.y + p.size);
				ctx.stroke();

				// Spawn splash ripple when hitting lower plane
				if (p.y > height * 0.65 && Math.random() < 0.12) {
					spawnRipple(p.x, p.y);
				}

				if (p.y > height + 20 || p.x < -20) {
					particles[i] = createParticle('rain', false);
				}
			} else if (type === 'sunbeam') {
				// Floating golden sun mote
				p.pulse += dt * 2;
				p.x += p.vx + Math.sin(p.pulse) * 0.3;
				p.y += p.vy;

				var alpha = (Math.sin(p.pulse) * 0.3 + 0.6) * p.opacity;
				ctx.fillStyle = 'rgba(255, 238, 170, ' + alpha + ')';
				ctx.beginPath();
				ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
				ctx.fill();

				if (p.y < -10 || p.x < 0 || p.x > width) {
					particles[i] = createParticle('sunbeam', false);
					particles[i].y = height + 10;
				}
			} else if (type === 'petal') {
				// Drifting sakura petal
				p.sway += p.swaySpeed;
				p.x += p.vx + Math.sin(p.sway) * 1.2;
				p.y += p.vy;
				p.rot += p.vrot;

				ctx.save();
				ctx.translate(p.x, p.y);
				ctx.rotate(p.rot);
				ctx.fillStyle = sc.particleColor;
				ctx.beginPath();
				ctx.ellipse(0, 0, p.size, p.size * 0.55, Math.PI * 0.25, 0, Math.PI * 2);
				ctx.fill();
				ctx.restore();

				if (p.y > height + 20 || p.x > width + 20) {
					particles[i] = createParticle('petal', false);
				}
			} else if (type === 'leaf') {
				// Autumn falling maple leaf
				p.sway += p.swaySpeed;
				p.x += p.vx + Math.sin(p.sway) * 1.6;
				p.y += p.vy;
				p.rot += p.vrot;

				ctx.save();
				ctx.translate(p.x, p.y);
				ctx.rotate(p.rot);
				ctx.fillStyle = p.color || sc.particleColor;
				ctx.beginPath();
				ctx.moveTo(0, -p.size);
				ctx.lineTo(p.size * 0.6, 0);
				ctx.lineTo(0, p.size);
				ctx.lineTo(-p.size * 0.6, 0);
				ctx.closePath();
				ctx.fill();
				ctx.restore();

				if (p.y > height + 20 || p.x > width + 20) {
					particles[i] = createParticle('leaf', false);
				}
			} else if (type === 'aurora') {
				// Twinkling Star
				p.twinklePhase += p.twinkleSpeed;
				var starAlpha = Math.sin(p.twinklePhase) * 0.4 + 0.5;
				ctx.fillStyle = 'rgba(255, 255, 255, ' + starAlpha + ')';
				ctx.beginPath();
				ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
				ctx.fill();
			}
		}
	}

	function drawRipples() {
		ctx.save();
		for (var i = ripples.length - 1; i >= 0; i--) {
			var r = ripples[i];
			r.r += 0.45;
			r.opacity -= 0.015;

			if (r.opacity <= 0 || r.r >= r.maxR) {
				ripples.splice(i, 1);
				continue;
			}

			ctx.strokeStyle = 'rgba(180, 220, 240, ' + r.opacity + ')';
			ctx.lineWidth = 1;
			ctx.beginPath();
			// Oval ripple viewed at downward perspective angle
			ctx.ellipse(r.x, r.y, r.r * 1.6, r.r * 0.65, 0, 0, Math.PI * 2);
			ctx.stroke();
		}
		ctx.restore();
	}

	global.WordscapesScenery = {
		init: init,
		resize: resize,
		setScenery: setScenery,
		setSceneryForLevel: setSceneryForLevel,
		getCurrent: function () { return currentScenery; },
		getSceneries: function () { return SCENERIES; }
	};

})(window);

