import React, { useEffect, useMemo, useState } from 'react';
import { storage, keys, getActiveTournamentId } from './lib/storage.js';
import { seedIfEmpty } from './lib/seedData.js';
import { fetchEspnScoreboard, normalizeEspn } from './lib/espnApi.js';

import AuthGate from './components/AuthGate.jsx';
import Nav from './components/Nav.jsx';
import Home from './pages/Home.jsx';
import Submit from './pages/Submit.jsx';
import Leaderboard from './pages/Leaderboard.jsx';
import Players from './pages/Players.jsx';
import Compare from './pages/Compare.jsx';
import Trends from './pages/Trends.jsx';
import History from './pages/History.jsx';
import Admin from './pages/Admin.jsx';
import { Card, Button, Input } from './components/ui.jsx';

export default function App() {
  const [bootstrapped, setBootstrapped] = useState(false);
  const [page, setPage] = useState('home');
  const [session, setSession] = useState(() => storage.get(keys.session));
  const [adminPending, setAdminPending] = useState(false);
  const [tick, setTick] = useState(0);

  // First-run seed
  useEffect(() => {
    seedIfEmpty();
    setBootstrapped(true);
  }, []);

  const refreshAll = () => setTick((t) => t + 1);

  const tournamentId = getActiveTournamentId();
  const tournament = tournamentId ? storage.get(keys.tournament(tournamentId)) : null;
  const golfers   = tournamentId ? (storage.get(keys.golfers(tournamentId)) || []) : [];
  const entries   = tournamentId ? (storage.get(keys.entries(tournamentId)) || []) : [];
  const snapshots = tournamentId ? (storage.get(keys.snapshots(tournamentId)) || []) : [];

  // Optional: refresh ESPN live (manual button; auto-refresh would hit rate limits)
  async function refreshLive() {
    if (!tournament) return;
    try {
      const raw = await fetchEspnScoreboard();
      const { golfers: liveGolfers, currentRound, cutLine } = normalizeEspn(raw);
      // Merge: keep tier assignments, overlay live score fields by golfer NAME
      const byName = new Map(liveGolfers.map((g) => [g.name.toLowerCase(), g]));
      const merged = golfers.map((g) => {
        const live = byName.get(g.name.toLowerCase());
        if (!live) return g;
        return { ...g, strokesToPar: live.strokesToPar, todayToPar: live.todayToPar, thru: live.thru, position: live.position, status: live.status, won: live.won };
      });
      storage.set(keys.golfers(tournamentId), merged);
      storage.set(keys.tournament(tournamentId), {
        ...tournament,
        currentRound: tournament.currentRound || currentRound,
        cutLine: tournament.cutLine ?? cutLine,
      });
      refreshAll();
      alert('Live scores refreshed from ESPN.');
    } catch (err) {
      alert('ESPN fetch failed: ' + err.message + '\n\nTip: ESPN’s public endpoint blocks some networks. The app still works with seeded data + admin controls.');
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
    return <div className="min-h-screen flex items-center justify-center text-muted">Loading…</div>;
  }

  if (adminPending) {
    return <AdminLogin onAuth={(s) => { setSession(s); setAdminPending(false); }} onCancel={() => setAdminPending(false)} />;
  }

  if (!session) {
    return <AuthGate onAuth={handleAuth} tournament={tournament} />;
  }

  return (
    <div className="min-h-screen">
      <Nav page={page} onChange={setPage} session={session} onLogout={handleLogout} />

      <main key={tick} className="pb-20 md:pb-0">
        {page === 'home' && <Home tournament={tournament} golfers={golfers} entries={entries} session={session} onNav={setPage} />}
        {page === 'submit' && tournament && <Submit tournament={tournament} golfers={golfers} entries={entries} session={session} refreshAll={refreshAll} />}
        {page === 'players' && tournament && <Players tournament={tournament} golfers={golfers} entries={entries} onNavToLeaderboard={() => setPage('leaderboard')} />}
        {page === 'leaderboard' && tournament && <Leaderboard tournament={tournament} golfers={golfers} entries={entries} snapshots={snapshots} />}
        {page === 'compare' && tournament && <Compare tournament={tournament} golfers={golfers} entries={entries} />}
        {page === 'trends' && tournament && <Trends tournament={tournament} golfers={golfers} entries={entries} snapshots={snapshots} session={session} />}
        {page === 'history' && <History session={session} refreshAll={refreshAll} />}
        {page === 'admin' && session.isAdmin && <Admin tournament={tournament} golfers={golfers} refreshAll={refreshAll} />}
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
  const stored = storage.get(keys.adminCode);

  function submit(e) {
    e.preventDefault();
    if (code !== stored) return setErr('Wrong admin code');
    storage.set(keys.session, { name: 'Admin', isAdmin: true });
    onAuth({ name: 'Admin', isAdmin: true });
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <Card className="w-full max-w-sm p-6">
        <div className="text-xs text-warn uppercase tracking-wide mb-1">Admin login</div>
        <h1 className="text-lg font-semibold mb-4">Enter admin code</h1>
        <form onSubmit={submit} className="space-y-3">
          <Input type="password" value={code} onChange={setCode} placeholder="admin code" />
          {err && <div className="text-sm text-danger">{err}</div>}
          <div className="flex gap-2">
            <Button type="submit">Enter</Button>
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
