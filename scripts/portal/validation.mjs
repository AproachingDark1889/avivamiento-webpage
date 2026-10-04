import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CONTRACT_VERSION, MODULES, readMarker } from './contracts.mjs';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const fileHash = path => sha256(readFileSync(path));
export function requireThat(ok, code) { if (!ok) throw new Error(code); }

export function pythonCall(script, payload, python = 'python') {
  const result = spawnSync(python, [fileURLToPath(new URL(script, import.meta.url))], {
    input: JSON.stringify(payload), encoding: 'utf8', windowsHide: true,
    maxBuffer: 16 * 1024 * 1024, timeout: 120000,
  });
  requireThat(!result.error && result.status === 0, `${script}:OFFLINE_HELPER_FAILED`);
  return JSON.parse(result.stdout);
}
export const decodeImages = (paths, python) => pythonCall('images.py', { paths }, python);

export function validateApproval(approval, traceHash, runnerResult) {
  requireThat(approval?.schema === 1 && approval.contractVersion === CONTRACT_VERSION, 'APPROVAL_SCHEMA');
  requireThat(/^[a-zA-Z0-9_-]{8,100}$/.test(approval.runId), 'RUN_ID');
  requireThat(typeof approval.testId === 'string' && approval.testId.length > 0, 'TEST_ID');
  requireThat(runnerResult?.schema === 1 && runnerResult.testId === approval.testId && runnerResult.runId === approval.runId, 'RUNNER_RESULT_IDENTITY');
  requireThat(runnerResult.status === 'passed' && runnerResult.retry === 0 && runnerResult.traceSha256 === traceHash, 'RUNNER_RESULT_NOT_PASSED');
  requireThat(approval.runnerResultSha256 === sha256(JSON.stringify(runnerResult)), 'RUNNER_RESULT_HASH');
  requireThat(approval.status === 'passed' && approval.cleanupStatus === 'passed', 'RUN_NOT_APPROVED');
  requireThat(/^[a-f0-9]{64}$/.test(traceHash) && approval.traceSha256 === traceHash, 'TRACE_HASH_MISMATCH');
  requireThat(approval.viewport?.width === 1366 && approval.viewport?.height === 768, 'VIEWPORT_MISMATCH');
  requireThat(Array.isArray(approval.actors) && approval.actors.length > 0, 'ACTORS_MISSING');
  const ids = new Set(), locations = new Set();
  for (const actor of approval.actors) {
    const location = `${actor.contextFile}/${actor.pageId}`;
    requireThat(/^[a-zA-Z0-9_-]+$/.test(actor.id) && !ids.has(actor.id), 'DUPLICATE_ACTOR');
    requireThat(/^[a-zA-Z0-9_.-]+\.trace$/.test(actor.contextFile) && typeof actor.pageId === 'string' && actor.pageId, 'ACTOR_BINDING');
    requireThat(!locations.has(location), 'AMBIGUOUS_ACTOR_PAGE');
    ids.add(actor.id); locations.add(location);
  }
  requireThat(Array.isArray(approval.receipts) && approval.receipts.length === MODULES.length, 'RECEIPTS_MISSING');
  for (const module of MODULES) {
    const matches = approval.receipts.filter(r => r.moduleId === module.id);
    requireThat(matches.length === 1, 'RECEIPT_DUPLICATE');
    const receipt = matches[0];
    requireThat(receipt.status === 'passed' && /^[a-zA-Z0-9_-]+$/.test(receipt.entityKey) && typeof receipt.entityId === 'string' && receipt.entityId.length > 0, 'ENTITY_RECEIPT');
    const expected = module.segments.flatMap(s => s.milestones);
    requireThat(Array.isArray(receipt.checks) && expected.every(id => receipt.checks.includes(id)), 'RESULT_MISSING');
    if (module.id === 9) {
      requireThat(receipt.mode === 'independent' && receipt.independentEnabledViaUI === true
        && typeof receipt.cashierId === 'string' && receipt.cashierId.length > 0
        && receipt.openedBy === receipt.cashierId, 'CONTINGENCY_INDEPENDENT_CONTEXT');
      requireThat(receipt.openingCents === 5000 && receipt.salesCents === 4500 && receipt.expectedCents === 9500 && receipt.countedCents === 9500 && receipt.differenceCents === 0, 'CONTINGENCY_TOTALS');
      requireThat(receipt.closedSessionId === receipt.entityId && typeof receipt.nextSessionId === 'string' && receipt.nextSessionId && receipt.nextSessionId !== receipt.entityId, 'CONTINGENCY_UNBLOCK');
    }
  }
  return approval;
}

