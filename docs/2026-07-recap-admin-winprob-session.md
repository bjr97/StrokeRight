# Session recap — Admin workflow + win-probability calibration

Covers a run of related work: Admin tab reorganization, tiering-formula fix,
and a full win-probability calibration pass (post-cut cliff, daily snapshot
capture, historical backfill, gap-weight calibration). Written as a decisions
log — the "why", not a restatement of what's already commented in code.

---

## Admin tab reorganization (`src/pages/Admin.jsx`)

- **Live Controls**: removed the editable "made-cut bonus / missed-cut
  penalty" number field. The rules fix the magnitude at 3 — it's no longer
  admin-configurable. The underlying `cutBonusPoints` data field and its use
  in `scoring.js` are untouched (existing pre-2025-Open-Championship majors
  still carry `cut_bonus_points: 2` in Supabase; new tournaments default to 3
  with no UI to change it).
- **Rules page** (`src/pages/Rules.jsx`): added a `**` footnote dating three
  rule changes — tiered cut-line penalty + cut bonus/penalty going from ±2 to
  ±3, both starting the 2025 Open Championship (Jul 17, 2025); entry fee
  $10→$20 starting the 2026 Open Championship (Jul 16, 2026).
- **Tiers + Live Controls merged into one "Edit" tab.** Previously two
  separate top-level tabs, each locked to whichever tournament was "active"
  (the one shown pool-wide) — meaning you couldn't set up tiers ahead of
  activating, or fix a completed tournament's scoring, without reactivating
  it first. Now: a shared event picker (hides `completed` tournaments by
  default — there are usually a dozen+ and they rarely need touching, except
  whichever one is currently selected) feeds both sections stacked on one
  page, Live Controls above Tiers.
- **Manage tab**: status is now a direct 3-way toggle (Upcoming / Live /
  Completed) per tile, replacing a static pill — this is a quick label
  change, *not* the same as Live Controls' "Mark tournament complete"
  ceremony (which also computes final standings and can file History). Since
  `buildMajors()` (`src/lib/majors.js`) already computes completed-tournament
  data live from `status` + entries/golfers, flipping the label alone is
  sufficient. One safety net kept: toggling to Completed clears the pool-wide
  active-tournament id if that tournament was active.
- **Manage tab filter + sort**: All/Upcoming/Live/Completed filter, plus a
  separate Newest/Year/Event sort (defaults to Newest = strict chronological).
  Year groups by year then alphabetical by event type; Event groups
  alphabetically by event type then newest-year-first within each group
  (e.g. every "Masters" across years sits together).
- **Event type is now read-only** on existing tournaments (was an inline
  dropdown) — it drives name/course auto-fill at creation and was never
  meant to change after.
- **Edit button** added to every Manage tile (next to Activate/Delete) —
  jumps straight to the Edit tab with that tournament pre-selected, the
  escape hatch for completed tournaments hidden from the picker by default.
- **New tournament wizard** is now 2 steps: same details form, then — after
  creation — the same tier-import UI (live odds fetch or paste) scoped to the
  tournament just made. Skippable either way ("Done — go to Manage"). Step 1
  also gained the "Tiered cut-line penalty" On/Off toggle (defaults **On**,
  matching the standing rule for every major since the 2025 Open
  Championship) — previously every new tournament was hardcoded to
  `tieredPenaltyEnabled: false`.

## Auto-tiering formula (`src/lib/tiering.js`)

Tier 1 is now a **fixed 3 golfers** regardless of field size, not a
percentage (~5.6%) — a major realistically only ever has a handful of true
favorites no matter how big the field is. Tiers 2–6 split whatever's left,
using the original empirical percentages rescaled from 94.4% to 100% of the
remainder (same relative growth shape, just filling a smaller pool).

## Win-probability engine (`src/lib/winProb.js`)

- **Post-cut hard cliff**: once the cut has happened (`currentRound >= 3`),
  entries outside the top half of the pool now collectively hold only 1%
  combined win probability (top half absorbs 99% in the same relative
  proportions the softmax already gave them) — realistic majors are
  essentially never won from outside the top half once the cut has landed.
- **Daily snapshot capture** (`api/capture-snapshot.js` + `vercel.json`):
  a Vercel Cron job, `59 4 * * *` UTC = 11:59 PM Central (drifts to 10:59 PM
  during standard time / WM Open in Feb — Vercel cron doesn't do DST). Pulls
  live ESPN scores for the pool's active tournament, updates the golfers
  table, and records one snapshot row per entry. The app never wrote to
  `snapshots` during live play before this (only demo seed data did) — this
  is what lets *future* majors' win-probability curves actually be
  backtested. Protected by a `CRON_SECRET` env var (now configured and
  verified live — unauthenticated requests get 401).
- **Historical backfill**: reconstructed round-by-round snapshots for all 11
  already-completed majors from ESPN's historical scoreboard API (confirmed
  it exposes full per-round linescores even for finished events, via
  `?dates=YYYYMMDD-YYYYMMDD`). Found and fixed two real bugs before trusting
  the result:
  - ESPN pads a golfer's `linescores` with placeholder `"-"` entries for
    rounds after they missed the cut/withdrew, rather than omitting them —
    was miscounting those as "rounds played."
  - Amateur golfers are stored with a `"(a)"` suffix in this app's data but
    not in ESPN's `displayName`, breaking name matching.

  Round 4 (the final day) is populated directly from the already-correct
  stored golfer data rather than re-derived from ESPN — that's the real
  ground truth real payouts were computed from, and re-deriving it was the
  source of every reconciliation bug. Rounds 1–3 are genuine ESPN
  reconstructions. Final result: all 11 majors validated with **zero
  mismatches** against known-correct final standings. 1,668 snapshot rows
  total.
- **Gap-weight calibration**: backtested `computeWinProbabilities()` against
  the new snapshot history — for every (tournament, round), does the softmax
  assign high probability to whoever actually won? A full re-fit of both
  gap-weight and temperature found a "better" combination on paper, but it
  reversed gap-weight's directional sign and only won by pushing
  early-tournament confidence to an extreme — a small-sample overfit (44
  data points across 11 majors) that made 2 majors meaningfully worse.
  Instead applied a single conservative scale, `GAP_WEIGHT_SCALE = 1.15`,
  which improves 10 of 11 majors with a negligible regression on the 11th
  (wm-open-2026, +0.04 log-loss).
  **Not yet backtested**: the "upside" (live position) and "odds" terms —
  ESPN's historical API only exposes final position, not a golfer's standing
  at a given past round, so there's no ground truth to check those against
  yet. Revisit as real majors accumulate snapshot history via the daily cron.

## Operational notes

- Vercel env vars `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are
  confirmed reaching serverless functions at runtime (not just build) —
  needed for `api/capture-snapshot.js`.
- `CRON_SECRET` is set in Vercel and verified enforced (401 without it).
- No lasting test-data artifacts remain in Supabase — every throwaway
  tournament created during this work was deleted and cross-checked via
  direct Supabase queries afterward.

## Files touched

`src/pages/Admin.jsx`, `src/pages/Rules.jsx`, `src/lib/tiering.js`,
`src/lib/winProb.js`, `api/capture-snapshot.js` (new), `vercel.json` (new).
