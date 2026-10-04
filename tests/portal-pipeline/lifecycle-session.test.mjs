import test from 'node:test';
import assert from 'node:assert/strict';
import { attemptAll, requireOwnedEmails, resolveOwnedOrganization } from '../../scripts/portal/lifecycle.mjs';
import { withExactSessionRpc } from '../../scripts/portal/session-guard.mjs';
import { captureTraining, runWithFinalization } from '../../scripts/portal/capture.mjs';
import { MODULES } from '../../scripts/portal/contracts.mjs';

test('evidence failure still attempts known cleanup and all contexts, with explicit errors', async () => {
  const called = [];
  await assert.rejects(attemptAll([
    ['evidence', () => { called.push('evidence'); throw new Error('capture fault'); }],
    ['context-one', () => { called.push('context-one'); throw new Error('close fault'); }],
    ['context-two', () => called.push('context-two')],
    ['cleanup', () => called.push('cleanup')],
  ]), error => {
    assert.equal(error.errors.length, 2);
    assert.equal(error.results[3].status, 'passed');
    return /FINALIZATION_FAILED/.test(error.message);
  });
  assert.deepEqual(called, ['evidence', 'context-one', 'context-two', 'cleanup']);
});

test('primary failure and cleanup failure both survive finalization', async () => {
  let attempted = false;
  await assert.rejects(runWithFinalization(() => { throw new Error('primary'); }, [
    ['cleanup', () => { attempted = true; throw new Error('cleanup'); }],
  ]), e => e.errors[0].message === 'primary' && e.errors[1] instanceof AggregateError);
  assert.equal(attempted, true);
});

test('run slug and organization ownership reject unrelated identities or ambiguous IDs', () => {
  requireOwnedEmails('run_12345678', ['pastor.run-12345678@example.invalid']);
  for (const email of ['pastor@example.invalid', 'pastor.other-run@example.invalid', 'pastor.run-12345678.evil@example.invalid']) assert.throws(() => requireOwnedEmails('run_12345678', [email]), /CLEANUP_EMAIL_OUTSIDE_RUN/);
  assert.equal(resolveOwnedOrganization({ profiles: [{ org_id: 'own' }], knownOrgIds: [] }), 'own');
  assert.equal(resolveOwnedOrganization({ profiles: [], knownOrgIds: ['own'] }), 'own');
  assert.throws(() => resolveOwnedOrganization({ profiles: [], knownOrgIds: [], explicitOrgId: 'foreign' }), /UNPROVEN/);
  assert.throws(() => resolveOwnedOrganization({ profiles: [{ org_id: 'a' }, { org_id: 'b' }], knownOrgIds: [] }), /AMBIGUOUS/);
  assert.throws(() => resolveOwnedOrganization({ profiles: [{ org_id: 'other' }], knownOrgIds: ['own'] }), /MISMATCH/);
});

function fakePage() {
  let handler, resolve, reject, predicate;
  const observed = { forwarded: 0, aborted: 0, unrouted: 0 };
  return {
    observed,
    route: async (_, fn) => { handler = fn; },
    unroute: async () => { observed.unrouted++; handler = undefined; },
    waitForResponse: fn => { predicate = fn; return new Promise((yes, no) => { resolve = yes; reject = no; }); },
    click: async (id, rpc = 'pre_close_cash_session', ok = true) => {
      const request = { postDataJSON: () => ({ p_session_id: id }) };
      await handler({ request: () => request,
        abort: async () => { observed.aborted++; reject(new Error('blocked by guard')); },
        continue: async () => {
          observed.forwarded++;
          const response = { url: () => `http://127.0.0.1/rest/v1/rpc/${rpc}`, request: () => request, ok: () => ok };
          assert.equal(predicate(response), true); resolve(response);
        },
      });
    },
  };
}

test('exact-session request forwarded once; route always removed', async () => {
  const page = fakePage();
  await withExactSessionRpc(page, 'pre_close_cash_session', 'own-session', () => page.click('own-session'));
  assert.deepEqual(page.observed, { forwarded: 1, aborted: 0, unrouted: 1 });
});

test('wrong session aborted before request forwarding; bad response rejected', async () => {
  const page = fakePage();
  await assert.rejects(withExactSessionRpc(page, 'pre_close_cash_session', 'own', () => page.click('foreign')), /blocked by guard/);
  assert.deepEqual(page.observed, { forwarded: 0, aborted: 1, unrouted: 1 });
  const bad = fakePage();
  await assert.rejects(withExactSessionRpc(bad, 'approve_cash_session', 'own', () => bad.click('own', 'approve_cash_session', false)), /SESSION_RPC_NOT_VERIFIED/);
  assert.equal(bad.observed.unrouted, 1);
});

test('deterministic capture orchestration has complete markers and balances groups on failure', async () => {
  let opened = 0, closed = 0, screenshots = 0, actions = 0;
  const actors = ['pastor','leader','cashier','kitchen'].map(role => ({ id: role, role,
    context: { tracing: { group: async () => opened++, groupEnd: async () => closed++ } },
    page: { screenshot: async () => screenshots++ },
  }));
  const adapters = {}, entityKeys = {};
  for (const module of MODULES) {
    entityKeys[module.id] = `entity-${module.id}`;
    for (const segment of module.segments) adapters[`${module.id}/${segment.id}`] = {
      actorId: segment.role, actions: Object.fromEntries(segment.milestones.map(m => [m, async () => actions++])),
    };
  }
  const options = { runId: 'synthetic-capture', actors, adapters, entityKeys, verifyModule: async id => ({ status: 'passed', entityId: `id-${id}` }) };
  assert.equal((await captureTraining(options)).length, 9);
  assert.equal(actions, 36); assert.equal(screenshots, 36); assert.equal(opened, 48); assert.equal(closed, 48);
  adapters['1/onboarding'].actions.registration = async () => { throw new Error('assertion failed'); };
  await assert.rejects(captureTraining(options), /assertion failed/);
  assert.equal(opened, closed);
});
