import { storage, keys, listTournaments } from './storage.js';
import { finalStandings } from './scoring.js';
import { oddsToNum } from './odds.js';
import { eventTypeEmoji } from './eventTypes.js';

const LONGSHOT_THRESHOLD = 3000; // +3000 or longer odds counts as a notable pick
const NAIL_BITER_MARGIN = 3;     // won by this many points or fewer
const RUNAWAY_MARGIN = 10;       // won by this many points or more

// Builds the unified "majors" list used by both the History page and the
// Home page's recent-majors section.
//
// "Full data" = a completed tournament that still has its entries/golfers
// rows around, so standings (and a highlight) can be computed live.
// "Summary only" = a `history` row with no matching tournament left — the
// legacy/manually-entered case where only the winner was ever recorded.
export function buildMajors() {
  const history = storage.get(keys.history) || [];
  const allTournaments = listTournaments();
  const full = [];
  const fullIds = new Set();

  for (const t of allTournaments) {
    if (t.status !== 'completed') continue;
    const tGolfers = storage.get(keys.golfers(t.id)) || [];
    const tEntries = storage.get(keys.entries(t.id)) || [];
    const fs = finalStandings(t, tGolfers, tEntries);
    if (!fs) continue;
    fullIds.add(t.id);
    const major = {
      id: t.id,
      name: t.name,
      date: t.startDate || '',
      fullData: true,
      eventType: t.eventType || 'other',
      winner: fs.winnerNames,
      team: fs.team,
      points: fs.points,
      entryCount: tEntries.length,
      prize: fs.prize,
      ranked: fs.ranked,
      payouts: fs.payouts,
    };
    major.highlight = computeHighlight(major, tGolfers);
    full.push(major);
  }

  const summary = history
    .filter((h) => !fullIds.has(h.id))
    .map((h) => {
      const major = {
        id: h.id,
        name: h.name,
        date: h.date || '',
        fullData: false,
        eventType: h.eventType || 'other',
        winner: h.winner,
        team: h.team || [],
        points: h.points,
        entryCount: h.entries,
        prize: h.prize,
      };
      major.highlight = computeHighlight(major, null);
      return major;
    });

  return [...full, ...summary];
}

// One auto-computed "anything interesting" line per event, in priority order:
// a tie for the win, then a notable longshot pick on the winning team, then
// how close/lopsided the margin was. Returns null if nothing stands out (or
// there isn't enough data to tell, e.g. a summary-only legacy major).
// Names of the stroker(s) who won the most recent PAST major of the given
// event type, anchored strictly before `anchorDate` (a true "defending
// champion" lookup — same event only, exactly one edition back, not just
// whoever won most recently overall). Takes a plain {eventType, anchorDate}
// pair rather than a tournament object so it works equally for the active
// tournament (anchorDate = its startDate) and the admin's manual "next
// major" override (anchorDate = its deadline, since there's no startDate
// yet). Returns [] for event type 'other'/unset, missing/invalid
// anchorDate, or no prior edition on record.
export function getDefendingChampions({ eventType, anchorDate } = {}) {
  if (!eventType || eventType === 'other') return [];
  if (!anchorDate) return [];
  const anchor = new Date(anchorDate);
  if (isNaN(anchor)) return [];

  const priorEditions = buildMajors()
    .filter((m) => m.eventType === eventType && m.date)
    .filter((m) => new Date(m.date) < anchor)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const mostRecent = priorEditions[0];
  if (!mostRecent?.winner) return [];
  return mostRecent.winner.split(' & ').map((s) => s.trim()).filter(Boolean);
}

function computeHighlight(m, tGolfers) {
  const winners = (m.winner || '').split(' & ').map((s) => s.trim()).filter(Boolean);
  if (winners.length > 1) return `Tie for the win between ${winners.join(' & ')}`;

  if (tGolfers?.length && m.team?.length) {
    const byName = new Map(tGolfers.map((g) => [g.name, g]));
    let longshot = null;
    for (const name of m.team) {
      const g = byName.get(name);
      if (!g) continue;
      const oddsNum = oddsToNum(g.odds);
      if (oddsNum >= LONGSHOT_THRESHOLD && (!longshot || oddsNum > longshot.oddsNum)) {
        longshot = { name, odds: g.odds, oddsNum };
      }
    }
    if (longshot) return `Rode a longshot pick: ${longshot.name} (${longshot.odds})`;
  }

  if (m.ranked?.length >= 2) {
    const totals = [...new Set(m.ranked.map((r) => r.total))].sort((a, b) => b - a);
    if (totals.length >= 2) {
      const margin = totals[0] - totals[1];
      if (margin <= NAIL_BITER_MARGIN) return `Nail-biter — won by just ${margin} pt${margin === 1 ? '' : 's'}`;
      if (margin >= RUNAWAY_MARGIN) return `Runaway win — margin of ${margin} pts`;
    }
  }

  return null;
}

// ─── Homepage "pool records" ────────────────────────────────────────────

