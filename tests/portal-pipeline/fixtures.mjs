import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { CONTRACT_VERSION, MODULES, markerTitle } from '../../scripts/portal/contracts.mjs';
import { sha256 } from '../../scripts/portal/validation.mjs';

export const python = process.env.AVC_PYTHON || 'python';
export function fixtureCall(request) {
  const result = spawnSync(python, [fileURLToPath(new URL('./fixture_assets.py', import.meta.url))], {
    input: JSON.stringify(request), encoding: 'utf8', windowsHide: true, timeout: 30000,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
export function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avc-offline-test-'));
  t.after(() => {
    const resolved = fs.realpathSync(root);
    assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(resolved).startsWith('avc-offline-test-'));
    fs.rmSync(resolved, { recursive: true });
  });
  return root;
}

export function syntheticRun() {
  const runId = 'synthetic-run-20260913', viewport = { width: 1366, height: 768 };
  const actors = ['pastor', 'leader', 'cashier', 'kitchen'].map(role => ({ id: role, role, contextFile: `${role}.trace`, pageId: `page-${role}` }));
  const events = Object.fromEntries(actors.map(actor => [actor.contextFile, [{ type: 'context-options', options: { viewport } }]]));
  let clock = 1, call = 0;
  const receipts = [];
  for (const module of MODULES) {
    const entityKey = `entity-${module.id}`;
    receipts.push({ moduleId: module.id, entityKey, entityId: `id-${module.id}`, status: 'passed',
      checks: module.segments.flatMap(s => s.milestones), ...(module.id === 9 ? {
        openingCents: 5000, salesCents: 4500, expectedCents: 9500, countedCents: 9500, differenceCents: 0,
        closedSessionId: 'id-9', nextSessionId: 'id-new',
        mode: 'independent', independentEnabledViaUI: true, cashierId: 'cashier-id', openedBy: 'cashier-id',
      } : {}) });
    for (const segment of module.segments) {
      const actor = actors.find(a => a.role === segment.role), e = events[actor.contextFile];
      const metadata = { runId, moduleId: module.id, segmentId: segment.id, actorId: actor.id, entityKey };
      const parent = `call-${++call}`;
      e.push({ type: 'before', callId: parent, startTime: clock++, class: 'Tracing', method: 'tracingGroup', title: markerTitle({ ...metadata, kind: 'segment' }) });
      for (const milestone of segment.milestones) {
        const child = `call-${++call}`;
        e.push({ type: 'before', callId: child, parentId: parent, startTime: clock++, class: 'Tracing', method: 'tracingGroup', title: markerTitle({ ...metadata, kind: 'milestone', milestone }) });
        // Deliberate repeats: two frames are not two different visual states.
        e.push({ type: 'screencast-frame', pageId: actor.pageId, timestamp: clock++, sha256: 'red.jpg' });
        e.push({ type: 'screencast-frame', pageId: actor.pageId, timestamp: clock++, sha256: 'red.jpg' });
        e.push({ type: 'screencast-frame', pageId: actor.pageId, timestamp: clock++, sha256: 'blue.jpg' });
        e.push({ type: 'after', callId: child, endTime: clock++ });
      }
      e.push({ type: 'after', callId: parent, endTime: clock++ });
    }
  }
  const traceHash = 'a'.repeat(64);
  const runnerResult = { schema: 1, testId: 'training-test-1', runId, status: 'passed', retry: 0, traceSha256: traceHash };
  const approval = { schema: 1, contractVersion: CONTRACT_VERSION, runId, testId: runnerResult.testId, status: 'passed', cleanupStatus: 'passed',
    traceSha256: traceHash, runnerResultSha256: sha256(JSON.stringify(runnerResult)), viewport, actors, receipts };
  const serialize = () => Object.fromEntries(Object.entries(events).map(([k, v]) => [k, v.map(e => JSON.stringify(e)).join('\n')]));
  return { events, approval, runnerResult, serialize };
}
