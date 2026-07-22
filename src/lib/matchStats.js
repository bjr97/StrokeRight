// Aggregate stats across every 1v1 match ever created, across every
// tournament. Shared by the History "1v1 Leaderboard" tab, the Home page's
// "1v1 Knockout King" tile, and the Fun Stats 1v1 badges.

import { storage, keys, listTournaments } from './storage.js';
import { isDraftComplete, computeMatchResult } from './matches.js';
import { scoreGolfer } from './scoring.js';

/**
 * Per-player rows: wins, losses, win %, $ wagered, net $, and how often they
 * propose vs. get declined. Win/loss/$ stats only count matches whose draft
 * finished AND whose tournament is fully completed (settled, final scores) —
 * matches the same "full data only" convention buildMajors() uses for the
 * main pool. Proposed/declined count every match ever recorded regardless
 * of whether it was ever played out.
 */
export function buildMatchLeaderboard() {
  const rows = new Map(); // lowercase name -> row

  function ensure(nameLower, displayName) {
    if (!rows.has(nameLower)) {
      rows.set(nameLower, { name: displayName, wins: 0, losses: 0, pushes: 0, wagered: 0, net: 0, proposed: 0, declined: 0 });
    }
    return rows.get(nameLower);
  }

  for (const t of listTournaments()) {
    const matches = storage.get(keys.matches(t.id)) || [];
    if (!matches.length) continue;
    const golfers = storage.get(keys.golfers(t.id)) || [];
    const opts = {
      tieredPenaltyEnabled: t.tieredPenaltyEnabled,
      cutLine: t.cutLine,
      currentRound: t.currentRound,
      cutBonusPoints: t.cutBonusPoints,
    };

    for (const m of matches) {
      const cRow = ensure(m.challengerName.toLowerCase(), m.challengerName);
      cRow.proposed += 1;

      if (m.status === 'declined') {
        if (m.opponentName) ensure(m.opponentName.toLowerCase(), m.opponentName).declined += 1;
        continue;
      }
      if (m.status !== 'accepted' || !m.opponentName) continue;
      if (!isDraftComplete(m) || t.status !== 'completed') continue;

      const oRow = ensure(m.opponentName.toLowerCase(), m.opponentName);
      const result = computeMatchResult(m, golfers, opts);
      const amount = m.amount || 0;
      cRow.wagered += amount;
      oRow.wagered += amount;

      if (result.winner === 'challenger') { cRow.wins++; oRow.losses++; cRow.net += amount; oRow.net -= amount; }
      else if (result.winner === 'opponent') { oRow.wins++; cRow.losses++; oRow.net += amount; cRow.net -= amount; }
      else { cRow.pushes++; oRow.pushes++; }
    }
  }

  return [...rows.values()].map((r) => ({
    ...r,
    winPct: (r.wins + r.losses) > 0 ? Math.round((r.wins / (r.wins + r.losses)) * 100) : null,
  }));
}

/**
 * Every settled 1v1 match a given player was part of (challenger or
 * opponent, draft finished, tournament completed), newest first — full
 * detail for the "click a leaderboard number to see the bets" popup.
 * Each side's team is the 5 starters + the extra, in draft order, with
 * the extra labeled since it doesn't normally count toward the total.
 */
export function getPlayerMatches(name) {
  const lname = name.toLowerCase();
  const results = [];

  for (const t of listTournaments()) {
    if (t.status !== 'completed') continue;
    const matches = storage.get(keys.matches(t.id)) || [];
    if (!matches.length) continue;
    const golfers = storage.get(keys.golfers(t.id)) || [];
    const golferLookup = new Map(golfers.map((g) => [g.id, g]));
    const opts = {
      tieredPenaltyEnabled: t.tieredPenaltyEnabled,
      cutLine: t.cutLine,
      currentRound: t.currentRound,
      cutBonusPoints: t.cutBonusPoints,
    };

    for (const m of matches) {
      if (m.status !== 'accepted' || !m.opponentName || !isDraftComplete(m)) continue;
      const isChallenger = m.challengerName.toLowerCase() === lname;
      const isOpponent = m.opponentName.toLowerCase() === lname;
      if (!isChallenger && !isOpponent) continue;

      const result = computeMatchResult(m, golfers, opts);
      const mySide = isChallenger ? 'challenger' : 'opponent';
      const oppSide = isChallenger ? 'opponent' : 'challenger';
      const outcome = result.winner === 'push' ? 'push' : (result.winner === mySide ? 'win' : 'loss');

      const teamFor = (picks) => (picks || []).map((gid, i) => {
        const g = golferLookup.get(gid);
        return {
          name: g?.name || 'Unknown',
          points: g ? scoreGolfer(g, opts).points : 0,
          isExtra: i === 5,
        };
      });

      results.push({
        tournamentName: t.name,
        date: t.startDate || m.createdAt || '',
        opponent: isChallenger ? m.opponentName : m.challengerName,
        amount: m.amount,
        outcome,
        myTotal: result[mySide].total,
        oppTotal: result[oppSide].total,
        myTeam: teamFor(isChallenger ? m.challengerPicks : m.opponentPicks),
        oppTeam: teamFor(isChallenger ? m.opponentPicks : m.challengerPicks),
      });
    }
  }

  return results.sort((a, b) => new Date(b.date) - new Date(a.date));
}

