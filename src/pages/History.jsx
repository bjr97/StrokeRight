import React, { useMemo, useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, XAxis, YAxis } from 'recharts';
import { storage, keys, listTournaments } from '../lib/storage.js';
import { buildMajors, getStrokerWins, trophyCaseEmojis, formatRank, getStrokerRows, groupSummaryPayouts, buildRecapStoryContext } from '../lib/majors.js';
import { buildMatchLeaderboard, highRoller, untouchable, biggestRivalry, getPlayerMatches } from '../lib/matchStats.js';
import { scoreGolfer } from '../lib/scoring.js';
import { fmtMoney as fm } from '../lib/payouts.js';
import { fmtDate } from '../lib/format.js';
import { oddsToNum } from '../lib/odds.js';
import { Card, Button, Input, Select, Pill, TierDot, StatusBadge, fmtToPar, confirmAsync, alertAsync, TrophyCase, TrophyCaseModal } from '../components/ui.jsx';
import { EVENT_TYPES, eventTypeLabel, autoTournamentName } from '../lib/eventTypes.js';

const TABS = [
  { key: 'majors', label: 'Past majors' },
  { key: 'strokers', label: 'Stroker leaderboard' },
  { key: 'onevone', label: '1v1 Leaderboard' },
  { key: 'golfers', label: 'Golfer trends' },
  { key: 'fun', label: 'Fun stats' },
];

