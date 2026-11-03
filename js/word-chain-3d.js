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
				thud: 'game/default/sounds/thud.ogg',
				bell: 'game/default/sounds/freesound_community-bell-98033.ogg'
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
			ctx.font = '900 132px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';
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

			var size = 256;
			var canvas = document.createElement('canvas');
			canvas.width = size;
			canvas.height = size;
			this.renderLetterOnCanvas(letter, canvas, sid);

			var texture = new THREE.CanvasTexture(canvas);
			texture.encoding = THREE.sRGBEncoding;
			if (renderer && renderer.capabilities) {
				texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
			}
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
					var tex = this.getLetterTexture(t.letter);
					t.mesh.material[2].map = tex;
					t.mesh.material[2].emissiveMap = tex;
					t.mesh.material[2].needsUpdate = true;
				}
			}
		},

		preloadTitleShowcaseImages: function () {
			var self = this;
			var letters = ['W', 'O', 'R', 'D', 'C', 'H', 'A', 'I', 'N'];
			for (var i = 0; i < TILE_SKIN_ORDER.length; i++) {
				var sid = TILE_SKIN_ORDER[i];
				for (var j = 0; j < letters.length; j++) {
					(function (s, c) {
						var key = s + ':' + c;
						if (self.tileImages[key]) return;
						var img = new Image();
						self.tileImages[key] = img;
						img.src = getTileImageUrl(s, c);
					})(sid, letters[j]);
				}
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

		// Cached procedural textures and color tokens for dark vs. light tray themes
		getTrayThemeTextures: function (theme) {
			if (!this.trayThemeTextures) this.trayThemeTextures = {};
			if (this.trayThemeTextures[theme]) return this.trayThemeTextures[theme];

			if (theme === 'light') {
				// LIGHT TRAYS & LETTER HOLDERS (Never white! Lighter shade of warm golden honey-oak / cedar wood with rich visible grain texture)
				this.trayThemeTextures.light = {
					rackWood: this.getHardwoodTexture('#8e5b32', '#4e2c14', '#ad7340'),
					activeWood: this.getHardwoodTexture('#9f6738', '#5a3318', '#bc8048'),
					solvedWood: this.getHardwoodTexture('#82522c', '#482610', '#9e6534'),
					dimmedWood: this.getHardwoodTexture('#764926', '#3e1e0c', '#8e552a'),
					greenWood: this.getHardwoodTexture('#684122', '#3a200e', '#825028'),
					feltColor: 0x3c2414,
					activeEmissive: 0x381e08,
					activeEmissiveIntensity: 0.35,
					chevronColor: 0xf59e0b,
					chevronEmissive: 0x78350f,
					bracketVariant: 'lightTray',
					rackRoughness: 0.70,
					activeRoughness: 0.62,
					solvedRoughness: 0.72,
					dimmedRoughness: 0.76,
					greenRoughness: 0.70
				};
			} else {
				// DARK TRAYS & LETTER HOLDERS (Paired with light tiles)
				// Rich dark roasted walnut / espresso racks, dark evergreen pine staging tray, charcoal felt, gold brackets
				this.trayThemeTextures.dark = {
					rackWood: this.getHardwoodTexture('#2c1b10', '#150c07', '#462c1c'),
					activeWood: this.getHardwoodTexture('#3e2213', '#1e0f07', '#5d351e'),
					solvedWood: this.getHardwoodTexture('#26170e', '#120a05', '#3e2617'),
					dimmedWood: this.getHardwoodTexture('#18100a', '#0b0704', '#261b11'),
					greenWood: this.getHardwoodTexture('#192b1d', '#0c160e', '#2b4731'),
					feltColor: 0x14100c,
					activeEmissive: 0x381705,
					activeEmissiveIntensity: 0.40,
					chevronColor: 0xf59e0b,
					chevronEmissive: 0x78350f,
					bracketVariant: 'darkTray',
					rackRoughness: 0.76,
					activeRoughness: 0.68,
					solvedRoughness: 0.78,
					dimmedRoughness: 0.82,
					greenRoughness: 0.76
				};
			}
			return this.trayThemeTextures[theme];
		},

		// Dynamically switch trays and letter holders to maintain optimal contrast with current tiles:
		// Light tiles -> Dark trays & letter holders
		// Dark tiles  -> Light trays & letter holders
		updateTrayTheme: function (skinId) {
			var skin = TILE_SKINS[skinId] || TILE_SKINS[currentSkinId] || TILE_SKINS.classic;
			var isLightTile = (skin.tone !== 'dark');
			var themeName = isLightTile ? 'dark' : 'light';
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

			// Immediately refresh rack and lip material assignments across all rows
			if (typeof updateActiveRowVisuals === 'function') {
				try {
					updateActiveRowVisuals();
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

	// --------------------------------------------------------------------------
	// Customization Unlocks, Gift Box Progression & Reward Ads
	// --------------------------------------------------------------------------
	var UnlockManager = {
		ownedSkins: ['classic'],
		ownedSceneries: ['sakura'],
		activeTrial: null, // { type: 'skin'|'scenery', id: string, roundLevel: number }
		lastGiftReceivedLevel: null,
		levelsSinceLastGift: 0,
		lastGiftType: 'skin',

		init: function () {
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
			if (this.ownedSceneries.indexOf('sakura') === -1) {
				this.ownedSceneries.push('sakura');
			}

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
		modal.classList.add('show');
		AudioManager.play('tilehit', 0.9);
		AudioManager.haptic(20);
	}

	function closeTileStorageModal() {
		var modal = document.getElementById('tile-storage-modal');
		if (!modal) return;
		modal.classList.remove('show');
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
			if (wpm >= 28) return 3; // ⭐⭐⭐ Lightning Fast (>=28 WPM)
			if (wpm >= 15) return 2; // ⭐⭐ Swift (>=15 WPM)
			return 1;                // ⭐ Steady/Completed (<15 WPM)
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
			this.currentLevelSpeed = 0;
			this.targetSpeed = 0;
			this.displayedSpeed = 0;
			this.isLevelActive = true;
			this.updateSettingsLevelUI(levelIndex);

			var numEl = document.getElementById('speedo-number');
			if (numEl) numEl.textContent = '0';
			this.applyTierVisuals(0);

			var winCard = document.getElementById('win-speed-card');
			if (winCard) winCard.classList.remove('show');
			var celebCard = document.getElementById('win-celebration-card');
			if (celebCard) celebCard.classList.remove('show');
		},

		onTileInteraction: function () {
			if (!this.isLevelActive) return;
			var now = performance.now();
			if (now - this.lastTileSnapTime < 120) return;
			this.lastTileSnapTime = now;
			// Provide an energetic needle boost on tile snap
			this.targetSpeed = Math.min(65, this.targetSpeed + 1.6);
		},

		onWordSolved: function (wordIdx, totalWords) {
			var now = performance.now();
			this.wordsSolvedThisLevel++;

			// Instantaneous WPM for this specific word
			var wordElapsedSec = Math.max(0.4, (now - this.lastWordSolveTime) / 1000);
			var instantWpm = Math.min(80, (1 / wordElapsedSec) * 60);

			// Cumulative level WPM
			var totalElapsedSec = Math.max(0.8, (now - this.levelStartTime) / 1000);
			var cumulativeWpm = (this.wordsSolvedThisLevel / totalElapsedSec) * 60;

			this.currentLevelSpeed = Math.round(cumulativeWpm * 10) / 10;
			this.lastWordSolveTime = now;

			// Rev the needle towards whichever is faster
			this.targetSpeed = Math.min(80, Math.max(instantWpm, cumulativeWpm));

			// Visual pulse feedback on speedometer
			var hudSpeedo = document.getElementById('hud-speedometer');
			if (hudSpeedo) {
				hudSpeedo.classList.add('speedo-pulse');
				setTimeout(function () {
					hudSpeedo.classList.remove('speedo-pulse');
				}, 450);
			}
		},

		onLevelCompleted: function (levelIndex) {
			this.isLevelActive = false;
			var totalElapsedSec = Math.max(0.8, (performance.now() - this.levelStartTime) / 1000);
			var wordsCount = Math.max(1, this.wordsSolvedThisLevel || (currentLevelData ? currentLevelData.words.length : 5));
			var finalWpm = Math.round((wordsCount / totalElapsedSec) * 60 * 10) / 10;
			this.currentLevelSpeed = finalWpm;
			this.displayedSpeed = finalWpm;
			this.targetSpeed = finalWpm;

			var starsEarned = this.calculateStarsForWpm(finalWpm);
			var prevRecord = this.records.levels[levelIndex] || {};
			var prevStars = prevRecord.stars || this.calculateStarsForWpm(prevRecord.bestWpm || 0);
			var bestStars = Math.max(prevStars, starsEarned);
			var bestWpm = Math.max(prevRecord.bestWpm || 0, finalWpm);
			var isNewRecord = !prevRecord.bestWpm || finalWpm > prevRecord.bestWpm;
			this.isLastRunNewRecord = isNewRecord;

			this.records.levels[levelIndex] = {
				bestWpm: bestWpm,
				bestTimeSec: prevRecord.bestTimeSec ? Math.min(prevRecord.bestTimeSec, Math.round(totalElapsedSec * 10) / 10) : Math.round(totalElapsedSec * 10) / 10,
				stars: bestStars,
				lastWpm: finalWpm,
				lastStars: starsEarned,
				timestamp: Date.now()
			};
			this.saveRecords();

			// Show win celebration speed card
			var winCard = document.getElementById('win-speed-card');
			var valEl = document.getElementById('win-speed-val');
			var recBadge = document.getElementById('win-record-badge');
			if (valEl) valEl.textContent = finalWpm + ' WPM';
			if (recBadge) recBadge.style.display = isNewRecord ? 'inline-block' : 'none';
			if (winCard) winCard.classList.add('show');

			this.updateTitleScreenUI();
			this.updateSettingsLevelUI(levelIndex);

			return { finalWpm: finalWpm, starsEarned: starsEarned, isNewRecord: isNewRecord };
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

		cacheDOMElements: function () {
			this.numEl = document.getElementById('speedo-number');
			this.needleGroup = document.getElementById('speedo-needle-group') || document.getElementById('speedo-needle');
			this.fillEl = document.getElementById('speedo-fill');
			this.hudSpeedo = document.getElementById('hud-speedometer');
			this.auraEl = document.getElementById('speedo-magical-aura');
			this.badgeEl = document.getElementById('speedo-sub-badge');
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
			if (!this.isLevelActive) return;
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
			this.displayedSpeed += (this.targetSpeed - this.displayedSpeed) * 0.12;

			var roundedSpeed = Math.round(this.displayedSpeed);
			if (roundedSpeed !== this.lastRoundedSpeed) {
				this.lastRoundedSpeed = roundedSpeed;
				if (this.numEl) this.numEl.textContent = roundedSpeed;
			}

			// Needle angle: 0 WPM -> -90deg, 60 WPM -> +90deg
			var angle = (Math.min(60, Math.max(0, this.displayedSpeed)) / 60) * 180 - 90;

			// Dynamic mechanical vibration / jitter at high speeds
			if (this.displayedSpeed >= 25) {
				var jitterAmp = Math.min(2.2, (this.displayedSpeed - 20) * 0.07);
				angle += (Math.random() - 0.5) * jitterAmp;
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
	var celebrationParticles = []; // Confetti & Star meshes
	var confettiGroup = null;
	var activeGiftBoxes = []; // 3D Gift Box reward instances on word racks

	// Materials Cache
	var materials = {};

	function initMaterials() {
		var startSkin = TILE_SKINS[currentSkinId] || TILE_SKINS.classic;
		var isLightTile = (startSkin.tone !== 'dark');
		var themeName = isLightTile ? 'dark' : 'light';
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

		// Letter Holder Tray (Player hand / staging tray)
		materials.greenTray = new THREE.MeshStandardMaterial({
			map: trayTheme.greenWood,
			color: 0xffffff,
			roughness: trayTheme.greenRoughness,
			metalness: 0.0
		});

		// Tray slot felt lining
		materials.slotFelt = new THREE.MeshStandardMaterial({
			color: trayTheme.feltColor,
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
			map: TextureManager.getSlotBracketTexture(trayTheme.bracketVariant),
			transparent: true,
			opacity: 0.75,
			depthWrite: false
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
	// 3D Tile Class
	// --------------------------------------------------------------------------
	function Tile(letter, isLocked) {
		this.letter = letter;
		this.isLocked = !!isLocked;
		this.currentSlot = null;

		// Geometry: 1.04 x 0.28 x 1.04 with beveled box (warm, bold wooden tile)
		var geom = new THREE.BoxGeometry(1.04, 0.28, 1.04);

		// Multi-material: Top face (Index 2 in BoxGeometry is +Y face)
		// The 2D art drives the face mostly through emissiveMap so it renders at its
		// true colours; a small diffuse term keeps subtle 3D shading when tilted.
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
		stagingTrayGroup.rotation.x = 0;

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
		var localTileY = trayHeight + 0.14;

		for (var i = 0; i < slotCount; i++) {
			var sx = startX + i * slotWidth;
			var slotMesh = new THREE.Mesh(
				new THREE.PlaneGeometry(1.06, 1.06),
				materials.slotFelt
			);
			slotMesh.rotation.x = -Math.PI * 0.5;
			slotMesh.position.set(sx, trayHeight + 0.01, 0);
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

				var slotWorldPos = new THREE.Vector3(
					sx,
					rackHeight + 0.14,
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

			// 3D Gift Box Spawn: strictly 1 gift box per eligible level on row 2 (or row 1 if short level)
			var targetGiftRow = (numRows > 3) ? 2 : 1;
			if (r === targetGiftRow) {
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
					var rowY = rowInfo.rowY || 0;
					var rackTilt = rowInfo.rackTilt || 0;

					// Left chevron points right ▶
					if (chevronMesh) {
						chevronMesh.position.set(-halfW - 0.36, 0.28 + rowY, rowInfo.rz);
						chevronMesh.rotation.x = -Math.PI * 0.5 + rackTilt;
					}
					// Right chevron points left ◀
					if (chevronRightMesh) {
						chevronRightMesh.position.set(halfW + 0.36, 0.28 + rowY, rowInfo.rz);
						chevronRightMesh.rotation.x = -Math.PI * 0.5 + rackTilt;
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
	// Level Loading & Tile Placement
	// --------------------------------------------------------------------------
	function loadLevel(levelIndex) {
		stopWinCelebration();
		dismissGhostTile();
		wordsSolvedCount = 0;
		var targetIndex = levelIndex % (window.WORD_CHAIN_LEVELS ? window.WORD_CHAIN_LEVELS.length : 30);
		UnlockManager.checkTrialExpiration(targetIndex);
		currentLevelIndex = targetIndex;
		try {
			localStorage.setItem('word_chain_last_level', String(targetIndex));
		} catch (e) {}
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
						var slotTilt = (hoverSlot.type === 'chain' && chainRowData[hoverSlot.row]) ? (chainRowData[hoverSlot.row].rackTilt || 0) : 0;
						hoverSlotHighlightMesh.rotation.x = -Math.PI * 0.5 + slotTilt;
					} else if (hoverSlotHighlightMesh) {
						hoverSlotHighlightMesh.visible = false;
					}
				}
			} else {
				// Hover cursor check (desktop mouse only, skipped on mobile touch for 60FPS speed)
				if (e.pointerType !== 'touch') {
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
						tile.targetRotation.set(0, 0, 0);
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
						tile.targetRotation.set(0, 0, 0);
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
				AudioManager.playSnap(1.35);

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
		AudioManager.haptic(25);

		// 2. Tray 1 lands (0.32s) + natural pause (0.12s) = 0.44s
		setTimeout(function () {
			// Tray 2 tiles jump upwards together with natural varied heights (0.32s duration)
			tiles2.forEach(function (t, j) {
				var h = hPattern2[j % hPattern2.length];
				t.startHop(0.32, h);
			});
			AudioManager.play('tilehit', 0.85);
			AudioManager.haptic(30);

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

			// Trigger sequential winning combination upwards jump:
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
						if (typeof UnlockManager !== 'undefined' && typeof UnlockManager.onLevelCompleted === 'function') {
							UnlockManager.onLevelCompleted(currentLevelIndex);
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

	var winCelebrationTimeout = null;

	function triggerWinCelebration() {
		isCelebratingWin = true;
		dismissGhostTile();

		// Clear any pending win card timeout
		if (winCelebrationTimeout) {
			clearTimeout(winCelebrationTimeout);
			winCelebrationTimeout = null;
		}

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

		// 5. Hide duplicate floating next button to prevent UI clutter
		var btnNext = document.getElementById('btn-floating-next');
		if (btnNext) btnNext.classList.remove('show');

		// 6. Pre-render celebratory card contents so it is 100% prepared
		var celebCard = document.getElementById('win-celebration-card');
		if (celebCard && typeof SpeedometerManager !== 'undefined') {
			var celebTitleEl = document.getElementById('win-celeb-level-title');
			if (celebTitleEl) {
				celebTitleEl.textContent = 'LVL ' + (currentLevelIndex + 1) + ' • ' + getLevelName(currentLevelIndex);
			}

			var recBadge = document.getElementById('win-celeb-record-badge');
			if (recBadge) {
				var isNewRec = (typeof SpeedometerManager !== 'undefined' && SpeedometerManager.isLastRunNewRecord);
				recBadge.style.display = isNewRec ? 'inline-block' : 'none';
			}

			var rec = (SpeedometerManager.records.levels && SpeedometerManager.records.levels[currentLevelIndex]) || {};
			var stars = rec.lastStars || SpeedometerManager.calculateStarsForWpm(rec.lastWpm || rec.bestWpm || 20);
			var wpm = rec.lastWpm || rec.bestWpm || 0;

			var starsContainer = document.getElementById('win-celeb-stars');
			if (starsContainer) {
				starsContainer.innerHTML = '';
				for (var s = 1; s <= 3; s++) {
					var starEl = document.createElement('span');
					starEl.className = 'win-celeb-star' + (s <= stars ? ' earned' : ' empty');
					starEl.textContent = (s <= stars ? '⭐' : '★');
					starEl.style.animationDelay = (s * 0.18) + 's';
					starsContainer.appendChild(starEl);
				}
			}

			var wpmEl = document.getElementById('win-celeb-wpm');
			if (wpmEl) wpmEl.textContent = '⚡ ' + wpm + ' WPM';

			var tierEl = document.getElementById('win-celeb-tier');
			if (tierEl) {
				if (stars >= 3) {
					tierEl.textContent = '⭐⭐⭐ LIGHTNING FAST!';
					tierEl.style.color = '#ffd700';
				} else if (stars === 2) {
					tierEl.textContent = '⭐⭐ SWIFT SOLVER!';
					tierEl.style.color = '#38bdf8';
				} else {
					tierEl.textContent = '⭐ STEADY SOLVER!';
					tierEl.style.color = '#94a3b8';
				}
			}

			// End-of-game dialog popup appears smoothly after completion fanfare
			// so only the level report and congratulations remain
			winCelebrationTimeout = setTimeout(function () {
				if (isCelebratingWin && celebCard) {
					// Hide the 3D board, racks, tiles, and message tiles so only the level report and congratulations remain
					if (chainRacksGroup) chainRacksGroup.visible = false;
					if (stagingTrayGroup) stagingTrayGroup.visible = false;
					if (activeRowIndicatorGroup) activeRowIndicatorGroup.visible = false;
					allTiles.forEach(function (tile) {
						if (tile && tile.mesh) tile.mesh.visible = false;
					});
					chainSlots.forEach(function (s) {
						if (s.tile && s.tile.mesh) s.tile.mesh.visible = false;
					});
					victoryMessageTiles.forEach(function (t) {
						if (t && t.mesh) t.mesh.visible = false;
					});
					activeGiftBoxes.forEach(function (gb) {
						if (gb && gb.group) gb.group.visible = false;
					});

					// Hide top HUD header so screen remains clean and focused exclusively on the level report
					var hudHeader = document.getElementById('hud-header');
					if (hudHeader) hudHeader.style.display = 'none';

					celebCard.classList.add('show');
					AudioManager.play('tilehit', 0.9);
					AudioManager.haptic(30);
				}
			}, 1500);
		}
	}

	function stopWinCelebration() {
		isCelebratingWin = false;
		if (winCelebrationTimeout) {
			clearTimeout(winCelebrationTimeout);
			winCelebrationTimeout = null;
		}
		if (mexicanWaveInterval) {
			clearInterval(mexicanWaveInterval);
			mexicanWaveInterval = null;
		}

		var btnNext = document.getElementById('btn-floating-next');
		if (btnNext) btnNext.classList.remove('show');

		var celebCard = document.getElementById('win-celebration-card');
		if (celebCard) celebCard.classList.remove('show');

		var winSpeedCard = document.getElementById('win-speed-card');
		if (winSpeedCard) winSpeedCard.classList.remove('show');

		// Restore 3D board and controls for normal gameplay
		if (chainRacksGroup) chainRacksGroup.visible = true;
		if (stagingTrayGroup) stagingTrayGroup.visible = true;
		allTiles.forEach(function (tile) {
			if (tile && tile.mesh) tile.mesh.visible = true;
		});
		stagingSlots.forEach(function (s) {
			if (s.tile) s.tile.mesh.visible = true;
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
	// Responsive Camera Framing & Dynamic Full-Vertical System
	// --------------------------------------------------------------------------
	function updateCameraFraming() {
		if (!camera || !renderer) return;

		var aspect = window.innerWidth / window.innerHeight;
		camera.aspect = aspect;

		var numRows = (currentLevelData && currentLevelData.words) ? currentLevelData.words.length : (chainRowData.length || 5);
		var stagingZ = (numRows >= 8) ? 4.8 : (numRows === 7 ? 4.3 : 3.6);
		var startZ = (numRows >= 8) ? -5.8 : (numRows === 7 ? -5.0 : -4.2);
		var centerZ = (startZ + stagingZ) * 0.5 - 0.15;

		var fov = 46;
		var fovRad = THREE.MathUtils.degToRad(fov);
		var halfFovTan = Math.tan(fovRad * 0.5);

		// Board width & vertical rack span
		var reqWidth = (numRows >= 8) ? 11.2 : ((numRows === 7) ? 10.9 : 10.6);
		var reqHeight = (stagingZ - startZ) + 4.5;

		var camY_by_width = (reqWidth / aspect) / (2 * halfFovTan);
		var camY_by_height = reqHeight / (2 * halfFovTan);
		var camY = Math.max(camY_by_width, camY_by_height);

		if (perspectiveMode === 'classic') {
			camY *= 1.05;
		}

		camera.fov = fov;
		camera.up.set(0, 0, -1);
		camera.position.set(0, camY, centerZ);
		camera.lookAt(0, 0, centerZ);

		camera.updateProjectionMatrix();
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
				slot.worldPos.y = rowInfo.rackHeight + 0.14;
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

		// Idle title screen camera breathing to make the 3D world feel living & dynamic
		if (titleScreenEl && !titleScreenEl.classList.contains('hide') && camera) {
			camera.position.x = Math.sin(now * 0.0006) * 0.22;
			var numRows = (currentLevelData && currentLevelData.words) ? currentLevelData.words.length : (chainRowData.length || 5);
			var sZ = (numRows >= 8) ? 4.8 : (numRows === 7 ? 4.3 : 3.6);
			var stZ = (numRows >= 8) ? -5.8 : (numRows === 7 ? -5.0 : -4.2);
			var cZ = (stZ + sZ) * 0.5 - 0.15;
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

		// 2. Camera
		camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 0.1, 100);
		camera.up.set(0, 0, -1);

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
		}

		// Initial start of Title Screen Word Chain Showcase
		startTitleShowcase();

		// 1. SOLO PLAY Button (Touch & Click debounced)
		var lastSoloTap = 0;
		function triggerSoloPlay(e) {
			if (e) e.stopPropagation();
			var now = performance.now();
			if (now - lastSoloTap < 350) return;
			lastSoloTap = now;

			var resumeIdx = (typeof SpeedometerManager !== 'undefined') ? SpeedometerManager.getResumeLevelIndex() : 0;
			if (currentLevelIndex !== resumeIdx) {
				loadLevel(resumeIdx);
			}
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

		// 2. VS MODE Button
		var lastVsTap = 0;
		function triggerVsMode(e) {
			if (e) e.stopPropagation();
			var now = performance.now();
			if (now - lastVsTap < 350) return;
			lastVsTap = now;

			AudioManager.playSnap(1.3);
			AudioManager.haptic(25);
			showToast('⚔️ VS MODE: 2-Player Head-to-Head & AI Battles coming soon in Season 2!');
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

		// Title Screen Storage Entrance Bar
		var btnTitleStorageBar = document.getElementById('btn-title-storage-bar');
		if (btnTitleStorageBar) {
			btnTitleStorageBar.addEventListener('click', function (e) {
				e.stopPropagation();
				openTileStorageModal();
			});
		}

		// Title Screen Footer Storage Icon
		var btnTitleStorageIcon = document.getElementById('btn-title-storage-icon');
		if (btnTitleStorageIcon) {
			btnTitleStorageIcon.addEventListener('click', function (e) {
				e.stopPropagation();
				openTileStorageModal();
			});
		}

		// Settings Modal Storage Portal Button
		var btnSettingsOpenStorage = document.getElementById('btn-settings-open-storage');
		if (btnSettingsOpenStorage) {
			btnSettingsOpenStorage.addEventListener('click', function (e) {
				e.stopPropagation();
				openTileStorageModal();
			});
		}

		// Storage Cabinet Close Button
		var btnStorageClose = document.getElementById('btn-storage-close');
		if (btnStorageClose) {
			btnStorageClose.addEventListener('click', closeTileStorageModal);
		}

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

		var shouldStartPlaying = (urlParams.get('autostart') === '1' || urlParams.get('play') === '1' || urlParams.get('hint') === '1' || urlParams.get('win') === '1' || urlParams.get('gift') === '1' || urlParams.get('ad') === '1' || urlParams.get('settings') === '1' || urlParams.get('trialend') === '1');

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