/** Most all-time 1v1 wins, tie-broken by net $. Null if nobody's ever won one. */
export function knockoutKing(rows) {
  const topWins = Math.max(0, ...rows.map((r) => r.wins));
  if (topWins <= 0) return null;
  const leaders = rows.filter((r) => r.wins === topWins).sort((a, b) => b.net - a.net);
  return { names: leaders.map((r) => r.name), wins: topWins };
}

/** Biggest single settled 1v1 bet ever played (not just proposed). */
export function highRoller() {
  let best = null;
  for (const t of listTournaments()) {
    if (t.status !== 'completed') continue;
    const matches = storage.get(keys.matches(t.id)) || [];
    for (const m of matches) {
      if (m.status !== 'accepted' || !isDraftComplete(m)) continue;
      if (!best || m.amount > best.amount) {
        best = { amount: m.amount, challenger: m.challengerName, opponent: m.opponentName, tournament: t.name };
      }
    }
  }
  return best;
}

/** Longest consecutive-win streak by any single player, ordered by tournament start date. */
export function untouchable() {
  const byPlayer = new Map(); // name -> [{ date, won }]

  for (const t of listTournaments()) {
    if (t.status !== 'completed') continue;
    const matches = storage.get(keys.matches(t.id)) || [];
    if (!matches.length) continue;
    const golfers = storage.get(keys.golfers(t.id)) || [];
    const opts = {
      tieredPenaltyEnabled: t.tieredPenaltyEnabled,
      cutLine: t.cutLine,
      currentRound: t.currentRound,
      cutBonusPoints: t.cutBonusPoints,
    };
    for (const m of matches) {
      if (m.status !== 'accepted' || !m.opponentName || !isDraftComplete(m)) continue;
      const result = computeMatchResult(m, golfers, opts);
      if (result.winner === 'push') continue;
      const date = t.startDate || m.createdAt || '';
      for (const [name, won] of [[m.challengerName, result.winner === 'challenger'], [m.opponentName, result.winner === 'opponent']]) {
        const key = name.toLowerCase();
        if (!byPlayer.has(key)) byPlayer.set(key, { name, matches: [] });
        byPlayer.get(key).matches.push({ date, won });
      }
    }
  }

  let best = null;
  for (const { name, matches } of byPlayer.values()) {
    matches.sort((a, b) => a.date.localeCompare(b.date));
    let run = 0, longest = 0;
    for (const m of matches) {
      run = m.won ? run + 1 : 0;
      if (run > longest) longest = run;
    }
    if (longest > 0 && (!best || longest > best.length)) best = { name, length: longest };
  }
  return best;
}

/** The pair of players who've played each other the most, with their head-to-head record. */
export function biggestRivalry() {
  const pairs = new Map(); // "a|b" (sorted) -> { names: [a,b], count, record: {a: wins, b: wins} }

  for (const t of listTournaments()) {
    if (t.status !== 'completed') continue;
    const matches = storage.get(keys.matches(t.id)) || [];
    if (!matches.length) continue;
    const golfers = storage.get(keys.golfers(t.id)) || [];
    const opts = {
      tieredPenaltyEnabled: t.tieredPenaltyEnabled,
      cutLine: t.cutLine,
      currentRound: t.currentRound,
      cutBonusPoints: t.cutBonusPoints,
    };
    for (const m of matches) {
      if (m.status !== 'accepted' || !m.opponentName || !isDraftComplete(m)) continue;
      const a = m.challengerName, b = m.opponentName;
      const key = [a.toLowerCase(), b.toLowerCase()].sort().join('|');
      if (!pairs.has(key)) pairs.set(key, { names: [a, b], count: 0, wins: { [a]: 0, [b]: 0 } });
      const p = pairs.get(key);
      p.count += 1;
      const result = computeMatchResult(m, golfers, opts);
      if (result.winner === 'challenger') p.wins[a] = (p.wins[a] || 0) + 1;
      else if (result.winner === 'opponent') p.wins[b] = (p.wins[b] || 0) + 1;
    }
  }

  const list = [...pairs.values()].filter((p) => p.count > 1);
  if (!list.length) return null;
  return list.reduce((a, b) => (b.count > a.count ? b : a));
}
