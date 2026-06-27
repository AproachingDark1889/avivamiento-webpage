<template>
  <div class="pa-4 h-100 d-flex flex-column">
    <div class="d-flex align-center mb-4">
      <h1 class="text-h4 font-weight-black text-primary">
        <v-icon start size="36">mdi-chart-bar</v-icon>Reportes
      </h1>
      <v-spacer />
      <v-chip color="secondary" variant="flat" class="font-weight-bold ml-2">
        {{ auth.isPastor ? 'Pastor (Auditor)' : auth.isSuperAdmin ? 'Super Admin' : 'Leader' }}
      </v-chip>
    </div>

    <v-card elevation="2" class="pa-4 flex-grow-1 overflow-y-auto" rounded="xl" border>
            <div class="d-flex align-center mb-4">
              <div class="text-h6 font-weight-bold">Filtros de Búsqueda</div>
            </div>

            <v-row>
              <v-col cols="12" md="3">
                <v-text-field
                  v-model="dateFrom"
                  label="Desde"
                  type="date"
                  variant="outlined"
                  density="compact"
                  hide-details
                />
              </v-col>
              <v-col cols="12" md="3">
                <v-text-field
                  v-model="dateTo"
                  label="Hasta"
                  type="date"
                  variant="outlined"
                  density="compact"
                  hide-details
                />
              </v-col>
              
              <!-- 🆕 SELECTOR DE DEPARTAMENTOS (Solo Pastor/SuperAdmin) -->
              <v-col cols="12" md="3" v-if="canViewAllDepartments">
                <v-select
                  v-model="selectedLeaderId"
                  :items="leaderOptions"
                  item-title="title"
                  item-value="value"
                  label="Departamento"
                  variant="outlined"
                  density="compact"
                  hide-details
                  prepend-inner-icon="mdi-domain"
                  clearable
                />
              </v-col>
              
              <v-col cols="12" :md="canViewAllDepartments ? 3 : 4">
                <v-btn
                  color="primary"
                  block
                  :loading="loading"
                  @click="runReport"
                  height="40"
                  prepend-icon="mdi-magnify"
                >
                  Generar Reporte
                </v-btn>
              </v-col>
            </v-row>

            <v-alert v-if="warning" type="warning" variant="tonal" class="mt-4" density="compact">
              {{ warning }}
            </v-alert>

            <v-divider class="my-6" />

            <v-row>
              <v-col cols="12" md="4">
                <v-card elevation="0" class="pa-4 bg-primary-lighten-5 border">
                  <div class="text-caption font-weight-bold text-medium-emphasis text-uppercase">Órdenes Totales</div>
                  <div class="text-h4 font-weight-black text-primary mt-1">{{ count }}</div>
                </v-card>
              </v-col>

              <v-col cols="12" md="4">
                <v-card elevation="0" class="pa-4 bg-success-lighten-5 border">
                  <div class="text-caption font-weight-bold text-medium-emphasis text-uppercase">Ventas Totales</div>
                  <div class="text-h4 font-weight-black text-success mt-1">{{ money(total) }}</div>
                </v-card>
              </v-col>

              <v-col cols="12" md="4">
                <v-card elevation="0" class="pa-4 bg-info-lighten-5 border">
                  <div class="text-caption font-weight-bold text-medium-emphasis text-uppercase">Ticket Promedio</div>
                  <div class="text-h4 font-weight-black text-info mt-1">{{ money(avg) }}</div>
                </v-card>
              </v-col>
            </v-row>

            <!-- 🆕 MÉTRICAS OPERATIVAS -->
            <v-row class="mb-4">
              <v-col cols="12" md="3">
                <v-card elevation="0" class="pa-3 border bg-grey-lighten-5 d-flex justify-space-between align-center">
                  <span class="text-caption font-weight-bold text-medium-emphasis">Entregadas</span>
                  <span class="text-h6 font-weight-black">{{ opCompleted }}</span>
                </v-card>
              </v-col>
              <v-col cols="12" md="3">
                <v-card elevation="0" class="pa-3 border bg-grey-lighten-5 d-flex justify-space-between align-center">
                  <span class="text-caption font-weight-bold text-medium-emphasis">Pendientes</span>
                  <span class="text-h6 font-weight-black">{{ opPending }}</span>
                </v-card>
              </v-col>
              <v-col cols="12" md="3">
                <v-card elevation="0" class="pa-3 border bg-orange-lighten-5 d-flex justify-space-between align-center">
                  <span class="text-caption font-weight-bold text-orange-darken-3">Incidencias</span>
                  <span class="text-h6 font-weight-black text-orange-darken-3">{{ opIncidences }}</span>
                </v-card>
              </v-col>
              <v-col cols="12" md="3">
                <v-card elevation="0" class="pa-3 border bg-red-lighten-5 d-flex justify-space-between align-center">
                  <span class="text-caption font-weight-bold text-error">Tasa Incidencia</span>
                  <span class="text-h6 font-weight-black text-error">{{ incidenceRate.toFixed(1) }}%</span>
                </v-card>
              </v-col>
            </v-row>

            <!-- 🆕 RANKING POR DEPARTAMENTO (Solo Pastor/SuperAdmin, cuando ve "Todos") -->
            <v-row v-if="canViewAllDepartments && !selectedLeaderId && departmentRanking.length > 0" class="mb-4">
              <v-col cols="12">
                <v-card variant="outlined" class="pa-4" rounded="xl">
                  <div class="text-h6 font-weight-bold mb-4">📊 Rendimiento por Departamento</div>
                  
                  <div v-for="dept in departmentRanking" :key="dept.leaderId" class="mb-4">
                    <div class="d-flex justify-space-between text-body-2 mb-1">
                      <div class="d-flex align-center">
                        <v-icon icon="mdi-account-tie" size="small" class="mr-2" color="primary" />
                        <span class="font-weight-medium">{{ dept.leaderName }}</span>
                      </div>
                      <span class="font-weight-bold">{{ money(dept.total) }} ({{ dept.count }} órdenes)</span>
                    </div>
                    <v-progress-linear 
                      :model-value="maxDeptTotal > 0 ? (dept.total / maxDeptTotal) * 100 : 0" 
                      color="primary" 
                      height="10" 
                      rounded 
                    />
                  </div>
                </v-card>
              </v-col>
            </v-row>

            <v-row class="mb-6">
              <!-- Ventas por Método de Pago -->
              <v-col cols="12" md="6">
                <v-card variant="outlined" class="h-100 pa-4" rounded="xl">
                  <div class="text-h6 font-weight-bold mb-4">Ventas por Método</div>
                  
                  <div v-for="method in paymentStats" :key="method.key" class="mb-4">
                    <div class="d-flex justify-space-between text-body-2 mb-1">
                      <div class="d-flex align-center">
                        <v-icon :icon="method.icon" size="small" class="mr-2" :color="method.color" />
                        <span class="text-capitalize font-weight-medium">{{ method.label }}</span>
                      </div>
                      <span class="font-weight-bold">{{ money(method.total) }} ({{ method.count }})</span>
                    </div>
                    <v-progress-linear 
                      :model-value="total > 0 ? (method.total / total) * 100 : 0" 
                      :color="method.color" 
                      height="8" 
                      rounded 
                    />
                  </div>
                </v-card>
              </v-col>

              <!-- Top Productos -->
              <v-col cols="12" md="6">
                <v-card variant="outlined" class="h-100 pa-4" rounded="xl">
                  <div class="text-h6 font-weight-bold mb-4">Top 5 Productos</div>
                  
                  <v-list density="compact" class="pa-0">
                    <v-list-item v-for="(prod, i) in topProducts" :key="prod.name" class="px-0">
                      <template #prepend>
                        <v-avatar color="primary" variant="tonal" size="32" class="font-weight-bold mr-3">
                          #{{ i + 1 }}
                        </v-avatar>
                      </template>
                      <v-list-item-title class="font-weight-medium">{{ prod.name }}</v-list-item-title>
                      <template #append>
                        <div class="text-right">
                          <div class="font-weight-bold">{{ prod.quantity }} vendidos</div>
                          <div class="text-caption text-medium-emphasis">{{ money(prod.total) }}</div>
                        </div>
                      </template>
                    </v-list-item>
                    <div v-if="topProducts.length === 0" class="text-center text-medium-emphasis pa-4">
                      Sin datos
                    </div>
                  </v-list>
                </v-card>
              </v-col>
            </v-row>

            <div class="text-h6 font-weight-bold mt-2 mb-4">Últimas Transacciones</div>

            <v-table hover density="compact" class="border rounded-lg">
              <thead>
                <tr>
                  <th class="text-left">Orden ID</th>
                  <th class="text-left">Fecha/Hora</th>
                  <th class="text-left">Método</th>
                  <th class="text-left">Total</th>
                  <th class="text-left">Estado</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="o in lastOrders" :key="o.id">
                  <td class="font-weight-bold font-monospace">#{{ String(o.id).slice(0, 8) }}</td>
                  <td>{{ formatTime(o.created_at) }}</td>
                  <td>
                    <div class="d-flex align-center">
                      <v-icon 
                        :icon="getPaymentIcon(o.payment_method)" 
                        size="small" 
                        class="mr-2"
                        color="medium-emphasis"
                      />
                      <span class="text-capitalize text-body-2">{{ paymentLabel(o.payment_method) }}</span>
                    </div>
                  </td>
                  <td class="font-weight-bold">{{ money(Number(o.total ?? 0)) }}</td>
                  <td>
                    <v-chip size="x-small" 
                      :color="o.operational_status === 'completed' ? 'success' : o.operational_status === 'pending' ? 'info' : 'error'" 
                      variant="flat">
                      {{ o.operational_status }}
                    </v-chip>
                  </td>
                </tr>
                <tr v-if="lastOrders.length === 0">
                  <td colspan="5" class="text-center pa-4 text-medium-emphasis">Sin datos disponibles</td>
                </tr>
              </tbody>
            </v-table>
    </v-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useAuthStore } from '../../../stores/auth'
