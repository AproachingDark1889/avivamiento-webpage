<template>
  <div class="pa-4 h-100 d-flex flex-column">
    <div class="d-flex align-center mb-4">
      <div>
        <h1 class="text-h4 font-weight-black text-primary">
          <v-icon start size="36">mdi-chef-hat</v-icon>Cocina 
        </h1>
        <div class="text-subtitle-1 text-medium-emphasis font-weight-bold">
          {{ pendingOrders.length }} órdenes pendientes
        </div>
      </div>
      <v-spacer />
      <v-chip
        size="large"
        :color="realtimeConnected ? 'success' : 'error'"
        variant="elevated"
        class="font-weight-bold mr-4"
        elevation="2"
      >
        <v-icon start size="small">{{ realtimeConnected ? 'mdi-wifi' : 'mdi-wifi-off' }}</v-icon>
        {{ realtimeConnected ? 'CONECTADO' : 'OFFLINE' }}
      </v-chip>
      
      <v-btn
        color="primary"
        variant="outlined"
        icon="mdi-refresh"
        @click="loadOrders"
        :loading="loading"
        rounded="lg"
      />
    </div>

    <v-alert
      v-if="!supabaseDetected"
      type="warning"
      variant="tonal"
      class="mb-4"
      icon="mdi-alert"
      rounded="lg"
    >
      <strong>Modo Offline:</strong> No se escucharán nuevas órdenes automáticamente.
    </v-alert>

    <!-- TABS -->
    <v-tabs v-model="activeTab" color="primary" class="mb-4" grow>
      <v-tab value="pending">
        <v-icon start>mdi-clock-outline</v-icon>
        Pendientes
        <v-badge v-if="pendingOrders.length" :content="pendingOrders.length" color="error" inline class="ml-2" />
      </v-tab>
      <v-tab value="delivered">
        <v-icon start>mdi-check-circle</v-icon>
        Entregados
        <v-badge v-if="deliveredOrders.length" :content="deliveredOrders.length" color="success" inline class="ml-2" />
      </v-tab>
      <v-tab value="rejected">
        <v-icon start>mdi-close-circle</v-icon>
        Rechazados
        <v-badge v-if="rejectedOrders.length" :content="rejectedOrders.length" color="warning" inline class="ml-2" />
      </v-tab>
    </v-tabs>

    <v-tabs-window v-model="activeTab" class="flex-grow-1 overflow-hidden">
      <!-- PENDING TAB -->
      <v-tabs-window-item value="pending" class="h-100 overflow-y-auto">
        <div v-if="pendingOrders.length === 0" class="d-flex flex-column align-center justify-center text-medium-emphasis pt-16">
          <v-icon icon="mdi-checkbox-marked-circle-outline" size="120" color="success" style="opacity: 0.2;" />
          <div class="text-h4 font-weight-black mt-4 text-disabled">Todo listo</div>
          <div class="text-h6 font-weight-medium text-disabled">No hay órdenes pendientes</div>
        </div>

        <v-row v-else class="align-content-start">
          <v-col v-for="o in pendingOrders" :key="o.id" cols="12" sm="6" md="4" lg="3">
            <v-card
              elevation="3"
              rounded="xl"
              :class="['h-100 d-flex flex-column order-card', getUrgencyClass(o.created_at, o.operational_status)]"
              border
            >
              <div class="pa-3 d-flex align-center justify-space-between bg-surface border-b">
                <div>
                  <div class="text-h6 font-weight-black lh-1" style="font-family: monospace;">#{{ shortId(o.id) }}</div>
                  <div class="text-caption font-weight-bold text-medium-emphasis">{{ formatTime(o.created_at) }}</div>
                </div>
                <v-chip size="small" :color="getUrgencyColor(o.created_at, o.operational_status)" variant="flat" class="font-weight-black text-white">
                  {{ getElapsedMinutes(o.created_at) }} min
                </v-chip>
              </div>
              <v-card-text class="pa-0 flex-grow-1 bg-white">
                <v-list density="compact" class="py-2">
                  <v-list-item v-for="item in (o.items ?? [])" :key="item.product_id" lines="one">
                    <template #prepend>
                      <v-avatar color="grey-lighten-4" class="font-weight-black text-body-1" rounded="lg" size="32">{{ item.quantity }}</v-avatar>
                    </template>
                    <v-list-item-title class="font-weight-bold text-body-1 ml-2" style="white-space: normal;">{{ item.name }}</v-list-item-title>
                  </v-list-item>
                </v-list>
              </v-card-text>
              <div class="pa-2 bg-surface border-t mt-auto d-flex ga-2">
                <v-btn variant="tonal" color="error" rounded="lg" icon="mdi-close-circle" @click="openRejectDialog(o)" />
                <v-btn class="flex-grow-1 font-weight-black" color="success" height="48" rounded="lg" prepend-icon="mdi-check-circle" @click="markDelivered(o)">
                  ENTREGAR
                </v-btn>
              </div>
            </v-card>
          </v-col>
        </v-row>
      </v-tabs-window-item>

      <!-- DELIVERED TAB -->
      <v-tabs-window-item value="delivered" class="h-100 overflow-y-auto">
        <div v-if="deliveredOrders.length === 0" class="d-flex flex-column align-center justify-center text-medium-emphasis pt-16">
          <v-icon icon="mdi-package-variant" size="100" color="grey" style="opacity: 0.2;" />
          <div class="text-h5 font-weight-bold mt-4 text-disabled">Sin entregas recientes</div>
        </div>

        <v-row v-else class="align-content-start">
          <v-col v-for="o in deliveredOrders" :key="o.id" cols="12" sm="6" md="4" lg="3">
            <v-card elevation="1" rounded="xl" class="h-100 border-success" border>
              <div class="pa-3 d-flex align-center justify-space-between bg-success-lighten-5">
                <div>
                  <div class="text-h6 font-weight-black" style="font-family: monospace;">#{{ shortId(o.id) }}</div>
                  <div class="text-caption text-medium-emphasis">{{ formatTime(o.created_at) }}</div>
                </div>
                <v-chip size="small" color="success" variant="flat" class="font-weight-bold">ENTREGADO</v-chip>
              </div>
              <v-card-text class="pa-2">
                <div v-for="item in (o.items ?? [])" :key="item.product_id" class="text-body-2">
                  {{ item.quantity }}x {{ item.name }}
                </div>
              </v-card-text>
            </v-card>
          </v-col>
        </v-row>
      </v-tabs-window-item>

      <!-- REJECTED TAB -->
      <v-tabs-window-item value="rejected" class="h-100 overflow-y-auto">
        <div v-if="rejectedOrders.length === 0" class="d-flex flex-column align-center justify-center text-medium-emphasis pt-16">
          <v-icon icon="mdi-emoticon-happy" size="100" color="grey" style="opacity: 0.2;" />
          <div class="text-h5 font-weight-bold mt-4 text-disabled">Sin rechazos</div>
        </div>

        <v-row v-else class="align-content-start">
          <v-col v-for="o in rejectedOrders" :key="o.id" cols="12" sm="6" md="4" lg="3">
            <v-card elevation="1" rounded="xl" class="h-100 border-error opacity-80" border>
              <div class="pa-3 d-flex align-center justify-space-between bg-error-lighten-5">
                <div>
                  <div class="text-h6 font-weight-black" style="font-family: monospace;">#{{ shortId(o.id) }}</div>
                  <div class="text-caption text-medium-emphasis">{{ formatTime(o.created_at) }}</div>
                </div>
                <v-chip size="small" color="error" variant="flat" class="font-weight-bold text-uppercase">{{ o.status }}</v-chip>
              </div>
              <v-card-text class="pa-2">
                <div v-for="item in (o.items ?? [])" :key="item.product_id" class="text-body-2">
                  {{ item.quantity }}x {{ item.name }}
                </div>
                <v-alert v-if="o.rejection_reason" type="warning" variant="tonal" density="compact" class="mt-2 text-caption">
                  {{ o.rejection_reason }}
                </v-alert>
              </v-card-text>
            </v-card>
          </v-col>
        </v-row>
      </v-tabs-window-item>
    </v-tabs-window>

    <!-- REJECTION DIALOG -->
    <v-dialog v-model="rejectDialog" max-width="400" persistent>
      <v-card rounded="xl">
        <v-card-title class="text-h6 font-weight-bold">
          <v-icon start color="error">mdi-close-circle</v-icon>
          Rechazar Orden #{{ shortId(rejectingOrder?.id) }}
        </v-card-title>
        <v-card-text>
          <v-select
            v-model="rejectReason"
            :items="rejectReasons"
            label="Motivo"
            variant="outlined"
            class="mb-2"
          />
          <v-textarea
            v-model="rejectNotes"
            label="Notas adicionales (opcional)"
            variant="outlined"
            rows="2"
            auto-grow
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="rejectDialog = false">Cancelar</v-btn>
          <v-btn color="error" variant="flat" @click="confirmReject" :loading="rejecting">Rechazar</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import type { Order, OrderItem, OrderWithItems } from '../../../types'
