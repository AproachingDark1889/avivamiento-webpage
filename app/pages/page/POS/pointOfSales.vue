<template>
  <div class="h-100 d-flex flex-column">
    <v-container fluid class="flex-grow-1 pa-2 pa-md-4">
      <v-row class="fill-height">
        <!-- SECCIÓN PRODUCTOS -->
        <v-col cols="12" md="8" lg="9" class="d-flex flex-column h-screen-mobile h-100 overflow-hidden">
          <div class="flex-shrink-0">
            <div class="d-flex align-center mb-4">
              <h1 class="text-h5 font-weight-black text-primary">
                <v-icon start>mdi-grid</v-icon>Caja
              </h1>
              <v-spacer />
              <v-chip color="secondary" variant="flat" class="font-weight-bold text-primary">
                <v-icon start size="small">mdi-database</v-icon> {{ products.length }} Items
              </v-chip>
            </div>

            <!-- Filtros -->
            <v-row class="mb-2">
              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="search"
                  prepend-inner-icon="mdi-magnify"
                  label="Buscar producto..."
                  variant="outlined"
                  density="compact"
                  hide-details
                  rounded="lg"
                  bg-color="white"
                />
              </v-col>
              <v-col cols="12" sm="6">
                <v-select
                  v-model="category"
                  :items="PRODUCT_CATEGORIES"
                  item-title="title"
                  item-value="value"
                  prepend-inner-icon="mdi-filter"
                  label="Categoría"
                  variant="outlined"
                  density="compact"
                  hide-details
                  rounded="lg"
                  bg-color="white"
                  clearable
                />
              </v-col>
            </v-row>
            
            <v-alert
              v-if="products.length === 0 && !productsStore.loading"
              type="info"
              variant="tonal"
              class="mb-4"
            >
              <strong>Catálogo Vacío:</strong> No hay productos activos. Pide a un líder que registre productos en el menú de gestión.
            </v-alert>
            <v-alert
              v-if="!supabaseDetected"
              class="mb-4"
              type="warning"
              variant="tonal"
              density="compact"
              closable
            >
              <strong>Modo Offline:</strong> No se detectó conexión a Supabase.
            </v-alert>
            <v-alert
              v-else-if="pos.cashSession"
              class="mb-4"
              type="success"
              variant="tonal"
              density="compact"
            >
              <strong>Caja abierta:</strong>
              {{ cashSessionModeLabel }} - Fondo inicial {{ money(pos.cashSession.opening_cash) }}
            </v-alert>
            <v-alert
              v-else-if="cashSessionChecked"
              class="mb-4"
              type="warning"
              variant="tonal"
              density="compact"
            >
              <strong>Caja cerrada:</strong> abre caja para habilitar cobros.
            </v-alert>

            <v-btn-toggle
              v-if="cashModeOptions.length > 1"
              :model-value="pos.selectedCashMode"
              color="primary"
              mandatory
              density="compact"
              rounded="lg"
              class="mb-4"
              @update:model-value="selectCashMode"
            >
              <v-btn
                v-for="option in cashModeOptions"
                :key="option.value"
                :value="option.value"
              >
                <v-icon start>{{ option.icon }}</v-icon>
                {{ option.label }}
              </v-btn>
            </v-btn-toggle>
          </div>

          <!-- Grid Scrollable -->
          <div class="flex-grow-1 overflow-y-auto">
            <v-row>
              <v-col
                v-for="p in products"
                :key="p.id"
                cols="6"
                sm="4"
                md="4"
                lg="3"
              >
                <ProductCard :product="p" @add="handleAddToCart(p)" />
              </v-col>
            </v-row>
            <!-- Espacio extra abajo para que el FAB no tape el último producto en móvil -->
            <div class="d-md-none" style="height: 100px;"></div>
          </div>
        </v-col>

        <!-- SECCIÓN TICKET (DESKTOP) -->
        <v-col cols="12" md="4" lg="3" class="d-none d-md-flex flex-column h-100 bg-white border-s">
          <CartPanel :pos="pos" :loading="pos.loading" />
        </v-col>
      </v-row>
    </v-container>

    <!-- FAB CARRITO (MÓVIL) -->
    <v-fab-transition>
      <v-badge
        v-if="!cartDrawer && pos.cart.length > 0"
        :content="pos.cart.reduce((sum, item) => sum + item.quantity, 0)"
        color="error"
        class="d-md-none position-fixed"
        style="bottom: 80px; right: 20px; z-index: 99;"
      >
        <v-btn
          color="secondary"
          icon="mdi-cart"
          size="x-large"
          elevation="4"
          @click="cartDrawer = true"
        ></v-btn>
      </v-badge>
    </v-fab-transition>

    <!-- DRAWER CARRITO (MÓVIL) -->
    <v-navigation-drawer
      v-model="cartDrawer"
      location="right"
      temporary
      width="350"
      class="d-md-none"
    >
      <CartPanel :pos="pos" :loading="pos.loading" :is-mobile="true" @close="cartDrawer = false" />
    </v-navigation-drawer>

    <!-- Payment Dialog -->
    <v-dialog v-model="pos.showPayment" max-width="450" persistent>
      <v-card rounded="xl" elevation="3">
        <v-card-title class="d-flex align-center pa-4 bg-primary text-white">
          <v-icon start>mdi-cash-register</v-icon>
          <span class="text-h6 font-weight-bold">Confirmar Pago</span>
          <v-spacer />
          <v-btn icon="mdi-close" variant="text" size="small" @click="pos.showPayment = false" />
        </v-card-title>
        
        <v-card-text class="pa-4 pt-6">
          <div class="text-center mb-6">
            <div class="text-subtitle-1 text-medium-emphasis mb-1">Total a Pagar</div>
            <div class="text-h3 font-weight-black text-primary">{{ money(pos.total) }}</div>
          </div>

          <!-- MÉTODOS DE PAGO -->
          <v-btn-toggle
            v-model="paymentMethod"
            mandatory
            rounded="xl"
            color="primary"
            class="d-flex w-100 mb-6 border"
            density="comfortable"
          >
            <v-btn value="cash" class="flex-grow-1">
              <v-icon start>mdi-cash</v-icon> Efectivo
            </v-btn>
            <v-btn value="transfer" class="flex-grow-1">
              <v-icon start>mdi-bank-transfer</v-icon> Transf.
            </v-btn>
            <v-btn value="card" class="flex-grow-1">
              <v-icon start>mdi-credit-card</v-icon> Tarjeta
            </v-btn>
          </v-btn-toggle>

          <v-expand-transition>
            <div v-if="paymentMethod === 'cash'">
              <v-text-field
                v-model="paidWithInput"
                label="Efectivo Recibido"
                prepend-inner-icon="mdi-cash"
                variant="outlined"
                type="number"
                inputmode="decimal"
                autofocus
                class="mb-2"
                rounded="lg"
                :rules="[v => (Number(v) >= pos.total) || 'Monto insuficiente']"
              />

              <v-card variant="tonal" class="pa-3 mb-4" :color="change >= 0 ? 'success' : 'error'">
                <div class="d-flex justify-space-between align-center">
                  <span class="font-weight-bold">Cambio:</span>
                  <span class="text-h5 font-weight-black">{{ money(change) }}</span>
                </div>
              </v-card>
            </div>
          </v-expand-transition>

          <div v-if="paymentMethod !== 'cash'" class="text-center text-medium-emphasis mb-4">
            <v-icon size="48" class="mb-2">mdi-check-circle-outline</v-icon>
            <div>Confirma que el pago ha sido realizado.</div>
          </div>

        </v-card-text>

        <v-card-actions class="pa-4 pt-0">
          <v-btn
            block
            color="success"
            size="x-large"
            rounded="lg"
            elevation="2"
            :loading="pos.loading"
            @click="procesarCobro"
          >
            <v-icon start>mdi-check-circle-outline</v-icon>
            CONFIRMAR PAGO
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog :model-value="cashSessionDialog" max-width="460" persistent>
      <v-card rounded="xl" elevation="3">
        <v-card-title class="d-flex align-center pa-4 bg-primary text-white">
          <v-icon start>mdi-safe</v-icon>
          <span class="text-h6 font-weight-bold">Apertura de Caja</span>
        </v-card-title>

        <v-card-text class="pa-4 pt-6">
          <v-alert
            v-if="cashSessionError || pos.cashSessionWarning"
            type="warning"
            variant="tonal"
            density="compact"
            class="mb-4"
          >
            {{ cashSessionError || pos.cashSessionWarning }}
          </v-alert>

          <div class="text-body-2 text-medium-emphasis mb-4">
            Registra el fondo inicial para abrir la caja de este turno.
          </div>

          <v-btn-toggle
            v-if="cashModeOptions.length > 1"
            :model-value="pos.selectedCashMode"
            color="primary"
            mandatory
            density="compact"
            rounded="lg"
            class="mb-4"
            @update:model-value="selectCashMode"
          >
            <v-btn
              v-for="option in cashModeOptions"
              :key="option.value"
              :value="option.value"
            >
              <v-icon start>{{ option.icon }}</v-icon>
              {{ option.label }}
            </v-btn>
          </v-btn-toggle>

          <v-text-field
            v-model="openingSessionCashInput"
            label="Fondo inicial"
            type="number"
            inputmode="decimal"
            variant="outlined"
            prepend-inner-icon="mdi-cash"
            rounded="lg"
            autofocus
          />
        </v-card-text>

        <v-card-actions class="pa-4 pt-0">
          <v-btn
            block
            color="success"
            size="large"
            rounded="lg"
            :loading="pos.cashSessionLoading"
            @click="openCashSession"
          >
            <v-icon start>mdi-lock-open-variant</v-icon>
            Abrir Caja
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { usePosStore } from '../../../stores/pos'
import { useProductsStore } from '../../../stores/products'
import { useAuthStore } from '../../../stores/auth'
import { useToast } from '../../../composables/useToast'
import { useSupabase } from '../../../composables/useSupabase'
import { PRODUCT_CATEGORIES } from '../../../utils/categories'
import { formatMoney } from '../../../utils/format'
import type { Product, CashSessionMode } from '../../../types'
import CartPanel from '../../../components/CartPanel.vue' 
import ProductCard from '../../../components/ProductCard.vue'

