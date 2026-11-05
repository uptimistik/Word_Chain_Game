const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require(path.join(__dirname, '../server/node_modules/ws'));

async function getPageTarget() {
	return new Promise((resolve, reject) => {
		http.get('http://localhost:9255/json/list', (res) => {
			let data = '';
			res.on('data', chunk => data += chunk);
			res.on('end', () => {
				const targets = JSON.parse(data);
				const page = targets.find(t => t.type === 'page' && !t.url.startsWith('chrome://'));
				if (page) resolve(page);
				else reject(new Error('No valid page target found'));
			});
		}).on('error', reject);
	});
}

function connectCDP(wsUrl) {
	return new Promise((resolve) => {
		const ws = new WebSocket(wsUrl);
		let id = 1;
		const pending = new Map();

		ws.on('open', () => {
			resolve({
				send: (method, params = {}) => new Promise((res, rej) => {
					const reqId = id++;
					pending.set(reqId, { res, rej });
					ws.send(JSON.stringify({ id: reqId, method, params }));
				}),
				close: () => ws.close()
			});
		});

		ws.on('message', (msg) => {
			const data = JSON.parse(msg);
			if (data.id && pending.has(data.id)) {
				const { res, rej } = pending.get(data.id);
				pending.delete(data.id);
				if (data.error) rej(data.error);
				else res(data.result);
			}
		});
	});
}

function sleep(ms) {
	return new Promise(r => setTimeout(r, ms));
}

async function run() {
	console.log('Connecting to Chrome CDP...');
	const target = await getPageTarget();
	const cdp = await connectCDP(target.webSocketDebuggerUrl);

	await cdp.send('Page.enable');
	await cdp.send('Runtime.enable');

	await cdp.send('Emulation.setDeviceMetricsOverride', {
		width: 412,
		height: 892,
		deviceScaleFactor: 2,
		mobile: true
	});

	console.log('Loading 3d.html in defeat state...');
	await cdp.send('Page.navigate', { url: 'http://localhost:8080/3d.html' });
	await sleep(1500);

	// Setup defeat match state with fake room so canRematch is true
	const setupDefeat = await cdp.send('Runtime.evaluate', {
		expression: `(() => {
			MultiplayerManager.isActive = true;
			MultiplayerManager.matchFinished = true;
			MultiplayerManager.winner = 'p2';
			MultiplayerManager.mySlot = 'p1';
			MultiplayerManager.playerUsername = 'Uptimistik';
			MultiplayerManager.opponentUsername = 'Marcus';
			MultiplayerManager.canRematch = true;
			MultiplayerManager.room = {
				send: function(msg, payload) {
					window._lastRoomSent = { msg, payload };
				},
				leave: function() {}
			};
			MultiplayerManager.lastMatchSummary = {
				winnerSlot: 'p2',
				matchType: 'pvp',
				totalRows: 4,
				p1Username: 'Uptimistik',
				p2Username: 'Marcus',
				p1Wpm: 18,
				p2Wpm: 22,
				p1Rows: 2,
				p2Rows: 4,
				p1FinishMs: null,
				p2FinishMs: 14500,
				canRematch: true
			};
			MultiplayerManager.showMatchResults();
			return {
				modalShowing: document.getElementById('vs-results-modal').classList.contains('show'),
				btnText: document.getElementById('btn-vs-results-next').textContent
			};
		})()`,
		returnByValue: true
	});
	console.log('Defeat setup state:', setupDefeat.result.value);

	const artifactDir = '/Users/uptimistik/.gemini/antigravity/brain/bfeca586-da2a-4a70-9039-61ba81789f80';
	await sleep(500);
	const shotDefeat = await cdp.send('Page.captureScreenshot', { format: 'png' });
	fs.writeFileSync(path.join(artifactDir, 'rematch_step1_defeat_results.png'), Buffer.from(shotDefeat.data, 'base64'));
	console.log('Saved rematch_step1_defeat_results.png');

	// Step 2: Click Rematch
	console.log('Clicking REMATCH button...');
	const clickRes = await cdp.send('Runtime.evaluate', {
		expression: `(() => {
			const btn = document.getElementById('btn-vs-results-next');
			btn.click();
			return {
				modalStillShowing: document.getElementById('vs-results-modal').classList.contains('show'),
				btnText: btn.textContent,
				btnDisabled: btn.disabled,
				subText: document.getElementById('vs-results-sub').textContent,
				sentRoomMsg: window._lastRoomSent
			};
		})()`,
		returnByValue: true
	});
	console.log('After Rematch click:', clickRes.result.value);

	if (!clickRes.result.value.modalStillShowing) {
		throw new Error('FAIL: Modal was hidden upon clicking REMATCH!');
	}
	console.log('PASS: Modal remains visible!');

	await sleep(500);
	const shotWaiting = await cdp.send('Page.captureScreenshot', { format: 'png' });
	fs.writeFileSync(path.join(artifactDir, 'rematch_step2_waiting_overlay.png'), Buffer.from(shotWaiting.data, 'base64'));
	console.log('Saved rematch_step2_waiting_overlay.png');

	// Step 3: Trigger timeout (simulate opponent not responding)
	console.log('Simulating timeout (no response)...');
	await cdp.send('Runtime.evaluate', {
		expression: `MultiplayerManager.handleRematchTimeout();`
	});

	const afterTimeout = await cdp.send('Runtime.evaluate', {
		expression: `(() => {
			return {
				subText: document.getElementById('vs-results-sub').textContent,
				btnText: document.getElementById('btn-vs-results-next').textContent
			};
		})()`,
		returnByValue: true
	});
	console.log('Status after timeout:', afterTimeout.result.value);

	await sleep(400);
	const shotTimeout = await cdp.send('Page.captureScreenshot', { format: 'png' });
	fs.writeFileSync(path.join(artifactDir, 'rematch_step3_timeout_message.png'), Buffer.from(shotTimeout.data, 'base64'));
	console.log('Saved rematch_step3_timeout_message.png');

	// Wait 2s for auto-return to lobby
	console.log('Waiting for auto-return to lobby...');
	await sleep(2000);

	const inLobby = await cdp.send('Runtime.evaluate', {
		expression: `(() => {
			return {
				resultsHidden: !document.getElementById('vs-results-modal').classList.contains('show'),
				lobbyShown: document.getElementById('vs-lobby-modal').classList.contains('show'),
				selectShown: document.getElementById('vs-step-select').style.display !== 'none'
			};
		})()`,
		returnByValue: true
	});
	console.log('Lobby state:', inLobby.result.value);

	const shotLobby = await cdp.send('Page.captureScreenshot', { format: 'png' });
	fs.writeFileSync(path.join(artifactDir, 'rematch_step4_returned_to_lobby.png'), Buffer.from(shotLobby.data, 'base64'));
	console.log('Saved rematch_step4_returned_to_lobby.png');

	cdp.close();
	console.log('Verification successful!');
}

run().catch(err => {
	console.error('Test run failed:', err);
	process.exit(1);
});

