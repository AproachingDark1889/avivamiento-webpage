-- ============================================================================
-- MIGRACIÓN: Cajas Independientes por Cajero (Toggle)
-- ============================================================================

-- 1. Profiles: Nuevo toggle por cajero
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS independent_cash_register boolean DEFAULT false;

-- 2. Cash Closures: Nuevos campos y control de estado
ALTER TABLE public.cash_closures
  ADD COLUMN IF NOT EXISTS operator_id uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'closed' CHECK (status IN ('open', 'pending_validation', 'closed'));

-- Backfill data para registros antiguos (se asume que los anteriores están cerrados)
UPDATE public.cash_closures SET status = 'closed' WHERE status IS NULL;
UPDATE public.cash_closures SET operator_id = closed_by WHERE operator_id IS NULL;

-- 3. Actualización de Constraints
ALTER TABLE public.cash_closures DROP CONSTRAINT IF EXISTS unique_org_department_closure_date;
ALTER TABLE public.cash_closures DROP CONSTRAINT IF EXISTS unique_org_closure_date;

-- Ahora la caja es única por departamento, por operador (si es independiente) y fecha.
ALTER TABLE public.cash_closures
  ADD CONSTRAINT unique_org_dept_operator_date UNIQUE (org_id, department_owner_id, operator_id, closure_date);

-- 4. Orders: Enlace a la sesión de caja
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS closure_id uuid REFERENCES public.cash_closures(id);

