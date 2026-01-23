export const PRODUCT_CATEGORIES = [
    // Comida Específica
    { value: 'tacos', title: 'Tacos', icon: 'mdi-taco' },
    { value: 'burgers', title: 'Hamburguesas', icon: 'mdi-hamburger' },
    { value: 'pizza', title: 'Pizzas', icon: 'mdi-pizza' },
    { value: 'snacks', title: 'Snacks / Papas', icon: 'mdi-french-fries' },

    // Generales
    { value: 'food', title: 'Platillos / Otros', icon: 'mdi-food-fork-drink' },
    { value: 'drink', title: 'Bebidas / Refrescos', icon: 'mdi-bottle-soda' },
    { value: 'coffee', title: 'Cafetería', icon: 'mdi-coffee' },
    { value: 'dessert', title: 'Postres / Pan', icon: 'mdi-cupcake' },

    // Otros
    { value: 'other', title: 'Varios', icon: 'mdi-shape' },
] as const

export function getCategoryIcon(category?: string | null) {
    const cat = PRODUCT_CATEGORIES.find(c => c.value === category)
    return cat?.icon || 'mdi-help-circle-outline'
}

export function getCategoryTitle(category?: string | null) {
    const cat = PRODUCT_CATEGORIES.find(c => c.value === category)
    return cat?.title || 'Otros'
}
