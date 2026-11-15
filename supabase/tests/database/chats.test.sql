-- The statements the chat API (M4) runs as the user: create a chat with preselected sources,
-- replace the selection (upsert ignoring duplicates + delete the rest), persist messages with a
-- citation snapshot, touch the chat via `title = title`, and read cited chunks.
-- Runs against the remote project via `npm run db:test`; everything is rolled back.
begin;
-- The CLI connects with a restricted login role that is a member of postgres.
set local role postgres;
set local search_path = public, extensions;

select plan(12);

-- Fixtures (as postgres, bypassing RLS) -------------------------------------
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-c000-00000000000a', 'chat-test-a@example.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-c000-00000000000b', 'chat-test-b@example.invalid', 'authenticated', 'authenticated');

insert into public.notebooks (id, user_id, name, language) values
  ('10000000-0000-4000-c000-000000000001', '00000000-0000-4000-c000-00000000000a', 'A1', 'en'),
  ('10000000-0000-4000-c000-000000000002', '00000000-0000-4000-c000-00000000000a', 'A2', 'en'),
  ('10000000-0000-4000-c000-000000000003', '00000000-0000-4000-c000-00000000000b', 'B1', 'en');

insert into public.sources (id, user_id, notebook_id, kind, title, storage_path, status) values
  ('20000000-0000-4000-c000-000000000001', '00000000-0000-4000-c000-00000000000a',
   '10000000-0000-4000-c000-000000000001', 'md', 'Ready 1', 'a/1/1/x.md', 'ready'),
  ('20000000-0000-4000-c000-000000000002', '00000000-0000-4000-c000-00000000000a',
   '10000000-0000-4000-c000-000000000001', 'md', 'Ready 2', 'a/1/2/x.md', 'ready'),
  ('20000000-0000-4000-c000-000000000003', '00000000-0000-4000-c000-00000000000a',
   '10000000-0000-4000-c000-000000000002', 'md', 'Other notebook', 'a/2/3/x.md', 'ready'),
  ('20000000-0000-4000-c000-000000000004', '00000000-0000-4000-c000-00000000000b',
   '10000000-0000-4000-c000-000000000003', 'md', 'B source', 'b/3/4/x.md', 'ready');

insert into public.source_chunks
  (id, user_id, notebook_id, source_id, ordinal, content, page_start, page_end, char_start,
   char_end, token_count, embedding)
values
  ('40000000-0000-4000-c000-000000000001', '00000000-0000-4000-c000-00000000000a',
   '10000000-0000-4000-c000-000000000001', '20000000-0000-4000-c000-000000000001', 0,
   'Water boils at 100 degrees.', 3, 3, 0, 27, 6, array_fill(0.1, array[3072])::halfvec(3072)),
  ('40000000-0000-4000-c000-000000000004', '00000000-0000-4000-c000-00000000000b',
   '10000000-0000-4000-c000-000000000003', '20000000-0000-4000-c000-000000000004', 0,
   'B secret.', null, null, 0, 9, 2, array_fill(0.1, array[3072])::halfvec(3072));

create function pg_temp.login_as(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- As user A -------------------------------------------------------------------
select pg_temp.login_as('00000000-0000-4000-c000-00000000000a');
set local role authenticated;

-- chats.create: insert the chat, preselect the ready sources
select lives_ok(
  $$ insert into public.chats (id, notebook_id)
     values ('30000000-0000-4000-c000-000000000001', '10000000-0000-4000-c000-000000000001') $$,
  'A creates a chat'
);
select lives_ok(
  $$ insert into public.chat_sources (chat_id, source_id, notebook_id) values
     ('30000000-0000-4000-c000-000000000001', '20000000-0000-4000-c000-000000000001',
      '10000000-0000-4000-c000-000000000001') $$,
  'A preselects a ready source'
);

-- chats.setSources: upsert ignoring duplicates, then delete deselected sources
select lives_ok(
  $$ insert into public.chat_sources (chat_id, source_id, notebook_id) values
     ('30000000-0000-4000-c000-000000000001', '20000000-0000-4000-c000-000000000001',
      '10000000-0000-4000-c000-000000000001'),
     ('30000000-0000-4000-c000-000000000001', '20000000-0000-4000-c000-000000000002',
      '10000000-0000-4000-c000-000000000001')
     on conflict (chat_id, source_id) do nothing $$,
  'A adds sources with an upsert that ignores existing rows'
);
select lives_ok(
  $$ delete from public.chat_sources
     where chat_id = '30000000-0000-4000-c000-000000000001'
       and source_id not in ('20000000-0000-4000-c000-000000000002') $$,
  'A removes deselected sources'
);
select results_eq(
  $$ select source_id from public.chat_sources where chat_id = '30000000-0000-4000-c000-000000000001' $$,
  $$ values ('20000000-0000-4000-c000-000000000002'::uuid) $$,
  'the selection was replaced'
);
select throws_ok(
  $$ insert into public.chat_sources (chat_id, source_id, notebook_id) values
     ('30000000-0000-4000-c000-000000000001', '20000000-0000-4000-c000-000000000003',
      '10000000-0000-4000-c000-000000000001')
     on conflict (chat_id, source_id) do nothing $$,
  '23503', null, 'A cannot select a source from another notebook'
);

-- stream: persist question and answer with a citation snapshot and usage
select lives_ok(
  $$ insert into public.messages (chat_id, role, content) values
     ('30000000-0000-4000-c000-000000000001', 'user', 'When does water boil?') $$,
  'A stores the question'
);
select lives_ok(
  $$ insert into public.messages (chat_id, role, content, citations, model, usage) values
     ('30000000-0000-4000-c000-000000000001', 'assistant', 'At 100 degrees [1].',
      '[{"marker":1,"chunkId":"40000000-0000-4000-c000-000000000001","sourceId":"20000000-0000-4000-c000-000000000001","sourceTitle":"Ready 1","page":3,"quote":"Water boils at 100 degrees."}]',
      'gpt-6.1-terra', '{"inputTokens":10,"outputTokens":5,"totalTokens":15}') $$,
  'A stores the answer with citations and usage'
);

-- stream: `title = title` touches the chat (updated_at trigger) for the chat list order
set local role postgres;
update public.chats set updated_at = now() - interval '1 hour'
where id = '30000000-0000-4000-c000-000000000001';
set local role authenticated;
select lives_ok(
  $$ update public.chats set title = 'Boiling' where id = '30000000-0000-4000-c000-000000000001' $$,
  'A sets the automatic title'
);
select ok(
  (select updated_at > now() - interval '1 minute' from public.chats
   where id = '30000000-0000-4000-c000-000000000001'),
  'updating the title bumps updated_at'
);

-- chats.chunk: cited chunk with its source title; B's chunks stay invisible
select results_eq(
  $$ select c.content, s.title from public.source_chunks c
     join public.sources s on s.id = c.source_id and s.notebook_id = c.notebook_id
     where c.id = '40000000-0000-4000-c000-000000000001' $$,
  $$ values ('Water boils at 100 degrees.'::text, 'Ready 1'::text) $$,
  'A reads an own cited chunk'
);
select is_empty(
  $$ select 1 from public.source_chunks where id = '40000000-0000-4000-c000-000000000004' $$,
  'A cannot read B''s chunks'
);

select * from finish();
rollback;