-- ============================================================================
-- 5. RPC: Abrir Caja
-- ============================================================================
CREATE OR REPLACE FUNCTION public.open_cash_closure(
  p_opening_cash numeric,
  p_closure_date date DEFAULT CURRENT_DATE
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_org_id uuid;
  v_department_owner_id uuid;
  v_independent boolean;
  v_operator_id uuid;
  v_existing_id uuid;
  v_new_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  v_department_owner_id := public.get_my_department_owner();

  SELECT org_id, independent_cash_register INTO v_org_id, v_independent
  FROM public.profiles
  WHERE id = v_user_id;

  -- Si es caja independiente, el operador es él mismo. Si es compartida, el operador lógico es el departamento (líder).
  IF v_independent THEN
    v_operator_id := v_user_id;
  ELSE
    v_operator_id := v_department_owner_id;
  END IF;

  -- Checar si ya existe una caja para hoy
  SELECT id INTO v_existing_id
  FROM public.cash_closures
  WHERE org_id = v_org_id
    AND department_owner_id = v_department_owner_id
    AND operator_id = v_operator_id
    AND closure_date = p_closure_date;

  IF v_existing_id IS NOT NULL THEN
    RAISE EXCEPTION 'Ya existe una caja abierta o cerrada para este departamento/cajero en esta fecha.';
  END IF;

  INSERT INTO public.cash_closures (
    org_id, department_owner_id, operator_id, closure_date,
    opening_cash, status, created_at
  ) VALUES (
    v_org_id, v_department_owner_id, v_operator_id, p_closure_date,
    p_opening_cash, 'open', now()
  ) RETURNING id INTO v_new_id;

  RETURN json_build_object('success', true, 'closure_id', v_new_id);
END;
$$;

-- ============================================================================
-- 6. RPC: Modificar process_checkout
-- ============================================================================
CREATE OR REPLACE FUNCTION public.process_checkout(
  p_items jsonb,
  p_payment_method text DEFAULT 'cash',
  p_paid_with numeric DEFAULT 0,
  p_change numeric DEFAULT 0,
  p_auto_accept boolean DEFAULT false
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id    uuid;
  v_org_id     uuid;
  v_role       text;
  v_owner_id   uuid;
  v_department_owner_id uuid;
  v_auto_accept boolean;
  v_independent boolean;
  v_order_id   bigint;
  v_total      numeric := 0;
  v_status     text;
  v_op_status  text;
  v_item       jsonb;
  v_product    record;
  v_quantity   int;
  v_prod_uuid  uuid;
  v_items_arr  jsonb := '[]'::jsonb;
  v_operator_id uuid;
  v_closure_id  uuid;
  v_closure_status text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT org_id, role, owner_id, auto_accept_orders, independent_cash_register
  INTO v_org_id, v_role, v_owner_id, v_auto_accept, v_independent
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_org_id IS NULL THEN RAISE EXCEPTION 'Usuario no pertenece a ninguna organización'; END IF;
  IF v_role NOT IN ('cashier', 'leader', 'pastor', 'super_admin') THEN RAISE EXCEPTION 'Acceso denegado'; END IF;

  v_department_owner_id := public.get_my_department_owner();
  IF v_department_owner_id IS NULL THEN RAISE EXCEPTION 'Usuario no pertenece a ningún departamento operativo'; END IF;

  -- -----------------------------------------------------------------
  -- LÓGICA DE CAJA (STATEFUL) - RESOLUCIÓN DEL OPERATOR_ID
  -- -----------------------------------------------------------------
  IF v_independent THEN
    v_operator_id := v_user_id;
  ELSE
    v_operator_id := v_department_owner_id;
  END IF;

  SELECT id, status INTO v_closure_id, v_closure_status
  FROM public.cash_closures
  WHERE org_id = v_org_id
    AND department_owner_id = v_department_owner_id
    AND operator_id = v_operator_id
    AND closure_date = CURRENT_DATE;

  IF v_closure_id IS NULL THEN
    RAISE EXCEPTION 'Debe abrir caja antes de realizar ventas.';
  END IF;

  IF v_closure_status != 'open' THEN
    RAISE EXCEPTION 'La caja no está abierta (Estado actual: %).', v_closure_status;
  END IF;
  -- -----------------------------------------------------------------

  IF p_payment_method IS NULL OR p_payment_method NOT IN ('cash', 'card', 'transfer') THEN RAISE EXCEPTION 'Método de pago inválido'; END IF;
  IF p_paid_with IS NULL OR p_change IS NULL OR p_paid_with < 0 OR p_change < 0 THEN RAISE EXCEPTION 'Montos inválidos'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) != 'array' OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Carrito inválido'; END IF;

  v_status := CASE WHEN v_auto_accept THEN 'completed' ELSE 'pending' END;
  v_op_status := CASE WHEN v_auto_accept THEN 'auto_fulfilled' ELSE 'pending' END;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    BEGIN
      v_quantity := (v_item->>'quantity')::int;
      v_prod_uuid := (v_item->>'product_id')::uuid;
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Item inválido'; END;
    IF v_quantity IS NULL OR v_quantity <= 0 THEN RAISE EXCEPTION 'Cantidad inválida'; END IF;

    SELECT id, name, price, org_id, department_owner_id INTO v_product
    FROM public.products
    WHERE id = v_prod_uuid AND org_id = v_org_id AND department_owner_id = v_department_owner_id AND active = true;

    IF v_product IS NULL THEN RAISE EXCEPTION 'Producto no válido'; END IF;

    v_total := v_total + (v_product.price * v_quantity);
    v_items_arr := v_items_arr || jsonb_build_object(
      'product_id', v_product.id, 'name', v_product.name, 'price', v_product.price, 'quantity', v_quantity, 'subtotal', v_product.price * v_quantity
    );
  END LOOP;

  IF p_payment_method = 'cash' AND p_paid_with < v_total THEN RAISE EXCEPTION 'Monto pagado insuficiente'; END IF;

  INSERT INTO public.orders (
    org_id, department_owner_id, total, status, operational_status,
    financial_status, paid_with, change, payment_method, created_by, closure_id
  ) VALUES (
    v_org_id, v_department_owner_id, v_total, v_status, v_op_status,
    'paid', p_paid_with, p_change, p_payment_method, v_user_id, v_closure_id
  ) RETURNING id INTO v_order_id;

  INSERT INTO public.order_items (order_id, product_id, name, price, quantity, subtotal, org_id)
  SELECT v_order_id, (elem->>'product_id')::uuid, elem->>'name', (elem->>'price')::numeric, (elem->>'quantity')::int, (elem->>'subtotal')::numeric, v_org_id
  FROM jsonb_array_elements(v_items_arr) AS elem;

  RETURN json_build_object('success', true, 'order_id', v_order_id, 'status', v_status);
END;
$$;

-- ============================================================================
-- 7. RPC: Pre-Cierre de Caja (Reemplaza lógicamente a save_cash_closure)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.pre_close_cash(
  p_closure_date  date,
  p_cash_counted  numeric,
  p_notes         text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_org_id uuid;
  v_department_owner_id uuid;
  v_independent boolean;
  v_operator_id uuid;
  v_closure record;
  v_orders_count int;
  v_sales_total numeric;
  v_cash_sales numeric;
  v_card_sales numeric;
  v_transfer_sales numeric;
  v_expected_cash numeric;
  v_difference numeric;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT org_id, independent_cash_register INTO v_org_id, v_independent
  FROM public.profiles WHERE id = v_user_id;

  v_department_owner_id := public.get_my_department_owner();

  IF v_independent THEN
    v_operator_id := v_user_id;
  ELSE
    v_operator_id := v_department_owner_id;
  END IF;

  SELECT * INTO v_closure
  FROM public.cash_closures
  WHERE org_id = v_org_id
    AND department_owner_id = v_department_owner_id
    AND operator_id = v_operator_id
    AND closure_date = p_closure_date
  FOR UPDATE;

  IF v_closure IS NULL THEN RAISE EXCEPTION 'No se encontró una caja abierta para hoy'; END IF;
  IF v_closure.status != 'open' THEN RAISE EXCEPTION 'La caja no está abierta. Status: %', v_closure.status; END IF;

  SELECT
    COUNT(*), COALESCE(SUM(total), 0),
    COALESCE(SUM(total) FILTER (WHERE payment_method = 'cash' OR payment_method IS NULL), 0),
    COALESCE(SUM(total) FILTER (WHERE payment_method = 'card'), 0),
    COALESCE(SUM(total) FILTER (WHERE payment_method = 'transfer'), 0)
  INTO
    v_orders_count, v_sales_total, v_cash_sales, v_card_sales, v_transfer_sales
  FROM public.orders
  WHERE closure_id = v_closure.id AND financial_status = 'paid';

  v_expected_cash := v_closure.opening_cash + v_cash_sales;
  v_difference := p_cash_counted - v_expected_cash;

  UPDATE public.cash_closures SET
    sales_total = v_sales_total,
    cash_counted = p_cash_counted,
    expected_cash = v_expected_cash,
    difference = v_difference,
    total_cash_sales = v_cash_sales,
    total_card_sales = v_card_sales,
    total_transfer_sales = v_transfer_sales,
    orders_count = v_orders_count,
    notes = p_notes,
    status = 'pending_validation',
    updated_at = now()
  WHERE id = v_closure.id;

  RETURN json_build_object('success', true, 'closure_id', v_closure.id, 'status', 'pending_validation');
END;
$$;

-- ============================================================================
-- 8. RPC: Aprobar Caja (Solo Líder)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.approve_cash_closure(
  p_closure_id uuid,
  p_revision_note text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_role text;
  v_closure record;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_user_id;
  IF v_role NOT IN ('leader', 'pastor', 'super_admin') THEN RAISE EXCEPTION 'Solo un líder puede aprobar cajas'; END IF;

  SELECT * INTO v_closure FROM public.cash_closures WHERE id = p_closure_id FOR UPDATE;
  IF v_closure IS NULL THEN RAISE EXCEPTION 'Caja no encontrada'; END IF;
  IF v_closure.status != 'pending_validation' THEN RAISE EXCEPTION 'La caja no está en espera de validación'; END IF;

  IF v_closure.department_owner_id != v_user_id AND v_role != 'pastor' THEN
    RAISE EXCEPTION 'No tienes permiso para aprobar cajas de este departamento';
  END IF;

  UPDATE public.cash_closures SET
    status = 'closed',
    closed_by = v_user_id,
    revision_note = COALESCE(p_revision_note, revision_note),
    updated_at = now(),
    updated_by = v_user_id
  WHERE id = p_closure_id;

  RETURN json_build_object('success', true, 'closure_id', p_closure_id, 'status', 'closed');
END;
$$;

-- Permisos
REVOKE ALL ON FUNCTION public.open_cash_closure(numeric, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.open_cash_closure(numeric, date) TO authenticated;

REVOKE ALL ON FUNCTION public.process_checkout(jsonb, text, numeric, numeric, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_checkout(jsonb, text, numeric, numeric, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.pre_close_cash(date, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pre_close_cash(date, numeric, text) TO authenticated;

REVOKE ALL ON FUNCTION public.approve_cash_closure(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_cash_closure(uuid, text) TO authenticated;
