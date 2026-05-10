# Golf Pool Platform — Project Specification (v2)

## Overview

A web-based golf pool platform replacing a Google Sheets workflow. Built as a React app with persistent storage, serving 50+ participants across multiple PGA tournaments per year.

---

## Core Details

- **Platform:** React web app (single .jsx artifact with persistent storage)
- **Auth:** Simple name + pool code (no accounts). Separate admin code for managers.
- **Admins:** 2-3 people
- **Tournaments:** All Majors + The Players (expandable)
- **Entry fee:** $10 per entry, unlimited entries per person
- **Payments:** Tracked externally via Venmo (@Vishnu697) — not in the app
- **Scores:** Live via ESPN public golf API (free, no auth). Live Golf API as backup.
- **Smart features:** Anthropic API (Claude Sonnet) for win probability and odds lookup

---

## Navigation

### Mobile-First Tab Structure
- **Always visible (5 tabs):** Home, Submit, Players, Leaderboard, More
- **Under "More" menu:** Trends, Compare, History
- Desktop can show all 7 tabs inline if space permits

---

## Pool Rules (from CSV)

### Team Selection
- Pick 6 golfers — one from each of 6 color-coded tiers (dark blue, orange, dark green, light blue, light green, yellow)
- Tiers are based on betting odds, with admin setting the cutoff boundaries manually
- Tier sizes are variable and admin-controlled per tournament
- **Down-tier option:** A participant can skip any tier and pick a 2nd golfer from a lower tier instead. Cannot pick from a higher tier.
- Deadline: Wednesday at 11:59pm before the tournament

### Scoring
1. **+1 point** for each stroke a golfer shoots under par for the tournament
2. **+3 points** for each golfer who makes the cut
3. **-3 points** for each golfer who misses the cut (no additional penalty for over-par strokes)
4. **-3 points** for each golfer who withdraws before the conclusion of Round 2
5. **0 points** for a golfer who makes the cut but withdraws after the start of Round 3
6. **+3 points** if a golfer wins the tournament

### Tiered Penalty Scoring (Rule 8) — OPTIONAL per tournament
- Admin toggle: OFF by default, can be enabled per tournament
- Applies starting in Round 3
- Based on strokes over the cut line
- Penalty bands (example with cut line at +6):
  - 7 over or better: 0
  - 8-10 over: -1
  - 11-13 over: -2
  - 14-16 over: -3
  - 17-19 over: -4
  - 20+ over: -5
- Cut line is auto-detected from the scores API, with admin override available

### Scoring Examples
- Golfer makes cut, shoots 10 under, doesn't win = **13 points** (3 + 10)
- Golfer makes cut, shoots 15 under, wins = **21 points** (3 + 15 + 3)
- Golfer misses the cut = **-3 points**
- Golfer withdraws before Round 2 ends = **-3 points**
- Golfer makes cut, then withdraws after Round 3 starts = **0 points**
- Golfer makes cut, shoots +14 (with tiered penalty active) = **0 points** (3 for cut + (-3 tiered penalty) = 0)

### Payout Structure
- Scales with number of entries:
  - **≤9 entries:** Winner take all
  - **10-19 entries:** 1st place gets remaining pool, 2nd place gets $10 back
  - **20-29 entries:** 1st = 80%, 2nd = 20%
  - **30+ entries:** 1st = 65%, 2nd = 25%, 3rd = 10%
- **Tie-splitting:** Tied participants split the combined prize money of the tied positions
  - Example: Two tied for 1st split combined 1st + 2nd prize; 3rd pays out normally

---

## Modules

### Module 1: Tournament Setup (Admin Only)
- Create tournament: name, dates, entry fee, deadline, pool code, admin code
- Pull golfer field from API (names + betting odds)
- Golfers sorted by odds; admin drags tier cutoff lines to define 6 tiers
- Golfers color-coded by tier (dark blue, orange, dark green, light blue, light green, yellow)
- Admin can manually move golfers between tiers
- Toggle for tiered penalty scoring (Rule 8) on/off per tournament
- Tier assignment locks at the submission deadline

