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
		isAppInBackground: false,
		wasMusicPlaying: false,

		init: function () {
			var self = this;
			var AudioContext = window.AudioContext || window.webkitAudioContext;
			if (AudioContext) {
				try { self.audioCtx = new AudioContext(); } catch (e) {}
			}

			// Format detection: use .ogg where supported, fallback to .m4a for iOS WKWebView
			var testAudio = new Audio();
			var canOgg = testAudio.canPlayType && testAudio.canPlayType('audio/ogg').replace(/^no$/, '');
			var ext = canOgg ? '.ogg' : '.m4a';

			var soundFiles = {
				tilehit: 'game/default/sounds/tilehit' + ext,
				affirmation: 'game/default/sounds/Afirmation' + ext,
				greatJob: 'game/default/sounds/Greatjobsoundeffect' + ext,
				wrong: 'game/default/sounds/WrongWord' + ext,
				thud: 'game/default/sounds/thud' + ext,
				bell: 'game/default/sounds/freesound_community-bell-98033' + ext
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

			// Automatic cut-off & resume on window focus / app lifecycle events
			document.addEventListener('visibilitychange', function () {
				if (document.hidden || document.visibilityState === 'hidden') {
					self.onAppBackground();
				} else {
					self.onAppForeground();
				}
			});
			window.addEventListener('pagehide', function () { self.onAppBackground(); });
			window.addEventListener('pageshow', function () { self.onAppForeground(); });
			window.addEventListener('blur', function () { self.onAppBackground(); });
			window.addEventListener('focus', function () { self.onAppForeground(); });
		},

		onAppBackground: function () {
			if (this.isAppInBackground) return;
			this.isAppInBackground = true;

			// 1. Suspend Web Audio context immediately to silence all sound effects
			if (this.audioCtx && this.audioCtx.state === 'running') {
				try { this.audioCtx.suspend(); } catch (e) {}
			}

			// 2. Pause background music track
			if (this.musicTrack) {
				if (!this.musicTrack.paused) {
					this.wasMusicPlaying = true;
					try { this.musicTrack.pause(); } catch (e) {}
				} else {
					this.wasMusicPlaying = false;
				}
			}

			// 3. Pause any currently playing HTML5 audio sound effects
			var self = this;
			if (self.sounds) {
				Object.keys(self.sounds).forEach(function (name) {
					var snd = self.sounds[name];
					if (snd && !snd.paused) {
						try { snd.pause(); snd.currentTime = 0; } catch (e) {}
					}
				});
			}
		},

		onAppForeground: function () {
			if (!this.isAppInBackground) return;
			this.isAppInBackground = false;

			// 1. Resume Web Audio context
			if (this.audioCtx && this.audioCtx.state === 'suspended') {
				try { this.audioCtx.resume(); } catch (e) {}
			}

			// 2. Resume music if enabled and was playing before backgrounding
			if (this.musicEnabled && this.musicTrack) {
				if (this.wasMusicPlaying) {
					var p = this.musicTrack.play();
					if (p && p.catch) p.catch(function () {});
				}
			}
		},

		lastTileHitTime: 0,
		lastHapticTime: 0,

		play: function (name, volume, pitch) {
			if (this.isAppInBackground || !this.soundEnabled) return;
			if (name === 'tilehit') {
				var nowSnd = (typeof performance !== 'undefined' ? performance.now() : Date.now());
				if (nowSnd - this.lastTileHitTime < 28) return;
				this.lastTileHitTime = nowSnd;
			}
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

		playSnap: function (volume, skipHaptic) {
			var vol = (volume !== undefined ? volume : 1.25);
			this.play('tilehit', vol);
			if (!skipHaptic) {
				this.haptic(20);
			}
		},

		playBell: function (volume) {
			this.play('bell', volume !== undefined ? volume : 0.95);
			this.haptic(35);
		},

		toggleSound: function () {
			this.soundEnabled = !this.soundEnabled;
			return this.soundEnabled;
		},

		toggleMusic: function () {
			this.musicEnabled = !this.musicEnabled;
			if (this.musicTrack) {
				if (this.musicEnabled) {
					this.wasMusicPlaying = true;
					this.musicTrack.play().catch(function () {});
				} else {
					this.wasMusicPlaying = false;
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
			if (this.isAppInBackground) return;
			var self = this;
			if (!self.audioCtx) {
				var AudioContext = window.AudioContext || window.webkitAudioContext;
				if (AudioContext) self.audioCtx = new AudioContext();
			}
			if (self.audioCtx && self.audioCtx.state === 'suspended') {
				self.audioCtx.resume();
			}
			if (self.musicEnabled && self.musicTrack && self.musicTrack.paused) {
				self.wasMusicPlaying = true;
				self.musicTrack.play().catch(function () {});
			}
			// Prime native haptic engine on iOS for instant response
			try {
				var w = window.webkit;
				if (w && w.messageHandlers && w.messageHandlers.haptics) {
					w.messageHandlers.haptics.postMessage({ type: 'prime' });
				}
			} catch (eH) {}
		},

		haptic: function (ms, intensity, sharpness) {
			var nowH = (typeof performance !== 'undefined' ? performance.now() : Date.now());
			if (nowH - (this.lastHapticTime || 0) < 42) return;
			this.lastHapticTime = nowH;

			var durationSec = (ms || 15) / 1000.0;
			var i = (intensity !== undefined) ? intensity : Math.min(1.0, 0.45 + (ms || 15) * 0.015);
			var s = (sharpness !== undefined) ? sharpness : 0.75;

			// 1. iOS Core Haptics via WebKit Message Handler
			try {
				var w = window.webkit;
				if (w && w.messageHandlers && w.messageHandlers.haptics) {
					w.messageHandlers.haptics.postMessage({
						type: 'pattern',
						events: [{ t: 0.0, i: i, s: s, d: Math.min(0.12, durationSec) }]
					});
					return;
				}
			} catch (e1) {}

			// 2. Android Native Bridge via JavascriptInterface
			try {
				if (window.AndroidHaptics && typeof window.AndroidHaptics.postMessage === 'function') {
					window.AndroidHaptics.postMessage(JSON.stringify({
						type: 'pattern',
						events: [{ t: 0.0, i: i, s: s, d: Math.min(0.12, durationSec) }]
					}));
					return;
				}
			} catch (e2) {}

			// 3. Web Vibration API fallback
			if (navigator.vibrate) {
				try { navigator.vibrate(ms || 15); } catch (e3) {}
			}
		},

		hapticPattern: function (events) {
			if (!events || !events.length) return;
			// 1. iOS Core Haptics
			try {
				var w = window.webkit;
				if (w && w.messageHandlers && w.messageHandlers.haptics) {
					w.messageHandlers.haptics.postMessage({
						type: 'pattern',
						events: events
					});
				}
			} catch (e1) {}

			// 2. Android Native Bridge
			try {
				if (window.AndroidHaptics && typeof window.AndroidHaptics.postMessage === 'function') {
					window.AndroidHaptics.postMessage(JSON.stringify({
						type: 'pattern',
						events: events
					}));
				}
			} catch (e2) {}

			// 3. Web Vibration API fallback
			if (navigator.vibrate) {
				try {
					var pattern = [];
					events.forEach(function (ev) {
						pattern.push(Math.round((ev.d || 0.02) * 1000));
						pattern.push(Math.round((ev.t || 0.05) * 1000));
					});
					navigator.vibrate(pattern);
				} catch (e3) {}
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
	// Letter Tile Skins — sourced ONLY from the hand-made 2D tile sets in
	// OriginalTileImages/ (files named <LETTER><SET>.png, e.g. A0.png ... Z12.png).
	// Side/edge wood colours are tuned per set so the 3D tile body matches the art.
	// --------------------------------------------------------------------------
	var TILE_IMAGE_FOLDER = 'OriginalTileImages/';

	function makeTileSkin(id, setNum, name, desc, sideBase, sideDark, sideLight, tone) {
		return {
			id: id,
			set: setNum,
			name: name,
			desc: desc,
			tone: tone || 'light',
			sideBase: sideBase, sideDark: sideDark, sideLight: sideLight,
			// Locked (solved) tiles keep the warm golden edge so solved rows stay readable
			lockedBase: '#f2de9f', lockedDark: '#aa833e', lockedLight: '#fff1c7',
			roughness: 0.72, metalness: 0.0
		};
	}

	// Display order in the tile selector (classic first)
	var TILE_SKIN_ORDER = ['classic', 'set0', 'set1', 'set2', 'set3', 'set5', 'set6', 'set7', 'set8', 'set9', 'set10', 'set11', 'set12'];

	// High-contrast pairing rules:
	// Light tiles (tone: 'light') -> Paired with Dark trays and letter holders
	// Dark tiles (tone: 'dark')   -> Paired with Light trays and letter holders
	var TILE_SKINS = {
		classic: makeTileSkin('classic', 4, 'Classic', 'The original cream wooden tiles', '#e8d4ba', '#9e7b54', '#f7ead8', 'light'),
		set0: makeTileSkin('set0', 0, 'Candy Gold', 'Glossy golden candy tiles', '#f5a623', '#c46a00', '#ffd36b', 'light'),
		set1: makeTileSkin('set1', 1, 'Sky Blue', 'Soft sky-blue rounded tiles', '#5bbcf0', '#2f86b8', '#a6dcf8', 'light'),
		set2: makeTileSkin('set2', 2, 'Charcoal', 'Sleek charcoal keycap tiles', '#4a4a4a', '#262626', '#7a7a7a', 'dark'),
		set3: makeTileSkin('set3', 3, 'Toy Block', 'Bright primary toy alphabet blocks', '#d4141c', '#8a0a10', '#f2575c', 'light'),
		set5: makeTileSkin('set5', 5, 'Postage Stamp', 'Airmail postage stamp tiles', '#3fd8f2', '#1a9ab3', '#a3f0fb', 'light'),
		set6: makeTileSkin('set6', 6, 'Grass Block', 'Blocky grass & dirt tiles', '#8a5a32', '#5a3a1e', '#b07a4a', 'dark'),
		set7: makeTileSkin('set7', 7, 'Marble Gold', 'White marble with gold lettering', '#d8d8d8', '#9a9a9a', '#f4f4f4', 'light'),
		set8: makeTileSkin('set8', 8, 'Rusty Stencil', 'Riveted rusty metal stencil plates', '#6e4a3a', '#3e2a20', '#9a6e58', 'dark'),
		set9: makeTileSkin('set9', 9, 'Mosaic Maze', 'Teal mosaic maze tiles', '#2a9d8f', '#1a6b62', '#7fd1c6', 'light'),
		set10: makeTileSkin('set10', 10, 'Carved Wood', 'Chunky hand-carved wooden tiles', '#c98a4b', '#8a5526', '#e8b07a', 'light'),
		set11: makeTileSkin('set11', 11, 'Chocolate', 'Rich milk-chocolate squares', '#7a3e2a', '#4a2318', '#a8644c', 'dark'),
		set12: makeTileSkin('set12', 12, 'Buddy', 'Cheeky character tiles', '#4a3020', '#2a1a10', '#d4a640', 'dark')
	};

	function getTileImageUrl(skinId, letter) {
		var skin = TILE_SKINS[skinId] || TILE_SKINS.classic;
		return TILE_IMAGE_FOLDER + (letter || 'A').toUpperCase() + skin.set + '.png';
	}

	// Lighting balance for the tile face so the 2D art keeps its true colours
	// (prevents scene lights + ACES tone mapping from washing the art out).
	var FACE_DIFFUSE = 0x262626;   // small lit contribution for subtle 3D shading
	var FACE_EMISSIVE = 0.80;      // art shown at (almost) its native brightness

	var currentSkinId = 'classic';
	try {
		var savedSkin = localStorage.getItem('word_chain_tile_skin');
		if (savedSkin && TILE_SKINS[savedSkin]) currentSkinId = savedSkin;
	} catch (e) {}

	var TextureManager = {
		letterTextures: {},
		tileImages: {}, // keyed by "<skinId>:<LETTER>"
		slotBracketTexture: null,
		slotBracketTextures: {},
		trayThemeTextures: {},
		slotHoverTexture: null,
		activeRowBadgeTexture: null,
		bgTexture: null,

		// Load all 26 letter images for a skin; re-render faces as they arrive.
		preloadSkinImages: function (skinId) {
			var self = this;
			var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
			for (var i = 0; i < alphabet.length; i++) {
				(function (c) {
					var key = skinId + ':' + c;
					if (self.tileImages[key]) return;
					var img = new Image();
					self.tileImages[key] = img;
					img.onload = function () {
						if (currentSkinId === skinId && self.letterTextures[key]) {
							self.renderLetterOnCanvas(c, self.letterTextures[key].image, skinId);
							self.letterTextures[key].needsUpdate = true;
						}
					};
					img.src = getTileImageUrl(skinId, c);
				})(alphabet[i]);
			}
		},

		// Backwards-compatible name used by init()
		preloadGameSaladTiles: function () {
			this.preloadSkinImages(currentSkinId);
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

			// Longitudinal prominent wood grain lines (ALWAYS rich, visible wooden texture)
			for (var y = 0; y < height; y += 2.5) {
				var grainAlpha = (Math.sin(y * 0.14) * 0.5 + 0.5) * 0.32 + Math.random() * 0.12;
				ctx.fillStyle = (Math.sin(y * 0.32) > 0) ? grainDarkHex : grainLightHex;
				ctx.globalAlpha = grainAlpha;
				ctx.beginPath();
				ctx.moveTo(0, y);
				for (var x = 0; x <= width; x += 24) {
					var waveY = y + Math.sin((x + y * 2) * 0.025) * 5 + Math.sin(x * 0.012) * 7;
					ctx.lineTo(x, waveY);
				}
				ctx.lineTo(width, y + 2.2);
				ctx.lineTo(0, y + 2.2);
				ctx.fill();
			}

			// Annual growth ring bands (darker rich organic grain waves)
			for (var b = 0; b < 6; b++) {
				var bandY = (b * 44) + 18;
				ctx.fillStyle = grainDarkHex;
				ctx.globalAlpha = 0.22;
				ctx.beginPath();
				ctx.moveTo(0, bandY);
				for (var bx = 0; bx <= width; bx += 20) {
					ctx.lineTo(bx, bandY + Math.sin(bx * 0.02) * 8 + Math.cos((bx + bandY) * 0.015) * 4);
				}
				ctx.lineTo(width, bandY + 6);
				ctx.lineTo(0, bandY + 6);
				ctx.fill();
			}

			// Fine wood pore capillaries
			ctx.fillStyle = grainDarkHex;
			ctx.globalAlpha = 0.16;
			for (var i = 0; i < 450; i++) {
				var px = Math.random() * width;
				var py = Math.random() * height;
				var len = Math.random() * 32 + 10;
				ctx.fillRect(px, py, len, 1.4);
			}
			ctx.globalAlpha = 1.0;

			var texture = new THREE.CanvasTexture(canvas);
			texture.encoding = THREE.sRGBEncoding;
			texture.wrapS = THREE.RepeatWrapping;
			texture.wrapT = THREE.RepeatWrapping;
			texture.repeat.set(2, 1);
			return texture;
		},

		getCharcoalTexture: function (baseCharcoalHex, ashFissureHex, emberGlowHex, emberIntensity) {
			var width = 512;
			var height = 256;
			var canvas = document.createElement('canvas');
			canvas.width = width;
			canvas.height = height;
			var ctx = canvas.getContext('2d');

			// Base deep charred matte black / graphite
			ctx.fillStyle = baseCharcoalHex || '#151518';
			ctx.fillRect(0, 0, width, height);

			// Longitudinal char ridges & alligator fractures (burnt timber texture)
			for (var y = 0; y < height; y += 3) {
				var charAlpha = (Math.sin(y * 0.18) * 0.5 + 0.5) * 0.45 + Math.random() * 0.15;
				ctx.fillStyle = (Math.sin(y * 0.35) > 0) ? (ashFissureHex || '#0a0a0c') : '#25252b';
				ctx.globalAlpha = charAlpha;
				ctx.beginPath();
				ctx.moveTo(0, y);
				for (var x = 0; x <= width; x += 18) {
					var waveY = y + Math.sin(x * 0.035 + y * 0.015) * 4.5 + Math.cos(x * 0.015) * 3;
					ctx.lineTo(x, waveY);
				}
				ctx.lineTo(width, y + 2.4);
				ctx.lineTo(0, y + 2.4);
				ctx.fill();
			}

			// Alligator cracks / char blocks characteristic of burnt wood
			ctx.fillStyle = '#08080a';
			ctx.globalAlpha = 0.55;
			for (var c = 0; c < width; c += 22) {
				var cx = c + (Math.random() * 8 - 4);
				ctx.fillRect(cx, 0, 1.8, height);
			}

			// Ash flecks & carbon flakes
			ctx.fillStyle = '#3a3a42';
			ctx.globalAlpha = 0.25;
			for (var f = 0; f < 300; f++) {
				var fx = Math.random() * width;
				var fy = Math.random() * height;
				var fSize = Math.random() * 2.5 + 1.0;
				ctx.fillRect(fx, fy, fSize, fSize * 0.6);
			}

			// Subtle smoldering glowing ember veins deep in the cracks (NOT loud neon red)
			if (emberIntensity && emberIntensity > 0) {
				ctx.fillStyle = emberGlowHex || '#d84315';
				ctx.globalAlpha = emberIntensity;
				for (var e = 0; e < 12; e++) {
					var ey = (e * 21) + 8 + (Math.random() * 6);
					ctx.beginPath();
					ctx.moveTo(0, ey);
					for (var ex = 0; ex <= width; ex += 25) {
						var eWaveY = ey + Math.sin(ex * 0.04 + e) * 4.0;
						ctx.lineTo(ex, eWaveY);
					}
					ctx.lineTo(width, ey + 1.6);
					ctx.lineTo(0, ey + 1.6);
					ctx.fill();
				}

				// Deep burning micro-ember hotspots
				for (var h = 0; h < 20; h++) {
					var hx = Math.random() * width;
					var hy = Math.random() * height;
					var grad = ctx.createRadialGradient(hx, hy, 0, hx, hy, 12);
					grad.addColorStop(0, '#ff6d00');
					grad.addColorStop(0.4, '#e64a19');
					grad.addColorStop(1, 'transparent');
					ctx.fillStyle = grad;
					ctx.globalAlpha = emberIntensity * 0.85;
					ctx.beginPath();
					ctx.arc(hx, hy, 12, 0, Math.PI * 2);
					ctx.fill();
				}
			}

			ctx.globalAlpha = 1.0;

			var texture = new THREE.CanvasTexture(canvas);
			texture.encoding = THREE.sRGBEncoding;
			texture.wrapS = THREE.RepeatWrapping;
			texture.wrapT = THREE.RepeatWrapping;
			texture.repeat.set(2, 1);
			return texture;
		},

		renderLetterOnCanvas: function (letter, canvas, skinId) {
			letter = (letter || '').toUpperCase();
			var sid = skinId || currentSkinId || 'classic';
			var skin = TILE_SKINS[sid] || TILE_SKINS.classic;
			var size = canvas.width || 256;
			var ctx = canvas.getContext('2d');
			ctx.clearRect(0, 0, size, size);

			// Solid backing in the tile's edge colour so transparent rounded
			// corners of the 2D art blend into the 3D tile body (no black corners).
			ctx.fillStyle = skin.sideBase;
			ctx.fillRect(0, 0, size, size);

			var img = this.tileImages[sid + ':' + letter];
			if (img && img.complete && img.naturalWidth > 0) {
				// Draw the authentic 2D tile art, stretched to the full face
				ctx.imageSmoothingEnabled = true;
				ctx.imageSmoothingQuality = 'high';
				ctx.drawImage(img, 0, 0, size, size);
				return;
			}

			// Placeholder while the image is loading
			ctx.font = '900 ' + Math.round(size * 0.52) + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
			ctx.fillText(letter, size * 0.5, size * 0.5);
		},

		getLetterTexture: function (letter, skinId) {
			letter = (letter || '').toUpperCase();
			var sid = skinId || currentSkinId || 'classic';
			var key = sid + ':' + letter;
			if (this.letterTextures[key]) return this.letterTextures[key];

			var size = 512;
			var canvas = document.createElement('canvas');
			canvas.width = size;
			canvas.height = size;
			this.renderLetterOnCanvas(letter, canvas, sid);

			var texture = new THREE.CanvasTexture(canvas);
			texture.encoding = THREE.sRGBEncoding;
			texture.minFilter = THREE.LinearMipmapLinearFilter;
			texture.magFilter = THREE.LinearFilter;
			texture.anisotropy = (renderer && renderer.capabilities) ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 4;
			this.letterTextures[key] = texture;

			var self = this;
			var img = this.tileImages[key];
			if (!img) {
				img = new Image();
				this.tileImages[key] = img;
				img.onload = function () {
					if (self.letterTextures[key]) {
						self.renderLetterOnCanvas(letter, self.letterTextures[key].image, sid);
						self.letterTextures[key].needsUpdate = true;
					}
				};
				img.src = getTileImageUrl(sid, letter);
			} else if (!img.complete) {
				var prevOnload = img.onload;
				img.onload = function () {
					if (typeof prevOnload === 'function') prevOnload();
					if (self.letterTextures[key]) {
						self.renderLetterOnCanvas(letter, self.letterTextures[key].image, sid);
						self.letterTextures[key].needsUpdate = true;
					}
				};
			}

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
			cachedTileFaceMaterials = {};
			this.preloadSkinImages(skinId);

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

			// Contrast Pairing: Light tiles -> Dark trays & letter holders; Dark tiles -> Light trays & letter holders
			this.updateTrayTheme(skinId);
			this.updateTitleBoardTiles(skinId);
			if (typeof updateStoragePreviewUI === 'function') updateStoragePreviewUI();

			for (var i = 0; i < allTiles.length; i++) {
				var t = allTiles[i];
				if (t && t.mesh && t.mesh.material && t.mesh.material[2]) {
					t.mesh.material[2] = getSharedTileFaceMaterial(t.letter);
				}
			}
		},

		preloadTitleShowcaseImages: function () {
			var self = this;
			var letters = ['W', 'O', 'R', 'D', 'C', 'H', 'A', 'I', 'N'];
			var sid = currentSkinId || 'classic';
			for (var j = 0; j < letters.length; j++) {
				(function (s, c) {
					var key = s + ':' + c;
					if (self.tileImages[key]) return;
					var img = new Image();
					self.tileImages[key] = img;
					img.src = getTileImageUrl(s, c);
				})(sid, letters[j]);
			}
		},

		getTileSideMaterial: function (skinId) {
			if (!this.tileSideMaterials) this.tileSideMaterials = {};
			if (this.tileSideMaterials[skinId]) return this.tileSideMaterials[skinId];
			var skin = TILE_SKINS[skinId] || TILE_SKINS.classic;
			var sideMap = this.getHardwoodTexture(skin.sideBase, skin.sideDark, skin.sideLight);
			var mat = new THREE.MeshStandardMaterial({
				map: sideMap,
				color: 0xffffff,
				roughness: skin.roughness,
				metalness: skin.metalness
			});
			this.tileSideMaterials[skinId] = mat;
			return mat;
		},

		getTitleRackMaterial: function (themeName) {
			if (!this.titleRackMaterials) this.titleRackMaterials = {};
			if (this.titleRackMaterials[themeName]) return this.titleRackMaterials[themeName];
			var theme = this.getTrayThemeTextures(themeName);
			var mat = new THREE.MeshStandardMaterial({
				map: theme.rackWood,
				color: 0xffffff,
				roughness: theme.rackRoughness,
				metalness: 0.0
			});
			this.titleRackMaterials[themeName] = mat;
			return mat;
		},

		updateTitleBoardTiles: function (skinId) {
			var sid = skinId || currentSkinId || 'classic';
			var skin = TILE_SKINS[sid] || TILE_SKINS.classic;
			var tileImgs = document.querySelectorAll('.title-tile-img');
			if (tileImgs && tileImgs.length) {
				tileImgs.forEach(function (img) {
					var letter = img.getAttribute('data-letter') || 'A';
					img.src = getTileImageUrl(sid, letter);
				});
			}

			var styleNameEl = document.getElementById('title-style-name');
			if (styleNameEl) {
				styleNameEl.textContent = skin.name.toUpperCase();
			}
		},

		getCurrentSkin: function () {
			return currentSkinId;
		},

		getSlotBracketTexture: function (variant) {
			var isLightTray = (variant === 'lightTray' || variant === true);
			var key = isLightTray ? 'lightTray' : 'darkTray';
			if (!this.slotBracketTextures) this.slotBracketTextures = {};
			if (this.slotBracketTextures[key]) return this.slotBracketTextures[key];

			var size = 256;
			var canvas = document.createElement('canvas');
			canvas.width = size;
			canvas.height = size;
			var ctx = canvas.getContext('2d');

			ctx.clearRect(0, 0, size, size);

			if (isLightTray) {
				// Light tray brackets: warm polished brass on rich saddle felt
				ctx.fillStyle = 'rgba(250, 204, 21, 0.08)';
				drawRoundRect(ctx, 10, 10, size - 20, size - 20, 20);
				ctx.fill();

				ctx.strokeStyle = '#facc15';
				ctx.lineWidth = 12;
				ctx.lineCap = 'round';
			} else {
				// Dark tray brackets: warm glowing amber gold on dark felt
				ctx.fillStyle = 'rgba(250, 204, 21, 0.08)';
				drawRoundRect(ctx, 10, 10, size - 20, size - 20, 20);
				ctx.fill();

				ctx.strokeStyle = '#facc15';
				ctx.lineWidth = 12;
				ctx.lineCap = 'round';
			}

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
			this.slotBracketTextures[key] = texture;
			this.slotBracketTexture = texture;
			return texture;
		},

		// Cached procedural textures and color tokens for dark, light, and volcano tray themes
		getTrayThemeTextures: function (theme) {
			if (!this.trayThemeTextures) this.trayThemeTextures = {};
			if (this.trayThemeTextures[theme]) return this.trayThemeTextures[theme];

			if (theme === 'volcano') {
				// VOLCANO THEME: Rich roasted charred timber with vibrant glowing hot-coal embers!
				// Deep obsidian mahogany with fiery smoldering veins and rich emerald pine staging rack.
				this.trayThemeTextures.volcano = {
					rackWood: this.getCharcoalTexture('#241510', '#100805', '#ff5500', 0.12),
					activeWood: this.getCharcoalTexture('#3a1a0c', '#180803', '#ff7700', 0.38),
					partnerWood: this.getCharcoalTexture('#2c140a', '#120703', '#ff5500', 0.22),
					solvedWood: this.getCharcoalTexture('#1e100a', '#0d0603', '#cc3e00', 0.08),
					dimmedWood: this.getCharcoalTexture('#170d08', '#0a0402', '#000000', 0.0),
					greenWood: this.getHardwoodTexture('#14422b', '#082315', '#226943'), // Distinct rich emerald pine hardwood
					feltColor: 0x1a0f0a, // Rich deep roasted volcanic felt
					feederFeltColor: 0x092e1a, // Rich deep emerald velvet felt
					activeEmissive: 0xcc3e00, // Rich warm smoldering charcoal ember
					activeEmissiveIntensity: 0.38,
					partnerEmissive: 0x882500,
					partnerEmissiveIntensity: 0.25,
					chevronColor: 0xffaa00,
					chevronEmissive: 0x993d00,
					bracketVariant: 'darkTray',
					rackRoughness: 0.74,
					activeRoughness: 0.64,
					partnerRoughness: 0.68,
					solvedRoughness: 0.76,
					dimmedRoughness: 0.82,
					greenRoughness: 0.60
				};
			} else if (theme === 'light') {
				// LIGHT TRAYS & LETTER HOLDERS (Rich warm golden honey-oak with vivid natural wood grain)
				// Feeder tray is ALWAYS distinct: rich deep forest evergreen hardwood!
				this.trayThemeTextures.light = {
					rackWood: this.getHardwoodTexture('#b36c32', '#643614', '#d6863e'),
					activeWood: this.getHardwoodTexture('#c5793a', '#74401a', '#e4954c'),
					partnerWood: this.getHardwoodTexture('#ba7235', '#6b3a16', '#dc8d43'),
					solvedWood: this.getHardwoodTexture('#a2602b', '#572d0f', '#c47634'),
					dimmedWood: this.getHardwoodTexture('#8d5122', '#49230a', '#a86129'),
					greenWood: this.getHardwoodTexture('#1d5236', '#0f2f1d', '#2d7850'), // Distinct deep forest evergreen
					feltColor: 0x422412,
					feederFeltColor: 0x0d331e, // Emerald velvet
					activeEmissive: 0x4a2408,
					activeEmissiveIntensity: 0.38,
					partnerEmissive: 0x3d1c05,
					partnerEmissiveIntensity: 0.30,
					chevronColor: 0xf59e0b,
					chevronEmissive: 0x78350f,
					bracketVariant: 'lightTray',
					rackRoughness: 0.66,
					activeRoughness: 0.58,
					partnerRoughness: 0.60,
					solvedRoughness: 0.68,
					dimmedRoughness: 0.72,
					greenRoughness: 0.58
				};
			} else {
				// DARK TRAYS & LETTER HOLDERS (Paired with light tiles)
				// Rich dark roasted walnut / espresso racks, distinct deep emerald spruce staging tray, charcoal felt, gold brackets
				this.trayThemeTextures.dark = {
					rackWood: this.getHardwoodTexture('#382012', '#190c05', '#5a351e'),
					activeWood: this.getHardwoodTexture('#4d2a16', '#261208', '#6e3f22'),
					partnerWood: this.getHardwoodTexture('#422312', '#200e06', '#61341c'),
					solvedWood: this.getHardwoodTexture('#301a0d', '#150904', '#4e2c17'),
					dimmedWood: this.getHardwoodTexture('#221208', '#0e0502', '#361d0f'),
					greenWood: this.getHardwoodTexture('#16452c', '#0a2315', '#246b45'), // Distinct deep forest spruce
					feltColor: 0x1c130b,
					feederFeltColor: 0x0a2818, // Emerald velvet
					activeEmissive: 0x4a1e06,
					activeEmissiveIntensity: 0.42,
					partnerEmissive: 0x381504,
					partnerEmissiveIntensity: 0.32,
					chevronColor: 0xf59e0b,
					chevronEmissive: 0x78350f,
					bracketVariant: 'darkTray',
					rackRoughness: 0.70,
					activeRoughness: 0.62,
					partnerRoughness: 0.65,
					solvedRoughness: 0.72,
					dimmedRoughness: 0.78,
					greenRoughness: 0.60
				};
			}
			return this.trayThemeTextures[theme];
		},

		// Dynamically switch trays and letter holders to maintain optimal contrast with current tiles:
		// Volcano scenery -> Burnt slightly glowing charcoal trays
		// Light tiles     -> Dark trays & letter holders
		// Dark tiles      -> Light trays & letter holders
		updateTrayTheme: function (skinId) {
			var skin = TILE_SKINS[skinId] || TILE_SKINS[currentSkinId] || TILE_SKINS.classic;
			var isLightTile = (skin.tone !== 'dark');
			var scId = (global.WordscapesScenery && global.WordscapesScenery.getCurrent) ? global.WordscapesScenery.getCurrent() : null;
			var themeName = (scId === 'volcano') ? 'volcano' : (isLightTile ? 'dark' : 'light');
			var theme = this.getTrayThemeTextures(themeName);

			if (materials.yellowTray) {
				materials.yellowTray.map = theme.rackWood;
				materials.yellowTray.roughness = theme.rackRoughness;
				materials.yellowTray.needsUpdate = true;
			}
			if (materials.yellowTrayActive) {
				materials.yellowTrayActive.map = theme.activeWood;
				materials.yellowTrayActive.roughness = theme.activeRoughness;
				materials.yellowTrayActive.emissive.setHex(theme.activeEmissive);
				materials.yellowTrayActive.emissiveIntensity = theme.activeEmissiveIntensity;
				materials.yellowTrayActive.needsUpdate = true;
			}
			if (materials.yellowTrayPartner) {
				materials.yellowTrayPartner.map = theme.partnerWood;
				materials.yellowTrayPartner.roughness = theme.partnerRoughness;
				materials.yellowTrayPartner.emissive.setHex(theme.partnerEmissive);
				materials.yellowTrayPartner.emissiveIntensity = theme.partnerEmissiveIntensity;
				materials.yellowTrayPartner.needsUpdate = true;
			}
			if (materials.yellowTraySolved) {
				materials.yellowTraySolved.map = theme.solvedWood;
				materials.yellowTraySolved.roughness = theme.solvedRoughness;
				materials.yellowTraySolved.needsUpdate = true;
			}
			if (materials.yellowTrayDimmed) {
				materials.yellowTrayDimmed.map = theme.dimmedWood;
				materials.yellowTrayDimmed.roughness = theme.dimmedRoughness;
				materials.yellowTrayDimmed.needsUpdate = true;
			}
			if (materials.greenTray) {
				materials.greenTray.map = theme.greenWood;
				materials.greenTray.roughness = theme.greenRoughness;
				materials.greenTray.needsUpdate = true;
			}
			if (materials.feederTrayLip) {
				materials.feederTrayLip.map = theme.greenWood;
				materials.feederTrayLip.needsUpdate = true;
			}
			if (materials.feederFelt) {
				materials.feederFelt.color.setHex(theme.feederFeltColor || 0x0f2619);
				materials.feederFelt.needsUpdate = true;
			}
			if (materials.slotFelt) {
				materials.slotFelt.color.setHex(theme.feltColor);
				materials.slotFelt.needsUpdate = true;
			}
			if (materials.activeSlotBracket) {
				materials.activeSlotBracket.map = this.getSlotBracketTexture(theme.bracketVariant);
				materials.activeSlotBracket.needsUpdate = true;
			}
			if (materials.chevron) {
				materials.chevron.color.setHex(theme.chevronColor);
				materials.chevron.emissive.setHex(theme.chevronEmissive);
				materials.chevron.needsUpdate = true;
			}

			// Immediately refresh rack and lip material assignments across all rows without prematurely showing coupler
			if (typeof updateActiveRowVisuals === 'function') {
				try {
					updateActiveRowVisuals(true);
				} catch (e) {}
			}
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
	global.TextureManager = TextureManager;

	// --------------------------------------------------------------------------
	// Customization Unlocks, Gift Box Progression & Reward Ads
	// --------------------------------------------------------------------------
	var UnlockManager = {
		ownedSkins: ['classic'],
		ownedSceneries: ['sakura', 'volcano', 'snowtown', 'peaks', 'ocean'],
		activeTrial: null, // { type: 'skin'|'scenery', id: string, roundLevel: number }
		lastGiftReceivedLevel: null,
		levelsSinceLastGift: 0,
		lastGiftType: 'skin',

		init: function () {
			var self = this;
			try {
				var savedSkins = JSON.parse(localStorage.getItem('word_chain_owned_skins'));
				if (Array.isArray(savedSkins)) {
					this.ownedSkins = savedSkins;
				}
			} catch (e) {}
			// Drop any legacy (non-2D-art) skins from older saves
			this.ownedSkins = this.ownedSkins.filter(function (id) { return !!TILE_SKINS[id]; });
			if (this.ownedSkins.indexOf('classic') === -1) {
				this.ownedSkins.push('classic');
			}

			try {
				var savedSceneries = JSON.parse(localStorage.getItem('word_chain_owned_sceneries'));
				if (Array.isArray(savedSceneries)) {
					this.ownedSceneries = savedSceneries;
				}
			} catch (e) {}
			['sakura', 'volcano', 'snowtown', 'peaks', 'ocean'].forEach(function (s) {
				if (self.ownedSceneries.indexOf(s) === -1) {
					self.ownedSceneries.push(s);
				}
			});

			try {
				var savedLastLevel = localStorage.getItem('word_chain_last_gift_level');
				if (savedLastLevel !== null && savedLastLevel !== '' && !isNaN(parseInt(savedLastLevel, 10))) {
					this.lastGiftReceivedLevel = parseInt(savedLastLevel, 10);
				}
				var savedLevelsSince = localStorage.getItem('word_chain_levels_since_gift');
				if (savedLevelsSince !== null && savedLevelsSince !== '' && !isNaN(parseInt(savedLevelsSince, 10))) {
					this.levelsSinceLastGift = parseInt(savedLevelsSince, 10);
				} else {
					// Initial progress: spaced so first reward appears on Level 5, then 4-5 levels after
					this.levelsSinceLastGift = 0;
				}
				this.lastGiftType = localStorage.getItem('word_chain_last_gift_type') || 'skin';
			} catch (e) {}
		},

		hasAnyUnownedReward: function () {
			var hasUnownedSkin = TILE_SKIN_ORDER.some(function (id) {
				return id !== 'classic' && !UnlockManager.isOwned('skin', id);
			});
			if (hasUnownedSkin) return true;
			var sceneries = ['volcano', 'snowtown', 'peaks', 'ocean'];
			return sceneries.some(function (id) {
				return !UnlockManager.isOwned('scenery', id);
			});
		},

		// Spacing: A gift appears strictly 4-5 levels AFTER receiving one gift (never back-to-back)
		isEligibleForGift: function (levelIndex) {
			if (!this.hasAnyUnownedReward()) return false;

			// Brand new player receives first gift on Level 5 (index 4)
			if (this.lastGiftReceivedLevel === null) {
				return levelIndex >= 4;
			}

			// Must be at least 4-5 levels after receiving the last gift
			if (this.levelsSinceLastGift >= 5 && Math.abs(levelIndex - this.lastGiftReceivedLevel) >= 4) {
				return true;
			}

			return false;
		},

		onLevelCompleted: function (levelIndex) {
			this.levelsSinceLastGift++;
			try {
				localStorage.setItem('word_chain_levels_since_gift', String(this.levelsSinceLastGift));
			} catch (e) {}
		},

		onGiftReceived: function (levelIndex, reward) {
			this.lastGiftReceivedLevel = levelIndex;
			this.levelsSinceLastGift = 0;
			if (reward && reward.type) {
				this.lastGiftType = reward.type;
				try { localStorage.setItem('word_chain_last_gift_type', reward.type); } catch (e) {}
			}
			try {
				localStorage.setItem('word_chain_last_gift_level', String(levelIndex));
				localStorage.setItem('word_chain_levels_since_gift', '0');
			} catch (e) {}
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
					try { localStorage.setItem('word_chain_scenery_user_selected', 'true'); } catch (e) {}
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
					try { localStorage.setItem('word_chain_scenery_user_selected', 'true'); } catch (e) {}
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
			onHandled = once(onHandled);
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
					showcaseEl.appendChild(createSkinPreviewEl(trialItem.id, 'reward-tile-preview-3d'));
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
					try { localStorage.removeItem('word_chain_scenery_user_selected'); } catch (e) {}
					if (global.WordscapesScenery) {
						global.WordscapesScenery.setScenery('sakura');
					}
				}
				this.activeTrial = null;
			}
			updateThemeModalUI();
		},

		makeSkinReward: function (skinId) {
			var skin = TILE_SKINS[skinId] || TILE_SKINS.classic;
			return { type: 'skin', id: skin.id, name: skin.name, desc: skin.desc, skin: skin };
		},

		getNextReward: function (levelIndex) {
			var giftableSkins = TILE_SKIN_ORDER.filter(function (id) {
				return id !== 'classic' && !UnlockManager.isOwned('skin', id);
			});
			var sceneryRewards = [
				{ type: 'scenery', id: 'volcano', name: 'Volcano Night', desc: 'Fiery magma eruption at night with glowing ember sparks', icon: '🌋' },
				{ type: 'scenery', id: 'snowtown', name: 'Winter Village', desc: 'Snowy alpine village at night with warm golden chalet lights', icon: '🏔️' },
				{ type: 'scenery', id: 'peaks', name: 'Alpine Peaks', desc: 'Majestic daytime snow mountain slopes and powder crystals', icon: '❄️' },
				{ type: 'scenery', id: 'ocean', name: 'Tropical Pier', desc: 'Crystal turquoise ocean dock with shimmering water glints', icon: '🏝️' }
			];
			var giftableSceneries = sceneryRewards.filter(function (sc) {
				return !UnlockManager.isOwned('scenery', sc.id);
			});

			// Alternate between skin and scenery rewards for rich variety
			var preferScenery = (this.lastGiftType === 'skin');
			if (preferScenery && giftableSceneries.length > 0) {
				return giftableSceneries[levelIndex % giftableSceneries.length];
			}
			if (giftableSkins.length > 0) {
				var sid = giftableSkins[levelIndex % giftableSkins.length];
				return this.makeSkinReward(sid);
			}
			if (giftableSceneries.length > 0) {
				return giftableSceneries[levelIndex % giftableSceneries.length];
			}
			return null;
		},

		getRewardForLevelRow: function (levelIndex, rowIndex) {
			// Single gift box per eligible level on Row 2 (appears ~4-5 levels after receiving one gift)
			if (rowIndex !== 2) return null;

			if (!this.isEligibleForGift(levelIndex)) {
				return null;
			}

			return this.getNextReward(levelIndex);
		}
	};

	// Small preview of a 2D tile set (uses the set's real "A" tile image)
	function createSkinPreviewEl(skinId, className) {
		var skin = TILE_SKINS[skinId] || TILE_SKINS.classic;
		var el = document.createElement('div');
		el.className = (className || 'skin-preview') + ' skin-img-preview';
		var img = document.createElement('img');
		img.src = getTileImageUrl(skin.id, 'A');
		img.alt = skin.name;
		img.draggable = false;
		el.appendChild(img);
		return el;
	}

	// ==========================================================================
	// FANCY FELT-FLOORED CUBBY HOLE SYSTEM (3 TILES A-B-C IN EACH OF 12+ STYLES)
	// ==========================================================================
	function updateStoragePreviewUI() {
		var curSkinId = TextureManager.getCurrentSkin ? TextureManager.getCurrentSkin() : 'classic';
		var skinObj = TILE_SKINS[curSkinId] || TILE_SKINS.classic;

		// 1. Title Screen Entrance Bar
		var titlePreviewA = document.getElementById('title-preview-tile-a');
		var titlePreviewB = document.getElementById('title-preview-tile-b');
		var titlePreviewC = document.getElementById('title-preview-tile-c');
		var titleStyleName = document.getElementById('title-style-name');

		if (titlePreviewA) titlePreviewA.src = getTileImageUrl(curSkinId, 'A');
		if (titlePreviewB) titlePreviewB.src = getTileImageUrl(curSkinId, 'B');
		if (titlePreviewC) titlePreviewC.src = getTileImageUrl(curSkinId, 'C');
		if (titleStyleName) titleStyleName.textContent = skinObj.name.toUpperCase();

		// 2. Settings Modal Portal
		var settingsPreviewA = document.getElementById('settings-preview-tile-a');
		var settingsPreviewB = document.getElementById('settings-preview-tile-b');
		var settingsPreviewC = document.getElementById('settings-preview-tile-c');
		var settingsStorageSub = document.getElementById('settings-storage-sub');

		if (settingsPreviewA) settingsPreviewA.src = getTileImageUrl(curSkinId, 'A');
		if (settingsPreviewB) settingsPreviewB.src = getTileImageUrl(curSkinId, 'B');
		if (settingsPreviewC) settingsPreviewC.src = getTileImageUrl(curSkinId, 'C');
		if (settingsStorageSub) settingsStorageSub.textContent = 'Current: ' + skinObj.name + ' (12+ Styles)';
	}

	function renderStorageCubbies() {
		var container = document.getElementById('cubby-grid');
		if (!container) return;
		container.innerHTML = '';

		var curSkin = TextureManager.getCurrentSkin ? TextureManager.getCurrentSkin() : 'classic';

		TILE_SKIN_ORDER.forEach(function (id) {
			var skin = TILE_SKINS[id];
			if (!skin) return;

			var isEquipped = (id === curSkin);
			var isOwned = UnlockManager.isOwned('skin', id);
			var isTrial = UnlockManager.isTrial('skin', id);

			var cubby = document.createElement('div');
			cubby.className = 'cubby-box' + (isEquipped ? ' active' : '');
			cubby.setAttribute('data-skin', id);
			cubby.setAttribute('title', skin.name + ' • ' + skin.desc);

			// 1. The Fancy Felt Floor
			var feltFloor = document.createElement('div');
			feltFloor.className = 'cubby-felt-floor';

			// 2. The 3 Tiles: A, B, and C resting physically on the felt floor!
			var stage = document.createElement('div');
			stage.className = 'cubby-tiles-stage';

			['A', 'B', 'C'].forEach(function (letter) {
				var unit = document.createElement('div');
				unit.className = 'cubby-tile-unit unit-' + letter.toLowerCase();

				// Contact shadow oval directly on the felt floor
				var shadow = document.createElement('div');
				shadow.className = 'cubby-tile-shadow';
				unit.appendChild(shadow);

				var tileImg = document.createElement('img');
				tileImg.src = getTileImageUrl(id, letter);
				tileImg.alt = letter;
				tileImg.className = 'cubby-tile-img';
				tileImg.draggable = false;
				unit.appendChild(tileImg);

				stage.appendChild(unit);
			});
			feltFloor.appendChild(stage);
			cubby.appendChild(feltFloor);

			// 3. Brass Plaque Nameplate
			var plaque = document.createElement('div');
			plaque.className = 'cubby-plaque';

			var nameEl = document.createElement('span');
			nameEl.className = 'cubby-name';
			nameEl.textContent = skin.name;
			plaque.appendChild(nameEl);

			// Concierge Service Call Bell replaces the select button!
			if (isEquipped) {
				var bellBtn = document.createElement('div');
				bellBtn.className = 'cubby-bell-action equipped';
				bellBtn.innerHTML = '<img class="bell-icon bell-down" src="OriginalTileImages/BELLGOLD_DOWN.png" alt="Bell" /><span class="bell-text">EQUIPPED</span>';
				plaque.appendChild(bellBtn);
			} else if (isOwned) {
				var bellBtn = document.createElement('button');
				bellBtn.type = 'button';
				bellBtn.className = 'cubby-bell-action select';
				bellBtn.innerHTML = '<img class="bell-icon bell-up" src="OriginalTileImages/BELLGOLD_UP.png" alt="Bell" /><span class="bell-text">SELECT</span>';
				plaque.appendChild(bellBtn);
			} else if (isTrial) {
				var bellBtn = document.createElement('div');
				bellBtn.className = 'cubby-bell-action trial';
				bellBtn.innerHTML = '<img class="bell-icon bell-up" src="OriginalTileImages/BELLSILVER_UP.png" alt="Bell" /><span class="bell-text">TRIAL</span>';
				plaque.appendChild(bellBtn);
			} else {
				var badge = document.createElement('span');
				badge.className = 'cubby-badge badge-store';
				badge.textContent = '🔒 WATCH AD';
				plaque.appendChild(badge);
			}
			cubby.appendChild(plaque);

			// Tactile interaction: Select or Unlock via Store
			cubby.addEventListener('click', function (e) {
				e.stopPropagation();
				var targetId = this.getAttribute('data-skin');
				if (!targetId) return;

				if (UnlockManager.isOwned('skin', targetId) || UnlockManager.isTrial('skin', targetId)) {
					TextureManager.setSkin(targetId);
					AudioManager.playBell();
					showToast('🛎️ Equipped ' + (TILE_SKINS[targetId] ? TILE_SKINS[targetId].name : targetId) + ' Tiles!');
					renderStorageCubbies();
					updateStoragePreviewUI();
					updateThemeModalUI();
				} else {
					var skinObj = TILE_SKINS[targetId];
					var skinName = skinObj ? skinObj.name : targetId;
					AdMobRewardService.showRewardAd({ type: 'skin', id: targetId, name: skinName }, function () {
						UnlockManager.unlockPermanent('skin', targetId);
						TextureManager.setSkin(targetId);
						AudioManager.playBell();
						showToast('🎉 LOCKED IN! You now own ' + skinName + ' forever!');
						renderStorageCubbies();
						updateStoragePreviewUI();
						updateThemeModalUI();
					});
				}
			});

			container.appendChild(cubby);
		});
	}

	function openTileStorageModal() {
		var modal = document.getElementById('tile-storage-modal');
		if (!modal) return;
		renderStorageCubbies();
		updateStoragePreviewUI();
		modal.style.display = 'flex';
		modal.classList.add('show');
		AudioManager.play('tilehit', 0.9);
		AudioManager.haptic(20);
	}

	function closeTileStorageModal() {
		var modal = document.getElementById('tile-storage-modal');
		if (!modal) return;
		modal.classList.remove('show');
		setTimeout(function () {
			if (modal && !modal.classList.contains('show')) {
				modal.style.display = '';
			}
		}, 350);
		AudioManager.play('tilehit', 0.8);
	}

	function renderSkinSelector() {
		renderStorageCubbies();
		updateStoragePreviewUI();
	}

	// Ensures a callback can only ever run once (guards against double-advancing)
	function once(fn) {
		var called = false;
		return function () {
			if (called || typeof fn !== 'function') return;
			called = true;
			return fn.apply(this, arguments);
		};
	}

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

			if (!modal) {
				self.isAdPlaying = false;
				if (typeof onDismissed === 'function') onDismissed();
				return;
			}
			// Clear any inline display left behind by other ad flows (e.g. key recharge)
			modal.style.display = '';
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
				}
			}, 100);

			// Exactly ONE outcome fires, and only after the player closes the ad,
			// so the game never advances behind the ad overlay or advances twice.
			closeBtn.onclick = function () {
				closeBtn.onclick = null;
				clearInterval(timerInterval);
				modal.classList.remove('show');
				self.isAdPlaying = false;
				if (rewardGranted) {
					if (typeof onRewarded === 'function') onRewarded(rewardItem);
				} else if (typeof onDismissed === 'function') {
					onDismissed();
				}
			};
		}
	};

	// --------------------------------------------------------------------------
	// Level Metadata Helper: The name of the level is the FIRST word in the chain
	// --------------------------------------------------------------------------
	function getLevelName(levelIndex) {
		var allLevels = window.WORD_CHAIN_LEVELS || [];
		var lvl = allLevels[levelIndex];
		if (lvl && lvl.words && lvl.words[0] && lvl.words[0].answer) {
			return lvl.words[0].answer.toUpperCase();
		}
		if (currentLevelData && currentLevelData.words && currentLevelData.words[0] && currentLevelData.words[0].answer) {
			return currentLevelData.words[0].answer.toUpperCase();
		}
		return 'LEVEL ' + (levelIndex + 1);
	}

	// --------------------------------------------------------------------------
	// 3D Star System with Three.js Lighting & Radiant Light Glow (HUD Star Track)
	// --------------------------------------------------------------------------
	var Star3DManager = {
		initialized: false,
		canvas: null,
		renderer: null,
		scene: null,
		camera: null,
		stars: [],
		ambientLight: null,
		sunLight: null,
		rimLight: null,
		topFillLight: null,
		boardStarLight: null,
		envTexture: null,
		glowTexture: null,
		flareTexture: null,
		haloRingTexture: null,
		trackEl: null,
		canvasWidth: 264,
		canvasHeight: 88,
		dpr: 1,

		createStudioEnvTexture: function () {
			if (this.envTexture) return this.envTexture;
			var c = document.createElement('canvas');
			c.width = 256;
			c.height = 128;
			var ctx = c.getContext('2d');

			// Base studio gradient from bright sky reflection to warm gold horizon & dark floor
			var bg = ctx.createLinearGradient(0, 0, 0, 128);
			bg.addColorStop(0.00, '#ffffff');
			bg.addColorStop(0.18, '#fff4cc');
			bg.addColorStop(0.42, '#fbbf24');
			bg.addColorStop(0.50, '#1e293b');
			bg.addColorStop(0.65, '#f59e0b');
			bg.addColorStop(0.85, '#38bdf8');
			bg.addColorStop(1.00, '#0f172a');
			ctx.fillStyle = bg;
			ctx.fillRect(0, 0, 256, 128);

			// High-intensity specular studio softbox strips for crisp 3D facet reflections
			ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
			ctx.fillRect(24, 10, 72, 22);
			ctx.fillRect(148, 14, 84, 20);
			ctx.fillStyle = 'rgba(255, 235, 150, 0.90)';
			ctx.fillRect(40, 68, 95, 16);

			var tex = new THREE.CanvasTexture(c);
			tex.mapping = THREE.EquirectangularReflectionMapping;
			tex.needsUpdate = true;
			this.envTexture = tex;
			return tex;
		},

		createFacetedStarGeometry: function (outerR, innerR, frontZ, backZ) {
			var geom = new THREE.BufferGeometry();
			var points = 5;
			var vertices = [];

			var tips = [];
			var valleys = [];

			for (var i = 0; i < points; i++) {
				var aTip = (i / points) * Math.PI * 2 + Math.PI / 2;
				tips.push({
					x: Math.cos(aTip) * outerR,
					y: Math.sin(aTip) * outerR,
					z: 0
				});
				var aVal = ((i + 0.5) / points) * Math.PI * 2 + Math.PI / 2;
				valleys.push({
					x: Math.cos(aVal) * innerR,
					y: Math.sin(aVal) * innerR,
					z: 0
				});
			}

			var frontApex = { x: 0, y: 0, z: frontZ };
			var backApex = { x: 0, y: 0, z: -backZ };

			function pushTri(p1, p2, p3) {
				vertices.push(p1.x, p1.y, p1.z);
				vertices.push(p2.x, p2.y, p2.z);
				vertices.push(p3.x, p3.y, p3.z);
			}

			for (var p = 0; p < points; p++) {
				var nextP = (p + 1) % points;
				// Front Facet A: Apex -> Tip[p] -> Val[p]
				pushTri(frontApex, tips[p], valleys[p]);
				// Front Facet B: Apex -> Val[p] -> Tip[nextP]
				pushTri(frontApex, valleys[p], tips[nextP]);

				// Back Facet A: BackApex -> Val[p] -> Tip[p]
				pushTri(backApex, valleys[p], tips[p]);
				// Back Facet B: BackApex -> Tip[nextP] -> Val[p]
				pushTri(backApex, tips[nextP], valleys[p]);
			}

			geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
			geom.computeVertexNormals();
			return geom;
		},

		createGlowTexture: function () {
			if (this.glowTexture) return this.glowTexture;
			var c = document.createElement('canvas');
			c.width = 128;
			c.height = 128;
			var ctx = c.getContext('2d');
			// Warm amber-gold backlight aura (never pure white so it never washes out the 5-pointed star silhouette)
			var grad = ctx.createRadialGradient(64, 64, 6, 64, 64, 60);
			grad.addColorStop(0.0, 'rgba(255, 195, 25, 0.72)');
			grad.addColorStop(0.35, 'rgba(255, 155, 10, 0.45)');
			grad.addColorStop(0.68, 'rgba(245, 110, 0, 0.18)');
			grad.addColorStop(1.0, 'rgba(220, 75, 0, 0.0)');
			ctx.fillStyle = grad;
			ctx.fillRect(0, 0, 128, 128);
			this.glowTexture = new THREE.CanvasTexture(c);
			this.glowTexture.generateMipmaps = false;
			this.glowTexture.minFilter = THREE.LinearFilter;
			this.glowTexture.magFilter = THREE.LinearFilter;
			return this.glowTexture;
		},

		createFlareTexture: function () {
			if (this.flareTexture) return this.flareTexture;
			var c = document.createElement('canvas');
			c.width = 128;
			c.height = 128;
			var ctx = c.getContext('2d');
			var cx = 64, cy = 64;

			// Subtle golden rays extending behind the star tips
			for (var r = 0; r < 4; r++) {
				ctx.save();
				ctx.translate(cx, cy);
				ctx.rotate((r * Math.PI) / 4);
				var rayLen = (r % 2 === 0) ? 58 : 40;
				var rayThick = (r % 2 === 0) ? 2.8 : 1.8;
				var rGrad = ctx.createLinearGradient(-rayLen, 0, rayLen, 0);
				rGrad.addColorStop(0, 'rgba(255, 185, 20, 0)');
				rGrad.addColorStop(0.5, 'rgba(255, 215, 70, 0.65)');
				rGrad.addColorStop(1, 'rgba(255, 185, 20, 0)');
				ctx.fillStyle = rGrad;
				ctx.beginPath();
				ctx.moveTo(-rayLen, 0);
				ctx.lineTo(0, -rayThick);
				ctx.lineTo(rayLen, 0);
				ctx.lineTo(0, rayThick);
				ctx.closePath();
				ctx.fill();
				ctx.restore();
			}

			this.flareTexture = new THREE.CanvasTexture(c);
			this.flareTexture.generateMipmaps = false;
			this.flareTexture.minFilter = THREE.LinearFilter;
			this.flareTexture.magFilter = THREE.LinearFilter;
			return this.flareTexture;
		},

		init: function () {
			if (this.initialized) return;
			this.canvas = document.getElementById('hud-star-3d-canvas');
			this.trackEl = document.getElementById('hud-star-track');
			if (!this.canvas || !this.trackEl || typeof THREE === 'undefined') return;

			try {
				var rect = this.canvas.getBoundingClientRect();
				this.canvasWidth = Math.max(220, rect.width || 264);
				this.canvasHeight = Math.max(68, rect.height || 88);
				this.dpr = Math.min(window.devicePixelRatio || 1, 2.0);

				this._dimColor = new THREE.Color(0x64748b);
				this._litColor = new THREE.Color(0xffb700);
				this._dimRim = new THREE.Color(0x1e293b);
				this._litRim = new THREE.Color(0x6b2f02);
				this.lastRenderTime = 0;

				this.renderer = new THREE.WebGLRenderer({
					canvas: this.canvas,
					antialias: true,
					alpha: true,
					powerPreference: 'high-performance'
				});
				this.renderer.setClearColor(0x000000, 0);
				this.renderer.setPixelRatio(this.dpr);
				this.renderer.setSize(this.canvasWidth, this.canvasHeight, false);
				this.renderer.shadowMap.enabled = false;
				this.renderer.outputEncoding = THREE.sRGBEncoding;

				this.scene = new THREE.Scene();
				var envTex = this.createStudioEnvTexture();
				this.scene.environment = envTex;

				// Telephoto FOV (15 deg) eliminates wide-angle edge distortion on left/right 3D stars
				var fov = 15;
				var fovRad = THREE.MathUtils.degToRad(fov);
				var camZ = (this.canvasHeight / 2) / Math.tan(fovRad / 2);
				this.camera = new THREE.PerspectiveCamera(fov, this.canvasWidth / this.canvasHeight, 1, 2000);
				this.camera.position.set(0, 0, camZ);
				this.camera.lookAt(0, 0, 0);

				// 1. Balanced Ambient Light (preserves deep shadow facets on the 3D star)
				this.ambientLight = new THREE.AmbientLight(0xffffff, 0.36);
				this.scene.add(this.ambientLight);

				// 2. Key Sun Directional Light (angled from top-left for sharp 10-facet contrast)
				this.sunLight = new THREE.DirectionalLight(0xfff4d0, 1.15);
				this.sunLight.position.set(-42, 52, 50);
				this.scene.add(this.sunLight);

				// 3. Warm Bronze Rim Light (bottom-right facet definition without washing out)
				this.rimLight = new THREE.DirectionalLight(0xd97706, 0.45);
				this.rimLight.position.set(38, -32, 20);
				this.scene.add(this.rimLight);

				// 4. Build Crisp 5-Pointed 3D Stars + Dark Bronze Bevel Rim + Subtle Backlight Glow
				var starGeom = this.createFacetedStarGeometry(13.0, 5.5, 6.2, 4.0);
				var rimGeom = this.createFacetedStarGeometry(14.8, 6.4, 2.2, 2.2);

				var glowTex = this.createGlowTexture();
				var flareTex = this.createFlareTexture();

				var glowGeom = new THREE.PlaneGeometry(42, 42);
				var flareGeom = new THREE.PlaneGeometry(46, 46);

				var defaultOffsets = [-80, 0, 80];

				this.stars = [];
				for (var i = 0; i < 3; i++) {
					var baseX = defaultOffsets[i];

					var starGroup = new THREE.Group();
					starGroup.position.set(baseX, 0, 0);

					// A. Subtle Warm Golden Back-Aura strictly BEHIND the opaque 3D star (z = -6)
					var glowMat = new THREE.MeshBasicMaterial({
						map: glowTex,
						transparent: true,
						opacity: 0,
						blending: THREE.NormalBlending,
						depthWrite: false
					});
					var glowMesh = new THREE.Mesh(glowGeom, glowMat);
					glowMesh.position.set(0, 0, -6.0);
					glowMesh.scale.set(0.1, 0.1, 0.1);
					starGroup.add(glowMesh);

					// B. Subtle Golden Starburst Rays strictly BEHIND the opaque 3D star (z = -5.5)
					var flareMat = new THREE.MeshBasicMaterial({
						map: flareTex,
						transparent: true,
						opacity: 0,
						blending: THREE.AdditiveBlending,
						depthWrite: false
					});
					var flareMesh = new THREE.Mesh(flareGeom, flareMat);
					flareMesh.position.set(0, 0, -5.5);
					flareMesh.scale.set(0.1, 0.1, 0.1);
					starGroup.add(flareMesh);

					// C. Crisp 5-Pointed 3D Star Assembly (Dark Bevel Rim + 10-Facet 3D Star Body)
					var bodyPivot = new THREE.Group();
					starGroup.add(bodyPivot);

					// Outer 5-pointed dark bevel border so the star silhouette is razor-sharp against any sky/snow!
					var rimMat = new THREE.MeshStandardMaterial({
						color: 0x1e293b,
						roughness: 0.42,
						metalness: 0.35,
						envMap: envTex,
						envMapIntensity: 0.5,
						emissive: 0x000000,
						emissiveIntensity: 0.0,
						flatShading: true
					});
					var rimMesh = new THREE.Mesh(rimGeom, rimMat);
					rimMesh.position.set(0, 0, -1.4);
					bodyPivot.add(rimMesh);

					// 10-Facet 3D Star Body (never clips to white; keeps distinct sunlit & shadowed 3D facets)
					var starMat = new THREE.MeshStandardMaterial({
						color: 0x64748b,
						roughness: 0.34,
						metalness: 0.36,
						envMap: envTex,
						envMapIntensity: 0.65,
						emissive: 0x000000,
						emissiveIntensity: 0.0,
						flatShading: true
					});
					var starMesh = new THREE.Mesh(starGeom, starMat);
					bodyPivot.add(starMesh);

					// D. Controlled Warm Golden Three.js PointLight (highlights upper-left facets when activated)
					var pLight = new THREE.PointLight(0xffb703, 0.0, 55, 1.6);
					pLight.position.set(-8, 10, 18);
					starGroup.add(pLight);

					this.scene.add(starGroup);

					this.stars.push({
						group: starGroup,
						bodyPivot: bodyPivot,
						mesh: starMesh,
						rimMesh: rimMesh,
						light: pLight,
						glowMesh: glowMesh,
						flareMesh: flareMesh,
						baseX: baseX,
						litAmount: 0.0,
						targetLit: 0.0,
						isLit: false,
						spinVelocity: 0.0,
						popScale: 0.96,
						pulseTimer: 0.0
					});
				}

				// Attach a golden star point light to the main 3D game board scene
				if (scene && !this.boardStarLight) {
					this.boardStarLight = new THREE.PointLight(0xffcf40, 0.0, 22, 1.5);
					this.boardStarLight.position.set(0, 4.5, -5.5);
					scene.add(this.boardStarLight);
				}

				this.updatePositions();
				this.initialized = true;
			} catch (err) {
				console.warn('Star3DManager initialization error:', err);
			}
		},

		updatePositions: function () {
			if (!this.trackEl || !this.stars.length) return;
			var trackRect = this.trackEl.getBoundingClientRect();
			var trackCenterX = trackRect.left + trackRect.width / 2;

			for (var i = 0; i < 3; i++) {
				var nodeEl = document.getElementById('star-node-' + (i + 1));
				if (nodeEl) {
					var nodeRect = nodeEl.getBoundingClientRect();
					var nodeCenterX = nodeRect.left + nodeRect.width / 2;
					var dx = nodeCenterX - trackCenterX;
					if (Math.abs(dx) > 0.01) {
						this.stars[i].baseX = dx;
						this.stars[i].group.position.x = dx;
					}
				}
			}
		},

		onResize: function () {
			if (!this.initialized || !this.canvas || !this.renderer) return;
			var rect = this.canvas.getBoundingClientRect();
			this.canvasWidth = Math.max(220, rect.width || 264);
			this.canvasHeight = Math.max(68, rect.height || 88);
			this.dpr = Math.min(window.devicePixelRatio || 1, 2.0);

			this.renderer.setPixelRatio(this.dpr);
			this.renderer.setSize(this.canvasWidth, this.canvasHeight, false);

			var fov = 15;
			var fovRad = THREE.MathUtils.degToRad(fov);
			var camZ = (this.canvasHeight / 2) / Math.tan(fovRad / 2);
			this.camera.aspect = this.canvasWidth / this.canvasHeight;
			this.camera.position.set(0, 0, camZ);
			this.camera.updateProjectionMatrix();

			this.updatePositions();
		},

		reset: function () {
			if (!this.initialized) this.init();
			for (var i = 0; i < this.stars.length; i++) {
				var s = this.stars[i];
				s.isLit = false;
				s.targetLit = 0.0;
				s.litAmount = 0.0;
				s.spinVelocity = 0.0;
				s.popScale = 0.96;
				s.pulseTimer = 0.0;
				s.light.intensity = 0.0;
				s.mesh.material.color.setHex(0x64748b);
				s.mesh.material.emissive.setHex(0x000000);
				s.mesh.material.emissiveIntensity = 0.0;
				s.mesh.material.roughness = 0.34;
				s.mesh.material.metalness = 0.36;
				s.rimMesh.material.color.setHex(0x1e293b);
				s.rimMesh.material.emissiveIntensity = 0.0;
				s.glowMesh.material.opacity = 0;
				s.glowMesh.scale.set(0.1, 0.1, 0.1);
				s.flareMesh.material.opacity = 0;
				s.flareMesh.scale.set(0.1, 0.1, 0.1);
			}
			if (this.boardStarLight) {
				this.boardStarLight.intensity = 0.0;
			}
		},

		setStarsLit: function (count) {
			if (!this.initialized) this.init();
			if (!this.initialized) return;

			for (var i = 0; i < 3; i++) {
				var s = this.stars[i];
				var shouldBeLit = (i < count);

				if (shouldBeLit && !s.isLit) {
					s.isLit = true;
					s.targetLit = 1.0;
					// Crisp 3D spin & pop while preserving the 5-pointed star silhouette
					s.spinVelocity = 14.0;
					s.popScale = 1.36;
					s.light.intensity = 1.65;
					s.pulseTimer = 0.85;
					s.glowMesh.scale.set(1.25, 1.25, 1.25);
					s.flareMesh.scale.set(1.2, 1.2, 1.2);
				} else if (!shouldBeLit && s.isLit) {
					s.isLit = false;
					s.targetLit = 0.0;
				}
			}
		},

		celebrate: function (starsEarned) {
			if (!this.initialized) this.init();
			if (!this.initialized) return;

			var self = this;
			for (var i = 0; i < starsEarned; i++) {
				(function (idx) {
					setTimeout(function () {
						if (!self.stars[idx]) return;
						var s = self.stars[idx];
						s.spinVelocity = 16.0;
						s.popScale = 1.42;
						s.light.intensity = 1.85;
						s.pulseTimer = 1.0;
						s.glowMesh.scale.set(1.35, 1.35, 1.35);
						s.flareMesh.scale.set(1.3, 1.3, 1.3);
					}, idx * 190);
				})(i);
			}
		},

		pulseStar: function (starIndex) {
			if (!this.initialized) return;
			var s = this.stars[starIndex];
			if (!s) return;
			s.spinVelocity = 9.5;
			s.popScale = 1.28;
			s.light.intensity = 1.6;
			s.pulseTimer = 0.7;
			s.glowMesh.scale.set(1.2, 1.2, 1.2);
			s.flareMesh.scale.set(1.18, 1.18, 1.18);
		},

		render: function (now, dt) {
			if (!this.initialized) this.init();
			if (!this.initialized) return;

			dt = Math.min(dt || 0.016, 0.05);

			var dimColor = this._dimColor || (this._dimColor = new THREE.Color(0x64748b));
			var litColor = this._litColor || (this._litColor = new THREE.Color(0xffb700)); // Rich 24K Gold (never washes out to white)
			var dimRim = this._dimRim || (this._dimRim = new THREE.Color(0x1e293b));
			var litRim = this._litRim || (this._litRim = new THREE.Color(0x6b2f02));   // Deep burnished bronze rim to keep 5-pointed star outline razor-sharp

			var totalLitAmount = 0;

			for (var i = 0; i < this.stars.length; i++) {
				var s = this.stars[i];

				// 1. Smooth interpolation of lit state
				s.litAmount += (s.targetLit - s.litAmount) * Math.min(1.0, dt * 8.0);
				totalLitAmount += s.litAmount;

				var breath = Math.sin(now * 0.004 + i * 1.5) * 0.06;

				// 2. Dynamic 3D Material interpolation (preserving sharp 10-facet contrast!)
				s.mesh.material.color.copy(dimColor).lerp(litColor, s.litAmount);
				s.mesh.material.roughness = 0.34 - 0.08 * s.litAmount;
				s.mesh.material.metalness = 0.36 - 0.04 * s.litAmount;
				s.mesh.material.envMapIntensity = 0.65 + 0.15 * s.litAmount;
				s.mesh.material.emissive.setHex(0x8a3800);
				s.mesh.material.emissiveIntensity = Math.max(0, (0.18 + breath) * s.litAmount + s.pulseTimer * 0.25);

				s.rimMesh.material.color.copy(dimRim).lerp(litRim, s.litAmount);
				s.rimMesh.material.emissive.setHex(0x3d1800);
				s.rimMesh.material.emissiveIntensity = 0.12 * s.litAmount;

				// 3. Controlled Three.js PointLight when activated (highlights facets without clipping to white)
				if (s.litAmount < 0.02) {
					s.light.intensity = 0.0;
				} else {
					var targetLightInt = (1.10 + breath * 0.8) * s.litAmount + s.pulseTimer * 0.6;
					s.light.intensity += (targetLightInt - s.light.intensity) * Math.min(1.0, dt * 6.0);
					s.light.position.x = -7.0 + Math.sin(now * 0.003 + i * 1.4) * 4.0;
					s.light.position.y = 8.0 + Math.cos(now * 0.0035 + i * 1.4) * 3.0;
					s.light.position.z = 18.0;
				}

				// 4. Subtle Warm Golden Back-Glow strictly behind the star
				var glowBreath = Math.sin(now * 0.004 + i * 1.4) * 0.08;
				s.glowMesh.material.opacity = Math.max(0, (0.48 + glowBreath) * s.litAmount + s.pulseTimer * 0.22);
				var targetGlowScale = (0.98 + Math.sin(now * 0.0035 + i * 1.4) * 0.05) * (s.litAmount > 0.08 ? 1.0 : 0.1);
				s.glowMesh.scale.x += (targetGlowScale - s.glowMesh.scale.x) * Math.min(1.0, dt * 6.5);
				s.glowMesh.scale.y = s.glowMesh.scale.x;

				s.flareMesh.rotation.z += (0.005 + s.spinVelocity * 0.03);
				s.flareMesh.material.opacity = Math.max(0, (0.32 + glowBreath * 0.4) * s.litAmount + s.pulseTimer * 0.25);
				var targetFlareScale = (0.95 + Math.sin(now * 0.003 + i) * 0.05) * (s.litAmount > 0.08 ? 1.0 : 0.1);
				s.flareMesh.scale.x += (targetFlareScale - s.flareMesh.scale.x) * Math.min(1.0, dt * 6.5);
				s.flareMesh.scale.y = s.flareMesh.scale.x;

				// 5. 3D Rotation, Tilt & Floating Physics
				s.bodyPivot.rotation.y += s.spinVelocity * dt;
				s.spinVelocity = Math.max(0, s.spinVelocity - s.spinVelocity * 4.2 * dt);

				var idleTiltY = Math.sin(now * 0.0024 + i * 1.8) * 0.24;
				var idleTiltX = Math.cos(now * 0.0029 + i * 1.8) * 0.15;
				var idleBobY = Math.sin(now * 0.0032 + i * 1.8) * 1.0;

				if (s.litAmount < 0.1) {
					idleTiltY *= 0.45;
					idleTiltX = 0.10 + Math.cos(now * 0.002 + i) * 0.05;
					idleBobY *= 0.2;
				}

				s.bodyPivot.rotation.x = idleTiltX;
				if (s.spinVelocity < 0.05) {
					var curY = s.bodyPivot.rotation.y % (Math.PI * 2);
					s.bodyPivot.rotation.y += (idleTiltY - curY) * Math.min(1.0, dt * 4.5);
				}
				s.bodyPivot.position.y = idleBobY;
				s.glowMesh.position.y = idleBobY;
				s.flareMesh.position.y = idleBobY;

				// 6. Scale Pop decay
				var targetScale = (s.litAmount > 0.5 ? 1.15 : 0.96);
				s.popScale += (targetScale - s.popScale) * Math.min(1.0, dt * 7.0);
				s.bodyPivot.scale.set(s.popScale, s.popScale, s.popScale);

				// 7. Pulse timer decay
				s.pulseTimer = Math.max(0, s.pulseTimer - dt * 2.4);
			}

			// Illuminate top of main 3D game board when stars are activated
			if (this.boardStarLight) {
				this.boardStarLight.intensity = (totalLitAmount / 3.0) * 1.25;
			}

			this.renderer.render(this.scene, this.camera);
		}
	};
	global.Star3DManager = Star3DManager;

	// --------------------------------------------------------------------------
	// Speedometer & Speed Ranking Manager (3D Magical Gauge & Star Progress)
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
		lastTileSnapTime: 0,
		peakStarsAchieved: 0,
		peakSpeedAchieved: 0,
		levelFinished: false,
		levelCompletedForIndex: -1,
		lastCompletionResult: null,

		TIERS: [
			{ minWpm: 45, tier: 'S+', title: 'GODSPEED', cssTier: 'tier-godspeed', color: '#ff007f', gradient: 'linear-gradient(135deg, #ff007f, #ffd700)' },
			{ minWpm: 35, tier: 'S',  title: 'LIGHTNING', cssTier: 'tier-lightning', color: '#ec4899', gradient: 'linear-gradient(135deg, #ec4899, #a855f7)' },
			{ minWpm: 25, tier: 'A',  title: 'TURBO',     cssTier: 'tier-turbo', color: '#f59e0b', gradient: 'linear-gradient(135deg, #f59e0b, #ef4444)' },
			{ minWpm: 15, tier: 'B',  title: 'SWIFT',     cssTier: 'tier-swift', color: '#10b981', gradient: 'linear-gradient(135deg, #10b981, #06b6d4)' },
			{ minWpm: 0,  tier: 'C',  title: 'CRUISE',    cssTier: 'tier-cruise', color: '#00e5ff', gradient: 'linear-gradient(135deg, #00e5ff, #3b82f6)' }
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

			// Ensure legacy records have star ratings calculated
			var levels = this.records.levels || {};
			for (var k in levels) {
				if (levels[k] && levels[k].bestWpm && !levels[k].stars) {
					levels[k].stars = this.calculateStarsForWpm(levels[k].bestWpm);
				}
			}

			// Pre-populate demo records if speed=1 query parameter is set
			if (window.location && window.location.search && window.location.search.indexOf('speed=1') !== -1) {
				if (Object.keys(this.records.levels).length === 0) {
					this.records.levels[0] = { bestWpm: 34.2, bestTimeSec: 7.0, stars: 3, timestamp: Date.now() - 3600000 };
					this.records.levels[1] = { bestWpm: 42.0, bestTimeSec: 5.7, stars: 3, timestamp: Date.now() - 2400000 };
					this.records.levels[2] = { bestWpm: 24.5, bestTimeSec: 8.2, stars: 2, timestamp: Date.now() - 1200000 };
					this.records.levels[3] = { bestWpm: 46.8, bestTimeSec: 4.8, stars: 3, timestamp: Date.now() - 300000 };
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

		calculateStarsForWpm: function (wpm) {
			if (!wpm || wpm <= 0) return 0;
			if (wpm >= 18) return 3; // ⭐⭐⭐ Lightning Fast (>=18 WPM - just a little over 2 stars!)
			if (wpm >= 14) return 2; // ⭐⭐ Swift (>=14 WPM)
			if (wpm >= 8) return 1;  // ⭐ Steady (>=8 WPM)
			return 0;
		},

		getTotalStars: function () {
			var total = 0;
			var levels = this.records.levels || {};
			var allLevels = window.WORD_CHAIN_LEVELS || [];
			var count = allLevels.length || 30;
			for (var i = 0; i < count; i++) {
				var rec = levels[i];
				if (rec) {
					total += (rec.stars || this.calculateStarsForWpm(rec.bestWpm || 0));
				}
			}
			return total;
		},

		isLevelUnlocked: function (levelIndex) {
			if (levelIndex === 0) return true;
			var prev = this.records.levels && this.records.levels[levelIndex - 1];
			if (prev && (prev.bestWpm > 0 || prev.stars > 0)) return true;
			if (levelIndex <= (currentLevelIndex || 0)) return true;
			return false;
		},

		getResumeLevelIndex: function () {
			var allLevels = window.WORD_CHAIN_LEVELS || [];
			var maxLvl = allLevels.length || 30;

			var saved = null;
			try {
				saved = parseInt(localStorage.getItem('word_chain_last_level'), 10);
			} catch (e) {}

			var levels = (this.records && this.records.levels) || {};

			if (!isNaN(saved) && saved >= 0 && saved < maxLvl && this.isLevelUnlocked(saved)) {
				var rec = levels[saved];
				if (rec && rec.stars >= 1 && (saved + 1) < maxLvl && this.isLevelUnlocked(saved + 1)) {
					var nextRec = levels[saved + 1];
					if (!nextRec || !nextRec.stars) {
						return saved + 1;
					}
				}
				return saved;
			}

			// Find first level without stars among unlocked levels
			for (var i = 0; i < maxLvl; i++) {
				if (this.isLevelUnlocked(i)) {
					var r = levels[i];
					if (!r || !r.stars || r.stars < 1) {
						return i;
					}
				}
			}

			return 0;
		},

		checkDailyStreak: function () {
			var todayStr = new Date().toISOString().slice(0, 10);
			var lastLogin = null;
			var streak = 1;
			try {
				lastLogin = localStorage.getItem('word_chain_last_login_date');
				streak = parseInt(localStorage.getItem('word_chain_daily_streak') || '1', 10);
			} catch (e) {}
			if (isNaN(streak) || streak < 1) streak = 1;

			if (!lastLogin) {
				try {
					localStorage.setItem('word_chain_last_login_date', todayStr);
					localStorage.setItem('word_chain_daily_streak', '1');
				} catch (e) {}
				streak = 1;
			} else if (lastLogin !== todayStr) {
				var lastDate = new Date(lastLogin);
				var todayDate = new Date(todayStr);
				var diffDays = Math.round((todayDate - lastDate) / (1000 * 60 * 60 * 24));
				if (diffDays === 1) {
					streak += 1;
				} else if (diffDays > 1) {
					streak = 1;
				}
				try {
					localStorage.setItem('word_chain_last_login_date', todayStr);
					localStorage.setItem('word_chain_daily_streak', String(streak));
				} catch (e) {}
			}

			var lastClaimed = null;
			try {
				lastClaimed = localStorage.getItem('word_chain_last_gift_date');
			} catch (e) {}
			var canClaim = (lastClaimed !== todayStr);

			return {
				streak: streak,
				canClaim: canClaim,
				todayStr: todayStr
			};
		},

		claimDailyGift: function () {
			var streakInfo = this.checkDailyStreak();
			if (!streakInfo.canClaim) {
				showToast('🎁 Daily Bonus already claimed today! Come back tomorrow!');
				return false;
			}
			try {
				localStorage.setItem('word_chain_last_gift_date', streakInfo.todayStr);
				var storedKeys = parseInt(localStorage.getItem('word_chain_keys_balance') || '20', 10);
				if (isNaN(storedKeys)) storedKeys = 20;
				storedKeys += 10;
				localStorage.setItem('word_chain_keys_balance', String(storedKeys));
			} catch (e) {}

			var badgeEl = document.getElementById('key-count-badge');
			if (badgeEl) badgeEl.textContent = String(storedKeys || 30);

			AudioManager.play('greatJob', 0.95);
			AudioManager.haptic(40);
			showToast('🎉 +10 HINT KEYS CLAIMED! Daily streak: ' + streakInfo.streak + ' days 🔥');
			this.updateTitleScreenUI();
			return true;
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
			this.wrongAttemptsThisLevel = 0;
			this.currentLevelSpeed = 0;
			this.targetSpeed = 0;
			this.displayedSpeed = 0;
			this.peakStarsAchieved = 0;
			this.peakSpeedAchieved = 0;
			this.levelFinished = false;
			this.levelCompletedForIndex = -1;
			this.lastCompletionResult = null;
			this.isLevelActive = true;
			this.updateSettingsLevelUI(levelIndex);

			var numEl = document.getElementById('speedo-number');
			if (numEl) numEl.textContent = '0';
			this.applyTierVisuals(0);

			// Reset dynamic speed milestone star track
			this.resetStarTrack();

			var winCard = document.getElementById('win-speed-card');
			if (winCard) winCard.classList.remove('show');
			var celebCard = document.getElementById('win-celebration-card');
			if (celebCard) celebCard.classList.remove('show');
		},

		onTileInteraction: function () {
			// Do NOT artificially boost speed on tile movement (WPM measures actual solved words)
		},

		onIncorrectWord: function () {
			if (!this.isLevelActive || this.levelFinished) return;
			this.wrongAttemptsThisLevel = (this.wrongAttemptsThisLevel || 0) + 1;

			// HARD BRAKE: Immediate dramatic speed slash
			// Cut speed down by 75% or cap at low crawl (prevent spam-submitting exploit)
			this.targetSpeed = Math.max(0, Math.min(this.targetSpeed * 0.25, 6.0));
			this.displayedSpeed = Math.max(0, Math.min(this.displayedSpeed * 0.30, 5.0));

			// Reset lastWordSolveTime to now so next word cannot get free instantaneous speed
			this.lastWordSolveTime = performance.now();

			// Immediate visual feedback on speedometer
			var hudSpeedo = document.getElementById('hud-speedometer');
			if (hudSpeedo) {
				hudSpeedo.classList.remove('speedo-pulse');
				hudSpeedo.classList.add('speedo-brake');
				setTimeout(function () {
					hudSpeedo.classList.remove('speedo-brake');
				}, 480);
			}

			// Immediately update numeric display, gauge tier, and dynamic stars
			if (this.numEl) {
				this.numEl.textContent = Math.round(this.displayedSpeed);
			}
			this.applyTierVisuals(this.displayedSpeed);
			this.updateStarTrack(this.displayedSpeed);

			// Brake shudder haptics
			AudioManager.haptic(60);
			setTimeout(function () { AudioManager.haptic(45); }, 90);
		},

		onWordSolved: function (wordIdx, totalWords) {
			if (this.levelFinished) return;
			var now = performance.now();
			this.wordsSolvedThisLevel++;

			// Instantaneous WPM for this specific word
			var wordElapsedSec = Math.max(0.4, (now - this.lastWordSolveTime) / 1000);
			var instantWpm = Math.min(80, (1 / wordElapsedSec) * 60);

			// Cumulative level WPM
			var totalElapsedSec = Math.max(0.8, (now - this.levelStartTime) / 1000);
			var cumulativeWpm = (this.wordsSolvedThisLevel / totalElapsedSec) * 60;

			var activeWpm = Math.max(instantWpm, cumulativeWpm);
			this.currentLevelSpeed = Math.round(activeWpm * 10) / 10;
			this.lastWordSolveTime = now;

			// Rev the needle towards whichever is faster
			this.targetSpeed = Math.min(80, activeWpm);
			this.displayedSpeed = Math.max(this.displayedSpeed, activeWpm * 0.9);
			this.peakSpeedAchieved = Math.max(this.peakSpeedAchieved, this.targetSpeed);

			// Update peak stars achieved
			var currentStars = this.calculateStarsForWpm(this.targetSpeed);
			if (currentStars > this.peakStarsAchieved) {
				this.peakStarsAchieved = currentStars;
			}

			// Visual pulse feedback on speedometer
			var hudSpeedo = document.getElementById('hud-speedometer');
			if (hudSpeedo) {
				hudSpeedo.classList.add('speedo-pulse');
				setTimeout(function () {
					hudSpeedo.classList.remove('speedo-pulse');
				}, 450);
			}

			this.updateStarTrack(this.displayedSpeed);
		},

		onLevelCompleted: function (levelIndex) {
			if (this.levelFinished && this.levelCompletedForIndex === levelIndex) {
				return this.lastCompletionResult;
			}
			this.levelFinished = true;
			this.isLevelActive = false;
			this.levelCompletedForIndex = levelIndex;

			var totalElapsedSec = Math.max(0.8, (performance.now() - this.levelStartTime) / 1000);
			var wordsCount = Math.max(1, this.wordsSolvedThisLevel || (currentLevelData ? currentLevelData.words.length - 1 : 4));
			// Each wrong attempt penalizes final WPM by 15% (minimum floor 35%)
			var penaltyFactor = Math.max(0.35, 1.0 - (this.wrongAttemptsThisLevel || 0) * 0.15);
			var rawWpm = (wordsCount / totalElapsedSec) * 60;
			var finalWpm = Math.round(rawWpm * penaltyFactor * 10) / 10;

			// Preserve the player's peak speed representation
			var displayWpm = Math.max(finalWpm, this.displayedSpeed, (this.peakSpeedAchieved || 0) * 0.85);
			this.currentLevelSpeed = finalWpm;
			this.displayedSpeed = displayWpm;
			this.targetSpeed = displayWpm;

			// Final stars earned: at least the peak stars achieved during this run, or from finalWpm, minimum 1
			var starsEarned = Math.max(1, this.peakStarsAchieved || 0, this.calculateStarsForWpm(finalWpm));
			this.peakStarsAchieved = starsEarned;

			var prevRecord = (this.records.levels && this.records.levels[levelIndex]) || {};
			var prevStars = prevRecord.stars || this.calculateStarsForWpm(prevRecord.bestWpm || 0);
			var bestStars = Math.max(prevStars, starsEarned);
			var bestWpm = Math.max(prevRecord.bestWpm || 0, finalWpm);
			var isNewRecord = !prevRecord.bestWpm || finalWpm > prevRecord.bestWpm;
			this.isLastRunNewRecord = isNewRecord;

			if (!this.records.levels) this.records.levels = {};
			this.records.levels[levelIndex] = {
				bestWpm: bestWpm,
				bestTimeSec: prevRecord.bestTimeSec ? Math.min(prevRecord.bestTimeSec, Math.round(totalElapsedSec * 10) / 10) : Math.round(totalElapsedSec * 10) / 10,
				stars: bestStars,
				lastWpm: finalWpm,
				lastStars: starsEarned,
				timestamp: Date.now()
			};
			this.saveRecords();

			// Play the end-of-level Star Celebration FX and keep stars lit with periodic fireworks
			this.playStarCelebrationFX(starsEarned);
			this.startPeriodicStarFireworks(starsEarned);

			// Freeze needle and gauge visually on winning speed
			if (!this.domCached) this.cacheDOMElements();
			if (this.numEl) this.numEl.textContent = Math.round(displayWpm);
			this.applyTierVisuals(displayWpm);
			var angle = (Math.min(60, Math.max(0, displayWpm)) / 60) * 180 - 90;
			if (this.needleGroup) {
				this.needleGroup.setAttribute('transform', 'rotate(' + angle.toFixed(1) + ' 50 50)');
			}
			if (this.fillEl) {
				var fillOffset = 115 - (Math.min(60, Math.max(0, displayWpm)) / 60) * 115;
				this.fillEl.style.strokeDashoffset = fillOffset.toFixed(1);
			}

			this.updateTitleScreenUI();
			this.updateSettingsLevelUI(levelIndex);

			this.lastCompletionResult = { finalWpm: finalWpm, starsEarned: starsEarned, isNewRecord: isNewRecord };
			return this.lastCompletionResult;
		},

		domCached: false,
		numEl: null,
		needleGroup: null,
		fillEl: null,
		hudSpeedo: null,
		auraEl: null,
		badgeEl: null,
		lastRoundedSpeed: -1,
		lastAngleFixed: '',
		lastFillOffsetFixed: '',
		lastTierClass: '',

		// Dynamic Speed Milestone Stars state & cache
		starTrackCached: false,
		starTrackEl: null,
		starFillEl: null,
		starNode1: null,
		starNode2: null,
		starNode3: null,
		lastStarsLit: -1,

		cacheStarTrackElements: function () {
			this.starTrackEl = document.getElementById('hud-star-track');
			this.starFillEl = document.getElementById('star-track-line-fill');
			this.starNode1 = document.getElementById('star-node-1');
			this.starNode2 = document.getElementById('star-node-2');
			this.starNode3 = document.getElementById('star-node-3');
			this.starTrackCached = true;
			if (typeof Star3DManager !== 'undefined' && typeof Star3DManager.init === 'function') {
				Star3DManager.init();
			}
		},

		resetStarTrack: function () {
			this.stopPeriodicStarFireworks();
			if (!this.starTrackCached) this.cacheStarTrackElements();
			if (!this.starTrackEl) return;
			this.starTrackEl.classList.remove('celebrate-3', 'celebrate-2', 'celebrate-1');
			if (this.starFillEl) this.starFillEl.style.width = '0%';
			for (var i = 1; i <= 3; i++) {
				var node = this['starNode' + i];
				if (node) {
					node.classList.remove('lit');
					node.classList.add('dim');
				}
			}
			this.lastStarsLit = 0;
			if (typeof Star3DManager !== 'undefined' && typeof Star3DManager.reset === 'function') {
				Star3DManager.reset();
			}
			var oldSparks = document.querySelectorAll('.star-sparkle-dot, .star-firework-particle, .star-firework-flash');
			oldSparks.forEach(function (el) { el.remove(); });
		},

		updateStarTrack: function (speed) {
			if (!this.starTrackCached) this.cacheStarTrackElements();
			if (!this.starTrackEl) return;

			var speedStars = 0;
			if (speed >= 18) speedStars = 3;
			else if (speed >= 14) speedStars = 2;
			else if (speed >= 8) speedStars = 1;

			// CRITICAL: Star milestones won are SAVED for this match!
			// Stars achieved NEVER fall back to 0 when the needle relaxes or when pauses occur!
			var starsLit = Math.max(speedStars, this.peakStarsAchieved || 0);
			if (starsLit > (this.peakStarsAchieved || 0)) {
				this.peakStarsAchieved = starsLit;
			}

			// Proportional fill calculation from 0% to 100%
			// 0% = Star 1 node (8 WPM)
			// 50% = Star 2 node (14 WPM)
			// 100% = Star 3 node (18 WPM - just a little over 2 stars!)
			var fillPct = 0;
			if (speed >= 18) {
				fillPct = 100;
			} else if (speed >= 14) {
				fillPct = 50 + ((speed - 14) / 4) * 50;
			} else if (speed >= 8) {
				fillPct = ((speed - 8) / 6) * 50;
			} else {
				fillPct = 0;
			}
			// Fill line also honors the earned star floor
			if (starsLit >= 3) {
				fillPct = Math.max(fillPct, 100);
			} else if (starsLit >= 2) {
				fillPct = Math.max(fillPct, 50);
			}
			fillPct = Math.min(100, Math.max(0, fillPct));

			if (this.starFillEl) {
				var fillPctStr = fillPct.toFixed(1) + '%';
				if (this.lastFillPctStr !== fillPctStr) {
					this.lastFillPctStr = fillPctStr;
					this.starFillEl.style.width = fillPctStr;
				}
			}

			// Update star nodes dynamically
			for (var i = 1; i <= 3; i++) {
				var node = this['starNode' + i];
				if (!node) continue;
				var shouldBeLit = (i <= starsLit);
				var isLit = node.classList.contains('lit');

				if (shouldBeLit && !isLit) {
					node.classList.add('lit');
					node.classList.remove('dim');
					if (this.isLevelActive && starsLit > this.lastStarsLit) {
						AudioManager.play('tilehit', 0.55);
						AudioManager.haptic(22);
					}
				} else if (!shouldBeLit && isLit) {
					node.classList.remove('lit');
					node.classList.add('dim');
				}
			}
			if (typeof Star3DManager !== 'undefined' && typeof Star3DManager.setStarsLit === 'function') {
				Star3DManager.setStarsLit(starsLit);
			}
			this.lastStarsLit = starsLit;
		},

		playStarCelebrationFX: function (starsEarned) {
			if (!this.starTrackCached) this.cacheStarTrackElements();
			if (!this.starTrackEl) return;

			this.starTrackEl.classList.remove('celebrate-3', 'celebrate-2', 'celebrate-1');

			for (var i = 1; i <= 3; i++) {
				var node = this['starNode' + i];
				if (!node) continue;
				if (i <= starsEarned) {
					node.classList.add('lit');
					node.classList.remove('dim');
				} else {
					node.classList.remove('lit');
					node.classList.add('dim');
				}
			}

			if (this.starFillEl) {
				var fillPct = (starsEarned >= 3) ? 100 : (starsEarned === 2 ? 50 : 0);
				this.starFillEl.style.width = fillPct + '%';
			}

			if (typeof Star3DManager !== 'undefined' && typeof Star3DManager.celebrate === 'function') {
				Star3DManager.celebrate(starsEarned);
			}

			if (starsEarned >= 3) {
				this.starTrackEl.classList.add('celebrate-3');
				this.spawnStarSparkles(3);
				AudioManager.play('greatJob', 1.0);
				AudioManager.haptic(50);
				setTimeout(function () { AudioManager.haptic(40); }, 180);
				setTimeout(function () { AudioManager.haptic(60); }, 360);
			} else if (starsEarned === 2) {
				this.starTrackEl.classList.add('celebrate-2');
				this.spawnStarSparkles(2);
				AudioManager.play('tilehit', 0.95);
				AudioManager.haptic(45);
				setTimeout(function () { AudioManager.haptic(35); }, 180);
			} else if (starsEarned === 1) {
				this.starTrackEl.classList.add('celebrate-1');
				this.spawnStarSparkles(1);
				AudioManager.play('tilehit', 0.85);
				AudioManager.haptic(35);
			}
		},

		spawnStarSparkles: function (starCount) {
			var track = this.starTrackEl;
			if (!track) return;

			var oldSparks = track.querySelectorAll('.star-sparkle-dot');
			oldSparks.forEach(function (el) { el.remove(); });

			for (var s = 1; s <= starCount; s++) {
				var node = this['starNode' + s];
				if (!node) continue;
				var rect = node.getBoundingClientRect();
				var trackRect = track.getBoundingClientRect();
				var originX = (rect.left + rect.width / 2) - trackRect.left;
				var originY = (rect.top + rect.height / 2) - trackRect.top;

				var numParticles = (starCount === 3) ? 8 : (starCount === 2 ? 6 : 4);
				for (var p = 0; p < numParticles; p++) {
					var dot = document.createElement('div');
					dot.className = 'star-sparkle-dot';
					var angle = (p / numParticles) * Math.PI * 2 + (Math.random() * 0.4 - 0.2);
					var dist = 14 + Math.random() * 16;
					var dx = Math.cos(angle) * dist;
					var dy = Math.sin(angle) * dist;
					var size = 3 + Math.random() * 3.5;

					dot.style.left = originX + 'px';
					dot.style.top = originY + 'px';
					dot.style.width = size + 'px';
					dot.style.height = size + 'px';
					dot.style.setProperty('--dx', dx.toFixed(1) + 'px');
					dot.style.setProperty('--dy', dy.toFixed(1) + 'px');
					dot.style.animationDelay = (p * 0.04) + 's';

					track.appendChild(dot);
					(function (elem) {
						setTimeout(function () { elem.remove(); }, 900);
					})(dot);
				}
			}
		},

		starFireworksInterval: null,

		startPeriodicStarFireworks: function (starsEarned) {
			this.stopPeriodicStarFireworks();
			if (!starsEarned || starsEarned <= 0) return;

			var self = this;
			// Initial volley right after victory fanfare
			setTimeout(function () {
				if (isCelebratingWin || self.levelFinished) self.fireStarFireworks(starsEarned);
			}, 320);

			// Periodic firework bursts launched from each earned star every 1.65 seconds
			this.starFireworksInterval = setInterval(function () {
				if (isCelebratingWin || self.levelFinished) {
					self.fireStarFireworks(starsEarned);
				} else {
					self.stopPeriodicStarFireworks();
				}
			}, 1650);
		},

		stopPeriodicStarFireworks: function () {
			if (this.starFireworksInterval) {
				clearInterval(this.starFireworksInterval);
				this.starFireworksInterval = null;
			}
			document.querySelectorAll('.star-firework-particle, .star-firework-flash').forEach(function (el) {
				el.remove();
			});
		},

		fireStarFireworks: function (starsEarned) {
			if (!this.starTrackEl) return;
			var self = this;

			for (var s = 1; s <= starsEarned; s++) {
				(function (starIdx) {
					setTimeout(function () {
						if (!isCelebratingWin && !self.levelFinished) return;
						self.launchSingleStarFirework(starIdx);
					}, (starIdx - 1) * 220);
				})(s);
			}
		},

		launchSingleStarFirework: function (starIdx) {
			var node = this['starNode' + starIdx];
			if (!node) return;

			// Tactile micro-pulse on the 3D star node
			if (typeof Star3DManager !== 'undefined' && typeof Star3DManager.pulseStar === 'function') {
				Star3DManager.pulseStar(starIdx - 1);
			}
			var starTarget = node.querySelector('.star-3d-group') || node.querySelector('.star-track-svg') || node;
			if (starTarget) {
				starTarget.style.animation = 'none';
				void starTarget.offsetWidth;
				starTarget.style.animation = 'starFireworkPulse 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)';
			}

			var rect = node.getBoundingClientRect();
			var screenX = rect.left + rect.width / 2;
			var screenY = rect.top + rect.height / 2;

			var fireworkColors = [
				'#ffd700', '#ffffff', '#ff9500', '#00e5ff',
				'#ff007f', '#a855f7', '#10b981', '#f59e0b', '#38bdf8'
			];
			var particleCount = 18;

			for (var i = 0; i < particleCount; i++) {
				var p = document.createElement('div');
				p.className = 'star-firework-particle';
				var color = fireworkColors[i % fireworkColors.length];
				p.style.backgroundColor = color;
				p.style.color = color;

				var angle = (i / particleCount) * Math.PI * 2 + (Math.random() * 0.30 - 0.15);
				var dist = 26 + Math.random() * 32;
				var fx = Math.cos(angle) * dist;
				var fy = Math.sin(angle) * dist - 16; // upward arc
				var size = 4.0 + Math.random() * 3.5;

				p.style.width = size + 'px';
				p.style.height = size + 'px';
				p.style.left = screenX + 'px';
				p.style.top = screenY + 'px';
				p.style.setProperty('--fx', fx.toFixed(1) + 'px');
				p.style.setProperty('--fy', fy.toFixed(1) + 'px');

				document.body.appendChild(p);

				(function (elem) {
					setTimeout(function () {
						if (elem && elem.parentNode) elem.remove();
					}, 900);
				})(p);
			}

			// Bright central flash
			var flash = document.createElement('div');
			flash.className = 'star-firework-flash';
			flash.style.left = screenX + 'px';
			flash.style.top = screenY + 'px';
			document.body.appendChild(flash);
			setTimeout(function () {
				if (flash && flash.parentNode) flash.remove();
			}, 450);

			AudioManager.play('tilehit', 0.85);
			AudioManager.haptic(20);
		},

		cacheDOMElements: function () {
			this.numEl = document.getElementById('speedo-number');
			this.needleGroup = document.getElementById('speedo-needle-group') || document.getElementById('speedo-needle');
			this.fillEl = document.getElementById('speedo-fill');
			this.hudSpeedo = document.getElementById('hud-speedometer');
			this.auraEl = document.getElementById('speedo-magical-aura');
			this.badgeEl = document.getElementById('speedo-sub-badge');
			this.cacheStarTrackElements();
			this.domCached = true;
		},

		applyTierVisuals: function (speed) {
			if (!this.domCached) this.cacheDOMElements();
			var tier = this.getTierForWpm(speed);
			if (tier.cssTier === this.lastTierClass) return;
			this.lastTierClass = tier.cssTier;

			if (this.hudSpeedo) {
				this.hudSpeedo.classList.remove('tier-cruise', 'tier-swift', 'tier-turbo', 'tier-lightning', 'tier-godspeed');
				this.hudSpeedo.classList.add(tier.cssTier);
			}
			if (this.auraEl) {
				this.auraEl.classList.remove('tier-cruise', 'tier-swift', 'tier-turbo', 'tier-lightning', 'tier-godspeed');
				this.auraEl.classList.add(tier.cssTier);
			}

			if (this.badgeEl) {
				if (speed >= 45) {
					this.badgeEl.textContent = 'GODSPEED 🌟';
					this.badgeEl.style.color = '#ff007f';
				} else if (speed >= 35) {
					this.badgeEl.textContent = 'LIGHTNING ⚡';
					this.badgeEl.style.color = '#ec4899';
				} else if (speed >= 25) {
					this.badgeEl.textContent = 'TURBO 🔥';
					this.badgeEl.style.color = '#f59e0b';
				} else if (speed >= 15) {
					this.badgeEl.textContent = 'SWIFT ✨';
					this.badgeEl.style.color = '#10b981';
				} else {
					this.badgeEl.textContent = 'CRUISE';
					this.badgeEl.style.color = '#00e5ff';
				}
			}
		},

		updateLoop: function () {
			if (!this.isLevelActive || this.levelFinished) return;
			if (!this.domCached) this.cacheDOMElements();

			var now = performance.now();
			var totalElapsedSec = Math.max(1.0, (now - this.levelStartTime) / 1000);
			var runningCumulativeWpm = (this.wordsSolvedThisLevel / totalElapsedSec) * 60;

			// Rather than decaying artificially to 0, gently relax toward the player's true running pace
			if (this.wordsSolvedThisLevel > 0) {
				if (this.targetSpeed > runningCumulativeWpm) {
					this.targetSpeed = Math.max(runningCumulativeWpm, this.targetSpeed - 0.025);
				}
			} else {
				if (this.targetSpeed > 0) {
					this.targetSpeed = Math.max(0, this.targetSpeed - 0.015);
				}
			}

			// Springy interpolation
			this.displayedSpeed += (this.targetSpeed - this.displayedSpeed) * 0.14;

			var roundedSpeed = Math.round(this.displayedSpeed);
			if (roundedSpeed !== this.lastRoundedSpeed) {
				this.lastRoundedSpeed = roundedSpeed;
				if (this.numEl) this.numEl.textContent = roundedSpeed;
			}

			// Needle angle: 0 WPM -> -90deg, 60 WPM -> +90deg
			var angle = (Math.min(60, Math.max(0, this.displayedSpeed)) / 60) * 180 - 90;

			// Smooth mechanical oscillation at high speeds (no random frame-to-frame flicker)
			if (this.displayedSpeed >= 25) {
				var jitterAmp = Math.min(1.2, (this.displayedSpeed - 25) * 0.04);
				angle += Math.sin(now * 0.035) * jitterAmp;
			}

			var angleStr = angle.toFixed(1);
			if (angleStr !== this.lastAngleFixed) {
				this.lastAngleFixed = angleStr;
				if (this.needleGroup) {
					this.needleGroup.setAttribute('transform', 'rotate(' + angleStr + ' 50 50)');
				}
			}

			// Gauge arc fill offset (115 is empty, 0 is full)
			var fillOffset = 115 - (Math.min(60, Math.max(0, this.displayedSpeed)) / 60) * 115;
			var fillOffsetStr = fillOffset.toFixed(1);
			if (fillOffsetStr !== this.lastFillOffsetFixed) {
				this.lastFillOffsetFixed = fillOffsetStr;
				if (this.fillEl) {
					this.fillEl.style.strokeDashoffset = fillOffsetStr;
				}
			}

			this.applyTierVisuals(this.displayedSpeed);
			this.updateStarTrack(this.displayedSpeed);
		},

		renderLevelSelectModal: function () {
			var gridEl = document.getElementById('level-select-grid');
			var totalStarsEl = document.getElementById('level-select-total-stars');
			if (!gridEl) return;

			var allLevels = window.WORD_CHAIN_LEVELS || [];
			var totalStars = this.getTotalStars();
			if (totalStarsEl) totalStarsEl.textContent = totalStars;

			gridEl.innerHTML = '';
			for (var i = 0; i < allLevels.length; i++) {
				var lvlData = allLevels[i];
				var rec = this.records.levels && this.records.levels[i];
				var isUnlocked = this.isLevelUnlocked(i);
				var isCurrent = (i === currentLevelIndex);
				var bestWpm = rec ? (rec.bestWpm || 0) : 0;
				var stars = rec ? (rec.stars || this.calculateStarsForWpm(bestWpm)) : 0;
				var wordCount = (lvlData && lvlData.words) ? lvlData.words.length : 5;
				var levelName = getLevelName(i);

				var card = document.createElement('div');
				card.className = 'level-grid-card' +
					(isUnlocked ? ' unlocked' : ' locked') +
					(isCurrent ? ' current' : '') +
					(stars > 0 ? ' completed' : '');
				card.setAttribute('data-level-index', i);

				var header = document.createElement('div');
				header.className = 'card-lvl-header';
				header.innerHTML = '<span class="card-lvl-badge">LVL ' + (i + 1) + '</span>' +
					(isCurrent ? '<span class="card-current-tag">ACTIVE</span>' : '');
				card.appendChild(header);

				var nameEl = document.createElement('div');
				nameEl.className = 'card-level-name';
				nameEl.textContent = levelName;
				card.appendChild(nameEl);

				var wordsInfo = document.createElement('div');
				wordsInfo.className = 'card-words-count';
				wordsInfo.textContent = wordCount + ' Words';
				card.appendChild(wordsInfo);

				// 3 Stars display
				var starsDiv = document.createElement('div');
				starsDiv.className = 'card-stars-row';
				for (var s = 1; s <= 3; s++) {
					var starSpan = document.createElement('span');
					starSpan.className = 'lvl-star ' + (s <= stars ? 'earned' : 'empty');
					starSpan.textContent = (s <= stars ? '⭐' : '★');
					starsDiv.appendChild(starSpan);
				}
				card.appendChild(starsDiv);

				var speedDiv = document.createElement('div');
				speedDiv.className = 'card-speed-badge';
				if (bestWpm > 0) {
					speedDiv.innerHTML = '⚡ ' + bestWpm + ' <span class="wpm-unit">WPM</span>';
				} else if (isUnlocked) {
					speedDiv.textContent = 'READY ▶';
				} else {
					speedDiv.innerHTML = '🔒 LOCKED';
				}
				card.appendChild(speedDiv);

				if (isUnlocked) {
					(function (targetIdx) {
						card.addEventListener('click', function () {
							loadLevel(targetIdx);
							hideLevelSelectModal();
							AudioManager.play('tilehit', 0.9);
							AudioManager.haptic(30);
						});
					})(i);
				}

				gridEl.appendChild(card);
			}
		},

		getOverallStats: function () {
			var levels = this.records.levels || {};
			var keys = Object.keys(levels);
			var count = keys.length;
			if (count === 0) {
				return {
					tierObj: this.TIERS[this.TIERS.length - 1],
					avgWpm: 0,
					peakWpm: 0,
					completedCount: 0,
					totalStars: 0
				};
			}

			var sumWpm = 0;
			var peakWpm = 0;
			var self = this;
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
				completedCount: count,
				totalStars: this.getTotalStars()
			};
		},

		updateTitleScreenUI: function () {
			var stats = this.getOverallStats();
			var streakInfo = this.checkDailyStreak();
			var resumeIdx = this.getResumeLevelIndex();
			var allLevels = window.WORD_CHAIN_LEVELS || [];
			var maxLvl = allLevels.length || 30;
			var resumeLvlName = getLevelName(resumeIdx);
			var isReturning = stats.completedCount > 0;

			// 1. Streak Pill
			var streakText = document.getElementById('title-streak-text');
			if (streakText) {
				streakText.textContent = streakInfo.streak + '-DAY STREAK';
			}

			// 2. Rank Pill
			var tierEl = document.getElementById('title-rank-tier');
			if (tierEl) {
				tierEl.textContent = 'RANK ' + stats.tierObj.tier;
				tierEl.style.background = stats.tierObj.gradient;
			}

			// 3. Daily Gift Button
			var giftBtn = document.getElementById('btn-daily-gift');
			var giftLabel = document.getElementById('title-gift-label');
			if (giftBtn && giftLabel) {
				if (streakInfo.canClaim) {
					giftBtn.classList.add('claimable');
					giftBtn.classList.remove('claimed');
					giftLabel.textContent = '+10 KEYS';
				} else {
					giftBtn.classList.remove('claimable');
					giftBtn.classList.add('claimed');
					giftLabel.textContent = 'CLAIMED';
				}
			}

			// 4. Level Spotlight
			var badgeEl = document.getElementById('title-resume-badge');
			var starsSummary = document.getElementById('title-total-stars-summary');
			var lvlNumEl = document.getElementById('title-resume-lvl-num');
			var lvlNameEl = document.getElementById('title-resume-lvl-name');
			var fillEl = document.getElementById('title-progress-fill');
			var textEl = document.getElementById('title-progress-text');

			if (badgeEl) {
				badgeEl.textContent = isReturning ? 'RESUME GAME' : 'GET STARTED';
			}
			if (starsSummary) {
				starsSummary.textContent = '⭐ ' + stats.totalStars + '/' + (maxLvl * 3) + ' STARS';
			}
			if (lvlNumEl) {
				lvlNumEl.textContent = 'LVL ' + (resumeIdx + 1) + ':';
			}
			if (lvlNameEl) {
				lvlNameEl.textContent = resumeLvlName;
			}
			if (fillEl) {
				var pct = Math.max(3, Math.min(100, Math.round((stats.completedCount / maxLvl) * 100)));
				fillEl.style.width = pct + '%';
			}
			if (textEl) {
				textEl.textContent = stats.completedCount + ' / ' + maxLvl + ' Levels Solved (' + Math.round((stats.completedCount / maxLvl) * 100) + '%)';
			}

			// 5. Play Button Labels
			var playMain = document.getElementById('title-play-btn-label');
			var playSub = document.getElementById('title-play-sub-label');
			if (playMain) {
				playMain.textContent = isReturning ? ('CONTINUE LVL ' + (resumeIdx + 1)) : 'START GAME';
			}
			if (playSub) {
				playSub.textContent = isReturning ? ('Word: ' + resumeLvlName + ' • Tap to Play!') : 'Level 1: TENNIS • Tap to Play!';
			}
		},

		updateSettingsLevelUI: function (levelIndex) {
			var numEl = document.getElementById('settings-level-num');
			var nameEl = document.getElementById('settings-level-name');
			var levelName = getLevelName(levelIndex);
			if (numEl) numEl.textContent = (levelIndex + 1);
			if (nameEl) nameEl.textContent = levelName;

			var homeNumEl = document.getElementById('home-level-num');
			var homeNameEl = document.getElementById('home-level-name');
			if (homeNumEl) homeNumEl.textContent = (levelIndex + 1);
			if (homeNameEl) homeNameEl.textContent = levelName;

			var recEl = document.getElementById('settings-level-record');
			var homeRecEl = document.getElementById('home-level-record');
			var rec = this.records.levels && this.records.levels[levelIndex];
			var recText = '';
			var recColor = '#94a3b8';
			if (rec && rec.bestWpm) {
				var starsStr = '';
				var starCount = rec.stars || this.calculateStarsForWpm(rec.bestWpm);
				for (var s = 0; s < starCount; s++) starsStr += '⭐';
				recText = '⚡ Best: ' + rec.bestWpm + ' WPM (' + rec.bestTimeSec + 's) ' + starsStr;
				recColor = '#ffd700';
			} else {
				recText = '⚡ Best: -- WPM (Unsolved)';
				recColor = '#94a3b8';
			}
			if (recEl) {
				recEl.textContent = recText;
				recEl.style.color = recColor;
			}
			if (homeRecEl) {
				homeRecEl.textContent = recText;
				homeRecEl.style.color = recColor;
			}
		}
	};

	// --------------------------------------------------------------------------
	// Colyseus Multiplayer VS Mode, Friend Rooms & Real Ghost Run Recorder
	// --------------------------------------------------------------------------
	var MultiplayerManager = {
		PLAYER_ID_KEY: 'word_chain_player_id_v1',
		USERNAME_STORAGE_KEY: 'word_chain_vs_username',
		AVATAR_STORAGE_KEY: 'word_chain_vs_avatar',
		STATS_STORAGE_KEY: 'word_chain_vs_stats_v1',
		WORD_CROWNS_KEY: 'word_chain_word_crowns_v1',
		PENDING_RUNS_KEY: 'word_chain_pending_runs_v1',
		SERVER_URL_KEY: 'word_chain_server_url',
		AVATARS: [
			'Character_1.png',
			'Character_2.png',
			'Character_3.png',
			'Character_4.png',
			'Character_5.png',
			'Character_6.png',
			'Character_7.png',
			'Character_8.png',
			'Character_9.png'
		],

		playerId: '',
		playerUsername: '',
		opponentUsername: 'Opponent',
		isActive: false,
		isSearching: false,
		playerAvatar: 'Character_8.png',
		opponentAvatar: 'Character_9.png',
		playerBaseWpm: 11,
		opponentTargetWpm: 12,
		playerLiveWpm: 0,
		opponentLiveWpm: 0,
		wordCrowns: 0,
		matchesPlayed: 0,
		matchesWon: 0,
		tempProfileAvatar: null,
		lastEarnedCrowns: 0,
		p1MatchCrowns: 0,
		p2MatchCrowns: 0,

		// Colyseus state
		colyseusClient: null,
		room: null,
		mySlot: 'p1',         // 'p1' or 'p2' on server; local player is ALWAYS Blue (left) on screen
		matchMode: 'live',    // 'live' | 'friend' | 'ghost'
		roomCode: null,
		canRematch: false,

		// Race progress
		raceStarted: false,
		raceStartTime: 0,
		playerRowsSolved: 0,
		opponentRowsSolved: 0,
		firstSolverByRow: {}, // rowIndex -> 'p1' (you / Blue) | 'p2' (opponent / Red)
		matchFinished: false,
		winner: null,         // 'p1' (you / Blue) | 'p2' (opponent / Red)
		lastVsLevelIndex: -1,
		lastMatchSummary: null,
		resultsInteractiveAt: 0,
		resultsRevealTimeout: null,
		rematchWaitTimer: null,
		rematchAbortTimer: null,

		// Solo run recording for genuine Ghost source material
		soloRunActive: false,
		soloRunLevelIndex: -1,
		soloRunStartMs: 0,
		soloRowSolveTimesMs: [],

		searchInterval: null,
		searchTimeout: null,
		recentWpms: [],

		init: function () {
			try {
				var pid = localStorage.getItem(this.PLAYER_ID_KEY);
				if (!pid || pid.length < 6) {
					pid = 'wc_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
					localStorage.setItem(this.PLAYER_ID_KEY, pid);
				}
				this.playerId = pid;

				var savedUsername = localStorage.getItem(this.USERNAME_STORAGE_KEY);
				if (savedUsername) {
					this.playerUsername = this.cleanUsername(savedUsername);
				}

				var savedAvatar = localStorage.getItem(this.AVATAR_STORAGE_KEY);
				if (savedAvatar && this.AVATARS.indexOf(savedAvatar) !== -1) {
					this.playerAvatar = savedAvatar;
				}

				var savedCrowns = parseInt(localStorage.getItem(this.WORD_CROWNS_KEY) || '0', 10);
				this.wordCrowns = (isNaN(savedCrowns) || savedCrowns < 0) ? 0 : savedCrowns;

				var savedStats = localStorage.getItem(this.STATS_STORAGE_KEY);
				if (savedStats) {
					var parsed = JSON.parse(savedStats);
					if (parsed && Array.isArray(parsed.recentWpms)) {
						this.recentWpms = parsed.recentWpms.filter(function (n) {
							return typeof n === 'number' && isFinite(n) && n > 0;
						}).slice(-6);
					}
					if (parsed && typeof parsed.matchesPlayed === 'number') {
						this.matchesPlayed = parsed.matchesPlayed;
					}
					if (parsed && typeof parsed.matchesWon === 'number') {
						this.matchesWon = parsed.matchesWon;
					}
				}
			} catch (e) {
				this.playerId = 'wc_' + Math.random().toString(36).slice(2, 10);
			}

			this.pickPreviewOpponent();
			this.syncTitleButtonAvatars();
			this.bindModalEvents();
			this.updateProfileUI();
			this.flushPendingRuns();
		},

		getServerEndpoints: function () {
			var custom = null;
			try {
				var params = new URLSearchParams(window.location.search);
				custom = params.get('server') || window.WORD_CHAIN_SERVER_URL || localStorage.getItem(this.SERVER_URL_KEY);
			} catch (e) {}

			if (custom) {
				var trimmed = String(custom).replace(/\/+$/, '');
				var httpUrl = trimmed.replace(/^ws(s?):\/\//, 'http$1://');
				var wsUrl = trimmed.replace(/^http(s?):\/\//, 'ws$1://');
				return { httpBase: httpUrl, wsBase: wsUrl };
			}

			var loc = window.location;
			var isHttps = (loc.protocol === 'https:');
			var host = loc.hostname || 'localhost';
			var port = loc.port;

			// If served directly by the Colyseus server (default 2567) or deployed HTTPS host without dev static port
			if (port === '2567' || (isHttps && !port)) {
				var protoWs = isHttps ? 'wss://' : 'ws://';
				var protoHttp = isHttps ? 'https://' : 'http://';
				var authority = host + (port ? (':' + port) : '');
				return {
					httpBase: protoHttp + authority,
					wsBase: protoWs + authority
				};
			}

			// Local dev static server (e.g. port 8080 / 5500 / file://) -> connect to Colyseus on 2567
			var targetHost = (loc.protocol === 'file:' || !host) ? 'localhost' : host;
			return {
				httpBase: 'http://' + targetHost + ':2567',
				wsBase: 'ws://' + targetHost + ':2567'
			};
		},

		getColyseusClient: function () {
			if (!window.Colyseus || !window.Colyseus.Client) {
				return null;
			}
			var endpoints = this.getServerEndpoints();
			if (!this.colyseusClient || this._lastWsBase !== endpoints.wsBase) {
				this._lastWsBase = endpoints.wsBase;
				this.colyseusClient = new window.Colyseus.Client(endpoints.wsBase);
			}
			return this.colyseusClient;
		},

		// ----------------------------------------------------------------------
		// Solo Run Recording -> Genuine Ghost Match-Up Source Material
		// ----------------------------------------------------------------------
		onSoloEntranceReady: function (levelIdx) {
			if (this.isActive) return;
			this.soloRunActive = true;
			this.soloRunLevelIndex = levelIdx;
			this.soloRunStartMs = performance.now();
			this.soloRowSolveTimesMs = [];
		},

		onSoloRowSolved: function (rowIdx, totalRows) {
			if (this.isActive || !this.soloRunActive || this.soloRunLevelIndex !== currentLevelIndex) return;
			if (rowIdx !== this.soloRowSolveTimesMs.length + 1) {
				this.soloRunActive = false;
				return;
			}
			var rawElapsed = Math.max(300, Math.round(performance.now() - this.soloRunStartMs));
			var prev = this.soloRowSolveTimesMs.length > 0
				? this.soloRowSolveTimesMs[this.soloRowSolveTimesMs.length - 1]
				: 0;
			var elapsedMs = Math.max(prev + 260, rawElapsed);
			this.soloRowSolveTimesMs.push(elapsedMs);

			if (rowIdx >= totalRows - 1) {
				this.soloRunActive = false;
				this.submitPlayerRun({
					runUuid: 'run_' + this.playerId + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
					playerId: this.playerId,
					username: this.playerUsername,
					avatar: this.playerAvatar,
					source: 'solo',
					levelIndex: currentLevelIndex,
					rowSolveTimesMs: this.soloRowSolveTimesMs.slice()
				});
			}
		},

		submitPlayerRun: function (runPayload) {
			var self = this;
			var endpoints = this.getServerEndpoints();
			return fetch(endpoints.httpBase + '/api/runs', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(runPayload)
			}).then(function (res) {
				if (!res.ok) throw new Error('HTTP ' + res.status);
				return res.json();
			}).catch(function () {
				// Queue offline Solo run locally so it syncs into SQLite as soon as server is online
				try {
					var raw = localStorage.getItem(self.PENDING_RUNS_KEY);
					var queue = raw ? JSON.parse(raw) : [];
					if (!Array.isArray(queue)) queue = [];
					queue.push(runPayload);
					if (queue.length > 25) queue = queue.slice(-25);
					localStorage.setItem(self.PENDING_RUNS_KEY, JSON.stringify(queue));
				} catch (e) {}
			});
		},

		flushPendingRuns: function () {
			var self = this;
			var queue = [];
			try {
				var raw = localStorage.getItem(this.PENDING_RUNS_KEY);
				queue = raw ? JSON.parse(raw) : [];
			} catch (e) {
				queue = [];
			}
			if (!Array.isArray(queue) || queue.length === 0) {
				return Promise.resolve();
			}

			var endpoints = this.getServerEndpoints();
			var remaining = [];
			var chain = Promise.resolve();

			queue.forEach(function (item) {
				if (self.playerUsername && self.playerUsername.length >= 2) {
					item.username = self.playerUsername;
				}
				chain = chain.then(function () {
					return fetch(endpoints.httpBase + '/api/runs', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify(item)
					}).then(function (res) {
						if (!res.ok && res.status >= 500) {
							remaining.push(item);
						}
					}).catch(function () {
						remaining.push(item);
					});
				});
			});

			return chain.then(function () {
				try {
					localStorage.setItem(self.PENDING_RUNS_KEY, JSON.stringify(remaining));
				} catch (e) {}
			});
		},

		// ----------------------------------------------------------------------
		// Username, Avatar & WPM Helpers
		// ----------------------------------------------------------------------
		cleanUsername: function (raw) {
			if (typeof raw !== 'string') return '';
			return raw
				.replace(/[^a-zA-Z0-9 _.\-\u00C0-\u024F]/g, '')
				.replace(/\s+/g, ' ')
				.trim()
				.slice(0, 14);
		},

		getDisplayUsername: function () {
			return (this.playerUsername && this.playerUsername.length >= 2) ? this.playerUsername : 'You';
		},

		saveUsernameFromInput: function () {
			var input = document.getElementById('vs-username-input');
			if (!input) return this.playerUsername;
			var cleaned = this.cleanUsername(input.value);
			this.playerUsername = cleaned;
			try {
				if (cleaned) {
					localStorage.setItem(this.USERNAME_STORAGE_KEY, cleaned);
				} else {
					localStorage.removeItem(this.USERNAME_STORAGE_KEY);
				}
			} catch (e) {}
			return cleaned;
		},

		requireValidUsername: function () {
			var cleaned = this.saveUsernameFromInput();
			var input = document.getElementById('vs-username-input');
			if (!cleaned || cleaned.length < 2) {
				if (input) {
					input.classList.add('needs-attention');
					input.focus();
				}
				this.showLobbyNotice('Create a username above (2–14 chars) so opponents can see who they\'re playing!');
				return false;
			}
			if (input) {
				input.classList.remove('needs-attention');
				input.value = cleaned;
			}
			this.syncProfileToServer();
			return true;
		},

		syncProfileToServer: function () {
			if (!this.playerUsername || this.playerUsername.length < 2) return;
			var endpoints = this.getServerEndpoints();
			fetch(endpoints.httpBase + '/api/profile', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					playerId: this.playerId,
					username: this.playerUsername,
					avatar: this.playerAvatar
				})
			}).catch(function () {});
		},

		getAvatarPath: function (fileName) {
			if (typeof fileName === 'number' && this.AVATARS[fileName]) {
				fileName = this.AVATARS[fileName];
			}
			return 'OriginalTileImages/' + (fileName || 'Character_8.png');
		},

		pickPreviewOpponent: function () {
			var pool = this.AVATARS.filter(function (a) { return a !== MultiplayerManager.playerAvatar; });
			if (this.opponentAvatar === this.playerAvatar || pool.indexOf(this.opponentAvatar) === -1) {
				this.opponentAvatar = (this.playerAvatar === 'Character_9.png') ? 'Character_8.png' : 'Character_9.png';
			}
		},

		syncTitleButtonAvatars: function () {
			var p1Img = document.getElementById('title-vs-p1-img');
			var p2Img = document.getElementById('title-vs-p2-img');
			if (p1Img) p1Img.src = this.getAvatarPath(this.playerAvatar);
			if (p2Img) p2Img.src = this.getAvatarPath(this.opponentAvatar);
		},

		getCalibratedPlayerWpm: function () {
			if (this.recentWpms && this.recentWpms.length > 0) {
				var sum = 0;
				for (var i = 0; i < this.recentWpms.length; i++) {
					sum += this.recentWpms[i];
				}
				var avg = sum / this.recentWpms.length;
				return Math.max(7, Math.min(40, Math.round(avg)));
			}
			if (typeof SpeedometerManager !== 'undefined' && SpeedometerManager.getOverallStats) {
				var stats = SpeedometerManager.getOverallStats();
				if (stats && stats.completedCount > 0 && stats.avgWpm > 0) {
					return Math.max(7, Math.min(40, Math.round(stats.avgWpm * 0.85)));
				}
			}
			return 12;
		},

		recordMatchWpm: function (wpm) {
			if (!wpm || !isFinite(wpm) || wpm <= 0) return;
			var clamped = Math.max(6, Math.min(55, Math.round(wpm * 10) / 10));
			this.recentWpms.push(clamped);
			if (this.recentWpms.length > 6) {
				this.recentWpms = this.recentWpms.slice(-6);
			}
			this.saveStats();
			this.updateProfileUI();
		},

		getWordCrowns: function () {
			return this.wordCrowns || 0;
		},

		addWordCrowns: function (count) {
			if (!count || count <= 0) return;
			this.wordCrowns = (this.wordCrowns || 0) + count;
			try {
				localStorage.setItem(this.WORD_CROWNS_KEY, String(this.wordCrowns));
			} catch (e) {}
			this.updateProfileUI();
		},

		recordMatchResult: function (won) {
			this.matchesPlayed = (this.matchesPlayed || 0) + 1;
			if (won) {
				this.matchesWon = (this.matchesWon || 0) + 1;
			}
			this.saveStats();
			this.updateProfileUI();
		},

		saveStats: function () {
			try {
				localStorage.setItem(this.STATS_STORAGE_KEY, JSON.stringify({
					recentWpms: this.recentWpms,
					matchesPlayed: this.matchesPlayed || 0,
					matchesWon: this.matchesWon || 0
				}));
			} catch (e) {}
		},

		getAverageWpm: function () {
			var pvpWpm = 0;
			if (this.recentWpms && this.recentWpms.length > 0) {
				var sum = 0;
				for (var i = 0; i < this.recentWpms.length; i++) {
					sum += this.recentWpms[i];
				}
				pvpWpm = sum / this.recentWpms.length;
			}
			var soloWpm = 0;
			if (typeof SpeedometerManager !== 'undefined' && SpeedometerManager.getOverallStats) {
				var stats = SpeedometerManager.getOverallStats();
				if (stats && stats.completedCount > 0 && stats.avgWpm > 0) {
					soloWpm = stats.avgWpm;
				}
			}
			if (pvpWpm > 0 && soloWpm > 0) {
				return Math.round((pvpWpm + soloWpm) / 2);
			} else if (pvpWpm > 0) {
				return Math.round(pvpWpm);
			} else if (soloWpm > 0) {
				return Math.round(soloWpm);
			}
			return 12;
		},

		renderAvatarGrid: function () {
			var grid = document.getElementById('vs-avatar-grid');
			if (!grid) return;
			grid.innerHTML = '';
			var self = this;

			this.AVATARS.forEach(function (fileName, idx) {
				var btn = document.createElement('button');
				btn.type = 'button';
				btn.className = 'vs-avatar-option' + (fileName === self.playerAvatar ? ' selected' : '');
				btn.setAttribute('aria-label', 'Avatar ' + (idx + 1));

				var img = document.createElement('img');
				img.src = self.getAvatarPath(fileName);
				img.alt = 'Avatar ' + (idx + 1);
				btn.appendChild(img);

				btn.addEventListener('click', function () {
					self.selectAvatar(fileName);
					AudioManager.play('tilehit', 0.9);
					AudioManager.haptic(16);
				});

				grid.appendChild(btn);
			});
		},

		selectAvatar: function (fileName) {
			if (this.AVATARS.indexOf(fileName) === -1) return;
			this.playerAvatar = fileName;
			try {
				localStorage.setItem(this.AVATAR_STORAGE_KEY, fileName);
			} catch (e) {}
			this.pickPreviewOpponent();
			this.syncTitleButtonAvatars();
			this.updateProfileUI();

			var grid = document.getElementById('vs-avatar-grid');
			if (grid) {
				var buttons = grid.querySelectorAll('.vs-avatar-option');
				for (var i = 0; i < buttons.length; i++) {
					buttons[i].classList.toggle('selected', this.AVATARS[i] === fileName);
				}
			}
			this.syncProfileToServer();
		},

		// ----------------------------------------------------------------------
		// Profile Modal & Career Stats
		// ----------------------------------------------------------------------
		openProfileModal: function () {
			this.tempProfileAvatar = this.playerAvatar || 'Character_8.png';
			this.renderProfileAvatarGrid();
			this.updateProfileUI();

			var modal = document.getElementById('profile-modal');
			var usernameInput = document.getElementById('profile-username-input');
			if (usernameInput) {
				usernameInput.value = this.playerUsername || '';
			}
			if (modal) {
				modal.classList.add('show');
				if (!this.playerUsername && usernameInput) {
					setTimeout(function () {
						try { usernameInput.focus(); } catch (e) {}
					}, 180);
				}
			}
			if (typeof AudioManager !== 'undefined') {
				AudioManager.play('tilehit', 0.8);
			}
		},

		closeProfileModal: function () {
			var modal = document.getElementById('profile-modal');
			if (modal) modal.classList.remove('show');
		},

		renderProfileAvatarGrid: function () {
			var grid = document.getElementById('profile-avatar-grid');
			if (!grid) return;
			grid.innerHTML = '';
			var self = this;
			var activeAvatar = this.tempProfileAvatar || this.playerAvatar || 'Character_8.png';

			this.AVATARS.forEach(function (fileName, idx) {
				var btn = document.createElement('button');
				btn.type = 'button';
				btn.className = 'profile-avatar-option' + (fileName === activeAvatar ? ' selected' : '');
				btn.setAttribute('aria-label', 'Avatar ' + (idx + 1));

				var img = document.createElement('img');
				img.src = self.getAvatarPath(fileName);
				img.alt = 'Avatar ' + (idx + 1);
				btn.appendChild(img);

				btn.addEventListener('click', function () {
					self.selectProfileAvatar(fileName);
					if (typeof AudioManager !== 'undefined') {
						AudioManager.play('tilehit', 0.9);
						AudioManager.haptic(16);
					}
				});

				grid.appendChild(btn);
			});
		},

		selectProfileAvatar: function (fileName) {
			if (this.AVATARS.indexOf(fileName) === -1) return;
			this.tempProfileAvatar = fileName;
			var largeImg = document.getElementById('profile-current-avatar-img');
			if (largeImg) {
				largeImg.src = this.getAvatarPath(fileName);
			}
			var grid = document.getElementById('profile-avatar-grid');
			if (grid) {
				var buttons = grid.querySelectorAll('.profile-avatar-option');
				for (var i = 0; i < buttons.length; i++) {
					buttons[i].classList.toggle('selected', this.AVATARS[i] === fileName);
				}
			}
		},

		saveProfile: function () {
			var usernameInput = document.getElementById('profile-username-input');
			var nameVal = usernameInput ? usernameInput.value : '';
			var cleaned = this.cleanUsername(nameVal);

			this.playerUsername = cleaned;
			try {
				if (cleaned) {
					localStorage.setItem(this.USERNAME_STORAGE_KEY, cleaned);
				} else {
					localStorage.removeItem(this.USERNAME_STORAGE_KEY);
				}
			} catch (e) {}

			if (this.tempProfileAvatar) {
				this.playerAvatar = this.tempProfileAvatar;
				try {
					localStorage.setItem(this.AVATAR_STORAGE_KEY, this.playerAvatar);
				} catch (e) {}
			}

			this.pickPreviewOpponent();
			this.syncTitleButtonAvatars();
			this.updateProfileUI();
			this.syncProfileToServer();

			// Sync with VS Lobby input and grid if present
			var vsInput = document.getElementById('vs-username-input');
			if (vsInput) vsInput.value = this.playerUsername || '';
			var vsGrid = document.getElementById('vs-avatar-grid');
			if (vsGrid) {
				var vsButtons = vsGrid.querySelectorAll('.vs-avatar-option');
				for (var j = 0; j < vsButtons.length; j++) {
					vsButtons[j].classList.toggle('selected', this.AVATARS[j] === this.playerAvatar);
				}
			}

			if (typeof AudioManager !== 'undefined') {
				AudioManager.playSnap(1.3);
				AudioManager.haptic(25);
			}
			if (typeof showToast === 'function') {
				showToast(this.playerUsername ? ('Profile saved! Welcome, ' + this.playerUsername) : 'Profile saved!');
			}

			this.closeProfileModal();
		},

		updateProfileUI: function () {
			var avatarSrc = this.getAvatarPath(this.playerAvatar);
			var crowns = this.wordCrowns || 0;
			var avgWpm = this.getAverageWpm();
			var hasName = !!(this.playerUsername && this.playerUsername.trim().length > 0);

			// 1. Title Screen Profile Widget
			var titleImg = document.getElementById('title-profile-img');
			if (titleImg) titleImg.src = avatarSrc;

			var titleBtnText = document.getElementById('title-profile-btn-text');
			var titleBtnIcon = document.getElementById('title-profile-btn-icon');
			var titleSub = document.getElementById('title-profile-sub');
			var titleCrowns = document.getElementById('title-profile-crowns');
			var titleWpm = document.getElementById('title-profile-wpm');

			if (titleBtnText) {
				titleBtnText.textContent = hasName ? this.playerUsername.toUpperCase() : 'Add Name';
			}
			if (titleBtnIcon) {
				titleBtnIcon.textContent = hasName ? '✏️' : '➕';
			}
			if (titleSub) {
				titleSub.style.display = hasName ? 'flex' : 'none';
				if (titleCrowns) titleCrowns.textContent = '👑 ' + crowns + ' Crown' + (crowns === 1 ? '' : 's');
				if (titleWpm) titleWpm.textContent = '⚡ ' + avgWpm + ' WPM';
			}

			// 2. In-Game Left Player Card
			var hudAvatarImg = document.getElementById('hud-player-avatar-img');
			if (hudAvatarImg) hudAvatarImg.src = avatarSrc;

			var btnHudAddName = document.getElementById('btn-hud-add-name');
			var hudPlayerInfo = document.getElementById('hud-player-info');
			var hudPlayerName = document.getElementById('hud-player-name');
			var hudPlayerWpm = document.getElementById('hud-player-wpm');
			var hudPlayerCrowns = document.getElementById('hud-player-crowns');

			if (!hasName) {
				if (btnHudAddName) btnHudAddName.style.display = 'block';
				if (hudPlayerInfo) hudPlayerInfo.style.display = 'none';
			} else {
				if (btnHudAddName) btnHudAddName.style.display = 'none';
				if (hudPlayerInfo) hudPlayerInfo.style.display = 'flex';
				if (hudPlayerName) hudPlayerName.textContent = this.playerUsername.toUpperCase();
				if (hudPlayerWpm) hudPlayerWpm.textContent = '⚡ ' + avgWpm + ' WPM';
				if (hudPlayerCrowns) hudPlayerCrowns.style.display = 'none';
			}

			// 3. Profile Modal Elements
			var modalAvatarImg = document.getElementById('profile-current-avatar-img');
			if (modalAvatarImg) {
				modalAvatarImg.src = this.getAvatarPath(this.tempProfileAvatar || this.playerAvatar);
			}
			var statCrowns = document.getElementById('stat-word-crowns');
			if (statCrowns) statCrowns.textContent = crowns;
			var statWpm = document.getElementById('stat-avg-wpm');
			if (statWpm) statWpm.textContent = avgWpm;
			var statPvpMatches = document.getElementById('stat-pvp-matches');
			if (statPvpMatches) statPvpMatches.textContent = this.matchesPlayed || 0;
			var statPvpWins = document.getElementById('stat-pvp-wins');
			if (statPvpWins) statPvpWins.textContent = this.matchesWon || 0;

			var soloStats = (typeof SpeedometerManager !== 'undefined' && SpeedometerManager.getOverallStats)
				? SpeedometerManager.getOverallStats()
				: { totalStars: 0, completedCount: 0 };
			var statSoloStars = document.getElementById('stat-solo-stars');
			if (statSoloStars) statSoloStars.textContent = soloStats.totalStars || 0;
			var statSoloLevels = document.getElementById('stat-solo-levels');
			if (statSoloLevels) statSoloLevels.textContent = soloStats.completedCount || 0;
		},

		showLobbyNotice: function (msg) {
			var el = document.getElementById('vs-lobby-notice');
			if (!el) return;
			if (!msg) {
				el.style.display = 'none';
				el.textContent = '';
			} else {
				el.textContent = msg;
				el.style.display = 'block';
			}
		},

		pulseHudAvatar: function (which) {
			var sel = (which === 'p1')
				? '#hud-vs-bar .vs-p1 .vs-hud-avatar-ring'
				: '#hud-vs-bar .vs-p2 .vs-hud-avatar-ring';
			var ring = document.querySelector(sel);
			if (!ring) return;
			ring.classList.remove('solve-pulse');
			void ring.offsetWidth;
			ring.classList.add('solve-pulse');
			setTimeout(function () {
				if (ring) ring.classList.remove('solve-pulse');
			}, 1050);
		},

		getRowWordLength: function (rowIdx) {
			if (currentLevelData && currentLevelData.words && currentLevelData.words[rowIdx] && currentLevelData.words[rowIdx].answer) {
				return currentLevelData.words[rowIdx].answer.length;
			}
			if (chainRowData && chainRowData[rowIdx] && chainRowData[rowIdx].wordLen) {
				return chainRowData[rowIdx].wordLen;
			}
			return 5;
		},

		triggerFlyingCrown: function (winnerSlot, rowIdx, points) {
			var self = this;
			var pts = points || this.getRowWordLength(rowIdx) || 5;

			// 1. Calculate origin screen coordinates (from 3D tray)
			var startX = window.innerWidth * 0.5;
			var startY = window.innerHeight * 0.45;
			try {
				if (camera && chainRowData && chainRowData[rowIdx] && chainRowData[rowIdx].rackMesh) {
					var v = new THREE.Vector3();
					chainRowData[rowIdx].rackMesh.getWorldPosition(v);
					v.project(camera);
					startX = (v.x * 0.5 + 0.5) * window.innerWidth;
					startY = (-(v.y * 0.5) + 0.5) * window.innerHeight;
				}
			} catch (e) {}

			// 2. Calculate destination screen coordinates (winner's avatar ring in VS top bar)
			var ringEl = document.querySelector(winnerSlot === 'p1' ? '.vs-hud-player.vs-p1 .vs-hud-avatar-ring' : '.vs-hud-player.vs-p2 .vs-hud-avatar-ring');
			var destX = (winnerSlot === 'p1') ? window.innerWidth * 0.28 : window.innerWidth * 0.72;
			var destY = 56;
			if (ringEl) {
				var rect = ringEl.getBoundingClientRect();
				destX = rect.left + rect.width / 2;
				destY = rect.top + rect.height / 2;
			}

			// 3. Create floating burst pill
			var burst = document.createElement('div');
			burst.className = 'vs-flying-crown-particle';
			burst.innerHTML = '👑 +' + pts;
			burst.style.left = startX + 'px';
			burst.style.top = startY + 'px';
			burst.style.opacity = '1';
			document.body.appendChild(burst);

			// 4. Create 2 mini sparkling crown sparkles alongside it
			var sparkles = [];
			for (var s = 0; s < 2; s++) {
				var sp = document.createElement('div');
				sp.className = 'vs-flying-crown-sparkle';
				sp.textContent = '👑';
				var offX = (s === 0 ? -18 : 18);
				var offY = (s === 0 ? 14 : -14);
				sp.style.left = (startX + offX) + 'px';
				sp.style.top = (startY + offY) + 'px';
				document.body.appendChild(sp);
				sparkles.push({ el: sp, offX: offX, offY: offY });
			}

			// 5. Trigger flight on next animation frame
			requestAnimationFrame(function () {
				burst.style.left = destX + 'px';
				burst.style.top = destY + 'px';
				burst.style.transform = 'translate(-50%, -50%) scale(0.9)';
				burst.style.opacity = '0.95';

				sparkles.forEach(function (item) {
					item.el.style.left = (destX + item.offX * 0.35) + 'px';
					item.el.style.top = (destY + item.offY * 0.35) + 'px';
					item.el.style.transform = 'translate(-50%, -50%) scale(0.65)';
					item.el.style.opacity = '0.9';
				});
			});

			// 6. Arrival payoff after flight duration (600ms)
			setTimeout(function () {
				try {
					burst.style.opacity = '0';
					burst.style.transform = 'translate(-50%, -50%) scale(1.4)';
					sparkles.forEach(function (item) {
						item.el.style.opacity = '0';
					});
				} catch (e) {}

				setTimeout(function () {
					try {
						if (burst.parentNode) burst.parentNode.removeChild(burst);
						sparkles.forEach(function (item) {
							if (item.el.parentNode) item.el.parentNode.removeChild(item.el);
						});
					} catch (e) {}
				}, 240);

				// Update match crown badges
				var crownBadge = document.getElementById(winnerSlot === 'p1' ? 'vs-p1-crowns' : 'vs-p2-crowns');
				var curCount = (winnerSlot === 'p1') ? self.p1MatchCrowns : self.p2MatchCrowns;
				if (crownBadge) {
					crownBadge.textContent = '👑 ' + curCount;
					crownBadge.classList.add('bump');
					setTimeout(function () { crownBadge.classList.remove('bump'); }, 300);
				}

				// Pulse avatar ring with gold celebration glow
				if (ringEl) {
					ringEl.classList.remove('crown-absorb-pulse');
					void ringEl.offsetWidth; // trigger reflow
					ringEl.classList.add('crown-absorb-pulse');
					setTimeout(function () { ringEl.classList.remove('crown-absorb-pulse'); }, 700);
				}

				// Play chime sound
				if (typeof AudioManager !== 'undefined') {
					AudioManager.play('word_chain_chime', 0.5);
				}
			}, 620);
		},

		// ----------------------------------------------------------------------
		// Lobby & Friend Room UI Events
		// ----------------------------------------------------------------------
		bindModalEvents: function () {
			var self = this;
			var modal = document.getElementById('vs-lobby-modal');
			var btnClose = document.getElementById('btn-vs-lobby-close');
			var usernameInput = document.getElementById('vs-username-input');
			var btnFind = document.getElementById('btn-vs-find-match');
			var btnCreateFriend = document.getElementById('btn-vs-create-friend');
			var btnJoinFriend = document.getElementById('btn-vs-join-friend');
			var codeInput = document.getElementById('vs-friend-code-input');
			var btnCopyInvite = document.getElementById('btn-vs-copy-invite');
			var btnCancel = document.getElementById('btn-vs-cancel-search');

			if (usernameInput) {
				if (this.playerUsername) {
					usernameInput.value = this.playerUsername;
				}
				usernameInput.addEventListener('input', function () {
					usernameInput.classList.remove('needs-attention');
					self.saveUsernameFromInput();
				});
				usernameInput.addEventListener('blur', function () {
					var cleaned = self.saveUsernameFromInput();
					usernameInput.value = cleaned;
					self.syncProfileToServer();
				});
				usernameInput.addEventListener('keydown', function (e) {
					if (e.key === 'Enter') {
						e.preventDefault();
						var cleaned = self.saveUsernameFromInput();
						usernameInput.value = cleaned;
						if (codeInput && codeInput.value.trim().length === 4) {
							self.joinFriendRoom(codeInput.value.trim().toUpperCase());
						} else {
							self.startSearch();
						}
					}
				});
			}

			if (btnClose) {
				btnClose.addEventListener('click', function () {
					AudioManager.play('tilehit', 0.8);
					self.leaveRoomSilently();
					self.closeLobby();
				});
			}
			if (btnFind) {
				btnFind.addEventListener('click', function () {
					AudioManager.playSnap(1.3);
					AudioManager.haptic(25);
					self.startSearch();
				});
			}
			if (btnCreateFriend) {
				btnCreateFriend.addEventListener('click', function () {
					AudioManager.playSnap(1.3);
					AudioManager.haptic(25);
					self.createFriendRoom();
				});
			}
			if (btnJoinFriend) {
				btnJoinFriend.addEventListener('click', function () {
					var val = codeInput ? codeInput.value.trim().toUpperCase() : '';
					AudioManager.playSnap(1.3);
					AudioManager.haptic(25);
					self.joinFriendRoom(val);
				});
			}
			if (codeInput) {
				codeInput.addEventListener('keydown', function (e) {
					if (e.key === 'Enter') {
						e.preventDefault();
						var val = codeInput.value.trim().toUpperCase();
						self.joinFriendRoom(val);
					}
				});
			}
			if (btnCopyInvite) {
				btnCopyInvite.addEventListener('click', function () {
					if (!self.roomCode) return;
					var baseUrl = window.location.origin + window.location.pathname;
					var inviteUrl = baseUrl + '?room=' + encodeURIComponent(self.roomCode);
					if (navigator.clipboard && navigator.clipboard.writeText) {
						navigator.clipboard.writeText(inviteUrl).then(function () {
							btnCopyInvite.textContent = 'COPIED INVITE LINK!';
							setTimeout(function () {
								btnCopyInvite.textContent = 'COPY INVITE LINK';
							}, 1800);
						}).catch(function () {});
					}
					AudioManager.play('tilehit', 0.9);
				});
			}
			if (btnCancel) {
				btnCancel.addEventListener('click', function () {
					AudioManager.play('tilehit', 0.8);
					self.leaveRoomSilently();
					self.cancelSearchToSelect();
				});
			}
			if (modal) {
				modal.addEventListener('click', function (e) {
					if (e.target === modal && !self.isSearching) {
						self.closeLobby();
					}
				});
			}

			// Post-Match Results Modal Buttons (guarded against accidental carryover taps)
			var btnResNext = document.getElementById('btn-vs-results-next');
			var btnResLobby = document.getElementById('btn-vs-results-lobby');
			var btnResClose = document.getElementById('btn-vs-results-close');

			if (btnResNext) {
				btnResNext.addEventListener('click', function (e) {
					if (e) e.stopPropagation();
					if (performance.now() < self.resultsInteractiveAt) return;
					AudioManager.playSnap(1.3);
					AudioManager.haptic(25);
					stopWinCelebration();
					self.onPostMatchNext();
				});
			}
			if (btnResLobby) {
				btnResLobby.addEventListener('click', function (e) {
					if (e) e.stopPropagation();
					if (performance.now() < self.resultsInteractiveAt) return;
					AudioManager.play('tilehit', 0.85);
					AudioManager.haptic(20);
					stopWinCelebration();
					self.clearRematchTimer();
					self.hideMatchResults();
					self.leaveRoomSilently();
					self.openLobby(false);
				});
			}
			if (btnResClose) {
				btnResClose.addEventListener('click', function (e) {
					if (e) e.stopPropagation();
					if (performance.now() < self.resultsInteractiveAt) return;
					AudioManager.play('tilehit', 0.8);
					stopWinCelebration();
					self.clearRematchTimer();
					self.hideMatchResults();
					self.exitVsMode();
					if (typeof self.showTitleScreenFn === 'function') {
						self.showTitleScreenFn();
					}
				});
			}

			// Profile Modal & HUD Card bindings
			var titleProfileWidget = document.getElementById('title-profile-widget');
			var btnTitleProfile = document.getElementById('btn-title-profile');
			var hudPlayerCard = document.getElementById('hud-player-card');
			var btnHudAddName = document.getElementById('btn-hud-add-name');
			var profileModal = document.getElementById('profile-modal');
			var btnProfileClose = document.getElementById('btn-profile-close');
			var btnProfileSave = document.getElementById('btn-profile-save');
			var profileUsernameInput = document.getElementById('profile-username-input');

			if (titleProfileWidget) {
				titleProfileWidget.addEventListener('click', function (e) {
					e.stopPropagation();
					self.openProfileModal();
				});
			}
			if (btnTitleProfile) {
				btnTitleProfile.addEventListener('click', function (e) {
					e.stopPropagation();
					self.openProfileModal();
				});
			}
			if (hudPlayerCard) {
				hudPlayerCard.addEventListener('click', function (e) {
					e.stopPropagation();
					self.openProfileModal();
				});
			}
			if (btnHudAddName) {
				btnHudAddName.addEventListener('click', function (e) {
					e.stopPropagation();
					self.openProfileModal();
				});
			}
			if (btnProfileClose) {
				btnProfileClose.addEventListener('click', function () {
					if (typeof AudioManager !== 'undefined') AudioManager.play('tilehit', 0.8);
					self.closeProfileModal();
				});
			}
			if (btnProfileSave) {
				btnProfileSave.addEventListener('click', function () {
					self.saveProfile();
				});
			}
			if (profileUsernameInput) {
				profileUsernameInput.addEventListener('keydown', function (e) {
					if (e.key === 'Enter') {
						e.preventDefault();
						self.saveProfile();
					}
				});
			}
			if (profileModal) {
				profileModal.addEventListener('click', function (e) {
					if (e.target === profileModal) {
						self.closeProfileModal();
					}
				});
			}
		},

		scheduleMatchResultsReveal: function (delayMs) {
			var self = this;
			if (this.resultsRevealTimeout) {
				clearTimeout(this.resultsRevealTimeout);
			}
			this.resultsRevealTimeout = setTimeout(function () {
				self.resultsRevealTimeout = null;
				if (self.isActive) {
					self.showMatchResults();
				}
			}, typeof delayMs === 'number' ? delayMs : 380);
		},

		hideMatchResults: function () {
			if (this.resultsRevealTimeout) {
				clearTimeout(this.resultsRevealTimeout);
				this.resultsRevealTimeout = null;
			}
			var resModal = document.getElementById('vs-results-modal');
			if (resModal) resModal.classList.remove('show');
		},

		populateMatchResultsDOM: function () {
			var summary = this.lastMatchSummary || {};
			var localWin = (this.winner !== 'p2');
			var totalRows = summary.totalRows || (currentLevelData && currentLevelData.words ? currentLevelData.words.length - 1 : 4);

			var myWpm = Math.round((this.mySlot === 'p1' ? summary.p1Wpm : summary.p2Wpm) || this.playerLiveWpm || this.playerBaseWpm || 0);
			var oppWpm = Math.round((this.mySlot === 'p1' ? summary.p2Wpm : summary.p1Wpm) || this.opponentLiveWpm || this.opponentTargetWpm || 0);

			var myRows = (summary.p1Rows !== undefined && summary.p2Rows !== undefined)
				? (this.mySlot === 'p1' ? summary.p1Rows : summary.p2Rows)
				: (localWin ? totalRows : this.playerRowsSolved);
			var oppRows = (summary.p1Rows !== undefined && summary.p2Rows !== undefined)
				? (this.mySlot === 'p1' ? summary.p2Rows : summary.p1Rows)
				: (!localWin ? totalRows : this.opponentRowsSolved);

			var myFinishMs = (this.mySlot === 'p1') ? summary.p1FinishMs : summary.p2FinishMs;
			var oppFinishMs = (this.mySlot === 'p1') ? summary.p2FinishMs : summary.p1FinishMs;

			var myName = (this.mySlot === 'p1' ? summary.p1Username : summary.p2Username) || this.getDisplayUsername();
			var oppName = (this.mySlot === 'p1' ? summary.p2Username : summary.p1Username) || this.opponentUsername || 'Opponent';

			var cardEl = document.getElementById('vs-results-card');
			var modeTagEl = document.getElementById('vs-results-mode-tag');
			var outcomeEl = document.getElementById('vs-results-outcome');
			var subEl = document.getElementById('vs-results-sub');
			var p1AvatarEl = document.getElementById('vs-res-p1-avatar');
			var p2AvatarEl = document.getElementById('vs-res-p2-avatar');
			var p1CrownEl = document.getElementById('vs-res-p1-crown');
			var p2CrownEl = document.getElementById('vs-res-p2-crown');
			var p1NameEl = document.getElementById('vs-res-p1-name');
			var p2NameEl = document.getElementById('vs-res-p2-name');
			var p1RoleEl = document.getElementById('vs-res-p1-role');
			var p2RoleEl = document.getElementById('vs-res-p2-role');
			var p1WpmEl = document.getElementById('vs-res-p1-wpm');
			var p2WpmEl = document.getElementById('vs-res-p2-wpm');
			var p1MetaEl = document.getElementById('vs-res-p1-meta');
			var p2MetaEl = document.getElementById('vs-res-p2-meta');
			var pillsEl = document.getElementById('vs-results-chain-pills');
			var btnNextEl = document.getElementById('btn-vs-results-next');

			if (cardEl) {
				cardEl.classList.toggle('outcome-win', localWin);
				cardEl.classList.toggle('outcome-loss', !localWin);
			}
			if (modeTagEl) {
				modeTagEl.textContent = (this.matchMode === 'friend')
					? 'FRIEND MATCH RESULTS'
					: (this.matchMode === 'ghost' ? 'GHOST MATCH RESULTS' : 'PVP MATCH RESULTS');
			}
			if (outcomeEl) {
				outcomeEl.textContent = localWin ? 'VICTORY!' : 'DEFEAT';
			}
			if (subEl) {
				var crownsSuffix = (this.lastEarnedCrowns !== undefined && this.lastEarnedCrowns > 0)
					? (' • 👑 +' + this.lastEarnedCrowns + ' Word Crown' + (this.lastEarnedCrowns > 1 ? 's' : ''))
					: '';
				if (summary.byForfeit && localWin) {
					subEl.textContent = oppName + ' disconnected — you win!' + crownsSuffix;
				} else if (localWin) {
					subEl.textContent = 'You beat ' + oppName + ' to complete the chain!' + crownsSuffix;
				} else {
					subEl.textContent = oppName + ' completed the chain first!' + crownsSuffix;
				}
			}

			if (p1AvatarEl) p1AvatarEl.src = this.getAvatarPath(this.playerAvatar);
			if (p2AvatarEl) p2AvatarEl.src = this.getAvatarPath(this.opponentAvatar);
			if (p1CrownEl) p1CrownEl.classList.toggle('show', localWin);
			if (p2CrownEl) p2CrownEl.classList.toggle('show', !localWin);
			if (p1NameEl) p1NameEl.textContent = myName;
			if (p2NameEl) p2NameEl.textContent = oppName;
			if (p1RoleEl) p1RoleEl.textContent = 'YOU';
			if (p2RoleEl) {
				p2RoleEl.textContent = (this.matchMode === 'ghost')
					? 'GHOST'
					: (this.matchMode === 'friend' ? 'FRIEND' : 'OPPONENT');
			}

			if (p1WpmEl) p1WpmEl.textContent = myWpm + ' WPM';
			if (p2WpmEl) p2WpmEl.textContent = oppWpm + ' WPM';

			var myTimeStr = myFinishMs ? (' • ' + (myFinishMs / 1000).toFixed(1) + 's') : '';
			var oppTimeStr = oppFinishMs ? (' • ' + (oppFinishMs / 1000).toFixed(1) + 's') : '';
			var p1MetaCrowns = ' • 👑 ' + (this.p1MatchCrowns || this.lastEarnedCrowns || 0);
			var p2MetaCrowns = ' • 👑 ' + (this.p2MatchCrowns || 0);
			if (p1MetaEl) p1MetaEl.textContent = myRows + '/' + totalRows + ' Words' + p1MetaCrowns + myTimeStr;
			if (p2MetaEl) p2MetaEl.textContent = oppRows + '/' + totalRows + ' Words' + p2MetaCrowns + oppTimeStr;

			if (pillsEl) {
				pillsEl.innerHTML = '';
				var words = (currentLevelData && currentLevelData.words) ? currentLevelData.words : [];
				for (var i = 0; i < words.length; i++) {
					var span = document.createElement('span');
					var cls = 'vs-chain-pill';
					var solver = this.firstSolverByRow[i];
					if (i === 0) {
						cls += ' pill-anchor';
						span.textContent = words[i].answer;
					} else {
						if (solver === 'p1') {
							cls += ' pill-blue';
						} else if (solver === 'p2') {
							cls += ' pill-red';
						}
						var avatarImg = document.createElement('img');
						avatarImg.className = 'vs-pill-avatar-img';
						var avFile = (solver === 'p2') ? this.opponentAvatar : this.playerAvatar;
						avatarImg.src = this.getAvatarPath(avFile);
						avatarImg.alt = (solver === 'p2') ? this.opponentUsername : 'You';
						span.appendChild(avatarImg);

						var crownPts = (words[i] && words[i].answer) ? words[i].answer.length : 5;
						var crownBadge = solver ? (' (+' + crownPts + ' 👑)') : '';
						var textNode = document.createTextNode(words[i].answer + crownBadge);
						span.appendChild(textNode);
					}
					span.className = cls;
					pillsEl.appendChild(span);
				}
			}

			if (btnNextEl) {
				btnNextEl.disabled = false;
				btnNextEl.classList.remove('vs-pulse-rematch');
				btnNextEl.textContent = (this.canRematch && this.room) ? 'REMATCH' : 'NEXT MATCH';
			}
		},

		showMatchResults: function () {
			var resModal = document.getElementById('vs-results-modal');
			if (!resModal) return;
			this.populateMatchResultsDOM();
			this.resultsInteractiveAt = performance.now() + 480;
			resModal.classList.add('show');
		},

		openLobby: function (autoStartSearch, prefillCode) {
			this.hideMatchResults();
			this.clearSearchTimers();
			this.renderAvatarGrid();
			this.showLobbyNotice('');

			var modal = document.getElementById('vs-lobby-modal');
			var stepSelect = document.getElementById('vs-step-select');
			var stepSearch = document.getElementById('vs-step-search');
			var codeBox = document.getElementById('vs-friend-room-box');
			var codeInput = document.getElementById('vs-friend-code-input');
			var usernameInput = document.getElementById('vs-username-input');
			if (!modal) return;

			if (usernameInput) {
				usernameInput.classList.remove('needs-attention');
				usernameInput.value = this.playerUsername || '';
			}

			if (codeBox) codeBox.style.display = 'none';
			if (prefillCode && codeInput) {
				codeInput.value = String(prefillCode).trim().toUpperCase().slice(0, 4);
			}

			var canAutoSearch = autoStartSearch && this.playerUsername && this.playerUsername.length >= 2;
			if (stepSelect) stepSelect.style.display = canAutoSearch ? 'none' : 'block';
			if (stepSearch) stepSearch.style.display = canAutoSearch ? 'block' : 'none';

			modal.classList.add('show');

			if (canAutoSearch) {
				this.startSearch();
			} else if (!this.playerUsername && usernameInput) {
				setTimeout(function () {
					try { usernameInput.focus(); } catch (e) {}
				}, 180);
			}
		},

		closeLobby: function () {
			this.clearSearchTimers();
			var modal = document.getElementById('vs-lobby-modal');
			if (modal) modal.classList.remove('show');
			if (this.isActive && this.matchFinished) {
				this.exitVsMode();
				if (typeof this.showTitleScreenFn === 'function') {
					this.showTitleScreenFn();
				}
			}
		},

		cancelSearchToSelect: function (noticeMsg) {
			this.clearSearchTimers();
			var stepSelect = document.getElementById('vs-step-select');
			var stepSearch = document.getElementById('vs-step-search');
			var codeBox = document.getElementById('vs-friend-room-box');
			if (codeBox) codeBox.style.display = 'none';
			if (stepSearch) stepSearch.style.display = 'none';
			if (stepSelect) stepSelect.style.display = 'block';
			if (noticeMsg) {
				this.showLobbyNotice(noticeMsg);
			}
		},

		clearSearchTimers: function () {
			this.clearRematchTimer();
			this.isSearching = false;
			if (this.searchInterval) {
				clearInterval(this.searchInterval);
				this.searchInterval = null;
			}
			if (this.searchTimeout) {
				clearTimeout(this.searchTimeout);
				this.searchTimeout = null;
			}
			var p2Ring = document.getElementById('vs-search-p2-ring');
			if (p2Ring) p2Ring.classList.remove('vs-searching-spin');
		},

		leaveRoomSilently: function () {
			this.clearRematchTimer();
			this.canRematch = false;
			this.roomCode = null;
			if (this.room) {
				var r = this.room;
				this.room = null;
				try { r.leave(); } catch (e) {}
			}
		},

		startAvatarSpinner: function () {
			var self = this;
			var p2RingEl = document.getElementById('vs-search-p2-ring');
			var p2AvatarEl = document.getElementById('vs-search-p2-avatar');
			if (p2RingEl) p2RingEl.classList.add('vs-searching-spin');

			var candidatePool = this.AVATARS.filter(function (a) { return a !== self.playerAvatar; });
			var spinIdx = 0;
			if (this.searchInterval) clearInterval(this.searchInterval);
			this.searchInterval = setInterval(function () {
				spinIdx = (spinIdx + 1) % candidatePool.length;
				if (p2AvatarEl) {
					p2AvatarEl.src = self.getAvatarPath(candidatePool[spinIdx]);
				}
			}, 125);
		},

		prepareSearchStageUI: function (statusText, showFriendBox) {
			var stepSelect = document.getElementById('vs-step-select');
			var stepSearch = document.getElementById('vs-step-search');
			var p1AvatarEl = document.getElementById('vs-search-p1-avatar');
			var p1WpmEl = document.getElementById('vs-search-p1-wpm');
			var p2WpmEl = document.getElementById('vs-search-p2-wpm');
			var p1NameEl = document.getElementById('vs-search-p1-name');
			var p2NameEl = document.getElementById('vs-search-p2-name');
			var statusEl = document.getElementById('vs-search-status');
			var btnCancel = document.getElementById('btn-vs-cancel-search');
			var codeBox = document.getElementById('vs-friend-room-box');

			this.showLobbyNotice('');
			this.playerBaseWpm = this.getCalibratedPlayerWpm();

			if (stepSelect) stepSelect.style.display = 'none';
			if (stepSearch) stepSearch.style.display = 'block';
			if (codeBox) codeBox.style.display = showFriendBox ? 'block' : 'none';
			if (p1AvatarEl) p1AvatarEl.src = this.getAvatarPath(this.playerAvatar);
			if (p1WpmEl) p1WpmEl.textContent = this.playerBaseWpm + 'WPM';
			if (p2WpmEl) p2WpmEl.textContent = '--WPM';
			if (p1NameEl) p1NameEl.textContent = this.getDisplayUsername();
			if (p2NameEl) p2NameEl.textContent = showFriendBox ? 'Waiting...' : 'Searching...';
			if (statusEl) statusEl.textContent = statusText || 'Searching for opponent...';
			if (btnCancel) btnCancel.style.visibility = 'visible';
		},

		// ----------------------------------------------------------------------
		// Colyseus Matchmaking: Quick Match & Friend Room
		// ----------------------------------------------------------------------
		startSearch: function () {
			var self = this;
			if (!this.requireValidUsername()) {
				return;
			}
			this.leaveRoomSilently();
			this.clearSearchTimers();

			var client = this.getColyseusClient();
			if (!client) {
				this.cancelSearchToSelect('Colyseus SDK failed to load. Please refresh the page.');
				return;
			}

			this.isSearching = true;
			this.prepareSearchStageUI('Searching for live opponent...', false);
			this.startAvatarSpinner();

			this.flushPendingRuns().then(function () {
				if (!self.isSearching) return;
				return client.joinOrCreate('vs_match', {
					mode: 'quick',
					playerId: self.playerId,
					username: self.playerUsername,
					avatar: self.playerAvatar,
					wpm: self.playerBaseWpm,
					lastLevelIndex: self.lastVsLevelIndex
				});
			}).then(function (room) {
				if (!room) return;
				if (!self.isSearching) {
					try { room.leave(); } catch (e) {}
					return;
				}
				self.attachRoomHandlers(room);
			}).catch(function () {
				self.cancelSearchToSelect('Multiplayer server is offline. Start Colyseus with: cd server && npm start');
			});
		},

		createFriendRoom: function () {
			var self = this;
			if (!this.requireValidUsername()) {
				return;
			}
			this.leaveRoomSilently();
			this.clearSearchTimers();

			var client = this.getColyseusClient();
			if (!client) {
				this.showLobbyNotice('Colyseus SDK failed to load.');
				return;
			}

			this.isSearching = true;
			this.prepareSearchStageUI('Creating private friend room...', true);
			var codeDisplay = document.getElementById('vs-friend-room-code');
			if (codeDisplay) codeDisplay.textContent = '....';
			this.startAvatarSpinner();

			this.flushPendingRuns().then(function () {
				return client.create('vs_match', {
					mode: 'friend',
					playerId: self.playerId,
					username: self.playerUsername,
					avatar: self.playerAvatar,
					wpm: self.playerBaseWpm,
					lastLevelIndex: self.lastVsLevelIndex
				});
			}).then(function (room) {
				if (!self.isSearching) {
					try { room.leave(); } catch (e) {}
					return;
				}
				self.attachRoomHandlers(room);
			}).catch(function () {
				self.cancelSearchToSelect('Multiplayer server is offline. Start Colyseus with: cd server && npm start');
			});
		},

		joinFriendRoom: function (code) {
			var self = this;
			if (!this.requireValidUsername()) {
				return;
			}
			var normalized = String(code || '').trim().toUpperCase();
			if (normalized.length < 4) {
				this.showLobbyNotice('Enter your friend\'s 4-letter Room Code first.');
				return;
			}

			var client = this.getColyseusClient();
			if (!client) {
				this.showLobbyNotice('Colyseus SDK failed to load.');
				return;
			}

			this.leaveRoomSilently();
			this.clearSearchTimers();
			this.isSearching = true;
			this.prepareSearchStageUI('Joining friend room ' + normalized + '...', false);
			this.startAvatarSpinner();

			var endpoints = this.getServerEndpoints();
			this.flushPendingRuns().then(function () {
				return fetch(endpoints.httpBase + '/api/friend-room/' + encodeURIComponent(normalized));
			}).then(function (res) {
				return res.json().then(function (body) {
					if (!res.ok || !body || !body.ok || !body.roomId) {
						throw new Error((body && body.error) || 'Room code not found or already full.');
					}
					return body.roomId;
				});
			}).then(function (roomId) {
				return client.joinById(roomId, {
					mode: 'friend',
					roomCode: normalized,
					playerId: self.playerId,
					username: self.playerUsername,
					avatar: self.playerAvatar,
					wpm: self.playerBaseWpm,
					lastLevelIndex: self.lastVsLevelIndex
				});
			}).then(function (room) {
				if (!self.isSearching) {
					try { room.leave(); } catch (e) {}
					return;
				}
				self.attachRoomHandlers(room);
			}).catch(function (err) {
				var msg = (err && err.message && err.message.indexOf('Failed to fetch') === -1)
					? err.message
					: 'Multiplayer server is offline. Start Colyseus with: cd server && npm start';
				self.cancelSearchToSelect(msg);
			});
		},

		clearRematchTimer: function () {
			if (this.rematchWaitTimer) {
				clearInterval(this.rematchWaitTimer);
				this.rematchWaitTimer = null;
			}
			if (this.rematchAbortTimer) {
				clearTimeout(this.rematchAbortTimer);
				this.rematchAbortTimer = null;
			}
		},

		handleRematchTimeout: function (customMsg) {
			var self = this;
			this.clearRematchTimer();
			this.canRematch = false;
			var oppName = this.opponentUsername || 'Opponent';
			var msg = customMsg || ('No response from ' + oppName + '. Returning to lobby...');

			var btnNextEl = document.getElementById('btn-vs-results-next');
			var subEl = document.getElementById('vs-results-sub');
			if (btnNextEl) {
				btnNextEl.textContent = 'RETURNING TO LOBBY...';
				btnNextEl.disabled = true;
				btnNextEl.classList.remove('vs-pulse-rematch');
			}
			if (subEl) {
				subEl.textContent = msg;
			}
			if (typeof AudioManager !== 'undefined') {
				AudioManager.play('tilehit', 0.6);
			}

			this.rematchAbortTimer = setTimeout(function () {
				self.clearRematchTimer();
				self.hideMatchResults();
				self.leaveRoomSilently();
				self.openLobby(false);
			}, 1800);
		},

		onPostMatchNext: function () {
			if (this.canRematch && this.room) {
				var btnNextEl = document.getElementById('btn-vs-results-next');
				var subEl = document.getElementById('vs-results-sub');
				var oppName = this.opponentUsername || 'Opponent';
				var isAccepting = btnNextEl && (btnNextEl.textContent === 'ACCEPT REMATCH' || btnNextEl.classList.contains('vs-pulse-rematch'));

				this.clearRematchTimer();

				if (isAccepting) {
					if (btnNextEl) {
						btnNextEl.textContent = 'ACCEPTING REMATCH...';
						btnNextEl.disabled = true;
						btnNextEl.classList.remove('vs-pulse-rematch');
					}
					if (subEl) {
						subEl.textContent = 'Accepting rematch with ' + oppName + '! Starting...';
					}
					AudioManager.playSnap(1.4);
					AudioManager.haptic(25);
					try {
						this.room.send('request_rematch');
					} catch (e) {
						this.handleRematchTimeout('Connection lost. Returning to lobby...');
						return;
					}
					var self = this;
					this.rematchAbortTimer = setTimeout(function () {
						self.handleRematchTimeout('No response from room. Returning to lobby...');
					}, 6000);
					return;
				}

				// Initiating Rematch request — overlay stays open while waiting for opponent
				if (btnNextEl) {
					btnNextEl.textContent = 'WAITING FOR OPPONENT...';
					btnNextEl.disabled = true;
					btnNextEl.classList.remove('vs-pulse-rematch');
				}
				var secondsLeft = 12;
				if (subEl) {
					subEl.textContent = '⚡ Rematch requested! Waiting for ' + oppName + ' (' + secondsLeft + 's)...';
				}
				AudioManager.playSnap(1.2);
				AudioManager.haptic(20);

				try {
					this.room.send('request_rematch');
				} catch (e) {
					this.handleRematchTimeout('Connection lost. Returning to lobby...');
					return;
				}

				var self = this;
				this.rematchWaitTimer = setInterval(function () {
					secondsLeft--;
					if (secondsLeft > 0) {
						if (subEl) {
							subEl.textContent = '⚡ Rematch requested! Waiting for ' + oppName + ' (' + secondsLeft + 's)...';
						}
					} else {
						self.handleRematchTimeout('No response from ' + oppName + '. Returning to lobby...');
					}
				}, 1000);
				return;
			}
			this.clearRematchTimer();
			this.hideMatchResults();
			this.leaveRoomSilently();
			this.openLobby(true);
		},

		attachRoomHandlers: function (room) {
			var self = this;
			this.room = room;

			room.onMessage('friend_room_created', function (payload) {
				self.roomCode = payload.roomCode;
				var codeDisplay = document.getElementById('vs-friend-room-code');
				var codeBox = document.getElementById('vs-friend-room-box');
				var statusEl = document.getElementById('vs-search-status');
				if (codeBox) codeBox.style.display = 'block';
				if (codeDisplay) codeDisplay.textContent = payload.roomCode;
				if (statusEl) statusEl.textContent = 'Waiting for friend to join...';
			});

			room.onMessage('searching_live', function () {
				var statusEl = document.getElementById('vs-search-status');
				if (statusEl) statusEl.textContent = 'Searching for opponent...';
			});

			// STRICT: Server rejects fake empty matches when no live opponent & 0 saved ghost runs exist
			room.onMessage('no_opponent_found', function (payload) {
				self.leaveRoomSilently();
				self.cancelSearchToSelect(
					(payload && payload.message) ||
					'No live opponent online and 0 recorded runs yet! Play 1 Solo round first or create a Friend Room.'
				);
			});

			room.onMessage('match_found', function (payload) {
				if (self.room !== room) return;
				self.clearRematchTimer();
				self.clearSearchTimers();

				self.mySlot = payload.yourSlot || 'p1';
				self.matchMode = payload.matchMode || 'live';
				self.roomCode = payload.roomCode || null;
				self.canRematch = false;

				var opp = payload.opponent || {};
				self.opponentUsername = opp.username || 'Opponent';
				self.opponentAvatar = opp.avatar || 'Character_9.png';
				self.opponentTargetWpm = opp.baseWpm || 12;
				self.syncTitleButtonAvatars();

				var p2RingEl = document.getElementById('vs-search-p2-ring');
				var p2AvatarEl = document.getElementById('vs-search-p2-avatar');
				var p2WpmEl = document.getElementById('vs-search-p2-wpm');
				var p1NameEl = document.getElementById('vs-search-p1-name');
				var p2NameEl = document.getElementById('vs-search-p2-name');
				var statusEl = document.getElementById('vs-search-status');
				var btnCancel = document.getElementById('btn-vs-cancel-search');
				var codeBox = document.getElementById('vs-friend-room-box');

				if (p2RingEl) p2RingEl.classList.remove('vs-searching-spin');
				if (p2AvatarEl) p2AvatarEl.src = self.getAvatarPath(self.opponentAvatar);
				if (p2WpmEl) p2WpmEl.textContent = self.opponentTargetWpm + 'WPM';
				if (p1NameEl) p1NameEl.textContent = self.getDisplayUsername();
				if (p2NameEl) p2NameEl.textContent = self.opponentUsername;
				if (codeBox) codeBox.style.display = 'none';
				if (btnCancel) btnCancel.style.visibility = 'hidden';

				if (statusEl) {
					statusEl.textContent = (self.matchMode === 'friend')
						? ('Matched with ' + self.opponentUsername + '! Starting...')
						: ('Matched vs ' + self.opponentUsername + '! Starting...');
				}

				AudioManager.playSnap(1.45);
				AudioManager.haptic(30);

				self.searchTimeout = setTimeout(function () {
					if (btnCancel) btnCancel.style.visibility = 'visible';
					self.beginSyncedMatch(payload.levelIndex);
				}, 520);
			});

			room.onMessage('race_start', function () {
				if (!self.isActive || self.room !== room) return;
				self.raceStarted = true;
				self.raceStartTime = performance.now();
				updateOpponentBeaconAppearance(self.opponentAvatar, self.opponentUsername);
				setOpponentActiveRow(self.opponentRowsSolved + 1, false);
			});

			room.onMessage('row_update', function (payload) {
				if (!self.isActive || self.room !== room) return;

				var row = Number(payload.row);
				var firstLocal = (payload.firstSolverSlot === self.mySlot) ? 'p1' : 'p2';
				var solverLocal = (payload.solverSlot === self.mySlot) ? 'p1' : 'p2';

				var prevFirst = self.firstSolverByRow[row];
				self.firstSolverByRow[row] = firstLocal;
				self.applyRowClaimMaterial(row);

				var pts = self.getRowWordLength(row);
				if (!prevFirst) {
					if (firstLocal === 'p1') {
						self.p1MatchCrowns = (self.p1MatchCrowns || 0) + pts;
					} else {
						self.p2MatchCrowns = (self.p2MatchCrowns || 0) + pts;
					}
					self.triggerFlyingCrown(firstLocal, row, pts);
				} else if (prevFirst !== firstLocal) {
					if (prevFirst === 'p1') {
						self.p1MatchCrowns = Math.max(0, (self.p1MatchCrowns || 0) - pts);
					} else {
						self.p2MatchCrowns = Math.max(0, (self.p2MatchCrowns || 0) - pts);
					}
					if (firstLocal === 'p1') {
						self.p1MatchCrowns = (self.p1MatchCrowns || 0) + pts;
					} else {
						self.p2MatchCrowns = (self.p2MatchCrowns || 0) + pts;
					}
					self.triggerFlyingCrown(firstLocal, row, pts);
				}

				var myWpm = (self.mySlot === 'p1') ? payload.p1Wpm : payload.p2Wpm;
				var oppWpm = (self.mySlot === 'p1') ? payload.p2Wpm : payload.p1Wpm;
				var oppRows = (self.mySlot === 'p1') ? payload.p2Rows : payload.p1Rows;

				self.playerLiveWpm = myWpm || 0;
				self.opponentLiveWpm = oppWpm || 0;
				var prevOppRows = self.opponentRowsSolved;
				self.opponentRowsSolved = oppRows || 0;

				var hudP1Wpm = document.getElementById('vs-p1-wpm');
				var hudP2Wpm = document.getElementById('vs-p2-wpm');
				if (hudP1Wpm && self.playerLiveWpm > 0) hudP1Wpm.textContent = Math.round(self.playerLiveWpm) + 'WPM';
				if (hudP2Wpm && self.opponentLiveWpm > 0) hudP2Wpm.textContent = Math.round(self.opponentLiveWpm) + 'WPM';

				self.pulseHudAvatar(solverLocal);
				if (solverLocal === 'p2') {
					AudioManager.play('tilehit', 0.30);
				}

				// Update 3D Opponent Avatar Beacon position on active tray
				if (oppRows !== prevOppRows) {
					setOpponentActiveRow(self.opponentRowsSolved + 1, true);
				} else {
					setOpponentActiveRow(self.opponentRowsSolved + 1, false);
				}
			});

			room.onMessage('match_finished', function (payload) {
				if (!self.isActive || self.room !== room) return;

				self.matchFinished = true;
				if (opponentRowIndicatorGroup) {
					opponentRowIndicatorGroup.visible = false;
				}
				self.lastMatchSummary = payload || null;
				self.canRematch = !!payload.canRematch;
				var oppSummaryName = (self.mySlot === 'p1') ? payload.p2Username : payload.p1Username;
				if (oppSummaryName) {
					self.opponentUsername = oppSummaryName;
				}
				var localWinner = (payload.winnerSlot === self.mySlot) ? 'p1' : 'p2';
				self.winner = localWinner;

				// Sync authoritative row claim map & award Word Crowns (1 point per letter per word)
				var earnedCrowns = 0;
				var words = (currentLevelData && currentLevelData.words) ? currentLevelData.words : [];
				var authoritativeClaims = payload.firstSolverByRow || self.firstSolverByRow || {};

				Object.keys(authoritativeClaims).forEach(function (rk) {
					var rIdx = Number(rk);
					var isLocalFirst = (authoritativeClaims[rk] === self.mySlot || authoritativeClaims[rk] === 'p1');
					self.firstSolverByRow[rIdx] = isLocalFirst ? 'p1' : 'p2';
					self.applyRowClaimMaterial(rIdx);
					if (isLocalFirst && rIdx > 0 && rIdx < words.length) {
						var wordLen = (words[rIdx] && words[rIdx].answer) ? words[rIdx].answer.length : 5;
						earnedCrowns += wordLen;
					}
				});

				self.lastEarnedCrowns = earnedCrowns;
				if (earnedCrowns > 0) {
					self.addWordCrowns(earnedCrowns);
				}
				self.recordMatchResult(localWinner === 'p1');

				var myFinalWpm = (self.mySlot === 'p1') ? payload.p1Wpm : payload.p2Wpm;
				var oppFinalWpm = (self.mySlot === 'p1') ? payload.p2Wpm : payload.p1Wpm;
				if (myFinalWpm > 0) {
					self.recordMatchWpm(myFinalWpm);
					var hudP1Wpm = document.getElementById('vs-p1-wpm');
					if (hudP1Wpm) hudP1Wpm.textContent = Math.round(myFinalWpm) + 'WPM';
				}
				if (oppFinalWpm > 0) {
					var hudP2Wpm = document.getElementById('vs-p2-wpm');
					if (hudP2Wpm) hudP2Wpm.textContent = Math.round(oppFinalWpm) + 'WPM';
				}

				// If Match Results modal is already visible, refresh with authoritative server totals
				var resModal = document.getElementById('vs-results-modal');
				if (resModal && resModal.classList.contains('show')) {
					self.populateMatchResultsDOM();
				}

				var p1Crown = document.getElementById('vs-p1-crown');
				var p2Crown = document.getElementById('vs-p2-crown');
				if (localWinner === 'p1') {
					if (p1Crown) p1Crown.classList.add('show');
					// If opponent forfeited mid-race while local player hadn't finished the final row yet, trigger win celebration now
					if (payload.byForfeit && !isCelebratingWin) {
						self.abortActiveBoardInteraction();
						setTimeout(function () {
							if (self.isActive && !isCelebratingWin) triggerWinCelebration();
						}, 260);
					}
				} else {
					if (p2Crown) p2Crown.classList.add('show');
					self.abortActiveBoardInteraction();
					setTimeout(function () {
						if (self.isActive && self.winner === 'p2' && !isCelebratingWin) {
							triggerWinCelebration();
						}
					}, 260);
				}
			});

			room.onMessage('rematch_status', function (payload) {
				if (!self.room || self.room !== room) return;
				var votes = payload.votes || [];
				var myVoted = votes.indexOf(self.mySlot) !== -1;
				var oppSlot = (self.mySlot === 'p1') ? 'p2' : 'p1';
				var oppVoted = votes.indexOf(oppSlot) !== -1;

				var btnNextEl = document.getElementById('btn-vs-results-next');
				var subEl = document.getElementById('vs-results-sub');

				if (oppVoted && !myVoted) {
					// Opponent wants a rematch!
					if (btnNextEl) {
						btnNextEl.textContent = 'ACCEPT REMATCH';
						btnNextEl.disabled = false;
						btnNextEl.classList.add('vs-pulse-rematch');
					}
					if (subEl) {
						var reqName = payload.requesterUsername || self.opponentUsername || 'Opponent';
						subEl.textContent = '⚡ ' + reqName + ' requested a Rematch!';
					}
					AudioManager.playSnap(1.4);
					AudioManager.haptic(25);
				} else if (myVoted && !oppVoted) {
					// We requested rematch, waiting for opponent
					if (btnNextEl) {
						btnNextEl.textContent = 'WAITING FOR OPPONENT...';
						btnNextEl.disabled = true;
						btnNextEl.classList.remove('vs-pulse-rematch');
					}
					if (subEl && !self.rematchWaitTimer) {
						subEl.textContent = 'Rematch requested! Waiting for ' + (self.opponentUsername || 'opponent') + ' to accept...';
					}
				}
			});

			room.onMessage('rematch_unavailable', function (payload) {
				self.canRematch = false;
				var oppName = self.opponentUsername || 'Opponent';
				var msg = (payload && payload.message) || (oppName + ' left the match.');
				if (self.isSearching) {
					self.leaveRoomSilently();
					self.cancelSearchToSelect(msg);
				} else {
					self.handleRematchTimeout(msg + ' Returning to lobby...');
				}
			});

			room.onLeave(function () {
				if (self.room === room) {
					self.room = null;
					self.canRematch = false;
					if (self.rematchWaitTimer || self.rematchAbortTimer) {
						self.handleRematchTimeout('Match room closed. Returning to lobby...');
					} else {
						var btnNextEl = document.getElementById('btn-vs-results-next');
						if (btnNextEl) {
							btnNextEl.textContent = 'NEXT MATCH';
							btnNextEl.disabled = false;
							btnNextEl.classList.remove('vs-pulse-rematch');
						}
					}
				}
			});
		},

		abortActiveBoardInteraction: function () {
			if (activeTile) {
				activeTile.isDragging = false;
				if (activeTile.currentSlot) {
					activeTile.setTarget(activeTile.currentSlot.worldPos.x, activeTile.currentSlot.worldPos.y, activeTile.currentSlot.worldPos.z);
					activeTile.targetRotation.set(0, 0, 0);
				}
				activeTile = null;
			}
			if (hoverSlotHighlightMesh) hoverSlotHighlightMesh.visible = false;
			isRowShaking = false;
			isComboPlaying = false;
		},

		beginSyncedMatch: function (serverLevelIndex) {
			this.hideMatchResults();
			this.clearSearchTimers();

			var modal = document.getElementById('vs-lobby-modal');
			if (modal) modal.classList.remove('show');

			var btnNextEl = document.getElementById('btn-vs-results-next');
			if (btnNextEl) {
				btnNextEl.disabled = false;
				btnNextEl.classList.remove('vs-pulse-rematch');
			}

			this.isActive = true;
			this.raceStarted = false;
			this.raceStartTime = performance.now();
			this.playerRowsSolved = 0;
			this.opponentRowsSolved = 0;
			this.firstSolverByRow = {};
			this.matchFinished = false;
			this.lastMatchSummary = null;
			this.winner = null;
			this.lastEarnedCrowns = 0;
			this.p1MatchCrowns = 0;
			this.p2MatchCrowns = 0;
			this.playerLiveWpm = 0;
			this.opponentLiveWpm = 0;
			this.lastVsLevelIndex = serverLevelIndex;

			document.body.classList.add('vs-mode-active');

			var hudP1Img = document.getElementById('vs-p1-avatar');
			var hudP2Img = document.getElementById('vs-p2-avatar');
			var hudP1Wpm = document.getElementById('vs-p1-wpm');
			var hudP2Wpm = document.getElementById('vs-p2-wpm');
			var hudP1Name = document.getElementById('vs-p1-name');
			var hudP2Name = document.getElementById('vs-p2-name');
			var p1Crown = document.getElementById('vs-p1-crown');
			var p2Crown = document.getElementById('vs-p2-crown');
			var p1CrownsEl = document.getElementById('vs-p1-crowns');
			var p2CrownsEl = document.getElementById('vs-p2-crowns');

			if (hudP1Img) hudP1Img.src = this.getAvatarPath(this.playerAvatar);
			if (hudP2Img) hudP2Img.src = this.getAvatarPath(this.opponentAvatar);
			if (hudP1Wpm) hudP1Wpm.textContent = '0WPM';
			if (hudP2Wpm) hudP2Wpm.textContent = '0WPM';
			if (hudP1Name) hudP1Name.textContent = this.getDisplayUsername();
			if (hudP2Name) hudP2Name.textContent = this.opponentUsername || 'Opponent';
			if (p1Crown) p1Crown.classList.remove('show');
			if (p2Crown) p2Crown.classList.remove('show');
			if (p1CrownsEl) p1CrownsEl.textContent = '👑 0';
			if (p2CrownsEl) p2CrownsEl.textContent = '👑 0';

			var toast = document.getElementById('toast-banner');
			if (toast) toast.classList.remove('show');

			if (typeof this.hideTitleScreenFn === 'function') {
				this.hideTitleScreenFn();
			} else if (titleScreenEl) {
				titleScreenEl.classList.add('hide');
				titleScreenEl.classList.add('hidden');
				titleScreenEl.style.display = 'none';
			}

			loadLevel(serverLevelIndex);
			requestAnimationFrame(function () {
				updateCameraFraming();
			});
		},

		onRaceStart: function () {
			if (!this.isActive || this.matchFinished) return;
			if (!this.raceStarted) {
				this.raceStarted = true;
				this.raceStartTime = performance.now();
			}
			updateOpponentBeaconAppearance(this.opponentAvatar, this.opponentUsername);
			setOpponentActiveRow(this.opponentRowsSolved + 1, false);
			if (this.room) {
				try {
					this.room.send('ready_for_race');
				} catch (e) {}
			}
		},

		getRowFirstSolver: function (rowIdx) {
			return this.firstSolverByRow[rowIdx] || null;
		},

		applyRowClaimMaterial: function (rowIdx) {
			if (!this.isActive || rowIdx < 1) return;
			var rowInfo = chainRowData[rowIdx];
			if (!rowInfo || !rowInfo.rackMesh || !rowInfo.lipMesh) return;
			var solver = this.firstSolverByRow[rowIdx];
			if (!solver) return;

			if (solver === 'p1' && materials.vsTrayBlue) {
				rowInfo.rackMesh.material = materials.vsTrayBlue;
				rowInfo.lipMesh.material = materials.vsTrayBlue;
			} else if (solver === 'p2' && materials.vsTrayRed) {
				rowInfo.rackMesh.material = materials.vsTrayRed;
				rowInfo.lipMesh.material = materials.vsTrayRed;
			}
		},

		onPlayerSolvedRow: function (rowIdx, totalRows, spelledWord) {
			if (!this.isActive || this.matchFinished) return;

			this.playerRowsSolved = rowIdx;
			// Optimistic local visual feedback while server confirms authoritative order
			if (!this.firstSolverByRow[rowIdx]) {
				this.firstSolverByRow[rowIdx] = 'p1';
				this.applyRowClaimMaterial(rowIdx);
				this.pulseHudAvatar('p1');
				var pts = this.getRowWordLength(rowIdx);
				this.p1MatchCrowns = (this.p1MatchCrowns || 0) + pts;
				this.triggerFlyingCrown('p1', rowIdx, pts);
			}

			if (this.room) {
				try {
					this.room.send('row_solved', {
						row: rowIdx,
						word: spelledWord
					});
				} catch (e) {}
			}

			// Optimistic local finish guard if completing the final word first
			if (rowIdx >= totalRows - 1 && !this.winner) {
				this.winner = 'p1';
				var p1Crown = document.getElementById('vs-p1-crown');
				if (p1Crown) p1Crown.classList.add('show');
			}

			// Ensure opponent beacon stays correctly positioned relative to local player row
			setOpponentActiveRow(this.opponentRowsSolved + 1, false);
		},

		exitVsMode: function () {
			this.hideMatchResults();
			this.clearSearchTimers();
			this.leaveRoomSilently();
			if (phraseCouplerGroup) phraseCouplerGroup.visible = false;
			if (opponentRowIndicatorGroup) opponentRowIndicatorGroup.visible = false;
			var wasActive = this.isActive;
			this.isActive = false;
			this.raceStarted = false;
			this.matchFinished = false;
			this.lastMatchSummary = null;
			this.winner = null;
			this.firstSolverByRow = {};
			this.lastEarnedCrowns = 0;
			this.p1MatchCrowns = 0;
			this.p2MatchCrowns = 0;

			document.body.classList.remove('vs-mode-active');
			var p1Crown = document.getElementById('vs-p1-crown');
			var p2Crown = document.getElementById('vs-p2-crown');
			if (p1Crown) p1Crown.classList.remove('show');
			if (p2Crown) p2Crown.classList.remove('show');
			var p1CrownsEl = document.getElementById('vs-p1-crowns');
			var p2CrownsEl = document.getElementById('vs-p2-crowns');
			if (p1CrownsEl) p1CrownsEl.textContent = '👑 0';
			if (p2CrownsEl) p2CrownsEl.textContent = '👑 0';

			this.updateProfileUI();

			if (wasActive) {
				requestAnimationFrame(function () {
					updateCameraFraming();
				});
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
	var chainRowData = []; // Array of row metadata: { row, rowGroup, rackMesh, lipMesh, rz, rowY, rackTilt, rackWidth, wordLen, slots, brackets }

	// Camera Perspective View Mode: 'incline' (3D Star Wars / Guitar Hero angled highway) vs 'classic' (Traditional top-down view)
	var perspectiveMode = (function () {
		try {
			var saved = localStorage.getItem('word_chain_perspective_mode');
			if (saved === 'classic' || saved === 'incline') return saved;
		} catch (e) {}
		return 'incline';
	})();

	// Active Row & Snap Visual Indicators
	var activeRowIndicatorGroup = null;
	var activeRowIndicatorBadge = null;
	var chevronMesh = null;
	var chevronRightMesh = null;
	var hoverSlotHighlightMesh = null;

	// 3D Opponent Active Row Indicator (Floating Beacon tracking Opponent's active tray in PVP)
	var opponentRowIndicatorGroup = null;
	var opponentChevronMesh = null;
	var opponentAvatarMesh = null;
	var opponentAvatarTexture = null;
	var opponentNameSprite = null;
	var opponentIndicatorState = {
		activeRow: 1,
		targetPos: new THREE.Vector3(0, 0, 0),
		fromPos: new THREE.Vector3(0, 0, 0),
		currentPos: new THREE.Vector3(0, 0, 0),
		isTransitioning: false,
		transitionStart: 0,
		transitionDuration: 420
	};

	// 3D Phrase Coupler: Visually connecting the two current solvable trays (e.g. TENNIS-MATCH or MATCH-POINT)
	var phraseCouplerGroup = null;
	var leftMountUpper = null;
	var leftMountLower = null;
	var rightMountUpper = null;
	var rightMountLower = null;
	var leftLinks = [];
	var rightLinks = [];
	var centerChainGroup = null;

	// Dynamic Physical Chain Swing & Snap Animation State
	var chainSwingState = {
		active: false,
		startTime: 0,
		duration: 0.44, // duration in seconds
		hasSnapped: false,
		prevRowIdx: 0,
		currRowIdx: 1,
		lastTargetRow: -1
	};

	// Ghost Tile Hint System State (translucent guide tile on top board)
	var ghostTileMesh = null;
	var currentGhostSlot = null;
	var currentGhostLetter = null;
	var titleScreenEl = null;

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
	var victoryTrayGroup = null;
	var winCelebrationState = null;
	var celebrationParticles = []; // Confetti & Star meshes (reserved for gift unboxing)
	var confettiGroup = null;
	var activeGiftBoxes = []; // 3D Gift Box reward instances on word racks

	// Materials Cache
	var materials = {};

	function initMaterials() {
		var startSkin = TILE_SKINS[currentSkinId] || TILE_SKINS.classic;
		var isLightTile = (startSkin.tone !== 'dark');
		var scId = (global.WordscapesScenery && global.WordscapesScenery.getCurrent) ? global.WordscapesScenery.getCurrent() : null;
		var themeName = (scId === 'volcano') ? 'volcano' : (isLightTile ? 'dark' : 'light');
		var trayTheme = TextureManager.getTrayThemeTextures(themeName);

		var tileSideWoodMap = TextureManager.getHardwoodTexture(startSkin.sideBase, startSkin.sideDark, startSkin.sideLight);
		var tileLockedWoodMap = TextureManager.getHardwoodTexture('#f2de9f', '#aa833e', '#fff1c7');

		// Word Chain Racks (Default rack wood)
		materials.yellowTray = new THREE.MeshStandardMaterial({
			map: trayTheme.rackWood,
			color: 0xffffff,
			roughness: trayTheme.rackRoughness,
			metalness: 0.0
		});

		// Active row rack (Highlighted illuminated carved wood)
		materials.yellowTrayActive = new THREE.MeshStandardMaterial({
			map: trayTheme.activeWood,
			color: 0xffffff,
			emissive: trayTheme.activeEmissive,
			emissiveIntensity: trayTheme.activeEmissiveIntensity,
			roughness: trayTheme.activeRoughness,
			metalness: 0.0
		});

		// Connected Phrase Partner row rack (Warm luminous amber wood coupling the phrase)
		materials.yellowTrayPartner = new THREE.MeshStandardMaterial({
			map: trayTheme.partnerWood,
			color: 0xffffff,
			emissive: trayTheme.partnerEmissive,
			emissiveIntensity: trayTheme.partnerEmissiveIntensity,
			roughness: trayTheme.partnerRoughness,
			metalness: 0.0
		});

		// 3D Physical Radiant Golden Chain Links (glowing, polished, chunky)
		materials.goldChainLink = new THREE.MeshStandardMaterial({
			color: 0xffe033,
			emissive: 0xff9900,
			emissiveIntensity: 0.85,
			roughness: 0.16,
			metalness: 0.92
		});

		// Brushed glowing brass mount brackets and connector struts
		materials.brassBracket = new THREE.MeshStandardMaterial({
			color: 0xf5a524,
			emissive: 0x884400,
			emissiveIntensity: 0.45,
			roughness: 0.26,
			metalness: 0.85
		});

		// Radiant glowing connection beam in the inter-rack gap
		materials.couplerGlowBeam = new THREE.MeshBasicMaterial({
			color: 0xffbe1a,
			transparent: true,
			opacity: 0.65,
			depthWrite: false,
			blending: THREE.AdditiveBlending
		});

		// Solved row rack (Settled antique carved wood)
		materials.yellowTraySolved = new THREE.MeshStandardMaterial({
			map: trayTheme.solvedWood,
			color: 0xffffff,
			roughness: trayTheme.solvedRoughness,
			metalness: 0.0
		});

		// Pending row rack (Muted dimmed carved wood)
		materials.yellowTrayDimmed = new THREE.MeshStandardMaterial({
			map: trayTheme.dimmedWood,
			color: 0xffffff,
			roughness: trayTheme.dimmedRoughness,
			metalness: 0.0
		});

		// VS Mode Player 1 (Blue) claimed tray wood (rich deep royal blue matching avatar ring)
		materials.vsTrayBlue = new THREE.MeshStandardMaterial({
			map: TextureManager.getHardwoodTexture('#07477a', '#032645', '#0e639c'),
			color: 0xffffff,
			emissive: 0x031a30,
			emissiveIntensity: 0.08,
			roughness: 0.68,
			metalness: 0.0
		});

		// VS Mode Player 2 (Red) claimed tray wood (rich deep crimson matching avatar ring)
		materials.vsTrayRed = new THREE.MeshStandardMaterial({
			map: TextureManager.getHardwoodTexture('#78080c', '#420305', '#9e0b0f'),
			color: 0xffffff,
			emissive: 0x260203,
			emissiveIntensity: 0.08,
			roughness: 0.68,
			metalness: 0.0
		});

		// VS Opponent Active Row Indicator Materials (Crisp crimson & red ring)
		materials.opponentChevron = new THREE.MeshBasicMaterial({
			color: 0xef4444
		});

		materials.opponentRing = new THREE.MeshBasicMaterial({
			color: 0xef4444
		});

		// Letter Holder Tray Body (Player hand / staging tray - always visually distinct!)
		materials.greenTray = new THREE.MeshStandardMaterial({
			map: trayTheme.greenWood,
			color: 0xffffff,
			roughness: trayTheme.greenRoughness,
			metalness: 0.0
		});

		// Letter Holder Tray Front Lip (Distinct polished champagne-brass accent rim)
		materials.feederTrayLip = new THREE.MeshStandardMaterial({
			map: trayTheme.greenWood,
			color: 0xdeb86a,
			roughness: 0.38,
			metalness: 0.55
		});

		// Feeder Tray Slot Felt Lining (Rich emerald velvet felt bed)
		materials.feederFelt = new THREE.MeshStandardMaterial({
			color: trayTheme.feederFeltColor || 0x0f2619,
			roughness: 0.88,
			metalness: 0.0,
			polygonOffset: true,
			polygonOffsetFactor: -1,
			polygonOffsetUnits: -2
		});

		// Tray slot felt lining
		materials.slotFelt = new THREE.MeshStandardMaterial({
			color: trayTheme.feltColor,
			roughness: 0.90,
			metalness: 0.0,
			polygonOffset: true,
			polygonOffsetFactor: -1,
			polygonOffsetUnits: -2
		});

		// Slot hover snap indicator
		materials.slotHover = new THREE.MeshBasicMaterial({
			map: TextureManager.getSlotHoverTexture(),
			transparent: true,
			opacity: 0.85,
			depthWrite: false,
			polygonOffset: true,
			polygonOffsetFactor: -2,
			polygonOffsetUnits: -4
		});

		// Active slot brackets (corner targets [ ])
		materials.activeSlotBracket = new THREE.MeshBasicMaterial({
			map: TextureManager.getSlotBracketTexture(trayTheme.bracketVariant),
			transparent: true,
			opacity: 0.75,
			depthWrite: false,
			polygonOffset: true,
			polygonOffsetFactor: -2,
			polygonOffsetUnits: -4
		});

		// 3D Chevron Arrow Material
		materials.chevron = new THREE.MeshStandardMaterial({
			color: trayTheme.chevronColor,
			emissive: trayTheme.chevronEmissive,
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

		// 3D Gift Box Materials (Ruby Red body with Polished Gold ribbon for Tiles)
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

		// 3D Gift Box Materials (Emerald Green body with Luminous Gold ribbon for Environments)
		materials.giftBoxEmerald = new THREE.MeshStandardMaterial({
			color: 0x10b981,
			emissive: 0x064e3b,
			emissiveIntensity: 0.22,
			roughness: 0.35,
			metalness: 0.15
		});

		materials.giftBoxEmeraldRibbon = new THREE.MeshStandardMaterial({
			color: 0xfef08a,
			emissive: 0xa16207,
			emissiveIntensity: 0.25,
			roughness: 0.22,
			metalness: 0.65
		});
	}

	// --------------------------------------------------------------------------
	// 3D Tile Class (Shared Geometry & Cached Face Materials for Zero-Lag Spawns)
	// --------------------------------------------------------------------------
	var sharedTileBoxGeometry = null;
	var cachedTileFaceMaterials = {};

	function getSharedTileFaceMaterial(letter) {
		var key = (currentSkinId || 'classic') + ':' + (letter || 'A');
		if (cachedTileFaceMaterials[key]) {
			return cachedTileFaceMaterials[key];
		}
		var faceTex = TextureManager.getLetterTexture(letter);
		var faceMat = new THREE.MeshStandardMaterial({
			map: faceTex,
			color: FACE_DIFFUSE,
			emissive: 0xffffff,
			emissiveMap: faceTex,
			emissiveIntensity: FACE_EMISSIVE,
			roughness: 0.9,
			metalness: 0.0,
			toneMapped: false
		});
		cachedTileFaceMaterials[key] = faceMat;
		return faceMat;
	}

	function Tile(letter, isLocked) {
		this.letter = letter;
		this.isLocked = !!isLocked;
		this.currentSlot = null;

		// Shared Geometry: 1.04 x 0.28 x 1.04 (allocated once for the entire game)
		if (!sharedTileBoxGeometry) {
			sharedTileBoxGeometry = new THREE.BoxGeometry(1.04, 0.28, 1.04);
		}
		var geom = sharedTileBoxGeometry;

		// Multi-material: Top face (Index 2 in BoxGeometry is +Y face)
		var faceMat = getSharedTileFaceMaterial(letter);
		var sideMat = this.isLocked ? materials.tileLocked : materials.tileWood;

		// BoxGeometry faces order: +X, -X, +Y, -Y, +Z, -Z
		var mats = [
			sideMat, // +X
			sideMat, // -X
			faceMat, // +Y (Top face with letter texture)
			materials.slotFelt || sideMat, // -Y (Bottom face)
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
				// Warm golden glow over the tile art
				faceMat.emissive.setHex(0xffd27a);
				faceMat.emissiveIntensity = 1.25;
			} else {
				faceMat.emissive.setHex(0xffffff);
				faceMat.emissiveIntensity = FACE_EMISSIVE;
			}
			faceMat.needsUpdate = true;
		}
	};

	Tile.prototype.startSnapFx = function () {
		this.inSnap = true;
		this.snapTimer = 0;
		this.snapDuration = 0.20;
		if (typeof SpeedometerManager !== 'undefined') {
			SpeedometerManager.onTileInteraction();
		}
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
		// Frame-rate-independent snappy exponential interpolation (fast flight even on mobile frame dips)
		var lerpRate = this.isDragging ? (1.0 - Math.exp(-28.0 * dt)) : (1.0 - Math.exp(-22.0 * dt));

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

		// Wave jump physics
		var waveExtraY = 0;
		var waveExtraZ = 0;
		var waveTiltX = 0;
		if (this.inWave) {
			this.waveTimer += dt;
			if (this.waveTimer >= 0 && this.waveTimer <= this.waveDuration) {
				var p = this.waveTimer / this.waveDuration;
				var waveAmount = Math.sin(p * Math.PI) * this.wavePeakHeight;
				// Leaps visually UP on screen (-Z) with subtle tray lift (+Y)
				waveExtraZ = -waveAmount * 0.85;
				waveExtraY = waveAmount * 0.28;
				waveTiltX = Math.sin(p * Math.PI * 2) * -0.14;
			} else if (this.waveTimer > this.waveDuration) {
				this.inWave = false;
				this.mesh.rotation.x = this.targetRotation.x;
			}
		}

		// Winning combination upwards hop physics:
		// Jumps visually UP along the board towards top of screen (-Z) with natural physical lift (+Y)
		// NEVER jumps forward into camera/player's face (+Y only).
		var hopExtraY = 0;
		var hopExtraZ = 0;
		var hopTiltX = 0;
		if (this.inHop) {
			this.hopTimer += dt;
			if (this.hopTimer <= this.hopDuration) {
				var hp = this.hopTimer / this.hopDuration;
				var hopAmount = Math.sin(hp * Math.PI) * this.hopPeakHeight;
				// Screen-up is towards -Z (top of the board); rack-normal lift is +Y
				hopExtraZ = -hopAmount * 0.90;
				hopExtraY = hopAmount * 0.28;
				hopTiltX = -Math.sin(hp * Math.PI) * 0.10;
			} else {
				this.inHop = false;
			}
		}

		// Interpolate Z: include wave & hop upward displacement smoothly
		var targetZ = this.targetPosition.z + waveExtraZ + hopExtraZ;
		this.mesh.position.z += (targetZ - this.mesh.position.z) * ((this.inHop || this.inWave) ? 0.35 : lerpRate);

		// Y elevation with spring settle
		var targetY = this.targetPosition.y + (this.isDragging ? 1.35 : 0) + waveExtraY + hopExtraY;
		this.mesh.position.y += (targetY - this.mesh.position.y) * 0.35;

		// Rotation tilt interpolation
		this.mesh.rotation.x += ((this.targetRotation.x + waveTiltX + hopTiltX) - this.mesh.rotation.x) * 0.25;
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

		// 5. 3D Phrase Coupler (Visually chains the two current solvable trays together)
		initPhraseCoupler();

		// 6. 3D Opponent Active Row Indicator (Floating Beacon tracking Opponent's active tray in PVP)
		initOpponentRowIndicator();
	}

	/**
	 * 3D Phrase Coupler:
	 * Visually and physically connects the two solvable trays in real-time
	 * (e.g. TENNIS-MATCH or MATCH-POINT) so players clearly understand the compound phrase.
	 * Features:
	 *  - Left and Right flank heavy interlocking golden chain links with brass mount brackets
	 *  - Central inter-rack double interlocking golden chain link (⛓️) emblem
	 *  - Symmetrical polished brass connecting bridge struts across the inter-rack gap
	 *  - Luminous glowing connector beam spanning between the two racks
	 *  - Dynamic physical pendulum SWING and SNAP animation as words advance
	 *  - Elevated ON TOP of the tray wood layer, positioned outside letter slots so it NEVER covers any letter!
	 */
	function initPhraseCoupler() {
		phraseCouplerGroup = new THREE.Group();
		phraseCouplerGroup.visible = false;
		// Render order 8 ensures it renders cleanly on TOP of the wooden tray layer
		phraseCouplerGroup.renderOrder = 8;

		// Chunky Brushed Brass Mount Brackets for Left & Right rack ends (24 x 28 x 40)
		var mountGeom = new THREE.BoxGeometry(0.24, 0.28, 0.40);

		leftMountUpper = new THREE.Mesh(mountGeom, materials.brassBracket);
		leftMountLower = new THREE.Mesh(mountGeom, materials.brassBracket);
		phraseCouplerGroup.add(leftMountUpper);
		phraseCouplerGroup.add(leftMountLower);

		rightMountUpper = new THREE.Mesh(mountGeom, materials.brassBracket);
		rightMountLower = new THREE.Mesh(mountGeom, materials.brassBracket);
		phraseCouplerGroup.add(rightMountUpper);
		phraseCouplerGroup.add(rightMountLower);

		// Chunky Side Flank Chain Links (larger: radius 0.24, tube 0.072)
		var linkGeom = new THREE.TorusGeometry(0.24, 0.072, 14, 26);
		leftLinks = [];
		rightLinks = [];

		for (var i = 0; i < 3; i++) {
			var lLink = new THREE.Mesh(linkGeom, materials.goldChainLink);
			if (i === 1) {
				lLink.rotation.set(0, Math.PI * 0.5, 0);
				lLink.userData.baseRotX = 0;
			} else {
				lLink.rotation.set(Math.PI * 0.5, 0, 0);
				lLink.userData.baseRotX = Math.PI * 0.5;
			}
			phraseCouplerGroup.add(lLink);
			leftLinks.push(lLink);

			var rLink = new THREE.Mesh(linkGeom, materials.goldChainLink);
			if (i === 1) {
				rLink.rotation.set(0, Math.PI * 0.5, 0);
				rLink.userData.baseRotX = 0;
			} else {
				rLink.rotation.set(Math.PI * 0.5, 0, 0);
				rLink.userData.baseRotX = Math.PI * 0.5;
			}
			phraseCouplerGroup.add(rLink);
			rightLinks.push(rLink);
		}

		scene.add(phraseCouplerGroup);
	}

	function isGamePlayActive() {
		// 1. Title Screen visible: game has NOT started!
		var titleEl = document.getElementById('title-screen');
		if (titleEl && !titleEl.classList.contains('hidden') && !titleEl.classList.contains('hide') && titleEl.style.display !== 'none') {
			return false;
		}
		// 2. Win celebration / Level completed: chain must be hidden!
		if (isCelebratingWin) {
			return false;
		}
		// 3. Level entrance cascading in progress: trays are not all present yet!
		if (levelEntranceState && levelEntranceState.active) {
			return false;
		}
		// 4. Level solved or beyond valid words
		if (!currentLevelData || !currentLevelData.words || currentWordIndex < 1 || currentWordIndex >= currentLevelData.words.length) {
			return false;
		}
		// 5. No trays present in scene
		if (!chainRowData || chainRowData.length < 2) {
			return false;
		}
		return true;
	}

	function triggerChainSnapSparks(x, y, z) {
		if (typeof createSparkleBurst === 'function') {
			createSparkleBurst(x, y + 0.12, z, 12, false);
		}
	}

	function triggerChainCouplerSnap(prevRow, currRow) {
		if (!phraseCouplerGroup) return;
		if (!isGamePlayActive() || !prevRow || !currRow) {
			phraseCouplerGroup.visible = false;
			return;
		}
		updatePhraseCoupler(prevRow, currRow);
		phraseCouplerGroup.visible = true;

		// Trigger dynamic physical swing and snap animation!
		chainSwingState.active = true;
		chainSwingState.startTime = performance.now();
		chainSwingState.hasSnapped = false;
		chainSwingState.prevRowIdx = currentWordIndex - 1;
		chainSwingState.currRowIdx = currentWordIndex;
		chainSwingState.lastTargetRow = currentWordIndex;
	}

	function updatePhraseCoupler(prevRow, currRow) {
		if (!phraseCouplerGroup) return;
		if (!isGamePlayActive() || !prevRow || !currRow) {
			phraseCouplerGroup.visible = false;
			return;
		}
		phraseCouplerGroup.visible = true;

		var zPrev = prevRow.rz;
		var zCurr = currRow.rz;
		var zMid = (zPrev + zCurr) * 0.5;
		var dz = zCurr - zPrev;

		var yPrev = prevRow.rowY || 0;
		var yCurr = currRow.rowY || 0;
		var yMid = (yPrev + yCurr) * 0.5;

		var wPrev = prevRow.rackWidth;
		var wCurr = currRow.rackWidth;

		// Elevated Y positions: sits squarely ON TOP of the wooden rack layer (never submerged behind!)
		var yElevatedUpper = yPrev + 0.46;
		var yElevatedLower = yCurr + 0.46;
		var yElevatedMid = yMid + 0.48;

		// Lateral X positions: placed outside the letter slots so it NEVER covers any letter!
		var xLPrev = -wPrev * 0.5 - 0.16;
		var xLCurr = -wCurr * 0.5 - 0.16;
		var xRPrev = wPrev * 0.5 + 0.16;
		var xRCurr = wCurr * 0.5 + 0.16;

		// Check if we need to trigger a physical swing & snap onto the new tray
		if (chainSwingState.lastTargetRow !== currentWordIndex) {
			if (chainSwingState.lastTargetRow !== -1) {
				// Trigger swing animation!
				chainSwingState.active = true;
				chainSwingState.startTime = performance.now();
				chainSwingState.hasSnapped = false;
				chainSwingState.prevRowIdx = currentWordIndex - 1;
				chainSwingState.currRowIdx = currentWordIndex;
			}
			chainSwingState.lastTargetRow = currentWordIndex;
		}

		// 1. Position Left Flank Coupler (Upper & Lower Mounts)
		if (leftMountUpper) {
			leftMountUpper.position.set(xLPrev, yElevatedUpper, zPrev);
			leftMountUpper.userData.targetY = yElevatedUpper;
		}
		if (leftMountLower) {
			leftMountLower.position.set(xLCurr, yElevatedLower, zCurr);
			leftMountLower.userData.targetY = yElevatedLower;
		}

		for (var i = 0; i < leftLinks.length; i++) {
			var tL = (i + 1) / (leftLinks.length + 1);
			var lx = THREE.MathUtils.lerp(xLPrev, xLCurr, tL);
			var ly = THREE.MathUtils.lerp(yElevatedUpper, yElevatedLower, tL) + 0.06;
			var lz = THREE.MathUtils.lerp(zPrev, zCurr, tL);
			leftLinks[i].position.set(lx, ly, lz);
			leftLinks[i].userData.targetY = ly;
		}

		// 2. Position Right Flank Coupler (Upper & Lower Mounts)
		if (rightMountUpper) {
			rightMountUpper.position.set(xRPrev, yElevatedUpper, zPrev);
			rightMountUpper.userData.targetY = yElevatedUpper;
		}
		if (rightMountLower) {
			rightMountLower.position.set(xRCurr, yElevatedLower, zCurr);
			rightMountLower.userData.targetY = yElevatedLower;
		}

		for (var j = 0; j < rightLinks.length; j++) {
			var tR = (j + 1) / (rightLinks.length + 1);
			var rx = THREE.MathUtils.lerp(xRPrev, xRCurr, tR);
			var ry = THREE.MathUtils.lerp(yElevatedUpper, yElevatedLower, tR) + 0.06;
			var rz = THREE.MathUtils.lerp(zPrev, zCurr, tR);
			rightLinks[j].position.set(rx, ry, rz);
			rightLinks[j].userData.targetY = ry;
		}
	}

	/**
	 * Compute board layout coordinates ensuring generous clear space between
	 * the chained word racks and the player's feeder/staging tray.
	 */
	function getBoardLayout(numRows) {
		numRows = Math.max(2, numRows || 5);
		var rowSpacing = (numRows >= 8) ? 1.38 : ((numRows >= 7) ? 1.44 : 1.50);
		var rackSpan = (numRows - 1) * rowSpacing;

		// Position startZ so racks sit in the upper half of the view
		var startZ = -rackSpan * 0.5 - 0.75;
		var maxRackZ = startZ + rackSpan;

		// Generous clear space between the last chain tray and the feeder tray
		// rackDepth is 1.30 (half 0.65), trayDepth is 1.44 (half 0.72)
		// A gap of 1.25 units gives clear, comfortable physical separation between the chain trays and feeder tray!
		var trayGap = 1.25;
		var stagingZ = maxRackZ + 0.65 + trayGap + 0.72;

		return {
			numRows: numRows,
			startZ: startZ,
			maxRackZ: maxRackZ,
			rowSpacing: rowSpacing,
			stagingZ: stagingZ,
			trayGap: trayGap
		};
	}

	/**
	 * 3D Opponent Active Row Indicator (Opponent Avatar Beacon)
	 * Floating 3D beacon displaying the opponent's face, red emissive outer ring,
	 * red chevron pointer, and glowing name tag sprite.
	 * Dynamically tracks and indicates which word the opponent is currently solving in PVP mode.
	 */
	function initOpponentRowIndicator() {
		opponentRowIndicatorGroup = new THREE.Group();
		opponentRowIndicatorGroup.visible = false;
		opponentRowIndicatorGroup.renderOrder = 9;

		// 1. Red Extruded Chevron pointing left towards tray ◀
		var arrowShape = new THREE.Shape();
		arrowShape.moveTo(-0.14, -0.16);
		arrowShape.lineTo(0.18, 0);
		arrowShape.lineTo(-0.14, 0.16);
		arrowShape.lineTo(-0.07, 0);
		arrowShape.closePath();

		var arrowGeom = new THREE.ExtrudeGeometry(arrowShape, {
			steps: 1,
			depth: 0.09,
			bevelEnabled: true,
			bevelThickness: 0.02,
			bevelSize: 0.02,
			bevelSegments: 2
		});

		opponentChevronMesh = new THREE.Mesh(arrowGeom, materials.opponentChevron);
		opponentChevronMesh.rotation.x = -Math.PI * 0.5;
		opponentChevronMesh.rotation.z = Math.PI; // Flip 180 to point left
		opponentChevronMesh.position.set(-0.20, 0, 0);
		opponentRowIndicatorGroup.add(opponentChevronMesh);

		// 2. Opponent Avatar Disc (Outer glowing red ring + inner avatar face)
		var discHolder = new THREE.Group();
		discHolder.position.set(0.30, 0, 0);
		discHolder.rotation.x = -Math.PI * 0.5; // Flat to camera looking down from +Y

		// Red outer ring casing
		var ringGeom = new THREE.TorusGeometry(0.40, 0.045, 16, 32);
		var ringMesh = new THREE.Mesh(ringGeom, materials.opponentRing);
		discHolder.add(ringMesh);

		// Dark backing plate
		var backPlate = new THREE.Mesh(
			new THREE.CircleGeometry(0.40, 32),
			new THREE.MeshBasicMaterial({ color: 0x0f172a, side: THREE.DoubleSide })
		);
		discHolder.add(backPlate);

		// Avatar circle face
		var defaultCanvas = document.createElement('canvas');
		defaultCanvas.width = 128;
		defaultCanvas.height = 128;
		var dCtx = defaultCanvas.getContext('2d');
		dCtx.fillStyle = '#0f172a';
		dCtx.fillRect(0, 0, 128, 128);
		opponentAvatarTexture = new THREE.CanvasTexture(defaultCanvas);

		var avatarMat = new THREE.MeshBasicMaterial({
			map: opponentAvatarTexture,
			transparent: true,
			side: THREE.DoubleSide
		});
		opponentAvatarMesh = new THREE.Mesh(new THREE.CircleGeometry(0.39, 32), avatarMat);
		opponentAvatarMesh.position.z = 0.01;
		discHolder.add(opponentAvatarMesh);

		opponentRowIndicatorGroup.add(discHolder);

		// 3. Floating Name Tag Sprite above the avatar disc
		var spriteCanvas = document.createElement('canvas');
		spriteCanvas.width = 320;
		spriteCanvas.height = 76;
		var spriteTex = new THREE.CanvasTexture(spriteCanvas);
		var spriteMat = new THREE.SpriteMaterial({
			map: spriteTex,
			transparent: true,
			depthTest: false
		});
		opponentNameSprite = new THREE.Sprite(spriteMat);
		opponentNameSprite.position.set(0.30, 0.12, -0.56);
		opponentNameSprite.scale.set(1.08, 0.26, 1.0);
		opponentRowIndicatorGroup.add(opponentNameSprite);

		scene.add(opponentRowIndicatorGroup);
	}

	function updateOpponentBeaconAppearance(avatarFileName, opponentName) {
		var avatarFile = avatarFileName || MultiplayerManager.opponentAvatar || 'Character_9.png';
		var avatarSrc = MultiplayerManager.getAvatarPath(avatarFile);
		var img = new Image();
		img.crossOrigin = 'anonymous';
		img.onload = function () {
			var canvas = document.createElement('canvas');
			canvas.width = 256;
			canvas.height = 256;
			var ctx = canvas.getContext('2d');

			// Circular dark background
			ctx.beginPath();
			ctx.arc(128, 128, 124, 0, Math.PI * 2);
			ctx.fillStyle = '#0f172a';
			ctx.fill();

			// Clip avatar inside circle
			ctx.save();
			ctx.beginPath();
			ctx.arc(128, 128, 120, 0, Math.PI * 2);
			ctx.clip();
			ctx.drawImage(img, 0, 0, 256, 256);
			ctx.restore();

			// Crisp red border
			ctx.beginPath();
			ctx.arc(128, 128, 120, 0, Math.PI * 2);
			ctx.lineWidth = 8;
			ctx.strokeStyle = '#ef4444';
			ctx.stroke();

			if (opponentAvatarTexture) {
				opponentAvatarTexture.image = canvas;
				opponentAvatarTexture.needsUpdate = true;
			}
		};
		img.src = avatarSrc;

		// Name Tag Sprite
		if (opponentNameSprite) {
			var nCanvas = document.createElement('canvas');
			nCanvas.width = 320;
			nCanvas.height = 76;
			var nCtx = nCanvas.getContext('2d');

			// Pill background
			nCtx.fillStyle = 'rgba(15, 23, 42, 0.90)';
			nCtx.strokeStyle = '#ef4444';
			nCtx.lineWidth = 3;
			nCtx.beginPath();
			if (typeof nCtx.roundRect === 'function') {
				nCtx.roundRect(4, 4, 312, 68, 28);
			} else {
				nCtx.rect(4, 4, 312, 68);
			}
			nCtx.fill();
			nCtx.stroke();

			// Glowing red indicator pip
			nCtx.fillStyle = '#ef4444';
			nCtx.beginPath();
			nCtx.arc(36, 38, 9, 0, Math.PI * 2);
			nCtx.fill();

			// Opponent name text
			nCtx.font = 'bold 30px Fredoka, -apple-system, sans-serif';
			nCtx.fillStyle = '#ffffff';
			nCtx.textBaseline = 'middle';
			var name = (opponentName || MultiplayerManager.opponentUsername || 'OPPONENT').toUpperCase();
			if (name.length > 9) name = name.slice(0, 8) + '…';
			nCtx.fillText(name, 58, 40);

			if (opponentNameSprite.material && opponentNameSprite.material.map) {
				opponentNameSprite.material.map.image = nCanvas;
				opponentNameSprite.material.map.needsUpdate = true;
			}
		}
	}

	function setOpponentActiveRow(rowIdx, animateTransition) {
		if (!opponentRowIndicatorGroup) return;
		if (!MultiplayerManager.isActive || MultiplayerManager.matchFinished) {
			opponentRowIndicatorGroup.visible = false;
			return;
		}

		var totalRows = (currentLevelData && currentLevelData.words) ? (currentLevelData.words.length - 1) : 4;
		if (rowIdx < 1 || rowIdx > totalRows) {
			opponentRowIndicatorGroup.visible = false;
			return;
		}

		var rowData = chainRowData[rowIdx];
		if (!rowData) {
			opponentRowIndicatorGroup.visible = false;
			return;
		}

		opponentIndicatorState.activeRow = rowIdx;
		var xPos = rowData.rackWidth * 0.5 + 1.02;
		var yPos = 0.28 + (rowData.rowY || 0);
		var zPos = rowData.rz;

		if (!opponentRowIndicatorGroup.visible || !animateTransition) {
			opponentIndicatorState.currentPos.set(xPos, yPos, zPos);
			opponentIndicatorState.targetPos.set(xPos, yPos, zPos);
			opponentRowIndicatorGroup.position.set(xPos, yPos, zPos);
			opponentIndicatorState.isTransitioning = false;
			opponentRowIndicatorGroup.visible = true;
		} else {
			opponentIndicatorState.fromPos.copy(opponentRowIndicatorGroup.position);
			opponentIndicatorState.targetPos.set(xPos, yPos, zPos);
			opponentIndicatorState.isTransitioning = true;
			opponentIndicatorState.transitionStart = performance.now();
			opponentRowIndicatorGroup.visible = true;
			if (typeof AudioManager !== 'undefined') {
				AudioManager.play('tilehit', 0.25);
			}
		}
	}

	/**
	 * Build the bottom green player hand tray.
	 * Dynamically sized and centered to the exact letter count of the active word.
	 */
	function buildStagingTray(stagingZ, wordLength) {
		var numRows = (currentLevelData && currentLevelData.words) ? currentLevelData.words.length : (chainRowData.length || 5);
		var layout = getBoardLayout(numRows);
		stagingZ = (stagingZ !== undefined ? stagingZ : layout.stagingZ);

		while (stagingTrayGroup.children.length > 0) {
			stagingTrayGroup.remove(stagingTrayGroup.children[0]);
		}
		stagingSlots = [];

		var slotCount = Math.max(3, Math.min(8, wordLength || 5));
		var slotWidth = 1.15;
		var trayWidth = slotCount * slotWidth + 0.50;
		var trayDepth = 1.44;
		var trayHeight = 0.36;

		stagingTrayGroup.position.set(0, 0, stagingZ);
		stagingTrayGroup.rotation.x = 0;

		// Main wooden beam (Evergreen / emerald hardwood)
		var beamGeom = new THREE.BoxGeometry(trayWidth, trayHeight, trayDepth);
		var beam = new THREE.Mesh(beamGeom, materials.greenTray);
		beam.position.y = trayHeight * 0.5;
		stagingTrayGroup.add(beam);

		// Front lip (Distinct champagne brass / gilded accent edge)
		var lipGeom = new THREE.BoxGeometry(trayWidth + 0.04, 0.15, 0.15);
		var lip = new THREE.Mesh(lipGeom, materials.feederTrayLip || materials.greenTray);
		lip.position.set(0, trayHeight + 0.075, trayDepth * 0.5 - 0.075);
		stagingTrayGroup.add(lip);

		// Distinct brushed brass side brackets / end-caps on left & right of the feeder tray
		var endCapGeom = new THREE.BoxGeometry(0.08, trayHeight + 0.06, trayDepth + 0.02);
		var leftCap = new THREE.Mesh(endCapGeom, materials.brassBracket);
		leftCap.position.set(-trayWidth * 0.5 - 0.04, (trayHeight + 0.06) * 0.5, 0);
		stagingTrayGroup.add(leftCap);

		var rightCap = new THREE.Mesh(endCapGeom, materials.brassBracket);
		rightCap.position.set(trayWidth * 0.5 + 0.04, (trayHeight + 0.06) * 0.5, 0);
		stagingTrayGroup.add(rightCap);

		// Slots inside tray (using distinct emerald velvet materials.feederFelt!)
		var startX = -((slotCount - 1) * slotWidth) * 0.5;
		var localTileY = trayHeight + 0.155;

		for (var i = 0; i < slotCount; i++) {
			var sx = startX + i * slotWidth;
			var slotMesh = new THREE.Mesh(
				new THREE.PlaneGeometry(1.06, 1.06),
				materials.feederFelt || materials.slotFelt
			);
			slotMesh.rotation.x = -Math.PI * 0.5;
			slotMesh.position.set(sx, trayHeight + 0.015, 0);
			stagingTrayGroup.add(slotMesh);

			var worldPos = new THREE.Vector3(
				sx,
				localTileY,
				stagingZ
			);

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

		// Calculate staging tray Z and rack layout with generous clear space between feeder & chain trays
		var layout = getBoardLayout(numRows);
		var stagingZ = layout.stagingZ;
		var startZ = layout.startZ;
		var rowSpacing = layout.rowSpacing;

		var initialWordLen = (words[0] && words[0].answer) ? words[0].answer.length : 5;
		buildStagingTray(stagingZ, initialWordLen);

		var slotWidth = 1.15;
		var rackDepth = 1.30;
		var rackHeight = 0.34;

		var inclineStep = 0;
		var rackTilt = 0;

		for (var r = 0; r < numRows; r++) {
			var wordObj = words[r];
			var wordLen = wordObj.answer.length;
			var rackWidth = wordLen * slotWidth + 0.50;
			var rz = startZ + r * rowSpacing;
			var rowY = 0;

			var rowGroup = new THREE.Group();
			rowGroup.position.set(0, rowY, rz);
			rowGroup.rotation.x = rackTilt;

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
				sMesh.position.set(sx, rackHeight + 0.015, 0);
				rowGroup.add(sMesh);

				// Glowing target bracket mesh
				var bracketMesh = new THREE.Mesh(
					new THREE.PlaneGeometry(1.16, 1.16),
					materials.activeSlotBracket
				);
				bracketMesh.rotation.x = -Math.PI * 0.5;
				bracketMesh.position.set(sx, rackHeight + 0.026, 0);
				bracketMesh.visible = false;
				rowGroup.add(bracketMesh);
				rowBrackets.push(bracketMesh);

				var slotWorldPos = new THREE.Vector3(
					sx,
					rackHeight + 0.155,
					rz
				);

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
				rowY: rowY,
				rackTilt: rackTilt,
				rackWidth: rackWidth,
				rackHeight: rackHeight,
				wordLen: wordLen,
				slots: rowSlots,
				brackets: rowBrackets
			});

			// 3D Gift Box Spawn: strictly 1 gift box per eligible level on row 2 (or row 1 if short level) - Solo mode only
			var targetGiftRow = (numRows > 3) ? 2 : 1;
			if (!MultiplayerManager.isActive && r === targetGiftRow) {
				var rowReward = UnlockManager.getRewardForLevelRow(currentLevelIndex, 2);
				if (rowReward && !UnlockManager.isOwned(rowReward.type, rowReward.id)) {
					var giftBox = create3DGiftBox(r, rowReward, rackWidth, rz, rackHeight, rowY, rackTilt);
					activeGiftBoxes.push(giftBox);
				}
			}
		}
	}

	/**
	 * Update rack highlight materials, 3D active row indicators, and brackets.
	 * If skipCoupler is true, updates the tray visuals first and leaves the chain to be linked afterwards.
	 */
	function updateActiveRowVisuals(skipCoupler) {
		for (var r = 0; r < chainRowData.length; r++) {
			var rowInfo = chainRowData[r];
			var vsSolver = (MultiplayerManager.isActive && r >= 1) ? MultiplayerManager.getRowFirstSolver(r) : null;
			var vsClaimMat = (vsSolver === 'p1') ? materials.vsTrayBlue : ((vsSolver === 'p2') ? materials.vsTrayRed : null);

			if (r === currentWordIndex) {
				// ACTIVE ROW: Highlighted golden wood (or VS first-solver color if opponent already claimed it)
				var activeMat = vsClaimMat || materials.yellowTrayActive;
				rowInfo.rackMesh.material = activeMat;
				rowInfo.lipMesh.material = activeMat;

				// Reposition 3D active row indicator chevrons
				if (activeRowIndicatorGroup) {
					activeRowIndicatorGroup.visible = true;
					var halfW = rowInfo.rackWidth * 0.5;
					var rowY = rowInfo.rowY || 0;
					var rackTilt = rowInfo.rackTilt || 0;

					// Left chevron points right ▶
					if (chevronMesh) {
						chevronMesh.position.set(-halfW - 0.85, 0.28 + rowY, rowInfo.rz);
						chevronMesh.rotation.x = -Math.PI * 0.5 + rackTilt;
					}
					// Right chevron points left ◀ (yield right flank to opponent beacon in VS mode)
					if (chevronRightMesh) {
						chevronRightMesh.visible = !MultiplayerManager.isActive;
						chevronRightMesh.position.set(halfW + 0.85, 0.28 + rowY, rowInfo.rz);
						chevronRightMesh.rotation.x = -Math.PI * 0.5 + rackTilt;
					}
				}
			} else if (r === currentWordIndex - 1) {
				// CONNECTED PHRASE PARTNER ROW: First-solver color in VS mode, or warm luminous amber wood
				var partnerMat = vsClaimMat || materials.yellowTrayPartner;
				rowInfo.rackMesh.material = partnerMat;
				rowInfo.lipMesh.material = partnerMat;
			} else if (r < currentWordIndex - 1) {
				// OLD SOLVED ROW: First-solver color in VS mode, or muted antique settled wood
				var solvedMat = vsClaimMat || materials.yellowTraySolved;
				rowInfo.rackMesh.material = solvedMat;
				rowInfo.lipMesh.material = solvedMat;
			} else {
				// PENDING ROW: First-solver color if opponent already solved ahead, else dimmed wood
				var pendingMat = vsClaimMat || materials.yellowTrayDimmed;
				rowInfo.rackMesh.material = pendingMat;
				rowInfo.lipMesh.material = pendingMat;
			}
		}

		// Update 3D Phrase Coupler linking row (currentWordIndex - 1) and row (currentWordIndex)
		// Only show if gameplay is active and trays are present
		if (!skipCoupler && isGamePlayActive() && currentWordIndex >= 1 && chainRowData[currentWordIndex] && chainRowData[currentWordIndex - 1]) {
			updatePhraseCoupler(chainRowData[currentWordIndex - 1], chainRowData[currentWordIndex]);
		} else {
			if (phraseCouplerGroup) phraseCouplerGroup.visible = false;
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
	// 3D Gift Box Rewards & Unboxing (Color Coded: Red for Tiles, Green for Environments)
	// --------------------------------------------------------------------------
	function create3DGiftBox(rowIdx, reward, rackWidth, rz, rackHeight, rowY, rackTilt) {
		rowY = (rowY !== undefined ? rowY : 0);
		rackTilt = (rackTilt !== undefined ? rackTilt : 0);
		var isEnvironment = (reward && reward.type === 'scenery');
		var boxMaterial = isEnvironment ? materials.giftBoxEmerald : materials.giftBoxRuby;
		var ribbonMaterial = isEnvironment ? materials.giftBoxEmeraldRibbon : materials.giftBoxGold;
		var glowColor = isEnvironment ? 0x10b981 : 0xffa040;

		var giftGroup = new THREE.Group();
		var posX = rackWidth * 0.5 + 0.46;
		var baseY = rackHeight + 0.22 + rowY;
		giftGroup.position.set(posX, baseY, rz);
		giftGroup.rotation.x = -0.12 + rackTilt;
		giftGroup.rotation.y = -0.18;

		// Box Body (Ruby Red for Tiles, Emerald Green for Environments)
		var boxGeom = new THREE.BoxGeometry(0.52, 0.44, 0.52);
		var boxMesh = new THREE.Mesh(boxGeom, boxMaterial);
		boxMesh.position.y = 0.22;
		giftGroup.add(boxMesh);

		// Ribbon Band horizontal
		var ribbonH = new THREE.Mesh(new THREE.BoxGeometry(0.53, 0.10, 0.53), ribbonMaterial);
		ribbonH.position.y = 0.22;
		giftGroup.add(ribbonH);

		// Ribbon Band vertical 1
		var ribbonV1 = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.45, 0.53), ribbonMaterial);
		ribbonV1.position.y = 0.22;
		giftGroup.add(ribbonV1);

		// Ribbon Band vertical 2
		var ribbonV2 = new THREE.Mesh(new THREE.BoxGeometry(0.53, 0.45, 0.10), ribbonMaterial);
		ribbonV2.position.y = 0.22;
		giftGroup.add(ribbonV2);

		// Lid Group (pops off on unboxing)
		var lidGroup = new THREE.Group();
		lidGroup.position.y = 0.44;

		var lidGeom = new THREE.BoxGeometry(0.56, 0.10, 0.56);
		var lidMesh = new THREE.Mesh(lidGeom, boxMaterial);
		lidMesh.position.y = 0.05;
		lidGroup.add(lidMesh);

		var lidRibbon1 = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.11, 0.57), ribbonMaterial);
		lidRibbon1.position.y = 0.05;
		lidGroup.add(lidRibbon1);

		var lidRibbon2 = new THREE.Mesh(new THREE.BoxGeometry(0.57, 0.11, 0.10), ribbonMaterial);
		lidRibbon2.position.y = 0.05;
		lidGroup.add(lidRibbon2);

		// Bow knot loops
		var bow1 = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.025, 8, 16), ribbonMaterial);
		bow1.rotation.x = Math.PI * 0.5;
		bow1.rotation.z = Math.PI * 0.25;
		bow1.position.set(-0.06, 0.13, -0.06);
		lidGroup.add(bow1);

		var bow2 = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.025, 8, 16), ribbonMaterial);
		bow2.rotation.x = Math.PI * 0.5;
		bow2.rotation.z = -Math.PI * 0.25;
		bow2.position.set(0.06, 0.13, 0.06);
		lidGroup.add(bow2);

		var bowCenter = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), ribbonMaterial);
		bowCenter.position.set(0, 0.12, 0);
		lidGroup.add(bowCenter);

		giftGroup.add(lidGroup);

		// Aura Glow beneath box (Emerald Green or Warm Ruby Amber)
		var glowGeo = new THREE.PlaneGeometry(0.72, 0.72);
		var glowMat = new THREE.MeshBasicMaterial({
			map: TextureManager.getSlotHoverTexture(),
			color: glowColor,
			transparent: true,
			opacity: 0.65,
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
			baseX: posX,
			baseY: baseY,
			rowY: rowY,
			rackTilt: rackTilt,
			rackHeight: rackHeight,
			rackWidth: rackWidth,
			rz: rz,
			isEnvironment: isEnvironment,
			isOpening: false
		};
	}

	function createSparkleBurst(x, y, z, count, isEnvironment) {
		if (!confettiGroup) {
			confettiGroup = new THREE.Group();
			scene.add(confettiGroup);
		}
		var starShape = createStarShape(0.20, 0.09);
		var starGeom = new THREE.ShapeGeometry(starShape);
		var starMat = new THREE.MeshStandardMaterial({
			color: isEnvironment ? 0x34d399 : 0xffd700,
			emissive: isEnvironment ? 0x059669 : 0xffaa00,
			emissiveIntensity: 0.85,
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
				isSparkle: true,
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

		// Sparkle burst from box (color-coded)
		var boxPos = new THREE.Vector3();
		giftBoxObj.group.getWorldPosition(boxPos);
		createSparkleBurst(boxPos.x, boxPos.y + 0.4, boxPos.z, 28, giftBoxObj.isEnvironment);

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

				UnlockManager.onGiftReceived(currentLevelIndex, giftBoxObj.reward);
				showGiftUnlockModal(giftBoxObj.reward, onFinish);
			}
		}
		requestAnimationFrame(animLid);
	}

	function showGiftUnlockModal(reward, onDismiss) {
		onDismiss = once(onDismiss);
		var modal = document.getElementById('gift-box-modal');
		var titleEl = document.getElementById('reward-item-title');
		var nameEl = document.getElementById('reward-item-name');
		var descEl = document.getElementById('reward-item-desc');
		var showcaseEl = document.getElementById('reward-item-showcase');
		var ribbonEl = modal ? modal.querySelector('.reward-badge-ribbon') : null;
		var btnAd = document.getElementById('btn-reward-watch-ad');
		var btnTry = document.getElementById('btn-reward-try');

		if (!modal) {
			if (typeof onDismiss === 'function') onDismiss();
			return;
		}

		if (reward.type === 'skin') {
			if (ribbonEl) ribbonEl.textContent = '🎁 TILE SET DISCOVERED!';
			if (titleEl) titleEl.textContent = 'Letter Tile Set Unlocked!';
			if (nameEl) nameEl.textContent = reward.name;
			if (descEl) descEl.textContent = reward.desc;
			modal.classList.add('modal-theme-skin');
			modal.classList.remove('modal-theme-scenery');
			if (showcaseEl) {
				showcaseEl.innerHTML = '';
				showcaseEl.appendChild(createSkinPreviewEl(reward.id, 'reward-tile-preview-3d'));
			}
		} else {
			if (ribbonEl) ribbonEl.textContent = '🌿 ENVIRONMENT DISCOVERED!';
			if (titleEl) titleEl.textContent = 'Living Scenery Background!';
			if (nameEl) nameEl.textContent = reward.name;
			if (descEl) descEl.textContent = reward.desc;
			modal.classList.add('modal-theme-scenery');
			modal.classList.remove('modal-theme-skin');
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
	// Level Entrance Animation (Cascading Trays Top-to-Bottom)
	// --------------------------------------------------------------------------
	var levelEntranceState = null;

	function initLevelEntrance() {
		var slideOffsetX = -14.0;
		// Hide all racks initially so players see the clear scenery backdrop first
		for (var r = 0; r < chainRowData.length; r++) {
			var rowInfo = chainRowData[r];
			if (rowInfo && rowInfo.rowGroup) {
				rowInfo.rowGroup.visible = false;
				rowInfo.rowGroup.position.x = slideOffsetX;
				rowInfo.rowGroup.position.y = 0;
			}
		}

		// Row 0 anchor tiles
		chainSlots.filter(function (s) { return s.row === 0; }).forEach(function (s) {
			if (s.tile && s.tile.mesh) {
				s.tile.mesh.visible = false;
				s.tile.mesh.position.x = s.worldPos.x + slideOffsetX;
				s.tile.mesh.position.y = s.worldPos.y;
			}
		});

		// Active gift boxes
		activeGiftBoxes.forEach(function (gb) {
			if (gb && gb.group) {
				gb.group.visible = false;
				var bx = (gb.baseX !== undefined ? gb.baseX : gb.group.position.x);
				gb.baseX = bx;
				gb.group.position.x = bx + slideOffsetX;
				gb.group.position.y = gb.baseY;
			}
		});

		// Staging tray at bottom
		if (stagingTrayGroup) {
			stagingTrayGroup.visible = false;
			stagingTrayGroup.position.x = slideOffsetX;
			stagingTrayGroup.position.y = 0;
		}

		// Chevrons & 3D Phrase Coupler
		if (activeRowIndicatorGroup) {
			activeRowIndicatorGroup.visible = false;
		}
		if (phraseCouplerGroup) {
			phraseCouplerGroup.visible = false;
		}

		// Clear staging tiles for now (they will slide in when staging tray lands)
		stagingSlots.forEach(function (s) {
			if (s.tile) {
				var idx = allTiles.indexOf(s.tile);
				if (idx !== -1) allTiles.splice(idx, 1);
				scene.remove(s.tile.mesh);
				s.tile = null;
			}
		});

		levelEntranceState = {
			active: true,
			startTime: null,
			initialPause: 0.35,  // 350ms pure scenery reveal!
			rowDelay: 0.10,      // 100ms stagger between consecutive rows from top to bottom
			slideDuration: 0.44, // 440ms smooth lateral slide-in
			slideOffsetX: slideOffsetX,
			numRows: chainRowData.length,
			rowsLanded: {},
			stagingLanded: false,
			completed: false
		};
	}

	function updateLevelEntrance(now) {
		if (!levelEntranceState || !levelEntranceState.active) return;
		if (!levelEntranceState.startTime) {
			levelEntranceState.startTime = now;
		}
		var elapsed = (now - levelEntranceState.startTime) * 0.001;
		var slideOffsetX = levelEntranceState.slideOffsetX;

		// 1. Cascade Chain Rows from Row 0 (top) down to Row numRows-1
		for (var r = 0; r < levelEntranceState.numRows; r++) {
			var rowInfo = chainRowData[r];
			if (!rowInfo) continue;

			var rStart = levelEntranceState.initialPause + r * levelEntranceState.rowDelay;
			if (elapsed < rStart) {
				rowInfo.rowGroup.visible = false;
				if (r === 0) {
					chainSlots.filter(function (s) { return s.row === 0; }).forEach(function (s) {
						if (s.tile && s.tile.mesh) s.tile.mesh.visible = false;
					});
				}
				activeGiftBoxes.forEach(function (gb) {
					if (gb && gb.rowIdx === r && gb.group) gb.group.visible = false;
				});
			} else {
				rowInfo.rowGroup.visible = true;
				if (r === 0) {
					chainSlots.filter(function (s) { return s.row === 0; }).forEach(function (s) {
						if (s.tile && s.tile.mesh) s.tile.mesh.visible = true;
					});
				}
				activeGiftBoxes.forEach(function (gb) {
					if (gb && gb.rowIdx === r && gb.group) gb.group.visible = true;
				});

				var u = (elapsed - rStart) / levelEntranceState.slideDuration;
				if (u >= 1.0) {
					rowInfo.rowGroup.position.x = 0;
					rowInfo.rowGroup.position.y = 0;
					if (r === 0) {
						chainSlots.filter(function (s) { return s.row === 0; }).forEach(function (s) {
							if (s.tile && s.tile.mesh) {
								s.tile.mesh.position.x = s.worldPos.x;
								s.tile.mesh.position.y = s.worldPos.y;
							}
						});
					}
					activeGiftBoxes.forEach(function (gb) {
						if (gb && gb.rowIdx === r && gb.group) {
							gb.group.position.x = gb.baseX;
							gb.group.position.y = gb.baseY;
						}
					});

					if (!levelEntranceState.rowsLanded[r]) {
						levelEntranceState.rowsLanded[r] = true;
						AudioManager.play('tilehit', 0.20 + r * 0.03);
						AudioManager.haptic(10);
					}
				} else {
					// Smooth ease-out quartic deceleration
					var ease = 1.0 - Math.pow(1.0 - u, 3.5);
					var dx = slideOffsetX * (1.0 - ease);

					rowInfo.rowGroup.position.x = dx;
					rowInfo.rowGroup.position.y = 0;
					if (r === 0) {
						chainSlots.filter(function (s) { return s.row === 0; }).forEach(function (s) {
							if (s.tile && s.tile.mesh) {
								s.tile.mesh.position.x = s.worldPos.x + dx;
								s.tile.mesh.position.y = s.worldPos.y;
							}
						});
					}
					activeGiftBoxes.forEach(function (gb) {
						if (gb && gb.rowIdx === r && gb.group) {
							gb.group.position.x = gb.baseX + dx;
							gb.group.position.y = gb.baseY;
						}
					});
				}
			}
		}

		// 2. Cascade Staging Tray (bottom tray)
		var stagingStart = levelEntranceState.initialPause + levelEntranceState.numRows * levelEntranceState.rowDelay;
		if (elapsed < stagingStart) {
			if (stagingTrayGroup) stagingTrayGroup.visible = false;
		} else {
			if (stagingTrayGroup) stagingTrayGroup.visible = true;
			var uStage = (elapsed - stagingStart) / levelEntranceState.slideDuration;
			if (uStage >= 1.0) {
				if (stagingTrayGroup) {
					stagingTrayGroup.position.x = 0;
					stagingTrayGroup.position.y = 0;
				}
				if (!levelEntranceState.stagingLanded) {
					levelEntranceState.stagingLanded = true;
					levelEntranceState.active = false;
					levelEntranceState.completed = true;
					AudioManager.play('tilehit', 0.35);
					AudioManager.haptic(15);
					spawnStagingTiles(currentWordIndex);

					// SEQUENCE: The trays appear FIRST!
					updateActiveRowVisuals(true);
					if (MultiplayerManager.isActive) {
						MultiplayerManager.onRaceStart();
					} else {
						MultiplayerManager.onSoloEntranceReady(currentLevelIndex);
					}

					// Then the chain appears AFTER to link the two solvable trays together with swing & snap!
					// The chain is the LAST element to appear on level/tray creation!
					setTimeout(function () {
						if (!isGamePlayActive()) {
							if (phraseCouplerGroup) phraseCouplerGroup.visible = false;
							return;
						}
						if (currentWordIndex >= 1 && chainRowData[currentWordIndex] && chainRowData[currentWordIndex - 1]) {
							triggerChainCouplerSnap(chainRowData[currentWordIndex - 1], chainRowData[currentWordIndex]);
						}
					}, 280);
				}
			} else {
				var easeStage = 1.0 - Math.pow(1.0 - uStage, 3.5);
				var dxStage = slideOffsetX * (1.0 - easeStage);
				if (stagingTrayGroup) {
					stagingTrayGroup.position.x = dxStage;
					stagingTrayGroup.position.y = 0;
				}
			}
		}
	}

	function completeLevelEntranceImmediately() {
		if (!levelEntranceState || !levelEntranceState.active) return;
		levelEntranceState.active = false;
		levelEntranceState.completed = true;
		for (var r = 0; r < chainRowData.length; r++) {
			var rowInfo = chainRowData[r];
			if (rowInfo && rowInfo.rowGroup) {
				rowInfo.rowGroup.visible = true;
				rowInfo.rowGroup.position.x = 0;
				rowInfo.rowGroup.position.y = 0;
			}
		}
		chainSlots.filter(function (s) { return s.row === 0; }).forEach(function (s) {
			if (s.tile && s.tile.mesh) {
				s.tile.mesh.visible = true;
				s.tile.mesh.position.x = s.worldPos.x;
				s.tile.mesh.position.y = s.worldPos.y;
			}
		});
		activeGiftBoxes.forEach(function (gb) {
			if (gb && gb.group) {
				gb.group.visible = true;
				gb.group.position.x = (gb.baseX !== undefined ? gb.baseX : gb.group.position.x);
				gb.group.position.y = gb.baseY;
			}
		});
		if (stagingTrayGroup) {
			stagingTrayGroup.visible = true;
			stagingTrayGroup.position.x = 0;
			stagingTrayGroup.position.y = 0;
		}
		var hasStaging = stagingSlots.some(function (s) { return !!s.tile; });
		if (!hasStaging) {
			spawnStagingTiles(currentWordIndex);
		}
		// SEQUENCE: Trays appear FIRST!
		updateActiveRowVisuals(true);
		if (MultiplayerManager.isActive) {
			MultiplayerManager.onRaceStart();
		} else {
			MultiplayerManager.onSoloEntranceReady(currentLevelIndex);
		}
		setTimeout(function () {
			if (!isGamePlayActive()) {
				if (phraseCouplerGroup) phraseCouplerGroup.visible = false;
				return;
			}
			if (currentWordIndex >= 1 && chainRowData[currentWordIndex] && chainRowData[currentWordIndex - 1]) {
				triggerChainCouplerSnap(chainRowData[currentWordIndex - 1], chainRowData[currentWordIndex]);
			}
		}, 180);
	}

	// --------------------------------------------------------------------------
	// Level Loading & Tile Placement
	// --------------------------------------------------------------------------
	function loadLevel(levelIndex) {
		stopWinCelebration();
		dismissGhostTile();
		wordsSolvedCount = 0;
		if (opponentRowIndicatorGroup && !MultiplayerManager.isActive) {
			opponentRowIndicatorGroup.visible = false;
		}
		var targetIndex = levelIndex % (window.WORD_CHAIN_LEVELS ? window.WORD_CHAIN_LEVELS.length : 30);
		if (!MultiplayerManager.isActive) {
			UnlockManager.checkTrialExpiration(targetIndex);
		}
		currentLevelIndex = targetIndex;
		if (!MultiplayerManager.isActive) {
			try {
				localStorage.setItem('word_chain_last_level', String(targetIndex));
			} catch (e) {}
		}
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
		updateCameraFraming();

		// 1. Populate Row 0 with locked anchor word tiles (e.g. "TENNIS")
		var anchorWord = currentLevelData.words[0].answer;
		var row0Slots = chainSlots.filter(function (s) { return s.row === 0; });

		for (var i = 0; i < anchorWord.length; i++) {
			var letter = anchorWord[i];
			var slot = row0Slots[i];
			if (slot) {
				var tile = new Tile(letter, true); // Locked
				var rTilt = chainRowData[0] ? (chainRowData[0].rackTilt || 0) : 0;
				tile.mesh.position.copy(slot.worldPos);
				tile.targetPosition.copy(slot.worldPos);
				tile.mesh.rotation.x = rTilt;
				tile.targetRotation.x = rTilt;
				tile.currentSlot = slot;
				slot.tile = tile;
				scene.add(tile.mesh);
				allTiles.push(tile);
			}
		}

		// 2. Cascade tray spawn animation from top to bottom (revealing the live scenery first!)
		initLevelEntrance();

		// 3. Scenery selection: prioritize URL param or user-equipped choice over level cycling
		var urlParams = new URLSearchParams(window.location.search);
		var urlScenery = urlParams.get('scenery');
		var userSelected = null;
		try { userSelected = localStorage.getItem('word_chain_scenery_user_selected'); } catch (e) {}

		if (urlScenery && global.WordscapesScenery) {
			global.WordscapesScenery.setScenery(urlScenery);
		} else if (userSelected && global.WordscapesScenery) {
			var saved = null;
			try { saved = localStorage.getItem('word_chain_scenery'); } catch (e) {}
			if (saved) global.WordscapesScenery.setScenery(saved);
		} else if (global.WordscapesScenery && typeof global.WordscapesScenery.setSceneryForLevel === 'function') {
			global.WordscapesScenery.setSceneryForLevel(currentLevelIndex);
		}

		if (TextureManager && typeof TextureManager.updateTrayTheme === 'function') {
			TextureManager.updateTrayTheme();
		}

		if (!MultiplayerManager.isActive && typeof SpeedometerManager !== 'undefined') {
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
		var wordLen = letters.length;

		// Dynamically rebuild feeder tray to fit active word width and center it
		if (stagingSlots.length !== wordLen) {
			var numRows = (currentLevelData && currentLevelData.words) ? currentLevelData.words.length : (chainRowData.length || 5);
			var layout = getBoardLayout(numRows);
			buildStagingTray(layout.stagingZ, wordLen);
		}

		for (var i = 0; i < letters.length; i++) {
			var letter = letters[i];
			var slot = stagingSlots[i];
			if (slot) {
				var tile = new Tile(letter, false);

				// Fun cascading drop from above
				tile.mesh.position.set(slot.worldPos.x, slot.worldPos.y + 4.5 + i * 0.4, slot.worldPos.z);
				tile.targetPosition.copy(slot.worldPos);
				tile.mesh.rotation.x = 0;
				tile.targetRotation.set(0, 0, 0);
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
		dom.style.touchAction = 'none';
		dom.style.webkitUserSelect = 'none';
		dom.style.userSelect = 'none';

		var pointerDownScreenPos = { x: 0, y: 0 };
		var pointerDownTime = 0;
		var pointerHasDragged = false;
		var activePointerId = null;
		var DRAG_START_PX = 24; // Prevents rapid thumb taps from being misclassified as drags
		var tempProjVec = new THREE.Vector3();
		var tempHitPoint = new THREE.Vector3();

		// Cache canvas bounding rect to eliminate synchronous DOM reflows inside pointerdown/pointermove
		var cachedCanvasRect = { left: 0, top: 0, width: window.innerWidth || 390, height: window.innerHeight || 844 };
		function refreshCanvasRect() {
			var r = dom.getBoundingClientRect();
			if (r && r.width > 0 && r.height > 0) {
				cachedCanvasRect.left = r.left;
				cachedCanvasRect.top = r.top;
				cachedCanvasRect.width = r.width;
				cachedCanvasRect.height = r.height;
			} else {
				cachedCanvasRect.left = 0;
				cachedCanvasRect.top = 0;
				cachedCanvasRect.width = window.innerWidth || 390;
				cachedCanvasRect.height = window.innerHeight || 844;
			}
		}
		refreshCanvasRect();
		window.addEventListener('resize', refreshCanvasRect, { passive: true });
		window.addEventListener('orientationchange', refreshCanvasRect, { passive: true });

		function getPointerPos(e) {
			var clientX = (e.clientX !== undefined) ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
			var clientY = (e.clientY !== undefined) ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
			pointer.x = ((clientX - cachedCanvasRect.left) / cachedCanvasRect.width) * 2 - 1;
			pointer.y = -((clientY - cachedCanvasRect.top) / cachedCanvasRect.height) * 2 + 1;
			return { x: clientX, y: clientY };
		}

		// Fast, deterministic Tap-to-Place helper (used for single taps and rapid multi-thumb typing)
		function executeTapPlace(tile) {
			if (!tile || !tile.currentSlot) return false;
			if (tile.currentSlot.type === 'staging') {
				var targetSlot = null;
				for (var i = 0; i < chainSlots.length; i++) {
					var s = chainSlots[i];
					if (s.row === currentWordIndex && s.tile === null) {
						targetSlot = s;
						break;
					}
				}
				if (targetSlot) {
					if (currentGhostSlot && targetSlot === currentGhostSlot) {
						dismissGhostTile();
					}
					tile.currentSlot.tile = null;
					targetSlot.tile = tile;
					tile.currentSlot = targetSlot;
					tile.setTarget(targetSlot.worldPos.x, targetSlot.worldPos.y, targetSlot.worldPos.z);
					tile.targetRotation.set(0, 0, 0);
					tile.startSnapFx();
					AudioManager.playSnap(1.30, true);
					AudioManager.haptic(20, 0.90, 0.80);
					updateSlotBrackets();
					checkWordCompletion();
					return true;
				}
			} else if (tile.currentSlot.type === 'chain' && tile.currentSlot.row === currentWordIndex) {
				var returnSlot = null;
				for (var j = 0; j < stagingSlots.length; j++) {
					if (stagingSlots[j].tile === null) {
						returnSlot = stagingSlots[j];
						break;
					}
				}
				if (returnSlot) {
					if (currentGhostSlot && returnSlot === currentGhostSlot) {
						dismissGhostTile();
					}
					tile.currentSlot.tile = null;
					returnSlot.tile = tile;
					tile.currentSlot = returnSlot;
					tile.setTarget(returnSlot.worldPos.x, returnSlot.worldPos.y, returnSlot.worldPos.z);
					tile.targetRotation.set(0, 0, 0);
					tile.startSnapFx();
					AudioManager.playSnap(1.05, true);
					AudioManager.haptic(16, 0.80, 0.70);
					updateSlotBrackets();
					return true;
				}
			}
			return false;
		}

		// Pointer Down - Ultra-responsive touch detection with Zero-Reflow 2D Fast-Path
		dom.addEventListener('pointerdown', function (e) {
			if (levelEntranceState && levelEntranceState.active) {
				completeLevelEntranceImmediately();
			}
			if (isRowShaking || isCelebratingWin || isComboPlaying) return;

			// If a previous tap is still pending (e.g. rapid alternating two-thumb typing), commit it immediately!
			if (activeTile && !pointerHasDragged) {
				var prevTile = activeTile;
				activeTile = null;
				prevTile.isDragging = false;
				prevTile.targetRotation.set(0, 0, 0);
				executeTapPlace(prevTile);
			}

			var pt = getPointerPos(e);
			var clientX = pt.x;
			var clientY = pt.y;
			pointerDownScreenPos.x = clientX;
			pointerDownScreenPos.y = clientY;
			pointerDownTime = performance.now();
			pointerHasDragged = false;
			activePointerId = (e.pointerId !== undefined) ? e.pointerId : null;

			// 1. Check tap directly on ghost tile (only when a ghost tile is visible)
			if (ghostTileMesh) {
				raycaster.setFromCamera(pointer, camera);
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

			// 2. Fast-Path Tier 1: Zero-allocation 2D screen-space proximity hit test on unlocked tiles
			var targetTile = null;
			var bestScreenDist = 58; // 58px radius (~15mm on mobile) guarantees instant first-tap response
			var w = cachedCanvasRect.width;
			var h = cachedCanvasRect.height;

			for (var ti = 0; ti < allTiles.length; ti++) {
				var candidateTile = allTiles[ti];
				if (candidateTile.isLocked || !candidateTile.mesh) continue;
				// Check both current position and target position (so tiles settling into tray are 100% clickable)
				tempProjVec.copy(candidateTile.targetPosition).project(camera);
				if (tempProjVec.z < 1.0) {
					var sx = (tempProjVec.x * 0.5 + 0.5) * w + cachedCanvasRect.left;
					var sy = (-(tempProjVec.y * 0.5) + 0.5) * h + cachedCanvasRect.top;
					var d = Math.hypot(clientX - sx, clientY - sy);
					if (d < bestScreenDist) {
						bestScreenDist = d;
						targetTile = candidateTile;
					}
				}
			}

			// Tier 2: 3D Raycast fallback if touch was outside the 2D fast-path center
			if (!targetTile) {
				raycaster.setFromCamera(pointer, camera);
				for (var rti = 0; rti < allTiles.length; rti++) {
					var tCandidate = allTiles[rti];
					if (!tCandidate.isLocked && tCandidate.mesh) {
						var hits = raycaster.intersectObject(tCandidate.mesh, false);
						if (hits.length > 0) {
							targetTile = tCandidate;
							break;
						}
					}
				}
			}

			// On confirmed tile touch
			if (targetTile) {
				activeTile = targetTile;
				// Keep isDragging false until finger moves past DRAG_START_PX so quick taps don't waste frames lifting in place
				activeTile.isDragging = false;
				dom.style.cursor = 'grabbing';
				prevDragPos.copy(activeTile.mesh.position);

				AudioManager.play('tilehit', 0.85);
				AudioManager.haptic(14, 0.80, 0.75);
			}
		});

		// Pointer Move
		window.addEventListener('pointermove', function (e) {
			if (isRowShaking || isCelebratingWin) return;

			if (activeTile) {
				if (activePointerId !== null && e.pointerId !== undefined && e.pointerId !== activePointerId) return;
				var clientX = (e.clientX !== undefined) ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
				var clientY = (e.clientY !== undefined) ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
				var moveDist = Math.hypot(clientX - pointerDownScreenPos.x, clientY - pointerDownScreenPos.y);

				// Fast-path: ignore finger micro-movement during taps (< 24px) — zero raycasting during rapid letter entry!
				if (!pointerHasDragged && moveDist < DRAG_START_PX) {
					return;
				}

				getPointerPos(e);
				raycaster.setFromCamera(pointer, camera);

				if (!pointerHasDragged) {
					pointerHasDragged = true;
					activeTile.isDragging = true;
					if (raycaster.ray.intersectPlane(dragPlane, tempHitPoint)) {
						dragOffset.copy(activeTile.mesh.position).sub(tempHitPoint);
					} else {
						dragOffset.set(0, 0, 0);
					}
				}

				if (raycaster.ray.intersectPlane(dragPlane, tempHitPoint)) {
					var newPos = tempHitPoint.add(dragOffset);
					activeTile.setTarget(newPos.x, activeTile.targetPosition.y, newPos.z);

					// Dynamic physical tilt from drag velocity
					dragVelocity.copy(newPos).sub(prevDragPos);
					prevDragPos.copy(newPos);

					activeTile.targetRotation.z = THREE.MathUtils.clamp(-dragVelocity.x * 0.45, -0.28, 0.28);
					activeTile.targetRotation.x = THREE.MathUtils.clamp(dragVelocity.z * 0.45, -0.28, 0.28);

					// Real-time hover slot snap indicator
					var hoverSlot = null;
					var hoverDist = 1.85;

					for (var i = 0; i < chainSlots.length; i++) {
						var cs = chainSlots[i];
						if (cs.row !== currentWordIndex) continue;
						var cdx = activeTile.mesh.position.x - cs.worldPos.x;
						var cdz = activeTile.mesh.position.z - cs.worldPos.z;
						var cDist = Math.sqrt(cdx * cdx + cdz * cdz);
						if (cDist < hoverDist) {
							hoverDist = cDist;
							hoverSlot = cs;
						}
					}
					for (var j = 0; j < stagingSlots.length; j++) {
						var ss = stagingSlots[j];
						var sdx = activeTile.mesh.position.x - ss.worldPos.x;
						var sdz = activeTile.mesh.position.z - ss.worldPos.z;
						var sDist = Math.sqrt(sdx * sdx + sdz * sdz);
						if (sDist < hoverDist) {
							hoverDist = sDist;
							hoverSlot = ss;
						}
					}

					if (hoverSlot && hoverSlotHighlightMesh) {
						hoverSlotHighlightMesh.visible = true;
						hoverSlotHighlightMesh.position.set(hoverSlot.worldPos.x, hoverSlot.worldPos.y + 0.02, hoverSlot.worldPos.z);
						var slotTilt = (hoverSlot.type === 'chain' && chainRowData[hoverSlot.row]) ? (chainRowData[hoverSlot.row].rackTilt || 0) : 0;
						hoverSlotHighlightMesh.rotation.x = -Math.PI * 0.5 + slotTilt;
					} else if (hoverSlotHighlightMesh) {
						hoverSlotHighlightMesh.visible = false;
					}
				}
			} else {
				// Hover cursor check (desktop mouse only, skipped on mobile touch for 60FPS speed)
				if (e.pointerType === 'mouse') {
					getPointerPos(e);
					raycaster.setFromCamera(pointer, camera);
					var hasHit = false;
					for (var t = 0; t < allTiles.length; t++) {
						var tileObj = allTiles[t];
						if (!tileObj.isLocked && tileObj.mesh) {
							var res = raycaster.intersectObject(tileObj.mesh);
							if (res.length > 0) {
								hasHit = true;
								break;
							}
						}
					}
					dom.style.cursor = hasHit ? 'grab' : 'default';
				}
			}
		});

		// Pointer Up
		window.addEventListener('pointerup', function (e) {
			if (activePointerId !== null && e.pointerId !== undefined && e.pointerId !== activePointerId) return;
			if (hoverSlotHighlightMesh) {
				hoverSlotHighlightMesh.visible = false;
			}

			if (!activeTile) return;

			var tile = activeTile;
			activeTile = null;
			activePointerId = null;
			tile.isDragging = false;
			dom.style.cursor = 'default';
			tile.targetRotation.set(0, 0, 0);

			var elapsed = performance.now() - pointerDownTime;
			var isTap = (!pointerHasDragged && elapsed < 550);

			// 1. TAP-TO-PLACE: Instant effortless tap manipulation
			if (isTap) {
				if (executeTapPlace(tile)) {
					return;
				}
			}

			// 2. DRAG-AND-DROP: Generous 2D horizontal (X-Z) snap detection
			var bestSlot = null;
			var bestDist = 1.85; // Generous horizontal snap threshold

			for (var i = 0; i < chainSlots.length; i++) {
				var cSlot = chainSlots[i];
				if (cSlot.row !== currentWordIndex) continue;
				var cdx = tile.mesh.position.x - cSlot.worldPos.x;
				var cdz = tile.mesh.position.z - cSlot.worldPos.z;
				var cDistXZ = Math.sqrt(cdx * cdx + cdz * cdz);
				if (cDistXZ < bestDist) {
					bestDist = cDistXZ;
					bestSlot = cSlot;
				}
			}
			for (var j = 0; j < stagingSlots.length; j++) {
				var sSlot = stagingSlots[j];
				var sdx = tile.mesh.position.x - sSlot.worldPos.x;
				var sdz = tile.mesh.position.z - sSlot.worldPos.z;
				var sDistXZ = Math.sqrt(sdx * sdx + sdz * sdz);
				if (sDistXZ < bestDist) {
					bestDist = sDistXZ;
					bestSlot = sSlot;
				}
			}

			// Smart mobile thumb-swipe recovery: if a quick gesture ended back on its own starting slot, treat as Tap-to-Place!
			if ((!bestSlot || bestSlot === tile.currentSlot) && elapsed < 480) {
				if (executeTapPlace(tile)) {
					return;
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
						otherTile.targetRotation.set(0, 0, 0);
					} else {
						var emptyStaging = stagingSlots.find(function (s) { return s.tile === null; });
						if (emptyStaging) {
							emptyStaging.tile = otherTile;
							otherTile.currentSlot = emptyStaging;
							otherTile.setTarget(emptyStaging.worldPos.x, emptyStaging.worldPos.y, emptyStaging.worldPos.z);
							otherTile.targetRotation.set(0, 0, 0);
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
				tile.targetRotation.set(0, 0, 0);
				tile.startSnapFx();
				AudioManager.playSnap(1.30, true);
				AudioManager.haptic(22, 0.90, 0.80);

				updateSlotBrackets();
				checkWordCompletion();
			} else {
				// Revert to current slot
				if (tile.currentSlot) {
					tile.setTarget(tile.currentSlot.worldPos.x, tile.currentSlot.worldPos.y, tile.currentSlot.worldPos.z);
					tile.targetRotation.set(0, 0, 0);
				}
				AudioManager.play('thud', 0.5);
			}
		});

		// Pointer Cancel: safely reset active drag state on system interruption
		window.addEventListener('pointercancel', function () {
			if (hoverSlotHighlightMesh) hoverSlotHighlightMesh.visible = false;
			if (activeTile) {
				if (activeTile.currentSlot) {
					activeTile.setTarget(activeTile.currentSlot.worldPos.x, activeTile.currentSlot.worldPos.y, activeTile.currentSlot.worldPos.z);
					activeTile.targetRotation.set(0, 0, 0);
				}
				activeTile.isDragging = false;
				activeTile = null;
				dom.style.cursor = 'default';
			}
		});

		// ----------------------------------------------------------------------
		// Desktop / PC Keyboard Support: Type Tray Letters Directly
		// ----------------------------------------------------------------------
		window.addEventListener('keydown', function (e) {
			// Ignore keystrokes when typing into text boxes, inputs, or contentEditable areas
			if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) {
				return;
			}

			// Don't intercept browser shortcuts (Ctrl/Cmd/Alt)
			if (e.ctrlKey || e.metaKey || e.altKey) {
				return;
			}

			// If modal is open, let Escape close it
			var openModal = document.querySelector('.game-modal.show, .game-modal.open, .admob-overlay.show');
			if (openModal) {
				if (e.key === 'Escape') {
					e.preventDefault();
					hideThemeModal();
					hideLevelSelectModal();
					closeTileStorageModal();
					MultiplayerManager.closeLobby();
				}
				return;
			}

			// Title Screen: Enter or Space starts Solo Play
			if (titleScreenEl && !titleScreenEl.classList.contains('hidden') && titleScreenEl.style.display !== 'none') {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					triggerSoloPlay();
				}
				return;
			}

			// Win Celebration: Enter, Space, or any key advances to next level (Solo Play only; VS Mode requires explicit button press on Match Results)
			if (isCelebratingWin) {
				if (MultiplayerManager.isActive) {
					if (e.key === 'Enter' || e.key === ' ') e.preventDefault();
					return;
				}
				if (e.key === 'Enter' || e.key === ' ' || /^[a-zA-Z]$/.test(e.key)) {
					e.preventDefault();
					if (performance.now() - winCelebrationStartTime > 600) {
						AudioManager.play('tilehit', 1.0);
						AudioManager.haptic(35);
						stopWinCelebration();
						loadLevel(currentLevelIndex + 1);
					}
				}
				return;
			}

			// Complete level entrance animation immediately if typing while it slides in
			if (levelEntranceState && levelEntranceState.active) {
				completeLevelEntranceImmediately();
			}

			// If active tile is currently being dragged, cancel drag
			if (activeTile) {
				activeTile.isDragging = false;
				dom.style.cursor = 'default';
				if (activeTile.currentSlot) {
					activeTile.setTarget(activeTile.currentSlot.worldPos.x, activeTile.currentSlot.worldPos.y, activeTile.currentSlot.worldPos.z);
				}
				activeTile = null;
			}

			if (isRowShaking || isComboPlaying) return;
			if (!currentLevelData || !currentLevelData.words || !currentLevelData.words[currentWordIndex]) return;

			var key = e.key;

			// 1. Backspace / Delete: Return the last placed tile on active row back to tray
			if (key === 'Backspace' || key === 'Delete') {
				e.preventDefault();
				var filledActiveSlots = chainSlots.filter(function (s) {
					return s.row === currentWordIndex && s.tile !== null && !s.tile.isLocked;
				});

				if (filledActiveSlots.length > 0) {
					var lastSlot = filledActiveSlots[filledActiveSlots.length - 1];
					var tileToReturn = lastSlot.tile;
					var targetStaging = stagingSlots.find(function (s) { return s.tile === null; });

					if (targetStaging) {
						if (currentGhostSlot && lastSlot === currentGhostSlot) {
							dismissGhostTile();
						}
						lastSlot.tile = null;
						targetStaging.tile = tileToReturn;
						tileToReturn.currentSlot = targetStaging;
						tileToReturn.setTarget(targetStaging.worldPos.x, targetStaging.worldPos.y, targetStaging.worldPos.z);
						tileToReturn.targetRotation.set(0, 0, 0);
						tileToReturn.startSnapFx();
						AudioManager.playSnap(1.1);
						AudioManager.haptic(10);
						updateSlotBrackets();
					}
				}
				return;
			}

			// 2. Escape: Recall all placed tiles in active row back to letter tray
			if (key === 'Escape') {
				e.preventDefault();
				recallActiveRow();
				return;
			}

			// 3. Spacebar: Shuffle tray letters
			if (key === ' ') {
				e.preventDefault();
				shuffleStaging();
				return;
			}

			// 4. Enter: If active row is full, trigger word completion check
			if (key === 'Enter') {
				e.preventDefault();
				var activeSlots = chainSlots.filter(function (s) { return s.row === currentWordIndex; });
				var allFilled = activeSlots.every(function (s) { return s.tile !== null; });
				if (allFilled) {
					checkWordCompletion();
				}
				return;
			}

			// 5. Letter keys A-Z / a-z: Type in available letter from tray into next active row slot
			if (/^[a-zA-Z]$/.test(key)) {
				var typedLetter = key.toUpperCase();

				// Find next empty slot in active row
				var targetSlot = chainSlots.find(function (s) {
					return s.row === currentWordIndex && s.tile === null;
				});

				if (!targetSlot) {
					// Row is already full
					return;
				}

				// Find available matching letter tile currently in the staging tray
				var matchingStagingSlot = stagingSlots.find(function (s) {
					return s.tile && !s.tile.isLocked && s.tile.letter && s.tile.letter.toUpperCase() === typedLetter;
				});

				if (matchingStagingSlot) {
					e.preventDefault();
					var typedTile = matchingStagingSlot.tile;

					if (currentGhostSlot && targetSlot === currentGhostSlot) {
						dismissGhostTile();
					}

					matchingStagingSlot.tile = null;
					targetSlot.tile = typedTile;
					typedTile.currentSlot = targetSlot;
					typedTile.setTarget(targetSlot.worldPos.x, targetSlot.worldPos.y, targetSlot.worldPos.z);
					typedTile.targetRotation.set(0, 0, 0);
					typedTile.startSnapFx();
					AudioManager.playSnap(1.35);
					AudioManager.haptic(15);
					updateSlotBrackets();
					checkWordCompletion();
				} else {
					// Letter not present in tray: gentle acoustic thud & haptic feedback
					AudioManager.play('thud', 0.28);
					AudioManager.haptic(8);
				}
				return;
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
	/**
	 * Correct chain sequential upwards word jump:
	 * Tray 1 (previous chained word) tiles jump upwards together with natural varied heights (0.36s),
	 * fall and land back on their tray,
	 * followed by a natural short pause (0.40s),
	 * then Tray 2 (just solved word) tiles jump upwards together with natural varied heights (0.36s),
	 * fall and land back on their tray.
	 * Identical to the title screen's natural, physical upwards hop cadence with zero cartoon distortion or flashing fx.
	 */
	function playChainComboSequence(row1Idx, row2Idx, onComplete) {
		isComboPlaying = true;
		var row1 = chainRowData[row1Idx];
		var row2 = chainRowData[row2Idx];

		var tiles1 = row1 ? row1.slots.map(function (s) { return s.tile; }).filter(Boolean) : [];
		var tiles2 = row2 ? row2.slots.map(function (s) { return s.tile; }).filter(Boolean) : [];

		// Natural varied height patterns for physical bounce feel
		var hPattern1 = [0.55, 0.68, 0.50, 0.65, 0.52, 0.66, 0.48, 0.60];
		var hPattern2 = [0.50, 0.68, 0.56, 0.70, 0.52, 0.64, 0.50, 0.62];

		// 1. Tray 1 tiles jump upwards together with natural varied heights (0.32s duration)
		tiles1.forEach(function (t, i) {
			var h = hPattern1[i % hPattern1.length];
			t.startHop(0.32, h);
		});
		AudioManager.play('tilehit', 0.75);
		AudioManager.hapticPattern([
			{ t: 0.0, i: 0.90, s: 0.82, d: 0.03 }
		]);

		// 2. Tray 1 lands (0.32s) + natural pause (0.12s) = 0.44s
		setTimeout(function () {
			// Tray 2 tiles jump upwards together with natural varied heights (0.32s duration)
			tiles2.forEach(function (t, j) {
				var h = hPattern2[j % hPattern2.length];
				t.startHop(0.32, h);
			});
			AudioManager.play('tilehit', 0.85);
			AudioManager.hapticPattern([
				{ t: 0.0, i: 1.0, s: 0.88, d: 0.04 }
			]);

			// 3. Tray 2 lands (0.32s) + brief settle (0.12s) = 0.44s
			setTimeout(function () {
				isComboPlaying = false;
				if (typeof onComplete === 'function') {
					onComplete();
				}
			}, 440);

		}, 440);
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

			if (MultiplayerManager.isActive) {
				MultiplayerManager.onPlayerSolvedRow(currentWordIndex, currentLevelData.words.length, spelled);
			} else {
				if (typeof SpeedometerManager !== 'undefined') {
					SpeedometerManager.onWordSolved(currentWordIndex, currentLevelData.words.length);
				}
				MultiplayerManager.onSoloRowSolved(currentWordIndex, currentLevelData.words.length);
			}

			var isLevelComplete = (currentWordIndex + 1 >= currentLevelData.words.length);

			if (isLevelComplete) {
				// ALL CHAINS HAVE BEEN SOLVED!
				// FIRST TO DISAPPEAR ON LEVEL SOLUTION: Instantly hide the in-game chain coupler and active indicators!
				if (phraseCouplerGroup) phraseCouplerGroup.visible = false;
				if (activeRowIndicatorGroup) activeRowIndicatorGroup.visible = false;

				// Immediately record level completion, freeze speedometer & timer, and save stars!
				if (!MultiplayerManager.isActive && typeof SpeedometerManager !== 'undefined') {
					SpeedometerManager.onLevelCompleted(currentLevelIndex);
					MultiplayerManager.updateProfileUI();
				}
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

			// Trigger sequential winning combination upwards jump:
			var word1Row = currentWordIndex - 1;
			var word2Row = currentWordIndex;

			playChainComboSequence(word1Row, word2Row, function () {
				function proceedToNextStep() {
					if (isCelebratingWin || (MultiplayerManager.isActive && MultiplayerManager.matchFinished && MultiplayerManager.winner === 'p2')) {
						return;
					}
					// Hide previous chain coupler immediately as the previous pair has finished
					if (phraseCouplerGroup) phraseCouplerGroup.visible = false;

					currentWordIndex++;

					if (currentWordIndex >= currentLevelData.words.length) {
						// LEVEL COMPLETE!
						if (!MultiplayerManager.isActive) {
							if (typeof SpeedometerManager !== 'undefined') {
								SpeedometerManager.onLevelCompleted(currentLevelIndex);
							}
							if (typeof UnlockManager !== 'undefined' && typeof UnlockManager.onLevelCompleted === 'function') {
								UnlockManager.onLevelCompleted(currentLevelIndex);
							}
							MultiplayerManager.updateProfileUI();
						}
						if (activeRowIndicatorGroup) activeRowIndicatorGroup.visible = false;
						if (phraseCouplerGroup) phraseCouplerGroup.visible = false;
						setTimeout(function () {
							triggerWinCelebration();
						}, 250);
					} else {
						// Spawn next word scrambled tiles
						spawnStagingTiles(currentWordIndex);
						// SEQUENCE: Trays appear FIRST!
						updateActiveRowVisuals(true);

						// Chain appears AFTER to link the two trays together with swing & snap!
						setTimeout(function () {
							if (!isGamePlayActive()) {
								if (phraseCouplerGroup) phraseCouplerGroup.visible = false;
								return;
							}
							if (currentWordIndex >= 1 && chainRowData[currentWordIndex] && chainRowData[currentWordIndex - 1]) {
								triggerChainCouplerSnap(chainRowData[currentWordIndex - 1], chainRowData[currentWordIndex]);
							}
						}, 280);
					}
				}

				// Check if there is an active gift box reward on this solved row
				// (once(): the row may only advance a single time, even if several
				// modal/ad callbacks fire)
				var proceedOnce = once(proceedToNextStep);
				var foundGb = activeGiftBoxes.find(function (g) { return g.rowIdx === word2Row; });
				if (foundGb) {
					open3DGiftBox(foundGb, proceedOnce);
				} else {
					proceedOnce();
				}
			});
		} else {
			// INCORRECT WORD! Hard brake on speedometer to penalize wrong entries
			isRowShaking = true;
			if (!MultiplayerManager.isActive && typeof SpeedometerManager !== 'undefined') {
				SpeedometerManager.onIncorrectWord();
			}
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
				if (!isCelebratingWin) {
					recallActiveRow();
				}
				isRowShaking = false;
			}, 520);
		}
	}

	// --------------------------------------------------------------------------
	// Helper Actions (Shuffle, Recall)
	// --------------------------------------------------------------------------
	function shuffleStaging() {
		dismissGhostTile();

		// Collect all staging slots that currently contain a letter
		var occupiedSlots = stagingSlots.filter(function (s) { return s.tile !== null; });
		if (occupiedSlots.length <= 1) return;

		var stagingTiles = occupiedSlots.map(function (s) { return s.tile; });

		// Clear slot tile references first to prevent cross-contamination
		occupiedSlots.forEach(function (s) {
			s.tile = null;
		});

		// Fisher-Yates shuffle
		for (var i = stagingTiles.length - 1; i > 0; i--) {
			var j = Math.floor(Math.random() * (i + 1));
			var temp = stagingTiles[i];
			stagingTiles[i] = stagingTiles[j];
			stagingTiles[j] = temp;
		}

		// Reassign shuffled tiles to the exact same occupied tray slots
		occupiedSlots.forEach(function (slot, idx) {
			var tile = stagingTiles[idx];
			slot.tile = tile;
			tile.currentSlot = slot;
			// Target exact tray felt surface (worldPos.y) so tiles never drift or float in the air
			tile.setTarget(slot.worldPos.x, slot.worldPos.y, slot.worldPos.z);
			tile.targetRotation.set(0, 0, 0);
			// Trigger a joyful bouncy hop that settles cleanly onto the felt slot
			tile.startHop(0.24, 0.40);
		});

		updateSlotBrackets();
		AudioManager.play('tilehit', 0.85);
		AudioManager.haptic(25);
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
					tile.targetRotation.set(0, 0, 0);
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
		var slotTilt = (slot.type === 'chain' && chainRowData[slot.row]) ? (chainRowData[slot.row].rackTilt || 0) : 0;
		ghostTileMesh.rotation.x = slotTilt;
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
				wrongTile.targetRotation.set(0, 0, 0);
			}
		}

		targetSlot.tile = foundTile;
		foundTile.currentSlot = targetSlot;
		if (typeof foundTile.startWave === 'function') {
			foundTile.startWave(0);
		}
		foundTile.startSnapFx();
		foundTile.setTarget(targetSlot.worldPos.x, targetSlot.worldPos.y, targetSlot.worldPos.z);
		foundTile.targetRotation.set(0, 0, 0);

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

	function showLevelSelectModal() {
		var modal = document.getElementById('level-select-modal');
		if (modal) {
			if (typeof SpeedometerManager !== 'undefined') {
				SpeedometerManager.renderLevelSelectModal();
			}
			modal.classList.add('show');
			AudioManager.play('tilehit', 0.9);
			AudioManager.haptic(20);
		}
	}

	function hideLevelSelectModal() {
		var modal = document.getElementById('level-select-modal');
		if (modal) modal.classList.remove('show');
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
		var currentScenery = (global.WordscapesScenery && global.WordscapesScenery.getCurrent) ? global.WordscapesScenery.getCurrent() : 'sakura';

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

			// Clean up any old badges
			var oldBadge = btn.querySelector('.item-badge-status');
			if (oldBadge) oldBadge.remove();
		});
	}

	// --------------------------------------------------------------------------
	// UI & HUD
	// --------------------------------------------------------------------------
	function updateHUD() {
		var currentLvlName = getLevelName(currentLevelIndex);

		var levelNumEl = document.getElementById('hud-level-num');
		if (levelNumEl) levelNumEl.textContent = (currentLevelIndex + 1);

		var levelNameEl = document.getElementById('hud-level-name');
		if (levelNameEl) levelNameEl.textContent = currentLvlName;

		var settingsLvlEl = document.getElementById('settings-level-num');
		if (settingsLvlEl) settingsLvlEl.textContent = (currentLevelIndex + 1);

		var settingsNameEl = document.getElementById('settings-level-name');
		if (settingsNameEl) settingsNameEl.textContent = currentLvlName;

		var homeLvlNum = document.getElementById('home-level-num');
		if (homeLvlNum) homeLvlNum.textContent = (currentLevelIndex + 1);

		var homeLvlName = document.getElementById('home-level-name');
		if (homeLvlName) homeLvlName.textContent = currentLvlName;

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
		// Suppress extra UI notifications during active VS Mode matches per clean HUD design
		if (MultiplayerManager.isActive) {
			var settingsOpen = document.querySelector('#theme-modal.show, #tile-storage-modal.show');
			if (!settingsOpen) return;
		}
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

	function initCelebrationParticles() {
		// Confetti celebration removed per player request: keeping celebratory spotlight on star fireworks & tray wave
		if (confettiGroup) {
			scene.remove(confettiGroup);
			celebrationParticles.forEach(function (p) {
				if (p.geometry) p.geometry.dispose();
				if (p.material) p.material.dispose();
			});
			celebrationParticles = [];
			confettiGroup = null;
		}
	}

	function updateCelebrationParticles(dt, now) {
		if (!confettiGroup || celebrationParticles.length === 0) return;

		for (var i = celebrationParticles.length - 1; i >= 0; i--) {
			var p = celebrationParticles[i];
			var u = p.userData;
			if (!u) continue;

			// One-shot sparkle burst particles from gift unboxing
			if (typeof u.isSparkle !== 'undefined') {
				u.life -= dt * 1.25;
				u.vy -= 9.8 * dt;
				p.position.x += u.vx * dt;
				p.position.y += u.vy * dt;
				p.position.z += u.vz * dt;
				p.rotation.x += u.rotSpeedX * dt;
				p.rotation.y += u.rotSpeedY * dt;
				var sc = Math.max(0.001, u.life);
				p.scale.set(sc, sc, sc);

				if (u.life <= 0) {
					confettiGroup.remove(p);
					if (p.geometry) p.geometry.dispose();
					celebrationParticles.splice(i, 1);
				}
				continue;
			}
		}
	}

	function spawnCongratulatoryTrays() {
		// Clear any previous victory trays and tiles
		if (victoryTrayGroup) {
			victoryTrayGroup.traverse(function (obj) {
				if (obj.geometry) obj.geometry.dispose();
			});
			scene.remove(victoryTrayGroup);
			victoryTrayGroup = null;
		}
		victoryMessageTiles.forEach(function (t) {
			scene.remove(t.mesh);
			var idx = allTiles.indexOf(t);
			if (idx !== -1) allTiles.splice(idx, 1);
		});
		victoryMessageTiles = [];

		var pair = WIN_MESSAGES[Math.floor(Math.random() * WIN_MESSAGES.length)];
		var vsVictoryBeamMat = null;
		if (MultiplayerManager.isActive) {
			if (MultiplayerManager.winner === 'p2') {
				pair = { r1: 'RED', r2: 'WINS' };
				vsVictoryBeamMat = materials.vsTrayRed;
			} else {
				pair = { r1: 'YOU', r2: 'WIN' };
				vsVictoryBeamMat = materials.vsTrayBlue;
			}
		}
		if (winCelebrationState) winCelebrationState.victoryMessage = pair;

		victoryTrayGroup = new THREE.Group();
		scene.add(victoryTrayGroup);

		// Calculate center screen Z position dynamically based on camera framing
		var numRows = (currentLevelData && currentLevelData.words) ? currentLevelData.words.length : (chainRowData.length || 5);
		var layout = getBoardLayout(numRows);
		var centerZ = currentCenterZ || ((layout.startZ + layout.stagingZ) * 0.5);

		var slotWidth = 1.15;
		var rackDepth = 1.30;
		var rackHeight = 0.34;
		var trayZSpacing = 1.55;

		function buildSingleTray(word, trayZ, initialX) {
			var wordLen = word.length;
			var rackWidth = wordLen * slotWidth + 0.50;
			var trayGroup = new THREE.Group();
			trayGroup.position.set(initialX, 0, trayZ);

			// Main wooden beam (Winner's color in VS mode, or active illuminated tray hardwood)
			var beamMat = vsVictoryBeamMat || materials.yellowTrayActive || materials.yellowTray;
			var beamGeom = new THREE.BoxGeometry(rackWidth, rackHeight, rackDepth);
			var beam = new THREE.Mesh(beamGeom, beamMat);
			beam.position.y = rackHeight * 0.5;
			trayGroup.add(beam);

			// Front retaining lip (Winner's color in VS mode, or distinct champagne brass / active lip)
			var lipMat = vsVictoryBeamMat || materials.feederTrayLip || materials.yellowTrayActive;
			var lipGeom = new THREE.BoxGeometry(rackWidth + 0.04, 0.15, 0.15);
			var lip = new THREE.Mesh(lipGeom, lipMat);
			lip.position.set(0, rackHeight + 0.075, rackDepth * 0.5 - 0.075);
			trayGroup.add(lip);

			// Brushed brass side end-caps
			var endCapGeom = new THREE.BoxGeometry(0.08, rackHeight + 0.04, rackDepth + 0.02);
			var leftCap = new THREE.Mesh(endCapGeom, materials.brassBracket);
			leftCap.position.set(-rackWidth * 0.5 - 0.04, (rackHeight + 0.04) * 0.5, 0);
			trayGroup.add(leftCap);

			var rightCap = new THREE.Mesh(endCapGeom, materials.brassBracket);
			rightCap.position.set(rackWidth * 0.5 + 0.04, (rackHeight + 0.04) * 0.5, 0);
			trayGroup.add(rightCap);

			// Slot felt beds and letter blocks
			var startX = -((wordLen - 1) * slotWidth) * 0.5;
			var rowTiles = [];

			for (var c = 0; c < wordLen; c++) {
				var sx = startX + c * slotWidth;

				// Felt lining
				var sMesh = new THREE.Mesh(
					new THREE.PlaneGeometry(1.06, 1.06),
					materials.slotFelt
				);
				sMesh.rotation.x = -Math.PI * 0.5;
				sMesh.position.set(sx, rackHeight + 0.015, 0);
				trayGroup.add(sMesh);

				// Locked Golden Victory Tile block sitting on the tray!
				var letter = word[c];
				var tile = new Tile(letter, true);
				var tileX = sx;
				var tileY = rackHeight + 0.155;

				tile.mesh.position.set(tileX + initialX, tileY, trayZ);
				tile.targetPosition.set(tileX + initialX, tileY, trayZ);
				tile.targetRotation.set(0, 0, 0);
				tile.baseX = tileX;
				tile.col = c;

				scene.add(tile.mesh);
				victoryMessageTiles.push(tile);
				allTiles.push(tile);
				rowTiles.push(tile);
			}

			victoryTrayGroup.add(trayGroup);

			return {
				tray: trayGroup,
				tiles: rowTiles
			};
		}

		var tray1Data = buildSingleTray(pair.r1, centerZ - trayZSpacing * 0.5, -16.0);
		var tray2Data = buildSingleTray(pair.r2, centerZ + trayZSpacing * 0.5, 16.0);

		if (winCelebrationState) {
			winCelebrationState.congratulatoryData = {
				tray1: tray1Data.tray,
				tiles1: tray1Data.tiles,
				tray2: tray2Data.tray,
				tiles2: tray2Data.tiles
			};
		}
	}

	function updateWinCelebrationAnimation(now, dt) {
		if (!winCelebrationState || !winCelebrationState.active) return;
		var elapsed = (now - winCelebrationState.startTime) * 0.001;
		var numRows = winCelebrationState.numRows;

		// 1. Process each level row: wave letters first, then slide tray + letters away
		for (var r = 0; r < numRows; r++) {
			var rowInfo = chainRowData[r];
			if (!rowInfo) continue;

			var rWaveStart = r * winCelebrationState.rowInterval;
			var rSlideStart = rWaveStart + winCelebrationState.waveDelayBeforeSlide;

			// Trigger letter wave jump across the word
			if (elapsed >= rWaveStart && !winCelebrationState.rowsWaved[r]) {
				winCelebrationState.rowsWaved[r] = true;
				if (rowInfo.slots) {
					for (var c = 0; c < rowInfo.slots.length; c++) {
						var slot = rowInfo.slots[c];
						if (slot && slot.tile && typeof slot.tile.startWave === 'function') {
							slot.tile.startWave(c * 0.05);
						}
					}
				}
				AudioManager.play('tilehit', 0.7);
			}

			// Animate tray and its letters sliding away off-screen
			if (elapsed >= rSlideStart) {
				var u = (elapsed - rSlideStart) / winCelebrationState.slideDuration;
				var slideDir = (r % 2 === 0) ? -1 : 1; // Alternating left and right!
				var maxDist = 18.0;

				if (u < 1.0) {
					// Snappy accelerating swoosh
					var ease = u * u * (3 - 2 * u);
					var dx = slideDir * (ease * maxDist);

					if (rowInfo.rowGroup) {
						rowInfo.rowGroup.position.x = dx;
					}
					if (rowInfo.slots) {
						for (var sc = 0; sc < rowInfo.slots.length; sc++) {
							var s = rowInfo.slots[sc];
							if (s && s.tile && s.tile.mesh) {
								s.tile.mesh.position.x = s.worldPos.x + dx;
								s.tile.targetPosition.x = s.worldPos.x + dx;
							}
						}
					}
				} else if (!winCelebrationState.rowsSlid[r]) {
					winCelebrationState.rowsSlid[r] = true;
					if (rowInfo.rowGroup) {
						rowInfo.rowGroup.visible = false;
						rowInfo.rowGroup.position.x = slideDir * 25.0;
					}
					if (rowInfo.slots) {
						for (var sc2 = 0; sc2 < rowInfo.slots.length; sc2++) {
							var s2 = rowInfo.slots[sc2];
							if (s2 && s2.tile && s2.tile.mesh) {
								s2.tile.mesh.visible = false;
							}
						}
					}
				}
			}
		}

		// 2. Once all level trays have slid away, spawn congratulatory message CENTER SCREEN ON TRAYS!
		var allRowsSlidTime = (numRows - 1) * winCelebrationState.rowInterval + winCelebrationState.waveDelayBeforeSlide + winCelebrationState.slideDuration;

		if (elapsed >= allRowsSlidTime + 0.10 && !winCelebrationState.victorySpawned) {
			winCelebrationState.victorySpawned = true;
			winCelebrationState.victorySpawnTime = elapsed;
			spawnCongratulatoryTrays();
		}

		// 3. Animate the congratulatory trays and tiles sliding in to center screen
		if (winCelebrationState.victorySpawned && winCelebrationState.congratulatoryData) {
			var cData = winCelebrationState.congratulatoryData;
			var vElapsed = elapsed - winCelebrationState.victorySpawnTime;
			var vDuration = 0.44; // 440ms snappy spring slide-in

			if (vElapsed < vDuration) {
				var progress = vElapsed / vDuration;
				// Back ease out: overshoot slightly and settle with magnetic snap
				var s1 = 1.5;
				var t = progress - 1;
				var easeOutBack = t * t * ((s1 + 1) * t + s1) + 1;

				// Tray 1 slides in from left (-16 -> 0)
				var x1 = -16.0 * (1 - easeOutBack);
				if (cData.tray1) cData.tray1.position.x = x1;
				cData.tiles1.forEach(function (tileObj) {
					if (tileObj && tileObj.mesh) {
						tileObj.mesh.position.x = tileObj.baseX + x1;
						tileObj.targetPosition.x = tileObj.baseX + x1;
					}
				});

				// Tray 2 slides in from right (+16 -> 0)
				var x2 = 16.0 * (1 - easeOutBack);
				if (cData.tray2) cData.tray2.position.x = x2;
				cData.tiles2.forEach(function (tileObj) {
					if (tileObj && tileObj.mesh) {
						tileObj.mesh.position.x = tileObj.baseX + x2;
						tileObj.targetPosition.x = tileObj.baseX + x2;
					}
				});
			} else if (!winCelebrationState.victoryLanded) {
				winCelebrationState.victoryLanded = true;
				if (cData.tray1) cData.tray1.position.x = 0;
				if (cData.tray2) cData.tray2.position.x = 0;
				cData.tiles1.forEach(function (tileObj) {
					if (tileObj && tileObj.mesh) {
						tileObj.mesh.position.x = tileObj.baseX;
						tileObj.targetPosition.x = tileObj.baseX;
						tileObj.startWave(tileObj.col * 0.08); // Domino wave across row 1
					}
				});
				cData.tiles2.forEach(function (tileObj) {
					if (tileObj && tileObj.mesh) {
						tileObj.mesh.position.x = tileObj.baseX;
						tileObj.targetPosition.x = tileObj.baseX;
						tileObj.startWave(tileObj.col * 0.08 + 0.12); // Domino wave across row 2
					}
				});

				AudioManager.playSnap(1.4);
				AudioManager.haptic(45);

				// In VS Mode, show the dedicated Match Results screen; in Solo Play, reveal the raised NEXT button
				if (MultiplayerManager.isActive) {
					MultiplayerManager.scheduleMatchResultsReveal(380);
				} else {
					var btnNext = document.getElementById('btn-floating-next');
					if (btnNext) {
						btnNext.classList.add('show');
					}
				}
			} else {
				// Gentle periodic domino wave on the congratulatory blocks while waiting for NEXT
				if (!winCelebrationState.lastPeriodicWave || (now - winCelebrationState.lastPeriodicWave > 2400)) {
					winCelebrationState.lastPeriodicWave = now;
					cData.tiles1.forEach(function (t) {
						if (t && typeof t.startWave === 'function') t.startWave(t.col * 0.06);
					});
					cData.tiles2.forEach(function (t) {
						if (t && typeof t.startWave === 'function') t.startWave(t.col * 0.06 + 0.10);
					});
				}
			}
		}
	}

	var winCelebrationTimeout = null;
	var winCelebrationStartTime = 0;

	function triggerWinCelebration() {
		if (levelEntranceState && levelEntranceState.active) {
			completeLevelEntranceImmediately();
		}
		isCelebratingWin = true;
		dismissGhostTile();

		// Clear any pending win card timeout
		if (winCelebrationTimeout) {
			clearTimeout(winCelebrationTimeout);
			winCelebrationTimeout = null;
		}

		// Hide active row chevrons, 3D phrase coupler, staging tray, and bottom buttons during celebration
		if (activeRowIndicatorGroup) activeRowIndicatorGroup.visible = false;
		if (phraseCouplerGroup) phraseCouplerGroup.visible = false;
		if (stagingTrayGroup) stagingTrayGroup.visible = false;
		stagingSlots.forEach(function (s) {
			if (s.tile) s.tile.mesh.visible = false;
		});

		var hudBottom = document.getElementById('hud-bottom');
		if (hudBottom) hudBottom.style.display = 'none';

		// Dismiss any active toast notifications during celebration
		var toast = document.getElementById('toast-banner');
		if (toast) toast.classList.remove('show');
		if (toastTimeout) {
			clearTimeout(toastTimeout);
			toastTimeout = null;
		}

		// Clean up any previous celebration particles or victory trays
		if (confettiGroup) {
			scene.remove(confettiGroup);
			celebrationParticles = [];
			confettiGroup = null;
		}
		if (victoryTrayGroup) {
			victoryTrayGroup.traverse(function (obj) {
				if (obj.geometry) obj.geometry.dispose();
			});
			scene.remove(victoryTrayGroup);
			victoryTrayGroup = null;
		}
		victoryMessageTiles.forEach(function (t) {
			scene.remove(t.mesh);
			var idx = allTiles.indexOf(t);
			if (idx !== -1) allTiles.splice(idx, 1);
		});
		victoryMessageTiles = [];

		var btnNext = document.getElementById('btn-floating-next');
		if (btnNext) btnNext.classList.remove('show');

		var toast = document.getElementById('toast-banner');
		if (toast) toast.classList.remove('show');
		if (toastTimeout) {
			clearTimeout(toastTimeout);
			toastTimeout = null;
		}

		winCelebrationStartTime = performance.now();

		// Configure Tray Wave & Slide-Away Choreography
		winCelebrationState = {
			active: true,
			startTime: performance.now(),
			numRows: chainRowData.length,
			rowInterval: 0.24,          // 240ms stagger between consecutive row waves
			waveDelayBeforeSlide: 0.30, // 300ms after wave begins, row starts sliding off
			slideDuration: 0.38,        // 380ms smooth off-screen swoosh
			rowsWaved: {},
			rowsSlid: {},
			victorySpawned: false,
			victorySpawnTime: 0,
			victoryLanded: false,
			victoryMessage: null,
			lastPeriodicWave: performance.now()
		};

		// Keep stars lit and continue star fireworks periodically from the speedometer (Solo mode only)
		if (!MultiplayerManager.isActive && typeof SpeedometerManager !== 'undefined' && SpeedometerManager.startPeriodicStarFireworks) {
			var earnedStars = (SpeedometerManager.lastCompletionResult && SpeedometerManager.lastCompletionResult.starsEarned)
				|| SpeedometerManager.peakStarsAchieved
				|| SpeedometerManager.lastStarsLit
				|| 3;
			SpeedometerManager.startPeriodicStarFireworks(earnedStars);
		}

		// Play celebratory fanfare sound & haptics
		if (MultiplayerManager.isActive && MultiplayerManager.winner === 'p2') {
			AudioManager.playSnap(1.1);
			AudioManager.haptic(35);
		} else {
			AudioManager.play('greatJob', 1.0);
			AudioManager.haptic(50);
			setTimeout(function () { AudioManager.haptic(35); }, 200);
		}
	}

	function stopWinCelebration() {
		isCelebratingWin = false;
		if (typeof SpeedometerManager !== 'undefined' && SpeedometerManager.stopPeriodicStarFireworks) {
			SpeedometerManager.stopPeriodicStarFireworks();
		}
		if (winCelebrationTimeout) {
			clearTimeout(winCelebrationTimeout);
			winCelebrationTimeout = null;
		}
		if (mexicanWaveInterval) {
			clearInterval(mexicanWaveInterval);
			mexicanWaveInterval = null;
		}

		winCelebrationState = null;

		var btnNext = document.getElementById('btn-floating-next');
		if (btnNext) btnNext.classList.remove('show');

		var toast = document.getElementById('toast-banner');
		if (toast) toast.classList.remove('show');
		if (toastTimeout) {
			clearTimeout(toastTimeout);
			toastTimeout = null;
		}

		var celebCard = document.getElementById('win-celebration-card');
		if (celebCard) celebCard.classList.remove('show');

		var winSpeedCard = document.getElementById('win-speed-card');
		if (winSpeedCard) winSpeedCard.classList.remove('show');

		// Clean up congratulatory trays and tiles
		if (victoryTrayGroup) {
			victoryTrayGroup.traverse(function (obj) {
				if (obj.geometry) obj.geometry.dispose();
			});
			scene.remove(victoryTrayGroup);
			victoryTrayGroup = null;
		}
		victoryMessageTiles.forEach(function (t) {
			scene.remove(t.mesh);
			var idx = allTiles.indexOf(t);
			if (idx !== -1) allTiles.splice(idx, 1);
		});
		victoryMessageTiles = [];

		// Restore 3D board rows and controls for normal gameplay
		if (chainRacksGroup) {
			chainRacksGroup.visible = true;
			for (var r = 0; r < chainRowData.length; r++) {
				var rowInfo = chainRowData[r];
				if (rowInfo && rowInfo.rowGroup) {
					rowInfo.rowGroup.visible = true;
					rowInfo.rowGroup.position.set(0, rowInfo.rowY || 0, rowInfo.rz);
				}
				if (rowInfo && rowInfo.slots) {
					for (var c = 0; c < rowInfo.slots.length; c++) {
						var s = rowInfo.slots[c];
						if (s && s.tile && s.tile.mesh) {
							s.tile.mesh.visible = true;
							s.tile.mesh.position.set(s.worldPos.x, s.worldPos.y, s.worldPos.z);
							s.tile.targetPosition.set(s.worldPos.x, s.worldPos.y, s.worldPos.z);
						}
					}
				}
			}
		}

		if (stagingTrayGroup) {
			stagingTrayGroup.visible = true;
			stagingTrayGroup.position.x = 0;
		}

		allTiles.forEach(function (tile) {
			if (tile && tile.mesh) tile.mesh.visible = true;
		});
		stagingSlots.forEach(function (s) {
			if (s.tile && s.tile.mesh) s.tile.mesh.visible = true;
		});

		var hudHeader = document.getElementById('hud-header');
		if (hudHeader) hudHeader.style.display = 'flex';

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
	}

	function showWinModal() {
		triggerWinCelebration();
	}

	function hideWinModal() {
		stopWinCelebration();
	}

	// --------------------------------------------------------------------------
	// Responsive Camera Framing & Dynamic Full-Vertical System
	// --------------------------------------------------------------------------
	var currentCenterZ = 0;

	function updateCameraFraming() {
		if (!camera || !renderer) return;

		var aspect = window.innerWidth / window.innerHeight;
		camera.aspect = aspect;

		var numRows = (currentLevelData && currentLevelData.words) ? currentLevelData.words.length : (chainRowData.length || 5);
		var layout = getBoardLayout(numRows);
		var stagingZ = layout.stagingZ;
		var startZ = layout.startZ;

		// Exact physical vertical bounds of the 3D board
		var boardTopZ = startZ - 0.70;       // Top rim of upper rack
		var boardBottomZ = stagingZ + 0.75;  // Bottom rim of player staging rack
		var boardHeight = boardBottomZ - boardTopZ;

		var isMobilePortrait = (aspect < 0.75);

		// Determine dynamic top and bottom safe boundaries on screen
		// Top HUD header (speedometer + star gauge) height measured from actual DOM
		var headerEl = document.getElementById('hud-header');
		var headerBottomPx = 115;
		if (headerEl) {
			var hRect = headerEl.getBoundingClientRect();
			if (hRect && hRect.bottom > 0) {
				headerBottomPx = hRect.bottom;
			}
		}
		var topPaddingPx = isMobilePortrait ? 20 : 16;
		var topSafeFraction = (headerBottomPx + topPaddingPx) / window.innerHeight;
		topSafeFraction = Math.max(0.14, Math.min(0.24, topSafeFraction));

		// Bottom HUD (#hud-bottom with shuffle/hint/recall) measured dynamically from DOM
		var hudBottomEl = document.getElementById('hud-bottom');
		var bottomBarTopPx = window.innerHeight - (isMobilePortrait ? 76 : 64);
		if (hudBottomEl) {
			var bRect = hudBottomEl.getBoundingClientRect();
			if (bRect && bRect.top > 0) {
				bottomBarTopPx = bRect.top;
			}
		}
		var bottomPaddingPx = isMobilePortrait ? 24 : 18;
		var bottomSafeFraction = (bottomBarTopPx - bottomPaddingPx) / window.innerHeight;
		bottomSafeFraction = Math.max(0.78, Math.min(0.92, bottomSafeFraction));

		// Safe playable vertical span between top header and bottom action bar
		var safeSpan = Math.max(0.40, bottomSafeFraction - topSafeFraction);
		var targetOccupancy = isMobilePortrait ? Math.min(0.68, safeSpan) : Math.min(0.72, safeSpan);

		var fov = 46;
		var fovRad = THREE.MathUtils.degToRad(fov);
		var halfFovTan = Math.tan(fovRad * 0.5);

		var reqWidth = (numRows >= 8) ? 10.8 : ((numRows === 7) ? 10.5 : 10.2);
		var reqHeight = boardHeight / targetOccupancy;

		var camY_by_width = (reqWidth / aspect) / (2 * halfFovTan);
		var camY_by_height = reqHeight / (2 * halfFovTan);
		var camY = Math.max(camY_by_width, camY_by_height);

		// Scenery adjustment for volcano
		var activeScenery = (global.WordscapesScenery && global.WordscapesScenery.getCurrent) ? global.WordscapesScenery.getCurrent() : null;
		if (activeScenery === 'volcano') {
			camY *= 1.08;
		}

		if (perspectiveMode === 'classic') {
			camY *= 1.05;
		}

		// Calculate vertical distribution of board within safe span
		var viewHeight = 2 * camY * halfFovTan;
		var boardFractionOnScreen = boardHeight / viewHeight;
		var slack = Math.max(0, safeSpan - boardFractionOnScreen);

		// Distribute slack: On mobile portrait, allocate ~62% of slack to the top,
		// bringing everything DOWN to fill the bottom blank space while maintaining
		// guaranteed clear clearance under the speedometer and milestone stars!
		var topSlackRatio = isMobilePortrait ? 0.62 : 0.50;
		var boardTopScreenFrac = topSafeFraction + topSlackRatio * slack;

		// Calculate centerZ so that boardTopZ sits precisely at boardTopScreenFrac on screen
		var centerZ = boardTopZ + viewHeight * (0.5 - boardTopScreenFrac);
		currentCenterZ = centerZ;

		camera.fov = fov;
		camera.up.set(0, 0, -1);
		camera.position.set(0, camY, centerZ);
		camera.lookAt(0, 0, centerZ);

		camera.updateProjectionMatrix();
		renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.0));
		renderer.setSize(window.innerWidth, window.innerHeight);

		// Synchronize panoramic backdrop photo dynamically
		if (global.WordscapesScenery && typeof global.WordscapesScenery.onCameraUpdate === 'function') {
			global.WordscapesScenery.onCameraUpdate(camY, centerZ, fov, aspect);
		}
	}

	function applyPerspectiveMode(mode) {
		if (mode === 'incline' || mode === 'classic') {
			perspectiveMode = mode;
		}
		try {
			localStorage.setItem('word_chain_perspective_mode', perspectiveMode);
		} catch (e) {}

		// Reposition chain rows, racks, slots, and tiles (Full vertical, zero tilt)
		for (var r = 0; r < chainRowData.length; r++) {
			var rowInfo = chainRowData[r];
			rowInfo.rowY = 0;
			rowInfo.rackTilt = 0;
			rowInfo.rowGroup.position.y = 0;
			rowInfo.rowGroup.rotation.x = 0;

			for (var c = 0; c < rowInfo.slots.length; c++) {
				var slot = rowInfo.slots[c];
				slot.worldPos.y = rowInfo.rackHeight + 0.155;
				slot.worldPos.z = rowInfo.rz;

				if (slot.tile && !slot.tile.isDragging) {
					slot.tile.setTarget(slot.worldPos.x, slot.worldPos.y, slot.worldPos.z);
					slot.tile.targetRotation.set(0, 0, 0);
				}
			}
		}

		// Reposition active 3D gift boxes
		activeGiftBoxes.forEach(function (gb) {
			if (!gb || !gb.group) return;
			var r = gb.rowIdx;
			var rInfo = chainRowData[r];
			if (rInfo) {
				var baseY = (rInfo.rackHeight + 0.22);
				gb.baseY = baseY;
				gb.rowY = 0;
				gb.rackTilt = 0;
				gb.group.position.y = baseY;
				gb.group.rotation.x = 0;
			}
		});

		// Reposition chevrons
		updateActiveRowVisuals();

		// Update camera framing with new angle / distance
		updateCameraFraming();

		// Update UI toggle icons and settings modal active state
		updatePerspectiveModeUI();
	}

	function togglePerspectiveMode() {
		var newMode = (perspectiveMode === 'incline') ? 'classic' : 'incline';
		applyPerspectiveMode(newMode);
		var label = (newMode === 'incline') ? '📐 Standard Vertical' : '📐 Panoramic Vertical';
		showToast(label);
		AudioManager.play('tilehit', 0.9);
		AudioManager.haptic(20);
	}

	function updatePerspectiveModeUI() {
		var btnToggleCam = document.getElementById('btn-toggle-cam');
		var iconEl = document.getElementById('cam-toggle-icon');
		var isIncline = (perspectiveMode === 'incline');

		if (btnToggleCam) {
			btnToggleCam.title = isIncline ? 'Current: 3D Incline Highway (Tap for Classic)' : 'Current: Classic View (Tap for 3D Incline)';
			btnToggleCam.setAttribute('aria-label', btnToggleCam.title);
			btnToggleCam.classList.toggle('active-incline', isIncline);
		}
		if (iconEl) {
			iconEl.textContent = isIncline ? '🎸' : '📐';
		}

		var optIncline = document.getElementById('opt-cam-incline');
		var optClassic = document.getElementById('opt-cam-classic');
		if (optIncline && optClassic) {
			optIncline.classList.toggle('active', isIncline);
			optClassic.classList.toggle('active', !isIncline);
		}
	}

	function onWindowResize() {
		applyPerspectiveMode();
		if (typeof Star3DManager !== 'undefined' && typeof Star3DManager.onResize === 'function') {
			Star3DManager.onResize();
		}
	}

	var lastTime = 0;

	function animate(now) {
		requestAnimationFrame(animate);

		var dt = (now - lastTime) * 0.001;
		if (dt < 0.009) return; // Smooth 60 FPS pacing without dropping frames on 60Hz displays
		lastTime = now;
		dt = Math.min(dt, 0.05);

		// Update in-game tile animations & physics
		for (var i = 0; i < allTiles.length; i++) {
			allTiles[i].update(dt);
		}

		// Animate cascading tray spawn from top to bottom at start of level
		if (levelEntranceState && levelEntranceState.active) {
			updateLevelEntrance(now);
		}

		// Animate win celebration tray wave, slide-away, and congratulatory message on trays
		if (winCelebrationState && winCelebrationState.active) {
			updateWinCelebrationAnimation(now, dt);
		}

		// Animate 3D Active Row Indicator Chevrons
		if (activeRowIndicatorGroup && activeRowIndicatorGroup.visible && chainRowData[currentWordIndex]) {
			var activeRowData = chainRowData[currentWordIndex];
			var bob = Math.sin(now * 0.005) * 0.08;
			// Left Chevron bobbing towards rack ▶
			if (chevronMesh) {
				var baseChevronX = -activeRowData.rackWidth * 0.5 - 0.85;
				chevronMesh.position.x = baseChevronX + bob;
			}
			// Right Chevron bobbing towards rack ◀
			if (chevronRightMesh) {
				var baseRightChevronX = activeRowData.rackWidth * 0.5 + 0.85;
				chevronRightMesh.position.x = baseRightChevronX - bob;
			}
			if (materials.chevron) {
				materials.chevron.emissiveIntensity = 0.55 + Math.sin(now * 0.006) * 0.35;
			}
		}

		// Animate 3D Opponent Active Row Indicator (Opponent Avatar Beacon in PVP)
		if (opponentRowIndicatorGroup && opponentRowIndicatorGroup.visible && MultiplayerManager.isActive && !MultiplayerManager.matchFinished) {
			if (opponentIndicatorState.isTransitioning) {
				var transElapsed = now - opponentIndicatorState.transitionStart;
				var p = Math.min(1.0, transElapsed / opponentIndicatorState.transitionDuration);
				var ease = 1 - Math.pow(1 - p, 3);
				var curX = THREE.MathUtils.lerp(opponentIndicatorState.fromPos.x, opponentIndicatorState.targetPos.x, ease);
				var curZ = THREE.MathUtils.lerp(opponentIndicatorState.fromPos.z, opponentIndicatorState.targetPos.z, ease);
				var hopHeight = 0.55;
				var curY = THREE.MathUtils.lerp(opponentIndicatorState.fromPos.y, opponentIndicatorState.targetPos.y, ease) + Math.sin(p * Math.PI) * hopHeight;

				opponentRowIndicatorGroup.position.set(curX, curY, curZ);
				opponentIndicatorState.currentPos.set(curX, curY, curZ);

				if (p >= 1.0) {
					opponentIndicatorState.isTransitioning = false;
				}
			} else {
				var oppBobX = Math.sin(now * 0.005) * 0.05;
				var oppBobY = Math.sin(now * 0.0035) * 0.03;
				opponentRowIndicatorGroup.position.x = opponentIndicatorState.targetPos.x - oppBobX;
				opponentRowIndicatorGroup.position.y = opponentIndicatorState.targetPos.y + oppBobY;
				opponentRowIndicatorGroup.position.z = opponentIndicatorState.targetPos.z;
			}

			var oppPulse = 0.70 + Math.sin(now * 0.006) * 0.30;
			if (materials.opponentChevron && materials.opponentChevron.emissiveIntensity !== undefined) {
				materials.opponentChevron.emissiveIntensity = oppPulse;
			}
			if (materials.opponentRing && materials.opponentRing.emissiveIntensity !== undefined) {
				materials.opponentRing.emissiveIntensity = oppPulse * 0.8;
			}
		} else if (opponentRowIndicatorGroup && opponentRowIndicatorGroup.visible && (!MultiplayerManager.isActive || MultiplayerManager.matchFinished)) {
			opponentRowIndicatorGroup.visible = false;
		}

		// Animate 3D Phrase Coupler connecting the two solvable trays
		if (!isGamePlayActive()) {
			if (phraseCouplerGroup && phraseCouplerGroup.visible) {
				phraseCouplerGroup.visible = false;
			}
		} else if (phraseCouplerGroup && phraseCouplerGroup.visible) {
			var couplerPulse = Math.sin(now * 0.005);

			// Intense golden radiance glow
			if (materials.goldChainLink) {
				materials.goldChainLink.emissiveIntensity = 0.85 + couplerPulse * 0.35;
			}
			if (materials.brassBracket) {
				materials.brassBracket.emissiveIntensity = 0.45 + couplerPulse * 0.20;
			}
			if (materials.couplerGlowBeam) {
				materials.couplerGlowBeam.opacity = 0.65 + couplerPulse * 0.25;
			}

			// Physical Swing and Snap Animation when advancing to subsequent tray
			if (chainSwingState && chainSwingState.active) {
				var swingElapsed = (now - chainSwingState.startTime) * 0.001;
				var swingProgress = Math.min(1.0, swingElapsed / chainSwingState.duration);

				if (swingProgress < 0.70) {
					// 1. PENDULUM SWING PHASE: Lower ends of chains lift up in a dynamic parabolic arc and swing forward
					var pSwing = swingProgress / 0.70;
					var swingLiftY = Math.sin(pSwing * Math.PI) * 0.95;
					var swingTiltX = -Math.sin(pSwing * Math.PI) * 0.52;

					if (leftMountLower) {
						leftMountLower.position.y = (leftMountLower.userData.targetY || 0.46) + swingLiftY;
						leftMountLower.rotation.x = swingTiltX;
					}
					if (rightMountLower) {
						rightMountLower.position.y = (rightMountLower.userData.targetY || 0.46) + swingLiftY;
						rightMountLower.rotation.x = swingTiltX;
					}

					for (var li = 0; li < leftLinks.length; li++) {
						var tL = (li + 1) / (leftLinks.length + 1);
						var linkLiftY = swingLiftY * tL;
						leftLinks[li].position.y = (leftLinks[li].userData.targetY || 0.46) + linkLiftY;
						leftLinks[li].rotation.x = (leftLinks[li].userData.baseRotX || 0) + swingTiltX * tL;
					}
					for (var ri = 0; ri < rightLinks.length; ri++) {
						var tR = (ri + 1) / (rightLinks.length + 1);
						var rLinkLiftY = swingLiftY * tR;
						rightLinks[ri].position.y = (rightLinks[ri].userData.targetY || 0.46) + rLinkLiftY;
						rightLinks[ri].rotation.x = (rightLinks[ri].userData.baseRotX || 0) + swingTiltX * tR;
					}

					if (centerChainGroup) {
						centerChainGroup.position.y = (centerChainGroup.userData.targetY || 0.48) + swingLiftY * 0.75;
						centerChainGroup.rotation.x = swingTiltX * 0.65;
					}
				} else {
					// 2. MECHANICAL SNAP & OVERSHOOT IMPACT PHASE:
					if (!chainSwingState.hasSnapped) {
						chainSwingState.hasSnapped = true;
						AudioManager.playSnap(1.55);
						AudioManager.hapticPattern([
							{ t: 0.0, i: 0.95, s: 0.90, d: 0.025 },
							{ t: 0.07, i: 1.0, s: 0.95, d: 0.035 }
						]);
						if (leftMountLower) triggerChainSnapSparks(leftMountLower.position.x, leftMountLower.position.y, leftMountLower.position.z);
						if (rightMountLower) triggerChainSnapSparks(rightMountLower.position.x, rightMountLower.position.y, rightMountLower.position.z);
					}

					// Damped physical spring wobble on landing
					var pSnap = (swingProgress - 0.70) / 0.30;
					var springVibe = Math.sin(pSnap * Math.PI * 4.5) * Math.exp(-pSnap * 7.5) * 0.12;

					if (leftMountLower) {
						leftMountLower.position.y = (leftMountLower.userData.targetY || 0.46) + springVibe;
						leftMountLower.rotation.x = 0;
					}
					if (rightMountLower) {
						rightMountLower.position.y = (rightMountLower.userData.targetY || 0.46) + springVibe;
						rightMountLower.rotation.x = 0;
					}

					for (var li = 0; li < leftLinks.length; li++) {
						leftLinks[li].position.y = (leftLinks[li].userData.targetY || 0.46) + springVibe * 0.7;
						leftLinks[li].rotation.x = (leftLinks[li].userData.baseRotX || 0);
					}
					for (var ri = 0; ri < rightLinks.length; ri++) {
						rightLinks[ri].position.y = (rightLinks[ri].userData.targetY || 0.46) + springVibe * 0.7;
						rightLinks[ri].rotation.x = (rightLinks[ri].userData.baseRotX || 0);
					}
					if (centerChainGroup) {
						centerChainGroup.position.y = (centerChainGroup.userData.targetY || 0.48) + springVibe * 0.75;
						centerChainGroup.rotation.x = 0;
					}

					if (swingProgress >= 1.0) {
						chainSwingState.active = false;
					}
				}
			} else {
				// Gentle resting hover breathing for flank chain links
				var gentleHover = Math.sin(now * 0.004) * 0.025;
				for (var li = 0; li < leftLinks.length; li++) {
					leftLinks[li].position.y = (leftLinks[li].userData.targetY || 0.46) + gentleHover;
				}
				for (var ri = 0; ri < rightLinks.length; ri++) {
					rightLinks[ri].position.y = (rightLinks[ri].userData.targetY || 0.46) + gentleHover;
				}
				if (centerChainGroup) {
					centerChainGroup.rotation.y = couplerPulse * 0.12;
					var baseCY = centerChainGroup.userData.targetY || 0.48;
					centerChainGroup.position.y = baseCY + gentleHover;
				}
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

		// Update Live Speedometer Gauge & 3D HUD Stars (Solo mode only; hidden in VS mode)
		if (!MultiplayerManager.isActive) {
			if (typeof SpeedometerManager !== 'undefined') {
				SpeedometerManager.updateLoop();
			}
			if (typeof Star3DManager !== 'undefined' && typeof Star3DManager.render === 'function') {
				Star3DManager.render(now, dt);
			}
		}

		// Idle title screen camera breathing to make the 3D world feel living & dynamic
		if (titleScreenEl && !titleScreenEl.classList.contains('hide') && camera) {
			camera.position.x = Math.sin(now * 0.0006) * 0.22;
			var numRows = (currentLevelData && currentLevelData.words) ? currentLevelData.words.length : (chainRowData.length || 5);
			var layout = getBoardLayout(numRows);
			var cZ = currentCenterZ || ((layout.startZ + layout.stagingZ) * 0.5);
			camera.lookAt(0, 0, cZ);
		}

		// Living 3D Scenery & Particles (drifting around and IN FRONT of tiles!)
		if (global.WordscapesScenery && typeof global.WordscapesScenery.update === 'function') {
			global.WordscapesScenery.update(dt, now);
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

		// 2. Camera (near=2.0 maximizes depth-buffer precision at board distance ~18-24 to eliminate Z-fighting)
		camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 2.0, 80);
		camera.up.set(0, 0, -1);

		// 3. Renderer (Crisp HD 2.0x DPR & hardware MSAA with transparent background)
		renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
		renderer.setClearColor(0x000000, 0);
		renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.0));
		renderer.setSize(window.innerWidth, window.innerHeight);
		renderer.shadowMap.enabled = false; // Heavy real-time shadow passes disabled
		renderer.outputEncoding = THREE.sRGBEncoding;
		// NoToneMapping prevents grey compression and preserves 100% rich, punchy color vibrancy!
		renderer.toneMapping = THREE.NoToneMapping;
		container.appendChild(renderer.domElement);

		// Apply responsive camera framing immediately
		updateCameraFraming();

		// 4. Lights - Warm Amber Ambient & Punchy Directional Sunlight for rich wooden luster
		var ambientLight = new THREE.AmbientLight(0xffeedd, 0.62);
		scene.add(ambientLight);

		var sunLight = new THREE.DirectionalLight(0xfff8ea, 1.05);
		sunLight.position.set(4, 20, 10);
		scene.add(sunLight);

		// Warm fill light for deep timber warmth
		var fillLight = new THREE.DirectionalLight(0xffd5b0, 0.38);
		fillLight.position.set(-8, 8, -6);
		scene.add(fillLight);

		// Store lights on scene for dynamic Wordscapes environment tinting
		scene.userData.lights = { ambient: ambientLight, sun: sunLight, fill: fillLight };

		// 5. Initialize Subsystems (Living Wordscapes Scenery Engine + 3D Table & Trays)
		UnlockManager.init();
		if (global.WordscapesScenery && typeof global.WordscapesScenery.init === 'function') {
			global.WordscapesScenery.init(scene, camera, renderer);
		}
		TextureManager.preloadGameSaladTiles();
		initMaterials();
		buildTableAndTrays();
		initInteraction();
		AudioManager.init();
		if (typeof SpeedometerManager !== 'undefined') {
			SpeedometerManager.init();
		}
		MultiplayerManager.init();

		var totalLevels = (window.WORD_CHAIN_LEVELS && window.WORD_CHAIN_LEVELS.length) ? window.WORD_CHAIN_LEVELS.length : 30;

		// Title Screen & Settings Bindings (Clean Minimalist Redesign)
		titleScreenEl = document.getElementById('title-screen');
		var btnTitlePlay = document.getElementById('btn-title-play');
		var btnTitleVs = document.getElementById('btn-title-vs');
		var btnTitleSettings = document.getElementById('btn-title-settings');
		var btnTitleTrophy = document.getElementById('btn-title-trophy');
		var btnSettings = document.getElementById('btn-settings');
		var btnReturnTitle = document.getElementById('btn-return-title');

		// Title Screen Word Chain Showcase System
		// Rhythmic continuous word jump and font style cycling every 2.6 seconds
		var titleShowcaseIndex = 0;
		var titleShowcaseInterval = null;

		function cycleTitleSkin(targetSkinId) {
			if (targetSkinId) {
				var idx = TILE_SKIN_ORDER.indexOf(targetSkinId);
				if (idx !== -1) titleShowcaseIndex = idx;
			} else {
				titleShowcaseIndex = (titleShowcaseIndex + 1) % TILE_SKIN_ORDER.length;
			}
			var skinId = TILE_SKIN_ORDER[titleShowcaseIndex];
			if (TextureManager && typeof TextureManager.updateTitleBoardTiles === 'function') {
				TextureManager.updateTitleBoardTiles(skinId);
			}
		}

		function startTitleShowcase() {
			stopTitleShowcase();
			if (TextureManager && typeof TextureManager.preloadTitleShowcaseImages === 'function') {
				TextureManager.preloadTitleShowcaseImages();
			}
			var cur = TextureManager.getCurrentSkin ? TextureManager.getCurrentSkin() : (currentSkinId || 'classic');
			TextureManager.updateTitleBoardTiles(cur);
			if (typeof updateStoragePreviewUI === 'function') updateStoragePreviewUI();
		}

		function stopTitleShowcase() {
			if (titleShowcaseInterval) {
				clearInterval(titleShowcaseInterval);
				titleShowcaseInterval = null;
			}
		}

		function showTitleScreen() {
			if (phraseCouplerGroup) {
				phraseCouplerGroup.visible = false;
			}
			if (activeRowIndicatorGroup) {
				activeRowIndicatorGroup.visible = false;
			}
			if (titleScreenEl) {
				titleScreenEl.classList.remove('hidden');
				titleScreenEl.classList.remove('hide');
				titleScreenEl.style.display = 'flex';
				titleScreenEl.style.pointerEvents = 'auto';
			}
			startTitleShowcase();
			if (typeof SpeedometerManager !== 'undefined') {
				SpeedometerManager.updateTitleScreenUI();
			}
			if (typeof MultiplayerManager !== 'undefined') {
				MultiplayerManager.updateProfileUI();
			}
		}

		function hideTitleScreen() {
			stopTitleShowcase();
			if (titleScreenEl) {
				titleScreenEl.classList.add('hide');
				titleScreenEl.classList.add('hidden');
				titleScreenEl.style.display = 'none';
				titleScreenEl.style.pointerEvents = 'none';
			}
			if (camera) {
				camera.position.x = 0;
			}
			updateCameraFraming();
			AudioManager.unlockAudio();
			if (typeof MultiplayerManager !== 'undefined') {
				MultiplayerManager.updateProfileUI();
			}
		}

		// Initial start of Title Screen Word Chain Showcase
		MultiplayerManager.showTitleScreenFn = showTitleScreen;
		MultiplayerManager.hideTitleScreenFn = hideTitleScreen;
		startTitleShowcase();

		// 1. SOLO PLAY Button (Touch & Click debounced)
		var lastSoloTap = 0;
		function triggerSoloPlay(e) {
			if (e) e.stopPropagation();
			var now = performance.now();
			if (now - lastSoloTap < 350) return;
			lastSoloTap = now;

			MultiplayerManager.exitVsMode();
			var resumeIdx = (typeof SpeedometerManager !== 'undefined') ? SpeedometerManager.getResumeLevelIndex() : 0;
			loadLevel(resumeIdx);
			hideTitleScreen();
			AudioManager.play('tilehit', 1.0);
			AudioManager.haptic(30);
		}

		if (btnTitlePlay) {
			btnTitlePlay.addEventListener('click', triggerSoloPlay);
			btnTitlePlay.addEventListener('touchend', function (e) {
				e.preventDefault();
				triggerSoloPlay(e);
			}, { passive: false });
		}

		// 2. VS MODE Button (Opens Avatar Selection & Opponent Matchmaking Lobby)
		var lastVsTap = 0;
		function triggerVsMode(e) {
			if (e) e.stopPropagation();
			var now = performance.now();
			if (now - lastVsTap < 350) return;
			lastVsTap = now;

			AudioManager.playSnap(1.3);
			AudioManager.haptic(25);
			MultiplayerManager.openLobby(false);
		}

		if (btnTitleVs) {
			btnTitleVs.addEventListener('click', triggerVsMode);
			btnTitleVs.addEventListener('touchend', function (e) {
				e.preventDefault();
				triggerVsMode(e);
			}, { passive: false });
		}

		// 3. Interactive Word Chain Title Board: Tap to jump tiles
		var titleGameBoard = document.getElementById('title-game-board');
		if (titleGameBoard) {
			function onTitleBoardTap(e) {
				if (e) e.stopPropagation();
				AudioManager.playSnap(1.4);
				AudioManager.haptic(25);
				var tileBoxes = titleGameBoard.querySelectorAll('.title-tile-box');
				tileBoxes.forEach(function (box) {
					box.classList.remove('hop');
					void box.offsetWidth;
					box.classList.add('hop');
				});
				var chainSvgs = titleGameBoard.querySelectorAll('.title-chain-svg');
				chainSvgs.forEach(function (csv) {
					csv.classList.remove('jingle');
					void csv.offsetWidth;
					csv.classList.add('jingle');
				});
			}
			titleGameBoard.addEventListener('click', onTitleBoardTap);
			titleGameBoard.addEventListener('touchend', function (e) {
				e.preventDefault();
				onTitleBoardTap(e);
			}, { passive: false });
		}

		// 4. Bottom Footer Navigation: Settings on left, Trophy on right
		var lastSettingsTap = 0;
		function triggerSettings(e) {
			if (e) e.stopPropagation();
			var now = performance.now();
			if (now - lastSettingsTap < 350) return;
			lastSettingsTap = now;
			showThemeModal();
			AudioManager.play('tilehit', 0.9);
			AudioManager.haptic(20);
		}
		if (btnTitleSettings) {
			btnTitleSettings.addEventListener('click', triggerSettings);
			btnTitleSettings.addEventListener('touchend', function (e) {
				e.preventDefault();
				triggerSettings(e);
			}, { passive: false });
		}

		var lastTrophyTap = 0;
		function triggerTrophy(e) {
			if (e) e.stopPropagation();
			var now = performance.now();
			if (now - lastTrophyTap < 350) return;
			lastTrophyTap = now;
			showLevelSelectModal();
			AudioManager.play('tilehit', 0.9);
			AudioManager.haptic(20);
		}
		if (btnTitleTrophy) {
			btnTitleTrophy.addEventListener('click', triggerTrophy);
			btnTitleTrophy.addEventListener('touchend', function (e) {
				e.preventDefault();
				triggerTrophy(e);
			}, { passive: false });
		}
		if (btnSettings) {
			btnSettings.addEventListener('click', function () {
				showThemeModal();
			});
		}
		if (btnReturnTitle) {
			btnReturnTitle.addEventListener('click', function () {
				MultiplayerManager.exitVsMode();
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

		// Initialize Fancy Felt-Floored Cubby Storage System & Store
		renderStorageCubbies();
		updateStoragePreviewUI();

		// Title Screen & Settings Storage Entrance Triggers
		var lastStorageTap = 0;
		function triggerTileStorage(e) {
			if (e) {
				e.stopPropagation();
				if (e.cancelable && e.type === 'touchend') e.preventDefault();
			}
			var now = performance.now();
			if (now - lastStorageTap < 350) return;
			lastStorageTap = now;
			openTileStorageModal();
		}

		var btnTitleStorageBar = document.getElementById('btn-title-storage-bar');
		if (btnTitleStorageBar) {
			btnTitleStorageBar.addEventListener('click', triggerTileStorage);
			btnTitleStorageBar.addEventListener('touchend', triggerTileStorage, { passive: false });
		}

		// Title Screen Footer Storage Icon
		var btnTitleStorageIcon = document.getElementById('btn-title-storage-icon');
		if (btnTitleStorageIcon) {
			btnTitleStorageIcon.addEventListener('click', triggerTileStorage);
			btnTitleStorageIcon.addEventListener('touchend', triggerTileStorage, { passive: false });
		}

		// Settings Modal Storage Portal Button
		var btnSettingsOpenStorage = document.getElementById('btn-settings-open-storage');
		if (btnSettingsOpenStorage) {
			btnSettingsOpenStorage.addEventListener('click', triggerTileStorage);
			btnSettingsOpenStorage.addEventListener('touchend', triggerTileStorage, { passive: false });
		}

		// Storage Cabinet Close Button & Backdrop Dismiss
		var btnStorageClose = document.getElementById('btn-storage-close');
		if (btnStorageClose) {
			btnStorageClose.addEventListener('click', function (e) {
				if (e) e.stopPropagation();
				closeTileStorageModal();
			});
			btnStorageClose.addEventListener('touchend', function (e) {
				if (e) {
					e.stopPropagation();
					if (e.cancelable) e.preventDefault();
				}
				closeTileStorageModal();
			}, { passive: false });
		}

		var tileStorageModalEl = document.getElementById('tile-storage-modal');
		if (tileStorageModalEl) {
			tileStorageModalEl.addEventListener('click', function (e) {
				if (e.target === tileStorageModalEl) {
					closeTileStorageModal();
				}
			});
		}

		// Living Scenery option buttons (Instantly switch and equip)
		document.querySelectorAll('.scenery-opt').forEach(function (btn) {
			btn.addEventListener('click', function () {
				var scId = this.getAttribute('data-scenery');
				if (!scId || !global.WordscapesScenery) return;

				try {
					localStorage.setItem('word_chain_scenery_user_selected', 'true');
					localStorage.setItem('word_chain_scenery', scId);
				} catch (e) {}

				global.WordscapesScenery.setScenery(scId);
				updateThemeModalUI();
				AudioManager.play('tilehit', 0.9);
				AudioManager.haptic(20);

				var scs = (global.WordscapesScenery.getSceneries) ? global.WordscapesScenery.getSceneries() : {};
				var scName = (scs[scId] && scs[scId].name) ? scs[scId].name : 'Living Scenery';
				showToast('Equipped ' + scName);
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
			btnFloatingNext.addEventListener('click', function (e) {
				if (e) e.stopPropagation();
				AudioManager.play('tilehit', 1.0);
				AudioManager.haptic(35);
				stopWinCelebration();
				if (MultiplayerManager.isActive) {
					MultiplayerManager.onPostMatchNext();
				} else {
					loadLevel(currentLevelIndex + 1);
				}
			});
		}

		// Tap anywhere during Solo win celebration (once congratulatory trays have landed) to advance level.
		// Disabled in VS Mode so players never accidentally skip Match Results into another PvP match!
		window.addEventListener('click', function (e) {
			if (MultiplayerManager.isActive) return;
			if (isCelebratingWin && winCelebrationState && winCelebrationState.victoryLanded) {
				if (e.target && e.target.closest && e.target.closest('#btn-open-settings, .btn-settings, #btn-settings, #hud-bottom, #theme-modal, #settings-modal, #level-select-modal, #vs-lobby-modal, #vs-results-modal')) {
					return;
				}
				AudioManager.play('tilehit', 1.0);
				AudioManager.haptic(35);
				stopWinCelebration();
				loadLevel(currentLevelIndex + 1);
			}
		}, true);

		// Win Celebration Replay Buttons
		var btnWinReplay = document.getElementById('btn-win-replay');
		if (btnWinReplay) {
			btnWinReplay.addEventListener('click', function () {
				AudioManager.play('tilehit', 1.0);
				AudioManager.haptic(35);
				stopWinCelebration();
				loadLevel(currentLevelIndex);
			});
		}

		var btnWinReplayCard = document.getElementById('btn-win-replay-card');
		if (btnWinReplayCard) {
			btnWinReplayCard.addEventListener('click', function () {
				AudioManager.play('tilehit', 1.0);
				AudioManager.haptic(35);
				stopWinCelebration();
				loadLevel(currentLevelIndex);
			});
		}

		// Level Select Modal Bindings
		var btnLevelSelectClose = document.getElementById('btn-level-select-close');
		if (btnLevelSelectClose) btnLevelSelectClose.addEventListener('click', hideLevelSelectModal);

		var hudLeftPill = document.querySelector('.hud-left-pill');
		if (hudLeftPill) {
			hudLeftPill.style.cursor = 'pointer';
			hudLeftPill.setAttribute('title', 'Tap to open Level Select & Star Progress');
			hudLeftPill.addEventListener('click', showLevelSelectModal);
		}

		var btnTitleAllLevels = document.getElementById('btn-title-all-levels');
		if (btnTitleAllLevels) btnTitleAllLevels.addEventListener('click', showLevelSelectModal);

		var btnSettingsAllLevels = document.getElementById('btn-settings-all-levels');
		if (btnSettingsAllLevels) btnSettingsAllLevels.addEventListener('click', function () {
			hideThemeModal();
			showLevelSelectModal();
		});

		var btnWinLevels = document.getElementById('btn-win-levels');
		if (btnWinLevels) {
			btnWinLevels.addEventListener('click', function () {
				stopWinCelebration();
				showLevelSelectModal();
			});
		}

		var btnWinNext = document.getElementById('btn-win-next');
		if (btnWinNext) {
			btnWinNext.addEventListener('click', function () {
				AudioManager.play('tilehit', 1.0);
				AudioManager.haptic(35);
				stopWinCelebration();
				loadLevel(currentLevelIndex + 1);
			});
		}

		// Title Screen Speed Ranking Card click -> open level select
		var titleRankCard = document.getElementById('title-speed-rank-card');
		if (titleRankCard) {
			titleRankCard.style.cursor = 'pointer';
			titleRankCard.addEventListener('click', function () {
				showLevelSelectModal();
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

		// Camera Perspective View Mode Bindings (3D Incline vs Classic)
		var btnToggleCam = document.getElementById('btn-toggle-cam');
		if (btnToggleCam) {
			btnToggleCam.addEventListener('click', function () {
				togglePerspectiveMode();
			});
		}

		var optCamIncline = document.getElementById('opt-cam-incline');
		if (optCamIncline) {
			optCamIncline.addEventListener('click', function () {
				applyPerspectiveMode('incline');
				AudioManager.play('tilehit', 0.9);
				AudioManager.haptic(20);
				showToast('🎸 3D Incline Highway View');
			});
		}

		var optCamClassic = document.getElementById('opt-cam-classic');
		if (optCamClassic) {
			optCamClassic.addEventListener('click', function () {
				applyPerspectiveMode('classic');
				AudioManager.play('tilehit', 0.9);
				AudioManager.haptic(20);
				showToast('📐 Classic View');
			});
		}

		updatePerspectiveModeUI();

		window.addEventListener('resize', onWindowResize);

		// Expose public API for controls and automation testing
		global.TextureManager = TextureManager;
		global.WordChain3D = {
			loadLevel: loadLevel,
			showLevelSelect: showLevelSelectModal,
			shuffle: shuffleStaging,
			recall: recallActiveRow,
			hint: provideHint,
			togglePerspective: togglePerspectiveMode,
			setPerspective: applyPerspectiveMode,
			getPerspective: function () { return perspectiveMode; },
			celebrateWin: triggerWinCelebration,
			stopCelebration: stopWinCelebration,
			showThemeModal: showThemeModal,
			hideThemeModal: hideThemeModal,
			showTitle: showTitleScreen,
			hideTitle: hideTitleScreen,
			isChainVisible: function () { return !!(phraseCouplerGroup && phraseCouplerGroup.visible); },
			isGameActive: isGamePlayActive,
			checkWord: checkWordCompletion,
			getLevelEntrance: function () { return levelEntranceState; },
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
			getTrayTheme: function () {
				var curSkin = TILE_SKINS[TextureManager.getCurrentSkin ? TextureManager.getCurrentSkin() : 'classic'];
				return (curSkin && curSkin.tone === 'dark') ? 'light' : 'dark';
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
				var curSkin = TILE_SKINS[TextureManager.getCurrentSkin ? TextureManager.getCurrentSkin() : 'classic'];
				var trayThemeName = (curSkin && curSkin.tone === 'dark') ? 'light' : 'dark';
				return {
					level: currentLevelIndex + 1,
					activeRow: currentWordIndex + 1,
					currentWordIndex: currentWordIndex,
					currentWordAnswer: (currentLevelData && currentLevelData.words && currentLevelData.words[currentWordIndex]) ? currentLevelData.words[currentWordIndex].answer : null,
					totalRows: currentLevelData ? currentLevelData.words.length : 0,
					skin: TextureManager.getCurrentSkin ? TextureManager.getCurrentSkin() : 'classic',
					tileTone: curSkin ? curSkin.tone : 'light',
					trayTheme: trayThemeName,
					scenery: (global.WordscapesScenery && global.WordscapesScenery.getCurrent) ? global.WordscapesScenery.getCurrent() : null,
					stagingTiles: stagingSlots.map(function (s) { return s.tile ? s.tile.letter : null; }),
					activeRowTiles: chainSlots.filter(function (s) { return s.row === currentWordIndex; }).map(function (s) { return s.tile ? s.tile.letter : null; }),
					audio: {
						enabled: AudioManager.enabled,
						hasMusic: !!AudioManager.musicTrack,
						musicSrc: AudioManager.musicTrack ? AudioManager.musicTrack.src : null
					},
					materials: {
						trayTheme: trayThemeName,
						feltColorHex: (materials.slotFelt && materials.slotFelt.color) ? ('#' + materials.slotFelt.color.getHexString()) : null,
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

		// 7. Load Level (supports ?level=X query parameter or automatic smart resume for returning players!)
		var urlParams = new URLSearchParams(window.location.search);
		var startLvl = parseInt(urlParams.get('level'), 10);
		var resumeLvl = (typeof SpeedometerManager !== 'undefined') ? SpeedometerManager.getResumeLevelIndex() : 0;
		var initialLevel = (!isNaN(startLvl) && startLvl > 0) ? (startLvl - 1) : resumeLvl;
		loadLevel(initialLevel);

		var shouldStartPlaying = (urlParams.get('autostart') === '1' || urlParams.get('play') === '1' || urlParams.get('hint') === '1' || urlParams.get('win') === '1' || urlParams.get('vsplay') === '1' || urlParams.get('vsresults') === '1' || urlParams.get('gift') === '1' || urlParams.get('ad') === '1' || urlParams.get('settings') === '1' || urlParams.get('trialend') === '1');

		if (shouldStartPlaying) {
			hideTitleScreen();
		} else {
			showTitleScreen();
		}

		if (urlParams.get('hint') === '1') {
			setTimeout(function () {
				provideHint();
			}, 300);
		}
		if (urlParams.get('win') === '1') {
			setTimeout(function () {
				triggerWinCelebration();
			}, 300);
		}
		if (urlParams.get('gift') === '1') {
			setTimeout(function () {
				showGiftUnlockModal(UnlockManager.getRewardForLevelRow(0, 2) || UnlockManager.makeSkinReward('set0'));
			}, 300);
		}
		if (urlParams.get('ad') === '1') {
			setTimeout(function () {
				AdMobRewardService.showRewardAd({ type: 'skin', id: 'set0', name: TILE_SKINS.set0.name });
			}, 300);
		}
		if (urlParams.get('settings') === '1') {
			setTimeout(function () {
				showThemeModal();
			}, 300);
		}
		if (urlParams.get('trialend') === '1') {
			setTimeout(function () {
				UnlockManager.activeTrial = { type: 'skin', id: 'set0', roundLevel: 999 };
				UnlockManager.checkTrialExpiration(0);
			}, 300);
		}

		var inviteRoomCode = urlParams.get('room');
		if (inviteRoomCode) {
			setTimeout(function () {
				MultiplayerManager.openLobby(false, inviteRoomCode);
			}, 250);
		} else if (urlParams.get('vs') === '1') {
			setTimeout(function () {
				MultiplayerManager.openLobby(false);
			}, 250);
		} else if (urlParams.get('vsplay') === '1') {
			setTimeout(function () {
				document.body.classList.add('vs-mode-active');
				MultiplayerManager.isActive = true;
				MultiplayerManager.mySlot = 'p1';
				MultiplayerManager.matchMode = 'pvp';
				MultiplayerManager.playerUsername = 'Uptimistik';
				MultiplayerManager.opponentUsername = 'Marcus';
				MultiplayerManager.playerAvatar = 'Character_8.png';
				MultiplayerManager.opponentAvatar = 'Character_9.png';
				MultiplayerManager.firstSolverByRow = { 1: 'p1', 2: 'p2' };
				MultiplayerManager.applyRowClaimMaterial(1);
				MultiplayerManager.applyRowClaimMaterial(2);
				var hudP1Img = document.getElementById('vs-p1-avatar');
				var hudP2Img = document.getElementById('vs-p2-avatar');
				var hudP1Wpm = document.getElementById('vs-p1-wpm');
				var hudP2Wpm = document.getElementById('vs-p2-wpm');
				var hudP1Name = document.getElementById('vs-p1-name');
				var hudP2Name = document.getElementById('vs-p2-name');
				if (hudP1Img) hudP1Img.src = MultiplayerManager.getAvatarPath('Character_8.png');
				if (hudP2Img) hudP2Img.src = MultiplayerManager.getAvatarPath('Character_9.png');
				if (hudP1Wpm) hudP1Wpm.textContent = '18WPM';
				if (hudP2Wpm) hudP2Wpm.textContent = '16WPM';
				if (hudP1Name) hudP1Name.textContent = 'Uptimistik';
				if (hudP2Name) hudP2Name.textContent = 'Marcus';
				MultiplayerManager.p1MatchCrowns = 5;
				MultiplayerManager.p2MatchCrowns = 4;
				var p1CrownsEl = document.getElementById('vs-p1-crowns');
				var p2CrownsEl = document.getElementById('vs-p2-crowns');
				if (p1CrownsEl) p1CrownsEl.textContent = '👑 5';
				if (p2CrownsEl) p2CrownsEl.textContent = '👑 4';
				updateOpponentBeaconAppearance(MultiplayerManager.opponentAvatar, MultiplayerManager.opponentUsername);
				setOpponentActiveRow(1, false);
				updateCameraFraming();
			}, 300);
		} else if (urlParams.get('vsresults') === '1') {
			setTimeout(function () {
				var ts = document.getElementById('title-screen');
				if (ts) {
					ts.classList.add('hidden');
					ts.style.display = 'none';
				}
				document.body.classList.remove('title-screen-active');
				document.body.classList.add('vs-mode-active');
				MultiplayerManager.isActive = true;
				MultiplayerManager.mySlot = 'p1';
				MultiplayerManager.matchMode = 'pvp';
				MultiplayerManager.winner = 'p1';
				MultiplayerManager.playerUsername = 'Uptimistik';
				MultiplayerManager.opponentUsername = 'Marcus';
				MultiplayerManager.playerAvatar = 'Character_8.png';
				MultiplayerManager.opponentAvatar = 'Character_9.png';
				MultiplayerManager.firstSolverByRow = { 1: 'p1', 2: 'p2', 3: 'p1', 4: 'p1' };
				var totalRows = (currentLevelData && currentLevelData.words) ? (currentLevelData.words.length - 1) : 4;
				for (var r = 1; r <= totalRows; r++) {
					if (!MultiplayerManager.firstSolverByRow[r]) {
						MultiplayerManager.firstSolverByRow[r] = (r % 2 === 0) ? 'p2' : 'p1';
					}
					MultiplayerManager.applyRowClaimMaterial(r);
				}
				var hudP1Img = document.getElementById('vs-p1-avatar');
				var hudP2Img = document.getElementById('vs-p2-avatar');
				var hudP1Wpm = document.getElementById('vs-p1-wpm');
				var hudP2Wpm = document.getElementById('vs-p2-wpm');
				var hudP1Name = document.getElementById('vs-p1-name');
				var hudP2Name = document.getElementById('vs-p2-name');
				var p1Crown = document.getElementById('vs-p1-crown');
				if (hudP1Img) hudP1Img.src = MultiplayerManager.getAvatarPath('Character_8.png');
				if (hudP2Img) hudP2Img.src = MultiplayerManager.getAvatarPath('Character_9.png');
				if (hudP1Wpm) hudP1Wpm.textContent = '19WPM';
				if (hudP2Wpm) hudP2Wpm.textContent = '17WPM';
				if (hudP1Name) hudP1Name.textContent = 'Uptimistik';
				if (hudP2Name) hudP2Name.textContent = 'Marcus';
				if (p1Crown) p1Crown.classList.add('show');
				MultiplayerManager.p1MatchCrowns = 14;
				MultiplayerManager.p2MatchCrowns = 4;
				MultiplayerManager.lastEarnedCrowns = 14;
				var p1CrownsEl = document.getElementById('vs-p1-crowns');
				var p2CrownsEl = document.getElementById('vs-p2-crowns');
				if (p1CrownsEl) p1CrownsEl.textContent = '👑 14';
				if (p2CrownsEl) p2CrownsEl.textContent = '👑 4';
				MultiplayerManager.lastMatchSummary = {
					winnerSlot: 'p1',
					matchType: 'pvp',
					totalRows: totalRows,
					p1Username: 'Uptimistik',
					p2Username: 'Marcus',
					p1Wpm: 19,
					p2Wpm: 17,
					p1Rows: totalRows,
					p2Rows: Math.max(1, totalRows - 1),
					p1FinishMs: 18400,
					p2FinishMs: null,
					canRematch: false
				};
				triggerWinCelebration();
				MultiplayerManager.showMatchResults();
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

	// Global export for native WebView bridges (Android & iOS background lifecycle hooks)
	MultiplayerManager.setOpponentActiveRow = setOpponentActiveRow;
	MultiplayerManager.updateOpponentBeaconAppearance = updateOpponentBeaconAppearance;
	global.AudioManager = AudioManager;
	global.MultiplayerManager = MultiplayerManager;

})(window);

