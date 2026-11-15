-- RLS, cross-user and cross-notebook tests for the notebook content tables.
-- Runs against the remote project via `npm run db:test`; everything is rolled back.
begin;
-- The CLI connects with a restricted login role that is a member of postgres.
set local role postgres;
set local search_path = public, extensions;

select plan(27);

-- Fixtures (as postgres, bypassing RLS) -------------------------------------
-- user A: notebooks N1, N2; user B: notebook N3
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-a000-00000000000a', 'rls-test-a@example.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-00000000000b', 'rls-test-b@example.invalid', 'authenticated', 'authenticated');

insert into public.notebooks (id, user_id, name, language) values
  ('10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-00000000000a', 'A1', 'de'),
  ('10000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-00000000000a', 'A2', 'en'),
  ('10000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-00000000000b', 'B1', 'en');

insert into public.sources (id, user_id, notebook_id, kind, title, storage_path) values
  ('20000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-00000000000a',
   '10000000-0000-4000-a000-000000000001', 'md', 'A1 source', 'a/1/s1/x.md'),
  ('20000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-00000000000a',
   '10000000-0000-4000-a000-000000000002', 'md', 'A2 source', 'a/2/s2/x.md'),
  ('20000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-00000000000b',
   '10000000-0000-4000-a000-000000000003', 'md', 'B1 source', 'b/3/s3/x.md');

insert into public.chats (id, user_id, notebook_id, title) values
  ('30000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-00000000000a',
   '10000000-0000-4000-a000-000000000001', 'A1 chat'),
  ('30000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-00000000000b',
   '10000000-0000-4000-a000-000000000003', 'B1 chat');

