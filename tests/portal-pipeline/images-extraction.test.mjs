import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decodeImages, fileHash, pythonCall } from '../../scripts/portal/validation.mjs';
import { makeApproval } from '../../scripts/portal/capture.mjs';
import { extractCandidate } from '../../scripts/extract_portal_frames.mjs';
import { fixtureCall, temporary, syntheticRun, python } from './fixtures.mjs';

test('real JPEG/PNG decode; full file and raster hashes distinguish encoding from pixels', t => {
  const root = temporary(t); fixtureCall({ operation: 'images', root });
  const names = ['red.jpg', 'blue.jpg', 'same-a.png', 'same-b.png'];
  const result = decodeImages(names.map(n => path.join(root, n)), python);
  assert.equal(result.images.length, 4);
  assert.ok(result.images.every(i => i.width === 64 && i.height === 40 && /^[a-f0-9]{64}$/.test(i.pixelSha256)));
  assert.deepEqual(fs.readFileSync(path.join(root, names[0])).subarray(0,64), fs.readFileSync(path.join(root, names[1])).subarray(0,64));
  assert.notEqual(result.images[0].sha256, result.images[1].sha256);
  assert.notEqual(result.images[0].pixelSha256, result.images[1].pixelSha256);
  assert.notEqual(result.images[2].sha256, result.images[3].sha256);
  assert.equal(result.images[2].pixelSha256, result.images[3].pixelSha256);
});

for (const file of ['fake.jpg', 'fake.png', 'truncated.jpg', 'truncated.png']) {
  test(`decoder rejects ${file}, including plausible markers`, t => {
    const root = temporary(t); fixtureCall({ operation: 'images', root });
    assert.throws(() => decodeImages([path.join(root, file)], python), /OFFLINE_HELPER_FAILED/);
  });
}

test('ZIP traversal, absolute paths and Windows paths rejected before extraction', t => {
  const root = temporary(t);
  for (const [index, name] of ['../escape.txt', '/absolute.trace', 'C:/bad.trace', 'resources\\bad.jpg'].entries()) {
    fixtureCall({ operation: 'zip', root, name: `bad${index}.zip`, images: false, extra: { [name]: 'unsafe' } });
    assert.ok(fs.readFileSync(path.join(root, `bad${index}.zip`)).includes(Buffer.from(name)), `fixture preserved ${name}`);
    const destination = path.join(root, `unpacked${index}`);
    assert.throws(() => pythonCall('archive.py', { source: path.join(root, `bad${index}.zip`), destination }, python), /OFFLINE_HELPER_FAILED/, `archive must reject ${name}`);
    assert.equal(fs.existsSync(destination), false);
  }
});

test('full offline ZIP -> nine candidates; all observed frames retained, no fabricated 160; original untouched', t => {
  const root = temporary(t); fixtureCall({ operation: 'images', root });
  const run = syntheticRun();
  fixtureCall({ operation: 'zip', root, name: 'synthetic.zip', traces: run.serialize() });
  const tracePath = path.join(root, 'synthetic.zip');
  const { approval, runnerResult } = makeApproval({ ...run.approval, result: { status: 'passed', retry: 0 }, tracePath });
  const approvalPath = path.join(root, 'approval.json'), resultPath = path.join(root, 'result.json');
  fs.writeFileSync(approvalPath, JSON.stringify(approval)); fs.writeFileSync(resultPath, JSON.stringify(runnerResult));
  const original = path.join(root, 'docs', 'portal', 'assets', 'frames'); fs.mkdirSync(original, { recursive: true });
  fs.copyFileSync(path.join(root, 'red.jpg'), path.join(original, 'original.jpg'));
  const before = fileHash(path.join(original, 'original.jpg'));
  const options = { tracePath, approvalPath, resultPath, name: 'synthetic-candidate', python, workspace: root };
  const { manifest, target } = extractCandidate(options);
  assert.equal(manifest.modules.length, 9);
  assert.deepEqual(manifest.modules.map(m => m.frameCount), [9,9,9,9,9,9,9,18,27]);
  assert.ok(manifest.modules.every(m => m.uniqueFiles === 2 && m.uniqueRasters === 2));
  for (const module of manifest.modules) for (const frame of module.frames) assert.equal(fileHash(path.join(target, frame.path)), frame.sha256);
  assert.equal(fileHash(path.join(original, 'original.jpg')), before);
  assert.throws(() => extractCandidate(options), /CANDIDATE_EXISTS/);
  fs.writeFileSync(approvalPath, '{malformed');
  assert.throws(() => extractCandidate({ ...options, name: 'bad-manifest' }), SyntaxError);
  fs.writeFileSync(approvalPath, JSON.stringify({ ...approval, traceSha256: 'b'.repeat(64) }));
  assert.throws(() => extractCandidate({ ...options, name: 'wrong-trace' }), /TRACE_HASH_MISMATCH/);
  assert.equal(fs.existsSync(path.join(root, 'artifacts', 'training-candidates', 'wrong-trace')), false);
});

