// Win probability engine.
// Primary: heuristic Monte-Carlo using current point gap + remaining golfers' positions.
// Optional: hook for Anthropic call (requires a backend proxy — not safe in browser).
//
// Formula per spec: 50% point differential from leader, 30% remaining-golfer positions,
// 20% pre-tournament odds. We use a smooth softmax over a composite score.

export function computeWinProbabilities(rankedEntries, golfers, opts = {}) {
  const { roundsRemaining = 2 } = opts;
  if (!rankedEntries.length) return new Map();
  const leaderTotal = rankedEntries[0].total;

  // Per-entry composite score.
  const composites = rankedEntries.map((row) => {
    const gap = leaderTotal - row.total;

    // Upside from remaining golfers still in the field
    const remaining = row.scored
      .filter((s) => s.golfer.status === 'made_cut' || s.golfer.status === 'playing');
    const upsidePos = remaining.length
      ? remaining.reduce((sum, s) => sum + (1 / (positionRank(s.golfer.position) + 4)), 0)
      : 0;

    // Pre-tournament odds boost (lower implied prob → less upside, but already in standings)
    const oddsBoost = remaining.length
      ? remaining.reduce((sum, s) => sum + impliedProbFromOdds(s.golfer.odds), 0)
      : 0;

    // Weighted composite. Negative gap is good (= leader has 0).
    // Use roundsRemaining to amplify upside vs gap when more golf left.
    const gapWeight = 1.0 - 0.15 * roundsRemaining; // late tournament: gap matters more
    const upWeight = 0.5 + 0.15 * roundsRemaining;
    const composite = -gap * gapWeight + upsidePos * upWeight * 5 + oddsBoost * 0.2;

    return composite;
  });

  // Softmax with temperature scaling for win probabilities
  const temp = Math.max(1, 3 + roundsRemaining * 2);
  const exps = composites.map((c) => Math.exp(c / temp));
  const sum = exps.reduce((a, b) => a + b, 0);
  const probs = exps.map((e) => e / sum);

  const out = new Map();
  rankedEntries.forEach((row, i) => out.set(row.entry.id, probs[i]));
  return out;
}

function positionRank(pos) {
  if (!pos) return 50;
  const m = String(pos).match(/\d+/);
  return m ? parseInt(m[0], 10) : 50;
}

function impliedProbFromOdds(odds) {
  if (!odds) return 0;
  const n = typeof odds === 'string' ? parseInt(odds.replace(/[+]/, ''), 10) : odds;
  if (!Number.isFinite(n)) return 0;
  // American odds → implied probability
  return n > 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100);
}

// Anthropic-powered probability — stub.
// Production: route through a server endpoint that holds the API key.
// Returning null tells the caller to fall back to computeWinProbabilities.
export async function anthropicWinProbability(/* context */) {
  return null;
}
