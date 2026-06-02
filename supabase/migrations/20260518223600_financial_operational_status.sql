-- ============================================================================
-- MIGRACIÃ“N ADITIVA: Modelo Pay-First y Hardening de DML
-- ============================================================================

-- 1. Nuevas Columnas (Seguras e Idempotentes)
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS financial_status text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS operational_status text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS financial_review_required boolean;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS rejection_reason text;

-- NormalizaciÃ³n de valores invÃ¡lidos legacy por seguridad y Backfill Idempotente
UPDATE public.orders
SET financial_status = 'paid'
WHERE financial_status IS NULL OR financial_status NOT IN ('paid', 'refunded', 'voided');

UPDATE public.orders
SET
  operational_status = CASE
    WHEN status IN ('completed', 'delivered') THEN 'completed'
    WHEN status IN ('rejected', 'incomplete') THEN 'kitchen_rejected'
    WHEN status = 'cancelled' THEN 'kitchen_cancelled'
    ELSE 'pending'
  END
WHERE operational_status IS DISTINCT FROM CASE
    WHEN status IN ('completed', 'delivered') THEN 'completed'
    WHEN status IN ('rejected', 'incomplete') THEN 'kitchen_rejected'
    WHEN status = 'cancelled' THEN 'kitchen_cancelled'
    ELSE 'pending'
  END;

UPDATE public.orders
SET financial_review_required = CASE
    WHEN status IN ('rejected', 'cancelled', 'incomplete') THEN true
    ELSE false
  END
WHERE financial_review_required IS DISTINCT FROM CASE
    WHEN status IN ('rejected', 'cancelled', 'incomplete') THEN true
    ELSE false
  END;

-- Restricciones de nulos y defaults
ALTER TABLE public.orders ALTER COLUMN financial_status SET NOT NULL;
ALTER TABLE public.orders ALTER COLUMN financial_status SET DEFAULT 'paid';

ALTER TABLE public.orders ALTER COLUMN operational_status SET NOT NULL;
ALTER TABLE public.orders ALTER COLUMN operational_status SET DEFAULT 'pending';

ALTER TABLE public.orders ALTER COLUMN financial_review_required SET NOT NULL;
ALTER TABLE public.orders ALTER COLUMN financial_review_required SET DEFAULT false;

