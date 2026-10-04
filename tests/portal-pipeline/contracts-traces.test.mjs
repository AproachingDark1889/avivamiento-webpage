import test from 'node:test';
import assert from 'node:assert/strict';
import { MODULES, markerTitle, readMarker, moduleById } from '../../scripts/portal/contracts.mjs';
import { parseTrace, selectScenes, validateApproval } from '../../scripts/portal/validation.mjs';
import { syntheticRun } from './fixtures.mjs';

const parsed = run => Object.fromEntries(Object.entries(run.serialize()).map(([k, text]) => [k, parseTrace(text)]));

test('nine explicit contracts; cashier counts, leader approves; separate contingency markers', () => {
  assert.deepEqual(MODULES.map(m => m.id), [1,2,3,4,5,6,7,8,9]);
  assert.deepEqual(moduleById(8).segments.map(s => s.role), ['cashier', 'leader']);
  assert.ok(moduleById(9).segments[1].milestones.includes('contingency_dialog'));
  assert.deepEqual(moduleById(9).segments[2], { id: 'reopen', role: 'cashier', milestones: ['new_session_unblocked'] });
  assert.equal(moduleById(9).sessionMode, 'independent');
  assert.throws(() => moduleById(10), /UNKNOWN_MODULE/);
});

test('markers round trip; extra fields and malformed JSON rejected', () => {
  const marker = { runId: 'synthetic-123', moduleId: 1, segmentId: 'onboarding', actorId: 'pastor', entityKey: 'org', kind: 'segment' };
  assert.deepEqual(readMarker(markerTitle(marker)), marker);
  assert.equal(readMarker('ordinary button click'), null);
  assert.throws(() => readMarker('AVC1:{'), /MALFORMED_MARKER/);
  assert.throws(() => markerTitle({ ...marker, password: 'forbidden' }), /MARKER_FIELDS/);
});

test('paired actions cover all 12 segments and all 36 milestones, including counting and outcome', () => {
  const run = syntheticRun();
  validateApproval(run.approval, run.approval.traceSha256, run.runnerResult);
  const scenes = selectScenes(run.approval, parsed(run));
  assert.equal(scenes.length, 12);
  assert.equal(scenes.flatMap(s => s.windows).length, 36);
  assert.equal(scenes.flatMap(s => s.frames).length, 108);
  assert.equal(scenes.find(s => s.moduleId === 8 && s.segmentId === 'count').windows[0].id, 'counting');
});

for (const status of ['failed', 'skipped', 'interrupted', 'unknown', undefined]) {
  test(`approval rejects status ${status}`, () => {
    const run = syntheticRun(); run.approval.status = status;
    assert.throws(() => validateApproval(run.approval, run.approval.traceSha256, run.runnerResult), /RUN_NOT_APPROVED/);
  });
}

test('approval requires exact test, run, trace hash, viewport and cleanup result', () => {
  for (const [mutate, expected] of [
    [r => r.approval.traceSha256 = 'b'.repeat(64), /TRACE_HASH_MISMATCH/],
    [r => r.runnerResult.testId = 'other-test', /RUNNER_RESULT_IDENTITY/],
    [r => r.runnerResult.runId = 'different-run', /RUNNER_RESULT_IDENTITY/],
    [r => r.runnerResult.status = 'skipped', /RUNNER_RESULT_NOT_PASSED/],
    [r => r.runnerResult.retry = 1, /RUNNER_RESULT_NOT_PASSED/],
    [r => r.approval.viewport.width = 390, /VIEWPORT_MISMATCH/],
    [r => r.approval.cleanupStatus = 'failed', /RUN_NOT_APPROVED/],
    [r => r.approval.receipts[8].closedSessionId = 'different-session', /CONTINGENCY_UNBLOCK/],
    [r => r.approval.receipts[8].nextSessionId = 'id-9', /CONTINGENCY_UNBLOCK/],
    [r => r.approval.receipts[8].expectedCents = 9450, /CONTINGENCY_TOTALS/],
    [r => r.approval.receipts[7].checks = [], /RESULT_MISSING/],
  ]) {
    const run = syntheticRun(); mutate(run);
    assert.throws(() => validateApproval(run.approval, 'a'.repeat(64), run.runnerResult), expected);
  }
  assert.throws(() => validateApproval(undefined, 'a'.repeat(64), undefined), /APPROVAL_SCHEMA/);
});

test('ordinary closure does not pass as contingency; missing final scene rejected', () => {
  for (const milestone of ['contingency_dialog', 'same_session_closed', 'new_session_unblocked']) {
    const run = syntheticRun(), traces = parsed(run);
    const child = Object.values(traces).flatMap(t => t.actions).find(a => a.marker?.moduleId === 9 && a.marker?.milestone === milestone);
    assert.ok(child);
    child.marker.milestone = 'ordinary_preclose';
    assert.throws(() => selectScenes(run.approval, traces), /MILESTONE_MISSING_OR_DUPLICATE/);
  }
});

test('actor, entity, viewport and temporal inversions rejected', () => {
  for (const [mutate, expected] of [
    [t => t['leader.trace'].actions.find(a => a.marker?.kind === 'segment').marker.actorId = 'cashier', /WRONG_ACTOR/],
    [t => t['leader.trace'].actions.find(a => a.marker?.kind === 'segment').marker.entityKey = 'elsewhere', /RUN_OR_ENTITY_MISMATCH/],
    [t => t['leader.trace'].contexts[0].options.viewport.width = 390, /TRACE_VIEWPORT_MISMATCH/],
    [t => t['leader.trace'].actions.find(a => a.marker?.milestone === 'role_assignment').startTime = 0, /MILESTONE_ORDER/],
  ]) {
    const run = syntheticRun(), traces = parsed(run); mutate(traces);
    assert.throws(() => selectScenes(run.approval, traces), expected);
  }
});

test('frames from another page cannot fill missing milestone evidence', () => {
  const run = syntheticRun(), traces = parsed(run);
  traces['pastor.trace'].frames.forEach(f => f.pageId = 'unrelated-page');
  assert.throws(() => selectScenes(run.approval, traces), /MILESTONE_HAS_NO_FRAMES/);
});

test('trace rejects corrupt lines, incomplete actions and failed actions', () => {
  assert.throws(() => parseTrace('{invalid'), /MALFORMED_TRACE_LINE/);
  assert.throws(() => parseTrace(JSON.stringify({ type: 'before', callId: '1', startTime: 1 })), /INCOMPLETE_OR_FAILED_ACTION/);
  assert.throws(() => parseTrace(JSON.stringify({ type: 'after', callId: '1', endTime: 2 })), /UNPAIRED_ACTION/);
  const run = syntheticRun();
  run.events['pastor.trace'].find(e => e.type === 'after').error = { message: 'synthetic assertion failure' };
  assert.throws(() => parsed(run), /INCOMPLETE_OR_FAILED_ACTION/);
});
