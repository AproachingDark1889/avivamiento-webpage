import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { MODULES } from '../../scripts/portal/contracts.mjs';
import { rehearseTraining } from '../../scripts/portal/capture.mjs';
import { buildTrainingAdapters } from '../../scripts/portal/training-adapters.mjs';
import { localRpc } from '../../scripts/portal/real-adapters.mjs';
import { cents, cleanupTraining } from '../../scripts/portal/training-data.mjs';
import { syntheticRun } from './fixtures.mjs';
import { validateApproval } from '../../scripts/portal/validation.mjs';

test('all 36 real actions are bound to the 12 declared segments and roles without executing them', () => {
  const actors = ['pastor','leader','leader','leader','cashier','kitchen','cashier'].map((role, i) => ({ id: `actor-${i}`, role }));
  const { adapters } = buildTrainingAdapters(actors, {});
  assert.equal(Object.keys(adapters).length, 12);
  for (const m of MODULES) for (const s of m.segments) {
    const a = adapters[`${m.id}/${s.id}`];
    assert.equal(actors.find(actor => actor.id === a.actorId).role, s.role);
    assert.deepEqual(Object.keys(a.actions), s.milestones);
  }
});

test('rehearsal uses all adapters and preconditions, never screenshots or tracing', async () => {
  const before = [], events = [], actors = ['pastor','leader','cashier','kitchen'].map(role => ({ id: role, role }));
  const adapters = {}, entityKeys = {};
  for (const m of MODULES) {
    entityKeys[m.id] = `entity-${m.id}`;
    for (const s of m.segments) adapters[`${m.id}/${s.id}`] = { actorId: s.role, actions: Object.fromEntries(s.milestones.map(id => [id, async () => {}])) };
  }
  const results = await rehearseTraining({ runId: 'synthetic-123', actors, adapters, entityKeys,
    beforeModule: async id => before.push(id), onEvent: e => events.push(e), verifyModule: async id => ({ status: 'passed', entityId: `id-${id}` }) });
  assert.equal(results.length, 9); assert.equal(events.filter(e => e.status === 'passed').length, 36);
  assert.deepEqual(before, [1,2,3,4,5,6,7,8,9]);
});

test('v2 acceptance rejects shared session, missing UI enablement and wrong cashier', () => {
  for (const patch of [{ mode: 'shared' }, { independentEnabledViaUI: false }, { cashierId: '' }, { openedBy: 'other' }]) {
    const run = syntheticRun(); Object.assign(run.approval.receipts[8], patch);
    assert.throws(() => validateApproval(run.approval, run.approval.traceSha256, run.runnerResult), /INDEPENDENT_CONTEXT/);
  }
  const old = syntheticRun(); old.approval.contractVersion = 1;
  assert.throws(() => validateApproval(old.approval, old.approval.traceSha256, old.runnerResult), /APPROVAL_SCHEMA/);
});

test('money conversion is exact to cents and rejects overprecision or nonfinite values', () => {
  assert.equal(cents('50.00') + cents(45), cents('95.00'));
  assert.equal(cents('-0.01'), -1); assert.equal(cents('0.1'), 10);
  for (const value of [NaN, Infinity, null, '1.001', '1e3']) assert.throws(() => cents(value), /MONEY_/);
});

test('local RPC guard rejects wrong UUID or remote URL before forwarding, and retains lower network guard', async () => {
  for (const variant of ['good', 'wrong-id', 'remote']) {
    let handler, resolve, reject, forwarded = 0, aborted = 0, unrouted = 0;
    const req = { url: () => variant === 'remote' ? 'https://example.invalid/rest/v1/rpc/approve_cash_session' : 'http://127.0.0.1:54321/rest/v1/rpc/approve_cash_session',
      method: () => 'POST', postDataJSON: () => ({ p_session_id: variant === 'wrong-id' ? 'foreign' : 'own' }) };
    const page = { route: async (_, fn) => { handler = fn; }, unroute: async () => { unrouted++; },
      waitForResponse: () => new Promise((a, b) => { resolve = a; reject = b; }) };
    const action = async () => handler({ request: () => req, fallback: async () => { forwarded++; resolve({ ok: () => true, status: () => 200, json: async () => ({ success: true }) }); },
      abort: async () => { aborted++; reject(new Error('blocked')); }, continue: () => { throw new Error('network guard bypass'); } });
    if (variant === 'good') await localRpc(page, 'approve_cash_session', { p_session_id: 'own' }, action);
    else await assert.rejects(localRpc(page, 'approve_cash_session', { p_session_id: 'own' }, action), /blocked/);
    assert.equal(forwarded, variant === 'good' ? 1 : 0); assert.equal(aborted, variant === 'good' ? 0 : 1); assert.equal(unrouted, 1);
  }
});

test('rehearsal CLI rejects missing consent before contacting database', () => {
  const r = spawnSync(process.execPath, ['scripts/rehearse_portal_local.mjs'], { encoding: 'utf8', windowsHide: true });
  assert.notEqual(r.status, 0); assert.match(r.stderr, /LOCAL_REHEARSAL_ONLY_NO_RECORDING/);
});

test('training cleanup rejects outside-run identity before database access', () => {
  assert.throws(() => cleanupTraining('avc-training-11111111-1111-4111-8111-111111111111', [{ email: 'real@example.invalid' }], {}), /CLEANUP_EMAIL_OUTSIDE_RUN/);
});
