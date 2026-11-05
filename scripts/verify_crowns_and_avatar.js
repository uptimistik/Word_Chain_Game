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

async function run() {
	console.log('Connecting to Chrome CDP on port 9255...');
	const target = await getPageTarget();
	const cdp = await connectCDP(target.webSocketDebuggerUrl);
	console.log('Connected to target:', target.title);

	await cdp.send('Page.enable');
	await cdp.send('Runtime.enable');

	// Set viewport
	await cdp.send('Emulation.setDeviceMetricsOverride', {
		width: 576,
		height: 960,
		deviceScaleFactor: 2,
		mobile: true
	});

	// =========================================================================
	// TEST 1: Solo In-Game Avatar Sizing, Object-Fit Contain & WPM-only Badge
	// =========================================================================
	console.log('\n--- TEST 1: Solo In-Game Avatar & Profile Header ---');
	await cdp.send('Page.navigate', { url: 'http://localhost:8080/3d.html?play=1' });
	await new Promise(r => setTimeout(r, 2000));

	// Set user profile in localStorage and update UI
	await cdp.send('Runtime.evaluate', {
		expression: `
			MultiplayerManager.playerUsername = 'UPTIMISTIK';
			localStorage.setItem(MultiplayerManager.USERNAME_STORAGE_KEY, 'UPTIMISTIK');
			MultiplayerManager.playerAvatar = 'Character_8.png';
			localStorage.setItem(MultiplayerManager.AVATAR_STORAGE_KEY, 'Character_8.png');
			MultiplayerManager.updateProfileUI();
		`
	});
	await new Promise(r => setTimeout(r, 500));

	const soloMetrics = await cdp.send('Runtime.evaluate', {
		expression: `
			(() => {
				const card = document.getElementById('hud-player-card');
				const ring = document.getElementById('hud-player-avatar-ring');
				const img = document.getElementById('hud-player-avatar-img');
				const name = document.getElementById('hud-player-name');
				const wpm = document.getElementById('hud-player-wpm');
				const crowns = document.getElementById('hud-player-crowns');
				const gear = document.getElementById('btn-settings');
				const speedo = document.getElementById('hud-speedometer');

				const ringStyle = window.getComputedStyle(ring);
				const imgStyle = window.getComputedStyle(img);
				const crownsStyle = window.getComputedStyle(crowns);

				return {
					ringWidth: ringStyle.width,
					ringHeight: ringStyle.height,
					ringBorder: ringStyle.border,
					imgObjectFit: imgStyle.objectFit,
					imgWidth: imgStyle.width,
					imgHeight: imgStyle.height,
					nameText: name ? name.innerText : '',
					wpmText: wpm ? wpm.innerText : '',
					crownsDisplay: crownsStyle.display,
					cardVisible: card && card.offsetParent !== null,
					avatarSrc: img ? img.src : ''
				};
			})()
		`,
		returnByValue: true
	});

	console.log('Solo Avatar & Profile Metrics:', JSON.stringify(soloMetrics.result.value, null, 2));

	// Take full screenshot for solo play
	const soloShot = await cdp.send('Page.captureScreenshot', { format: 'png' });
	fs.writeFileSync('/Users/uptimistik/.gemini/antigravity/brain/bfeca586-da2a-4a70-9039-61ba81789f80/solo_avatar_enlarged_full_face.png', Buffer.from(soloShot.data, 'base64'));
	console.log('Saved: solo_avatar_enlarged_full_face.png');

	// =========================================================================
	// TEST 2: 2-Player Flying Crown & Per-Letter Point Calculation
	// =========================================================================
	console.log('\n--- TEST 2: 2-Player Word Crowns & Flying Animation ---');
	await cdp.send('Page.navigate', { url: 'http://localhost:8080/3d.html?vsplay=1' });
	await new Promise(r => setTimeout(r, 2000));

	const vsHudCheck = await cdp.send('Runtime.evaluate', {
		expression: `
			(() => {
				const p1Crowns = document.getElementById('vs-p1-crowns');
				const p2Crowns = document.getElementById('vs-p2-crowns');
				const p1Avatar = document.getElementById('vs-p1-avatar');
				const p2Avatar = document.getElementById('vs-p2-avatar');
				return {
					p1CrownsText: p1Crowns ? p1Crowns.innerText : null,
					p2CrownsText: p2Crowns ? p2Crowns.innerText : null,
					p1Src: p1Avatar ? p1Avatar.src : null,
					p2Src: p2Avatar ? p2Avatar.src : null
				};
			})()
		`,
		returnByValue: true
	});
	console.log('VS HUD Initial Check:', JSON.stringify(vsHudCheck.result.value, null, 2));

	// Trigger flying crown to P1 avatar (solving a 5-letter word -> +5 crowns)
	console.log('Triggering flying crown to P1 (5-letter word = +5 crowns)...');
	await cdp.send('Runtime.evaluate', {
		expression: `
			MultiplayerManager.p1MatchCrowns = (MultiplayerManager.p1MatchCrowns || 0) + 5;
			MultiplayerManager.triggerFlyingCrown('p1', 1, 5);
		`
	});

	// Wait 250ms to capture flying crown mid-air!
	await new Promise(r => setTimeout(r, 250));
	const flyingShot = await cdp.send('Page.captureScreenshot', { format: 'png' });
	fs.writeFileSync('/Users/uptimistik/.gemini/antigravity/brain/bfeca586-da2a-4a70-9039-61ba81789f80/pvp_flying_crown_to_avatar.png', Buffer.from(flyingShot.data, 'base64'));
	console.log('Saved mid-flight screenshot: pvp_flying_crown_to_avatar.png');

	// Wait for arrival payoff
	await new Promise(r => setTimeout(r, 600));

	// Trigger flying crown to P2 avatar (solving a 4-letter word -> +4 crowns)
	console.log('Triggering flying crown to P2 (4-letter word = +4 crowns)...');
	await cdp.send('Runtime.evaluate', {
		expression: `
			MultiplayerManager.p2MatchCrowns = (MultiplayerManager.p2MatchCrowns || 0) + 4;
			MultiplayerManager.triggerFlyingCrown('p2', 2, 4);
		`
	});
	await new Promise(r => setTimeout(r, 700));

	const vsHudPostFly = await cdp.send('Runtime.evaluate', {
		expression: `
			(() => {
				const p1Crowns = document.getElementById('vs-p1-crowns');
				const p2Crowns = document.getElementById('vs-p2-crowns');
				return {
					p1CrownsText: p1Crowns ? p1Crowns.innerText : null,
					p2CrownsText: p2Crowns ? p2Crowns.innerText : null,
					p1MatchCrowns: MultiplayerManager.p1MatchCrowns,
					p2MatchCrowns: MultiplayerManager.p2MatchCrowns
				};
			})()
		`,
		returnByValue: true
	});
	console.log('VS HUD After Flying Crowns:', JSON.stringify(vsHudPostFly.result.value, null, 2));

	// =========================================================================
	// TEST 3: Match Results Summary with Crowns per Word and Total Word Crowns
	// =========================================================================
	console.log('\n--- TEST 3: 2-Player Match Results Screen ---');
	await cdp.send('Page.navigate', { url: 'http://localhost:8080/3d.html?vsresults=1' });
	await new Promise(r => setTimeout(r, 2000));

	const resultsMetrics = await cdp.send('Runtime.evaluate', {
		expression: `
			(() => {
				const p1Meta = document.getElementById('vs-res-p1-meta');
				const p2Meta = document.getElementById('vs-res-p2-meta');
				const pills = Array.from(document.querySelectorAll('.vs-chain-pill')).map(p => p.innerText.trim());
				const p1Crown = document.getElementById('vs-res-p1-crown');
				return {
					p1Meta: p1Meta ? p1Meta.innerText : null,
					p2Meta: p2Meta ? p2Meta.innerText : null,
					pills: pills,
					p1CrownVisible: p1Crown && p1Crown.classList.contains('show')
				};
			})()
		`,
		returnByValue: true
	});
	console.log('Match Results Check:', JSON.stringify(resultsMetrics.result.value, null, 2));

	const resultsShot = await cdp.send('Page.captureScreenshot', { format: 'png' });
	fs.writeFileSync('/Users/uptimistik/.gemini/antigravity/brain/bfeca586-da2a-4a70-9039-61ba81789f80/pvp_results_word_crowns.png', Buffer.from(resultsShot.data, 'base64'));
	console.log('Saved results screenshot: pvp_results_word_crowns.png');

	cdp.close();
	console.log('\nAll tests completed successfully!');
}

run().catch(err => {
	console.error('Test failed:', err);
	process.exit(1);
});
