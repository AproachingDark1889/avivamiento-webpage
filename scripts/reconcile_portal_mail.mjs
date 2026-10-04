import fs from 'node:fs';
import path from 'node:path';
import { REPO, newRunDirectory } from './portal/local-environment.mjs';
import { ownedMailbox, findOwnedMail, cleanupOwnedMail } from './portal/local-mail.mjs';
import { requireThat } from './portal/validation.mjs';

requireThat(process.argv[2] === '--previous-smoke', 'EXPLICIT_RECONCILIATION_REQUIRED');
const previous = process.argv[3];
const email = `smoke.${previous}@training.avivacheck.invalid`;
ownedMailbox(previous, email);
const prior = JSON.parse(fs.readFileSync(path.join(REPO, 'test-results', previous, 'smoke-result.json'), 'utf8'));
requireThat(prior.runId === previous && prior.steps.organization?.status === 'passed'
  && prior.steps.mailRequest?.httpStatus === 200, 'PREVIOUS_OWN_SMOKE_NOT_VERIFIED');
const run = newRunDirectory('phase3-mail-reconciliation');
const report = { runId: run.runId, previousRunId: previous, checkedUtc: new Date().toISOString(),
  scope: 'Only mail addressed to this prior smoke identity; no database writes; prior report preserved' };
try {
  const messages = await findOwnedMail(previous, email);
  report.deliveryObservedNow = messages.length > 0;
  report.cleanup = await cleanupOwnedMail(previous, email);
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = error.message; process.exitCode = 1; }
fs.writeFileSync(path.join(run.dir, 'mail-reconciliation.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ ...report, directory: run.dir }));
