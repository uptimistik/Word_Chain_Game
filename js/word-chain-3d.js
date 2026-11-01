/**
 * Word Chain 3D - Three.js Letter Tray & Physical Tile Manipulation
 * ================================================================
 * Pure 3D implementation of Word Chain without train or 2D wrappers.
 * Features:
 *   - 3D Beveled Wooden Letter Tiles with dynamic drop shadows
 *   - Authentic Word Chain Trays (Yellow Chained Racks & Green Staging Tray)
 *   - Smooth 3D Raycast Drag & Drop with velocity tilt & snap physics
 *   - Authentic Audio & Haptic feedback on grabs, clicks, and snaps
 *   - Full 30-Level Chain Progression from game tables
 */
(function (global) {
	'use strict';

	// Letter point values for Scrabble / Word Chain tiles
	var LETTER_POINTS = {
		A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1,
		J: 8, K: 5, L: 1, M: 3, N: 1, O: 1, P: 3, Q: 10, R: 1,
		S: 1, T: 1, U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10
	};

	// --------------------------------------------------------------------------
	// Audio Manager (Authentic Game Sounds & Background Music)
	// --------------------------------------------------------------------------
	var AudioManager = {
		enabled: true,
		soundEnabled: true,
		musicEnabled: true,
		sounds: {},
		audioBuffers: {},
		musicTrack: null,
		audioCtx: null,

		init: function () {
			var self = this;
			var AudioContext = window.AudioContext || window.webkitAudioContext;
			if (AudioContext) {
				try { self.audioCtx = new AudioContext(); } catch (e) {}
			}

			var soundFiles = {
				tilehit: 'game/default/sounds/tilehit.ogg',
				affirmation: 'game/default/sounds/Afirmation.ogg',
				greatJob: 'game/default/sounds/Greatjobsoundeffect.ogg',
				wrong: 'game/default/sounds/WrongWord.ogg',
				thud: 'game/default/sounds/thud.ogg'
			};

			Object.keys(soundFiles).forEach(function (name) {
				var url = soundFiles[name];
				var audio = new Audio(url);
				audio.preload = 'auto';
				self.sounds[name] = audio;

				if (self.audioCtx && window.fetch) {
					fetch(url)
						.then(function (res) { return res.arrayBuffer(); })
						.then(function (buf) { return self.audioCtx.decodeAudioData(buf); })
						.then(function (decoded) { self.audioBuffers[name] = decoded; })
						.catch(function () {});
				}
			});

			// Upbeat background music track from GameSalad (tuned to a balanced background volume)
			try {
				var bgm = new Audio();
				var canOgg = bgm.canPlayType && bgm.canPlayType('audio/ogg').replace(/^no$/, '');
				bgm.src = canOgg ? 'game/default/sounds/sub_clair-upbeat-587078.ogg'
				                 : 'game/default/sounds/sub_clair-upbeat-587078.m4a';
				bgm.loop = true;
				bgm.volume = 0.16;
				bgm.preload = 'auto';
				self.musicTrack = bgm;
			} catch (e) {}

			var unlock = function () {
				self.unlockAudio();
				window.removeEventListener('pointerdown', unlock);
				window.removeEventListener('touchstart', unlock);
				window.removeEventListener('click', unlock);
			};
			window.addEventListener('pointerdown', unlock);
			window.addEventListener('touchstart', unlock);
			window.addEventListener('click', unlock);
		},

		play: function (name, volume, pitch) {
			if (!this.soundEnabled) return;
			var vol = (volume !== undefined ? volume : 1.0);

			// Web Audio path: allows gain boost up to 2.0x and realistic acoustic pitch nuance
			if (this.audioCtx && this.audioBuffers[name]) {
				if (this.audioCtx.state === 'suspended') {
					this.audioCtx.resume().catch(function () {});
				}
				try {
					var source = this.audioCtx.createBufferSource();
					source.buffer = this.audioBuffers[name];
					if (pitch !== undefined) {
						source.playbackRate.value = pitch;
					} else if (name === 'tilehit') {
						source.playbackRate.value = 0.97 + Math.random() * 0.08;
					}

					var gainNode = this.audioCtx.createGain();
					// Boost tilehit gain to 1.95x so the tactile wood snap punches cleanly over music
					var boost = (name === 'tilehit') ? 1.95 : 1.0;
					gainNode.gain.value = vol * boost;

					source.connect(gainNode);
					gainNode.connect(this.audioCtx.destination);
					source.start(0);
					return;
				} catch (e) {}
			}

			// HTML5 Audio fallback
			var orig = this.sounds[name];
			if (orig) {
				try {
					var clone = orig.cloneNode();
					clone.volume = Math.min(1.0, vol);
					clone.play().catch(function () {});
				} catch (e) {}
			}
		},

		playSnap: function (volume) {
			var vol = (volume !== undefined ? volume : 1.25);
			this.play('tilehit', vol);
			this.haptic(22);
		},

		toggleSound: function () {
			this.soundEnabled = !this.soundEnabled;
			return this.soundEnabled;
		},

		toggleMusic: function () {
			this.musicEnabled = !this.musicEnabled;
			if (this.musicTrack) {
				if (this.musicEnabled) {
					this.musicTrack.play().catch(function () {});
				} else {
					this.musicTrack.pause();
				}
			}
			return this.musicEnabled;
		},

		toggle: function () {
			var state = this.toggleSound();
			this.toggleMusic();
			return state;
		},

		unlockAudio: function () {
			var self = this;
			if (!self.audioCtx) {
				var AudioContext = window.AudioContext || window.webkitAudioContext;
				if (AudioContext) self.audioCtx = new AudioContext();
			}
			if (self.audioCtx && self.audioCtx.state === 'suspended') {
				self.audioCtx.resume();
			}
			if (self.musicEnabled && self.musicTrack && self.musicTrack.paused) {
				self.musicTrack.play().catch(function () {});
			}
		},

		haptic: function (ms) {
			if (navigator.vibrate) {
				try { navigator.vibrate(ms || 12); } catch (e) {}
			}
		}
	};

	// Helper: Canvas rounded rectangle
	function drawRoundRect(ctx, x, y, width, height, radius) {
		ctx.beginPath();
		ctx.moveTo(x + radius, y);
		ctx.lineTo(x + width - radius, y);
		ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
		ctx.lineTo(x + width, y + height - radius);
		ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
		ctx.lineTo(x + radius, y + height);
		ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
		ctx.lineTo(x, y + radius);
		ctx.quadraticCurveTo(x, y, x + radius, y);
		ctx.closePath();
	}

	// --------------------------------------------------------------------------
	// Texture Generator (Authentic Wood Textures, Grain & Laser-Etched Type)
	// --------------------------------------------------------------------------
	var tileBaseImg = new Image();
	tileBaseImg.src = 'game/default/images/tile.png';
	tileBaseImg.onload = function () {
		TextureManager.letterTextures = {};
		if (typeof allTiles !== 'undefined' && allTiles.length) {
			for (var i = 0; i < allTiles.length; i++) {
				var t = allTiles[i];
				if (t && t.mesh && t.mesh.material && t.mesh.material[2]) {
					t.mesh.material[2].map = TextureManager.getLetterTexture(t.letter);
					t.mesh.material[2].needsUpdate = true;
				}
			}
		}
	};

	// --------------------------------------------------------------------------
	// Letter Tile Skins & Visual Styles
	// --------------------------------------------------------------------------
	var TILE_SKINS = {
		classic: {
			id: 'classic',
			name: 'Classic Wood',
			faceBase: ['#fbf6ea', '#ebd9bd', '#ddc39d'],
			textColor: '#2e1909',
			highlightColor: 'rgba(255, 245, 230, 0.75)',
			scoreColor: '#6b3f17',
			borderColor: 'rgba(110, 75, 35, 0.35)',
			sideBase: '#e8d4ba', sideDark: '#9e7b54', sideLight: '#f7ead8',
			lockedBase: '#f2de9f', lockedDark: '#aa833e', lockedLight: '#fff1c7',
			roughness: 0.65, metalness: 0.0
		},
		obsidian: {
			id: 'obsidian',
			name: 'Midnight Onyx',
			faceBase: ['#282630', '#181620', '#0f0e14'],
			textColor: '#f59e0b',
			highlightColor: 'rgba(251, 191, 36, 0.45)',
			scoreColor: '#fbbf24',
			borderColor: 'rgba(245, 158, 11, 0.55)',
			sideBase: '#332918', sideDark: '#1a140b', sideLight: '#d97706',
			lockedBase: '#4a3411', lockedDark: '#241705', lockedLight: '#f59e0b',
			roughness: 0.35, metalness: 0.40
		},
		marble: {
			id: 'marble',
			name: 'Pearl Marble',
			faceBase: ['#ffffff', '#f1f5f9', '#e2e8f0'],
			textColor: '#0f172a',
			highlightColor: 'rgba(255, 255, 255, 0.9)',
			scoreColor: '#334155',
			borderColor: 'rgba(148, 163, 184, 0.4)',
			sideBase: '#cbd5e1', sideDark: '#64748b', sideLight: '#f8fafc',
			lockedBase: '#e2e8f0', lockedDark: '#94a3b8', lockedLight: '#ffffff',
			roughness: 0.38, metalness: 0.20
		},
		jade: {
			id: 'jade',
			name: 'Imperial Jade',
			faceBase: ['#f0fdf4', '#dcfce7', '#bbf7d0'],
			textColor: '#064e3b',
			highlightColor: 'rgba(255, 255, 255, 0.85)',
			scoreColor: '#047857',
			borderColor: 'rgba(16, 185, 129, 0.45)',
			sideBase: '#10b981', sideDark: '#047857', sideLight: '#6ee7b7',
			lockedBase: '#34d399', lockedDark: '#065f46', lockedLight: '#a7f3d0',
			roughness: 0.36, metalness: 0.15
		},
		sunset: {
			id: 'sunset',
			name: 'Sunset Coral',
			faceBase: ['#fff1f2', '#ffe4e6', '#fecdd3'],
			textColor: '#881337',
			highlightColor: 'rgba(255, 255, 255, 0.85)',
			scoreColor: '#be123c',
			borderColor: 'rgba(244, 63, 94, 0.45)',
			sideBase: '#fb7185', sideDark: '#9f1239', sideLight: '#fecdd3',
			lockedBase: '#f43f5e', lockedDark: '#881337', lockedLight: '#fda4af',
			roughness: 0.42, metalness: 0.12
		}
	};

	var currentSkinId = 'classic';
	try {
		var savedSkin = localStorage.getItem('word_chain_tile_skin');
		if (savedSkin && TILE_SKINS[savedSkin]) currentSkinId = savedSkin;
	} catch (e) {}

	var TextureManager = {
		letterTextures: {},
		gameSaladTiles: {},
		slotBracketTexture: null,
		slotHoverTexture: null,
		activeRowBadgeTexture: null,
		bgTexture: null,

		preloadGameSaladTiles: function () {
			var self = this;
			var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
			for (var i = 0; i < alphabet.length; i++) {
				var char = alphabet[i];
				(function (c) {
					var img = new Image();
					img.onload = function () {
						self.gameSaladTiles[c] = img;
						if (currentSkinId === 'classic' && self.letterTextures[c]) {
							self.renderLetterOnCanvas(c, self.letterTextures[c].image);
							self.letterTextures[c].needsUpdate = true;
						}
					};
					img.src = 'game/default/images/' + c + '4.png';
				})(char);
			}
		},

		getHardwoodTexture: function (baseColorHex, grainDarkHex, grainLightHex) {
			var width = 512;
			var height = 256;
			var canvas = document.createElement('canvas');
			canvas.width = width;
			canvas.height = height;
			var ctx = canvas.getContext('2d');

			// Base wood tone
			ctx.fillStyle = baseColorHex;
			ctx.fillRect(0, 0, width, height);

			// Longitudinal wood grain lines
			for (var y = 0; y < height; y += 3) {
				var grainAlpha = (Math.sin(y * 0.12) * 0.5 + 0.5) * 0.18 + Math.random() * 0.08;
				ctx.fillStyle = (Math.sin(y * 0.35) > 0) ? grainDarkHex : grainLightHex;
				ctx.globalAlpha = grainAlpha;
				ctx.beginPath();
				ctx.moveTo(0, y);
				for (var x = 0; x <= width; x += 32) {
					var waveY = y + Math.sin((x + y * 2) * 0.03) * 4 + Math.sin(x * 0.015) * 6;
					ctx.lineTo(x, waveY);
				}
				ctx.lineTo(width, y + 2.5);
				ctx.lineTo(0, y + 2.5);
				ctx.fill();
			}

			// Fine wood pore capillaries
			ctx.fillStyle = grainDarkHex;
			ctx.globalAlpha = 0.09;
			for (var i = 0; i < 350; i++) {
				var px = Math.random() * width;
				var py = Math.random() * height;
				var len = Math.random() * 26 + 8;
				ctx.fillRect(px, py, len, 1.2);
			}
			ctx.globalAlpha = 1.0;

			var texture = new THREE.CanvasTexture(canvas);
			texture.encoding = THREE.sRGBEncoding;
			texture.wrapS = THREE.RepeatWrapping;
			texture.wrapT = THREE.RepeatWrapping;
			texture.repeat.set(2, 1);
			return texture;
		},

		renderLetterOnCanvas: function (letter, canvas) {
			letter = (letter || '').toUpperCase();
			var skin = TILE_SKINS[currentSkinId] || TILE_SKINS.classic;
			var size = canvas.width || 256;
			var ctx = canvas.getContext('2d');
			ctx.clearRect(0, 0, size, size);

			// 1. If skin is classic and GameSalad tile image is ready:
			var gsImg = this.gameSaladTiles[letter];
			if (skin.id === 'classic' && gsImg && gsImg.complete && gsImg.naturalWidth > 0) {
				// Draw the authentic GameSalad human, homely tile!
				ctx.drawImage(gsImg, 0, 0, size, size);

				// GameSalad point value in corner
				var pts = LETTER_POINTS[letter] || 1;
				ctx.font = '700 32px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
				ctx.textAlign = 'right';
				ctx.textBaseline = 'bottom';
				ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
				ctx.fillText(pts, size - 20, size - 16 + 1.5);
				ctx.fillStyle = '#3a2211';
				ctx.fillText(pts, size - 20, size - 16);
				return;
			}

			// Fallback / Procedural render for other skins
			var bgGrad = ctx.createRadialGradient(size * 0.5, size * 0.5, 20, size * 0.5, size * 0.5, size * 0.7);
			bgGrad.addColorStop(0, skin.faceBase[0]);
			bgGrad.addColorStop(0.7, skin.faceBase[1]);
			bgGrad.addColorStop(1.0, skin.faceBase[2]);
			ctx.fillStyle = bgGrad;
			ctx.fillRect(0, 0, size, size);

			if (skin.id === 'marble') {
				ctx.strokeStyle = 'rgba(100, 116, 139, 0.18)';
				ctx.lineWidth = 2;
				ctx.beginPath();
				ctx.moveTo(10, 30);
				ctx.bezierCurveTo(80, 120, 160, 90, 240, 210);
				ctx.stroke();
				ctx.beginPath();
				ctx.moveTo(140, 20);
				ctx.bezierCurveTo(190, 80, 210, 140, 250, 170);
				ctx.stroke();
			} else if (skin.id === 'obsidian') {
				var glossGrad = ctx.createLinearGradient(0, 0, size, size);
				glossGrad.addColorStop(0, 'rgba(255, 255, 255, 0.12)');
				glossGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.0)');
				glossGrad.addColorStop(1, 'rgba(245, 158, 11, 0.08)');
				ctx.fillStyle = glossGrad;
				ctx.fillRect(0, 0, size, size);
			} else if (skin.id === 'jade') {
				ctx.fillStyle = 'rgba(16, 185, 129, 0.10)';
				for (var y = 10; y < size; y += 12) {
					ctx.fillRect(0, y + Math.sin(y * 0.06) * 4, size, 2.5);
				}
			} else {
				// Wood / Coral grain
				ctx.fillStyle = (skin.id === 'sunset') ? 'rgba(225, 29, 72, 0.08)' : 'rgba(140, 95, 50, 0.07)';
				for (var y = 6; y < size; y += 7) {
					var wave = Math.sin(y * 0.05) * 6;
					ctx.fillRect(0, y + wave, size, 2.0);
				}
			}

			// Inset borders
			ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
			ctx.lineWidth = 4;
			ctx.strokeRect(7, 7, size - 14, size - 14);

			ctx.strokeStyle = skin.borderColor;
			ctx.lineWidth = 3;
			ctx.strokeRect(10, 10, size - 20, size - 20);

			// Capital Letter
			ctx.font = '900 132px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';

			ctx.fillStyle = skin.highlightColor;
			ctx.fillText(letter, size * 0.5, size * 0.48 + 3);

			ctx.fillStyle = skin.textColor;
			ctx.fillText(letter, size * 0.5, size * 0.48);

			// Letter Point Value
			var pts = LETTER_POINTS[letter] || 1;
			ctx.font = '700 32px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
			ctx.textAlign = 'right';
			ctx.textBaseline = 'bottom';

			ctx.fillStyle = skin.highlightColor;
			ctx.fillText(pts, size - 22, size - 18 + 1.5);
			ctx.fillStyle = skin.scoreColor;
			ctx.fillText(pts, size - 22, size - 18);
		},

		getLetterTexture: function (letter) {
			letter = (letter || '').toUpperCase();
			if (this.letterTextures[letter]) return this.letterTextures[letter];

			var size = 256;
			var canvas = document.createElement('canvas');
			canvas.width = size;
			canvas.height = size;
			this.renderLetterOnCanvas(letter, canvas);

			var texture = new THREE.CanvasTexture(canvas);
			texture.encoding = THREE.sRGBEncoding;
			this.letterTextures[letter] = texture;
			return texture;
		},

		setSkin: function (skinId) {
			if (!TILE_SKINS[skinId]) skinId = 'classic';
			currentSkinId = skinId;
			try {
				localStorage.setItem('word_chain_tile_skin', skinId);
			} catch (e) {}

			var skin = TILE_SKINS[skinId];
			this.letterTextures = {};

			var sideMap = this.getHardwoodTexture(skin.sideBase, skin.sideDark, skin.sideLight);
			var lockedSideMap = this.getHardwoodTexture(skin.lockedBase, skin.lockedDark, skin.lockedLight);

			if (materials.tileWood) {
				materials.tileWood.map = sideMap;
				materials.tileWood.roughness = skin.roughness;
				materials.tileWood.metalness = skin.metalness;
				materials.tileWood.needsUpdate = true;
			}
			if (materials.tileLocked) {
				materials.tileLocked.map = lockedSideMap;
				materials.tileLocked.roughness = skin.roughness;
				materials.tileLocked.metalness = skin.metalness;
				materials.tileLocked.needsUpdate = true;
			}

			for (var i = 0; i < allTiles.length; i++) {
				var t = allTiles[i];
				if (t && t.mesh && t.mesh.material && t.mesh.material[2]) {
					t.mesh.material[2].map = this.getLetterTexture(t.letter);
					t.mesh.material[2].roughness = skin.roughness;
					t.mesh.material[2].metalness = skin.metalness;
					t.mesh.material[2].needsUpdate = true;
				}
			}
		},

		getCurrentSkin: function () {
			return currentSkinId;
		},

		getSlotBracketTexture: function () {
			if (this.slotBracketTexture) return this.slotBracketTexture;

			var size = 256;
			var canvas = document.createElement('canvas');
			canvas.width = size;
			canvas.height = size;
			var ctx = canvas.getContext('2d');

			ctx.clearRect(0, 0, size, size);

			// Soft subtle amber fill
			ctx.fillStyle = 'rgba(250, 204, 21, 0.08)';
			drawRoundRect(ctx, 10, 10, size - 20, size - 20, 20);
			ctx.fill();

			// Glowing corner brackets [  ]
			ctx.strokeStyle = '#facc15';
			ctx.lineWidth = 12;
			ctx.lineCap = 'round';

			var arm = 50;
			var m = 18;

			// Top-Left
			ctx.beginPath();
			ctx.moveTo(m, m + arm);
			ctx.lineTo(m, m);
			ctx.lineTo(m + arm, m);
			ctx.stroke();

			// Top-Right
			ctx.beginPath();
			ctx.moveTo(size - m - arm, m);
			ctx.lineTo(size - m, m);
			ctx.lineTo(size - m, m + arm);
			ctx.stroke();

			// Bottom-Left
			ctx.beginPath();
			ctx.moveTo(m, size - m - arm);
			ctx.lineTo(m, size - m);
			ctx.lineTo(m + arm, size - m);
			ctx.stroke();

			// Bottom-Right
			ctx.beginPath();
			ctx.moveTo(size - m - arm, size - m);
			ctx.lineTo(size - m, size - m);
			ctx.lineTo(size - m, size - m - arm);
			ctx.stroke();

			var texture = new THREE.CanvasTexture(canvas);
			texture.encoding = THREE.sRGBEncoding;
			this.slotBracketTexture = texture;
			return texture;
		},

		getSlotHoverTexture: function () {
			if (this.slotHoverTexture) return this.slotHoverTexture;

			var size = 256;
			var canvas = document.createElement('canvas');
			canvas.width = size;
			canvas.height = size;
			var ctx = canvas.getContext('2d');

			ctx.clearRect(0, 0, size, size);

			// Glowing cyan fill
			ctx.fillStyle = 'rgba(56, 189, 248, 0.22)';
			drawRoundRect(ctx, 8, 8, size - 16, size - 16, 18);
			ctx.fill();

			// Bright cyan border
			ctx.strokeStyle = '#38bdf8';
			ctx.lineWidth = 10;
			drawRoundRect(ctx, 10, 10, size - 20, size - 20, 16);
			ctx.stroke();

			var texture = new THREE.CanvasTexture(canvas);
			texture.encoding = THREE.sRGBEncoding;
			this.slotHoverTexture = texture;
			return texture;
		},

		getActiveRowBadgeTexture: function () {
			if (this.activeRowBadgeTexture) return this.activeRowBadgeTexture;

			var width = 512;
			var height = 140;
			var canvas = document.createElement('canvas');
			canvas.width = width;
			canvas.height = height;
			var ctx = canvas.getContext('2d');

			// Glowing background shadow
			ctx.shadowColor = 'rgba(245, 158, 11, 0.85)';
			ctx.shadowBlur = 24;

			// Gold gradient pill
			var grad = ctx.createLinearGradient(0, 0, width, 0);
			grad.addColorStop(0, '#f59e0b');
			grad.addColorStop(0.5, '#fbbf24');
			grad.addColorStop(1.0, '#d97706');
			ctx.fillStyle = grad;
			drawRoundRect(ctx, 16, 16, width - 32, height - 32, 38);
			ctx.fill();

			ctx.shadowBlur = 0;

			// Crisp white border
			ctx.strokeStyle = '#ffffff';
			ctx.lineWidth = 6;
			drawRoundRect(ctx, 16, 16, width - 32, height - 32, 38);
			ctx.stroke();

			// Inner dark golden trim
			ctx.strokeStyle = 'rgba(120, 53, 15, 0.5)';
			ctx.lineWidth = 3;
			drawRoundRect(ctx, 22, 22, width - 44, height - 44, 32);
			ctx.stroke();

			// Bold text
			ctx.font = '900 46px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';

			// White top highlight
			ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
			ctx.fillText('▶ ACTIVE ROW', width * 0.5, height * 0.5 - 1.5);

			// Deep espresso core text
			ctx.fillStyle = '#261404';
			ctx.fillText('▶ ACTIVE ROW', width * 0.5, height * 0.5);

			var texture = new THREE.CanvasTexture(canvas);
			texture.encoding = THREE.sRGBEncoding;
			this.activeRowBadgeTexture = texture;
			return texture;
		},

		getBackgroundTexture: function () {
			if (this.bgTexture) return this.bgTexture;

			var size = 512;
			var canvas = document.createElement('canvas');
			canvas.width = size;
			canvas.height = size;
			var ctx = canvas.getContext('2d');

			// Authentic warm walnut tabletop background gradient (same tone as table art)
			var grad = ctx.createRadialGradient(size * 0.5, size * 0.45, size * 0.1, size * 0.5, size * 0.5, size * 0.75);
			grad.addColorStop(0, '#664225');
			grad.addColorStop(0.5, '#54351d');
			grad.addColorStop(0.85, '#422814');
			grad.addColorStop(1.0, '#311c0d');
			ctx.fillStyle = grad;
			ctx.fillRect(0, 0, size, size);

			// Soft subtle vertical plank seam guides
			ctx.fillStyle = 'rgba(25, 12, 4, 0.25)';
			for (var x = 0; x < size; x += 128) {
				ctx.fillRect(x - 1, 0, 2, size);
			}

			// Natural fine wood fibers
			for (var y = 0; y < size; y += 4) {
				var alpha = (Math.sin(y * 0.14) * 0.5 + 0.5) * 0.07 + 0.02;
				ctx.fillStyle = (Math.sin(y * 0.28) > 0) ? '#281508' : '#7c5332';
				ctx.globalAlpha = alpha;
				ctx.fillRect(0, y, size, 2.5);
			}
			ctx.globalAlpha = 1.0;

			var texture = new THREE.CanvasTexture(canvas);
			texture.encoding = THREE.sRGBEncoding;
			this.bgTexture = texture;
			return texture;
		}
	};

	// --------------------------------------------------------------------------
	// Customization Unlocks, Gift Box Progression & Reward Ads
	// --------------------------------------------------------------------------
	var UnlockManager = {
		ownedSkins: ['classic'],
		ownedSceneries: ['sakura'],
		activeTrial: null, // { type: 'skin'|'scenery', id: string, roundLevel: number }

		init: function () {
			try {
				var savedSkins = JSON.parse(localStorage.getItem('word_chain_owned_skins'));
				if (Array.isArray(savedSkins)) {
					this.ownedSkins = savedSkins;
				}
			} catch (e) {}
			if (this.ownedSkins.indexOf('classic') === -1) {
				this.ownedSkins.push('classic');
			}

			try {
				var savedSceneries = JSON.parse(localStorage.getItem('word_chain_owned_sceneries'));
				if (Array.isArray(savedSceneries)) {
					this.ownedSceneries = savedSceneries;
				}
			} catch (e) {}
			if (this.ownedSceneries.indexOf('sakura') === -1) {
				this.ownedSceneries.push('sakura');
			}
		},

		isOwned: function (type, id) {
			if (type === 'skin') return this.ownedSkins.indexOf(id) !== -1;
			if (type === 'scenery') return this.ownedSceneries.indexOf(id) !== -1;
			return false;
		},

		isTrial: function (type, id) {
			return this.activeTrial && this.activeTrial.type === type && this.activeTrial.id === id;
		},

		unlockPermanent: function (type, id) {
			if (type === 'skin') {
				if (this.ownedSkins.indexOf(id) === -1) {
					this.ownedSkins.push(id);
					try { localStorage.setItem('word_chain_owned_skins', JSON.stringify(this.ownedSkins)); } catch (e) {}
				}
				TextureManager.setSkin(id);
			} else if (type === 'scenery') {
				if (this.ownedSceneries.indexOf(id) === -1) {
					this.ownedSceneries.push(id);
					try { localStorage.setItem('word_chain_owned_sceneries', JSON.stringify(this.ownedSceneries)); } catch (e) {}
				}
				if (global.WordscapesScenery) {
					global.WordscapesScenery.setScenery(id);
				}
			}
			if (this.activeTrial && this.activeTrial.type === type && this.activeTrial.id === id) {
				this.activeTrial = null;
			}
			updateThemeModalUI();
		},

		startTrial: function (type, id) {
			this.activeTrial = {
				type: type,
				id: id,
				roundLevel: currentLevelIndex
			};
			if (type === 'skin') {
				TextureManager.setSkin(id);
			} else if (type === 'scenery') {
				if (global.WordscapesScenery) {
					global.WordscapesScenery.setScenery(id);
				}
			}
			updateThemeModalUI();
		},

		checkTrialExpiration: function (newLevelIndex, onHandled) {
			var self = this;
			if (!self.activeTrial) {
				if (onHandled) onHandled();
				return;
			}
			// If still on the same level round, trial continues
			if (self.activeTrial.roundLevel === newLevelIndex) {
				if (onHandled) onHandled();
				return;
			}
			// If already owned, clear trial silently
			if (self.isOwned(self.activeTrial.type, self.activeTrial.id)) {
				self.activeTrial = null;
				if (onHandled) onHandled();
				return;
			}

			// Trial ended! Show modal prompt
			var trialItem = self.activeTrial;
			var modal = document.getElementById('trial-ended-modal');
			var nameEl = document.getElementById('trial-ended-name');
			var showcaseEl = document.getElementById('trial-ended-showcase');
			var btnAd = document.getElementById('btn-trial-ended-ad');
			var btnDismiss = document.getElementById('btn-trial-ended-dismiss');

			if (!modal) {
				self.revertToDefault();
				if (onHandled) onHandled();
				return;
			}

			var itemName = (trialItem.type === 'skin') ? (TILE_SKINS[trialItem.id] ? TILE_SKINS[trialItem.id].name : trialItem.id) : trialItem.id;
			if (nameEl) nameEl.textContent = itemName;

			if (showcaseEl) {
				showcaseEl.innerHTML = '';
				if (trialItem.type === 'skin') {
					var preview = document.createElement('div');
					preview.className = 'reward-tile-preview-3d';
					var skin = TILE_SKINS[trialItem.id] || TILE_SKINS.classic;
					preview.style.background = skin.faceBase[0];
					preview.style.color = skin.textColor;
					preview.style.border = '2px solid ' + skin.borderColor;
					preview.innerHTML = '<span>A</span><span class="preview-score">1</span>';
					showcaseEl.appendChild(preview);
				} else {
					var scCard = document.createElement('div');
					scCard.className = 'reward-scenery-preview-card';
					var sc = (global.WordscapesScenery && global.WordscapesScenery.getSceneries) ? global.WordscapesScenery.getSceneries()[trialItem.id] : null;
					scCard.style.background = sc ? sc.skyBottom : '#382045';
					scCard.innerHTML = '<span>' + (sc ? sc.icon : '✨') + '</span>';
					showcaseEl.appendChild(scCard);
				}
			}

			modal.classList.add('show');

			if (btnAd) {
				btnAd.onclick = function () {
					modal.classList.remove('show');
					AdMobRewardService.showRewardAd({ type: trialItem.type, id: trialItem.id, name: itemName }, function () {
						self.unlockPermanent(trialItem.type, trialItem.id);
						showToast('🎉 LOCKED IN! You now own ' + itemName + ' forever!');
						if (onHandled) onHandled();
					}, function () {
						self.revertToDefault();
						if (onHandled) onHandled();
					});
				};
			}

			if (btnDismiss) {
				btnDismiss.onclick = function () {
					modal.classList.remove('show');
					self.revertToDefault();
					showToast('Reverted to default collection.');
					if (onHandled) onHandled();
				};
			}
		},

		revertToDefault: function () {
			if (this.activeTrial) {
				if (this.activeTrial.type === 'skin') {
					TextureManager.setSkin('classic');
				} else if (this.activeTrial.type === 'scenery') {
					if (global.WordscapesScenery) {
						global.WordscapesScenery.setScenery('sakura');
					}
				}
				this.activeTrial = null;
			}
			updateThemeModalUI();
		},

		getRewardForLevelRow: function (levelIndex, rowIndex) {
			var rewardsByLevel = [
				{
					2: { type: 'skin', id: 'obsidian', name: 'Midnight Onyx', desc: 'Sleek obsidian stone with polished gold laser lettering', skin: TILE_SKINS.obsidian },
					4: { type: 'scenery', id: 'sunlit', name: 'Alpine Lake', desc: 'Golden dawn mountain lake with glowing sunbeams', icon: '☀️' }
				},
				{
					2: { type: 'skin', id: 'marble', name: 'Pearl Marble', desc: 'Luminous Italian marble with deep slate numerals', skin: TILE_SKINS.marble },
					4: { type: 'scenery', id: 'aurora', name: 'Northern Lights', desc: 'Ethereal emerald & violet polar aurora under starry skies', icon: '🌌' }
				},
				{
					2: { type: 'skin', id: 'jade', name: 'Imperial Jade', desc: 'Polished emerald jade stone with rich forest markings', skin: TILE_SKINS.jade },
					4: { type: 'scenery', id: 'autumn', name: 'Autumn Woods', desc: 'Crisp golden woods with falling amber & crimson leaves', icon: '🍂' }
				},
				{
					2: { type: 'skin', id: 'sunset', name: 'Sunset Coral', desc: 'Warm coral blush wood with rose quartz laser etching', skin: TILE_SKINS.sunset },
					4: { type: 'scenery', id: 'rain', name: 'Rainy Forest', desc: 'Peaceful twilight woodland sanctuary with gentle rain & ripples', icon: '🌧️' }
				}
			];

			var lvlRewards = rewardsByLevel[levelIndex % rewardsByLevel.length];
			return (lvlRewards && lvlRewards[rowIndex]) ? lvlRewards[rowIndex] : null;
		}
	};

	var AdMobRewardService = {
		testAdUnitId: 'ca-app-pub-3940256099942544/5224354917',
		adDurationSec: 5,
		isAdPlaying: false,

		showRewardAd: function (rewardItem, onRewarded, onDismissed) {
			var self = this;
			self.isAdPlaying = true;
			var modal = document.getElementById('admob-reward-modal');
			var countdownEl = document.getElementById('admob-countdown-text');
			var closeBtn = document.getElementById('btn-admob-close');
			var progressBar = document.getElementById('admob-progress-bar');
			var grantNotice = document.getElementById('admob-grant-notice');
			var statusTag = document.getElementById('admob-server-status');

			if (!modal) return;
			modal.classList.add('show');
			closeBtn.disabled = true;
			grantNotice.classList.remove('show');
			statusTag.textContent = 'Simulating Google AdMob Test Server (200 OK)...';
			progressBar.style.width = '0%';

			var remaining = self.adDurationSec;
			countdownEl.textContent = 'Reward in: ' + remaining + 's';

			var startTime = performance.now();
			var rewardGranted = false;

			var timerInterval = setInterval(function () {
				var elapsed = (performance.now() - startTime) / 1000;
				var pct = Math.min(100, (elapsed / self.adDurationSec) * 100);
				progressBar.style.width = pct + '%';

				var rem = Math.max(0, Math.ceil(self.adDurationSec - elapsed));
				if (rem > 0) {
					countdownEl.textContent = 'Reward in: ' + rem + 's';
				} else {
					clearInterval(timerInterval);
					countdownEl.textContent = 'Reward Granted! ✓';
					grantNotice.classList.add('show');
					closeBtn.disabled = false;
					statusTag.textContent = 'Verified: 1x Permanent Unlock (' + (rewardItem ? rewardItem.name : '') + ')';
					AudioManager.play('greatJob', 0.9);
					AudioManager.haptic(40);
					rewardGranted = true;

					if (typeof onRewarded === 'function') {
						onRewarded(rewardItem);
					}
				}
			}, 100);

			closeBtn.onclick = function () {
				modal.classList.remove('show');
				self.isAdPlaying = false;
				if (typeof onDismissed === 'function') {
					onDismissed();
				}
			};
		}
	};

	// --------------------------------------------------------------------------
	// Speedometer & Speed Ranking Manager
	// --------------------------------------------------------------------------
	var SpeedometerManager = {
		STORAGE_KEY: 'scruffle_3d_speed_records_v1',
		records: { levels: {} },
		levelStartTime: 0,
		lastWordSolveTime: 0,
		wordsSolvedThisLevel: 0,
		targetSpeed: 0,
		displayedSpeed: 0,
		currentLevelSpeed: 0,
		isLevelActive: false,

		TIERS: [
			{ minWpm: 45, tier: 'S+', title: 'GODSPEED', color: '#ff007f', gradient: 'linear-gradient(135deg, #ff007f, #ffd700)' },
			{ minWpm: 35, tier: 'S',  title: 'LIGHTNING', color: '#ffd700', gradient: 'linear-gradient(135deg, #ffd700, #ff8c00)' },
			{ minWpm: 26, tier: 'A+', title: 'SPEED DEMON', color: '#ff7300', gradient: 'linear-gradient(135deg, #ff7300, #ff3b30)' },
			{ minWpm: 18, tier: 'A',  title: 'RAPID SOLVER', color: '#00e5ff', gradient: 'linear-gradient(135deg, #00e5ff, #0077ff)' },
			{ minWpm: 12, tier: 'B',  title: 'SWIFT CHAINER', color: '#4ade80', gradient: 'linear-gradient(135deg, #4ade80, #10b981)' },
			{ minWpm: 6,  tier: 'C',  title: 'STEADY SOLVER', color: '#94a3b8', gradient: 'linear-gradient(135deg, #94a3b8, #64748b)' },
			{ minWpm: 0,  tier: 'D',  title: 'ROOKIE', color: '#64748b', gradient: 'linear-gradient(135deg, #64748b, #475569)' }
		],

		init: function () {
			try {
				var saved = localStorage.getItem(this.STORAGE_KEY);
				if (saved) {
					this.records = JSON.parse(saved);
					if (!this.records.levels) this.records.levels = {};
				}
			} catch (e) {
				this.records = { levels: {} };
			}

			// Pre-populate demo records if speed=1 query parameter is set
			if (window.location && window.location.search && window.location.search.indexOf('speed=1') !== -1) {
				if (Object.keys(this.records.levels).length === 0) {
					this.records.levels[0] = { bestWpm: 34.2, bestTimeSec: 7.0, timestamp: Date.now() - 3600000 };
					this.records.levels[1] = { bestWpm: 42.0, bestTimeSec: 5.7, timestamp: Date.now() - 2400000 };
					this.records.levels[2] = { bestWpm: 38.5, bestTimeSec: 6.2, timestamp: Date.now() - 1200000 };
					this.records.levels[3] = { bestWpm: 46.8, bestTimeSec: 4.8, timestamp: Date.now() - 300000 };
					this.saveRecords();
				}
				this.targetSpeed = 42.0;
				this.displayedSpeed = 42.0;
			}

			this.updateTitleScreenUI();
			this.updateSettingsLevelUI(currentLevelIndex || 0);
		},

		saveRecords: function () {
			try {
				localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.records));
			} catch (e) {}
			this.updateTitleScreenUI();
			this.updateSettingsLevelUI(currentLevelIndex || 0);
		},

		getTierForWpm: function (wpm) {
			for (var i = 0; i < this.TIERS.length; i++) {
				if (wpm >= this.TIERS[i].minWpm) {
					return this.TIERS[i];
				}
			}
			return this.TIERS[this.TIERS.length - 1];
		},

		startLevel: function (levelIndex) {
			this.levelStartTime = performance.now();
			this.lastWordSolveTime = performance.now();
			this.wordsSolvedThisLevel = 0;
			this.currentLevelSpeed = 0;
			this.targetSpeed = 0;
			this.displayedSpeed = 0;
			this.isLevelActive = true;
			this.updateSettingsLevelUI(levelIndex);

			var numEl = document.getElementById('speedo-number');
			if (numEl) numEl.textContent = '0';
			var badgeEl = document.getElementById('speedo-sub-badge');
			if (badgeEl) {
				badgeEl.textContent = 'CRUISE';
				badgeEl.style.color = '#00e5ff';
			}
			var needleEl = document.getElementById('speedo-needle');
			if (needleEl) needleEl.setAttribute('transform', 'rotate(-90 50 50)');
			var fillEl = document.getElementById('speedo-fill');
			if (fillEl) fillEl.style.strokeDashoffset = '115';

			var winCard = document.getElementById('win-speed-card');
			if (winCard) winCard.classList.remove('show');
		},

		onWordSolved: function (wordIdx, totalWords) {
			var now = performance.now();
			this.wordsSolvedThisLevel++;

			// Instantaneous WPM for this specific word
			var wordElapsedSec = Math.max(0.3, (now - this.lastWordSolveTime) / 1000);
			var instantWpm = Math.min(80, (1 / wordElapsedSec) * 60);

			// Cumulative level WPM
			var totalElapsedSec = Math.max(0.6, (now - this.levelStartTime) / 1000);
			var cumulativeWpm = (this.wordsSolvedThisLevel / totalElapsedSec) * 60;

			this.currentLevelSpeed = Math.round(cumulativeWpm * 10) / 10;
			this.lastWordSolveTime = now;

			// Rev the needle towards the faster speed with inertia
			this.targetSpeed = Math.min(80, Math.max(instantWpm, cumulativeWpm));

			// Visual pulse feedback on speedometer
			var hudSpeedo = document.getElementById('hud-speedometer');
			if (hudSpeedo) {
				hudSpeedo.classList.add('speedo-pulse');
				if (this.targetSpeed >= 40) {
					hudSpeedo.classList.add('speedo-hyper');
				}
				setTimeout(function () {
					hudSpeedo.classList.remove('speedo-pulse');
				}, 400);
			}
		},

		onLevelCompleted: function (levelIndex) {
			this.isLevelActive = false;
			var totalElapsedSec = Math.max(0.8, (performance.now() - this.levelStartTime) / 1000);
			var finalWpm = Math.round((Math.max(1, this.wordsSolvedThisLevel) / totalElapsedSec) * 60 * 10) / 10;
			this.currentLevelSpeed = finalWpm;

			var prevRecord = this.records.levels[levelIndex];
			var isNewRecord = !prevRecord || finalWpm > prevRecord.bestWpm;

			if (isNewRecord) {
				this.records.levels[levelIndex] = {
					bestWpm: finalWpm,
					bestTimeSec: Math.round(totalElapsedSec * 10) / 10,
					timestamp: Date.now()
				};
				this.saveRecords();
			}

			// Show win celebration speed card
			var winCard = document.getElementById('win-speed-card');
			var valEl = document.getElementById('win-speed-val');
			var recBadge = document.getElementById('win-record-badge');
			if (valEl) valEl.textContent = finalWpm + ' WPM';
			if (recBadge) recBadge.style.display = isNewRecord ? 'inline-block' : 'none';
			if (winCard) winCard.classList.add('show');

			this.updateTitleScreenUI();
			this.updateSettingsLevelUI(levelIndex);

			return { finalWpm: finalWpm, isNewRecord: isNewRecord };
		},

		updateLoop: function () {
			if (!this.isLevelActive) return;

			// Gradual needle drop / decay when idle
			if (this.targetSpeed > 0) {
				this.targetSpeed = Math.max(0, this.targetSpeed - 0.08);
			}

			// Smooth lerp for needle
			this.displayedSpeed += (this.targetSpeed - this.displayedSpeed) * 0.12;

			var roundedSpeed = Math.round(this.displayedSpeed);
			var numEl = document.getElementById('speedo-number');
			if (numEl) numEl.textContent = roundedSpeed;

			// Needle angle: 0 WPM -> -90deg, 60 WPM -> +90deg
			var angle = (Math.min(60, Math.max(0, this.displayedSpeed)) / 60) * 180 - 90;
			var needleEl = document.getElementById('speedo-needle');
			if (needleEl) {
				needleEl.setAttribute('transform', 'rotate(' + angle.toFixed(1) + ' 50 50)');
			}

			// Gauge arc fill offset (115 is empty, 0 is full)
			var fillOffset = 115 - (Math.min(60, Math.max(0, this.displayedSpeed)) / 60) * 115;
			var fillEl = document.getElementById('speedo-fill');
			if (fillEl) {
				fillEl.style.strokeDashoffset = fillOffset.toFixed(1);
			}

			// Sub badge status
			var badgeEl = document.getElementById('speedo-sub-badge');
			if (badgeEl) {
				if (this.displayedSpeed >= 45) {
					badgeEl.textContent = 'HYPER ⚡';
					badgeEl.style.color = '#ff007f';
				} else if (this.displayedSpeed >= 32) {
					badgeEl.textContent = 'TURBO 🔥';
					badgeEl.style.color = '#ff8c00';
				} else if (this.displayedSpeed >= 18) {
					badgeEl.textContent = 'RAPID 🚀';
					badgeEl.style.color = '#ffd700';
				} else if (this.displayedSpeed >= 8) {
					badgeEl.textContent = 'SWIFT ✨';
					badgeEl.style.color = '#00e5ff';
				} else {
					badgeEl.textContent = 'CRUISE';
					badgeEl.style.color = '#94a3b8';
				}
			}

			var hudSpeedo = document.getElementById('hud-speedometer');
			if (hudSpeedo && this.displayedSpeed < 40) {
				hudSpeedo.classList.remove('speedo-hyper');
			}
		},

		getOverallStats: function () {
			var levels = this.records.levels || {};
			var keys = Object.keys(levels);
			var count = keys.length;
			if (count === 0) {
				return {
					tierObj: this.TIERS[this.TIERS.length - 1], // Rookie D
					avgWpm: 0,
					peakWpm: 0,
					completedCount: 0
				};
			}

			var sumWpm = 0;
			var peakWpm = 0;
			keys.forEach(function (k) {
				var wpm = levels[k].bestWpm || 0;
				sumWpm += wpm;
				if (wpm > peakWpm) peakWpm = wpm;
			});

			var avgWpm = Math.round((sumWpm / count) * 10) / 10;
			var tierObj = this.getTierForWpm(avgWpm);

			return {
				tierObj: tierObj,
				avgWpm: avgWpm,
				peakWpm: Math.round(peakWpm * 10) / 10,
				completedCount: count
			};
		},

		updateTitleScreenUI: function () {
			var stats = this.getOverallStats();
			var tierEl = document.getElementById('title-rank-tier');
			var nameEl = document.getElementById('title-rank-name');
			var avgEl = document.getElementById('title-rank-avg-wpm');
			var peakEl = document.getElementById('title-rank-peak-wpm');
			var lvlEl = document.getElementById('title-rank-levels');

			if (tierEl) {
				tierEl.textContent = 'RANK ' + stats.tierObj.tier;
				tierEl.style.background = stats.tierObj.gradient;
			}
			if (nameEl) {
				nameEl.textContent = stats.tierObj.title;
			}
			if (avgEl) {
				avgEl.textContent = stats.avgWpm > 0 ? (stats.avgWpm + ' WPM') : '--';
			}
			if (peakEl) {
				peakEl.textContent = stats.peakWpm > 0 ? (stats.peakWpm + ' WPM') : '--';
			}
			if (lvlEl) {
				lvlEl.textContent = stats.completedCount + '/30';
			}
		},

		updateSettingsLevelUI: function (levelIndex) {
			var recEl = document.getElementById('settings-level-record');
			if (!recEl) return;
			var rec = this.records.levels && this.records.levels[levelIndex];
			if (rec && rec.bestWpm) {
				recEl.textContent = '⚡ Best: ' + rec.bestWpm + ' WPM (' + rec.bestTimeSec + 's)';
				recEl.style.color = '#ffd700';
			} else {
				recEl.textContent = '⚡ Best: -- WPM (Unsolved)';
				recEl.style.color = '#94a3b8';
			}
		}
	};

	// --------------------------------------------------------------------------
	// 3D Engine & Game State
	// --------------------------------------------------------------------------
	var scene, camera, renderer;
	var raycaster, pointer, dragPlane;

	// Trays & Slots
	var chainRacksGroup;
	var stagingTrayGroup;
	var chainSlots = [];   // Array of { type: 'chain', row: r, col: c, mesh, slotPos, tile: null }
	var stagingSlots = []; // Array of { type: 'staging', index: i, mesh, slotPos, tile: null }
	var chainRowData = []; // Array of row metadata: { row, rowGroup, rackMesh, lipMesh, rz, rackWidth, wordLen, slots, brackets }

	// Active Row & Snap Visual Indicators
	var activeRowIndicatorGroup = null;
	var activeRowIndicatorBadge = null;
	var chevronMesh = null;
	var chevronRightMesh = null;
	var hoverSlotHighlightMesh = null;

	// Ghost Tile Hint System State (translucent guide tile on top board)
	var ghostTileMesh = null;
	var currentGhostSlot = null;
	var currentGhostLetter = null;

	// Tiles
	var allTiles = [];     // Array of Tile instances
	var activeTile = null; // Tile currently being dragged
	var dragOffset = new THREE.Vector3();
	var dragIntersection = new THREE.Vector3();
	var prevDragPos = new THREE.Vector3();
	var dragVelocity = new THREE.Vector3();

	// Game Progression State
	var currentLevelIndex = 0;
	var currentWordIndex = 0;
	var currentLevelData = null;
	var totalLevels = 30;
	var wordsSolvedCount = 0;

	// Interactive Gameplay Animation States (Win Celebration & Headshake)
	var isRowShaking = false;
	var isCelebratingWin = false;
	var isComboPlaying = false;
	var mexicanWaveInterval = null;
	var victoryMessageTiles = [];
	var celebrationParticles = []; // Confetti & Star meshes
	var confettiGroup = null;
	var activeGiftBoxes = []; // 3D Gift Box reward instances on word racks

	// Materials Cache
	var materials = {};

	function initMaterials() {
		var rackWoodMap = TextureManager.getHardwoodTexture('#be8432', '#6b4112', '#e2af68');
		var activeWoodMap = TextureManager.getHardwoodTexture('#df9419', '#7e3e07', '#ffcb6d');
		var solvedWoodMap = TextureManager.getHardwoodTexture('#9c6a28', '#52340f', '#c49048');
		var dimmedWoodMap = TextureManager.getHardwoodTexture('#583b20', '#2d1b0c', '#79532e');
		var greenWoodMap = TextureManager.getHardwoodTexture('#2f5a3a', '#173620', '#4a8258');
		var tileSideWoodMap = TextureManager.getHardwoodTexture('#e8d4ba', '#9e7b54', '#f7ead8');
		var tileLockedWoodMap = TextureManager.getHardwoodTexture('#f2de9f', '#aa833e', '#fff1c7');

		// Yellow Teak Wood (Chained word racks - Default warm wood)
		materials.yellowTray = new THREE.MeshStandardMaterial({
			map: rackWoodMap,
			color: 0xffffff,
			roughness: 0.76,
			metalness: 0.0
		});

		// Active row rack (Warm glowing honey amber carved wood)
		materials.yellowTrayActive = new THREE.MeshStandardMaterial({
			map: activeWoodMap,
			color: 0xffffff,
			emissive: 0x3d1f03,
			emissiveIntensity: 0.35,
			roughness: 0.68,
			metalness: 0.0
		});

		// Solved row rack (Settled antique warm teak wood)
		materials.yellowTraySolved = new THREE.MeshStandardMaterial({
			map: solvedWoodMap,
			color: 0xffffff,
			roughness: 0.78,
			metalness: 0.0
		});

		// Pending row rack (Darkened walnut oak wood)
		materials.yellowTrayDimmed = new THREE.MeshStandardMaterial({
			map: dimmedWoodMap,
			color: 0xffffff,
			roughness: 0.82,
			metalness: 0.0
		});

		// Green Moss Wood (Player hand / staging tray)
		materials.greenTray = new THREE.MeshStandardMaterial({
			map: greenWoodMap,
			color: 0xffffff,
			roughness: 0.76,
			metalness: 0.0
		});

		// Tray slot felt lining
		materials.slotFelt = new THREE.MeshStandardMaterial({
			color: 0x16120e,
			roughness: 0.90,
			metalness: 0.0
		});

		// Slot hover snap indicator
		materials.slotHover = new THREE.MeshBasicMaterial({
			map: TextureManager.getSlotHoverTexture(),
			transparent: true,
			opacity: 0.85,
			depthWrite: false
		});

		// Active slot brackets (corner targets [ ])
		materials.activeSlotBracket = new THREE.MeshBasicMaterial({
			map: TextureManager.getSlotBracketTexture(),
			transparent: true,
			opacity: 0.75,
			depthWrite: false
		});

		// 3D Chevron Arrow Material
		materials.chevron = new THREE.MeshStandardMaterial({
			color: 0xf59e0b,
			emissive: 0x78350f,
			roughness: 0.35,
			metalness: 0.4
		});

		// Tile sides & back (authentic birch/maple wood grain)
		materials.tileWood = new THREE.MeshStandardMaterial({
			map: tileSideWoodMap,
			color: 0xffffff,
			roughness: 0.72,
			metalness: 0.0
		});

		// Locked tile sides & back (warm amber golden wood)
		materials.tileLocked = new THREE.MeshStandardMaterial({
			map: tileLockedWoodMap,
			color: 0xffffff,
			roughness: 0.68,
			metalness: 0.0
		});

		// Lit tile sides & front/back (glowing golden amber illuminated wood)
		materials.tileLit = new THREE.MeshStandardMaterial({
			map: tileLockedWoodMap,
			color: 0xffffff,
			emissive: 0xd97706,
			emissiveIntensity: 0.92,
			roughness: 0.35,
			metalness: 0.2
		});

		// 3D Gift Box Materials (Ruby Red body with Polished Gold ribbon)
		materials.giftBoxRuby = new THREE.MeshStandardMaterial({
			color: 0xdf1c3f,
			roughness: 0.35,
			metalness: 0.15
		});

		materials.giftBoxGold = new THREE.MeshStandardMaterial({
			color: 0xffd23f,
			emissive: 0x7a4d05,
			emissiveIntensity: 0.25,
			roughness: 0.25,
			metalness: 0.6
		});
	}

	// --------------------------------------------------------------------------
	// 3D Tile Class
	// --------------------------------------------------------------------------
	function Tile(letter, isLocked) {
		this.letter = letter;
		this.isLocked = !!isLocked;
		this.currentSlot = null;

		// Geometry: 1.04 x 0.28 x 1.04 with beveled box (warm, bold wooden tile)
		var geom = new THREE.BoxGeometry(1.04, 0.28, 1.04);

		// Multi-material: Top face (Index 2 in BoxGeometry is +Y face)
		var faceMat = new THREE.MeshStandardMaterial({
			map: TextureManager.getLetterTexture(letter),
			roughness: 0.62,
			metalness: 0.0
		});

		var sideMat = this.isLocked ? materials.tileLocked : materials.tileWood;

		// BoxGeometry faces order: +X, -X, +Y, -Y, +Z, -Z
		var mats = [
			sideMat, // +X
			sideMat, // -X
			faceMat, // +Y (Top face with letter texture)
			materials.slotFelt, // -Y (Bottom felt)
			sideMat, // +Z
			sideMat  // -Z
		];

		this.mesh = new THREE.Mesh(geom, mats);
		this.mesh.userData.tile = this;

		// Physics / Interpolation values
		this.position = new THREE.Vector3();
		this.targetPosition = new THREE.Vector3();
		this.rotation = new THREE.Euler(0, 0, 0);
		this.targetRotation = new THREE.Euler(0, 0, 0);

		this.isDragging = false;
		this.liftY = 0; // Target lift while dragging
		this.settleVelocity = 0;
		this.wobblePhase = 0;

		// Sequential Wave Jump State
		this.inWave = false;
		this.waveTimer = 0;
		this.waveDuration = 0.44;
		this.wavePeakHeight = 1.15;

		// Horizontal "No-No" Headshake State
		this.inShake = false;
		this.shakeTimer = 0;
		this.shakeDuration = 0.45;

		// Snap Pop Effect State
		this.inSnap = false;
		this.snapTimer = 0;
		this.snapDuration = 0.20;

		// Winning Combination Hop State (0.2s duration)
		this.inHop = false;
		this.hopTimer = 0;
		this.hopDuration = 0.20;
		this.hopPeakHeight = 0.65;
		this.isLit = false;
	}

	Tile.prototype.setTarget = function (x, y, z) {
		this.targetPosition.set(x, y, z);
	};

	Tile.prototype.startHop = function (duration, peakHeight) {
		this.inHop = true;
		this.hopTimer = 0;
		this.hopDuration = duration || 0.20;
		this.hopPeakHeight = peakHeight || 0.65;
	};

	Tile.prototype.setLit = function (isLit) {
		this.isLit = !!isLit;
		var sideMat = isLit ? materials.tileLit : (this.isLocked ? materials.tileLocked : materials.tileWood);
		this.mesh.material[0] = sideMat;
		this.mesh.material[1] = sideMat;
		this.mesh.material[4] = sideMat;
		this.mesh.material[5] = sideMat;

		var faceMat = this.mesh.material[2];
		if (faceMat) {
			if (isLit) {
				faceMat.emissive.setHex(0xf59e0b);
				faceMat.emissiveIntensity = 0.95;
			} else {
				faceMat.emissive.setHex(0x000000);
				faceMat.emissiveIntensity = 0.0;
			}
			faceMat.needsUpdate = true;
		}
	};

	Tile.prototype.startSnapFx = function () {
		this.inSnap = true;
		this.snapTimer = 0;
		this.snapDuration = 0.20;
	};

	Tile.prototype.startWave = function (delaySec) {
		this.inWave = true;
		this.waveTimer = -(delaySec || 0);
		this.waveDuration = 0.44;
		this.wavePeakHeight = 1.15;
	};
	Tile.prototype.triggerWave = Tile.prototype.startWave;

	Tile.prototype.startShake = function (duration) {
		this.inShake = true;
		this.shakeTimer = 0;
		this.shakeDuration = duration || 0.45;
	};

	Tile.prototype.update = function (dt) {
		var lerpRate = this.isDragging ? 0.32 : 0.22;

		// Horizontal "No-No" Headshake physics
		var shakeExtraX = 0;
		var shakeTiltZ = 0;
		if (this.inShake) {
			this.shakeTimer += dt;
			if (this.shakeTimer <= this.shakeDuration) {
				var sp = this.shakeTimer / this.shakeDuration;
				var damp = 1 - sp;
				shakeExtraX = Math.sin(sp * Math.PI * 8) * 0.42 * damp;
				shakeTiltZ = Math.sin(sp * Math.PI * 8) * -0.20 * damp;
			} else {
				this.inShake = false;
				this.mesh.rotation.z = this.targetRotation.z;
			}
		}

		// Smooth position interpolation
		this.mesh.position.x += ((this.targetPosition.x + shakeExtraX) - this.mesh.position.x) * lerpRate;
		this.mesh.position.z += (this.targetPosition.z - this.mesh.position.z) * lerpRate;

		// Y elevation with spring settle
		var targetY = this.targetPosition.y + (this.isDragging ? 1.35 : 0);

		// Wave jump physics
		var waveExtraY = 0;
		var waveTiltX = 0;
		if (this.inWave) {
			this.waveTimer += dt;
			if (this.waveTimer >= 0 && this.waveTimer <= this.waveDuration) {
				var p = this.waveTimer / this.waveDuration;
				waveExtraY = Math.sin(p * Math.PI) * this.wavePeakHeight;
				waveTiltX = Math.sin(p * Math.PI * 2) * -0.16;
			} else if (this.waveTimer > this.waveDuration) {
				this.inWave = false;
				this.mesh.rotation.x = this.targetRotation.x;
			}
		}

		// Winning combination 0.2s hop physics
		var hopExtraY = 0;
		if (this.inHop) {
			this.hopTimer += dt;
			if (this.hopTimer <= this.hopDuration) {
				var hp = this.hopTimer / this.hopDuration;
				hopExtraY = Math.sin(hp * Math.PI) * this.hopPeakHeight;
			} else {
				this.inHop = false;
			}
		}

		this.mesh.position.y += ((targetY + waveExtraY + hopExtraY) - this.mesh.position.y) * 0.35;

		// Rotation tilt interpolation
		this.mesh.rotation.x += ((this.targetRotation.x + waveTiltX) - this.mesh.rotation.x) * 0.25;
		this.mesh.rotation.z += ((this.targetRotation.z + shakeTiltZ) - this.mesh.rotation.z) * 0.25;
		this.mesh.rotation.y += (this.targetRotation.y - this.mesh.rotation.y) * 0.2;

		// Snap pop spring scaling
		var snapScale = 1.0;
		if (this.inSnap) {
			this.snapTimer += dt;
			if (this.snapTimer <= this.snapDuration) {
				var snp = this.snapTimer / this.snapDuration;
				snapScale = 1.0 + Math.sin(snp * Math.PI) * 0.16;
			} else {
				this.inSnap = false;
				snapScale = 1.0;
			}
		}
		this.mesh.scale.set(snapScale, snapScale, snapScale);
	};

	// --------------------------------------------------------------------------
	// Scene & Trays Builder
	// --------------------------------------------------------------------------
	function buildTableAndTrays() {
		// 1. Chained Word Racks Container
		chainRacksGroup = new THREE.Group();
		scene.add(chainRacksGroup);

		// 2. Staging / Player Hand Tray (Green Wood)
		stagingTrayGroup = new THREE.Group();
		scene.add(stagingTrayGroup);

		// 3. Hover Slot Highlight Target Mesh (appears under tile during drag)
		var hoverGeom = new THREE.PlaneGeometry(1.28, 1.28);
		hoverSlotHighlightMesh = new THREE.Mesh(hoverGeom, materials.slotHover);
		hoverSlotHighlightMesh.rotation.x = -Math.PI * 0.5;
		hoverSlotHighlightMesh.visible = false;
		scene.add(hoverSlotHighlightMesh);

		// 4. Active Row 3D Indicator Group (Twin Animated Golden Chevrons)
		activeRowIndicatorGroup = new THREE.Group();

		// Extruded 3D Arrow Chevrons framing the active rack from left and right
		var arrowShape = new THREE.Shape();
		arrowShape.moveTo(-0.22, -0.18);
		arrowShape.lineTo(0.26, 0);
		arrowShape.lineTo(-0.22, 0.18);
		arrowShape.lineTo(-0.11, 0);
		arrowShape.closePath();

		var arrowGeom = new THREE.ExtrudeGeometry(arrowShape, {
			steps: 1,
			depth: 0.12,
			bevelEnabled: true,
			bevelThickness: 0.03,
			bevelSize: 0.03,
			bevelSegments: 2
		});

		// Left Chevron pointing right ▶
		chevronMesh = new THREE.Mesh(arrowGeom, materials.chevron);
		chevronMesh.rotation.x = -Math.PI * 0.5;
		activeRowIndicatorGroup.add(chevronMesh);

		// Right Chevron pointing left ◀
		chevronRightMesh = new THREE.Mesh(arrowGeom, materials.chevron);
		chevronRightMesh.rotation.x = -Math.PI * 0.5;
		chevronRightMesh.rotation.z = Math.PI; // Flip 180 to point left
		activeRowIndicatorGroup.add(chevronRightMesh);

		scene.add(activeRowIndicatorGroup);
	}

	/**
	 * Build the bottom green player hand tray with 8 slots.
	 * Positioned dynamically based on level depth.
	 */
	function buildStagingTray(stagingZ) {
		stagingZ = (stagingZ !== undefined ? stagingZ : 6.3);

		while (stagingTrayGroup.children.length > 0) {
			stagingTrayGroup.remove(stagingTrayGroup.children[0]);
		}
		stagingSlots = [];

		var slotCount = 8;
		var slotWidth = 1.15;
		var trayWidth = slotCount * slotWidth + 0.50;
		var trayDepth = 1.44;
		var trayHeight = 0.36;

		stagingTrayGroup.position.set(0, 0, stagingZ);

		// Main wooden beam
		var beamGeom = new THREE.BoxGeometry(trayWidth, trayHeight, trayDepth);
		var beam = new THREE.Mesh(beamGeom, materials.greenTray);
		beam.position.y = trayHeight * 0.5;
		stagingTrayGroup.add(beam);

		// Front lip
		var lipGeom = new THREE.BoxGeometry(trayWidth + 0.04, 0.15, 0.15);
		var lip = new THREE.Mesh(lipGeom, materials.greenTray);
		lip.position.set(0, trayHeight + 0.075, trayDepth * 0.5 - 0.075);
		stagingTrayGroup.add(lip);

		// Slots inside tray
		var startX = -((slotCount - 1) * slotWidth) * 0.5;
		for (var i = 0; i < slotCount; i++) {
			var sx = startX + i * slotWidth;
			var slotMesh = new THREE.Mesh(
				new THREE.PlaneGeometry(1.06, 1.06),
				materials.slotFelt
			);
			slotMesh.rotation.x = -Math.PI * 0.5;
			slotMesh.position.set(sx, trayHeight + 0.01, 0);
			stagingTrayGroup.add(slotMesh);

			var worldPos = new THREE.Vector3(sx, trayHeight + 0.14, stagingZ);

			stagingSlots.push({
				type: 'staging',
				index: i,
				slotMesh: slotMesh,
				worldPos: worldPos,
				tile: null
			});
		}
	}

	/**
	 * Rebuild the chained word racks for the current level.
	 * Dynamically accommodates ALL 8 rows of words without overlap.
	 */
	function buildChainRacks(levelData) {
		// Clear existing racks, slots, and active 3D gift boxes
		while (chainRacksGroup.children.length > 0) {
			chainRacksGroup.remove(chainRacksGroup.children[0]);
		}
		activeGiftBoxes.forEach(function (gb) {
			if (gb && gb.group) scene.remove(gb.group);
		});
		activeGiftBoxes = [];
		chainSlots = [];
		chainRowData = [];

		var words = levelData.words;
		var numRows = words.length;

		// Calculate staging tray Z and rack layout to take full advantage of screen height
		// Perfectly clear of bottom controls and top header
		var stagingZ = (numRows >= 8) ? 4.8 : (numRows === 7 ? 4.3 : 3.6);
		buildStagingTray(stagingZ);

		var startZ = (numRows >= 8) ? -5.8 : (numRows === 7 ? -5.0 : -4.2);
		var maxRackZ = stagingZ - 1.35;
		var availableSpan = maxRackZ - startZ;
		var rowSpacing = (numRows > 1) ? Math.min(1.58, availableSpan / (numRows - 1)) : 1.58;

		var slotWidth = 1.15;
		var rackDepth = 1.30;
		var rackHeight = 0.34;

		for (var r = 0; r < numRows; r++) {
			var wordObj = words[r];
			var wordLen = wordObj.answer.length;
			var rackWidth = wordLen * slotWidth + 0.50;
			var rz = startZ + r * rowSpacing;

			var rowGroup = new THREE.Group();
			rowGroup.position.set(0, 0, rz);

			// Wooden Rack Beam
			var rackGeom = new THREE.BoxGeometry(rackWidth, rackHeight, rackDepth);
			var rackMesh = new THREE.Mesh(rackGeom, materials.yellowTrayDimmed);
			rackMesh.position.y = rackHeight * 0.5;
			rowGroup.add(rackMesh);

			// Front retaining lip
			var lipGeom = new THREE.BoxGeometry(rackWidth + 0.04, 0.15, 0.15);
			var lipMesh = new THREE.Mesh(lipGeom, materials.yellowTrayDimmed);
			lipMesh.position.set(0, rackHeight + 0.075, rackDepth * 0.5 - 0.075);
			rowGroup.add(lipMesh);

			// Slots for this word
			var startX = -((wordLen - 1) * slotWidth) * 0.5;
			var rowSlots = [];
			var rowBrackets = [];

			for (var c = 0; c < wordLen; c++) {
				var sx = startX + c * slotWidth;

				// Felt bed
				var sMesh = new THREE.Mesh(
					new THREE.PlaneGeometry(1.06, 1.06),
					materials.slotFelt
				);
				sMesh.rotation.x = -Math.PI * 0.5;
				sMesh.position.set(sx, rackHeight + 0.01, 0);
				rowGroup.add(sMesh);

				// Glowing target bracket mesh
				var bracketMesh = new THREE.Mesh(
					new THREE.PlaneGeometry(1.16, 1.16),
					materials.activeSlotBracket
				);
				bracketMesh.rotation.x = -Math.PI * 0.5;
				bracketMesh.position.set(sx, rackHeight + 0.02, 0);
				bracketMesh.visible = false;
				rowGroup.add(bracketMesh);
				rowBrackets.push(bracketMesh);

				var slotWorldPos = new THREE.Vector3(sx, rackHeight + 0.14, rz);

				var slotObj = {
					type: 'chain',
					row: r,
					col: c,
					slotMesh: sMesh,
					bracketMesh: bracketMesh,
					worldPos: slotWorldPos,
					tile: null
				};
				chainSlots.push(slotObj);
				rowSlots.push(slotObj);
			}

			chainRacksGroup.add(rowGroup);

			chainRowData.push({
				row: r,
				rowGroup: rowGroup,
				rackMesh: rackMesh,
				lipMesh: lipMesh,
				rz: rz,
				rackWidth: rackWidth,
				wordLen: wordLen,
				slots: rowSlots,
				brackets: rowBrackets
			});

			// 3D Gift Box Spawn for rows with unearned unlocks
			if (r > 0) {
				var rowReward = UnlockManager.getRewardForLevelRow(currentLevelIndex, r);
				if (rowReward && !UnlockManager.isOwned(rowReward.type, rowReward.id)) {
					var giftBox = create3DGiftBox(r, rowReward, rackWidth, rz, rackHeight);
					activeGiftBoxes.push(giftBox);
				}
			}
		}
	}

	/**
	 * Update rack highlight materials, 3D active row indicators, and brackets.
	 */
	function updateActiveRowVisuals() {
		for (var r = 0; r < chainRowData.length; r++) {
			var rowInfo = chainRowData[r];
			if (r === currentWordIndex) {
				// ACTIVE ROW: Highlighted golden wood & active spotlight
				rowInfo.rackMesh.material = materials.yellowTrayActive;
				rowInfo.lipMesh.material = materials.yellowTrayActive;

				// Reposition 3D active row indicator chevrons
				if (activeRowIndicatorGroup) {
					activeRowIndicatorGroup.visible = true;
					var halfW = rowInfo.rackWidth * 0.5;

					// Left chevron points right ▶
					if (chevronMesh) {
						chevronMesh.position.set(-halfW - 0.36, 0.28, rowInfo.rz);
					}
					// Right chevron points left ◀
					if (chevronRightMesh) {
						chevronRightMesh.position.set(halfW + 0.36, 0.28, rowInfo.rz);
					}
				}
			} else if (r < currentWordIndex) {
				// SOLVED ROW: Warm settled wood
				rowInfo.rackMesh.material = materials.yellowTraySolved;
				rowInfo.lipMesh.material = materials.yellowTraySolved;
			} else {
				// PENDING ROW: Dimmed wood
				rowInfo.rackMesh.material = materials.yellowTrayDimmed;
				rowInfo.lipMesh.material = materials.yellowTrayDimmed;
			}
		}

		updateSlotBrackets();
		updateHUD();
	}

	function updateSlotBrackets() {
		for (var r = 0; r < chainRowData.length; r++) {
			var rowInfo = chainRowData[r];
			var isActiveRow = (r === currentWordIndex);
			for (var c = 0; c < rowInfo.brackets.length; c++) {
				var slot = rowInfo.slots[c];
				var bracket = rowInfo.brackets[c];
				// Brackets only appear on empty slots of the active row
				bracket.visible = isActiveRow && (slot.tile === null);
			}
		}
	}

	// --------------------------------------------------------------------------
	// 3D Gift Box Rewards & Unboxing
	// --------------------------------------------------------------------------
	function create3DGiftBox(rowIdx, reward, rackWidth, rz, rackHeight) {
		var giftGroup = new THREE.Group();
		var posX = rackWidth * 0.5 + 0.46;
		var baseY = rackHeight + 0.22;
		giftGroup.position.set(posX, baseY, rz);
		giftGroup.rotation.x = -0.12;
		giftGroup.rotation.y = -0.18;

		// Box Body (Ruby Red)
		var boxGeom = new THREE.BoxGeometry(0.52, 0.44, 0.52);
		var boxMesh = new THREE.Mesh(boxGeom, materials.giftBoxRuby);
		boxMesh.position.y = 0.22;
		giftGroup.add(boxMesh);

		// Gold Ribbon Band horizontal
		var ribbonH = new THREE.Mesh(new THREE.BoxGeometry(0.53, 0.10, 0.53), materials.giftBoxGold);
		ribbonH.position.y = 0.22;
		giftGroup.add(ribbonH);

		// Gold Ribbon Band vertical 1
		var ribbonV1 = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.45, 0.53), materials.giftBoxGold);
		ribbonV1.position.y = 0.22;
		giftGroup.add(ribbonV1);

		// Gold Ribbon Band vertical 2
		var ribbonV2 = new THREE.Mesh(new THREE.BoxGeometry(0.53, 0.45, 0.10), materials.giftBoxGold);
		ribbonV2.position.y = 0.22;
		giftGroup.add(ribbonV2);

		// Lid Group (pops off on unboxing)
		var lidGroup = new THREE.Group();
		lidGroup.position.y = 0.44;

		var lidGeom = new THREE.BoxGeometry(0.56, 0.10, 0.56);
		var lidMesh = new THREE.Mesh(lidGeom, materials.giftBoxRuby);
		lidMesh.position.y = 0.05;
		lidGroup.add(lidMesh);

		var lidRibbon1 = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.11, 0.57), materials.giftBoxGold);
		lidRibbon1.position.y = 0.05;
		lidGroup.add(lidRibbon1);

		var lidRibbon2 = new THREE.Mesh(new THREE.BoxGeometry(0.57, 0.11, 0.10), materials.giftBoxGold);
		lidRibbon2.position.y = 0.05;
		lidGroup.add(lidRibbon2);

		// Bow knot loops
		var bow1 = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.025, 8, 16), materials.giftBoxGold);
		bow1.rotation.x = Math.PI * 0.5;
		bow1.rotation.z = Math.PI * 0.25;
		bow1.position.set(-0.06, 0.13, -0.06);
		lidGroup.add(bow1);

		var bow2 = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.025, 8, 16), materials.giftBoxGold);
		bow2.rotation.x = Math.PI * 0.5;
		bow2.rotation.z = -Math.PI * 0.25;
		bow2.position.set(0.06, 0.13, 0.06);
		lidGroup.add(bow2);

		var bowCenter = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), materials.giftBoxGold);
		bowCenter.position.set(0, 0.12, 0);
		lidGroup.add(bowCenter);

		giftGroup.add(lidGroup);

		// Golden Aura Glow beneath box
		var glowGeo = new THREE.PlaneGeometry(0.72, 0.72);
		var glowMat = new THREE.MeshBasicMaterial({
			map: TextureManager.getSlotHoverTexture(),
			color: 0xffd166,
			transparent: true,
			opacity: 0.5,
			depthWrite: false
		});
		var glowMesh = new THREE.Mesh(glowGeo, glowMat);
		glowMesh.rotation.x = -Math.PI * 0.5;
		glowMesh.position.y = 0.01;
		giftGroup.add(glowMesh);

		scene.add(giftGroup);

		return {
			rowIdx: rowIdx,
			reward: reward,
			group: giftGroup,
			lid: lidGroup,
			baseY: baseY,
			isOpening: false
		};
	}

	function createSparkleBurst(x, y, z, count) {
		if (!confettiGroup) {
			confettiGroup = new THREE.Group();
			scene.add(confettiGroup);
		}
		var starShape = createStarShape(0.20, 0.09);
		var starGeom = new THREE.ShapeGeometry(starShape);
		var starMat = new THREE.MeshStandardMaterial({
			color: 0xffd700,
			emissive: 0xffaa00,
			emissiveIntensity: 0.8,
			roughness: 0.2,
			metalness: 0.7,
			side: THREE.DoubleSide
		});

		var num = count || 26;
		for (var i = 0; i < num; i++) {
			var mesh = new THREE.Mesh(starGeom, starMat);
			mesh.position.set(x, y, z);
			var angle = Math.random() * Math.PI * 2;
			var speed = 2.5 + Math.random() * 3.5;
			mesh.userData = {
				vx: Math.cos(angle) * speed,
				vy: 3.5 + Math.random() * 4.0,
				vz: Math.sin(angle) * speed,
				rotSpeedX: (Math.random() - 0.5) * 12,
				rotSpeedY: (Math.random() - 0.5) * 12,
				rotSpeedZ: (Math.random() - 0.5) * 12,
				wobblePhase: Math.random() * Math.PI * 2,
				life: 1.0
			};
			confettiGroup.add(mesh);
			celebrationParticles.push(mesh);
		}
	}

	function open3DGiftBox(giftBoxObj, onFinish) {
		if (!giftBoxObj || giftBoxObj.isOpening) {
			if (typeof onFinish === 'function') onFinish();
			return;
		}
		giftBoxObj.isOpening = true;

		AudioManager.playSnap(1.6);
		setTimeout(function () {
			AudioManager.play('greatJob', 0.95);
		}, 150);
		AudioManager.haptic(50);

		// Sparkle burst from box
		var boxPos = new THREE.Vector3();
		giftBoxObj.group.getWorldPosition(boxPos);
		createSparkleBurst(boxPos.x, boxPos.y + 0.4, boxPos.z, 28);

		var startTime = performance.now();
		var duration = 850;
		var initialLidY = giftBoxObj.lid.position.y;

		function animLid(now) {
			var elapsed = now - startTime;
			var progress = Math.min(1, elapsed / duration);

			var popY = Math.sin(progress * Math.PI) * 0.8;
			giftBoxObj.lid.position.y = initialLidY + popY + progress * 0.3;
			giftBoxObj.lid.rotation.x = -progress * 1.2;
			giftBoxObj.lid.rotation.z = Math.sin(progress * 8) * 0.3;

			var scale = 1 + Math.sin(progress * Math.PI) * 0.25;
			giftBoxObj.group.scale.set(scale, scale, scale);

			if (progress < 1) {
				requestAnimationFrame(animLid);
			} else {
				scene.remove(giftBoxObj.group);
				var idx = activeGiftBoxes.indexOf(giftBoxObj);
				if (idx !== -1) activeGiftBoxes.splice(idx, 1);

				showGiftUnlockModal(giftBoxObj.reward, onFinish);
			}
		}
		requestAnimationFrame(animLid);
	}

	function showGiftUnlockModal(reward, onDismiss) {
		var modal = document.getElementById('gift-box-modal');
		var titleEl = document.getElementById('reward-item-title');
		var nameEl = document.getElementById('reward-item-name');
		var descEl = document.getElementById('reward-item-desc');
		var showcaseEl = document.getElementById('reward-item-showcase');
		var btnAd = document.getElementById('btn-reward-watch-ad');
		var btnTry = document.getElementById('btn-reward-try');

		if (!modal) {
			if (typeof onDismiss === 'function') onDismiss();
			return;
		}

		if (reward.type === 'skin') {
			if (titleEl) titleEl.textContent = 'Tile Skin Discovered!';
			if (nameEl) nameEl.textContent = reward.name;
			if (descEl) descEl.textContent = reward.desc;
			if (showcaseEl) {
				showcaseEl.innerHTML = '';
				var preview = document.createElement('div');
				preview.className = 'reward-tile-preview-3d';
				var skin = reward.skin || TILE_SKINS[reward.id] || TILE_SKINS.classic;
				preview.style.background = skin.faceBase[0];
				preview.style.color = skin.textColor;
				preview.style.border = '2px solid ' + skin.borderColor;
				preview.innerHTML = '<span>A</span><span class="preview-score">1</span>';
				showcaseEl.appendChild(preview);
			}
		} else {
			if (titleEl) titleEl.textContent = 'Living Background Discovered!';
			if (nameEl) nameEl.textContent = reward.name;
			if (descEl) descEl.textContent = reward.desc;
			if (showcaseEl) {
				showcaseEl.innerHTML = '';
				var scCard = document.createElement('div');
				scCard.className = 'reward-scenery-preview-card';
				var sc = (global.WordscapesScenery && global.WordscapesScenery.getSceneries) ? global.WordscapesScenery.getSceneries()[reward.id] : null;
				scCard.style.background = sc ? sc.skyBottom : '#382045';
				scCard.innerHTML = '<span style="font-size:38px;">' + (sc ? sc.icon : reward.icon || '✨') + '</span>';
				showcaseEl.appendChild(scCard);
			}
		}

		modal.classList.add('show');

		if (btnAd) {
			btnAd.onclick = function () {
				modal.classList.remove('show');
				AdMobRewardService.showRewardAd(reward, function () {
					UnlockManager.unlockPermanent(reward.type, reward.id);
					showToast('🎉 LOCKED IN! You now own ' + reward.name + ' forever!');
					if (typeof onDismiss === 'function') onDismiss();
				}, function () {
					UnlockManager.startTrial(reward.type, reward.id);
					showToast('1-round trial activated: ' + reward.name + '!');
					if (typeof onDismiss === 'function') onDismiss();
				});
			};
		}

		if (btnTry) {
			btnTry.onclick = function () {
				modal.classList.remove('show');
				UnlockManager.startTrial(reward.type, reward.id);
				showToast('1-round trial activated: ' + reward.name + '!');
				if (typeof onDismiss === 'function') onDismiss();
			};
		}
	}

	// --------------------------------------------------------------------------
	// Level Loading & Tile Placement
	// --------------------------------------------------------------------------
	function loadLevel(levelIndex) {
		stopWinCelebration();
		dismissGhostTile();
		wordsSolvedCount = 0;
		var targetIndex = levelIndex % (window.WORD_CHAIN_LEVELS ? window.WORD_CHAIN_LEVELS.length : 30);
		UnlockManager.checkTrialExpiration(targetIndex);
		currentLevelIndex = targetIndex;
		var allLevels = window.WORD_CHAIN_LEVELS || [];
		currentLevelData = allLevels[currentLevelIndex] || {
			id: 1,
			words: [
				{ answer: 'TENNIS', scrambled: 'NENITS' },
				{ answer: 'MATCH', scrambled: 'CTMHA' },
				{ answer: 'POINT', scrambled: 'NOIPT' },
				{ answer: 'BLANK', scrambled: 'LANKB' },
				{ answer: 'PAGE', scrambled: 'EPGA' }
			]
		};

		currentWordIndex = 1; // Row 0 is revealed anchor, player solves Row 1+

		// Clear previous tiles from scene
		allTiles.forEach(function (tile) {
			scene.remove(tile.mesh);
		});
		allTiles = [];

		buildChainRacks(currentLevelData);

		// 1. Populate Row 0 with locked anchor word tiles (e.g. "TENNIS")
		var anchorWord = currentLevelData.words[0].answer;
		var row0Slots = chainSlots.filter(function (s) { return s.row === 0; });

		for (var i = 0; i < anchorWord.length; i++) {
			var letter = anchorWord[i];
			var slot = row0Slots[i];
			if (slot) {
				var tile = new Tile(letter, true); // Locked
				tile.mesh.position.copy(slot.worldPos);
				tile.targetPosition.copy(slot.worldPos);
				tile.currentSlot = slot;
				slot.tile = tile;
				scene.add(tile.mesh);
				allTiles.push(tile);
			}
		}

		// 2. Spawn scrambled tiles for Row 1 in staging tray
		spawnStagingTiles(currentWordIndex);

		updateActiveRowVisuals();
		if (global.WordscapesScenery && typeof global.WordscapesScenery.setSceneryForLevel === 'function') {
			global.WordscapesScenery.setSceneryForLevel(currentLevelIndex);
		}
		if (typeof SpeedometerManager !== 'undefined') {
			SpeedometerManager.startLevel(currentLevelIndex);
		}
	}

	/**
	 * Spawn the scrambled letters for the active word into the staging tray.
	 */
	function spawnStagingTiles(wordIdx) {
		// Clear tiles from staging slots
		stagingSlots.forEach(function (s) {
			if (s.tile) {
				var idx = allTiles.indexOf(s.tile);
				if (idx !== -1) allTiles.splice(idx, 1);
				scene.remove(s.tile.mesh);
				s.tile = null;
			}
		});

		var wordObj = currentLevelData.words[wordIdx];
		if (!wordObj) return;

		var letters = (wordObj.scrambled || wordObj.answer).split('');

		for (var i = 0; i < letters.length; i++) {
			var letter = letters[i];
			var slot = stagingSlots[i];
			if (slot) {
				var tile = new Tile(letter, false);

				// Fun cascading drop from above
				tile.mesh.position.set(slot.worldPos.x, slot.worldPos.y + 4.5 + i * 0.4, slot.worldPos.z);
				tile.targetPosition.copy(slot.worldPos);
				tile.currentSlot = slot;
				slot.tile = tile;

				scene.add(tile.mesh);
				allTiles.push(tile);
			}
		}

		updateSlotBrackets();
		AudioManager.play('tilehit', 0.8);
	}

	// --------------------------------------------------------------------------
	// Physical Manipulation & Drag Events
	// --------------------------------------------------------------------------
	function initInteraction() {
		raycaster = new THREE.Raycaster();
		pointer = new THREE.Vector2(-999, -999);
		dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.35);

		var dom = renderer.domElement;
		var pointerDownScreenPos = { x: 0, y: 0 };
		var pointerDownTime = 0;
		var pointerHasDragged = false;

		function getPointerPos(e) {
			var rect = dom.getBoundingClientRect();
			var clientX = e.touches ? e.touches[0].clientX : e.clientX;
			var clientY = e.touches ? e.touches[0].clientY : e.clientY;
			pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
			pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
		}

		// Pointer Down
		dom.addEventListener('pointerdown', function (e) {
			if (isRowShaking || isCelebratingWin || isComboPlaying) return;
			getPointerPos(e);
			raycaster.setFromCamera(pointer, camera);

			var clientX = e.touches ? e.touches[0].clientX : e.clientX;
			var clientY = e.touches ? e.touches[0].clientY : e.clientY;
			pointerDownScreenPos.x = clientX;
			pointerDownScreenPos.y = clientY;
			pointerDownTime = performance.now();
			pointerHasDragged = false;

			// Check tap directly on ghost tile
			if (ghostTileMesh) {
				var ghostHits = raycaster.intersectObject(ghostTileMesh);
				if (ghostHits.length > 0 && currentGhostSlot && currentGhostLetter) {
					var gSlot = currentGhostSlot;
					var gLetter = currentGhostLetter;
					dismissGhostTile();
					autoPlaceLetterTile(gLetter, gSlot);
					showToast('Placed "' + gLetter + '"!');
					return;
				}
			}

			// Test intersections against unlocked tiles
			var tileMeshes = allTiles.filter(function (t) { return !t.isLocked; }).map(function (t) { return t.mesh; });
			var intersects = raycaster.intersectObjects(tileMeshes);

			if (intersects.length > 0) {
				var hitMesh = intersects[0].object;
				var tile = hitMesh.userData.tile;

				if (tile && !tile.isLocked) {
					activeTile = tile;
					activeTile.isDragging = true;
					dom.style.cursor = 'grabbing';

					// Intersect with drag plane to calculate grab offset
					var hitPoint = new THREE.Vector3();
					raycaster.ray.intersectPlane(dragPlane, hitPoint);
					dragOffset.copy(tile.mesh.position).sub(hitPoint);
					prevDragPos.copy(tile.mesh.position);

					AudioManager.play('tilehit', 0.9);
					AudioManager.haptic(15);
				}
			}
		});

		// Pointer Move
		window.addEventListener('pointermove', function (e) {
			if (isRowShaking || isCelebratingWin) return;
			getPointerPos(e);

			if (activeTile) {
				var clientX = e.touches ? e.touches[0].clientX : e.clientX;
				var clientY = e.touches ? e.touches[0].clientY : e.clientY;
				if (Math.hypot(clientX - pointerDownScreenPos.x, clientY - pointerDownScreenPos.y) > 6) {
					pointerHasDragged = true;
				}

				raycaster.setFromCamera(pointer, camera);
				var hitPoint = new THREE.Vector3();

				if (raycaster.ray.intersectPlane(dragPlane, hitPoint)) {
					var newPos = hitPoint.add(dragOffset);
					activeTile.setTarget(newPos.x, activeTile.targetPosition.y, newPos.z);

					// Dynamic physical tilt from drag velocity
					dragVelocity.copy(newPos).sub(prevDragPos);
					prevDragPos.copy(newPos);

					activeTile.targetRotation.z = THREE.MathUtils.clamp(-dragVelocity.x * 0.45, -0.28, 0.28);
					activeTile.targetRotation.x = THREE.MathUtils.clamp(dragVelocity.z * 0.45, -0.28, 0.28);

					// Real-time hover slot snap indicator
					var validSlots = chainSlots.filter(function (s) { return s.row === currentWordIndex; }).concat(stagingSlots);
					var hoverSlot = null;
					var hoverDist = 1.85;

					for (var i = 0; i < validSlots.length; i++) {
						var s = validSlots[i];
						var dx = activeTile.mesh.position.x - s.worldPos.x;
						var dz = activeTile.mesh.position.z - s.worldPos.z;
						var distXZ = Math.sqrt(dx * dx + dz * dz);
						if (distXZ < hoverDist) {
							hoverDist = distXZ;
							hoverSlot = s;
						}
					}

					if (hoverSlot && hoverSlotHighlightMesh) {
						hoverSlotHighlightMesh.visible = true;
						hoverSlotHighlightMesh.position.set(hoverSlot.worldPos.x, hoverSlot.worldPos.y + 0.02, hoverSlot.worldPos.z);
					} else if (hoverSlotHighlightMesh) {
						hoverSlotHighlightMesh.visible = false;
					}
				}
			} else {
				// Hover highlight check
				raycaster.setFromCamera(pointer, camera);
				var tileMeshes = allTiles.filter(function (t) { return !t.isLocked; }).map(function (t) { return t.mesh; });
				var intersects = raycaster.intersectObjects(tileMeshes);
				dom.style.cursor = intersects.length > 0 ? 'grab' : 'default';
			}
		});

		// Pointer Up
		window.addEventListener('pointerup', function (e) {
			if (hoverSlotHighlightMesh) {
				hoverSlotHighlightMesh.visible = false;
			}

			if (!activeTile) return;

			var tile = activeTile;
			activeTile = null;
			tile.isDragging = false;
			dom.style.cursor = 'default';
			tile.targetRotation.set(0, 0, 0);

			var elapsed = performance.now() - pointerDownTime;
			var isTap = (!pointerHasDragged && elapsed < 320);

			// 1. TAP-TO-PLACE: Instant effortless tap manipulation
			if (isTap) {
				if (tile.currentSlot && tile.currentSlot.type === 'staging') {
					// Tap on staging tile: fly to first empty slot of active row
					var targetSlot = chainSlots.find(function (s) {
						return s.row === currentWordIndex && s.tile === null;
					});

					if (targetSlot) {
						if (currentGhostSlot && targetSlot === currentGhostSlot) {
							dismissGhostTile();
						}
						tile.currentSlot.tile = null;
						targetSlot.tile = tile;
						tile.currentSlot = targetSlot;
						tile.setTarget(targetSlot.worldPos.x, targetSlot.worldPos.y, targetSlot.worldPos.z);
						tile.startSnapFx();
						AudioManager.playSnap(1.35);
						updateSlotBrackets();
						checkWordCompletion();
						return;
					}
				} else if (tile.currentSlot && tile.currentSlot.type === 'chain' && tile.currentSlot.row === currentWordIndex) {
					// Tap on active row tile: fly back to first empty staging slot
					var targetSlot = stagingSlots.find(function (s) {
						return s.tile === null;
					});

					if (targetSlot) {
						if (currentGhostSlot && targetSlot === currentGhostSlot) {
							dismissGhostTile();
						}
						tile.currentSlot.tile = null;
						targetSlot.tile = tile;
						tile.currentSlot = targetSlot;
						tile.setTarget(targetSlot.worldPos.x, targetSlot.worldPos.y, targetSlot.worldPos.z);
						tile.startSnapFx();
						AudioManager.playSnap(1.1);
						updateSlotBrackets();
						return;
					}
				}
			}

			// 2. DRAG-AND-DROP: Generous 2D horizontal (X-Z) snap detection
			var validSlots = chainSlots.filter(function (s) { return s.row === currentWordIndex; }).concat(stagingSlots);
			var bestSlot = null;
			var bestDist = 1.85; // Generous horizontal snap threshold

			for (var i = 0; i < validSlots.length; i++) {
				var slot = validSlots[i];
				var dx = tile.mesh.position.x - slot.worldPos.x;
				var dz = tile.mesh.position.z - slot.worldPos.z;
				var distXZ = Math.sqrt(dx * dx + dz * dz);
				if (distXZ < bestDist) {
					bestDist = distXZ;
					bestSlot = slot;
				}
			}

			if (bestSlot) {
				if (currentGhostSlot && bestSlot === currentGhostSlot) {
					dismissGhostTile();
				}
				// If slot is occupied by another tile, swap them!
				if (bestSlot.tile && bestSlot.tile !== tile) {
					var otherTile = bestSlot.tile;
					var oldSlot = tile.currentSlot;

					if (oldSlot) {
						oldSlot.tile = otherTile;
						otherTile.currentSlot = oldSlot;
						otherTile.setTarget(oldSlot.worldPos.x, oldSlot.worldPos.y, oldSlot.worldPos.z);
					} else {
						var emptyStaging = stagingSlots.find(function (s) { return s.tile === null; });
						if (emptyStaging) {
							emptyStaging.tile = otherTile;
							otherTile.currentSlot = emptyStaging;
							otherTile.setTarget(emptyStaging.worldPos.x, emptyStaging.worldPos.y, emptyStaging.worldPos.z);
						} else {
							otherTile.currentSlot = null;
						}
					}
				} else if (tile.currentSlot && tile.currentSlot !== bestSlot) {
					tile.currentSlot.tile = null;
				}

				bestSlot.tile = tile;
				tile.currentSlot = bestSlot;
				tile.setTarget(bestSlot.worldPos.x, bestSlot.worldPos.y, bestSlot.worldPos.z);
				tile.startSnapFx();
				AudioManager.playSnap(1.35);

				updateSlotBrackets();
				checkWordCompletion();
			} else {
				// Revert to current slot
				if (tile.currentSlot) {
					tile.setTarget(tile.currentSlot.worldPos.x, tile.currentSlot.worldPos.y, tile.currentSlot.worldPos.z);
				}
				AudioManager.play('thud', 0.5);
			}
		});
	}

	// --------------------------------------------------------------------------
	// Word Chain Logic & Win Detection
	// --------------------------------------------------------------------------
	/**
	 * Winning combination sequential light & jump:
	 * Word 1 lights up & jumps for 0.20s,
	 * then 0.10s pause,
	 * then Word 2 lights up & jumps for 0.20s,
	 * then after 0.20s both go dark again.
	 * Allows players to mentally verbalize the chain (e.g. "TENNIS ... MATCH!").
	 */
	function playChainComboSequence(row1Idx, row2Idx, onComplete) {
		isComboPlaying = true;
		var row1 = chainRowData[row1Idx];
		var row2 = chainRowData[row2Idx];

		var tiles1 = row1 ? row1.slots.map(function (s) { return s.tile; }).filter(Boolean) : [];
		var tiles2 = row2 ? row2.slots.map(function (s) { return s.tile; }).filter(Boolean) : [];

		// 1. Light up & jump Word 1 for 0.20s
		tiles1.forEach(function (t) {
			t.setLit(true);
			t.startHop(0.20, 0.65);
		});
		if (row1 && row1.lipMesh) row1.lipMesh.material = materials.yellowTrayActive;
		AudioManager.playSnap(1.4);
		AudioManager.haptic(25);

		// 2. After 0.20s, Word 1 finishes jump and unlights (0.10s pause)
		setTimeout(function () {
			tiles1.forEach(function (t) {
				t.setLit(false);
			});
			if (row1 && row1.lipMesh) row1.lipMesh.material = materials.yellowTraySolved;

			// 3. After 0.10s pause, Word 2 lights up & jumps for 0.20s
			setTimeout(function () {
				tiles2.forEach(function (t) {
					t.setLit(true);
					t.startHop(0.20, 0.65);
				});
				if (row2 && row2.lipMesh) row2.lipMesh.material = materials.yellowTrayActive;
				AudioManager.playSnap(1.55);
				AudioManager.haptic(30);

				// 4. After 0.20s, Word 2 finishes jump and both go dark again
				setTimeout(function () {
					tiles2.forEach(function (t) {
						t.setLit(false);
					});
					if (row2 && row2.lipMesh) row2.lipMesh.material = materials.yellowTraySolved;

					// 5. After 0.20s resting period, proceed to next row or win
					setTimeout(function () {
						isComboPlaying = false;
						if (typeof onComplete === 'function') {
							onComplete();
						}
					}, 200);

				}, 200); // 0.20s lighting of word 2

			}, 100); // 0.10s pause

		}, 200); // 0.20s lighting of word 1
	}

	function checkWordCompletion() {
		var activeSlots = chainSlots.filter(function (s) { return s.row === currentWordIndex; });
		var allFilled = activeSlots.every(function (s) { return s.tile !== null; });

		if (!allFilled) return;

		var spelled = activeSlots.map(function (s) { return s.tile.letter; }).join('');
		var targetWord = currentLevelData.words[currentWordIndex].answer;

		if (spelled === targetWord) {
			dismissGhostTile();
			wordsSolvedCount++;

			if (typeof SpeedometerManager !== 'undefined') {
				SpeedometerManager.onWordSolved(currentWordIndex, currentLevelData.words.length);
			}

			var isLevelComplete = (currentWordIndex + 1 >= currentLevelData.words.length);

			if (isLevelComplete) {
				// Final word solved: win celebration will play greatJob!
				AudioManager.playSnap(1.6);
			} else {
				// Intermediate word solved: crisp confirmation snap
				AudioManager.playSnap(1.45);
				if (wordsSolvedCount % 4 === 1) {
					setTimeout(function () {
						AudioManager.play('affirmation', 0.6);
					}, 200);
				}
			}
			AudioManager.haptic(35);

			// Lock row tiles immediately
			activeSlots.forEach(function (s) {
				s.tile.isLocked = true;
				s.tile.mesh.material[0] = materials.tileLocked;
				s.tile.mesh.material[1] = materials.tileLocked;
				s.tile.mesh.material[4] = materials.tileLocked;
				s.tile.mesh.material[5] = materials.tileLocked;
			});

			var word1Str = currentLevelData.words[currentWordIndex - 1].answer;
			showToast(word1Str + ' ' + targetWord + '!');

			// Trigger sequential winning combination cadence:
			// Word 1 lights & jumps (0.2s) -> pause (0.1s) -> Word 2 lights & jumps (0.2s) -> both dark (0.2s)
			var word1Row = currentWordIndex - 1;
			var word2Row = currentWordIndex;

			playChainComboSequence(word1Row, word2Row, function () {
				function proceedToNextStep() {
					currentWordIndex++;
					updateActiveRowVisuals();

					if (currentWordIndex >= currentLevelData.words.length) {
						// LEVEL COMPLETE!
						if (typeof SpeedometerManager !== 'undefined') {
							SpeedometerManager.onLevelCompleted(currentLevelIndex);
						}
						if (activeRowIndicatorGroup) activeRowIndicatorGroup.visible = false;
						setTimeout(function () {
							triggerWinCelebration();
						}, 250);
					} else {
						// Spawn next word scrambled tiles
						spawnStagingTiles(currentWordIndex);
						updateActiveRowVisuals();
					}
				}

				// Check if there is an active gift box reward on this solved row
				var foundGb = activeGiftBoxes.find(function (g) { return g.rowIdx === word2Row; });
				if (foundGb) {
					open3DGiftBox(foundGb, function () {
						proceedToNextStep();
					});
				} else {
					proceedToNextStep();
				}
			});
		} else {
			// INCORRECT WORD!
			isRowShaking = true;
			AudioManager.play('wrong', 0.85);
			AudioManager.haptic(35);
			setTimeout(function () { AudioManager.haptic(35); }, 130);
			showToast('Not quite! Letters returning...');

			// Trigger horizontal "No-No" headshake on all tiles in this active row
			activeSlots.forEach(function (s) {
				if (s.tile) {
					s.tile.startShake(0.48);
				}
			});

			// Automatically return non-locked letters back to letter tray after headshake!
			setTimeout(function () {
				recallActiveRow();
				isRowShaking = false;
			}, 520);
		}
	}

	// --------------------------------------------------------------------------
	// Helper Actions (Shuffle, Recall)
	// --------------------------------------------------------------------------
	function shuffleStaging() {
		dismissGhostTile();
		var stagingTiles = stagingSlots.map(function (s) { return s.tile; }).filter(Boolean);
		if (stagingTiles.length <= 1) return;

		// Fisher-Yates shuffle
		for (var i = stagingTiles.length - 1; i > 0; i--) {
			var j = Math.floor(Math.random() * (i + 1));
			var temp = stagingTiles[i];
			stagingTiles[i] = stagingTiles[j];
			stagingTiles[j] = temp;
		}

		stagingTiles.forEach(function (tile, idx) {
			var slot = stagingSlots[idx];
			slot.tile = tile;
			tile.currentSlot = slot;
			tile.setTarget(slot.worldPos.x, slot.worldPos.y + 0.8, slot.worldPos.z);
		});

		updateSlotBrackets();
		AudioManager.play('tilehit', 0.8);
	}

	function recallActiveRow() {
		dismissGhostTile();
		var activeSlots = chainSlots.filter(function (s) { return s.row === currentWordIndex; });
		var emptyStagingSlots = stagingSlots.filter(function (s) { return s.tile === null; });

		activeSlots.forEach(function (slot) {
			if (slot.tile && !slot.tile.isLocked) {
				var targetSlot = emptyStagingSlots.shift();
				if (targetSlot) {
					var tile = slot.tile;
					slot.tile = null;
					targetSlot.tile = tile;
					tile.currentSlot = targetSlot;
					tile.setTarget(targetSlot.worldPos.x, targetSlot.worldPos.y, targetSlot.worldPos.z);
				}
			}
		});

		updateSlotBrackets();
		AudioManager.play('tilehit', 0.8);
	}

	function dismissGhostTile() {
		if (ghostTileMesh) {
			scene.remove(ghostTileMesh);
			if (ghostTileMesh.geometry) ghostTileMesh.geometry.dispose();
			if (Array.isArray(ghostTileMesh.material)) {
				ghostTileMesh.material.forEach(function (m) { if (m) m.dispose(); });
			} else if (ghostTileMesh.material) {
				ghostTileMesh.material.dispose();
			}
			ghostTileMesh = null;
			currentGhostSlot = null;
			currentGhostLetter = null;
		}
	}

	function createGhostTile(letter, slot) {
		dismissGhostTile();

		var geom = new THREE.BoxGeometry(1.04, 0.28, 1.04);
		var letterTex = TextureManager.getLetterTexture(letter);
		var ghostFaceMat = new THREE.MeshStandardMaterial({
			map: letterTex,
			transparent: true,
			opacity: 0.72,
			roughness: 0.3,
			metalness: 0.05,
			emissive: new THREE.Color(0xffe082),
			emissiveIntensity: 0.45
		});
		var ghostSideMat = new THREE.MeshStandardMaterial({
			color: 0xffd54f,
			transparent: true,
			opacity: 0.45,
			roughness: 0.5
		});

		var mats = [
			ghostSideMat,
			ghostSideMat,
			ghostFaceMat,
			materials.slotFelt,
			ghostSideMat,
			ghostSideMat
		];

		ghostTileMesh = new THREE.Mesh(geom, mats);
		ghostTileMesh.position.set(slot.worldPos.x, slot.worldPos.y + 0.16, slot.worldPos.z);
		ghostTileMesh.userData.isGhost = true;
		ghostTileMesh.userData.letter = letter;
		ghostTileMesh.userData.slot = slot;

		currentGhostSlot = slot;
		currentGhostLetter = letter;
		scene.add(ghostTileMesh);
	}

	function autoPlaceLetterTile(requiredLetter, targetSlot) {
		var foundTile = null;
		var sourceStagingSlot = stagingSlots.find(function (s) {
			return s.tile && !s.tile.isLocked && s.tile.letter === requiredLetter;
		});

		if (sourceStagingSlot) {
			foundTile = sourceStagingSlot.tile;
			sourceStagingSlot.tile = null;
		} else {
			var activeSlots = chainSlots.filter(function (s) { return s.row === currentWordIndex; });
			for (var j = 0; j < activeSlots.length; j++) {
				var otherSlot = activeSlots[j];
				if (otherSlot !== targetSlot && otherSlot.tile && !otherSlot.tile.isLocked && otherSlot.tile.letter === requiredLetter) {
					foundTile = otherSlot.tile;
					otherSlot.tile = null;
					break;
				}
			}
		}

		if (!foundTile) {
			showToast('Letter "' + requiredLetter + '" not found in tray!');
			return false;
		}

		// If targetSlot already has a wrong tile, return it to empty staging slot
		if (targetSlot.tile && targetSlot.tile !== foundTile) {
			var wrongTile = targetSlot.tile;
			var emptyStaging = stagingSlots.find(function (s) { return s.tile === null; });
			if (emptyStaging) {
				targetSlot.tile = null;
				emptyStaging.tile = wrongTile;
				wrongTile.currentSlot = emptyStaging;
				wrongTile.setTarget(emptyStaging.worldPos.x, emptyStaging.worldPos.y + 0.8, emptyStaging.worldPos.z);
			}
		}

		targetSlot.tile = foundTile;
		foundTile.currentSlot = targetSlot;
		if (typeof foundTile.startWave === 'function') {
			foundTile.startWave(0);
		}
		foundTile.startSnapFx();
		foundTile.setTarget(targetSlot.worldPos.x, targetSlot.worldPos.y, targetSlot.worldPos.z);

		updateSlotBrackets();
		AudioManager.playSnap(1.35);
		checkWordCompletion();
		return true;
	}

	function provideHint() {
		if (!currentLevelData || !currentLevelData.words) return;
		var targetWordObj = currentLevelData.words[currentWordIndex];
		if (!targetWordObj) return;
		var targetWord = targetWordObj.answer.toUpperCase();

		var activeSlots = chainSlots.filter(function (s) { return s.row === currentWordIndex; });
		if (!activeSlots || activeSlots.length === 0) return;

		// 1. Find the first slot in the active row that is empty or has the wrong letter
		var targetSlotIdx = -1;
		for (var i = 0; i < targetWord.length; i++) {
			var slot = activeSlots[i];
			var neededLetter = targetWord[i];
			if (!slot.tile || slot.tile.letter !== neededLetter) {
				targetSlotIdx = i;
				break;
			}
		}

		if (targetSlotIdx === -1) {
			showToast('Row is already complete!');
			return;
		}

		var targetSlot = activeSlots[targetSlotIdx];
		var requiredLetter = targetWord[targetSlotIdx];

		// If a ghost tile is already showing for this slot, pressing hint again auto-places it!
		if (ghostTileMesh && currentGhostSlot === targetSlot && currentGhostLetter === requiredLetter) {
			dismissGhostTile();
			autoPlaceLetterTile(requiredLetter, targetSlot);
			showToast('Placed "' + requiredLetter + '"!');
			return;
		}

		// Otherwise: create and show the ghost tile on the top board
		createGhostTile(requiredLetter, targetSlot);

		// Trigger a wave jump on the matching tile in the staging tray so player easily spots it
		var stagingTile = allTiles.find(function (t) {
			return !t.isLocked && t.letter === requiredLetter && t.currentSlot && t.currentSlot.type === 'staging';
		});
		if (stagingTile && typeof stagingTile.startWave === 'function') {
			stagingTile.startWave(0);
		}

		AudioManager.play('tilehit', 0.9);
		AudioManager.haptic(25);
		showToast('Ghost tile: Look for "' + requiredLetter + '"!');
	}

	function showThemeModal() {
		var modal = document.getElementById('theme-modal');
		if (modal) {
			modal.classList.add('show');
			updateThemeModalUI();
		}
	}

	function hideThemeModal() {
		var modal = document.getElementById('theme-modal');
		if (modal) modal.classList.remove('show');
	}

	function updateThemeModalUI() {
		var currentSkin = TextureManager.getCurrentSkin ? TextureManager.getCurrentSkin() : 'classic';
		var currentScenery = (global.WordscapesScenery && global.WordscapesScenery.getCurrent) ? global.WordscapesScenery.getCurrent() : 'rain';

		document.querySelectorAll('.skin-opt').forEach(function (btn) {
			var skinId = btn.getAttribute('data-skin');
			if (skinId === currentSkin) {
				btn.classList.add('active');
			} else {
				btn.classList.remove('active');
			}

			// Customization Badges: ✓ OWNED, ⏳ TRIAL, 🔒 WATCH AD
			var oldBadge = btn.querySelector('.item-badge-status');
			if (oldBadge) oldBadge.remove();

			var badge = document.createElement('span');
			badge.className = 'item-badge-status';
			if (UnlockManager.isOwned('skin', skinId)) {
				badge.classList.add('item-badge-owned');
				badge.textContent = '✓ OWNED';
			} else if (UnlockManager.isTrial('skin', skinId)) {
				badge.classList.add('item-badge-trial');
				badge.textContent = '⏳ TRIAL';
			} else {
				badge.classList.add('item-badge-locked');
				badge.textContent = '🔒 WATCH AD';
			}
			btn.appendChild(badge);
		});

		document.querySelectorAll('.scenery-opt').forEach(function (btn) {
			var scId = btn.getAttribute('data-scenery');
			if (scId === currentScenery) {
				btn.classList.add('active');
			} else {
				btn.classList.remove('active');
			}

			// Customization Badges: ✓ OWNED, ⏳ TRIAL, 🔒 WATCH AD
			var oldBadge = btn.querySelector('.item-badge-status');
			if (oldBadge) oldBadge.remove();

			var badge = document.createElement('span');
			badge.className = 'item-badge-status';
			if (UnlockManager.isOwned('scenery', scId)) {
				badge.classList.add('item-badge-owned');
				badge.textContent = '✓ OWNED';
			} else if (UnlockManager.isTrial('scenery', scId)) {
				badge.classList.add('item-badge-trial');
				badge.textContent = '⏳ TRIAL';
			} else {
				badge.classList.add('item-badge-locked');
				badge.textContent = '🔒 WATCH AD';
			}
			btn.appendChild(badge);
		});
	}

	// --------------------------------------------------------------------------
	// UI & HUD
	// --------------------------------------------------------------------------
	function updateHUD() {
		var levelNumEl = document.getElementById('hud-level-num');
		if (levelNumEl) levelNumEl.textContent = (currentLevelIndex + 1);

		var settingsLvlEl = document.getElementById('settings-level-num');
		if (settingsLvlEl) settingsLvlEl.textContent = (currentLevelIndex + 1);

		var targetBadgeEl = document.getElementById('hud-target-badge');
		if (targetBadgeEl && currentLevelData && currentLevelData.words) {
			var totalWords = currentLevelData.words.length;
			targetBadgeEl.textContent = '▶ ROW ' + (currentWordIndex + 1) + ' OF ' + totalWords + ' ACTIVE';
		}

		var clueEl = document.getElementById('hud-clue-text');
		if (clueEl && currentLevelData && currentLevelData.words) {
			var prevWord = currentLevelData.words[currentWordIndex - 1];
			var targetWord = currentLevelData.words[currentWordIndex];
			if (prevWord && targetWord) {
				clueEl.textContent = 'Active Row ' + (currentWordIndex + 1) + ': Chain after "' + prevWord.answer + '" (' + targetWord.answer.length + ' letters)';
			} else {
				clueEl.textContent = '';
			}
		}

		// Update dots
		var progressContainer = document.getElementById('chain-progress-dots');
		if (progressContainer && currentLevelData && currentLevelData.words) {
			progressContainer.innerHTML = '';
			currentLevelData.words.forEach(function (w, idx) {
				var dot = document.createElement('div');
				dot.className = 'chain-dot';
				if (idx < currentWordIndex) dot.classList.add('completed');
				else if (idx === currentWordIndex) dot.classList.add('active');
				progressContainer.appendChild(dot);
			});
		}
	}

	var toastTimeout = null;
	function showToast(msg) {
		var toast = document.getElementById('toast-banner');
		var text = document.getElementById('toast-text');
		if (!toast || !text) return;

		text.textContent = msg;
		toast.classList.add('show');
		if (toastTimeout) clearTimeout(toastTimeout);
		toastTimeout = setTimeout(function () {
			toast.classList.remove('show');
		}, 1500);
	}

	// --------------------------------------------------------------------------
	// Win Celebration System (Mexican Wave, 3D Confetti & Stars, Victory Tiles)
	// --------------------------------------------------------------------------
	var WIN_MESSAGES = [
		{ r1: 'WELL', r2: 'DONE' },
		{ r1: 'EPIC', r2: 'WIN' },
		{ r1: 'PURE', r2: 'SKILL' },
		{ r1: 'TOP',  r2: 'TIER' },
		{ r1: 'GREAT', r2: 'WORK' },
		{ r1: 'NICE', r2: 'JOB' },
		{ r1: 'SOLID', r2: 'RUN' },
		{ r1: 'GOOD', r2: 'PLAY' }
	];

	function createStarShape(outerRadius, innerRadius) {
		var shape = new THREE.Shape();
		var points = 5;
		for (var i = 0; i < points * 2; i++) {
			var r = (i % 2 === 0) ? outerRadius : innerRadius;
			var angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
			var x = Math.cos(angle) * r;
			var y = Math.sin(angle) * r;
			if (i === 0) shape.moveTo(x, y);
			else shape.lineTo(x, y);
		}
		shape.closePath();
		return shape;
	}

	function resetCelebrationParticle(mesh, initialSpread) {
		var angle = Math.random() * Math.PI * 2;
		var radius = Math.random() * 3.8;
		var originX = Math.cos(angle) * radius;
		var originZ = Math.sin(angle) * radius * 0.7 - 0.5;

		mesh.position.set(
			originX,
			initialSpread ? (Math.random() * 5.0 - 0.5) : -0.2,
			originZ
		);

		mesh.userData.vx = (Math.random() - 0.5) * 4.6;
		mesh.userData.vy = Math.random() * 8.0 + 5.5; // Explosive upward burst
		mesh.userData.vz = (Math.random() - 0.5) * 3.2;
		mesh.userData.rotSpeedX = (Math.random() - 0.5) * 10.0;
		mesh.userData.rotSpeedY = (Math.random() - 0.5) * 10.0;
		mesh.userData.rotSpeedZ = (Math.random() - 0.5) * 10.0;
		mesh.userData.wobblePhase = Math.random() * Math.PI * 2;

		var s = Math.random() * 0.4 + 0.8;
		mesh.scale.set(s, s, s);
	}

	function initCelebrationParticles() {
		if (confettiGroup) {
			scene.remove(confettiGroup);
			confettiGroup = null;
		}
		confettiGroup = new THREE.Group();
		scene.add(confettiGroup);
		celebrationParticles = [];

		var confettiColors = [
			0xfbbf24, // Gold
			0x10b981, // Emerald
			0xef4444, // Crimson
			0x06b6d4, // Cyan
			0x8b5cf6, // Violet
			0xf97316, // Sunset Orange
			0xec4899, // Hot Pink
			0xffffff  // Sparkle White
		];

		// 1. Confetti Flakes (140 pieces)
		var confettiGeom = new THREE.PlaneGeometry(0.24, 0.36);
		for (var i = 0; i < 140; i++) {
			var color = confettiColors[i % confettiColors.length];
			var mat = new THREE.MeshBasicMaterial({
				color: color,
				side: THREE.DoubleSide
			});
			var mesh = new THREE.Mesh(confettiGeom, mat);
			resetCelebrationParticle(mesh, true);
			confettiGroup.add(mesh);
			celebrationParticles.push(mesh);
		}

		// 2. 3D Golden Stars (35 pieces)
		var starShape = createStarShape(0.28, 0.13);
		var starGeom = new THREE.ShapeGeometry(starShape);
		var starMat = new THREE.MeshStandardMaterial({
			color: 0xffd700,
			emissive: 0xffb700,
			emissiveIntensity: 0.5,
			roughness: 0.28,
			metalness: 0.65,
			side: THREE.DoubleSide
		});

		for (var s = 0; s < 35; s++) {
			var starMesh = new THREE.Mesh(starGeom, starMat);
			resetCelebrationParticle(starMesh, true);
			confettiGroup.add(starMesh);
			celebrationParticles.push(starMesh);
		}
	}

	function updateCelebrationParticles(dt, now) {
		if (!confettiGroup || celebrationParticles.length === 0) return;

		for (var i = celebrationParticles.length - 1; i >= 0; i--) {
			var p = celebrationParticles[i];
			var u = p.userData;
			if (!u) continue;

			// One-shot sparkle burst particles from gift unboxing
			if (typeof u.life !== 'undefined') {
				u.life -= dt * 1.25;
				u.vy -= 9.8 * dt;
				p.position.x += u.vx * dt;
				p.position.y += u.vy * dt;
				p.position.z += u.vz * dt;
				p.rotation.x += u.rotSpeedX * dt;
				p.rotation.y += u.rotSpeedY * dt;
				var s = Math.max(0.001, u.life);
				p.scale.set(s, s, s);

				if (u.life <= 0) {
					confettiGroup.remove(p);
					if (p.geometry) p.geometry.dispose();
					celebrationParticles.splice(i, 1);
				}
				continue;
			}

			// Continuous win celebration confetti
			if (!isCelebratingWin) continue;

			// Gravity & aerodynamic turbulence
			u.vy -= 10.5 * dt;
			p.position.x += u.vx * dt + Math.sin(now * 0.004 + u.wobblePhase) * 0.025;
			p.position.y += u.vy * dt;
			p.position.z += u.vz * dt;

			// 3D tumbling rotation
			p.rotation.x += u.rotSpeedX * dt;
			p.rotation.y += u.rotSpeedY * dt;
			p.rotation.z += u.rotSpeedZ * dt;

			// Recycle falling particles into the fountain
			if (p.position.y < -3.8) {
				resetCelebrationParticle(p, false);
			}
		}
	}

	function spawnVictoryTiles() {
		// Pick random celebratory message from GameSalad SpawnMessages
		var pair = WIN_MESSAGES[Math.floor(Math.random() * WIN_MESSAGES.length)];
		var words = [pair.r1, pair.r2];

		// Clear previous victory tiles
		victoryMessageTiles.forEach(function (t) {
			scene.remove(t.mesh);
			var idx = allTiles.indexOf(t);
			if (idx !== -1) allTiles.splice(idx, 1);
			if (t.mesh.geometry) t.mesh.geometry.dispose();
		});
		victoryMessageTiles = [];

		var spacingX = 1.16;
		var rowZPositions = [4.7, 6.1];

		words.forEach(function (word, rIdx) {
			var wordLen = word.length;
			var startX = -((wordLen - 1) * spacingX) * 0.5;
			var targetZ = rowZPositions[rIdx];

			for (var c = 0; c < wordLen; c++) {
				var letter = word[c];
				var tile = new Tile(letter, true); // Golden locked victory tile

				var targetX = startX + c * spacingX;
				var targetY = 0.35;

				// Spawn high in the sky and drop in with bouncy spring landing!
				tile.mesh.position.set(targetX, 4.8 + (rIdx * 4 + c) * 0.3, targetZ);
				tile.targetPosition.set(targetX, targetY, targetZ);

				// Start with Domino wave jump
				tile.startWave((rIdx * 4 + c) * 0.08);

				scene.add(tile.mesh);
				victoryMessageTiles.push(tile);
				allTiles.push(tile);
			}
		});

		showToast(pair.r1 + ' ' + pair.r2 + '!');
	}

	function triggerMexicanWavePass() {
		// Sequential cascade across every row and every column of the whole board
		for (var r = 0; r < chainRowData.length; r++) {
			var rowInfo = chainRowData[r];
			for (var c = 0; c < rowInfo.slots.length; c++) {
				var slot = rowInfo.slots[c];
				if (slot && slot.tile) {
					var delay = r * 0.12 + c * 0.055;
					slot.tile.startWave(delay);
				}
			}
		}

		// Victory message tiles wave in unison
		victoryMessageTiles.forEach(function (tile, idx) {
			tile.startWave(chainRowData.length * 0.12 + idx * 0.07);
		});
	}

	function startMexicanWave() {
		triggerMexicanWavePass();

		if (mexicanWaveInterval) clearInterval(mexicanWaveInterval);
		mexicanWaveInterval = setInterval(function () {
			if (isCelebratingWin) {
				triggerMexicanWavePass();
			} else {
				clearInterval(mexicanWaveInterval);
			}
		}, 2400);
	}

	function triggerWinCelebration() {
		isCelebratingWin = true;
		dismissGhostTile();

		// Hide active row chevrons, staging tray, and bottom buttons during celebration
		if (activeRowIndicatorGroup) activeRowIndicatorGroup.visible = false;
		if (stagingTrayGroup) stagingTrayGroup.visible = false;
		stagingSlots.forEach(function (s) {
			if (s.tile) s.tile.mesh.visible = false;
		});

		var hudBottom = document.getElementById('hud-bottom');
		if (hudBottom) hudBottom.style.display = 'none';

		// 1. Spurt Confetti & 3D Stars
		initCelebrationParticles();

		// 2. Spawn GameSalad Victory Message written in homely tiles
		spawnVictoryTiles();

		// 3. Start Board Mexican Wave
		startMexicanWave();

		// 4. Play grand completion sound & celebratory haptics
		AudioManager.play('greatJob', 1.0);
		AudioManager.haptic(50);
		setTimeout(function () { AudioManager.haptic(35); }, 200);

		// 5. Show 3D-styled NEXT arrow button on the right edge
		var btnNext = document.getElementById('btn-floating-next');
		if (btnNext) btnNext.classList.add('show');
	}

	function stopWinCelebration() {
		isCelebratingWin = false;
		if (mexicanWaveInterval) {
			clearInterval(mexicanWaveInterval);
			mexicanWaveInterval = null;
		}

		var btnNext = document.getElementById('btn-floating-next');
		if (btnNext) btnNext.classList.remove('show');

		var winSpeedCard = document.getElementById('win-speed-card');
		if (winSpeedCard) winSpeedCard.classList.remove('show');

		if (stagingTrayGroup) stagingTrayGroup.visible = true;
		stagingSlots.forEach(function (s) {
			if (s.tile) s.tile.mesh.visible = true;
		});

		var hudBottom = document.getElementById('hud-bottom');
		if (hudBottom) hudBottom.style.display = 'flex';

		if (confettiGroup) {
			scene.remove(confettiGroup);
			celebrationParticles.forEach(function (p) {
				if (p.geometry) p.geometry.dispose();
				if (p.material) p.material.dispose();
			});
			celebrationParticles = [];
			confettiGroup = null;
		}

		victoryMessageTiles.forEach(function (t) {
			scene.remove(t.mesh);
			var idx = allTiles.indexOf(t);
			if (idx !== -1) allTiles.splice(idx, 1);
			if (t.mesh.geometry) t.mesh.geometry.dispose();
		});
		victoryMessageTiles = [];
	}

	function showWinModal() {
		triggerWinCelebration();
	}

	function hideWinModal() {
		stopWinCelebration();
	}

	// --------------------------------------------------------------------------
	// Responsive Camera Framing & Animation Loop
	// --------------------------------------------------------------------------
	function updateCameraFraming() {
		if (!camera || !renderer) return;

		var aspect = window.innerWidth / window.innerHeight;
		camera.aspect = aspect;

		if (aspect < 0.65) {
			// Mobile portrait (phones: 390x844, 412x915, etc. aspect ~0.45-0.60)
			// Widest racks and staging tray fill 90-93% of screen width with comfortable edge clearance!
			var reqWidth = 11.2;
			var fov = 46;
			var fovRad = THREE.MathUtils.degToRad(fov);
			var halfFovTan = Math.tan(fovRad * 0.5);
			var reqDist = (reqWidth / aspect) / (2 * halfFovTan);

			camera.fov = fov;
			camera.position.set(0, reqDist * 0.96, 1.8);
			camera.lookAt(0, 0, -0.2);
		} else if (aspect < 1.0) {
			// Tablet / wider portrait (iPad aspect ~0.75)
			var t = (aspect - 0.65) / 0.35;
			camera.fov = THREE.MathUtils.lerp(47, 42, t);
			camera.position.set(
				0,
				THREE.MathUtils.lerp(20.0, 17.5, t),
				THREE.MathUtils.lerp(2.6, 5.5, t)
			);
			camera.lookAt(0, 0, THREE.MathUtils.lerp(0.45, 0.0, t));
		} else {
			// Landscape / desktop
			camera.fov = 38;
			camera.position.set(0, 16.5, 9.0);
			camera.lookAt(0, 0, -0.3);
		}

		camera.updateProjectionMatrix();
		renderer.setSize(window.innerWidth, window.innerHeight);
	}

	function onWindowResize() {
		updateCameraFraming();
	}

	var lastTime = 0;
	var lastFrameTime = 0;
	var fpsInterval = 1000 / 60; // Max 60 FPS cap to protect against 120Hz ProMotion thermal overload

	function animate(now) {
		requestAnimationFrame(animate);

		var elapsed = now - lastFrameTime;
		if (elapsed < fpsInterval - 1) return;
		lastFrameTime = now;

		var dt = Math.min((now - lastTime) * 0.001, 0.05);
		lastTime = now;

		// Update tile animations & physics
		for (var i = 0; i < allTiles.length; i++) {
			allTiles[i].update(dt);
		}

		// Animate 3D Active Row Indicator Chevrons
		if (activeRowIndicatorGroup && activeRowIndicatorGroup.visible && chainRowData[currentWordIndex]) {
			var activeRowData = chainRowData[currentWordIndex];
			var bob = Math.sin(now * 0.005) * 0.08;
			// Left Chevron bobbing towards rack ▶
			if (chevronMesh) {
				var baseChevronX = -activeRowData.rackWidth * 0.5 - 0.36;
				chevronMesh.position.x = baseChevronX + bob;
			}
			// Right Chevron bobbing towards rack ◀
			if (chevronRightMesh) {
				var baseRightChevronX = activeRowData.rackWidth * 0.5 + 0.36;
				chevronRightMesh.position.x = baseRightChevronX - bob;
			}
			if (materials.chevron) {
				materials.chevron.emissiveIntensity = 0.55 + Math.sin(now * 0.006) * 0.35;
			}
		}

		// Animate Ghost Tile pulse & subtle hover
		if (ghostTileMesh && currentGhostSlot) {
			var ghostBob = Math.sin(now * 0.006) * 0.06;
			ghostTileMesh.position.y = currentGhostSlot.worldPos.y + 0.16 + ghostBob;
			if (Array.isArray(ghostTileMesh.material) && ghostTileMesh.material[2]) {
				ghostTileMesh.material[2].emissiveIntensity = 0.35 + Math.sin(now * 0.008) * 0.25;
			}
		}

		// Animate 3D Gift Boxes (gentle floating bob and yaw)
		for (var g = 0; g < activeGiftBoxes.length; g++) {
			var gb = activeGiftBoxes[g];
			if (!gb.isOpening && gb.group) {
				var gBob = Math.sin(now * 0.0035 + gb.rowIdx) * 0.05;
				gb.group.position.y = gb.baseY + gBob;
				gb.group.rotation.y = -0.18 + Math.sin(now * 0.002 + gb.rowIdx) * 0.12;
			}
		}

		// Update 3D Confetti and Stars physics
		updateCelebrationParticles(dt, now);

		// Update Live Speedometer Gauge
		if (typeof SpeedometerManager !== 'undefined') {
			SpeedometerManager.updateLoop();
		}

		renderer.render(scene, camera);
	}

	// --------------------------------------------------------------------------
	// Bootstrapping
	// --------------------------------------------------------------------------
	function init() {
		var container = document.getElementById('canvas-container');

		// 1. Scene
		scene = new THREE.Scene();
		scene.background = null;

		// 2. Camera
		camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 100);

		// 3. Renderer (Optimized for cool, locked 60FPS mobile performance with transparent background)
		renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
		renderer.setClearColor(0x000000, 0);
		renderer.setSize(window.innerWidth, window.innerHeight);
		renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.35));
		renderer.shadowMap.enabled = false; // Heavy real-time shadow passes disabled
		renderer.outputEncoding = THREE.sRGBEncoding;
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		renderer.toneMappingExposure = 1.0;
		container.appendChild(renderer.domElement);

		// Apply responsive camera framing immediately
		updateCameraFraming();

		// 4. Lights - Warm Ambient & Clean Directional Sunlight
		var ambientLight = new THREE.AmbientLight(0xfff2e3, 0.92);
		scene.add(ambientLight);

		var sunLight = new THREE.DirectionalLight(0xfff8ee, 0.85);
		sunLight.position.set(4, 20, 10);
		scene.add(sunLight);

		// Cool blue fill light
		var fillLight = new THREE.DirectionalLight(0xb4d0ee, 0.32);
		fillLight.position.set(-8, 8, -6);
		scene.add(fillLight);

		// 5. Initialize Subsystems (Living Wordscapes Scenery Engine + 3D Table & Trays)
		UnlockManager.init();
		if (global.WordscapesScenery && typeof global.WordscapesScenery.init === 'function') {
			global.WordscapesScenery.init();
		}
		TextureManager.preloadGameSaladTiles();
		initMaterials();
		buildTableAndTrays();
		initInteraction();
		AudioManager.init();
		if (typeof SpeedometerManager !== 'undefined') {
			SpeedometerManager.init();
		}

		var totalLevels = (window.WORD_CHAIN_LEVELS && window.WORD_CHAIN_LEVELS.length) ? window.WORD_CHAIN_LEVELS.length : 30;

		// Title Screen & Settings Bindings
		var titleScreenEl = document.getElementById('title-screen');
		var btnTitlePlay = document.getElementById('btn-title-play');
		var btnTitleSettings = document.getElementById('btn-title-settings');
		var btnSettings = document.getElementById('btn-settings');
		var btnReturnTitle = document.getElementById('btn-return-title');

		function showTitleScreen() {
			if (titleScreenEl) {
				titleScreenEl.classList.remove('hidden');
				titleScreenEl.style.display = 'flex';
			}
			if (typeof SpeedometerManager !== 'undefined') {
				SpeedometerManager.updateTitleScreenUI();
			}
		}

		function hideTitleScreen() {
			if (titleScreenEl) {
				titleScreenEl.classList.add('hide');
				titleScreenEl.classList.add('hidden');
				titleScreenEl.style.display = 'none';
			}
			AudioManager.unlockAudio();
		}

		if (btnTitlePlay) {
			btnTitlePlay.addEventListener('click', function () {
				hideTitleScreen();
				AudioManager.play('tilehit', 1.0);
			});
		}
		if (window.location && window.location.search && window.location.search.indexOf('play=1') !== -1) {
			hideTitleScreen();
		}
		if (btnTitleSettings) {
			btnTitleSettings.addEventListener('click', function () {
				showThemeModal();
			});
		}
		if (btnSettings) {
			btnSettings.addEventListener('click', function () {
				showThemeModal();
			});
		}
		if (btnReturnTitle) {
			btnReturnTitle.addEventListener('click', function () {
				hideThemeModal();
				showTitleScreen();
			});
		}

		// 6. Bind DOM buttons
		var btnShuffle = document.getElementById('btn-shuffle');
		if (btnShuffle) btnShuffle.addEventListener('click', shuffleStaging);

		var btnRecall = document.getElementById('btn-recall');
		if (btnRecall) btnRecall.addEventListener('click', recallActiveRow);

		var btnHint = document.getElementById('btn-hint');
		if (btnHint) btnHint.addEventListener('click', provideHint);

		var btnThemeClose = document.getElementById('btn-theme-close');
		if (btnThemeClose) btnThemeClose.addEventListener('click', hideThemeModal);

		// Tile Skin option buttons
		document.querySelectorAll('.skin-opt').forEach(function (btn) {
			btn.addEventListener('click', function () {
				var skinId = this.getAttribute('data-skin');
				if (!skinId) return;

				if (UnlockManager.isOwned('skin', skinId) || UnlockManager.isTrial('skin', skinId)) {
					TextureManager.setSkin(skinId);
					updateThemeModalUI();
					AudioManager.play('tilehit', 0.9);
					AudioManager.haptic(20);
					showToast('Equipped ' + (TILE_SKINS[skinId] ? TILE_SKINS[skinId].name : skinId));
				} else {
					var skinObj = TILE_SKINS[skinId];
					var skinName = skinObj ? skinObj.name : skinId;
					AdMobRewardService.showRewardAd({ type: 'skin', id: skinId, name: skinName }, function () {
						UnlockManager.unlockPermanent('skin', skinId);
						showToast('🎉 LOCKED IN! You now own ' + skinName + ' forever!');
					});
				}
			});
		});

		// Living Scenery option buttons
		document.querySelectorAll('.scenery-opt').forEach(function (btn) {
			btn.addEventListener('click', function () {
				var scId = this.getAttribute('data-scenery');
				if (!scId || !global.WordscapesScenery) return;

				if (UnlockManager.isOwned('scenery', scId) || UnlockManager.isTrial('scenery', scId)) {
					global.WordscapesScenery.setScenery(scId);
					updateThemeModalUI();
					AudioManager.play('tilehit', 0.9);
					AudioManager.haptic(20);
					showToast('Equipped Living Scenery');
				} else {
					var scs = (global.WordscapesScenery.getSceneries) ? global.WordscapesScenery.getSceneries() : {};
					var scName = (scs[scId] && scs[scId].name) ? scs[scId].name : scId;
					AdMobRewardService.showRewardAd({ type: 'scenery', id: scId, name: scName }, function () {
						UnlockManager.unlockPermanent('scenery', scId);
						showToast('🎉 LOCKED IN! You now own ' + scName + ' forever!');
					});
				}
			});
		});

		var btnPrevLvl = document.getElementById('btn-prev-lvl');
		if (btnPrevLvl) {
			btnPrevLvl.addEventListener('click', function () {
				loadLevel(currentLevelIndex - 1 >= 0 ? currentLevelIndex - 1 : totalLevels - 1);
			});
		}

		var btnNextLvl = document.getElementById('btn-next-lvl');
		if (btnNextLvl) {
			btnNextLvl.addEventListener('click', function () {
				loadLevel(currentLevelIndex + 1);
			});
		}

		function updateAudioButtonsUI() {
			var soundLabel = document.getElementById('sound-label-text');
			var btnSoundEl = document.getElementById('btn-sound');
			if (soundLabel && btnSoundEl) {
				soundLabel.textContent = 'Sound: ' + (AudioManager.soundEnabled ? 'ON' : 'OFF');
				var iconS = btnSoundEl.querySelector('.toggle-icon');
				if (iconS) iconS.textContent = AudioManager.soundEnabled ? '🔊' : '🔇';
			}
			var musicLabel = document.getElementById('music-label-text');
			var btnMusicEl = document.getElementById('btn-music');
			if (musicLabel && btnMusicEl) {
				musicLabel.textContent = 'Music: ' + (AudioManager.musicEnabled ? 'ON' : 'OFF');
				var iconM = btnMusicEl.querySelector('.toggle-icon');
				if (iconM) iconM.textContent = AudioManager.musicEnabled ? '🎵' : '🔇';
			}
		}

		var btnSound = document.getElementById('btn-sound');
		if (btnSound) {
			btnSound.addEventListener('click', function () {
				AudioManager.toggleSound();
				updateAudioButtonsUI();
			});
		}

		var btnMusic = document.getElementById('btn-music');
		if (btnMusic) {
			btnMusic.addEventListener('click', function () {
				AudioManager.toggleMusic();
				updateAudioButtonsUI();
			});
		}

		var btnModalNext = document.getElementById('btn-modal-next');
		if (btnModalNext) {
			btnModalNext.addEventListener('click', function () {
				hideWinModal();
				loadLevel(currentLevelIndex + 1);
			});
		}

		// Floating 3D NEXT Button (Right Edge)
		var btnFloatingNext = document.getElementById('btn-floating-next');
		if (btnFloatingNext) {
			btnFloatingNext.addEventListener('click', function () {
				AudioManager.play('tilehit', 1.0);
				AudioManager.haptic(35);
				stopWinCelebration();
				loadLevel(currentLevelIndex + 1);
			});
		}

		// Win Celebration Replay Button for Speed Record
		var btnWinReplay = document.getElementById('btn-win-replay');
		if (btnWinReplay) {
			btnWinReplay.addEventListener('click', function () {
				AudioManager.play('tilehit', 1.0);
				AudioManager.haptic(35);
				stopWinCelebration();
				loadLevel(currentLevelIndex);
			});
		}

		// Title Screen Speed Ranking Card click -> open level select in settings
		var titleRankCard = document.getElementById('title-speed-rank-card');
		if (titleRankCard) {
			titleRankCard.style.cursor = 'pointer';
			titleRankCard.addEventListener('click', function () {
				showThemeModal();
				AudioManager.play('tilehit', 0.8);
			});
		}

		// In-Game Speedometer tap -> pulse and show quick toast status
		var hudSpeedoEl = document.getElementById('hud-speedometer');
		if (hudSpeedoEl) {
			hudSpeedoEl.addEventListener('click', function () {
				if (typeof SpeedometerManager !== 'undefined') {
					var stats = SpeedometerManager.getOverallStats();
					showToast('⚡ Speed: ' + Math.round(SpeedometerManager.displayedSpeed) + ' WPM (Overall: ' + stats.tierObj.tier + ' ' + stats.tierObj.title + ')');
				}
			});
		}

		window.addEventListener('resize', onWindowResize);

		// Expose public API for controls and automation testing
		global.WordChain3D = {
			loadLevel: loadLevel,
			shuffle: shuffleStaging,
			recall: recallActiveRow,
			hint: provideHint,
			celebrateWin: triggerWinCelebration,
			stopCelebration: stopWinCelebration,
			showThemeModal: showThemeModal,
			hideThemeModal: hideThemeModal,
			showTitle: showTitleScreen,
			hideTitle: hideTitleScreen,
			speedometer: SpeedometerManager,
			getSpeedRanking: function () {
				return SpeedometerManager.getOverallStats();
			},
			getSpeedRecords: function () {
				return SpeedometerManager.records;
			},
			setSkin: function (skinId) {
				TextureManager.setSkin(skinId);
				updateThemeModalUI();
			},
			getSkin: function () {
				return TextureManager.getCurrentSkin ? TextureManager.getCurrentSkin() : 'classic';
			},
			setScenery: function (sceneryId) {
				if (global.WordscapesScenery) {
					global.WordscapesScenery.setScenery(sceneryId);
					updateThemeModalUI();
				}
			},
			getScenery: function () {
				return (global.WordscapesScenery && global.WordscapesScenery.getCurrent) ? global.WordscapesScenery.getCurrent() : null;
			},
			getState: function () {
				return {
					level: currentLevelIndex + 1,
					activeRow: currentWordIndex + 1,
					totalRows: currentLevelData ? currentLevelData.words.length : 0,
					skin: TextureManager.getCurrentSkin ? TextureManager.getCurrentSkin() : 'classic',
					scenery: (global.WordscapesScenery && global.WordscapesScenery.getCurrent) ? global.WordscapesScenery.getCurrent() : null,
					stagingTiles: stagingSlots.map(function (s) { return s.tile ? s.tile.letter : null; }),
					activeRowTiles: chainSlots.filter(function (s) { return s.row === currentWordIndex; }).map(function (s) { return s.tile ? s.tile.letter : null; }),
					audio: {
						enabled: AudioManager.enabled,
						hasMusic: !!AudioManager.musicTrack,
						musicSrc: AudioManager.musicTrack ? AudioManager.musicTrack.src : null
					},
					materials: {
						yellowTrayRoughness: materials.yellowTray ? materials.yellowTray.roughness : null,
						yellowTrayMetalness: materials.yellowTray ? materials.yellowTray.metalness : null,
						greenTrayRoughness: materials.greenTray ? materials.greenTray.roughness : null
					},
					anyTileInWave: allTiles.some(function (t) { return t.inWave; })
				};
			},
			tapLetter: function (letter) {
				letter = (letter || '').toUpperCase();
				var tile = allTiles.find(function (t) {
					return !t.isLocked && t.letter === letter && t.currentSlot && t.currentSlot.type === 'staging';
				});
				if (!tile) return false;
				var targetSlot = chainSlots.find(function (s) {
					return s.row === currentWordIndex && s.tile === null;
				});
				if (!targetSlot) return false;
				tile.currentSlot.tile = null;
				targetSlot.tile = tile;
				tile.currentSlot = targetSlot;
				tile.setTarget(targetSlot.worldPos.x, targetSlot.worldPos.y, targetSlot.worldPos.z);
				updateSlotBrackets();
				checkWordCompletion();
				return true;
			},
			unlocks: UnlockManager,
			ads: AdMobRewardService,
			getGiftBoxes: function () {
				return activeGiftBoxes;
			},
			triggerGiftBox: function (row) {
				var targetRow = (typeof row === 'number') ? row : (activeGiftBoxes[0] ? activeGiftBoxes[0].rowIdx : null);
				var gb = activeGiftBoxes.find(function (g) { return g.rowIdx === targetRow; });
				if (gb) {
					open3DGiftBox(gb);
					return true;
				}
				return false;
			}
		};

		// 7. Load Level (supports ?level=X query parameter)
		var urlParams = new URLSearchParams(window.location.search);
		var startLvl = parseInt(urlParams.get('level'), 10);
		loadLevel(!isNaN(startLvl) && startLvl > 0 ? (startLvl - 1) : 0);

		if (urlParams.get('autostart') === '1' || urlParams.get('play') === '1') {
			hideTitleScreen();
		}
		if (urlParams.get('hint') === '1') {
			hideTitleScreen();
			setTimeout(function () {
				provideHint();
			}, 300);
		}
		if (urlParams.get('win') === '1') {
			hideTitleScreen();
			setTimeout(function () {
				triggerWinCelebration();
			}, 300);
		}
		if (urlParams.get('gift') === '1') {
			hideTitleScreen();
			setTimeout(function () {
				showGiftUnlockModal(UnlockManager.getRewardForLevelRow(0, 2) || { type: 'skin', id: 'obsidian', name: 'Midnight Onyx', desc: 'Sleek obsidian stone with polished gold laser lettering', skin: TILE_SKINS.obsidian });
			}, 300);
		}
		if (urlParams.get('ad') === '1') {
			hideTitleScreen();
			setTimeout(function () {
				AdMobRewardService.showRewardAd({ type: 'skin', id: 'obsidian', name: 'Midnight Onyx' });
			}, 300);
		}
		if (urlParams.get('settings') === '1') {
			hideTitleScreen();
			setTimeout(function () {
				showThemeModal();
			}, 300);
		}
		if (urlParams.get('trialend') === '1') {
			hideTitleScreen();
			setTimeout(function () {
				UnlockManager.activeTrial = { type: 'skin', id: 'obsidian', roundLevel: 999 };
				UnlockManager.checkTrialExpiration(0);
			}, 300);
		}

		// 8. Start Loop
		lastTime = performance.now();
		requestAnimationFrame(animate);
	}

	if (document.readyState === 'loading') {
		window.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}

})(window);

