import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let cachedLevels = null;

export function loadLevels() {
	if (cachedLevels) return cachedLevels;

	const levelsPath = path.resolve(__dirname, '..', 'js', 'levels.js');
	const code = fs.readFileSync(levelsPath, 'utf8');
	const sandbox = { window: {} };
	vm.createContext(sandbox);
	vm.runInContext(code, sandbox, { filename: 'levels.js' });

	const levels = sandbox.window.WORD_CHAIN_LEVELS;
	if (!Array.isArray(levels) || levels.length === 0) {
		throw new Error('Failed to load WORD_CHAIN_LEVELS from js/levels.js');
	}
	cachedLevels = levels;
	return cachedLevels;
}

export function getLevel(levelIndex) {
	const levels = loadLevels();
	const idx = ((levelIndex % levels.length) + levels.length) % levels.length;
	return { index: idx, data: levels[idx] };
}
