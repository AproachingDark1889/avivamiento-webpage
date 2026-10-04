import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
import { CONTRACT_VERSION } from './portal/contracts.mjs';
import { requireThat } from './portal/validation.mjs';
import { REPO, LOCAL, inventory, localFetch, mailConfiguration, newRunDirectory } from './portal/local-environment.mjs';
import { restrictBrowserToLocal } from './portal/real-adapters.mjs';
import { rehearseTraining } from './portal/capture.mjs';
import { buildTrainingAdapters } from './portal/training-adapters.mjs';
import { cleanupTraining } from './portal/training-data.mjs';

requireThat(process.argv.length === 3 && process.argv[2] === '--local-ui-rehearsal', 'LOCAL_REHEARSAL_ONLY_NO_RECORDING');
const before = inventory();
requireThat(before.onboarding_hardened && before.checkout_hardened && Object.values(before.counts).every(n => n === 0), 'LOCAL_REHEARSAL_REQUIRES_EMPTY_COMPATIBLE_DB');
const mailConfig = mailConfiguration();
requireThat(mailConfig.GOTRUE_MAILER_AUTOCONFIRM === 'true', 'LOCAL_AUTOCONFIRM_REQUIRED');
const mailBefore = await (await localFetch(`${LOCAL.mail}/api/v1/messages?limit=1`)).json();
requireThat((await localFetch(LOCAL.app)).status === 200, 'LOCAL_APP_NOT_READY');
const run = newRunDirectory('training');
const sourcePaths = ['scripts/rehearse_portal_local.mjs', 'scripts/portal/contracts.mjs', 'scripts/portal/capture.mjs',
  'scripts/portal/validation.mjs', 'scripts/portal/real-adapters.mjs', 'scripts/portal/training-adapters.mjs',
  'scripts/portal/training-data.mjs', 'scripts/portal/local-environment.mjs'];
const sources = sourcePaths.map(relative => {
  const source = path.join(REPO, relative), dest = path.join(run.dir, 'source', relative);
  fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(source, dest, fs.constants.COPYFILE_EXCL);
  return { path: relative, sha256: createHash('sha256').update(fs.readFileSync(source)).digest('hex') };
});
const definitions = [['pastor','pastor','Pastor David Ramos'], ['samuel','leader','Líder Samuel Castro'],
  ['marcos','leader','Líder Marcos Peña'], ['daniel','leader','Líder Daniel Soto'],
  ['isaac','cashier','Cajero Isaac Díaz'], ['andres','kitchen','Cocinero Andrés Cruz'], ['sofia','cashier','Cajera Sofía Mendoza']];
const actors = definitions.map(([id, role, name]) => ({ id, role, name, church: 'Comunidad Cristiana Monte de Sion',
  email: `${id}.${run.runId}@training.avivacheck.invalid`, password: `Local-${randomBytes(20).toString('hex')}!` }));
const state = {}, observation = { allowedOrigins: new Set(), blocked: [] };
const report = { runId: run.runId, contractVersion: CONTRACT_VERSION, startedUtc: new Date().toISOString(),
  purpose: 'Local UI adapter verification, not master recording', viewport: { width: 1366, height: 768 },
  recording: { trace: false, video: false, screenshots: false }, sources, before, events: [], receipts: [] };
let browser, failure;
function sanitize(error) {
  let text = String(error?.message || error);
  for (const actor of actors) text = text.replaceAll(actor.password, '[REDACTED]');
  return text.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[TOKEN_REDACTED]');
}
function event(item) {
  const value = { ...item, at: new Date().toISOString() }; report.events.push(value);
  fs.appendFileSync(path.join(run.dir, 'events.jsonl'), JSON.stringify(value) + '\n');
  if (item.status === 'started') console.log(`REHEARSAL module=${item.moduleId} segment=${item.segmentId} milestone=${item.milestone}`);
}
try {
  browser = await chromium.launch({ headless: true });
  for (const actor of actors) {
    actor.context = await browser.newContext({ viewport: report.viewport, locale: 'es-MX', timezoneId: 'America/Mexico_City', serviceWorkers: 'block' });
    await restrictBrowserToLocal(actor.context, observation);
    actor.context.tracing.start = async () => { throw new Error('REHEARSAL_TRACE_FORBIDDEN'); };
    actor.context.tracing.group = async () => { throw new Error('REHEARSAL_TRACE_GROUP_FORBIDDEN'); };
    actor.page = await actor.context.newPage(); actor.page.setDefaultTimeout(20000);
    actor.page.screenshot = async () => { throw new Error('REHEARSAL_SCREENSHOT_FORBIDDEN'); };
  }
  const options = buildTrainingAdapters(actors, state);
  await rehearseTraining({ ...options, runId: run.runId, onEvent: event, onReceipt: receipt => report.receipts.push(receipt) });
  requireThat(report.receipts.length === 9, 'NINE_PROCEDURES_REQUIRED');
} catch (error) { failure = sanitize(error); }
finally {
  report.finalizers = [];
  for (const actor of actors) {
    try { if (actor.context) await actor.context.close(); report.finalizers.push({ actorId: actor.id, status: 'closed' }); }
    catch { failure ||= 'CONTEXT_CLOSE_FAILED'; report.finalizers.push({ actorId: actor.id, status: 'failed' }); }
  }
  try { if (browser) await browser.close(); } catch { failure ||= 'BROWSER_CLOSE_FAILED'; }
  try { report.cleanup = cleanupTraining(run.runId, actors, state); }
  catch (error) { report.cleanup = { status: 'failed', error: sanitize(error) }; failure ||= 'CLEANUP_FAILED'; }
  try {
    report.after = inventory();
    if (Object.values(report.after.counts).some(n => n !== 0)) failure ||= 'LOCAL_DB_RESIDUAL';
    const mailAfter = await (await localFetch(`${LOCAL.mail}/api/v1/messages?limit=1`)).json();
    report.mail = { before: mailBefore.total, after: mailAfter.total, autoConfirm: true };
    if (mailAfter.total !== mailBefore.total) failure ||= 'LOCAL_MAIL_CHANGED_REQUIRES_SCOPED_REVIEW';
  } catch { failure ||= 'FINAL_INVENTORY_FAILED'; }
  report.network = { allowedOrigins: [...observation.allowedOrigins], blocked: observation.blocked };
  if (observation.blocked.length) failure ||= 'UNEXPECTED_EXTERNAL_REQUEST_BLOCKED';
  report.actors = actors.filter(a => a.userId).map(a => ({ actorId: a.id, role: a.role, userId: a.userId, departmentId: a.departmentId }));
  report.state = state; report.finishedUtc = new Date().toISOString(); report.status = failure ? 'failed' : 'passed';
  if (failure) report.error = failure;
  fs.writeFileSync(path.join(run.dir, 'rehearsal-result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ run: run.runId, directory: run.dir, status: report.status, completedMilestones: report.events.filter(e => e.status === 'passed').length,
    receipts: report.receipts.length, cleanup: report.cleanup, residualCounts: report.after?.counts, ...(failure ? { error: failure } : {}) }));
  process.exitCode = failure ? 1 : 0;
}
