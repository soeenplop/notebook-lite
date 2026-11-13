-- Private Storage buckets for source files (uploads, URL snapshots) and podcast audio.
--
-- Object path convention: {user_id}/{notebook_id}/{entity_id}/{filename}
--   * the first folder is always the owner's user id (checked by every policy)
--   * uploads by users must target a notebook they own, at exactly that depth
--   * the worker writes with the service role (bypasses RLS) and builds paths the same way
--
-- Users may upload, read and delete source files, and read and delete podcast audio (the
-- worker creates it). Nobody updates objects through RLS: uploads never overwrite.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'sources', 'sources', false, 25 * 1024 * 1024,
    array[
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/markdown',
      'text/plain'
    ]
  ),
  ('podcasts', 'podcasts', false, 50 * 1024 * 1024, array['audio/mpeg'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Helpers for policies live in `private`, a schema PostgREST does not expose (no RPC endpoint).
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- True if `object_name` is {auth.uid()}/{notebook}/{entity}/{filename} and the caller owns the
-- notebook. Security invoker: the notebook lookup itself is subject to notebooks RLS.
create function private.is_own_notebook_object_path(object_name text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(array_length(storage.foldername(object_name), 1), 0) = 3
    and (storage.foldername(object_name))[1] = (select auth.uid())::text
    and exists (
      select 1
      from public.notebooks n
      where n.id::text = (storage.foldername(object_name))[2]
        and n.user_id = (select auth.uid())
    );
$$;

revoke all on function private.is_own_notebook_object_path(text) from public, anon;
grant execute on function private.is_own_notebook_object_path(text) to authenticated, service_role;

-- sources: upload into own notebooks; read and delete everything under the own user folder.
create policy sources_objects_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'sources'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy sources_objects_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'sources'
    and private.is_own_notebook_object_path(name)
  );

create policy sources_objects_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'sources'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- podcasts: written by the worker only; users read (signed URLs) and delete (notebook delete).
create policy podcasts_objects_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'podcasts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy podcasts_objects_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'podcasts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
