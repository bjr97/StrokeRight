import React, { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { rankEntries } from '../lib/scoring.js';
import { Card, Button } from '../components/ui.jsx';

const LINE_COLORS = ['#3FB950', '#58A6FF', '#D29922', '#F85149', '#79C0FF', '#D2D250', '#7DC991', '#8B949E'];

export default function Trends({ tournament, golfers, entries, snapshots, session }) {
  const [mode, setMode] = useState('rank'); // 'rank' | 'points'
  const ranked = useMemo(() => rankEntries(entries, golfers, {
    tieredPenaltyEnabled: tournament.tieredPenaltyEnabled,
    cutLine: tournament.cutLine,
    cutBonusPoints: tournament.cutBonusPoints,
    currentRound: tournament.currentRound,
  }), [entries, golfers, tournament]);

  // Default: user's own entries selected
  const [selected, setSelected] = useState(() => {
    const mine = ranked.filter((r) => r.entry.name.toLowerCase() === (session?.name || '').toLowerCase());
    return new Set(mine.length ? mine.map((r) => r.entry.id) : ranked.slice(0, 3).map((r) => r.entry.id));
  });

  function toggle(id) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  // Build chart data: each x-tick is a round, y is rank or cumulative points.
  // Pull from `snapshots` table + append current as round = tournament.currentRound.
  const chartData = useMemo(() => {
    const byRound = new Map();
    for (const s of snapshots || []) {
      if (!byRound.has(s.round)) byRound.set(s.round, {});
      byRound.get(s.round)[s.entryId] = { rank: s.rank, points: s.points };
    }
    // Add current round live
    const current = tournament.currentRound;
    const live = {};
    ranked.forEach((r) => (live[r.entry.id] = { rank: r.rank, points: r.total }));
    byRound.set(current, live);

    const rounds = [...byRound.keys()].sort((a, b) => a - b);
    return rounds.map((r) => {
      const point = { round: `R${r}` };
      for (const id of selected) {
        const cell = byRound.get(r)?.[id];
        point[id] = cell ? cell[mode] : null;
      }
      return point;
    });
  }, [snapshots, ranked, mode, selected, tournament.currentRound]);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-32 md:pb-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Scoring trends</h1>
        <div className="flex gap-1 bg-card border border-border rounded-lg p-1">
          <button onClick={() => setMode('rank')} className={`px-3 py-1 text-xs rounded ${mode === 'rank' ? 'bg-accent text-bg' : 'text-muted'}`}>Rank</button>
          <button onClick={() => setMode('points')} className={`px-3 py-1 text-xs rounded ${mode === 'points' ? 'bg-accent text-bg' : 'text-muted'}`}>Points</button>
        </div>
      </div>

      <Card className="p-4">
        <div style={{ width: '100%', height: 320 }}>
          <ResponsiveContainer>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#21262D" />
              <XAxis dataKey="round" stroke="#8B949E" />
              <YAxis stroke="#8B949E" reversed={mode === 'rank'} domain={mode === 'rank' ? [1, 'dataMax'] : ['dataMin', 'dataMax']} />
              <Tooltip
                contentStyle={{ background: '#161B22', border: '1px solid #21262D', borderRadius: 8 }}
                labelStyle={{ color: '#E6EDF3' }}
                formatter={(value, name) => {
                  const entry = entries.find((e) => e.id === name);
                  return [value, entry ? `${entry.name} #${entry.entryNum}` : name];
                }}
              />
              {[...selected].map((id, i) => (
                <Line key={id} type="monotone" dataKey={id} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={2} dot={{ r: 3 }} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="p-3">
        <div className="text-xs text-muted uppercase tracking-wide mb-2">Entries on chart (tap to toggle)</div>
        <div className="max-h-72 overflow-y-auto space-y-1">
          {ranked.map((row, i) => {
            const colorIdx = [...selected].indexOf(row.entry.id);
            const color = colorIdx >= 0 ? LINE_COLORS[colorIdx % LINE_COLORS.length] : '#21262D';
            return (
              <button
                key={row.entry.id}
                onClick={() => toggle(row.entry.id)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm ${selected.has(row.entry.id) ? 'bg-bg' : 'hover:bg-bg'}`}
              >
                <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                <span className="w-6 tabular-nums text-muted">{row.rank}</span>
                <span className="flex-1 text-left">{row.entry.name} <span className="text-muted text-xs">#{row.entry.entryNum}</span></span>
                <span className={`tabular-nums ${row.total >= 0 ? 'text-accent' : 'text-danger'}`}>{row.total >= 0 ? `+${row.total}` : row.total}</span>
              </button>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
