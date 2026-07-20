-- Removes the 5 fake demo-seed legacy majors from history. Targeted by
-- their known IDs (from seedData.js's PAST_HISTORY fixture), so this won't
-- touch any real history rows.

DELETE FROM history WHERE id IN (
  '2025-masters',
  '2025-us-open',
  '2025-open',
  '2025-pga',
  '2025-players'
);
