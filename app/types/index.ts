// app/types/index.ts

export type AppRole = 'super_admin' | 'leader' | 'cashier' | 'kitchen'

export interface Profile {
  id: string
  email?: string
  display_name?: string
  org_id?: string
  role: AppRole
  created_at?: string
}

export interface Product {
  id: string
  org_id: string
  name: string
  price: number
  category?: string
  image?: string
  active: boolean
  created_at?: string
  updated_at?: string
}

export type OrderStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'progress'   // legacy
  | 'delivered'  // legacy

export interface Order {
  id: string
  created_at?: string
  status: OrderStatus
  total: number
  created_by?: string
  session_id?: string
  paid_with?: number
  change?: number
  payment_method?: 'cash' | 'card' | 'transfer'
  // items might be used optionally in some contexts, but OrderWithItems is safer
}


export interface OrderItem {
  id?: string
  order_id?: string
  product_id: string
  name: string
  price: number
  quantity: number
  subtotal: number
}

export interface OrderWithItems extends Order {
  items: OrderItem[]
}
