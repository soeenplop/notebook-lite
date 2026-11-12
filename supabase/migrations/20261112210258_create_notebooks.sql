-- Notebooks: the layer between a user and their sources, chats and podcasts.
-- Exactly one user (the owner) per notebook. Every child table references
-- (notebook_id, user_id) so its owner always matches the notebook owner.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Maps a supported notebook language to its Postgres full-text search config.
-- Keep in sync with SUPPORTED_LANGUAGES in packages/shared.
create function public.language_regconfig(code text)
returns regconfig
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case code
    when 'de' then 'pg_catalog.german'::regconfig
    when 'en' then 'pg_catalog.english'::regconfig
    else 'pg_catalog.simple'::regconfig
  end
$$;

-- Generic trigger function that keeps updated_at current.
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- notebooks
-- ---------------------------------------------------------------------------

create table public.notebooks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  description text,
  language text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- target of the composite (notebook_id, user_id) foreign keys of child tables
  constraint notebooks_id_user_id_key unique (id, user_id),
  constraint notebooks_name_length check (char_length(btrim(name)) between 1 and 120),
  constraint notebooks_description_length check (
    description is null or char_length(description) <= 2000
  ),
  constraint notebooks_language_supported check (language in ('de', 'en'))
);

comment on table public.notebooks is
  'User-owned notebook grouping sources, chats and podcasts. language drives all AI output.';

create index notebooks_user_id_created_at_idx on public.notebooks (user_id, created_at desc);

create trigger notebooks_set_updated_at
  before update on public.notebooks
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security: owner only. anon gets no access at all.
-- ---------------------------------------------------------------------------

alter table public.notebooks enable row level security;

revoke all on table public.notebooks from anon, authenticated;
grant select, insert, update, delete on table public.notebooks to authenticated;
grant all on table public.notebooks to service_role;

create policy notebooks_select_own on public.notebooks
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy notebooks_insert_own on public.notebooks
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy notebooks_update_own on public.notebooks
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy notebooks_delete_own on public.notebooks
  for delete to authenticated
  using ((select auth.uid()) = user_id);
