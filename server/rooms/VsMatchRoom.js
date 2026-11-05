import crypto from 'node:crypto';
import { Room } from '@colyseus/core';
import { loadLevels } from '../levelsLoader.js';
import * as store from '../store.js';

// In-memory registry mapping 4-char friend room codes -> active waiting room metadata
const friendRoomRegistry = new Map();
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateUniqueRoomCode() {
	for (let attempt = 0; attempt < 50; attempt++) {
		let code = '';
		for (let i = 0; i < 4; i++) {
			code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
		}
		if (!friendRoomRegistry.has(code)) {
			return code;
		}
	}
	return crypto.randomBytes(2).toString('hex').toUpperCase();
}

function lookupFriendRoom(code) {
	if (!code || typeof code !== 'string') return null;
	const normalized = code.trim().toUpperCase();
	const entry = friendRoomRegistry.get(normalized);
	if (!entry || entry.status !== 'waiting') return null;
	return entry;
}

class VsMatchRoom extends Room {
	onCreate(options = {}) {
		this.levels = loadLevels();
		this.maxClients = 2;

		const requestedMode = options.mode === 'friend' ? 'friend' : 'quick';
		this.requestedMode = requestedMode;
		this.matchMode = requestedMode === 'friend' ? 'friend' : 'live';
		this.roomCode = null;

		this.phase = 'waiting_opponent'; // 'waiting_opponent' | 'loading' | 'racing' | 'finished'
		this.levelIndex = 0;
		this.numSolvableRows = 0;
		this.ghostRun = null;

		this.players = {
			p1: null,
			p2: null
		};
		this.sessionToSlot = new Map();
		this.readySlots = new Set();
		this.rematchVotes = new Set();

		this.firstSolverByRow = {};
		this.matchFinished = false;
		this.winnerSlot = null;
		this.raceStartAt = 0;

		this.quickWaitTimer = null;
		this.readyFallbackTimer = null;
		this.ghostTimers = [];

		this.quickWaitMs = Math.max(800, Math.min(12000, Number(options.quickWaitMs) || 4200));

		if (requestedMode === 'friend') {
			// Private room: never match random strangers into a Friend Room!
			this.setPrivate(true);
			this.roomCode = generateUniqueRoomCode();
			friendRoomRegistry.set(this.roomCode, {
				roomId: this.roomId,
				code: this.roomCode,
				status: 'waiting',
				createdAt: Date.now()
			});
		} else {
			this.setMetadata({
				mode: 'quick',
				hostWpm: Math.max(6, Math.min(50, Number(options.wpm) || 12))
			});
		}

		// Client signals that level entrance animation finished and tiles are on board
		this.onMessage('ready_for_race', (client) => {
			const slot = this.sessionToSlot.get(client.sessionId);
			if (!slot || this.phase !== 'loading') return;
			this.readySlots.add(slot);

			const requiredHumans = this.matchMode === 'ghost' ? 1 : 2;
			if (this.readySlots.size >= requiredHumans) {
				this.startRace();
			}
		});

		// Client submits a solved word row
		this.onMessage('row_solved', (client, payload) => {
			const slot = this.sessionToSlot.get(client.sessionId);
			if (!slot || this.phase !== 'racing' || this.matchFinished) return;

			const row = Number(payload && payload.row);
			const spelled = String((payload && payload.word) || '').trim().toUpperCase();
			const lvl = this.levels[this.levelIndex];
			if (!lvl || !lvl.words || !lvl.words[row]) return;

			const expectedAnswer = String(lvl.words[row].answer || '').trim().toUpperCase();
			if (spelled !== expectedAnswer) {
				return;
			}

			this.recordRowSolved(slot, row, null);
		});

		// Friend / Live instant rematch vote
		this.onMessage('request_rematch', (client) => {
			const slot = this.sessionToSlot.get(client.sessionId);
			if (!slot || this.phase !== 'finished') return;

			if (this.matchMode === 'ghost') {
				// Instant Ghost Rematch: pick fresh level & best matching ghost run
				this.pickFreshSharedLevel();
				const ghost = store.getBestOpponentRun(this.levelIndex, this.players.p1 ? this.players.p1.baseWpm : 12, this.players.p1 ? this.players.p1.playerId : '');
				if (ghost) {
					this.ghostRun = ghost;
					this.players.p2 = {
						playerId: ghost.playerId,
						username: ghost.username,
						avatar: ghost.avatar,
						baseWpm: ghost.wpm,
						isGhost: true,
						liveWpm: ghost.wpm,
						rowsSolved: 0,
						rowSolveTimesMs: [],
						finishMs: null,
						completed: false
					};
				}
				this.beginMatchCountdown();
				return;
			}

			if (this.clients.length < 2) {
				client.send('rematch_unavailable', { message: 'Opponent has left the room.' });
				return;
			}

			this.rematchVotes.add(slot);
			const requester = this.players[slot];
			this.broadcast('rematch_status', {
				votes: Array.from(this.rematchVotes),
				requesterSlot: slot,
				requesterUsername: requester ? requester.username : 'Opponent',
				needed: 2
			});

			if (this.rematchVotes.size >= 2) {
				this.pickFreshSharedLevel();
				this.beginMatchCountdown();
			}
		});
	}

