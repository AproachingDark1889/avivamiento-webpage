-- Hardening: product write RLS and operational staff mutations during cash sessions.
-- Cashier/kitchen can read their department catalog, but cannot mutate products directly.
-- Any active/pending cash session in a department blocks sensitive staff metadata changes.

DROP POLICY IF EXISTS "products_insert_by_department" ON public.products;
DROP POLICY IF EXISTS "products_update_by_department" ON public.products;
DROP POLICY IF EXISTS "products_delete_by_department" ON public.products;

CREATE POLICY "products_insert_by_department"
ON public.products FOR INSERT TO public
WITH CHECK (
  public.get_my_role() = 'super_admin'
  OR (
    org_id = public.get_my_org()
    AND department_owner_id = public.get_my_department_owner()
    AND public.get_my_role() IN ('pastor', 'leader')
  )
);

CREATE POLICY "products_update_by_department"
ON public.products FOR UPDATE TO public
USING (
  public.get_my_role() = 'super_admin'
  OR (
    org_id = public.get_my_org()
    AND department_owner_id = public.get_my_department_owner()
    AND public.get_my_role() IN ('pastor', 'leader')
  )
)
WITH CHECK (
  public.get_my_role() = 'super_admin'
  OR (
    org_id = public.get_my_org()
    AND department_owner_id = public.get_my_department_owner()
    AND public.get_my_role() IN ('pastor', 'leader')
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
      p.role::text AS role,
      CASE
        WHEN p.role::text IN ('pastor', 'leader', 'super_admin') THEN p.id
        ELSE p.owner_id
      END AS department_owner_id
    FROM public.profiles p
    WHERE p.id = p_target_user_id
      AND p.deactivated_at IS NULL
  )
  SELECT EXISTS (
    SELECT 1
    FROM public.cash_sessions s
    JOIN target_profile t ON t.department_owner_id = s.department_owner_id
    WHERE s.status IN ('open', 'pending_validation')
  );
$$;

REVOKE ALL ON FUNCTION public.has_active_cash_session_for_profile(uuid) FROM PUBLIC;
