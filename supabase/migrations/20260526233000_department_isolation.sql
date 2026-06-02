-- ============================================================================
-- P0: Department isolation inside one pastor organization
-- ============================================================================
-- Model:
--   org_id              = tenant boundary (pastor's organization / church)
--   department_owner_id = department boundary (leader, or pastor for direct ops)
--
-- Goal:
--   Pastor sees the whole organization.
--   Leaders and their staff see/operate only their own department.
--   Departments cannot read or mutate each other's orders/products/closures.
-- ============================================================================

-- 1. Add explicit department boundary columns.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS department_owner_id uuid REFERENCES public.profiles(id);

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS department_owner_id uuid REFERENCES public.profiles(id);

ALTER TABLE public.cash_closures
  ADD COLUMN IF NOT EXISTS department_owner_id uuid REFERENCES public.profiles(id);

CREATE INDEX IF NOT EXISTS idx_products_org_department
  ON public.products(org_id, department_owner_id, active);

CREATE INDEX IF NOT EXISTS idx_orders_org_department_created
  ON public.orders(org_id, department_owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cash_closures_org_department_date
  ON public.cash_closures(org_id, department_owner_id, closure_date DESC);

-- 2. Resolve current user's department.
--    Pastor and leader own their own operating department.
--    Cashier/kitchen inherit owner_id, which should be their leader or pastor.
CREATE OR REPLACE FUNCTION public.get_my_department_owner()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p.role::text IN ('pastor', 'leader', 'super_admin') THEN p.id
    ELSE p.owner_id
  END
  FROM public.profiles p
  WHERE p.id = auth.uid();
$$;

-- 3. Default department for products created from the UI.
CREATE OR REPLACE FUNCTION public.set_product_department_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_department_owner_id uuid;
BEGIN
  IF NEW.department_owner_id IS NULL THEN
    v_department_owner_id := public.get_my_department_owner();
    IF v_department_owner_id IS NULL THEN
      RAISE EXCEPTION 'No se pudo resolver el departamento del usuario';
    END IF;
    NEW.department_owner_id := v_department_owner_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS products_department_owner_trigger ON public.products;
CREATE TRIGGER products_department_owner_trigger
BEFORE INSERT ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.set_product_department_owner();

-- 4. Backfill existing rows conservatively.
--    If created_by/closed_by points to a leader, that leader is the department.
--    If it points to staff, staff.owner_id is the department.
--    Ambiguous legacy rows are assigned to the org owner/pastor/first leader so
--    the migration never invents a cross-department relationship.
WITH product_departments AS (
  SELECT
    p.id AS product_id,
    (
      SELECT pr.id
      FROM public.profiles pr
      LEFT JOIN public.organizations org ON org.id = p.org_id
      WHERE pr.org_id = p.org_id
        AND (
          pr.id = org.owner_id
          OR pr.role::text IN ('pastor', 'leader', 'super_admin')
        )
      ORDER BY
        CASE
          WHEN pr.id = org.owner_id THEN 0
          WHEN pr.role::text = 'pastor' THEN 1
          WHEN pr.role::text = 'leader' THEN 2
          ELSE 3
        END,
        pr.created_at ASC NULLS LAST
      LIMIT 1
    ) AS department_owner_id
  FROM public.products p
  WHERE p.department_owner_id IS NULL
)
UPDATE public.products p
SET department_owner_id = pd.department_owner_id
FROM product_departments pd
WHERE p.id = pd.product_id
  AND pd.department_owner_id IS NOT NULL;

WITH order_departments AS (
  SELECT
    o.id AS order_id,
    COALESCE(
      CASE
        WHEN creator.role::text IN ('pastor', 'leader', 'super_admin') THEN creator.id
        ELSE creator.owner_id
      END,
      (
        SELECT pr.id
        FROM public.profiles pr
        LEFT JOIN public.organizations org ON org.id = o.org_id
        WHERE pr.org_id = o.org_id
          AND (
            pr.id = org.owner_id
            OR pr.role::text IN ('pastor', 'leader', 'super_admin')
          )
        ORDER BY
          CASE
            WHEN pr.id = org.owner_id THEN 0
            WHEN pr.role::text = 'pastor' THEN 1
            WHEN pr.role::text = 'leader' THEN 2
            ELSE 3
          END,
          pr.created_at ASC NULLS LAST
        LIMIT 1
      )
    ) AS department_owner_id
  FROM public.orders o
  LEFT JOIN public.profiles creator ON creator.id = o.created_by
  WHERE o.department_owner_id IS NULL
)
UPDATE public.orders o
SET department_owner_id = od.department_owner_id
FROM order_departments od
WHERE o.id = od.order_id
  AND od.department_owner_id IS NOT NULL;

WITH closure_departments AS (
  SELECT
    c.id AS closure_id,
    COALESCE(
      CASE
        WHEN closer.role::text IN ('pastor', 'leader', 'super_admin') THEN closer.id
        ELSE closer.owner_id
      END,
      (
        SELECT pr.id
        FROM public.profiles pr
        LEFT JOIN public.organizations org ON org.id = c.org_id
        WHERE pr.org_id = c.org_id
          AND (
            pr.id = org.owner_id
            OR pr.role::text IN ('pastor', 'leader', 'super_admin')
          )
        ORDER BY
          CASE
            WHEN pr.id = org.owner_id THEN 0
            WHEN pr.role::text = 'pastor' THEN 1
            WHEN pr.role::text = 'leader' THEN 2
            ELSE 3
          END,
          pr.created_at ASC NULLS LAST
        LIMIT 1
      )
    ) AS department_owner_id
  FROM public.cash_closures c
  LEFT JOIN public.profiles closer ON closer.id = c.closed_by
  WHERE c.department_owner_id IS NULL
)
UPDATE public.cash_closures c
SET department_owner_id = cd.department_owner_id
FROM closure_departments cd
WHERE c.id = cd.closure_id
  AND cd.department_owner_id IS NOT NULL;

DO $$
DECLARE
  v_count integer;
BEGIN
  IF EXISTS (SELECT 1 FROM public.products WHERE department_owner_id IS NULL) THEN
    SELECT COUNT(*) INTO v_count FROM public.products WHERE department_owner_id IS NULL;
    RAISE EXCEPTION 'Department isolation migration blocked: % products still have no valid organization owner, pastor, or leader profile.', v_count;
  END IF;

  IF EXISTS (SELECT 1 FROM public.orders WHERE department_owner_id IS NULL) THEN
    SELECT COUNT(*) INTO v_count FROM public.orders WHERE department_owner_id IS NULL;
    RAISE EXCEPTION 'Department isolation migration blocked: % orders still have no valid department owner.', v_count;
  END IF;

  IF EXISTS (SELECT 1 FROM public.cash_closures WHERE department_owner_id IS NULL) THEN
    SELECT COUNT(*) INTO v_count FROM public.cash_closures WHERE department_owner_id IS NULL;
    RAISE EXCEPTION 'Department isolation migration blocked: % cash closures still have no valid department owner.', v_count;
  END IF;
END;
$$;

ALTER TABLE public.products
  ALTER COLUMN department_owner_id SET NOT NULL;

ALTER TABLE public.orders
  ALTER COLUMN department_owner_id SET NOT NULL;

ALTER TABLE public.cash_closures
  ALTER COLUMN department_owner_id SET NOT NULL;

-- 5. Replace product RLS with department-aware policies.
DROP POLICY IF EXISTS "Staff can manage org products" ON public.products;
DROP POLICY IF EXISTS "Staff can select org products" ON public.products;
DROP POLICY IF EXISTS "Staff can insert org products" ON public.products;
DROP POLICY IF EXISTS "Staff can update org products" ON public.products;
DROP POLICY IF EXISTS "Leaders can delete org products" ON public.products;

CREATE POLICY "products_select_by_department"
ON public.products FOR SELECT TO public
USING (
  public.get_my_role() = 'super_admin'
  OR (
    org_id = public.get_my_org()
    AND (
      public.get_my_role() = 'pastor'
      OR department_owner_id = public.get_my_department_owner()
    )
  )
);

CREATE POLICY "products_insert_by_department"
ON public.products FOR INSERT TO public
WITH CHECK (
  public.get_my_role() = 'super_admin'
  OR (
    org_id = public.get_my_org()
    AND department_owner_id = public.get_my_department_owner()
    AND public.get_my_role() IN ('pastor', 'leader', 'cashier', 'kitchen')
  )
);

CREATE POLICY "products_update_by_department"
ON public.products FOR UPDATE TO public
USING (
  public.get_my_role() = 'super_admin'
  OR (
    org_id = public.get_my_org()
    AND department_owner_id = public.get_my_department_owner()
    AND public.get_my_role() IN ('pastor', 'leader', 'cashier', 'kitchen')
  )
)
WITH CHECK (
  public.get_my_role() = 'super_admin'
  OR (
    org_id = public.get_my_org()
    AND department_owner_id = public.get_my_department_owner()
  )
);

CREATE POLICY "products_delete_by_department"
ON public.products FOR DELETE TO public
USING (
  public.get_my_role() = 'super_admin'
  OR (
    org_id = public.get_my_org()
    AND department_owner_id = public.get_my_department_owner()
    AND public.get_my_role() IN ('pastor', 'leader')
  )
);

-- 6. Replace order RLS with department-aware policies.
DROP POLICY IF EXISTS "Kitchen can update order status" ON public.orders;
DROP POLICY IF EXISTS "Leaders can manage org orders" ON public.orders;
DROP POLICY IF EXISTS "Pastor can manage org orders" ON public.orders;
DROP POLICY IF EXISTS "Staff can create orders" ON public.orders;
DROP POLICY IF EXISTS "Staff can view org orders" ON public.orders;

CREATE POLICY "orders_select_by_department"
ON public.orders FOR SELECT TO public
USING (
  public.get_my_role() = 'super_admin'
  OR (
    org_id = public.get_my_org()
    AND (
      public.get_my_role() = 'pastor'
      OR department_owner_id = public.get_my_department_owner()
    )
  )
);

CREATE POLICY "orders_insert_by_department"
ON public.orders FOR INSERT TO public
WITH CHECK (
  public.get_my_role() = 'super_admin'
  OR (
    org_id = public.get_my_org()
    AND department_owner_id = public.get_my_department_owner()
    AND public.get_my_role() IN ('cashier', 'kitchen', 'leader', 'pastor')
  )
);

CREATE POLICY "orders_update_by_department"
ON public.orders FOR UPDATE TO public
USING (
  public.get_my_role() = 'super_admin'
  OR (
    org_id = public.get_my_org()
    AND (
      public.get_my_role() = 'pastor'
      OR department_owner_id = public.get_my_department_owner()
    )
  )
)
WITH CHECK (
  public.get_my_role() = 'super_admin'
  OR (
    org_id = public.get_my_org()
    AND (
      public.get_my_role() = 'pastor'
      OR department_owner_id = public.get_my_department_owner()
    )
  )
);

-- 7. Replace order item RLS with department-aware policies.
DROP POLICY IF EXISTS "order_items_delete_by_org" ON public.order_items;
DROP POLICY IF EXISTS "order_items_insert_by_org" ON public.order_items;
DROP POLICY IF EXISTS "order_items_select_by_org" ON public.order_items;
DROP POLICY IF EXISTS "order_items_update_by_org" ON public.order_items;

CREATE POLICY "order_items_select_by_department"
ON public.order_items FOR SELECT TO public
USING (
  public.get_my_role() = 'super_admin'
  OR EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id = order_items.order_id
      AND o.org_id = public.get_my_org()
      AND (
        public.get_my_role() = 'pastor'
        OR o.department_owner_id = public.get_my_department_owner()
      )
  )
);

CREATE POLICY "order_items_insert_by_department"
ON public.order_items FOR INSERT TO public
WITH CHECK (
  public.get_my_role() = 'super_admin'
  OR EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id = order_items.order_id
      AND o.org_id = public.get_my_org()
      AND (
        public.get_my_role() = 'pastor'
        OR o.department_owner_id = public.get_my_department_owner()
      )
  )
);

