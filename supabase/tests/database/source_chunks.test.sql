-- RLS, FTS-language and retrieval tests for source_chunks and match_chunks.
-- Runs against the remote project via `npm run db:test`; everything is rolled back.
begin;
-- The CLI connects with a restricted login role that is a member of postgres.
set local role postgres;
set local search_path = public, extensions;

select plan(20);

-- Fixtures (as postgres, bypassing RLS) -------------------------------------
-- user A: notebook N1 (de) with sources S1, S2; notebook N2 (en) with S4
-- user B: notebook N3 (en) with S3
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-a000-00000000000a', 'rls-test-a@example.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-00000000000b', 'rls-test-b@example.invalid', 'authenticated', 'authenticated');

insert into public.notebooks (id, user_id, name, language) values
  ('10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-00000000000a', 'A1', 'de'),
  ('10000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-00000000000a', 'A2', 'en'),
  ('10000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-00000000000b', 'B1', 'en');

insert into public.sources (id, user_id, notebook_id, kind, title, storage_path) values
  ('20000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-00000000000a',
   '10000000-0000-4000-a000-000000000001', 'md', 'S1', 'a/1/s1/x.md'),
  ('20000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-00000000000a',
   '10000000-0000-4000-a000-000000000001', 'md', 'S2', 'a/1/s2/x.md'),
  ('20000000-0000-4000-a000-000000000004', '00000000-0000-4000-a000-00000000000a',
   '10000000-0000-4000-a000-000000000002', 'md', 'S4', 'a/2/s4/x.md'),
  ('20000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-00000000000b',
   '10000000-0000-4000-a000-000000000003', 'md', 'S3', 'b/3/s3/x.md');

-- Unit vector along axis k (1-based), as a 3072-dim halfvec.
create function pg_temp.axis(k int) returns extensions.halfvec language sql as $$
  select array_agg(case when i = k then 1 else 0 end order by i)::real[]::extensions.halfvec(3072)
  from generate_series(1, 3072) i;
$$;

