// Versioned didactic contract, independent of Nuxt, credentials and test config.
const segment = (id, role, milestones) => ({ id, role, milestones });
export const CONTRACT_VERSION = 2;
export const MODULES = [
  { id: 1, title: 'Congregación y configuración inicial', entityType: 'organization', segments: [segment('onboarding', 'pastor', ['registration', 'configuration', 'organization_verified'])] },
  { id: 2, title: 'Personal y asignación', entityType: 'profile', segments: [segment('staff', 'leader', ['staff_form', 'role_assignment', 'profile_verified'])] },
  { id: 3, title: 'Catálogo y precios', entityType: 'product', segments: [segment('catalog', 'leader', ['product_form', 'price_saved', 'catalog_verified'])] },
  { id: 4, title: 'Apertura de caja', entityType: 'cash_session', segments: [segment('opening', 'cashier', ['opening_form', 'opening_cash', 'session_open_verified'])] },
  { id: 5, title: 'Cobro y cambio', entityType: 'order', segments: [segment('checkout', 'cashier', ['cart', 'payment', 'order_and_change_verified'])] },
  { id: 6, title: 'Recepción y despacho KDS', entityType: 'order', segments: [segment('kitchen', 'kitchen', ['order_received', 'dispatch', 'operational_result_verified'])] },
  { id: 7, title: 'Venta directa sin cocina', entityType: 'order', segments: [segment('direct_sale', 'leader', ['auto_fulfillment_enabled', 'direct_payment', 'auto_fulfilled_verified'])] },
  { id: 8, title: 'Conteo y cierre ordinario', entityType: 'cash_session', segments: [segment('count', 'cashier', ['counting', 'ordinary_preclose', 'pending_verified']), segment('approve', 'leader', ['review_totals', 'ordinary_approval', 'closed_verified'])] },
  { id: 9, title: 'Rescate de caja independiente desatendida', entityType: 'cash_session', sessionMode: 'independent', requiresIndependentEnabledViaUI: true, segments: [segment('abandon', 'cashier', ['opening_50', 'sale_45', 'departure']), segment('rescue', 'leader', ['contingency_dialog', 'justification_and_95', 'contingency_preclose', 'contingency_approval', 'same_session_closed']), segment('reopen', 'cashier', ['new_session_unblocked'])] },
];

export function moduleById(id) {
  const found = MODULES.find(m => m.id === id);
  if (!found) throw new Error('UNKNOWN_MODULE');
  return found;
}

export function markerTitle(metadata) {
  const allowed = ['runId', 'moduleId', 'segmentId', 'actorId', 'entityKey', 'kind', 'milestone'];
  if (Object.keys(metadata).some(key => !allowed.includes(key))) throw new Error('MARKER_FIELDS');
  return `AVC1:${JSON.stringify(metadata)}`;
}

export function readMarker(title) {
  if (!title?.startsWith('AVC1:')) return null;
  try { return JSON.parse(title.slice(5)); } catch { throw new Error('MALFORMED_MARKER'); }
}
