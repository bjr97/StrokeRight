import React, { useState, useEffect } from 'react';
import { storage, keys, listTournaments, setActiveTournamentId, getActiveTournamentId } from '../lib/storage.js';
import { seedDemoMasters } from '../lib/seedData.js';
import { finalStandings } from '../lib/scoring.js';
import { fmtMoney } from '../lib/payouts.js';
import { Card, Button, Input, Select, Pill, TierDot, TIER_COLORS, fmtToPar, confirmAsync, alertAsync } from '../components/ui.jsx';
import { EVENT_TYPES, autoTournamentName } from '../lib/eventTypes.js';

export default function Admin({ tournament, golfers, refreshAll }) {
  const [tab, setTab] = useState(tournament ? 'manage' : 'create');

  // Previously a parent-level remount reset this whenever `tournament`
  // changed identity (e.g. after "Mark tournament complete" clears the
  // active tournament). That remount also wiped every other page's local
  // UI state on any background refresh, so it's gone now — this replaces
  // just the one thing it was actually needed for here.
  useEffect(() => {
    if (!tournament && (tab === 'tiers' || tab === 'live')) setTab('manage');
  }, [tournament, tab]);

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
    name: '', startDate: '', deadline: '', poolCode: '', course: '', eventType: 'other',
  });

  const nameLocked = form.eventType !== 'other';
  const computedName = autoTournamentName(form.eventType, form.startDate);

  async function save() {
    if (nameLocked && !computedName) {
      return alertAsync('Pick a start date first so the name can be generated — or choose "Other" to type a name manually.');
    }
    const name = nameLocked ? computedName : form.name;
    if (!name || !form.poolCode) return alertAsync('Name and pool code are required');
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) + '-' + Date.now().toString(36);
    const t = {
      id,
      name,
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
      eventType: form.eventType,
    };
    storage.set(keys.tournament(id), t);
    storage.set(keys.golfers(id), []);
    storage.set(keys.entries(id), []);
    setActiveTournamentId(id);
    refreshAll();
  }

  return (
    <Card className="p-5 space-y-4">
      <Field label="Event type"><Select value={form.eventType} onChange={(v) => setForm({ ...form, eventType: v })} options={EVENT_TYPES} className="w-full" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Start date"><Input type="date" value={form.startDate} onChange={(v) => setForm({ ...form, startDate: v })} /></Field>
        <Field label="Deadline (Wed 11:59 pm)"><Input type="datetime-local" value={form.deadline} onChange={(v) => setForm({ ...form, deadline: v })} /></Field>
      </div>
      <Field label="Tournament name">
        {nameLocked ? (
          <div className="px-3 py-2 bg-bg border border-border rounded-lg text-sm">
            {computedName || <span className="text-muted">Set a start date above to generate the name</span>}
          </div>
        ) : (
          <Input value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="e.g. 2026 Member-Guest Classic" />
        )}
      </Field>
      <Field label="Course"><Input value={form.course} onChange={(v) => setForm({ ...form, course: v })} placeholder="Quail Hollow" /></Field>
      <Field label="Pool code (share with participants)"><Input value={form.poolCode} onChange={(v) => setForm({ ...form, poolCode: v })} placeholder="masters26" /></Field>
      <Button onClick={save}>Create tournament</Button>
    </Card>
  );
}

