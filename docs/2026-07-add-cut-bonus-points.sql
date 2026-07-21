-- Adds a per-tournament "cut bonus points" magnitude, used for both the
-- made-cut bonus (+N) and the missed-cut / withdrawal-before-cut penalty
-- (-N). Defaults to 3 (today's flat rule) for every existing and future
-- tournament.
--
-- The +/-2 magnitude was actually live through every major before the 2025
-- Open Championship -- the same boundary as the tiered cut-line penalty fix
-- (docs/2026-07-fix-tiered-penalty-scope.sql): 2025 Open Championship and
-- every 2026 major use the current +/-3 default; everything before it,
-- including 2025 Masters/US Open/PGA (not just the 4 2024 majors), used +/-2.
--
-- Run this once in Supabase -> SQL Editor -> New query -> Run.
-- Safe to re-run.

ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS cut_bonus_points integer DEFAULT 3;

UPDATE tournaments SET cut_bonus_points = 2, updated_at = now()
WHERE id IN (
  'masters-2024', 'pga-championship-2024', 'us-open-2024', 'open-championship-2024',
  'masters-2025', 'us-open-2025', 'pga-championship-2025'
);
