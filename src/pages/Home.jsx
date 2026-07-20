import React, { useEffect, useMemo, useState } from 'react';
import { storage, keys } from '../lib/storage.js';
import { rankEntries } from '../lib/scoring.js';
import { computePayouts, fmtMoney } from '../lib/payouts.js';
import { buildMajors, getDefendingChampions } from '../lib/majors.js';
import { fmtDate } from '../lib/format.js';
import { Card, Stat, Button } from '../components/ui.jsx';

export default function Home({ tournament, golfers, entries, session, onNav }) {
  const nextMajor = storage.get(keys.nextMajor);
  // The admin-set override always wins while it's there (it's meant to bridge
  // the gap before the real tournament exists in the system) — otherwise
  // fall back to the active tournament's own submission deadline.
  const countdownName = nextMajor?.name || tournament?.name;
  const countdownDeadline = nextMajor?.deadline || tournament?.deadline;
  const countdownEventType = nextMajor?.eventType || tournament?.eventType;
  // No startDate exists yet for a pure override, so anchor on the deadline
  // instead — it's always at or before the real event, which is all that
  // matters for "did this prior edition happen before the upcoming one".
  const countdownAnchorDate = nextMajor?.deadline || tournament?.startDate || tournament?.deadline;

  const majors = useMemo(() => buildMajors(), [tournament, entries]);
  const recentMajors = useMemo(
    () => [...majors].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 4),
    [majors]
  );
  const lastMajorOverall = recentMajors[0] || null;
  const defendingChampions = useMemo(
    () => getDefendingChampions({ eventType: countdownEventType, anchorDate: countdownAnchorDate }),
    [countdownEventType, countdownAnchorDate, majors]
  );

  let ranked = [], structure = null, leader = null, myEntries = [];
  if (tournament) {
    ranked = rankEntries(entries, golfers, {
      tieredPenaltyEnabled: tournament.tieredPenaltyEnabled,
      cutLine: tournament.cutLine,
      currentRound: tournament.currentRound,
    });
    structure = computePayouts(ranked, entries.length, tournament.entryFee).structure;
    leader = ranked[0];
    myEntries = ranked.filter((r) => r.entry.name.toLowerCase() === session.name.toLowerCase());
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-32 md:pb-6 space-y-6">
      {countdownDeadline && (
        <Countdown
          name={countdownName}
          deadline={countdownDeadline}
          defendingChampions={defendingChampions}
          lastMajorOverall={lastMajorOverall}
        />
      )}

      {tournament && (
        <>
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
        </>
      )}

      {recentMajors.length > 0 && (
        <div>
          <div className="text-xs text-muted uppercase tracking-wide mb-2">Recent majors</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {recentMajors.map((m) => <RecentMajorCard key={m.id} m={m} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function Countdown({ name, deadline, defendingChampions = [], lastMajorOverall = null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const target = new Date(deadline).getTime();
  const diff = target - now;
  const locked = !Number.isFinite(target) || diff <= 0;

  const totalSeconds = Math.max(0, Math.floor(diff / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return (
    <Card className="p-5 text-center">
      <div className="text-xs text-muted uppercase tracking-wide">Picks lock for</div>
      <div className="text-lg font-semibold mt-1">{name}</div>
      {locked ? (
        <div className="text-xl font-bold text-danger mt-2">Picks are locked</div>
      ) : (
        <div className="flex justify-center gap-4 mt-3">
          {[['Days', days], ['Hrs', hours], ['Min', minutes], ['Sec', seconds]].map(([label, val]) => (
            <div key={label} className="text-center">
              <div className="text-2xl font-bold tabular-nums text-accent">{String(val).padStart(2, '0')}</div>
              <div className="text-[10px] text-muted uppercase tracking-wide mt-0.5">{label}</div>
            </div>
          ))}
        </div>
      )}

      {(defendingChampions.length > 0 || lastMajorOverall) && (
        <div className="mt-4 pt-3 border-t border-border space-y-0.5">
          {defendingChampions.length > 0 && (
            <div className="text-xs text-muted">
              Defending champ: <span className="text-text">{defendingChampions.join(' & ')}</span>
            </div>
          )}
          {lastMajorOverall && (
            <div className="text-xs text-muted">
              Last winner: <span className="text-text">{lastMajorOverall.winner}</span> — {lastMajorOverall.name}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function RecentMajorCard({ m }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium text-sm">{m.name}</div>
          <div className="text-xs text-muted mt-0.5">{fmtDate(m.date)}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-semibold text-accent tabular-nums">{fmtMoney(m.prize)}</div>
          {m.points != null && (
            <div className="text-xs text-muted tabular-nums">{m.points >= 0 ? '+' : ''}{m.points} pts</div>
          )}
        </div>
      </div>
      <div className="text-xs text-muted mt-2">Winner: <span className="text-text">{m.winner}</span></div>
      {!!m.team?.length && <div className="text-xs text-muted mt-0.5">{m.team.join(', ')}</div>}
      {m.highlight && <div className="text-xs text-warn mt-2">✨ {m.highlight}</div>}
    </Card>
  );
}

function lastName(full) {
  if (!full) return '';
  const parts = full.split(' ');
  return parts[parts.length - 1];
}
