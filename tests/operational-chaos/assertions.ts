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
  
  // 2. Reconcile cash closures with orders
  let closuresQuery = sb
    .from('cash_closures')
    .select('id, sales_total, department_owner_id')
    .eq('org_id', orgId)
    .eq('closure_date', dateStr)

  if (departmentOwnerId) {
    closuresQuery = closuresQuery.eq('department_owner_id', departmentOwnerId)
  }

  const { data: closures, error: closuresErr } = await closuresQuery
    
  expect(closuresErr).toBeNull()
  
  const closureList = closures || []

  if (departmentOwnerId) {
    expect(
      closureList,
      `Expected exactly one cash closure for department ${departmentOwnerId} on ${dateStr}`
    ).toHaveLength(1)
  }

  for (const closure of closureList) {
    const closureSalesTotal = Number(closure.sales_total)
    const closureDepartmentOwnerId = closure.department_owner_id
    
    // A rejected/cancelled kitchen order can still be financially paid.
    // Cash closure must reconcile against financial reality per department.
    const paidOrders = (orders || []).filter(o => {
      if (closureDepartmentOwnerId && o.department_owner_id !== closureDepartmentOwnerId) return false
      return o.financial_status === 'paid'
    })
    const ordersSalesSum = paidOrders.reduce((sum, o) => sum + Number(o.total), 0)
    
    expect(
      closureSalesTotal,
      `cash_closure ${closure.id} total mismatch for department ${closureDepartmentOwnerId || 'unknown'}`
    ).toBe(ordersSalesSum)
  }
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

  // 3. Process checkout for Alpha to create a real order in Org A
  const { data: orderA, error: errA } = await sbAlpha.rpc('process_checkout', {
    p_items: [{ product_id: productIdAlpha, quantity: 1 }],
    p_payment_method: 'cash',
    p_paid_with: 200,
    p_change: 0,
    p_auto_accept: false
  })
  expect(errA).toBeNull()

  // 4. Process checkout for Beta to create a real order in Org B
  const { data: orderB, error: errB } = await sbBeta.rpc('process_checkout', {
    p_items: [{ product_id: productIdBeta, quantity: 1 }],
    p_payment_method: 'cash',
    p_paid_with: 200,
    p_change: 0,
    p_auto_accept: false
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
