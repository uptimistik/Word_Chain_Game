/*
 * Word Chain Game - Multitouch Bridge (2-Finger MAX with Instant Clean Grab & Throw Physics)
 * -----------------------------------------------------------------------------------------
 * Features:
 *   1. Strict 2-Finger Limit: Exactly at most 2 letter tiles can be grabbed simultaneously.
 *      Any 3rd touch on a letter tile is ignored/rejected until a held tile is released.
 *   2. Instant, Clean Grab (Zero Delay):
 *      - Direct drag initialization on touchDown sets offsets, self.Dragging, density, and
 *        visual tint on frame 0, completely eliminating the delay on the 2nd grabbed tile.
 *      - Per-tile game.Dragging condition routing ensures both tiles satisfy drag start
 *        and maintain active drag independently.
 *   3. Zero Velocity Loss / Throw Physics:
 *      - High-frequency touch sampling calculates flick throwing momentum.
 *      - Release velocity applies directly to Box2D body without constraint braking.
 *      - Tile flies freely under scene gravity and collisions.
 *   4. Independent Multi-Tile Grip (Zero Cross-Talk Drops):
 *      - When multiple tiles are grabbed and one is released, any other held tiles
 *        NEVER fall or drop.
 *      - Global game.Dragging (id104408) & mouse.button are guarded so they remain active
 *        as long as any tile is held.
 *      - Downward AccelerateBehavior (gravity) is suppressed on actively held tiles.
 *      - Motion tracking executes every frame across touches.
 */
