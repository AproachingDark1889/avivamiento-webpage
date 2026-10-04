import test from 'node:test';
import assert from 'node:assert/strict';
import { ownedMailbox, findOwnedMail, waitForOwnedMail, cleanupOwnedMail } from '../../scripts/portal/local-mail.mjs';

const run = 'avc-phase3-smoke-11111111-1111-4111-8111-111111111111';
const email = `smoke.${run}@training.avivacheck.invalid`;
const own = { ID: 'owned-message-123', To: [{ Address: email }], Cc: [], Bcc: [] };
const response = messages => ({ ok: true, json: async () => ({ total: messages.length, messages }) });

test('mail ownership rejects another run and non-training recipients before requests', async () => {
  assert.equal(ownedMailbox(run, email), email);
  assert.throws(() => ownedMailbox(run, 'person@example.invalid'), /MAIL_OUTSIDE_RUN/);
  let called = false;
  await assert.rejects(findOwnedMail('other-run', email, async () => { called = true; }), /MAIL_RUN_ID/);
  assert.equal(called, false);
});

test('mail substring matches do not grant ownership; bodies never returned', async () => {
  const rows = [own, { ...own, ID: 'other-message-456', To: [{ Address: `extra-${email}` }] }];
  const found = await findOwnedMail(run, email, async () => response(rows));
  assert.deepEqual(found, [{ id: own.ID, created: undefined }]);
});

test('mail with any additional recipient is not eligible for deletion', async () => {
  await assert.rejects(cleanupOwnedMail(run, email, async () => response([
    { ...own, Cc: [{ Address: 'someone@example.invalid' }] },
  ])), /MAIL_HAS_UNOWNED_RECIPIENT/);
});

test('mail cleanup sends exact owned IDs and verifies removal; no global DELETE', async () => {
  const calls = []; let removed = false;
  const request = async (url, options = {}) => {
    calls.push({ url, options });
    if (options.method === 'DELETE') { removed = true; return { ok: true }; }
    return response(removed ? [] : [own]);
  };
  assert.equal((await cleanupOwnedMail(run, email, request)).deleted, 1);
  assert.deepEqual(JSON.parse(calls[1].options.body), { IDs: [own.ID] });
  assert.equal(calls.length, 3);
  let deletes = 0;
  await cleanupOwnedMail(run, email, async (_, options) => { if (options?.method === 'DELETE') deletes++; return response([]); });
  assert.equal(deletes, 0);
});

test('mail success requires actual receipt, not only accepted send request', async () => {
  let attempts = 0;
  const result = await waitForOwnedMail(run, email, { request: async () => response(++attempts === 2 ? [own] : []), delay: async () => {} });
  assert.equal(result.deliveryVerified, true); assert.equal(attempts, 2);
  await assert.rejects(waitForOwnedMail(run, email, { request: async () => response([]), attempts: 2, delay: async () => {} }), /DELIVERY_NOT_OBSERVED/);
});

test('mail truncated search and failed cleanup remain explicit failures', async () => {
  await assert.rejects(findOwnedMail(run, email, async () => ({ ok: true, json: async () => ({ total: 2, messages: [own] }) })), /TRUNCATED/);
  await assert.rejects(cleanupOwnedMail(run, email, async (_, options) => options?.method === 'DELETE' ? { ok: false } : response([own])), /DELETE_FAILED/);
  await assert.rejects(cleanupOwnedMail(run, email, async (_, options) => options?.method === 'DELETE' ? { ok: true } : response([own])), /RESIDUAL/);
});