create function pg_temp.login_as(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Chunks are written like the worker does (service role, explicit user_id).
set local role service_role;
insert into public.source_chunks
  (id, source_id, notebook_id, user_id, ordinal, content, char_start, char_end, token_count, embedding)
values
  ('50000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000001',
   '10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-00000000000a',
   0, 'Die Häuser am Hafen wurden 1890 gebaut.', 0, 39, 12, pg_temp.axis(1)),
  ('50000000-0000-4000-a000-000000000002', '20000000-0000-4000-a000-000000000001',
   '10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-00000000000a',
   1, 'Der Leuchtturm steht auf der Insel.', 40, 75, 10, pg_temp.axis(2)),
  ('50000000-0000-4000-a000-000000000003', '20000000-0000-4000-a000-000000000002',
   '10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-00000000000a',
   0, 'Fischer verkaufen ihren Fang am Morgen.', 0, 39, 11, pg_temp.axis(3)),
  ('50000000-0000-4000-a000-000000000004', '20000000-0000-4000-a000-000000000003',
   '10000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-00000000000b',
   0, 'The houses by the harbour were built in 1890.', 0, 45, 12, pg_temp.axis(1));

-- Schema ----------------------------------------------------------------------
set local role postgres;
select ok(
  (select relrowsecurity from pg_class where oid = 'public.source_chunks'::regclass),
  'RLS is enabled on source_chunks'
);
select ok(
  (select fts @@ to_tsquery('german', 'Haus') from public.source_chunks
   where id = '50000000-0000-4000-a000-000000000001'),
  'fts uses the notebook language (German stemming)'
);
select throws_ok(
  $$ insert into public.source_chunks
       (source_id, notebook_id, user_id, ordinal, content, char_start, char_end, token_count, embedding)
     values ('20000000-0000-4000-a000-000000000004', '10000000-0000-4000-a000-000000000001',
             '00000000-0000-4000-a000-00000000000a', 0, 'x', 0, 1, 1, pg_temp.axis(1)) $$,
  '23503', null, 'a chunk cannot point to a source from another notebook'
);
select throws_ok(
  $$ insert into public.source_chunks
       (source_id, notebook_id, user_id, ordinal, content, char_start, char_end, token_count, embedding)
     values ('20000000-0000-4000-a000-000000000003', '10000000-0000-4000-a000-000000000003',
             '00000000-0000-4000-a000-00000000000a', 9, 'x', 0, 1, 1, pg_temp.axis(1)) $$,
  '23503', null, 'a chunk owner must match the notebook owner'
);

-- As user A -------------------------------------------------------------------
select pg_temp.login_as('00000000-0000-4000-a000-00000000000a');
set local role authenticated;

select results_eq(
  $$ select ordinal from public.source_chunks order by source_id, ordinal $$,
  $$ values (0), (1), (0) $$,
  'A sees only own chunks'
);
select throws_ok(
  $$ insert into public.source_chunks
       (source_id, notebook_id, user_id, ordinal, content, char_start, char_end, token_count, embedding)
     values ('20000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000001',
             '00000000-0000-4000-a000-00000000000a', 9, 'x', 0, 1, 1, pg_temp.axis(1)) $$,
  '42501', null, 'A cannot insert chunks'
);
select throws_ok(
  $$ update public.source_chunks set content = 'changed' $$,
  '42501', null, 'A cannot update chunks'
);
select throws_ok(
  $$ delete from public.source_chunks $$, '42501', null, 'A cannot delete chunks directly'
);

-- match_chunks as A: vector, keyword and source filter
select is(
  (select id from public.match_chunks(
     '10000000-0000-4000-a000-000000000001', pg_temp.axis(2), '',
     array['20000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000002']::uuid[])
   limit 1),
  '50000000-0000-4000-a000-000000000002'::uuid,
  'the nearest embedding ranks first'
);
select results_eq(
  $$ select id, keyword_rank from public.match_chunks(
       '10000000-0000-4000-a000-000000000001', pg_temp.axis(3), 'Häuser',
       array['20000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000002']::uuid[])
     where keyword_rank is not null $$,
  $$ values ('50000000-0000-4000-a000-000000000001'::uuid, 1::bigint) $$,
  'keyword search matches in the notebook language'
);
select ok(
  (select score from public.match_chunks(
     '10000000-0000-4000-a000-000000000001', pg_temp.axis(1), 'Häuser',
     array['20000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000002']::uuid[])
   where id = '50000000-0000-4000-a000-000000000001')
  > (select score from public.match_chunks(
     '10000000-0000-4000-a000-000000000001', pg_temp.axis(1), 'Fang',
     array['20000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000002']::uuid[])
   where id = '50000000-0000-4000-a000-000000000001'),
  'a chunk found by both searches scores higher than by one'
);
select results_eq(
  $$ select id from public.match_chunks(
       '10000000-0000-4000-a000-000000000001', pg_temp.axis(1), 'Häuser Fischer',
       array['20000000-0000-4000-a000-000000000002']::uuid[]) $$,
  $$ values ('50000000-0000-4000-a000-000000000003'::uuid) $$,
  'only the selected sources are searched'
);
select is(
  (select count(*) from public.match_chunks(
     '10000000-0000-4000-a000-000000000001', pg_temp.axis(1), 'Häuser', '{}'::uuid[])),
  0::bigint, 'no selected sources, no results'
);
select is_empty(
  $$ select * from public.match_chunks(
       '10000000-0000-4000-a000-000000000003', pg_temp.axis(1), 'houses',
       array['20000000-0000-4000-a000-000000000003']::uuid[]) $$,
  'A cannot retrieve chunks from B''s notebook'
);

-- Language change recomputes fts (A owns N1)
update public.notebooks set language = 'en' where id = '10000000-0000-4000-a000-000000000001';
set local role postgres;
select ok(
  (select fts = to_tsvector('english', content) from public.source_chunks
   where id = '50000000-0000-4000-a000-000000000001'),
  'changing the notebook language recomputes fts'
);

-- As user B -------------------------------------------------------------------
select pg_temp.login_as('00000000-0000-4000-a000-00000000000b');
set local role authenticated;
select results_eq(
  $$ select id from public.source_chunks $$,
  $$ values ('50000000-0000-4000-a000-000000000004'::uuid) $$,
  'B sees only own chunks'
);

-- service role must scope by user -----------------------------------------------
set local role postgres;
set local role service_role;
select is_empty(
  $$ select * from public.match_chunks(
       '10000000-0000-4000-a000-000000000003', pg_temp.axis(1), 'houses',
       array['20000000-0000-4000-a000-000000000003']::uuid[],
       p_user_id => '00000000-0000-4000-a000-00000000000a') $$,
  'p_user_id restricts service-role retrieval to that user'
);

-- anon --------------------------------------------------------------------------
set local role postgres;
set local role anon;
select throws_ok(
  $$ select * from public.source_chunks $$, '42501', null, 'anon cannot read chunks'
);
select throws_ok(
  $$ select * from public.match_chunks(
       '10000000-0000-4000-a000-000000000001', pg_temp.axis(1), 'x',
       array['20000000-0000-4000-a000-000000000001']::uuid[]) $$,
  '42501', null, 'anon cannot call match_chunks'
);

-- Cascade -----------------------------------------------------------------------
set local role postgres;
delete from public.sources where id = '20000000-0000-4000-a000-000000000001';
select is_empty(
  $$ select 1 from public.source_chunks where source_id = '20000000-0000-4000-a000-000000000001' $$,
  'deleting a source deletes its chunks'
);

select * from finish();
rollback;
