import React, { useMemo, useState } from 'react';
import { storage, keys, listTournaments } from '../lib/storage.js';
import { finalStandings } from '../lib/scoring.js';
import { fmtMoney as fm } from '../lib/payouts.js';
import { Card, Button, Input, Pill, TierDot, confirmAsync } from '../components/ui.jsx';

const TABS = [
  { key: 'majors', label: 'Past majors' },
  { key: 'strokers', label: 'Stroker leaderboard' },
  { key: 'payouts', label: 'Payouts' },
  { key: 'golfers', label: 'Golfer trends' },
  { key: 'fun', label: 'Fun stats' },
];

export default function History({ session, refreshAll }) {
  const [tab, setTab] = useState('majors');
  const [majorSort, setMajorSort] = useState('year');
  const [gSort, setGSort] = useState({ key: 'moneyWon', dir: -1 });
  const [pSort, setPSort] = useState({ key: 'timesPaid', dir: -1 });
  const [expandedId, setExpandedId] = useState(null);
  const [editing, setEditing] = useState(null);

  const history = storage.get(keys.history) || [];
  const allTournaments = listTournaments();

  // ─── Build the unified "majors" list ─────────────────────────────────────
  // "Full data" = a completed tournament that still has its entries/golfers
  // rows around, so standings can be recomputed live (always reflects the
  // latest scores, even if corrected after completion).
  // "Summary only" = a `history` row with no matching tournament left — the
  // legacy/manually-entered case where only the winner was ever recorded.
  const majors = useMemo(() => {
    const full = [];
    const fullIds = new Set();

    for (const t of allTournaments) {
      if (t.status !== 'completed') continue;
      const golfers = storage.get(keys.golfers(t.id)) || [];
      const entries = storage.get(keys.entries(t.id)) || [];
      const fs = finalStandings(t, golfers, entries);
      if (!fs) continue;
      fullIds.add(t.id);
      full.push({
        id: t.id,
        name: t.name,
        date: t.startDate || '',
        fullData: true,
        winner: fs.winnerNames,
        team: fs.team,
        points: fs.points,
        entryCount: entries.length,
        prize: fs.prize,
        ranked: fs.ranked,
        payouts: fs.payouts,
      });
    }

    const summary = history
      .filter((h) => !fullIds.has(h.id))
      .map((h) => ({
        id: h.id,
        name: h.name,
        date: h.date || '',
        fullData: false,
        winner: h.winner,
        team: h.team || [],
        points: h.points,
        entryCount: h.entries,
        prize: h.prize,
      }));

    return [...full, ...summary];
  }, [allTournaments, history]);

  const sortedMajors = useMemo(() => {
    const list = [...majors];
    if (majorSort === 'year') list.sort((a, b) => new Date(b.date) - new Date(a.date));
    else list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [majors, majorSort]);

  // ─── Stroker + golfer aggregation ────────────────────────────────────────
  // Wins & $ won: across every major (full data or summary).
  // Entries / $ spent / ROI / golfer picks: only from full-data majors —
  // that's the only place we know every stroker's entry, not just the winner's.
  const { strokerRows, golferRows, payoutRows } = useMemo(() => {
    const wins = new Map();
    const full = new Map();
    const golferCounts = new Map();
    const paid = new Map(); // name -> { timesPaid, wins, podiumOnly, placementMoney }

    for (const m of majors) {
      const winnerNames = (m.winner || '').split(' & ').map((s) => s.trim()).filter(Boolean);
      if (winnerNames.length && m.prize != null) {
        const share = m.prize / winnerNames.length;
        for (const w of winnerNames) {
          const rec = wins.get(w) || { wins: 0, moneyWon: 0 };
          rec.wins += 1;
          rec.moneyWon += share;
          wins.set(w, rec);
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
        const rec = full.get(e.name) || { entries: 0, feesPaid: 0, moneyWonFull: 0 };
        rec.entries += 1;
        rec.feesPaid += t.entryFee || 0;
        full.set(e.name, rec);
        for (const gid of e.golferIds || []) {
          const g = golferLookup.get(gid);
          if (!g) continue;
          const grec = golferCounts.get(g.name) || { count: 0, tier: g.tier };
          grec.count += 1;
          grec.tier = g.tier;
          golferCounts.set(g.name, grec);
        }
      }

      const winnerNames = (major.winner || '').split(' & ').map((s) => s.trim()).filter(Boolean);
      for (const w of winnerNames) {
        const rec = full.get(w);
        if (rec) rec.moneyWonFull = (rec.moneyWonFull || 0) + (major.prize / winnerNames.length);
      }

      // Every entry that actually got paid — not just the winning rank.
      // This is how a runner-up who cashed a payout but never won shows up.
      for (const r of major.ranked || []) {
        const payout = major.payouts.get(r.entry.id) || 0;
        if (payout <= 0) continue;
        const rec = paid.get(r.entry.name) || { timesPaid: 0, wins: 0, podiumOnly: 0, placementMoney: 0 };
        rec.timesPaid += 1;
        rec.placementMoney += payout;
        if (r.rank === 1) rec.wins += 1;
        else rec.podiumOnly += 1;
        paid.set(r.entry.name, rec);
      }
    }

    const names = new Set([...wins.keys(), ...full.keys()]);
    const strokerRows = [...names].map((name) => {
      const w = wins.get(name) || { wins: 0, moneyWon: 0 };
      const f = full.get(name);
      const roi = f && f.feesPaid > 0 ? f.moneyWonFull / f.feesPaid : null;
      return {
        name,
        wins: w.wins,
        moneyWon: w.moneyWon,
        entries: f ? f.entries : null,
        feesPaid: f ? f.feesPaid : null,
        roi,
      };
    });

    const golferRows = [...golferCounts.entries()]
      .map(([name, r]) => ({ name, count: r.count, tier: r.tier }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    const payoutRows = [...paid.entries()]
      .map(([name, r]) => ({ name, ...r }))
      .sort((a, b) => b.timesPaid - a.timesPaid);

    return { strokerRows, golferRows, payoutRows };
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

  const sortedPayouts = useMemo(() => {
    const list = [...payoutRows];
    list.sort((a, b) => {
      const av = a[pSort.key], bv = b[pSort.key];
      if (typeof av === 'string') return av.localeCompare(bv) * pSort.dir;
      return (av - bv) * pSort.dir;
    });
    return list;
  }, [payoutRows, pSort]);

  function togglePSort(key) {
    setPSort((s) => (s.key === key ? { key, dir: s.dir * -1 } : { key, dir: -1 }));
  }

  const fun = useMemo(() => {
    if (!majors.length) return null;
    const topWins = Math.max(0, ...strokerRows.map((r) => r.wins));
    const mostWins = strokerRows.filter((r) => r.wins === topWins && topWins > 0);

    let biggestPrize = null, highestScore = null, biggestField = null;
    for (const m of majors) {
      if (m.prize != null && (!biggestPrize || m.prize > biggestPrize.amount)) {
        biggestPrize = { amount: m.prize, who: m.winner, major: m.name };
      }
      if (m.points != null && (!highestScore || m.points > highestScore.points)) {
        highestScore = { points: m.points, who: m.winner, major: m.name };
      }
      if (m.entryCount != null && (!biggestField || m.entryCount > biggestField.entryCount)) {
        biggestField = { entryCount: m.entryCount, major: m.name };
      }
    }

    const withRoi = strokerRows.filter((r) => r.roi != null && r.entries > 0);
    const bestRoi = withRoi.length ? withRoi.reduce((a, b) => (b.roi > a.roi ? b : a)) : null;
    const ironMan = strokerRows
      .filter((r) => r.entries != null)
      .reduce((a, b) => ((b.entries || 0) > (a?.entries || 0) ? b : a), null);
    const topGolfer = golferRows[0] || null;

    const bridesmaids = payoutRows.filter((r) => r.podiumOnly > 0);
    const topPodiumOnly = bridesmaids.length ? Math.max(...bridesmaids.map((r) => r.podiumOnly)) : 0;
    const bridesmaid = topPodiumOnly > 0 ? bridesmaids.filter((r) => r.podiumOnly === topPodiumOnly) : [];

    return { mostWins, topWins, biggestPrize, highestScore, biggestField, bestRoi, ironMan, topGolfer, bridesmaid, topPodiumOnly };
  }, [majors, strokerRows, golferRows, payoutRows]);

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

      <Card className="p-3 text-xs text-muted space-y-1.5">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-accent inline-block" />
            <b className="text-text">Full data</b> — every entry &amp; pick preserved
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-border inline-block" />
            <b className="text-text">Summary only</b> — winner recorded, entry list not available
          </span>
        </div>
        <div>
          Stroker and golfer stats below only draw from majors with full data. Older majors still count
          toward win totals and lifetime $ won.
        </div>
      </Card>

      <div className="flex gap-2 border-b border-border overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-sm border-b-2 -mb-px whitespace-nowrap ${tab === t.key ? 'border-accent text-text' : 'border-transparent text-muted'}`}
          >
            {t.label}
          </button>
        ))}
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
          <StrokerTable rows={sortedStrokers} sort={gSort} onSort={toggleGSort} />
          <p className="text-xs text-muted">
            Entries / $ Spent / ROI only reflect majors with full data. ROI compares $ won to $ spent within
            that same set — it won't count a legacy win with no known entry cost. "—" means we don't have
            enough data yet.
          </p>
        </div>
      )}

      {tab === 'payouts' && (
        <div className="space-y-2">
          <PayoutsTable rows={sortedPayouts} sort={pSort} onSort={togglePSort} />
          <p className="text-xs text-muted">
            Every finish that actually cashed a payout, not just wins — so a runner-up who got paid but didn't
            win still shows up here. Only covers majors with full data, since summary-only majors just recorded
            the winner.
          </p>
        </div>
      )}

      {tab === 'golfers' && (
        <div className="space-y-2">
          <div className="text-sm font-medium">Most picked golfers overall</div>
          <GolferBars rows={golferRows} />
          <p className="text-xs text-muted">
            Based on majors with full pick data. This gets more meaningful every time another tournament is
            marked complete.
          </p>
        </div>
      )}

      {tab === 'fun' && <FunStats fun={fun} />}

      {editing && <EditModal record={editing} onSave={save} onCancel={() => setEditing(null)} />}
    </div>
  );
}

