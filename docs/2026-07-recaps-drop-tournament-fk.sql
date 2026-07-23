-- Recaps used to always belong to a real `tournaments` row, so
-- recaps.tournament_id had a foreign key to it. That's no longer true:
-- summary-only History backfills (payout-only imports with no
-- tournaments/entries/golfers rows at all, e.g. a major run entirely
-- outside the app) can now get a recap too. Drop the FK so those don't
-- violate it -- tournament_id stays the primary key either way.
--
-- Paste this into Supabase -> SQL Editor -> New query -> Run.
-- Safe to re-run: uses IF EXISTS.

alter table recaps drop constraint if exists recaps_tournament_id_fkey;
