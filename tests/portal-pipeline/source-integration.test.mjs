import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { attemptAll, requireOwnedEmails, resolveOwnedOrganization } from '../../scripts/portal/lifecycle.mjs';

const require = createRequire(import.meta.url);
const parser = require('@babel/parser');
const babel = require('@babel/core');
const transformTypescript = require('@babel/plugin-transform-typescript');
const specPath = fileURLToPath(new URL('../operational-chaos/final-chaos-journey.spec.ts', import.meta.url));
const source = fs.readFileSync(specPath, 'utf8');
const ast = parser.parse(source, { sourceType: 'module', plugins: ['typescript'] });

// Extract only a function AST, erase types, inject doubles. Never import the
// live spec/config: importing them would load environment/credential files.
function isolatedFunction(name, dependencies) {
  const node = ast.program.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === name);
  assert.ok(node, `function ${name} present`);
  const file = { type: 'File', program: { type: 'Program', sourceType: 'module', body: [node], directives: [] } };
  const { code } = babel.transformFromAstSync(file, undefined, { configFile: false, babelrc: false, plugins: [transformTypescript] });
  return new Function(...Object.keys(dependencies), `${code}; return ${name};`)(...Object.values(dependencies));
}

test('current TypeScript parses; configuration does not auto-grant database consent', () => {
  const config = fs.readFileSync(fileURLToPath(new URL('../../playwright.final-chaos.config.ts', import.meta.url)), 'utf8');
  parser.parse(config, { sourceType: 'module', plugins: ['typescript'] });
  assert.doesNotMatch(config, /process\.env\.(TEST_ALLOW_OPERATIONAL_CHAOS|TEST_OPERATIONAL_CHAOS_ACK)\s*=/);
  assert.match(source, /TOR[M]?ENTA CONCURRENTE/);
  assert.match(source, /for \(const viewportCase of FINAL_CHAOS_VIEWPORTS\)/);
});

test('actual cleanupJourney attempts cleanup even if context close and manifest save fail', async () => {
  const called = [];
  const cleanup = isolatedFunction('cleanupJourney', { attemptAll,
    closeActorSessions: async () => { called.push('close'); throw new Error('close'); },
    saveManifestSafe: () => { called.push('save'); throw new Error('save'); },
    executeCleanup: async () => called.push('cleanup'),
  });
  await assert.rejects(cleanup({ runId: 'synthetic-123' }, {}, {}), /FINALIZATION_FAILED/);
  assert.deepEqual(called, ['close', 'save', 'cleanup']);
});

test('actual ownership collector uses recorded organization ID with empty emails, never church name', async () => {
  const requests = [], products = [];
  const supabaseDouble = { from(table) {
    const query = { table, filters: [] }; requests.push(query);
    return { select() { return this; }, eq(key, value) { query.filters.push([key, value]); return this; },
      async maybeSingle() { return { data: { id: 'product-1', org_id: 'owned-1', name: 'Demo' }, error: null }; },
    };
  } };
  const collector = isolatedFunction('captureKnownEntitiesForCleanup', {
    requireOwnedEmails, resolveOwnedOrganization,
    addProduct: (_, id, orgId) => products.push({ id, orgId }),
    addOrganization: () => { throw new Error('unexpected'); }, addUser: () => {}, addAuthUser: () => {}, captureAuthOnlyUser: async () => {},
  });
  await collector(supabaseDouble, { runId: 'synthetic-123', organizations: [{ orgId: 'owned-1' }], authUsers: [], users: [], products: [] },
    { churchName: 'A shared human name', emails: [], productNames: ['Demo'] });
  assert.deepEqual(requests, [{ table: 'products', filters: [['org_id', 'owned-1'], ['name', 'Demo']] }]);
  assert.deepEqual(products, [{ id: 'product-1', orgId: 'owned-1' }]);
});

test('actual collector rejects unrelated email before making any query', async () => {
  let queries = 0;
  const collector = isolatedFunction('captureKnownEntitiesForCleanup', { requireOwnedEmails, resolveOwnedOrganization });
  await assert.rejects(collector({ from() { queries++; } }, { runId: 'synthetic-123' }, { emails: ['real@example.invalid'] }), /CLEANUP_EMAIL_OUTSIDE_RUN/);
  assert.equal(queries, 0);
});
