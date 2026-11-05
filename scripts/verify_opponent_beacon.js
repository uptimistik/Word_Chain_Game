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
	console.log('Connected to target:', target.title);

	await cdp.send('Page.enable');
	await cdp.send('Runtime.enable');

	// Set mobile portrait viewport (typical phone 412x892)
	await cdp.send('Emulation.setDeviceMetricsOverride', {
		width: 412,
		height: 892,
		deviceScaleFactor: 2,
		mobile: true
	});

	console.log('Navigating to http://localhost:8080/3d.html?vsplay=1 ...');
	await cdp.send('Page.navigate', { url: 'http://localhost:8080/3d.html?vsplay=1' });
	await sleep(2200);

	// 1. Check beacon at Row 1
	const evalRow1 = await cdp.send('Runtime.evaluate', {
		expression: `(() => {
			return {
				isActive: MultiplayerManager.isActive,
				hasSetOpponentActiveRow: typeof MultiplayerManager.setOpponentActiveRow === 'function'
			};
		})()`,
		returnByValue: true
	});
	console.log('Initial VS State:', evalRow1.result.value);

	await sleep(600);
	const shot1 = await cdp.send('Page.captureScreenshot', { format: 'png' });
	const artifactDir = '/Users/uptimistik/.gemini/antigravity/brain/bfeca586-da2a-4a70-9039-61ba81789f80';
	fs.writeFileSync(path.join(artifactDir, 'opponent_beacon_at_row1.png'), Buffer.from(shot1.data, 'base64'));
	console.log('Saved opponent_beacon_at_row1.png');

	// 2. Animate Opponent advance to Row 2
	console.log('Advancing opponent to Row 2...');
	await cdp.send('Runtime.evaluate', {
		expression: `MultiplayerManager.setOpponentActiveRow(2, true);`
	});
	// Wait mid-transition to catch hopping arc or post-transition
	await sleep(250);
	const shot2a = await cdp.send('Page.captureScreenshot', { format: 'png' });
	fs.writeFileSync(path.join(artifactDir, 'opponent_beacon_hopping_arc.png'), Buffer.from(shot2a.data, 'base64'));
	console.log('Saved opponent_beacon_hopping_arc.png');

	await sleep(400); // Complete transition
	const shot2 = await cdp.send('Page.captureScreenshot', { format: 'png' });
	fs.writeFileSync(path.join(artifactDir, 'opponent_beacon_at_row2.png'), Buffer.from(shot2.data, 'base64'));
	console.log('Saved opponent_beacon_at_row2.png');

	// 3. Animate Opponent advance to Row 3
	console.log('Advancing opponent to Row 3...');
	await cdp.send('Runtime.evaluate', {
		expression: `MultiplayerManager.setOpponentActiveRow(3, true);`
	});
	await sleep(600);
	const shot3 = await cdp.send('Page.captureScreenshot', { format: 'png' });
	fs.writeFileSync(path.join(artifactDir, 'opponent_beacon_at_row3.png'), Buffer.from(shot3.data, 'base64'));
	console.log('Saved opponent_beacon_at_row3.png');

	// 4. Test exit VS mode
	console.log('Testing exit VS mode...');
	await cdp.send('Runtime.evaluate', {
		expression: `MultiplayerManager.exitVsMode();`
	});
	await sleep(400);
	const shot4 = await cdp.send('Page.captureScreenshot', { format: 'png' });
	fs.writeFileSync(path.join(artifactDir, 'solo_mode_beacon_hidden.png'), Buffer.from(shot4.data, 'base64'));
	console.log('Saved solo_mode_beacon_hidden.png');

	cdp.close();
	console.log('All verification steps completed!');
}

run().catch(err => {
	console.error('Test run failed:', err);
	process.exit(1);
});

