// Auto-tiering by odds: splits a field into 6 tiers that GROW in size
// (favorites in a small Tier 1, longshots packed into a big Tier 6) instead
// of 6 equal buckets. The percentages below are the average tier-size share
// of the field across every real major already in this pool's history (11
// events: every 2024/2025/2026 Masters, PGA Championship, U.S. Open, Open
// Championship, and WM Open loaded so far) — not an arbitrary curve.
export const TIER_SIZE_PCT = [5.6, 10.8, 14.0, 18.0, 21.4, 30.2];

function oddsToSortableNum(odds) {
  if (!odds) return Infinity; // no odds → treated as a longshot, sorts last
  const n = parseInt(String(odds).replace(/[+\-]/, ''), 10);
  return Number.isFinite(n) ? n : Infinity;
}

/**
 * How many golfers each of the 6 tiers should get for a field of size `n`,
 * using TIER_SIZE_PCT. Largest-remainder rounding so the counts always sum
 * to exactly `n` (a plain per-tier Math.round can over/undershoot by a
 * couple of golfers otherwise).
 */
export function tierCounts(n) {
  if (n <= 0) return [0, 0, 0, 0, 0, 0];
  const raw = TIER_SIZE_PCT.map((pct) => (pct / 100) * n);
  const base = raw.map(Math.floor);
  const shortfall = n - base.reduce((a, b) => a + b, 0);
  const byRemainder = raw
    .map((r, i) => ({ i, frac: r - base[i] }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < shortfall; k++) base[byRemainder[k % 6].i] += 1;
  return base;
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
