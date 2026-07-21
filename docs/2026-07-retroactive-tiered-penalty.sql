-- Retroactively enable the tiered cut-line penalty (Rules 7-8) for every
-- major before the 2025 U.S. Open, which is where this scoring system was
-- actually introduced for the pool. 2025 U.S. Open and everything after are
-- left untouched.
--
-- cut_line values are the REAL 36-hole cut for each event (cross-checked
-- against two sources each for Masters/PGA where it wasn't already on file):
--   2024 Masters:            +6  (150, cut line was 6-over)
--   2024 PGA Championship:    0  (already on file — see docs/2026-07-import-2024-pga-championship.sql)
--   2024 U.S. Open:          +6  (already on file)
--   2024 Open Championship:  +6  (already on file)
--   2025 Masters:            +2  (lowest Augusta cut since 2020)
--   2025 PGA Championship:   +1  (143, Quail Hollow)
--
-- Already applied directly to the live Supabase project. This changed the
-- recorded winner of 3 majors (a tied co-winner dropped in each case) and
-- flipped the 2024 Masters outright from Reilly to Brooks -- confirmed with
-- the pool admin before this was left in place.

UPDATE tournaments SET tiered_penalty_enabled = true, cut_line = 6, updated_at = now() WHERE id = 'masters-2024';
UPDATE tournaments SET tiered_penalty_enabled = true, updated_at = now() WHERE id = 'pga-championship-2024';
UPDATE tournaments SET tiered_penalty_enabled = true, updated_at = now() WHERE id = 'us-open-2024';
UPDATE tournaments SET tiered_penalty_enabled = true, updated_at = now() WHERE id = 'open-championship-2024';
UPDATE tournaments SET tiered_penalty_enabled = true, cut_line = 2, updated_at = now() WHERE id = 'masters-2025';
UPDATE tournaments SET tiered_penalty_enabled = true, cut_line = 1, updated_at = now() WHERE id = 'pga-championship-2025';
