-- Storage buckets and storage.objects policies (sources, podcasts).
-- Runs against the remote project via `npm run db:test`; everything is rolled back.
begin;
-- The CLI connects with a restricted login role that is a member of postgres.
set local role postgres;
set local search_path = public, extensions;

select plan(22);

-- Fixtures (as postgres, bypassing RLS) -------------------------------------
-- user A owns notebook N1, user B owns notebook N3
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-a000-00000000000a', 'rls-test-a@example.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-00000000000b', 'rls-test-b@example.invalid', 'authenticated', 'authenticated');

insert into public.notebooks (id, user_id, name, language) values
  ('10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-00000000000a', 'A1', 'en'),
  ('10000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-00000000000b', 'B1', 'en');

insert into storage.objects (bucket_id, name) values
  ('sources', '00000000-0000-4000-a000-00000000000a/10000000-0000-4000-a000-000000000001/s1/a.md'),
  ('sources', '00000000-0000-4000-a000-00000000000b/10000000-0000-4000-a000-000000000003/s3/b.md'),
  ('podcasts', '00000000-0000-4000-a000-00000000000a/10000000-0000-4000-a000-000000000001/p1/a.mp3'),
  ('podcasts', '00000000-0000-4000-a000-00000000000b/10000000-0000-4000-a000-000000000003/p3/b.mp3');

create function pg_temp.login_as(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Buckets -------------------------------------------------------------------
select results_eq(
  $$ select id, public from storage.buckets where id in ('sources', 'podcasts') order by id $$,
  $$ values ('podcasts'::text, false), ('sources'::text, false) $$,
  'both buckets exist and are private'
);
select is(
  (select file_size_limit from storage.buckets where id = 'sources'),
  (25 * 1024 * 1024)::bigint,
  'sources are limited to 25 MB'
);
select ok(
  (select allowed_mime_types @> array[
     'application/pdf',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
     'text/markdown']
   from storage.buckets where id = 'sources'),
  'sources accept PDF, DOCX and Markdown'
);
select is(
  (select allowed_mime_types from storage.buckets where id = 'podcasts'),
  array['audio/mpeg'],
  'podcasts accept MP3 only'
);

-- As user A -----------------------------------------------------------------
select pg_temp.login_as('00000000-0000-4000-a000-00000000000a');
set local role authenticated;
-- storage.protect_delete blocks SQL deletes unless this is set; the Storage API sets it too.
set local storage.allow_delete_query = 'true';

select lives_ok(
  $$ insert into storage.objects (bucket_id, name) values ('sources',
       '00000000-0000-4000-a000-00000000000a/10000000-0000-4000-a000-000000000001/s2/new.pdf') $$,
  'A can upload a source into an own notebook'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('sources',
       '00000000-0000-4000-a000-00000000000b/10000000-0000-4000-a000-000000000003/s9/x.md') $$,
  '42501', null, 'A cannot upload into B''s folder'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('sources',
       '00000000-0000-4000-a000-00000000000a/10000000-0000-4000-a000-000000000003/s9/x.md') $$,
  '42501', null, 'A cannot upload into B''s notebook under the own user folder'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('sources',
       '00000000-0000-4000-a000-00000000000a/10000000-0000-4000-a000-0000000000ff/s9/x.md') $$,
  '42501', null, 'A cannot upload into a notebook that does not exist'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('sources',
       '00000000-0000-4000-a000-00000000000a/10000000-0000-4000-a000-000000000001/x.md') $$,
  '42501', null, 'uploads must use the {user}/{notebook}/{entity}/{file} layout (too shallow)'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('sources',
       '00000000-0000-4000-a000-00000000000a/10000000-0000-4000-a000-000000000001/s9/x/y.md') $$,
  '42501', null, 'uploads must use the {user}/{notebook}/{entity}/{file} layout (too deep)'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('podcasts',
       '00000000-0000-4000-a000-00000000000a/10000000-0000-4000-a000-000000000001/p9/x.mp3') $$,
  '42501', null, 'A cannot upload podcast audio (worker only)'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('other',
       '00000000-0000-4000-a000-00000000000a/10000000-0000-4000-a000-000000000001/s9/x.md') $$,
  null, null, 'A cannot upload into other buckets'
);

select results_eq(
  $$ select bucket_id, name from storage.objects order by bucket_id, name $$,
  $$ values
       ('podcasts'::text, '00000000-0000-4000-a000-00000000000a/10000000-0000-4000-a000-000000000001/p1/a.mp3'::text),
       ('sources', '00000000-0000-4000-a000-00000000000a/10000000-0000-4000-a000-000000000001/s1/a.md'),
       ('sources', '00000000-0000-4000-a000-00000000000a/10000000-0000-4000-a000-000000000001/s2/new.pdf') $$,
  'A sees only own objects'
);
select is_empty(
  $$ update storage.objects set name = name || '.x' returning name $$,
  'A cannot update objects (no overwrite)'
);
select is_empty(
  $$ delete from storage.objects
     where name like '00000000-0000-4000-a000-00000000000b/%' returning name $$,
  'A cannot delete B''s objects'
);
select results_eq(
  $$ delete from storage.objects
     where bucket_id = 'sources'
       and name like '00000000-0000-4000-a000-00000000000a/10000000-0000-4000-a000-000000000001/s1/%'
     returning name $$,
  $$ values ('00000000-0000-4000-a000-00000000000a/10000000-0000-4000-a000-000000000001/s1/a.md'::text) $$,
  'A can delete own source files'
);
select results_eq(
  $$ delete from storage.objects
     where bucket_id = 'podcasts'
       and name like '00000000-0000-4000-a000-00000000000a/10000000-0000-4000-a000-000000000001/%'
     returning name $$,
  $$ values ('00000000-0000-4000-a000-00000000000a/10000000-0000-4000-a000-000000000001/p1/a.mp3'::text) $$,
  'A can delete own podcast audio (notebook delete)'
);

-- As user B -----------------------------------------------------------------
select pg_temp.login_as('00000000-0000-4000-a000-00000000000b');

select results_eq(
  $$ select name from storage.objects order by name $$,
  $$ values
       ('00000000-0000-4000-a000-00000000000b/10000000-0000-4000-a000-000000000003/p3/b.mp3'::text),
       ('00000000-0000-4000-a000-00000000000b/10000000-0000-4000-a000-000000000003/s3/b.md') $$,
  'B sees only own objects'
);

-- Anonymous -----------------------------------------------------------------
set local role postgres;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select is_empty($$ select name from storage.objects $$, 'anon sees no objects');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('sources',
       '00000000-0000-4000-a000-00000000000a/10000000-0000-4000-a000-000000000001/s9/x.md') $$,
  '42501', null, 'anon cannot upload'
);

-- Service role (worker) -------------------------------------------------------
set local role postgres;
set local role service_role;
select lives_ok(
  $$ insert into storage.objects (bucket_id, name) values ('podcasts',
       '00000000-0000-4000-a000-00000000000a/10000000-0000-4000-a000-000000000001/p2/x.mp3') $$,
  'the service role can write podcast audio'
);

-- Helper ----------------------------------------------------------------------
set local role postgres;
set local role postgres;
select ok(
  not has_function_privilege('anon', 'private.is_own_notebook_object_path(text)', 'execute')
    and not has_schema_privilege('anon', 'private', 'usage'),
  'anon cannot reach the path helper'
);

select * from finish();
rollback;