test('CLI refuses implicit execution and promotion with nonzero exit', () => {
  const script = fileURLToPath(new URL('../../scripts/extract_portal_frames.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 1); assert.match(result.stderr, /USAGE/);
  const promote = spawnSync(process.execPath, [script, '--promote', 'yes', '--trace', 'x', '--approval', 'x', '--result', 'x', '--name', 'synthetic'], { encoding: 'utf8', windowsHide: true });
  assert.equal(promote.status, 1); assert.match(promote.stderr, /UNKNOWN_OR_DUPLICATE_OPTION/);
});

test('ZIP rejects case collisions, path aliases and reserved Windows devices', t => {
  const root = temporary(t);
  for (const [index, extra] of [
    { 'same.trace': 'one', 'SAME.trace': 'two' },
    { 'resources//red.jpg': 'alias' },
    { 'resources/CON.jpg': 'device' },
  ].entries()) {
    fixtureCall({ operation: 'zip', root, name: `collision${index}.zip`, images: false, extra });
    assert.throws(() => pythonCall('archive.py', { source: path.join(root, `collision${index}.zip`), destination: path.join(root, `out${index}`) }, python), /OFFLINE_HELPER_FAILED/);
  }
});

test('missing image resource rejects candidate even with matching approved trace hash', t => {
  const root = temporary(t), run = syntheticRun();
  fixtureCall({ operation: 'zip', root, name: 'missing-resource.zip', traces: run.serialize(), images: false });
  const tracePath = path.join(root, 'missing-resource.zip');
  const { approval, runnerResult } = makeApproval({ ...run.approval, result: { status: 'passed', retry: 0 }, tracePath });
  const approvalPath = path.join(root, 'approval.json'), resultPath = path.join(root, 'result.json');
  fs.writeFileSync(approvalPath, JSON.stringify(approval)); fs.writeFileSync(resultPath, JSON.stringify(runnerResult));
  assert.throws(() => extractCandidate({ tracePath, approvalPath, resultPath, name: 'missing-image', workspace: root, python }), /OFFLINE_HELPER_FAILED/);
  assert.equal(fs.existsSync(path.join(root, 'artifacts', 'training-candidates', 'missing-image')), false);
});

test('a passed .last-run.json alone never authorizes extraction', t => {
  const root = temporary(t);
  fs.writeFileSync(path.join(root, '.last-run.json'), JSON.stringify({ status: 'passed' }));
  assert.throws(() => extractCandidate({ tracePath: 'not-read.zip', approvalPath: path.join(root, 'missing-approval.json'), resultPath: 'missing.json', name: 'unapproved-run', workspace: root, python }), /ENOENT/);
  assert.equal(fs.existsSync(path.join(root, 'artifacts')), false);
});
