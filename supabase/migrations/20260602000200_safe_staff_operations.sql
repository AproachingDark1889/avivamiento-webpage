-- Safe staff operations for the POS MVP.
-- Direct profile mutations are replaced by RPCs that validate hierarchy,
-- active cash sessions, and role-compatible operational flags.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS deactivated_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS deactivation_reason text;

CREATE INDEX IF NOT EXISTS idx_profiles_active_by_owner
  ON public.profiles(org_id, owner_id, role)
  WHERE deactivated_at IS NULL;

CREATE OR REPLACE FUNCTION public.get_my_org()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT org_id
  FROM public.profiles
  WHERE id = auth.uid()
    AND deactivated_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.get_my_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT org_id
  FROM public.profiles
  WHERE id = auth.uid()
    AND deactivated_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT role::text
  FROM public.profiles
  WHERE id = auth.uid()
    AND deactivated_at IS NULL;
$$;

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
  WHERE p.id = auth.uid()
    AND p.deactivated_at IS NULL;
$$;

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
  v_deactivated_at timestamptz;
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

  SELECT
    p.org_id,
    p.role::text,
    p.owner_id,
    COALESCE(p.independent_cash_register, false),
    p.deactivated_at
  INTO
    v_org_id,
    v_role,
    v_owner_id,
    v_independent_cash_register,
    v_deactivated_at
  FROM public.profiles p
  WHERE p.id = v_user_id;

  IF v_deactivated_at IS NOT NULL THEN
    RAISE EXCEPTION 'Usuario desactivado';
  END IF;

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

