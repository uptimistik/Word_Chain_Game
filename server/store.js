import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
	fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = process.env.WORD_CHAIN_DB_PATH || path.join(DATA_DIR, 'wordchain.sqlite');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
CREATE TABLE IF NOT EXISTS player_runs (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	run_uuid TEXT UNIQUE NOT NULL,
	player_id TEXT NOT NULL,
	username TEXT NOT NULL DEFAULT '',
	avatar TEXT NOT NULL,
	source TEXT NOT NULL,
	level_index INTEGER NOT NULL,
	num_solvable_rows INTEGER NOT NULL,
	total_duration_ms INTEGER NOT NULL,
	avg_wpm REAL NOT NULL,
	row_solve_times_json TEXT NOT NULL,
	created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_player_runs_wpm ON player_runs(avg_wpm);
CREATE INDEX IF NOT EXISTS idx_player_runs_player ON player_runs(player_id);
CREATE INDEX IF NOT EXISTS idx_player_runs_level ON player_runs(level_index);

CREATE TABLE IF NOT EXISTS match_results (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	match_id TEXT UNIQUE NOT NULL,
	room_id TEXT NOT NULL,
	match_mode TEXT NOT NULL,
	room_code TEXT,
	level_index INTEGER NOT NULL,
	ghost_source_run_id INTEGER,
	p1_player_id TEXT NOT NULL,
	p1_username TEXT NOT NULL DEFAULT '',
	p1_avatar TEXT NOT NULL,
	p1_wpm REAL NOT NULL,
	p1_rows_solved INTEGER NOT NULL,
	p1_finish_ms INTEGER,
	p1_completed INTEGER NOT NULL,
	p2_player_id TEXT NOT NULL,
	p2_username TEXT NOT NULL DEFAULT '',
	p2_avatar TEXT NOT NULL,
	p2_wpm REAL NOT NULL,
	p2_rows_solved INTEGER NOT NULL,
	p2_finish_ms INTEGER,
	p2_completed INTEGER NOT NULL,
	first_solver_by_row_json TEXT NOT NULL,
	winner_slot TEXT NOT NULL,
	winner_player_id TEXT,
	created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_match_results_created ON match_results(created_at DESC);
`);

// Safe non-destructive migration for existing SQLite databases created prior to username support
function ensureColumnExists(tableName, columnName, columnDef) {
	const cols = db.prepare(`PRAGMA table_info(${tableName})`).all();
	if (!cols.some((c) => c.name === columnName)) {
		db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDef}`);
	}
}
ensureColumnExists('player_runs', 'username', "TEXT NOT NULL DEFAULT ''");
ensureColumnExists('match_results', 'p1_username', "TEXT NOT NULL DEFAULT ''");
ensureColumnExists('match_results', 'p2_username', "TEXT NOT NULL DEFAULT ''");

const VALID_AVATARS = new Set([
	'Character_1.png',
	'Character_2.png',
	'Character_3.png',
	'Character_4.png',
	'Character_5.png',
	'Character_6.png',
	'Character_7.png',
	'Character_8.png',
	'Character_9.png'
]);

function sanitizeAvatar(avatar) {
	return VALID_AVATARS.has(avatar) ? avatar : 'Character_8.png';
}

function sanitizeUsername(rawName, fallbackId = '') {
	if (typeof rawName === 'string') {
		const cleaned = rawName
			.replace(/[^\p{L}\p{N} _.\-]/gu, '')
			.replace(/\s+/g, ' ')
			.trim()
			.slice(0, 14);
		if (cleaned.length >= 2) {
			return cleaned;
		}
	}
	const seed = String(fallbackId || 'guest').replace(/^ghost:/, '');
	let hash = 0;
	for (let i = 0; i < seed.length; i++) {
		hash = ((hash * 31) + seed.charCodeAt(i)) >>> 0;
	}
	return `Player ${(hash % 900) + 100}`;
}

const insertRunStmt = db.prepare(`
	INSERT OR IGNORE INTO player_runs (
		run_uuid, player_id, username, avatar, source, level_index, num_solvable_rows,
		total_duration_ms, avg_wpm, row_solve_times_json, created_at
	) VALUES (
		@run_uuid, @player_id, @username, @avatar, @source, @level_index, @num_solvable_rows,
		@total_duration_ms, @avg_wpm, @row_solve_times_json, @created_at
	)
`);

const insertMatchStmt = db.prepare(`
	INSERT OR IGNORE INTO match_results (
		match_id, room_id, match_mode, room_code, level_index, ghost_source_run_id,
		p1_player_id, p1_username, p1_avatar, p1_wpm, p1_rows_solved, p1_finish_ms, p1_completed,
		p2_player_id, p2_username, p2_avatar, p2_wpm, p2_rows_solved, p2_finish_ms, p2_completed,
		first_solver_by_row_json, winner_slot, winner_player_id, created_at
	) VALUES (
		@match_id, @room_id, @match_mode, @room_code, @level_index, @ghost_source_run_id,
		@p1_player_id, @p1_username, @p1_avatar, @p1_wpm, @p1_rows_solved, @p1_finish_ms, @p1_completed,
		@p2_player_id, @p2_username, @p2_avatar, @p2_wpm, @p2_rows_solved, @p2_finish_ms, @p2_completed,
		@first_solver_by_row_json, @winner_slot, @winner_player_id, @created_at
	)
`);

