// Seeds a realistic 2026 Masters tournament so the whole app is clickable
// even without a live event. Idempotent — only seeds if no tournaments exist yet.

import { storage, keys, setActiveTournamentId } from './storage.js';

const TOURNAMENT_ID = '2026-masters';

// Golfers grouped by tier. Strokes-to-par simulates "Round 3 in progress".
const FIELD = [
  // Tier 1 — Dark blue (favorites)
  { name: 'Scottie Scheffler', odds: '+450',  tier: 1, strokesToPar: -8, todayToPar: -3, thru: 14, status: 'made_cut' },
  { name: 'Rory McIlroy',      odds: '+600',  tier: 1, strokesToPar: -6, todayToPar: -2, thru: 14, status: 'made_cut' },
  { name: 'Xander Schauffele', odds: '+800',  tier: 1, strokesToPar: -4, todayToPar: -1, thru: 13, status: 'made_cut' },
  { name: 'Jon Rahm',          odds: '+900',  tier: 1, strokesToPar: -3, todayToPar: 1,  thru: 13, status: 'made_cut' },
  { name: 'Ludvig Aberg',      odds: '+1000', tier: 1, strokesToPar: -7, todayToPar: -4, thru: 14, status: 'made_cut' },

  // Tier 2 — Orange
  { name: 'Collin Morikawa',   odds: '+1400', tier: 2, strokesToPar: -5, todayToPar: -2, thru: 13, status: 'made_cut' },
  { name: 'Viktor Hovland',    odds: '+1600', tier: 2, strokesToPar: -4, todayToPar: -1, thru: 14, status: 'made_cut' },
  { name: 'Patrick Cantlay',   odds: '+1800', tier: 2, strokesToPar: -2, todayToPar: 0,  thru: 12, status: 'made_cut' },
  { name: 'Hideki Matsuyama',  odds: '+2000', tier: 2, strokesToPar: -3, todayToPar: -1, thru: 13, status: 'made_cut' },
  { name: 'Brooks Koepka',     odds: '+2000', tier: 2, strokesToPar:  2, todayToPar:  3, thru: 14, status: 'made_cut' },

  // Tier 3 — Dark green
  { name: 'Tommy Fleetwood',   odds: '+2500', tier: 3, strokesToPar: -3, todayToPar: -2, thru: 13, status: 'made_cut' },
  { name: 'Sam Burns',         odds: '+2800', tier: 3, strokesToPar: -1, todayToPar:  0, thru: 14, status: 'made_cut' },
  { name: 'Wyndham Clark',     odds: '+3000', tier: 3, strokesToPar:  1, todayToPar:  2, thru: 13, status: 'made_cut' },
  { name: 'Sahith Theegala',   odds: '+3000', tier: 3, strokesToPar: -2, todayToPar: -1, thru: 14, status: 'made_cut' },
  { name: 'Justin Thomas',     odds: '+3500', tier: 3, strokesToPar:  0, todayToPar:  1, thru: 13, status: 'made_cut' },

  // Tier 4 — Light blue
  { name: 'Max Homa',          odds: '+4000', tier: 4, strokesToPar: -2, todayToPar: -2, thru: 14, status: 'made_cut' },
  { name: 'Tony Finau',        odds: '+4500', tier: 4, strokesToPar:  1, todayToPar:  1, thru: 13, status: 'made_cut' },
  { name: 'Cameron Young',     odds: '+5000', tier: 4, strokesToPar: -1, todayToPar:  0, thru: 14, status: 'made_cut' },
  { name: 'Russell Henley',    odds: '+5000', tier: 4, strokesToPar:  3, todayToPar:  2, thru: 13, status: 'made_cut' },
  { name: 'Min Woo Lee',       odds: '+6000', tier: 4, strokesToPar:  4, todayToPar:  3, thru: 12, status: 'made_cut' },

  // Tier 5 — Light green
  { name: 'Sam Lowry',         odds: '+8000', tier: 5, strokesToPar:  2, todayToPar:  1, thru: 14, status: 'made_cut' },
  { name: 'Tom Kim',           odds: '+8000', tier: 5, strokesToPar:  3, todayToPar:  2, thru: 13, status: 'made_cut' },
  { name: 'Si Woo Kim',        odds: '+9000', tier: 5, strokesToPar:  5, todayToPar:  3, thru: 13, status: 'made_cut' },
  { name: 'Sungjae Im',        odds: '+10000',tier: 5, strokesToPar:  6, todayToPar:  4, thru: 12, status: 'made_cut' },
  { name: 'Akshay Bhatia',     odds: '+10000',tier: 5, strokesToPar:  4, todayToPar:  2, thru: 13, status: 'made_cut' },

  // Tier 6 — Yellow (long shots)
  { name: 'Brian Harman',      odds: '+15000',tier: 6, strokesToPar:  8, todayToPar:  3, thru: 13, status: 'made_cut' },
  { name: 'Nick Taylor',       odds: '+15000',tier: 6, strokesToPar:  6, todayToPar:  2, thru: 14, status: 'made_cut' },
  { name: 'Adam Scott',        odds: '+20000',tier: 6, strokesToPar:  7, todayToPar:  3, thru: 13, status: 'made_cut' },
  { name: 'Corey Conners',     odds: '+20000',tier: 6, strokesToPar: 11, todayToPar:  4, thru: 12, status: 'made_cut' },
  { name: 'Sepp Straka',       odds: '+25000',tier: 6, strokesToPar:  5, todayToPar:  1, thru: 14, status: 'made_cut' },

  // Missed cut
  { name: 'Phil Mickelson',    odds: '+30000',tier: 6, strokesToPar:  9, todayToPar:  0, thru: 18, status: 'missed_cut' },
  { name: 'Bryson DeChambeau', odds: '+5000', tier: 4, strokesToPar:  7, todayToPar:  0, thru: 18, status: 'missed_cut' },
];

