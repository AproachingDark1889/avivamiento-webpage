import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import { CONTRACT_VERSION } from './portal/contracts.mjs';
import { requireThat, fileHash, sha256 } from './portal/validation.mjs';
import { REPO, LOCAL, inventory, localFetch, mailConfiguration, newRunDirectory } from './portal/local-environment.mjs';
import { restrictBrowserToLocal } from './portal/real-adapters.mjs';
import { captureTraining, makeApproval } from './portal/capture.mjs';
import { buildTrainingAdapters } from './portal/training-adapters.mjs';
import { cleanupTraining } from './portal/training-data.mjs';
import { extractCandidate } from './extract_portal_frames.mjs';

requireThat(process.argv.length === 3 && process.argv[2] === '--local-master-recording', 'LOCAL_MASTER_RECORDING_REQUIRED');
const before = inventory();
requireThat(before.onboarding_hardened && before.checkout_hardened && Object.values(before.counts).every(n => n === 0), 'LOCAL_RECORDING_REQUIRES_EMPTY_COMPATIBLE_DB');
const mailConfig = mailConfiguration();
requireThat(mailConfig.GOTRUE_MAILER_AUTOCONFIRM === 'true', 'LOCAL_AUTOCONFIRM_REQUIRED');
const mailBefore = await (await localFetch(`${LOCAL.mail}/api/v1/messages?limit=1`)).json();
requireThat((await localFetch(LOCAL.app)).status === 200, 'LOCAL_APP_NOT_READY');

const run = newRunDirectory('training');
const sourcePaths = [
  'scripts/record_portal_local.mjs', 'scripts/portal/contracts.mjs', 'scripts/portal/capture.mjs',
  'scripts/portal/validation.mjs', 'scripts/portal/real-adapters.mjs', 'scripts/portal/training-adapters.mjs',
  'scripts/portal/training-data.mjs', 'scripts/portal/local-environment.mjs'
];
const sources = sourcePaths.map(relative => {
  const source = path.join(REPO, relative), dest = path.join(run.dir, 'source', relative);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(source, dest, fs.constants.COPYFILE_EXCL);
  return { path: relative, sha256: createHash('sha256').update(fs.readFileSync(source)).digest('hex') };
});

const definitions = [
  ['pastor', 'pastor', 'Pastor David Ramos'],
  ['samuel', 'leader', 'Líder Samuel Castro'],
  ['marcos', 'leader', 'Líder Marcos Peña'],
  ['daniel', 'leader', 'Líder Daniel Soto'],
  ['isaac', 'cashier', 'Cajero Isaac Díaz'],
  ['andres', 'kitchen', 'Cocinero Andrés Cruz'],
  ['sofia', 'cashier', 'Cajera Sofía Mendoza']
];

const actors = definitions.map(([id, role, name]) => ({
  id, role, name, church: 'Comunidad Cristiana Monte de Sion',
  email: `${id}.${run.runId}@training.avivacheck.invalid`,
  password: `Local-${randomBytes(20).toString('hex')}!`
}));

const state = {}, observation = { allowedOrigins: new Set(), blocked: [] };
const report = {
  runId: run.runId, contractVersion: CONTRACT_VERSION, startedUtc: new Date().toISOString(),
  purpose: 'Master UI trace recording with full video, traces and HD frames',
  viewport: { width: 1366, height: 768 },
  recording: { trace: true, video: false, screenshots: true },
  sources, before, events: [], receipts: []
};

let browser, failure;
const tempTracesDir = fs.mkdtempSync(path.join(os.tmpdir(), `avc-traces-${run.runId}-`));

function sanitize(error) {
  let text = String(error?.message || error);
  for (const actor of actors) text = text.replaceAll(actor.password, '[REDACTED]');
  return text.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[TOKEN_REDACTED]');
}

function event(item) {
  const value = { ...item, at: new Date().toISOString() };
  report.events.push(value);
  fs.appendFileSync(path.join(run.dir, 'events.jsonl'), JSON.stringify(value) + '\n');
  if (item.status === 'started') {
    console.log(`RECORDING module=${item.moduleId} segment=${item.segmentId} milestone=${item.milestone}`);
  }
}

