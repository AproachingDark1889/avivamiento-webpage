-- ============================================================================
-- MIGRACIÃ“N: RLS Hardening + RPC process_checkout
-- Fecha: 2026-05-07
-- Fuente: AuditorÃ­a ArquitectÃ³nica (Vectores 3 y 4) + Mapa TÃ©cnico Frontend
-- ============================================================================


-- ============================================================================
-- SECCIÃ“N 1: RLS tabla profiles
-- ============================================================================
-- Problema: Las polÃ­ticas SELECT actuales no filtran por org_id de forma
-- consistente. Un usuario autenticado con curl podrÃ­a leer perfiles de
-- otras organizaciones si bypasea el frontend.
-- ============================================================================

-- 1a. Eliminar polÃ­ticas SELECT que no fuerzan org_id
DROP POLICY IF EXISTS "Hierarchy read access"           ON public.profiles;
DROP POLICY IF EXISTS "Leaders can view org profiles"   ON public.profiles;
DROP POLICY IF EXISTS "Pastor can view all profiles"    ON public.profiles;
DROP POLICY IF EXISTS "Super Admin can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile"      ON public.profiles;

-- 1b. PolÃ­tica SELECT unificada con org_id obligatorio
--     Permite: ver tu propio perfil, ver perfiles de tu misma org,
--     o acceso total si eres super_admin.
CREATE POLICY "profiles_select_by_org"
  ON public.profiles
  AS permissive
  FOR SELECT
  TO public
  USING (
    id = auth.uid()
    OR org_id = public.get_my_org()
    OR public.get_my_role() = 'super_admin'
    OR owner_id = auth.uid()
  );

-- 1c. PolÃ­tica INSERT: solo se puede insertar en la propia org
--     (Los RPCs SECURITY DEFINER como provision_user_profile bypasean RLS,
--      esto protege inserts directos desde el cliente)
DROP POLICY IF EXISTS "Jerarquia de Creacion" ON public.profiles;

CREATE POLICY "profiles_insert_by_org"
  ON public.profiles
  AS permissive
  FOR INSERT
  TO public
  WITH CHECK (
    org_id = public.get_my_org()
    OR public.get_my_role() = 'super_admin'
  );

-- 1d. PolÃ­tica UPDATE: solo tu org (preserva las existentes de manager/self)
--     No tocamos "Users can update own profile", "Managers can update their staff",
--     ni "Leaders can update org staff" porque ya son correctas.
--     Pero aÃ±adimos el constraint de org_id donde falta.
DROP POLICY IF EXISTS "Leaders can update org staff"       ON public.profiles;
DROP POLICY IF EXISTS "Managers can update their staff"    ON public.profiles;
DROP POLICY IF EXISTS "Super Admin can update all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile"       ON public.profiles;

CREATE POLICY "profiles_update_self"
  ON public.profiles
  AS permissive
  FOR UPDATE
  TO public
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND role = (SELECT p.role FROM public.profiles p WHERE p.id = auth.uid())
  );

CREATE POLICY "profiles_update_by_owner"
  ON public.profiles
  AS permissive
  FOR UPDATE
  TO public
  USING (
    owner_id = auth.uid()
    AND org_id = public.get_my_org()
  )
  WITH CHECK (
    owner_id = auth.uid()
    AND org_id = public.get_my_org()
  );

CREATE POLICY "profiles_update_superadmin"
  ON public.profiles
  AS permissive
  FOR UPDATE
  TO public
  USING (public.get_my_role() = 'super_admin')
  WITH CHECK (
    NOT (email = 'admin@genesis.com' AND role::text <> 'super_admin')
  );


-- ============================================================================
-- SECCIÃ“N 2: RLS tabla orders â€” Parche kitchen UPDATE
-- ============================================================================
-- Problema: La polÃ­tica "Kitchen can update order status" tiene
-- WITH CHECK (true), lo que permite a cocina escribir cualquier valor
-- en cualquier columna al actualizar, incluyendo org_id o total.
-- ============================================================================

DROP POLICY IF EXISTS "Kitchen can update order status" ON public.orders;

CREATE POLICY "Kitchen can update order status"
  ON public.orders
  AS permissive
  FOR UPDATE
  TO public
  USING (
    public.get_my_role() = 'kitchen'
    AND org_id = public.get_my_org()
  )
  WITH CHECK (
    org_id = public.get_my_org()
  );


-- ============================================================================
-- SECCIÃ“N 3: RPC process_checkout â€” TransacciÃ³n atÃ³mica ACID
-- ============================================================================
-- Reemplaza el patrÃ³n frÃ¡gil de 2 INSERTs + rollback manual del cliente.
-- Una sola llamada: sb.rpc('process_checkout', { ... })
-- Si cualquier paso falla, PostgreSQL revierte TODO automÃ¡ticamente.
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
AS $function$
DECLARE
  v_user_id    uuid;
  v_org_id     uuid;
  v_order_id   bigint;
  v_total      numeric := 0;
  v_status     text;
  v_item       jsonb;
  v_product    record;
  v_items_arr  jsonb := '[]'::jsonb;
BEGIN
  -- 1. AutenticaciÃ³n
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  -- 2. Obtener org_id del perfil del usuario
  SELECT org_id INTO v_org_id
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no pertenece a ninguna organizaciÃ³n';
  END IF;

  -- 3. Validar que hay items
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Carrito vacÃ­o';
  END IF;

  -- 4. Determinar status inicial
  v_status := CASE WHEN p_auto_accept THEN 'completed' ELSE 'pending' END;

  -- 5. Calcular total REAL desde la base de datos (NO confiar en el cliente)
  --    y validar existencia de cada producto en la org del usuario
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT id, name, price, org_id
    INTO v_product
    FROM public.products
    WHERE id = (v_item->>'product_id')::uuid
      AND org_id = v_org_id
      AND active = true;

    IF v_product IS NULL THEN
      RAISE EXCEPTION 'Producto % no encontrado, inactivo, o no pertenece a su organizaciÃ³n',
        v_item->>'product_id';
    END IF;

    v_total := v_total + (v_product.price * (v_item->>'quantity')::int);

    -- Construir item verificado
    v_items_arr := v_items_arr || jsonb_build_object(
      'product_id', v_product.id,
      'name',       v_product.name,
      'price',      v_product.price,
      'quantity',   (v_item->>'quantity')::int,
      'subtotal',   v_product.price * (v_item->>'quantity')::int
    );
  END LOOP;

  -- 6. INSERT atÃ³mico: Orden
  INSERT INTO public.orders (
    org_id,
    total,
    status,
    paid_with,
    change,
    payment_method,
    created_by
  ) VALUES (
    v_org_id,
    v_total,
    v_status,
    p_paid_with,
    p_change,
    p_payment_method,
    v_user_id
  )
  RETURNING id INTO v_order_id;

  -- 7. INSERT atÃ³mico: Items (usando precios verificados de la DB)
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

  -- 8. Retornar la orden creada
  RETURN json_build_object(
    'success',        true,
    'order_id',       v_order_id,
    'total',          v_total,
    'status',         v_status,
    'items_count',    jsonb_array_length(v_items_arr),
    'payment_method', p_payment_method
  );

  -- Si CUALQUIER paso anterior falla, PostgreSQL revierte TODO.
  -- No hay rollback manual. No hay Ã³rdenes fantasma. ACID nativo.
END;
$function$;