import { formatMoney } from '../../../utils/format'
import { useAuthStore } from '../../../stores/auth'

definePageMeta({ middleware: ['auth'], layout: 'sistema', requiredAccess: 'kds' })
useHead({ title: 'Cocina - Aviva Check' })

// --- State ---
const orders = ref<OrderWithItems[]>([])
const loading = ref(false)
const realtimeConnected = ref(false)
const now = ref(Date.now())
let timerInterval: any = null
let ordersPollingInterval: any = null
let ordersChannel: any = null

const authStore = useAuthStore()


// Tabs
const activeTab = ref('pending')

// Rejection Dialog
const rejectDialog = ref(false)
const rejectingOrder = ref<OrderWithItems | null>(null)
const rejectReason = ref('')
const rejectNotes = ref('')
const rejecting = ref(false)
const rejectReasons = [
  'Ingrediente agotado',
  'Cliente no recogió',
  'Error de pedido',
  'Pedido duplicado',
  'Otro'
]

const { $supabase } = useNuxtApp() as any
const supabaseDetected = computed(() => !!$supabase && typeof $supabase.from === 'function')

// --- Mock Data ---
const mockOrders: OrderWithItems[] = [
  {
    id: '123e4567-e89b-12d3-a456-426614174000',
    created_at: new Date(Date.now() - 1000 * 60 * 2).toISOString(),
    status: 'pending',
    operational_status: 'pending',
    total: 100,
    items: [
      { product_id: 'p1', name: 'Tacos de Bistec', price: 25, quantity: 2, subtotal: 50 },
      { product_id: 'p2', name: 'Coca Cola', price: 35, quantity: 1, subtotal: 35 },
    ]
  },
  {
    id: '123e4567-e89b-12d3-a456-426614174001',
    created_at: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
    status: 'pending',
    operational_status: 'pending',
    total: 80,
    items: [
      { product_id: 'p3', name: 'Hamburguesa Sencilla', price: 85, quantity: 1, subtotal: 85 },
    ]
  },
  {
    id: '123e4567-e89b-12d3-a456-426614174002',
    created_at: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
    status: 'pending',
    operational_status: 'pending',
    total: 80,
    items: [
      { product_id: 'p4', name: 'Orden de Tacos', price: 110, quantity: 2, subtotal: 220 },
    ]
  }
]