-- CreaciÃ³n condicional de constraints CHECK
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_orders_financial_status' AND conrelid = 'public.orders'::regclass) THEN
    ALTER TABLE public.orders ADD CONSTRAINT chk_orders_financial_status CHECK (financial_status IN ('paid', 'refunded', 'voided'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_orders_op_status' AND conrelid = 'public.orders'::regclass) THEN
    ALTER TABLE public.orders ADD CONSTRAINT chk_orders_op_status CHECK (operational_status IN ('pending', 'completed', 'kitchen_rejected', 'kitchen_cancelled', 'auto_fulfilled'));
  END IF;
END $$;

-- 2. Ãndices Estructurales
CREATE INDEX IF NOT EXISTS idx_orders_reports ON public.orders (org_id, financial_status, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_kds ON public.orders (org_id, operational_status, created_at);

-- ============================================================================
-- 4. RPC update_kitchen_status
-- ============================================================================
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
  v_order_org_id uuid;
  v_current_op_status text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  -- Verificar rol operativo y obtener org_id del perfil
  SELECT org_id, role INTO v_org_id, v_role
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Acceso denegado: Usuario no tiene organizaciÃ³n';
  END IF;

  IF v_role NOT IN ('kitchen', 'leader', 'pastor', 'super_admin') THEN
    RAISE EXCEPTION 'Acceso denegado: El rol "%" no puede operar KDS', v_role;
  END IF;

  -- Verificar existencia de la orden, capturar estado actual, y proteger contra doble procesamiento
  SELECT org_id, operational_status INTO v_order_org_id, v_current_op_status
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order_org_id IS NULL THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;

  IF v_order_org_id != v_org_id THEN
    RAISE EXCEPTION 'Acceso denegado: Orden de otra organizaciÃ³n';
  END IF;

  -- KDS solo puede procesar Ã³rdenes que estÃ©n actualmente pendientes
  IF v_current_op_status != 'pending' THEN
    RAISE EXCEPTION 'TransiciÃ³n invÃ¡lida: La orden ya fue procesada (estado actual: %)', v_current_op_status;
  END IF;

  -- KDS solo puede cambiar a completado, rechazado o cancelado. auto_fulfilled estÃ¡ prohibido.
  IF p_new_status NOT IN ('completed', 'kitchen_rejected', 'kitchen_cancelled') THEN
    RAISE EXCEPTION 'TransiciÃ³n invÃ¡lida o no permitida desde KDS';
  END IF;

  -- UPDATE protegido (solo muta columnas operativas)
  UPDATE public.orders
  SET
    operational_status = p_new_status,
    rejection_reason = CASE WHEN p_new_status IN ('kitchen_rejected', 'kitchen_cancelled') THEN p_reason ELSE rejection_reason END,
    financial_review_required = CASE WHEN p_new_status IN ('kitchen_rejected', 'kitchen_cancelled') THEN true ELSE financial_review_required END,
    -- Actualizamos legacy status estrictamente a valores compatibles previos
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

-- ============================================================================
-- 5. Ajuste de process_checkout
-- ============================================================================
CREATE OR REPLACE FUNCTION public.process_checkout(
  p_items jsonb,
  p_payment_method text DEFAULT 'cash',
  p_paid_with numeric DEFAULT 0,
  p_change numeric DEFAULT 0,
  p_auto_accept boolean DEFAULT false -- Mantenido temporalmente por compatibilidad en params, no es fuente de verdad
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

  SELECT org_id, role, auto_accept_orders INTO v_org_id, v_role, v_auto_accept
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no pertenece a ninguna organizaciÃ³n';
  END IF;

  IF v_role NOT IN ('cashier', 'leader', 'pastor', 'super_admin') THEN
    RAISE EXCEPTION 'Acceso denegado: El rol "%" no estÃ¡ autorizado para procesar cobros', v_role;
  END IF;

  -- Validaciones de inputs financieros
  IF p_payment_method IS NULL OR p_payment_method NOT IN ('cash', 'card', 'transfer') THEN
    RAISE EXCEPTION 'MÃ©todo de pago invÃ¡lido';
  END IF;

  IF p_paid_with IS NULL OR p_change IS NULL OR p_paid_with < 0 OR p_change < 0 THEN
    RAISE EXCEPTION 'Los montos de pago y cambio no pueden ser negativos ni nulos';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) != 'array' THEN
    RAISE EXCEPTION 'Carrito invÃ¡lido: no es un arreglo JSON';
  END IF;

  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Carrito vacÃ­o';
  END IF;

  -- Determinar status desde la fuente de verdad (la BD, no el cliente)
  v_status := CASE WHEN v_auto_accept THEN 'completed' ELSE 'pending' END;
  v_op_status := CASE WHEN v_auto_accept THEN 'auto_fulfilled' ELSE 'pending' END;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    -- Validar product_id
    IF NOT (v_item ? 'product_id') OR v_item->>'product_id' IS NULL THEN
      RAISE EXCEPTION 'Item invÃ¡lido: product_id faltante';
    END IF;

    -- Validar cantidad
    BEGIN
      v_quantity := (v_item->>'quantity')::int;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Item invÃ¡lido: cantidad no es un nÃºmero entero';
    END;

    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'Cantidad de producto invÃ¡lida';
    END IF;

    -- Extraer product_id de manera segura antes de usarlo
    BEGIN
      v_prod_uuid := (v_item->>'product_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Item invÃ¡lido: product_id "%" no es un UUID vÃ¡lido', v_item->>'product_id';
    END;

    SELECT id, name, price, org_id
    INTO v_product
    FROM public.products
    WHERE id = v_prod_uuid
      AND org_id = v_org_id
      AND active = true;

    IF v_product IS NULL THEN
      RAISE EXCEPTION 'Producto % no encontrado, inactivo, o no pertenece a su organizaciÃ³n', v_item->>'product_id';
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

  -- ValidaciÃ³n coherencia efectivo
  IF p_payment_method = 'cash' THEN
    IF p_paid_with < v_total THEN
      RAISE EXCEPTION 'Monto pagado insuficiente para orden en efectivo';
    END IF;
    -- Descomentar si se exige matemÃ¡ticas exactas en change:
    -- IF p_change != (p_paid_with - v_total) THEN
    --   RAISE EXCEPTION 'Cambio calculado incorrecto';
    -- END IF;
    -- Actualmente se omite la validaciÃ³n estricta del vuelto exacto temporalmente
    -- para no romper clientes que calculen redondeos.
  END IF;

  INSERT INTO public.orders (
    org_id,
    total,
    status,
    operational_status,
    financial_status,
    paid_with,
    change,
    payment_method,
    created_by
  ) VALUES (
    v_org_id,
    v_total,
    v_status,
    v_op_status,
    'paid',
    p_paid_with,
    p_change,
    p_payment_method,
    v_user_id
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
    'success',        true,
    'order_id',       v_order_id,
    'total',          v_total,
    'status',         v_status,
    'operational_status', v_op_status,
    'items_count',    jsonb_array_length(v_items_arr),
    'payment_method', p_payment_method
  );
END;
$$;

-- ============================================================================
-- 6. Hardening Temprano DML Completo
-- ============================================================================
-- Revocamos INSERT, DELETE y TRUNCATE en orders para aislar el modelo Pay-First
REVOKE INSERT, DELETE, TRUNCATE ON public.orders FROM anon, authenticated;

-- Hardening en order_items
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.order_items FROM anon, authenticated;

-- ============================================================================
-- 7. Trigger de Compatibilidad Temporal (OpciÃ³n A)
-- ============================================================================
-- Sincroniza mutaciones directas sobre "status" desde clientes KDS sin actualizar
-- DEBE ELIMINARSE EN FASE DE DEPRECACIÃ“N CUANDO "status" SEA BORRADA.
CREATE OR REPLACE FUNCTION public.fn_legacy_status_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.operational_status := CASE
      WHEN NEW.status IN ('completed', 'delivered') THEN 'completed'
      WHEN NEW.status IN ('rejected', 'incomplete') THEN 'kitchen_rejected'
      WHEN NEW.status = 'cancelled' THEN 'kitchen_cancelled'
      ELSE 'pending'
    END;

    -- DecisiÃ³n conservadora: Si la orden cae en un estado de rechazo, se levanta la
    -- bandera de revisiÃ³n financiera. Si luego vuelve a completed (ej. por error),
    -- la bandera NO se apaga automÃ¡ticamente, exigiendo siempre intervenciÃ³n manual.
    IF NEW.status IN ('rejected', 'cancelled', 'incomplete') THEN
      NEW.financial_review_required := true;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Blindaje: el trigger solo debe correr internamente por eventos DML
REVOKE ALL ON FUNCTION public.fn_legacy_status_sync() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_legacy_status_sync ON public.orders;
CREATE TRIGGER trg_legacy_status_sync
BEFORE UPDATE OF status ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.fn_legacy_status_sync();
