-- AI-generated recaps: round-by-round "story" beats during a tournament,
-- plus a final wrap-up once it's marked completed. Written by two
-- serverless functions (api/capture-snapshot.js for round recaps,
-- api/generate-recap.js for the final one) — the client only ever reads
-- this table, never writes it directly.
--
-- Paste this into Supabase -> SQL Editor -> New query -> Run.
-- Safe to re-run: uses IF NOT EXISTS.

create table if not exists recaps (
  tournament_id text primary key references tournaments(id) on delete cascade,
  rounds        jsonb not null default '{}'::jsonb, -- { "1": "text...", "2": "text...", ... }
  final         text,
  updated_at    timestamptz default now()
);

alter table recaps enable row level security;
drop policy if exists anon_all on recaps;
create policy anon_all on recaps for all to anon using (true) with check (true);
