// Storage layer: in-memory cache hydrated from Supabase, mirrored to localStorage
// for offline fallback. Public API is sync (matches old window.storage shape) so
// page components don't need to change. Writes fire async upserts to Postgres.
//
// Keys that stay local-only (NOT synced):
//   - `session`             (which device/user is logged in here)
//
// Everything else maps to Supabase tables:
//   - `tournament:{id}`            → tournaments table
//   - `golfers:{tournament_id}`    → golfers table     (jsonb blob)
//   - `entries:{tournament_id}`    → entries table     (one row per entry, diffed on write)
//   - `matches:{tournament_id}`    → matches table     (1v1 matches, upserted + diffed on write)
//   - `snapshots:{tournament_id}`  → snapshots table   (one row per snapshot, full replace on write)
//   - `history`                    → history table     (one row per record, full replace on write)
//   - `admin-code`                 → app_config table  (key='admin-code')
//   - `active-tournament-id`       → app_config table  (key='active-tournament-id')
//   - `next-major`                 → app_config table  (key='next-major', {name, deadline, eventType})

import { supabase, SUPABASE_READY } from './supabase.js';

const PREFIX = 'sr:';
const LOCAL_ONLY_KEYS = new Set(['session']);

const cache = new Map();
let bootstrapped = false;
let bootstrapPromise = null;

// ─── Public API ───────────────────────────────────────────────────────────

export const storage = {
  get(key) {
    if (cache.has(key)) return cache.get(key);
    // Cold cache → fall back to localStorage (e.g., 'session' on first paint)
    const raw = localStorage.getItem(PREFIX + key);
    if (raw == null) return null;
    try {
      const parsed = JSON.parse(raw);
      cache.set(key, parsed);
      return parsed;
    } catch { return raw; }
  },

  set(key, value) {
    const prev = cache.get(key);
    cache.set(key, value);
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch {}
    if (!LOCAL_ONLY_KEYS.has(key) && SUPABASE_READY) {
      syncToSupabase(key, value, prev).catch((err) =>
        console.error('[supabase sync]', key, err)
      );
    }
  },

  delete(key) {
    const prev = cache.get(key);
    cache.delete(key);
    try { localStorage.removeItem(PREFIX + key); } catch {}
    if (!LOCAL_ONLY_KEYS.has(key) && SUPABASE_READY) {
      syncDeleteToSupabase(key, prev).catch((err) =>
        console.error('[supabase delete]', key, err)
      );
    }
  },

  list(prefix = '') {
    return [...cache.keys()].filter((k) => k.startsWith(prefix));
  },
};

export const keys = {
  tournament:    (id) => `tournament:${id}`,
  golfers:       (id) => `golfers:${id}`,
  entries:       (id) => `entries:${id}`,
  matches:       (id) => `matches:${id}`,
  scores:        (id) => `scores:${id}`,
  snapshots:     (id) => `snapshots:${id}`,
  recap:         (id) => `recap:${id}`, // { rounds: { "1": "text", ... }, final: "text" | null } — read-only, written by the recap serverless functions
  history:       'history',
  adminCode:     'admin-code',
  activeTournId: 'active-tournament-id',
  nextMajor:     'next-major',
  session:       'session',
};

export function getActiveTournamentId() {
  return storage.get(keys.activeTournId);
}

export function setActiveTournamentId(id) {
  storage.set(keys.activeTournId, id);
}

export function listTournaments() {
  return [...cache.keys()]
    .filter((k) => k.startsWith('tournament:'))
    .map((k) => cache.get(k))
    .filter(Boolean);
}

// ─── Boot: pull everything from Supabase into the cache ──────────────────

export function bootstrap() {
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = hydrate();
  return bootstrapPromise;
}

