/*
 * Word Chain Game - Haptics Bridge
 * --------------------------------
 * Hooks the GameSalad engine's PlaySoundAction and Box2D ContactListener so that:
 *   1. Letter tiles colliding with each other or the tile collider trigger physical
 *      haptic vibration whose strength & sharpness scale with impact velocity.
 *   2. Fake tiles trigger a distinct, lower-intensity haptic vibration whenever
 *      their sound fx is played.
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

	// Sound profiles:
	// i = base intensity (0..1), s = base sharpness (0..1), r = optional rumble tail.
	var SOUND_PROFILE = {
		tilehit:   { i: 0.82, s: 0.72 },
		thud:      { i: 0.95, s: 0.20 },
		dirtsound: { i: 0.65, s: 0.10, r: { d: 0.07, i: 0.30 } },
		bookgrab:  { i: 0.72, s: 0.45, r: { d: 0.04, i: 0.20 } },
		WrongWord: { i: 0.45, s: 0.25 }
	};
	var DEFAULT_PROFILE = { i: 0.50, s: 0.35 };

	var COALESCE_MS = 16;        // gather impacts landing in the same frame
	var MIN_GAP_MS = 25;         // minimum gap between haptic triggers to prevent hardware stall
	var MAX_EVENTS = 6;          // cap events per batch

	var queue = [];
	var flushTimer = null;
	var lastFire = 0;
	var installed = false;

	function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
	function jitter(v, amount) { return v * (1 + (Math.random() * 2 - 1) * amount); }
	function rand(lo, hi) { return lo + Math.random() * (hi - lo); }

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

	function isLetterTileActor(actor) {
		if (!actor) return false;
		var proto = actor._prototypeID || actor.prototypeID;
		if (proto === 'id109260') return true;
		try {
			var n = actor.attributes && actor.attributes.name && actor.attributes.name.getValue();
			return n === 'Letters Tiles' || n === 'Letter Tile';
		} catch (e) { return false; }
	}

	function isTileColliderActor(actor) {
		if (!actor) return false;
		var proto = actor._prototypeID || actor.prototypeID;
		if (proto === 'id182822') return true;
		try {
			var n = actor.attributes && actor.attributes.name && actor.attributes.name.getValue();
			return n === 'Tiles collider' || n === 'Tiles Collider' || (n && n.toLowerCase().indexOf('collider') !== -1);
		} catch (e) { return false; }
	}

	function familyFor(actor) {
		if (!actor) { return null; }
		var protoId = actor._prototypeID || actor.prototypeID;
		if (protoId && ACTOR_FAMILY[protoId]) {
			return ACTOR_FAMILY[protoId];
		}
		try {
			var name = actor.attributes && actor.attributes.name && actor.attributes.name.getValue();
			if (name) {
				if (NAME_FAMILY[name]) return NAME_FAMILY[name];
				if (name.indexOf('Fake') !== -1 || name.indexOf('fake') !== -1) return 'fake';
			}
		} catch (e) {}
		return null;
	}

	function actorSpeed(actor) {
		try {
			var v = actor.aspects && actor.aspects.motion && actor.aspects.motion.attributes && actor.aspects.motion.attributes.linearVelocity;
			if (v) {
				var x = v.x.getValue(), y = v.y.getValue();
				return Math.sqrt(x * x + y * y);
			}
		} catch (e) {}
		return 0;
	}

	function actorNumber(actor, attrId) {
		if (!actor || !actor.attributes || !actor.attributes[attrId]) return 0;
		try {
			return Number(actor.attributes[attrId].getValue()) || 0;
		} catch (e) {
			return 0;
		}
	}

	/*
	 * Build haptic events for one sound / impact:
	 * Event: { t: offset in seconds, i: intensity 0..1, s: sharpness 0..1, d?: duration in seconds }
	 */
	function buildEvents(family, sound, volume, pitch, actor) {
		var p = SOUND_PROFILE[sound] || DEFAULT_PROFILE;
		var vol = clamp(volume !== undefined ? volume : 1, 0.3, 1.0);
		// pitch variation in GameSalad is random(0.8..1.1); map it to a sharpness shift
		var sharpShift = clamp(((pitch !== undefined ? pitch : 1) - 0.95) * 1.2, -0.2, 0.2);
		var events = [];

		if (family === 'letter') {
			// Real physics tile: dynamic strength follows impact speed
			var speed = actorSpeed(actor);
			var force = clamp(0.65 + speed / 1100, 0.60, 1.20);
			var i = clamp(jitter(p.i * vol * force, 0.10), 0.20, 1.0);
			var s = clamp(jitter(p.s + sharpShift, 0.12), 0.05, 1.0);
			events.push({ t: 0, i: i, s: s });
			if (p.r) {
				events.push({ t: 0.004, i: clamp(p.r.i * force, 0.05, 1.0), s: 0.05, d: p.r.d });
			}
			// Heavy impacts produce a subtle settling rattle tap
			if (force > 0.85 && Math.random() < 0.50) {
				events.push({ t: rand(0.045, 0.085), i: clamp(i * rand(0.22, 0.36), 0.08, 0.8), s: clamp(s + 0.15, 0, 1.0) });
			}
		} else if (family === 'fake') {
			// Fake Tile: lower vibrate effect when their soundfx plays
			var row = actorNumber(actor, 'id191767'); // RowOffset
			var rowBoost = clamp(1.05 - row * 0.05, 0.80, 1.05);
			var fakeIntensity = clamp(jitter(p.i * 0.52 * vol * rowBoost, 0.12), 0.12, 0.55);
			var fakeSharpness = clamp(jitter(p.s * 0.85 + sharpShift, 0.15), 0.05, 0.80);
			events.push({
				t: 0,
				i: fakeIntensity,
				s: fakeSharpness
			});
		} else if (family === 'fake2') {
			// Row5FakeTile ("Fake Tiles 2"): two-step lower clack
			var first = clamp(jitter(p.i * 0.55 * vol, 0.12), 0.15, 0.60);
			var gap = rand(0.035, 0.055);
			events.push({ t: 0, i: first, s: clamp(jitter(p.s * 0.85 + sharpShift, 0.15), 0.05, 0.85) });
			events.push({ t: gap, i: clamp(first * rand(0.40, 0.55), 0.08, 0.40), s: clamp(p.s * 0.85 + 0.15, 0.05, 0.90) });
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
		if (WordChainHaptics.debug && global.console) {
			console.log('[WordChainHaptics]', JSON.stringify(events));
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
				// Duration scales with intensity: 10ms (light fake tile) to 42ms (heavy real tile)
				var dur = Math.round(10 + events[i].i * 32 + (events[i].d || 0) * 1000);
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

	function onImpact(family, sound, volume, pitch, actor) {
		var events = buildEvents(family, sound, volume, pitch, actor);
		if (!events.length) { return; }
		queue.push(events);
		if (!flushTimer) {
			flushTimer = setTimeout(flush, COALESCE_MS);
		}
	}

	// Physics contact listener handler for letter tile collisions
	function onPhysicsCollision(fixtureA, fixtureB) {
		try {
			var game = global.gs && global.gs.Game && global.gs.Game.current;
			if (!game) return;
			var scene = game.getCurrentScene && game.getCurrentScene();
			if (!scene || !scene._collisionController) return;
			var cc = scene._collisionController;

			var udA = fixtureA && fixtureA.m_body && fixtureA.m_body.GetUserData && fixtureA.m_body.GetUserData();
			var udB = fixtureB && fixtureB.m_body && fixtureB.m_body.GetUserData && fixtureB.m_body.GetUserData();
			if (!udA || !udB) return;

			var actorA = cc.getActorFromActorID(udA.actorID);
			var actorB = cc.getActorFromActorID(udB.actorID);
			if (!actorA || !actorB) return;

			var isA_Letter = isLetterTileActor(actorA);
			var isB_Letter = isLetterTileActor(actorB);
			var isA_Collider = isTileColliderActor(actorA);
			var isB_Collider = isTileColliderActor(actorB);

			var isTileToTile = isA_Letter && isB_Letter;
			var isTileToCollider = (isA_Letter && isB_Collider) || (isB_Letter && isA_Collider);

			if (isTileToTile || isTileToCollider) {
				var letterActor = isA_Letter ? actorA : actorB;
				var spd = Math.max(actorSpeed(actorA), actorSpeed(actorB));
				if (spd > 25) {
					onImpact('letter', 'tilehit', 1, 1, letterActor);
				}
			}
		} catch (e) {
			if (WordChainHaptics.debug && global.console) {
				console.warn('[WordChainHaptics] Collision check error:', e);
			}
		}
	}

	function hookContactListener() {
		var gs = global.gs;
		if (gs && gs.ContactListener && typeof gs.ContactListener.fixtureCollisionBegan === 'function') {
			if (!gs.ContactListener._hapticsHooked) {
				gs.ContactListener._hapticsHooked = true;
				var origFixtureCollisionBegan = gs.ContactListener.fixtureCollisionBegan;
				gs.ContactListener.fixtureCollisionBegan = function (fixtureA, fixtureB) {
					var result = origFixtureCollisionBegan.apply(this, arguments);
					if (WordChainHaptics.enabled) {
						onPhysicsCollision(fixtureA, fixtureB);
					}
					return result;
				};
			}
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

			// 1. Hook PlaySoundAction for soundfx haptics (fake tiles soundfx & letter impacts)
			var target = gs.PlaySoundAction;
			if (target) {
				var originalStart = target.start || (target.prototype && target.prototype.start);
				if (typeof originalStart === 'function') {
					var hookedStart = function (actor, timestamp) {
						if (WordChainHaptics.enabled && actor) {
							try {
								var family = familyFor(actor);
								if (family) {
									var sound = this.attributes && this.attributes.soundName && this.attributes.soundName.getValue();
									if (sound) {
										var vol = this.attributes.volume ? (Number(this.attributes.volume.getValue()) || 1) : 1;
										var pitch = this.attributes.pitch ? (Number(this.attributes.pitch.getValue()) || 1) : 1;
										onImpact(family, sound, vol, pitch, actor);
									}
								}
							} catch (e) {
								if (WordChainHaptics.debug && global.console) {
									console.warn('[WordChainHaptics] Error in sound hook:', e);
								}
							}
						}
						return originalStart.apply(this, arguments);
					};
					target.start = hookedStart;
					if (target.prototype && typeof target.prototype.start === 'function') {
						target.prototype.start = hookedStart;
					}
				}
			}

			// 2. Hook Box2D ContactListener for direct physics collision vibration
			hookContactListener();

			// Re-verify ContactListener on scene changes
			if (gs.EngineContext && gs.EngineContext.current) {
				var engineContext = gs.EngineContext.current;
				if (engineContext.delegate) {
					var origOnSceneAboutToChange = engineContext.delegate.onSceneAboutToChange;
					engineContext.delegate.onSceneAboutToChange = function () {
						hookContactListener();
						if (origOnSceneAboutToChange) {
							return origOnSceneAboutToChange.apply(this, arguments);
						}
					};
				}
			}

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
				console.log('[WordChainHaptics] Installed successfully: letter tile collisions & fake tile soundfx haptics active.');
			}
			return true;
		},

		test: function (family, sound) {
			onImpact(family || 'letter', sound || 'tilehit', 1, 1, null);
		}
	};

	global.WordChainHaptics = WordChainHaptics;
})(typeof window !== 'undefined' ? window : this);
