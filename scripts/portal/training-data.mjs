import { expect } from '@playwright/test';
import { readJsonSql, quoteSql, localSql } from './local-environment.mjs';
import { requireThat } from './validation.mjs';
import { requireOwnedEmails } from './lifecycle.mjs';

export function cents(value) {
  const text = String(value);
  requireThat(/^-?\d+(\.\d{1,2})?$/.test(text), 'MONEY_NOT_EXACT_CENTS');
  const [whole, fraction = ''] = text.replace('-', '').split('.');
  const n = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  requireThat(Number.isSafeInteger(n), 'MONEY_RANGE');
  return text.startsWith('-') ? -n : n;
}

export function trainingData(state) {
  function one(table, where) {
    const result = readJsonSql(`coalesce(json_agg(t),'[]'::json) FROM (SELECT * FROM public.${table} WHERE ${where}) t`);
    expect(result, `one ${table} in scoped query`).toHaveLength(1); return result[0];
  }
  const scoped = () => { requireThat(!!state.orgId, 'TRAINING_ORG_NOT_RESOLVED'); return `org_id=${quoteSql(state.orgId)}`; };
  return {
    profile(actor, ownerId) {
      const p = one('profiles', `${scoped()} AND id=${quoteSql(actor.userId)}`);
      expect(p.role).toBe(actor.role); expect(p.email).toBe(actor.email);
      if (ownerId) expect(p.owner_id).toBe(ownerId);
      return p;
    },
    organization(pastor) {
      const o = one('organizations', `id=${quoteSql(state.orgId)}`);
      expect(o.owner_id).toBe(pastor.userId); expect(o.name).toBe(pastor.church);
      expect(this.profile(pastor).onboarding_completed).toBe(true);
      return o;
    },
    product(actor, product) {
      const p = one('products', `${scoped()} AND department_owner_id=${quoteSql(actor.userId)} AND name=${quoteSql(product.name)}`);
      expect(cents(p.price)).toBe(cents(product.price)); expect(p.active).toBe(true);
      product.id = p.id; return p;
    },
    products(actor) {
      return readJsonSql(`coalesce(json_agg(t),'[]'::json) FROM (SELECT * FROM public.products WHERE ${scoped()}) t`);
    },
    session(id, expected) {
      const s = one('cash_sessions', `${scoped()} AND id=${quoteSql(id)}`);
      for (const [key, value] of Object.entries(expected)) expect(s[key], `session.${key}`).toBe(value);
      return s;
    },
    order(id, actor, sessionId, product, received, operationalStatus) {
      const o = one('orders', `${scoped()} AND id=${quoteSql(id)}`);
      expect(o.created_by).toBe(actor.userId); expect(o.cash_session_id).toBe(sessionId);
      expect(o.department_owner_id).toBe(actor.departmentId || actor.userId);
      expect(o.financial_status).toBe('paid'); expect(o.payment_method).toBe('cash');
      expect(o.operational_status).toBe(operationalStatus);
      expect(cents(o.total)).toBe(cents(product.price)); expect(cents(o.paid_with)).toBe(cents(received));
      expect(cents(o.change)).toBe(cents(received) - cents(product.price));
      const item = one('order_items', `${scoped()} AND order_id=${quoteSql(id)}`);
      expect(item.product_id).toBe(product.id); expect(item.quantity).toBe(1);
      expect(cents(item.price)).toBe(cents(product.price)); expect(cents(item.subtotal)).toBe(cents(o.total));
      return o;
    },
    reconciliation(sessionId, expected) {
      const s = this.session(sessionId, { status: expected.status, mode: expected.mode,
        opened_by: expected.opener, department_owner_id: expected.department,
        cashier_id: expected.mode === 'independent' ? expected.opener : null });
      expect(s.preclosed_by).toBe(expected.precloser);
      if (expected.status === 'closed') { expect(s.approved_by).toBe(expected.approver); expect(s.closed_at).toBeTruthy(); }
      const sum = readJsonSql(`json_build_object('cash',coalesce(sum(total) FILTER (WHERE financial_status='paid' AND payment_method='cash'),0),'count',count(*))
        FROM public.orders WHERE ${scoped()} AND cash_session_id=${quoteSql(sessionId)}`);
      expect(sum.count).toBe(1); expect(cents(sum.cash)).toBe(expected.salesCents);
      expect(cents(s.opening_cash)).toBe(expected.openingCents);
      expect(cents(s.total_cash_sales)).toBe(expected.salesCents);
      expect(cents(s.expected_cash)).toBe(expected.openingCents + expected.salesCents);
      expect(cents(s.cash_counted)).toBe(expected.countedCents);
      expect(cents(s.difference)).toBe(expected.countedCents - expected.openingCents - expected.salesCents);
      return s;
    },
  };
}

