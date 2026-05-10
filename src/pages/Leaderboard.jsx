import React, { useMemo, useState } from 'react';
import { rankEntries } from '../lib/scoring.js';
import { computePayouts, fmtMoney } from '../lib/payouts.js';
import { computeWinProbabilities } from '../lib/winProb.js';
import { Card, Stat, Pill, StatusBadge, TierDot, fmtToPar, Input } from '../components/ui.jsx';

export default function Leaderboard({ tournament, golfers, entries, snapshots }) {
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState(null);

  const ranked = useMemo(() => rankEntries(entries, golfers, {
    tieredPenaltyEnabled: tournament.tieredPenaltyEnabled,
    cutLine: tournament.cutLine,
    currentRound: tournament.currentRound,
  }), [entries, golfers, tournament]);

  const probs = useMemo(() => computeWinProbabilities(ranked, golfers, {
    roundsRemaining: Math.max(0, 4 - (tournament.currentRound || 1)),
  }), [ranked, golfers, tournament]);

  const { payouts, structure } = computePayouts(ranked, entries.length);

  // Position change since last snapshot
  const prevRanks = useMemo(() => {
    const lastSnap = (snapshots || []).filter((s) => s.round === (tournament.currentRound - 1));
    return new Map(lastSnap.map((s) => [s.entryId, s.rank]));
  }, [snapshots, tournament.currentRound]);

  const filtered = ranked.filter((r) => !filter || r.entry.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-32 md:pb-6 space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Prize pool" value={fmtMoney(structure.pool)} valueClass="text-accent" />
        <Stat label={`R${tournament.currentRound}`} value={tournament.currentRound ? `Live` : 'Pre-tourney'} valueClass="text-warn" />
        <Stat label="Entries" value={entries.length} />
      </div>

      <Input value={filter} onChange={setFilter} placeholder="Filter by name…" />

      <div className="space-y-1">
        {filtered.map((row, idx) => {
          const prevRank = prevRanks.get(row.entry.id);
          const change = prevRank ? prevRank - row.rank : 0;
          const payout = payouts.get(row.entry.id);
          const prob = probs.get(row.entry.id);
          return (
            <Card key={row.entry.id} className="overflow-hidden">
              <button
                onClick={() => setExpanded(expanded === row.entry.id ? null : row.entry.id)}
                className="w-full text-left px-3 py-3 flex items-center justify-between hover:bg-bg transition"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-6 text-center font-semibold tabular-nums text-muted">{row.rank}</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{row.entry.name}</span>
                      <span className="text-xs text-muted">Entry {row.entry.entryNum}</span>
                      {change > 0 && <span className="text-xs text-accent">↑{change}</span>}
                      {change < 0 && <span className="text-xs text-danger">↓{-change}</span>}
                    </div>
                    {payout > 0 && (
                      <div className="text-xs text-accent">{fmtMoney(payout)} projected</div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  {prob != null && (
                    <div className="text-right hidden sm:block">
                      <div className="text-xs text-muted">win</div>
                      <div className="text-sm tabular-nums">{(prob * 100).toFixed(1)}%</div>
                    </div>
                  )}
                  <div className={`text-lg font-semibold tabular-nums ${row.total >= 0 ? 'text-accent' : 'text-danger'}`}>
                    {row.total >= 0 ? `+${row.total}` : row.total}
                  </div>
                </div>
              </button>

              {expanded === row.entry.id && (
                <div className="border-t border-border bg-bg/50 px-3 py-2 space-y-1">
                  {row.scored.map((s) => (
                    <div key={s.golfer.id} className="flex items-center justify-between text-sm py-1">
                      <span className="flex items-center gap-2">
                        <TierDot tier={s.golfer.tier} />
                        <span>{s.golfer.name}</span>
                        <span className="text-muted text-xs tabular-nums">{fmtToPar(s.golfer.strokesToPar)}</span>
                        <StatusBadge status={s.golfer.status} />
                      </span>
                      <span className={`tabular-nums text-sm ${s.points >= 0 ? 'text-accent' : 'text-danger'}`}>
                        {s.points >= 0 ? `+${s.points}` : s.points}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