export default function History({ session, refreshAll }) {
  const [tab, setTab] = useState('majors');
  const [strokerFilter, setStrokerFilter] = useState('');
  const [gSort, setGSort] = useState({ key: 'moneyWon', dir: -1 });
  const [mSort, setMSort] = useState({ key: 'wins', dir: -1 });
  const [expandedId, setExpandedId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [trophyFor, setTrophyFor] = useState(null);
  const [podiumFor, setPodiumFor] = useState(null); // { name, finishes } or null
  const [moneyWonFor, setMoneyWonFor] = useState(null); // { name, finishes, total } or null
  const [golferWinDetail, setGolferWinDetail] = useState(null); // { name, tier, details } or null
  const [pickPieFor, setPickPieFor] = useState(null); // golfer name, or null

  const strokerWins = getStrokerWins(); // cheap; always fresh (unaffected by History's own filters — a trophy case is a fixed fact)
  const [eventTypeFilter, setEventTypeFilter] = useState('all');
  const [yearFilter, setYearFilter] = useState('all');

  const history = storage.get(keys.history) || [];
  const allTournaments = listTournaments();

  // "Full data" = a completed tournament that still has its entries/golfers
  // rows around, so standings can be recomputed live (always reflects the
  // latest scores, even if corrected after completion).
  // "Summary only" = a `history` row with no matching tournament left — the
  // legacy/manually-entered case where only the winner was ever recorded.
  // (Shared with the Home page's recent-majors section — see lib/majors.js.)
  const allMajors = useMemo(() => buildMajors(), [allTournaments, history]);
  const matchRows = useMemo(() => buildMatchLeaderboard(), [allTournaments]);
  const sortedMatchRows = useMemo(() => {
    const list = [...matchRows];
    list.sort((a, b) => {
      const av = a[mSort.key], bv = b[mSort.key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') return av.localeCompare(bv) * mSort.dir;
      return (av - bv) * mSort.dir;
    });
    return list;
  }, [matchRows, mSort]);
  function toggleMSort(key) {
    setMSort((s) => (s.key === key ? { key, dir: s.dir * -1 } : { key, dir: -1 }));
  }

  const availableYears = useMemo(() => {
    const years = new Set(allMajors.map((m) => (m.date || '').slice(0, 4)).filter(Boolean));
    return [...years].sort((a, b) => b.localeCompare(a));
  }, [allMajors]);

  // Filtering happens once, here, on the base list — every tab (Stroker
  // leaderboard, Golfer trends, Fun stats, Payouts) derives from this same
  // `majors` array, so picking an event type / year filters everything at
  // once rather than needing separate logic per tab.
  const majors = useMemo(() => {
    return allMajors
      .filter((m) => {
        if (eventTypeFilter !== 'all' && (m.eventType || 'other') !== eventTypeFilter) return false;
        if (yearFilter !== 'all' && (m.date || '').slice(0, 4) !== yearFilter) return false;
        return true;
      })
      .map((m) => ({ ...m, recap: storage.get(keys.recap(m.id))?.final || null }));
  }, [allMajors, eventTypeFilter, yearFilter]);

  const sortedMajors = useMemo(() => {
    const list = majors.filter((m) => {
      if (!strokerFilter) return true;
      return (m.winner || '').split(' & ').map((s) => s.trim()).includes(strokerFilter);
    });
    list.sort((a, b) => new Date(b.date) - new Date(a.date));
    return list;
  }, [majors, strokerFilter]);

  // ─── Stroker + golfer aggregation ────────────────────────────────────────
  // Wins & $ won: across every major (full data or summary) — and for
  // full-data majors, $ won includes money from paid non-winning finishes
  // too (e.g. a 2nd place that cashed a payout without winning outright).
  // Entries / $ spent / ROI / podiums / golfer picks: only from full-data
  // majors — that's the only place we know every stroker's entry and every
  // paid position, not just the winner's.
  const { strokerRows, golferRows, longestShot, totalPicksLogged, winningestGolfers, cumulativeScoreRows, golferCutTally, biggestFavoriteToMissCut, golferHistory, picksLoggedLog, strokerPickCounts, golferPickLog } = useMemo(() => {
    const strokerRows = getStrokerRows(majors, allTournaments);

    const golferCounts = new Map();
    const golferWinCounts = new Map();  // name -> { count, tier, details: [] } — winning-team appearances
    const golferScoreSum = new Map();   // name -> { sum, majorsCount, tier } — our fantasy points, once per event
    const golferCutTally = new Map();   // name -> { madeCut, missedCut, tier } — once per event, like golferScoreSum
    const golferHistory = new Map();    // name -> [{ major, status, points, tier, odds }] — every event picked in
    const strokerPickCounts = new Map(); // strokerName -> Map<golferName, { count, tier, details: [] }> — for Pick Breakdown
    const golferPickLog = new Map(); // golferName -> [{ major, strokerName, entryNum, odds, tier, points, status }] — every pick of this golfer, for the "Most picked golfers" drill-down
    let longestShot = null; // { name, odds, oddsNum, strokerName, major, points, status } — worst odds ever actually picked
    let biggestFavoriteToMissCut = null; // { name, odds, oddsNum, major } — shortest odds among picks that still missed the cut
    let totalPicksLogged = 0;
    const picksLoggedLog = []; // [{ major, count }] — picks logged per major, for the "total picks" drill-down

    for (const t of allTournaments) {
      if (t.status !== 'completed') continue;
      const tGolfers = storage.get(keys.golfers(t.id)) || [];
      const tEntries = storage.get(keys.entries(t.id)) || [];
      if (!tEntries.length) continue;
      const golferLookup = new Map(tGolfers.map((g) => [g.id, g]));
      const major = majors.find((m) => m.id === t.id);
      if (!major) continue;
      const scoreOpts = {
        tieredPenaltyEnabled: t.tieredPenaltyEnabled,
        cutLine: t.cutLine,
        currentRound: t.currentRound,
        cutBonusPoints: t.cutBonusPoints,
      };

      let picksThisMajor = 0;
      for (const e of tEntries) {
        const strokerMap = strokerPickCounts.get(e.name) || new Map();
        for (const gid of e.golferIds || []) {
          const g = golferLookup.get(gid);
          if (!g) continue;
          totalPicksLogged += 1;
          picksThisMajor += 1;
          const points = scoreGolfer(g, scoreOpts).points;
          const grec = golferCounts.get(g.name) || { count: 0, tier: g.tier };
          grec.count += 1;
          grec.tier = g.tier;
          golferCounts.set(g.name, grec);
          const oddsNum = oddsToNum(g.odds);
          if (oddsNum >= 0 && (!longestShot || oddsNum > longestShot.oddsNum)) {
            longestShot = { name: g.name, odds: g.odds, oddsNum, strokerName: e.name, major, points, status: g.status };
          }

          const prec = strokerMap.get(g.name) || { count: 0, tier: g.tier, details: [] };
          prec.count += 1;
          prec.tier = g.tier;
          prec.details.push({ major, entryNum: e.entryNum, odds: g.odds, tier: g.tier, points, status: g.status });
          strokerMap.set(g.name, prec);

          const glog = golferPickLog.get(g.name) || [];
          glog.push({ major, strokerName: e.name, entryNum: e.entryNum, odds: g.odds, tier: g.tier, points, status: g.status });
          golferPickLog.set(g.name, glog);
        }
        if (strokerMap.size) strokerPickCounts.set(e.name, strokerMap);
      }
      if (picksThisMajor > 0) picksLoggedLog.push({ major, count: picksThisMajor });

      // Winning-team golfer appearances — once per major, not per entry, so
      // a golfer picked by both halves of a tie only counts once for that event.
      if (major.ranked?.length) {
        const topRank = major.ranked[0].rank;
        const seenThisMajor = new Set();
        for (const r of major.ranked) {
          if (r.rank !== topRank) continue;
          for (const s of r.scored) {
            if (seenThisMajor.has(s.golfer.name)) continue;
            seenThisMajor.add(s.golfer.name);
            const wrec = golferWinCounts.get(s.golfer.name) || { count: 0, tier: s.golfer.tier, details: [] };
            wrec.count += 1;
            wrec.tier = s.golfer.tier;
            wrec.details.push({
              major, strokerName: r.entry.name, points: s.points, teamTotal: r.total,
              odds: s.golfer.odds, tier: s.golfer.tier,
            });
            golferWinCounts.set(s.golfer.name, wrec);
          }
        }
      }

      // Cumulative fantasy score — each golfer's points under our own scoring
      // rules (scoreGolfer: cut bonus/penalty, tiered penalty, winner bonus)
      // for this event, added once regardless of how many entries drafted
      // them — it's the golfer's own scoring line, not the pool's total.
      const pickedIdsThisMajor = new Set();
      for (const e of tEntries) for (const gid of e.golferIds || []) pickedIdsThisMajor.add(gid);
      for (const gid of pickedIdsThisMajor) {
        const g = golferLookup.get(gid);
        if (!g) continue;
        const points = scoreGolfer(g, scoreOpts).points;
        const srec = golferScoreSum.get(g.name) || { sum: 0, majorsCount: 0, tier: g.tier };
        srec.sum += points;
        srec.majorsCount += 1;
        srec.tier = g.tier;
        golferScoreSum.set(g.name, srec);

        const hrec = golferHistory.get(g.name) || [];
        hrec.push({ major, status: g.status, points, tier: g.tier, odds: g.odds });
        golferHistory.set(g.name, hrec);

        // Cut tally + "biggest favorite to miss the cut" — both keyed off
        // made_cut/missed_cut only (withdrawn/playing don't answer either
        // question), once per golfer per major regardless of pick count.
        if (g.status === 'made_cut' || g.status === 'missed_cut') {
          const crec = golferCutTally.get(g.name) || { madeCut: 0, missedCut: 0, tier: g.tier };
          if (g.status === 'made_cut') crec.madeCut += 1; else crec.missedCut += 1;
          crec.tier = g.tier;
          golferCutTally.set(g.name, crec);
        }
        if (g.status === 'missed_cut') {
          const oddsNum = oddsToNum(g.odds);
          if (oddsNum >= 0 && (!biggestFavoriteToMissCut || oddsNum < biggestFavoriteToMissCut.oddsNum)) {
            biggestFavoriteToMissCut = { name: g.name, odds: g.odds, oddsNum, major, points };
          }
        }
      }
    }

    const golferRows = [...golferCounts.entries()]
      .map(([name, r]) => ({ name, count: r.count, tier: r.tier }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 100);

    const winningestGolfers = [...golferWinCounts.entries()]
      .map(([name, r]) => ({ name, count: r.count, tier: r.tier, details: r.details }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    // Highest cumulative fantasy points first.
    const cumulativeScoreRows = [...golferScoreSum.entries()]
      .map(([name, r]) => ({ name, sum: r.sum, majorsCount: r.majorsCount, tier: r.tier }))
      .sort((a, b) => b.sum - a.sum)
      .slice(0, 15);

    return { strokerRows, golferRows, longestShot, totalPicksLogged, winningestGolfers, cumulativeScoreRows, golferCutTally, biggestFavoriteToMissCut, golferHistory, picksLoggedLog, strokerPickCounts, golferPickLog };
  }, [majors, allTournaments]);

  const sortedStrokers = useMemo(() => {
    const list = [...strokerRows];
    list.sort((a, b) => {
      const av = a[gSort.key], bv = b[gSort.key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') return av.localeCompare(bv) * gSort.dir;
      return (av - bv) * gSort.dir;
    });
    return list;
  }, [strokerRows, gSort]);

  function toggleGSort(key) {
    setGSort((s) => (s.key === key ? { key, dir: s.dir * -1 } : { key, dir: -1 }));
  }

  // Every stroker who shows up anywhere (majors, entries, or 1v1 matches) —
  // the shared "Stroker" filter's option list, used across Past majors,
  // Stroker leaderboard, Events & payouts, and 1v1 Leaderboard.
  const allStrokerNames = useMemo(() => {
    const names = new Set([...strokerRows.map((r) => r.name), ...matchRows.map((r) => r.name)]);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [strokerRows, matchRows]);

  const filteredStrokers = useMemo(
    () => (strokerFilter ? sortedStrokers.filter((r) => r.name === strokerFilter) : sortedStrokers),
    [sortedStrokers, strokerFilter]
  );

  const filteredMatchRows = useMemo(
    () => (strokerFilter ? sortedMatchRows.filter((r) => r.name === strokerFilter) : sortedMatchRows),
    [sortedMatchRows, strokerFilter]
  );

  // Events x payouts matrix: rows = majors (newest first), columns = every
  // stroker who's cashed a payout at least once (sorted by all-time total,
  // highest first), respecting the page's event-type/year filters like
  // everything else on this tab. Full-data majors split each entry's actual
  // payout by stroker name (summing if they had more than one entry that
  // major); summary-only majors (no tournament rows left) only ever
  // recorded the winner's prize, so every other cell in that row is $0.
  const payoutMatrix = useMemo(() => {
    const rowsByMajor = majors
      .map((m) => {
        // stroker name -> { total, items: [{ entryNum, rank, payout, scored, points }] }
        // `items` has one entry per cashing ENTRY (not per stroker) — a stroker
        // with 2 entries that both cashed shows 2 items, each with its own
        // place and team. `scored`/`points` are null for summary-only majors
        // (no per-golfer breakdown was ever recorded, just the winner's prize).
        const cells = new Map();
        function add(name, item) {
          const rec = cells.get(name) || { total: 0, items: [] };
          rec.total += item.payout;
          rec.items.push(item);
          cells.set(name, rec);
        }
        if (m.fullData && m.ranked?.length) {
          for (const r of m.ranked) {
            const payout = m.payouts.get(r.entry.id) || 0;
            if (payout <= 0) continue;
            add(r.entry.name, { entryNum: r.entry.entryNum, rankLabel: formatRank(r.rank, m.ranked), payout, scored: r.scored, points: r.total });
          }
        } else if (m.summaryPayouts?.length) {
          // Multi-place summary backfill (payout-only import) — every paid
          // place, not just the winner's.
          for (const g of groupSummaryPayouts(m.summaryPayouts)) {
            for (const p of g.entries) {
              add(p.name, { entryNum: null, rankLabel: g.rankLabel, payout: p.prize, scored: null, points: g.place === 1 ? m.points : null });
            }
          }
        } else if (m.prize != null) {
          const winnerNames = (m.winner || '').split(' & ').map((s) => s.trim()).filter(Boolean);
          if (winnerNames.length) {
            const share = m.prize / winnerNames.length;
            const rankLabel = winnerNames.length > 1 ? 'T1st' : '1st';
            for (const w of winnerNames) add(w, { entryNum: null, rankLabel, payout: share, scored: null, points: m.points });
          }
        }
        const total = [...cells.values()].reduce((a, b) => a + b.total, 0);
        return { major: m, cells, total };
      })
      .filter((row) => row.total > 0)
      .sort((a, b) => new Date(b.major.date) - new Date(a.major.date));

    const strokerTotals = new Map();
    for (const row of rowsByMajor) {
      for (const [name, rec] of row.cells) {
        strokerTotals.set(name, (strokerTotals.get(name) || 0) + rec.total);
      }
    }
    const strokers = [...strokerTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, total]) => ({ name, total }));

    const grandTotal = [...strokerTotals.values()].reduce((a, b) => a + b, 0);

    return { rows: rowsByMajor, strokers, grandTotal };
  }, [majors]);

  // Narrows the matrix to one stroker's column when the shared Stroker
  // filter is set — drops rows where they never cashed, too, so the table
  // doesn't fill up with dashes.
  const filteredPayoutMatrix = useMemo(() => {
    if (!strokerFilter) return payoutMatrix;
    const strokers = payoutMatrix.strokers.filter((s) => s.name === strokerFilter);
    const rows = payoutMatrix.rows.filter((r) => r.cells.has(strokerFilter));
    const grandTotal = strokers.reduce((a, s) => a + s.total, 0);
    return { rows, strokers, grandTotal };
  }, [payoutMatrix, strokerFilter]);

  const fun = useMemo(() => {
    if (!majors.length) return null;
    const topWins = Math.max(0, ...strokerRows.map((r) => r.wins));
    const mostWins = strokerRows.filter((r) => r.wins === topWins && topWins > 0);

    let biggestPrize = null, highestScore = null, biggestField = null, toughestTest = null, totalPaidOut = 0;
    const paidOutLog = []; // [{ major, amount }] — $ paid out per major, for the "total paid out" drill-down
    for (const m of majors) {
      if (m.prize != null && (!biggestPrize || m.prize > biggestPrize.amount)) {
        biggestPrize = { amount: m.prize, who: m.winner, major: m };
      }
      if (m.points != null && (!highestScore || m.points > highestScore.points)) {
        highestScore = { points: m.points, who: m.winner, major: m };
      }
      if (m.points != null && (!toughestTest || m.points < toughestTest.points)) {
        toughestTest = { points: m.points, who: m.winner, major: m };
      }
      if (m.entryCount != null && (!biggestField || m.entryCount > biggestField.entryCount)) {
        biggestField = { entryCount: m.entryCount, major: m };
      }
      // Total paid out: every dollar we know changed hands. Full-data majors
      // have every payout on record; summary-only majors only ever recorded
      // the winner's, so that's all we can add for those.
      let majorPaid = 0;
      if (m.fullData && m.payouts) {
        for (const amt of m.payouts.values()) majorPaid += amt;
      } else if (m.summaryPayouts?.length) {
        for (const p of m.summaryPayouts) majorPaid += p.prize;
      } else if (m.prize != null) {
        majorPaid += m.prize;
      }
      totalPaidOut += majorPaid;
      if (majorPaid > 0) paidOutLog.push({ major: m, amount: majorPaid });
    }

    const withRoi = strokerRows.filter((r) => r.roi != null && r.entries > 0);
    const bestRoi = withRoi.length ? withRoi.reduce((a, b) => (b.roi > a.roi ? b : a)) : null;
    const ironMan = strokerRows
      .filter((r) => r.entries != null)
      .reduce((a, b) => ((b.entries || 0) > (a?.entries || 0) ? b : a), null);
    const topGolfer = golferRows[0] || null;

    const bridesmaids = strokerRows.filter((r) => r.podiumOnly > 0);
    const topPodiumOnly = bridesmaids.length ? Math.max(...bridesmaids.map((r) => r.podiumOnly)) : 0;
    const bridesmaid = topPodiumOnly > 0 ? bridesmaids.filter((r) => r.podiumOnly === topPodiumOnly) : [];

    // Most entries with zero wins — the pool's most loyal non-champion.
    const ringless = strokerRows.filter((r) => r.wins === 0 && r.entries != null && r.entries > 0);
    const mostLoyal = ringless.length ? ringless.reduce((a, b) => ((b.entries || 0) > (a.entries || 0) ? b : a)) : null;

    // Nail-biter / runaway: margin between the winning score and the next
    // distinct score group, for full-data majors only (need the runner-up's
    // actual score, which summary-only majors never recorded).
    let nailBiter = null, runaway = null, cheapestCash = null;
    for (const m of majors) {
      if (!m.fullData || !m.ranked?.length) continue;

      const totals = [...new Set(m.ranked.map((r) => r.total))].sort((a, b) => b - a);
      if (totals.length >= 2) {
        const margin = totals[0] - totals[1];
        if (!nailBiter || margin < nailBiter.margin) nailBiter = { margin, major: m, winner: m.winner };
        if (!runaway || margin > runaway.margin) runaway = { margin, major: m, winner: m.winner };
      }

      // Lowest score that still cashed a payout — "backed into it."
      for (const r of m.ranked) {
        const payout = m.payouts.get(r.entry.id) || 0;
        if (payout <= 0) continue;
        if (!cheapestCash || r.total < cheapestCash.points) {
          cheapestCash = { points: r.total, who: r.entry.name, major: m, payout };
        }
      }
    }

    // All-time picking style: average odds (American, numeric) across every
    // golfer a stroker has ever drafted in full-data majors. Lowest average
    // = "chalk" (favorite-heavy), highest = "contrarian" (longshot-heavy).
    const withOdds = strokerRows.filter((r) => r.avgPickOdds != null);
    const minAvgOdds = withOdds.length ? Math.min(...withOdds.map((r) => r.avgPickOdds)) : null;
    const maxAvgOdds = withOdds.length ? Math.max(...withOdds.map((r) => r.avgPickOdds)) : null;
    const mrChalk = minAvgOdds != null ? withOdds.filter((r) => r.avgPickOdds === minAvgOdds) : [];
    const mrContrarian = maxAvgOdds != null ? withOdds.filter((r) => r.avgPickOdds === maxAvgOdds) : [];

    // Winning-team missed-cut distribution: for every winning entry (a tie
    // counts each co-winner separately, same convention used elsewhere),
    // how many of its 6 golfers missed the cut. Only full-data majors carry
    // per-golfer status, so summary-only history rows are skipped.
    // Several other winning-team stats piggyback on the same pass: whether
    // the real champion was on the roster, whether they took a down-tier
    // gambit, and (for majors with the rule on) whether they ate any tiered
    // cut-line penalty. League-wide MC average uses EVERY entry, not just
    // winners, as a baseline to compare the winners-only distribution against.
    const mcBuckets = { '0': 0, '1': 0, '2': 0, '3+': 0 };
    const mcBucketDetails = { '0': [], '1': [], '2': [], '3+': [] }; // key -> [{ major, entryName, total }]
    let mcTotal = 0;
    let calledChampionCount = 0, calledChampionTotal = 0;
    const calledChampionLog = []; // [{ major, hit }]
    let downTierGambitCount = 0, downTierGambitTotal = 0;
    const downTierGambitLog = []; // [{ major, hit }]
    let tieredPenaltyExposedCount = 0, tieredPenaltyExposedTotal = 0;
    const tieredPenaltyLog = []; // [{ major, hit }]
    let leagueMcSum = 0, leagueEntryCount = 0;
    const leagueMcLog = []; // [{ major, avg }] — per-major average MC across every entry that major
    const championTierCounts = {};
    const championTierMajors = {}; // tier -> [{ major, champion }]
    for (const m of majors) {
      if (!m.fullData || !m.ranked?.length) continue;

      if (m.championTier != null) {
        championTierCounts[m.championTier] = (championTierCounts[m.championTier] || 0) + 1;
        (championTierMajors[m.championTier] ||= []).push({ major: m, champion: m.champion });
      }

      let majorMcSum = 0;
      for (const row of m.ranked) {
        const mcHere = row.scored.filter((s) => s.golfer.status === 'missed_cut').length;
        leagueMcSum += mcHere;
        majorMcSum += mcHere;
        leagueEntryCount++;
      }
      leagueMcLog.push({ major: m, avg: m.ranked.length ? majorMcSum / m.ranked.length : 0 });

      const winningRows = m.ranked.filter((r) => r.rank === m.ranked[0].rank);
      for (const row of winningRows) {
        const mc = row.scored.filter((s) => s.golfer.status === 'missed_cut').length;
        const key = mc >= 3 ? '3+' : String(mc);
        mcBuckets[key]++;
        mcBucketDetails[key].push({ major: m, entryName: row.entry.name, total: row.total, mc });
        mcTotal++;

        if (m.champion) {
          calledChampionTotal++;
          const hit = row.scored.some((s) => s.golfer.name === m.champion);
          if (hit) calledChampionCount++;
          calledChampionLog.push({ major: m, hit });
        }

        downTierGambitTotal++;
        const gambit = row.entry.downTierSkipped > 0;
        if (gambit) downTierGambitCount++;
        downTierGambitLog.push({ major: m, hit: gambit });

        if (m.tieredPenaltyEnabled) {
          tieredPenaltyExposedTotal++;
          const exposed = row.scored.some((s) => s.breakdown.tieredPenalty < 0);
          if (exposed) tieredPenaltyExposedCount++;
          tieredPenaltyLog.push({ major: m, hit: exposed });
        }
      }
    }
    const mcDistribution = mcTotal
      ? ['0', '1', '2', '3+'].map((key) => ({
          name: `${key} MC`,
          value: mcBuckets[key],
          pct: Math.round((mcBuckets[key] / mcTotal) * 100),
        })).filter((d) => d.value > 0)
      : [];
    const calledChampionPct = calledChampionTotal ? Math.round((calledChampionCount / calledChampionTotal) * 100) : null;
    const downTierGambitPct = downTierGambitTotal ? Math.round((downTierGambitCount / downTierGambitTotal) * 100) : null;
    const tieredPenaltyExposurePct = tieredPenaltyExposedTotal ? Math.round((tieredPenaltyExposedCount / tieredPenaltyExposedTotal) * 100) : null;
    const leagueWideAvgMC = leagueEntryCount ? leagueMcSum / leagueEntryCount : null;
    const championTierDistribution = Object.keys(championTierCounts).length
      ? Object.entries(championTierCounts)
          .sort((a, b) => Number(a[0]) - Number(b[0]))
          .map(([tier, count]) => ({
            name: `Tier ${tier}`,
            value: count,
            pct: Math.round((count / Object.values(championTierCounts).reduce((a, b) => a + b, 0)) * 100),
          }))
      : [];

    // Fan favorite's real-world make-cut rate — withdrawn/playing appearances
    // don't answer made-vs-missed, so the denominator is just those two.
    const favTally = topGolfer ? golferCutTally.get(topGolfer.name) : null;
    const fanFavoriteCutRate = favTally && (favTally.madeCut + favTally.missedCut) > 0
      ? Math.round((favTally.madeCut / (favTally.madeCut + favTally.missedCut)) * 100)
      : null;

    return {
      mostWins, topWins, biggestPrize, highestScore, biggestField, bestRoi, ironMan, topGolfer,
      bridesmaid, topPodiumOnly, toughestTest, totalPaidOut, paidOutLog, mostLoyal, nailBiter, runaway,
      cheapestCash, longestShot, totalPicksLogged, picksLoggedLog, mrChalk, mrContrarian, minAvgOdds, maxAvgOdds,
      mcDistribution, mcTotal, mcBucketDetails, calledChampionCount, calledChampionTotal, calledChampionPct, calledChampionLog,
      downTierGambitPct, downTierGambitCount, downTierGambitTotal, downTierGambitLog,
      tieredPenaltyExposurePct, tieredPenaltyExposedCount, tieredPenaltyExposedTotal, tieredPenaltyLog,
      leagueWideAvgMC, leagueMcLog, championTierDistribution, championTierMajors, biggestFavoriteToMissCut, fanFavoriteCutRate,
    };
  }, [majors, strokerRows, golferRows, longestShot, totalPicksLogged, picksLoggedLog, golferCutTally, biggestFavoriteToMissCut]);

  const oneVOneFun = useMemo(() => ({
    highRoller: highRoller(),
    untouchable: untouchable(),
    rivalry: biggestRivalry(),
  }), [allTournaments]);

  // Fun Stats, scoped to one stroker (the shared Stroker filter) instead of
  // the whole pool — every "record" tile is recomputed against just their
  // own wins/picks/bets rather than the pool-wide leaderboard-topper. Tiles
  // with no per-person meaning (pool totals, pool-wide distributions, the
  // most-picked golfer overall) simply aren't included here; FunStats hides
  // those when a stroker is selected.
  const personalFun = useMemo(() => {
    if (!strokerFilter) return null;
    const row = strokerRows.find((r) => r.name === strokerFilter) || {
      name: strokerFilter, wins: 0, moneyWon: 0, podiumOnly: null, podiumFinishes: [],
      allFinishes: [], allPaidFinishes: [], entries: null, feesPaid: null, roi: null, avgPickOdds: null,
    };

    const wonMajors = majors.filter((m) => (m.winner || '').split(' & ').map((s) => s.trim()).includes(strokerFilter));

    let biggestPrize = null, highestScore = null, toughestTest = null;
    for (const m of wonMajors) {
      if (m.prize != null && (!biggestPrize || m.prize > biggestPrize.amount)) biggestPrize = { amount: m.prize, major: m };
      if (m.points != null && (!highestScore || m.points > highestScore.points)) highestScore = { points: m.points, major: m };
      if (m.points != null && (!toughestTest || m.points < toughestTest.points)) toughestTest = { points: m.points, major: m };
    }

    let nailBiter = null, runaway = null;
    for (const m of wonMajors) {
      if (!m.fullData || !m.ranked?.length) continue;
      const totals = [...new Set(m.ranked.map((r) => r.total))].sort((a, b) => b - a);
      if (totals.length >= 2) {
        const margin = totals[0] - totals[1];
        if (!nailBiter || margin < nailBiter.margin) nailBiter = { margin, major: m };
        if (!runaway || margin > runaway.margin) runaway = { margin, major: m };
      }
    }

    const paidWithPoints = row.allPaidFinishes.filter((f) => f.points != null);
    const cheapestCash = paidWithPoints.length
      ? paidWithPoints.reduce((a, b) => (b.points < a.points ? b : a))
      : null;

    let longestShot = null;
    for (const [gName, log] of golferPickLog) {
      for (const pick of log) {
        if (pick.strokerName !== strokerFilter) continue;
        const oddsNum = oddsToNum(pick.odds);
        if (oddsNum >= 0 && (!longestShot || oddsNum > longestShot.oddsNum)) {
          longestShot = { name: gName, odds: pick.odds, oddsNum, major: pick.major, points: pick.points, status: pick.status };
        }
      }
    }

    const picksLogged = [...(strokerPickCounts.get(strokerFilter)?.values() || [])].reduce((sum, r) => sum + r.count, 0);

    // Winning-team drill-downs (champion on roster / down-tier gambit /
    // tiered-penalty exposure / missed-cut distribution / champion's tier),
    // scoped to just this stroker's own winning entries rather than every
    // winning team in the pool — same shape as the pool-wide `fun` versions
    // so the pie charts can render off either source.
    let calledChampionCount = 0, calledChampionTotal = 0;
    let downTierGambitCount = 0, downTierGambitTotal = 0;
    let tieredPenaltyExposedCount = 0, tieredPenaltyExposedTotal = 0;
    const mcBuckets = { '0': 0, '1': 0, '2': 0, '3+': 0 };
    const mcBucketDetails = { '0': [], '1': [], '2': [], '3+': [] };
    let mcTotal = 0;
    const championTierCounts = {};
    const championTierMajors = {};
    for (const m of wonMajors) {
      if (!m.fullData || !m.ranked?.length) continue;
      if (m.championTier != null) {
        championTierCounts[m.championTier] = (championTierCounts[m.championTier] || 0) + 1;
        (championTierMajors[m.championTier] ||= []).push({ major: m, champion: m.champion });
      }
      const topRank = m.ranked[0].rank;
      const ownWinningRows = m.ranked.filter((r) => r.rank === topRank && r.entry.name === strokerFilter);
      for (const r of ownWinningRows) {
        const mc = r.scored.filter((s) => s.golfer.status === 'missed_cut').length;
        const key = mc >= 3 ? '3+' : String(mc);
        mcBuckets[key]++;
        mcBucketDetails[key].push({ major: m, entryName: r.entry.name, total: r.total, mc });
        mcTotal++;

        if (m.champion) {
          calledChampionTotal++;
          if (r.scored.some((s) => s.golfer.name === m.champion)) calledChampionCount++;
        }
        downTierGambitTotal++;
        if (r.entry.downTierSkipped > 0) downTierGambitCount++;
        if (m.tieredPenaltyEnabled) {
          tieredPenaltyExposedTotal++;
          if (r.scored.some((s) => s.breakdown.tieredPenalty < 0)) tieredPenaltyExposedCount++;
        }
      }
    }
    const mcDistribution = mcTotal
      ? ['0', '1', '2', '3+'].map((key) => ({
          name: `${key} MC`,
          value: mcBuckets[key],
          pct: Math.round((mcBuckets[key] / mcTotal) * 100),
        })).filter((d) => d.value > 0)
      : [];
    const championTierTotal = Object.values(championTierCounts).reduce((a, b) => a + b, 0);
    const championTierDistribution = championTierTotal
      ? Object.entries(championTierCounts)
          .sort((a, b) => Number(a[0]) - Number(b[0]))
          .map(([tier, count]) => ({ name: `Tier ${tier}`, value: count, pct: Math.round((count / championTierTotal) * 100) }))
      : [];

    return {
      row, wonMajors, biggestPrize, highestScore, toughestTest, nailBiter, runaway, cheapestCash, longestShot, picksLogged,
      calledChampionCount, calledChampionTotal,
      calledChampionPct: calledChampionTotal ? Math.round((calledChampionCount / calledChampionTotal) * 100) : null,
      downTierGambitCount, downTierGambitTotal,
      downTierGambitPct: downTierGambitTotal ? Math.round((downTierGambitCount / downTierGambitTotal) * 100) : null,
      tieredPenaltyExposedCount, tieredPenaltyExposedTotal,
      tieredPenaltyExposurePct: tieredPenaltyExposedTotal ? Math.round((tieredPenaltyExposedCount / tieredPenaltyExposedTotal) * 100) : null,
      mcDistribution, mcTotal, mcBucketDetails, championTierDistribution, championTierMajors,
      highRoller: highRoller(strokerFilter),
      untouchable: untouchable(strokerFilter),
      rivalry: biggestRivalry(strokerFilter),
    };
  }, [strokerFilter, majors, strokerRows, golferPickLog, strokerPickCounts, allTournaments]);

  function save(idx, draft) {
    const next = [...history];
    if (idx == null || idx < 0) next.unshift(draft);
    else next[idx] = draft;
    storage.set(keys.history, next);
    setEditing(null);
    refreshAll();
  }

  async function remove(idx) {
    if (idx < 0) return;
    const ok = await confirmAsync('Delete this record?', { danger: true, confirmLabel: 'Delete' });
    if (!ok) return;
    const next = history.filter((_, i) => i !== idx);
    storage.set(keys.history, next);
    refreshAll();
  }

  // For summary-only majors (payout-only backfills with no
  // tournaments/entries/golfers rows at all) — there's no finalStandings()
  // to draw on, so this builds the same storyContext by hand from just the
  // winner/date/event type/other paid places already on the record.
  async function generateSummaryRecap(m) {
    const label = m.recap ? 'Regenerate' : 'Generate';
    const ok = await confirmAsync(
      `${label} the AI recap for "${m.name}"?${m.recap ? ' This overwrites the existing recap text.' : ''}`,
      { confirmLabel: label }
    );
    if (!ok) return;

    const priorMajors = allMajors.filter((x) => x.id !== m.id);
    const winnerList = (m.winner || '').split(' & ').map((s) => s.trim()).filter(Boolean);
    const storyContext = buildRecapStoryContext(
      { eventType: m.eventType, date: m.date, winnerList },
      priorMajors
    );
    if (m.summaryPayouts?.length) {
      const groups = groupSummaryPayouts(m.summaryPayouts);
      const winnerPlace = groups[0]?.place;
      for (const g of groups) {
        if (g.place === winnerPlace) continue;
        for (const p of g.entries) storyContext.push(`${p.name} finished ${g.rankLabel} and won $${p.prize}.`);
      }
    }

    try {
      const res = await fetch('/api/generate-recap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tournamentId: m.id,
          tournamentName: m.name,
          eventTypeLabel: eventTypeLabel(m.eventType),
          course: null,
          winnerNames: m.winner,
          team: [],
          totalPoints: m.points ?? null,
          prize: m.prize,
          entryCount: m.entryCount ?? null,
          storyContext,
          runnerUp: null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      await alertAsync('Recap generated. Refresh to see it below the major.');
      refreshAll();
    } catch (err) {
      await alertAsync(`Recap generation failed: ${String(err.message || err)}`);
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-32 md:pb-6 space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Pool history</h1>
        <p className="text-xs text-muted mt-0.5">
          Every major your pool has run — standings, stroker records, and pick trends.
        </p>
      </div>

      <div
        className="sticky top-14 z-20 bg-bg/95 backdrop-blur flex flex-nowrap gap-2 border-b border-border overflow-x-auto overflow-y-hidden overscroll-x-contain"
        style={{ overflowAnchor: 'none', touchAction: 'pan-x' }}
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); if (t.key === 'golfers') setStrokerFilter(''); }}
            className={`px-3 py-2 text-sm border-b-2 -mb-px whitespace-nowrap shrink-0 ${tab === t.key ? 'border-accent text-text' : 'border-transparent text-muted'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 sm:gap-2 flex-1 min-w-0">
          <Select
            value={eventTypeFilter}
            onChange={setEventTypeFilter}
            options={[{ value: 'all', label: 'All events' }, ...EVENT_TYPES]}
            className="flex-1 min-w-0 !px-2 py-1.5 text-xs sm:text-sm overflow-hidden text-ellipsis whitespace-nowrap"
          />
          <Select
            value={yearFilter}
            onChange={setYearFilter}
            options={[{ value: 'all', label: 'All years' }, ...availableYears.map((y) => ({ value: y, label: y }))]}
            className="flex-1 min-w-0 !px-2 py-1.5 text-xs sm:text-sm overflow-hidden text-ellipsis whitespace-nowrap"
          />
          {tab !== 'golfers' && (
            <Select
              value={strokerFilter}
              onChange={setStrokerFilter}
              options={[{ value: '', label: 'All strokers' }, ...allStrokerNames.map((n) => ({ value: n, label: n }))]}
              className="flex-1 min-w-0 !px-2 py-1.5 text-xs sm:text-sm overflow-hidden text-ellipsis whitespace-nowrap"
            />
          )}
        </div>
        {(eventTypeFilter !== 'all' || yearFilter !== 'all' || strokerFilter) && (
          <button
            onClick={() => { setEventTypeFilter('all'); setYearFilter('all'); setStrokerFilter(''); }}
            className="text-xs text-muted hover:text-text underline shrink-0"
          >
            Clear filters
          </button>
        )}
      </div>

      {tab === 'majors' && (
        <div className="space-y-3">
          <div className="space-y-2">
            {sortedMajors.map((m) => (
              <MajorCard
                key={m.id}
                m={m}
                expanded={expandedId === m.id}
                onToggleExpand={() => setExpandedId(expandedId === m.id ? null : m.id)}
                isAdmin={session?.isAdmin}
                onGenerateRecap={() => generateSummaryRecap(m)}
                onEdit={() => {
                  const idx = history.findIndex((h) => h.id === m.id);
                  setEditing({ idx, draft: history[idx] });
                }}
                onDelete={() => remove(history.findIndex((h) => h.id === m.id))}
              />
            ))}
            {!sortedMajors.length && <div className="text-muted text-sm">No past majors yet.</div>}
          </div>
        </div>
      )}

      {tab === 'strokers' && (
        <div className="space-y-4">
          <StrokerTable rows={filteredStrokers} sort={gSort} onSort={toggleGSort} strokerWins={strokerWins} onOpenTrophy={setTrophyFor} onOpenPodium={setPodiumFor} onOpenMoneyWon={setMoneyWonFor} />
          <p className="text-xs text-muted">
            $ Won includes paid finishes that weren't wins (e.g. a 2nd place that cashed a payout).
            Entries / $ Spent / ROI / Paid-no-win only reflect majors with full data. ROI is net return —
            (money earned − entry fees) ÷ entry fees, within that same set — so 0% means broke even and a
            negative number means a net loss. "—" means we don't have enough data yet.
          </p>

          <div className="space-y-2">
            <div className="text-sm font-medium">Events & payouts</div>
            <PayoutMatrixTable matrix={filteredPayoutMatrix} />
            <p className="text-xs text-muted">
              Every major (rows) x every stroker who's cashed a payout at least once (columns), sorted by
              all-time total. A major with no known payout breakdown only shows the winner's cell.
            </p>
          </div>
        </div>
      )}

      {tab === 'onevone' && (
        <div className="space-y-2">
          <MatchLeaderboardTable rows={filteredMatchRows} sort={mSort} onSort={toggleMSort} />
          <p className="text-xs text-muted">
            Wins / Losses / Win % / $ Wagered / Net $ only count matches whose draft finished and whose tournament
            is fully settled. Win % excludes pushes. Proposed and Declined count every match ever recorded,
            regardless of whether it was ever played.
          </p>
        </div>
      )}

      {tab === 'golfers' && (
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="text-sm font-medium">Most picked golfers overall</div>
            <GolferBars rows={golferRows} onSelect={(g) => setPickPieFor(g.name)} maxHeight={446} />
            <p className="text-xs text-muted">Top {golferRows.length} · tap a golfer to break down who's been picking them.</p>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">Winningest golfers</div>
            <GolferBars rows={winningestGolfers} onSelect={(g) => setGolferWinDetail(g)} />
            <p className="text-xs text-muted">
              Appearances on a winning team, across majors with full data. A tie counts once for each co-winner
              who had that golfer. Tap a golfer to see every win.
            </p>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">All-time cumulative score</div>
            <GolferScoreList rows={cumulativeScoreRows} />
            <p className="text-xs text-muted">
              Each golfer's own fantasy points under our scoring rules (cut bonus/penalty, tiered penalty, winner
              bonus), added once per event they were picked in — not multiplied by how many entries drafted them.
              Higher is better.
            </p>
          </div>

          <p className="text-xs text-muted">
            Based on majors with full pick data. This gets more meaningful every time another tournament is
            marked complete.
          </p>

          <div className="space-y-2 pt-2 border-t border-border">
            <div className="text-sm font-medium">Pick breakdown</div>
            <p className="text-xs text-muted">
              One stroker's own picking patterns — pick a name to see their most-drafted golfers across every major.
            </p>
            <PickBreakdown strokerPickCounts={strokerPickCounts} strokerRows={strokerRows} session={session} />
          </div>
        </div>
      )}

      {tab === 'fun' && (
        <FunStats
          fun={fun}
          personalFun={personalFun}
          strokerFilter={strokerFilter}
          oneVOne={oneVOneFun}
          strokerRows={strokerRows}
          golferHistory={golferHistory}
          payoutMatrix={payoutMatrix}
          onOpenTrophy={setTrophyFor}
          onOpenPodium={setPodiumFor}
        />
      )}

      {editing && <EditModal record={editing} onSave={save} onCancel={() => setEditing(null)} />}
      {trophyFor && (
        <TrophyCaseModal name={trophyFor} wins={strokerWins.get(trophyFor) || []} onClose={() => setTrophyFor(null)} />
      )}
      {podiumFor && (
        <PodiumFinishesModal name={podiumFor.name} finishes={podiumFor.finishes} onClose={() => setPodiumFor(null)} />
      )}
      {moneyWonFor && (
        <RowsModal
          title={moneyWonFor.name}
          subtitle={`${fm(moneyWonFor.total)} all-time`}
          chart={<PlaceBreakdownChart items={moneyWonFor.finishes} rankOf={(f) => f.rank} />}
          rows={[...moneyWonFor.finishes]
            .sort((a, b) => new Date(b.date) - new Date(a.date))
            .map((f, i) => ({
              key: i,
              primary: f.major,
              secondary: `${fmtDate(f.date)} · ${f.rank}`,
              value: fm(f.payout),
            }))}
          onClose={() => setMoneyWonFor(null)}
        />
      )}
      {golferWinDetail && (
        <RowsModal
          title={
            <span className="flex items-center gap-1.5">
              <TierDot tier={golferWinDetail.tier} />{golferWinDetail.name}
            </span>
          }
          subtitle={`${golferWinDetail.details.length} winning-team appearance${golferWinDetail.details.length === 1 ? '' : 's'}`}
          rows={[...golferWinDetail.details]
            .sort((a, b) => new Date(b.major.date) - new Date(a.major.date))
            .map((d, i) => ({
              key: i,
              primary: d.major.name,
              secondary: `${d.strokerName}'s team · ${d.odds} odds · Tier ${d.tier}`,
              value: `${d.points >= 0 ? '+' : ''}${d.points} pts`,
            }))}
          onClose={() => setGolferWinDetail(null)}
        />
      )}
      {pickPieFor && (
        <GolferPickPieModal
          name={pickPieFor}
          log={golferPickLog.get(pickPieFor) || []}
          onClose={() => setPickPieFor(null)}
        />
      )}
    </div>
  );
}

