// app/stores/auth.ts
import { defineStore } from 'pinia'
import type { AppRole, Profile } from '../types'

type SupabaseClientLike = any

function getSupabase(): SupabaseClientLike | null {
    const nuxtApp = useNuxtApp() as any
    return nuxtApp?.$supabase || nuxtApp?.$supabaseClient || null
}

const ROLE_ORDER: AppRole[] = ['cashier', 'kitchen', 'leader', 'super_admin']

export const useAuthStore = defineStore('auth', {
    state: () => ({
        session: null as any | null,
        user: null as any | null,
        profile: null as Profile | null,

        loading: false,
        initialized: false,
        error: null as string | null,

        _listenerBound: false,
        _unsubscribe: null as (() => void) | null,
    }),

    getters: {
        isLoggedIn: (s) => !!s.user,
        role: (s): AppRole | null => (s.profile?.role as AppRole) ?? null,

        hasProfile: (s) => !!s.profile && !!s.profile.role,

        isCashier(): boolean {
            return this.role === 'cashier'
        },
        isKitchen(): boolean {
            return this.role === 'kitchen'
        },
        isLeader(): boolean {
            return this.role === 'leader'
        },
        isSuperAdmin(): boolean {
            return this.role === 'super_admin'
        },

        canAccessPos(): boolean {
            // Flexible: Cashier, Kitchen, Leader, Admin
            return ['cashier', 'kitchen', 'leader', 'super_admin'].includes(this.role || '')
        },
        canAccessKds(): boolean {
             // Flexible: Cashier, Kitchen, Leader, Admin
            return ['cashier', 'kitchen', 'leader', 'super_admin'].includes(this.role || '')
        },
        canManageUsers(): boolean {
            return this.role === 'leader' || this.role === 'super_admin'
        },
        canViewReports(): boolean {
            return this.role === 'leader' || this.role === 'super_admin'
        },
        canCloseCash(): boolean {
            return this.role === 'cashier' || this.role === 'leader' || this.role === 'super_admin'
        },

        roleRank(): number {
            const r = this.role
            if (!r) return -1
            return ROLE_ORDER.indexOf(r)
        },
    },

    actions: {
        async init() {
            if (!import.meta.client) return
            if (this.initialized) return

            const sb = getSupabase()
            if (!sb?.auth?.getSession) {
                this.error = 'Supabase client no detectado. Revisa la inyección ($supabase / $supabaseClient).'
                this.initialized = true
                return
            }

            this.loading = true
            this.error = null
            try {
                const { data, error } = await sb.auth.getSession()
                if (error) throw error

                this.session = data?.session ?? null
                this.user = data?.session?.user ?? null

                if (this.user?.id) {
                    await this.refreshProfile()
                } else {
                    this.profile = null
                }
            } catch (e: any) {
                this.error = e?.message ?? String(e)
                this.session = null
                this.user = null
                this.profile = null
            } finally {
                this.loading = false
                this.initialized = true
            }
        },

        bindAuthListener() {
            if (!import.meta.client) return
            if (this._listenerBound) return

            const sb = getSupabase()
            if (!sb?.auth?.onAuthStateChange) return

            const { data } = sb.auth.onAuthStateChange(async (_event: any, session: any) => {
                this.session = session ?? null
                this.user = session?.user ?? null

                if (this.user?.id) {
                    await this.refreshProfile()
                } else {
                    this.profile = null
                }
            })

            this._unsubscribe = data?.subscription?.unsubscribe ? () => data.subscription.unsubscribe() : null
            this._listenerBound = true
        },

        unbindAuthListener() {
            try {
                if (this._unsubscribe) this._unsubscribe()
            } catch {
                // no-op
            } finally {
                this._unsubscribe = null
                this._listenerBound = false
            }
        },

        async refreshProfile() {
            if (!import.meta.client) return
            const sb = getSupabase()
            const uid = this.user?.id
            if (!sb?.from || !uid) {
                this.profile = null
                return
            }

            try {
                const { data, error } = await sb
                    .from('profiles')
                    .select('id,email,display_name,org_id,role,created_at')
                    .eq('id', uid)
                    .single()

                if (error) throw error

                // Si no hay rol, tratamos como no autorizado
                if (!data?.role) {
                    this.profile = null
                    return
                }

                this.profile = {
                    id: String(data.id),
                    email: data.email ?? undefined,
                    display_name: data.display_name ?? undefined,
                    org_id: data.org_id ?? undefined,
                    role: data.role as AppRole,
                    created_at: data.created_at ?? undefined,
                }
            } catch {
                this.profile = null
            }
        },

        async signIn(email: string, password: string) {
            if (!import.meta.client) return
            const sb = getSupabase()
            if (!sb?.auth?.signInWithPassword) {
                throw new Error('Supabase auth no está disponible.')
            }

            this.loading = true
            this.error = null
            try {
                const { data, error } = await sb.auth.signInWithPassword({ email, password })
                if (error) throw error

                this.session = data?.session ?? null
                this.user = data?.user ?? data?.session?.user ?? null

                if (this.user?.id) await this.refreshProfile()
            } catch (e: any) {
                this.error = e?.message ?? String(e)
                throw e
            } finally {
                this.loading = false
            }
        },

        async signOut() {
            if (!import.meta.client) return
            const sb = getSupabase()
            if (!sb?.auth?.signOut) return

            this.loading = true
            try {
                await sb.auth.signOut()
            } finally {
                this.session = null
                this.user = null
                this.profile = null
                this.loading = false
            }
        },
    },
})