CREATE POLICY "order_items_update_by_department"
ON public.order_items FOR UPDATE TO public
USING (
  public.get_my_role() = 'super_admin'
  OR EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id = order_items.order_id
      AND o.org_id = public.get_my_org()
      AND (
        public.get_my_role() = 'pastor'
        OR o.department_owner_id = public.get_my_department_owner()
      )
  )
)
WITH CHECK (
  public.get_my_role() = 'super_admin'
  OR EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id = order_items.order_id
      AND o.org_id = public.get_my_org()
      AND (
        public.get_my_role() = 'pastor'
        OR o.department_owner_id = public.get_my_department_owner()
      )
  )
);

CREATE POLICY "order_items_delete_by_department"
ON public.order_items FOR DELETE TO public
USING (
  public.get_my_role() = 'super_admin'
  OR EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id = order_items.order_id
      AND o.org_id = public.get_my_org()
      AND (
        public.get_my_role() = 'pastor'
        OR o.department_owner_id = public.get_my_department_owner()
      )
  )
);

-- 8. Replace cash closure uniqueness and RLS.
ALTER TABLE public.cash_closures
  DROP CONSTRAINT IF EXISTS unique_org_closure_date;

ALTER TABLE public.cash_closures
  ADD CONSTRAINT unique_org_department_closure_date
  UNIQUE (org_id, department_owner_id, closure_date);

