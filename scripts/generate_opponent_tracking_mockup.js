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
	console.log('Connecting to Chrome CDP...');
	const target = await getPageTarget();
	const cdp = await connectCDP(target.webSocketDebuggerUrl);

	await cdp.send('Page.enable');
	await cdp.send('Runtime.enable');

	await cdp.send('Emulation.setDeviceMetricsOverride', {
		width: 576,
		height: 960,
		deviceScaleFactor: 2,
		mobile: true
	});

	// Navigate to vsplay
	await cdp.send('Page.navigate', { url: 'http://localhost:8080/3d.html?vsplay=1' });
	await new Promise(r => setTimeout(r, 2200));

	// Setup exact scenario:
	// P1 has solved Row 1 (WEST) and Row 2 (COAST) -> Both are Blue!
	// P1 is currently on Row 3 (GUARD).
	// Opponent is still on Row 1 (WEST).
	await cdp.send('Runtime.evaluate', {
		expression: `
			(() => {
				// 1. Mark Row 1 and Row 2 as claimed by P1 (Blue)
				MultiplayerManager.firstSolverByRow = { 1: 'p1', 2: 'p1' };
				MultiplayerManager.applyRowClaimMaterial(1);
				MultiplayerManager.applyRowClaimMaterial(2);

				// 2. Set current active word for P1 to Row 3
				// Advance word to row 3 if needed
				if (typeof currentWordIndex !== 'undefined') {
					// Put letters in row 1 and row 2
				}

				// 3. Update top VS Bar with Step Badges & Progress Dots
				const p1Box = document.querySelector('.vs-hud-player.vs-p1');
				const p2Box = document.querySelector('.vs-hud-player.vs-p2');

				// Add Step badges if not present
				if (p1Box && !document.getElementById('mock-p1-step')) {
					const badge1 = document.createElement('div');
					badge1.id = 'mock-p1-step';
					badge1.innerHTML = '<span style="font-size: 9.5px; font-weight: 900; background: rgba(14, 99, 156, 0.45); border: 1.2px solid #38bdf8; border-radius: 8px; padding: 1.5px 7px; color: #ffffff; letter-spacing: 0.4px; text-shadow: 0 1px 2px rgba(0,0,0,0.8);">WORD 3/4</span><div style="display:flex; gap:4px; margin-top:3px; justify-content:center;"><span style="width:7px; height:7px; border-radius:50%; background:#38bdf8; box-shadow:0 0 5px #38bdf8;"></span><span style="width:7px; height:7px; border-radius:50%; background:#38bdf8; box-shadow:0 0 5px #38bdf8;"></span><span style="width:7px; height:7px; border-radius:50%; background:#facc15; border:1px solid #ffffff; box-shadow:0 0 6px #facc15;"></span><span style="width:7px; height:7px; border-radius:50%; background:#334155;"></span></div>';
					badge1.style.marginTop = '3px';
					badge1.style.display = 'flex';
					badge1.style.flexDirection = 'column';
					badge1.style.alignItems = 'center';
					p1Box.appendChild(badge1);
				}

				if (p2Box && !document.getElementById('mock-p2-step')) {
					const badge2 = document.createElement('div');
					badge2.id = 'mock-p2-step';
					badge2.innerHTML = '<span style="font-size: 9.5px; font-weight: 900; background: rgba(185, 28, 28, 0.45); border: 1.2px solid #f87171; border-radius: 8px; padding: 1.5px 7px; color: #ffffff; letter-spacing: 0.4px; text-shadow: 0 1px 2px rgba(0,0,0,0.8);">WORD 1/4</span><div style="display:flex; gap:4px; margin-top:3px; justify-content:center;"><span style="width:7px; height:7px; border-radius:50%; background:#f87171; border:1px solid #ffffff; box-shadow:0 0 6px #f87171;"></span><span style="width:7px; height:7px; border-radius:50%; background:#334155;"></span><span style="width:7px; height:7px; border-radius:50%; background:#334155;"></span><span style="width:7px; height:7px; border-radius:50%; background:#334155;"></span></div>';
					badge2.style.marginTop = '3px';
					badge2.style.display = 'flex';
					badge2.style.flexDirection = 'column';
					badge2.style.alignItems = 'center';
					p2Box.appendChild(badge2);
				}

				// 4. Calculate Screen Position for Tray 1 (WEST) right end
				let tray1ScreenX = window.innerWidth * 0.76;
				let tray1ScreenY = window.innerHeight * 0.32;

				try {
					if (camera && chainRowData && chainRowData[1] && chainRowData[1].rackMesh) {
						const v = new THREE.Vector3();
						chainRowData[1].rackMesh.getWorldPosition(v);
						// Shift to right end of tray
						v.x += (chainRowData[1].rackWidth * 0.5 + 0.55);
						v.project(camera);
						tray1ScreenX = (v.x * 0.5 + 0.5) * window.innerWidth;
						tray1ScreenY = (-(v.y * 0.5) + 0.5) * window.innerHeight;
					}
				} catch (e) {
					console.error('Projection error:', e);
				}

				// 5. Inject 3D Opponent Avatar Beacon overlay at Tray 1
				let beacon = document.getElementById('mock-opponent-beacon');
				if (!beacon) {
					beacon = document.createElement('div');
					beacon.id = 'mock-opponent-beacon';
					beacon.style.position = 'fixed';
					beacon.style.zIndex = '50';
					beacon.style.pointerEvents = 'none';
					beacon.style.display = 'flex';
					beacon.style.alignItems = 'center';
					beacon.style.gap = '6px';
					beacon.style.transform = 'translate(0, -50%)';
					beacon.innerHTML = \`
						<!-- Red pointing chevron -->
						<svg width="20" height="22" viewBox="0 0 20 22" style="filter: drop-shadow(0 2px 5px rgba(239, 68, 68, 0.8));">
							<path d="M16 2 L4 11 L16 20 Z" fill="#ef4444" stroke="#ffffff" stroke-width="1.8" stroke-linejoin="round"/>
						</svg>
						<!-- Opponent Avatar Disc with glowing red ring -->
						<div style="position: relative; width: 44px; height: 44px; border-radius: 50%; border: 3px solid #ef4444; background: #0f172a; box-shadow: 0 0 16px rgba(239, 68, 68, 0.85), 0 4px 12px rgba(0,0,0,0.6); overflow: hidden; display: flex; align-items: center; justify-content: center;">
							<img src="OriginalTileImages/Character_9.png" style="width: 100%; height: 100%; object-fit: contain; object-position: center; border-radius: 50%; display: block;">
						</div>
						<!-- Opponent Name Pill -->
						<div style="background: rgba(15, 23, 42, 0.88); border: 1.5px solid #ef4444; border-radius: 12px; padding: 2px 8px; color: #ffffff; font-family: Fredoka, sans-serif; font-size: 11px; font-weight: 800; letter-spacing: 0.3px; box-shadow: 0 3px 10px rgba(0,0,0,0.5); white-space: nowrap;">
							<span style="color: #f87171;">● MARCUS</span>
						</div>
					\`;
					document.body.appendChild(beacon);
				}
				beacon.style.left = tray1ScreenX + 'px';
				beacon.style.top = tray1ScreenY + 'px';

				// 6. Also mark Tray 1 and Tray 2 letters completed on trays if empty
				// Refresh frame
				if (typeof updateCameraFraming === 'function') updateCameraFraming();
			})()
		`
	});

	await new Promise(r => setTimeout(r, 600));

	// Capture full mockup
	const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
	const fullPath = '/Users/uptimistik/.gemini/antigravity/brain/bfeca586-da2a-4a70-9039-61ba81789f80/mockup_opponent_beacon_and_hud.png';
	fs.writeFileSync(fullPath, Buffer.from(shot.data, 'base64'));
	console.log('Saved mockup screenshot:', fullPath);

	cdp.close();
}

run().catch(err => {
	console.error('Mockup generation failed:', err);
	process.exit(1);
});