definePageMeta({ middleware: ['auth'], layout: 'sistema', requiredAccess: 'pos' })
useHead({ title: 'Caja - Aviva Check' })

const pos = usePosStore()
const productsStore = useProductsStore()
const auth = useAuthStore()
const toast = useToast()

const cartDrawer = ref(false)
const paidWithInput = ref('')
const paymentMethod = ref('cash') 
const openingSessionCashInput = ref('0')
const cashSessionChecked = ref(false)
const cashSessionError = ref('')

// Filters
const search = ref('')
const category = ref<string | null>(null)

const paidWith = computed(() => Number(paidWithInput.value || 0))
const change = computed(() => paidWith.value - pos.total)
const cashModeOptions = computed(() => {
  const options = [
    { value: 'shared' as CashSessionMode, label: 'Caja general', icon: 'mdi-cash-register' },
  ]

  if (auth.profile?.role === 'cashier' && auth.profile?.independent_cash_register) {
    options.push({ value: 'independent' as CashSessionMode, label: 'Caja independiente', icon: 'mdi-safe' })
  }

  return options
})

// Products from Store (Filtered)
const products = computed(() => {
  let list = productsStore.activeItems
  
  if (category.value) {
    list = list.filter(p => (p.category ?? 'other') === category.value)
  }
  
  const q = search.value.trim().toLowerCase()
  if (q) {
    list = list.filter(p => p.name.toLowerCase().includes(q))
  }
  
  return list
})

