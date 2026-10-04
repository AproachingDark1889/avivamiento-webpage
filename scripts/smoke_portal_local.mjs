import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import { inventory, newRunDirectory, quoteSql, readJsonSql, localSql, LOCAL, localFetch, localAnonymousKey, mailConfiguration } from './portal/local-environment.mjs';
import { signupOrganization, restrictBrowserToLocal } from './portal/real-adapters.mjs';
import { waitForOwnedMail, cleanupOwnedMail } from './portal/local-mail.mjs';

if (process.argv[2] !== '--ephemeral-local-smoke') throw new Error('EXPLICIT_LOCAL_SMOKE_REQUIRED');
const run = newRunDirectory('phase3-smoke');
const identity = { name: 'Pastor Prueba Local', church: `Prueba efímera ${run.runId}`,
  email: `smoke.${run.runId}@training.avivacheck.invalid`, password: `Local-${randomBytes(20).toString('hex')}!` };
const observation = { allowedOrigins: new Set(), blocked: [] };
let browser, context, created, failure;
const report = { runId: run.runId, startedUtc: new Date().toISOString(), scope: 'ephemeral local organization only; no master trace', steps: {} };
function sanitized(error) { return String(error.message).replaceAll(identity.password, '[REDACTED]').replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[TOKEN_REDACTED]'); }
function discoverOwned() {
  return readJsonSql(`coalesce(json_agg(json_build_object('userId',u.id,'orgId',p.org_id)), '[]'::json)
    FROM auth.users u LEFT JOIN public.profiles p ON p.id=u.id WHERE u.email=${quoteSql(identity.email)}`);
}
function cleanup() {
  const owned = discoverOwned();
  expect(owned.length).toBeLessThanOrEqual(1);
  if (!owned.length) return { status: 'passed', deletedUsers: 0, deletedOrganizations: 0 };
  const { userId, orgId } = owned[0];
  if (created?.userId) expect(userId).toBe(created.userId);
  if (created?.orgId) expect(orgId).toBe(created.orgId);
  const uid = quoteSql(userId), org = orgId ? quoteSql(orgId) : 'NULL';
  localSql(`BEGIN;
    SET LOCAL lock_timeout='5s';
    DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.profiles WHERE org_id=${org} AND id<>${uid}) THEN RAISE EXCEPTION 'UNEXPECTED_MEMBER_STOP_CLEANUP'; END IF; END $$;
    DELETE FROM public.order_items WHERE order_id IN (SELECT id FROM public.orders WHERE org_id=${org});
    DELETE FROM public.orders WHERE org_id=${org}; DELETE FROM public.cash_closures WHERE org_id=${org};
    DELETE FROM public.cash_sessions WHERE org_id=${org}; DELETE FROM public.products WHERE org_id=${org};
    UPDATE public.organizations SET owner_id=NULL WHERE id=${org} AND owner_id=${uid};
    DELETE FROM public.profiles WHERE id=${uid}; DELETE FROM public.organizations WHERE id=${org};
    DELETE FROM auth.refresh_tokens WHERE user_id=${quoteSql(userId)};
    DELETE FROM auth.audit_log_entries WHERE payload->>'actor_id'=${quoteSql(userId)};
    DELETE FROM auth.users WHERE id=${uid} AND email=${quoteSql(identity.email)};
    COMMIT;`);
  expect(discoverOwned()).toEqual([]);
  return { status: 'passed', deletedUsers: 1, deletedOrganizations: orgId ? 1 : 0 };
}
try {
  const before = inventory();
  expect(before.onboarding_hardened).toBe(true); expect(before.checkout_hardened).toBe(true);
  expect(Object.values(before.counts).every(n => n === 0)).toBe(true);
  report.steps.schema = { status: 'passed', migrations: before.migration_versions.length, tables: before.tables };
  report.mailConfiguration = mailConfiguration();
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 1366, height: 768 }, serviceWorkers: 'block' });
  await restrictBrowserToLocal(context, observation);
  const page = await context.newPage();
  created = await signupOrganization(page, identity, async userId => { created = { userId }; });
  const database = readJsonSql(`json_build_object('role',p.role,'orgId',p.org_id,'ownerId',o.owner_id,'onboardingCompleted',p.onboarding_completed)
    FROM public.profiles p JOIN public.organizations o ON o.id=p.org_id WHERE p.id=${quoteSql(created.userId)}`);
  expect(database.role).toBe('pastor'); expect(database.orgId).toBe(created.orgId); expect(database.ownerId).toBe(created.userId);
  report.steps.organization = { status: 'passed', ...created, verifiedInPostgres: true };
  const config = await page.evaluate(() => ({ url: window.__NUXT__?.config?.public?.supabaseUrl, training: window.__NUXT__?.config?.public?.localTraining }));
  expect(config.url).toBe(LOCAL.api); expect(config.training).toBe(true);
  report.steps.nuxt = { status: 'passed', effectiveApi: config.url, localTraining: config.training };
  // Mailer auto-confirm is enabled; recovery mail separately exercises local SMTP.
  const mail = await localFetch(`${LOCAL.api}/auth/v1/recover`, { method: 'POST', headers: { apikey: localAnonymousKey(), 'Content-Type': 'application/json' }, body: JSON.stringify({ email: identity.email }) });
  expect(mail.status).toBe(200);
  report.steps.mailRequest = { status: 'accepted', httpStatus: mail.status };
  report.steps.mailDelivery = await waitForOwnedMail(run.runId, identity.email);
} catch (error) { failure = sanitized(error); }
finally {
  try { if (context) await context.close(); } catch { report.contextCloseFailed = true; failure ||= 'CONTEXT_CLOSE_FAILED'; }
  try { if (browser) await browser.close(); } catch { report.browserCloseFailed = true; failure ||= 'BROWSER_CLOSE_FAILED'; }
  try { report.steps.cleanup = cleanup(); } catch (error) { report.steps.cleanup = { status: 'failed', error: sanitized(error) }; failure ||= 'CLEANUP_FAILED'; }
  try { report.steps.mailCleanup = await cleanupOwnedMail(run.runId, identity.email); }
  catch (error) { report.steps.mailCleanup = { status: 'failed', error: sanitized(error) }; failure ||= 'MAIL_CLEANUP_FAILED'; }
  try {
    report.after = inventory();
    if (!Object.values(report.after.counts).every(n => n === 0)) failure ||= 'RESIDUAL_DATA';
  } catch { failure ||= 'FINAL_INVENTORY_FAILED'; }
  report.network = { allowedOrigins: [...observation.allowedOrigins], blocked: observation.blocked };
  report.finishedUtc = new Date().toISOString(); report.status = failure ? 'failed' : 'passed';
  if (failure) report.error = failure;
  fs.writeFileSync(path.join(run.dir, 'smoke-result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, directory: run.dir, steps: report.steps, residualCounts: report.after?.counts, ...(failure ? { error: failure } : {}) }));
  process.exitCode = failure ? 1 : 0;
}
