import { CONTRACT_VERSION, MODULES, markerTitle } from './contracts.mjs';
import { attemptAll } from './lifecycle.mjs';
import { requireThat, fileHash, sha256, validateApproval } from './validation.mjs';

// Never starts a browser or reads credentials. Phase 3 supplies UI + server
// assertion adapters only AFTER the local environment is approved.
async function executeTraining({ runId, actors, adapters, entityKeys, verifyModule, beforeModule = async () => {}, onEvent = () => {}, onReceipt = () => {} }, recording) {
  const receipts = [];
  for (const module of MODULES) {
    await beforeModule(module.id);
    const entityKey = entityKeys[module.id];
    requireThat(typeof entityKey === 'string' && entityKey.length > 0, 'CAPTURE_ENTITY_KEY');
    const checks = [];
    for (const segment of module.segments) {
      const adapter = adapters[`${module.id}/${segment.id}`];
      const actor = actors.find(a => a.id === adapter?.actorId);
      requireThat(actor?.role === segment.role, 'CAPTURE_ACTOR');
      requireThat(segment.milestones.every(id => typeof adapter.actions?.[id] === 'function'), 'CAPTURE_ACTION_MISSING');
      const metadata = { runId, moduleId: module.id, segmentId: segment.id, actorId: actor.id, entityKey };
      if (recording) await actor.context.tracing.group(markerTitle({ ...metadata, kind: 'segment' }));
      try {
        for (const milestone of segment.milestones) {
          onEvent({ moduleId: module.id, segmentId: segment.id, actorId: actor.id, milestone, status: 'started' });
          if (recording) await actor.context.tracing.group(markerTitle({ ...metadata, kind: 'milestone', milestone }));
          try {
            // Each adapter must assert its own visible/server result, not just click.
            await adapter.actions[milestone]();
            if (recording) await actor.page.screenshot();
            checks.push(milestone);
            onEvent({ moduleId: module.id, segmentId: segment.id, actorId: actor.id, milestone, status: 'passed' });
          } finally { if (recording) await actor.context.tracing.groupEnd(); }
        }
      } finally { if (recording) await actor.context.tracing.groupEnd(); }
    }
    const verified = await verifyModule(module.id, entityKey);
    requireThat(verified?.status === 'passed' && verified.entityId, 'CAPTURE_RESULT_UNVERIFIED');
    const receipt = { ...verified, moduleId: module.id, entityKey, checks };
    receipts.push(receipt); onReceipt(receipt);
  }
  return receipts;
}

export const captureTraining = options => executeTraining(options, true);
// Same adapters and assertions, without calling tracing/screenshot APIs. This
// rehearsal is execution evidence only and cannot produce extraction approval.
export const rehearseTraining = options => executeTraining(options, false);

export async function runWithFinalization(operation, finalizers) {
  let result, failure;
  try { result = await operation(); } catch (error) { failure = error; }
  try { await attemptAll(finalizers); } catch (error) {
    if (failure) throw new AggregateError([failure, error], 'CAPTURE_AND_FINALIZATION_FAILED');
    throw error;
  }
  if (failure) throw failure;
  return result;
}

// Invoke only after the runner has closed its trace and obtained final results.
// This binds provenance, not authenticity: a fabricated receipt is not evidence.
export function makeApproval({ runId, testId, result, cleanupStatus, viewport, actors, receipts, tracePath }) {
  const traceSha256 = fileHash(tracePath);
  const runnerResult = { schema: 1, runId, testId, status: result.status, retry: result.retry, traceSha256 };
  const approval = validateApproval({ schema: 1, contractVersion: CONTRACT_VERSION,
    runId, testId, status: result.status, cleanupStatus, viewport, actors, receipts, traceSha256,
    runnerResultSha256: sha256(JSON.stringify(runnerResult)) }, traceSha256, runnerResult);
  return { approval, runnerResult };
}
