-- Podcast production limits. Runs against the remote project via `npm run db:test`;
-- everything is rolled back.
begin;
-- The CLI connects with a restricted login role that is a member of postgres.
set local role postgres;
set local search_path = public, extensions;

select plan(6);

-- Fixtures (as postgres, bypassing RLS) -------------------------------------
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-a000-0000000000c1', 'podcast-test-a@example.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-0000000000c2', 'podcast-test-b@example.invalid', 'authenticated', 'authenticated');

insert into public.notebooks (id, user_id, name, language) values
  ('10000000-0000-4000-a000-0000000000c1', '00000000-0000-4000-a000-0000000000c1', 'A', 'en'),
  ('10000000-0000-4000-a000-0000000000c2', '00000000-0000-4000-a000-0000000000c2', 'B', 'de');

create function pg_temp.login_as(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- As user A -------------------------------------------------------------------
select pg_temp.login_as('00000000-0000-4000-a000-0000000000c1');
set local role authenticated;

select lives_ok(
  $$ insert into public.podcasts (id, notebook_id, topic, mode, target_minutes)
     values ('40000000-0000-4000-a000-0000000000c1', '10000000-0000-4000-a000-0000000000c1',
             'Topic', 'dialogue', 6) $$,
  'A can queue a podcast'
);
select throws_ok(
  $$ insert into public.podcasts (notebook_id, topic, mode, target_minutes)
     values ('10000000-0000-4000-a000-0000000000c1', 'Second', 'monologue', 2) $$,
  '23505', null, 'A cannot queue a second podcast while one is in production'
);

-- As user B: the limit is per user ----------------------------------------------
select pg_temp.login_as('00000000-0000-4000-a000-0000000000c2');
select lives_ok(
  $$ insert into public.podcasts (notebook_id, topic, mode, target_minutes)
     values ('10000000-0000-4000-a000-0000000000c2', 'Thema', 'dialogue', 2) $$,
  'B can queue a podcast while A has one in production'
);

-- The worker moves A's podcast on (as postgres, like the service role bypassing RLS) ----
reset role;
set local role postgres;
update public.podcasts set status = 'synthesizing'
  where id = '40000000-0000-4000-a000-0000000000c1';

select pg_temp.login_as('00000000-0000-4000-a000-0000000000c1');
set local role authenticated;
select throws_ok(
  $$ insert into public.podcasts (notebook_id, topic, mode, target_minutes)
     values ('10000000-0000-4000-a000-0000000000c1', 'Second', 'monologue', 2) $$,
  '23505', null, 'synthesizing still counts as in production'
);

reset role;
set local role postgres;
update public.podcasts set status = 'ready'
  where id = '40000000-0000-4000-a000-0000000000c1';

select pg_temp.login_as('00000000-0000-4000-a000-0000000000c1');
set local role authenticated;
select lives_ok(
  $$ insert into public.podcasts (notebook_id, topic, mode, target_minutes)
     values ('10000000-0000-4000-a000-0000000000c1', 'Second', 'monologue', 2) $$,
  'A can queue the next podcast once the previous one is ready'
);
select is(
  (select count(*)::int from public.podcasts),
  2, 'A sees both own podcasts'
);

select * from finish();
rollback;
