// app/stores/auth.ts
import { defineStore } from 'pinia'
import type { AppRole, Profile } from '../types'
import { useSupabase } from '../composables/useSupabase'

function getSupabase() {
    try { return useSupabase() } catch { return null }
}

const ROLE_ORDER: AppRole[] = ['cashier', 'kitchen', 'leader', 'super_admin']

function makeChurchSlug(churchName: string) {
    return churchName
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
}

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
        isPastor(): boolean {
            return this.role === 'pastor'
        },

        canAccessPos(): boolean {
            return ['cashier', 'leader', 'pastor', 'super_admin'].includes(this.role || '')
        },
        canAccessKds(): boolean {
            return ['kitchen', 'leader', 'pastor', 'super_admin'].includes(this.role || '')
        },
        canManageUsers(): boolean {
            return ['leader', 'pastor', 'super_admin'].includes(this.role || '')
        },
        canViewReports(): boolean {
            return ['leader', 'pastor', 'super_admin'].includes(this.role || '')
        },
        canCloseCash(): boolean {
            return ['cashier', 'leader', 'pastor', 'super_admin'].includes(this.role || '')
        },
        canManageProducts(): boolean {
            return ['leader', 'pastor', 'super_admin'].includes(this.role || '')
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
                    .select('id,email,display_name,org_id,owner_id,role,created_at,auto_accept_orders,independent_cash_register,deactivated_at,onboarding_completed')
                    .eq('id', uid)
                    .single()

                if (error) throw error

                if (data?.deactivated_at) {
                    this.error = 'Usuario desactivado. Contacta a tu lider.'
                    try {
                        await sb.auth.signOut()
                    } catch {
                        // no-op
                    }
                    this.session = null
                    this.user = null
                    this.profile = null
                    return
                }

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
                    owner_id: data.owner_id ?? undefined,
                    role: data.role as AppRole,
                    created_at: data.created_at ?? undefined,
                    auto_accept_orders: data.auto_accept_orders ?? false,
                    independent_cash_register: data.independent_cash_register ?? false,
                    deactivated_at: data.deactivated_at ?? null,
                    onboarding_completed: data.onboarding_completed ?? false,
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

                if (this.user?.id) {
                    await this.refreshProfile()
                    if (!this.profile) {
                        throw new Error(this.error || 'Perfil no autorizado')
                    }
                    await this.ensurePendingTenant()
                }
            } catch (e: any) {
                this.error = e?.message ?? String(e)
                throw e
            } finally {
                this.loading = false
            }
        },

        async ensurePendingTenant() {
            if (!import.meta.client) return false
            const sb = getSupabase()
            if (!sb?.rpc || !this.user?.id) return false

            const metadata = this.user.user_metadata || {}
            const churchName = typeof metadata.church_name === 'string' ? metadata.church_name.trim() : ''
            const fullName = typeof metadata.full_name === 'string' ? metadata.full_name.trim() : ''

            if (!churchName) return false
            if (this.profile?.org_id && this.profile?.role === 'pastor') return false

            const slug = makeChurchSlug(churchName)
            const payload = {
                p_church_name: churchName,
                p_church_slug: slug,
                p_full_name: fullName || this.user.email || 'Pastor',
            }

            const { error: rpcError } = await sb.rpc('setup_new_tenant', payload)

            if (rpcError) {
                if (rpcError.message?.includes('ya estÃ¡ en uso')) {
                    const uniqueSlug = `${slug}-${Date.now().toString(36).slice(-4)}`
                    const { error: retryError } = await sb.rpc('setup_new_tenant', {
                        ...payload,
                        p_church_slug: uniqueSlug,
                    })
                    if (retryError) throw retryError
                } else {
                    throw rpcError
                }
            }

            await this.refreshProfile()
            return true
        },

        async signUp(email: string, password: string, metadata: { full_name: string; church_name: string }) {
            if (!import.meta.client) return
            const sb = getSupabase()
            if (!sb?.auth?.signUp) {
                throw new Error('Supabase auth no está disponible.')
            }

            this.loading = true
            this.error = null
            try {
                // 1. Crear usuario (trigger handle_new_user crea profile automáticamente)
                const { data: authData, error: authError } = await sb.auth.signUp({
                    email,
                    password,
                    options: {
                        data: {
                            full_name: metadata.full_name,
                            church_name: metadata.church_name,
                        },
                    },
                })

                if (authError) throw authError
                if (!authData?.user) throw new Error('No se pudo crear el usuario')

                this.session = authData.session ?? null
                this.user = authData.session?.user ?? null

                if (!this.session) {
                    this.user = null
                    this.profile = null
                    return { requiresLogin: true }
                }

                // 2. Generar slug desde nombre de iglesia
                const slug = makeChurchSlug(metadata.church_name)

                // 3. RPC atómica: crear org + actualizar profile (cero race conditions)
                const { error: rpcError } = await sb.rpc('setup_new_tenant', {
                    p_church_name: metadata.church_name,
                    p_church_slug: slug,
                    p_full_name: metadata.full_name,
                })

                if (rpcError) {
                    // Si slug duplicado, reintentar con sufijo único
                    if (rpcError.message?.includes('ya está en uso')) {
                        const uniqueSlug = `${slug}-${Date.now().toString(36).slice(-4)}`
                        const { error: retryError } = await sb.rpc('setup_new_tenant', {
                            p_church_name: metadata.church_name,
                            p_church_slug: uniqueSlug,
                            p_full_name: metadata.full_name,
                        })
                        if (retryError) throw retryError
                    } else {
                        throw rpcError
                    }
                }

                // 4. Recargar perfil con datos actualizados
                await this.refreshProfile()
                return { requiresLogin: false }
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