const ENTRIES = [
  { name: 'Brooks T.', entryNum: 1, golfers: ['Scottie Scheffler', 'Viktor Hovland', 'Tommy Fleetwood', 'Tony Finau', 'Sam Lowry', 'Tom Kim'] },
  { name: 'Glenn M.',  entryNum: 1, golfers: ['Rory McIlroy', 'Viktor Hovland', 'Sam Burns', 'Max Homa', 'Tom Kim', 'Sepp Straka'] },
  { name: 'Rielly K.', entryNum: 1, golfers: ['Xander Schauffele', 'Patrick Cantlay', 'Sahith Theegala', 'Cameron Young', 'Tom Kim', 'Nick Taylor'] },
  { name: 'Charles D.', entryNum: 1, golfers: ['Scottie Scheffler', 'Collin Morikawa', 'Tommy Fleetwood', 'Max Homa', 'Sam Lowry', 'Tom Kim'] },
  { name: 'Charles D.', entryNum: 2, golfers: ['Rory McIlroy', 'Viktor Hovland', 'Sam Burns', 'Tony Finau', 'Sam Lowry', 'Sepp Straka'] },
  { name: 'Bryce W.',  entryNum: 1, golfers: ['Jon Rahm', 'Hideki Matsuyama', 'Sahith Theegala', 'Min Woo Lee', 'Brian Harman', 'Si Woo Kim'] },
  { name: 'Brooks T.', entryNum: 2, golfers: ['Rory McIlroy', 'Brooks Koepka', 'Justin Thomas', 'Tony Finau', 'Sam Lowry', 'Nick Taylor'] },
  { name: 'Rielly K.', entryNum: 2, golfers: ['Ludvig Aberg', 'Collin Morikawa', 'Wyndham Clark', 'Max Homa', 'Brian Harman', 'Si Woo Kim'] },
  { name: 'Vishnu P.', entryNum: 1, golfers: ['Scottie Scheffler', 'Hideki Matsuyama', 'Tommy Fleetwood', 'Cameron Young', 'Akshay Bhatia', 'Adam Scott'] },
  { name: 'Vishnu P.', entryNum: 2, golfers: ['Ludvig Aberg', 'Viktor Hovland', 'Tommy Fleetwood', 'Max Homa', 'Tom Kim', 'Nick Taylor'] },
  { name: 'Dan O.',    entryNum: 1, golfers: ['Xander Schauffele', 'Collin Morikawa', 'Sahith Theegala', 'Tony Finau', 'Tom Kim', 'Sepp Straka'] },
  { name: 'Lily R.',   entryNum: 1, golfers: ['Scottie Scheffler', 'Patrick Cantlay', 'Justin Thomas', 'Russell Henley', 'Sungjae Im', 'Brian Harman'] },
];