export function parseTrace(text) {
  const actions = new Map(), frames = [], contexts = [];
  for (const line of text.split(/\r?\n/).filter(s => s.trim())) {
    let e;
    try { e = JSON.parse(line); } catch { throw new Error('MALFORMED_TRACE_LINE'); }
    if (e.type === 'context-options') contexts.push(e);
    if (e.type === 'before') {
      requireThat(!actions.has(e.callId) && Number.isFinite(e.startTime), 'BAD_ACTION_START');
      actions.set(e.callId, { ...e, marker: readMarker(e.title) });
    }
    if (e.type === 'after') {
      const a = actions.get(e.callId);
      requireThat(a && a.endTime === undefined && Number.isFinite(e.endTime) && e.endTime >= a.startTime, 'UNPAIRED_ACTION');
      Object.assign(a, { endTime: e.endTime, error: e.error });
    }
    if (e.type === 'screencast-frame') {
      requireThat(Number.isFinite(e.timestamp) && typeof e.pageId === 'string' && /^[a-zA-Z0-9_-]+\.(jpg|jpeg|png)$/.test(e.sha256), 'BAD_FRAME');
      frames.push(e);
    }
  }
  for (const a of actions.values()) requireThat(a.endTime !== undefined && !a.error, 'INCOMPLETE_OR_FAILED_ACTION');
  return { actions: [...actions.values()], frames: frames.sort((a, b) => a.timestamp - b.timestamp), contexts };
}

export function selectScenes(approval, traces) {
  const scenes = [];
  for (const module of MODULES) {
    const receipt = approval.receipts.find(r => r.moduleId === module.id);
    let previousEnd = -Infinity;
    for (const segment of module.segments) {
      const matches = [];
      for (const [contextFile, trace] of Object.entries(traces)) {
        for (const a of trace.actions) if (a.marker?.kind === 'segment' && a.marker.moduleId === module.id && a.marker.segmentId === segment.id) matches.push({ contextFile, trace, a });
      }
      requireThat(matches.length === 1, 'SEGMENT_MISSING_OR_DUPLICATE');
      const { contextFile, trace, a } = matches[0], marker = a.marker;
      const actor = approval.actors.find(actor => actor.id === marker.actorId);
      requireThat(marker.runId === approval.runId && marker.entityKey === receipt.entityKey, 'RUN_OR_ENTITY_MISMATCH');
      requireThat(actor?.role === segment.role && actor.contextFile === contextFile, 'WRONG_ACTOR');
      requireThat(trace.contexts.length === 1 && trace.contexts[0].options?.viewport?.width === approval.viewport.width && trace.contexts[0].options?.viewport?.height === approval.viewport.height, 'TRACE_VIEWPORT_MISMATCH');
      requireThat(a.startTime >= previousEnd, 'SEGMENT_ORDER');
      previousEnd = a.endTime;
      let last = a.startTime;
      const windows = [];
      for (const milestone of segment.milestones) {
        const children = trace.actions.filter(child => child.parentId === a.callId && child.marker?.milestone === milestone);
        requireThat(children.length === 1, 'MILESTONE_MISSING_OR_DUPLICATE');
        const child = children[0], cm = child.marker;
        requireThat(cm.kind === 'milestone' && cm.runId === marker.runId && cm.moduleId === module.id && cm.segmentId === segment.id && cm.actorId === actor.id && cm.entityKey === marker.entityKey, 'MILESTONE_BINDING');
        requireThat(child.startTime >= last && child.endTime <= a.endTime, 'MILESTONE_ORDER');
        last = child.endTime;
        const within = trace.frames.filter(f => f.pageId === actor.pageId && f.timestamp >= child.startTime && f.timestamp <= child.endTime);
        requireThat(within.length > 0, 'MILESTONE_HAS_NO_FRAMES');
        windows.push({ id: milestone, start: child.startTime, end: child.endTime });
      }
      const frames = trace.frames.filter(f => f.pageId === actor.pageId && f.timestamp >= a.startTime && f.timestamp <= a.endTime);
      scenes.push({ moduleId: module.id, segmentId: segment.id, actorId: actor.id, entityKey: marker.entityKey, entityId: receipt.entityId, contextFile, start: a.startTime, end: a.endTime, windows, frames });
    }
  }
  return scenes;
}