const updateRunProfileStmt = db.prepare(`
	UPDATE player_runs
	SET username = @username, avatar = @avatar
	WHERE player_id = @player_id
`);

/**
 * Validates and persists a real completed human chain run for future Ghost match-ups.
 */
function savePlayerRun({ runUuid, playerId, username, avatar, source, levelIndex, rowSolveTimesMs }, levels) {
	if (!playerId || typeof playerId !== 'string') {
		throw new Error('Missing playerId');
	}
	const idx = Number(levelIndex);
	if (!Number.isInteger(idx) || idx < 0 || idx >= levels.length) {
		throw new Error('Invalid levelIndex');
	}
	const expectedSolvable = levels[idx].words.length - 1;
	if (!Array.isArray(rowSolveTimesMs) || rowSolveTimesMs.length !== expectedSolvable || expectedSolvable < 1) {
		throw new Error(`Expected ${expectedSolvable} rowSolveTimesMs entries`);
	}

	const cleanedTimes = [];
	let prev = 0;
	for (let i = 0; i < rowSolveTimesMs.length; i++) {
		const t = Math.round(Number(rowSolveTimesMs[i]));
		if (!Number.isFinite(t) || t <= prev || t > 600000) {
			throw new Error('Invalid monotonic rowSolveTimesMs');
		}
		// Enforce realistic human minimum delta per word (>= 250ms)
		if (t - prev < 250) {
			throw new Error('Unrealistic split timing');
		}
		cleanedTimes.push(t);
		prev = t;
	}

	const totalDurationMs = cleanedTimes[cleanedTimes.length - 1];
	const avgWpm = Math.round(((expectedSolvable / (totalDurationMs / 1000)) * 60) * 100) / 100;
	if (avgWpm < 1 || avgWpm > 150) {
		throw new Error('Out-of-bounds WPM');
	}

	const uuid = (typeof runUuid === 'string' && runUuid.length >= 8)
		? runUuid
		: crypto.randomUUID();
	const createdAt = new Date().toISOString();

	const cleanPid = playerId.slice(0, 64);
	const cleanUsername = sanitizeUsername(username, cleanPid);
	const cleanAvatar = sanitizeAvatar(avatar);

	const info = insertRunStmt.run({
		run_uuid: uuid,
		player_id: cleanPid,
		username: cleanUsername,
		avatar: cleanAvatar,
		source: String(source || 'solo').slice(0, 24),
		level_index: idx,
		num_solvable_rows: expectedSolvable,
		total_duration_ms: totalDurationMs,
		avg_wpm: avgWpm,
		row_solve_times_json: JSON.stringify(cleanedTimes),
		created_at: createdAt
	});

	// If the player provided a custom username, retroactively keep their earlier runs labeled with it
	if (typeof username === 'string' && username.trim().length >= 2) {
		updateRunProfileStmt.run({
			player_id: cleanPid,
			username: cleanUsername,
			avatar: cleanAvatar
		});
	}

	const row = db.prepare('SELECT id, run_uuid, username, avg_wpm, level_index, total_duration_ms FROM player_runs WHERE run_uuid = ?').get(uuid);
	return { inserted: info.changes > 0, run: row };
}

function updatePlayerProfile({ playerId, username, avatar }) {
	if (!playerId || typeof playerId !== 'string') {
		throw new Error('Missing playerId');
	}
	const cleanPid = playerId.slice(0, 64);
	const cleanUsername = sanitizeUsername(username, cleanPid);
	const cleanAvatar = sanitizeAvatar(avatar);
	const info = updateRunProfileStmt.run({
		player_id: cleanPid,
		username: cleanUsername,
		avatar: cleanAvatar
	});
	return { updatedRuns: info.changes, username: cleanUsername, avatar: cleanAvatar };
}

/**
 * Finds a genuine recorded human run closely matched to targetWpm.
 * Prioritizes runs recorded by OTHER players; falls back to self-runs only if no other player's runs exist yet.
 * Returns null if zero valid recorded runs exist (preventing fake/empty matches).
 */