CREATE OR REPLACE FUNCTION public.has_active_cash_session_for_profile(
  p_target_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH target_profile AS (
    SELECT
      p.id,
      p.owner_id,
      p.role::text AS role,
      CASE
        WHEN p.role::text IN ('pastor', 'leader', 'super_admin') THEN p.id
        ELSE p.owner_id
      END AS department_owner_id
    FROM public.profiles p
    WHERE p.id = p_target_user_id
  )
  SELECT EXISTS (
    SELECT 1
    FROM public.cash_sessions s
    JOIN target_profile t ON t.department_owner_id = s.department_owner_id
    WHERE s.status IN ('open', 'pending_validation')
      AND (
        s.cashier_id = t.id
        OR s.opened_by = t.id
        OR (
          t.role IN ('leader', 'pastor', 'super_admin')
          AND s.department_owner_id = t.department_owner_id
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.assert_can_manage_profile_safely(
  p_target_user_id uuid,
  p_allowed_roles text[]
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller public.profiles%ROWTYPE;
  v_target public.profiles%ROWTYPE;
  v_allowed boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT * INTO v_caller
  FROM public.profiles
  WHERE id = auth.uid()
    AND deactivated_at IS NULL;

  IF v_caller.id IS NULL THEN
    RAISE EXCEPTION 'Usuario inactivo o sin perfil operativo';
  END IF;

  SELECT * INTO v_target
  FROM public.profiles
  WHERE id = p_target_user_id
  FOR UPDATE;

  IF v_target.id IS NULL THEN
    RAISE EXCEPTION 'Usuario no encontrado';
  END IF;

  IF v_target.deactivated_at IS NOT NULL THEN
    RAISE EXCEPTION 'Usuario desactivado';
  END IF;

  IF v_target.id = v_caller.id THEN
    RAISE EXCEPTION 'No puedes modificar tu propio perfil operativo';
  END IF;

  IF v_target.email = 'admin@genesis.com' THEN
    RAISE EXCEPTION 'No se puede modificar la cuenta maestra';
  END IF;

  IF p_allowed_roles IS NOT NULL
     AND NOT (v_target.role::text = ANY (p_allowed_roles)) THEN
    RAISE EXCEPTION 'Operacion no permitida para el rol actual del usuario';
  END IF;

  IF v_caller.role::text = 'super_admin' THEN
    v_allowed := true;
  ELSIF v_caller.role::text = 'pastor' THEN
    v_allowed := v_target.org_id = v_caller.org_id
      AND (
        v_target.owner_id = v_caller.id
        OR EXISTS (
          SELECT 1
          FROM public.profiles leader
          WHERE leader.id = v_target.owner_id
            AND leader.owner_id = v_caller.id
            AND leader.role::text = 'leader'
            AND leader.deactivated_at IS NULL
        )
      );
  ELSIF v_caller.role::text = 'leader' THEN
    v_allowed := v_target.org_id = v_caller.org_id
      AND v_target.owner_id = v_caller.id;
  END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'No tienes permisos para modificar este usuario';
  END IF;

  RETURN v_target;
END;
$$;

CREATE OR REPLACE FUNCTION public.change_staff_role_safely(
  p_target_user_id uuid,
  p_new_role text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_target public.profiles%ROWTYPE;
  v_updated public.profiles%ROWTYPE;
BEGIN
  IF p_new_role NOT IN ('cashier', 'kitchen') THEN
    RAISE EXCEPTION 'Rol destino no permitido para staff operativo';
  END IF;

  SELECT * INTO v_target
  FROM public.assert_can_manage_profile_safely(
    p_target_user_id,
    ARRAY['cashier', 'kitchen']
  );

  IF public.has_active_cash_session_for_profile(v_target.id) THEN
    RAISE EXCEPTION 'No se puede cambiar el rol mientras el usuario tiene caja abierta o pendiente de validacion';
  END IF;

  UPDATE public.profiles
  SET
    role = p_new_role::public.app_role,
    auto_accept_orders = CASE
      WHEN p_new_role = 'kitchen' THEN false
      ELSE COALESCE(auto_accept_orders, false)
    END,
    independent_cash_register = CASE
      WHEN p_new_role = 'cashier' THEN COALESCE(independent_cash_register, false)
      ELSE false
    END
  WHERE id = v_target.id
  RETURNING * INTO v_updated;

  RETURN json_build_object(
    'success', true,
    'id', v_updated.id,
    'role', v_updated.role,
    'auto_accept_orders', COALESCE(v_updated.auto_accept_orders, false),
    'independent_cash_register', COALESCE(v_updated.independent_cash_register, false)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_staff_auto_accept_safely(
  p_target_user_id uuid,
  p_enabled boolean
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_target public.profiles%ROWTYPE;
  v_updated public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO v_target
  FROM public.assert_can_manage_profile_safely(
    p_target_user_id,
    ARRAY['cashier', 'leader']
  );

  IF public.has_active_cash_session_for_profile(v_target.id) THEN
    RAISE EXCEPTION 'No se puede cambiar auto-cobro mientras el usuario tiene caja abierta o pendiente de validacion';
  END IF;

  UPDATE public.profiles
  SET auto_accept_orders = COALESCE(p_enabled, false)
  WHERE id = v_target.id
  RETURNING * INTO v_updated;

  RETURN json_build_object(
    'success', true,
    'id', v_updated.id,
    'auto_accept_orders', COALESCE(v_updated.auto_accept_orders, false)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_staff_independent_cash_safely(
  p_target_user_id uuid,
  p_enabled boolean
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_target public.profiles%ROWTYPE;
  v_updated public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO v_target
  FROM public.assert_can_manage_profile_safely(
    p_target_user_id,
    ARRAY['cashier']
  );

  IF public.has_active_cash_session_for_profile(v_target.id) THEN
    RAISE EXCEPTION 'No se puede cambiar caja independiente mientras el usuario tiene caja abierta o pendiente de validacion';
  END IF;

  UPDATE public.profiles
  SET independent_cash_register = COALESCE(p_enabled, false)
  WHERE id = v_target.id
  RETURNING * INTO v_updated;

  RETURN json_build_object(
    'success', true,
    'id', v_updated.id,
    'independent_cash_register', COALESCE(v_updated.independent_cash_register, false)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.deactivate_staff_user_safely(
  p_target_user_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_target public.profiles%ROWTYPE;
  v_updated public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO v_target
  FROM public.assert_can_manage_profile_safely(
    p_target_user_id,
    ARRAY['cashier', 'kitchen']
  );

  IF public.has_active_cash_session_for_profile(v_target.id) THEN
    RAISE EXCEPTION 'No se puede desactivar un usuario mientras tiene caja abierta o pendiente de validacion';
  END IF;

  UPDATE public.profiles
  SET
    deactivated_at = now(),
    deactivated_by = auth.uid(),
    deactivation_reason = NULLIF(trim(COALESCE(p_reason, '')), ''),
    auto_accept_orders = false,
    independent_cash_register = false
  WHERE id = v_target.id
  RETURNING * INTO v_updated;

  RETURN json_build_object(
    'success', true,
    'id', v_updated.id,
    'deactivated_at', v_updated.deactivated_at
  );
END;
$$;

-- Client code must not mutate operational profile columns directly.
REVOKE UPDATE ON TABLE public.profiles FROM anon, authenticated;

REVOKE ALL ON FUNCTION public.has_active_cash_session_for_profile(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_can_manage_profile_safely(uuid, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.change_staff_role_safely(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_staff_auto_accept_safely(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_staff_independent_cash_safely(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.deactivate_staff_user_safely(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_user_cascade(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.change_staff_role_safely(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_staff_auto_accept_safely(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_staff_independent_cash_safely(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deactivate_staff_user_safely(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_user_cascade(uuid) TO service_role;
