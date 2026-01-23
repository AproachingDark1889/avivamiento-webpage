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
      void paymentMethod
      if (this.cart.length === 0) throw new Error('Carrito vacío')

      this.loading = true

      const nuxtApp = useNuxtApp()
      const sb = (nuxtApp.$supabase || nuxtApp.$supabaseClient) as any // Cast temporal para evitar error de tipo en NuxtApp

      if (!sb || typeof sb.from !== 'function') {
        this.loading = false
        this.showPayment = false
        throw new Error('Supabase no disponible')
      }

      const total = this.total
      let createdOrder: Order | null = null

      try {
        // 1. Insertar Orden (pending)
        const { data, error: orderError } = await sb
          .from('orders')
          .insert({
            total,
            status: 'pending',
            paid_with: paidWith,
            change,
            payment_method: paymentMethod
          })
          .select()
          .single()

        if (orderError) throw orderError
        createdOrder = data as Order

        // 2. Insertar Items
        const items = this.cart.map((item) => ({
          order_id: createdOrder!.id,
          product_id: item.product_id,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          subtotal: item.subtotal,
        }))

        const { error: itemsError } = await sb.from('order_items').insert(items)
        if (itemsError) throw itemsError

        // 3. Trigger semántico (evita race con KDS)
        // Intentamos tocar updated_at para despertar al realtime de KDS *después* de que los items existan
        const nowIso = new Date().toISOString()
        const { error: triggerError } = await sb
          .from('orders')
          .update({ updated_at: nowIso }) // Si updated_at no existe en DB, esto podría fallar, así que usamos fallback
          .eq('id', createdOrder!.id)

        if (triggerError) {
          // Fallback seguro: tocar total a sí mismo para disparar UPDATE
          const { error: fallbackError } = await sb
            .from('orders')
            .update({ total })
            .eq('id', createdOrder!.id)
          if (fallbackError) throw fallbackError
        }

        this.clearCart()
        return createdOrder
      } catch (e) {
        // Rollback: Si falla inserción de items o trigger
        if (createdOrder?.id) {
          console.error('⚠️ Iniciando Rollback por error:', e)
          try {
            const { error: delError } = await sb.from('orders').delete().eq('id', createdOrder.id)
            if (delError) {
              console.error('❌ Falló DELETE rollback, intentando CANCEL:', delError)
              // Si falla delete, marcamos cancelled
              await sb.from('orders').update({ status: 'cancelled' }).eq('id', createdOrder.id)
            }
          } catch (rollbackError) {
            console.error('❌ Rollback failed completely:', rollbackError)
          }
        }
        console.error('❌ Error en checkout:', e) // Log error para debug
        throw e
      } finally {
        this.loading = false
        this.showPayment = false
      }
    }
  },
})
