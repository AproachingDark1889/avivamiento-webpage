export const APP_ROLES = [
    { value: 'leader', title: 'Líder de Departamento', color: 'indigo' },
    { value: 'cashier', title: 'Cajero (Punto de Venta)', color: 'success' },
    { value: 'kitchen', title: 'Cocina / Pantalla', color: 'warning' },
] as const

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
