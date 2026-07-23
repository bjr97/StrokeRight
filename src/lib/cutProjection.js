// Projects where the cut will fall, live, from current scores — for the
// rounds 1-2 window before the real cut (tournament.cutLine) is set.
// ESPN's public scoreboard API doesn't expose a "projected cut" field, so
// this derives one from each major's own "low N and ties" cut rule.

// Approximate real-world cut counts. Good enough for a live projection —
// admin can always override the final number directly (tournament.projectedCutLine)
// if a specific field's actual cut rule differs.
export const DEFAULT_CUT_COUNTS = {
  masters: 50,
  us_open: 60,
  pga: 70,
  open: 70,
};

// Sorts every golfer still in it by strokes-to-par and takes the score at
// the Nth position — anyone tied with that score also survives, same as
// the real "low N and ties" rule. Returns null once the field is too thin
// to project from yet (e.g. before round 1 tee times finish, or an event
// type with no known cut count).
export function projectCutLine(golfers, cutCount) {
  if (!cutCount || cutCount <= 0) return null;
  const scores = (golfers || [])
    .filter((g) => g.status !== 'withdrawn')
    .map((g) => g.strokesToPar ?? 0)
    .sort((a, b) => a - b);
  if (scores.length < cutCount) return null;
  return scores[cutCount - 1];
}

// The line to actually use for display: an explicit admin override wins,
// otherwise fall back to the live projection. Returns null once the real
// cut has been applied (tournament.cutLine set) — projection stops mattering.
export function resolveProjectedCutLine(tournament, golfers) {
  if (tournament.cutLine != null) return null;
  if (tournament.projectedCutLine != null) return tournament.projectedCutLine;
  const count = DEFAULT_CUT_COUNTS[tournament.eventType];
  return count ? projectCutLine(golfers, count) : null;
}
