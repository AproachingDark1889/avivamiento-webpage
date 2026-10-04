import { LOCAL, localFetch } from './local-environment.mjs';
import { requireThat } from './validation.mjs';

// Mailpit is served by the legacy-named supabase_inbucket container. Only
// summary metadata is inspected: never message bodies, reset links or tokens.
export function ownedMailbox(runId, email) {
  requireThat(/^avc-phase3-smoke-[a-f0-9-]{36}$/.test(runId), 'MAIL_RUN_ID');
  requireThat(email === `smoke.${runId}@training.avivacheck.invalid`, 'MAIL_OUTSIDE_RUN');
  return email;
}

export async function findOwnedMail(runId, email, request = localFetch) {
  ownedMailbox(runId, email);
  const response = await request(`${LOCAL.mail}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}&limit=100`);
  requireThat(response.ok, 'LOCAL_MAIL_SEARCH_FAILED');
  const data = await response.json();
  requireThat(Array.isArray(data.messages) && data.messages.length < 100, 'MAIL_SEARCH_INCOMPLETE');
  if (data.total != null) requireThat(data.total === data.messages.length, 'MAIL_SEARCH_TRUNCATED');
  const messages = [];
  for (const item of data.messages) {
    const recipients = [...(item.To || []), ...(item.Cc || []), ...(item.Bcc || [])].map(r => r.Address?.toLowerCase());
    // Search can be substring-based; an inexact hit grants no ownership.
    if (!recipients.includes(email)) continue;
    requireThat(recipients.length === 1 && recipients[0] === email, 'MAIL_HAS_UNOWNED_RECIPIENT');
    requireThat(/^[a-zA-Z0-9_-]{8,100}$/.test(item.ID), 'MAIL_MESSAGE_ID');
    messages.push({ id: item.ID, created: item.Created });
  }
  requireThat(new Set(messages.map(m => m.id)).size === messages.length, 'MAIL_DUPLICATE_ID');
  return messages;
}

export async function waitForOwnedMail(runId, email, { request = localFetch, attempts = 30,
  delay = () => new Promise(resolve => setTimeout(resolve, 500)) } = {}) {
  for (let i = 0; i < attempts; i++) {
    const messages = await findOwnedMail(runId, email, request);
    if (messages.length) return { status: 'passed', deliveryVerified: true, messageIds: messages.map(m => m.id) };
    if (i + 1 < attempts) await delay();
  }
  throw new Error('LOCAL_MAIL_DELIVERY_NOT_OBSERVED');
}

export async function cleanupOwnedMail(runId, email, request = localFetch) {
  const messages = await findOwnedMail(runId, email, request);
  const ids = messages.map(m => m.id);
  if (ids.length) {
    // An empty or omitted IDs list means GLOBAL deletion in Mailpit. Never send it.
    const response = await request(`${LOCAL.mail}/api/v1/messages`, { method: 'DELETE',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ IDs: ids }) });
    requireThat(response.ok, 'LOCAL_MAIL_DELETE_FAILED');
  }
  requireThat((await findOwnedMail(runId, email, request)).length === 0, 'LOCAL_MAIL_RESIDUAL');
  return { status: 'passed', deleted: ids.length, messageIds: ids, remainingOwned: 0 };
}