DROP POLICY IF EXISTS "Members view own org closures" ON public.cash_closures;
DROP POLICY IF EXISTS "Staff can insert closures" ON public.cash_closures;
DROP POLICY IF EXISTS "Superadmin all closures" ON public.cash_closures;

CREATE POLICY "cash_closures_select_by_department"
ON public.cash_closures FOR SELECT TO public
USING (
  public.get_my_role() = 'super_admin'
  OR (
    org_id = public.get_my_org()
    AND (
      public.get_my_role() = 'pastor'
      OR department_owner_id = public.get_my_department_owner()
    )
  )
);

CREATE POLICY "cash_closures_insert_by_department"
ON public.cash_closures FOR INSERT TO public
WITH CHECK (
  public.get_my_role() = 'super_admin'
  OR (
    org_id = public.get_my_org()
    AND department_owner_id = public.get_my_department_owner()
    AND public.get_my_role() IN ('cashier', 'leader', 'pastor')
  )
);

CREATE POLICY "cash_closures_update_by_department"
ON public.cash_closures FOR UPDATE TO public
USING (
  public.get_my_role() = 'super_admin'
  OR (
    org_id = public.get_my_org()
    AND (
      public.get_my_role() = 'pastor'
      OR department_owner_id = public.get_my_department_owner()
    )
  )
)
WITH CHECK (
  public.get_my_role() = 'super_admin'
  OR (
    org_id = public.get_my_org()
    AND (
      public.get_my_role() = 'pastor'
      OR department_owner_id = public.get_my_department_owner()
    )
  )
);

