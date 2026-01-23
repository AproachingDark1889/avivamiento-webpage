import { defineStore } from 'pinia'
import type { Product } from '../types'
import { useAuthStore } from './auth'

type SupabaseClientLike = any

function getSupabase(): SupabaseClientLike | null {
    const nuxtApp = useNuxtApp() as any
    return nuxtApp?.$supabase || nuxtApp?.$supabaseClient || null
}

function toProduct(row: any): Product {
    return {
        id: String(row.id),
        org_id: String(row.org_id),
        name: String(row.name ?? ''),
        price: Number(row.price ?? 0),
        category: row.category ?? undefined,
        image: row.image ?? undefined,
        active: Boolean(row.active ?? true),
        created_at: row.created_at ?? undefined,
        updated_at: row.updated_at ?? undefined,
    }
}

export const useProductsStore = defineStore('products', {
    state: () => ({
        items: [] as Product[],
        loading: false,
        loaded: false,
        error: null as string | null,
    }),

    getters: {
        activeItems(state): Product[] {
            return state.items.filter(p => p.active)
        },
    },

    actions: {
        async load(opts?: { includeInactive?: boolean }) {
            const auth = useAuthStore()
            const sb = getSupabase()
            this.error = null

            if (!sb?.from) {
                this.error = 'Supabase no detectado'
                return
            }

            // Ensure profile loaded
            if (!auth.profile) await auth.refreshProfile()

            const orgId = auth.profile?.org_id
            if (!orgId) {
                this.error = 'Tu usuario no tiene org_id asignado. Contacta al administrador.'
                this.items = []
                this.loaded = true
                return
            }

            this.loading = true
            try {
                let q = sb
                    .from('products')
                    .select('*')
                    .eq('org_id', orgId)
                    .order('name', { ascending: true })

                if (!opts?.includeInactive) q = q.eq('active', true)

                const { data, error } = await q
                if (error) throw error

                this.items = (data ?? []).map(toProduct)
                this.loaded = true
            } catch (e: any) {
                console.error('Error loading products:', e)
                this.error = e?.message ?? String(e)
                this.items = []
                this.loaded = true
            } finally {
                this.loading = false
            }
        },

        async create(input: { name: string; price: number; category?: string; active?: boolean; image?: string }) {
            const auth = useAuthStore()
            const sb = getSupabase()
            if (!sb?.from) throw new Error('Supabase no detectado')
            const orgId = auth.profile?.org_id
            if (!orgId) throw new Error('org_id faltante en profile')

            const payload = {
                org_id: orgId,
                name: input.name,
                price: input.price,
                category: input.category ?? null,
                image: input.image ?? null,
                active: input.active ?? true,
            }

            const { data, error } = await sb.from('products').insert(payload).select('*').single()
            if (error) throw error

            const p = toProduct(data)
            this.items = [p, ...this.items].sort((a, b) => a.name.localeCompare(b.name))
            return p
        },

        async update(id: string, patch: Partial<{ name: string; price: number; category?: string; active: boolean; image?: string }>) {
            const sb = getSupabase()
            if (!sb?.from) throw new Error('Supabase no detectado')

            const payload: any = {}
            if (patch.name !== undefined) payload.name = patch.name
            if (patch.price !== undefined) payload.price = patch.price
            if (patch.category !== undefined) payload.category = patch.category ?? null
            if (patch.image !== undefined) payload.image = patch.image ?? null
            if (patch.active !== undefined) payload.active = patch.active

            const { data, error } = await sb.from('products').update(payload).eq('id', id).select('*').single()
            if (error) throw error

            const p = toProduct(data)
            this.items = this.items.map(x => (x.id === id ? p : x)).sort((a, b) => a.name.localeCompare(b.name))
            return p
        },

        async remove(id: string) {
            const sb = getSupabase()
            if (!sb?.from) throw new Error('Supabase no detectado')

            const { error } = await sb.from('products').delete().eq('id', id)
            if (error) throw error

            this.items = this.items.filter(x => x.id !== id)
        },
    },
})
