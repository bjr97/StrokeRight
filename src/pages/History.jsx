import React, { useMemo, useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { storage, keys, listTournaments } from '../lib/storage.js';
import { buildMajors, getStrokerWins, trophyCaseEmojis } from '../lib/majors.js';
import { buildMatchLeaderboard, highRoller, untouchable, biggestRivalry } from '../lib/matchStats.js';
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

// "2nd", "T3", etc. — prefixes a T when someone else shares that rank in the
// same major, matching the tie-handling convention used everywhere else.
function formatRank(rank, rankedList) {
  const tied = (rankedList || []).filter((x) => x.rank === rank).length > 1;
  const mod100 = rank % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? 'th'
    : rank % 10 === 1 ? 'st'
    : rank % 10 === 2 ? 'nd'
    : rank % 10 === 3 ? 'rd' : 'th';
  return `${tied ? 'T' : ''}${rank}${suffix}`;
}

export default function History({ session, refreshAll }) {
  const [tab, setTab] = useState('majors');
  const [majorSort, setMajorSort] = useState('year');
  const [gSort, setGSort] = useState({ key: 'moneyWon', dir: -1 });
  const [mSort, setMSort] = useState({ key: 'wins', dir: -1 });
  const [expandedId, setExpandedId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [trophyFor, setTrophyFor] = useState(null);
  const [podiumFor, setPodiumFor] = useState(null); // { name, finishes } or null

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
    return allMajors.filter((m) => {
      if (eventTypeFilter !== 'all' && (m.eventType || 'other') !== eventTypeFilter) return false;
      if (yearFilter !== 'all' && (m.date || '').slice(0, 4) !== yearFilter) return false;
      return true;
    });
  }, [allMajors, eventTypeFilter, yearFilter]);

  const sortedMajors = useMemo(() => {
    const list = [...majors];
    if (majorSort === 'year') list.sort((a, b) => new Date(b.date) - new Date(a.date));
    else list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [majors, majorSort]);

  // ─── Stroker + golfer aggregation ────────────────────────────────────────
  // Wins & $ won: across every major (full data or summary) — and for
  // full-data majors, $ won includes money from paid non-winning finishes
  // too (e.g. a 2nd place that cashed a payout without winning outright).
  // Entries / $ spent / ROI / podiums / golfer picks: only from full-data
  // majors — that's the only place we know every stroker's entry and every
  // paid position, not just the winner's.
  const { strokerRows, golferRows, longestShot, totalPicksLogged, winningestGolfers, cumulativeScoreRows } = useMemo(() => {
    const legacy = new Map(); // name -> { wins, moneyWon } — from summary-only majors
    const full = new Map();   // name -> { entries, feesPaid, winsFull, podiumOnly, moneyFull }
    const golferCounts = new Map();
    const golferWinCounts = new Map();  // name -> { count, tier } — winning-team appearances
    const golferScoreSum = new Map();   // name -> { sum, majorsCount, tier } — real strokesToPar, once per event
    let longestShot = null; // { name, odds, oddsNum } — worst odds ever actually picked
    let totalPicksLogged = 0;

    for (const m of majors) {
      if (m.fullData) continue;
      const winnerNames = (m.winner || '').split(' & ').map((s) => s.trim()).filter(Boolean);
      if (winnerNames.length && m.prize != null) {
        const share = m.prize / winnerNames.length;
        for (const w of winnerNames) {
          const rec = legacy.get(w) || { wins: 0, moneyWon: 0 };
          rec.wins += 1;
          rec.moneyWon += share;
          legacy.set(w, rec);
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
        const rec = full.get(e.name) || { entries: 0, feesPaid: 0, winsFull: 0, podiumOnly: 0, moneyFull: 0, oddsSum: 0, oddsCount: 0, podiumFinishes: [] };
        rec.entries += 1;
        rec.feesPaid += t.entryFee || 0;
        full.set(e.name, rec);
        for (const gid of e.golferIds || []) {
          const g = golferLookup.get(gid);
          if (!g) continue;
          totalPicksLogged += 1;
          const grec = golferCounts.get(g.name) || { count: 0, tier: g.tier };
          grec.count += 1;
          grec.tier = g.tier;
          golferCounts.set(g.name, grec);
          const oddsNum = oddsToNum(g.odds);
          if (oddsNum >= 0 && (!longestShot || oddsNum > longestShot.oddsNum)) {
            longestShot = { name: g.name, odds: g.odds, oddsNum };
          }
          if (oddsNum >= 0) {
            rec.oddsSum += oddsNum;
            rec.oddsCount += 1;
          }
        }
      }

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
            const wrec = golferWinCounts.get(s.golfer.name) || { count: 0, tier: s.golfer.tier };
            wrec.count += 1;
            wrec.tier = s.golfer.tier;
            golferWinCounts.set(s.golfer.name, wrec);
          }
        }
      }

      // Cumulative real score — each golfer's own strokesToPar for this event,
      // added once regardless of how many entries drafted them (it's their
      // score, not the pool's fantasy points).
      const pickedIdsThisMajor = new Set();
      for (const e of tEntries) for (const gid of e.golferIds || []) pickedIdsThisMajor.add(gid);
      for (const gid of pickedIdsThisMajor) {
        const g = golferLookup.get(gid);
        if (!g || typeof g.strokesToPar !== 'number') continue;
        const srec = golferScoreSum.get(g.name) || { sum: 0, majorsCount: 0, tier: g.tier };
        srec.sum += g.strokesToPar;
        srec.majorsCount += 1;
        srec.tier = g.tier;
        golferScoreSum.set(g.name, srec);
      }

      // Every entry that actually got paid — not just the winning rank.
      // This is how a runner-up who cashed a payout but never won shows up.
      for (const r of major.ranked || []) {
        const payout = major.payouts.get(r.entry.id) || 0;
        if (payout <= 0) continue;
        const rec = full.get(r.entry.name);
        if (!rec) continue;
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
    const strokerRows = [...names].map((name) => {
      const l = legacy.get(name) || { wins: 0, moneyWon: 0 };
      const f = full.get(name);
      // ROI = (gain - cost) / cost — net return, not the raw payout multiple.
      const roi = f && f.feesPaid > 0 ? (f.moneyFull - f.feesPaid) / f.feesPaid : null;
      const avgPickOdds = f && f.oddsCount > 0 ? f.oddsSum / f.oddsCount : null;
      return {
        name,
        wins: l.wins + (f?.winsFull || 0),
        moneyWon: l.moneyWon + (f?.moneyFull || 0),
        podiumOnly: f ? f.podiumOnly : null,
        podiumFinishes: f ? f.podiumFinishes : [],
        entries: f ? f.entries : null,
        feesPaid: f ? f.feesPaid : null,
        roi,
        avgPickOdds,
      };
    });

    const golferRows = [...golferCounts.entries()]
      .map(([name, r]) => ({ name, count: r.count, tier: r.tier }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    const winningestGolfers = [...golferWinCounts.entries()]
      .map(([name, r]) => ({ name, count: r.count, tier: r.tier }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    // Most under par (best real-life performance) first.
    const cumulativeScoreRows = [...golferScoreSum.entries()]
      .map(([name, r]) => ({ name, sum: r.sum, majorsCount: r.majorsCount, tier: r.tier }))
      .sort((a, b) => a.sum - b.sum)
      .slice(0, 15);

    return { strokerRows, golferRows, longestShot, totalPicksLogged, winningestGolfers, cumulativeScoreRows };
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

  const fun = useMemo(() => {
    if (!majors.length) return null;
    const topWins = Math.max(0, ...strokerRows.map((r) => r.wins));
    const mostWins = strokerRows.filter((r) => r.wins === topWins && topWins > 0);

    let biggestPrize = null, highestScore = null, biggestField = null, toughestTest = null, totalPaidOut = 0;
    for (const m of majors) {
      if (m.prize != null && (!biggestPrize || m.prize > biggestPrize.amount)) {
        biggestPrize = { amount: m.prize, who: m.winner, major: m.name };
      }
      if (m.points != null && (!highestScore || m.points > highestScore.points)) {
        highestScore = { points: m.points, who: m.winner, major: m.name };
      }
      if (m.points != null && (!toughestTest || m.points < toughestTest.points)) {
        toughestTest = { points: m.points, who: m.winner, major: m.name };
      }
      if (m.entryCount != null && (!biggestField || m.entryCount > biggestField.entryCount)) {
        biggestField = { entryCount: m.entryCount, major: m.name };
      }
      // Total paid out: every dollar we know changed hands. Full-data majors
      // have every payout on record; summary-only majors only ever recorded
      // the winner's, so that's all we can add for those.
      if (m.fullData && m.payouts) {
        for (const amt of m.payouts.values()) totalPaidOut += amt;
      } else if (m.prize != null) {
        totalPaidOut += m.prize;
      }
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
        if (!nailBiter || margin < nailBiter.margin) nailBiter = { margin, major: m.name, winner: m.winner };
        if (!runaway || margin > runaway.margin) runaway = { margin, major: m.name, winner: m.winner };
      }

      // Lowest score that still cashed a payout — "backed into it."
      for (const r of m.ranked) {
        const payout = m.payouts.get(r.entry.id) || 0;
        if (payout <= 0) continue;
        if (!cheapestCash || r.total < cheapestCash.points) {
          cheapestCash = { points: r.total, who: r.entry.name, major: m.name, payout };
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
    const mcBuckets = { '0': 0, '1': 0, '2': 0, '3+': 0 };
    let mcTotal = 0;
    for (const m of majors) {
      if (!m.fullData || !m.ranked?.length) continue;
      const winningRows = m.ranked.filter((r) => r.rank === m.ranked[0].rank);
      for (const row of winningRows) {
        const mc = row.scored.filter((s) => s.golfer.status === 'missed_cut').length;
        const key = mc >= 3 ? '3+' : String(mc);
        mcBuckets[key]++;
        mcTotal++;
      }
    }
    const mcDistribution = mcTotal
      ? ['0', '1', '2', '3+'].map((key) => ({
          name: `${key} MC`,
          value: mcBuckets[key],
          pct: Math.round((mcBuckets[key] / mcTotal) * 100),
        })).filter((d) => d.value > 0)
      : [];

    // Did the winning team actually have the real tournament champion on
    // its roster? Ties count each co-winner separately, same convention as
    // the MC distribution above. Only counts majors where the admin has
    // set a champion golfer (all 11 to date, but older/manual records
    // could lack one).
    let calledChampionCount = 0, calledChampionTotal = 0;
    for (const m of majors) {
      if (!m.fullData || !m.ranked?.length || !m.champion) continue;
      const winningRows = m.ranked.filter((r) => r.rank === m.ranked[0].rank);
      for (const row of winningRows) {
        calledChampionTotal++;
        if (row.scored.some((s) => s.golfer.name === m.champion)) calledChampionCount++;
      }
    }
    const calledChampionPct = calledChampionTotal ? Math.round((calledChampionCount / calledChampionTotal) * 100) : null;

    return {
      mostWins, topWins, biggestPrize, highestScore, biggestField, bestRoi, ironMan, topGolfer,
      bridesmaid, topPodiumOnly, toughestTest, totalPaidOut, mostLoyal, nailBiter, runaway,
      cheapestCash, longestShot, totalPicksLogged, mrChalk, mrContrarian, minAvgOdds, maxAvgOdds,
      mcDistribution, mcTotal, calledChampionCount, calledChampionTotal, calledChampionPct,
    };
  }, [majors, strokerRows, golferRows, longestShot, totalPicksLogged]);

  const oneVOneFun = useMemo(() => ({
    highRoller: highRoller(),
    untouchable: untouchable(),
    rivalry: biggestRivalry(),
  }), [allTournaments]);

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
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-sm border-b-2 -mb-px whitespace-nowrap shrink-0 ${tab === t.key ? 'border-accent text-text' : 'border-transparent text-muted'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Select
          value={eventTypeFilter}
          onChange={setEventTypeFilter}
          options={[{ value: 'all', label: 'All events' }, ...EVENT_TYPES]}
          className="text-sm"
        />
        <Select
          value={yearFilter}
          onChange={setYearFilter}
          options={[{ value: 'all', label: 'All years' }, ...availableYears.map((y) => ({ value: y, label: y }))]}
          className="text-sm"
        />
        {(eventTypeFilter !== 'all' || yearFilter !== 'all') && (
          <button
            onClick={() => { setEventTypeFilter('all'); setYearFilter('all'); }}
            className="text-xs text-muted hover:text-text underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {tab === 'majors' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex gap-2">
              <button
                onClick={() => setMajorSort('year')}
                className={`text-xs px-2.5 py-1.5 rounded-lg border ${majorSort === 'year' ? 'border-accent text-text' : 'border-border text-muted'}`}
              >
                Newest first
              </button>
              <button
                onClick={() => setMajorSort('major')}
                className={`text-xs px-2.5 py-1.5 rounded-lg border ${majorSort === 'major' ? 'border-accent text-text' : 'border-border text-muted'}`}
              >
                A–Z by major
              </button>
            </div>
            {session?.isAdmin && (
              <Button variant="secondary" onClick={() => setEditing({ idx: null, draft: blankRecord() })}>+ Add</Button>
            )}
          </div>

          <div className="space-y-2">
            {sortedMajors.map((m) => (
              <MajorCard
                key={m.id}
                m={m}
                expanded={expandedId === m.id}
                onToggleExpand={() => setExpandedId(expandedId === m.id ? null : m.id)}
                isAdmin={session?.isAdmin}
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
        <div className="space-y-2">
          <StrokerTable rows={sortedStrokers} sort={gSort} onSort={toggleGSort} strokerWins={strokerWins} onOpenTrophy={setTrophyFor} onOpenPodium={setPodiumFor} />
          <p className="text-xs text-muted">
            $ Won includes paid finishes that weren't wins (e.g. a 2nd place that cashed a payout).
            Entries / $ Spent / ROI / Paid-no-win only reflect majors with full data. ROI is net return —
            (money earned − entry fees) ÷ entry fees, within that same set — so 0% means broke even and a
            negative number means a net loss. "—" means we don't have enough data yet.
          </p>
        </div>
      )}

      {tab === 'onevone' && (
        <div className="space-y-2">
          <MatchLeaderboardTable rows={sortedMatchRows} sort={mSort} onSort={toggleMSort} />
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
            <GolferBars rows={golferRows} />
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">Winningest golfers</div>
            <GolferBars rows={winningestGolfers} />
            <p className="text-xs text-muted">
              Appearances on a winning team, across majors with full data. A tie counts once for each co-winner
              who had that golfer.
            </p>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">All-time cumulative score</div>
            <GolferScoreList rows={cumulativeScoreRows} />
            <p className="text-xs text-muted">
              Each golfer's own real strokes-to-par, added once per event they were picked in — not the pool's
              fantasy points, and not multiplied by how many entries drafted them. Lower is better.
            </p>
          </div>

          <p className="text-xs text-muted">
            Based on majors with full pick data. This gets more meaningful every time another tournament is
            marked complete.
          </p>
        </div>
      )}

      {tab === 'fun' && <FunStats fun={fun} oneVOne={oneVOneFun} />}

      {editing && <EditModal record={editing} onSave={save} onCancel={() => setEditing(null)} />}
      {trophyFor && (
        <TrophyCaseModal name={trophyFor} wins={strokerWins.get(trophyFor) || []} onClose={() => setTrophyFor(null)} />
      )}
      {podiumFor && (
        <PodiumFinishesModal name={podiumFor.name} finishes={podiumFor.finishes} onClose={() => setPodiumFor(null)} />
      )}
    </div>
  );
}

function PodiumFinishesModal({ name, finishes, onClose }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center px-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="font-medium">{name} — paid, no win</div>
          <button onClick={onClose} className="text-muted hover:text-text text-sm px-2">✕</button>
        </div>
        {!finishes?.length ? (
          <div className="text-sm text-muted">No paid-no-win finishes yet.</div>
        ) : (
          <div className="space-y-2">
            {finishes.map((f, i) => (
              <div key={i} className="flex items-center justify-between text-sm py-1 border-b border-border last:border-b-0">
                <div className="min-w-0">
                  <div className="text-text truncate">{f.major}</div>
                  <div className="text-xs text-muted">{fmtDate(f.date)} · {f.rank} · {f.points >= 0 ? '+' : ''}{f.points} pts</div>
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

function MajorCard({ m, expanded, onToggleExpand, isAdmin, onEdit, onDelete }) {
  const [expandedEntryId, setExpandedEntryId] = useState(null);
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
          <button onClick={onEdit} className="text-xs text-muted hover:text-text">edit</button>
          <button onClick={onDelete} className="text-xs text-danger">del</button>
        </div>
      )}
    </Card>
  );
}

function StrokerTable({ rows, sort, onSort, strokerWins, onOpenTrophy, onOpenPodium }) {
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
                  <TrophyCase emojis={String(r.wins)} onClick={() => onOpenTrophy(r.name)} />
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
              <td className="py-1.5 sm:py-2 px-0.5 sm:px-1.5 text-right tabular-nums text-accent whitespace-nowrap">{fm(r.moneyWon)}</td>
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

function MatchLeaderboardTable({ rows, sort, onSort }) {
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
              <td className="py-1.5 sm:py-2 px-0.5 sm:px-1.5 text-right tabular-nums">{r.wins}</td>
              <td className="py-1.5 sm:py-2 px-0.5 sm:px-1.5 text-right tabular-nums">{r.losses}</td>
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
  );
}

function GolferBars({ rows }) {
  const max = rows[0]?.count || 1;
  return (
    <Card className="p-4 space-y-2">
      {rows.map((g, i) => (
        <div key={g.name} className="flex items-center gap-2">
          <span className="w-5 text-right text-xs text-muted">{i + 1}</span>
          <span className="w-32 sm:w-40 flex items-center gap-1.5 text-sm truncate">
            <TierDot tier={g.tier} />{g.name}
          </span>
          <div className="flex-1 bg-border rounded h-2 overflow-hidden">
            <div className="bg-accent h-full rounded" style={{ width: `${(g.count / max) * 100}%` }} />
          </div>
          <span className="w-6 text-right text-xs text-muted">{g.count}</span>
        </div>
      ))}
      {!rows.length && <div className="text-muted text-sm">No full pick data yet.</div>}
    </Card>
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
          </tr>
        </thead>
        <tbody>
          {rows.map((g, i) => (
            <tr key={g.name} className="border-t border-border">
              <td className="py-1.5 sm:py-2 px-1.5">
                <span className="flex items-center gap-1.5">
                  <span className="w-4 text-right text-muted">{i + 1}</span>
                  <TierDot tier={g.tier} />
                  <span className="truncate">{g.name}</span>
                </span>
              </td>
              <td className="py-1.5 sm:py-2 px-1.5 text-right tabular-nums text-muted">{g.majorsCount}</td>
              <td className="py-1.5 sm:py-2 px-1.5 text-right tabular-nums">{fmtToPar(g.sum)}</td>
            </tr>
          ))}
          {!rows.length && (
            <tr><td colSpan={3} className="py-4 text-center text-muted text-sm">No full pick data yet.</td></tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}

const MC_COLORS = ['#3FB950', '#D29922', '#F0883E', '#F85149'];

function FunStats({ fun, oneVOne }) {
  if (!fun) return <div className="text-muted text-sm">No past majors yet.</div>;

  const cards = [
    {
      label: 'Most decorated',
      value: fun.mostWins.length ? fun.mostWins.map((r) => r.name).join(' & ') : '—',
      sub: fun.topWins > 0 ? `${fun.topWins} major win${fun.topWins > 1 ? 's' : ''}` : 'No wins yet',
    },
    {
      label: 'Called the champion',
      value: fun.calledChampionPct != null ? `${fun.calledChampionPct}%` : '—',
      sub: fun.calledChampionPct != null
        ? `${fun.calledChampionCount} of ${fun.calledChampionTotal} winning teams had the real champion on their roster`
        : 'Not enough data yet',
    },
    {
      label: 'Biggest single payday',
      value: fun.biggestPrize ? fm(fun.biggestPrize.amount) : '—',
      sub: fun.biggestPrize ? `${fun.biggestPrize.who} · ${fun.biggestPrize.major}` : '',
    },
    {
      label: 'Best ROI',
      value: fun.bestRoi ? `${(fun.bestRoi.roi * 100).toFixed(0)}%` : '—',
      sub: fun.bestRoi ? `${fun.bestRoi.name} (full-data majors)` : 'Not enough data yet',
    },
    {
      label: 'Iron man',
      value: fun.ironMan?.entries ? `${fun.ironMan.entries} entries` : '—',
      sub: fun.ironMan?.entries ? `${fun.ironMan.name} (full-data majors)` : 'Not enough data yet',
    },
    {
      label: 'Fan favorite golfer',
      value: fun.topGolfer?.name || '—',
      sub: fun.topGolfer ? `Picked ${fun.topGolfer.count}× across full-data majors` : 'Not enough data yet',
    },
    {
      label: 'Always the bridesmaid',
      value: fun.bridesmaid.length ? fun.bridesmaid.map((r) => r.name).join(' & ') : '—',
      sub: fun.topPodiumOnly > 0 ? `Paid out ${fun.topPodiumOnly}× without ever winning` : 'Not enough data yet',
    },
    {
      label: 'Highest winning score',
      value: fun.highestScore ? `${fun.highestScore.points >= 0 ? '+' : ''}${fun.highestScore.points} pts` : '—',
      sub: fun.highestScore ? `${fun.highestScore.who} · ${fun.highestScore.major}` : '',
    },
    {
      label: 'Biggest field',
      value: fun.biggestField ? `${fun.biggestField.entryCount} entries` : '—',
      sub: fun.biggestField?.major || '',
    },
    {
      label: 'Toughest test',
      value: fun.toughestTest ? `${fun.toughestTest.points >= 0 ? '+' : ''}${fun.toughestTest.points} pts` : '—',
      sub: fun.toughestTest ? `Lowest winning score · ${fun.toughestTest.who} · ${fun.toughestTest.major}` : '',
    },
    {
      label: 'Nail-biter',
      value: fun.nailBiter ? `${fun.nailBiter.margin} pt${fun.nailBiter.margin === 1 ? '' : 's'}` : '—',
      sub: fun.nailBiter ? `Closest margin · ${fun.nailBiter.winner} · ${fun.nailBiter.major}` : 'Not enough data yet',
    },
    {
      label: 'Runaway winner',
      value: fun.runaway ? `${fun.runaway.margin} pts` : '—',
      sub: fun.runaway ? `Biggest margin · ${fun.runaway.winner} · ${fun.runaway.major}` : 'Not enough data yet',
    },
    {
      label: 'Longest shot picked',
      value: fun.longestShot ? fun.longestShot.name : '—',
      sub: fun.longestShot ? `${fun.longestShot.odds} odds — somebody believed` : 'Not enough data yet',
    },
    {
      label: 'Backed into it',
      value: fun.cheapestCash != null ? `${fun.cheapestCash.points >= 0 ? '+' : ''}${fun.cheapestCash.points} pts` : '—',
      sub: fun.cheapestCash ? `Lowest score to still cash · ${fun.cheapestCash.who} · ${fm(fun.cheapestCash.payout)}` : 'Not enough data yet',
    },
    {
      label: 'Most loyal, still ringless',
      value: fun.mostLoyal ? `${fun.mostLoyal.entries} entries` : '—',
      sub: fun.mostLoyal ? `${fun.mostLoyal.name} · 0 wins so far` : 'Not enough data yet',
    },
    {
      label: 'Total paid out',
      value: fm(fun.totalPaidOut),
      sub: 'Every dollar we know changed hands, all-time',
    },
    {
      label: 'Total picks logged',
      value: `${fun.totalPicksLogged.toLocaleString()} picks`,
      sub: 'Across every full-data major',
    },
    {
      label: 'Mr. Chalk (all-time)',
      value: fun.mrChalk.length ? fun.mrChalk.map((r) => r.name).join(' & ') : '—',
      sub: fun.minAvgOdds != null ? `Avg pick odds +${Math.round(fun.minAvgOdds).toLocaleString()} — plays it safe` : 'Not enough data yet',
    },
    {
      label: 'Mr. Contrarian (all-time)',
      value: fun.mrContrarian.length ? fun.mrContrarian.map((r) => r.name).join(' & ') : '—',
      sub: fun.maxAvgOdds != null ? `Avg pick odds +${Math.round(fun.maxAvgOdds).toLocaleString()} — swings for the fences` : 'Not enough data yet',
    },
    {
      label: 'High roller',
      value: oneVOne?.highRoller ? fm(oneVOne.highRoller.amount) : '—',
      sub: oneVOne?.highRoller ? `${oneVOne.highRoller.challenger} vs ${oneVOne.highRoller.opponent} · ${oneVOne.highRoller.tournament}` : 'No settled 1v1 matches yet',
    },
    {
      label: 'Untouchable',
      value: oneVOne?.untouchable ? `${oneVOne.untouchable.length} in a row` : '—',
      sub: oneVOne?.untouchable ? `${oneVOne.untouchable.name} · longest 1v1 win streak` : 'No settled 1v1 matches yet',
    },
    {
      label: 'Rivalry',
      value: oneVOne?.rivalry ? oneVOne.rivalry.names.join(' vs ') : '—',
      sub: oneVOne?.rivalry
        ? `${oneVOne.rivalry.count} matches · ${oneVOne.rivalry.names.map((n) => `${n} ${oneVOne.rivalry.wins[n] || 0}`).join(', ')}`
        : 'Not enough head-to-head history yet',
    },
  ];

  return (
    <div className="space-y-3">
      {fun.mcDistribution.length > 0 && (
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wide text-muted mb-1">Winning teams by missed cuts</div>
          <div className="text-xs text-muted mb-2">
            Of {fun.mcTotal} winning team{fun.mcTotal === 1 ? '' : 's'} (full-data majors; ties count each co-winner separately) —
            how many of the 6 golfers missed the cut.
          </div>
          <div style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={fun.mcDistribution} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={85} label={(d) => `${d.name}: ${d.pct}%`}>
                  {fun.mcDistribution.map((d, i) => (
                    <Cell key={d.name} fill={MC_COLORS[['0 MC', '1 MC', '2 MC', '3+ MC'].indexOf(d.name)] || MC_COLORS[i % MC_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: '#161B22', border: '1px solid #21262D', borderRadius: 8 }}
                  labelStyle={{ color: '#E6EDF3' }}
                  formatter={(value, name, props) => [`${value} team${value === 1 ? '' : 's'} (${props.payload.pct}%)`, name]}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3">
        {cards.map((c) => (
          <Card key={c.label} className="p-4">
            <div className="text-[11px] uppercase tracking-wide text-muted mb-1">{c.label}</div>
            <div className="text-lg font-semibold">{c.value}</div>
            <div className="text-xs text-muted mt-0.5">{c.sub}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function blankRecord() {
  return { id: '', name: '', date: '', winner: '', team: [], points: 0, entries: 0, prize: 0, eventType: 'other' };
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