import { useSupabase } from '../../../composables/useSupabase'
import { formatMoney } from '../../../utils/format'

definePageMeta({ middleware: ['auth', 'role-leader'], layout: 'sistema', requiredAccess: 'reports' })
useHead({ title: 'Reportes - Aviva Check' })

// Auth store
const auth = useAuthStore()

const loading = ref(false)
const warning = ref('')

const dateFrom = ref<string>('')
const dateTo = ref<string>('')

const count = ref(0)
const total = ref(0)
const lastOrders = ref<any[]>([])

const opCompleted = ref(0)
const opPending = ref(0)
const opIncidences = ref(0)
const incidenceRate = ref(0)

// 🆕 Department Selector State
const leaders = ref<Array<{ id: string; display_name: string; email: string }>>([])
const selectedLeaderId = ref<string | null>(null)

// 🆕 Department Ranking State
interface DepartmentStats {
  leaderId: string
  leaderName: string
  total: number
  count: number
}
const departmentRanking = ref<DepartmentStats[]>([])

// 🆕 Computed: Max para normalizar barras
const maxDeptTotal = computed(() => {
  return Math.max(...departmentRanking.value.map(d => d.total), 1)
})

// 🆕 Computed: Solo Pastor/SuperAdmin ven el selector
const canViewAllDepartments = computed(() => {
  return auth.isPastor || auth.isSuperAdmin
})

