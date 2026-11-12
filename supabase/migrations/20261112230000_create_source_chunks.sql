-- Chunks of ingested sources, with embeddings and full-text vectors, and hybrid retrieval.
--
--   * rows are written only by the worker (service role); users can read their own chunks
--   * fts uses the notebook language: set on insert, recomputed when the notebook language
--     changes (embeddings are language-agnostic and stay as they are)
--   * match_chunks runs as the caller (security invoker), so RLS applies for users

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- source_chunks
-- ---------------------------------------------------------------------------

create table public.source_chunks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null,
  notebook_id uuid not null,
  user_id uuid not null,
  ordinal integer not null,
  content text not null,
  page_start integer,
  page_end integer,
  heading_path text[] not null default '{}',
  char_start integer not null,
  char_end integer not null,
  token_count integer not null,
  embedding extensions.halfvec(3072) not null,
  -- set by trigger from the notebook language
  fts tsvector not null,
  created_at timestamptz not null default now(),

  constraint source_chunks_notebook_fk foreign key (notebook_id, user_id)
    references public.notebooks (id, user_id) on delete cascade,
  constraint source_chunks_source_fk foreign key (source_id, notebook_id)
    references public.sources (id, notebook_id) on delete cascade,
  constraint source_chunks_source_ordinal_key unique (source_id, ordinal),
  constraint source_chunks_ordinal_nonnegative check (ordinal >= 0),
  constraint source_chunks_content_nonempty check (char_length(btrim(content)) > 0),
  constraint source_chunks_pages_valid check (
    (page_start is null and page_end is null)
    or (page_start >= 1 and page_end >= page_start)
  ),
  constraint source_chunks_chars_valid check (char_start >= 0 and char_end > char_start),
  constraint source_chunks_token_count_positive check (token_count > 0)
);

comment on table public.source_chunks is
  'Retrieval units of a source. Written by the worker; fts follows the notebook language.';

create index source_chunks_notebook_id_source_id_idx
  on public.source_chunks (notebook_id, source_id);
create index source_chunks_fts_idx on public.source_chunks using gin (fts);
create index source_chunks_embedding_idx
  on public.source_chunks using hnsw (embedding extensions.halfvec_cosine_ops);

-- ---------------------------------------------------------------------------
-- Full-text vectors in the notebook language
-- ---------------------------------------------------------------------------

create function public.source_chunks_set_fts()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  notebook_language text;
begin
  select n.language into strict notebook_language
  from public.notebooks n
  where n.id = new.notebook_id;
  new.fts := to_tsvector(public.language_regconfig(notebook_language), new.content);
  return new;
exception
  when no_data_found then
    raise exception 'notebook % not found', new.notebook_id using errcode = '23503';
end;
$$;

create trigger source_chunks_set_fts
  before insert or update of content, notebook_id on public.source_chunks
  for each row execute function public.source_chunks_set_fts();

-- Users cannot write chunks, so this runs as the function owner. It only touches chunks of
-- the notebook row the caller was allowed to update.
create function public.notebooks_refresh_chunk_fts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.source_chunks c
  set fts = to_tsvector(public.language_regconfig(new.language), c.content)
  where c.notebook_id = new.id;
  return null;
end;
$$;

revoke all on function public.notebooks_refresh_chunk_fts() from public, anon, authenticated;

create trigger notebooks_refresh_chunk_fts
  after update of language on public.notebooks
  for each row
  when (old.language is distinct from new.language)
  execute function public.notebooks_refresh_chunk_fts();

-- ---------------------------------------------------------------------------
-- match_chunks: hybrid retrieval (vector + full text, Reciprocal Rank Fusion)
-- ---------------------------------------------------------------------------

-- Returns the best p_match_count chunks of the given sources in one notebook.
--   * vector candidates: cosine distance on the embedding
--   * keyword candidates: websearch_to_tsquery in the notebook language
--   * score: sum of 1 / (p_rrf_k + rank) over both lists
-- Callers with the service role must pass p_user_id: RLS does not apply to them.
create function public.match_chunks(
  p_notebook_id uuid,
  p_query_embedding extensions.halfvec,
  p_query_text text,
  p_source_ids uuid[],
  p_match_count integer default 12,
  p_candidate_count integer default 40,
  p_rrf_k integer default 60,
  p_user_id uuid default null
)
returns table (
  id uuid,
  source_id uuid,
  ordinal integer,
  content text,
  page_start integer,
  page_end integer,
  heading_path text[],
  char_start integer,
  char_end integer,
  token_count integer,
  score double precision,
  semantic_rank bigint,
  keyword_rank bigint
)
language sql
stable
security invoker
-- Keeps HNSW scans going until enough rows pass the notebook/source filter (pgvector >= 0.8).
set hnsw.iterative_scan = 'relaxed_order'
set search_path = ''
as $$
  with query as (
    -- no keyword search for an empty query (null never matches)
    select case
      when btrim(coalesce(p_query_text, '')) <> ''
        then websearch_to_tsquery(public.language_regconfig(n.language), p_query_text)
    end as tsq
    from public.notebooks n
    where n.id = p_notebook_id
  ),
  semantic as (
    select v.id, row_number() over (order by v.distance) as rank
    from (
      select c.id, c.embedding operator(extensions.<=>) p_query_embedding as distance
      from public.source_chunks c
      where c.notebook_id = p_notebook_id
        and c.source_id = any (p_source_ids)
        and (p_user_id is null or c.user_id = p_user_id)
      order by distance
      limit p_candidate_count
    ) v
  ),
  keyword as (
    select k.id, row_number() over (order by k.rank_value desc) as rank
    from (
      select c.id, ts_rank_cd(c.fts, q.tsq) as rank_value
      from public.source_chunks c
      cross join query q
      where c.notebook_id = p_notebook_id
        and c.source_id = any (p_source_ids)
        and (p_user_id is null or c.user_id = p_user_id)
        and c.fts @@ q.tsq
      order by rank_value desc
      limit p_candidate_count
    ) k
  ),
  fused as (
    select
      coalesce(s.id, k.id) as id,
      coalesce(1.0 / (p_rrf_k + s.rank), 0) + coalesce(1.0 / (p_rrf_k + k.rank), 0) as score,
      s.rank as semantic_rank,
      k.rank as keyword_rank
    from semantic s
    full outer join keyword k on k.id = s.id
  )
  select
    c.id, c.source_id, c.ordinal, c.content, c.page_start, c.page_end, c.heading_path,
    c.char_start, c.char_end, c.token_count,
    f.score::double precision, f.semantic_rank, f.keyword_rank
  from fused f
  join public.source_chunks c on c.id = f.id
  order by f.score desc, c.source_id, c.ordinal
  limit p_match_count
$$;

-- ---------------------------------------------------------------------------
-- Grants and row level security: users read their own chunks, nothing else.
-- ---------------------------------------------------------------------------

revoke all on table public.source_chunks from anon, authenticated;
grant select on table public.source_chunks to authenticated;
grant all on table public.source_chunks to service_role;

revoke all on function public.match_chunks(
  uuid, extensions.halfvec, text, uuid[], integer, integer, integer, uuid
) from public, anon;
grant execute on function public.match_chunks(
  uuid, extensions.halfvec, text, uuid[], integer, integer, integer, uuid
) to authenticated, service_role;

alter table public.source_chunks enable row level security;

create policy source_chunks_select_own on public.source_chunks
  for select to authenticated using ((select auth.uid()) = user_id);
