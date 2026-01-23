// app/middleware/role-leader.client.ts
import { useAuthStore } from '../stores/auth'

export default defineNuxtRouteMiddleware(async (to) => {
    if (import.meta.server) return
    const auth = useAuthStore()
    await auth.init()

    if (!auth.isLoggedIn) {
        const redirect = encodeURIComponent(to.fullPath)
        return navigateTo(`/login?redirect=${redirect}`)
    }

    if (!auth.hasProfile || !auth.canViewReports) {
        return navigateTo('/forbidden?reason=role')
    }
})