onMounted(async () => {
  pos.initFromStorage()
  // Ensure we have auth profile to load products
  if (!auth.profile) await auth.refreshProfile()
  pos.setCashMode(auth.profile?.role === 'cashier' && auth.profile?.independent_cash_register ? 'independent' : 'shared')
  try {
    await pos.loadCurrentCashSession(pos.selectedCashMode)
  } catch (e: any) {
    cashSessionError.value = e?.message ?? String(e)
  } finally {
    cashSessionChecked.value = true
  }
  await productsStore.load({ includeInactive: false })
})

const money = formatMoney

function handleAddToCart(product: Product) {
  try {
    if (supabaseDetected.value && !pos.cashSession) {
      toast.info('Abre caja antes de agregar productos.')
      return
    }
    pos.addToCart(product)
  } catch (e) {
    console.error(e)
    toast.error('Error al agregar producto')
  }
}

function getSupabase() {
  try { return useSupabase() } catch { return null }
}

const supabaseDetected = computed(() => {
  const sb = getSupabase()
  return !!sb && typeof sb.from === 'function'
})
const cashSessionDialog = computed(() => supabaseDetected.value && cashSessionChecked.value && !pos.cashSession)
const cashSessionModeLabel = computed(() => {
  if (!pos.cashSession) return pos.selectedCashMode === 'independent' ? 'Caja independiente' : 'Caja general'
  return pos.cashSession.mode === 'independent' ? 'Caja independiente' : 'Caja compartida'
})