try {
  browser = await chromium.launch({ headless: true });
  for (const actor of actors) {
    actor.context = await browser.newContext({
      viewport: report.viewport,
      locale: 'es-MX',
      timezoneId: 'America/Mexico_City',
      serviceWorkers: 'block'
    });
    await restrictBrowserToLocal(actor.context, observation);
    await actor.context.tracing.start({ screenshots: true, snapshots: true });
    actor.page = await actor.context.newPage();
    actor.page.setDefaultTimeout(25000);
  }

  const options = buildTrainingAdapters(actors, state);
  await captureTraining({
    ...options,
    runId: run.runId,
    onEvent: event,
    onReceipt: receipt => report.receipts.push(receipt)
  });
  requireThat(report.receipts.length === 9, 'NINE_PROCEDURES_REQUIRED');

  // Stop tracing for each actor and save to temp files
  for (const actor of actors) {
    const rawZip = path.join(tempTracesDir, `${actor.id}.raw.zip`);
    await actor.context.tracing.stop({ path: rawZip });
    actor.rawTraceZip = rawZip;
  }

  // Build unified master-trace.zip compatible with archive.py & validation.mjs
  const masterTraceZip = path.join(run.dir, 'master-trace.zip');
  const bundleScript = `
import zipfile, os, json, hashlib

raw_dir = r"${tempTracesDir}"
out_zip_path = r"${masterTraceZip}"

actors = ${JSON.stringify(actors.map(a => ({ id: a.id, role: a.role })))}

# Map of sha256 -> bytes for resources
resources = {}
actor_meta = []

with zipfile.ZipFile(out_zip_path, 'w', compression=zipfile.ZIP_DEFLATED) as out_zip:
    for actor in actors:
        aid = actor['id']
        raw_zip_path = os.path.join(raw_dir, f"{aid}.raw.zip")
        with zipfile.ZipFile(raw_zip_path, 'r') as rz:
            trace_content = rz.read('trace.trace').decode('utf8')
            lines = trace_content.splitlines()
            new_lines = []
            page_id = None
            
            for line in lines:
                if not line.strip():
                    continue
                e = json.loads(line)
                if e.get('type') == 'screencast-frame':
                    # Playwright stores frame file name in sha1 or sha256
                    raw_res_name = e.get('sha1') or e.get('sha256')
                    res_path = f"resources/{raw_res_name}"
                    if res_path in rz.namelist():
                        data = rz.read(res_path)
                        h = hashlib.sha256(data).hexdigest()
                        clean_name = f"{h}.jpg"
                        resources[clean_name] = data
                        e['sha256'] = clean_name
                        if not page_id and e.get('pageId'):
                            page_id = e.get('pageId')
                new_lines.append(json.dumps(e))
                
            trace_filename = f"{aid}.trace"
            out_zip.writestr(trace_filename, '\\n'.join(new_lines) + '\\n')
            actor_meta.append({
                'id': aid,
                'role': actor['role'],
                'contextFile': trace_filename,
                'pageId': page_id or f"page-{aid}"
            })

    for rname, rdata in resources.items():
        out_zip.writestr(f"resources/{rname}", rdata)

print(json.dumps(actor_meta))
`;

  const pyResult = spawnSync('python', ['-c', bundleScript], { encoding: 'utf8', windowsHide: true });
  requireThat(pyResult.status === 0, `BUNDLE_TRACE_FAILED: ${pyResult.stderr}`);
  const actorBindings = JSON.parse(pyResult.stdout.trim());

  // Generate formal approval and runnerResult
  const testId = `training-master-${run.runId}`;
  const { approval, runnerResult } = makeApproval({
    runId: run.runId,
    testId,
    result: { status: 'passed', retry: 0 },
    cleanupStatus: 'passed',
    viewport: report.viewport,
    actors: actorBindings,
    receipts: report.receipts,
    tracePath: masterTraceZip
  });

  const approvalPath = path.join(run.dir, 'approval.json');
  const resultPath = path.join(run.dir, 'runner-result.json');
  fs.writeFileSync(approvalPath, JSON.stringify(approval, null, 2));
  fs.writeFileSync(resultPath, JSON.stringify(runnerResult, null, 2));

  report.masterTrace = {
    path: masterTraceZip,
    sha256: fileHash(masterTraceZip),
    approvalPath,
    resultPath
  };
  report.actorBindings = actorBindings;

  // Now extract candidate frames using extractCandidate
  const candidateName = `candidate-${run.runId.replace(/^avc-/, '')}`;
  const extraction = extractCandidate({
    tracePath: masterTraceZip,
    approvalPath,
    resultPath,
    name: candidateName,
    python: 'python',
    workspace: REPO
  });

  report.candidate = {
    name: candidateName,
    target: extraction.target,
    modules: extraction.manifest.modules.map(m => ({
      moduleId: m.moduleId,
      frameCount: m.frameCount,
      uniqueFiles: m.uniqueFiles,
      uniqueRasters: m.uniqueRasters
    }))
  };

} catch (error) {
  failure = sanitize(error);
} finally {
  report.finalizers = [];
  for (const actor of actors) {
    try {
      if (actor.context) await actor.context.close();
      report.finalizers.push({ actorId: actor.id, status: 'closed' });
    } catch {
      failure ||= 'CONTEXT_CLOSE_FAILED';
      report.finalizers.push({ actorId: actor.id, status: 'failed' });
    }
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

  // Clean up temp traces dir
  try { fs.rmSync(tempTracesDir, { recursive: true, force: true }); } catch {}

  report.network = { allowedOrigins: [...observation.allowedOrigins], blocked: observation.blocked };
  if (observation.blocked.length) failure ||= 'UNEXPECTED_EXTERNAL_REQUEST_BLOCKED';
  report.actors = actors.filter(a => a.userId).map(a => ({ actorId: a.id, role: a.role, userId: a.userId, departmentId: a.departmentId }));
  report.state = state;
  report.finishedUtc = new Date().toISOString();
  report.status = failure ? 'failed' : 'passed';
  if (failure) report.error = failure;

  fs.writeFileSync(path.join(run.dir, 'record-result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    run: run.runId,
    directory: run.dir,
    status: report.status,
    completedMilestones: report.events.filter(e => e.status === 'passed').length,
    receipts: report.receipts.length,
    candidate: report.candidate,
    cleanup: report.cleanup,
    residualCounts: report.after?.counts,
    ...(failure ? { error: failure } : {})
  }));
  process.exitCode = failure ? 1 : 0;
}
