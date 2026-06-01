export const APP_ROLES = [
    { value: 'pastor', title: 'Pastor', color: 'deep-purple' },
    { value: 'leader', title: 'Líder de Departamento', color: 'indigo' },
    { value: 'cashier', title: 'Cajero', color: 'success' },
    { value: 'kitchen', title: 'Cocina', color: 'warning' },
] as const

// Roles que Super Admin puede crear
export const SUPER_ADMIN_CREATABLE_ROLES = APP_ROLES.filter(r => r.value === 'pastor' || r.value === 'leader')

// Roles que Pastor puede crear: Líderes + Staff operativo
export const PASTOR_ASSIGNABLE_ROLES = APP_ROLES.filter(r => r.value === 'leader' || r.value === 'cashier' || r.value === 'kitchen')

// Roles que Leader puede crear: solo Staff operativo
export const STAFF_ROLES = APP_ROLES.filter(r => r.value === 'cashier' || r.value === 'kitchen')

export function getRoleTitle(role?: string) {
    if (role === 'super_admin') return 'Super Administrador'
    const found = APP_ROLES.find(r => r.value === role)
    return found?.title || role || 'Desconocido'
}

export function getRoleColor(role?: string) {
    if (role === 'super_admin') return 'purple'
    const found = APP_ROLES.find(r => r.value === role)
    return found?.color || 'grey'
}