async function hydrate() {
  // Always hydrate `session` from localStorage (it's local-only)
  const localSession = localStorage.getItem(PREFIX + 'session');
  if (localSession) {
    try { cache.set('session', JSON.parse(localSession)); } catch {}
  }

  if (!SUPABASE_READY) {
    console.warn('[StrokeRight] Supabase env not configured. Running in localStorage-only mode.');
    bootstrapped = true;
    return;
  }

  console.log('[StrokeRight] hydrating from Supabase…');
  const [tournR, golfR, entR, matchR, snapR, histR, cfgR, recapR] = await Promise.all([
    supabase.from('tournaments').select('*'),
    supabase.from('golfers').select('*'),
    supabase.from('entries').select('*').order('created_at', { ascending: true }),
    supabase.from('matches').select('*').order('created_at', { ascending: true }),
    supabase.from('snapshots').select('*'),
    supabase.from('history').select('*').order('date', { ascending: false }),
    supabase.from('app_config').select('*'),
    supabase.from('recaps').select('*'),
  ]);

  for (const [label, r] of [
    ['tournaments', tournR], ['golfers', golfR], ['entries', entR], ['matches', matchR],
    ['snapshots', snapR], ['history', histR], ['app_config', cfgR], ['recaps', recapR],
  ]) {
    if (r.error) {
      console.error(`[StrokeRight] ${label} fetch error:`, r.error);
    } else {
      console.log(`[StrokeRight] ${label}: ${r.data?.length ?? 0} rows`);
    }
  }

  for (const row of tournR.data || []) {
    cache.set(`tournament:${row.id}`, fromTournamentRow(row));
  }
  for (const row of golfR.data || []) {
    cache.set(`golfers:${row.tournament_id}`, row.data || []);
  }
  const entriesByT = groupBy(entR.data || [], 'tournament_id');
  for (const [tId, rows] of entriesByT) {
    cache.set(`entries:${tId}`, rows.map(fromEntryRow));
  }
  const matchesByT = groupBy(matchR.data || [], 'tournament_id');
  for (const [tId, rows] of matchesByT) {
    cache.set(`matches:${tId}`, rows.map(fromMatchRow));
  }
  const snapsByT = groupBy(snapR.data || [], 'tournament_id');
  for (const [tId, rows] of snapsByT) {
    cache.set(`snapshots:${tId}`, rows.map(fromSnapshotRow));
  }
  cache.set('history', (histR.data || []).map(fromHistoryRow));
  for (const row of cfgR.data || []) {
    cache.set(row.key, row.value);
  }
  for (const row of recapR.data || []) {
    cache.set(`recap:${row.tournament_id}`, { rounds: row.rounds || {}, final: row.final || null });
  }

  bootstrapped = true;
}

// ─── Sync writes to Supabase ─────────────────────────────────────────────

