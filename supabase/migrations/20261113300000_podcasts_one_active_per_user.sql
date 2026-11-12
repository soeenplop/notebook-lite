-- At most one podcast per user may be in production (queued, scripting or synthesizing) at a
-- time. The API checks this before enqueueing; the index closes the race between two
-- concurrent create calls. A stuck podcast can always be deleted by its owner.
create unique index podcasts_one_active_per_user_idx
  on public.podcasts (user_id)
  where status in ('queued', 'scripting', 'synthesizing');
