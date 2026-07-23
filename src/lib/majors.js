import { storage, keys, listTournaments } from './storage.js';
import { finalStandings } from './scoring.js';
import { oddsToNum } from './odds.js';
import { eventTypeEmoji, eventTypeLabel } from './eventTypes.js';

const LONGSHOT_THRESHOLD = 8000;        // a single pick this long (or longer) is notable on its own
const UNDERDOG_TEAM_AVG_THRESHOLD = 9000; // whole-team average odds this long counts as "underdogs"
const NAIL_BITER_MARGIN = 3;            // won by this many points or fewer
const RUNAWAY_MARGIN = 10;              // won by this many points or more

// "1st"/"2nd"/"3rd"/"4th"... for a bare place number — used for summary-only
// majors' multi-place payouts, which don't have a full ranked entry list to
// derive a tie-aware label from the way formatRank() does.
function ordinalSuffix(n) {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

// Groups a summary-only major's flat payouts list ([{place, name, prize}])
// by place, sorted low-to-high, with a tie-aware rank label ("T2nd" when
// more than one name shares a place). Shared by the Events & payouts table
// and getStrokerRows() below so both read the same tie logic.
export function groupSummaryPayouts(payouts) {
  const byPlace = new Map();
  for (const p of payouts || []) {
    const arr = byPlace.get(p.place) || [];
    arr.push(p);
    byPlace.set(p.place, arr);
  }
  return [...byPlace.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([place, entries]) => ({
      place,
      rankLabel: entries.length > 1 ? `T${ordinalSuffix(place)}` : ordinalSuffix(place),
      entries,
    }));
}

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
      champion: tGolfers.find((g) => g.won)?.name || null,
      championTier: tGolfers.find((g) => g.won)?.tier ?? null,
      tieredPenaltyEnabled: !!t.tieredPenaltyEnabled,
      team: fs.team,
      points: fs.points,
      entryCount: tEntries.length,
      prize: fs.prize,
      ranked: fs.ranked,
      payouts: fs.payouts,
    };
    full.push(major);
  }

  const summary = history
    .filter((h) => !fullIds.has(h.id))
    .map((h) => ({
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
      summaryPayouts: h.payouts || [],
    }));

  // Highlights are computed in a second pass, once every major is assembled —
  // "defending champ repeats" needs to look sideways at prior editions of the
  // same event type, which isn't available yet mid-construction above.
  // Every candidate fact that applies is kept (not just the best one) so a
  // consumer showing several majors side by side (the Home page) can assign
  // each one a DIFFERENT fact rather than have the same one win repeatedly
  // for majors that happen to share more than one qualifying fact.
  const all = [...full, ...summary];
  for (const major of all) {
    major.highlightCandidates = computeHighlightCandidates(major, all);
    major.highlight = major.highlightCandidates[0]?.text ?? null;
  }
  return all;
}

// Greedily assigns each major in `list` (in order) the highest-priority
// highlight fact whose key hasn't already been claimed by an earlier major
// in the same list — so a set of majors shown together never repeats the
// same fact type twice, even when several of them structurally qualify for
// the same top fact. A major falls back to null (no highlight shown, rather
// than a forced duplicate) if every fact it qualifies for is already taken.
// Returns new major objects; doesn't mutate the input.
export function withUniqueHighlights(list) {
  const used = new Set();
  return list.map((m) => {
    const candidates = m.highlightCandidates || [];
    const pick = candidates.find((c) => !used.has(c.key));
    if (pick) used.add(pick.key);
    return { ...m, highlight: pick ? pick.text : null };
  });
}

