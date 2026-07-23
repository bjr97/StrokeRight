-- Admin-overridable projected cut line (strokes over par), shown on the
-- Board and Players pages during rounds 1-2 before the real cut is set.
-- When blank, the app projects one live from current scores instead
-- (see src/lib/cutProjection.js) -- this column only holds an explicit
-- admin override, same pattern as the existing cut_line column.
--
-- Paste this into Supabase -> SQL Editor -> New query -> Run.
-- Safe to re-run: uses IF NOT EXISTS.

alter table tournaments add column if not exists projected_cut_line numeric;