	onJoin(client, options = {}) {
		const playerId = String(options.playerId || ('anon_' + client.sessionId)).slice(0, 64);
		const username = store.sanitizeUsername(options.username, playerId);
		const avatar = store.sanitizeAvatar(options.avatar);
		const baseWpm = Math.max(6, Math.min(55, Math.round(Number(options.wpm) || 11)));
		const lastLevelIndex = Number.isInteger(options.lastLevelIndex) ? options.lastLevelIndex : -1;

		// Keep any earlier Solo runs from this player labeled with their latest username & avatar
		if (typeof options.username === 'string' && options.username.trim().length >= 2) {
			try {
				store.updatePlayerProfile({ playerId, username, avatar });
			} catch (_) {}
		}

		const slot = !this.players.p1 ? 'p1' : 'p2';
		this.sessionToSlot.set(client.sessionId, slot);
		this.players[slot] = {
			slot,
			sessionId: client.sessionId,
			isGhost: false,
			playerId,
			username,
			avatar,
			baseWpm,
			lastLevelIndex,
			liveWpm: 0,
			rowsSolved: 0,
			rowSolveTimesMs: [],
			finishMs: null,
			completed: false
		};

		if (this.requestedMode === 'friend') {
			if (slot === 'p1') {
				client.send('friend_room_created', {
					roomCode: this.roomCode,
					roomId: this.roomId
				});
			} else if (slot === 'p2' && this.players.p1) {
				const reg = friendRoomRegistry.get(this.roomCode);
				if (reg) reg.status = 'matched';
				this.lock();
				this.matchMode = 'friend';
				this.pickFreshSharedLevel();
				this.beginMatchCountdown();
			}
			return;
		}

		// Quick Match mode
		if (slot === 'p1') {
			client.send('searching_live', { waitMs: this.quickWaitMs });
			this.quickWaitTimer = setTimeout(() => {
				this.quickWaitTimer = null;
				if (this.phase === 'waiting_opponent' && this.clients.length === 1) {
					this.matchWithGhostOrReject();
				}
			}, this.quickWaitMs);
		} else if (slot === 'p2' && this.players.p1) {
			if (this.quickWaitTimer) {
				clearTimeout(this.quickWaitTimer);
				this.quickWaitTimer = null;
			}
			this.lock();
			this.matchMode = 'live';
			this.pickFreshSharedLevel();
			this.beginMatchCountdown();
		}
	}

	pickFreshSharedLevel() {
		const total = this.levels.length;
		const avoidA = this.players.p1 ? this.players.p1.lastLevelIndex : -1;
		const avoidB = this.players.p2 ? this.players.p2.lastLevelIndex : -1;
		const avoidCurrent = this.levelIndex;

		const candidates = [];
		for (let i = 0; i < total; i++) {
			if (i !== avoidA && i !== avoidB && i !== avoidCurrent) {
				candidates.push(i);
			}
		}
		const pool = candidates.length > 0 ? candidates : Array.from({ length: total }, (_, i) => i);
		this.levelIndex = pool[Math.floor(Math.random() * pool.length)];
	}

