import React, { useMemo, useState } from 'react';
import { rankEntries, scoreGolfer } from '../lib/scoring.js';
import { picksRevealed, deadlineLabel } from '../lib/gating.js';
import { Card, TierDot, StatusBadge, fmtToPar, Input } from '../components/ui.jsx';

export default function Players({ tournament, golfers, entries, onNavToLeaderboard, session }) {
  const revealed = picksRevealed(tournament, session);
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState(null);

  const opts = {
    tieredPenaltyEnabled: tournament.tieredPenaltyEnabled,
    cutLine: tournament.cutLine,
    cutBonusPoints: tournament.cutBonusPoints,
    currentRound: tournament.currentRound,
  };

  // Popularity + entries-by-golfer index
  const { popularity, entriesByGolfer } = useMemo(() => {
    const pop = new Map();
    const idx = new Map();
    for (const e of entries) {
      for (const gid of e.golferIds) {
        pop.set(gid, (pop.get(gid) || 0) + 1);
        if (!idx.has(gid)) idx.set(gid, []);
        idx.get(gid).push(e);
      }
    }
    return { popularity: pop, entriesByGolfer: idx };
  }, [entries]);

  // Sort by position: first by strokes-to-par for active golfers, then below-cut at the bottom
  const sorted = useMemo(() => {
    const active = golfers.filter((g) => g.status !== 'missed_cut' && g.status !== 'withdrawn');
    const below = golfers.filter((g) => g.status === 'missed_cut' || g.status === 'withdrawn');
    active.sort((a, b) => (a.strokesToPar ?? 0) - (b.strokesToPar ?? 0));
    below.sort((a, b) => (a.strokesToPar ?? 0) - (b.strokesToPar ?? 0));
    return { active, below };
  }, [golfers]);

  const totalEntries = Math.max(1, entries.length);
  const ranked = useMemo(() => rankEntries(entries, golfers, opts), [entries, golfers, tournament]);
  const entryRankLookup = useMemo(
    () => new Map(ranked.map((r) => [r.entry.id, { rank: r.rank, total: r.total }])),
    [ranked]
  );

  function rowsFor(list) {
    return list
      .filter((g) => !filter || g.name.toLowerCase().includes(filter.toLowerCase()))
      .map((g, i) => {
        const points = scoreGolfer(g, opts).points;
        const pop = popularity.get(g.id) || 0;
        const pct = Math.round((pop / totalEntries) * 100);
        const entriesPicking = entriesByGolfer.get(g.id) || [];
        return (
          <Card key={g.id} className="overflow-hidden">
            <button
              onClick={() => setExpanded(expanded === g.id ? null : g.id)}
              className="w-full px-3 py-2.5 flex items-center justify-between text-left hover:bg-bg"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-6 text-xs text-muted tabular-nums">{g.position || (i + 1)}</span>
                <TierDot tier={g.tier} />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{g.name}</div>
                  <div className="text-xs text-muted">
                    Today {fmtToPar(g.todayToPar)} · Thru {g.thru ?? '—'}
                    {revealed && <> · {pop} pick{pop === 1 ? '' : 's'} ({pct}%)</>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge status={g.status} won={g.won} />
                <div className="text-right">
                  <div className={`text-sm font-semibold tabular-nums ${(g.strokesToPar ?? 0) <= 0 ? 'text-accent' : 'text-text'}`}>
                    {fmtToPar(g.strokesToPar)}
                  </div>
                  <div className={`text-xs tabular-nums ${points >= 0 ? 'text-accent' : 'text-danger'}`}>
                    {points >= 0 ? `+${points}` : points} pts
                  </div>
                </div>
              </div>
            </button>
            {expanded === g.id && (
              <div className="border-t border-border bg-bg/40 px-3 py-2">
                {!revealed ? (
                  <div className="text-xs text-muted">🔒 Picks hidden until submissions lock at {deadlineLabel(tournament) || 'the deadline'}.</div>
                ) : (
                <>
                <div className="text-xs text-muted uppercase tracking-wide mb-2">Picked by ({entriesPicking.length})</div>
                {entriesPicking.length === 0 ? (
                  <div className="text-xs text-muted">No pool entries picked this golfer.</div>
                ) : (
                  <div className="space-y-1">
                    {entriesPicking.map((e) => {
                      const meta = entryRankLookup.get(e.id);
                      return (
                        <button
                          key={e.id}
                          onClick={() => onNavToLeaderboard?.(e.id)}
                          className="w-full flex items-center justify-between text-sm py-1 px-2 hover:bg-card rounded"
                        >
                          <span>
                            <span className="text-muted tabular-nums w-6 inline-block">{meta?.rank ?? '–'}</span>
                            {e.name} <span className="text-muted text-xs">Entry {e.entryNum}</span>
                          </span>
                          <span className={`tabular-nums ${(meta?.total ?? 0) >= 0 ? 'text-accent' : 'text-danger'}`}>
                            {meta ? (meta.total >= 0 ? `+${meta.total}` : meta.total) : '–'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
                </>
                )}
              </div>
            )}
          </Card>
        );
      });
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-32 md:pb-6 space-y-3">
      <Input value={filter} onChange={setFilter} placeholder={`Search ${golfers.length} golfers…`} />

      {tournament.cutLine != null && tournament.currentRound > 2 && (
        <div className="text-xs text-muted">Cut line: {fmtToPar(tournament.cutLine)}</div>
      )}

      <div className="space-y-1.5">{rowsFor(sorted.active)}</div>

      {sorted.below.length > 0 && (
        <>
          <div className="relative my-4">
            <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-danger/40"></div>
            <div className="relative inline-block bg-bg px-3 text-xs text-danger uppercase tracking-wide">Cut line</div>
          </div>
          <div className="space-y-1.5 opacity-70">{rowsFor(sorted.below)}</div>
        </>
      )}
    </div>
  );
}
