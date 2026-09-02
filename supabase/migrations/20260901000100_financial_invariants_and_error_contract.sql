-- ==============================================================================
-- MIGRACIÓN: 20260901000100_financial_invariants_and_error_contract.sql
-- DESCRIPCIÓN: Endurecimiento de invariantes financieras, aislamiento de
--              onboarding y catálogo canónico de errores (ACV_*).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. HARDENING DE ONBOARDING: setup_new_tenant
-- ------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.setup_new_tenant(text, text, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.setup_new_tenant(
  p_church_name text,
  p_church_slug text,
  p_full_name text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_org_id uuid;
  v_user_email text;
  v_existing_org_id uuid;
  v_profile_exists boolean := false;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'ACV_TENANT_UNAUTHENTICATED';
  END IF;

  IF NULLIF(trim(p_church_name), '') IS NULL
     OR NULLIF(trim(p_church_slug), '') IS NULL
     OR NULLIF(trim(p_full_name), '') IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'ACV_TENANT_INVALID_INPUT';
  END IF;

  -- Serializa reintentos concurrentes para el mismo usuario
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  SELECT p.org_id
    INTO v_existing_org_id
  FROM public.profiles AS p
  WHERE p.id = v_user_id
  FOR UPDATE;

  v_profile_exists := FOUND;

  -- Una identidad ya asignada no puede reescribir su perfil ni crear otra org raíz
  IF v_profile_exists AND v_existing_org_id IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'ACV_TENANT_PROFILE_ALREADY_ASSIGNED';
  END IF;

  SELECT u.email
    INTO v_user_email
  FROM auth.users AS u
  WHERE u.id = v_user_id;

  IF v_user_email IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'ACV_TENANT_IDENTITY_INVALID';
  END IF;

  INSERT INTO public.organizations (
    name, slug, plan, status, max_users, owner_id
  )
  VALUES (
    trim(p_church_name), trim(p_church_slug), 'free', 'trial', 3, NULL
  )
  RETURNING id INTO v_org_id;

  INSERT INTO public.profiles (
    id, email, role, org_id, owner_id, display_name, onboarding_completed
  )
  VALUES (
    v_user_id, v_user_email, 'pastor'::public.app_role, v_org_id,
    NULL, trim(p_full_name), false
  )
  ON CONFLICT (id) DO UPDATE
  SET
    email = EXCLUDED.email,
    role = EXCLUDED.role,
    org_id = EXCLUDED.org_id,
    owner_id = NULL,
    display_name = EXCLUDED.display_name,
    onboarding_completed = false;

  UPDATE public.organizations
  SET owner_id = v_user_id
  WHERE id = v_org_id;

  RETURN json_build_object('success', true, 'org_id', v_org_id);

EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'ACV_TENANT_SLUG_TAKEN';
END;
$$;

GRANT EXECUTE ON FUNCTION public.setup_new_tenant(text, text, text) TO authenticated;


-- ------------------------------------------------------------------------------
-- 2. HARDENING DE CHECKOUT TRANSACCIONAL: process_checkout
-- ------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.process_checkout(jsonb, text, numeric, numeric, boolean, text) FROM PUBLIC;

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
  v_paid_with numeric;
  v_change numeric;
BEGIN
  SELECT * INTO v_ctx FROM public.resolve_cash_context() LIMIT 1;

  IF v_ctx.role NOT IN ('cashier', 'leader', 'pastor', 'super_admin') THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'ACV_CHECKOUT_FORBIDDEN';
  END IF;

  v_mode := COALESCE(NULLIF(trim(p_mode), ''), v_ctx.cash_mode);
  IF v_mode NOT IN ('shared', 'independent') THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'ACV_CHECKOUT_INVALID_MODE';
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
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'ACV_CHECKOUT_INDEPENDENT_NOT_ENABLED';
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
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'ACV_CHECKOUT_CASH_SESSION_NOT_OPEN';
  END IF;

  IF p_payment_method IS NULL OR p_payment_method NOT IN ('cash', 'card', 'transfer') THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'ACV_CHECKOUT_INVALID_PAYMENT_METHOD';
  END IF;

  IF p_paid_with IS NULL
     OR p_paid_with = 'NaN'::numeric
     OR p_paid_with < 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'ACV_CHECKOUT_INVALID_PAYMENT_AMOUNT';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) != 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'ACV_CHECKOUT_CART_INVALID';
  END IF;

  v_status := CASE WHEN v_auto_accept THEN 'completed' ELSE 'pending' END;
  v_op_status := CASE WHEN v_auto_accept THEN 'auto_fulfilled' ELSE 'pending' END;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    BEGIN
      v_quantity := (v_item->>'quantity')::int;
      v_prod_uuid := (v_item->>'product_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'ACV_CHECKOUT_ITEM_INVALID';
    END;

    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'ACV_CHECKOUT_ITEM_INVALID';
    END IF;

    SELECT id, name, price, org_id, department_owner_id
    INTO v_product
    FROM public.products
    WHERE id = v_prod_uuid
      AND org_id = v_ctx.org_id
      AND department_owner_id = v_ctx.department_owner_id
      AND active = true;

    IF v_product IS NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'ACV_CHECKOUT_PRODUCT_UNAVAILABLE';
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

  -- Canonicalización estricta de efectivo y cambio en el servidor
  IF p_payment_method = 'cash' THEN
    IF p_paid_with < v_total THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'ACV_CHECKOUT_CASH_INSUFFICIENT';
    END IF;

    v_paid_with := p_paid_with;
    v_change := v_paid_with - v_total;
  ELSE
    -- Tarjeta y transferencia liquidan exactamente el total recalculado por PostgreSQL
    v_paid_with := v_total;
    v_change := 0;
  END IF;

  INSERT INTO public.orders (
    org_id, department_owner_id, cash_session_id, total, status, operational_status,
    financial_status, paid_with, change, payment_method, created_by
  ) VALUES (
    v_ctx.org_id, v_ctx.department_owner_id, v_session.id, v_total, v_status, v_op_status,
    'paid', v_paid_with, v_change, p_payment_method, v_ctx.user_id
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
    'paid_with', v_paid_with,
    'change', v_change,
    'status', v_status,
    'operational_status', v_op_status,
    'items_count', jsonb_array_length(v_items_arr),
    'payment_method', p_payment_method
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_checkout(jsonb, text, numeric, numeric, boolean, text) TO authenticated;