// --- Computed ---
const pendingOrders = computed(() => {
  return orders.value
    .filter(o => o.operational_status === 'pending')
    .sort((a, b) => {
      const tA = a.created_at ? new Date(a.created_at).getTime() : 0
      const tB = b.created_at ? new Date(b.created_at).getTime() : 0
      return tA - tB
    })
})

const deliveredOrders = computed(() => {
  return orders.value
    .filter(o => o.operational_status === 'completed')
    .sort((a, b) => {
      const tA = a.created_at ? new Date(a.created_at).getTime() : 0
      const tB = b.created_at ? new Date(b.created_at).getTime() : 0
      return tB - tA // Most recent first
    })
    .slice(0, 50) // Limit history
})

const rejectedOrders = computed(() => {
  return orders.value
    .filter(o => o.operational_status === 'kitchen_rejected' || o.operational_status === 'kitchen_cancelled')
    .sort((a, b) => {
      const tA = a.created_at ? new Date(a.created_at).getTime() : 0
      const tB = b.created_at ? new Date(b.created_at).getTime() : 0
      return tB - tA
    })
    .slice(0, 50)
})

// --- Methods ---
function shortId(uuid: any) {
  if (!uuid) return '????'
  const str = String(uuid)
  // Si es UUID, tomamos primeros 4 (estilo A3F1)
  if (str.includes('-')) return str.split('-')[0].slice(0, 4).toUpperCase()
  // Si es numérico u otro, tomamos últimos 4
  return str.slice(-4).toUpperCase()
}

function formatTime(iso: any) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return '—'
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch { return '—' }
}

function getElapsedMinutes(iso: any) {
  if (!iso) return 0
  try {
    const t = new Date(iso).getTime()
    if (isNaN(t)) return 0
    // Use Math.max to avoid negative numbers if clocks sync weirdly
    return Math.max(0, Math.floor((now.value - t) / 60000))
  } catch { return 0 }
}

