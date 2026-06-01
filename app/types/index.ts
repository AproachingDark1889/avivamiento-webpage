// app/types/index.ts

export type AppRole = 'super_admin' | 'pastor' | 'leader' | 'cashier' | 'kitchen'

export interface Profile {
  id: string
  email?: string
  display_name?: string
  org_id?: string
  owner_id?: string
  role: AppRole
  created_at?: string
  auto_accept_orders?: boolean
  onboarding_completed?: boolean
}

export interface Organization {
  id: string
  name: string
  slug: string
  plan: 'free' | 'starter' | 'pro' | 'enterprise'
  status: 'trial' | 'active' | 'suspended' | 'cancelled'
  max_users: number
  owner_id?: string
  stripe_customer_id?: string
  stripe_subscription_id?: string
  subscription_ends_at?: string
  created_at?: string
  updated_at?: string
}

export interface Product {
  id: string
  org_id: string
  department_owner_id?: string
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
  | 'rejected'
  | 'incomplete'
  | 'progress'   // legacy
  | 'delivered'  // legacy

export interface Order {
  id: string
  org_id?: string
  department_owner_id?: string
  created_at?: string
  status: OrderStatus
  financial_status?: 'paid' | 'refunded' | 'voided'
  operational_status?: 'pending' | 'completed' | 'kitchen_rejected' | 'kitchen_cancelled' | 'auto_fulfilled'
  financial_review_required?: boolean
  total: number
  created_by?: string
  session_id?: string
  paid_with?: number
  change?: number
  payment_method?: 'cash' | 'card' | 'transfer'
  rejection_reason?: string
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
