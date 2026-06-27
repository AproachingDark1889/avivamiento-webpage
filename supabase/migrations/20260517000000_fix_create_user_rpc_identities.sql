-- Fix: create_new_user_rpc â€” identities insert usaba gen_random_uuid() como id
-- y el email como provider_id. Supabase espera id=user_id y provider_id=user_id::text.
-- Sin este fix, los usuarios creados via RPC no pueden hacer login ("Database error querying schema").

CREATE OR REPLACE FUNCTION public.create_new_user_rpc(new_email text, new_password text, new_role text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  creator_id uuid;
  creator_profile record;
  target_org_id uuid;
  new_user_id uuid;
  encrypted_pw text;
  v_instance_id uuid;
begin
  -- 1. Identificar al creador y SU INSTANCE_ID
  creator_id := auth.uid();
  if creator_id is null then
    raise exception 'No autenticado';
  end if;

  select instance_id into v_instance_id from auth.users where id = creator_id;
  if v_instance_id is null then
     v_instance_id := '00000000-0000-0000-0000-000000000000';
  end if;

  -- 2. Obtener datos del perfil del creador
  select * into creator_profile from public.profiles where id = creator_id;
  if creator_profile is null then
    raise exception 'Perfil del creador no encontrado';
  end if;

  -- 3. LÃ³gica "Smart Provisioning"
  if new_role = 'leader' then
    insert into public.organizations (name, slug)
    values ('Departamento - ' || split_part(new_email, '@', 1), gen_random_uuid()::text)
    returning id into target_org_id;
  else
    if creator_profile.org_id is null then
      raise exception 'El creador no pertenece a ninguna organizaciÃ³n para heredar.';
    end if;
    target_org_id := creator_profile.org_id;
  end if;

  -- 4. Generar ID y Password
  new_user_id := gen_random_uuid();
  encrypted_pw := crypt(new_password, gen_salt('bf'));

  -- 5. Insertar en auth.users
  insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change,
    created_at,
    updated_at
  ) values (
    v_instance_id,
    new_user_id,
    'authenticated',
    'authenticated',
    new_email,
    encrypted_pw,
    now(),
    jsonb_build_object('provider', 'email', 'providers', array['email']),
    jsonb_build_object('role', new_role),
    '',
    '',
    '',
    '',
    now(),
    now()
  );

  -- 6. Insertar en auth.identities (FIX: id y provider_id deben ser el user_id)
  INSERT INTO auth.identities (
    id,
    user_id,
    provider_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  ) VALUES (
    new_user_id,
    new_user_id,
    new_email,
    jsonb_build_object('sub', new_user_id::text, 'email', new_email),
    'email',
    now(), now(), now()
  );

  -- 7. Insertar en public.profiles
  begin
    insert into public.profiles (id, email, role, org_id, owner_id, display_name, onboarding_completed)
    values (
      new_user_id,
      new_email,
      new_role::public.app_role,
      target_org_id,
      creator_id,
      split_part(new_email, '@', 1),
      true
    );
  exception when unique_violation then
    update public.profiles
    set org_id = target_org_id,
        role = new_role::public.app_role,
        owner_id = creator_id,
        onboarding_completed = true
    where id = new_user_id;
  end;

  return json_build_object(
    'message', 'Usuario creado exitosamente (v4.0 - Identity Fix)',
    'id', new_user_id,
    'org_id', target_org_id
  );
end;
$function$;
