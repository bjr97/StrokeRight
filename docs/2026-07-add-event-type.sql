-- Adds event-type categorization to tournaments and history.
-- Safe to run multiple times (IF NOT EXISTS guards). Existing rows default
-- to 'other' and can be corrected afterward via the app's own edit UI
-- (Admin -> Manage for tournaments, History -> Past majors -> edit for
-- summary-only legacy records).

ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS event_type text NOT NULL DEFAULT 'other';
ALTER TABLE history     ADD COLUMN IF NOT EXISTS event_type text NOT NULL DEFAULT 'other';

-- Allowed values (enforced app-side, not as a DB constraint, so you're not
-- blocked if we ever add a 7th category): 'wm_open', 'masters', 'us_open',
-- 'pga', 'open', 'other'.
