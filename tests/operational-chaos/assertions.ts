// tests/operational-chaos/assertions.ts
import { expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

export async function assertMathematicalConsistency(
  sb: any,
  orgId: string,
  dateStr: string,
  departmentOwnerId?: string
): Promise<void> {
  const dayStart = new Date(`${dateStr}T00:00:00`)
  const dayEnd = new Date(`${dateStr}T23:59:59.999`)

  // 1. Reconcile order_items with orders
  let ordersQuery = sb
    .from('orders')
    .select('id, total, status, financial_status, department_owner_id, created_at')
    .eq('org_id', orgId)
    .gte('created_at', dayStart.toISOString())
    .lte('created_at', dayEnd.toISOString())

  if (departmentOwnerId) {
    ordersQuery = ordersQuery.eq('department_owner_id', departmentOwnerId)
  }

  const { data: orders, error: ordersErr } = await ordersQuery
    
  expect(ordersErr).toBeNull()
  expect(orders).not.toBeNull()
  
  for (const order of orders || []) {
    const { data: items, error: itemsErr } = await sb
      .from('order_items')
      .select('quantity, price')
      .eq('order_id', order.id)
      
    expect(itemsErr).toBeNull()
    expect(items).not.toBeNull()
    
    const calculatedTotal = (items || []).reduce((sum, item) => sum + (Number(item.quantity) * Number(item.price)), 0)
    expect(calculatedTotal, `order_items total mismatch for order ${order.id}`).toBe(Number(order.total))
  }
  
  await assertCashSessionConsistency(sb, orgId, departmentOwnerId)
}

export async function assertCashSessionConsistency(
  sb: any,
  orgId: string,
  departmentOwnerId?: string
): Promise<void> {
  let sessionsQuery = sb
    .from('cash_sessions')
    .select('id, sales_total, total_cash_sales, total_card_sales, total_transfer_sales, orders_count, status, department_owner_id')
    .eq('org_id', orgId)
    .in('status', ['pending_validation', 'closed'])

  if (departmentOwnerId) {
    sessionsQuery = sessionsQuery.eq('department_owner_id', departmentOwnerId)
  }

  const { data: sessions, error: sessionsErr } = await sessionsQuery
  expect(sessionsErr).toBeNull()

  const sessionList = sessions || []
  if (departmentOwnerId) {
    expect(
      sessionList.length,
      `Expected at least one reconciled cash session for department ${departmentOwnerId}`
    ).toBeGreaterThan(0)
  }

  for (const session of sessionList) {
    const { data: orders, error: ordersErr } = await sb
      .from('orders')
      .select('id, total, financial_status, payment_method')
      .eq('org_id', orgId)
      .eq('cash_session_id', session.id)

    expect(ordersErr).toBeNull()

    const paidOrders = (orders || []).filter((order: any) => order.financial_status === 'paid')
    const salesTotal = paidOrders.reduce((sum: number, order: any) => sum + Number(order.total), 0)
    const cashSales = paidOrders
      .filter((order: any) => order.payment_method === 'cash' || !order.payment_method)
      .reduce((sum: number, order: any) => sum + Number(order.total), 0)
    const cardSales = paidOrders
      .filter((order: any) => order.payment_method === 'card')
      .reduce((sum: number, order: any) => sum + Number(order.total), 0)
    const transferSales = paidOrders
      .filter((order: any) => order.payment_method === 'transfer')
      .reduce((sum: number, order: any) => sum + Number(order.total), 0)

    expect(Number(session.sales_total), `cash_session ${session.id} sales_total mismatch`).toBe(salesTotal)
    expect(Number(session.total_cash_sales), `cash_session ${session.id} cash total mismatch`).toBe(cashSales)
    expect(Number(session.total_card_sales), `cash_session ${session.id} card total mismatch`).toBe(cardSales)
    expect(Number(session.total_transfer_sales), `cash_session ${session.id} transfer total mismatch`).toBe(transferSales)
    expect(Number(session.orders_count), `cash_session ${session.id} order count mismatch`).toBe(paidOrders.length)
  }

  const { data: orphanOrders, error: orphanErr } = await sb
    .from('orders')
    .select('id')
    .eq('org_id', orgId)
    .is('cash_session_id', null)
    .eq('financial_status', 'paid')

  expect(orphanErr).toBeNull()
  expect(orphanOrders || [], 'Paid orders must be linked to a cash session').toHaveLength(0)
}

export async function assertCrossTenantIsolation(
  supabaseUrl: string,
  supabaseAnonKey: string,
  emailAlpha: string,
  emailBeta: string,
  passwordAlpha: string,
  passwordBeta: string,
  orgIdAlpha: string,
  orgIdBeta: string,
  productIdAlpha: string,
  productIdBeta: string
): Promise<void> {
  // 1. Authenticate Alpha client using anon key
  const sbAlpha = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  })
  const { error: alphaAuthErr } = await sbAlpha.auth.signInWithPassword({
    email: emailAlpha,
    password: passwordAlpha
  })
  expect(alphaAuthErr).toBeNull()

  // 2. Authenticate Beta client using anon key
  const sbBeta = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  })
  const { error: betaAuthErr } = await sbBeta.auth.signInWithPassword({
    email: emailBeta,
    password: passwordBeta
  })
  expect(betaAuthErr).toBeNull()

  const { error: openAlphaErr } = await sbAlpha.rpc('open_cash_session', {
    p_mode: 'shared',
    p_opening_cash: 0
  })
  expect(openAlphaErr).toBeNull()

  const { error: openBetaErr } = await sbBeta.rpc('open_cash_session', {
    p_mode: 'shared',
    p_opening_cash: 0
  })
  expect(openBetaErr).toBeNull()

  // 3. Process checkout for Alpha to create a real order in Org A
  const { data: orderA, error: errA } = await sbAlpha.rpc('process_checkout', {
    p_items: [{ product_id: productIdAlpha, quantity: 1 }],
    p_payment_method: 'cash',
    p_paid_with: 200,
    p_change: 0,
    p_auto_accept: false,
    p_mode: 'shared'
  })
  expect(errA).toBeNull()

  // 4. Process checkout for Beta to create a real order in Org B
  const { data: orderB, error: errB } = await sbBeta.rpc('process_checkout', {
    p_items: [{ product_id: productIdBeta, quantity: 1 }],
    p_payment_method: 'cash',
    p_paid_with: 200,
    p_change: 0,
    p_auto_accept: false,
    p_mode: 'shared'
  })
  expect(errB).toBeNull()

  // =========================================================================
  // CONTROL POSITIVO: Alpha/Beta deben poder ver sus PROPIOS recursos
  // =========================================================================
  
  // Alpha cashier must be able to read Alpha products
  const { data: alphaOwnProduct } = await sbAlpha
    .from('products')
    .select('id')
    .eq('id', productIdAlpha)
  expect(alphaOwnProduct || []).toHaveLength(1)

  // Beta cashier must be able to read Beta products
  const { data: betaOwnProduct } = await sbBeta
    .from('products')
    .select('id')
    .eq('id', productIdBeta)
  expect(betaOwnProduct || []).toHaveLength(1)

  // Alpha cashier must be able to read Alpha orders
  const { data: alphaOwnOrder } = await sbAlpha
    .from('orders')
    .select('id')
    .eq('id', orderA.order_id)
  expect(alphaOwnOrder || []).toHaveLength(1)

  // Beta cashier must be able to read Beta orders
  const { data: betaOwnOrder } = await sbBeta
    .from('orders')
    .select('id')
    .eq('id', orderB.order_id)
  expect(betaOwnOrder || []).toHaveLength(1)

  // =========================================================================
  // CONTROL NEGATIVO: Alpha/Beta NO deben poder ver recursos ajenos
  // =========================================================================

  // Alpha cashier must never read Beta products
  const { data: alphaCrossProduct } = await sbAlpha
    .from('products')
    .select('id')
    .eq('id', productIdBeta)
  expect(alphaCrossProduct || []).toHaveLength(0)

  // Beta cashier must never read Alpha products
  const { data: betaCrossProduct } = await sbBeta
    .from('products')
    .select('id')
    .eq('id', productIdAlpha)
  expect(betaCrossProduct || []).toHaveLength(0)

  // Alpha cashier must never read Beta orders
  const { data: alphaCrossOrder } = await sbAlpha
    .from('orders')
    .select('id')
    .eq('id', orderB.order_id)
  expect(alphaCrossOrder || []).toHaveLength(0)
  
  // Beta cashier must never read Alpha orders
  const { data: betaCrossOrder } = await sbBeta
    .from('orders')
    .select('id')
    .eq('id', orderA.order_id)
  expect(betaCrossOrder || []).toHaveLength(0)
}