function ManageTournaments({ active, refreshAll }) {
  const all = listTournaments();
  const activeId = getActiveTournamentId();

  async function loadDemo() {
    const ok = await confirmAsync(
      'Load the demo 2026 Masters tournament into Supabase? This will be visible to everyone in your pool. You can delete it later.',
      { confirmLabel: 'Load demo' }
    );
    if (!ok) return;
    await seedDemoMasters();
    setTimeout(refreshAll, 300);
  }

  if (!all.length) {
    return (
      <div className="space-y-3">
        <NextMajorCard refreshAll={refreshAll} />
        <Card className="p-5 text-muted text-sm">
          No tournaments yet. Click <span className="text-text">New</span> to create one, or load demo data below to see the app populated.
        </Card>
        <Button variant="secondary" onClick={loadDemo}>Load demo 2026 Masters tournament</Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <NextMajorCard refreshAll={refreshAll} />
      {all.map((t) => (
        <Card key={t.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium">{t.name}</span>
              {t.id === activeId && <Pill color="green">Active</Pill>}
              <Pill color={t.status === 'live' ? 'amber' : t.status === 'completed' ? 'green' : 'gray'}>{t.status}</Pill>
            </div>
            <div className="text-xs text-muted mt-1">Code: <code className="text-text">{t.poolCode}</code> · Deadline {t.deadline || 'TBD'}</div>
            <div className="mt-2">
              <Select
                value={t.eventType || 'other'}
                onChange={(v) => { storage.set(keys.tournament(t.id), { ...t, eventType: v }); refreshAll(); }}
                options={EVENT_TYPES}
                className="text-xs py-1"
              />
            </div>
          </div>
          <div className="flex gap-2">
            {t.id !== activeId && (
              <Button variant="secondary" onClick={() => { setActiveTournamentId(t.id); refreshAll(); }}>Activate</Button>
            )}
            <Button
              variant="danger"
              onClick={async () => {
                const ok = await confirmAsync(`Delete ${t.name}? This wipes entries and scores.`, { danger: true, confirmLabel: 'Delete' });
                if (!ok) return;
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

function NextMajorCard({ refreshAll }) {
  const saved = storage.get(keys.nextMajor) || null;
  const [eventType, setEventType] = useState(saved?.eventType || 'other');
  const [name, setName] = useState(saved?.name || '');
  const [deadline, setDeadline] = useState(saved?.deadline || '');

  const nameLocked = eventType !== 'other';
  const computedName = autoTournamentName(eventType, deadline);

  async function save() {
    if (nameLocked && !computedName) {
      return alertAsync('Set a picks-due date first so the name can be generated — or choose "Other" to type a name manually.');
    }
    const finalName = nameLocked ? computedName : name;
    if (!finalName || !deadline) return alertAsync('Enter both a name and a picks-due date & time.');
    storage.set(keys.nextMajor, { name: finalName, deadline, eventType });
    refreshAll();
  }

  async function clear() {
    const ok = await confirmAsync('Clear the next-major countdown override?', { confirmLabel: 'Clear' });
    if (!ok) return;
    storage.delete(keys.nextMajor);
    setEventType('other');
    setName('');
    setDeadline('');
    refreshAll();
  }

  return (
    <Card className="p-4 space-y-2">
      <div className="text-sm font-medium">Next major countdown (homepage)</div>
      <div className="text-xs text-muted">
        Shows a countdown on everyone's homepage until this deadline. Meant for bridging the gap before
        you've created the actual tournament — once a tournament exists with its own deadline, that takes
        over automatically, but this stays saved until you clear it, so remember to clear it once it's no
        longer needed. Event type also drives the "defending champ" line under the countdown, so set it
        if you can.
      </div>
      <Select value={eventType} onChange={setEventType} options={EVENT_TYPES} className="w-full" />
      <Input type="datetime-local" value={deadline} onChange={setDeadline} placeholder="Picks-due date & time" />
      {nameLocked ? (
        <div className="px-3 py-2 bg-bg border border-border rounded-lg text-sm">
          {computedName || <span className="text-muted">Set a picks-due date above to generate the name</span>}
        </div>
      ) : (
        <Input value={name} onChange={setName} placeholder="Major name (e.g. 2026 Member-Guest Classic)" />
      )}
      <div className="flex gap-2">
        <Button onClick={save}>Save</Button>
        {saved && <Button variant="ghost" onClick={clear}>Clear</Button>}
      </div>
    </Card>
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

  async function save() {
    storage.set(keys.golfers(tournament.id), draft);
    refreshAll();
    await alertAsync('Saved.');
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
  const entries = storage.get(keys.entries(tournament.id)) || [];

  // These start from the tournament prop but only capture it once (useState
  // initializers only run on mount). Re-sync whenever the underlying data
  // actually changes (e.g. an ESPN refresh or another admin's edit lands),
  // rather than relying on the parent to force a full remount to pick it up —
  // that remount approach was also nuking unrelated UI state (like History's
  // active tab) on every background refresh.
  useEffect(() => {
    setRound(tournament.currentRound);
    setCutLine(tournament.cutLine ?? '');
  }, [tournament.id, tournament.currentRound, tournament.cutLine]);

  async function completeTournament() {
    if (!entries.length) return alertAsync('No entries yet — nothing to finalize.');

    const fs = finalStandings(tournament, golfers, entries);
    const { winnerNames, team, points, prize } = fs;

    const stillPlaying = golfers.some((g) => g.status === 'playing');
    const warning = stillPlaying
      ? '\n\n⚠️ Some golfers are still marked "Playing" — scores may not be final.'
      : '';

    const ok = await confirmAsync(
      `Mark "${tournament.name}" complete and file it under History?\n\n` +
      `Winner: ${winnerNames}\nScore: ${points >= 0 ? '+' + points : points}\n` +
      `Prize: ${fmtMoney(prize)}\nEntries: ${entries.length}${warning}\n\n` +
      `This clears it as the active tournament. You can still edit or delete the ` +
      `History entry afterward.`,
      { danger: true, confirmLabel: 'Mark complete' }
    );
    if (!ok) return;

    const record = {
      id: tournament.id,
      name: tournament.name,
      date: tournament.startDate || new Date().toISOString().slice(0, 10),
      winner: winnerNames,
      team,
      points,
      entries: entries.length,
      prize,
    };
    const history = storage.get(keys.history) || [];
    storage.set(keys.history, [record, ...history.filter((h) => h.id !== record.id)]);

    storage.set(keys.tournament(tournament.id), { ...tournament, status: 'completed' });
    if (getActiveTournamentId() === tournament.id) storage.delete(keys.activeTournId);

    refreshAll();
    await alertAsync('Tournament marked complete and added to History.');
  }

  async function reactivate() {
    const ok = await confirmAsync(
      `Reactivate "${tournament.name}"? This sets its status back to live. It won't remove the History record — delete that separately on the History tab if you want.`,
      { confirmLabel: 'Reactivate' }
    );
    if (!ok) return;
    storage.set(keys.tournament(tournament.id), { ...tournament, status: 'live' });
    setActiveTournamentId(tournament.id);
    refreshAll();
  }

  function save() {
    storage.set(keys.tournament(tournament.id), { ...tournament, currentRound: Number(round), cutLine: cutLine === '' ? null : Number(cutLine) });
    refreshAll();
  }

  function togglePenalty() {
    storage.set(keys.tournament(tournament.id), { ...tournament, tieredPenaltyEnabled: !tournament.tieredPenaltyEnabled });
    refreshAll();
  }

  async function applyCutToAll() {
    if (cutLine === '') return alertAsync('Enter and save a cut line first.');
    const line = Number(cutLine);
    // Only touch golfers who aren't already withdrawn — never override a WD status.
    const eligible = golfers.filter((g) => g.status !== 'withdrawn');
    const madeCut = eligible.filter((g) => (g.strokesToPar ?? 0) <= line).length;
    const missedCut = eligible.length - madeCut;

    const ok = await confirmAsync(
      `Apply cut line of ${line >= 0 ? '+' + line : line} to ${eligible.length} golfers?\n\n${madeCut} will be set to Made cut\n${missedCut} will be set to Missed cut\n\nGolfers already marked Withdrawn won't be touched.`,
      { confirmLabel: 'Apply' }
    );
    if (!ok) return;

    const upd = golfers.map((g) => {
      if (g.status === 'withdrawn') return g;
      return { ...g, status: (g.strokesToPar ?? 0) <= line ? 'made_cut' : 'missed_cut' };
    });
    storage.set(keys.golfers(tournament.id), upd);
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
        <div className="text-sm font-medium">Apply cut to all golfers</div>
        <div className="text-xs text-muted">
          After Round 2, once the cut line above is set and saved, click this to set every golfer's status
          in one shot — anyone at or better than the cut line becomes Made cut, everyone else becomes Missed cut.
          Golfers already marked Withdrawn are left alone.
        </div>
        <Button variant="secondary" onClick={applyCutToAll}>Apply cut line to all golfers</Button>
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

      <Card className="p-4 space-y-2">
        <div className="flex items-center gap-2">
          <div className="text-sm font-medium">Finish tournament</div>
          {tournament.status === 'completed' && <Pill color="green">completed</Pill>}
        </div>
        {tournament.status === 'completed' ? (
          <>
            <div className="text-xs text-muted">
              This tournament is filed under History and is no longer active.
            </div>
            <Button variant="secondary" onClick={reactivate}>Reactivate</Button>
          </>
        ) : (
          <>
            <div className="text-xs text-muted">
              Once the final round is in and the winner is set above, click this to compute
              final standings and payouts, file a summary under History, and clear this as
              the active tournament.
            </div>
            <Button variant="danger" onClick={completeTournament}>Mark tournament complete</Button>
          </>
        )}
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