-- 9. Department-aware checkout.
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
  v_order_id   bigint;
  v_total      numeric := 0;
  v_status     text;
  v_op_status  text;
  v_item       jsonb;
  v_product    record;
  v_quantity   int;
  v_prod_uuid  uuid;
  v_items_arr  jsonb := '[]'::jsonb;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT org_id, role, owner_id, auto_accept_orders
  INTO v_org_id, v_role, v_owner_id, v_auto_accept
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no pertenece a ninguna organizaciÃ³n';
  END IF;

  IF v_role NOT IN ('cashier', 'leader', 'pastor', 'super_admin') THEN
    RAISE EXCEPTION 'Acceso denegado: El rol "%" no estÃ¡ autorizado para procesar cobros', v_role;
  END IF;

  v_department_owner_id := CASE
    WHEN v_role IN ('pastor', 'leader', 'super_admin') THEN v_user_id
    ELSE v_owner_id
  END;

  IF v_department_owner_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no pertenece a ningÃºn departamento operativo';
  END IF;

  IF p_payment_method IS NULL OR p_payment_method NOT IN ('cash', 'card', 'transfer') THEN
    RAISE EXCEPTION 'MÃ©todo de pago invÃ¡lido';
  END IF;

  IF p_paid_with IS NULL OR p_change IS NULL OR p_paid_with < 0 OR p_change < 0 THEN
    RAISE EXCEPTION 'Los montos de pago y cambio no pueden ser negativos ni nulos';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) != 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Carrito invÃ¡lido o vacÃ­o';
  END IF;

  v_status := CASE WHEN v_auto_accept THEN 'completed' ELSE 'pending' END;
  v_op_status := CASE WHEN v_auto_accept THEN 'auto_fulfilled' ELSE 'pending' END;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    BEGIN
      v_quantity := (v_item->>'quantity')::int;
      v_prod_uuid := (v_item->>'product_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Item invÃ¡lido en carrito';
    END;

    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'Cantidad de producto invÃ¡lida';
    END IF;

    SELECT id, name, price, org_id, department_owner_id
    INTO v_product
    FROM public.products
    WHERE id = v_prod_uuid
      AND org_id = v_org_id
      AND department_owner_id = v_department_owner_id
      AND active = true;

    IF v_product IS NULL THEN
      RAISE EXCEPTION 'Producto no encontrado, inactivo, o no pertenece a su departamento';
    END IF;

    v_total := v_total + (v_product.price * v_quantity);
    v_items_arr := v_items_arr || jsonb_build_object(
      'product_id', v_product.id,
      'name',       v_product.name,
      'price',      v_product.price,
      'quantity',   v_quantity,
      'subtotal',   v_product.price * v_quantity
    );
  END LOOP;

  IF p_payment_method = 'cash' AND p_paid_with < v_total THEN
    RAISE EXCEPTION 'Monto pagado insuficiente para orden en efectivo';
  END IF;

  INSERT INTO public.orders (
    org_id, department_owner_id, total, status, operational_status,
    financial_status, paid_with, change, payment_method, created_by
  ) VALUES (
    v_org_id, v_department_owner_id, v_total, v_status, v_op_status,
    'paid', p_paid_with, p_change, p_payment_method, v_user_id
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
    v_org_id
  FROM jsonb_array_elements(v_items_arr) AS elem;

  RETURN json_build_object(
    'success', true,
    'order_id', v_order_id,
    'total', v_total,
    'status', v_status,
    'operational_status', v_op_status,
    'items_count', jsonb_array_length(v_items_arr),
    'payment_method', p_payment_method
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_checkout(jsonb, text, numeric, numeric, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_checkout(jsonb, text, numeric, numeric, boolean) TO authenticated;

-- 10. Department-aware KDS updates.
CREATE OR REPLACE FUNCTION public.update_kitchen_status(
  p_order_id bigint,
  p_new_status text,
  p_reason text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_org_id uuid;
  v_role text;
  v_department_owner_id uuid;
  v_order_org_id uuid;
  v_order_department_owner_id uuid;
  v_current_op_status text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT org_id, role, public.get_my_department_owner()
  INTO v_org_id, v_role, v_department_owner_id
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_org_id IS NULL OR v_department_owner_id IS NULL THEN
    RAISE EXCEPTION 'Acceso denegado: Usuario no tiene organizaciÃ³n o departamento';
  END IF;

  IF v_role NOT IN ('kitchen', 'leader', 'pastor', 'super_admin') THEN
    RAISE EXCEPTION 'Acceso denegado: El rol "%" no puede operar KDS', v_role;
  END IF;

  SELECT org_id, department_owner_id, operational_status
  INTO v_order_org_id, v_order_department_owner_id, v_current_op_status
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order_org_id IS NULL THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;

  IF v_order_org_id != v_org_id THEN
    RAISE EXCEPTION 'Acceso denegado: Orden de otra organizaciÃ³n';
  END IF;

  IF v_role NOT IN ('pastor', 'super_admin')
     AND v_order_department_owner_id IS DISTINCT FROM v_department_owner_id THEN
    RAISE EXCEPTION 'Acceso denegado: Orden de otro departamento';
  END IF;

  IF v_current_op_status != 'pending' THEN
    RAISE EXCEPTION 'TransiciÃ³n invÃ¡lida: La orden ya fue procesada (estado actual: %)', v_current_op_status;
  END IF;

  IF p_new_status NOT IN ('completed', 'kitchen_rejected', 'kitchen_cancelled') THEN
    RAISE EXCEPTION 'TransiciÃ³n invÃ¡lida o no permitida desde KDS';
  END IF;

  UPDATE public.orders
  SET
    operational_status = p_new_status,
    rejection_reason = CASE WHEN p_new_status IN ('kitchen_rejected', 'kitchen_cancelled') THEN p_reason ELSE rejection_reason END,
    financial_review_required = CASE WHEN p_new_status IN ('kitchen_rejected', 'kitchen_cancelled') THEN true ELSE financial_review_required END,
    status = CASE
      WHEN p_new_status = 'completed' THEN 'completed'
      WHEN p_new_status = 'kitchen_rejected' THEN 'rejected'
      WHEN p_new_status = 'kitchen_cancelled' THEN 'cancelled'
    END,
    updated_at = now()
  WHERE id = p_order_id;

  RETURN json_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.update_kitchen_status(bigint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_kitchen_status(bigint, text, text) TO authenticated;

-- 11. Department-aware cash closure.
CREATE OR REPLACE FUNCTION public.save_cash_closure(
  p_closure_date  date,
  p_opening_cash  numeric,
  p_cash_counted  numeric,
  p_notes         text     DEFAULT NULL,
  p_revision_note text     DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id         uuid;
  v_org_id          uuid;
  v_role            text;
  v_department_owner_id uuid;
  v_existing_id     uuid;
  v_day_start       timestamptz;
  v_day_end         timestamptz;
  v_orders_count    integer;
  v_sales_total     numeric;
  v_cash_sales      numeric;
  v_card_sales      numeric;
  v_transfer_sales  numeric;
  v_expected_cash   numeric;
  v_difference      numeric;
  v_result_id       uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT org_id, role, public.get_my_department_owner()
  INTO v_org_id, v_role, v_department_owner_id
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_org_id IS NULL OR v_department_owner_id IS NULL THEN
    RAISE EXCEPTION 'Acceso denegado: Usuario no tiene organizaciÃ³n o departamento';
  END IF;

  IF v_role NOT IN ('cashier', 'leader', 'pastor', 'super_admin') THEN
    RAISE EXCEPTION 'Acceso denegado: El rol "%" no estÃ¡ autorizado para corte de caja', v_role;
  END IF;

  IF p_closure_date IS NULL THEN
    RAISE EXCEPTION 'Fecha de cierre requerida';
  END IF;

  IF p_opening_cash IS NULL OR p_opening_cash < 0 OR p_cash_counted IS NULL OR p_cash_counted < 0 THEN
    RAISE EXCEPTION 'Montos de corte invÃ¡lidos';
  END IF;

  v_day_start := p_closure_date::timestamp AT TIME ZONE 'America/Mexico_City';
  v_day_end   := (p_closure_date + 1)::timestamp AT TIME ZONE 'America/Mexico_City';

  SELECT
    COUNT(*),
    COALESCE(SUM(total), 0),
    COALESCE(SUM(total) FILTER (WHERE payment_method = 'cash' OR payment_method IS NULL), 0),
    COALESCE(SUM(total) FILTER (WHERE payment_method = 'card'), 0),
    COALESCE(SUM(total) FILTER (WHERE payment_method = 'transfer'), 0)
  INTO v_orders_count, v_sales_total, v_cash_sales, v_card_sales, v_transfer_sales
  FROM public.orders
  WHERE org_id = v_org_id
    AND department_owner_id = v_department_owner_id
    AND financial_status = 'paid'
    AND created_at >= v_day_start
    AND created_at < v_day_end;

  v_expected_cash := p_opening_cash + v_cash_sales;
  v_difference    := p_cash_counted - v_expected_cash;

  SELECT id INTO v_existing_id
  FROM public.cash_closures
  WHERE org_id = v_org_id
    AND department_owner_id = v_department_owner_id
    AND closure_date = p_closure_date
  FOR UPDATE;

  IF v_existing_id IS NULL THEN
    INSERT INTO public.cash_closures (
      org_id, department_owner_id, closed_by, closure_date,
      opening_cash, sales_total, cash_counted, expected_cash, difference,
      total_cash_sales, total_card_sales, total_transfer_sales,
      orders_count, notes, created_at
    ) VALUES (
      v_org_id, v_department_owner_id, v_user_id, p_closure_date,
      p_opening_cash, v_sales_total, p_cash_counted, v_expected_cash, v_difference,
      v_cash_sales, v_card_sales, v_transfer_sales,
      v_orders_count, p_notes, now()
    )
    RETURNING id INTO v_result_id;

    RETURN json_build_object('success', true, 'action', 'created', 'closure_id', v_result_id);
  ELSE
    IF p_revision_note IS NULL OR trim(p_revision_note) = '' THEN
      RAISE EXCEPTION 'Se requiere motivo de correcciÃ³n (revision_note) para actualizar un corte existente';
    END IF;

    UPDATE public.cash_closures SET
      opening_cash = p_opening_cash,
      sales_total = v_sales_total,
      cash_counted = p_cash_counted,
      expected_cash = v_expected_cash,
      difference = v_difference,
      total_cash_sales = v_cash_sales,
      total_card_sales = v_card_sales,
      total_transfer_sales = v_transfer_sales,
      orders_count = v_orders_count,
      notes = p_notes,
      updated_at = now(),
      updated_by = v_user_id,
      revision_note = p_revision_note
    WHERE id = v_existing_id;

    RETURN json_build_object('success', true, 'action', 'corrected', 'closure_id', v_existing_id);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.save_cash_closure(date, numeric, numeric, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_cash_closure(date, numeric, numeric, text, text) TO authenticated;