// Generic "list of rows" popup — every row is { key, primary, secondary,
// value, valueClass }, pre-shaped by the caller. Reused across most of the
// Fun Stats drill-downs (stroker rankings, per-major logs, pie-slice
// detail, golfer appearance history) so there's one modal to get right
// instead of a dozen near-identical ones.
function RowsModal({ title, subtitle, rows, onClose, emptyText, chart }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center px-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl w-full max-w-lg p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3 gap-2">
          <div className="min-w-0">
            <div className="font-medium">{title}</div>
            {subtitle && <div className="text-xs text-muted mt-0.5">{subtitle}</div>}
          </div>
          <button onClick={onClose} className="text-muted hover:text-text text-sm px-2 shrink-0">✕</button>
        </div>
        {chart}
        {!rows?.length ? (
          <div className="text-sm text-muted">{emptyText || 'No data yet.'}</div>
        ) : (
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={r.key ?? i} className="flex items-center justify-between text-sm py-1 border-b border-border last:border-b-0 gap-3">
                <div className="min-w-0">
                  <div className="text-text truncate">{r.primary}</div>
                  {r.secondary && <div className="text-xs text-muted truncate">{r.secondary}</div>}
                </div>
                <div className={`shrink-0 tabular-nums font-medium text-right ${r.valueClass || 'text-accent'}`}>{r.value}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Tiny disambiguation popup for tied leaders (e.g. two strokers sharing
// "Most decorated") — pick a name, then the real detail modal opens for it.
function NamePickerModal({ title, names, onPick, onClose }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center px-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl w-full max-w-xs p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="font-medium">{title}</div>
          <button onClick={onClose} className="text-muted hover:text-text text-sm px-2">✕</button>
        </div>
        <div className="space-y-1">
          {names.map((n) => (
            <button key={n} onClick={() => onPick(n)} className="w-full text-left px-3 py-2 rounded-lg hover:bg-bg text-sm">
              {n}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function PodiumFinishesModal({ name, finishes, title, emptyText, onClose }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center px-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl w-full max-w-sm p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="font-medium">{title || `${name} — paid, no win`}</div>
          <button onClick={onClose} className="text-muted hover:text-text text-sm px-2">✕</button>
        </div>
        {!finishes?.length ? (
          <div className="text-sm text-muted">{emptyText || 'No paid-no-win finishes yet.'}</div>
        ) : (
          <div className="space-y-2">
            <PlaceBreakdownChart items={finishes} rankOf={(f) => f.rank} />
            {finishes.map((f, i) => (
              <div key={i} className="flex items-center justify-between text-sm py-1 border-b border-border last:border-b-0">
                <div className="min-w-0">
                  <div className="text-text truncate">{f.major}</div>
                  <div className="text-xs text-muted">{fmtDate(f.date)} · {f.rank}{f.points != null ? ` · ${f.points >= 0 ? '+' : ''}${f.points} pts` : ''}</div>
                </div>
                <div className="text-accent font-medium tabular-nums shrink-0 ml-3">{fm(f.payout)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MajorCard({ m, expanded, onToggleExpand, isAdmin, onGenerateRecap, onEdit, onDelete }) {
  const [expandedEntryId, setExpandedEntryId] = useState(null);
  const [recapOpen, setRecapOpen] = useState(true);
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium truncate">{m.name}</div>
          <div className="text-xs text-muted mt-0.5">{fmtDate(m.date)} · {m.entryCount ?? '—'} entries</div>
        </div>
        <div className="flex gap-1 shrink-0">
          <Pill color="gray">{eventTypeLabel(m.eventType)}</Pill>
          <Pill color={m.fullData ? 'green' : 'gray'}>{m.fullData ? 'Full data' : 'Summary only'}</Pill>
        </div>
      </div>

      <div className="text-xs text-muted mt-2">
        Winner: <span className="text-text">{m.winner}</span>
        {m.points != null && <> · {m.points >= 0 ? '+' : ''}{m.points} pts</>}
        {' · '}<span className="text-accent">{fm(m.prize)}</span>
      </div>
      <div className="text-xs text-muted mt-1">{(m.team || []).join(', ')}</div>

      {m.fullData && !!m.ranked?.length && (
        <button onClick={onToggleExpand} className="text-xs text-accent mt-2">
          {expanded ? '▴ Hide' : '▾ View'} all {m.entryCount} entries
        </button>
      )}
      {m.recap && (
        <div className="mt-2 pt-2 border-t border-border">
          <button onClick={() => setRecapOpen((o) => !o)} className="text-xs text-accent">
            {recapOpen ? '▴ Hide' : '▾ View'} recap
          </button>
          {recapOpen && <div className="text-xs text-muted mt-1 italic">{m.recap}</div>}
        </div>
      )}
      {m.fullData && expanded && (
        <div className="mt-2 pt-2 border-t border-border space-y-1">
          {m.ranked.map((r) => {
            const payout = m.payouts.get(r.entry.id);
            const isOpen = expandedEntryId === r.entry.id;
            return (
              <div key={r.entry.id}>
                <button
                  onClick={() => setExpandedEntryId(isOpen ? null : r.entry.id)}
                  className="w-full flex items-center justify-between text-xs py-0.5 hover:bg-bg rounded"
                >
                  <span><span className="text-muted inline-block w-5">{r.rank}.</span>{r.entry.name}</span>
                  <span className="tabular-nums">
                    {r.total >= 0 ? '+' : ''}{r.total} pts
                    {payout > 0 && <span className="text-accent ml-2">{fm(payout)}</span>}
                  </span>
                </button>
                {isOpen && (
                  <div className="pl-5 py-1 space-y-1">
                    {r.scored.map((s) => (
                      <div key={s.golfer.id} className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5">
                          <TierDot tier={s.golfer.tier} />
                          <span>{s.golfer.name}</span>
                          <span className="text-muted tabular-nums">{fmtToPar(s.golfer.strokesToPar)}</span>
                          <StatusBadge status={s.golfer.status} won={s.golfer.won} />
                        </span>
                        <span className={`tabular-nums ${s.points >= 0 ? 'text-accent' : 'text-danger'}`}>
                          {s.points >= 0 ? `+${s.points}` : s.points}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!m.fullData && isAdmin && (
        <div className="mt-2 flex gap-2 justify-end">
          <button onClick={onGenerateRecap} className="text-xs text-accent">{m.recap ? 'regenerate recap' : 'generate recap'}</button>
          <button onClick={onEdit} className="text-xs text-muted hover:text-text">edit</button>
          <button onClick={onDelete} className="text-xs text-danger">del</button>
        </div>
      )}
    </Card>
  );
}

function StrokerTable({ rows, sort, onSort, strokerWins, onOpenTrophy, onOpenPodium, onOpenMoneyWon }) {
  const cols = [
    { key: 'name', label: 'Stroker', left: true },
    { key: 'wins', label: 'Wins' },
    { key: 'podiumOnly', label: 'Paid, no win' },
    { key: 'moneyWon', label: '$ Won' },
    { key: 'entries', label: 'Entries' },
    { key: 'feesPaid', label: '$ Spent' },
    { key: 'roi', label: 'ROI' },
  ];
  return (
    <Card className="p-2 sm:p-3 overflow-x-auto">
      <table className="w-full text-xs sm:text-sm">
        <thead>
          <tr>
            {cols.map((c) => (
              <th
                key={c.key}
                onClick={() => onSort(c.key)}
                className={`text-[9px] sm:text-[11px] uppercase tracking-wide text-muted leading-tight align-bottom pb-1.5 px-0.5 sm:px-1.5 cursor-pointer select-none ${c.left ? 'text-left' : 'text-right'} ${sort.key === c.key ? 'text-accent' : ''}`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-t border-border">
              <td className="py-1.5 sm:py-2 px-0.5 sm:px-1.5 whitespace-nowrap">
                <div>{r.name}</div>
                <TrophyCase emojis={trophyCaseEmojis(strokerWins.get(r.name))} onClick={() => onOpenTrophy(r.name)} />
              </td>
              <td className="py-1.5 sm:py-2 px-0.5 sm:px-1.5 text-right tabular-nums">
                {r.wins > 0 ? (
                  <button
                    onClick={() => onOpenTrophy(r.name)}
                    className="underline decoration-dotted underline-offset-2 hover:opacity-80"
                  >
                    {r.wins}
                  </button>
                ) : r.wins}
              </td>
              <td className="py-1.5 sm:py-2 px-0.5 sm:px-1.5 text-right tabular-nums text-warn">
                {r.podiumOnly > 0 ? (
                  <button
                    onClick={() => onOpenPodium({ name: r.name, finishes: r.podiumFinishes })}
                    className="underline decoration-dotted underline-offset-2 hover:opacity-80"
                  >
                    {r.podiumOnly}
                  </button>
                ) : (r.podiumOnly ?? '—')}
              </td>
              <td className="py-1.5 sm:py-2 px-0.5 sm:px-1.5 text-right tabular-nums text-accent whitespace-nowrap">
                {r.moneyWon > 0 && r.allPaidFinishes?.length ? (
                  <button
                    onClick={() => onOpenMoneyWon({ name: r.name, finishes: r.allPaidFinishes, total: r.moneyWon })}
                    className="underline decoration-dotted underline-offset-2 hover:opacity-80"
                  >
                    {fm(r.moneyWon)}
                  </button>
                ) : fm(r.moneyWon)}
              </td>
              <td className="py-1.5 sm:py-2 px-0.5 sm:px-1.5 text-right tabular-nums text-muted">{r.entries ?? '—'}</td>
              <td className="py-1.5 sm:py-2 px-0.5 sm:px-1.5 text-right tabular-nums text-muted whitespace-nowrap">{r.feesPaid != null ? fm(r.feesPaid) : '—'}</td>
              <td className="py-1.5 sm:py-2 px-0.5 sm:px-1.5 text-right tabular-nums whitespace-nowrap">{r.roi != null ? `${(r.roi * 100).toFixed(0)}%` : '—'}</td>
            </tr>
          ))}
          {!rows.length && (
            <tr><td colSpan={7} className="py-4 text-center text-muted text-sm">No data yet.</td></tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}

// Short labels for this table only (it's tight on width) — everywhere else
// in the app still uses the full event-type label.
const SHORT_EVENT_LABEL = {
  masters: 'Masters',
  us_open: 'US Open',
  pga: 'PGA Champ',
  open: 'Open Champ',
  tour_championship: 'TOUR Champ',
};

// "2026 Open Championship" -> { label: "Open Champ", year: "2026" } —
// splitting these onto two lines keeps the sticky first column narrow, which
// is the whole point (frees up width for more stroker columns to show).
function splitMajorName(major) {
  const year = major.date ? major.date.slice(0, 4) : (major.name.match(/^(\d{4})/)?.[1] || '');
  const label = SHORT_EVENT_LABEL[major.eventType] || major.name.replace(/^\d{4}\s+/, '');
  return { label, year };
}

function PayoutMatrixTable({ matrix }) {
  const { rows, strokers, grandTotal } = matrix;
  const [detail, setDetail] = useState(null); // { major, strokerName, rec } or null
  const [majorSummary, setMajorSummary] = useState(null); // row or null
  const [strokerSummary, setStrokerSummary] = useState(null); // { name, total } or null
  // 'date' (default, newest first) | 'total' | a stroker name — click a
  // header to sort rows by that column's value, biggest first; click again
  // to reverse. Ties fall back to newest-first so the order stays stable.
  const [sort, setSort] = useState({ key: 'date', dir: -1 });

  function toggleSort(key) {
    setSort((s) => (s.key === key ? { key, dir: s.dir * -1 } : { key, dir: -1 }));
  }

  const sortedRows = useMemo(() => {
    const list = [...rows];
    const valueFor = (row) => {
      if (sort.key === 'date') return new Date(row.major.date).getTime();
      if (sort.key === 'total') return row.total;
      if (sort.key === 'entries') return row.major.entryCount ?? 0;
      return row.cells.get(sort.key)?.total || 0;
    };
    list.sort((a, b) => {
      const diff = (valueFor(a) - valueFor(b)) * sort.dir;
      if (diff !== 0) return diff;
      return new Date(b.major.date) - new Date(a.major.date);
    });
    return list;
  }, [rows, sort]);

  if (!rows.length || !strokers.length) {
    return <Card className="p-4 text-center text-muted text-sm">No payouts recorded yet.</Card>;
  }
  return (
    <>
      <Card className="p-2 sm:p-3 overflow-x-auto">
        <table className="text-xs sm:text-sm">
          <thead>
            <tr>
              <th
                onClick={() => toggleSort('date')}
                className={`sticky left-0 bg-card text-[9px] sm:text-[11px] uppercase tracking-wide text-muted text-left align-bottom pb-1.5 px-1.5 whitespace-nowrap cursor-pointer select-none ${sort.key === 'date' ? 'text-accent' : ''}`}
              >
                Major
              </th>
              {strokers.map((s) => (
                <th
                  key={s.name}
                  onClick={() => toggleSort(s.name)}
                  className={`text-[9px] sm:text-[11px] uppercase tracking-wide text-muted text-right align-bottom pb-1.5 px-1.5 whitespace-nowrap cursor-pointer select-none ${sort.key === s.name ? 'text-accent' : ''}`}
                >
                  {s.name}
                </th>
              ))}
              <th
                onClick={() => toggleSort('total')}
                className={`text-[9px] sm:text-[11px] uppercase tracking-wide text-right align-bottom pb-1.5 px-1.5 whitespace-nowrap border-l border-border cursor-pointer select-none ${sort.key === 'total' ? 'text-accent' : 'text-text'}`}
              >
                Total
              </th>
              <th
                onClick={() => toggleSort('entries')}
                className={`text-[9px] sm:text-[11px] uppercase tracking-wide text-muted text-right align-bottom pb-1.5 px-1.5 whitespace-nowrap border-l border-border cursor-pointer select-none ${sort.key === 'entries' ? 'text-accent' : ''}`}
              >
                Entries
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => {
              const { label, year } = splitMajorName(row.major);
              return (
                <tr key={row.major.id} className="border-t border-border">
                  <td className="sticky left-0 bg-card py-1.5 sm:py-2 px-1.5 whitespace-nowrap">
                    <div>{label}</div>
                    <div className="text-[10px] text-muted">{year}</div>
                  </td>
                  {strokers.map((s) => {
                    const rec = row.cells.get(s.name);
                    return (
                      <td key={s.name} className="py-1.5 sm:py-2 px-1.5 text-right tabular-nums whitespace-nowrap">
                        {rec ? (
                          <button
                            onClick={() => setDetail({ major: row.major, strokerName: s.name, rec })}
                            className="text-accent underline decoration-dotted underline-offset-2 hover:opacity-80"
                          >
                            {fm(rec.total)}
                          </button>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="py-1.5 sm:py-2 px-1.5 text-right tabular-nums font-medium whitespace-nowrap border-l border-border">
                    <button
                      onClick={() => setMajorSummary(row)}
                      className="underline decoration-dotted underline-offset-2 hover:opacity-80"
                    >
                      {fm(row.total)}
                    </button>
                  </td>
                  <td className="py-1.5 sm:py-2 px-1.5 text-right tabular-nums text-muted whitespace-nowrap border-l border-border">
                    {row.major.entryCount ?? '—'}
                  </td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-border">
              <td className="sticky left-0 bg-card py-1.5 sm:py-2 px-1.5 font-medium whitespace-nowrap">Total</td>
              {strokers.map((s) => (
                <td key={s.name} className="py-1.5 sm:py-2 px-1.5 text-right tabular-nums font-medium whitespace-nowrap">
                  <button
                    onClick={() => setStrokerSummary({ name: s.name, total: s.total })}
                    className="underline decoration-dotted underline-offset-2 hover:opacity-80"
                  >
                    {fm(s.total)}
                  </button>
                </td>
              ))}
              <td className="py-1.5 sm:py-2 px-1.5 text-right tabular-nums font-semibold whitespace-nowrap border-l border-border">
                {fm(grandTotal)}
              </td>
              <td className="py-1.5 sm:py-2 px-1.5 text-right tabular-nums font-semibold whitespace-nowrap border-l border-border">
                {rows.reduce((a, r) => a + (r.major.entryCount || 0), 0)}
              </td>
            </tr>
          </tbody>
        </table>
      </Card>

      {detail && (
        <PayoutDetailModal
          major={detail.major}
          strokerName={detail.strokerName}
          rec={detail.rec}
          onClose={() => setDetail(null)}
        />
      )}
      {majorSummary && (
        <MajorSummaryModal major={majorSummary.major} row={majorSummary} onClose={() => setMajorSummary(null)} />
      )}
      {strokerSummary && (
        <StrokerSummaryModal
          strokerName={strokerSummary.name}
          rows={rows}
          total={strokerSummary.total}
          onClose={() => setStrokerSummary(null)}
        />
      )}
    </>
  );
}

// Row-total click: every stroker who cashed in this one major, place + payout.
function MajorSummaryModal({ major, row, onClose }) {
  const flat = [...row.cells.entries()]
    .flatMap(([name, rec]) => rec.items.map((item) => ({ name, ...item })))
    .sort((a, b) => b.payout - a.payout);
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center px-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="font-medium">{major.name}</div>
          <button onClick={onClose} className="text-muted hover:text-text text-sm px-2">✕</button>
        </div>
        <div className="space-y-2">
          {flat.map((item, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <span>
                <span className="font-medium">{item.rankLabel}</span>
                <span className="text-muted"> {item.name}</span>
                {item.points != null && (
                  <span className="text-muted text-xs"> · {item.points >= 0 ? '+' : ''}{item.points} pts</span>
                )}
              </span>
              <span className="text-accent font-medium tabular-nums">{fm(item.payout)}</span>
            </div>
          ))}
        </div>
        <div className="text-xs text-muted mt-3 pt-3 border-t border-border">
          Total paid out: <span className="text-text font-medium">{fm(row.total)}</span>
        </div>
      </div>
    </div>
  );
}

// Column-total click: every major a stroker has cashed in, place + payout.
function StrokerSummaryModal({ strokerName, rows, total, onClose }) {
  const flat = rows
    .filter((row) => row.cells.has(strokerName))
    .flatMap((row) => row.cells.get(strokerName).items.map((item) => ({ major: row.major, ...item })))
    .sort((a, b) => new Date(b.major.date) - new Date(a.major.date));
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center px-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl w-full max-w-sm p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="font-medium">{strokerName}</div>
          <button onClick={onClose} className="text-muted hover:text-text text-sm px-2">✕</button>
        </div>
        <PlaceBreakdownChart items={flat} rankOf={(item) => item.rankLabel} />
        <div className="space-y-2">
          {flat.map((item, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <span>
                <span className="font-medium">{item.rankLabel}</span>
                <span className="text-muted"> {item.major.name}</span>
                {item.points != null && (
                  <span className="text-muted text-xs"> · {item.points >= 0 ? '+' : ''}{item.points} pts</span>
                )}
              </span>
              <span className="text-accent font-medium tabular-nums">{fm(item.payout)}</span>
            </div>
          ))}
        </div>
        <div className="text-xs text-muted mt-3 pt-3 border-t border-border">
          All-time total: <span className="text-text font-medium">{fm(total)}</span>
        </div>
      </div>
    </div>
  );
}

function PayoutDetailModal({ major, strokerName, rec, onClose }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center px-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="font-medium">{strokerName}</div>
            <div className="text-xs text-muted">{major.name}</div>
          </div>
          <button onClick={onClose} className="text-muted hover:text-text text-sm px-2">✕</button>
        </div>
        <div className="space-y-4">
          {rec.items.map((item, i) => (
            <div key={i} className={i > 0 ? 'pt-3 border-t border-border' : ''}>
              <div className="flex items-center justify-between text-sm mb-2">
                <span>
                  <span className="font-medium">{item.rankLabel}</span>
                  {item.entryNum != null && <span className="text-muted text-xs"> · Entry {item.entryNum}</span>}
                  {item.points != null && (
                    <span className="text-muted text-xs"> · {item.points >= 0 ? '+' : ''}{item.points} pts</span>
                  )}
                </span>
                <span className="text-accent font-medium tabular-nums">{fm(item.payout)}</span>
              </div>
              {item.scored ? (
                <div className="space-y-1">
                  {item.scored.map((s) => (
                    <div key={s.golfer.id} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5">
                        <TierDot tier={s.golfer.tier} />
                        <span>{s.golfer.name}</span>
                        <span className="text-muted tabular-nums">{fmtToPar(s.golfer.strokesToPar)}</span>
                        <StatusBadge status={s.golfer.status} won={s.golfer.won} />
                      </span>
                      <span className={`tabular-nums ${s.points >= 0 ? 'text-accent' : 'text-danger'}`}>
                        {s.points >= 0 ? `+${s.points}` : s.points}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-muted">Team details not available for this legacy record.</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MatchLeaderboardTable({ rows, sort, onSort }) {
  const [detailFor, setDetailFor] = useState(null); // player name or null
  const cols = [
    { key: 'name', label: 'Player', left: true },
    { key: 'wins', label: 'Wins' },
    { key: 'losses', label: 'Losses' },
    { key: 'winPct', label: 'Win %' },
    { key: 'proposed', label: 'Proposed' },
    { key: 'declined', label: 'Declined' },
    { key: 'wagered', label: '$ Wagered' },
    { key: 'net', label: 'Net $' },
  ];
  return (
    <>
      <Card className="p-2 sm:p-3 overflow-x-auto">
        <table className="w-full text-xs sm:text-sm">
          <thead>
            <tr>
              {cols.map((c) => (
                <th
                  key={c.key}
                  onClick={() => onSort(c.key)}
                  className={`text-[9px] sm:text-[11px] uppercase tracking-wide text-muted leading-tight align-bottom pb-1.5 px-0.5 sm:px-1.5 cursor-pointer select-none ${c.left ? 'text-left' : 'text-right'} ${sort.key === c.key ? 'text-accent' : ''}`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className="border-t border-border">
                <td className="py-1.5 sm:py-2 px-0.5 sm:px-1.5 whitespace-nowrap">{r.name}</td>
                <td className="py-1.5 sm:py-2 px-0.5 sm:px-1.5 text-right tabular-nums">
                  {r.wins + r.losses > 0 ? (
                    <button onClick={() => setDetailFor(r.name)} className="underline decoration-dotted underline-offset-2 hover:opacity-80">
                      {r.wins}
                    </button>
                  ) : r.wins}
                </td>
                <td className="py-1.5 sm:py-2 px-0.5 sm:px-1.5 text-right tabular-nums">
                  {r.wins + r.losses > 0 ? (
                    <button onClick={() => setDetailFor(r.name)} className="underline decoration-dotted underline-offset-2 hover:opacity-80">
                      {r.losses}
                    </button>
                  ) : r.losses}
                </td>
                <td className="py-1.5 sm:py-2 px-0.5 sm:px-1.5 text-right tabular-nums text-muted">{r.winPct != null ? `${r.winPct}%` : '—'}</td>
                <td className="py-1.5 sm:py-2 px-0.5 sm:px-1.5 text-right tabular-nums text-muted">{r.proposed}</td>
                <td className="py-1.5 sm:py-2 px-0.5 sm:px-1.5 text-right tabular-nums text-muted">{r.declined}</td>
                <td className="py-1.5 sm:py-2 px-0.5 sm:px-1.5 text-right tabular-nums whitespace-nowrap">{fm(r.wagered)}</td>
                <td className={`py-1.5 sm:py-2 px-0.5 sm:px-1.5 text-right tabular-nums whitespace-nowrap ${r.net > 0 ? 'text-accent' : r.net < 0 ? 'text-danger' : 'text-muted'}`}>
                  {r.net > 0 ? '+' : r.net < 0 ? '-' : ''}{fm(Math.abs(r.net))}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={8} className="py-4 text-center text-muted text-sm">No 1v1 matches yet.</td></tr>
            )}
          </tbody>
        </table>
      </Card>

      {detailFor && (
        <PlayerMatchesModal name={detailFor} onClose={() => setDetailFor(null)} />
      )}
    </>
  );
}

function PlayerMatchesModal({ name, onClose }) {
  const matches = useMemo(() => getPlayerMatches(name), [name]);
  return <MatchRowsModal title={`${name}'s completed 1v1 matches`} matches={matches} perspective={name} onClose={onClose} />;
}

// Generic 1v1-match list popup — reused by PlayerMatchesModal (every match
// for one player) and, in Fun Stats, by High roller (one match), Untouchable
// (one player's full match list, to show the streak), and Rivalry (just the
// matches between two specific players). `perspective` labels the "my team"
// column — every match here was fetched via getPlayerMatches() from that
// player's point of view.
function MatchRowsModal({ title, matches, perspective, onClose, emptyText }) {
  const outcomeColor = { win: 'text-accent', loss: 'text-danger', push: 'text-muted' };
  const outcomeLabel = { win: 'Win', loss: 'Loss', push: 'Push' };
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center px-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl w-full max-w-md p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="font-medium">{title}</div>
          <button onClick={onClose} className="text-muted hover:text-text text-sm px-2">✕</button>
        </div>
        {!matches.length ? (
          <div className="text-sm text-muted">{emptyText || 'No settled matches yet.'}</div>
        ) : (
          <div className="space-y-4">
            {matches.map((m, i) => (
              <div key={i} className={i > 0 ? 'pt-4 border-t border-border' : ''}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span>
                    <span className={`font-medium ${outcomeColor[m.outcome]}`}>{outcomeLabel[m.outcome]}</span>
                    <span className="text-muted"> vs {m.opponent}</span>
                  </span>
                  <span className="text-muted">{fm(m.amount)}</span>
                </div>
                <div className="text-xs text-muted mb-2">
                  {m.tournamentName} · {m.myTotal >= 0 ? '+' : ''}{m.myTotal} – {m.oppTotal >= 0 ? '+' : ''}{m.oppTotal}
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <div className="text-muted uppercase tracking-wide text-[10px] mb-1">{perspective || 'This side'}</div>
                    <div className="space-y-0.5">
                      {m.myTeam.map((g, gi) => (
                        <div key={gi} className={`flex items-center justify-between ${g.isExtra ? 'text-muted' : ''}`}>
                          <span>{g.name}{g.isExtra ? ' (extra)' : ''}</span>
                          <span className="tabular-nums">{g.points >= 0 ? `+${g.points}` : g.points}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted uppercase tracking-wide text-[10px] mb-1">{m.opponent}</div>
                    <div className="space-y-0.5">
                      {m.oppTeam.map((g, gi) => (
                        <div key={gi} className={`flex items-center justify-between ${g.isExtra ? 'text-muted' : ''}`}>
                          <span>{g.name}{g.isExtra ? ' (extra)' : ''}</span>
                          <span className="tabular-nums">{g.points >= 0 ? `+${g.points}` : g.points}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function GolferBars({ rows, onSelect, maxHeight }) {
  const max = rows[0]?.count || 1;
  const list = (
    <div className={maxHeight ? 'space-y-2 overflow-y-auto pr-1' : 'space-y-2'} style={maxHeight ? { maxHeight } : undefined}>
      {rows.map((g, i) => {
        const Wrap = onSelect ? 'button' : 'div';
        return (
          <Wrap
            key={g.name}
            onClick={onSelect ? () => onSelect(g) : undefined}
            className={`flex items-center gap-2 w-full ${onSelect ? 'hover:bg-bg rounded' : ''}`}
          >
            <span className="w-5 text-right text-xs text-muted">{i + 1}</span>
            <span className="w-32 sm:w-40 flex items-center gap-1.5 text-sm truncate">
              <TierDot tier={g.tier} />{g.name}
            </span>
            <div className="flex-1 bg-border rounded h-2 overflow-hidden">
              <div className="bg-accent h-full rounded" style={{ width: `${(g.count / max) * 100}%` }} />
            </div>
            <span className="min-w-[2rem] text-right text-xs text-muted whitespace-nowrap">{g.label ?? g.count}</span>
          </Wrap>
        );
      })}
      {!rows.length && <div className="text-muted text-sm">No full pick data yet.</div>}
    </div>
  );
  return <Card className="p-4">{list}</Card>;
}

// One stroker's own most-drafted golfers — a Map<golferName, {count, tier,
// details}> per stroker (strokerPickCounts, built in History's main
// aggregation) sliced down to the top 10 for whoever's selected. Tapping a
// golfer bar shows every major/entry that pick came from.
// Every stroker who's ever submitted an entry, name -> total entries (full-data
// majors only) — the shared denominator for "picked in X% of entries" used by
// both single and compare mode, and by the pool-average calculation.
function strokerEntryMap(strokerRows) {
  return new Map(strokerRows.filter((r) => r.entries > 0).map((r) => [r.name, r.entries]));
}

function PickBreakdown({ strokerPickCounts, strokerRows, session }) {
  const [mode, setMode] = useState('single'); // 'single' | 'compare'
  // Defaults open to the logged-in stroker (visual only — falls back to
  // blank/"Choose a stroker…" if they're not in this list, e.g. an admin
  // who's never submitted an entry).
  const [selected, setSelected] = useState(() => {
    const myNameLower = (session?.name || '').toLowerCase();
    return [...strokerPickCounts.keys()].find((n) => n.toLowerCase() === myNameLower) || '';
  });
  const [compareSelected, setCompareSelected] = useState([]); // up to 4 stroker names
  const [detail, setDetail] = useState(null); // { name, tier, details } or null
  const [compareDetail, setCompareDetail] = useState(null); // { title, subtitle, rows } or null

  const strokerNames = useMemo(
    () => [...strokerPickCounts.keys()].sort((a, b) => a.localeCompare(b)),
    [strokerPickCounts]
  );
  const entriesByStroker = useMemo(() => strokerEntryMap(strokerRows), [strokerRows]);

  // Total entries this stroker has submitted in full-data majors — the
  // denominator for "picked in X% of entries," a better read on how
  // committed a pick is than the raw count alone (10 picks means very
  // different things at 12 entries vs. 60).
  const totalEntries = entriesByStroker.get(selected) ?? null;

  const rows = useMemo(() => {
    if (!selected) return [];
    const map = strokerPickCounts.get(selected);
    if (!map) return [];
    return [...map.entries()]
      .map(([name, r]) => {
        const pct = totalEntries ? Math.round((r.count / totalEntries) * 100) : null;
        return {
          name, count: r.count, tier: r.tier, details: r.details,
          label: pct != null ? `${r.count} (${pct}%)` : r.count,
        };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [strokerPickCounts, selected, totalEntries]);

  function toggleCompare(name) {
    setCompareSelected((cur) => {
      if (cur.includes(name)) return cur.filter((n) => n !== name);
      if (cur.length >= 4) return cur;
      return [...cur, name];
    });
  }

  // Union of each selected stroker's own top-6 golfers, so nobody's favorite
  // gets dropped just because another selected stroker doesn't share it.
  // Each row gets one %-of-entries value per selected stroker plus a
  // pool-wide "avg" value (mean %-of-entries across EVERY stroker with
  // entries, not just the ones being compared — the whole-pool baseline).
  const compareData = useMemo(() => {
    if (!compareSelected.length) return [];
    const golferTiers = new Map();
    for (const strokerName of compareSelected) {
      const map = strokerPickCounts.get(strokerName);
      if (!map) continue;
      const top = [...map.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 6);
      for (const [gname, r] of top) golferTiers.set(gname, r.tier);
    }
    const pctFor = (strokerName, gname) => {
      const entries = entriesByStroker.get(strokerName);
      if (!entries) return 0;
      const count = strokerPickCounts.get(strokerName)?.get(gname)?.count || 0;
      return Math.round((count / entries) * 100);
    };
    const allStrokers = [...entriesByStroker.keys()];
    return [...golferTiers.entries()]
      .map(([gname, tier]) => {
        const row = { name: gname, tier };
        for (const strokerName of compareSelected) row[strokerName] = pctFor(strokerName, gname);
        const avgSum = allStrokers.reduce((sum, s) => sum + pctFor(s, gname), 0);
        row.avg = allStrokers.length ? Math.round(avgSum / allStrokers.length) : 0;
        row._sortKey = compareSelected.reduce((s, n) => s + row[n], 0);
        return row;
      })
      .sort((a, b) => b._sortKey - a._sortKey);
  }, [compareSelected, strokerPickCounts, entriesByStroker]);

  function openCompareStrokerDetail(strokerName, golferName) {
    const rec = strokerPickCounts.get(strokerName)?.get(golferName);
    if (!rec) return;
    const entries = entriesByStroker.get(strokerName);
    setCompareDetail({
      title: (
        <span className="flex items-center gap-1.5">
          <TierDot tier={rec.tier} />{golferName}
        </span>
      ),
      subtitle: `Picked by ${strokerName} · ${rec.details.length}×${entries ? ` · ${Math.round((rec.details.length / entries) * 100)}% of entries` : ''}`,
      rows: [...rec.details]
        .sort((a, b) => new Date(b.major.date) - new Date(a.major.date))
        .map((d, i) => ({
          key: i,
          primary: d.major.name,
          secondary: `Entry ${d.entryNum} · ${d.odds} odds · Tier ${d.tier}`,
          value: `${d.points >= 0 ? '+' : ''}${d.points} pts`,
          valueClass: d.points >= 0 ? 'text-accent' : 'text-danger',
        })),
    });
  }

  function openAvgDetail(golferName) {
    const rowsOut = [...entriesByStroker.entries()]
      .map(([strokerName, entries]) => {
        const count = strokerPickCounts.get(strokerName)?.get(golferName)?.count || 0;
        return { strokerName, count, pct: entries ? Math.round((count / entries) * 100) : 0 };
      })
      .filter((r) => r.count > 0)
      .sort((a, b) => b.pct - a.pct)
      .map((r, i) => ({
        key: i, primary: r.strokerName, secondary: `${r.count} pick${r.count === 1 ? '' : 's'}`,
        value: `${r.pct}%`, valueClass: 'text-muted',
      }));
    setCompareDetail({ title: `Pool average — ${golferName}`, subtitle: 'Every stroker who has picked them, by rate', rows: rowsOut });
  }

  return (
    <>
      <div className="flex gap-2">
        <button
          onClick={() => setMode('single')}
          className={`text-xs px-2.5 py-1.5 rounded-lg border ${mode === 'single' ? 'border-accent text-text' : 'border-border text-muted'}`}
        >
          One stroker
        </button>
        <button
          onClick={() => setMode('compare')}
          className={`text-xs px-2.5 py-1.5 rounded-lg border ${mode === 'compare' ? 'border-accent text-text' : 'border-border text-muted'}`}
        >
          Compare strokers
        </button>
      </div>

      {mode === 'single' && (
        <>
          <Select
            value={selected}
            onChange={setSelected}
            options={[{ value: '', label: 'Choose a stroker…' }, ...strokerNames.map((n) => ({ value: n, label: n }))]}
            className="w-full"
          />
          {selected && (
            <>
              <GolferBars
                rows={rows}
                onSelect={(g) => setDetail({ name: g.name, tier: g.tier, details: g.details })}
              />
              {totalEntries != null && (
                <p className="text-xs text-muted">
                  % = share of {selected}'s {totalEntries} entr{totalEntries === 1 ? 'y' : 'ies'} that included that golfer.
                </p>
              )}
            </>
          )}
          {selected && !rows.length && (
            <Card className="p-4 text-center text-muted text-sm">No full pick data for {selected} yet.</Card>
          )}
        </>
      )}

      {mode === 'compare' && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {strokerNames.map((n) => (
              <button
                key={n}
                onClick={() => toggleCompare(n)}
                disabled={!compareSelected.includes(n) && compareSelected.length >= 4}
                className={`text-xs px-2.5 py-1 rounded-full border disabled:opacity-30 disabled:cursor-not-allowed ${compareSelected.includes(n) ? 'border-accent text-text bg-accent/10' : 'border-border text-muted'}`}
              >
                {n}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted">Pick up to 4 strokers. Bars show % of that stroker's entries that included the golfer, alongside the pool-wide average.</p>

          {compareSelected.length > 0 ? (
            <Card className="p-4">
              <div style={{ width: '100%', height: Math.max(260, compareData.length * 56) }}>
                <ResponsiveContainer>
                  <BarChart data={compareData} layout="vertical" margin={{ left: 8, right: 8 }}>
                    <XAxis type="number" domain={[0, 100]} unit="%" stroke="#8B949E" fontSize={11} />
                    <YAxis type="category" dataKey="name" width={110} stroke="#8B949E" fontSize={11} />
                    <Tooltip
                      contentStyle={{ background: '#161B22', border: '1px solid #21262D', borderRadius: 8 }}
                      labelStyle={{ color: '#E6EDF3' }}
                      formatter={(value, key) => [`${value}%`, key === 'avg' ? 'Pool avg' : key]}
                    />
                    <Legend formatter={(key) => (key === 'avg' ? 'Pool avg' : key)} />
                    {compareSelected.map((strokerName, i) => (
                      <Bar
                        key={strokerName}
                        dataKey={strokerName}
                        fill={PICK_PIE_COLORS[i % PICK_PIE_COLORS.length]}
                        onClick={(data) => openCompareStrokerDetail(strokerName, data.name)}
                        style={{ cursor: 'pointer' }}
                      />
                    ))}
                    <Bar dataKey="avg" fill="#8B949E" onClick={(data) => openAvgDetail(data.name)} style={{ cursor: 'pointer' }} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          ) : (
            <Card className="p-4 text-center text-muted text-sm">Pick at least one stroker to compare.</Card>
          )}
        </>
      )}

      {detail && (
        <RowsModal
          title={
            <span className="flex items-center gap-1.5">
              <TierDot tier={detail.tier} />{detail.name}
            </span>
          }
          subtitle={`Picked by ${selected} · ${detail.details.length}×${totalEntries ? ` · ${Math.round((detail.details.length / totalEntries) * 100)}% of entries` : ''}`}
          rows={[...detail.details]
            .sort((a, b) => new Date(b.major.date) - new Date(a.major.date))
            .map((d, i) => ({
              key: i,
              primary: d.major.name,
              secondary: `Entry ${d.entryNum} · ${d.odds} odds · Tier ${d.tier}`,
              value: `${d.points >= 0 ? '+' : ''}${d.points} pts`,
              valueClass: d.points >= 0 ? 'text-accent' : 'text-danger',
            }))}
          onClose={() => setDetail(null)}
        />
      )}
      {compareDetail && (
        <RowsModal
          title={compareDetail.title}
          subtitle={compareDetail.subtitle}
          rows={compareDetail.rows}
          onClose={() => setCompareDetail(null)}
        />
      )}
    </>
  );
}

function GolferScoreList({ rows }) {
  return (
    <Card className="p-2 sm:p-3 overflow-x-auto">
      <table className="w-full text-xs sm:text-sm">
        <thead>
          <tr>
            <th className="text-[9px] sm:text-[11px] uppercase tracking-wide text-muted text-left pb-1.5 px-1.5">Golfer</th>
            <th className="text-[9px] sm:text-[11px] uppercase tracking-wide text-muted text-right pb-1.5 px-1.5">Events</th>
            <th className="text-[9px] sm:text-[11px] uppercase tracking-wide text-muted text-right pb-1.5 px-1.5">Cumulative</th>
            <th className="text-[9px] sm:text-[11px] uppercase tracking-wide text-muted text-right pb-1.5 px-1.5">Avg/Event</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((g, i) => {
            const avg = g.majorsCount ? g.sum / g.majorsCount : 0;
            return (
              <tr key={g.name} className="border-t border-border">
                <td className="py-1.5 sm:py-2 px-1.5">
                  <span className="flex items-center gap-1.5">
                    <span className="w-4 text-right text-muted">{i + 1}</span>
                    <TierDot tier={g.tier} />
                    <span className="truncate">{g.name}</span>
                  </span>
                </td>
                <td className="py-1.5 sm:py-2 px-1.5 text-right tabular-nums text-muted">{g.majorsCount}</td>
                <td className="py-1.5 sm:py-2 px-1.5 text-right tabular-nums">{g.sum >= 0 ? `+${g.sum}` : g.sum}</td>
                <td className="py-1.5 sm:py-2 px-1.5 text-right tabular-nums text-muted">{avg >= 0 ? `+${avg.toFixed(1)}` : avg.toFixed(1)}</td>
              </tr>
            );
          })}
          {!rows.length && (
            <tr><td colSpan={4} className="py-4 text-center text-muted text-sm">No full pick data yet.</td></tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}

// One brand-green scale (light -> dark, #3FB950 is the exact accent color
// used everywhere else in the app) that every pie chart draws its slice
// colors from, light to dark, instead of a mixed rainbow palette.
const GREEN_SCALE = ['#B7F5C5', '#8FE3A0', '#6EDB85', '#56D364', '#3FB950', '#2EA043', '#23863A', '#1A6E30', '#135227', '#0D3D1D'];

const MC_COLORS = [GREEN_SCALE[1], GREEN_SCALE[4], GREEN_SCALE[6], GREEN_SCALE[9]]; // 0/1/2/3+ MC, light (best) -> dark (worst)
const TIER_HEX = { 1: GREEN_SCALE[0], 2: GREEN_SCALE[2], 3: GREEN_SCALE[4], 4: GREEN_SCALE[6], 5: GREEN_SCALE[8], 6: GREEN_SCALE[9] };
const PICK_PIE_COLORS = GREEN_SCALE;
const PLACE_PIE_COLORS = [GREEN_SCALE[0], GREEN_SCALE[1], GREEN_SCALE[3], GREEN_SCALE[4], GREEN_SCALE[5], GREEN_SCALE[6], GREEN_SCALE[7], GREEN_SCALE[9]];

// Buckets a list of paid finishes by finishing place — "T3rd" and "3rd"
// both land in the same "3rd" bucket, since a tie is still that place.
// `rankOf` pulls the rank-label string off whatever item shape the caller
// has (PodiumFinishesModal's `f.rank`, StrokerSummaryModal's `item.rankLabel`, etc).
function groupByPlace(items, rankOf) {
  const buckets = new Map(); // placeNum -> { label, count, items: [] }
  for (const item of items) {
    const raw = rankOf(item);
    if (!raw) continue;
    const label = raw.replace(/^T/, '');
    const placeNum = parseInt(label, 10);
    if (!Number.isFinite(placeNum)) continue;
    const bucket = buckets.get(placeNum) || { placeNum, label, count: 0, items: [] };
    bucket.count += 1;
    bucket.items.push(item);
    buckets.set(placeNum, bucket);
  }
  return [...buckets.values()].sort((a, b) => a.placeNum - b.placeNum);
}

// Reusable stat key for a pie chart — a name + color swatch + value/pct row
// per slice, replacing on-slice labels (illegible past 4-5 thin slices) and
// recharts' own <Legend/> (name-only, no value). `onSelect`, if given, makes
// each row clickable too — same drill-down the pie slice itself opens.
function PieKey({ data, colorFor, onSelect }) {
  return (
    <div className="space-y-0.5">
      {data.map((d, i) => {
        const row = (
          <>
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: colorFor(d, i) }} />
              <span className="truncate">{d.name}</span>
            </span>
            <span className="text-muted tabular-nums shrink-0">
              {d.value}{d.pct != null ? ` (${d.pct}%)` : ''}
            </span>
          </>
        );
        return onSelect ? (
          <button
            key={d.name}
            onClick={() => onSelect(d)}
            className="w-full flex items-center justify-between text-xs py-1 px-1.5 rounded hover:bg-bg"
          >
            {row}
          </button>
        ) : (
          <div key={d.name} className="w-full flex items-center justify-between text-xs py-1 px-1.5">
            {row}
          </div>
        );
      })}
    </div>
  );
}

// Small "stat overview" pie — count of finishes by place, dropped into the
// top of a popup that already lists the finishes individually below it.
function PlaceBreakdownChart({ items, rankOf }) {
  const groups = useMemo(() => groupByPlace(items, rankOf), [items]);
  if (groups.length < 2) return null; // one place only — a pie of one slice says nothing
  const total = groups.reduce((a, g) => a + g.count, 0);
  const data = groups.map((g) => ({ name: g.label, value: g.count, pct: Math.round((g.count / total) * 100) }));
  const colorFor = (d, i) => PLACE_PIE_COLORS[i % PLACE_PIE_COLORS.length];
  return (
    <div className="mb-3">
      <div style={{ width: '100%', height: 180 }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70}>
              {data.map((d, i) => (
                <Cell key={d.name} fill={colorFor(d, i)} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ background: '#161B22', border: '1px solid #21262D', borderRadius: 8 }}
              labelStyle={{ color: '#E6EDF3' }}
              formatter={(value, name, props) => [`${value} finish${value === 1 ? '' : 'es'} (${props.payload.pct}%)`, name]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <PieKey data={data} colorFor={colorFor} />
    </div>
  );
}

// "Most picked golfers overall" drill-down: this golfer's full pick log,
// grouped by stroker / event type / year (toggle), with an optional
// stroker filter that narrows the log before grouping — so you can ask
// "how has Charles's picking of Scottie trended by year" as well as the
// pool-wide view. Clicking a slice shows the underlying picks.
function GolferPickPieModal({ name, log, onClose }) {
  const [groupBy, setGroupBy] = useState('eventType'); // 'eventType' | 'year'
  const [pieStrokerFilter, setPieStrokerFilter] = useState('');
  const [sliceDetail, setSliceDetail] = useState(null); // { label, rows } or null

  const strokerNames = useMemo(
    () => [...new Set(log.map((p) => p.strokerName))].sort((a, b) => a.localeCompare(b)),
    [log]
  );

  const filteredLog = useMemo(
    () => (pieStrokerFilter ? log.filter((p) => p.strokerName === pieStrokerFilter) : log),
    [log, pieStrokerFilter]
  );

  const keyFor = (p) => {
    if (groupBy === 'eventType') return eventTypeLabel(p.major.eventType);
    return (p.major.date || '').slice(0, 4) || 'Unknown';
  };

  const { pieData, groups } = useMemo(() => {
    const groups = new Map(); // label -> picks[]
    for (const p of filteredLog) {
      const key = keyFor(p);
      const arr = groups.get(key) || [];
      arr.push(p);
      groups.set(key, arr);
    }
    const total = filteredLog.length;
    const pieData = [...groups.entries()]
      .map(([label, picks]) => ({ name: label, value: picks.length, pct: total ? Math.round((picks.length / total) * 100) : 0 }))
      .sort((a, b) => b.value - a.value);
    return { pieData, groups };
  }, [filteredLog, groupBy]);

  function openSlice(label) {
    const picks = groups.get(label) || [];
    const rows = [...picks]
      .sort((a, b) => new Date(b.major.date) - new Date(a.major.date))
      .map((p, i) => ({
        key: i,
        primary: p.major.name,
        secondary: `${p.strokerName} · Entry ${p.entryNum} · ${p.odds} odds · Tier ${p.tier}`,
        value: `${p.points >= 0 ? '+' : ''}${p.points} pts`,
        valueClass: p.points >= 0 ? 'text-accent' : 'text-danger',
      }));
    setSliceDetail({ label, rows });
  }

  const GROUP_LABELS = { eventType: 'By event type', year: 'By year' };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center px-4" onClick={onClose}>
        <div className="bg-card border border-border rounded-xl w-full max-w-lg p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-1">
            <div className="font-medium">{name}</div>
            <button onClick={onClose} className="text-muted hover:text-text text-sm px-2">✕</button>
          </div>
          <div className="text-xs text-muted mb-3">
            {filteredLog.length} pick{filteredLog.length === 1 ? '' : 's'}{pieStrokerFilter ? ` by ${pieStrokerFilter}` : ' total'}
          </div>

          <div className="flex items-center gap-1.5 mb-3">
            {['eventType', 'year'].map((key) => (
              <button
                key={key}
                onClick={() => setGroupBy(key)}
                className={`shrink-0 text-xs px-2 py-1.5 rounded-lg border whitespace-nowrap ${groupBy === key ? 'border-accent text-text' : 'border-border text-muted'}`}
              >
                {GROUP_LABELS[key]}
              </button>
            ))}
            {strokerNames.length > 1 && (
              <Select
                value={pieStrokerFilter}
                onChange={setPieStrokerFilter}
                options={[{ value: '', label: 'All strokers' }, ...strokerNames.map((n) => ({ value: n, label: n }))]}
                className="flex-1 min-w-0 !px-2 py-1.5 text-xs overflow-hidden text-ellipsis whitespace-nowrap"
              />
            )}
          </div>

          {pieData.length ? (
            <>
              <div style={{ width: '100%', height: 260 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={95}
                      style={{ cursor: 'pointer' }}
                      onClick={(d) => openSlice(d.name)}
                    >
                      {pieData.map((d, i) => (
                        <Cell key={d.name} fill={PICK_PIE_COLORS[i % PICK_PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: '#161B22', border: '1px solid #21262D', borderRadius: 8 }}
                      labelStyle={{ color: '#E6EDF3' }}
                      formatter={(value, n, props) => [`${value} pick${value === 1 ? '' : 's'} (${props.payload.pct}%)`, n]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <PieKey
                data={pieData}
                colorFor={(d, i) => PICK_PIE_COLORS[i % PICK_PIE_COLORS.length]}
                onSelect={(d) => openSlice(d.name)}
              />
            </>
          ) : (
            <div className="text-sm text-muted text-center py-6">No picks for this filter.</div>
          )}
        </div>
      </div>

      {sliceDetail && (
        <RowsModal
          title={`${name} — ${sliceDetail.label}`}
          subtitle={`${sliceDetail.rows.length} pick${sliceDetail.rows.length === 1 ? '' : 's'}`}
          rows={sliceDetail.rows}
          onClose={() => setSliceDetail(null)}
        />
      )}
    </>
  );
}

function FunStats({ fun, personalFun, strokerFilter, oneVOne, strokerRows, golferHistory, payoutMatrix, onOpenTrophy, onOpenPodium }) {
  const [modal, setModal] = useState(null); // { type: 'rows'|'namePicker'|'matches'|'majorSummary', ... } or null

  if (!fun) return <div className="text-muted text-sm">No past majors yet.</div>;

  function closeModal() { setModal(null); }
  function openRows(title, subtitle, rows) { setModal({ type: 'rows', title, subtitle, rows }); }
  function openNamePicker(title, names, onPick) { setModal({ type: 'namePicker', title, names, onPick }); }
  function openMatches(title, matches, perspective) { setModal({ type: 'matches', title, matches, perspective }); }
  function openMajorSummary(major) {
    const row = payoutMatrix.rows.find((r) => r.major.id === major.id);
    if (row) setModal({ type: 'majorSummary', major, row });
  }
  function openMajorStandings(major, subtitle) {
    const rows = (major.ranked || []).map((r) => {
      const payout = major.payouts?.get(r.entry.id) || 0;
      return {
        key: r.entry.id,
        primary: `${r.rank}. ${r.entry.name}`,
        value: `${r.total >= 0 ? '+' : ''}${r.total} pts${payout > 0 ? ` · ${fm(payout)}` : ''}`,
      };
    });
    openRows(major.name, subtitle || `${fmtDate(major.date)} · ${major.entryCount ?? rows.length} entries`, rows);
  }
  function openGolferRows(name, tier, rows, subtitle) {
    setModal({
      type: 'rows',
      title: (<span className="flex items-center gap-1.5"><TierDot tier={tier} />{name}</span>),
      subtitle,
      rows,
    });
  }
  function openFanFavorite() {
    if (!fun.topGolfer) return;
    const hist = [...(golferHistory.get(fun.topGolfer.name) || [])].sort((a, b) => new Date(b.major.date) - new Date(a.major.date));
    openGolferRows(
      fun.topGolfer.name, fun.topGolfer.tier,
      hist.map((h, i) => ({
        key: i,
        primary: h.major.name,
        secondary: `${fmtDate(h.major.date)} · ${h.status === 'made_cut' ? 'Made cut' : h.status === 'missed_cut' ? 'Missed cut' : h.status}`,
        value: `${h.points >= 0 ? '+' : ''}${h.points} pts`,
        valueClass: h.points >= 0 ? 'text-accent' : 'text-danger',
      })),
      `Picked ${fun.topGolfer.count}× across full-data majors`
    );
  }

  const poolCards = [
    {
      label: 'Most decorated',
      value: fun.mostWins.length ? fun.mostWins.map((r) => r.name).join(' & ') : '—',
      sub: fun.topWins > 0 ? `${fun.topWins} major win${fun.topWins > 1 ? 's' : ''}` : 'No wins yet',
      onClick: fun.mostWins.length ? () => {
        if (fun.mostWins.length === 1) onOpenTrophy(fun.mostWins[0].name);
        else openNamePicker('Most decorated — pick a name', fun.mostWins.map((r) => r.name), (n) => { onOpenTrophy(n); closeModal(); });
      } : undefined,
    },
    {
      label: 'Called the champion',
      value: fun.calledChampionPct != null ? `${fun.calledChampionPct}%` : '—',
      sub: fun.calledChampionPct != null
        ? `${fun.calledChampionCount} of ${fun.calledChampionTotal} winning teams had the real champion on their roster`
        : 'Not enough data yet',
      onClick: fun.calledChampionLog.length ? () => openRows(
        'Called the champion',
        `${fun.calledChampionCount} of ${fun.calledChampionTotal} winning teams had the real champion on their roster`,
        [...fun.calledChampionLog].sort((a, b) => new Date(b.major.date) - new Date(a.major.date)).map((l, i) => ({
          key: i, primary: l.major.name, secondary: fmtDate(l.major.date),
          value: l.hit ? '✓ On roster' : '✗ Missed', valueClass: l.hit ? 'text-accent' : 'text-danger',
        }))
      ) : undefined,
    },
    {
      label: 'Down-tier gambit win rate',
      value: fun.downTierGambitPct != null ? `${fun.downTierGambitPct}%` : '—',
      sub: fun.downTierGambitPct != null
        ? `${fun.downTierGambitCount} of ${fun.downTierGambitTotal} winning teams skipped a tier to double up below it`
        : 'Not enough data yet',
      onClick: fun.downTierGambitLog.length ? () => openRows(
        'Down-tier gambit win rate',
        `${fun.downTierGambitCount} of ${fun.downTierGambitTotal} winning teams skipped a tier to double up below it`,
        [...fun.downTierGambitLog].sort((a, b) => new Date(b.major.date) - new Date(a.major.date)).map((l, i) => ({
          key: i, primary: l.major.name, secondary: fmtDate(l.major.date),
          value: l.hit ? '✓ Gambit' : '—', valueClass: l.hit ? 'text-accent' : 'text-muted',
        }))
      ) : undefined,
    },
    {
      label: 'Tiered-penalty exposure',
      value: fun.tieredPenaltyExposurePct != null ? `${fun.tieredPenaltyExposurePct}%` : '—',
      sub: fun.tieredPenaltyExposurePct != null
        ? `${fun.tieredPenaltyExposedCount} of ${fun.tieredPenaltyExposedTotal} winning teams (rule-enabled majors) ate a tiered cut-line penalty`
        : 'No rule-enabled majors yet',
      onClick: fun.tieredPenaltyLog.length ? () => openRows(
        'Tiered-penalty exposure',
        `${fun.tieredPenaltyExposedCount} of ${fun.tieredPenaltyExposedTotal} winning teams (rule-enabled majors) ate a tiered cut-line penalty`,
        [...fun.tieredPenaltyLog].sort((a, b) => new Date(b.major.date) - new Date(a.major.date)).map((l, i) => ({
          key: i, primary: l.major.name, secondary: fmtDate(l.major.date),
          value: l.hit ? '⚠ Penalized' : '✓ Clean', valueClass: l.hit ? 'text-danger' : 'text-accent',
        }))
      ) : undefined,
    },
    {
      label: 'League-wide missed-cut average',
      value: fun.leagueWideAvgMC != null ? fun.leagueWideAvgMC.toFixed(2) : '—',
      sub: fun.leagueWideAvgMC != null ? 'Avg. golfers missed cut per entry, every entry, all-time' : 'Not enough data yet',
      onClick: fun.leagueMcLog.length ? () => openRows(
        'League-wide missed-cut average — by major',
        `${fun.leagueWideAvgMC.toFixed(2)} avg all-time`,
        [...fun.leagueMcLog].sort((a, b) => new Date(b.major.date) - new Date(a.major.date)).map((l, i) => ({
          key: i, primary: l.major.name, secondary: fmtDate(l.major.date), value: `${l.avg.toFixed(2)} avg MC`, valueClass: 'text-muted',
        }))
      ) : undefined,
    },
    {
      label: 'Biggest favorite to miss the cut',
      value: fun.biggestFavoriteToMissCut ? fun.biggestFavoriteToMissCut.name : '—',
      sub: fun.biggestFavoriteToMissCut
        ? `${fun.biggestFavoriteToMissCut.odds} odds · ${fun.biggestFavoriteToMissCut.major.name}`
        : 'Not enough data yet',
      onClick: fun.biggestFavoriteToMissCut ? () => openGolferRows(
        fun.biggestFavoriteToMissCut.name, undefined,
        [{
          key: 0, primary: fun.biggestFavoriteToMissCut.major.name, secondary: fmtDate(fun.biggestFavoriteToMissCut.major.date),
          value: `${fun.biggestFavoriteToMissCut.odds} odds`, valueClass: 'text-danger',
        }],
        'Missed the cut despite the shortest odds among every missed-cut pick'
      ) : undefined,
    },
    {
      label: 'Biggest single payday',
      value: fun.biggestPrize ? fm(fun.biggestPrize.amount) : '—',
      sub: fun.biggestPrize ? `${fun.biggestPrize.who} · ${fun.biggestPrize.major.name}` : '',
      onClick: fun.biggestPrize ? () => openMajorSummary(fun.biggestPrize.major) : undefined,
    },
    {
      label: 'Best ROI',
      value: fun.bestRoi ? `${(fun.bestRoi.roi * 100).toFixed(0)}%` : '—',
      sub: fun.bestRoi ? `${fun.bestRoi.name} (full-data majors)` : 'Not enough data yet',
      onClick: fun.bestRoi ? () => openRows(
        'Best ROI (all-time)',
        'Net return — (money earned − entry fees) ÷ entry fees, full-data majors only',
        strokerRows.filter((r) => r.roi != null && r.entries > 0).sort((a, b) => b.roi - a.roi).map((r) => ({
          key: r.name, primary: r.name, secondary: `${r.entries} entries · ${fm(r.moneyWon)} won`,
          value: `${(r.roi * 100).toFixed(0)}%`, valueClass: r.roi >= 0 ? 'text-accent' : 'text-danger',
        }))
      ) : undefined,
    },
    {
      label: 'Iron man',
      value: fun.ironMan?.entries ? `${fun.ironMan.entries} entries` : '—',
      sub: fun.ironMan?.entries ? `${fun.ironMan.name} (full-data majors)` : 'Not enough data yet',
      onClick: fun.ironMan?.entries ? () => openRows(
        'Iron man — most entries', 'Full-data majors only',
        strokerRows.filter((r) => r.entries != null).sort((a, b) => b.entries - a.entries).map((r) => ({
          key: r.name, primary: r.name, secondary: `${r.wins} wins · ${fm(r.feesPaid)} spent`, value: `${r.entries} entries`,
        }))
      ) : undefined,
    },
    {
      label: 'Fan favorite golfer',
      value: fun.topGolfer?.name || '—',
      sub: fun.topGolfer ? `Picked ${fun.topGolfer.count}× across full-data majors` : 'Not enough data yet',
      onClick: fun.topGolfer ? openFanFavorite : undefined,
    },
    {
      label: "Fan favorite's make-cut rate",
      value: fun.fanFavoriteCutRate != null ? `${fun.fanFavoriteCutRate}%` : '—',
      sub: fun.fanFavoriteCutRate != null ? `How often ${fun.topGolfer.name} made the cut when picked` : 'Not enough data yet',
      onClick: fun.topGolfer ? openFanFavorite : undefined,
    },
    {
      label: 'Always the bridesmaid',
      value: fun.bridesmaid.length ? fun.bridesmaid.map((r) => r.name).join(' & ') : '—',
      sub: fun.topPodiumOnly > 0 ? `Paid out ${fun.topPodiumOnly}× without ever winning` : 'Not enough data yet',
      onClick: fun.bridesmaid.length ? () => {
        if (fun.bridesmaid.length === 1) onOpenPodium({ name: fun.bridesmaid[0].name, finishes: fun.bridesmaid[0].podiumFinishes });
        else openNamePicker('Always the bridesmaid — pick a name', fun.bridesmaid.map((r) => r.name), (n) => {
          const row = fun.bridesmaid.find((r) => r.name === n);
          onOpenPodium({ name: n, finishes: row.podiumFinishes });
          closeModal();
        });
      } : undefined,
    },
    {
      label: 'Highest winning score',
      value: fun.highestScore ? `${fun.highestScore.points >= 0 ? '+' : ''}${fun.highestScore.points} pts` : '—',
      sub: fun.highestScore ? `${fun.highestScore.who} · ${fun.highestScore.major.name}` : '',
      onClick: fun.highestScore ? () => openMajorSummary(fun.highestScore.major) : undefined,
    },
    {
      label: 'Biggest field',
      value: fun.biggestField ? `${fun.biggestField.entryCount} entries` : '—',
      sub: fun.biggestField?.major?.name || '',
      onClick: fun.biggestField ? () => openMajorStandings(fun.biggestField.major) : undefined,
    },
    {
      label: 'Toughest test',
      value: fun.toughestTest ? `${fun.toughestTest.points >= 0 ? '+' : ''}${fun.toughestTest.points} pts` : '—',
      sub: fun.toughestTest ? `Lowest winning score · ${fun.toughestTest.who} · ${fun.toughestTest.major.name}` : '',
      onClick: fun.toughestTest ? () => openMajorSummary(fun.toughestTest.major) : undefined,
    },
    {
      label: 'Nail-biter',
      value: fun.nailBiter ? `${fun.nailBiter.margin} pt${fun.nailBiter.margin === 1 ? '' : 's'}` : '—',
      sub: fun.nailBiter ? `Closest margin · ${fun.nailBiter.winner} · ${fun.nailBiter.major.name}` : 'Not enough data yet',
      onClick: fun.nailBiter ? () => openMajorStandings(
        fun.nailBiter.major,
        `Margin: ${fun.nailBiter.margin} pt${fun.nailBiter.margin === 1 ? '' : 's'} · ${fmtDate(fun.nailBiter.major.date)}`
      ) : undefined,
    },
    {
      label: 'Runaway winner',
      value: fun.runaway ? `${fun.runaway.margin} pts` : '—',
      sub: fun.runaway ? `Biggest margin · ${fun.runaway.winner} · ${fun.runaway.major.name}` : 'Not enough data yet',
      onClick: fun.runaway ? () => openMajorStandings(
        fun.runaway.major,
        `Margin: ${fun.runaway.margin} pts · ${fmtDate(fun.runaway.major.date)}`
      ) : undefined,
    },
    {
      label: 'Longest shot picked',
      value: fun.longestShot ? fun.longestShot.name : '—',
      sub: fun.longestShot ? `${fun.longestShot.odds} odds — somebody believed` : 'Not enough data yet',
      onClick: fun.longestShot ? () => openGolferRows(
        fun.longestShot.name, undefined,
        [{
          key: 0, primary: fun.longestShot.major.name,
          secondary: `Picked by ${fun.longestShot.strokerName} · ${fun.longestShot.status === 'made_cut' ? 'Made cut' : fun.longestShot.status === 'missed_cut' ? 'Missed cut' : fun.longestShot.status}`,
          value: `${fun.longestShot.odds} odds`,
        }],
        `${fun.longestShot.points >= 0 ? '+' : ''}${fun.longestShot.points} pts that event`
      ) : undefined,
    },
    {
      label: 'Backed into it',
      value: fun.cheapestCash != null ? `${fun.cheapestCash.points >= 0 ? '+' : ''}${fun.cheapestCash.points} pts` : '—',
      sub: fun.cheapestCash ? `Lowest score to still cash · ${fun.cheapestCash.who} · ${fm(fun.cheapestCash.payout)}` : 'Not enough data yet',
      onClick: fun.cheapestCash ? () => openMajorSummary(fun.cheapestCash.major) : undefined,
    },
    {
      label: 'Most loyal, still ringless',
      value: fun.mostLoyal ? `${fun.mostLoyal.entries} entries` : '—',
      sub: fun.mostLoyal ? `${fun.mostLoyal.name} · 0 wins so far` : 'Not enough data yet',
      onClick: fun.mostLoyal ? () => openRows(
        `${fun.mostLoyal.name} — entry history`,
        `${fun.mostLoyal.entries} entries, still ringless`,
        [...fun.mostLoyal.allFinishes].sort((a, b) => new Date(b.date) - new Date(a.date)).map((f, i) => ({
          key: i, primary: f.major, secondary: `${fmtDate(f.date)} · ${f.rank}`,
          value: f.payout > 0 ? fm(f.payout) : `${f.points >= 0 ? '+' : ''}${f.points} pts`,
          valueClass: f.payout > 0 ? 'text-accent' : 'text-muted',
        }))
      ) : undefined,
    },
    {
      label: 'Total paid out',
      value: fm(fun.totalPaidOut),
      sub: 'Every dollar we know changed hands, all-time',
      onClick: fun.paidOutLog.length ? () => openRows(
        'Total paid out — by major', `${fm(fun.totalPaidOut)} all-time`,
        [...fun.paidOutLog].sort((a, b) => new Date(b.major.date) - new Date(a.major.date)).map((l, i) => ({
          key: i, primary: l.major.name, secondary: fmtDate(l.major.date), value: fm(l.amount),
        }))
      ) : undefined,
    },
    {
      label: 'Total picks logged',
      value: `${fun.totalPicksLogged.toLocaleString()} picks`,
      sub: 'Across every full-data major',
      onClick: fun.picksLoggedLog.length ? () => openRows(
        'Total picks logged — by major', `${fun.totalPicksLogged.toLocaleString()} picks all-time`,
        [...fun.picksLoggedLog].sort((a, b) => new Date(b.major.date) - new Date(a.major.date)).map((l, i) => ({
          key: i, primary: l.major.name, secondary: fmtDate(l.major.date), value: `${l.count} picks`, valueClass: 'text-muted',
        }))
      ) : undefined,
    },
    {
      label: 'Mr. Chalk (all-time)',
      value: fun.mrChalk.length ? fun.mrChalk.map((r) => r.name).join(' & ') : '—',
      sub: fun.minAvgOdds != null ? `Avg pick odds +${Math.round(fun.minAvgOdds).toLocaleString()} — plays it safe` : 'Not enough data yet',
      onClick: fun.mrChalk.length ? () => openRows(
        'Mr. Chalk — lowest avg pick odds', 'Full-data majors only, safest-first',
        strokerRows.filter((r) => r.avgPickOdds != null).sort((a, b) => a.avgPickOdds - b.avgPickOdds).map((r) => ({
          key: r.name, primary: r.name, secondary: `${r.entries ?? '—'} entries`,
          value: `+${Math.round(r.avgPickOdds).toLocaleString()}`, valueClass: 'text-muted',
        }))
      ) : undefined,
    },
    {
      label: 'Mr. Contrarian (all-time)',
      value: fun.mrContrarian.length ? fun.mrContrarian.map((r) => r.name).join(' & ') : '—',
      sub: fun.maxAvgOdds != null ? `Avg pick odds +${Math.round(fun.maxAvgOdds).toLocaleString()} — swings for the fences` : 'Not enough data yet',
      onClick: fun.mrContrarian.length ? () => openRows(
        'Mr. Contrarian — highest avg pick odds', 'Full-data majors only, longest-shots-first',
        strokerRows.filter((r) => r.avgPickOdds != null).sort((a, b) => b.avgPickOdds - a.avgPickOdds).map((r) => ({
          key: r.name, primary: r.name, secondary: `${r.entries ?? '—'} entries`,
          value: `+${Math.round(r.avgPickOdds).toLocaleString()}`, valueClass: 'text-muted',
        }))
      ) : undefined,
    },
    {
      label: 'High roller',
      value: oneVOne?.highRoller ? fm(oneVOne.highRoller.amount) : '—',
      sub: oneVOne?.highRoller ? `${oneVOne.highRoller.challenger} vs ${oneVOne.highRoller.opponent} · ${oneVOne.highRoller.tournament}` : 'No settled 1v1 matches yet',
      onClick: oneVOne?.highRoller ? () => {
        const all = getPlayerMatches(oneVOne.highRoller.challenger);
        const match = all.filter((m) => m.tournamentName === oneVOne.highRoller.tournament && m.opponent === oneVOne.highRoller.opponent && m.amount === oneVOne.highRoller.amount);
        openMatches('Biggest bet ever', match.length ? match : all, oneVOne.highRoller.challenger);
      } : undefined,
    },
    {
      label: 'Untouchable',
      value: oneVOne?.untouchable ? `${oneVOne.untouchable.length} in a row` : '—',
      sub: oneVOne?.untouchable ? `${oneVOne.untouchable.name} · longest 1v1 win streak` : 'No settled 1v1 matches yet',
      onClick: oneVOne?.untouchable ? () => openMatches(
        `${oneVOne.untouchable.name}'s matches — win streak: ${oneVOne.untouchable.length}`,
        getPlayerMatches(oneVOne.untouchable.name), oneVOne.untouchable.name
      ) : undefined,
    },
    {
      label: 'Rivalry',
      value: oneVOne?.rivalry ? oneVOne.rivalry.names.join(' vs ') : '—',
      sub: oneVOne?.rivalry
        ? `${oneVOne.rivalry.count} matches · ${oneVOne.rivalry.names.map((n) => `${n} ${oneVOne.rivalry.wins[n] || 0}`).join(', ')}`
        : 'Not enough head-to-head history yet',
      onClick: oneVOne?.rivalry ? () => {
        const [a, b] = oneVOne.rivalry.names;
        openMatches(`${a} vs ${b}`, getPlayerMatches(a).filter((m) => m.opponent === b), a);
      } : undefined,
    },
  ];

  // One stroker's own version of the tiles above — every "record" is
  // recomputed against just their wins/picks/bets instead of the pool-wide
  // leaderboard-topper. Tiles with no per-person meaning (pool totals, the
  // MC/champion-tier distributions, the fan-favorite golfer) aren't
  // reproduced here at all.
  const pf = personalFun;
  const personalCards = pf ? [
    {
      label: 'Major wins',
      value: `${pf.row.wins}`,
      sub: pf.row.wins > 0 ? `${pf.row.wins} major win${pf.row.wins > 1 ? 's' : ''}` : 'No wins yet',
      onClick: pf.row.wins > 0 ? () => onOpenTrophy(strokerFilter) : undefined,
    },
    {
      label: 'ROI',
      value: pf.row.roi != null ? `${(pf.row.roi * 100).toFixed(0)}%` : '—',
      sub: pf.row.roi != null ? `${pf.row.entries} entries · ${fm(pf.row.moneyWon)} won` : 'Not enough data yet',
      onClick: pf.row.allFinishes?.length ? () => openRows(
        `${strokerFilter} — entry history`, 'Full-data majors only',
        [...pf.row.allFinishes].sort((a, b) => new Date(b.date) - new Date(a.date)).map((f, i) => ({
          key: i, primary: f.major, secondary: `${fmtDate(f.date)} · ${f.rank}`,
          value: f.payout > 0 ? fm(f.payout) : `${f.points >= 0 ? '+' : ''}${f.points} pts`,
          valueClass: f.payout > 0 ? 'text-accent' : 'text-muted',
        }))
      ) : undefined,
    },
    {
      label: 'Entries',
      value: pf.row.entries != null ? `${pf.row.entries} entries` : '—',
      sub: pf.row.entries != null ? `${pf.row.wins} wins · ${fm(pf.row.feesPaid)} spent` : 'Not enough data yet',
      onClick: pf.row.allFinishes?.length ? () => openRows(
        `${strokerFilter} — entry history`, 'Full-data majors only',
        [...pf.row.allFinishes].sort((a, b) => new Date(b.date) - new Date(a.date)).map((f, i) => ({
          key: i, primary: f.major, secondary: `${fmtDate(f.date)} · ${f.rank}`,
          value: f.payout > 0 ? fm(f.payout) : `${f.points >= 0 ? '+' : ''}${f.points} pts`,
          valueClass: f.payout > 0 ? 'text-accent' : 'text-muted',
        }))
      ) : undefined,
    },
    {
      label: 'Always the bridesmaid',
      value: pf.row.podiumOnly > 0 ? `${pf.row.podiumOnly}` : '—',
      sub: pf.row.podiumOnly > 0 ? `Paid out ${pf.row.podiumOnly}× without winning` : 'Not enough data yet',
      onClick: pf.row.podiumOnly > 0 ? () => onOpenPodium({ name: strokerFilter, finishes: pf.row.podiumFinishes }) : undefined,
    },
    pf.row.wins === 0 && pf.row.entries > 0 ? {
      label: 'Still ringless',
      value: `${pf.row.entries} entries`,
      sub: '0 wins so far',
    } : null,
    {
      label: 'Highest winning score',
      value: pf.highestScore ? `${pf.highestScore.points >= 0 ? '+' : ''}${pf.highestScore.points} pts` : '—',
      sub: pf.highestScore ? pf.highestScore.major.name : 'No wins yet',
      onClick: pf.highestScore ? () => openMajorSummary(pf.highestScore.major) : undefined,
    },
    {
      label: 'Toughest test',
      value: pf.toughestTest ? `${pf.toughestTest.points >= 0 ? '+' : ''}${pf.toughestTest.points} pts` : '—',
      sub: pf.toughestTest ? `Your lowest winning score · ${pf.toughestTest.major.name}` : 'No wins yet',
      onClick: pf.toughestTest ? () => openMajorSummary(pf.toughestTest.major) : undefined,
    },
    {
      label: 'Biggest single payday',
      value: pf.biggestPrize ? fm(pf.biggestPrize.amount) : '—',
      sub: pf.biggestPrize ? pf.biggestPrize.major.name : 'No wins yet',
      onClick: pf.biggestPrize ? () => openMajorSummary(pf.biggestPrize.major) : undefined,
    },
    {
      label: 'Nail-biter',
      value: pf.nailBiter ? `${pf.nailBiter.margin} pt${pf.nailBiter.margin === 1 ? '' : 's'}` : '—',
      sub: pf.nailBiter ? `Your closest margin · ${pf.nailBiter.major.name}` : 'Not enough data yet',
      onClick: pf.nailBiter ? () => openMajorStandings(
        pf.nailBiter.major, `Margin: ${pf.nailBiter.margin} pt${pf.nailBiter.margin === 1 ? '' : 's'} · ${fmtDate(pf.nailBiter.major.date)}`
      ) : undefined,
    },
    {
      label: 'Runaway winner',
      value: pf.runaway ? `${pf.runaway.margin} pts` : '—',
      sub: pf.runaway ? `Your biggest margin · ${pf.runaway.major.name}` : 'Not enough data yet',
      onClick: pf.runaway ? () => openMajorStandings(
        pf.runaway.major, `Margin: ${pf.runaway.margin} pts · ${fmtDate(pf.runaway.major.date)}`
      ) : undefined,
    },
    {
      label: 'Longest shot picked',
      value: pf.longestShot ? pf.longestShot.name : '—',
      sub: pf.longestShot ? `${pf.longestShot.odds} odds — you believed` : 'Not enough data yet',
      onClick: pf.longestShot ? () => openGolferRows(
        pf.longestShot.name, undefined,
        [{
          key: 0, primary: pf.longestShot.major.name,
          secondary: pf.longestShot.status === 'made_cut' ? 'Made cut' : pf.longestShot.status === 'missed_cut' ? 'Missed cut' : pf.longestShot.status,
          value: `${pf.longestShot.odds} odds`,
        }],
        `${pf.longestShot.points >= 0 ? '+' : ''}${pf.longestShot.points} pts that event`
      ) : undefined,
    },
    {
      label: 'Backed into it',
      value: pf.cheapestCash != null ? `${pf.cheapestCash.points >= 0 ? '+' : ''}${pf.cheapestCash.points} pts` : '—',
      sub: pf.cheapestCash ? `Lowest score to still cash · ${fm(pf.cheapestCash.payout)}` : 'Not enough data yet',
      onClick: pf.cheapestCash ? () => openRows(
        'Backed into it', `${strokerFilter}'s lowest score to still cash`,
        [{ key: 0, primary: pf.cheapestCash.major, secondary: `${fmtDate(pf.cheapestCash.date)} · ${pf.cheapestCash.rank}`, value: fm(pf.cheapestCash.payout) }]
      ) : undefined,
    },
    {
      label: 'Picks logged',
      value: `${pf.picksLogged.toLocaleString()} picks`,
      sub: 'Every golfer you’ve drafted, full-data majors only',
    },
    {
      label: 'Pick style',
      value: pf.row.avgPickOdds != null ? `+${Math.round(pf.row.avgPickOdds).toLocaleString()}` : '—',
      sub: pf.row.avgPickOdds != null ? 'Your avg. pick odds — lower means chalk, higher means longshots' : 'Not enough data yet',
    },
    {
      label: 'Called the champion',
      value: pf.calledChampionPct != null ? `${pf.calledChampionPct}%` : '—',
      sub: pf.calledChampionPct != null
        ? `${pf.calledChampionCount} of ${pf.calledChampionTotal} of your winning teams had the real champion on the roster`
        : 'No wins with tracked champion data yet',
    },
    {
      label: 'Down-tier gambit win rate',
      value: pf.downTierGambitPct != null ? `${pf.downTierGambitPct}%` : '—',
      sub: pf.downTierGambitPct != null
        ? `${pf.downTierGambitCount} of ${pf.downTierGambitTotal} of your winning teams skipped a tier`
        : 'No wins with tracked pick data yet',
    },
    {
      label: 'Tiered-penalty exposure',
      value: pf.tieredPenaltyExposurePct != null ? `${pf.tieredPenaltyExposurePct}%` : '—',
      sub: pf.tieredPenaltyExposurePct != null
        ? `${pf.tieredPenaltyExposedCount} of ${pf.tieredPenaltyExposedTotal} of your winning teams (rule-enabled majors) ate a penalty`
        : 'No rule-enabled wins yet',
    },
    {
      label: 'High roller',
      value: pf.highRoller ? fm(pf.highRoller.amount) : '—',
      sub: pf.highRoller
        ? `vs ${pf.highRoller.challenger === strokerFilter ? pf.highRoller.opponent : pf.highRoller.challenger} · ${pf.highRoller.tournament}`
        : 'No settled 1v1 matches yet',
      onClick: pf.highRoller ? () => {
        const other = pf.highRoller.challenger === strokerFilter ? pf.highRoller.opponent : pf.highRoller.challenger;
        const all = getPlayerMatches(strokerFilter);
        const match = all.filter((m) => m.tournamentName === pf.highRoller.tournament && m.opponent === other && m.amount === pf.highRoller.amount);
        openMatches('Your biggest bet ever', match.length ? match : all, strokerFilter);
      } : undefined,
    },
    {
      label: 'Untouchable',
      value: pf.untouchable ? `${pf.untouchable.length} in a row` : '—',
      sub: pf.untouchable ? 'Your longest 1v1 win streak' : 'No settled 1v1 matches yet',
      onClick: pf.untouchable ? () => openMatches(
        `Your matches — win streak: ${pf.untouchable.length}`, getPlayerMatches(strokerFilter), strokerFilter
      ) : undefined,
    },
    {
      label: 'Rivalry',
      value: pf.rivalry ? (pf.rivalry.names.find((n) => n !== strokerFilter) || pf.rivalry.names[0]) : '—',
      sub: pf.rivalry
        ? (() => {
            const other = pf.rivalry.names.find((n) => n !== strokerFilter) || pf.rivalry.names[0];
            return `${pf.rivalry.count} matches · you ${pf.rivalry.wins[strokerFilter] || 0} - ${pf.rivalry.wins[other] || 0}`;
          })()
        : 'Not enough head-to-head history yet',
      onClick: pf.rivalry ? () => {
        const other = pf.rivalry.names.find((n) => n !== strokerFilter) || pf.rivalry.names[0];
        openMatches(`${strokerFilter} vs ${other}`, getPlayerMatches(strokerFilter).filter((m) => m.opponent === other), strokerFilter);
      } : undefined,
    },
  ].filter(Boolean) : [];

  const cards = strokerFilter && pf ? personalCards : poolCards;

  // Both pies fall back to the pool-wide `fun` source normally, but scope to
  // just this stroker's own wins when one's selected — shown whenever that
  // source actually has data, rather than always hiding on a stroker filter.
  const pieSrc = strokerFilter && pf ? pf : fun;
  const mcHeading = strokerFilter ? `${strokerFilter}'s winning teams by missed cuts` : 'Winning teams by missed cuts';
  const mcSubtext = strokerFilter
    ? <>Of {pieSrc.mcTotal} of your winning team{pieSrc.mcTotal === 1 ? '' : 's'} (full-data majors; ties count each co-winner separately) — how many of the 6 golfers missed the cut. Click a slice to see the teams.</>
    : <>Of {pieSrc.mcTotal} winning team{pieSrc.mcTotal === 1 ? '' : 's'} (full-data majors; ties count each co-winner separately) — how many of the 6 golfers missed the cut. Click a slice to see the teams.</>;
  const tierHeading = strokerFilter ? "Champion's pool tier — your wins" : "Champion's pool tier";
  const tierSubtext = strokerFilter
    ? <>What tier the ACTUAL tournament champion was assigned to in this pool's tier system, across your full-data wins. Click a slice to see which majors.</>
    : <>What tier the ACTUAL tournament champion was assigned to in this pool's tier system, across every full-data major. Click a slice to see which majors.</>;

  const mcColorFor = (d, i) => MC_COLORS[['0 MC', '1 MC', '2 MC', '3+ MC'].indexOf(d.name)] || MC_COLORS[i % MC_COLORS.length];
  function openMcSlice(d) {
    const key = d.name.replace(' MC', '');
    const rows = (pieSrc.mcBucketDetails[key] || []).map((row, i) => ({
      key: i, primary: row.entryName, secondary: row.major.name,
      value: `${row.mc} MC · ${row.total >= 0 ? '+' : ''}${row.total} pts`,
    }));
    openRows(`Winning teams — ${d.name}`, `${rows.length} team${rows.length === 1 ? '' : 's'}`, rows);
  }

  const tierColorFor = (d) => TIER_HEX[Number(d.name.replace('Tier ', ''))] || '#8B949E';
  function openTierSlice(d) {
    const tier = Number(d.name.replace('Tier ', ''));
    const rows = (pieSrc.championTierMajors[tier] || []).map((row, i) => ({
      key: i, primary: row.major.name, secondary: fmtDate(row.major.date), value: row.champion,
    }));
    openRows(`Champions — ${d.name}`, `${rows.length} major${rows.length === 1 ? '' : 's'}`, rows);
  }

  return (
    <div className="space-y-3">
      {pieSrc.mcDistribution.length > 0 && (
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wide text-muted mb-1">{mcHeading}</div>
          <div className="text-xs text-muted mb-2">{mcSubtext}</div>
          <div style={{ width: '100%', height: 220 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={pieSrc.mcDistribution} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={85}
                  style={{ cursor: 'pointer' }}
                  onClick={openMcSlice}
                >
                  {pieSrc.mcDistribution.map((d, i) => (
                    <Cell key={d.name} fill={mcColorFor(d, i)} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: '#161B22', border: '1px solid #21262D', borderRadius: 8 }}
                  labelStyle={{ color: '#E6EDF3' }}
                  formatter={(value, name, props) => [`${value} team${value === 1 ? '' : 's'} (${props.payload.pct}%)`, name]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <PieKey data={pieSrc.mcDistribution} colorFor={mcColorFor} onSelect={openMcSlice} />
        </Card>
      )}

      {pieSrc.championTierDistribution.length > 0 && (
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wide text-muted mb-1">{tierHeading}</div>
          <div className="text-xs text-muted mb-2">{tierSubtext}</div>
          <div style={{ width: '100%', height: 220 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={pieSrc.championTierDistribution} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={85}
                  style={{ cursor: 'pointer' }}
                  onClick={openTierSlice}
                >
                  {pieSrc.championTierDistribution.map((d, i) => (
                    <Cell key={d.name} fill={tierColorFor(d, i)} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: '#161B22', border: '1px solid #21262D', borderRadius: 8 }}
                  labelStyle={{ color: '#E6EDF3' }}
                  formatter={(value, name, props) => [`${value} major${value === 1 ? '' : 's'} (${props.payload.pct}%)`, name]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <PieKey data={pieSrc.championTierDistribution} colorFor={tierColorFor} onSelect={openTierSlice} />
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3">
        {cards.map((c) => (
          <Card
            key={c.label}
            className={`p-4 ${c.onClick ? 'cursor-pointer hover:border-accent/50 transition-colors' : ''}`}
            onClick={c.onClick}
          >
            <div className="text-[11px] uppercase tracking-wide text-muted mb-1">{c.label}</div>
            <div className="text-lg font-semibold">{c.value}</div>
            <div className="text-xs text-muted mt-0.5">{c.sub}</div>
          </Card>
        ))}
      </div>

      {modal?.type === 'rows' && (
        <RowsModal title={modal.title} subtitle={modal.subtitle} rows={modal.rows} onClose={closeModal} />
      )}
      {modal?.type === 'namePicker' && (
        <NamePickerModal title={modal.title} names={modal.names} onPick={modal.onPick} onClose={closeModal} />
      )}
      {modal?.type === 'matches' && (
        <MatchRowsModal title={modal.title} matches={modal.matches} perspective={modal.perspective} onClose={closeModal} />
      )}
      {modal?.type === 'majorSummary' && (
        <MajorSummaryModal major={modal.major} row={modal.row} onClose={closeModal} />
      )}
    </div>
  );
}


function EditModal({ record, onSave, onCancel }) {
  const [d, setD] = useState({ eventType: 'other', ...record.draft, team: (record.draft.team || []).join(', ') });

  const nameLocked = d.eventType !== 'other';
  const computedName = autoTournamentName(d.eventType, d.date);

  async function submit() {
    if (nameLocked && !computedName) {
      return alertAsync('Enter a date first so the name can be generated — or choose "Other" to type a name manually.');
    }
    const name = nameLocked ? computedName : d.name;
    const draft = {
      ...d,
      name,
      team: d.team.split(',').map((s) => s.trim()).filter(Boolean),
      points: Number(d.points),
      entries: Number(d.entries),
      prize: Number(d.prize),
    };
    if (!draft.id) draft.id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now().toString(36);
    onSave(record.idx, draft);
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center px-4">
      <Card className="w-full max-w-md p-5 space-y-3">
        <div className="font-medium">{record.idx == null || record.idx < 0 ? 'Add' : 'Edit'} major (summary only)</div>
        <Select value={d.eventType} onChange={(v) => setD({ ...d, eventType: v })} options={EVENT_TYPES} className="w-full" />
        <Input value={d.date} onChange={(v) => setD({ ...d, date: v })} placeholder="Date (YYYY-MM-DD)" />
        {nameLocked ? (
          <div className="px-3 py-2 bg-bg border border-border rounded-lg text-sm">
            {computedName || <span className="text-muted">Enter a date above to generate the name</span>}
          </div>
        ) : (
          <Input value={d.name} onChange={(v) => setD({ ...d, name: v })} placeholder="Tournament name" />
        )}
        <Input value={d.winner} onChange={(v) => setD({ ...d, winner: v })} placeholder="Winner name" />
        <Input value={d.team} onChange={(v) => setD({ ...d, team: v })} placeholder="Team (comma-separated last names)" />
        <div className="grid grid-cols-3 gap-2">
          <Input value={d.points} onChange={(v) => setD({ ...d, points: v })} placeholder="Points" />
          <Input value={d.entries} onChange={(v) => setD({ ...d, entries: v })} placeholder="Entries" />
          <Input value={d.prize} onChange={(v) => setD({ ...d, prize: v })} placeholder="Prize $" />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button onClick={submit}>Save</Button>
        </div>
      </Card>
    </div>
  );
}