// 🆕 Computed: Opciones del selector (Todos + Líderes)
const leaderOptions = computed(() => {
  const options = [{ value: null, title: '📊 Todos los Departamentos' }]
  leaders.value.forEach(l => {
    options.push({
      value: l.id as any,
      title: l.display_name || l.email || 'Líder'
    })
  })
  return options
})

// 🔥 Team-Aware: Obtener IDs del líder + todo su equipo
async function getTeamIds(leaderId: string): Promise<string[]> {
  const sb = getSupabase()
  if (!sb?.from) return [leaderId]
  
  const { data: staff } = await sb
    .from('profiles')
    .select('id')
    .eq('owner_id', leaderId)
  
  const staffIds = staff?.map((s: any) => s.id) || []
  return [leaderId, ...staffIds]
}

function todayISO() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Cargar líderes al montar (solo si puede ver todos)
async function loadLeaders() {
  if (!canViewAllDepartments.value) return
  
  const sb = getSupabase()
  if (!sb?.from) return
  
  let query = sb
    .from('profiles')
    .select('id, display_name, email')
    .eq('role', 'leader')
    .order('display_name', { ascending: true })
  
  // Pastor: ver solo líderes que creó (via owner_id)
  if (auth.role === 'pastor' && auth.profile?.id) {
    query = query.eq('owner_id', auth.profile.id)
  }
  
  const { data, error } = await query
  
  if (!error && data) {
    leaders.value = data
  }
}

