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

    const assignedPanel = () => {
        if (auth.canAccessPos) return '/page/POS/pointOfSales'
        if (auth.canAccessKds) return '/page/POS/kds'
        if (auth.canViewReports) return '/page/POS/reports'
        return '/login'
    }

    const deny = () => navigateTo(assignedPanel())
    const requiredAccess = to.meta.requiredAccess as string | undefined

    if (requiredAccess === 'pos' && !auth.canAccessPos) return deny()
    if (requiredAccess === 'kds' && !auth.canAccessKds) return deny()
    if (requiredAccess === 'cash' && !auth.canCloseCash) return deny()
    if (requiredAccess === 'users' && !auth.canManageUsers) return deny()
    if (requiredAccess === 'products' && !auth.canManageProducts) return deny()
    if (requiredAccess === 'reports' && !auth.canViewReports) return deny()

    const path = to.path

    const isPosRoute = path === '/sistema/pos' || path === '/page/POS/pointOfSales'
    const isKdsRoute = path === '/sistema/kds' || path === '/page/POS/kds'
    const isCashRoute = path === '/sistema/corte' || path === '/page/POS/cashClosing'
    const isUsersRoute = path === '/sistema/admin/usuarios' || path === '/page/POS/users'
    const isProductsRoute = path === '/sistema/admin/productos' || path === '/page/POS/products'
    const isReportsRoute = path === '/sistema/reportes' || path === '/page/POS/reports'
    const isAdminRoute = path.startsWith('/sistema/admin')

    if (isPosRoute && !auth.canAccessPos) return deny()
    if (isKdsRoute && !auth.canAccessKds) return deny()
    if (isCashRoute && !auth.canCloseCash) return deny()
    if (isUsersRoute && !auth.canManageUsers) return deny()
    if (isProductsRoute && !auth.canManageProducts) return deny()
    if (isReportsRoute && !auth.canViewReports) return deny()
    if (isAdminRoute && !auth.canManageUsers && !auth.canManageProducts) return deny()
})
