-- Content inside a notebook: sources, chats (+ selected sources, messages) and podcasts
-- (+ selected sources).
--
-- Ownership model:
--   * every table carries user_id; RLS is a plain user_id = auth.uid() check
--   * child tables reference notebooks (notebook_id, user_id), so the row owner always
--     equals the notebook owner
--   * join tables reference both sides via (id, notebook_id), so chats/podcasts can only
--     select sources from their own notebook
--   * columns maintained by the worker (status, error, ...) are not writable by users:
--     authenticated only gets column-level INSERT/UPDATE grants on user-editable columns

-- ---------------------------------------------------------------------------
-- sources
-- ---------------------------------------------------------------------------

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  notebook_id uuid not null,
  kind text not null,
  title text not null,
  original_url text,
  storage_path text,
  mime_type text,
  size_bytes bigint,
  status text not null default 'pending',
  error text,
  page_count integer,
  token_count integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint sources_notebook_fk foreign key (notebook_id, user_id)
    references public.notebooks (id, user_id) on delete cascade,
  constraint sources_id_notebook_id_key unique (id, notebook_id),
  constraint sources_kind_valid check (kind in ('pdf', 'docx', 'md', 'url')),
  constraint sources_status_valid check (status in ('pending', 'processing', 'ready', 'failed')),
  constraint sources_title_length check (char_length(btrim(title)) between 1 and 300),
  constraint sources_url_kind check ((kind = 'url') = (original_url is not null)),
  constraint sources_file_kind check ((kind = 'url') or (storage_path is not null)),
  constraint sources_size_nonnegative check (size_bytes is null or size_bytes >= 0)
);

create index sources_notebook_id_created_at_idx on public.sources (notebook_id, created_at desc);

create trigger sources_set_updated_at
  before update on public.sources
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- chats
-- ---------------------------------------------------------------------------

create table public.chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  notebook_id uuid not null,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint chats_notebook_fk foreign key (notebook_id, user_id)
    references public.notebooks (id, user_id) on delete cascade,
  constraint chats_id_notebook_id_key unique (id, notebook_id),
  constraint chats_id_user_id_key unique (id, user_id),
  constraint chats_title_length check (title is null or char_length(title) <= 200)
);

create index chats_notebook_id_updated_at_idx on public.chats (notebook_id, updated_at desc);

create trigger chats_set_updated_at
  before update on public.chats
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- chat_sources: which sources a chat answers from (same notebook only)
-- ---------------------------------------------------------------------------

create table public.chat_sources (
  chat_id uuid not null,
  source_id uuid not null,
  notebook_id uuid not null,
  user_id uuid not null default auth.uid(),
  created_at timestamptz not null default now(),

  primary key (chat_id, source_id),
  constraint chat_sources_notebook_fk foreign key (notebook_id, user_id)
    references public.notebooks (id, user_id) on delete cascade,
  constraint chat_sources_chat_fk foreign key (chat_id, notebook_id)
    references public.chats (id, notebook_id) on delete cascade,
  constraint chat_sources_source_fk foreign key (source_id, notebook_id)
    references public.sources (id, notebook_id) on delete cascade
);

create index chat_sources_source_id_idx on public.chat_sources (source_id);
create index chat_sources_notebook_id_idx on public.chat_sources (notebook_id);

-- ---------------------------------------------------------------------------
-- messages (reach their notebook through chat_id)
-- ---------------------------------------------------------------------------

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null,
  user_id uuid not null default auth.uid(),
  role text not null,
  content text not null,
  parts jsonb,
  -- snapshot: [{ marker, chunkId, sourceId, sourceTitle, page, quote }]
  citations jsonb not null default '[]'::jsonb,
  model text,
  usage jsonb,
  created_at timestamptz not null default now(),

  constraint messages_chat_fk foreign key (chat_id, user_id)
    references public.chats (id, user_id) on delete cascade,
  constraint messages_role_valid check (role in ('user', 'assistant')),
  constraint messages_citations_array check (jsonb_typeof(citations) = 'array')
);

create index messages_chat_id_created_at_idx on public.messages (chat_id, created_at);

-- ---------------------------------------------------------------------------
-- podcasts
-- ---------------------------------------------------------------------------

create table public.podcasts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  notebook_id uuid not null,
  -- snapshot of the notebook language at creation (set by trigger)
  language text not null,
  title text,
  topic text not null,
  mode text not null,
  target_minutes smallint not null,
  status text not null default 'queued',
  error text,
  script jsonb,
  storage_path text,
  duration_seconds numeric(8, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint podcasts_notebook_fk foreign key (notebook_id, user_id)
    references public.notebooks (id, user_id) on delete cascade,
  constraint podcasts_id_notebook_id_key unique (id, notebook_id),
  constraint podcasts_language_supported check (language in ('de', 'en')),
  constraint podcasts_topic_length check (char_length(btrim(topic)) between 1 and 500),
  constraint podcasts_title_length check (title is null or char_length(title) <= 200),
  constraint podcasts_mode_valid check (mode in ('monologue', 'dialogue')),
  constraint podcasts_target_minutes_valid check (target_minutes in (2, 6, 15)),
  constraint podcasts_status_valid check (
    status in ('queued', 'scripting', 'synthesizing', 'ready', 'failed')
  )
);

