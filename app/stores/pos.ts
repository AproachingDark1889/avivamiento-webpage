// app/stores/pos.ts
import { defineStore } from 'pinia'
import type { Product, OrderItem, Order } from '../types'

const STORAGE_KEY = 'genesis_sales_core_cart_v1'

export const usePosStore = defineStore('pos', {
  state: () => ({
    cart: [] as OrderItem[],
    loading: false,
    showPayment: false,
  }),

  getters: {
    total: (state): number =>
      state.cart.reduce((sum, item) => sum + item.price * item.quantity, 0),
  },

  actions: {
    initFromStorage() {
      if (!import.meta.client) return
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return
        const parsed = JSON.parse(raw)

        if (!Array.isArray(parsed)) return

        // Sanitiza estructura mínima para evitar romper el POS por datos corruptos
        this.cart = parsed
          .filter((x) => x && typeof x.product_id === 'string')
          .map((x) => {
            const price = Number(x.price ?? 0)
            const quantity = Math.max(1, Number(x.quantity ?? 1))
            return {
              product_id: String(x.product_id),
              name: String(x.name ?? ''),
              price,
              quantity,
              subtotal: Number(x.subtotal ?? price * quantity),
            } as OrderItem
          })
      } catch {
        // Si algo falla, arrancamos limpio
        this.cart = []
      }
    },

    persistToStorage() {
      if (!import.meta.client) return
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.cart))
      } catch {
        // Silencioso: si storage falla (modo privado, etc.), no tronamos
      }
    },

    addToCart(product: Product) {
      const pId = String(product.id)
      const found = this.cart.find((i) => i.product_id === pId)

      if (found) {
        found.quantity += 1
        found.subtotal = found.price * found.quantity
      } else {
        this.cart.push({
          product_id: pId,
          name: product.name,
          price: product.price,
          quantity: 1,
          subtotal: product.price,
        })
      }

      this.persistToStorage()
    },

    removeFromCart(productId: string) {
      const idx = this.cart.findIndex((i) => i.product_id === productId)
      if (idx === -1) return

      const item = this.cart[idx]
      if (item.quantity > 1) {
        item.quantity -= 1
        item.subtotal = item.price * item.quantity
      } else {
        this.cart.splice(idx, 1)
      }

      this.persistToStorage()
    },

    clearCart() {
      this.cart = []
      this.persistToStorage()
    },

    async checkout(paidWith: number, change: number, paymentMethod: string) {
      if (this.cart.length === 0) throw new Error('Carrito vacío')

      this.loading = true

      const nuxtApp = useNuxtApp()
      const sb = (nuxtApp.$supabase || nuxtApp.$supabaseClient) as any

      if (!sb || typeof sb.rpc !== 'function') {
        this.loading = false
        this.showPayment = false
        throw new Error('Supabase no disponible')
      }

      try {
        const { useAuthStore } = await import('./auth')
        const auth = useAuthStore()
        const autoAccept = auth.profile?.auto_accept_orders === true

        // Una sola llamada atómica. PostgreSQL valida precios, org_id y existencia.
        // Si falla cualquier paso interno, revierte TODO. Sin rollback manual.
        const { data, error } = await sb.rpc('process_checkout', {
          p_items: this.cart.map(item => ({
            product_id: item.product_id,
            quantity: item.quantity,
          })),
          p_payment_method: paymentMethod,
          p_paid_with: paidWith,
          p_change: change,
          p_auto_accept: autoAccept,
        })

        if (error) throw error

        this.clearCart()
        return data
      } catch (e) {
        console.error('❌ Error en checkout:', e)
        throw e
      } finally {
        this.loading = false
        this.showPayment = false
      }
    }
  },
})
