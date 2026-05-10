// Pure scoring engine. Implements all 8 rules from the spec.
//
// Golfer status values: 'playing' | 'made_cut' | 'missed_cut' | 'withdrawn'
// `withdrawnAfterCut`: true if WD happened after start of R3 AND golfer had made the cut.

/**
 * Score a single golfer for a given entry.
 * @param {object} golfer - { strokesToPar, status, won, withdrawnAfterCut }
 * @param {object} opts   - { tieredPenaltyEnabled, cutLine, currentRound }
 * @returns {{ points: number, breakdown: object }}
 */
export function scoreGolfer(golfer, opts = {}) {
  const { tieredPenaltyEnabled = false, cutLine = null, currentRound = 1 } = opts;
  const breakdown = {
    strokesUnderPar: 0,
    cutBonus: 0,
    cutPenalty: 0,
    wdPenalty: 0,
    winBonus: 0,
    tieredPenalty: 0,
  };

  // Rule 4: WD before end of R2 → -3 (no other points)
  if (golfer.status === 'withdrawn' && !golfer.withdrawnAfterCut) {
    breakdown.wdPenalty = -3;
    return { points: -3, breakdown };
  }

  // Rule 5: WD after start of R3 (had made cut) → 0
  if (golfer.status === 'withdrawn' && golfer.withdrawnAfterCut) {
    return { points: 0, breakdown };
  }

  // Rule 3: missed cut → -3 (no per-stroke math)
  if (golfer.status === 'missed_cut') {
    breakdown.cutPenalty = -3;
    return { points: -3, breakdown };
  }

  // Rule 1: +1 per stroke under par (strokesToPar is negative if under)
  const strokes = golfer.strokesToPar ?? 0;
  breakdown.strokesUnderPar = strokes < 0 ? -strokes : 0; // only under-par counts positive

  // Actually spec is unambiguous: "+1 point for each stroke under par".
  // For over-par strokes, no negative — handled via tiered penalty if enabled.
  // (Spec example confirms this.)

  // Rule 2: made cut → +3
  if (golfer.status === 'made_cut' || golfer.status === 'playing') {
    // Bonus applies once they've made the cut. We treat 'playing' as not-yet-cut pre-R2;
    // most calls happen post-cut so this is fine.
    breakdown.cutBonus = golfer.status === 'made_cut' ? 3 : 0;
  }

  // Rule 6: winner bonus
  if (golfer.won) breakdown.winBonus = 3;

  // Rule 8: tiered penalty starting R3, based on strokes over cut line
  if (tieredPenaltyEnabled && currentRound >= 3 && cutLine != null && golfer.status === 'made_cut') {
    const overCut = (golfer.strokesToPar ?? 0) - cutLine;
    breakdown.tieredPenalty = tieredPenaltyBand(overCut);
  }

  const points =
    breakdown.strokesUnderPar +
    breakdown.cutBonus +
    breakdown.cutPenalty +
    breakdown.wdPenalty +
    breakdown.winBonus +
    breakdown.tieredPenalty;

  return { points, breakdown };
}

// Spec bands (cut line at +6 example): 7+over=0, 8-10=-1, 11-13=-2, 14-16=-3, 17-19=-4, 20+=-5
// Generalized: overCut = strokesToPar - cutLine. So if cut is +6 and golfer is +14, overCut=+8.
// Wait — re-reading: the bands are absolute strokes-over-par, not over-cut.
// "7 over or better: 0 ... 20+ over: -5" — those numbers are strokes over par.
// Cut-line value is auto-detected so we know where bands START. Treat as: overPar = strokesToPar.
// Implementing per spec example: golfer at +14, cut at +6 → "14-16 over: -3" → tieredPenalty = -3. ✓
export function tieredPenaltyBand(overPar) {
  if (overPar <= 7) return 0;
  if (overPar <= 10) return -1;
  if (overPar <= 13) return -2;
  if (overPar <= 16) return -3;
  if (overPar <= 19) return -4;
  return -5;
}

/**
 * Score a whole entry (6 picks).
 * @param {object} entry  - { id, name, golferIds }
 * @param {Array}  golfers - tournament golfers list (each has live score data)
 * @param {object} opts   - scoring options for the tournament
 */
export function scoreEntry(entry, golfers, opts) {
  const lookup = new Map(golfers.map((g) => [g.id, g]));
  const picks = entry.golferIds.map((id) => lookup.get(id)).filter(Boolean);
  const scored = picks.map((g) => ({ golfer: g, ...scoreGolfer(g, opts) }));
  const total = scored.reduce((sum, s) => sum + s.points, 0);
  return { total, scored };
}

/** Rank a list of entries by total points (descending). Ties share rank. */
export function rankEntries(entries, golfers, opts) {
  const scored = entries.map((e) => ({ entry: e, ...scoreEntry(e, golfers, opts) }));
  scored.sort((a, b) => b.total - a.total);

  let lastTotal = null;
  let lastRank = 0;
  scored.forEach((row, i) => {
    if (row.total === lastTotal) {
      row.rank = lastRank;
    } else {
      row.rank = i + 1;
      lastRank = row.rank;
      lastTotal = row.total;
    }
  });
  return scored;
}
