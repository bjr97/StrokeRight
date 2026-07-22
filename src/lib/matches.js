// 1v1 match logic: snake draft (6 picks each — 5 starters + 1 extra) and
// scoring, layered on top of the same rules as the main pool (src/lib/
// scoring.js) against whichever tournament the match is tied to.

import { scoreGolfer } from './scoring.js';

const TOTAL_PICKS_PER_SIDE = 6;
const STARTER_COUNT = 5;

/**
 * Standard 2-player snake order across 6 rounds (12 picks total):
 * odd rounds go firstPicker-then-other, even rounds reverse.
 */
export function draftOrder(firstPicker) {
  const other = firstPicker === 'challenger' ? 'opponent' : 'challenger';
  const order = [];
  for (let round = 1; round <= TOTAL_PICKS_PER_SIDE; round++) {
    if (round % 2 === 1) order.push(firstPicker, other);
    else order.push(other, firstPicker);
  }
  return order;
}

/** Whose turn is next ('challenger' | 'opponent'), or null if the draft is complete. */
export function nextTurn(match) {
  const made = (match.challengerPicks?.length || 0) + (match.opponentPicks?.length || 0);
  if (made >= TOTAL_PICKS_PER_SIDE * 2) return null;
  return draftOrder(match.firstPicker)[made];
}

export function isDraftComplete(match) {
  return (match.challengerPicks?.length || 0) === TOTAL_PICKS_PER_SIDE
    && (match.opponentPicks?.length || 0) === TOTAL_PICKS_PER_SIDE;
}

/** Golfer ids already taken by either side — exclusive within this match only. */
export function takenGolferIds(match) {
  return new Set([...(match.challengerPicks || []), ...(match.opponentPicks || [])]);
}

/**
 * Scores one side's 6 picks (5 starters + 1 extra/alternate).
 *
 * Auto-sub: if a starter withdrew before the end of Round 2, the extra's
 * score replaces theirs in the total (only the first such withdrawal gets
 * subbed in — there's only one extra to go around). Otherwise the extra
 * doesn't count toward the total; it's only kept as a tiebreaker.
 */
export function scoreMatchSide(pickIds, golfers, opts) {
  const lookup = new Map(golfers.map((g) => [g.id, g]));
  const starterIds = (pickIds || []).slice(0, STARTER_COUNT);
  const extraId = pickIds?.[STARTER_COUNT];
  const extra = extraId ? lookup.get(extraId) : null;

  const isEarlyWithdrawal = (g) => g && g.status === 'withdrawn' && !g.withdrawnAfterCut;
  const starters = starterIds.map((id) => lookup.get(id));
  const subIndex = starters.findIndex(isEarlyWithdrawal);

  let total = 0;
  starters.forEach((g, i) => {
    if (i === subIndex && extra) total += scoreGolfer(extra, opts).points;
    else if (g) total += scoreGolfer(g, opts).points;
  });

  return {
    total,
    extraUsedAsSub: subIndex !== -1 && !!extra,
    extraScore: extra ? scoreGolfer(extra, opts).points : 0,
  };
}

/**
 * Full result for a completed draft. `winner` is 'challenger' | 'opponent'
 * | 'push'. Ties fall back to comparing extra-golfer scores, unless the
 * extra was already used as a sub on one (or both) sides, in which case
 * there's no separate number left to break the tie with — a push.
 */
export function computeMatchResult(match, golfers, opts) {
  const challenger = scoreMatchSide(match.challengerPicks, golfers, opts);
  const opponent = scoreMatchSide(match.opponentPicks, golfers, opts);

  let winner;
  if (challenger.total > opponent.total) winner = 'challenger';
  else if (opponent.total > challenger.total) winner = 'opponent';
  else if (!challenger.extraUsedAsSub && !opponent.extraUsedAsSub && challenger.extraScore !== opponent.extraScore) {
    winner = challenger.extraScore > opponent.extraScore ? 'challenger' : 'opponent';
  } else {
    winner = 'push';
  }

  return { challenger, opponent, winner };
}
