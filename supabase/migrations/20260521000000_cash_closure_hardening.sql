-- ============================================================================
-- MIGRACIÃ“N: Hardening de cash_closures
-- Fecha: 2026-05-21
-- Requisito previo: Duplicados por org_id + closure_date fueron limpiados
-- ============================================================================

-- 1. Columnas de trazabilidad para auditorÃ­a de correcciones
--    FK usa auth.users(id) por consistencia con closed_by_fkey en la misma tabla
--    y con el patrÃ³n de auditorÃ­a de products (migraciÃ³n 20260517224800)
ALTER TABLE public.cash_closures
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS revision_note text;

-- 2. Constraint de unicidad: un solo corte por organizaciÃ³n y fecha
--    Esto es la regla de negocio: la caja fÃ­sica es una sola por sucursal/dÃ­a
ALTER TABLE public.cash_closures
  ADD CONSTRAINT unique_org_closure_date UNIQUE (org_id, closure_date);

-- ============================================================================
-- 3. RPC save_cash_closure â€” Escritura atÃ³mica de corte de caja
-- ============================================================================
-- Recibe solo inputs del usuario (fecha, efectivo inicial, contado, notas).
-- Calcula totales financieros desde orders en backend (Zero Trust pricing).
-- Usa SELECT FOR UPDATE para concurrencia segura.
-- Exige revision_note para correcciones.
-- MVP: zona horaria hardcodeada a America/Mexico_City.
-- TODO futuro: leer de organizations.timezone.

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
  -- ---------------------------------------------------------------
  -- 1. AUTENTICACIÃ“N
  -- ---------------------------------------------------------------
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  -- ---------------------------------------------------------------
  -- 2. PERFIL Y AUTORIZACIÃ“N
  -- ---------------------------------------------------------------
  SELECT org_id, role INTO v_org_id, v_role
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Acceso denegado: Usuario no tiene organizaciÃ³n';
  END IF;

  IF v_role NOT IN ('cashier', 'leader', 'pastor', 'super_admin') THEN
    RAISE EXCEPTION 'Acceso denegado: El rol "%" no estÃ¡ autorizado para corte de caja', v_role;
  END IF;

  -- ---------------------------------------------------------------
  -- 3. VALIDACIÃ“N DE INPUTS
  -- ---------------------------------------------------------------
  IF p_closure_date IS NULL THEN
    RAISE EXCEPTION 'Fecha de cierre requerida';
  END IF;

  IF p_opening_cash IS NULL OR p_opening_cash < 0 THEN
    RAISE EXCEPTION 'Efectivo inicial no puede ser negativo o nulo';
  END IF;

  IF p_cash_counted IS NULL OR p_cash_counted < 0 THEN
    RAISE EXCEPTION 'Efectivo contado no puede ser negativo o nulo';
  END IF;

  -- ---------------------------------------------------------------
  -- 4. RANGO DE FECHA (dÃ­a local de negocio)
  --    MVP: America/Mexico_City hardcodeado
  --    TODO futuro: leer de organizations.timezone
  --    Rango semiabierto: [start, end)
  -- ---------------------------------------------------------------
  v_day_start := p_closure_date::timestamp AT TIME ZONE 'America/Mexico_City';
  v_day_end   := (p_closure_date + 1)::timestamp AT TIME ZONE 'America/Mexico_City';

  -- ---------------------------------------------------------------
  -- 5. CÃLCULO BACKEND DESDE orders
  --    Todas las Ã³rdenes de la organizaciÃ³n para esa fecha
  -- ---------------------------------------------------------------
  SELECT
    COUNT(*),
    COALESCE(SUM(total), 0),
    COALESCE(SUM(total) FILTER (WHERE payment_method = 'cash' OR payment_method IS NULL), 0),
    COALESCE(SUM(total) FILTER (WHERE payment_method = 'card'), 0),
    COALESCE(SUM(total) FILTER (WHERE payment_method = 'transfer'), 0)
  INTO
    v_orders_count,
    v_sales_total,
    v_cash_sales,
    v_card_sales,
    v_transfer_sales
  FROM public.orders
  WHERE org_id = v_org_id
    AND financial_status = 'paid'
    AND created_at >= v_day_start
    AND created_at < v_day_end;

  v_expected_cash := p_opening_cash + v_cash_sales;
  v_difference    := p_cash_counted - v_expected_cash;

  -- ---------------------------------------------------------------
  -- 6. CONCURRENCIA: SELECT FOR UPDATE sobre corte existente
  --    Si la fila existe, se bloquea hasta que esta transacciÃ³n termine.
  --    El UNIQUE (org_id, closure_date) es red de seguridad final.
  -- ---------------------------------------------------------------
  SELECT id INTO v_existing_id
  FROM public.cash_closures
  WHERE org_id = v_org_id
    AND closure_date = p_closure_date
  FOR UPDATE;

  IF v_existing_id IS NULL THEN
    -- ---------------------------------------------------------------
    -- 6a. INSERT: Corte nuevo
    -- ---------------------------------------------------------------
    INSERT INTO public.cash_closures (
      org_id, closed_by, closure_date,
      opening_cash, sales_total, cash_counted, expected_cash, difference,
      total_cash_sales, total_card_sales, total_transfer_sales,
      orders_count, notes, created_at
    ) VALUES (
      v_org_id, v_user_id, p_closure_date,
      p_opening_cash, v_sales_total, p_cash_counted, v_expected_cash, v_difference,
      v_cash_sales, v_card_sales, v_transfer_sales,
      v_orders_count, p_notes, now()
    )
    RETURNING id INTO v_result_id;

    RETURN json_build_object(
      'success',    true,
      'action',     'created',
      'closure_id', v_result_id
    );
  ELSE
    -- ---------------------------------------------------------------
    -- 6b. UPDATE: CorrecciÃ³n de corte existente
    --     Exige revision_note obligatorio
    -- ---------------------------------------------------------------
    IF p_revision_note IS NULL OR trim(p_revision_note) = '' THEN
      RAISE EXCEPTION 'Se requiere motivo de correcciÃ³n (revision_note) para actualizar un corte existente';
    END IF;

    UPDATE public.cash_closures SET
      opening_cash         = p_opening_cash,
      sales_total          = v_sales_total,
      cash_counted         = p_cash_counted,
      expected_cash        = v_expected_cash,
      difference           = v_difference,
      total_cash_sales     = v_cash_sales,
      total_card_sales     = v_card_sales,
      total_transfer_sales = v_transfer_sales,
      orders_count         = v_orders_count,
      notes                = p_notes,
      updated_at           = now(),
      updated_by           = v_user_id,
      revision_note        = p_revision_note
    WHERE id = v_existing_id;

    RETURN json_build_object(
      'success',    true,
      'action',     'corrected',
      'closure_id', v_existing_id
    );
  END IF;
END;
$$;

-- Permisos del RPC
REVOKE ALL ON FUNCTION public.save_cash_closure(date, numeric, numeric, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_cash_closure(date, numeric, numeric, text, text) TO authenticated;

-- ============================================================================
-- 4. HARDENING DML de cash_closures
-- Revocar escritura directa. Solo el RPC SECURITY DEFINER puede escribir.
-- SELECT se conserva para lectura de historial (protegido por RLS existente).
-- service_role conserva todos los privilegios.
-- ============================================================================
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.cash_closures FROM anon, authenticated;
