import React, { useMemo, useState } from 'react';
import { storage, keys, refresh } from '../lib/storage.js';
import { Card, Button, Input, Select, TierDot, Pill, alertAsync } from '../components/ui.jsx';
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

// All names ever seen across every tournament's entries + matches — the
// all-time pool roster. No accounts in this app, so this is the only
// registry of "known names" to pick an opponent from.
function allKnownNames(excludeNameLower) {
  const entryNames = storage.list('entries:').flatMap((k) => storage.get(k) || []).map((e) => e.name);
  const matchNames = storage.list('matches:').flatMap((k) => storage.get(k) || []).flatMap((m) => [m.challengerName, m.opponentName]);
  const seen = new Map(); // lowercase -> first-seen casing
  for (const n of [...entryNames, ...matchNames]) {
    if (!n) continue;
    const key = n.toLowerCase();
    if (key === excludeNameLower || seen.has(key)) continue;
    seen.set(key, n);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

// 1v1 matches: two players draft 6 golfers each (5 starters + 1 extra) via
// an async snake draft against this tournament's own field. No accounts in
// this app — like everything else here, matches are name-based on the
// honor system, not a secured per-user identity.
function MatchesSection({ tournament, golfers, session, refreshAll, deadlinePassed }) {
  const matches = storage.get(keys.matches(tournament.id)) || [];
  const myName = session.name.toLowerCase();
  const myMatches = matches.filter(
    (m) => m.challengerName.toLowerCase() === myName || (m.opponentName && m.opponentName.toLowerCase() === myName)
  );
  const openChallenges = matches.filter(
    (m) => m.status === 'proposed' && !m.opponentName && m.challengerName.toLowerCase() !== myName
  );
  const knownNames = allKnownNames(myName);

  const [mode, setMode] = useState('specific'); // 'specific' | 'open'
  const [opponentName, setOpponentName] = useState('');
  const [amount, setAmount] = useState('');
  const [proposed, setProposed] = useState(false);

  function propose() {
    if (mode === 'specific' && !opponentName) return alertAsync('Pick an opponent.');
    if (!amount || Number(amount) <= 0) return alertAsync('Enter a $ amount greater than 0.');

    const m = {
      id: 'm' + Date.now().toString(36),
      challengerName: session.name,
      opponentName: mode === 'specific' ? opponentName : null,
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

  function declineMatch(match) {
    const updated = matches.map((m) => (m.id === match.id ? { ...m, status: 'declined' } : m));
    storage.set(keys.matches(tournament.id), updated);
    refreshAll();
  }

  function cancelMatch(match) {
    const updated = matches.filter((m) => m.id !== match.id);
    storage.set(keys.matches(tournament.id), updated);
    refreshAll();
  }

  function acceptTargeted(match) {
    const updated = matches.map((m) =>
      m.id === match.id ? { ...m, status: 'accepted', firstPicker: Math.random() < 0.5 ? 'challenger' : 'opponent' } : m
    );
    storage.set(keys.matches(tournament.id), updated);
    refreshAll();
  }

  // Open challenges have no single addressee, so there's a real (if narrow)
  // race if two people tap Accept close together — re-hydrate from Supabase
  // and re-check it's still unclaimed immediately before locking it in.
  async function acceptOpen(match) {
    await refresh();
    const fresh = storage.get(keys.matches(tournament.id)) || [];
    const latest = fresh.find((m) => m.id === match.id);
    if (!latest || latest.status !== 'proposed' || latest.opponentName) {
      await alertAsync('Someone else already accepted this challenge.');
      refreshAll();
      return;
    }
    const updated = fresh.map((m) =>
      m.id === match.id
        ? { ...m, opponentName: session.name, status: 'accepted', firstPicker: Math.random() < 0.5 ? 'challenger' : 'opponent' }
        : m
    );
    storage.set(keys.matches(tournament.id), updated);
    refreshAll();
  }

  function handleAccept(match) {
    return match.opponentName ? acceptTargeted(match) : acceptOpen(match);
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
          {proposed && <div className="text-xs text-accent">Proposed.</div>}
          <div className="flex gap-1">
            {[{ value: 'specific', label: 'Challenge someone' }, { value: 'open', label: 'Open to anyone' }].map((o) => (
              <button
                key={o.value}
                onClick={() => { setMode(o.value); setProposed(false); }}
                className={`px-2.5 py-1 rounded-lg text-xs border transition ${
                  mode === o.value ? 'bg-accent text-bg border-accent' : 'border-border text-muted hover:text-text'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          {mode === 'specific' && (
            <Select
              value={opponentName}
              onChange={(v) => { setOpponentName(v); setProposed(false); }}
              options={[{ value: '', label: '— choose an opponent —' }, ...knownNames.map((n) => ({ value: n, label: n }))]}
              className="w-full"
            />
          )}
          <Input type="number" value={amount} onChange={(v) => { setAmount(v); setProposed(false); }} placeholder="$ amount" />
          <Button onClick={propose}>Propose match</Button>
        </Card>
      )}

      {!!openChallenges.length && (
        <div className="space-y-2">
          <h3 className="text-xs uppercase text-muted tracking-wide">Open challenges</h3>
          {openChallenges.map((m) => (
            <Card key={m.id} className="p-3 flex items-center justify-between">
              <div className="text-sm">{m.challengerName} · ${m.amount} · open to anyone</div>
              <Button onClick={() => handleAccept(m)}>Accept</Button>
            </Card>
          ))}
        </div>
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
          onAccept={() => handleAccept(m)}
          onDecline={() => declineMatch(m)}
          onCancel={() => cancelMatch(m)}
          onPick={(gid) => pickGolfer(m, gid)}
        />
      ))}
    </div>
  );
}

function MatchCard({ match, golfers, tournament, myName, deadlinePassed, onAccept, onDecline, onCancel, onPick }) {
  const iAmChallenger = match.challengerName.toLowerCase() === myName;
  const iAmOpponent = !!match.opponentName && match.opponentName.toLowerCase() === myName;
  const header = (
    <div className="text-sm">
      <span className="font-medium">{match.challengerName}</span>{' '}
      {match.opponentName ? (
        <>vs <span className="font-medium">{match.opponentName}</span></>
      ) : (
        <span className="text-muted">· open challenge</span>
      )}
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
        {iAmChallenger ? (
          <div className="flex items-center gap-2">
            <div className="text-xs text-muted">
              {match.opponentName ? `Waiting for ${match.opponentName} to accept.` : 'Open — waiting for anyone to accept.'}
            </div>
            <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          </div>
        ) : iAmOpponent ? (
          <div className="flex gap-2">
            <Button onClick={onAccept}>Accept</Button>
            <Button variant="ghost" onClick={onDecline}>Decline</Button>
          </div>
        ) : null}
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
