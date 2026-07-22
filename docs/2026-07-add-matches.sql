-- 1v1 match feature: two players draft 6 golfers each (5 starters + 1
-- extra/alternate) via an async snake draft, tied to an existing
-- tournament's golfer field. Picks are stored as ordered jsonb arrays;
-- scoring/result logic lives in src/lib/matches.js (reuses src/lib/
-- scoring.js against whichever golfer data the tournament already has).
--
-- Paste this into Supabase -> SQL Editor -> New query -> Run.
-- Safe to re-run: uses IF NOT EXISTS.

create table if not exists matches (
  id                text primary key,
  tournament_id     text not null references tournaments(id) on delete cascade,
  challenger_name   text not null,
  opponent_name     text not null,
  amount            numeric not null,
  status            text not null default 'proposed', -- proposed | accepted | declined
  first_picker      text,                              -- 'challenger' | 'opponent', set on accept
  challenger_picks  jsonb not null default '[]'::jsonb, -- ordered golfer ids, up to 6
  opponent_picks    jsonb not null default '[]'::jsonb,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);
create index if not exists matches_tournament_idx on matches (tournament_id);

alter table matches enable row level security;
drop policy if exists anon_all on matches;
create policy anon_all on matches for all to anon using (true) with check (true);