/** Stroker(s) with the most all-time wins, across every major (any type). */
export function getMostDecorated(majors) {
  const wins = new Map();
  for (const m of majors) {
    const winners = (m.winner || '').split(' & ').map((s) => s.trim()).filter(Boolean);
    for (const w of winners) wins.set(w, (wins.get(w) || 0) + 1);
  }
  if (!wins.size) return null;
  const max = Math.max(...wins.values());
  if (max <= 0) return null;
  const names = [...wins.entries()].filter(([, c]) => c === max).map(([n]) => n);
  return { names, wins: max };
}

// Walks a chronologically-sorted list of majors and finds, per stroker, the
// longest run of CONSECUTIVE majors (within that list) they won. A tied win
// counts as a win for everyone in the tie, so a co-championship extends
// everyone's streak, not just one person's.
function longestConsecutiveWinStreak(sortedMajors) {
  const current = new Map(); // name -> running streak length
  const best = new Map();    // name -> best streak length seen
  for (const m of sortedMajors) {
    const winners = new Set((m.winner || '').split(' & ').map((s) => s.trim()).filter(Boolean));
    for (const name of new Set([...current.keys(), ...winners])) {
      if (winners.has(name)) {
        const next = (current.get(name) || 0) + 1;
        current.set(name, next);
        if (next > (best.get(name) || 0)) best.set(name, next);
      } else {
        current.set(name, 0);
      }
    }
  }
  if (!best.size) return null;
  const max = Math.max(...best.values());
  if (max < 2) return null; // a "streak" of 1 isn't a streak
  const names = [...best.entries()].filter(([, c]) => c === max).map(([n]) => n);
  return { names, length: max };
}

/**
 * Longest win streaks, computed two ways since "streak" is genuinely
 * ambiguous:
 *   - overall: consecutive majors won back-to-back, any event type,
 *     in chronological order.
 *   - sameEvent: consecutive editions of the SAME event type won in a row
 *     (e.g. 3 Masters in a row) — the best such streak found across all
 *     event types (excluding 'other', which has no coherent identity).
 * Either can be null if nothing qualifies (need at least a streak of 2).
 */
export function getLongestStreaks(majors) {
  const withDates = majors.filter((m) => m.date && m.winner);

  const overallSorted = [...withDates].sort((a, b) => new Date(a.date) - new Date(b.date));
  const overall = longestConsecutiveWinStreak(overallSorted);

  let sameEvent = null;
  const types = new Set(withDates.map((m) => m.eventType).filter((t) => t && t !== 'other'));
  for (const type of types) {
    const typeSorted = withDates
      .filter((m) => m.eventType === type)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    const result = longestConsecutiveWinStreak(typeSorted);
    if (result && (!sameEvent || result.length > sameEvent.length)) {
      sameEvent = { ...result, eventType: type };
    }
  }

  return { overall, sameEvent };
}

const GRAND_SLAM_TYPES = ['masters', 'us_open', 'pga', 'open'];

/**
 * Career grand-slam progress: how many of the 4 real majors (Masters, US
 * Open, PGA, Open — WM Open and Other don't count) each stroker has won at
 * least once, ever. Returns every stroker with at least one grand-slam-type
 * win (sorted by count desc) plus the leader(s) at the max count.
 */
export function getGrandSlamProgress(majors) {
  const wonTypes = new Map(); // name -> Set of eventTypes won

  for (const m of majors) {
    if (!GRAND_SLAM_TYPES.includes(m.eventType)) continue;
    const winners = (m.winner || '').split(' & ').map((s) => s.trim()).filter(Boolean);
    for (const w of winners) {
      const set = wonTypes.get(w) || new Set();
      set.add(m.eventType);
      wonTypes.set(w, set);
    }
  }

  const all = [...wonTypes.entries()]
    .map(([name, set]) => ({ name, count: set.size, pct: Math.round((set.size / GRAND_SLAM_TYPES.length) * 100) }))
    .sort((a, b) => b.count - a.count);

  if (!all.length) return { leaders: [], all };
  const max = all[0].count;
  const leaders = all.filter((r) => r.count === max);
  return { leaders, all };
}

// Every major each stroker has won, all-time, one entry per win (a tie
// counts as a full win for each co-winner). Sorted newest-first. Always
// computed from the full unfiltered majors list — a stroker's trophy case
// is a fixed fact about them, not something that should shrink because the
// person looking at it happens to have a History filter active.
export function getStrokerWins() {
  const wins = new Map(); // name -> [{ major, date, eventType }]
  const sorted = buildMajors()
    .filter((m) => m.date && m.winner)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  for (const m of sorted) {
    const winners = (m.winner || '').split(' & ').map((s) => s.trim()).filter(Boolean);
    for (const w of winners) {
      const list = wins.get(w) || [];
      list.push({ major: m.name, date: m.date, eventType: m.eventType });
      wins.set(w, list);
    }
  }
  return wins;
}

// Fixed display order so the emoji string reads the same for everyone
// regardless of the order they actually won things in.
const TROPHY_ORDER = ['masters', 'pga', 'us_open', 'open', 'wm_open'];

/** Builds the repeated-emoji trophy-case string from a stroker's win list. */
export function trophyCaseEmojis(winList) {
  const counts = new Map();
  for (const w of winList || []) counts.set(w.eventType, (counts.get(w.eventType) || 0) + 1);
  let out = '';
  for (const type of TROPHY_ORDER) {
    out += eventTypeEmoji(type).repeat(counts.get(type) || 0);
  }
  return out;
}