create function pg_temp.login_as(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Schema ----------------------------------------------------------------------
select ok(
  (select bool_and(relrowsecurity) from pg_class
   where oid in ('public.sources'::regclass, 'public.chats'::regclass,
                 'public.chat_sources'::regclass, 'public.messages'::regclass,
                 'public.podcasts'::regclass, 'public.podcast_sources'::regclass)),
  'RLS is enabled on all content tables'
);

-- As user A -------------------------------------------------------------------
select pg_temp.login_as('00000000-0000-4000-a000-00000000000a');
set local role authenticated;

select results_eq(
  $$ select title from public.sources order by title $$,
  $$ values ('A1 source'), ('A2 source') $$,
  'A sees only own sources'
);
select results_eq(
  $$ select title from public.chats $$, $$ values ('A1 chat') $$, 'A sees only own chats'
);

-- sources
select lives_ok(
  $$ insert into public.sources (id, notebook_id, kind, title, original_url)
     values ('20000000-0000-4000-a000-000000000011', '10000000-0000-4000-a000-000000000001',
             'url', 'Web page', 'https://example.com') $$,
  'A can add a URL source to own notebook'
);
select is(
  (select status from public.sources where id = '20000000-0000-4000-a000-000000000011'),
  'pending', 'new sources start as pending'
);
select throws_ok(
  $$ insert into public.sources (notebook_id, kind, title, storage_path)
     values ('10000000-0000-4000-a000-000000000003', 'md', 'x', 'p') $$,
  '23503', null, 'A cannot add a source to B''s notebook'
);
select throws_ok(
  $$ insert into public.sources (notebook_id, kind, title, storage_path, status)
     values ('10000000-0000-4000-a000-000000000001', 'md', 'x', 'p', 'ready') $$,
  '42501', null, 'A cannot set source status'
);
select throws_ok(
  $$ update public.sources set status = 'ready' where id = '20000000-0000-4000-a000-000000000001' $$,
  '42501', null, 'A cannot update source status'
);
select lives_ok(
  $$ update public.sources set title = 'Renamed' where id = '20000000-0000-4000-a000-000000000001' $$,
  'A can rename own source'
);
select throws_ok(
  $$ insert into public.sources (notebook_id, kind, title) values
     ('10000000-0000-4000-a000-000000000001', 'url', 'no url') $$,
  '23514', null, 'URL sources require original_url'
);

-- chats and chat_sources
select lives_ok(
  $$ insert into public.chat_sources (chat_id, source_id, notebook_id) values
     ('30000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000001',
      '10000000-0000-4000-a000-000000000001') $$,
  'A can select a source of the same notebook for a chat'
);
select throws_ok(
  $$ insert into public.chat_sources (chat_id, source_id, notebook_id) values
     ('30000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000002',
      '10000000-0000-4000-a000-000000000001') $$,
  '23503', null, 'A cannot select a source from another notebook'
);
select throws_ok(
  $$ insert into public.chat_sources (chat_id, source_id, notebook_id) values
     ('30000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000003',
      '10000000-0000-4000-a000-000000000001') $$,
  '23503', null, 'A cannot select B''s source'
);
select throws_ok(
  $$ insert into public.chats (notebook_id, title) values ('10000000-0000-4000-a000-000000000003', 'x') $$,
  '23503', null, 'A cannot create a chat in B''s notebook'
);

-- messages
select lives_ok(
  $$ insert into public.messages (chat_id, role, content)
     values ('30000000-0000-4000-a000-000000000001', 'user', 'Hello') $$,
  'A can add a message to own chat'
);
select throws_ok(
  $$ insert into public.messages (chat_id, role, content)
     values ('30000000-0000-4000-a000-000000000003', 'user', 'Hi B') $$,
  '23503', null, 'A cannot add a message to B''s chat'
);
select throws_ok(
  $$ update public.messages set content = 'edited' $$,
  '42501', null, 'messages are immutable for users'
);

-- podcasts
select lives_ok(
  $$ insert into public.podcasts (id, notebook_id, topic, mode, target_minutes) values
     ('40000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000001',
      'Topic', 'dialogue', 6) $$,
  'A can create a podcast'
);
select is(
  (select language from public.podcasts where id = '40000000-0000-4000-a000-000000000001'),
  'de', 'podcast language is copied from the notebook'
);
select throws_ok(
  $$ insert into public.podcasts (notebook_id, topic, mode, target_minutes)
     values ('10000000-0000-4000-a000-000000000003', 'Topic', 'monologue', 2) $$,
  '23503', null, 'A cannot create a podcast in B''s notebook'
);
select throws_ok(
  $$ insert into public.podcasts (notebook_id, topic, mode, target_minutes)
     values ('10000000-0000-4000-a000-000000000001', 'Topic', 'monologue', 5) $$,
  '23514', null, 'podcast length must be 2, 6 or 15 minutes'
);
select throws_ok(
  $$ update public.podcasts set status = 'ready' $$,
  '42501', null, 'A cannot update podcast status'
);
select throws_ok(
  $$ insert into public.podcast_sources (podcast_id, source_id, notebook_id) values
     ('40000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000002',
      '10000000-0000-4000-a000-000000000001') $$,
  '23503', null, 'A cannot base a podcast on a source from another notebook'
);

-- As user B: A's data is invisible and untouchable ------------------------------
set local role postgres;
select pg_temp.login_as('00000000-0000-4000-a000-00000000000b');
set local role authenticated;

select is_empty(
  $$ select 1 from public.sources where user_id = '00000000-0000-4000-a000-00000000000a'
     union all select 1 from public.chats where user_id = '00000000-0000-4000-a000-00000000000a'
     union all select 1 from public.messages where user_id = '00000000-0000-4000-a000-00000000000a'
     union all select 1 from public.podcasts where user_id = '00000000-0000-4000-a000-00000000000a'
     union all select 1 from public.chat_sources where user_id = '00000000-0000-4000-a000-00000000000a' $$,
  'B sees none of A''s content'
);
select is_empty(
  $$ delete from public.sources where id = '20000000-0000-4000-a000-000000000001' returning id $$,
  'B cannot delete A''s source'
);

-- anon --------------------------------------------------------------------------
set local role postgres;
set local role anon;
select throws_ok($$ select * from public.sources $$, '42501', null, 'anon cannot read sources');

-- Cascade: deleting a notebook removes its content -----------------------------
set local role postgres;
delete from public.notebooks where id = '10000000-0000-4000-a000-000000000001';
select is_empty(
  $$ select 1 from public.sources where notebook_id = '10000000-0000-4000-a000-000000000001'
     union all select 1 from public.chats where notebook_id = '10000000-0000-4000-a000-000000000001'
     union all select 1 from public.messages where chat_id = '30000000-0000-4000-a000-000000000001'
     union all select 1 from public.podcasts where notebook_id = '10000000-0000-4000-a000-000000000001' $$,
  'deleting a notebook cascades to its content'
);

select * from finish();
rollback;
