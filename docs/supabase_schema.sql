-- StrokeRight — Supabase schema
-- Paste this into Supabase → SQL Editor → New query → Run.
-- Safe to re-run: uses IF NOT EXISTS / ON CONFLICT.

------------------------------------------------------------
-- Tables
------------------------------------------------------------

create table if not exists tournaments (
  id                      text primary key,
  name                    text not null,
  course                  text,
  start_date              text,
  deadline                text,
  pool_code               text not null,
  entry_fee               int default 10,
  tiered_penalty_enabled  boolean default false,
  cut_line                numeric,
  current_round           int default 1,
  status                  text default 'setup',
  tier_labels             jsonb,
  created_at              timestamptz default now(),
  updated_at              timestamptz default now()
);

create table if not exists golfers (
  tournament_id text primary key references tournaments(id) on delete cascade,
  data          jsonb not null default '[]'::jsonb,
  updated_at    timestamptz default now()
);

create table if not exists entries (
  id                 text primary key,
  tournament_id      text not null references tournaments(id) on delete cascade,
  name               text not null,
  entry_num          int default 1,
  golfer_ids         jsonb not null,
  down_tier_skipped  int,
  created_at         timestamptz default now()
);
create index if not exists entries_tournament_idx on entries (tournament_id);

create table if not exists snapshots (
  id            bigserial primary key,
  tournament_id text not null references tournaments(id) on delete cascade,
  entry_id      text not null,
  round         int not null,
  points        int not null,
  rank          int not null,
  created_at    timestamptz default now(),
  unique (tournament_id, entry_id, round)
);
create index if not exists snapshots_tournament_idx on snapshots (tournament_id);

create table if not exists history (
  id          text primary key,
  name        text not null,
  date        text,
  winner      text,
  team        jsonb,
  points      int,
  entries     int,
  prize       numeric,
  created_at  timestamptz default now()
);

create table if not exists app_config (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz default now()
);

------------------------------------------------------------
-- Row Level Security
-- For "shared data only" mode: allow anon to do everything.
-- The pool code (checked client-side) is the friction.
-- Tighten this when you upgrade to Supabase Auth.
------------------------------------------------------------

alter table tournaments enable row level security;
alter table golfers     enable row level security;
alter table entries     enable row level security;
alter table snapshots   enable row level security;
alter table history     enable row level security;
alter table app_config  enable row level security;

do $$
declare
  t text;
begin
  for t in select unnest(array['tournaments','golfers','entries','snapshots','history','app_config'])
  loop
    execute format('drop policy if exists anon_all on %I', t);
    execute format(
      'create policy anon_all on %I for all to anon using (true) with check (true)',
      t
    );
  end loop;
end$$;

------------------------------------------------------------
-- Seed: default admin code (change this in the app later)
------------------------------------------------------------

insert into app_config (key, value)
values ('admin-code', '"admin"'::jsonb)
on conflict (key) do nothing;