onMounted(async () => {
  const t = todayISO()
  dateFrom.value = t
  dateTo.value = t
  
  await loadLeaders()
  runReport()
})

// 🆕 Calcular ranking de departamentos (eficiente: usa datos en memoria)
async function calculateDepartmentRanking(allOrders: any[]) {
  if (!canViewAllDepartments.value || selectedLeaderId.value) {
    departmentRanking.value = []
    return
  }
  
  const sb = getSupabase()
  if (!sb?.from || leaders.value.length === 0) {
    departmentRanking.value = []
    return
  }
  
  const ranking: DepartmentStats[] = []
  
  // Obtener todos los staffs de una vez (optimizado)
  const { data: allStaff } = await sb
    .from('profiles')
    .select('id, owner_id')
    .in('owner_id', leaders.value.map(l => l.id))
  
  // Crear mapa de staff -> leader
  const staffToLeader = new Map<string, string>()
  allStaff?.forEach((s: any) => {
    staffToLeader.set(s.id, s.owner_id)
  })
  
  // También mapear líderes a sí mismos
  leaders.value.forEach(l => {
    staffToLeader.set(l.id, l.id)
  })
  
  // Agrupar ventas por líder
  const leaderTotals = new Map<string, { total: number; count: number }>()
  leaders.value.forEach(l => {
    leaderTotals.set(l.id, { total: 0, count: 0 })
  })
  
  allOrders.forEach((order: any) => {
    const createdBy = order.created_by
    const departmentOwnerId = order.department_owner_id
    if (!createdBy && !departmentOwnerId) return
    
    // Buscar el líder de este creador
    let leaderId = departmentOwnerId || staffToLeader.get(createdBy)
    
    // Si el creador es un líder
    if (!leaderId && leaders.value.find(l => l.id === createdBy)) {
      leaderId = createdBy
    }
    
    if (leaderId && leaderTotals.has(leaderId)) {
      const current = leaderTotals.get(leaderId)!
      current.total += Number(order.total ?? 0)
      current.count++
    }
  })
  
  // Crear ranking ordenado
  leaders.value.forEach(l => {
    const stats = leaderTotals.get(l.id)
    if (stats && stats.count > 0) {
      ranking.push({
        leaderId: l.id,
        leaderName: l.display_name || l.email || 'Líder',
        total: stats.total,
        count: stats.count
      })
    }
  })
  
  departmentRanking.value = ranking.sort((a, b) => b.total - a.total)
}

// 🆕 Recargar reporte al cambiar departamento
watch(selectedLeaderId, () => {
  runReport()
})

const money = (amount: number) => formatMoney(amount || 0)

