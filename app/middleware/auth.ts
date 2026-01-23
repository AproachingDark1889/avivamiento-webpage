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

    // Logged in pero sin perfil/rol: bloqueamos
    if (!auth.hasProfile) {
        return navigateTo('/forbidden?reason=no-profile')
    }
})