(function (global) {
	'use strict';

	// Ensure GameSalad prototype definitions remain configurable and writable for extensions
	// Guards against browser extension conflicts (e.g. crypto wallets, devtools redefining prototype/ethereum)
	(function () {
		try {
			var origDefineProperty = Object.defineProperty;
			Object.defineProperty = function (obj, prop, descriptor) {
				if (descriptor && typeof descriptor === 'object' && prop !== 'prototype' && prop !== 'ethereum') {
					try {
						var existing = Object.getOwnPropertyDescriptor(obj, prop);
						if (!existing || existing.configurable !== false) {
							descriptor.configurable = true;
							if (descriptor.value !== undefined && descriptor.writable === undefined) {
								descriptor.writable = true;
							}
						}
					} catch (e) {}
				}
				try {
					return origDefineProperty.call(Object, obj, prop, descriptor);
				} catch (err) {
					if (prop === 'prototype' || prop === 'ethereum') {
						return obj;
					}
					throw err;
				}
			};

			var origDefineProperties = Object.defineProperties;
			Object.defineProperties = function (obj, props) {
				if (props && typeof props === 'object') {
					for (var key in props) {
						var desc = props[key];
						if (desc && typeof desc === 'object' && key !== 'prototype' && key !== 'ethereum') {
							try {
								var existing = Object.getOwnPropertyDescriptor(obj, key);
								if (!existing || existing.configurable !== false) {
									desc.configurable = true;
									if (desc.value !== undefined && desc.writable === undefined) {
										desc.writable = true;
									}
								}
							} catch (e) {}
						}
					}
				}
				try {
					return origDefineProperties.call(Object, obj, props);
				} catch (err) {
					return obj;
				}
			};
		} catch (e) {}
	})();

	var MAX_SIMULTANEOUS_TILES = 2; // Strict 2-finger MAX multi touch
	var MAX_THROW_SPEED = 800;       // Matches Letters Tiles maxSpeed in motion aspects
	var installed = false;
	var debug = false;

	// Track actively held tiles: Actor -> touchIndex (max 2 entries)
	var heldTiles = new Map();
	// TouchIndex -> Actor
	var touchToActor = new Map();
	// TouchIndex -> Array of { x, y, t } samples
	var touchHistory = new Map();
	// TouchIndex -> { x, y } in GameSalad view coordinates
	var touchPositions = new Map();
	// TouchIndex -> boolean (is finger currently pressed)
	var touchActive = new Map();

	function log() {
		if (debug && global.console) {
			console.log.apply(console, ['[WordChainMultitouch]'].concat(Array.prototype.slice.call(arguments)));
		}
	}

	function isLetterTile(actor) {
		if (!actor) return false;
		var protoId = actor._prototypeID || actor.prototypeID;
		if (protoId === 'id109260') return true;
		try {
			var name = actor.attributes && actor.attributes.name && actor.attributes.name.getValue();
			return name === 'Letters Tiles' || name === 'Letter Tile';
		} catch (e) {
			return false;
		}
	}

	function countOtherHeldTiles(actor) {
		var count = 0;
		heldTiles.forEach(function (tIdx, hActor) {
			if (hActor !== actor && !hActor._releasing) {
				count++;
			}
		});
		return count;
	}

	function countActiveHeldTiles(excludeActor) {
		var count = 0;
		heldTiles.forEach(function (tIdx, hActor) {
			if (hActor !== excludeActor && !hActor._releasing) {
				count++;
			}
		});
		return count;
	}

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

	function recordTouchSample(index, x, y) {
		if (index === undefined || x === undefined || y === undefined) return;
		var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
		touchPositions.set(index, { x: x, y: y });
		touchActive.set(index, true);

		var list = touchHistory.get(index);
		if (!list) {
			list = [];
			touchHistory.set(index, list);
		}
		list.push({ x: x, y: y, t: now });
		// Keep samples within the last 120ms
		while (list.length > 2 && (now - list[0].t) > 120) {
			list.shift();
		}
	}

	/*
	 * Calculate throwing velocity from finger flick and physics motion.
	 */
	function calculateThrowVelocity(index, actor) {
		var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
		var list = touchHistory.get(index);
		var flickVx = 0, flickVy = 0;

		if (list && list.length >= 2) {
			// Find samples within the last 80ms before release
			var recent = [];
			for (var i = list.length - 1; i >= 0; i--) {
				if (now - list[i].t <= 80) {
					recent.unshift(list[i]);
				}
			}
			if (recent.length < 2 && list.length >= 2) {
				recent = list.slice(-3);
			}
			if (recent.length >= 2) {
				var first = recent[0];
				var last = recent[recent.length - 1];
				var dt = (last.t - first.t) / 1000;
				if (dt > 0.005) {
					flickVx = (last.x - first.x) / dt;
					flickVy = (last.y - first.y) / dt;
				}
			}
		}

		// Also check the actor's current Box2D linear velocity
		var bodyVx = 0, bodyVy = 0;
		var motion = actor && actor.aspects && actor.aspects.motion;
		if (motion && motion.attributes && motion.attributes.linearVelocity) {
			try {
				bodyVx = motion.attributes.linearVelocity.x.getValue() || 0;
				bodyVy = motion.attributes.linearVelocity.y.getValue() || 0;
			} catch (e) {}
		}

		var flickSpeed = Math.sqrt(flickVx * flickVx + flickVy * flickVy);
		var bodySpeed = Math.sqrt(bodyVx * bodyVx + bodyVy * bodyVy);

		var throwVx = 0, throwVy = 0;
		if (flickSpeed > 30) {
			// Player flicked finger: follow flick vector
			throwVx = flickVx;
			throwVy = flickVy;
			// If body was already traveling faster along the flick direction, blend
			if (bodySpeed > flickSpeed && (bodyVx * flickVx + bodyVy * flickVy > 0)) {
				throwVx = bodyVx;
				throwVy = bodyVy;
			}
		} else if (bodySpeed > 50) {
			// Fast movement where finger decelerated slightly at release
			throwVx = bodyVx;
			throwVy = bodyVy;
		}

		// Cap velocity at actor maxSpeed
		var maxSpeed = MAX_THROW_SPEED;
		if (motion && motion.attributes && motion.attributes.maxSpeed) {
			try {
				maxSpeed = motion.attributes.maxSpeed.getValue() || MAX_THROW_SPEED;
			} catch (e) {}
		}
		var speed = Math.sqrt(throwVx * throwVx + throwVy * throwVy);
		if (speed > maxSpeed) {
			throwVx = (throwVx / speed) * maxSpeed;
			throwVy = (throwVy / speed) * maxSpeed;
		}

		return { vx: throwVx, vy: throwVy, speed: speed };
	}

	function applyThrowVelocity(actor, throwVx, throwVy) {
		if (!actor) return;
		var motion = actor.aspects && actor.aspects.motion;
		if (!motion) return;

		// 1. Update GameSalad linearVelocity attributes
		if (motion.attributes && motion.attributes.linearVelocity) {
			try {
				motion.attributes.linearVelocity.x.setValue(throwVx);
				motion.attributes.linearVelocity.y.setValue(throwVy);
			} catch (e) {}
		}

		// 2. Set physics body velocity directly in Box2D
		if (motion._body && typeof motion._body.setLinearVelocity === 'function') {
			try {
				motion._body.setLinearVelocity(throwVx, throwVy);
			} catch (e) {}
		}
	}

	/*
	 * Updates motion velocity directly for an actively held tile.
	 */
	function updateActorMotion(actor, touchIndex) {
		if (!actor || actor._releasing) return;
		var pos = touchPositions.get(touchIndex);
		if (!pos || touchActive.get(touchIndex) === false) return;

		try {
			var offX = actor.attributes.id126864 ? actor.attributes.id126864.getValue() : 0;
			var offY = actor.attributes.id196173 ? actor.attributes.id196173.getValue() : 0;
			var targetX = pos.x + offX;
			var targetY = pos.y + offY;
			var curX = actor.attributes.position.x.getValue();
			var curY = actor.attributes.position.y.getValue();
			var vx = 20 * (targetX - curX);
			var vy = 20 * (targetY - curY);

			var motion = actor.aspects && actor.aspects.motion;
			if (motion) {
				if (motion.attributes && motion.attributes.linearVelocity) {
					motion.attributes.linearVelocity.x.fastSetValue(vx);
					motion.attributes.linearVelocity.y.fastSetValue(vy);
				}
				if (motion._body && typeof motion._body.setLinearVelocity === 'function') {
					motion._body.setLinearVelocity(vx, vy);
				}
			}
		} catch (e) {}
	}

	/*
	 * Updates motion for ALL actively held tiles every frame.
	 */
	function updateHeldTilesMotion() {
		heldTiles.forEach(function (touchIndex, actor) {
			updateActorMotion(actor, touchIndex);
		});
	}

	/*
	 * Directly initializes a tile for dragging on touchDown.
	 * This completely eliminates the grab delay on the second tile by bypassing
	 * multi-frame condition cascades and preparing offsets and drag state on frame 0.
	 */
	function initTileDrag(actor, index, locationInViewX, locationInViewY) {
		if (!actor) return;
		actor._releasing = false;
		actor._activeTouchIndex = index;
		heldTiles.set(actor, index);
		touchToActor.set(index, actor);

		// Trigger on-touch haptic tap directly upon confirmed tile grab
		if (global.WordChainHaptics) {
			if (typeof global.WordChainHaptics.resetStartup === 'function') {
				global.WordChainHaptics.resetStartup();
			}
			if (typeof global.WordChainHaptics.resetWordCompleted === 'function') {
				global.WordChainHaptics.resetWordCompleted();
			}
			if (typeof global.WordChainHaptics.triggerTouch === 'function') {
				global.WordChainHaptics.triggerTouch(actor, index);
			}
		}

		try {
			var posX = locationInViewX;
			var posY = locationInViewY;
			var curX = 0, curY = 0;
			if (actor.attributes && actor.attributes.position) {
				curX = (actor.attributes.position.x && typeof actor.attributes.position.x.getValue === 'function') ? actor.attributes.position.x.getValue() : 0;
				curY = (actor.attributes.position.y && typeof actor.attributes.position.y.getValue === 'function') ? actor.attributes.position.y.getValue() : 0;
			}

			// Calculate and set OffsetX and OffsetY immediately
			if (actor.attributes && actor.attributes.id126864) {
				actor.attributes.id126864.setValue(curX - posX);
			}
			if (actor.attributes && actor.attributes.id196173) {
				actor.attributes.id196173.setValue(curY - posY);
			}

			// Set self.Dragging = true and protect it while held
			if (actor.attributes && actor.attributes.id110061) {
				actor.attributes.id110061.setValue(true);
				if (!actor.attributes.id110061._protectedForMultitouch) {
					actor.attributes.id110061._protectedForMultitouch = true;
					var origSelfDragSetValue = actor.attributes.id110061.setValue;
					actor.attributes.id110061.setValue = function (val) {
						if (!val || val === 'false' || val === 0) {
							if (heldTiles.has(actor) && !actor._releasing) {
								return; // Do not allow self.Dragging to become false while actively held
							}
						}
						return origSelfDragSetValue.call(this, val);
					};
				}
			}

			// Darken tile to 0.72 immediately for tactile grab feedback
			if (actor.attributes && actor.attributes.color) {
				actor.attributes.color.red.setValue(0.7215686274509804);
				actor.attributes.color.green.setValue(0.7215686274509804);
				actor.attributes.color.blue.setValue(0.7215686274509804);
			}

			// Set density to 150 for lighter drag feel
			if (actor.aspects && actor.aspects.physics && actor.aspects.physics.attributes && actor.aspects.physics.attributes.density) {
				actor.aspects.physics.attributes.density.setValue(150);
			}
		} catch (e) {}

		// Mark game-level flags
		var gs = global.gs;
		var game = gs && (gs.Game.current || gs.Game.instance);
		if (game && game.attributes) {
			try {
				if (game.attributes.id169130) game.attributes.id169130.setValue(true);
				if (game.attributes.id104408) game.attributes.id104408.setValue(true);
			} catch (e) {}
		}
		if (game && game.devices && game.devices.mouse && game.devices.mouse.button) {
			try {
				game.devices.mouse.button.setValue(true);
			} catch (e) {}
		}
	}

	/*
	 * Cleanly releases a tile with throw physics momentum.
	 */
	function cleanReleaseTile(actor, index, locationInViewX, locationInViewY) {
		if (!actor) return;
		var throwResult = calculateThrowVelocity(index, actor);

		actor._releasing = true;
		actor._throwVx = throwResult.vx;
		actor._throwVy = throwResult.vy;

		heldTiles.delete(actor);
		touchToActor.delete(index);
		touchHistory.delete(index);
		actor._activeTouchIndex = null;

		var remaining = countActiveHeldTiles();
		log('TouchUp touch ' + index + '. Throw velocity: (' + Math.round(throwResult.vx) + ', ' + Math.round(throwResult.vy) + ') speed: ' + Math.round(throwResult.speed) + '. Remaining held tiles:', remaining);

		// Cleanly exit drag state & reset tile color and density
		try {
			if (actor.attributes && actor.attributes.id110061) {
				actor.attributes.id110061.setValue(false);
			}
			if (actor.attributes && actor.attributes.color) {
				actor.attributes.color.red.setValue(1);
				actor.attributes.color.green.setValue(1);
				actor.attributes.color.blue.setValue(1);
			}
			if (actor.aspects && actor.aspects.physics && actor.aspects.physics.attributes && actor.aspects.physics.attributes.density) {
				actor.aspects.physics.attributes.density.setValue(600);
			}
		} catch (e) {}

		// Apply throw velocity to free flight
		if (throwResult.speed > 30) {
			applyThrowVelocity(actor, throwResult.vx, throwResult.vy);
			log('Throw momentum applied to actor. Speed: ' + Math.round(throwResult.speed));
		}

		// Reset releasing flag on next animation frame
		global.requestAnimationFrame(function () {
			actor._releasing = false;
		});

		// Ensure game.Dragging & mouse.button reflect whether any tile remains held
		var gs = global.gs;
		var game = gs && (gs.Game.current || gs.Game.instance);
		if (game && game.attributes && game.attributes.id104408) {
			try {
				game.attributes.id104408.setValue(remaining > 0);
			} catch (e) {}
		}
		if (game && game.devices && game.devices.mouse && game.devices.mouse.button) {
			try {
				game.devices.mouse.button.setValue(remaining > 0);
			} catch (e) {}
		}
	}

	/*
	 * Evaluates routed variable values per actor.
	 */
	function routedValue(entity, keypath, val) {
		if (!entity) return val;

		// Keypath for mouse position: route to this actor's holding touch
		if (keypath === 'game.devices.mouse.position.x') {
			if (heldTiles.has(entity)) {
				var idxX = heldTiles.get(entity);
				var posX = touchPositions.get(idxX);
				if (posX) return posX.x;
			}
			return val;
		}
		if (keypath === 'game.devices.mouse.position.y') {
			if (heldTiles.has(entity)) {
				var idxY = heldTiles.get(entity);
				var posY = touchPositions.get(idxY);
				if (posY) return posY.y;
			}
			return val;
		}

		// Keypath for mouse button: route to this actor's touch active state
		if (keypath === 'game.devices.mouse.button') {
			if (entity._releasing) {
				return false;
			}
			if (heldTiles.has(entity)) {
				var idxB = heldTiles.get(entity);
				return touchActive.get(idxB) !== false;
			}
			return val;
		}

		// Keypath for game.Dragging (id104408):
		// - If entity is releasing: sees false to allow release exit
		// - If entity is actively held or dragging: sees true (so its drag rule stays active)
		// - If entity is NOT being held: sees true ONLY if max tiles (2) already held (blocking 3rd tile)
		if (keypath === 'game.attributes.id104408') {
			if (entity._releasing) {
				return false;
			}
			var selfDrag = false;
			if (entity.attributes && entity.attributes.id110061) {
				selfDrag = !!entity.attributes.id110061.getValue();
			}
			if (selfDrag || heldTiles.has(entity)) {
				return true;
			}
			var cnt = countOtherHeldTiles(entity);
			return cnt >= MAX_SIMULTANEOUS_TILES;
		}

		return val;
	}

	function install() {
		if (installed) return true;
		var gs = global.gs;
		if (!gs) {
			if (global.console) {
				console.warn('[WordChainMultitouch] gs runtime not loaded');
			}
			return false;
		}

		log('Installing Multitouch Bridge (2-finger MAX, instant clean grab, zero velocity loss)...');

		// 1. Hook updateTouchPosition on gs.Game to track touch positions & active states
		if (gs.Game && gs.Game.updateTouchPosition) {
			var origUpdateTouchPosition = gs.Game.updateTouchPosition;
			safeOverride(gs.Game, 'updateTouchPosition', function (index, locationInViewX, locationInViewY, active) {
				var isAct = active !== undefined ? active : true;
				recordTouchSample(index, locationInViewX, locationInViewY);
				try {
					return origUpdateTouchPosition.call(this, index, locationInViewX, locationInViewY, isAct);
				} catch (e) {}
			});
		}

		// 2. Global Attribute Protection: Guard game.Dragging (id104408) & mouse.button
		// When releasing ONE tile while another is still held, GameSalad rules attempt to set
		// game.Dragging = false and mouse.button = false.
		// Intercepting setValue / fastSetValue ensures they NEVER drop to false while any tile is held.
		var Attr = gs.Attribute;
		if (Attr && Attr.prototype && !Attr.prototype._multitouchProtected) {
			Attr.prototype._multitouchProtected = true;

			var origAttrSetValue = Attr.prototype.setValue;
			safeOverride(Attr.prototype, 'setValue', function (val) {
				var game = gs.Game && (gs.Game.current || gs.Game.instance);
				if (game && game.attributes && this === game.attributes.id104408) {
					if (!val || val === 'false' || val === 0) {
						if (countActiveHeldTiles() > 0) {
							val = true; // Lock to true while other tile is held
						}
					}
				} else if (game && game.devices && game.devices.mouse && this === game.devices.mouse.button) {
					if (!val || val === 'false' || val === 0) {
						if (countActiveHeldTiles() > 0) {
							val = true;
						}
					}
				}
				return origAttrSetValue.call(this, val);
			});

			var origAttrFastSetValue = Attr.prototype.fastSetValue;
			safeOverride(Attr.prototype, 'fastSetValue', function (val) {
				var game = gs.Game && (gs.Game.current || gs.Game.instance);
				if (game && game.attributes && this === game.attributes.id104408) {
					if (!val || val === 'false' || val === 0) {
						if (countActiveHeldTiles() > 0) {
							val = true;
						}
					}
				} else if (game && game.devices && game.devices.mouse && this === game.devices.mouse.button) {
					if (!val || val === 'false' || val === 0) {
						if (countActiveHeldTiles() > 0) {
							val = true;
						}
					}
				}
				return origAttrFastSetValue.call(this, val);
			});

			var origAttrGetValue = Attr.prototype.getValue;
			safeOverride(Attr.prototype, 'getValue', function () {
				var game = gs.Game && (gs.Game.current || gs.Game.instance);
				if (game && game.attributes && this === game.attributes.id104408) {
					if (countActiveHeldTiles() > 0) {
						return true;
					}
				} else if (game && game.devices && game.devices.mouse && this === game.devices.mouse.button) {
					if (countActiveHeldTiles() > 0) {
						return true;
					}
				}
				return origAttrGetValue.call(this);
			});
		}

		// 3. AccelerateBehavior Suppression on Actively Held Tiles
		// In Letters Tiles (id109260), when Rule 16 falls back, elseBehavior 0 is AccelerateBehavior
		// (downward acceleration 1900). We completely suppress this on held tiles so they NEVER fall under gravity!
		var Accel = gs.AccelerateBehavior;
		var accelTargets = [Accel];
		if (Accel && Accel.prototype && Accel.prototype !== Accel) accelTargets.push(Accel.prototype);

		accelTargets.forEach(function (targetObj) {
			if (!targetObj || !targetObj.everyFrame || targetObj._accelHooked) return;
			targetObj._accelHooked = true;
			var origAccelEveryFrame = targetObj.everyFrame;
			safeOverride(targetObj, 'everyFrame', function (actor, timestamp) {
				if (actor && isLetterTile(actor) && heldTiles.has(actor) && !actor._releasing) {
					// Actively held tile must NEVER be accelerated downward by gravity!
					return;
				}
				return origAccelEveryFrame.apply(this, arguments);
			});
		});

		// 4. RuleBehavior Condition Protection: Lock conditionStates[0] and [1] to true for held tiles
		var Rule = gs.RuleBehavior;
		if (Rule && Rule.prototype && !Rule.prototype._multitouchRuleHooked) {
			Rule.prototype._multitouchRuleHooked = true;
			var origConditionChangedState = Rule.prototype.conditionChangedState;
			safeOverride(Rule.prototype, 'conditionChangedState', function (index, state) {
				var actor = this._entity;
				if (actor && isLetterTile(actor) && heldTiles.has(actor) && !actor._releasing) {
					if (state === false) {
						var cond = this.condition || (this.conditions && this.conditions.array && this.conditions.array[index]);
						if (cond) {
							var game = gs.Game && (gs.Game.current || gs.Game.instance);
							var isProtectedCond = false;
							if (cond.subjectAttribute && game && game.attributes && cond.subjectAttribute === game.attributes.id104408) {
								isProtectedCond = true;
							} else if (cond.subjectAttribute && actor.attributes && cond.subjectAttribute === actor.attributes.id110061) {
								isProtectedCond = true;
							} else if (cond.subjectAttribute && game && game.devices && game.devices.mouse && cond.subjectAttribute === game.devices.mouse.button) {
								isProtectedCond = true;
							}
							if (isProtectedCond) {
								state = true;
							}
						}
					}
				}
				return origConditionChangedState.call(this, index, state);
			});
		}

		// 5. Engine Frame-by-Frame Motion Tracking
		// Guarantees all held tiles are continuously positioned & velocity-tracked on every frame
		if (gs.EngineContext && gs.EngineContext.prototype && gs.EngineContext.prototype.update && !gs.EngineContext.prototype._multitouchMotionHooked) {
			gs.EngineContext.prototype._multitouchMotionHooked = true;
			var origEngineUpdate = gs.EngineContext.prototype.update;
			safeOverride(gs.EngineContext.prototype, 'update', function () {
				updateHeldTilesMotion();
				return origEngineUpdate.apply(this, arguments);
			});
		}

		// 6. Hook gs.EventCenter.prototype.postEvent to capture every touch event with immediate velocity updates
		if (gs.EventCenter && gs.EventCenter.prototype && gs.EventCenter.prototype.postEvent) {
			var origPostEvent = gs.EventCenter.prototype.postEvent;
			safeOverride(gs.EventCenter.prototype, 'postEvent', function (eventName, objectOfInterest) {
				if (eventName === 'touchDown' || eventName === 'touchMoved') {
					var touchIndex = arguments[2];
					var x = arguments[3];
					var y = arguments[4];
					recordTouchSample(touchIndex, x, y);

					// Immediate zero-latency velocity update on touchMoved
					if (eventName === 'touchMoved' && touchToActor.has(touchIndex)) {
						var actor = touchToActor.get(touchIndex);
						if (actor && heldTiles.has(actor) && !actor._releasing) {
							updateActorMotion(actor, touchIndex);
						}
					}
				} else if (eventName === 'touchUp' || eventName === 'touchCancel') {
					var touchIdx = arguments[2];
					touchActive.set(touchIdx, false);
				}
				return origPostEvent.apply(this, arguments);
			});
		}

		// 7. Hook gs.TouchPredicate for 2-finger limit, instant clean grabbing, and throw release
		var TP = gs.TouchPredicate;
		var tpTargets = [TP];
		if (TP && TP.prototype && TP.prototype !== TP) tpTargets.push(TP.prototype);

		tpTargets.forEach(function (targetObj) {
			if (!targetObj) return;

			// Hook touchDown: 2-finger limit + instant clean grab
			var origTouchDown = targetObj.touchDown;
			if (typeof origTouchDown === 'function' && !targetObj._touchDownHooked) {
				targetObj._touchDownHooked = true;
				safeOverride(targetObj, 'touchDown', function (index, locationInViewX, locationInViewY) {
					recordTouchSample(index, locationInViewX, locationInViewY);
					var actor = this._entity;
					var isLetter = actor && isLetterTile(actor);

					if (isLetter && (this.conditionType === TP.PRESSED || this.conditionType === 0)) {
						// If this tile is already held by a different touch, ignore
						if (heldTiles.has(actor) && heldTiles.get(actor) !== index) {
							return;
						}

						// Check 2-finger limit: if 2 OTHER tiles are already held, reject 3rd touch
						var otherCount = countOtherHeldTiles(actor);
						if (otherCount >= MAX_SIMULTANEOUS_TILES) {
							log('2-finger max reached. Rejecting touch ' + index + ' on tile.');
							return;
						}

						// Run native touchDown hit testing
						var res = origTouchDown.call(this, index, locationInViewX, locationInViewY);

						// If hit test succeeded and touch is over this actor
						if (this.trackingTouch === index) {
							if (countOtherHeldTiles(actor) < MAX_SIMULTANEOUS_TILES) {
								initTileDrag(actor, index, locationInViewX, locationInViewY);
								log('Grabbed tile cleanly with touch ' + index + '. Total held:', heldTiles.size);
							} else {
								this.trackingTouch = null;
								this.setState(false);
							}
						}
						return res;
					}

					return origTouchDown.call(this, index, locationInViewX, locationInViewY);
				});
			}

			// Hook touchUp: calculate throw velocity and preserve momentum WITHOUT velocity loss
			var origTouchUp = targetObj.touchUp;
			if (typeof origTouchUp === 'function' && !targetObj._touchUpHooked) {
				targetObj._touchUpHooked = true;
				safeOverride(targetObj, 'touchUp', function (index, locationInViewX, locationInViewY) {
					recordTouchSample(index, locationInViewX, locationInViewY);
					touchActive.set(index, false);

					var actor = this._entity;
					var isLetter = actor && isLetterTile(actor);
					var isOurTouch = isLetter && (this.trackingTouch === index || heldTiles.get(actor) === index);

					if (isOurTouch) {
						cleanReleaseTile(actor, index, locationInViewX, locationInViewY);
					}

					var result = origTouchUp.call(this, index, locationInViewX, locationInViewY);

					// Ensure game.Dragging & mouse.button remain true if another tile is still held
					if (countActiveHeldTiles() > 0) {
						var game = gs.Game && (gs.Game.current || gs.Game.instance);
						if (game && game.attributes && game.attributes.id104408) {
							game.attributes.id104408.setValue(true);
						}
						if (game && game.devices && game.devices.mouse && game.devices.mouse.button) {
							game.devices.mouse.button.setValue(true);
						}
					}

					return result;
				});
			}

			// Hook touchCancel
			var origTouchCancel = targetObj.touchCancel;
			if (typeof origTouchCancel === 'function' && !targetObj._touchCancelHooked) {
				targetObj._touchCancelHooked = true;
				safeOverride(targetObj, 'touchCancel', function () {
					var actor = this._entity;
					var isLetter = actor && isLetterTile(actor);
					if (isLetter && heldTiles.has(actor)) {
						var idx = heldTiles.get(actor);
						cleanReleaseTile(actor, idx, 0, 0);
					}
					var res = origTouchCancel.call(this);
					if (countActiveHeldTiles() > 0) {
						var game = gs.Game && (gs.Game.current || gs.Game.instance);
						if (game && game.attributes && game.attributes.id104408) {
							game.attributes.id104408.setValue(true);
						}
						if (game && game.devices && game.devices.mouse && game.devices.mouse.button) {
							game.devices.mouse.button.setValue(true);
						}
					}
					return res;
				});
			}
		});

		// 8. Hook ConstrainAttributeBehavior: NEVER brake or zero a tile that is not currently held or releasing!
		var Constrain = gs.ConstrainAttributeBehavior;
		var constrainTargets = [Constrain];
		if (Constrain && Constrain.prototype && Constrain.prototype !== Constrain) constrainTargets.push(Constrain.prototype);

		constrainTargets.forEach(function (targetObj) {
			if (!targetObj || !targetObj.everyFrame || targetObj._constrainHooked) return;
			targetObj._constrainHooked = true;
			var origConstrainEveryFrame = targetObj.everyFrame;
			safeOverride(targetObj, 'everyFrame', function (actor, timestamp) {
				if (isLetterTile(actor) && (!heldTiles.has(actor) || actor._releasing)) {
					// Tile has been released or is not held! Do not let constrain brake its throw momentum
					return;
				}
				return origConstrainEveryFrame.apply(this, arguments);
			});
		});

		// 9. Hook gs.Condition: route game.Dragging (id104408) & mouse.button per tile actor
		var Cond = gs.Condition;
		if (Cond && Cond.prototype && !Cond.prototype._conditionHooked) {
			Cond.prototype._conditionHooked = true;

			var origCondDidEnter = Cond.prototype.didEnter;
			safeOverride(Cond.prototype, 'didEnter', function (actor, isInitTime, rule, ruleIndex) {
				this._entity = actor;
				var ref = this.attributes && this.attributes.subjectAttribute && this.attributes.subjectAttribute.getValue();
				this._subjectKeypath = ref && ref.keypath ? ref.keypath : null;
				return origCondDidEnter.apply(this, arguments);
			});

			var origTestAttribute = Cond.prototype.testAttribute;
			safeOverride(Cond.prototype, 'testAttribute', function () {
				var actor = this._entity;
				if (actor && isLetterTile(actor)) {
					var kp = this._subjectKeypath;
					var game = gs.Game && (gs.Game.current || gs.Game.instance);
					var isDragAttr = (kp === 'game.attributes.id104408') || (game && game.attributes && this.subjectAttribute === game.attributes.id104408);
					var isMouseBtn = (kp === 'game.devices.mouse.button') || (game && game.devices && game.devices.mouse && this.subjectAttribute === game.devices.mouse.button);

					// Dragging condition
					if (isDragAttr) {
						if (actor._releasing) {
							return this.predicate ? this.predicate.testValue(false) : false;
						}
						var selfDragging = false;
						if (actor.attributes && actor.attributes.id110061) {
							selfDragging = !!actor.attributes.id110061.getValue();
						}
						// If active or held, passes active drag condition
						if (selfDragging || heldTiles.has(actor)) {
							return this.predicate ? this.predicate.testValue(true) : false;
						}
						// If not dragging, can start if other held tiles < 2
						var otherCount = countOtherHeldTiles(actor);
						var canStart = otherCount < MAX_SIMULTANEOUS_TILES;
						return this.predicate ? this.predicate.testValue(!canStart) : false;
					}

					// Mouse button condition
					if (isMouseBtn) {
						var isDown = true;
						if (actor._releasing) {
							isDown = false;
						} else if (heldTiles.has(actor)) {
							var touchIdx = heldTiles.get(actor);
							isDown = touchActive.get(touchIdx) !== false;
						} else {
							isDown = countActiveHeldTiles() > 0;
						}
						return this.predicate ? this.predicate.testValue(isDown) : false;
					}
				}
				return origTestAttribute.apply(this, arguments);
			});

			var origObserveValueChange = Cond.prototype.observeValueChange;
			safeOverride(Cond.prototype, 'observeValueChange', function (attribute, value) {
				var actor = this._entity;
				if (actor && isLetterTile(actor)) {
					var kp = this._subjectKeypath;
					var game = gs.Game && (gs.Game.current || gs.Game.instance);
					var isDragAttr = (kp === 'game.attributes.id104408') || (game && game.attributes && attribute === game.attributes.id104408);
					var isMouseBtn = (kp === 'game.devices.mouse.button') || (game && game.devices && game.devices.mouse && attribute === game.devices.mouse.button);

					if (isDragAttr) {
						if (actor._releasing) {
							if (this.predicate) this.predicate.valueChanged(false);
							return;
						}
						var selfDragging = false;
						if (actor.attributes && actor.attributes.id110061) {
							selfDragging = !!actor.attributes.id110061.getValue();
						}
						if (selfDragging || heldTiles.has(actor)) {
							if (this.predicate) this.predicate.valueChanged(true);
							return;
						}
						var otherCount = countOtherHeldTiles(actor);
						var canStart = otherCount < MAX_SIMULTANEOUS_TILES;
						if (this.predicate) this.predicate.valueChanged(!canStart);
						return;
					}
					if (isMouseBtn) {
						var isDown = true;
						if (actor._releasing) {
							isDown = false;
						} else if (heldTiles.has(actor)) {
							var touchIdx = heldTiles.get(actor);
							isDown = touchActive.get(touchIdx) !== false;
						} else {
							isDown = countActiveHeldTiles() > 0;
						}
						if (this.predicate) {
							this.predicate.valueChanged(isDown);
						}
						return;
					}
				}
				return origObserveValueChange.apply(this, arguments);
			});
		}

		// 10. Hook gs.Expression: route touch positions & button state per actor
		var Expr = gs.Expression;
		var exprTargets = [Expr];
		if (Expr && Expr.prototype && Expr.prototype !== Expr) exprTargets.push(Expr.prototype);

		exprTargets.forEach(function (targetObj) {
			if (!targetObj) return;

			// Hook evaluateForEntityStateless
			if (typeof targetObj.evaluateForEntityStateless === 'function' && !targetObj._statelessHooked) {
				targetObj._statelessHooked = true;
				var origEvaluateForEntityStateless = targetObj.evaluateForEntityStateless;
				safeOverride(targetObj, 'evaluateForEntityStateless', function (entity) {
					var expressionTree = this.expressionTree;
					var inputReferences = this.inputReferences;

					if (inputReferences) {
						for (var keypath in inputReferences) {
							var reference = inputReferences[keypath];
							var attribute = reference.resolveRelativeTo(entity);
							if (!attribute) continue;
							var val = attribute.getValue();
							expressionTree.setVariable(keypath, routedValue(entity, keypath, val));
						}
					}
					return expressionTree.evaluateRoot();
				});
			}

			// Hook evaluateForEntity
			if (typeof targetObj.evaluateForEntity === 'function' && !targetObj._entityHooked) {
				targetObj._entityHooked = true;
				var origEvaluateForEntity = targetObj.evaluateForEntity;
				safeOverride(targetObj, 'evaluateForEntity', function (entity) {
					if (entity !== this.entity) {
						this.resolveInputAttributesForEntity(entity);
						this.entity = entity;
						this.needsUpdate = true;
					}
					if (!this.isObservingAttributes) {
						this.observeInputs(this.inputAttributes);
					}

					var inputAttributes = this.inputAttributes;
					var expressionTree = this.expressionTree;

					for (var keypath in inputAttributes) {
						var attribute = inputAttributes[keypath];
						var val = attribute ? attribute.getValue() : 0;
						expressionTree.setVariable(keypath, routedValue(entity, keypath, val));
					}
					this.needsUpdate = this.alwaysNeedsUpdate;
					return expressionTree.evaluateRoot();
				});
			}
		});

		// 11. Hook Scene changes: cleanly reset state on scene reload/transition
		if (gs.EngineContext && gs.EngineContext.current) {
			var engineContext = gs.EngineContext.current;
			if (engineContext.delegate) {
				var origOnSceneAboutToChange = engineContext.delegate.onSceneAboutToChange;
				engineContext.delegate.onSceneAboutToChange = function () {
					heldTiles.clear();
					touchToActor.clear();
					touchHistory.clear();
					touchPositions.clear();
					touchActive.clear();
					if (origOnSceneAboutToChange) {
						return origOnSceneAboutToChange.apply(this, arguments);
					}
				};
			}
		}

		installed = true;
		if (global.console) {
			console.log('[WordChainMultitouch] Installed successfully: 2-finger MAX, independent grip lock & throw physics active.');
		}
		return true;
	}

	global.WordChainMultitouch = {
		install: install,
		get maxTiles() { return MAX_SIMULTANEOUS_TILES; },
		get heldCount() { return heldTiles.size; },
		get debug() { return debug; },
		set debug(val) { debug = !!val; }
	};

})(typeof window !== 'undefined' ? window : this);
