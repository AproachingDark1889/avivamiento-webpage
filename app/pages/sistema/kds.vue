<template>
  <div class="pa-4 h-100 d-flex flex-column">
    <div class="d-flex align-center mb-4">
      <div>
        <h1 class="text-h4 font-weight-black text-primary">
          <v-icon start size="36">mdi-chef-hat</v-icon>Cocina (KDS)
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

    <div v-if="pendingOrders.length === 0" class="flex-grow-1 d-flex flex-column align-center justify-center text-medium-emphasis op-50 pt-16">
      <v-icon icon="mdi-checkbox-marked-circle-outline" size="120" color="success" style="opacity: 0.2;" />
      <div class="text-h4 font-weight-black mt-4 text-disabled">Todo listo</div>
      <div class="text-h6 font-weight-medium text-disabled">No hay órdenes pendientes</div>
    </div>

    <v-row v-else class="flex-grow-1 overflow-y-auto align-content-start">
      <v-col
        v-for="o in pendingOrders"
        :key="o.id"
        cols="12"
        sm="6"
        md="4"
        lg="3"
      >
        <v-card
          elevation="3"
          rounded="xl"
          :class="['h-100 d-flex flex-column order-card', getUrgencyClass(o.created_at)]"
          border
        >
          <!-- Header TICKET -->
          <div class="pa-3 d-flex align-center justify-space-between bg-surface border-b">
            <div>
              <div class="text-h6 font-weight-black lh-1" style="font-family: monospace;">
                #{{ shortId(o.id) }}
              </div>
              <div class="text-caption font-weight-bold text-medium-emphasis">
                {{ formatTime(o.created_at) }}
              </div>
            </div>
            <v-chip
              size="small"
              :color="getUrgencyColor(o.created_at)"
              variant="flat"
              class="font-weight-black text-white"
            >
              {{ getElapsedMinutes(o.created_at) }} min
            </v-chip>
          </div>

          <!-- Items -->
          <v-card-text class="pa-0 flex-grow-1 bg-white">
            <v-list density="compact" class="py-2">
              <v-list-item
                v-for="item in (o.items ?? [])"
                :key="item.id || (item.product_id + '-' + item.name)"
                lines="one"
              >
                <template #prepend>
                   <v-avatar color="grey-lighten-4" class="font-weight-black text-body-1" rounded="lg" size="32">
                     {{ item.quantity }}
                   </v-avatar>
                </template>
                <v-list-item-title class="font-weight-bold text-body-1 ml-2" style="white-space: normal;">
                  {{ item.name }}
                </v-list-item-title>
                <!-- Opcional: mostrar subnotas o extras aqui -->
              </v-list-item>
            </v-list>
          </v-card-text>

          <!-- Footer ACTION -->
          <div class="pa-2 bg-surface border-t mt-auto">
             <v-btn
               block
               color="success"
               height="56"
               rounded="lg"
               elevation="2"
               class="font-weight-black text-h6"
               prepend-icon="mdi-check-circle"
               @click="markDelivered(o)"
             >
               ENTREGAR
             </v-btn>
          </div>
        </v-card>
      </v-col>
    </v-row>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import type { Order, OrderItem, OrderWithItems } from '../../types'

definePageMeta({ middleware: ['auth'], layout: 'sistema' })
useHead({ title: 'Cocina (KDS) - Aviva Check' })

// --- State ---
const orders = ref<OrderWithItems[]>([]) // Use imported OrderWithItems, ensure import below
const loading = ref(false)
const realtimeConnected = ref(false)
const now = ref(Date.now())
let timerInterval: any = null
let ordersChannel: any = null // Save channel

const { $supabase } = useNuxtApp() as any
const supabaseDetected = computed(() => !!$supabase && typeof $supabase.from === 'function')

