-- supabase/migrations/20260526222815_fix_signup_tenant.sql

CREATE OR REPLACE FUNCTION public.setup_new_tenant(p_church_name text, p_church_slug text, p_full_name text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_user_email text;
BEGIN
  -- 1. Obtener ID del usuario autenticado
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  -- 1b. Obtener email real de auth.users (ValidaciÃ³n Defensiva)
  SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;
  IF v_user_email IS NULL THEN
    RAISE EXCEPTION 'El usuario no tiene un email vÃ¡lido registrado';
  END IF;

  -- 2. Validar que el slug no exista
  IF EXISTS (SELECT 1 FROM public.organizations WHERE slug = p_church_slug) THEN
    -- Mantenemos el error limpio para que el frontend (auth.ts) lo parsee
    RAISE EXCEPTION 'El nombre de iglesia "%" ya estÃ¡ en uso', p_church_name;
  END IF;

  -- 3. Crear organizaciÃ³n con owner_id temporalmente NULL.
  -- No podemos apuntar owner_id a v_user_id antes de garantizar que
  -- public.profiles(id = v_user_id) exista, porque organizations.owner_id
  -- tiene FK hacia profiles.id.
  INSERT INTO public.organizations (name, slug, plan, status, max_users, owner_id)
  VALUES (p_church_name, p_church_slug, 'free', 'trial', 3, NULL)
  RETURNING id INTO v_org_id;

  -- 4. UPSERT Robusto en public.profiles
  -- Elimina la dependencia frÃ¡gil de un trigger asÃ­ncrono
  -- Fuerza explÃ­citamente role='pastor' para habilitar el acceso al Onboarding
  INSERT INTO public.profiles (
    id, email, role, org_id, owner_id, display_name, onboarding_completed
  ) VALUES (
    v_user_id,
    v_user_email,
    'pastor'::public.app_role,
    v_org_id,
    NULL, -- Es el pastor principal
    p_full_name,
    FALSE
  )
  ON CONFLICT (id) DO UPDATE
  SET
    email = EXCLUDED.email,
    role = EXCLUDED.role,
    org_id = EXCLUDED.org_id,
    owner_id = NULL,
    display_name = EXCLUDED.display_name,
    onboarding_completed = EXCLUDED.onboarding_completed;

  -- 5. Cerrar la relaciÃ³n circular ahora que el profile ya existe.
  UPDATE public.organizations
  SET owner_id = v_user_id
  WHERE id = v_org_id;

  -- 6. Retornar Ã©xito
  RETURN json_build_object(
    'success', true,
    'org_id', v_org_id,
    'message', 'Tenant creado y perfil aprovisionado exitosamente'
  );

EXCEPTION WHEN OTHERS THEN
  -- Si es la excepciÃ³n de iglesia en uso (detectada por el RAISE manual),
  -- la dejamos pasar con el mismo texto exacto para que Pinia active el reintento.
  IF SQLERRM LIKE 'El nombre de iglesia % ya estÃ¡ en uso' THEN
    RAISE EXCEPTION '%', SQLERRM;
  END IF;

  -- Para errores genÃ©ricos de constraint o sistema
  RAISE EXCEPTION 'Error al crear tenant: %', SQLERRM;
END;
$function$;