const cart = computed(() => pos.cart)

// FUNCIÓN BLINDADA DE COBRO
const procesarCobro = async () => {
  if (pos.cart.length === 0) return

  if (supabaseDetected.value && !pos.cashSession) {
    toast.info('Abre caja antes de cobrar.')
    return
  }

  if (paymentMethod.value === 'cash' && paidWith.value < pos.total) {
    if (toast) toast.error('Monto insuficiente')
    else alert('Monto insuficiente')
    return
  }

  try {
    const paid = paymentMethod.value === 'cash' ? paidWith.value : pos.total
    const changeVal = paymentMethod.value === 'cash' ? change.value : 0

    await pos.checkout(paid, changeVal, paymentMethod.value)
    
    if (toast) {
       toast.success('¡Venta registrada correctamente!')
    } else {
       alert('¡Venta registrada!')
    }

    paidWithInput.value = ''
    paymentMethod.value = 'cash'
  } catch (err: any) {
    console.error(err)
    if (toast) {
       toast.error('Error al guardar venta: ' + (err?.message || 'Desconocido'))
    } 
    alert('ERROR: ' + (err?.message || JSON.stringify(err)))
  }
};

async function openCashSession() {
  cashSessionError.value = ''
  const openingCash = Number(openingSessionCashInput.value || 0)
  if (!Number.isFinite(openingCash) || openingCash < 0) {
    cashSessionError.value = 'Fondo inicial invalido.'
    return
  }

  try {
    await pos.openCashSession(openingCash, pos.selectedCashMode)
    toast.success('Caja abierta correctamente')
  } catch (e: any) {
    cashSessionError.value = e?.message ?? String(e)
    toast.error('Error al abrir caja')
  }
}

async function selectCashMode(mode: CashSessionMode | null) {
  if (!mode || mode === pos.selectedCashMode) return

  pos.setCashMode(mode)
  cashSessionError.value = ''
  cashSessionChecked.value = false

  try {
    await pos.loadCurrentCashSession(mode)
  } catch (e: any) {
    cashSessionError.value = e?.message ?? String(e)
  } finally {
    cashSessionChecked.value = true
  }
}
</script>

<style scoped>
/* Fix para móviles donde h-100 no calcula bien con address bars dinámicas */
@media (max-width: 960px) {
  .h-screen-mobile {
    height: 85vh !important;
    height: 100dvh !important;
  }
}
</style>