// Names of the stroker(s) who won the most recent PAST major of the given
// event type, anchored strictly before `anchorDate` (a true "defending
// champion" lookup — same event only, exactly one edition back, not just
// whoever won most recently overall). Takes a plain {eventType, anchorDate}
// pair rather than a tournament object so it works equally for the active
// tournament (anchorDate = its startDate) and the admin's manual "next
// major" override (anchorDate = its deadline, since there's no startDate
// yet). Returns [] for event type 'other'/unset, missing/invalid
// anchorDate, or no prior edition on record.
// `majorsList`, if provided, is used instead of calling buildMajors() again —
// computeHighlight passes its own in-progress list here to avoid recursion.
export function getDefendingChampions({ eventType, anchorDate } = {}, majorsList = null) {
  if (!eventType || eventType === 'other') return [];
  if (!anchorDate) return [];
  const anchor = new Date(anchorDate);
  if (isNaN(anchor)) return [];

  const priorEditions = (majorsList || buildMajors())
    .filter((m) => m.eventType === eventType && m.date)
    .filter((m) => new Date(m.date) < anchor)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const mostRecent = priorEditions[0];
  if (!mostRecent?.winner) return [];
  return mostRecent.winner.split(' & ').map((s) => s.trim()).filter(Boolean);
}