function findMatchedGhostRun({ excludePlayerId, targetWpm, lastLevelIndex }, levels) {
	const target = Math.max(5, Math.min(60, Number(targetWpm) || 12));

	const otherPlayerRows = db.prepare(`
		SELECT * FROM player_runs
		WHERE player_id != ?
		ORDER BY ABS(avg_wpm - ?) ASC, id DESC
		LIMIT 12
	`).all(String(excludePlayerId || ''), target);

	let candidates = otherPlayerRows;

	// If no other player has recorded runs yet, allow matching against saved real runs in the DB
	// so single-device local testing still replays genuine human runs once at least 1 Solo chain is completed.
	if (candidates.length === 0) {
		candidates = db.prepare(`
			SELECT * FROM player_runs
			ORDER BY ABS(avg_wpm - ?) ASC, id DESC
			LIMIT 12
		`).all(target);
	}

	const valid = [];
	for (const r of candidates) {
		try {
			const lvl = levels[r.level_index];
			if (!lvl || !Array.isArray(lvl.words)) continue;
			const times = JSON.parse(r.row_solve_times_json);
			if (!Array.isArray(times) || times.length !== lvl.words.length - 1) continue;
			valid.push({
				id: r.id,
				runUuid: r.run_uuid,
				playerId: r.player_id,
				username: sanitizeUsername(r.username, r.player_id),
				avatar: sanitizeAvatar(r.avatar),
				source: r.source,
				levelIndex: r.level_index,
				numSolvableRows: r.num_solvable_rows,
				totalDurationMs: r.total_duration_ms,
				avgWpm: Math.round(r.avg_wpm * 10) / 10,
				rowSolveTimesMs: times,
				createdAt: r.created_at
			});
		} catch (e) {}
	}

	if (valid.length === 0) {
		return null;
	}

	// Avoid immediate same-level repeat when multiple closely matched runs exist
	const nonRepeating = valid.filter((c) => c.levelIndex !== lastLevelIndex);
	const pool = nonRepeating.length > 0 ? nonRepeating : valid;

	// Pick randomly among the top 3 closest WPM matches for natural variety
	const topK = pool.slice(0, Math.min(3, pool.length));
	return topK[Math.floor(Math.random() * topK.length)];
}

/**
 * Saves complete head-to-head VS match outcome (Live, Friend, or Ghost).
 */
function saveMatchResult(record) {
	const matchId = record.matchId || crypto.randomUUID();
	const createdAt = new Date().toISOString();

	const p1Id = String(record.p1.playerId || 'unknown');
	const p2Id = String(record.p2.playerId || 'unknown');

	insertMatchStmt.run({
		match_id: matchId,
		room_id: String(record.roomId || ''),
		match_mode: String(record.matchMode || 'live'),
		room_code: record.roomCode ? String(record.roomCode) : null,
		level_index: Number(record.levelIndex) || 0,
		ghost_source_run_id: record.ghostSourceRunId ? Number(record.ghostSourceRunId) : null,
		p1_player_id: p1Id,
		p1_username: sanitizeUsername(record.p1.username, p1Id),
		p1_avatar: sanitizeAvatar(record.p1.avatar),
		p1_wpm: Math.round((Number(record.p1.wpm) || 0) * 10) / 10,
		p1_rows_solved: Number(record.p1.rowsSolved) || 0,
		p1_finish_ms: record.p1.finishMs != null ? Math.round(Number(record.p1.finishMs)) : null,
		p1_completed: record.p1.completed ? 1 : 0,
		p2_player_id: p2Id,
		p2_username: sanitizeUsername(record.p2.username, p2Id),
		p2_avatar: sanitizeAvatar(record.p2.avatar),
		p2_wpm: Math.round((Number(record.p2.wpm) || 0) * 10) / 10,
		p2_rows_solved: Number(record.p2.rowsSolved) || 0,
		p2_finish_ms: record.p2.finishMs != null ? Math.round(Number(record.p2.finishMs)) : null,
		p2_completed: record.p2.completed ? 1 : 0,
		first_solver_by_row_json: JSON.stringify(record.firstSolverByRow || {}),
		winner_slot: String(record.winnerSlot || 'p1'),
		winner_player_id: record.winnerPlayerId ? String(record.winnerPlayerId) : null,
		created_at: createdAt
	});

	return matchId;
}

function getStats() {
	const runCount = db.prepare('SELECT COUNT(*) AS cnt FROM player_runs').get().cnt;
	const distinctPlayers = db.prepare('SELECT COUNT(DISTINCT player_id) AS cnt FROM player_runs').get().cnt;
	const matchCount = db.prepare('SELECT COUNT(*) AS cnt FROM match_results').get().cnt;
	const recentMatches = db.prepare(`
		SELECT match_id, match_mode, room_code, level_index, ghost_source_run_id,
		       p1_player_id, p1_username, p1_avatar, p1_wpm, p1_rows_solved,
		       p2_player_id, p2_username, p2_avatar, p2_wpm, p2_rows_solved,
		       winner_slot, created_at
		FROM match_results
		ORDER BY id DESC
		LIMIT 10
	`).all();

	return {
		totalRuns: runCount,
		distinctRunPlayers: distinctPlayers,
		totalMatches: matchCount,
		recentMatches
	};
}

export {
	sanitizeAvatar,
	sanitizeUsername,
	savePlayerRun,
	updatePlayerProfile,
	findMatchedGhostRun,
	saveMatchResult,
	getStats
};
