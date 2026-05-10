# StrokeRight — Fantasy Golf Pool

A React web app implementing the spec in `../Golf_Pool_Platform_Spec_v2.md`.

## Run it

```sh
cd strokeright
npm install      # already done if you're seeing this
npm run dev      # http://localhost:5173
npm run build    # production bundle in dist/
```

## Demo credentials (seeded on first run)

A 2026 Masters tournament with 12 entries is pre-seeded so the whole app is clickable immediately.

- **Pool code:** `masters26`
- **Admin code:** `admin`
- **Sample participant names** in the seed: Charles D., Brooks T., Glenn M., Rielly K., Bryce W., Vishnu P., Dan O., Lily R.

Use any name + the pool code to log in as a participant. Click "Admin login →" on the auth screen and enter `admin` to manage tournaments.

## Architecture

- **Framework:** Vite + React 18, Tailwind CSS, Recharts
- **Persistence:** `localStorage`, wrapped in `src/lib/storage.js` to mirror the spec's `window.storage` API (same get/set/delete/list surface)
- **No backend.** All scoring, ranking, payouts, and win-prob run client-side from `localStorage` data.
- **Live scores:** `src/lib/espnApi.js` fetches ESPN's public PGA scoreboard. Admin → "Live sync" floating button merges live data into the active tournament.
- **Win probability:** `src/lib/winProb.js` implements the spec's weighted heuristic (gap + upside + odds) via softmax. The `anthropicWinProbability` function is a stub — call it through a server proxy for production (don't ship your API key in browser code).

## File map

```
src/
├── App.jsx                 — routing, auth state, live-sync button
├── lib/
│   ├── storage.js          — localStorage wrapper + key helpers
│   ├── scoring.js          — all 8 scoring rules (pure)
│   ├── payouts.js          — payout structure + tie-splitting (pure)
│   ├── espnApi.js          — ESPN scoreboard fetch + normalize
│   ├── winProb.js          — win probability engine
│   └── seedData.js         — demo Masters tournament + history
├── components/
│   ├── ui.jsx              — Card, Button, Pill, StatusBadge, TierDot
│   ├── AuthGate.jsx        — name + pool code form
│   └── Nav.jsx             — 5 mobile tabs + "More" overflow, desktop top bar
└── pages/
    ├── Home.jsx            — dashboard: stats, payout, your entries
    ├── Submit.jsx          — 6-tier picker with down-tier double-pick
    ├── Leaderboard.jsx     — ranked entries, expandable golfer detail, win %
    ├── Players.jsx         — live tournament leaderboard with picks index
    ├── Compare.jsx         — 1v1 entry diff, popularity, contrarian/chalk
    ├── Trends.jsx          — rank/points line chart over rounds
    ├── History.jsx         — past tournaments + lifetime earnings
    └── Admin.jsx           — create/manage tournaments, tiers, live controls
```

## What's implemented (spec coverage)

| Module                                | Status |
| ------------------------------------- | ------ |
| 1. Tournament Setup                   | ✅     |
| 2. Team Submission (+ down-tier)      | ✅     |
| 3. Scoring Engine (all 8 rules)       | ✅     |
| 4. Live Leaderboard                   | ✅     |
| 5. Players Page                       | ✅     |
| 6. Trends Page                        | ✅     |
| 7. Compare Tool (1v1)                 | ✅     |
| 8. Win Probability (heuristic)        | ✅     |
| 9. Payout Calculator                  | ✅     |
| 10. History Dashboard (admin-edit)    | ✅     |

## Known trade-offs & next steps

1. **No real-time refresh loop** — Live sync is manual (admin button). Polling ESPN every minute would be easy to add with `setInterval`; left manual to be respectful of the unofficial endpoint.
2. **Anthropic win probability is stubbed.** Production needs a thin server (e.g. a Cloudflare Worker) holding the API key. The client-side stub falls back to the heuristic.
3. **Snapshot capture is automatic for seed data only.** Add a cron-like end-of-round trigger to write to `snapshots:{tournament_id}` for real tournaments — currently the trends chart shows live round + any historical snapshots present in storage.
4. **No tests yet.** Scoring/payout logic is intentionally pure for testability; suggest adding Vitest.
5. **Tier cutoffs are manual** in the admin UI (auto-tier by odds is implemented, with up/down arrow re-bucketing). The mockup-style drag handles are an obvious enhancement.

## Where the data lives

Open DevTools → Application → Local Storage. All keys are prefixed `sr:`:

- `sr:tournament:{id}` — config
- `sr:golfers:{id}`     — field with tier + live data
- `sr:entries:{id}`     — submitted picks
- `sr:snapshots:{id}`   — round-by-round rank/points
- `sr:history`          — past tournaments
- `sr:admin-code`       — admin code (plaintext for demo; hash before production)
- `sr:active-tournament-id`
- `sr:session`          — current logged-in user
