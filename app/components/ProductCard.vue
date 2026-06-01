<template>
  <v-card
    class="h-100 product-card d-flex flex-column cursor-pointer"
    :color="bgColor"
    elevation="0"
    @click="$emit('add', product)"
    v-ripple
  >
    <v-card-text class="flex-grow-1 d-flex flex-column align-center justify-center text-center pa-2">
      <v-icon
        :icon="iconName"
        size="64"
        color="rgba(0,0,0,0.5)"
        class="mb-3 mt-2"
      />
      <div class="text-body-1 font-weight-bold mb-1" style="line-height: 1.1; color: rgba(0,0,0,0.8);">
        {{ product.name }}
      </div>
      <div class="text-h5 font-weight-black text-white mt-auto pt-2" style="text-shadow: 0 2px 4px rgba(0,0,0,0.2);">
        {{ formattedPrice }}
      </div>
    </v-card-text>
    <div class="pa-2 w-100">
      <v-btn
        block
        color="rgba(255,255,255,0.9)"
        class="text-primary"
        height="40"
        elevation="0"
        @click.stop="$emit('add', product)"
      >
        <v-icon start>mdi-plus</v-icon> AGREGAR
      </v-btn>
    </div>
  </v-card>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Product } from '../types'
import { getCategoryIcon } from '../utils/categories'
import { formatMoney } from '../utils/format'

const props = defineProps<{
  product: Product
}>()

const formattedPrice = computed(() => formatMoney(props.product.price))

const bgColor = computed(() => {
  // Generar color consistente basado en el nombre
  const colors = [
    '#EF5350', // Red 400
    '#AB47BC', // Purple 400
    '#5C6BC0', // Indigo 400
    '#42A5F5', // Blue 400
    '#26A69A', // Teal 400
    '#66BB6A', // Green 400
    '#FFA726', // Orange 400
    '#FF7043', // Deep Orange 400
    '#8D6E63', // Brown 400
    '#78909C'  // Blue Grey 400
  ]
  let hash = 0
  for (let i = 0; i < props.product.name.length; i++) {
    hash = props.product.name.charCodeAt(i) + ((hash << 5) - hash)
  }
  const index = Math.abs(hash) % colors.length
  return colors[index]
})

const iconName = computed(() => {
  return getCategoryIcon(props.product.category)
})
</script>

<style scoped>
.product-card {
  transition: transform 0.1s ease-in-out;
  border: 1px solid rgba(0,0,0,0.05);
}
.product-card:active {
  transform: scale(0.95);
}
</style>
