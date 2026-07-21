// Win probability engine.
//
// Heuristic composite score (point gap + remaining-golfer position/odds) run
// through a softmax. This is NOT a real Monte Carlo simulation — no
// randomized trials, no per-golfer scoring distribution to sample from.
// Calling it "Monte-Carlo" in earlier versions was misleading; corrected
// here.
//
// The GAP_WEIGHT_SCALE constant below is backtested against real
// round-by-round history from the 11 completed majors (snapshots table,
// backfilled from ESPN's historical per-round scores): for every
// (tournament, round) combination, did softmax(-gap * gapWeight / temp)
// assign high probability to whoever actually went on to win? Scaling the
// gap term up by 1.15x reduced average log-loss on 10 of the 11 majors
// (2.12 -> 1.99), with a negligible regression on the 11th (wm-open-2026,
// +0.04). A full 4-parameter re-fit of both gapWeight and temp found a much
// "better" combination on paper, but it reversed gapWeight's sign (mattering
// MORE early than late) and only won by making early-tournament confidence
// extreme — a classic small-sample overfit (44 data points across 11
// majors), and it made 2 of the 11 majors meaningfully worse. This 1.15x
// single-knob scale is the conservative, broadly-beneficial slice of that
// result. The "upside" (live position) and "odds" terms below are NOT
// backtested this way — ESPN's historical API only exposes final position,
// not each golfer's standing at a given past round, so there's no ground
// truth to check them against yet. Revisit as more majors accumulate real
// snapshot history via the daily capture cron (api/capture-snapshot.js).
//
// composite = -(gap * gapWeight) + (upside * upWeight * 5) + (oddsBoost * oddsWeight)
//
// "Upside" (from each remaining golfer's live position) is discounted by:
//   - completion confidence: how much of the tournament they've actually
//     played (holes thru, not just which round we're in) — an early
//     position is a weak signal, a late one is a strong signal.
//   - cut-survival probability: a golfer who hasn't made the cut yet still
//     carries real risk of contributing zero.
// Pre-tournament odds (oddsBoost) get less weight as the event progresses,
// since live position becomes the better signal and static odds go stale.
//
// Optional: hook for an Anthropic-powered call (requires a backend proxy —
// not safe to call directly from the browser with an API key).

export function computeWinProbabilities(rankedEntries, golfers, opts = {}) {
  const { roundsRemaining = 2, currentRound = 1, cutLine = null } = opts;
  if (!rankedEntries.length) return new Map();
  const leaderTotal = rankedEntries[0].total;

  const TOTAL_HOLES = 72; // 4 rounds x 18

  // 0 (hasn't started) to 1 (finished) — how much of the tournament this
  // golfer has actually played, counting completed prior rounds in full
  // plus however many holes they're thru in the current one.
  function completionRatio(golfer) {
    const roundsComplete = Math.max(0, (currentRound || 1) - 1);
    const holesPlayed = roundsComplete * 18 + clampThru(golfer.thru);
    return Math.min(1, holesPlayed / TOTAL_HOLES);
  }

  // Probability a currently-'playing' golfer survives to/through the cut.
  // Already-decided statuses short-circuit; otherwise a logistic curve
  // centered on the cut line (or a flat prior before there's a cut line to
  // measure against yet).
  function cutSurvivalProb(golfer) {
    if (golfer.status === 'made_cut') return 1;
    if (golfer.status !== 'playing') return 0;
    if ((currentRound || 1) >= 3) return 1; // the cut has already happened by R3
    if (cutLine == null) return 0.85; // no projected cut line yet — flat prior
    const margin = cutLine - (golfer.strokesToPar ?? 0); // positive = safely inside the line
    return 1 / (1 + Math.exp(-margin * 0.6));
  }

  // Pre-tournament odds matter most early (little live signal exists yet)
  // and fade in relevance as real position data accumulates.
  const oddsWeight = 0.1 + 0.15 * Math.min(1, roundsRemaining / 3);

  const composites = rankedEntries.map((row) => {
    const gap = leaderTotal - row.total;

    const remaining = row.scored
      .filter((s) => s.golfer.status === 'made_cut' || s.golfer.status === 'playing');

    let upsidePos = 0;
    let oddsBoost = 0;
    for (const s of remaining) {
      const g = s.golfer;
      const survival = cutSurvivalProb(g);
      const confidence = 0.5 + 0.5 * completionRatio(g);
      upsidePos += (1 / (positionRank(g.position) + 4)) * survival * confidence;
      oddsBoost += impliedProbFromOdds(g.odds) * survival;
    }

    // Weighted composite. Negative gap is good (= leader has 0).
    // Use roundsRemaining to amplify upside vs gap when more golf is left.
    // GAP_WEIGHT_SCALE (see file header) is the backtested adjustment.
    const GAP_WEIGHT_SCALE = 1.15;
    const gapWeight = GAP_WEIGHT_SCALE * (1.0 - 0.15 * roundsRemaining); // late tournament: gap matters more
    const upWeight = 0.5 + 0.15 * roundsRemaining;
    const composite = -gap * gapWeight + upsidePos * upWeight * 5 + oddsBoost * oddsWeight;

    return composite;
  });

  // Softmax with temperature scaling for win probabilities
  const temp = Math.max(1, 3 + roundsRemaining * 2);
  const exps = composites.map((c) => Math.exp(c / temp));
  const sum = exps.reduce((a, b) => a + b, 0);
  const probs = exps.map((e) => e / sum);

  // Post-cut hard cliff: once the cut has happened (currentRound >= 3, same
  // convention as cutSurvivalProb above), realistic majors essentially never
  // get won from outside the top half of the pool — the softmax curve alone
  // still leaves the bottom half too much probability mass. Split the field
  // at the median (ties go to the top half) and force the bottom half down
  // to a combined 1%, redistributing 99% across the top half in the same
  // relative proportions the softmax already gave them.
  const finalProbs = applyPostCutCliff(probs, currentRound);

  const out = new Map();
  rankedEntries.forEach((row, i) => out.set(row.entry.id, finalProbs[i]));
  return out;
}

function applyPostCutCliff(probs, currentRound) {
  if ((currentRound || 1) < 3 || probs.length < 2) return probs;

  const order = probs.map((_, i) => i).sort((a, b) => probs[b] - probs[a]);
  const topCount = Math.ceil(probs.length / 2);
  const topIdx = new Set(order.slice(0, topCount));
  const topSum = order.slice(0, topCount).reduce((s, i) => s + probs[i], 0);
  const botSum = order.slice(topCount).reduce((s, i) => s + probs[i], 0);

  return probs.map((p, i) => {
    if (topIdx.has(i)) return topSum > 0 ? (p / topSum) * 0.99 : 0.99 / topCount;
    const botCount = probs.length - topCount;
    return botSum > 0 ? (p / botSum) * 0.01 : 0.01 / botCount;
  });
}

function clampThru(thru) {
  const n = typeof thru === 'string' ? parseInt(thru, 10) : thru;
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(18, n));
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
