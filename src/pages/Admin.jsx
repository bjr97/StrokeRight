import React, { useState, useEffect } from 'react';
import { storage, keys, listTournaments, setActiveTournamentId, getActiveTournamentId } from '../lib/storage.js';
import { seedDemoMasters } from '../lib/seedData.js';
import { finalStandings } from '../lib/scoring.js';
import { fmtMoney } from '../lib/payouts.js';
import { Card, Button, Input, Select, Pill, TierDot, TIER_COLORS, fmtToPar, confirmAsync, alertAsync } from '../components/ui.jsx';
import { EVENT_TYPES, autoTournamentName, fixedCourse, eventTypeLabel, eventTypeEmoji } from '../lib/eventTypes.js';
import { autoTierByOdds } from '../lib/tiering.js';

// Event types with a live odds feed available (The Odds API free tier only
// covers the 4 real majors — everything else still uses the manual paste).
const LIVE_ODDS_SPORT_KEYS = {
  masters: 'golf_masters_tournament_winner',
  pga: 'golf_pga_championship_winner',
  us_open: 'golf_us_open_winner',
  open: 'golf_the_open_championship_winner',
};

// Prefers the active tournament, falls back to the first non-completed one
// (completed tournaments are hidden from the picker by default — see
// TournamentPicker — so defaulting to one would be a confusing dead end).
function pickDefaultId(tournaments, activeId) {
  if (activeId && tournaments.some((t) => t.id === activeId)) return activeId;
  const nonCompleted = tournaments.find((t) => (t.status || 'setup') !== 'completed');
  return nonCompleted?.id ?? tournaments[0]?.id ?? null;
}

