import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createActivationSandbox } from '../../scripts/portal/activation-sandbox.mjs';

const read = dir => fs.readFileSync(path.join(dir, 'version.txt'), 'utf8');

test('successful two-rename activation keeps previous version and is not called indivisible', t => {
  const box = createActivationSandbox(); t.after(() => box.dispose());
  const result = box.activate();
  assert.equal(read(box.target), 'candidate'); assert.equal(read(box.backup), 'original');
  assert.equal(result.indivisible, false);
});

test('failed initial rename preserves active and candidate', t => {
  const box = createActivationSandbox(); t.after(() => box.dispose());
  assert.throws(() => box.activate(() => { throw new Error('initial fault'); }), /initial fault/);
  assert.equal(read(box.target), 'original'); assert.equal(read(box.candidate), 'candidate');
});

test('failed activation restores original using real temporary directories', t => {
  const box = createActivationSandbox(); t.after(() => box.dispose());
  let calls = 0;
  assert.throws(() => box.activate((from, to) => {
    if (++calls === 2) throw new Error('injected activation failure');
    fs.renameSync(from, to);
  }), /ACTIVATION_FAILED:RESTORED/);
  assert.equal(read(box.target), 'original'); assert.equal(read(box.candidate), 'candidate');
  assert.equal(fs.existsSync(box.backup), false);
});

test('failed restoration reports critical failure and retains recoverable backup', t => {
  const box = createActivationSandbox(); t.after(() => box.dispose());
  let calls = 0;
  assert.throws(() => box.activate((from, to) => {
    if (++calls >= 2) throw new Error('injected failure');
    fs.renameSync(from, to);
  }), /RESTORATION_FAILED:BACKUP_RETAINED/);
  assert.equal(fs.existsSync(box.target), false); assert.equal(read(box.backup), 'original');
});