	matchWithGhostOrReject() {
		this.lock();
		const p1 = this.players.p1;
		if (!p1) return;

		const ghostRun = store.findMatchedGhostRun({
			excludePlayerId: p1.playerId,
			targetWpm: p1.baseWpm,
			lastLevelIndex: p1.lastLevelIndex
		}, this.levels);

		// STRICT RULE: Never start a fake empty match against synthetic timers!
		if (!ghostRun) {
			const c1 = this.clients[0];
			if (c1) {
				c1.send('no_opponent_found', {
					reason: 'empty_ghost_pool',
					message: 'No live opponent online & no recorded runs yet! Complete 1 Solo chain first, or invite a Friend with a Room Code.'
				});
			}
			setTimeout(() => {
				try { this.disconnect(4000); } catch (e) {}
			}, 150);
			return;
		}

		this.matchMode = 'ghost';
		this.ghostRun = ghostRun;
		this.levelIndex = ghostRun.levelIndex;

		// Keep recorded avatar & username; if self-fallback chose identical avatar/name, make Blue vs Red distinct
		let ghostAvatar = ghostRun.avatar;
		let ghostUsername = store.sanitizeUsername(ghostRun.username, ghostRun.playerId);
		if (ghostRun.playerId === p1.playerId) {
			if (ghostAvatar === p1.avatar) {
				ghostAvatar = p1.avatar === 'Character_9.png' ? 'Character_8.png' : 'Character_9.png';
			}
			if (ghostUsername.toLowerCase() === (p1.username || '').toLowerCase()) {
				ghostUsername = `${ghostUsername.slice(0, 10)} 👻`;
			}
		}

		this.players.p2 = {
			slot: 'p2',
			sessionId: null,
			isGhost: true,
			ghostRunId: ghostRun.id,
			playerId: `ghost:${ghostRun.playerId}`,
			username: ghostUsername,
			avatar: ghostAvatar,
			baseWpm: Math.max(5, Math.round(ghostRun.avgWpm)),
			lastLevelIndex: ghostRun.levelIndex,
			liveWpm: 0,
			rowsSolved: 0,
			rowSolveTimesMs: [],
			finishMs: null,
			completed: false
		};

		this.beginMatchCountdown();
	}

	beginMatchCountdown() {
		this.clearRaceTimers();
		this.phase = 'loading';
		this.matchFinished = false;
		this.winnerSlot = null;
		this.firstSolverByRow = {};
		this.readySlots.clear();
		this.rematchVotes.clear();

		const lvl = this.levels[this.levelIndex];
		this.numSolvableRows = (lvl && Array.isArray(lvl.words)) ? (lvl.words.length - 1) : 4;

		['p1', 'p2'].forEach((s) => {
			const p = this.players[s];
			if (p) {
				p.liveWpm = 0;
				p.rowsSolved = 0;
				p.rowSolveTimesMs = [];
				p.finishMs = null;
				p.completed = false;
				p.lastLevelIndex = this.levelIndex;
			}
		});

		for (const client of this.clients) {
			const mySlot = this.sessionToSlot.get(client.sessionId);
			const oppSlot = mySlot === 'p1' ? 'p2' : 'p1';
			const me = this.players[mySlot];
			const opp = this.players[oppSlot];
			if (!me || !opp) continue;

			client.send('match_found', {
				roomId: this.roomId,
				matchMode: this.matchMode,
				roomCode: this.roomCode,
				yourSlot: mySlot,
				levelIndex: this.levelIndex,
				you: {
					playerId: me.playerId,
					username: me.username,
					avatar: me.avatar,
					baseWpm: me.baseWpm
				},
				opponent: {
					playerId: opp.playerId,
					username: opp.username,
					avatar: opp.avatar,
					baseWpm: opp.baseWpm,
					isGhost: !!opp.isGhost
				}
			});
		}

		// Safety fallback so a slow device entrance never hangs race start beyond 2.4s
		this.readyFallbackTimer = setTimeout(() => {
			this.readyFallbackTimer = null;
			if (this.phase === 'loading') {
				this.startRace();
			}
		}, 2400);
	}