function getUrgencyColor(iso: any, opStatus?: string) {
  if (opStatus === 'kitchen_cancelled') return 'grey'
  const min = getElapsedMinutes(iso)
  if (min < 5) return 'success'
  if (min < 10) return 'warning'
  return 'error'
}

function getUrgencyClass(iso: any, opStatus?: string) {
  if (opStatus === 'kitchen_cancelled') return 'border-cancelled opacity-50'
  
  const min = getElapsedMinutes(iso)
  if (min < 5) return 'border-normal'
  if (min < 10) return 'border-warning'
  return 'border-critical animate-pulse'
}

const money = (val: number) => formatMoney(val || 0)

function currentDepartmentOwnerId() {
  const profile = authStore.profile
  if (!profile) return null
  if (profile.role === 'pastor' || profile.role === 'leader' || profile.role === 'super_admin') return profile.id
  return profile.owner_id || null
}

function shouldFilterByDepartment() {
  const role = authStore.profile?.role
  return role !== 'pastor' && role !== 'super_admin'
}

// --- Logic ---
async function loadOrders() {
  if (!supabaseDetected.value) {
    orders.value = mockOrders
    return
  }

  const orgId = authStore.profile?.org_id
  if (!orgId) return

  loading.value = true
  try {
    let query = $supabase
      .from('orders')
      .select('*, items:order_items(*)')
      .eq('org_id', orgId)
      .in('operational_status', ['pending', 'completed', 'kitchen_rejected', 'kitchen_cancelled']) 
      .order('created_at', { ascending: false })
      .limit(200)

    const deptOwnerId = currentDepartmentOwnerId()
    if (shouldFilterByDepartment() && deptOwnerId) {
      query = query.eq('department_owner_id', deptOwnerId)
    }

    const { data, error } = await query
    
    if (error) throw error
    
    // SANITIZATION: Protect against nulls to prevent v-for crashes
    if (data) {
       orders.value = data.map((o: any) => ({
         ...o,
         id: o.id || 'unknown-id',
         items: Array.isArray(o.items) ? o.items : [], // Validate array
         created_at: o.created_at || new Date().toISOString()
       }))
    }
  } catch (e) {
    console.error('Error loading orders:', e)
  } finally {
    loading.value = false
  }
}

async function markDelivered(order: OrderWithItems) {
  if (!order?.id) return
  
  // Optimistic update - change status instead of removing
  const orderRef = orders.value.find(o => o.id === order.id)
  let prevOpStatus: any = null
  let prevStatus: any = null
  
  if (orderRef) {
    prevOpStatus = orderRef.operational_status
    prevStatus = orderRef.status
    orderRef.operational_status = 'completed'
    orderRef.status = 'completed'
  }

  if (!supabaseDetected.value) return

  try {
    const { error } = await $supabase.rpc('update_kitchen_status', { 
      p_order_id: order.id, 
      p_new_status: 'completed' 
    })
    
    if (error) throw error
  } catch (e) {
    console.error('Error completing order:', e)
    if (orderRef) {
      orderRef.operational_status = prevOpStatus
      orderRef.status = prevStatus
    }
    alert('Error al completar orden')
  }
}

async function cancelOrder(order: OrderWithItems) {
  if (!confirm('¿Seguro que deseas CANCELAR esta orden?')) return

  if (!supabaseDetected.value) return
  
  // Optimistic update
  const orderRef = orders.value.find(o => o.id === order.id)
  let prevOpStatus: any = null
  let prevStatus: any = null
  
  if (orderRef) {
    prevOpStatus = orderRef.operational_status
    prevStatus = orderRef.status
    orderRef.operational_status = 'kitchen_cancelled'
    orderRef.status = 'cancelled'
  }

  try {
    const { error } = await $supabase.rpc('update_kitchen_status', { 
      p_order_id: order.id, 
      p_new_status: 'kitchen_cancelled' 
    })
    
    if (error) throw error
  } catch (e) {
    console.error('Error resetting order:', e)
    alert('Error al cancelar')
    if (orderRef) {
      orderRef.operational_status = prevOpStatus
      orderRef.status = prevStatus
    }
  }
}

function openRejectDialog(order: OrderWithItems) {
  rejectingOrder.value = order
  rejectReason.value = ''
  rejectNotes.value = ''
  rejectDialog.value = true
}

