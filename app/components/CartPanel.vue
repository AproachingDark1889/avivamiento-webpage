<template>
  <div class="d-flex flex-column h-100">
    <div class="pa-4 border-b d-flex align-center bg-surface">
      <v-icon icon="mdi-receipt-text" color="primary" class="mr-2" />
      <span class="text-h6 font-weight-black text-primary">Ticket de Venta</span>
      <v-spacer />
      <v-btn
        v-if="isMobile"
        icon="mdi-close"
        variant="text"
        density="comfortable"
        @click="$emit('close')"
      />
      <v-btn
        v-else
        variant="text"
        color="error"
        size="small"
        prepend-icon="mdi-delete"
        @click="pos.clearCart()"
        :disabled="pos.cart.length === 0 || loading"
      >
        Limpiar
      </v-btn>
    </div>

    <div class="flex-grow-1 overflow-y-auto pa-2" v-if="pos.cart.length > 0">
      <v-list lines="two" density="compact" class="bg-transparent">
        <v-slide-y-transition group>
          <v-card
            v-for="(item, index) in pos.cart"
            :key="item.product_id + '-' + index"
            elevation="0"
            border
            rounded="lg"
            class="mb-2"
          >
            <div class="d-flex align-center pa-2">
              <v-avatar color="primary" variant="tonal" rounded="lg" size="40" class="mr-3 font-weight-bold">
                {{ item.quantity }}x
              </v-avatar>
              
              <div class="flex-grow-1" style="min-width: 0;">
                <div class="font-weight-bold text-body-2 text-truncate">
                  {{ item.name }}
                </div>
                <div class="text-caption text-medium-emphasis">
                  {{ money(item.price) }} c/u
                </div>
              </div>

              <div class="text-right ml-2">
                <div class="font-weight-black text-body-1">
                  {{ money(item.price * item.quantity) }}
                </div>
                <!-- Controls -->
                <div class="d-flex align-center mt-1">
                  <v-btn
                    icon="mdi-minus"
                    size="x-small"
                    variant="tonal"
                    color="error"
                    class="mr-1"
                    @click="pos.removeFromCart(item.product_id)"
                    :disabled="loading"
                  />
                  <v-btn
                    icon="mdi-plus"
                    size="x-small"
                    variant="tonal"
                    color="success"
                    @click="pos.addToCart({ id: item.product_id, name: item.name, price: item.price })"
                    :disabled="loading"
                  />
                </div>
              </div>
            </div>
          </v-card>
        </v-slide-y-transition>
      </v-list>
    </div>

    <div v-else class="flex-grow-1 d-flex flex-column align-center justify-center text-medium-emphasis pa-8 text-center op-50">
      <v-icon icon="mdi-cart-outline" size="64" class="mb-4 text-disabled" />
      <div class="text-h6 font-weight-bold">Carrito Vacío</div>
      <div class="text-body-2">Agrega productos del menú para comenzar una orden.</div>
    </div>

    <div class="pa-4 bg-surface border-t mt-auto">
      <div class="d-flex align-center justify-space-between mb-4">
        <span class="text-body-1 font-weight-medium text-medium-emphasis">Total a Pagar</span>
        <span class="text-h4 font-weight-black text-primary">{{ money(pos.total) }}</span>
      </div>

      <v-btn
        block
        color="secondary"
        size="x-large"
        rounded="lg"
        elevation="2"
        :disabled="pos.cart.length === 0 || loading"
        @click="pos.showPayment = true"
        class="font-weight-black"
        style="font-size: 1.25rem;"
      >
        <v-icon start class="mr-2">mdi-cash-multiple</v-icon>
        COBRAR
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { formatMoney } from '../utils/format'

const props = defineProps<{
  pos: any
  loading: boolean
  isMobile?: boolean
}>()

defineEmits(['close'])

const money = formatMoney
</script>
