// Future browser operation: prevent a wrong-session RPC BEFORE it reaches DB.
export async function withExactSessionRpc(page, rpc, sessionId, action) {
  if (!['pre_close_cash_session', 'approve_cash_session'].includes(rpc) || !sessionId) throw new Error('SESSION_GUARD_INPUT');
  const pattern = `**/rest/v1/rpc/${rpc}`;
  let accepted = 0, rejected = false;
  const handler = async route => {
    const data = route.request().postDataJSON();
    if (data?.p_session_id !== sessionId) { rejected = true; await route.abort('blockedbyclient'); }
    else { accepted++; await route.continue(); }
  };
  await page.route(pattern, handler);
  try {
    const [response] = await Promise.all([
      page.waitForResponse(r => new URL(r.url()).pathname.endsWith(`/rpc/${rpc}`) && r.request().postDataJSON()?.p_session_id === sessionId, { timeout: 15000 }),
      action(),
    ]);
    if (rejected || accepted !== 1 || !response.ok()) throw new Error('SESSION_RPC_NOT_VERIFIED');
  } finally { await page.unroute(pattern, handler); }
}
