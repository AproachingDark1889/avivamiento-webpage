import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Node 20 on Windows does not expand shell wildcards for `node --test`.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const folder = path.join(root, 'tests', 'portal-pipeline');
const files = fs.readdirSync(folder).filter(name => name.endsWith('.test.mjs')).sort().map(name => path.join(folder, name));
if (!files.length) throw new Error('NO_OFFLINE_TESTS_FOUND');
const started = new Date().toISOString();
const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...files], {
  cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 300000,
});
const reportDir = path.join(root, 'test-results', `portal-offline-${started.replace(/[^0-9TZ]/g, '')}`);
fs.mkdirSync(path.dirname(reportDir), { recursive: true });
fs.mkdirSync(reportDir);
fs.writeFileSync(path.join(reportDir, 'results.tap'), (result.stdout || '') + (result.stderr || ''), { flag: 'wx' });
const total = key => Number(result.stdout?.match(new RegExp(`^# ${key} (\\d+)$`, 'm'))?.[1] ?? 0);
const summary = { started, finished: new Date().toISOString(), node: process.version, command: 'npm run test:portal:offline',
  network: 'not used by runner or tests', files: files.map(f => path.relative(root, f)),
  exitCode: result.status ?? 1, tests: total('tests'), passed: total('pass'), failed: total('fail'), skipped: total('skipped') };
fs.writeFileSync(path.join(reportDir, 'summary.json'), JSON.stringify(summary, null, 2), { flag: 'wx' });
process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
console.log(`OFFLINE_REPORT ${reportDir}`);
process.exitCode = result.status === 0 && summary.tests > 0 && summary.failed === 0 && summary.skipped === 0 && summary.passed === summary.tests ? 0 : 1;
