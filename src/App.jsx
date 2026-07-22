import React, { useEffect, useMemo, useState } from 'react';
import { storage, keys, getActiveTournamentId, bootstrap, refresh } from './lib/storage.js';
import { SUPABASE_READY } from './lib/supabase.js';
import { fetchEspnScoreboard, normalizeEspn } from './lib/espnApi.js';
import { nextTurn, isDraftComplete } from './lib/matches.js';
import Rules from './pages/Rules.jsx';
import AuthGate from './components/AuthGate.jsx';
import Nav from './components/Nav.jsx';
import Home from './pages/Home.jsx';
import Submit from './pages/Submit.jsx';
import Leaderboard from './pages/Leaderboard.jsx';
import Players from './pages/Players.jsx';
import Analysis from './pages/Analysis.jsx';
import Matches from './pages/Matches.jsx';
import History from './pages/History.jsx';
import Admin from './pages/Admin.jsx';
import { Card, Button, Input, alertAsync } from './components/ui.jsx';

export default function App() {
  const [bootstrapped, setBootstrapped] = useState(false);
  const [bootError, setBootError] = useState(null);
  const [page, setPage] = useState('home');
  const [analysisTab, setAnalysisTab] = useState('trends');
  const [session, setSession] = useState(null);
  const [adminPending, setAdminPending] = useState(false);
  const [tick, setTick] = useState(0);

  // Trends and Compare used to be separate pages, now both live under
  // Analysis — translate old nav targets (e.g. Home's "Compare teams" link)
  // to the right Analysis sub-tab instead of a dead page id.
  function navigateTo(target) {
    if (target === 'compare' || target === 'trends') {
      setAnalysisTab(target);
      setPage('analysis');
      return;
    }
    setPage(target);
  }

  // Hydrate from Supabase on mount
  useEffect(() => {
    bootstrap()
      .then(() => {
        setSession(storage.get(keys.session));
        setBootstrapped(true);
      })
      .catch((err) => {
        console.error(err);
        setBootError(err.message || 'Failed to load data from Supabase');
        setBootstrapped(true);
      });
  }, []);

  // Pull fresh data when tab regains focus
  useEffect(() => {
    function onFocus() {
      if (!bootstrapped || !SUPABASE_READY) return;
      refresh().then(() => setTick((t) => t + 1)).catch(() => {});
    }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [bootstrapped]);

  const refreshAll = () => setTick((t) => t + 1);

  const tournamentId = getActiveTournamentId();
  const tournament = tournamentId ? storage.get(keys.tournament(tournamentId)) : null;
  const golfers   = tournamentId ? (storage.get(keys.golfers(tournamentId)) || []) : [];
  const entries   = tournamentId ? (storage.get(keys.entries(tournamentId)) || []) : [];
  const matches   = tournamentId ? (storage.get(keys.matches(tournamentId)) || []) : [];
  const snapshots = tournamentId ? (storage.get(keys.snapshots(tournamentId)) || []) : [];

  // Red-dot trigger for the 1v1 tab: something addressed to me needing
  // action — a proposal I haven't responded to, an open challenge someone
  // else posted, or it's my turn in an active draft. Not just "any match
  // exists" — this should only fire for things that actually need me.
  const myNameLower = session?.name?.toLowerCase() || '';
  const matchAlert = !!(myNameLower && matches.some((m) => {
    if (m.status === 'proposed') {
      if (m.opponentName && m.opponentName.toLowerCase() === myNameLower) return true;
      if (!m.opponentName && m.challengerName.toLowerCase() !== myNameLower) return true;
      return false;
    }
    if (m.status === 'accepted' && !isDraftComplete(m)) {
      const iAmChallenger = m.challengerName.toLowerCase() === myNameLower;
      const iAmOpponent = m.opponentName && m.opponentName.toLowerCase() === myNameLower;
      const turn = nextTurn(m);
      return (turn === 'challenger' && iAmChallenger) || (turn === 'opponent' && iAmOpponent);
    }
    return false;
  }));

  // Optional: refresh ESPN live (manual button; auto-refresh would hit rate limits)
  async function refreshLive() {
    if (!tournament) return;
    try {
      // Re-hydrate cache from Supabase first so the merge sees authoritative current state
      // (admin edits, prior syncs from other devices, manual data fixes) instead of a stale
      // local cache. Otherwise sticky flags like `won` get silently clobbered.
      await refresh();
      const currentGolfers = storage.get(keys.golfers(tournamentId)) || [];
      // Re-read the tournament from the freshly-hydrated cache too. The `tournament`
      // closure was captured at render and may predate an admin edit or a manual
      // cut-line fix, which would defeat the `?? cutLine` guard below.
      const currentTournament = storage.get(keys.tournament(tournamentId)) || tournament;
      const raw = await fetchEspnScoreboard();
      const { golfers: liveGolfers, currentRound, cutLine } = normalizeEspn(raw);
      // Normalize names: lowercase + strip diacritics so "Aberg" matches "Åberg",
      // "Hojgaard" matches "Højgaard", etc. ø/æ/ß aren't decomposable via NFKD,
      // so they're mapped explicitly.
      const FOLD = { 'ø':'o','æ':'ae','œ':'oe','ß':'ss','đ':'d','ł':'l','ð':'d','þ':'th' };
      const normalizeName = (s) => (s || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[øæœßđłðþ]/g, (c) => FOLD[c] || c);
      // Statuses set by admin or cut logic — never let an ESPN sync revert these to "playing".
      const TERMINAL = new Set(['made_cut', 'missed_cut', 'withdrawn']);
      // Merge: keep tier assignments, overlay live score fields by golfer NAME
      const byName = new Map(liveGolfers.map((g) => [normalizeName(g.name), g]));
      const merged = currentGolfers.map((g) => {
        const live = byName.get(normalizeName(g.name));
        if (!live) return g;
        const status = TERMINAL.has(g.status) ? g.status : live.status;
        // `won` is sticky-true: ESPN often lags setting the winner flag, so once true,
        // never let a subsequent sync revert it. To unset, use Admin → Live Controls.
        const won = g.won || live.won;
        return { ...g, strokesToPar: live.strokesToPar, todayToPar: live.todayToPar, thru: live.thru, position: live.position, status, won };
      });
      storage.set(keys.golfers(tournamentId), merged);
      storage.set(keys.tournament(tournamentId), {
        ...currentTournament,
        currentRound: currentTournament.currentRound || currentRound,
        cutLine: currentTournament.cutLine ?? cutLine,
      });
      refreshAll();
      await alertAsync('Live scores refreshed from ESPN.');
    } catch (err) {
      await alertAsync('ESPN fetch failed: ' + err.message + '\n\nTip: ESPN’s public endpoint blocks some networks. The app still works with seeded data + admin controls.');
    }
  }

  function handleLogout() {
    storage.delete(keys.session);
    setSession(null);
    setAdminPending(false);
  }

  function handleAuth(s) {
    if (s.isAdmin === 'pending') {
      setAdminPending(true);
      return;
    }
    setSession(s);
  }

  if (!bootstrapped) {
    return (
      <div className="min-h-dvh flex items-center justify-center text-muted">
        <div className="text-center">
          <div className="animate-pulse">Loading pool data…</div>
          {!SUPABASE_READY && <div className="text-xs mt-2">No Supabase config — local mode only</div>}
        </div>
      </div>
    );
  }

  if (bootError) {
    return (
      <div className="min-h-dvh flex items-center justify-center px-4">
        <Card className="max-w-md p-5">
          <div className="text-danger font-medium mb-2">Could not connect to Supabase</div>
          <div className="text-sm text-muted mb-3">{bootError}</div>
          <div className="text-xs text-muted">
            Did you run <code>docs/supabase_schema.sql</code> in the Supabase SQL editor? And does <code>.env</code> have your project URL + anon key?
          </div>
        </Card>
      </div>
    );
  }

  if (adminPending) {
    return <AdminLogin onAuth={(s) => { setSession(s); setAdminPending(false); }} onCancel={() => setAdminPending(false)} />;
  }

  if (!session) {
    return <AuthGate onAuth={handleAuth} tournament={tournament} />;
  }

  return (
    <div className="min-h-dvh">
      <Nav page={page} onChange={setPage} session={session} onLogout={handleLogout} matchAlert={matchAlert} />

      <main className="pb-20 md:pb-0">
        {page === 'home' && <Home tournament={tournament} golfers={golfers} entries={entries} session={session} onNav={navigateTo} />}
        {page === 'submit' && tournament && <Submit tournament={tournament} golfers={golfers} entries={entries} session={session} refreshAll={refreshAll} />}
        {page === 'matches' && tournament && <Matches tournament={tournament} golfers={golfers} session={session} refreshAll={refreshAll} />}
        {page === 'players' && tournament && <Players tournament={tournament} golfers={golfers} entries={entries} session={session} onNavToLeaderboard={() => setPage('leaderboard')} />}
        {page === 'leaderboard' && tournament && <Leaderboard tournament={tournament} golfers={golfers} entries={entries} snapshots={snapshots} session={session} />}
        {page === 'analysis' && tournament && <Analysis initialTab={analysisTab} tournament={tournament} golfers={golfers} entries={entries} snapshots={snapshots} session={session} />}
        {page === 'history' && <History session={session} refreshAll={refreshAll} />}
        {page === 'admin' && session.isAdmin && <Admin tournament={tournament} golfers={golfers} refreshAll={refreshAll} />}
        {page === 'rules' && <Rules />}
      </main>

      {session.isAdmin && tournament && (
        <button
          onClick={refreshLive}
          className="fixed bottom-20 right-4 md:bottom-4 z-20 bg-card border border-border text-xs text-muted hover:text-text px-3 py-2 rounded-full shadow-lg"
          title="Pull latest scores from ESPN"
        >
          ↻ Live sync
        </button>
      )}
    </div>
  );
}

function AdminLogin({ onAuth, onCancel }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setBusy(true);

    // 1. Try cache first (fast path)
    let stored = storage.get(keys.adminCode);

    // 2. Cache miss → re-fetch from Supabase live (resilient path)
    if (stored == null && SUPABASE_READY) {
      try {
        const { supabase } = await import('./lib/supabase.js');
        const { data, error } = await supabase
          .from('app_config')
          .select('value')
          .eq('key', 'admin-code')
          .maybeSingle();
        if (error) throw error;
        stored = data?.value ?? null;
        if (stored != null) storage.set(keys.adminCode, stored);
      } catch (e) {
        console.error('[admin-code fetch]', e);
        setBusy(false);
        return setErr('Could not reach Supabase: ' + (e.message || 'unknown error'));
      }
    }

    setBusy(false);

    if (stored == null) {
      return setErr('No admin code set. Re-run docs/supabase_schema.sql in the Supabase SQL editor.');
    }
    if (code !== stored) {
      return setErr('Wrong admin code');
    }
    storage.set(keys.session, { name: 'Admin', isAdmin: true });
    onAuth({ name: 'Admin', isAdmin: true });
  }

  return (
    <div className="min-h-dvh flex items-center justify-center px-4">
      <Card className="w-full max-w-sm p-6">
        <div className="text-xs text-warn uppercase tracking-wide mb-1">Admin login</div>
        <h1 className="text-lg font-semibold mb-4">Enter admin code</h1>
        <form onSubmit={submit} className="space-y-3">
          <Input type="password" value={code} onChange={setCode} placeholder="admin code" />
          {err && <div className="text-sm text-danger break-words">{err}</div>}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>{busy ? 'Checking…' : 'Enter'}</Button>
            <Button variant="ghost" onClick={onCancel}>Back</Button>
          </div>
        </form>
        <div className="mt-4 text-xs text-muted">
          Default admin code is <code>admin</code>. Change it in storage key <code>admin-code</code>.
        </div>
      </Card>
    </div>
  );
}
