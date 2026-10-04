import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { REPO, LOCAL, localAnonymousKey, newRunDirectory } from './portal/local-environment.mjs';

if (process.argv[2] !== '--local-only') throw new Error('EXPLICIT_LOCAL_START_REQUIRED');
await new Promise((resolve, reject) => {
  const server = net.createServer(); server.once('error', reject);
  server.listen(3002, '127.0.0.1', () => server.close(resolve));
});
const run = newRunDirectory('phase3-server');
const key = localAnonymousKey();
const childEnv = {};
for (const name of ['PATH','SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','COMSPEC','PATHEXT']) {
  if (process.env[name]) childEnv[name] = process.env[name];
}
Object.assign(childEnv, { AVC_LOCAL_TEST: '1', SUPABASE_URL: LOCAL.api, SUPABASE_ANON_KEY: key,
  NUXT_PUBLIC_SUPABASE_URL: LOCAL.api, NUXT_PUBLIC_SUPABASE_KEY: key,
  NODE_ENV: 'development', NUXT_TELEMETRY_DISABLED: '1', NUXT_NO_ANALYTICS: '1',
  CI: 'true', npm_config_offline: 'true', NO_UPDATE_NOTIFIER: '1',
  NODE_OPTIONS: `--require "${path.join(REPO, 'scripts/portal/local-network-guard.cjs').replaceAll('\\', '/')}"`,
});
const child = spawn(process.execPath, [path.join(REPO, 'node_modules/@nuxt/cli/bin/nuxi.mjs'), 'dev',
  '--host', '127.0.0.1', '--port', '3002', '--dotenv', 'scripts/portal/local-empty.env', '--no-fork'],
  { cwd: REPO, env: childEnv, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
const scrub = text => text.replaceAll(key, '[LOCAL_ANON_REDACTED]').replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[TOKEN_REDACTED]');
const log = data => {
  const text = scrub(data.toString());
  fs.appendFileSync(path.join(run.dir, 'nuxt-sanitized.log'), text);
  process.stdout.write(text);
};
child.stdout.on('data', log); child.stderr.on('data', log);
fs.writeFileSync(path.join(run.dir, 'server-owner.json'), JSON.stringify({ pid: child.pid, parentPid: process.pid,
  startedUtc: new Date().toISOString(), app: LOCAL.app, api: LOCAL.api, dotenv: 'scripts/portal/local-empty.env',
  remoteNetworkBlockedInNode: true, credentialsPrinted: false }, null, 2));
console.log(`LOCAL_SERVER_OWNER ${run.dir} PID ${child.pid}`);
process.on('SIGINT', () => child.kill()); process.on('SIGTERM', () => child.kill());
child.on('exit', code => { process.exitCode = code ?? 1; });