function MajorCard({ m, expanded, onToggleExpand, isAdmin, onEdit, onDelete }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium truncate">{m.name}</div>
          <div className="text-xs text-muted mt-0.5">{fmtDate(m.date)} · {m.entryCount ?? '—'} entries</div>
        </div>
        <Pill color={m.fullData ? 'green' : 'gray'}>{m.fullData ? 'Full data' : 'Summary only'}</Pill>
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
            return (
              <div key={r.entry.id} className="flex items-center justify-between text-xs">
                <span><span className="text-muted inline-block w-5">{r.rank}.</span>{r.entry.name}</span>
                <span className="tabular-nums">
                  {r.total >= 0 ? '+' : ''}{r.total} pts
                  {payout > 0 && <span className="text-accent ml-2">{fm(payout)}</span>}
                </span>
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

function StrokerTable({ rows, sort, onSort }) {
  const cols = [
    { key: 'name', label: 'Stroker', left: true },
    { key: 'wins', label: 'Wins' },
    { key: 'moneyWon', label: '$ Won' },
    { key: 'entries', label: 'Entries' },
    { key: 'feesPaid', label: '$ Spent' },
    { key: 'roi', label: 'ROI' },
  ];
  return (
    <Card className="p-3 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            {cols.map((c) => (
              <th
                key={c.key}
                onClick={() => onSort(c.key)}
                className={`text-[11px] uppercase tracking-wide text-muted pb-2 cursor-pointer select-none whitespace-nowrap ${c.left ? 'text-left' : 'text-right'} ${sort.key === c.key ? 'text-accent' : ''}`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-t border-border">
              <td className="py-2 pr-2">{r.name}</td>
              <td className="py-2 text-right tabular-nums">{r.wins}</td>
              <td className="py-2 text-right tabular-nums text-accent">{fm(r.moneyWon)}</td>
              <td className="py-2 text-right tabular-nums text-muted">{r.entries ?? '—'}</td>
              <td className="py-2 text-right tabular-nums text-muted">{r.feesPaid != null ? fm(r.feesPaid) : '—'}</td>
              <td className="py-2 text-right tabular-nums">{r.roi != null ? `${(r.roi * 100).toFixed(0)}%` : '—'}</td>
            </tr>
          ))}
          {!rows.length && (
            <tr><td colSpan={6} className="py-4 text-center text-muted text-sm">No data yet.</td></tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}

function PayoutsTable({ rows, sort, onSort }) {
  const cols = [
    { key: 'name', label: 'Stroker', left: true },
    { key: 'timesPaid', label: 'Times paid' },
    { key: 'wins', label: 'Wins' },
    { key: 'podiumOnly', label: 'Paid, no win' },
    { key: 'placementMoney', label: '$ From placements' },
  ];
  return (
    <Card className="p-3 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            {cols.map((c) => (
              <th
                key={c.key}
                onClick={() => onSort(c.key)}
                className={`text-[11px] uppercase tracking-wide text-muted pb-2 cursor-pointer select-none whitespace-nowrap ${c.left ? 'text-left' : 'text-right'} ${sort.key === c.key ? 'text-accent' : ''}`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-t border-border">
              <td className="py-2 pr-2">{r.name}</td>
              <td className="py-2 text-right tabular-nums">{r.timesPaid}</td>
              <td className="py-2 text-right tabular-nums">{r.wins}</td>
              <td className="py-2 text-right tabular-nums text-warn">{r.podiumOnly}</td>
              <td className="py-2 text-right tabular-nums text-accent">{fm(r.placementMoney)}</td>
            </tr>
          ))}
          {!rows.length && (
            <tr><td colSpan={5} className="py-4 text-center text-muted text-sm">No paid finishes yet.</td></tr>
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

function FunStats({ fun }) {
  if (!fun) return <div className="text-muted text-sm">No past majors yet.</div>;

  const cards = [
    {
      label: 'Most decorated',
      value: fun.mostWins.length ? fun.mostWins.map((r) => r.name).join(' & ') : '—',
      sub: fun.topWins > 0 ? `${fun.topWins} major win${fun.topWins > 1 ? 's' : ''}` : 'No wins yet',
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
  ];

  return (
    <div className="grid grid-cols-2 gap-3">
      {cards.map((c) => (
        <Card key={c.label} className="p-4">
          <div className="text-[11px] uppercase tracking-wide text-muted mb-1">{c.label}</div>
          <div className="text-lg font-semibold">{c.value}</div>
          <div className="text-xs text-muted mt-0.5">{c.sub}</div>
        </Card>
      ))}
    </div>
  );
}

function fmtDate(s) {
  if (!s) return 'TBD';
  const d = new Date(s.length <= 10 ? s + 'T00:00:00' : s);
  if (isNaN(d)) return s;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function blankRecord() {
  return { id: '', name: '', date: '', winner: '', team: [], points: 0, entries: 0, prize: 0 };
}

function EditModal({ record, onSave, onCancel }) {
  const [d, setD] = useState({ ...record.draft, team: (record.draft.team || []).join(', ') });

  function submit() {
    const draft = {
      ...d,
      team: d.team.split(',').map((s) => s.trim()).filter(Boolean),
      points: Number(d.points),
      entries: Number(d.entries),
      prize: Number(d.prize),
    };
    if (!draft.id) draft.id = draft.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now().toString(36);
    onSave(record.idx, draft);
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center px-4">
      <Card className="w-full max-w-md p-5 space-y-3">
        <div className="font-medium">{record.idx == null || record.idx < 0 ? 'Add' : 'Edit'} major (summary only)</div>
        <Input value={d.name} onChange={(v) => setD({ ...d, name: v })} placeholder="Tournament name" />
        <Input value={d.date} onChange={(v) => setD({ ...d, date: v })} placeholder="Date (YYYY-MM-DD)" />
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
