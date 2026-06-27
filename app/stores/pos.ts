// app/stores/pos.ts
import { defineStore } from 'pinia'
import type { Product, OrderItem, CashSession, CashSessionMode } from '../types'

const STORAGE_KEY = 'genesis_sales_core_cart_v1'

export const usePosStore = defineStore('pos', {
  state: () => ({
    cart: [] as OrderItem[],
    loading: false,
    showPayment: false,
    selectedCashMode: 'shared' as CashSessionMode,
    cashSessions: {
      shared: null as CashSession | null,
      independent: null as CashSession | null,
    },
    cashSessionLoading: false,
    cashSessionWarning: '',
  }),

  getters: {
    total: (state): number =>
      state.cart.reduce((sum, item) => sum + item.price * item.quantity, 0),
    cashSession: (state): CashSession | null =>
      state.cashSessions[state.selectedCashMode],
  },

  actions: {
    setCashMode(mode: CashSessionMode) {
      this.selectedCashMode = mode
    },

    initFromStorage() {
      if (!import.meta.client) return
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return
        const parsed = JSON.parse(raw)

        if (!Array.isArray(parsed)) return

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
        this.cart = []
      }
    },

    persistToStorage() {
      if (!import.meta.client) return
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.cart))
      } catch {
        // Storage failures should not break POS usage.
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

    getSupabaseClient() {
      const nuxtApp = useNuxtApp()
      return (nuxtApp.$supabase || nuxtApp.$supabaseClient) as any
    },

    normalizeCashSession(raw: any): CashSession | null {
      if (!raw || typeof raw !== 'object') return null
      return {
        ...raw,
        opening_cash: Number(raw.opening_cash ?? 0),
        cash_counted: raw.cash_counted == null ? null : Number(raw.cash_counted),
        expected_cash: raw.expected_cash == null ? null : Number(raw.expected_cash),
        sales_total: Number(raw.sales_total ?? 0),
        total_cash_sales: Number(raw.total_cash_sales ?? 0),
        total_card_sales: Number(raw.total_card_sales ?? 0),
        total_transfer_sales: Number(raw.total_transfer_sales ?? 0),
        orders_count: Number(raw.orders_count ?? 0),
        difference: raw.difference == null ? null : Number(raw.difference),
      } as CashSession
    },

    async loadCurrentCashSession(mode: CashSessionMode = this.selectedCashMode) {
      this.selectedCashMode = mode
      this.cashSessionLoading = true
      this.cashSessionWarning = ''

      const sb = this.getSupabaseClient()
      if (!sb || typeof sb.rpc !== 'function') {
        this.cashSessionLoading = false
        this.cashSessions[mode] = null
        throw new Error('Supabase no disponible')
      }

      try {
        const { data, error } = await sb.rpc('get_current_cash_session', {
          p_mode: mode,
        })
        if (error) throw error
        this.cashSessions[mode] = this.normalizeCashSession(data?.session)
        return data
      } catch (e: any) {
        this.cashSessions[mode] = null
        this.cashSessionWarning = e?.message ?? String(e)
        throw e
      } finally {
        this.cashSessionLoading = false
      }
    },

    async openCashSession(openingCash: number, mode: CashSessionMode = this.selectedCashMode) {
      this.selectedCashMode = mode
      this.cashSessionLoading = true
      this.cashSessionWarning = ''

      const sb = this.getSupabaseClient()
      if (!sb || typeof sb.rpc !== 'function') {
        this.cashSessionLoading = false
        throw new Error('Supabase no disponible')
      }

      try {
        const { data, error } = await sb.rpc('open_cash_session', {
          p_mode: mode,
          p_opening_cash: openingCash,
        })
        if (error) throw error
        this.cashSessions[mode] = this.normalizeCashSession(data?.session)
        return data
      } catch (e: any) {
        this.cashSessionWarning = e?.message ?? String(e)
        throw e
      } finally {
        this.cashSessionLoading = false
      }
    },

    async checkout(paidWith: number, change: number, paymentMethod: string) {
      if (this.cart.length === 0) throw new Error('Carrito vacio')
      if (!this.cashSession || this.cashSession.status !== 'open') {
        throw new Error('Caja no abierta. Abre una caja antes de cobrar.')
      }

      this.loading = true

      const sb = this.getSupabaseClient()

      if (!sb || typeof sb.rpc !== 'function') {
        this.loading = false
        this.showPayment = false
        throw new Error('Supabase no disponible')
      }

      try {
        const { useAuthStore } = await import('./auth')
        const auth = useAuthStore()
        const autoAccept = auth.profile?.auto_accept_orders === true

        const { data, error } = await sb.rpc('process_checkout', {
          p_items: this.cart.map(item => ({
            product_id: item.product_id,
            quantity: item.quantity,
          })),
          p_payment_method: paymentMethod,
          p_paid_with: paidWith,
          p_change: change,
          p_auto_accept: autoAccept,
          p_mode: this.selectedCashMode,
        })

        if (error) throw error

        this.clearCart()
        await this.loadCurrentCashSession(this.selectedCashMode).catch(() => null)
        return data
      } catch (e) {
        console.error('Error en checkout:', e)
        throw e
      } finally {
        this.loading = false
        this.showPayment = false
      }
    },
  },
})
