import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';

import { loadLevels } from './levelsLoader.js';
import * as store from './store.js';
import { VsMatchRoom, lookupFriendRoom } from './rooms/VsMatchRoom.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 2567;
const GAME_ROOT = path.resolve(__dirname, '..');
const levels = loadLevels();

const httpServer = http.createServer();

const gameServer = new Server({
	greet: false,
	transport: new WebSocketTransport({
		server: httpServer
	}),
	express: (app) => {
		app.use(cors());
		app.use(express.json({ limit: '128kb' }));

		// 1. Health & Persisted Stats Inspection
		app.get('/api/stats', (_req, res) => {
			try {
				res.json({
					ok: true,
					levelsCount: levels.length,
					...store.getStats()
				});
			} catch (err) {
				res.status(500).json({ ok: false, error: err.message });
			}
		});

		// 2. Record Completed Human Run (Solo or VS) as Ghost Source Material
		app.post('/api/runs', (req, res) => {
			try {
				const result = store.savePlayerRun(req.body || {}, levels);
				res.json({ ok: true, ...result });
			} catch (err) {
				res.status(400).json({ ok: false, error: err.message });
			}
		});

		// 2b. Sync Player Profile (Username & Avatar) onto Recorded Runs
		app.post('/api/profile', (req, res) => {
			try {
				const result = store.updatePlayerProfile(req.body || {});
				res.json({ ok: true, ...result });
			} catch (err) {
				res.status(400).json({ ok: false, error: err.message });
			}
		});

		// 3. Resolve 4-Character Friend Room Code -> Active Colyseus Room ID
		app.get('/api/friend-room/:code', (req, res) => {
			const entry = lookupFriendRoom(req.params.code);
			if (!entry) {
				return res.status(404).json({
					ok: false,
					error: 'Room code not found or already in progress.'
				});
			}
			return res.json({
				ok: true,
				code: entry.code,
				roomId: entry.roomId
			});
		});

		// Serve static game files so http://localhost:2567/3d.html (and LAN phones!) work out of the box
		app.use(express.static(GAME_ROOT, {
			index: '3d.html'
		}));
	}
});

gameServer.define('vs_match', VsMatchRoom).filterBy(['mode']);

gameServer.listen(PORT).then(() => {
	console.log(`[WordChain Colyseus] Listening on http://localhost:${PORT}/3d.html (WS: ws://localhost:${PORT})`);
});