// Every "anything interesting" fact that applies to a major, in priority
// order (rarest/most notable first) — unlike a single pick-the-first-match
// function, this collects ALL qualifying facts so a caller juggling several
// majors at once (Home page) can skip ones already used elsewhere and fall
// back to this major's next-best fact instead of forcing a duplicate.
// `allMajors` is buildMajors()'s own in-progress list, needed for the
// "defending champ" lookback. Each candidate is { key, text }; `key`
// identifies the fact TYPE (for de-duping), `text` is the display string.
function computeHighlightCandidates(m, allMajors) {
  const candidates = [];
  const winners = (m.winner || '').split(' & ').map((s) => s.trim()).filter(Boolean);

  // Rarest: a tie for the win.
  if (winners.length > 1) {
    candidates.push({ key: 'tie', text: `Tie for the win between ${winners.join(' & ')}` });
  }

  // Everything below needs the winning entry's actual picks, which only
  // exist for full-data majors (ranked/scored come straight from live entries).
  const winningRows = m.fullData && m.ranked?.length
    ? m.ranked.filter((r) => r.rank === m.ranked[0].rank)
    : [];

  // Defending champion repeats (only meaningful for a single, undisputed winner).
  if (winners.length === 1 && m.date && m.eventType && m.eventType !== 'other') {
    const defenders = getDefendingChampions({ eventType: m.eventType, anchorDate: m.date }, allMajors);
    if (defenders.includes(winners[0])) {
      const priorName = allMajors
        .filter((o) => o !== m && o.eventType === m.eventType && o.date && new Date(o.date) < new Date(m.date))
        .sort((a, b) => new Date(b.date) - new Date(a.date))[0]?.name;
      candidates.push({
        key: 'defendingChamp',
        text: `${winners[0]} defended their title${priorName ? ` from ${priorName}` : ''}`,
      });
    }
  }

  // Down-tier gambit paid off — winner skipped a tier and doubled up a lower one.
  // (> 0, not just non-null: some legacy rows store 0 rather than null for "no skip".)
  if (winningRows.length === 1 && winningRows[0].entry.downTierSkipped > 0) {
    candidates.push({
      key: 'downTierGambit',
      text: `Won it after a down-tier gambit — skipped Tier ${winningRows[0].entry.downTierSkipped} to double up below it`,
    });
  }

  // Cut-line survivor — winner won despite a missed-cut pick dragging them down.
  if (winningRows.length) {
    const missedCutNames = new Set();
    for (const row of winningRows) {
      for (const s of row.scored) {
        if (s.golfer.status === 'missed_cut') missedCutNames.add(s.golfer.name);
      }
    }
    if (missedCutNames.size === 1) {
      candidates.push({ key: 'cutLineSurvivor', text: `Won it despite ${[...missedCutNames][0]} missing the cut` });
    } else if (missedCutNames.size > 1) {
      candidates.push({
        key: 'cutLineSurvivor',
        text: `Won it despite ${missedCutNames.size} golfers on the team missing the cut`,
      });
    }
  }

  // Squad of underdogs — the whole team's average odds were long, not just one pick.
  if (winningRows.length === 1) {
    const oddsNums = winningRows[0].scored.map((s) => oddsToNum(s.golfer.odds)).filter((n) => n >= 0);
    if (oddsNums.length) {
      const avg = oddsNums.reduce((a, b) => a + b, 0) / oddsNums.length;
      if (avg >= UNDERDOG_TEAM_AVG_THRESHOLD) {
        candidates.push({
          key: 'squadOfUnderdogs',
          text: `Full squad of underdogs — averaged +${Math.round(avg).toLocaleString()} odds across all 6 picks`,
        });
      }
    }
  }

  // A single standout longshot pick on the winning team(s).
  if (winningRows.length) {
    let longshot = null;
    for (const row of winningRows) {
      for (const s of row.scored) {
        const oddsNum = oddsToNum(s.golfer.odds);
        if (oddsNum >= LONGSHOT_THRESHOLD && (!longshot || oddsNum > longshot.oddsNum)) {
          longshot = { name: s.golfer.name, odds: s.golfer.odds, oddsNum };
        }
      }
    }
    if (longshot) candidates.push({ key: 'longshot', text: `Rode a longshot pick: ${longshot.name} (${longshot.odds})` });
  }

  // Most common: how close/lopsided the margin was.
  if (m.ranked?.length >= 2) {
    const totals = [...new Set(m.ranked.map((r) => r.total))].sort((a, b) => b - a);
    if (totals.length >= 2) {
      const margin = totals[0] - totals[1];
      if (margin <= NAIL_BITER_MARGIN) {
        candidates.push({ key: 'margin', text: `Nail-biter — won by just ${margin} pt${margin === 1 ? '' : 's'}` });
      } else if (margin >= RUNAWAY_MARGIN) {
        candidates.push({ key: 'margin', text: `Runaway win — margin of ${margin} pts` });
      }
    }
  }

  return candidates;
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
// everyone's streak, not just one person's. Tracks the actual majors behind
// each name's best streak (not just its length) so a caller can show what it
// consisted of — kept PER NAME, since two people can independently reach the
// same max streak length via entirely different major sequences.
function longestConsecutiveWinStreak(sortedMajors) {
  const current = new Map(); // name -> running list of majors in the current streak
  const best = new Map();    // name -> majors list of the best streak seen
  for (const m of sortedMajors) {
    const winners = new Set((m.winner || '').split(' & ').map((s) => s.trim()).filter(Boolean));
    for (const name of new Set([...current.keys(), ...winners])) {
      if (winners.has(name)) {
        const list = [...(current.get(name) || []), m];
        current.set(name, list);
        if (list.length > (best.get(name)?.length || 0)) best.set(name, list);
      } else {
        current.set(name, []);
      }
    }
  }
  if (!best.size) return null;
  const max = Math.max(...[...best.values()].map((l) => l.length));
  if (max < 2) return null; // a "streak" of 1 isn't a streak
  const names = [...best.entries()].filter(([, l]) => l.length === max).map(([n]) => n);
  const byName = new Map(
    names.map((n) => [n, best.get(n).map((m) => ({ name: m.name, date: m.date, eventType: m.eventType }))])
  );
  return { names, length: max, byName };
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

export const GRAND_SLAM_TYPES = ['masters', 'us_open', 'pga', 'open'];

/**
 * Career grand-slam progress: how many of the 4 real majors (Masters, US
 * Open, PGA, Open — WM Open and Other don't count) each stroker has won at
 * least once, ever. Returns every stroker with at least one grand-slam-type
 * win (sorted by count desc) plus the leader(s) at the max count. Each row
 * includes `types`, the actual event types won, so a caller can show which
 * of the 4 are done vs. still missing (not just the count).
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
    .map(([name, set]) => ({
      name, count: set.size, pct: Math.round((set.size / GRAND_SLAM_TYPES.length) * 100),
      types: [...set],
    }))
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

// Builds the fact list a recap prompt is allowed to state — shared by both
// full-data and summary-only recap requests so the two paths can't drift
// apart on what counts as "back-to-back," a real win total, or a Grand Slam.
// Each line is a hard fact, not a suggestion — the prompt itself also tells
// the model not to invent anything beyond this list, since past runs showed
// the model will happily hallucinate a plausible-sounding streak or win
// count if you only ever tell it the positive cases and let it guess the rest.
//
// `eventType`/`date`/`winnerList` describe the major just played (not yet in
// buildMajors()'s output). `priorMajors` is buildMajors() from BEFORE this
// one was added, so "the most recent prior major" and win counts are exactly
// what they'd have been going into this event.
export function buildRecapStoryContext({ eventType, date, winnerList }, priorMajors) {
  const storyContext = [];

  // Deliberately NOT getStrokerWins() — that recomputes from buildMajors()
  // fresh, which includes the very major being recapped the moment it has a
  // history row or live entries (i.e. almost always, since this runs after
  // the record already exists). Counting off the caller's priorMajors list
  // instead is the only way to avoid a stroker's own win-just-now getting
  // counted twice (this is what produced "3rd career major" for someone's
  // 2nd, and "three total" for someone's 2nd, in earlier runs).
  const strokerWins = new Map();
  for (const m of [...priorMajors].filter((x) => x.date).sort((a, b) => new Date(b.date) - new Date(a.date))) {
    if (!m.winner) continue;
    for (const w of m.winner.split(' & ').map((s) => s.trim()).filter(Boolean)) {
      const list = strokerWins.get(w) || [];
      list.push({ major: m.name, date: m.date, eventType: m.eventType });
      strokerWins.set(w, list);
    }
  }

  for (const w of winnerList) {
    const priorWins = strokerWins.get(w) || [];
    const totalWins = priorWins.length + 1; // +1 for the win being recapped
    storyContext.push(`This is ${w}'s ${ordinalSuffix(totalWins)} major win overall (including this one) — state this exact number if you mention a win total, don't estimate.`);

    if (eventType && GRAND_SLAM_TYPES.includes(eventType)) {
      const priorTypes = new Set(priorWins.filter((pw) => GRAND_SLAM_TYPES.includes(pw.eventType)).map((pw) => pw.eventType));
      const newTypes = new Set(priorTypes);
      newTypes.add(eventType);
      if (newTypes.size === GRAND_SLAM_TYPES.length && priorTypes.size === GRAND_SLAM_TYPES.length - 1) {
        storyContext.push(`HEADLINE STORY: ${w} just completed the career Grand Slam with this win — they have now won all four majors (Masters, US Open, PGA Championship, Open Championship) at some point. Lead with this.`);
      } else if (newTypes.size > priorTypes.size) {
        storyContext.push(`This is ${w}'s first-ever ${eventTypeLabel(eventType)} win. They've now won ${newTypes.size} of the 4 major types needed for the career Grand Slam.`);
      }
    }
  }

  const priorSorted = priorMajors
    .filter((m) => m.date && new Date(m.date) < new Date(date))
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  const lastMajor = priorSorted[0];
  if (lastMajor?.winner) {
    const lastWinners = lastMajor.winner.split(' & ').map((s) => s.trim());
    const repeat = winnerList.find((w) => lastWinners.includes(w));
    if (repeat) {
      storyContext.push(`${repeat} also won the last major played (${lastMajor.name}) — that IS back-to-back, you can say so.`);
    } else {
      storyContext.push(`The last major played before this one was ${lastMajor.name}, won by ${lastMajor.winner} — a DIFFERENT person/team. This is NOT a back-to-back win for ${winnerList.join(' & ')}; do not call it one.`);
    }
  }

  const defenders = getDefendingChampions({ eventType, anchorDate: date }, priorMajors);
  if (defenders.length) {
    const repeated = winnerList.some((w) => defenders.includes(w));
    storyContext.push(`Defending ${eventTypeLabel(eventType)} champion: ${defenders.join(' & ')}.${repeated ? ' They just defended their title!' : ''}`);
  }

  return storyContext;
}

// "2nd", "T3", etc. — prefixes a T when someone else shares that rank in the
// same major, matching the tie-handling convention used everywhere else.
export function formatRank(rank, rankedList) {
  const tied = (rankedList || []).filter((x) => x.rank === rank).length > 1;
  const mod100 = rank % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? 'th'
    : rank % 10 === 1 ? 'st'
    : rank % 10 === 2 ? 'nd'
    : rank % 10 === 3 ? 'rd' : 'th';
  return `${tied ? 'T' : ''}${rank}${suffix}`;
}

/**
 * Per-stroker financial rollup: wins, $ won (incl. non-winning paid
 * finishes), entries, fees paid, ROI, and average pick odds. Wins/$ won
 * count both full-data and summary-only majors; entries/fees/ROI/podiums
 * only reflect full-data majors — that's the only place every stroker's
 * entry and every paid position is known, not just the winner's.
 * Shared by the History page's Stroker leaderboard and the Home page's
 * "Best Brain" (highest ROI) pool record, so the number can't drift
 * between the two places it's shown.
 */
export function getStrokerRows(majors, allTournaments) {
  const legacy = new Map(); // name -> { wins, moneyWon, podiumOnly, podiumFinishes } — from summary-only majors
  const full = new Map();   // name -> { entries, feesPaid, winsFull, podiumOnly, moneyFull, oddsSum, oddsCount, podiumFinishes }

  function legacyRec(name) {
    const rec = legacy.get(name) || { wins: 0, moneyWon: 0, podiumOnly: 0, podiumFinishes: [], allPaidFinishes: [] };
    legacy.set(name, rec);
    return rec;
  }

  for (const m of majors) {
    if (m.fullData) continue;
    const winnerNames = (m.winner || '').split(' & ').map((s) => s.trim()).filter(Boolean);
    if (winnerNames.length && m.prize != null) {
      const share = m.prize / winnerNames.length;
      const rankLabel = winnerNames.length > 1 ? 'T1st' : '1st';
      for (const w of winnerNames) {
        const rec = legacyRec(w);
        rec.wins += 1;
        rec.moneyWon += share;
        rec.allPaidFinishes.push({
          major: m.name, date: m.date, eventType: m.eventType,
          rank: rankLabel, payout: share, points: m.points ?? null,
        });
      }
    }

    // Non-winner paid places from a multi-place summary backfill (e.g. a
    // payout-only import that has 2nd/3rd place money but no full
    // entries/leaderboard) — same "paid, no win" bucket full-data majors
    // feed via their own podiumFinishes below.
    if (m.summaryPayouts?.length) {
      const groups = groupSummaryPayouts(m.summaryPayouts);
      const winnerPlace = groups[0]?.place;
      for (const g of groups) {
        if (g.place === winnerPlace) continue;
        for (const p of g.entries) {
          const rec = legacyRec(p.name);
          rec.moneyWon += p.prize;
          rec.podiumOnly += 1;
          const finish = {
            major: m.name, date: m.date, eventType: m.eventType,
            rank: g.rankLabel, payout: p.prize, points: null,
          };
          rec.podiumFinishes.push(finish);
          rec.allPaidFinishes.push(finish);
        }
      }
    }
  }

  for (const t of allTournaments) {
    if (t.status !== 'completed') continue;
    const tGolfers = storage.get(keys.golfers(t.id)) || [];
    const tEntries = storage.get(keys.entries(t.id)) || [];
    if (!tEntries.length) continue;
    const golferLookup = new Map(tGolfers.map((g) => [g.id, g]));
    const major = majors.find((m) => m.id === t.id);
    if (!major) continue;

    for (const e of tEntries) {
      const rec = full.get(e.name) || { entries: 0, feesPaid: 0, winsFull: 0, podiumOnly: 0, moneyFull: 0, oddsSum: 0, oddsCount: 0, podiumFinishes: [], allFinishes: [] };
      rec.entries += 1;
      rec.feesPaid += t.entryFee || 0;
      full.set(e.name, rec);
      for (const gid of e.golferIds || []) {
        const g = golferLookup.get(gid);
        if (!g) continue;
        const oddsNum = oddsToNum(g.odds);
        if (oddsNum >= 0) {
          rec.oddsSum += oddsNum;
          rec.oddsCount += 1;
        }
      }
    }

    for (const r of major.ranked || []) {
      const rec = full.get(r.entry.name);
      if (!rec) continue;
      const payout = major.payouts.get(r.entry.id) || 0;
      rec.allFinishes.push({
        major: major.name,
        date: major.date,
        eventType: major.eventType,
        rank: formatRank(r.rank, major.ranked),
        payout,
        points: r.total,
      });
      if (payout <= 0) continue;
      rec.moneyFull += payout;
      if (r.rank === 1) {
        rec.winsFull += 1;
      } else {
        rec.podiumOnly += 1;
        rec.podiumFinishes.push({
          major: major.name,
          date: major.date,
          eventType: major.eventType,
          rank: formatRank(r.rank, major.ranked),
          payout,
          points: r.total,
        });
      }
    }
  }

  const names = new Set([...legacy.keys(), ...full.keys()]);
  return [...names].map((name) => {
    const l = legacy.get(name) || { wins: 0, moneyWon: 0, podiumOnly: 0, podiumFinishes: [], allPaidFinishes: [] };
    const f = full.get(name);
    // ROI = (gain - cost) / cost — net return, not the raw payout multiple.
    const roi = f && f.feesPaid > 0 ? (f.moneyFull - f.feesPaid) / f.feesPaid : null;
    const avgPickOdds = f && f.oddsCount > 0 ? f.oddsSum / f.oddsCount : null;
    const hasPodiumData = !!f || l.podiumOnly > 0;
    return {
      name,
      wins: l.wins + (f?.winsFull || 0),
      moneyWon: l.moneyWon + (f?.moneyFull || 0),
      podiumOnly: hasPodiumData ? (f?.podiumOnly || 0) + l.podiumOnly : null,
      podiumFinishes: [...(f?.podiumFinishes || []), ...l.podiumFinishes],
      allFinishes: f ? f.allFinishes : [],
      allPaidFinishes: [...(f ? f.allFinishes.filter((x) => x.payout > 0) : []), ...l.allPaidFinishes],
      entries: f ? f.entries : null,
      feesPaid: f ? f.feesPaid : null,
      roi,
      avgPickOdds,
    };
  });
}

/** Stroker(s) with the highest ROI, among those with at least one full-data entry. Null if nobody qualifies. */
export function getBestROI(strokerRows) {
  const withRoi = strokerRows.filter((r) => r.roi != null && r.entries > 0);
  if (!withRoi.length) return null;
  const max = Math.max(...withRoi.map((r) => r.roi));
  const leaders = withRoi.filter((r) => r.roi === max);
  return { rows: leaders, roi: max };
}

/**
 * Stroker(s) with the most NET $ winnings, all-time — money won minus entry
 * fees paid, not the raw gross payout total (that's easy to confuse with
 * actual profit when someone's entered a ton of times). Fees are only
 * tracked for full-data majors, so a stroker with no full-data entries on
 * record falls back to gross (there's nothing to subtract). Null if nobody's
 * ever netted positive.
 */
export function getMoneyBags(strokerRows) {
  const withNet = strokerRows
    .map((r) => ({ ...r, net: r.moneyWon - (r.feesPaid || 0) }))
    .filter((r) => r.net > 0);
  if (!withNet.length) return null;
  const max = Math.max(...withNet.map((r) => r.net));
  const leaders = withNet.filter((r) => r.net === max);
  return { rows: leaders, net: max };
}

// Fixed display order so the emoji string reads the same for everyone
// regardless of the order they actually won things in.
const TROPHY_ORDER = ['players', 'masters', 'pga', 'us_open', 'open', 'wm_open'];

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
