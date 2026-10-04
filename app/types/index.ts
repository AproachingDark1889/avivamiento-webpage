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
  independent_cash_register?: boolean
  deactivated_at?: string | null
  deactivated_by?: string | null
  deactivation_reason?: string | null
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
  cash_session_id?: string
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

export type CashSessionMode = 'shared' | 'independent'
export type CashSessionStatus = 'open' | 'pending_validation' | 'closed'

export interface CashSessionCashierProfile {
  display_name?: string | null
  email?: string | null
}

export interface CashSession {
  id: string
  org_id: string
  department_owner_id: string
  cashier_id?: string | null
  cashier?: CashSessionCashierProfile | null
  mode: CashSessionMode
  status: CashSessionStatus
  opened_by: string
  opened_at: string
  opening_cash: number
  preclosed_by?: string | null
  preclosed_at?: string | null
  approved_by?: string | null
  approved_at?: string | null
  closed_at?: string | null
  cash_counted?: number | null
  expected_cash?: number | null
  sales_total: number
  total_cash_sales: number
  total_card_sales: number
  total_transfer_sales: number
  orders_count: number
  difference?: number | null
  notes?: string | null
}
