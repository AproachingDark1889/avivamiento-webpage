// app/middleware/auth.client.ts
import { useAuthStore } from '../stores/auth'

export default defineNuxtRouteMiddleware(async (to) => {
    if (import.meta.server) return
    const auth = useAuthStore()
    await auth.init()

    if (!auth.isLoggedIn) {
        const redirect = encodeURIComponent(to.fullPath)
        return navigateTo(`/login?redirect=${redirect}`)
    }

    // Usuarios recién confirmados pueden entrar sin tenant; completar alta pendiente con metadata.
    if (!auth.hasProfile || (auth.profile && !auth.profile.org_id)) {
        await auth.ensurePendingTenant()
    }

    // Logged in pero sin perfil/rol: bloqueamos
    if (!auth.hasProfile) {
        return navigateTo('/forbidden?reason=no-profile')
    }

    // Onboarding pendiente: solo pastores nuevos (no super_admin ni roles existentes)
    if (
        auth.profile?.role === 'pastor' &&
        auth.profile?.onboarding_completed === false &&
        to.path !== '/onboarding'
    ) {
        return navigateTo('/onboarding')
    }
})
