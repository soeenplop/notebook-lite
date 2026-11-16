-- Announces podcast progress (status, title) on the `podcast_changes` channel. The API LISTENs
-- and pushes the change to the owner's open pages over SSE (tRPC subscription). The payload
-- carries only ids and the status; clients refetch the podcast through RLS. NOTIFY is
-- delivered on commit, so rolled-back updates announce nothing.
create function public.notify_podcast_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_notify(
    'podcast_changes',
    json_build_object(
      'userId', new.user_id,
      'notebookId', new.notebook_id,
      'podcastId', new.id,
      'status', new.status
    )::text
  );
  return null;
end;
$$;

create trigger podcasts_notify_change
  after update on public.podcasts
  for each row
  when (old.status is distinct from new.status or old.title is distinct from new.title)
  execute function public.notify_podcast_change();