export const CLEAN_CAST_EMAILS = new Set([
  'david.ramos@example.org',
  'samuel.castro@example.org',
  'marcos.pena@example.org',
  'daniel.soto@example.org',
  'isaac.diaz@example.org',
  'andres.cruz@example.org',
  'sofia.mendoza@example.org'
]);

export function cleanupTraining(runId, actors, state) {
  const emails = actors.map(a => a.email);
  const isCleanCast = emails.length > 0 && emails.every(email => CLEAN_CAST_EMAILS.has(email));
  if (!isCleanCast) requireOwnedEmails(runId, emails);
  requireThat(/^avc-training-[a-f0-9-]{36}$/.test(runId)
    && (isCleanCast || emails.every(email => email.endsWith('@training.avivacheck.invalid'))), 'TRAINING_CLEANUP_SCOPE');
  const emailList = emails.map(quoteSql).join(',');
  const owned = readJsonSql(`coalesce(json_agg(json_build_object('id',u.id,'email',u.email,'orgId',p.org_id)),'[]'::json)
    FROM auth.users u LEFT JOIN public.profiles p ON p.id=u.id WHERE u.email IN (${emailList})`);
  const orgIds = [...new Set(owned.map(u => u.orgId).filter(Boolean))];
  requireThat(orgIds.length <= 1 && (!state.orgId || orgIds.every(id => id === state.orgId)), 'CLEANUP_ORG_MISMATCH');
  for (const u of owned) {
    const actor = actors.find(a => a.email === u.email);
    requireThat(actor && (!actor.userId || actor.userId === u.id), 'CLEANUP_USER_MISMATCH');
  }
  if (!owned.length) return { status: 'passed', usersDeleted: 0, organizationsDeleted: 0 };
  const ids = owned.map(u => quoteSql(u.id)).join(','), org = orgIds[0] ? quoteSql(orgIds[0]) : 'NULL';
  localSql(`BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='15s';
    LOCK TABLE public.profiles, public.organizations IN SHARE ROW EXCLUSIVE MODE;
    DO $$ BEGIN
      IF EXISTS(SELECT 1 FROM public.profiles WHERE org_id=${org} AND id NOT IN (${ids}))
      OR EXISTS(SELECT 1 FROM public.orders WHERE org_id=${org} AND created_by NOT IN (${ids}))
      OR EXISTS(SELECT 1 FROM public.cash_sessions WHERE org_id=${org} AND opened_by NOT IN (${ids}))
      THEN RAISE EXCEPTION 'CLEANUP_FOREIGN_RECORD'; END IF;
    END $$;
    DELETE FROM public.order_items WHERE order_id IN (SELECT id FROM public.orders WHERE org_id=${org});
    DELETE FROM public.orders WHERE org_id=${org}; DELETE FROM public.cash_closures WHERE org_id=${org};
    DELETE FROM public.cash_sessions WHERE org_id=${org}; DELETE FROM public.products WHERE org_id=${org};
    UPDATE public.organizations SET owner_id=NULL WHERE id=${org} AND owner_id IN (${ids});
    DELETE FROM public.profiles WHERE id IN (${ids}); DELETE FROM public.organizations WHERE id=${org};
    DELETE FROM auth.refresh_tokens WHERE user_id IN (${ids});
    DELETE FROM auth.audit_log_entries WHERE payload->>'actor_id' IN (${ids});
    DELETE FROM auth.users WHERE id IN (${ids}) AND email IN (${emailList});
    COMMIT;`);
  const remaining = readJsonSql(`json_build_object('users',(SELECT count(*) FROM auth.users WHERE email IN (${emailList})),
    'organizations',(SELECT count(*) FROM public.organizations WHERE id=${org}))`);
  requireThat(remaining.users === 0 && remaining.organizations === 0, 'TRAINING_CLEANUP_RESIDUAL');
  return { status: 'passed', usersDeleted: owned.length, organizationsDeleted: orgIds.length, remaining };
}
