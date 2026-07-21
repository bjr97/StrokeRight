// Auto-tiering by odds: splits a field into 6 tiers that GROW in size
// (favorites in a small Tier 1, longshots packed into a big Tier 6) instead
// of 6 equal buckets. Tier 1 is a fixed count — a major only ever really has
// a handful of true favorites, regardless of field size — rather than a
// percentage of the field. Tiers 2-6 split the remainder by percentage.
export const TIER1_FIXED_COUNT = 3;

// Tiers 2-6's share of whatever's left after tier 1's fixed 3 are set aside.
// Originally [10.8, 14.0, 18.0, 21.4, 30.2] (summing to 94.4% of the whole
// field, empirically averaged across 11 real majors in this pool's history)
// — rescaled here by 100/94.4 so they still sum to 100% of the remainder.
export const TIER_SIZE_PCT = [11.4, 14.8, 19.1, 22.7, 32.0];

function oddsToSortableNum(odds) {
  if (!odds) return Infinity; // no odds → treated as a longshot, sorts last
  const n = parseInt(String(odds).replace(/[+\-]/, ''), 10);
  return Number.isFinite(n) ? n : Infinity;
}

/**
 * How many golfers each of the 6 tiers should get for a field of size `n`.
 * Tier 1 gets TIER1_FIXED_COUNT (capped at `n` for tiny fields); tiers 2-6
 * split the remainder using TIER_SIZE_PCT with largest-remainder rounding so
 * the counts always sum to exactly `n` (a plain per-tier Math.round can
 * over/undershoot by a couple of golfers otherwise).
 */
export function tierCounts(n) {
  if (n <= 0) return [0, 0, 0, 0, 0, 0];
  const tier1 = Math.min(TIER1_FIXED_COUNT, n);
  const remaining = n - tier1;
  if (remaining <= 0) return [tier1, 0, 0, 0, 0, 0];

  const raw = TIER_SIZE_PCT.map((pct) => (pct / 100) * remaining);
  const base = raw.map(Math.floor);
  const shortfall = remaining - base.reduce((a, b) => a + b, 0);
  const byRemainder = raw
    .map((r, i) => ({ i, frac: r - base[i] }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < shortfall; k++) base[byRemainder[k % 5].i] += 1;
  return [tier1, ...base];
}

/**
 * Sorts golfers by odds (favorites first) and assigns tier 1-6 per
 * tierCounts(). Returns new objects; doesn't mutate the input. Golfers
 * without a parseable odds value sort last (longest-shot tier).
 */
export function autoTierByOdds(golfers) {
  const sorted = [...golfers].sort((a, b) => oddsToSortableNum(a.odds) - oddsToSortableNum(b.odds));
  const counts = tierCounts(sorted.length);
  const boundaries = [];
  let running = 0;
  for (const c of counts) { running += c; boundaries.push(running); }

  return sorted.map((g, i) => {
    let tier = 6;
    for (let t = 0; t < 6; t++) {
      if (i < boundaries[t]) { tier = t + 1; break; }
    }
    return { ...g, tier };
  });
}
