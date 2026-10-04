// Evidence failure must not skip other finalizers. No application imports.
export async function attemptAll(steps) {
  const results = [];
  for (const [name, action] of steps) {
    try { await action(); results.push({ name, status: 'passed' }); }
    catch (error) { results.push({ name, status: 'failed', error }); }
  }
  const failed = results.filter(r => r.status === 'failed');
  if (failed.length) {
    const error = new AggregateError(failed.map(r => r.error), `FINALIZATION_FAILED:${failed.map(r => r.name).join(',')}`);
    error.results = results.map(({ name, status }) => ({ name, status }));
    throw error;
  }
  return results;
}

export function requireOwnedEmails(runId, emails) {
  const slug = runId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  if (slug.length < 8 || emails.some(email => !email.toLowerCase().split('@')[0].endsWith(`.${slug}`))) throw new Error('CLEANUP_EMAIL_OUTSIDE_RUN');
}

export function resolveOwnedOrganization({ profiles, knownOrgIds, explicitOrgId }) {
  const ids = new Set(profiles.map(p => p.org_id).filter(Boolean));
  if (ids.size > 1) throw new Error('CLEANUP_ORGANIZATION_AMBIGUOUS');
  const inferred = [...ids][0];
  if (explicitOrgId && !knownOrgIds.includes(explicitOrgId) && inferred !== explicitOrgId) throw new Error('CLEANUP_ORGANIZATION_UNPROVEN');
  if (explicitOrgId && inferred && explicitOrgId !== inferred) throw new Error('CLEANUP_ORGANIZATION_MISMATCH');
  if (knownOrgIds.length > 1 || (inferred && knownOrgIds.length && !knownOrgIds.includes(inferred))) throw new Error('CLEANUP_ORGANIZATION_MISMATCH');
  return explicitOrgId || inferred || knownOrgIds[0];
}
