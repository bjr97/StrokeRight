import React from 'react';
import { rankEntries } from '../lib/scoring.js';
import { computePayouts, fmtMoney, payoutStructure } from '../lib/payouts.js';
import { Card, Stat, Button } from '../components/ui.jsx';

export default function Home({ tournament, golfers, entries, session, onNav }) {
  if (!tournament) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10">
        <Card className="p-6 text-center">
          <h2 className="text-lg font-medium mb-2">No active tournament</h2>
          <p className="text-sm text-muted">Ask your admin to set one up.</p>
        </Card>
      </div>
    );
  }

  const ranked = rankEntries(entries, golfers, {
    tieredPenaltyEnabled: tournament.tieredPenaltyEnabled,
    cutLine: tournament.cutLine,
    currentRound: tournament.currentRound,
  });
  const { structure } = computePayouts(ranked, entries.length, tournament.entryFee);
  const leader = ranked[0];
  const myEntries = ranked.filter((r) => r.entry.name.toLowerCase() === session.name.toLowerCase());

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-32 md:pb-6 space-y-6">
      <div className="text-center">
        <div className="text-xs text-muted uppercase tracking-wide">Active tournament</div>
        <h1 className="text-3xl font-semibold mt-1">{tournament.name}</h1>
        <p className="text-sm text-muted mt-1">
          {tournament.course || 'Course TBD'}
          {tournament.currentRound ? ` · Round ${tournament.currentRound} in progress` : ''}
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Entries" value={entries.length} />
        <Stat label="Prize pool" value={fmtMoney(structure.pool)} valueClass="text-accent" />
        <Stat label="Round" value={`R${tournament.currentRound || 1}`} />
        <Stat label="Leader" value={leader ? `+${leader.total}` : '—'} valueClass="text-accent" />
      </div>

      <Card className="p-5">
        <div className="text-xs text-muted uppercase tracking-wide mb-3">Payout structure ({entries.length} entries)</div>
        <div className="space-y-2">
          {structure.tiers.map((t, i) => (
            <div key={i} className="flex justify-between text-sm">
              <span>{t.label}</span>
              <span className="font-medium tabular-nums text-accent">{fmtMoney(t.amount)}</span>
            </div>
          ))}
        </div>
      </Card>

      {myEntries.length > 0 && (
        <Card className="p-5">
          <div className="text-xs text-muted uppercase tracking-wide mb-3">Your entries</div>
          <div className="space-y-2">
            {myEntries.map((row) => (
              <div key={row.entry.id} className="flex items-center justify-between py-1">
                <div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium tabular-nums w-6 text-muted">{row.rank}</span>
                    <span className="font-medium">{row.entry.name}</span>
                    <span className="text-xs text-muted">Entry {row.entry.entryNum}</span>
                  </div>
                  <div className="text-xs text-muted ml-8">
                    {row.scored.map((s) => lastName(s.golfer.name)).join(', ')}
                  </div>
                </div>
                <div className={`font-semibold tabular-nums ${row.total >= 0 ? 'text-accent' : 'text-danger'}`}>
                  {row.total >= 0 ? `+${row.total}` : row.total}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-5">
        <div className="text-xs text-muted uppercase tracking-wide mb-3">Quick links</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Button variant="secondary" onClick={() => onNav('submit')}>Submit new entry</Button>
          <Button variant="secondary" onClick={() => onNav('leaderboard')}>Full leaderboard</Button>
          <Button variant="secondary" onClick={() => onNav('compare')}>Compare teams</Button>
        </div>
      </Card>

      <div className="text-center text-xs text-muted">
        {tournament.deadline && <>Picks lock {new Date(tournament.deadline).toLocaleString()} · </>}
        Venmo <span className="text-text">@Vishnu697</span>
      </div>
    </div>
  );
}

function lastName(full) {
  if (!full) return '';
  const parts = full.split(' ');
  return parts[parts.length - 1];
}
