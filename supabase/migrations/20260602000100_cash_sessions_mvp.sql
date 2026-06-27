-- MVP: stateful cash sessions for shared and independent cash registers.
-- Shared cash remains the default. Independent cash is opt-in per cashier.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS independent_cash_register boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.cash_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  department_owner_id uuid NOT NULL REFERENCES public.profiles(id),
  cashier_id uuid REFERENCES public.profiles(id),
  mode text NOT NULL CHECK (mode IN ('shared', 'independent')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending_validation', 'closed')),
  opened_by uuid NOT NULL REFERENCES public.profiles(id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  opening_cash numeric(12,2) NOT NULL DEFAULT 0 CHECK (opening_cash >= 0),
  preclosed_by uuid REFERENCES public.profiles(id),
  preclosed_at timestamptz,
  approved_by uuid REFERENCES public.profiles(id),
  approved_at timestamptz,
  closed_at timestamptz,
  cash_counted numeric(12,2),
  expected_cash numeric(12,2),
  sales_total numeric(12,2) NOT NULL DEFAULT 0,
  total_cash_sales numeric(12,2) NOT NULL DEFAULT 0,
  total_card_sales numeric(12,2) NOT NULL DEFAULT 0,
  total_transfer_sales numeric(12,2) NOT NULL DEFAULT 0,
  orders_count integer NOT NULL DEFAULT 0,
  difference numeric(12,2),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cash_sessions_mode_cashier_consistency CHECK (
    (mode = 'shared' AND cashier_id IS NULL)
    OR (mode = 'independent' AND cashier_id IS NOT NULL)
  )
);

ALTER TABLE public.cash_sessions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cash_session_id uuid REFERENCES public.cash_sessions(id);

CREATE INDEX IF NOT EXISTS idx_profiles_independent_cash
  ON public.profiles(org_id, owner_id, independent_cash_register);

CREATE INDEX IF NOT EXISTS idx_orders_cash_session
  ON public.orders(cash_session_id);

CREATE INDEX IF NOT EXISTS idx_cash_sessions_org_department_status
  ON public.cash_sessions(org_id, department_owner_id, status, opened_at DESC);

CREATE INDEX IF NOT EXISTS idx_cash_sessions_cashier_status
  ON public.cash_sessions(cashier_id, status, opened_at DESC)
  WHERE cashier_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_cash_sessions_active_shared
  ON public.cash_sessions(org_id, department_owner_id)
  WHERE mode = 'shared' AND status IN ('open', 'pending_validation');

CREATE UNIQUE INDEX IF NOT EXISTS uniq_cash_sessions_active_independent
  ON public.cash_sessions(org_id, department_owner_id, cashier_id)
  WHERE mode = 'independent' AND status IN ('open', 'pending_validation');

DROP POLICY IF EXISTS "cash_sessions_select_by_department" ON public.cash_sessions;
CREATE POLICY "cash_sessions_select_by_department"
ON public.cash_sessions FOR SELECT TO authenticated
USING (
  public.get_my_role() = 'super_admin'
  OR (
    org_id = public.get_my_org()
    AND (
      public.get_my_role() = 'pastor'
      OR department_owner_id = public.get_my_department_owner()
      OR cashier_id = auth.uid()
    )
  )
);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.cash_sessions FROM anon, authenticated;
GRANT SELECT ON public.cash_sessions TO authenticated;
GRANT ALL ON public.cash_sessions TO service_role;

CREATE OR REPLACE FUNCTION public.resolve_cash_context()
RETURNS TABLE (
  user_id uuid,
  org_id uuid,
  role text,
  department_owner_id uuid,
  cash_mode text,
  cashier_id uuid,
  active_session_id uuid,
  active_session_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_org_id uuid;
  v_role text;
  v_owner_id uuid;
  v_independent_cash_register boolean;
  v_department_owner_id uuid;
  v_cash_mode text;
  v_cashier_id uuid;
  v_active_session_id uuid;
  v_active_session_status text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT p.org_id, p.role::text, p.owner_id, COALESCE(p.independent_cash_register, false)
  INTO v_org_id, v_role, v_owner_id, v_independent_cash_register
  FROM public.profiles p
  WHERE p.id = v_user_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no pertenece a ninguna organizacion';
  END IF;

  v_department_owner_id := CASE
    WHEN v_role IN ('pastor', 'leader', 'super_admin') THEN v_user_id
    ELSE v_owner_id
  END;

  IF v_department_owner_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no pertenece a ningun departamento operativo';
  END IF;

  IF v_role = 'cashier' AND v_independent_cash_register THEN
    v_cash_mode := 'independent';
    v_cashier_id := v_user_id;

    SELECT s.id, s.status
    INTO v_active_session_id, v_active_session_status
    FROM public.cash_sessions s
    WHERE s.org_id = v_org_id
      AND s.department_owner_id = v_department_owner_id
      AND s.mode = 'independent'
      AND s.cashier_id = v_user_id
      AND s.status IN ('open', 'pending_validation')
    ORDER BY s.opened_at DESC
    LIMIT 1;
  ELSIF v_role = 'cashier' THEN
    v_cash_mode := 'shared';
    v_cashier_id := NULL;

    SELECT s.id, s.status
    INTO v_active_session_id, v_active_session_status
    FROM public.cash_sessions s
    WHERE s.org_id = v_org_id
      AND s.department_owner_id = v_department_owner_id
      AND s.mode = 'shared'
      AND s.cashier_id IS NULL
      AND s.status IN ('open', 'pending_validation')
    ORDER BY s.opened_at DESC
    LIMIT 1;
  ELSE
    v_cash_mode := 'shared';
    v_cashier_id := NULL;

    SELECT s.id, s.status
    INTO v_active_session_id, v_active_session_status
    FROM public.cash_sessions s
    WHERE s.org_id = v_org_id
      AND s.department_owner_id = v_department_owner_id
      AND s.mode = 'shared'
      AND s.cashier_id IS NULL
      AND s.status IN ('open', 'pending_validation')
    ORDER BY s.opened_at DESC
    LIMIT 1;
  END IF;

  RETURN QUERY SELECT
    v_user_id,
    v_org_id,
    v_role,
    v_department_owner_id,
    v_cash_mode,
    v_cashier_id,
    v_active_session_id,
    v_active_session_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.cash_session_to_json(p_session public.cash_sessions)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT json_build_object(
    'id', p_session.id,
    'org_id', p_session.org_id,
    'department_owner_id', p_session.department_owner_id,
    'cashier_id', p_session.cashier_id,
    'mode', p_session.mode,
    'status', p_session.status,
    'opened_by', p_session.opened_by,
    'opened_at', p_session.opened_at,
    'opening_cash', p_session.opening_cash,
    'preclosed_by', p_session.preclosed_by,
    'preclosed_at', p_session.preclosed_at,
    'approved_by', p_session.approved_by,
    'approved_at', p_session.approved_at,
    'closed_at', p_session.closed_at,
    'cash_counted', p_session.cash_counted,
    'expected_cash', p_session.expected_cash,
    'sales_total', p_session.sales_total,
    'total_cash_sales', p_session.total_cash_sales,
    'total_card_sales', p_session.total_card_sales,
    'total_transfer_sales', p_session.total_transfer_sales,
    'orders_count', p_session.orders_count,
    'difference', p_session.difference,
    'notes', p_session.notes
  );
$$;

DROP FUNCTION IF EXISTS public.get_current_cash_session();

CREATE OR REPLACE FUNCTION public.get_current_cash_session(
  p_mode text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ctx record;
  v_session public.cash_sessions%ROWTYPE;
  v_mode text;
  v_cashier_id uuid;
  v_independent_cash_register boolean;
BEGIN
  SELECT * INTO v_ctx FROM public.resolve_cash_context() LIMIT 1;

  v_mode := COALESCE(NULLIF(trim(p_mode), ''), v_ctx.cash_mode);

  IF v_mode NOT IN ('shared', 'independent') THEN
    RAISE EXCEPTION 'Modo de caja invalido';
  END IF;

  SELECT COALESCE(independent_cash_register, false)
  INTO v_independent_cash_register
  FROM public.profiles
  WHERE id = v_ctx.user_id;

  IF v_mode = 'independent' THEN
    IF v_ctx.role != 'cashier' OR NOT COALESCE(v_independent_cash_register, false) THEN
      RAISE EXCEPTION 'Caja independiente no habilitada para este usuario';
    END IF;
    v_cashier_id := v_ctx.user_id;
  ELSE
    v_cashier_id := NULL;
  END IF;

  SELECT * INTO v_session
  FROM public.cash_sessions
  WHERE org_id = v_ctx.org_id
    AND department_owner_id = v_ctx.department_owner_id
    AND mode = v_mode
    AND (
      (v_mode = 'shared' AND cashier_id IS NULL)
      OR (v_mode = 'independent' AND cashier_id = v_cashier_id)
    )
    AND status IN ('open', 'pending_validation')
  ORDER BY opened_at DESC
  LIMIT 1;

  IF v_session.id IS NULL THEN
    RETURN json_build_object(
      'success', true,
      'cash_mode', v_mode,
      'department_owner_id', v_ctx.department_owner_id,
      'session', NULL
    );
  END IF;

  RETURN json_build_object(
    'success', true,
    'cash_mode', v_mode,
    'department_owner_id', v_ctx.department_owner_id,
    'session', public.cash_session_to_json(v_session)
  );
END;
$$;

DROP FUNCTION IF EXISTS public.open_cash_session(numeric);

CREATE OR REPLACE FUNCTION public.open_cash_session(
  p_mode text,
  p_opening_cash numeric DEFAULT 0
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ctx record;
  v_session public.cash_sessions%ROWTYPE;
  v_mode text;
  v_cashier_id uuid;
  v_independent_cash_register boolean;
BEGIN
  SELECT * INTO v_ctx FROM public.resolve_cash_context() LIMIT 1;

  IF v_ctx.role NOT IN ('cashier', 'leader', 'pastor', 'super_admin') THEN
    RAISE EXCEPTION 'Acceso denegado: El rol "%" no puede abrir caja', v_ctx.role;
  END IF;

  v_mode := NULLIF(trim(p_mode), '');
  IF v_mode NOT IN ('shared', 'independent') THEN
    RAISE EXCEPTION 'Modo de caja invalido';
  END IF;

  IF p_opening_cash IS NULL OR p_opening_cash < 0 THEN
    RAISE EXCEPTION 'Fondo inicial invalido';
  END IF;

  SELECT COALESCE(independent_cash_register, false)
  INTO v_independent_cash_register
  FROM public.profiles
  WHERE id = v_ctx.user_id;

  IF v_mode = 'independent' THEN
    IF v_ctx.role != 'cashier' OR NOT COALESCE(v_independent_cash_register, false) THEN
      RAISE EXCEPTION 'Caja independiente no habilitada para este usuario';
    END IF;
    v_cashier_id := v_ctx.user_id;
  ELSE
    v_cashier_id := NULL;
  END IF;

  SELECT * INTO v_session
  FROM public.cash_sessions
  WHERE org_id = v_ctx.org_id
    AND department_owner_id = v_ctx.department_owner_id
    AND mode = v_mode
    AND (
      (v_mode = 'shared' AND cashier_id IS NULL)
      OR (v_mode = 'independent' AND cashier_id = v_cashier_id)
    )
    AND status IN ('open', 'pending_validation')
  ORDER BY opened_at DESC
  LIMIT 1;

  IF v_session.id IS NOT NULL THEN
    IF v_session.status = 'pending_validation' THEN
      RAISE EXCEPTION 'La caja esta pendiente de validacion. No se puede abrir otra caja todavia.';
    END IF;

    RETURN json_build_object(
      'success', true,
      'action', 'existing',
      'session', public.cash_session_to_json(v_session)
    );
  END IF;

  INSERT INTO public.cash_sessions (
    org_id, department_owner_id, cashier_id, mode, status, opened_by, opening_cash
  ) VALUES (
    v_ctx.org_id, v_ctx.department_owner_id, v_cashier_id, v_mode, 'open', v_ctx.user_id, p_opening_cash
  )
  RETURNING * INTO v_session;

  RETURN json_build_object(
    'success', true,
    'action', 'created',
    'session', public.cash_session_to_json(v_session)
  );
END;
$$;

DROP FUNCTION IF EXISTS public.process_checkout(jsonb, text, numeric, numeric, boolean);

CREATE OR REPLACE FUNCTION public.process_checkout(
  p_items jsonb,
  p_payment_method text DEFAULT 'cash',
  p_paid_with numeric DEFAULT 0,
  p_change numeric DEFAULT 0,
  p_auto_accept boolean DEFAULT false,
  p_mode text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ctx record;
  v_session public.cash_sessions%ROWTYPE;
  v_auto_accept boolean;
  v_order_id bigint;
  v_total numeric := 0;
  v_status text;
  v_op_status text;
  v_item jsonb;
  v_product record;
  v_quantity int;
  v_prod_uuid uuid;
  v_items_arr jsonb := '[]'::jsonb;
  v_mode text;
  v_cashier_id uuid;
  v_independent_cash_register boolean;
BEGIN
  SELECT * INTO v_ctx FROM public.resolve_cash_context() LIMIT 1;

  IF v_ctx.role NOT IN ('cashier', 'leader', 'pastor', 'super_admin') THEN
    RAISE EXCEPTION 'Acceso denegado: El rol "%" no esta autorizado para procesar cobros', v_ctx.role;
  END IF;

  v_mode := COALESCE(NULLIF(trim(p_mode), ''), v_ctx.cash_mode);
  IF v_mode NOT IN ('shared', 'independent') THEN
    RAISE EXCEPTION 'Modo de caja invalido';
  END IF;

  SELECT COALESCE(auto_accept_orders, false)
  INTO v_auto_accept
  FROM public.profiles
  WHERE id = v_ctx.user_id;

  SELECT COALESCE(independent_cash_register, false)
  INTO v_independent_cash_register
  FROM public.profiles
  WHERE id = v_ctx.user_id;

  IF v_mode = 'independent' THEN
    IF v_ctx.role != 'cashier' OR NOT COALESCE(v_independent_cash_register, false) THEN
      RAISE EXCEPTION 'Caja independiente no habilitada para este usuario';
    END IF;
    v_cashier_id := v_ctx.user_id;
  ELSE
    v_cashier_id := NULL;
  END IF;

  SELECT * INTO v_session
  FROM public.cash_sessions
  WHERE org_id = v_ctx.org_id
    AND department_owner_id = v_ctx.department_owner_id
    AND mode = v_mode
    AND (
      (v_mode = 'shared' AND cashier_id IS NULL)
      OR (v_mode = 'independent' AND cashier_id = v_cashier_id)
    )
    AND status = 'open'
  ORDER BY opened_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'Caja no abierta. Abre una caja antes de cobrar.';
  END IF;

  IF p_payment_method IS NULL OR p_payment_method NOT IN ('cash', 'card', 'transfer') THEN
    RAISE EXCEPTION 'Metodo de pago invalido';
  END IF;

  IF p_paid_with IS NULL OR p_change IS NULL OR p_paid_with < 0 OR p_change < 0 THEN
    RAISE EXCEPTION 'Los montos de pago y cambio no pueden ser negativos ni nulos';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) != 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Carrito invalido o vacio';
  END IF;

  v_status := CASE WHEN v_auto_accept THEN 'completed' ELSE 'pending' END;
  v_op_status := CASE WHEN v_auto_accept THEN 'auto_fulfilled' ELSE 'pending' END;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    BEGIN
      v_quantity := (v_item->>'quantity')::int;
      v_prod_uuid := (v_item->>'product_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Item invalido en carrito';
    END;

    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'Cantidad de producto invalida';
    END IF;

    SELECT id, name, price, org_id, department_owner_id
    INTO v_product
    FROM public.products
    WHERE id = v_prod_uuid
      AND org_id = v_ctx.org_id
      AND department_owner_id = v_ctx.department_owner_id
      AND active = true;

    IF v_product IS NULL THEN
      RAISE EXCEPTION 'Producto no encontrado, inactivo, o no pertenece a su departamento';
    END IF;

    v_total := v_total + (v_product.price * v_quantity);
    v_items_arr := v_items_arr || jsonb_build_object(
      'product_id', v_product.id,
      'name', v_product.name,
      'price', v_product.price,
      'quantity', v_quantity,
      'subtotal', v_product.price * v_quantity
    );
  END LOOP;

  IF p_payment_method = 'cash' AND p_paid_with < v_total THEN
    RAISE EXCEPTION 'Monto pagado insuficiente para orden en efectivo';
  END IF;

  INSERT INTO public.orders (
    org_id, department_owner_id, cash_session_id, total, status, operational_status,
    financial_status, paid_with, change, payment_method, created_by
  ) VALUES (
    v_ctx.org_id, v_ctx.department_owner_id, v_session.id, v_total, v_status, v_op_status,
    'paid', p_paid_with, p_change, p_payment_method, v_ctx.user_id
  )
  RETURNING id INTO v_order_id;

  INSERT INTO public.order_items (order_id, product_id, name, price, quantity, subtotal, org_id)
  SELECT
    v_order_id,
    (elem->>'product_id')::uuid,
    elem->>'name',
    (elem->>'price')::numeric,
    (elem->>'quantity')::int,
    (elem->>'subtotal')::numeric,
    v_ctx.org_id
  FROM jsonb_array_elements(v_items_arr) AS elem;

  RETURN json_build_object(
    'success', true,
    'order_id', v_order_id,
    'cash_session_id', v_session.id,
    'total', v_total,
    'status', v_status,
    'operational_status', v_op_status,
    'items_count', jsonb_array_length(v_items_arr),
    'payment_method', p_payment_method
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.pre_close_cash_session(
  p_session_id uuid,
  p_cash_counted numeric,
  p_notes text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ctx record;
  v_session public.cash_sessions%ROWTYPE;
  v_orders_count integer;
  v_sales_total numeric;
  v_cash_sales numeric;
  v_card_sales numeric;
  v_transfer_sales numeric;
  v_expected_cash numeric;
  v_difference numeric;
BEGIN
  SELECT * INTO v_ctx FROM public.resolve_cash_context() LIMIT 1;

  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'Sesion de caja requerida';
  END IF;

  IF p_cash_counted IS NULL OR p_cash_counted < 0 THEN
    RAISE EXCEPTION 'Efectivo contado invalido';
  END IF;

  SELECT * INTO v_session
  FROM public.cash_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF v_session.id IS NULL OR v_session.org_id IS DISTINCT FROM v_ctx.org_id THEN
    RAISE EXCEPTION 'Sesion de caja no encontrada';
  END IF;

  IF v_session.status != 'open' THEN
    RAISE EXCEPTION 'La caja no esta abierta';
  END IF;

  IF NOT (
    v_ctx.role IN ('super_admin', 'pastor')
    OR (v_ctx.role = 'leader' AND v_session.department_owner_id = v_ctx.department_owner_id)
    OR (
      v_ctx.role = 'cashier'
      AND (
        (v_session.mode = 'independent' AND v_session.cashier_id = v_ctx.user_id)
        OR (v_session.mode = 'shared' AND v_session.opened_by = v_ctx.user_id)
      )
    )
  ) THEN
    RAISE EXCEPTION 'Acceso denegado para pre-cerrar esta caja';
  END IF;

  SELECT
    COUNT(*),
    COALESCE(SUM(total), 0),
    COALESCE(SUM(total) FILTER (WHERE payment_method = 'cash' OR payment_method IS NULL), 0),
    COALESCE(SUM(total) FILTER (WHERE payment_method = 'card'), 0),
    COALESCE(SUM(total) FILTER (WHERE payment_method = 'transfer'), 0)
  INTO v_orders_count, v_sales_total, v_cash_sales, v_card_sales, v_transfer_sales
  FROM public.orders
  WHERE cash_session_id = v_session.id
    AND financial_status = 'paid';

  v_expected_cash := v_session.opening_cash + v_cash_sales;
  v_difference := p_cash_counted - v_expected_cash;

  UPDATE public.cash_sessions
  SET
    status = 'pending_validation',
    preclosed_by = v_ctx.user_id,
    preclosed_at = now(),
    cash_counted = p_cash_counted,
    expected_cash = v_expected_cash,
    sales_total = v_sales_total,
    total_cash_sales = v_cash_sales,
    total_card_sales = v_card_sales,
    total_transfer_sales = v_transfer_sales,
    orders_count = v_orders_count,
    difference = v_difference,
    notes = p_notes,
    updated_at = now()
  WHERE id = v_session.id
  RETURNING * INTO v_session;

  RETURN json_build_object(
    'success', true,
    'action', 'pending_validation',
    'session', public.cash_session_to_json(v_session)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_cash_session(
  p_session_id uuid,
  p_notes text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ctx record;
  v_session public.cash_sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_ctx FROM public.resolve_cash_context() LIMIT 1;

  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'Sesion de caja requerida';
  END IF;

  SELECT * INTO v_session
  FROM public.cash_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF v_session.id IS NULL OR v_session.org_id IS DISTINCT FROM v_ctx.org_id THEN
    RAISE EXCEPTION 'Sesion de caja no encontrada';
  END IF;

  IF v_session.status != 'pending_validation' THEN
    RAISE EXCEPTION 'La caja no esta pendiente de validacion';
  END IF;

  IF NOT (
    v_ctx.role IN ('super_admin', 'pastor')
    OR (v_ctx.role = 'leader' AND v_session.department_owner_id = v_ctx.department_owner_id)
  ) THEN
    RAISE EXCEPTION 'Acceso denegado para aprobar esta caja';
  END IF;

  UPDATE public.cash_sessions
  SET
    status = 'closed',
    approved_by = v_ctx.user_id,
    approved_at = now(),
    closed_at = now(),
    notes = COALESCE(NULLIF(trim(p_notes), ''), notes),
    updated_at = now()
  WHERE id = v_session.id
  RETURNING * INTO v_session;

  RETURN json_build_object(
    'success', true,
    'action', 'closed',
    'session', public.cash_session_to_json(v_session)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_cash_context() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cash_session_to_json(public.cash_sessions) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_current_cash_session(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.open_cash_session(text, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_checkout(jsonb, text, numeric, numeric, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pre_close_cash_session(uuid, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_cash_session(uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.resolve_cash_context() TO authenticated;
GRANT EXECUTE ON FUNCTION public.cash_session_to_json(public.cash_sessions) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_current_cash_session(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.open_cash_session(text, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_checkout(jsonb, text, numeric, numeric, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pre_close_cash_session(uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_cash_session(uuid, text) TO authenticated;