const PAST_HISTORY = [
  { id: '2025-masters',  name: '2025 Masters',          date: '2025-04-13', winner: 'Brooks T.',  team: ['Scheffler', 'Morikawa', 'Fleetwood', 'Homa', 'Lowry', 'Tom Kim'],         points: 48, entries: 48, prize: 312 },
  { id: '2025-us-open',  name: '2025 US Open',          date: '2025-06-15', winner: 'Charles D.', team: ['Schauffele', 'Hovland', 'Clark', 'Henley', 'Young', 'Nick Taylor'],     points: 52, entries: 43, prize: 279.50 },
  { id: '2025-open',     name: '2025 Open Championship',date: '2025-07-20', winner: 'Rielly K.',  team: ['McIlroy', 'Hovland', 'Burns', 'Finau', 'Lowry', 'Nick Taylor'],         points: 39, entries: 55, prize: 357.50 },
  { id: '2025-pga',      name: '2025 PGA Championship', date: '2025-05-18', winner: 'Glenn M.',   team: ['Rahm', 'Matsuyama', 'Theegala', 'Im', 'Young', 'Si Woo Kim'],            points: 44, entries: 40, prize: 260 },
  { id: '2025-players',  name: '2025 The Players',      date: '2025-03-16', winner: 'Bryce W.',   team: ['Aberg', 'Koepka', 'Thomas', 'Finau', 'Lowry', 'Straka'],                points: 41, entries: 35, prize: 227.50 },
];

export function seedDemoMasters() {
  if (storage.get(keys.tournament(TOURNAMENT_ID))) {
    if (!confirm('Demo tournament already exists. Overwrite?')) return false;
  }
  if (!storage.get(keys.adminCode)) storage.set(keys.adminCode, 'admin');

  storage.set(keys.tournament(TOURNAMENT_ID), {
    id: TOURNAMENT_ID,
    name: '2026 Masters',
    course: 'Augusta National',
    startDate: '2026-04-09',
    deadline: '2026-04-08T23:59:59',
    poolCode: 'masters26',
    entryFee: 10,
    tieredPenaltyEnabled: false,
    cutLine: 6,
    currentRound: 3,
    status: 'live',
    tierLabels: ['Dark blue', 'Orange', 'Dark green', 'Light blue', 'Light green', 'Yellow'],
  });

  const golfersWithIds = FIELD.map((g, i) => ({ id: `g${i + 1}`, ...g }));
  storage.set(keys.golfers(TOURNAMENT_ID), golfersWithIds);

  const nameToId = new Map(golfersWithIds.map((g) => [g.name, g.id]));
  const entriesWithIds = ENTRIES.map((e, i) => ({
    id: `e${i + 1}`,
    name: e.name,
    entryNum: e.entryNum,
    golferIds: e.golfers.map((n) => nameToId.get(n)).filter(Boolean),
    createdAt: '2026-04-08T20:00:00',
  }));
  storage.set(keys.entries(TOURNAMENT_ID), entriesWithIds);

  // Synthesize snapshots for R1 + R2 so the trends page has data
  const snapshots = [];
  for (let r = 1; r <= 2; r++) {
    const snap = entriesWithIds.map((e) => ({
      entryId: e.id,
      round: r,
      // Synthetic: smaller magnitudes early
      points: Math.round((r / 3) * (10 + (e.id.charCodeAt(1) % 40) - 15)),
    }));
    // Add rank within round
    snap.sort((a, b) => b.points - a.points);
    snap.forEach((s, i) => (s.rank = i + 1));
    snapshots.push(...snap);
  }
  storage.set(keys.snapshots(TOURNAMENT_ID), snapshots);

  storage.set(keys.history, PAST_HISTORY);
  setActiveTournamentId(TOURNAMENT_ID);
  return true;
}
