import React, { useMemo, useState } from 'react';
import { storage, keys } from '../lib/storage.js';
import { Card, Button, TierDot, Pill } from '../components/ui.jsx';

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
