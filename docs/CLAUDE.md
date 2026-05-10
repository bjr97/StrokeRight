# CLAUDE.md — StrokeRight Golf Pool Platform

## Project Overview
This is a React web app for a golf pool platform called "StrokeRight." Read `Golf_Pool_Platform_Spec_v2.md` for the full specification and `Stroke_Right_Mockup.html` for the design reference.

## Critical Rules
- **Always read the spec before starting any module.** The spec is the source of truth for scoring rules, payout logic, tier structure, and pool rules.
- **Follow the phased build plan.** Build Phase 1 fully before moving to Phase 2, etc. Do not skip ahead.
- **Match the mockup's design language.** Dark theme (#0D1117 background, #161B22 cards, #21262D borders). Green accent (#3FB950). The mockup HTML shows the exact aesthetic — match it closely.
- **Single .jsx artifact with persistent storage.** This is a React app that uses the `window.storage` API for persistence. No backend, no database, no server.

## Tech Stack
- React (functional components, hooks)
- Tailwind CSS for utility classes
- Recharts for the Trends page charts
- Persistent storage via `window.storage` API (get, set, delete, list)
- ESPN public golf API for live scores (no auth needed)
- Anthropic API for win probability (called from within the artifact)

## Design Guidelines
- **Dark GitHub-style theme** — see mockup for exact colors and spacing
- **Mobile-first** — 5 visible tabs (Home, Submit, Players, Leaderboard, More), 3 under More (Trends, Compare, History)
- **Tier colors:** dark blue (#58A6FF), orange (#D29922), dark green (#3FB950), light blue (#79C0FF), light green (#7DC991), yellow (#D2D250)
- Compact, information-dense UI. No wasted space.
- Expandable rows on leaderboard and players page (tap to show detail)
- Status badges: green for positive, red for negative, amber for neutral, gray for inactive

## Storage Keys (from spec)
- `tournament:{id}` — tournament config
- `golfers:{tournament_id}` — golfer list with tiers and odds
- `entries:{tournament_id}` — submitted entries
- `scores:{tournament_id}` — cached live scores
- `snapshots:{tournament_id}` — end-of-round snapshots for trend charts
- `history` — past tournament results
- `admin-code` — admin access code

## Scoring Rules (summary — see spec for full detail)
1. +1 per stroke under par
2. +3 for making the cut
3. -3 for missing the cut
4. -3 for withdrawal before end of R2
5. 0 for withdrawal after start of R3 (if cut was made)
6. +3 for winning the tournament
7. Tiered penalty scoring (optional, admin toggle) — penalty bands based on strokes over cut line
8. Down-tier picking allowed (skip a tier, double-pick from lower)

## Creative Liberty
You have creative freedom on:
- Animations, transitions, micro-interactions
- Loading states and empty states
- How to lay out the admin screens (not mocked up)
- Icon choices and small visual flourishes
- How the "More" menu opens (dropdown, bottom sheet, etc.)

You must NOT deviate from:
- The scoring rules and payout math
- The tier system and down-tier logic
- The data model / storage key structure
- The navigation structure (5 tabs + More)
- The core color palette and dark theme
