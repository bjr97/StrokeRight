import React, { useMemo, useState } from 'react';
import { storage, keys } from '../lib/storage.js';
import { Card, Button, Input, confirmAsync } from '../components/ui.jsx';
import { fmtMoney as fm } from '../lib/payouts.js';

export default function History({ session, refreshAll }) {
  const [editing, setEditing] = useState(null);
  const history = storage.get(keys.history) || [];

  const lifetime = useMemo(() => {
    const map = new Map();
    for (const h of history) {
      if (!map.has(h.winner)) map.set(h.winner, { name: h.winner, wins: 0, podiums: 0, earnings: 0 });
      const row = map.get(h.winner);
      row.wins += 1;
      row.podiums += 1;
      row.earnings += h.prize || 0;
    }
    return [...map.values()].sort((a, b) => b.earnings - a.earnings);
  }, [history]);

  function save(idx, draft) {
    const next = [...history];
    if (idx == null) next.unshift(draft);
    else next[idx] = draft;
    storage.set(keys.history, next);
    setEditing(null);
    refreshAll();
  }

  async function remove(idx) {
    const ok = await confirmAsync('Delete this record?', { danger: true, confirmLabel: 'Delete' });
    if (!ok) return;
    const next = history.filter((_, i) => i !== idx);
    storage.set(keys.history, next);
    refreshAll();
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-32 md:pb-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Past tournaments</h1>
        {session?.isAdmin && (
          <Button variant="secondary" onClick={() => setEditing({ idx: null, draft: blankRecord() })}>+ Add</Button>
        )}
      </div>

      <div className="space-y-2">
        {history.map((h, i) => (
          <Card key={h.id || i} className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">{h.name}</div>
                <div className="text-xs text-muted mt-0.5">
                  Winner: <span className="text-text">{h.winner}</span> · {h.points} pts · {fm(h.prize)}
                </div>
                <div className="text-xs text-muted mt-1">{(h.team || []).join(', ')}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-muted">{h.entries} entries</div>
                {session?.isAdmin && (
                  <div className="mt-2 flex gap-1 justify-end">
                    <button onClick={() => setEditing({ idx: i, draft: h })} className="text-xs text-muted hover:text-text">edit</button>
                    <button onClick={() => remove(i)} className="text-xs text-danger">del</button>
                  </div>
                )}
              </div>
            </div>
          </Card>
        ))}
        {!history.length && <div className="text-muted text-sm">No past tournaments yet.</div>}
      </div>

      {!!lifetime.length && (
        <div>
          <h2 className="text-sm uppercase tracking-wide text-muted mb-2">Lifetime leaderboard</h2>
          <div className="space-y-1">
            {lifetime.map((row, i) => (
              <Card key={row.name} className="p-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="w-6 text-center font-semibold tabular-nums text-muted">{i + 1}</span>
                  <div>
                    <div className="font-medium">{row.name}</div>
                    <div className="text-xs text-muted">{row.wins} wins · {row.podiums} podiums</div>
                  </div>
                </div>
                <div className="text-accent font-semibold tabular-nums">{fm(row.earnings)}</div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {editing && <EditModal record={editing} onSave={save} onCancel={() => setEditing(null)} />}
    </div>
  );
}

function blankRecord() {
  return { id: '', name: '', date: '', winner: '', team: [], points: 0, entries: 0, prize: 0 };
}

function EditModal({ record, onSave, onCancel }) {
  const [d, setD] = useState({ ...record.draft, team: (record.draft.team || []).join(', ') });

  function submit() {
    const draft = { ...d, team: d.team.split(',').map((s) => s.trim()).filter(Boolean), points: Number(d.points), entries: Number(d.entries), prize: Number(d.prize) };
    if (!draft.id) draft.id = draft.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now().toString(36);
    onSave(record.idx, draft);
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center px-4">
      <Card className="w-full max-w-md p-5 space-y-3">
        <div className="font-medium">{record.idx == null ? 'Add' : 'Edit'} tournament</div>
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
