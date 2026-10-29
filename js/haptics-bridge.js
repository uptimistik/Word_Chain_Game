/*
 * Word Chain Game - Haptics Bridge
 * --------------------------------
 * Dual-mode physical haptics:
 *   1. On-Touch Tile Haptics (ALWAYS ACTIVE):
 *      Instant tactile feedback the moment the user touches any tile
 *      (Letter Tile, Fake Tile, Fake Tiles 2). Zero latency.
 *
 *   2. Tile SoundFX Haptics (CONDITIONALLY ACTIVE on Game Start & WordCompleted):
 *      - Game / Scene Start: When the game launches or a scene begins, tile soundfx
 *        vibrate during the initial tile spawn & drop intro (4.0s window).
 *      - Word Completed: When game.attributes.WordCompleted is TRUE, tile soundfx
 *        vibrate in sync with the celebratory audio cascade (2.5s window).
 *      - Normal Gameplay: Tile soundfx vibrations are completely TURNED OFF.
 *
 * NOTE: Box2D physics collisions remain disabled from haptics.
 *
 * Supported vibration channels:
 *   - iOS Core Haptics via window.webkit.messageHandlers.haptics
 *   - Android native via window.AndroidHaptics.postMessage
 *   - Web Vibration API via navigator.vibrate()
 *
 * Usage: WordChainHaptics.install() inside gse.ready(), before engine.play().
 */