	startRace() {
		if (this.phase !== 'loading') return;
		if (this.readyFallbackTimer) {
			clearTimeout(this.readyFallbackTimer);
			this.readyFallbackTimer = null;
		}

		this.phase = 'racing';
		this.raceStartAt = Date.now();

		this.broadcast('race_start', {
			raceStartAt: this.raceStartAt,
			levelIndex: this.levelIndex
		});

		// Schedule authoritative replay of real recorded human split times in Ghost mode
		if (this.matchMode === 'ghost' && this.ghostRun && Array.isArray(this.ghostRun.rowSolveTimesMs)) {
			this.ghostRun.rowSolveTimesMs.forEach((solveMs, idx) => {
				const targetRow = idx + 1;
				const delay = Math.max(300, Number(solveMs));
				const tid = setTimeout(() => {
					this.recordRowSolved('p2', targetRow, delay);
				}, delay);
				this.ghostTimers.push(tid);
			});
		}
	}

	recordRowSolved(slot, row, explicitElapsedMs) {
		if (this.phase !== 'racing' || this.matchFinished) return;
		const pState = this.players[slot];
		if (!pState) return;

		// Enforce sequential solving from Row 1 .. numSolvableRows
		if (row !== pState.rowsSolved + 1 || row < 1 || row > this.numSolvableRows) {
			return;
		}

		const rawElapsed = explicitElapsedMs != null
			? explicitElapsedMs
			: Math.max(300, Date.now() - this.raceStartAt);
		const prevTime = pState.rowSolveTimesMs.length > 0
			? pState.rowSolveTimesMs[pState.rowSolveTimesMs.length - 1]
			: 0;
		const elapsedMs = Math.max(prevTime + 260, Math.round(rawElapsed));

		pState.rowsSolved = row;
		pState.rowSolveTimesMs.push(elapsedMs);
		pState.liveWpm = Math.max(4, Math.min(85, Math.round((row / (elapsedMs / 1000)) * 60)));

		// Lock tray color to whichever player FIRST solved this word
		if (!this.firstSolverByRow[row]) {
			this.firstSolverByRow[row] = slot;
		}

		this.broadcast('row_update', {
			row,
			solverSlot: slot,
			firstSolverSlot: this.firstSolverByRow[row],
			p1Wpm: this.players.p1 ? this.players.p1.liveWpm : 0,
			p2Wpm: this.players.p2 ? this.players.p2.liveWpm : 0,
			p1Rows: this.players.p1 ? this.players.p1.rowsSolved : 0,
			p2Rows: this.players.p2 ? this.players.p2.rowsSolved : 0,
			elapsedMs
		});

		// First player to complete the final word of the chain wins!
		if (row >= this.numSolvableRows) {
			this.concludeMatch(slot, false);
		}
	}