export default function Admin({ tournament, refreshAll }) {
  const [tab, setTab] = useState(tournament ? 'manage' : 'create');
  const allTournaments = listTournaments();
  const activeId = getActiveTournamentId();
  const allIds = allTournaments.map((t) => t.id).join(',');

  // Tiers and Live controls used to be locked to whichever tournament is
  // "active" (the one shown pool-wide). That meant you couldn't set up tiers
  // for a tournament ahead of activating it, or fix up a just-completed one's
  // scoring, without re-activating it first. This lets the Edit tab target
  // any tournament in the list independently of what's currently active.
  const [selectedId, setSelectedId] = useState(() => pickDefaultId(allTournaments, activeId));
  useEffect(() => {
    if (!allTournaments.length) { setSelectedId(null); return; }
    if (!allTournaments.some((t) => t.id === selectedId)) {
      setSelectedId(pickDefaultId(allTournaments, getActiveTournamentId()));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allIds]);

  const selectedTournament = selectedId ? storage.get(keys.tournament(selectedId)) : null;
  const selectedGolfers = selectedId ? (storage.get(keys.golfers(selectedId)) || []) : [];

  useEffect(() => {
    if (!allTournaments.length && tab === 'edit') setTab('manage');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allIds, tab]);

  function editTournament(id) {
    setSelectedId(id);
    setTab('edit');
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-32 md:pb-6 space-y-6">
      <div>
        <div className="text-xs text-warn uppercase tracking-wide">Admin</div>
        <h1 className="text-2xl font-semibold">Tournament control</h1>
      </div>

      <div className="flex gap-2 border-b border-border">
        {['manage', 'edit', 'create'].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm border-b-2 -mb-px ${tab === t ? 'border-accent text-text' : 'border-transparent text-muted'}`}
          >
            {t === 'manage' ? 'Manage' : t === 'edit' ? 'Edit' : 'New'}
          </button>
        ))}
      </div>

      {tab === 'edit' && !!allTournaments.length && (
        <TournamentPicker tournaments={allTournaments} activeId={activeId} selectedId={selectedId} onChange={setSelectedId} />
      )}

      {tab === 'create' && <CreateTournament refreshAll={refreshAll} onDone={() => setTab('manage')} />}
      {tab === 'manage' && <ManageTournaments active={tournament} refreshAll={refreshAll} onEdit={editTournament} />}
      {tab === 'edit' && selectedTournament && (
        <div className="space-y-6">
          <div>
            <h2 className="text-sm font-semibold text-text mb-2">Live controls</h2>
            <LiveControls key={`${selectedTournament.id}-live`} tournament={selectedTournament} golfers={selectedGolfers} refreshAll={refreshAll} />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-text mb-2">Tiers</h2>
            <TierManager key={`${selectedTournament.id}-tiers`} tournament={selectedTournament} golfers={selectedGolfers} refreshAll={refreshAll} />
          </div>
        </div>
      )}
      {tab === 'edit' && !allTournaments.length && (
        <Card className="p-5 text-muted text-sm">
          No tournaments yet. Click <span className="text-text">New</span> to create one.
        </Card>
      )}
    </div>
  );
}

function TournamentPicker({ tournaments, activeId, selectedId, onChange }) {
  // Completed events are hidden here by default (there are usually a dozen+
  // of them and they rarely need touching) — except whichever one is
  // currently selected, so following an Edit link from Manage to a completed
  // tournament doesn't immediately bounce the picker to something else.
  const filtered = tournaments.filter((t) => (t.status || 'setup') !== 'completed' || t.id === selectedId);
  const options = filtered.map((t) => ({
    value: t.id,
    label: `${t.name} — ${t.status}${t.id === activeId ? ' • Active' : ''}`,
  }));
  return (
    <Card className="p-3">
      <Field label="Managing event">
        <Select value={selectedId ?? ''} onChange={onChange} options={options} className="w-full" />
      </Field>
    </Card>
  );
}

// 11:59 PM local time, the calendar day before `startDate` — datetime-local
// format (no seconds/timezone) to match how this field is stored elsewhere.
function computeDeadline(startDate) {
  if (!startDate) return '';
  const d = new Date(`${startDate}T00:00:00`); // local midnight, not UTC — avoids a day-shift
  d.setDate(d.getDate() - 1);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T23:59`;
}

function formatDeadlinePreview(deadline) {
  if (!deadline) return '';
  const d = new Date(deadline);
  const datePart = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const timePart = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${datePart} · ${timePart}`;
}

function CreateTournament({ refreshAll, onDone }) {
  const [form, setForm] = useState({
    name: '', startDate: '', poolCode: '', course: '', eventType: 'other', tieredPenaltyEnabled: true,
  });
  // Once the tournament record exists, step 2 reuses TierManager against it
  // directly — the field import is skippable (you can always add it later
  // from Edit), so this just tracks whether we've moved past step 1, not
  // whether tiers were actually set.
  const [createdTournament, setCreatedTournament] = useState(null);

  const nameLocked = form.eventType !== 'other';
  const computedName = autoTournamentName(form.eventType, form.startDate);
  const computedDeadline = computeDeadline(form.startDate);
  const courseLocked = fixedCourse(form.eventType);

  async function save() {
    if (nameLocked && !computedName) {
      return alertAsync('Pick a start date first so the name can be generated — or choose "Other" to type a name manually.');
    }
    const name = nameLocked ? computedName : form.name;
    if (!name || !form.poolCode) return alertAsync('Name and pool code are required');
    if (!computedDeadline) return alertAsync('Pick a start date first so the deadline can be computed.');
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) + '-' + Date.now().toString(36);
    const t = {
      id,
      name,
      course: courseLocked || form.course,
      startDate: form.startDate,
      deadline: computedDeadline,
      poolCode: form.poolCode,
      entryFee: 10,
      tieredPenaltyEnabled: form.tieredPenaltyEnabled,
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
    setCreatedTournament(t);
  }

  if (createdTournament) {
    return (
      <div className="space-y-4">
        <Card className="p-4">
          <div className="text-xs text-warn uppercase tracking-wide">Step 2 of 2</div>
          <div className="font-medium mt-0.5">"{createdTournament.name}" created — import the field</div>
          <div className="text-xs text-muted mt-1">Optional — skip this and add the field anytime from Edit.</div>
        </Card>
        <TierManager tournament={createdTournament} golfers={[]} refreshAll={refreshAll} />
        <Button variant="ghost" onClick={onDone}>Done — go to Manage</Button>
      </div>
    );
  }

  return (
    <Card className="p-5 space-y-4">
      <div className="text-xs text-warn uppercase tracking-wide">Step 1 of 2</div>
      <Field label="Event type"><Select value={form.eventType} onChange={(v) => setForm({ ...form, eventType: v })} options={EVENT_TYPES} className="w-full" /></Field>
      <Field label="Start date"><Input type="date" value={form.startDate} onChange={(v) => setForm({ ...form, startDate: v })} /></Field>
      <Field label="Picks deadline (auto: 11:59 PM the day before start)">
        <div className="px-3 py-2 bg-bg border border-border rounded-lg text-sm">
          {computedDeadline
            ? formatDeadlinePreview(computedDeadline)
            : <span className="text-muted">Set a start date above to compute the deadline</span>}
        </div>
      </Field>
      <Field label="Tournament name">
        {nameLocked ? (
          <div className="px-3 py-2 bg-bg border border-border rounded-lg text-sm">
            {computedName || <span className="text-muted">Set a start date above to generate the name</span>}
          </div>
        ) : (
          <Input value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="e.g. 2026 Member-Guest Classic" />
        )}
      </Field>
      <Field label="Course">
        {courseLocked ? (
          <div className="px-3 py-2 bg-bg border border-border rounded-lg text-sm">{courseLocked}</div>
        ) : (
          <Input value={form.course} onChange={(v) => setForm({ ...form, course: v })} placeholder="Quail Hollow" />
        )}
      </Field>
      <Field label="Pool code (share with participants)"><Input value={form.poolCode} onChange={(v) => setForm({ ...form, poolCode: v })} placeholder="masters26" /></Field>
      <Field label="Tiered cut-line penalty (Rules 7–8)">
        <button
          type="button"
          onClick={() => setForm({ ...form, tieredPenaltyEnabled: !form.tieredPenaltyEnabled })}
          className={`px-3 py-1.5 rounded-lg text-sm ${form.tieredPenaltyEnabled ? 'bg-accent text-bg' : 'bg-border text-muted'}`}
        >
          {form.tieredPenaltyEnabled ? 'On' : 'Off'}
        </button>
      </Field>
      <Button onClick={save}>Create tournament — continue to tiers</Button>
    </Card>
  );
}

const STATUS_OPTIONS = [
  { value: 'setup', label: 'Upcoming', activeClass: 'bg-border text-text border-border' },
  { value: 'live', label: 'Live', activeClass: 'bg-warn/15 text-warn border-warn/30' },
  { value: 'completed', label: 'Completed', activeClass: 'bg-accent/15 text-accent border-accent/30' },
];

// Group order for the "All" view — upcoming/live surfaced above completed,
// matching the lifecycle progression rather than however listTournaments()
// happens to return them.
const STATUS_SORT_RANK = { setup: 0, live: 1, completed: 2 };

function ManageTournaments({ active, refreshAll, onEdit }) {
  const all = listTournaments();
  const activeId = getActiveTournamentId();
  const [statusFilter, setStatusFilter] = useState('all');

  const visible = statusFilter === 'all'
    ? [...all].sort((a, b) => (STATUS_SORT_RANK[a.status || 'setup'] ?? 0) - (STATUS_SORT_RANK[b.status || 'setup'] ?? 0))
    : all.filter((t) => (t.status || 'setup') === statusFilter);

  // A quick label toggle — not the same ceremony as Live Controls' "Mark
  // tournament complete" (which also computes final standings and can file a
  // History summary). Home/History pull completed-tournament data live from
  // status + entries/golfers (see buildMajors()), so flipping this label is
  // enough on its own. The one thing worth mirroring: clearing the pool-wide
  // active id when a tournament is toggled to completed, so a finished event
  // doesn't linger as "the" active tournament shown to everyone.
  function setStatus(t, status) {
    storage.set(keys.tournament(t.id), { ...t, status });
    if (status === 'completed' && activeId === t.id) storage.delete(keys.activeTournId);
    refreshAll();
  }

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

      <div className="flex items-center gap-1">
        {[{ value: 'all', label: 'All' }, ...STATUS_OPTIONS].map((s) => (
          <button
            key={s.value}
            onClick={() => setStatusFilter(s.value)}
            className={`px-2.5 py-1 rounded-lg text-xs border transition ${
              statusFilter === s.value ? 'bg-accent text-bg border-accent' : 'border-border text-muted hover:text-text'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {visible.map((t) => (
        <Card key={t.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium">{t.name}</span>
              {t.id === activeId && <Pill color="green">Active</Pill>}
              <span className="text-xs text-muted">{eventTypeEmoji(t.eventType)} {eventTypeLabel(t.eventType)}</span>
            </div>
            <div className="text-xs text-muted mt-1">Code: <code className="text-text">{t.poolCode}</code> · Deadline {t.deadline || 'TBD'}</div>
            <div className="flex items-center gap-1 mt-2">
              {STATUS_OPTIONS.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setStatus(t, s.value)}
                  className={`px-2 py-0.5 rounded-full text-xs border transition ${
                    (t.status || 'setup') === s.value ? s.activeClass : 'border-border text-muted hover:text-text'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            {t.id !== activeId && (
              <Button variant="secondary" onClick={() => { setActiveTournamentId(t.id); refreshAll(); }}>Activate</Button>
            )}
            <Button variant="secondary" onClick={() => onEdit(t.id)}>Edit</Button>
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
      <div className="flex gap-2">
        <Select value={eventType} onChange={setEventType} options={EVENT_TYPES} className="flex-1" />
        <Input type="datetime-local" value={deadline} onChange={setDeadline} className="flex-1" />
      </div>
      <div className="flex gap-2">
        {nameLocked ? (
          <div className="flex-1 min-w-0 px-3 py-2 bg-bg border border-border rounded-lg text-sm truncate">
            {computedName || <span className="text-muted">Set a date above</span>}
          </div>
        ) : (
          <Input value={name} onChange={setName} placeholder="Major name" className="flex-1" />
        )}
        <Button onClick={save}>Save</Button>
        {saved && <Button variant="ghost" onClick={clear}>Clear</Button>}
      </div>
    </Card>
  );
}

function TierManager({ tournament, golfers, refreshAll }) {
  const [draft, setDraft] = useState(golfers || []);
  const [bulkText, setBulkText] = useState('');
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState('');

  const liveOddsSportKey = LIVE_ODDS_SPORT_KEYS[tournament.eventType];

  function importList(rawGolfers) {
    const withIds = rawGolfers.map((g, i) => ({
      id: `g${i + 1}`, name: g.name, odds: g.odds, tier: 1, strokesToPar: 0, status: 'playing',
    }));
    setDraft(autoTierByOdds(withIds));
  }

  function importBulk() {
    // Format: "Player Name, +450" per line
    const lines = bulkText.split('\n').map((l) => l.trim()).filter(Boolean);
    const list = lines.map((line) => {
      const [name, odds] = line.split(',').map((s) => s.trim());
      return { name, odds };
    });
    importList(list);
  }

  async function fetchLiveOdds() {
    setFetching(true);
    setFetchError('');
    try {
      const res = await fetch(`/api/fetch-golf-odds?eventType=${tournament.eventType}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      if (!data.golfers?.length) throw new Error('No odds returned yet — the board may not be posted for this event.');
      importList(data.golfers);
    } catch (err) {
      setFetchError(String(err.message || err));
    } finally {
      setFetching(false);
    }
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
        <>
          {liveOddsSportKey && (
            <Card className="p-4 space-y-3">
              <div className="text-sm">
                Live odds are available for this event type via The Odds API.
              </div>
              <Button onClick={fetchLiveOdds} disabled={fetching}>
                {fetching ? 'Fetching…' : 'Fetch live odds + auto-tier'}
              </Button>
              {fetchError && <div className="text-xs text-danger">{fetchError}</div>}
            </Card>
          )}
          <Card className="p-4 space-y-3">
            <div className="text-sm">
              {liveOddsSportKey ? 'Or paste the field manually' : 'Paste the field'} — one golfer per line, `Name, +odds`:
            </div>
            <textarea
              className="w-full h-40 bg-bg border border-border rounded-lg p-3 font-mono text-sm"
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              placeholder={`Scottie Scheffler, +450\nRory McIlroy, +600\n...`}
            />
            <Button onClick={importBulk}>Import + auto-tier</Button>
          </Card>
        </>
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
    storage.set(keys.tournament(tournament.id), {
      ...tournament,
      currentRound: Number(round),
      cutLine: cutLine === '' ? null : Number(cutLine),
    });
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
