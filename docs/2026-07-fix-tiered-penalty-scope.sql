-- Corrects docs/2026-07-retroactive-tiered-penalty.sql, which had the scope
-- backwards. The tiered cut-line penalty (Rules 7-8) applies to the 2025
-- Open Championship and every 2026 major -- NOT to any 2024 major or to
-- 2025 Masters/PGA/US Open, which all scored under the flat missed-cut rule
-- only.
--
-- Reverts tiered_penalty_enabled to false for the 6 tournaments wrongly
-- flipped on last time (their cut_line values are left in place -- accurate
-- historical numbers that do nothing while the flag is off). Turns it on
-- for the 3 that were missing it, with real cut lines cross-checked against
-- two sources each:
--   2025 Open Championship (Royal Portrush):  +1  (143)
--   2026 WM Phoenix Open (TPC Scottsdale):      0  (even par)
--   2026 Masters:                              +4  (148)
-- 2026 Open Championship already had it enabled correctly and is untouched.
--
-- Already applied directly to the live Supabase project. Net effect: the
-- 2024/2025-Masters/2025-PGA/2025-US-Open winners are all back to their
-- original values; the 2025 Open Championship tie (Blake & Brooks) breaks
-- to a sole winner (Blake) since tiered penalty now correctly applies there.

UPDATE tournaments SET tiered_penalty_enabled = false, updated_at = now()
WHERE id IN ('masters-2024', 'pga-championship-2024', 'us-open-2024', 'open-championship-2024', 'masters-2025', 'pga-championship-2025');

UPDATE tournaments SET tiered_penalty_enabled = true, cut_line = 1, updated_at = now() WHERE id = 'open-2025';
UPDATE tournaments SET tiered_penalty_enabled = true, cut_line = 0, updated_at = now() WHERE id = 'wm-open-2026';
UPDATE tournaments SET tiered_penalty_enabled = true, cut_line = 4, updated_at = now() WHERE id = 'masters-2026';
