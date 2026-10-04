import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { fileHash, requireThat } from './validation.mjs';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const LOCAL = Object.freeze({ api: 'http://127.0.0.1:54321', mail: 'http://127.0.0.1:54324', app: 'http://127.0.0.1:3002',
  db: 'supabase_db_avivamiento_webpage-main', kong: 'supabase_kong_avivamiento_webpage-main', auth: 'supabase_auth_avivamiento_webpage-main' });
export function localUrl(value) {
  const url = new URL(value);
  requireThat([LOCAL.api, LOCAL.mail, LOCAL.app].includes(url.origin) && !url.username && !url.password, 'NONLOCAL_DESTINATION_REJECTED');
  return url;
}
export async function localFetch(value, options = {}) {
  localUrl(value);
  const response = await fetch(value, { ...options, redirect: 'manual', signal: AbortSignal.timeout(15000) });
  requireThat(response.status < 300 || response.status >= 400, 'REDIRECT_REQUIRES_LOCAL_REVIEW');
  return response;
}
function docker(args, input) {
  const result = spawnSync('docker', args, { input, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  requireThat(result.status === 0 && !result.error, 'LOCAL_DOCKER_OPERATION_FAILED');
  return result.stdout.trim();
}
export function localSql(sql) {
  // Fixed container, database and peer-local connection: no DSN, .env or remote credentials.
  return docker(['exec', '-i', LOCAL.db, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1'], sql);
}
export function readJsonSql(expression) {
  return JSON.parse(localSql(`BEGIN READ ONLY; SELECT ${expression}; COMMIT;`));
}
export function inventory() {
  return readJsonSql(`json_build_object(
    'server_version',current_setting('server_version'),
    'migration_versions',(SELECT json_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations),
    'tables',(SELECT json_agg(tablename ORDER BY tablename) FROM pg_tables WHERE schemaname='public'),
    'counts',json_build_object('organizations',(SELECT count(*) FROM public.organizations),'profiles',(SELECT count(*) FROM public.profiles),'auth_users',(SELECT count(*) FROM auth.users),'products',(SELECT count(*) FROM public.products),'orders',(SELECT count(*) FROM public.orders),'order_items',(SELECT count(*) FROM public.order_items),'cash_sessions',(SELECT count(*) FROM public.cash_sessions),'cash_closures',(SELECT count(*) FROM public.cash_closures)),
    'onboarding_hardened',(SELECT position('ACV_TENANT_PROFILE_ALREADY_ASSIGNED' in prosrc)>0 FROM pg_proc WHERE oid='public.setup_new_tenant(text,text,text)'::regprocedure),
    'checkout_hardened',(SELECT position('ACV_CHECKOUT_CASH_INSUFFICIENT' in prosrc)>0 FROM pg_proc WHERE oid='public.process_checkout(jsonb,text,numeric,numeric,boolean,text)'::regprocedure))`);
}
export function mailConfiguration() {
  const names = ['GOTRUE_SMTP_HOST', 'GOTRUE_SMTP_PORT', 'GOTRUE_SITE_URL', 'GOTRUE_MAILER_AUTOCONFIRM'];
  const values = docker(['exec', LOCAL.auth, 'printenv', ...names]).split(/\r?\n/);
  const config = Object.fromEntries(names.map((n, i) => [n, values[i]]));
  requireThat(config.GOTRUE_SMTP_HOST === 'supabase_inbucket_avivamiento_webpage-main' && config.GOTRUE_SMTP_PORT === '1025', 'SMTP_NOT_LOCAL_INBUCKET');
  return config;
}
export function localAnonymousKey() {
  // Only LOCAL generated configuration is read in memory. Nothing is printed or
  // persisted. The repository .env and historic remote credentials are excluded;
  // no service_role credential is selected or passed to the application.
  // Run the bundled CLI against a minimal, unlinked, local-only workspace. This
  // version of Kong has no consumers block; never guess its credential format.
  const isolated = path.join(REPO, 'tests/local-only-cli');
  const result = spawnSync(path.join(REPO, 'node_modules/supabase/bin/supabase.exe'), ['status', '--output', 'json', '--workdir', isolated],
    { cwd: isolated, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 });
  requireThat(result.status === 0, 'LOCAL_CLI_STATUS_FAILED');
  const config = JSON.parse(result.stdout);
  requireThat(config.API_URL === LOCAL.api, 'LOCAL_CLI_DESTINATION_MISMATCH');
  const key = config.ANON_KEY || config.PUBLISHABLE_KEY;
  requireThat(typeof key === 'string' && key.length > 20, 'LOCAL_ANON_CONSUMER_MISSING');
  if (!key.startsWith('sb_publishable_')) {
    const claim = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8'));
    requireThat(claim.role === 'anon' && claim.iss === 'supabase-demo', 'NOT_LOCAL_DEVELOPMENT_ANON_KEY');
  }
  return key;
}
export function quoteSql(value) { return `'${String(value).replaceAll("'", "''")}'`; }
export function newRunDirectory(kind = 'preflight') {
  const runId = `avc-${kind}-${randomUUID()}`;
  const dir = path.join(REPO, 'test-results', runId);
  fs.mkdirSync(path.dirname(dir), { recursive: true }); fs.mkdirSync(dir);
  return { runId, dir };
}
export function prepareLocalSchema(dir) {
  const before = inventory();
  fs.writeFileSync(path.join(dir, 'schema-before.json'), JSON.stringify(before, null, 2), { flag: 'wx' });
  requireThat(Object.values(before.counts).every(n => n === 0), 'LOCAL_DATABASE_NOT_EMPTY_STOP_FOR_REVIEW');
  const version = '20260901000100';
  const migration = path.join(REPO, 'supabase/migrations/20260901000100_financial_invariants_and_error_contract.sql');
  if (!before.migration_versions.includes(version)) {
    const backup = readJsonSql(`json_agg(json_build_object('signature',oid::regprocedure::text,'definition',pg_get_functiondef(oid),'acl',proacl::text)) FROM pg_proc WHERE oid IN ('public.setup_new_tenant(text,text,text)'::regprocedure,'public.process_checkout(jsonb,text,numeric,numeric,boolean,text)'::regprocedure)`);
    fs.writeFileSync(path.join(dir, 'rpc-definitions-before.private.json'), JSON.stringify(backup, null, 2), { flag: 'wx' });
    const sql = fs.readFileSync(migration, 'utf8');
    localSql(`BEGIN;
      SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='20s';
      LOCK TABLE public.organizations, public.profiles, public.orders, public.cash_sessions IN SHARE MODE;
      DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.organizations) OR EXISTS(SELECT 1 FROM auth.users) THEN RAISE EXCEPTION 'LOCAL_DATABASE_CHANGED'; END IF; END $$;
      ${sql}
      INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
      VALUES ('${version}','financial_invariants_and_error_contract',ARRAY[${quoteSql(sql)}]);
      NOTIFY pgrst, 'reload schema';
      COMMIT;`);
  }
  const after = inventory();
  requireThat(after.onboarding_hardened && after.checkout_hardened, 'LOCAL_SCHEMA_INCOMPATIBLE');
  const report = { scope: 'local Docker only', migration: version, migrationSha256: fileHash(migration), applied: !before.migration_versions.includes(version), before, after };
  fs.writeFileSync(path.join(dir, 'schema-preparation.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
  return report;
}
