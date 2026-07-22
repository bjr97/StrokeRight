import React, { useMemo, useState } from 'react';
import { storage, keys } from '../lib/storage.js';
import { Card, Button, Input, TierDot, Pill, alertAsync } from '../components/ui.jsx';
import { nextTurn, isDraftComplete, takenGolferIds, computeMatchResult } from '../lib/matches.js';

export default function Submit({ tournament, golfers, entries, session, refreshAll }) {
  const deadlinePassed = tournament?.deadline ? new Date(tournament.deadline).getTime() < Date.now() : false;
  const myEntries = entries.filter((e) => e.name.toLowerCase() === session.name.toLowerCase());

  const [picks, setPicks] = useState({}); // tier -> [golferIds]
  const [downTier, setDownTier] = useState(null); // tier number to skip
  const [submitted, setSubmitted] = useState(false);

  const tiers = useMemo(() => [1, 2, 3, 4, 5, 6], []);
  const byTier = useMemo(() => {
    const map = new Map(tiers.map((t) => [t, []]));
    golfers.forEach((g) => map.get(g.tier)?.push(g));
    return map;
  }, [golfers]);

  function pick(tier, gid) {
    setPicks((prev) => {
      const next = { ...prev };
      if (downTier && tier > downTier) {
        // Double-pick allowed in lower tier — up to 2
        const cur = prev[tier] || [];
        if (cur.includes(gid)) next[tier] = cur.filter((x) => x !== gid);
        else if (cur.length < 2) next[tier] = [...cur, gid];
        else next[tier] = [cur[1], gid];
      } else {
        next[tier] = prev[tier]?.[0] === gid ? [] : [gid];
      }
      return next;
    });
  }

  function toggleDownTier(tier) {
    setDownTier((cur) => (cur === tier ? null : tier));
    setPicks((p) => ({ ...p, [tier]: [] }));
  }

  const allPicks = Object.values(picks).flat();
  const isValid = (() => {
    if (allPicks.length !== 6) return false;
    if (downTier) {
      if ((picks[downTier]?.length || 0) !== 0) return false;
      // Exactly one tier below downTier must have 2 picks
      const lowerWithTwo = tiers.filter((t) => t > downTier && (picks[t]?.length || 0) === 2);
      if (lowerWithTwo.length !== 1) return false;
      // All other tiers (except downTier and the double-tier) must have exactly 1
      for (const t of tiers) {
        if (t === downTier) continue;
        if (lowerWithTwo.includes(t)) continue;
        if ((picks[t]?.length || 0) !== 1) return false;
      }
    } else {
      for (const t of tiers) if ((picks[t]?.length || 0) !== 1) return false;
    }
    return true;
  })();

  function submit() {
    if (!isValid) return;
    const newEntry = {
      id: 'e' + Date.now().toString(36),
      name: session.name,
      entryNum: myEntries.length + 1,
      golferIds: allPicks,
      downTierSkipped: downTier,
      createdAt: new Date().toISOString(),
    };
    storage.set(keys.entries(tournament.id), [...entries, newEntry]);
    setSubmitted(true);
    setPicks({});
    setDownTier(null);
    refreshAll();
  }

  if (deadlinePassed) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6">
        <Card className="p-6 text-center">
          <div className="text-warn mb-2">Submission deadline passed</div>
          <div className="text-sm text-muted">Picks locked at {new Date(tournament.deadline).toLocaleString()}.</div>
        </Card>

        {myEntries.length > 0 && (
          <div className="mt-6 space-y-2">
            <h2 className="text-sm uppercase text-muted tracking-wide">Your locked entries</h2>
            {myEntries.map((e) => <EntryCard key={e.id} entry={e} golfers={golfers} />)}
          </div>
        )}

        <MatchesSection tournament={tournament} golfers={golfers} session={session} refreshAll={refreshAll} deadlinePassed={deadlinePassed} />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 pb-32 md:pb-6">
      <div className="mb-6">
        <div className="text-xs text-muted uppercase tracking-wide">Pick your 6 golfers — one per tier</div>
        <p className="text-sm text-muted mt-1">Tap a golfer in each tier. You may skip a tier and double-pick from a lower one.</p>
      </div>

      {submitted && (
        <Card className="p-4 mb-4 border-accent/40 bg-accent/5">
          <div className="text-accent text-sm">✓ Entry submitted. You can submit another below.</div>
        </Card>
      )}

      <div className="space-y-3">
        {tiers.map((tier) => {
          const golfersInTier = byTier.get(tier) || [];
          const skipped = downTier === tier;
          const allowDouble = downTier != null && tier > downTier;
          const picksInTier = picks[tier] || [];
          return (
            <Card key={tier} className={`p-3 ${skipped ? 'opacity-50' : ''}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <TierDot tier={tier} />
                  <span className="text-sm font-medium">Tier {tier} — {tournament.tierLabels[tier - 1]}</span>
                  {allowDouble && <Pill color="amber">double-pick</Pill>}
                </div>
                <button onClick={() => toggleDownTier(tier)} className="text-xs text-muted hover:text-text">
                  {skipped ? 'unskip' : 'skip tier ↓'}
                </button>
              </div>
              {!skipped && (
                <div className="space-y-1">
                  {golfersInTier.map((g) => {
                    const selected = picksInTier.includes(g.id);
                    return (
                      <button
                        key={g.id}
                        onClick={() => pick(tier, g.id)}
                        className={`w-full flex items-center justify-between text-sm py-2 px-3 rounded-lg transition border ${
                          selected ? 'bg-accent/15 border-accent text-text' : 'border-transparent hover:bg-bg'
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <span className={`w-3.5 h-3.5 rounded-full border ${selected ? 'bg-accent border-accent' : 'border-muted'}`} />
                          {g.name}
                        </span>
                        <span className="text-muted tabular-nums">{g.odds}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <div className="sticky bottom-16 md:bottom-4 mt-6">
        <Card className="p-3 flex items-center justify-between">
          <div className="text-sm">
            <span className="font-medium tabular-nums">{allPicks.length}/6</span>
            <span className="text-muted"> picks · {downTier ? `skipping T${downTier}` : 'no skip'}</span>
          </div>
          <Button disabled={!isValid} onClick={submit}>Submit entry</Button>
        </Card>
      </div>

      {myEntries.length > 0 && (
        <div className="mt-8 space-y-2">
          <h2 className="text-sm uppercase text-muted tracking-wide">Your entries ({myEntries.length})</h2>
          {myEntries.map((e) => <EntryCard key={e.id} entry={e} golfers={golfers} />)}
        </div>
      )}

      <MatchesSection tournament={tournament} golfers={golfers} session={session} refreshAll={refreshAll} deadlinePassed={deadlinePassed} />
    </div>
  );
}

function EntryCard({ entry, golfers }) {
  const lookup = new Map(golfers.map((g) => [g.id, g]));
  const names = entry.golferIds.map((id) => lookup.get(id)?.name).filter(Boolean);
  return (
    <Card className="p-3">
      <div className="text-xs text-muted mb-1">Entry {entry.entryNum} · {new Date(entry.createdAt).toLocaleDateString()}</div>
      <div className="text-sm">{names.join(', ')}</div>
    </Card>
  );
}

// 1v1 matches: two players draft 6 golfers each (5 starters + 1 extra) via
// an async snake draft against this tournament's own field. No accounts in
// this app — like everything else here, matches are name-based on the
// honor system, not a secured per-user identity.
function MatchesSection({ tournament, golfers, session, refreshAll, deadlinePassed }) {
  const matches = storage.get(keys.matches(tournament.id)) || [];
  const myName = session.name.toLowerCase();
  const myMatches = matches.filter(
    (m) => m.challengerName.toLowerCase() === myName || m.opponentName.toLowerCase() === myName
  );

  const [opponentName, setOpponentName] = useState('');
  const [amount, setAmount] = useState('');
  const [proposed, setProposed] = useState(false);

  async function propose() {
    const name = opponentName.trim();
    if (!name) return alertAsync('Enter an opponent name.');
    if (name.toLowerCase() === myName) return alertAsync("You can't challenge yourself.");
    if (!amount || Number(amount) <= 0) return alertAsync('Enter a $ amount greater than 0.');

    const m = {
      id: 'm' + Date.now().toString(36),
      challengerName: session.name,
      opponentName: name,
      amount: Number(amount),
      status: 'proposed',
      firstPicker: null,
      challengerPicks: [],
      opponentPicks: [],
      createdAt: new Date().toISOString(),
    };
    storage.set(keys.matches(tournament.id), [...matches, m]);
    setOpponentName('');
    setAmount('');
    setProposed(true);
    refreshAll();
  }

  function respond(match, accept) {
    const updated = matches.map((m) => {
      if (m.id !== match.id) return m;
      if (!accept) return { ...m, status: 'declined' };
      return { ...m, status: 'accepted', firstPicker: Math.random() < 0.5 ? 'challenger' : 'opponent' };
    });
    storage.set(keys.matches(tournament.id), updated);
    refreshAll();
  }

  function pickGolfer(match, golferId) {
    const iAmChallenger = match.challengerName.toLowerCase() === myName;
    const sideKey = iAmChallenger ? 'challengerPicks' : 'opponentPicks';
    const updated = matches.map((m) => {
      if (m.id !== match.id) return m;
      return { ...m, [sideKey]: [...m[sideKey], golferId] };
    });
    storage.set(keys.matches(tournament.id), updated);
    refreshAll();
  }

  return (
    <div className="mt-8 space-y-3">
      <h2 className="text-sm uppercase text-muted tracking-wide">1v1 matches</h2>

      {!deadlinePassed && (
        <Card className="p-4 space-y-3">
          <div className="text-sm font-medium">Propose a match</div>
          <div className="text-xs text-muted">
            Snake draft, 6 golfers each (5 starters + 1 extra) from this tournament's field. Same scoring rules as
            the main pool. Draft has to finish before the picks deadline, same as everything else here.
          </div>
          {proposed && <div className="text-xs text-accent">Proposed — waiting for them to accept.</div>}
          <Input value={opponentName} onChange={(v) => { setOpponentName(v); setProposed(false); }} placeholder="Opponent's name" />
          <Input type="number" value={amount} onChange={(v) => { setAmount(v); setProposed(false); }} placeholder="$ amount" />
          <Button onClick={propose}>Propose match</Button>
        </Card>
      )}

      {!myMatches.length && <div className="text-sm text-muted">No 1v1 matches yet.</div>}

      {myMatches.map((m) => (
        <MatchCard
          key={m.id}
          match={m}
          golfers={golfers}
          tournament={tournament}
          myName={myName}
          deadlinePassed={deadlinePassed}
          onRespond={(accept) => respond(m, accept)}
          onPick={(gid) => pickGolfer(m, gid)}
        />
      ))}
    </div>
  );
}

function MatchCard({ match, golfers, tournament, myName, deadlinePassed, onRespond, onPick }) {
  const iAmChallenger = match.challengerName.toLowerCase() === myName;
  const iAmOpponent = match.opponentName.toLowerCase() === myName;
  const header = (
    <div className="text-sm">
      <span className="font-medium">{match.challengerName}</span> vs{' '}
      <span className="font-medium">{match.opponentName}</span>
      <span className="text-muted"> · ${match.amount}</span>
    </div>
  );

  if (match.status === 'declined') {
    return (
      <Card className="p-4 space-y-1">
        {header}
        <div className="text-xs text-danger">Declined</div>
      </Card>
    );
  }

  const complete = match.status === 'accepted' && isDraftComplete(match);

  if (!complete && deadlinePassed) {
    return (
      <Card className="p-4 space-y-1">
        {header}
        <div className="text-xs text-warn">Voided — draft didn't finish before the deadline.</div>
      </Card>
    );
  }

  if (match.status === 'proposed') {
    return (
      <Card className="p-4 space-y-2">
        {header}
        {iAmOpponent ? (
          <div className="flex gap-2">
            <Button onClick={() => onRespond(true)}>Accept</Button>
            <Button variant="ghost" onClick={() => onRespond(false)}>Decline</Button>
          </div>
        ) : (
          <div className="text-xs text-muted">Waiting for {match.opponentName} to accept.</div>
        )}
      </Card>
    );
  }

  if (!complete) {
    const turn = nextTurn(match);
    const myTurn = (turn === 'challenger' && iAmChallenger) || (turn === 'opponent' && iAmOpponent);
    const taken = takenGolferIds(match);
    const available = [...golfers]
      .filter((g) => !taken.has(g.id))
      .sort((a, b) => oddsRank(a.odds) - oddsRank(b.odds));
    const mySide = iAmChallenger ? match.challengerPicks : match.opponentPicks;
    const theirSide = iAmChallenger ? match.opponentPicks : match.challengerPicks;
    const madeSoFar = mySide.length + theirSide.length;

    return (
      <Card className="p-4 space-y-3">
        {header}
        <div className="text-xs text-muted">
          Draft in progress — pick {madeSoFar + 1} of 12{mySide.length === 5 ? ' (your next pick is the extra/alternate)' : ''}
        </div>
        <PickList label="Your picks" picks={mySide} golfers={golfers} />
        <PickList label="Their picks" picks={theirSide} golfers={golfers} />
        {myTurn ? (
          <div>
            <div className="text-xs font-medium mb-1">Your turn:</div>
            <div className="max-h-64 overflow-y-auto space-y-1">
              {available.map((g) => (
                <button
                  key={g.id}
                  onClick={() => onPick(g.id)}
                  className="w-full flex items-center justify-between text-sm py-1.5 px-2 rounded hover:bg-bg"
                >
                  <span>{g.name}</span>
                  <span className="text-muted tabular-nums">{g.odds}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-xs text-muted">
            Waiting for {turn === 'challenger' ? match.challengerName : match.opponentName}'s pick.
          </div>
        )}
      </Card>
    );
  }

  // Draft complete — live (or final) result.
  const opts = {
    tieredPenaltyEnabled: tournament.tieredPenaltyEnabled,
    cutLine: tournament.cutLine,
    currentRound: tournament.currentRound,
    cutBonusPoints: tournament.cutBonusPoints,
  };
  const result = computeMatchResult(match, golfers, opts);
  const myTotal = iAmChallenger ? result.challenger.total : result.opponent.total;
  const theirTotal = iAmChallenger ? result.opponent.total : result.challenger.total;
  const iWon = (result.winner === 'challenger' && iAmChallenger) || (result.winner === 'opponent' && iAmOpponent);
  const isPush = result.winner === 'push';
  const isFinal = tournament.status === 'completed';

  return (
    <Card className="p-4 space-y-2">
      {header}
      <div className="flex items-center justify-between text-sm">
        <span>You: <span className="tabular-nums font-medium">{fmtPts(myTotal)}</span></span>
        <span>Them: <span className="tabular-nums font-medium">{fmtPts(theirTotal)}</span></span>
      </div>
      <div className={`text-xs ${isPush ? 'text-muted' : iWon ? 'text-accent' : 'text-danger'}`}>
        {isFinal
          ? isPush ? 'Push — no money changes hands' : iWon ? `You won $${match.amount}` : `You owe $${match.amount}`
          : isPush ? 'Currently tied' : iWon ? 'Currently winning' : 'Currently behind'}
      </div>
    </Card>
  );
}

function PickList({ label, picks, golfers }) {
  const lookup = new Map(golfers.map((g) => [g.id, g]));
  if (!picks.length) return <div className="text-xs text-muted">{label}: none yet</div>;
  return (
    <div className="text-xs text-muted">
      {label}: {picks.map((id, i) => (i === 5 ? `(${lookup.get(id)?.name || '?'} extra)` : lookup.get(id)?.name || '?')).join(', ')}
    </div>
  );
}

function oddsRank(odds) {
  if (!odds) return Infinity;
  const n = parseInt(String(odds).replace(/[+-]/, ''), 10);
  return Number.isFinite(n) ? n : Infinity;
}

function fmtPts(n) {
  return n >= 0 ? `+${n}` : `${n}`;
}