function formatTime(iso?: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('es-MX', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getSupabase() {
  try { return useSupabase() } catch { return null }
}

function currentDepartmentOwnerId() {
  const profile = auth.profile
  if (!profile) return null
  if (profile.role === 'pastor' || profile.role === 'leader' || profile.role === 'super_admin') return profile.id
  return profile.owner_id || null
}

function shouldFilterByDepartment() {
  const role = auth.profile?.role
  return role !== 'pastor' && role !== 'super_admin'
}

const avg = computed(() => {
  if (!count.value) return 0
  return total.value / count.value
})

function rangeToTimestamps(from: string, to: string) {
  const start = new Date(`${from}T00:00:00`)
  const end = new Date(`${to}T23:59:59.999`)
  return {
    startISO: start.toISOString(),
    endISO: end.toISOString(),
  }
}

const topProducts = ref<any[]>([])
const paymentStats = ref<any[]>([])

function getPaymentIcon(method?: string) {
  if (method === 'card') return 'mdi-credit-card'
  if (method === 'transfer') return 'mdi-bank-transfer'
  return 'mdi-cash'
}

function paymentLabel(method?: string) {
  if (method === 'card') return 'Tarjeta'
  if (method === 'transfer') return 'Transferencia'
  return 'Efectivo'
}

async function runReport() {
  warning.value = ''
  const sb = getSupabase()
  if (!sb?.from) {
    warning.value = 'No se detectó Supabase. Modo visualización.'
    return
  }

  if (!dateFrom.value || !dateTo.value) {
    warning.value = 'Selecciona fechas válidas.'
    return
  }

  loading.value = true
  try {
    const { startISO, endISO } = rangeToTimestamps(dateFrom.value, dateTo.value)
    const orgId = auth.profile?.org_id
    const deptOwnerId = currentDepartmentOwnerId()
    if (!orgId && auth.profile?.role !== 'super_admin') {
      warning.value = 'Tu usuario no tiene organizacion asignada.'
      return
    }

    // 🔥 Team-Aware: Si hay departamento seleccionado, filtrar por equipo completo
    const selectedDepartmentId = selectedLeaderId.value

    // 1. Build query
    let query = sb
      .from('orders')
      .select('id,total,status,created_at,payment_method,created_by,department_owner_id,financial_status,operational_status')
      .eq('financial_status', 'paid')
      .gte('created_at', startISO)
      .lte('created_at', endISO)
      .order('created_at', { ascending: false })
      .limit(2000)

    if (orgId) {
      query = query.eq('org_id', orgId)
    }
    
    // 🔥 Aplicar filtro Team-Aware si hay departamento seleccionado
    if (selectedDepartmentId) {
      query = query.eq('department_owner_id', selectedDepartmentId)
    } else if (shouldFilterByDepartment() && deptOwnerId) {
      query = query.eq('department_owner_id', deptOwnerId)
    }

    const { data: orders, error } = await query

    if (error) throw error

    const rows = orders ?? []
    count.value = rows.length
    total.value = rows.reduce((sum: number, r: any) => sum + Number(r.total ?? 0), 0)
    lastOrders.value = rows.slice(0, 30)

    opCompleted.value = rows.filter((r: any) => r.operational_status === 'completed').length
    opPending.value = rows.filter((r: any) => r.operational_status === 'pending').length
    opIncidences.value = rows.filter((r: any) => r.operational_status === 'kitchen_rejected' || r.operational_status === 'kitchen_cancelled').length
    incidenceRate.value = count.value > 0 ? (opIncidences.value / count.value) * 100 : 0

    // 2. Calculate Payment Stats
    const stats = {
      cash: { key: 'cash', label: 'Efectivo', count: 0, total: 0, icon: 'mdi-cash', color: 'success' },
      card: { key: 'card', label: 'Tarjeta', count: 0, total: 0, icon: 'mdi-credit-card', color: 'blue' },
      transfer: { key: 'transfer', label: 'Transferencia', count: 0, total: 0, icon: 'mdi-bank-transfer', color: 'purple' },
    } as Record<string, any>

    rows.forEach((r: any) => {
      const m = r.payment_method || 'cash'
      // Normalizar si hay basura en DB
      const key = stats[m] ? m : 'cash'
      
      stats[key].count++
      stats[key].total += Number(r.total ?? 0)
    })

    paymentStats.value = Object.values(stats).sort((a,b) => b.total - a.total)

    // 3. Fetch Order Items for Top Products
    // Optimización: Solo traer items de órdenes completadas (o todas, segun prefieras)
    const orderIds = rows.map((r: any) => r.id)
    
    if (orderIds.length > 0) {
      const { data: items, error: itemsError } = await sb
        .from('order_items')
        .select('name, quantity, subtotal')
        .in('order_id', orderIds)
      
      if (!itemsError && items) {
        // Agrupar por nombre
        const productMap = new Map<string, { name: string, quantity: number, total: number }>()
        
        items.forEach((item: any) => {
          const current = productMap.get(item.name) ?? { name: item.name, quantity: 0, total: 0 }
          current.quantity += Number(item.quantity ?? 0)
          current.total += Number(item.subtotal ?? 0)
          productMap.set(item.name, current)
        })

        topProducts.value = Array.from(productMap.values())
          .sort((a, b) => b.quantity - a.quantity)
          .slice(0, 5)
      }
    } else {
      topProducts.value = []
    }

    // 4. 🆕 Calcular ranking de departamentos (solo Pastor/SuperAdmin sin filtro)
    await calculateDepartmentRanking(rows)

  } catch (e: any) {
    warning.value = `Error: ${e?.message ?? String(e)}`
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.bg-primary-lighten-5 {
  background-color: #E3F2FD !important;
}
.bg-success-lighten-5 {
  background-color: #E8F5E9 !important;
}
.bg-info-lighten-5 {
  background-color: #E1F5FE !important;
}
</style>
