import { expect } from '@playwright/test';
import * as ui from './real-adapters.mjs';
import { LOCAL } from './local-environment.mjs';
import { MODULES } from './contracts.mjs';
import { cents, trainingData } from './training-data.mjs';

// No browser starts, database writes or environment reads during import.
// All business mutations below are actions of the real application's UI.
export function buildTrainingAdapters(actors, state, remember = () => {}) {
  const [pastor, samuel, marcos, daniel, isaac, andres, sofia] = actors;
  const db = trainingData(state);
  const taco = { name: 'Taco de Guisado', price: 55 };
  const bible = { name: 'Biblia RVR 1960', price: 150 };
  const coffee = { name: 'Café Americano', price: 45 };
  const initial = { name: 'Producto de Bienvenida', price: 20 };
  const reason = 'Rescate de turno: cajera se retiró por emergencia familiar.';
  const ordinary = status => ({ status, mode: 'shared', opener: isaac.userId, department: samuel.userId,
    precloser: isaac.userId, approver: samuel.userId, openingCents: 10000, salesCents: 5500, countedCents: 15500 });
  const contingency = status => ({ status, mode: 'independent', opener: sofia.userId, department: marcos.userId,
    precloser: marcos.userId, approver: marcos.userId, openingCents: 5000, salesCents: 4500, countedCents: 9500 });
  const createStaff = async (owner, actor) => {
    await ui.fillStaffForm(owner.page, actor); await ui.submitStaff(owner.page, actor, remember);
    if (actor.role !== 'leader') actor.departmentId = owner.userId;
    db.profile(actor, actor.role !== 'leader' ? owner.userId : undefined);
  };
  const createProduct = async (actor, product) => {
    await ui.productForm(actor.page, product); await ui.saveProduct(actor.page, product); db.product(actor, product);
  };
  const adapters = {
    '1/onboarding': { actorId: pastor.id, actions: {
      registration: async () => {
        const created = await ui.signupOrganization(pastor.page, pastor, id => { pastor.userId = id; remember(pastor); });
        state.orgId = created.orgId;
      },
      configuration: () => ui.completeInitialConfiguration(pastor.page, initial),
      organization_verified: async () => { db.organization(pastor); db.product(pastor, initial); },
    } },
    '2/staff': { actorId: samuel.id, actions: {
      staff_form: () => ui.fillStaffForm(samuel.page, isaac),
      role_assignment: async () => { await ui.submitStaff(samuel.page, isaac, remember); isaac.departmentId = samuel.userId; },
      profile_verified: async () => { db.profile(isaac, samuel.userId); },
    } },
    '3/catalog': { actorId: samuel.id, actions: {
      product_form: () => ui.productForm(samuel.page, taco),
      price_saved: () => ui.saveProduct(samuel.page, taco),
      catalog_verified: async () => { db.product(samuel, taco); },
    } },
    '4/opening': { actorId: isaac.id, actions: {
      opening_form: () => ui.openingForm(isaac.page),
      opening_cash: async () => { state.ordinaryId = await ui.openSession(isaac.page, 100, 'shared'); },
      session_open_verified: async () => {
        const s = db.session(state.ordinaryId, { status: 'open', mode: 'shared', cashier_id: null, opened_by: isaac.userId, department_owner_id: samuel.userId });
        expect(cents(s.opening_cash)).toBe(10000);
      },
    } },
    '5/checkout': { actorId: isaac.id, actions: {
      cart: () => ui.addToCart(isaac.page, taco),
      payment: async () => { state.kitchenOrderId = await ui.payCash(isaac.page, 100, 'shared'); },
      order_and_change_verified: async () => { db.order(state.kitchenOrderId, isaac, state.ordinaryId, taco, 100, 'pending'); },
    } },
    '6/kitchen': { actorId: andres.id, actions: {
      order_received: async () => {
        await andres.page.goto(`${LOCAL.app}/page/POS/kds`, { waitUntil: 'domcontentloaded' });
        const card = andres.page.locator('.order-card').filter({ hasText: `#${state.kitchenOrderId.slice(-4)}` });
        await expect(card).toHaveCount(1); await expect(card).toContainText(taco.name);
        db.order(state.kitchenOrderId, isaac, state.ordinaryId, taco, 100, 'pending');
      },
      dispatch: async () => {
        const card = andres.page.locator('.order-card').filter({ hasText: `#${state.kitchenOrderId.slice(-4)}` });
        await ui.localRpc(andres.page, 'update_kitchen_status', { p_order_id: Number(state.kitchenOrderId), p_new_status: 'completed' },
          () => card.getByRole('button', { name: 'ENTREGAR', exact: true }).click());
      },
      operational_result_verified: async () => {
        db.order(state.kitchenOrderId, isaac, state.ordinaryId, taco, 100, 'completed');
        await andres.page.getByRole('tab', { name: /Entregados/i }).click();
        await expect(andres.page.getByText(`#${state.kitchenOrderId.slice(-4)}`, { exact: true })).toBeVisible();
      },
    } },
    '7/direct_sale': { actorId: daniel.id, actions: {
      auto_fulfillment_enabled: async () => {
        expect(db.profile(daniel).auto_accept_orders).toBe(true);
        await ui.openingForm(daniel.page); state.bookSessionId = await ui.openSession(daniel.page, 0, 'shared');
        db.session(state.bookSessionId, { status: 'open', opened_by: daniel.userId, department_owner_id: daniel.userId });
      },
      direct_payment: async () => { await ui.addToCart(daniel.page, bible); state.directOrderId = await ui.payCash(daniel.page, 200, 'shared'); },
      auto_fulfilled_verified: async () => { db.order(state.directOrderId, daniel, state.bookSessionId, bible, 200, 'auto_fulfilled'); },
    } },
    '8/count': { actorId: isaac.id, actions: {
      counting: async () => { await ui.closingPage(isaac.page); await isaac.page.getByLabel('Efectivo contado', { exact: true }).fill('155'); },
      ordinary_preclose: () => ui.localRpc(isaac.page, 'pre_close_cash_session', { p_session_id: state.ordinaryId, p_cash_counted: 155 },
        () => isaac.page.getByRole('button', { name: 'Pre-cerrar Caja', exact: true }).click()),
      pending_verified: async () => { db.reconciliation(state.ordinaryId, ordinary('pending_validation')); },
    } },
    '8/approve': { actorId: samuel.id, actions: {
      review_totals: async () => {
        await ui.closingPage(samuel.page);
        await expect(samuel.page.getByText('Cajas Pendientes de Validacion', { exact: true })).toBeVisible();
        db.reconciliation(state.ordinaryId, ordinary('pending_validation'));
      },
      ordinary_approval: () => ui.approveSession(samuel.page, state.ordinaryId),
      closed_verified: async () => { db.reconciliation(state.ordinaryId, ordinary('closed')); },
    } },
    '9/abandon': { actorId: sofia.id, actions: {
      opening_50: async () => {
        expect(state.independentEnabledViaUI).toBe(true); expect(db.profile(sofia, marcos.userId).independent_cash_register).toBe(true);
        await ui.openingForm(sofia.page); state.rescueId = await ui.openSession(sofia.page, 50, 'independent');
        const s = db.session(state.rescueId, { mode: 'independent', status: 'open', cashier_id: sofia.userId, opened_by: sofia.userId, department_owner_id: marcos.userId });
        expect(cents(s.opening_cash)).toBe(5000);
      },
      sale_45: async () => {
        await ui.addToCart(sofia.page, coffee); state.rescueOrderId = await ui.payCash(sofia.page, 100, 'independent');
        db.order(state.rescueOrderId, sofia, state.rescueId, coffee, 100, 'pending');
      },
      departure: async () => { await sofia.page.goto('about:blank'); expect(sofia.page.url()).toBe('about:blank'); },
    } },
    '9/rescue': { actorId: marcos.id, actions: {
      contingency_dialog: () => ui.showContingency(marcos.page),
      justification_and_95: async () => {
        const dialog = marcos.page.locator('.v-dialog:visible');
        await dialog.getByLabel('Nota o justificación de contingencia (Obligatorio)', { exact: true }).fill('');
        await expect(dialog.getByRole('button', { name: 'Confirmar Pre-cierre', exact: true })).toBeDisabled();
        await dialog.getByLabel('Efectivo físico contado en cajón ($)', { exact: true }).fill('95');
        await dialog.getByLabel('Nota o justificación de contingencia (Obligatorio)', { exact: true }).fill(reason);
        await expect(dialog.getByRole('button', { name: 'Confirmar Pre-cierre', exact: true })).toBeEnabled();
      },
      contingency_preclose: async () => {
        await ui.localRpc(marcos.page, 'pre_close_cash_session', { p_session_id: state.rescueId, p_cash_counted: 95, p_notes: reason },
          () => marcos.page.locator('.v-dialog:visible').getByRole('button', { name: 'Confirmar Pre-cierre', exact: true }).click());
        const s = db.reconciliation(state.rescueId, contingency('pending_validation')); expect(s.notes).toContain(reason);
      },
      contingency_approval: () => ui.approveSession(marcos.page, state.rescueId),
      same_session_closed: async () => { db.reconciliation(state.rescueId, contingency('closed')); },
    } },
    '9/reopen': { actorId: sofia.id, actions: {
      new_session_unblocked: async () => {
        // Separate cashier segment: the leader does not impersonate Sofía and
        // the recording actor/page must match the person operating this UI.
        await ui.openingForm(sofia.page); state.nextSessionId = await ui.openSession(sofia.page, 0, 'independent');
        expect(state.nextSessionId).not.toBe(state.rescueId);
        db.session(state.nextSessionId, { status: 'open', mode: 'independent', cashier_id: sofia.userId, opened_by: sofia.userId, department_owner_id: marcos.userId });
        await expect(sofia.page.getByText(/Caja abierta/i).first()).toBeVisible();
      },
    } },
  };
  for (const module of MODULES) for (const segment of module.segments) {
    const adapter = adapters[`${module.id}/${segment.id}`];
    expect(adapter).toBeTruthy(); expect(actors.find(a => a.id === adapter.actorId)?.role).toBe(segment.role);
    expect(Object.keys(adapter.actions)).toEqual(segment.milestones);
  }
  async function beforeModule(id) {
    if (id === 2) {
      for (const leader of [samuel, marcos, daniel]) { await createStaff(pastor, leader); await ui.loginActor(leader); }
    }
    if (id === 4) await ui.loginActor(isaac);
    if (id === 6) { await createStaff(samuel, andres); await ui.loginActor(andres); }
    if (id === 7) {
      await ui.enableStaffSetting(pastor.page, daniel, 'auto'); expect(db.profile(daniel).auto_accept_orders).toBe(true);
      await createProduct(daniel, bible);
    }
    if (id === 9) {
      await createStaff(marcos, sofia);
      await ui.enableStaffSetting(marcos.page, sofia, 'independent');
      expect(db.profile(sofia, marcos.userId).independent_cash_register).toBe(true);
      state.independentEnabledViaUI = true;
      await createProduct(marcos, coffee); await ui.loginActor(sofia);
    }
  }
  async function verifyModule(id) {
    const entities = { 1: state.orgId, 2: isaac.userId, 3: taco.id, 4: state.ordinaryId, 5: state.kitchenOrderId,
      6: state.kitchenOrderId, 7: state.directOrderId, 8: state.ordinaryId, 9: state.rescueId };
    expect(entities[id]).toBeTruthy();
    const receipt = { status: 'passed', entityId: String(entities[id]), orgId: state.orgId };
    if (id === 9) {
      const s = db.reconciliation(state.rescueId, contingency('closed'));
      Object.assign(receipt, { mode: s.mode, independentEnabledViaUI: state.independentEnabledViaUI,
        cashierId: s.cashier_id, openedBy: s.opened_by, preclosedBy: s.preclosed_by, approvedBy: s.approved_by,
        openingCents: cents(s.opening_cash), salesCents: cents(s.total_cash_sales), expectedCents: cents(s.expected_cash),
        countedCents: cents(s.cash_counted), differenceCents: cents(s.difference),
        closedSessionId: s.id, nextSessionId: state.nextSessionId, saleOrderId: state.rescueOrderId });
    }
    return receipt;
  }
  return { actors, adapters, beforeModule, verifyModule, entityKeys: Object.fromEntries(MODULES.map(m => [m.id, `training-module-${m.id}`])) };
}
