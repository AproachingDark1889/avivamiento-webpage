-- ============================================================================
-- 1. AUDIT LOG PARA PRODUCTOS
-- ============================================================================

-- Agregar columnas de auditorÃ­a
ALTER TABLE public.products
ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Crear funciÃ³n del trigger
CREATE OR REPLACE FUNCTION public.set_products_audit()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  NEW.updated_by = auth.uid();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Vincular trigger a la tabla
DROP TRIGGER IF EXISTS products_audit_trigger ON public.products;
CREATE TRIGGER products_audit_trigger
BEFORE UPDATE ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.set_products_audit();


-- ============================================================================
-- 2. REFINAMIENTO DE PERMISOS RLS (Cajero/Cocina no pueden borrar)
-- ============================================================================

-- Borrar la polÃ­tica excesivamente permisiva actual
DROP POLICY IF EXISTS "Staff can manage org products" ON public.products;

-- PERMISO: SELECT (Todos los roles del org)
CREATE POLICY "Staff can select org products"
ON public.products FOR SELECT TO public
USING (
  public.get_my_role() IN ('pastor', 'leader', 'cashier', 'kitchen')
  AND org_id = public.get_my_org()
);

-- PERMISO: INSERT (Todos los roles del org)
CREATE POLICY "Staff can insert org products"
ON public.products FOR INSERT TO public
WITH CHECK (
  public.get_my_role() IN ('pastor', 'leader', 'cashier', 'kitchen')
  AND org_id = public.get_my_org()
);

-- PERMISO: UPDATE (Todos los roles del org)
CREATE POLICY "Staff can update org products"
ON public.products FOR UPDATE TO public
USING (
  public.get_my_role() IN ('pastor', 'leader', 'cashier', 'kitchen')
  AND org_id = public.get_my_org()
);

-- PERMISO: DELETE (Solo pastor y leader del org)
CREATE POLICY "Leaders can delete org products"
ON public.products FOR DELETE TO public
USING (
  public.get_my_role() IN ('pastor', 'leader')
  AND org_id = public.get_my_org()
);
