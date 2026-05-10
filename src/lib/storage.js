// localStorage wrapper that mimics the claude.ai `window.storage` API surface.
// Same method names (get/set/delete/list) so the spec's storage keys plug in unchanged.

const PREFIX = 'sr:';

export const storage = {
  get(key) {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw == null) return null;
    try { return JSON.parse(raw); } catch { return raw; }
  },
  set(key, value) {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  },
  delete(key) {
    localStorage.removeItem(PREFIX + key);
  },
  list(prefix = '') {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX + prefix)) out.push(k.slice(PREFIX.length));
    }
    return out;
  },
};

// Typed helpers for the spec's known keys.
export const keys = {
  tournament: (id) => `tournament:${id}`,
  golfers:    (id) => `golfers:${id}`,
  entries:    (id) => `entries:${id}`,
  scores:     (id) => `scores:${id}`,
  snapshots:  (id) => `snapshots:${id}`,
  history:        'history',
  adminCode:      'admin-code',
  activeTournId:  'active-tournament-id',
  session:        'session',
};

export function getActiveTournamentId() {
  return storage.get(keys.activeTournId);
}

export function setActiveTournamentId(id) {
  storage.set(keys.activeTournId, id);
}

export function listTournaments() {
  return storage.list('tournament:').map((k) => storage.get(k)).filter(Boolean);
}
