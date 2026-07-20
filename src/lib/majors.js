import { storage, keys, listTournaments } from './storage.js';
import { finalStandings } from './scoring.js';
import { oddsToNum } from './odds.js';

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
// Names of the stroker(s) who won the most recent PAST major of the same
// event type as `tournament` (a true "defending champion" lookup — same
// event only, exactly one edition back, not just whoever won most recently
// overall). Returns [] if the event type is 'other' (no meaningful
// defending-champion concept for a catch-all category), if there's no prior
// edition on record, or if `tournament` has no usable start date to anchor
// "previous" against.
export function getDefendingChampions(tournament) {
  if (!tournament?.eventType || tournament.eventType === 'other') return [];
  if (!tournament.startDate) return [];
  const currentDate = new Date(tournament.startDate);
  if (isNaN(currentDate)) return [];

  const priorEditions = buildMajors()
    .filter((m) => m.eventType === tournament.eventType && m.date)
    .filter((m) => new Date(m.date) < currentDate)
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
