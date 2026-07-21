-- Fix entry_fee: everything before the 2026 Open Championship was a $10 buy-in.
-- Four tournaments had been mislabeled at $20 -- corrected here. Only
-- 2026-open-championship-mrljqm3x is actually a $20 pool.
-- Already applied directly to the live Supabase project; this records the fix.

UPDATE tournaments SET entry_fee = 10, updated_at = now()
WHERE id IN ('masters-2024', 'masters-2025', 'pga-championship-2025', 'us-open-2025');