create index podcasts_notebook_id_created_at_idx on public.podcasts (notebook_id, created_at desc);

create trigger podcasts_set_updated_at
  before update on public.podcasts
  for each row execute function public.set_updated_at();

-- Copies the notebook language into the podcast so queued jobs are not affected by
-- later notebook edits. Runs as the inserting user, so RLS on notebooks applies.
create function public.podcasts_set_language()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select n.language into strict new.language
  from public.notebooks n
  where n.id = new.notebook_id;
  return new;
exception
  when no_data_found then
    raise exception 'notebook % not found', new.notebook_id using errcode = '23503';
end;
$$;

create trigger podcasts_set_language
  before insert on public.podcasts
  for each row execute function public.podcasts_set_language();

-- ---------------------------------------------------------------------------
-- podcast_sources: which sources a podcast is based on (same notebook only)
-- ---------------------------------------------------------------------------

create table public.podcast_sources (
  podcast_id uuid not null,
  source_id uuid not null,
  notebook_id uuid not null,
  user_id uuid not null default auth.uid(),
  created_at timestamptz not null default now(),

  primary key (podcast_id, source_id),
  constraint podcast_sources_notebook_fk foreign key (notebook_id, user_id)
    references public.notebooks (id, user_id) on delete cascade,
  constraint podcast_sources_podcast_fk foreign key (podcast_id, notebook_id)
    references public.podcasts (id, notebook_id) on delete cascade,
  constraint podcast_sources_source_fk foreign key (source_id, notebook_id)
    references public.sources (id, notebook_id) on delete cascade
);

create index podcast_sources_source_id_idx on public.podcast_sources (source_id);
create index podcast_sources_notebook_id_idx on public.podcast_sources (notebook_id);

-- ---------------------------------------------------------------------------
-- Grants: anon nothing; authenticated only what users may do; service_role all.
-- ---------------------------------------------------------------------------

revoke all on table
  public.sources, public.chats, public.chat_sources, public.messages,
  public.podcasts, public.podcast_sources
from anon, authenticated;

grant all on table
  public.sources, public.chats, public.chat_sources, public.messages,
  public.podcasts, public.podcast_sources
to service_role;

grant select, delete on table public.sources to authenticated;
grant insert (id, notebook_id, kind, title, original_url, storage_path, mime_type, size_bytes)
  on table public.sources to authenticated;
grant update (title) on table public.sources to authenticated;

grant select, delete on table public.chats to authenticated;
grant insert (id, notebook_id, title) on table public.chats to authenticated;
grant update (title) on table public.chats to authenticated;

grant select, delete on table public.chat_sources to authenticated;
grant insert (chat_id, source_id, notebook_id) on table public.chat_sources to authenticated;

grant select on table public.messages to authenticated;
grant insert (id, chat_id, role, content, parts, citations, model, usage)
  on table public.messages to authenticated;

grant select, delete on table public.podcasts to authenticated;
grant insert (id, notebook_id, title, topic, mode, target_minutes)
  on table public.podcasts to authenticated;

grant select on table public.podcast_sources to authenticated;
grant insert (podcast_id, source_id, notebook_id) on table public.podcast_sources to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security: owner only (user_id = auth.uid()) on every operation.
-- ---------------------------------------------------------------------------

alter table public.sources enable row level security;
alter table public.chats enable row level security;
alter table public.chat_sources enable row level security;
alter table public.messages enable row level security;
alter table public.podcasts enable row level security;
alter table public.podcast_sources enable row level security;

create policy sources_select_own on public.sources
  for select to authenticated using ((select auth.uid()) = user_id);
create policy sources_insert_own on public.sources
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy sources_update_own on public.sources
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy sources_delete_own on public.sources
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy chats_select_own on public.chats
  for select to authenticated using ((select auth.uid()) = user_id);
create policy chats_insert_own on public.chats
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy chats_update_own on public.chats
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy chats_delete_own on public.chats
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy chat_sources_select_own on public.chat_sources
  for select to authenticated using ((select auth.uid()) = user_id);
create policy chat_sources_insert_own on public.chat_sources
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy chat_sources_delete_own on public.chat_sources
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy messages_select_own on public.messages
  for select to authenticated using ((select auth.uid()) = user_id);
create policy messages_insert_own on public.messages
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy podcasts_select_own on public.podcasts
  for select to authenticated using ((select auth.uid()) = user_id);
create policy podcasts_insert_own on public.podcasts
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy podcasts_delete_own on public.podcasts
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy podcast_sources_select_own on public.podcast_sources
  for select to authenticated using ((select auth.uid()) = user_id);
create policy podcast_sources_insert_own on public.podcast_sources
  for insert to authenticated with check ((select auth.uid()) = user_id);
