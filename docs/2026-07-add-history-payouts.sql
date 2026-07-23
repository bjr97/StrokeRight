-- Multi-place payouts for summary-only History records (majors backfilled
-- without full entries/leaderboard data -- just who got paid what).
-- Previously a summary-only record could only carry ONE prize (the
-- winner's) via the existing `prize` column; this adds every paid place
-- so 2nd/3rd-place money shows up in the Events & payouts table and in
-- everyone's "paid, no win" totals on the Stroker leaderboard, same as
-- full-data majors already do.
--
-- Shape: [{ "place": 1, "name": "Reilly", "prize": 476 }, ...] -- ties
-- share the same `place` number.
--
-- Paste this into Supabase -> SQL Editor -> New query -> Run.
-- Safe to re-run: uses IF NOT EXISTS.

alter table history add column if not exists payouts jsonb;
