import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { localUrl, localFetch } from '../../scripts/portal/local-environment.mjs';

const require = createRequire(import.meta.url);
const parser = require('@babel/parser');
const babel = require('@babel/core');
const transformTypescript = require('@babel/plugin-transform-typescript');
const vue = fs.readFileSync(new URL('../../app/pages/page/POS/cashClosing.vue', import.meta.url), 'utf8');
const script = vue.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1];
const ast = parser.parse(script, { sourceType: 'module', plugins: ['typescript'] });

function functionFromSource(name, dependencies) {
  const node = ast.program.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === name);
  assert.ok(node);
  const { code } = babel.transformFromAstSync({ type: 'File', program: { type: 'Program', sourceType: 'module', body: [node], directives: [] } }, undefined,
    { configFile: false, babelrc: false, plugins: [transformTypescript] });
  return new Function(...Object.keys(dependencies), `${code}; return ${name};`)(...Object.values(dependencies));
}

async function openSessionsFor(currentSessionValue, rows) {
  const requests = [], openSessions = { value: [] };
  const query = { select() { return this; }, eq(key, value) { requests.push([key, value]); return this; },
    order() { return this; }, async limit() { return { data: rows, error: null }; } };
  const fn = functionFromSource('loadOpenSessions', { openSessions, currentSession: { value: currentSessionValue },
    canApprove: { value: true }, auth: { role: 'leader' }, warning: { value: '' },
    currentDepartmentOwnerId: () => 'cafe-leader', getSupabase: () => ({ from: () => query }), normalizeSession: x => x });
  await fn(); return { rows: openSessions.value, requests };
}

test('known M9 blocker: actual Vue source hides department shared session from contingency cards', async () => {
  const shared = { id: 'session-shared', mode: 'shared', department_owner_id: 'cafe-leader', status: 'open' };
  const result = await openSessionsFor(shared, [shared]);
  assert.deepEqual(result.rows, []);
  assert.ok(result.requests.some(([k, v]) => k === 'department_owner_id' && v === 'cafe-leader'));
  assert.match(vue, /v-if="canApprove && openSessions.length > 0"/);
});

test('actual Vue source offers a different session as contingency, not the current one', async () => {
  const independent = { id: 'session-independent', mode: 'independent', department_owner_id: 'cafe-leader', status: 'open' };
  assert.deepEqual((await openSessionsFor(null, [independent])).rows, [independent]);
});

test('actual current-session loader requests shared mode and stores the returned session', async () => {
  const session = { id: 'shared-id', mode: 'shared' }, currentSession = { value: null };
  let requested;
  const fn = functionFromSource('loadCurrentSession', { currentSession, warning: { value: '' }, loading: { value: false },
    selectedCashMode: { value: 'shared' }, normalizeSession: x => x, loadSessionPreview: async () => {},
    getSupabase: () => ({ rpc: async (rpc, args) => { requested = { rpc, args }; return { data: { session }, error: null }; } }) });
  await fn();
  assert.deepEqual(requested, { rpc: 'get_current_cash_session', args: { p_mode: 'shared' } });
  assert.deepEqual(currentSession.value, session);
});

test('local destinations reject remote hosts, credentials, redirects to unsupported origins and other ports', async () => {
  for (const value of ['https://example.invalid', 'http://127.0.0.1:54322', 'http://localhost:54321', 'http://user@127.0.0.1:54321']) {
    assert.throws(() => localUrl(value), /NONLOCAL/);
  }
  assert.equal(localUrl('http://127.0.0.1:54321/auth/v1/health').origin, 'http://127.0.0.1:54321');
  const original = globalThis.fetch;
  try {
    let calls = 0;
    globalThis.fetch = async (_, options) => { calls++; assert.equal(options.redirect, 'manual'); return { status: 302 }; };
    await assert.rejects(localFetch('http://127.0.0.1:54321/auth/v1/health'), /REDIRECT_REQUIRES_LOCAL_REVIEW/);
    assert.equal(calls, 1);
    await assert.rejects(localFetch('https://example.invalid'), /NONLOCAL/);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});
