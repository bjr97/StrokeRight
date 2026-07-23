import React, { useState, useEffect } from 'react';

const PRIMARY_BASE = [
  { id: 'home',    label: 'Home' },
  { id: 'submit',  label: 'Submit' },
  { id: 'matches', label: '1v1' },
];
const BOARD = { id: 'leaderboard', label: 'Board' };
const HISTORY = { id: 'history', label: 'History' };
const OVERFLOW_BASE = [
  { id: 'players',  label: 'Players' },
  { id: 'analysis', label: 'Analysis' },
];
const RULES = { id: 'rules', label: 'Rules' };

export default function Nav({ page, onChange, session, onLogout, matchAlert, tournamentLive }) {
  const [moreOpen, setMoreOpen] = useState(false);

  // Board only matters while an event is actually live — the rest of the
  // time History is the more useful 4th primary tab, and Board just waits
  // in More until the next tournament goes live.
  const PRIMARY = [...PRIMARY_BASE, tournamentLive ? BOARD : HISTORY];
  const OVERFLOW = [...OVERFLOW_BASE, tournamentLive ? HISTORY : BOARD, RULES];

  // Close the flyout on any navigation, not just taps inside it — otherwise
  // tapping a primary tab (Home/Submit/1v1/Board) while it's open leaves it
  // rendered open underneath the newly-navigated page.
  useEffect(() => { setMoreOpen(false); }, [page]);

  return (
    <>
      {/* Top bar */}
      <header className="sticky top-0 z-30 bg-bg/95 backdrop-blur border-b border-border">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold">
              <span className="text-text">Stroke</span><span className="text-accent">Right</span>
            </span>
          </div>
          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1">
            {[...PRIMARY, ...OVERFLOW].map((t) => (
              <button
                key={t.id}
                onClick={() => onChange(t.id)}
                className={`px-3 py-1.5 rounded-lg text-sm transition ${
                  page === t.id
                    ? 'bg-accent text-bg font-medium'
                    : 'text-muted hover:text-text hover:bg-card'
                }`}
              >
                <span className="relative inline-block">
                  {t.label}
                  {t.id === 'matches' && matchAlert && (
                    <span className="absolute -top-1 -right-2 w-1.5 h-1.5 rounded-full bg-danger" />
                  )}
                </span>
              </button>
            ))}
            {session?.isAdmin === true && (
              <button
                onClick={() => onChange('admin')}
                className={`px-3 py-1.5 rounded-lg text-sm ${page === 'admin' ? 'bg-warn text-bg font-medium' : 'text-warn hover:bg-warn/10'}`}
              >
                Admin
              </button>
            )}
          </nav>
          <button onClick={onLogout} className="text-xs text-muted hover:text-text">
            {session?.name} · log out
          </button>
        </div>
      </header>

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-bg/95 backdrop-blur border-t border-border safe-bottom">
        <div className="grid grid-cols-5">
          {PRIMARY.map((t) => (
            <NavBtn key={t.id} active={page === t.id} onClick={() => onChange(t.id)} label={t.label} badge={t.id === 'matches' && matchAlert} />
          ))}
          <NavBtn
            active={OVERFLOW.some((o) => o.id === page) || moreOpen}
            onClick={() => setMoreOpen((v) => !v)}
            label="More"
          />
        </div>
        {moreOpen && (
          <div className="bg-card border-t border-border">
            {OVERFLOW.map((t) => (
              <button
                key={t.id}
                onClick={() => { onChange(t.id); setMoreOpen(false); }}
                className={`w-full text-left px-4 py-3 text-sm border-b border-border last:border-b-0 ${page === t.id ? 'text-accent' : 'text-text'}`}
              >
                {t.label}
              </button>
            ))}
            {session?.isAdmin === true && (
              <button
                onClick={() => { onChange('admin'); setMoreOpen(false); }}
                className="w-full text-left px-4 py-3 text-sm text-warn"
              >
                Admin
              </button>
            )}
          </div>
        )}
      </nav>
    </>
  );
}

function NavBtn({ active, onClick, label, badge }) {
  return (
    <button
      onClick={onClick}
      className={`py-3 text-xs font-medium ${active ? 'text-accent' : 'text-muted'}`}
    >
      <span className="relative inline-block">
        {label}
        {badge && <span className="absolute -top-1 -right-2 w-1.5 h-1.5 rounded-full bg-danger" />}
      </span>
    </button>
  );
}
