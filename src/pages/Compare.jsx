import React, { useMemo, useState } from 'react';
import { rankEntries } from '../lib/scoring.js';
import { picksRevealed, deadlineLabel } from '../lib/gating.js';
import { Card, Pill } from '../components/ui.jsx';

export default function Compare({ tournament, golfers, entries, session }) {
  if (!picksRevealed(tournament, session)) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10">
        <Card className="p-6 text-center">
          <div className="text-warn font-medium mb-2">🔒 Comparison locked</div>
          <div className="text-sm text-muted">
            Other people's picks are hidden until submissions lock at <span className="text-text">{deadlineLabel(tournament) || 'the deadline'}</span>. Come back after — you'll be able to compare side-by-side with any entry then.
          </div>
        </Card>
      </div>
    );
  }

  const ranked = useMemo(() => rankEntries(entries, golfers, {
    tieredPenaltyEnabled: tournament.tieredPenaltyEnabled,
    cutLine: tournament.cutLine,
    currentRound: tournament.currentRound,
  }), [entries, golfers, tournament]);

  const [aId, setAId] = useState(ranked[0]?.entry.id || '');
  const [bId, setBId] = useState(ranked[1]?.entry.id || '');

  const a = ranked.find((r) => r.entry.id === aId);
  const b = ranked.find((r) => r.entry.id === bId);

  // Popularity
  const popularity = useMemo(() => {
    const m = new Map();
    for (const e of entries) for (const gid of e.golferIds) m.set(gid, (m.get(gid) || 0) + 1);
    return m;
  }, [entries]);
  const sortedPop = [...popularity.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8);
  const totalEntries = Math.max(1, entries.length);

  // Most contrarian / most chalk
  const { contrarian, chalk } = useMemo(() => {
    let bestContr = null, bestChalk = null, bestContrSum = Infinity, bestChalkSum = -Infinity;
    for (const e of entries) {
      const sum = e.golferIds.reduce((s, gid) => s + (popularity.get(gid) || 0), 0);
      if (sum < bestContrSum) { bestContrSum = sum; bestContr = e; }
      if (sum > bestChalkSum) { bestChalkSum = sum; bestChalk = e; }
    }
    return {
      contrarian: bestContr ? { entry: bestContr, overlap: Math.round((bestContrSum / (e6(bestContr) * totalEntries)) * 100) } : null,
      chalk:      bestChalk ? { entry: bestChalk, overlap: Math.round((bestChalkSum / (e6(bestChalk) * totalEntries)) * 100) } : null,
    };
  }, [entries, popularity, totalEntries]);

  if (!a || !b) {
    return <div className="max-w-2xl mx-auto px-4 py-6 text-muted text-sm">Need at least 2 entries to compare.</div>;
  }

  const aSet = new Set(a.entry.golferIds);
  const bSet = new Set(b.entry.golferIds);
  const shared = a.entry.golferIds.filter((id) => bSet.has(id));
  const aOnly = a.entry.golferIds.filter((id) => !bSet.has(id));
  const bOnly = b.entry.golferIds.filter((id) => !aSet.has(id));

  const lookup = new Map(golfers.map((g) => [g.id, g]));
  function pts(id) {
    return a.scored.concat(b.scored).find((s) => s.golfer.id === id)?.points ?? 0;
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-32 md:pb-6 space-y-4">
      <div className="text-xs uppercase tracking-wide text-muted">Select entries to compare</div>
      <div className="grid grid-cols-2 gap-2">
        <EntrySelect ranked={ranked} value={aId} onChange={setAId} accent="accent" />
        <EntrySelect ranked={ranked} value={bId} onChange={setBId} accent="danger" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card className="p-4">
          <div className="text-xs text-accent uppercase tracking-wide mb-2">Your edge — root for</div>
          <div className="space-y-1">
            {aOnly.map((id) => (
              <Row key={id} name={lookup.get(id)?.name} pts={pts(id)} positive />
            ))}
            {!aOnly.length && <div className="text-xs text-muted">No unique picks</div>}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-danger uppercase tracking-wide mb-2">Their edge — root against</div>
          <div className="space-y-1">
            {bOnly.map((id) => (
              <Row key={id} name={lookup.get(id)?.name} pts={pts(id)} negative />
            ))}
            {!bOnly.length && <div className="text-xs text-muted">No unique picks</div>}
          </div>
        </Card>
      </div>

      <Card className="p-4">
        <div className="text-xs text-muted uppercase tracking-wide mb-2">Shared golfers (cancel out)</div>
        <div className="space-y-1">
          {shared.map((id) => (
            <Row key={id} name={lookup.get(id)?.name} pts={pts(id)} muted />
          ))}
          {!shared.length && <div className="text-xs text-muted">No overlap</div>}
        </div>
      </Card>

      <Card className="p-4 flex items-center justify-between">
        <div>
          <div className="text-xs text-muted">Your total</div>
          <div className="text-xl font-semibold text-accent tabular-nums">{a.total >= 0 ? `+${a.total}` : a.total}</div>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted">Their total</div>
          <div className="text-xl font-semibold text-danger tabular-nums">{b.total >= 0 ? `+${b.total}` : b.total}</div>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted">Gap</div>
          <div className={`text-xl font-semibold tabular-nums ${a.total >= b.total ? 'text-accent' : 'text-danger'}`}>
            {a.total - b.total >= 0 ? `+${a.total - b.total}` : a.total - b.total}
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <div className="text-xs text-muted uppercase tracking-wide mb-3">Golfer popularity (all {totalEntries} entries)</div>
        <div className="space-y-1.5">
          {sortedPop.map(([gid, count]) => {
            const pct = Math.round((count / totalEntries) * 100);
            return (
              <div key={gid} className="text-sm">
                <div className="flex justify-between mb-0.5">
                  <span>{lookup.get(gid)?.name}</span>
                  <span className="text-muted tabular-nums">{pct}%</span>
                </div>
                <div className="h-1.5 bg-border rounded-full overflow-hidden">
                  <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <Card className="p-4">
          <div className="text-xs text-muted uppercase tracking-wide mb-1">Most contrarian</div>
          <div className="font-medium">{contrarian?.entry.name} <span className="text-xs text-muted">Entry {contrarian?.entry.entryNum}</span></div>
          <div className="text-xs text-muted">Lowest avg overlap with field</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted uppercase tracking-wide mb-1">Most chalk</div>
          <div className="font-medium">{chalk?.entry.name} <span className="text-xs text-muted">Entry {chalk?.entry.entryNum}</span></div>
          <div className="text-xs text-muted">Most popular picks in the field</div>
        </Card>
      </div>
    </div>
  );
}

function EntrySelect({ ranked, value, onChange, accent }) {
  const accentClass = accent === 'accent' ? 'border-accent/50 text-accent' : 'border-danger/50 text-danger';
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full bg-card border rounded-lg px-3 py-2 text-sm ${accentClass}`}
    >
      {ranked.map((r) => (
        <option key={r.entry.id} value={r.entry.id}>
          {r.entry.name} (Entry {r.entry.entryNum}) — {r.total >= 0 ? `+${r.total}` : r.total}
        </option>
      ))}
    </select>
  );
}

function Row({ name, pts, positive, negative, muted }) {
  const color = positive ? 'text-accent' : negative ? 'text-danger' : 'text-muted';
  return (
    <div className="flex justify-between text-sm">
      <span className={muted ? 'text-muted' : ''}>{name}</span>
      <span className={`tabular-nums ${color}`}>{pts >= 0 ? `+${pts}` : pts}</span>
    </div>
  );
}

function e6() { return 6; }
