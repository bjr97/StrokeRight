import React, { useMemo, useState } from 'react';
import { rankEntries } from '../lib/scoring.js';
import { computePayouts, fmtMoney } from '../lib/payouts.js';
import { computeWinProbabilities } from '../lib/winProb.js';
import { picksRevealed, deadlineLabel } from '../lib/gating.js';
import { Card, Stat, Pill, StatusBadge, TierDot, fmtToPar, Input } from '../components/ui.jsx';

// Human-readable labels for each breakdown line item.
// Only non-zero entries are shown in the popup.
const BREAKDOWN_LABELS = {
  strokesUnderPar: 'Strokes under par',
  cutBonus: 'Made cut bonus',
  cutPenalty: 'Missed cut penalty',
  wdPenalty: 'Withdrawal penalty',
  winBonus: 'Winner bonus',
  tieredPenalty: 'Cut-line tiered penalty',
};

function ScoreBreakdownModal({ scored, onClose }) {
  if (!scored) return null;
  const { golfer, points, breakdown } = scored;
  const lines = Object.entries(breakdown || {}).filter(([, v]) => v !== 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-xl w-full max-w-sm p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <TierDot tier={golfer.tier} />
            <span className="font-medium">{golfer.name}</span>
            <span className="text-muted text-xs tabular-nums">{fmtToPar(golfer.strokesToPar)}</span>
          </div>
          <button onClick={onClose} className="text-muted hover:text-fg text-sm px-2">✕</button>
        </div>

        <div className="space-y-1 mb-3">
          {lines.length === 0 && (
            <div className="text-sm text-muted">No scoring events yet.</div>
          )}
          {lines.map(([key, value]) => (
            <div key={key} className="flex items-center justify-between text-sm py-1">
              <span className="text-muted">{BREAKDOWN_LABELS[key] || key}</span>
              <span className={`tabular-nums ${value >= 0 ? 'text-accent' : 'text-danger'}`}>
                {value >= 0 ? `+${value}` : value}
              </span>
            </div>
          ))}
        </div>

        <div className="border-t border-border pt-2 flex items-center justify-between">
          <span className="text-sm font-medium">Total</span>
          <span className={`text-lg font-semibold tabular-nums ${points >= 0 ? 'text-accent' : 'text-danger'}`}>
            {points >= 0 ? `+${points}` : points}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function Leaderboard({ tournament, golfers, entries, snapshots, session }) {
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [breakdownFor, setBreakdownFor] = useState(null); // { golfer, points, breakdown }

  const revealed = picksRevealed(tournament, session);

  const ranked = useMemo(() => rankEntries(entries, golfers, {
    tieredPenaltyEnabled: tournament.tieredPenaltyEnabled,
    cutLine: tournament.cutLine,
    currentRound: tournament.currentRound,
  }), [entries, golfers, tournament]);

  const probs = useMemo(() => computeWinProbabilities(ranked, golfers, {
    roundsRemaining: Math.max(0, 4 - (tournament.currentRound || 1)),
  }), [ranked, golfers, tournament]);

  const { payouts, structure } = computePayouts(ranked, entries.length, tournament.entryFee);

  // Position change since last snapshot
  const prevRanks = useMemo(() => {
    const lastSnap = (snapshots || []).filter((s) => s.round === (tournament.currentRound - 1));
    return new Map(lastSnap.map((s) => [s.entryId, s.rank]));
  }, [snapshots, tournament.currentRound]);

  // Pre-deadline: alphabetize by name so order doesn't hint at scores.
  // Post-deadline: keep the score-ranked order.
  const list = revealed
    ? ranked
    : [...ranked].sort((a, b) => a.entry.name.localeCompare(b.entry.name));

  const filtered = list.filter((r) => !filter || r.entry.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-32 md:pb-6 space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Prize pool" value={fmtMoney(structure.pool)} valueClass="text-accent" />
        <Stat label={`R${tournament.currentRound}`} value={tournament.currentRound ? `Live` : 'Pre-tourney'} valueClass="text-warn" />
        <Stat label="Entries" value={entries.length} />
      </div>

      {!revealed && (
        <Card className="p-4 border-warn/40 bg-warn/5">
          <div className="text-warn text-sm font-medium">🔒 Picks hidden until submissions lock</div>
          <div className="text-xs text-muted mt-1">
            Other entries become visible at {deadlineLabel(tournament) || 'the deadline'}. You can see who's submitted, but not their golfers.
          </div>
        </Card>
      )}

      <Input value={filter} onChange={setFilter} placeholder="Filter by name…" />

      <div className="space-y-1">
        {filtered.map((row) => {
          const prevRank = prevRanks.get(row.entry.id);
          const change = prevRank ? prevRank - row.rank : 0;
          const payout = payouts.get(row.entry.id);
          const prob = probs.get(row.entry.id);
          const isMine = row.entry.name.toLowerCase() === (session?.name || '').toLowerCase();
          const showDetails = revealed || isMine;

          return (
            <Card key={row.entry.id} className="overflow-hidden">
              <button
                onClick={() => showDetails && setExpanded(expanded === row.entry.id ? null : row.entry.id)}
                className={`w-full text-left px-3 py-3 flex items-center justify-between transition ${showDetails ? 'hover:bg-bg cursor-pointer' : 'cursor-default'}`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  {revealed ? (
                    <span className="w-6 text-center font-semibold tabular-nums text-muted">{row.rank}</span>
                  ) : (
                    <span className="w-6 text-center text-muted">·</span>
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{row.entry.name}</span>
                      <span className="text-xs text-muted">Entry {row.entry.entryNum}</span>
                      {isMine && !revealed && <Pill color="green">you</Pill>}
                      {revealed && change > 0 && <span className="text-xs text-accent">↑{change}</span>}
                      {revealed && change < 0 && <span className="text-xs text-danger">↓{-change}</span>}
                    </div>
                    {revealed && payout > 0 && (
                      <div className="text-xs text-accent">{fmtMoney(payout)} projected</div>
                    )}
                    {!revealed && (
                      <div className="text-xs text-muted">{isMine ? 'tap to view your picks' : 'picks hidden'}</div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  {revealed && prob != null && (
                    <div className="text-right">
                      <div className="text-xs text-muted">win</div>
                      <div className="text-sm tabular-nums">{(prob * 100).toFixed(1)}%</div>
                    </div>
                  )}
                  {revealed ? (
                    <div className={`text-lg font-semibold tabular-nums ${row.total >= 0 ? 'text-accent' : 'text-danger'}`}>
                      {row.total >= 0 ? `+${row.total}` : row.total}
                    </div>
                  ) : (
                    <div className="text-lg text-muted">—</div>
                  )}
                </div>
              </button>

              {expanded === row.entry.id && showDetails && (
                <div className="border-t border-border bg-bg/50 px-3 py-2 space-y-1">
                  {row.scored.map((s) => (
                    <div key={s.golfer.id} className="flex items-center justify-between text-sm py-1">
                      <span className="flex items-center gap-2">
                        <TierDot tier={s.golfer.tier} />
                        <span>{s.golfer.name}</span>
                        <span className="text-muted text-xs tabular-nums">{fmtToPar(s.golfer.strokesToPar)}</span>
                        <StatusBadge status={s.golfer.status} />
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setBreakdownFor(s);
                        }}
                        className={`tabular-nums text-sm underline decoration-dotted underline-offset-2 hover:opacity-80 ${s.points >= 0 ? 'text-accent' : 'text-danger'}`}
                      >
                        {s.points >= 0 ? `+${s.points}` : s.points}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <ScoreBreakdownModal scored={breakdownFor} onClose={() => setBreakdownFor(null)} />
    </div>
  );
}