// --- Mock Data ---
const mockOrders: OrderWithItems[] = [
  {
    id: '123e4567-e89b-12d3-a456-426614174000',
    created_at: new Date(Date.now() - 1000 * 60 * 2).toISOString(), // 2 min ago
    status: 'pending',
    total: 100,
    items: [
      { product_id: 'p1', name: 'Tacos de Bistec', price: 25, quantity: 2, subtotal: 50 },
      { product_id: 'p2', name: 'Coca Cola', price: 35, quantity: 1, subtotal: 35 },
    ]
  },
  {
    id: '123e4567-e89b-12d3-a456-426614174001',
    created_at: new Date(Date.now() - 1000 * 60 * 8).toISOString(), // 8 min ago
    status: 'pending',
    total: 80,
    items: [
      { product_id: 'p3', name: 'Hamburguesa Sencilla', price: 85, quantity: 1, subtotal: 85 },
    ]
  },
    {
    id: '123e4567-e89b-12d3-a456-426614174002',
    created_at: new Date(Date.now() - 1000 * 60 * 15).toISOString(), // 15 min ago (Crítico)
    status: 'pending',
    total: 80,
    items: [
      { product_id: 'p4', name: 'Orden de Tacos', price: 110, quantity: 2, subtotal: 220 },
    ]
  }
]

// --- Computed ---
const pendingOrders = computed(() => {
  return orders.value
    // Filter uses aligned types
    .filter(o => o.status === 'pending' || o.status === 'progress' || o.status === 'in_progress')
    .sort((a, b) => {
      const tA = a.created_at ? new Date(a.created_at).getTime() : 0
      const tB = b.created_at ? new Date(b.created_at).getTime() : 0
      return tA - tB // FIFO
    })
})

// --- Methods ---
function shortId(uuid: any) {
  if (!uuid || typeof uuid !== 'string') return '????'
  return uuid.split('-')[0].slice(0, 4).toUpperCase()
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

function getUrgencyColor(iso: any) {
  const min = getElapsedMinutes(iso)
  if (min < 5) return 'success'
  if (min < 10) return 'warning'
  return 'error'
}

function getUrgencyClass(iso: any) {
  const min = getElapsedMinutes(iso)
  if (min < 5) return 'border-normal'
  if (min < 10) return 'border-warning'
  return 'border-critical animate-pulse'
}

function money(val: number) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(val || 0)
}

// --- Logic ---
async function loadOrders() {
  if (!supabaseDetected.value) {
    orders.value = mockOrders
    return
  }

  loading.value = true
  try {
    // Force Fetch FRESH data
    const { data, error } = await $supabase
      .from('orders')
      .select('*, items:order_items(*)')
      .in('status', ['pending', 'progress', 'in_progress']) 
      .order('created_at', { ascending: true })
    
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
  
  // Optimistic update
  const original = orders.value
  orders.value = orders.value.filter(o => o.id !== order.id)

  if (!supabaseDetected.value) return // Mock mode

  try {
    const { error } = await $supabase
      .from('orders')
      .update({ status: 'completed' })
      .eq('id', order.id)
    
    if (error) throw error
  } catch (e) {
    console.error('Error completing order:', e)
    orders.value = original // Revert
    alert('Error al completar orden')
  }
}

// --- Lifecycle ---
onMounted(() => {
  loadOrders()
  
  // Timer update every 10s to refresh "minutes ago"
  timerInterval = setInterval(() => {
    now.value = Date.now()
  }, 10000)

  if (supabaseDetected.value) {
    // Realtime subscription - Listen only to UPDATE to avoid race condition (waiting for items)
    ordersChannel = $supabase.channel('public:orders')
      // .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, () => loadOrders()) // Removed to fix race
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, () => loadOrders())
      .subscribe((status: any) => {
        realtimeConnected.value = status === 'SUBSCRIBED'
      })
  }
})

onBeforeUnmount(() => {
  if (timerInterval) clearInterval(timerInterval)
  if (ordersChannel) $supabase.removeChannel(ordersChannel)
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
</style>