async function confirmReject() {
  if (!rejectingOrder.value?.id) return
  
  rejecting.value = true
  const fullReason = rejectNotes.value 
    ? `${rejectReason.value}: ${rejectNotes.value}` 
    : rejectReason.value

  // Optimistic update
  const orderRef = orders.value.find(o => o.id === rejectingOrder.value?.id)
  let prevOpStatus: any = null
  let prevStatus: any = null
  let prevReason: any = null

  if (orderRef) {
    prevOpStatus = orderRef.operational_status
    prevStatus = orderRef.status
    prevReason = orderRef.rejection_reason
    orderRef.operational_status = 'kitchen_rejected'
    orderRef.status = 'rejected'
    orderRef.rejection_reason = fullReason
  }

  if (supabaseDetected.value) {
    try {
      const { error } = await $supabase.rpc('update_kitchen_status', {
        p_order_id: rejectingOrder.value.id,
        p_new_status: 'kitchen_rejected',
        p_reason: fullReason
      })
      
      if (error) throw error
    } catch (e) {
      console.error('Error rejecting order:', e)
      alert('Error al rechazar orden')
      if (orderRef) {
        orderRef.operational_status = prevOpStatus
        orderRef.status = prevStatus
        orderRef.rejection_reason = prevReason
      }
    }
  }

  rejecting.value = false
  rejectDialog.value = false
  rejectingOrder.value = null
}

// --- Realtime Channel Init (tenant-isolated) ---
function initRealtimeChannel() {
  // Guard: no abrir canal sin org_id o sin Supabase
  const orgId = authStore.profile?.org_id
  if (!orgId || !supabaseDetected.value) return
  const deptOwnerId = currentDepartmentOwnerId()
  const channelFilter = shouldFilterByDepartment() && deptOwnerId
    ? `department_owner_id=eq.${deptOwnerId}`
    : `org_id=eq.${orgId}`

  // Si ya hay un canal activo, limpiarlo primero
  if (ordersChannel) {
    $supabase.removeChannel(ordersChannel)
    ordersChannel = null
    realtimeConnected.value = false
  }

  // Suscripción filtrada por tenant: solo eventos de ESTA organización
  ordersChannel = $supabase.channel(`kds:orders:${orgId}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'orders',
      filter: channelFilter
    }, () => loadOrders())
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'orders',
      filter: channelFilter
    }, () => loadOrders())
    .subscribe((status: any) => {
      realtimeConnected.value = status === 'SUBSCRIBED'
    })
}

// --- Lifecycle ---
onMounted(() => {
  loadOrders()

  // Timer update every 10s to refresh "minutes ago"
  timerInterval = setInterval(() => {
    now.value = Date.now()
  }, 10000)

  // Realtime is the fast path, but KDS must keep working if a websocket event
  // is missed or the table is not published to Realtime in an environment.
  ordersPollingInterval = setInterval(() => {
    if (!loading.value) loadOrders()
  }, 3000)

  // Intentar inicializar canal si org_id ya está disponible
  initRealtimeChannel()
})

// Watcher: si el perfil carga DESPUÉS de onMounted (race condition),
// inicializar el canal en el momento en que org_id esté disponible.
authStore.$subscribe((_mutation, state) => {
  const orgId = (state as any).profile?.org_id
  if (orgId && !ordersChannel) {
    initRealtimeChannel()
  }
})

onBeforeUnmount(() => {
  if (timerInterval) clearInterval(timerInterval)
  if (ordersPollingInterval) clearInterval(ordersPollingInterval)
  if (ordersChannel) {
    $supabase.removeChannel(ordersChannel)
    ordersChannel = null
  }
})
</script>

<style scoped>
.order-card {
  transition: all 0.3s ease;
  border-width: 2px !important;
}

.border-normal {
  border-color: #4CAF50 !important; /* Green */
}

.border-warning {
  border-color: #FFC107 !important; /* Amber */
  box-shadow: 0 0 10px rgba(255, 193, 7, 0.2);
}

.border-critical {
  border-color: #FF5252 !important; /* Red */
  box-shadow: 0 0 15px rgba(255, 82, 82, 0.4);
}

@keyframes pulse-border {
  0% { box-shadow: 0 0 0 0 rgba(255, 82, 82, 0.7); }
  70% { box-shadow: 0 0 0 10px rgba(255, 82, 82, 0); }
  100% { box-shadow: 0 0 0 0 rgba(255, 82, 82, 0); }
}

.animate-pulse {
  animation: pulse-border 2s infinite;
}

.border-cancelled {
  border-color: #9E9E9E !important;
  filter: grayscale(1);
}
</style>