### Module 2: Team Submission (Participants)
- Enter name + pool code to access
- See 6 tier panels, each showing available golfers with odds
- Pick one golfer per tier (or toggle down-tier to skip a tier and double-pick from a lower one)
- Review picks and submit
- Option to "submit another entry" for multiple entries
- View all existing entries under your name
- Submissions lock at deadline (Wednesday 11:59pm)
- Validation: exactly 6 golfers, max 1 per tier unless down-tiering, down-tier only goes lower

### Module 3: Scoring Engine
- Implements all 8 scoring rules above
- Auto-calculates points per golfer and per entry
- Handles all edge cases: missed cuts, withdrawals (early vs late), tournament winner bonus
- Tiered penalty: auto-detects cut line from API, applies penalty bands when enabled
- Admin override for cut line if needed

### Module 4: Live Leaderboard (Pool Entries)
- Real-time ranking of all entries by total points
- Updates during rounds (live, not just end-of-round)
- Each entry shows: participant name, entry number, total points, projected payout
- Expandable rows showing individual golfer scores and statuses
- Golfer status badges: playing, made cut, missed cut, withdrawn
- Round-by-round breakdown per golfer
- Position change arrows (up/down since last update)
- Filter by participant name
- Prize projection based on current standing

### Module 5: Players Page (Live Tournament Scoreboard) — NEW
- **Purpose:** "Watch the actual golf" view — see every golfer in the tournament field, then drill into who in the pool picked them
- **Top-level list:**
  - All golfers sorted by current tournament position (like ESPN/PGA Tour leaderboard)
  - Each row shows: golfer name, score to par, today's round score, thru hole, tier color badge
  - **Pool points** displayed alongside golf score (e.g., Scheffler at -8 who made cut = +14 pool pts)
  - **Popularity %** shown next to each golfer (% of pool entries that picked them)
  - Search/filter bar at the top for finding golfers quickly in the ~100-150 player field
- **Cut line treatment:**
  - After R2, a visible horizontal line divides the leaderboard at the cut
  - Golfers who missed the cut or withdrew are locked below the cut line
  - Below-cut section stays in last known position order (not re-sorted)
  - Status badges: Playing, Made Cut, Missed Cut (MC), Withdrawn (WD)
- **Golfer detail (tap to expand):**
  - Round-by-round scores for that golfer
  - List of every pool entry that drafted this golfer
  - Each entry row is tappable — navigates to that entry on the Leaderboard tab
  - Shows entry name, entry number, and current total points

### Module 6: Scoring Trends Page — NEW
- **Purpose:** Visualize how entries performed across the tournament over time
- **Own tab** (under "More" on mobile)
- **Primary view: Rank position over time**
  - Y-axis = rank position (inverted — 1st at top)
  - X-axis = rounds (R1, R2, R3, R4)
  - Round-level granularity (4 data points per entry)
  - Cut event visible after R2 (where cut bonuses/penalties apply)
- **Toggle view: Cumulative points over time**
  - Y-axis = total pool points
  - X-axis = rounds (R1, R2, R3, R4)
  - Shows the raw scoring arc ("started slow, R3 saved me")
- **Multi-entry overlay:**
  - Users can tap entries to add/remove them from the chart
  - Multiple trend lines shown simultaneously with distinct colors
  - Entry selector shows the user's own entries by default, with ability to search/add any entry
- **Data storage:** Snapshots of rank and points captured at end of each round (stored in `snapshots:{tournament_id}`)

### Module 7: Team Comparison Tool
- **1v1 comparison only** (v1 — may expand to multi-entry in future)
- Select 2 entries to compare side-by-side
- Shows:
  - **Shared golfers** (gray — these cancel out between the two entries)
  - **Your unique golfers** (green — root for these)
  - **Their unique golfers** (red — root against these)
- Golfer popularity chart: percentage of all entries that picked each golfer
- "Most contrarian" entry badge (fewest overlapping picks with the field)
- "Most chalk" entry badge (most popular picks)