async function syncToSupabase(key, value, prev) {
  if (key.startsWith('tournament:')) {
    const { error } = await supabase.from('tournaments').upsert(toTournamentRow(value));
    if (error) throw error;
    return;
  }

  if (key.startsWith('golfers:')) {
    const tId = key.slice('golfers:'.length);
    const { error } = await supabase.from('golfers').upsert({
      tournament_id: tId,
      data: value,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    return;
  }

  if (key.startsWith('entries:')) {
    const tId = key.slice('entries:'.length);
    const prevIds = new Set((prev || []).map((e) => e.id));
    const nextIds = new Set(value.map((e) => e.id));
    const added   = value.filter((e) => !prevIds.has(e.id));
    const removed = (prev || []).filter((e) => !nextIds.has(e.id));

    if (added.length) {
      const { error } = await supabase
        .from('entries')
        .insert(added.map((e) => toEntryRow(e, tId)));
      if (error) throw error;
    }
    if (removed.length) {
      const { error } = await supabase
        .from('entries')
        .delete()
        .in('id', removed.map((e) => e.id));
      if (error) throw error;
    }
    return;
  }

  if (key.startsWith('matches:')) {
    const tId = key.slice('matches:'.length);
    // Matches mutate in place (accept, each draft pick), unlike entries —
    // upsert the whole current array on every write rather than diffing
    // added-only. Cheap: a tournament only ever has a handful of these.
    const nextIds = new Set(value.map((m) => m.id));
    const removed = (prev || []).filter((m) => !nextIds.has(m.id));

    if (value.length) {
      const { error } = await supabase
        .from('matches')
        .upsert(value.map((m) => toMatchRow(m, tId)));
      if (error) throw error;
    }
    if (removed.length) {
      const { error } = await supabase
        .from('matches')
        .delete()
        .in('id', removed.map((m) => m.id));
      if (error) throw error;
    }
    return;
  }

  if (key.startsWith('snapshots:')) {
    const tId = key.slice('snapshots:'.length);
    // Replace strategy: delete then bulk insert. Cheap for small N.
    const { error: delErr } = await supabase.from('snapshots').delete().eq('tournament_id', tId);
    if (delErr) throw delErr;
    if (value.length) {
      const { error } = await supabase
        .from('snapshots')
        .insert(value.map((s) => toSnapshotRow(s, tId)));
      if (error) throw error;
    }
    return;
  }

  if (key === 'history') {
    // Replace all history rows
    const { error: delErr } = await supabase
      .from('history')
      .delete()
      .gte('id', ''); // matches all
    if (delErr) throw delErr;
    if (value.length) {
      const { error } = await supabase.from('history').insert(value.map(toHistoryRow));
      if (error) throw error;
    }
    return;
  }

  if (key.startsWith('scores:')) {
    // We don't currently persist scores cache; skip.
    return;
  }

  // Default: stash in app_config (covers admin-code, active-tournament-id, etc.)
  const { error } = await supabase.from('app_config').upsert({
    key,
    value,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

async function syncDeleteToSupabase(key) {
  if (key.startsWith('tournament:')) {
    const id = key.slice('tournament:'.length);
    await supabase.from('tournaments').delete().eq('id', id);
    return;
  }
  if (key.startsWith('golfers:')) {
    const id = key.slice('golfers:'.length);
    await supabase.from('golfers').delete().eq('tournament_id', id);
    return;
  }
  if (key.startsWith('entries:')) {
    const id = key.slice('entries:'.length);
    await supabase.from('entries').delete().eq('tournament_id', id);
    return;
  }
  if (key.startsWith('matches:')) {
    const id = key.slice('matches:'.length);
    await supabase.from('matches').delete().eq('tournament_id', id);
    return;
  }
  if (key.startsWith('snapshots:')) {
    const id = key.slice('snapshots:'.length);
    await supabase.from('snapshots').delete().eq('tournament_id', id);
    return;
  }
  if (key === 'history') {
    await supabase.from('history').delete().gte('id', '');
    return;
  }
  // Default: app_config
  await supabase.from('app_config').delete().eq('key', key);
}

// ─── Refresh: pull latest from Supabase (called on tab focus, etc.) ──────

export async function refresh() {
  if (!SUPABASE_READY) return;
  bootstrapPromise = null;
  bootstrapped = false;
  await bootstrap();
}

// ─── Row ↔ App-shape converters ──────────────────────────────────────────

function toTournamentRow(t) {
  return {
    id: t.id,
    name: t.name,
    course: t.course,
    start_date: t.startDate,
    deadline: t.deadline,
    pool_code: t.poolCode,
    entry_fee: t.entryFee ?? 10,
    tiered_penalty_enabled: !!t.tieredPenaltyEnabled,
    cut_line: t.cutLine,
    cut_bonus_points: t.cutBonusPoints ?? 3,
    current_round: t.currentRound ?? 1,
    status: t.status ?? 'setup',
    tier_labels: t.tierLabels,
    event_type: t.eventType || 'other',
    updated_at: new Date().toISOString(),
  };
}
function fromTournamentRow(r) {
  return {
    id: r.id,
    name: r.name,
    course: r.course,
    startDate: r.start_date,
    deadline: r.deadline,
    poolCode: r.pool_code,
    entryFee: r.entry_fee,
    tieredPenaltyEnabled: r.tiered_penalty_enabled,
    cutLine: r.cut_line,
    cutBonusPoints: r.cut_bonus_points ?? 3,
    currentRound: r.current_round,
    status: r.status,
    tierLabels: r.tier_labels,
    eventType: r.event_type || 'other',
  };
}

function toEntryRow(e, tId) {
  return {
    id: e.id,
    tournament_id: tId,
    name: e.name,
    entry_num: e.entryNum ?? 1,
    golfer_ids: e.golferIds,
    down_tier_skipped: e.downTierSkipped ?? null,
    created_at: e.createdAt || new Date().toISOString(),
  };
}
function fromEntryRow(r) {
  return {
    id: r.id,
    name: r.name,
    entryNum: r.entry_num,
    golferIds: r.golfer_ids,
    downTierSkipped: r.down_tier_skipped,
    createdAt: r.created_at,
  };
}

function toMatchRow(m, tId) {
  return {
    id: m.id,
    tournament_id: tId,
    challenger_name: m.challengerName,
    opponent_name: m.opponentName,
    amount: m.amount,
    status: m.status,
    first_picker: m.firstPicker ?? null,
    challenger_picks: m.challengerPicks || [],
    opponent_picks: m.opponentPicks || [],
    updated_at: new Date().toISOString(),
  };
}
function fromMatchRow(r) {
  return {
    id: r.id,
    challengerName: r.challenger_name,
    opponentName: r.opponent_name,
    amount: r.amount,
    status: r.status,
    firstPicker: r.first_picker,
    challengerPicks: r.challenger_picks || [],
    opponentPicks: r.opponent_picks || [],
    createdAt: r.created_at,
  };
}

function toSnapshotRow(s, tId) {
  return {
    tournament_id: tId,
    entry_id: s.entryId,
    round: s.round,
    points: s.points,
    rank: s.rank,
  };
}
function fromSnapshotRow(r) {
  return { entryId: r.entry_id, round: r.round, points: r.points, rank: r.rank };
}

function toHistoryRow(h) {
  return {
    id: h.id,
    name: h.name,
    date: h.date,
    winner: h.winner,
    team: h.team,
    points: h.points,
    entries: h.entries,
    prize: h.prize,
    event_type: h.eventType || 'other',
  };
}
function fromHistoryRow(r) {
  return {
    id: r.id,
    name: r.name,
    date: r.date,
    winner: r.winner,
    team: r.team || [],
    points: r.points,
    entries: r.entries,
    prize: r.prize,
    eventType: r.event_type || 'other',
  };
}

function groupBy(rows, field) {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r[field])) map.set(r[field], []);
    map.get(r[field]).push(r);
  }
  return map;
}
