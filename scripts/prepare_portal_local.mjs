import fs from 'node:fs';
import path from 'node:path';
import { newRunDirectory, prepareLocalSchema, mailConfiguration, localFetch, LOCAL } from './portal/local-environment.mjs';

if (process.argv[2] !== '--prepare-empty-local-database') throw new Error('EXPLICIT_LOCAL_PREPARATION_REQUIRED');
const run = newRunDirectory('phase3-preflight');
try {
  const mail = mailConfiguration();
  const mailHttp = await localFetch(LOCAL.mail);
  if (mailHttp.status !== 200) throw new Error('INBUCKET_UI_NOT_REACHABLE');
  const schema = prepareLocalSchema(run.dir);
  fs.writeFileSync(path.join(run.dir, 'environment.json'), JSON.stringify({ checkedUtc: new Date().toISOString(), mail, mailUiStatus: mailHttp.status, app: LOCAL.app, api: LOCAL.api, schemaCompatible: true }, null, 2));
  console.log(JSON.stringify({ status: 'prepared', directory: run.dir, migrationApplied: schema.applied, localOnly: true }));
} catch (error) {
  fs.writeFileSync(path.join(run.dir, 'failure.json'), JSON.stringify({ status: 'failed', code: error.message }, null, 2));
  console.error(`LOCAL_PREFLIGHT_FAILED ${error.message} ${run.dir}`); process.exitCode = 1;
}
