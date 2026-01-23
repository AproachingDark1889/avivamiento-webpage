<template>
  <div class="h-100 d-flex flex-column">
    <v-container fluid class="flex-grow-1 pa-2 pa-md-4">
      <v-row class="fill-height">
        <!-- SECCIÓN PRODUCTOS -->
        <v-col cols="12" md="8" lg="9" class="h-100 overflow-y-auto">
          <div class="d-flex align-center mb-4">
            <h1 class="text-h5 font-weight-black text-primary">
              <v-icon start>mdi-grid</v-icon>Catálogo de Productos
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
          <div class="d-md-none" style="height: 80px;"></div>
        </v-col>

        <!-- SECCIÓN TICKET (DESKTOP) -->
        <v-col cols="12" md="4" lg="3" class="d-none d-md-flex flex-column h-100 bg-white border-s">
          <CartPanel :pos="pos" :loading="pos.loading" />
        </v-col>
      </v-row>
    </v-container>

    <!-- FAB CARRITO (MÓVIL) -->
    <v-fab-transition>
      <v-btn
        v-if="!cartDrawer && pos.cart.length > 0"
        color="secondary"
        icon="mdi-cart"
        size="x-large"
        class="d-md-none position-fixed"
        style="bottom: 80px; right: 20px; z-index: 99;"
        elevation="4"
        @click="cartDrawer = true"
      ></v-btn>
    </v-fab-transition>

    <!-- DRAWER CARRITO (MÓVIL) -->
    <v-navigation-drawer
      v-model="cartDrawer"
      location="right"
      temporary
      width="350"
      class="d-md-none"
    >
      <CartPanel :pos="pos" :loading="pos.loading" />
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
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { usePosStore } from '../../stores/pos'
import { useProductsStore } from '../../stores/products'
import { useAuthStore } from '../../stores/auth'
import { useToast } from '../../composables/useToast'
import { PRODUCT_CATEGORIES } from '../../utils/categories'
import type { Product } from '../../types'
import CartPanel from '../../components/CartPanel.vue' 
import ProductCard from '../../components/ProductCard.vue'

definePageMeta({ middleware: ['auth'], layout: 'sistema' })
useHead({ title: 'Caja - Aviva Check' })

const pos = usePosStore()
const productsStore = useProductsStore()
const auth = useAuthStore()
const toast = useToast()

const cartDrawer = ref(false)
const paidWithInput = ref('')
const paymentMethod = ref('cash') 

// Filters
const search = ref('')
const category = ref<string | null>(null)

const paidWith = computed(() => Number(paidWithInput.value || 0))
const change = computed(() => paidWith.value - pos.total)

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
  await productsStore.load({ includeInactive: false })
})

const money = (val: number) => {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(val)
}

function handleAddToCart(product: Product) {
  try {
    pos.addToCart(product)
  } catch (e) {
    console.error(e)
    toast.error('Error al agregar producto')
  }
}

// Minimal definition for Supabase client
type SupabaseClientLike = { from: Function }

function getSupabase(): SupabaseClientLike | null {
  const nuxtApp = useNuxtApp() as any
  return (nuxtApp?.$supabase || nuxtApp?.$supabaseClient || null) as SupabaseClientLike | null
}

const supabaseDetected = computed(() => {
  const sb = getSupabase()
  return !!sb && typeof sb.from === 'function'
})

const cart = computed(() => pos.cart)

// FUNCIÓN BLINDADA DE COBRO
const procesarCobro = async () => {
  if (pos.cart.length === 0) return

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
</script>