(function (global) {
	'use strict';

	// Actor prototype IDs (from game/default/object.js) -> haptic family.
	var ACTOR_FAMILY = {
		id109260: 'letter',   // Letters Tiles
		id121378: 'fake',     // Fake Tile
		id186281: 'fake2'     // Row5FakeTile ("Fake Tiles 2")
	};

	// Fallback by actor name in case prototype IDs change after re-export.
	var NAME_FAMILY = {
		'Letters Tiles': 'letter',
		'Letter Tile': 'letter',
		'Fake Tile': 'fake',
		'Row5FakeTile': 'fake2',
		'Fake Tiles 2': 'fake2'
	};

	// Touch profiles: fired the instant the user's finger lands on a tile.
	var TOUCH_PROFILE = {
		letter: { i: 0.75, s: 0.65 },   // crisp, tactile tap for letters
		fake:   { i: 0.50, s: 0.45 },   // softer tap for Fake Tile
		fake2:  { i: 0.50, s: 0.50 }    // softer two-step clack for Fake Tiles 2
	};
	var TOUCH_DEDUPE_MS = 100;   // prevent double-tap within same touch gesture

	// Sound profiles for tile soundfx when WordCompleted is true:
	// i = base intensity (0..1), s = base sharpness (0..1), r = optional rumble tail.
	var SOUND_PROFILE = {
		tilehit:             { i: 0.85, s: 0.75 },
		thud:                { i: 0.95, s: 0.30 },
		dirtsound:           { i: 0.70, s: 0.20, r: { d: 0.06, i: 0.35 } },
		bookgrab:            { i: 0.75, s: 0.50, r: { d: 0.04, i: 0.25 } },
		WrongWord:           { i: 0.45, s: 0.25 },
		ceramicsound:        { i: 0.75, s: 0.70 },
		Greatjobsoundeffect: { i: 0.80, s: 0.60 }
	};
	var DEFAULT_SOUND_PROFILE = { i: 0.55, s: 0.40 };

	var WORD_COMPLETED_WINDOW_MS = 2500; // Completion sequence window (covers tile drop cascade)
	var STARTUP_WINDOW_MS = 4000;        // Startup intro window (covers game/scene boot tile drops)
	var COALESCE_MS = 16;
	var MIN_GAP_MS = 25;
	var MAX_EVENTS = 6;

	var queue = [];
	var flushTimer = null;
	var lastFire = 0;
	var installed = false;
	var lastTouch = { index: null, actor: null, time: 0 };

	var wordCompletedActive = false;
	var lastWordCompletedTime = 0;
	var startupActive = false;
	var startupTimestamp = 0;
	var lastSoundName = '';
	var lastSoundTime = 0;

	function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
	function jitter(v, amount) { return v * (1 + (Math.random() * 2 - 1) * amount); }
	function rand(lo, hi) { return lo + Math.random() * (hi - lo); }

	function safeOverride(obj, prop, newFn) {
		if (!obj) return false;
		try {
			var desc = Object.getOwnPropertyDescriptor(obj, prop);
			if (desc && !desc.configurable && !desc.writable) {
				return false;
			}
			Object.defineProperty(obj, prop, {
				value: newFn,
				writable: true,
				configurable: true,
				enumerable: desc ? desc.enumerable : false
			});
			return true;
		} catch (e) {
			try {
				obj[prop] = newFn;
				return true;
			} catch (e2) {
				return false;
			}
		}
	}

	function nativeChannel() {
		var w = global.webkit;
		if (w && w.messageHandlers && w.messageHandlers.haptics) {
			return {
				postMessage: function (msg) {
					w.messageHandlers.haptics.postMessage(msg);
				}
			};
		}
		if (global.AndroidHaptics && typeof global.AndroidHaptics.postMessage === 'function') {
			return {
				postMessage: function (msg) {
					global.AndroidHaptics.postMessage(typeof msg === 'string' ? msg : JSON.stringify(msg));
				}
			};
		}
		return null;
	}

	function familyFor(actor) {
		if (!actor) { return null; }
		var protoId = actor._prototypeID || actor.prototypeID || actor._objectKey;
		if (protoId && ACTOR_FAMILY[protoId]) {
			return ACTOR_FAMILY[protoId];
		}
		try {
			var name = actor.attributes && actor.attributes.name && actor.attributes.name.getValue();
			if (name) {
				if (NAME_FAMILY[name]) return NAME_FAMILY[name];
				if (name.indexOf('Fake') !== -1 || name.indexOf('fake') !== -1) return 'fake';
				if (name.indexOf('Letter') !== -1 || name.indexOf('letter') !== -1) return 'letter';
			}
		} catch (e) {}
		return null;
	}

	function actorNumber(actor, attrId) {
		if (!actor || !actor.attributes || !actor.attributes[attrId]) return 0;
		try {
			return Number(actor.attributes[attrId].getValue()) || 0;
		} catch (e) {
			return 0;
		}
	}

	function onWordCompletedTriggered() {
		wordCompletedActive = true;
		lastWordCompletedTime = Date.now();
		if (WordChainHaptics.debug && global.console) {
			console.log('[WordChainHaptics] WordCompleted is TRUE -> Tile soundfx haptics ACTIVE.');
		}
	}

	function resetWordCompleted() {
		wordCompletedActive = false;
		lastWordCompletedTime = 0;
		if (WordChainHaptics.debug && global.console) {
			console.log('[WordChainHaptics] WordCompleted reset -> Tile soundfx haptics OFF.');
		}
	}

	function triggerStartupWindow(durationMs) {
		var dur = durationMs || STARTUP_WINDOW_MS;
		startupActive = true;
		startupTimestamp = Date.now();
		if (WordChainHaptics.debug && global.console) {
			console.log('[WordChainHaptics] Startup window ACTIVE for ' + dur + 'ms (Game start / scene boot).');
		}
	}

	function resetStartupWindow() {
		startupActive = false;
		startupTimestamp = 0;
		if (WordChainHaptics.debug && global.console) {
			console.log('[WordChainHaptics] Startup window reset -> OFF.');
		}
	}

	function isStartupActive() {
		if (startupActive && (Date.now() - startupTimestamp < STARTUP_WINDOW_MS)) {
			return true;
		}
		startupActive = false;
		return false;
	}

	function isWordCompleted() {
		try {
			var gs = global.gs;
			var game = gs && gs.Game && (gs.Game.current || gs.Game.instance);
			if (game && game.attributes) {
				var attr = game.attributes.id192539 || game.attributes.WordCompleted;
				if (attr) {
					var v = typeof attr.getValue === 'function' ? attr.getValue() : attr._value;
					if (v === true || v === 1 || v === 'true') {
						onWordCompletedTriggered();
						return true;
					}
				}
			}
		} catch (e) {}

		// Active during the completion cascade window (2.5 seconds)
		if (wordCompletedActive && (Date.now() - lastWordCompletedTime < WORD_COMPLETED_WINDOW_MS)) {
			return true;
		}

		wordCompletedActive = false;
		return false;
	}

	function isSoundFXVibrationActive() {
		return isWordCompleted() || isStartupActive();
	}

	/*
	 * Build haptic events for a finger landing on a tile (On-Touch).
	 */
	function buildTouchEvents(family, actor) {
		var p = TOUCH_PROFILE[family];
		var events = [];
		if (!p) { return events; }

		if (family === 'letter') {
			events.push({
				t: 0,
				i: clamp(jitter(p.i, 0.05), 0.30, 1.0),
				s: clamp(jitter(p.s, 0.06), 0.10, 1.0)
			});
		} else if (family === 'fake') {
			var row = actorNumber(actor, 'id191767'); // RowOffset
			var rowBoost = clamp(1.05 - row * 0.05, 0.80, 1.05);
			events.push({
				t: 0,
				i: clamp(jitter(p.i * rowBoost, 0.08), 0.15, 0.65),
				s: clamp(jitter(p.s, 0.10), 0.10, 0.80)
			});
		} else if (family === 'fake2') {
			var first = clamp(jitter(p.i, 0.08), 0.15, 0.65);
			events.push({
				t: 0,
				i: first,
				s: clamp(jitter(p.s, 0.10), 0.10, 0.85)
			});
			events.push({
				t: rand(0.035, 0.050),
				i: clamp(first * rand(0.40, 0.55), 0.10, 0.45),
				s: clamp(p.s + 0.15, 0.10, 0.90)
			});
		}
		return events;
	}

	/*
	 * Build haptic events for tile soundfx (Active ONLY when WordCompleted === true).
	 */
	function buildSoundEvents(family, sound, volume, pitch, actor) {
		var p = SOUND_PROFILE[sound] || DEFAULT_SOUND_PROFILE;
		var vol = clamp(volume !== undefined ? volume : 1, 0.3, 1.0);
		var sharpShift = clamp(((pitch !== undefined ? pitch : 1) - 0.95) * 1.2, -0.2, 0.2);
		var events = [];

		if (family === 'fake') {
			var row = actorNumber(actor, 'id191767'); // RowOffset
			var rowBoost = clamp(1.05 - row * 0.05, 0.80, 1.05);
			var fakeIntensity = clamp(jitter(p.i * 0.58 * vol * rowBoost, 0.10), 0.15, 0.65);
			var fakeSharpness = clamp(jitter(p.s * 0.85 + sharpShift, 0.12), 0.05, 0.85);
			events.push({ t: 0, i: fakeIntensity, s: fakeSharpness });
		} else if (family === 'fake2') {
			var first = clamp(jitter(p.i * 0.60 * vol, 0.10), 0.15, 0.65);
			var gap = rand(0.035, 0.055);
			events.push({ t: 0, i: first, s: clamp(jitter(p.s * 0.85 + sharpShift, 0.12), 0.05, 0.85) });
			events.push({ t: gap, i: clamp(first * rand(0.40, 0.55), 0.08, 0.45), s: clamp(p.s * 0.85 + 0.15, 0.05, 0.90) });
		} else {
			var i = clamp(jitter(p.i * vol * 0.90, 0.10), 0.25, 1.0);
			var s = clamp(jitter(p.s + sharpShift, 0.12), 0.10, 1.0);
			events.push({ t: 0, i: i, s: s });
			if (p.r) {
				events.push({ t: 0.004, i: clamp(p.r.i, 0.05, 1.0), s: 0.05, d: p.r.d });
			}
		}
		return events;
	}

	function flush() {
		flushTimer = null;
		if (!queue.length) { return; }
		var now = Date.now();
		var batch = queue;
		queue = [];

		var events = [];
		var stagger = 0;
		for (var b = 0; b < batch.length && events.length < MAX_EVENTS; b++) {
			var evs = batch[b];
			for (var e = 0; e < evs.length && events.length < MAX_EVENTS; e++) {
				var ev = evs[e];
				events.push({ t: ev.t + stagger, i: ev.i, s: ev.s, d: ev.d || 0 });
			}
			stagger += rand(0.012, 0.020);
		}

		if (now - lastFire < MIN_GAP_MS) {
			queue = [events];
			flushTimer = setTimeout(flush, MIN_GAP_MS - (now - lastFire));
			return;
		}
		lastFire = now;
		send(events);
	}

	function send(events) {
		lastFire = Date.now();
		if (WordChainHaptics.debug && global.console) {
			console.log('[WordChainHaptics] Sending haptic:', JSON.stringify(events));
		}
		var channel = nativeChannel();
		if (channel) {
			try {
				channel.postMessage({ type: 'pattern', events: events });
			} catch (e) {}
			return;
		}
		// Web Vibration API fallback (Android Chrome, mobile Firefox, etc.)
		if (global.navigator && typeof global.navigator.vibrate === 'function') {
			var pattern = [];
			var cursor = 0;
			for (var i = 0; i < events.length; i++) {
				var startMs = Math.round(events[i].t * 1000);
				var dur = Math.round(15 + events[i].i * 25 + (events[i].d || 0) * 1000);
				if (pattern.length) {
					pattern.push(Math.max(0, startMs - cursor));
				}
				pattern.push(dur);
				cursor = startMs + dur;
			}
			try {
				global.navigator.vibrate(pattern);
			} catch (e) {}
		}
	}

	// Fired the instant a finger lands on a tile.
	function onTouch(family, actor, index) {
		var now = Date.now();
		if (lastTouch.actor === actor && lastTouch.index === index && (now - lastTouch.time) < TOUCH_DEDUPE_MS) {
			return;
		}
		lastTouch.index = index;
		lastTouch.actor = actor;
		lastTouch.time = now;

		var events = buildTouchEvents(family, actor);
		if (!events.length) { return; }

		send(events);
	}

	// Fired when a tile soundfx plays while WordCompleted === true.
	function onTileSoundFX(family, sound, volume, pitch, actor) {
		var events = buildSoundEvents(family, sound, volume, pitch, actor);
		if (!events.length) { return; }
		var now = Date.now();
		if (now - lastFire >= MIN_GAP_MS && !queue.length && !flushTimer) {
			lastFire = now;
			send(events);
			return;
		}
		queue.push(events);
		if (!flushTimer) {
			flushTimer = setTimeout(flush, Math.max(10, MIN_GAP_MS - (now - lastFire)));
		}
	}

	// 1. Hook TouchPredicate: haptic fires ONLY when the user touches a tile
	function hookTouchPredicate() {
		var gs = global.gs;
		var TP = gs && gs.TouchPredicate;
		if (!TP) { return false; }
		var targets = [TP];
		if (TP.prototype && TP.prototype !== TP) { targets.push(TP.prototype); }

		targets.forEach(function (targetObj) {
			var origTouchDown = targetObj && targetObj.touchDown;
			if (typeof origTouchDown !== 'function' || targetObj._hapticsTouchHooked) { return; }
			targetObj._hapticsTouchHooked = true;
			safeOverride(targetObj, 'touchDown', function (index, locationInViewX, locationInViewY) {
				var result = origTouchDown.apply(this, arguments);
				if (WordChainHaptics.enabled && this.trackingTouch === index) {
					try {
						var actor = this._entity;
						var family = familyFor(actor);
						if (family) {
							onTouch(family, actor, index);
						}
					} catch (e) {
						if (WordChainHaptics.debug && global.console) {
							console.warn('[WordChainHaptics] Error in touch hook:', e);
						}
					}
				}
				return result;
			});
		});
		return true;
	}

	// 2. Hook PlaySoundAction: haptic fires for tile soundfx on Game Start & WordCompleted
	function hookPlaySoundAction() {
		var gs = global.gs;
		var PSA = gs && gs.PlaySoundAction;
		if (!PSA) { return false; }

		var targets = [PSA];
		if (PSA.prototype && PSA.prototype !== PSA) {
			targets.push(PSA.prototype);
		}

		targets.forEach(function (targetObj) {
			var origStart = targetObj && targetObj.start;
			if (typeof origStart !== 'function' || targetObj._hapticsSoundHooked) { return; }
			targetObj._hapticsSoundHooked = true;
			safeOverride(targetObj, 'start', function (actor, timestamp) {
				if (WordChainHaptics.enabled && isSoundFXVibrationActive()) {
					try {
						var sound = this.attributes && this.attributes.soundName && typeof this.attributes.soundName.getValue === 'function' ?
							this.attributes.soundName.getValue() : null;
						if (sound && SOUND_PROFILE[sound]) {
							var family = familyFor(actor) || 'letter';
							var vol = this.attributes.volume && typeof this.attributes.volume.getValue === 'function' ?
								(Number(this.attributes.volume.getValue()) || 1) : 1;
							var pitch = this.attributes.pitch && typeof this.attributes.pitch.getValue === 'function' ?
								(Number(this.attributes.pitch.getValue()) || 1) : 1;

							lastSoundName = sound;
							lastSoundTime = Date.now();
							onTileSoundFX(family, sound, vol, pitch, actor);
						}
					} catch (e) {
						if (WordChainHaptics.debug && global.console) {
							console.warn('[WordChainHaptics] Error in soundfx hook:', e);
						}
					}
				}
				return origStart.apply(this, arguments);
			});
		});
		return true;
	}

	// 3. Hook AudioManager: universal catcher for tile soundfx played on Game Start & WordCompleted
	function hookAudioManager() {
		var gs = global.gs;
		if (!gs) return;
		var audioClasses = [gs.AudioManagerBase, gs.StandardAudioManager, gs.ExtensionAudioManager];
		audioClasses.forEach(function (cls) {
			if (!cls || !cls.prototype || cls.prototype._hapticsAudioHooked) return;
			cls.prototype._hapticsAudioHooked = true;
			var origPlay = cls.prototype.playSound;
			if (typeof origPlay === 'function') {
				safeOverride(cls.prototype, 'playSound', function (id, volume, loop, pitch, positional) {
					if (WordChainHaptics.enabled && isSoundFXVibrationActive()) {
						if (id && SOUND_PROFILE[id]) {
							var now = Date.now();
							if (!(lastSoundName === id && now - lastSoundTime < 30)) {
								lastSoundName = id;
								lastSoundTime = now;
								onTileSoundFX('letter', id, volume || 1, pitch || 1, null);
							}
						}
					}
					return origPlay.apply(this, arguments);
				});
			}
		});

		if (gs.AudioManager && gs.AudioManager.current && !gs.AudioManager.current._hapticsAudioHooked) {
			gs.AudioManager.current._hapticsAudioHooked = true;
			var origCurrPlay = gs.AudioManager.current.playSound;
			if (typeof origCurrPlay === 'function') {
				safeOverride(gs.AudioManager.current, 'playSound', function (id, volume, loop, pitch, positional) {
					if (WordChainHaptics.enabled && isSoundFXVibrationActive()) {
						if (id && SOUND_PROFILE[id]) {
							var now = Date.now();
							if (!(lastSoundName === id && now - lastSoundTime < 30)) {
								lastSoundName = id;
								lastSoundTime = now;
								onTileSoundFX('letter', id, volume || 1, pitch || 1, null);
							}
						}
					}
					return origCurrPlay.apply(this, arguments);
				});
			}
		}
	}

	// 4. Hook Attribute setValue/fastSetValue to reactively detect WordCompleted changes
	function hookAttributeValues() {
		var gs = global.gs;
		var Attr = gs && (gs.Attribute || gs.MutableAttribute);
		if (!Attr || !Attr.prototype || Attr.prototype._hapticsWordCompletedHooked) return;
		Attr.prototype._hapticsWordCompletedHooked = true;

		var checkAttr = function (attrObj, val) {
			try {
				var game = gs.Game && (gs.Game.current || gs.Game.instance);
				var isTarget = false;
				if (game && game.attributes && attrObj === game.attributes.id192539) isTarget = true;
				if (attrObj.name === 'WordCompleted') isTarget = true;
				if (isTarget) {
					var isTrue = (val === true || val === 1 || val === 'true');
					if (isTrue) {
						onWordCompletedTriggered();
					}
				}
			} catch (e) {}
		};

		var origSetValue = Attr.prototype.setValue;
		if (typeof origSetValue === 'function') {
			safeOverride(Attr.prototype, 'setValue', function (val) {
				checkAttr(this, val);
				return origSetValue.apply(this, arguments);
			});
		}

		var origFastSetValue = Attr.prototype.fastSetValue;
		if (typeof origFastSetValue === 'function') {
			safeOverride(Attr.prototype, 'fastSetValue', function (val) {
				checkAttr(this, val);
				return origFastSetValue.apply(this, arguments);
			});
		}
	}

	// 5. Hook Engine update loop to continuously verify WordCompleted status
	function hookEngineUpdate() {
		var gs = global.gs;
		if (!gs || !gs.EngineContext || !gs.EngineContext.prototype) return;
		if (gs.EngineContext.prototype._hapticsUpdateHooked) return;
		gs.EngineContext.prototype._hapticsUpdateHooked = true;

		var origUpdate = gs.EngineContext.prototype.update;
		if (typeof origUpdate === 'function') {
			safeOverride(gs.EngineContext.prototype, 'update', function () {
				try {
					var game = gs.Game && (gs.Game.current || gs.Game.instance);
					if (game && game.attributes && game.attributes.id192539) {
						var v = game.attributes.id192539.getValue();
						if (v === true || v === 1 || v === 'true') {
							onWordCompletedTriggered();
						}
					}
				} catch (e) {}
				return origUpdate.apply(this, arguments);
			});
		}
	}

	var WordChainHaptics = {
		debug: false,
		enabled: true,

		install: function () {
			if (installed) { return true; }
			var gs = global.gs;
			if (!gs) {
				if (global.console) {
					console.warn('[WordChainHaptics] gs runtime not loaded; haptics bridge disabled.');
				}
				return false;
			}

			// Hook 1: TouchPredicate for instant on-touch tile vibration (Always active)
			hookTouchPredicate();

			// Hook 2: PlaySoundAction for tile soundfx (Active on Game Start & WordCompleted)
			hookPlaySoundAction();

			// Hook 3: AudioManager as universal soundfx catcher
			hookAudioManager();

			// Hook 4: Reactive attribute setter interceptor for WordCompleted
			hookAttributeValues();

			// Hook 5: Engine update loop for continuous WordCompleted monitoring
			hookEngineUpdate();

			// Hook 6: Scene transitions -> activate startup window for newly spawned tiles
			if (gs.EngineContext && gs.EngineContext.current && gs.EngineContext.current.delegate) {
				var del = gs.EngineContext.current.delegate;
				var origSceneChange = del.onSceneAboutToChange;
				del.onSceneAboutToChange = function () {
					triggerStartupWindow(4000);
					if (origSceneChange) return origSceneChange.apply(this, arguments);
				};
			}

			// Activate initial game start window (4.0 seconds for tile drops and intro sounds)
			triggerStartupWindow(4000);

			installed = true;

			// Warm up the native haptic engine on first user interaction for instant response
			var prime = function () {
				var ch = nativeChannel();
				if (ch) {
					try { ch.postMessage({ type: 'prime' }); } catch (e) {}
				}
				global.removeEventListener('touchstart', prime, true);
				global.removeEventListener('pointerdown', prime, true);
			};
			global.addEventListener('touchstart', prime, true);
			global.addEventListener('pointerdown', prime, true);

			if (global.console) {
				console.log('[WordChainHaptics] Installed successfully: on-touch tile haptics active, tile soundfx active on Game Start & WordCompleted.');
			}
			return true;
		},

		isWordCompleted: isWordCompleted,
		resetWordCompleted: resetWordCompleted,
		triggerWordCompleted: onWordCompletedTriggered,

		triggerStartup: triggerStartupWindow,
		resetStartup: resetStartupWindow,
		isStartupActive: isStartupActive,
		isSoundFXVibrationActive: isSoundFXVibrationActive,

		triggerTouch: function (actor, index) {
			if (!actor) return;
			var family = familyFor(actor);
			if (family) {
				onTouch(family, actor, index !== undefined ? index : 0);
			}
		},

		testTouch: function (family) {
			lastTouch.time = 0;
			onTouch(family || 'letter', null, -1);
		},

		testSoundFX: function (family, sound) {
			onTileSoundFX(family || 'letter', sound || 'tilehit', 1, 1, null);
		}
	};

	global.WordChainHaptics = WordChainHaptics;
})(typeof window !== 'undefined' ? window : this);
