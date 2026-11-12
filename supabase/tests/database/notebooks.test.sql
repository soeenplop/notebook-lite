-- RLS and constraint tests for public.notebooks.
-- Runs against the remote project via `npm run db:test`; everything is rolled back.
begin;
-- The CLI connects with a restricted login role that is a member of postgres.
set local role postgres;
set local search_path = public, extensions;

select plan(16);

-- Test users ---------------------------------------------------------------
insert into auth.users (id, email, aud, role)
values
  ('00000000-0000-4000-a000-00000000000a', 'rls-test-a@example.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-00000000000b', 'rls-test-b@example.invalid', 'authenticated', 'authenticated');

-- Helpers (temporary, dropped on rollback) ----------------------------------
create function pg_temp.login_as(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Schema --------------------------------------------------------------------
select has_table('public', 'notebooks', 'notebooks table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.notebooks'::regclass),
  'RLS is enabled on notebooks'
);
select is(public.language_regconfig('de'), 'german'::regconfig, 'de maps to german FTS config');
select is(public.language_regconfig('xx'), 'simple'::regconfig, 'unknown language maps to simple');

-- User A creates a notebook ---------------------------------------------------
select pg_temp.login_as('00000000-0000-4000-a000-00000000000a');
set local role authenticated;

select lives_ok(
  $$ insert into public.notebooks (id, name, description, language)
     values ('10000000-0000-4000-a000-000000000001', 'A''s notebook', 'desc', 'de') $$,
  'owner can create a notebook (user_id defaults to auth.uid())'
);
select results_eq(
  $$ select user_id from public.notebooks $$,
  $$ values ('00000000-0000-4000-a000-00000000000a'::uuid) $$,
  'owner sees exactly their notebook'
);
select throws_ok(
  $$ insert into public.notebooks (name, language) values ('   ', 'en') $$,
  '23514', null, 'blank name is rejected'
);
select throws_ok(
  $$ insert into public.notebooks (name, language) values ('x', 'fr') $$,
  '23514', null, 'unsupported language is rejected'
);
select throws_ok(
  $$ insert into public.notebooks (name, language, user_id)
     values ('spoof', 'en', '00000000-0000-4000-a000-00000000000b') $$,
  '42501', null, 'cannot create a notebook for another user'
);

-- User B cannot see or touch A's notebook --------------------------------------
set local role postgres;
select pg_temp.login_as('00000000-0000-4000-a000-00000000000b');
set local role authenticated;

select is_empty($$ select * from public.notebooks $$, 'other user sees no notebooks');
select is_empty(
  $$ update public.notebooks set name = 'hijacked'
     where id = '10000000-0000-4000-a000-000000000001' returning id $$,
  'other user cannot update'
);
select is_empty(
  $$ delete from public.notebooks
     where id = '10000000-0000-4000-a000-000000000001' returning id $$,
  'other user cannot delete'
);

-- Owner cannot hand a notebook to someone else --------------------------------
set local role postgres;
select pg_temp.login_as('00000000-0000-4000-a000-00000000000a');
set local role authenticated;

select throws_ok(
  $$ update public.notebooks set user_id = '00000000-0000-4000-a000-00000000000b'
     where id = '10000000-0000-4000-a000-000000000001' $$,
  '42501', null, 'owner cannot transfer ownership'
);
select lives_ok(
  $$ update public.notebooks set name = 'Renamed', language = 'en'
     where id = '10000000-0000-4000-a000-000000000001' $$,
  'owner can edit name and language'
);

-- anon has no access ----------------------------------------------------------
set local role postgres;
set local role anon;
select throws_ok($$ select * from public.notebooks $$, '42501', null, 'anon cannot read notebooks');

-- Cascade on user deletion ----------------------------------------------------
set local role postgres;
delete from auth.users where id = '00000000-0000-4000-a000-00000000000a';
select is_empty(
  $$ select * from public.notebooks where id = '10000000-0000-4000-a000-000000000001' $$,
  'notebooks are deleted with their owner'
);

select * from finish();
rollback;