	concludeMatch(winnerSlot, byForfeit) {
		if (this.matchFinished) return;
		this.matchFinished = true;
		this.phase = 'finished';
		this.winnerSlot = winnerSlot;
		this.clearGhostTimers();

		const winner = this.players[winnerSlot];
		if (winner && !byForfeit) {
			winner.completed = true;
			winner.finishMs = winner.rowSolveTimesMs[winner.rowSolveTimesMs.length - 1] || (Date.now() - this.raceStartAt);

			// Save the winning live human's real run into player_runs as future Ghost source material!
			if (!winner.isGhost && winner.rowSolveTimesMs.length === this.numSolvableRows) {
				try {
					store.savePlayerRun({
						playerId: winner.playerId,
						username: winner.username,
						avatar: winner.avatar,
						source: `vs_${this.matchMode}`,
						levelIndex: this.levelIndex,
						rowSolveTimesMs: winner.rowSolveTimesMs
					}, this.levels);
				} catch (err) {
					console.warn('[VsMatchRoom] Skipped saving player run:', err.message);
				}
			}
		}

		const p1 = this.players.p1 || { playerId: 'none', username: 'Player 1', avatar: 'Character_8.png', liveWpm: 0, rowsSolved: 0, finishMs: null, completed: false };
		const p2 = this.players.p2 || { playerId: 'none', username: 'Player 2', avatar: 'Character_9.png', liveWpm: 0, rowsSolved: 0, finishMs: null, completed: false };

		let matchId = null;
		try {
			matchId = store.saveMatchResult({
				roomId: this.roomId,
				matchMode: this.matchMode,
				roomCode: this.roomCode,
				levelIndex: this.levelIndex,
				ghostSourceRunId: this.ghostRun ? this.ghostRun.id : null,
				p1: {
					playerId: p1.playerId,
					username: p1.username,
					avatar: p1.avatar,
					wpm: p1.liveWpm || p1.baseWpm || 0,
					rowsSolved: p1.rowsSolved,
					finishMs: p1.finishMs,
					completed: p1.completed
				},
				p2: {
					playerId: p2.playerId,
					username: p2.username,
					avatar: p2.avatar,
					wpm: p2.liveWpm || p2.baseWpm || 0,
					rowsSolved: p2.rowsSolved,
					finishMs: p2.finishMs,
					completed: p2.completed
				},
				firstSolverByRow: this.firstSolverByRow,
				winnerSlot: byForfeit ? `${winnerSlot}_forfeit` : winnerSlot,
				winnerPlayerId: winner ? winner.playerId : null
			});
		} catch (err) {
			console.error('[VsMatchRoom] Failed to save match result:', err);
		}

		this.broadcast('match_finished', {
			matchId,
			matchMode: this.matchMode,
			levelIndex: this.levelIndex,
			totalRows: this.numSolvableRows,
			winnerSlot,
			byForfeit: !!byForfeit,
			p1Username: p1.username,
			p2Username: p2.username,
			p1Wpm: p1.liveWpm || p1.baseWpm || 0,
			p2Wpm: p2.liveWpm || p2.baseWpm || 0,
			p1Rows: p1.rowsSolved || 0,
			p2Rows: p2.rowsSolved || 0,
			p1FinishMs: p1.finishMs || null,
			p2FinishMs: p2.finishMs || null,
			firstSolverByRow: this.firstSolverByRow,
			canRematch: !byForfeit && (
				((this.matchMode === 'friend' || this.matchMode === 'live') && this.clients.length === 2) ||
				(this.matchMode === 'ghost' && this.clients.length === 1)
			)
		});
	}

	onLeave(client) {
		const leftSlot = this.sessionToSlot.get(client.sessionId);
		this.sessionToSlot.delete(client.sessionId);

		if (this.roomCode) {
			friendRoomRegistry.delete(this.roomCode);
		}

		// If a live opponent disconnects mid-race, award victory to the remaining player and record result
		if ((this.phase === 'loading' || this.phase === 'racing') && !this.matchFinished && this.matchMode !== 'ghost') {
			const remainingSlot = leftSlot === 'p1' ? 'p2' : 'p1';
			if (this.players[remainingSlot] && this.clients.length > 0) {
				if (this.phase === 'loading') {
					this.phase = 'racing';
					this.raceStartAt = Date.now();
				}
				this.concludeMatch(remainingSlot, true);
			}
		} else if (this.phase === 'finished') {
			this.broadcast('rematch_unavailable', { message: 'Opponent left the match.' });
		}
	}

	clearGhostTimers() {
		if (this.ghostTimers && this.ghostTimers.length > 0) {
			this.ghostTimers.forEach((t) => clearTimeout(t));
		}
		this.ghostTimers = [];
	}

	clearRaceTimers() {
		if (this.quickWaitTimer) {
			clearTimeout(this.quickWaitTimer);
			this.quickWaitTimer = null;
		}
		if (this.readyFallbackTimer) {
			clearTimeout(this.readyFallbackTimer);
			this.readyFallbackTimer = null;
		}
		this.clearGhostTimers();
	}

	onDispose() {
		this.clearRaceTimers();
		if (this.roomCode) {
			friendRoomRegistry.delete(this.roomCode);
		}
	}
}

export {
	VsMatchRoom,
	lookupFriendRoom
};
