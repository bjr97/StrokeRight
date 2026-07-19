import React, { useState } from 'react';
import { storage, keys, listTournaments, setActiveTournamentId, getActiveTournamentId } from '../lib/storage.js';
import { seedDemoMasters } from '../lib/seedData.js';
import { Card, Button, Input, Pill, TierDot, TIER_COLORS, fmtToPar } from '../components/ui.jsx';

export default function Admin({ tournament, golfers, refreshAll }) {
  const [tab, setTab] = useState(tournament ? 'manage' : 'create');

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-32 md:pb-6 space-y-6">
      <div>
        <div className="text-xs text-warn uppercase tracking-wide">Admin</div>
        <h1 className="text-2xl font-semibold">Tournament control</h1>
      </div>

      <div className="flex gap-2 border-b border-border">
        {['manage', 'tiers', 'create', 'live'].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm border-b-2 -mb-px ${tab === t ? 'border-accent text-text' : 'border-transparent text-muted'}`}
          >
            {t === 'manage' ? 'Manage' : t === 'tiers' ? 'Tiers' : t === 'create' ? 'New' : 'Live controls'}
          </button>
        ))}
      </div>

      {tab === 'create' && <CreateTournament refreshAll={refreshAll} />}
      {tab === 'manage' && <ManageTournaments active={tournament} refreshAll={refreshAll} />}
      {tab === 'tiers' && tournament && <TierManager tournament={tournament} golfers={golfers} refreshAll={refreshAll} />}
      {tab === 'live' && tournament && <LiveControls tournament={tournament} golfers={golfers} refreshAll={refreshAll} />}
    </div>
  );
}

function CreateTournament({ refreshAll }) {
  const [form, setForm] = useState({
    name: '', startDate: '', deadline: '', poolCode: '', course: '',
  });

  function save() {
    if (!form.name || !form.poolCode) return alert('Name and pool code are required');
    const id = form.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) + '-' + Date.now().toString(36);
    const t = {
      id,
      name: form.name,
      course: form.course,
      startDate: form.startDate,
      deadline: form.deadline,
      poolCode: form.poolCode,
      entryFee: 10,
      tieredPenaltyEnabled: false,
      cutLine: null,
      currentRound: 1,
      status: 'setup',
      tierLabels: ['Dark blue', 'Orange', 'Dark green', 'Light blue', 'Light green', 'Yellow'],
    };
    storage.set(keys.tournament(id), t);
    storage.set(keys.golfers(id), []);
    storage.set(keys.entries(id), []);
    setActiveTournamentId(id);
    refreshAll();
  }

  return (
    <Card className="p-5 space-y-4">
      <Field label="Tournament name"><Input value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="2026 PGA Championship" /></Field>
      <Field label="Course"><Input value={form.course} onChange={(v) => setForm({ ...form, course: v })} placeholder="Quail Hollow" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Start date"><Input type="date" value={form.startDate} onChange={(v) => setForm({ ...form, startDate: v })} /></Field>
        <Field label="Deadline (Wed 11:59 pm)"><Input type="datetime-local" value={form.deadline} onChange={(v) => setForm({ ...form, deadline: v })} /></Field>
      </div>
      <Field label="Pool code (share with participants)"><Input value={form.poolCode} onChange={(v) => setForm({ ...form, poolCode: v })} placeholder="masters26" /></Field>
      <Button onClick={save}>Create tournament</Button>
    </Card>
  );
}

function ManageTournaments({ active, refreshAll }) {
  const all = listTournaments();
  const activeId = getActiveTournamentId();

  function loadDemo() {
    if (!confirm('Load the demo 2026 Masters tournament into Supabase? This will be visible to everyone in your pool. You can delete it later.')) return;
    seedDemoMasters();
    setTimeout(refreshAll, 300);
  }

  if (!all.length) {
    return (
      <div className="space-y-3">
        <Card className="p-5 text-muted text-sm">
          No tournaments yet. Click <span className="text-text">New</span> to create one, or load demo data below to see the app populated.
        </Card>
        <Button variant="secondary" onClick={loadDemo}>Load demo 2026 Masters tournament</Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {all.map((t) => (
        <Card key={t.id} className="p-4 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium">{t.name}</span>
              {t.id === activeId && <Pill color="green">Active</Pill>}
              <Pill color={t.status === 'live' ? 'amber' : 'gray'}>{t.status}</Pill>
            </div>
            <div className="text-xs text-muted mt-1">Code: <code className="text-text">{t.poolCode}</code> · Deadline {t.deadline || 'TBD'}</div>
          </div>
          <div className="flex gap-2">
            {t.id !== activeId && (
              <Button variant="secondary" onClick={() => { setActiveTournamentId(t.id); refreshAll(); }}>Activate</Button>
            )}
            <Button
              variant="danger"
              onClick={() => {
                if (!confirm(`Delete ${t.name}? This wipes entries and scores.`)) return;
                storage.delete(keys.tournament(t.id));
                storage.delete(keys.golfers(t.id));
                storage.delete(keys.entries(t.id));
                storage.delete(keys.scores(t.id));
                storage.delete(keys.snapshots(t.id));
                if (activeId === t.id) storage.delete(keys.activeTournId);
                refreshAll();
              }}
            >Delete</Button>
          </div>
        </Card>
      ))}
    </div>
  );
}

function TierManager({ tournament, golfers, refreshAll }) {
  const [draft, setDraft] = useState(golfers || []);
  const [bulkText, setBulkText] = useState('');

  function importBulk() {
    // Format: "Player Name, +450" per line
    const lines = bulkText.split('\n').map((l) => l.trim()).filter(Boolean);
    const list = lines.map((line, i) => {
      const [name, odds] = line.split(',').map((s) => s.trim());
      return { id: `g${i + 1}`, name, odds, tier: 1, strokesToPar: 0, status: 'playing' };
    });
    // Auto-tier by odds: split into 6 roughly-equal buckets
    list.sort((a, b) => oddsToNum(a.odds) - oddsToNum(b.odds));
    const perTier = Math.ceil(list.length / 6);
    list.forEach((g, i) => (g.tier = Math.min(6, Math.floor(i / perTier) + 1)));
    setDraft(list);
  }

  function move(id, dir) {
    setDraft((d) => d.map((g) => {
      if (g.id !== id) return g;
      const next = Math.max(1, Math.min(6, g.tier + dir));
      return { ...g, tier: next };
    }));
  }

  function save() {
    storage.set(keys.golfers(tournament.id), draft);
    refreshAll();
    alert('Saved.');
  }

  return (
    <div className="space-y-4">
      {!draft.length && (
        <Card className="p-4 space-y-3">
          <div className="text-sm">Paste the field — one golfer per line, `Name, +odds`:</div>
          <textarea
            className="w-full h-40 bg-bg border border-border rounded-lg p-3 font-mono text-sm"
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder={`Scottie Scheffler, +450\nRory McIlroy, +600\n...`}
          />
          <Button onClick={importBulk}>Import + auto-tier</Button>
        </Card>
      )}

      {!!draft.length && (
        <>
          {[1, 2, 3, 4, 5, 6].map((tier) => (
            <Card key={tier} className="p-3">
              <div className="flex items-center gap-2 mb-2">
                <TierDot tier={tier} />
                <span className="font-medium">Tier {tier} — {tournament.tierLabels[tier - 1]}</span>
                <span className="text-xs text-muted">({draft.filter((g) => g.tier === tier).length})</span>
              </div>
              <div className="space-y-1">
                {draft.filter((g) => g.tier === tier).map((g) => (
                  <div key={g.id} className="flex items-center justify-between text-sm py-1 px-2 hover:bg-bg rounded">
                    <span>{g.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-muted tabular-nums">{g.odds}</span>
                      <button onClick={() => move(g.id, -1)} disabled={tier === 1} className="text-muted hover:text-text disabled:opacity-30 px-1">↑</button>
                      <button onClick={() => move(g.id, +1)} disabled={tier === 6} className="text-muted hover:text-text disabled:opacity-30 px-1">↓</button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
          <Button onClick={save}>Save tier assignments</Button>
        </>
      )}
    </div>
  );
}

function LiveControls({ tournament, golfers, refreshAll }) {
  const [round, setRound] = useState(tournament.currentRound);
  const [cutLine, setCutLine] = useState(tournament.cutLine ?? '');

  function save() {
    storage.set(keys.tournament(tournament.id), { ...tournament, currentRound: Number(round), cutLine: cutLine === '' ? null : Number(cutLine) });
    refreshAll();
  }

  function togglePenalty() {
    storage.set(keys.tournament(tournament.id), { ...tournament, tieredPenaltyEnabled: !tournament.tieredPenaltyEnabled });
    refreshAll();
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">Tiered penalty scoring (Rule 8)</div>
            <div className="text-xs text-muted mt-0.5">Optional. Applies penalty bands starting Round 3 based on strokes over the cut line, for golfers who made the cut.</div>
          </div>
          <button onClick={togglePenalty} className={`px-3 py-1.5 rounded-lg text-sm ${tournament.tieredPenaltyEnabled ? 'bg-accent text-bg' : 'bg-border text-muted'}`}>
            {tournament.tieredPenaltyEnabled ? 'On' : 'Off'}
          </button>
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <Field label="Current round (1–4)"><Input type="number" value={round} onChange={setRound} /></Field>
        <Field label="Cut line (over par). Leave blank to auto-detect."><Input type="number" value={cutLine} onChange={setCutLine} placeholder="6" /></Field>
        <Button onClick={save}>Save</Button>
      </Card>

      <Card className="p-4 space-y-2">
        <div className="text-sm font-medium">Tournament winner</div>
        <div className="text-xs text-muted">Grants the winner the +3 bonus. Setting one winner clears any previous one.</div>
        <select
          value={golfers.find((g) => g.won)?.id ?? ''}
          onChange={(e) => {
            const winnerId = e.target.value;
            const upd = golfers.map((x) => ({ ...x, won: x.id === winnerId }));
            storage.set(keys.golfers(tournament.id), upd);
            refreshAll();
          }}
          className="w-full bg-bg border border-border rounded px-2 py-2 text-sm"
        >
          <option value="">— No winner set —</option>
          {golfers.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
      </Card>

      <Card className="p-4">
        <div className="text-sm font-medium mb-2">Manually adjust golfer status</div>
        <div className="text-xs text-muted mb-3">Use this when ESPN data is missing or wrong (e.g., late withdrawals).</div>
        <div className="max-h-96 overflow-y-auto space-y-1">
          {golfers.map((g) => (
            <div key={g.id} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2"><TierDot tier={g.tier} />{g.name}</span>
              <select
                value={g.status}
                onChange={(e) => {
                  const upd = golfers.map((x) => x.id === g.id ? { ...x, status: e.target.value } : x);
                  storage.set(keys.golfers(tournament.id), upd);
                  refreshAll();
                }}
                className="bg-bg border border-border rounded px-2 py-1 text-xs"
              >
                <option value="playing">Playing</option>
                <option value="made_cut">Made cut</option>
                <option value="missed_cut">Missed cut</option>
                <option value="withdrawn">Withdrawn</option>
              </select>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-muted uppercase tracking-wide">{label}</span>
      {children}
    </label>
  );
}

function oddsToNum(odds) {
  if (!odds) return 99999;
  const n = parseInt(String(odds).replace(/[+]/, ''), 10);
  return Number.isFinite(n) ? n : 99999;
}
