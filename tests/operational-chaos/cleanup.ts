// tests/operational-chaos/cleanup.ts
import { assertPhase2BExecutionAllowed, assertOperationalChaosEnabled } from './config'
import { ChaosManifest, MockSupabaseClient } from './manifest'

export async function executeCleanup(manifest: ChaosManifest, supabase: MockSupabaseClient) {
  // Falla cerrado antes de leer secretos si no está explícitamente autorizado
  assertPhase2BExecutionAllowed()
  assertOperationalChaosEnabled()
  
  const orgIds = manifest.organizations.map(o => o.orgId)
  const capturedOrderIds: string[] = []

  // 1. CAPTURAR orderIds antes de cualquier eliminación (falla explícitamente si la consulta falla)
  if (orgIds.length > 0) {
    for (const orgId of orgIds) {
      const { data: orders, error: errOrders } = await supabase.from('orders').select('id').eq('org_id', orgId)
      if (errOrders) {
        throw new Error('Initial cleanup orders query failed: ' + errOrders.message)
      }
      if (orders) {
        orders.forEach((o: any) => capturedOrderIds.push(o.id))
      }
    }
  }
  
  if (orgIds.length > 0) {
    // 1. cash_closures
    const { error: err1 } = await supabase.from('cash_closures').delete().in('org_id', orgIds)
    if (err1) throw new Error('Cleanup err1: ' + err1.message)

    // 2. order_items
    if (capturedOrderIds.length > 0) {
      const { error: err2b } = await supabase.from('order_items').delete().in('order_id', capturedOrderIds)
      if (err2b) throw new Error('Cleanup err2b: ' + err2b.message)
    }

    // 3. orders
    const { error: err3 } = await supabase.from('orders').delete().in('org_id', orgIds)
    if (err3) throw new Error('Cleanup err3: ' + err3.message)

    // 4. products
    const { error: err4 } = await supabase.from('products').delete().in('org_id', orgIds)
    if (err4) throw new Error('Cleanup err4: ' + err4.message)

    // 5. UPDATE organizations
    const { error: err5 } = await supabase.from('organizations').update({ owner_id: null }).in('id', orgIds)
    if (err5) throw new Error('Cleanup err5: ' + err5.message)

    // 6. profiles
    const { error: err6 } = await supabase.from('profiles').delete().in('org_id', orgIds)
    if (err6) throw new Error('Cleanup err6: ' + err6.message)

    // 7. organizations
    const { error: err7 } = await supabase.from('organizations').delete().in('id', orgIds)
    if (err7) throw new Error('Cleanup err7: ' + err7.message)
  }

  // 8. admin.deleteUser fallback
  // Este bloque debe ejecutarse siempre para limpiar cualquier auth user huérfano, 
  // independientemente de si la creación de la organización falló
  for (const user of manifest.authUsers) {
    const { error } = await supabase.auth.admin.deleteUser(user.userId)
    if (error && error.status !== 404) {
      throw new Error(`Cleanup fallback failed for user ${user.userId}: ${error.message}`)
    }
  }

  // =========================================================================
  // VERIFICACIÓN POST-CLEANUP EXPLÍCITA
  // =========================================================================
  let orgCount = 0
  let prodCount = 0
  let profCount = 0
  let ordCount = 0
  let closureCount = 0
  let orderItemsCount = 0

  if (orgIds.length > 0) {
    // 1. Contar organizations
    const { count: cOrg, error: errCheckOrg } = await supabase
      .from('organizations')
      .select('*', { count: 'exact', head: true })
      .in('id', orgIds)
    if (errCheckOrg) throw new Error('Post-cleanup check organizations failed: ' + errCheckOrg.message)
    orgCount = cOrg || 0

    // 2. Contar products
    const { count: cProd, error: errCheckProd } = await supabase
      .from('products')
      .select('*', { count: 'exact', head: true })
      .in('org_id', orgIds)
    if (errCheckProd) throw new Error('Post-cleanup check products failed: ' + errCheckProd.message)
    prodCount = cProd || 0

    // 3. Contar profiles
    const { count: cProf, error: errCheckProf } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .in('org_id', orgIds)
    if (errCheckProf) throw new Error('Post-cleanup check profiles failed: ' + errCheckProf.message)
    profCount = cProf || 0

    // 4. Contar orders
    const { count: cOrd, error: errCheckOrd } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .in('org_id', orgIds)
    if (errCheckOrd) throw new Error('Post-cleanup check orders failed: ' + errCheckOrd.message)
    ordCount = cOrd || 0

    // 5. Contar cash_closures
    const { count: cClosure, error: errCheckClosure } = await supabase
      .from('cash_closures')
      .select('*', { count: 'exact', head: true })
      .in('org_id', orgIds)
    if (errCheckClosure) throw new Error('Post-cleanup check cash_closures failed: ' + errCheckClosure.message)
    closureCount = cClosure || 0

    // 6. Verificar order_items = 0
    if (capturedOrderIds.length > 0) {
      const { count: itemsCount, error: errCheckItems } = await supabase
        .from('order_items')
        .select('*', { count: 'exact', head: true })
        .in('order_id', capturedOrderIds)
      if (errCheckItems) throw new Error('Post-cleanup check order_items failed: ' + errCheckItems.message)
      orderItemsCount = itemsCount || 0
    }
  }

  // 7. Verificar authUsers eliminados (responden 404 al buscar por id) — SIEMPRE FUERA del bloque orgIds
  let activeAuthUsersCount = 0
  for (const user of manifest.authUsers) {
    const { data: userData, error: errGetUser } = await supabase.auth.admin.getUserById(user.userId)
    
    if (errGetUser) {
      const status = errGetUser.status
      const msg = errGetUser.message || ''
      // Aceptar estrictamente solo 404 / user-not-found como eliminación exitosa; cualquier otro error falla la prueba
      const isNotFound = status === 404 || msg.toLowerCase().includes('user not found') || msg.toLowerCase().includes('not found')
      if (!isNotFound) {
        throw new Error(`Auth getUserById failed for user ${user.userId} with unexpected database/network error: ${errGetUser.message} (status: ${status})`)
      }
    } else if (userData?.user) {
      activeAuthUsersCount++
    }
  }

  const residuals = {
    organizations: orgCount,
    products: prodCount,
    profiles: profCount,
    orders: ordCount,
    cash_closures: closureCount,
    order_items: orderItemsCount,
    auth_users: activeAuthUsersCount
  }

  const totalResiduals = Object.values(residuals).reduce((sum, val) => sum + val, 0)
  if (totalResiduals > 0) {
    throw new Error(`CRITICAL POST-CLEANUP FAILURE: Residual rows detected in database! ${JSON.stringify(residuals)}`)
  }
}