### Module 8: Win Probability Engine
- Live probability percentage displayed next to each entry on the leaderboard
- Formula: weighted blend of:
  - 50% current point differential from leader
  - 30% remaining golfers' live tournament positions (upside potential)
  - 20% pre-tournament odds of remaining golfers
- Monte Carlo simulation of remaining rounds based on historical scoring variance
- Updates after each hole completes
- Sparkline showing probability trend over time
- Highlighted treatment for top entries

### Module 9: Payout Calculator
- Auto-calculates prize pool from entry count × $10
- Determines payout tiers based on entry count
- Applies tie-splitting rules automatically
- Shows prize pool total prominently
- Projected payouts displayed on leaderboard next to qualifying positions
- Final payouts displayed after tournament ends

### Module 10: History Dashboard
- Admin-editable page showing past tournament results
- Seeded from existing Excel sheet of past results
- Shows: tournament name, date, pool winners, their teams, points, prize money
- Friends can browse freely (no admin code needed to view)
- Lifetime stats: total earnings, win count, podium finishes
- Future tournaments auto-populate after completion
- Admin can add/edit/delete records

---

## Phased Build Plan

### Phase 1 — Foundation (Est: 1 session)
- App shell with navigation (5 visible tabs + "More" overflow with 3 additional)
- Auth gate: name + pool code for participants, admin code for setup
- Tournament creation screen
- Golfer list with tier assignment (admin drags cutoff lines)
- Tiered penalty toggle
- Persistent storage setup

### Phase 2 — Core Gameplay (Est: 1-2 sessions)
- Full team submission flow with tier validation and down-tier logic
- Multiple entries per person
- Scoring engine with all 8 rules
- Basic leaderboard with rankings and expandable golfer detail
- Payout calculator auto-adjusting to entry count

### Phase 3 — Live Data Integration (Est: 1-2 sessions)
- ESPN API integration for live scores
- Real-time leaderboard refresh
- Auto-detect cut line from API
- Golfer status tracking (playing, made cut, missed cut, withdrawn)
- **Players page** with live tournament scoreboard, search, popularity %, cut line display
- Players page drill-down showing entries that picked each golfer
- Admin override for auto-detected values
- Odds lookup for tier sorting assistance

### Phase 4 — Analytics & Trends (Est: 1-2 sessions)
- Win probability engine (Monte Carlo + odds + standings)
- **Scoring trends page** with rank position and cumulative points toggle
- Multi-entry overlay on trend charts
- Round-end snapshot capture for trend data
- Team comparison tool (1v1) with shared/unique golfer visualization
- Golfer popularity charts
- Position change tracking
- "Most contrarian" and "most chalk" badges

### Phase 5 — History + Polish (Est: 1 session)
- History dashboard with admin editing
- Import past results from Excel
- Lifetime stats and leaderboards
- Mobile responsiveness pass
- UI polish and edge case handling

---

## API Details

### ESPN Public Golf API (Primary — Free)
- Endpoint pattern: `site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard`
- No authentication required
- Returns: live scores, player positions, cut status, round-by-round data
- Caveat: Unofficial/undocumented — could change without notice

### Live Golf API (Backup — Free)
- Requires API key (free signup at livegolfapi.com)
- Endpoints for events, leaderboards, scorecards

### Anthropic API (Built into artifact)
- Used for: win probability calculations, betting odds lookup via web search
- Model: Claude Sonnet 4
- Called from within the React artifact

---

## Data Model (Persistent Storage Keys)

- `tournament:{id}` — tournament config (name, dates, tiers, settings, pool code)
- `golfers:{tournament_id}` — golfer list with tier assignments and odds
- `entries:{tournament_id}` — all submitted entries (participant name, 6 golfer picks, timestamp)
- `scores:{tournament_id}` — cached live scores from API
- `snapshots:{tournament_id}` — end-of-round snapshots for trend charts (rank + points per entry per round)
- `history` — past tournament results (admin-editable)
- `admin-code` — hashed admin access code

---

*Last updated: April 29, 2026*
