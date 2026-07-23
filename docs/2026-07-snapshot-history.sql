-- Snapshots used to be one row per (tournament, entry/golfer, round) --
-- upserted in place every time the cron ran, so re-running it just kept
-- overwriting the same row with the latest state. Now that live syncs
-- during play write a snapshot too (see App.jsx's refreshLive, throttled
-- to once per 30 min per round), we want every capture to land as its own
-- row instead of clobbering the last one -- that's what actually produces
-- an intra-day trend line to track.
--
-- This drops the old "one row per round" unique constraints so multiple
-- captures per round can coexist. Both tables already have a `created_at`
-- timestamp (default now()) from when they were created, so no new column
-- is needed -- just remove what was stopping more than one row per round.
--
-- Paste this into Supabase -> SQL Editor -> New query -> Run.
-- Safe to re-run: only drops constraints if found.

do $$
declare
  c record;
begin
  for c in
    select tc.constraint_name, tc.table_name
    from information_schema.table_constraints tc
    where tc.constraint_type = 'UNIQUE'
      and tc.table_name in ('snapshots', 'golfer_snapshots')
  loop
    execute format('alter table %I drop constraint %I', c.table_name, c.constraint_name);
  end loop;
end $$;
