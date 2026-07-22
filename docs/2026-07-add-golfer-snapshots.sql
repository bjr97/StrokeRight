-- Adds a golfer-level per-round snapshot table, alongside the existing
-- entry-level `snapshots` table. The daily capture cron (api/capture-
-- snapshot.js) currently only persists each entry's total/rank per round —
-- it does NOT preserve golfer-level state (status, strokes, position) from
-- one day to the next, since the `golfers` table just gets overwritten with
-- the latest live data each cron run. Without this, the win-probability
-- model's "upside" (live position) and "odds" terms can never be backtested
-- against real history, no matter how long the cron runs.
--
-- Paste this into Supabase -> SQL Editor -> New query -> Run.
-- Safe to re-run: uses IF NOT EXISTS.

create table if not exists golfer_snapshots (
  id              bigserial primary key,
  tournament_id   text not null references tournaments(id) on delete cascade,
  golfer_id       text not null,
  round           int not null,
  status          text,
  strokes_to_par  int,
  thru            int,
  position        text,
  created_at      timestamptz default now(),
  unique (tournament_id, golfer_id, round)
);
create index if not exists golfer_snapshots_tournament_idx on golfer_snapshots (tournament_id);

alter table golfer_snapshots enable row level security;
drop policy if exists anon_all on golfer_snapshots;
create policy anon_all on golfer_snapshots for all to anon using (true) with check (true);
