-- 1. Create table with multi-tenant support
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  name text not null,
  price numeric not null DEFAULT 0,
  category text,
  image text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. Performance indexes
create index if not exists idx_products_org_active on public.products (org_id, active);
create index if not exists idx_products_org_name on public.products (org_id, name);

-- 3. RLS Policies (Security)
alter table public.products enable row level security;

-- Policy: Authenticated users can SEE products from their SAME organization
create policy if not exists products_select_same_org
on public.products for select
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.org_id = products.org_id
  )
);

-- Policy: Leaders/Admins can INSERT/UPDATE/DELETE within their org
create policy if not exists products_mutate_leader
on public.products for all
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.org_id = products.org_id
      and p.role in ('leader','super_admin')
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.org_id = products.org_id
      and p.role in ('leader','super_admin')
  )
);

-- 4. Refresh Schema Cache (Trigger this after running the above)
notify pgrst, 'reload schema';
