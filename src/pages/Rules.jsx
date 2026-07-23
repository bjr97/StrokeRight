import React from 'react';
import { Card } from '../components/ui.jsx';

const TIER_BANDS = [
  { range: '0–1 over', penalty: '0' },
  { range: '2–4 over', penalty: '−1' },
  { range: '5–7 over', penalty: '−2' },
  { range: '8–10 over', penalty: '−3' },
  { range: '11–13 over', penalty: '−4' },
  { range: '14+ over', penalty: '−5' },
];

const PAYOUT_BANDS = [
  { range: '1–9', split: 'Winner take all (100%)' },
  { range: '10–19', split: '1st: pool minus one entry fee · 2nd: entry fee refunded' },
  { range: '20–29', split: '1st: 80% · 2nd: 20%' },
  { range: '30+', split: '1st: 65% · 2nd: 25% · 3rd: 10%' },
];

function Section({ title, children }) {
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-text mb-2">{title}</h2>
      <div className="text-sm text-muted space-y-2">{children}</div>
    </Card>
  );
}

export default function Rules() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-32 md:pb-6 space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-text">Scoring rules</h1>
        <p className="text-sm text-muted mt-1">
          How each golfer's points are calculated, and how those roll up into an entry's total.
        </p>
      </div>

      <Section title="1. Strokes under par">
        <p>Each golfer earns <span className="text-accent">+1 point</span> for every stroke finished under par. Strokes over par earn no points on their own — over-par play is only penalized through the tiered cut-line penalty below, not a straight per-stroke deduction.</p>
      </Section>

      <Section title="2. Made-cut bonus">
        <p>A golfer who officially makes the cut earns a flat <span className="text-accent">+3</span>, separate from their stroke score. <span className="text-text">2024 majors used ±2</span> instead of ±3 for this and the rule below.**</p>
      </Section>

      <Section title="3. Missed-cut penalty">
        <p>If a golfer misses the cut, they score a flat <span className="text-danger">−3</span> for the tournament — no stroke points, no cut bonus, nothing else factors in. This overrides all other scoring for that golfer.</p>
      </Section>

      <Section title="4. Withdrawal before the cut">
        <p>A golfer who withdraws before the end of Round 2 is treated the same as missing the cut: a flat <span className="text-danger">−3</span>, no other points.</p>
      </Section>

      <Section title="5. Withdrawal after making the cut">
        <p>A golfer who withdraws after Round 3 has started — having already made the cut — scores a neutral <span className="text-text">0</span>. No penalty, no bonus, no stroke points.</p>
      </Section>

      <Section title="6. Winner bonus">
        <p>The golfer who wins the tournament outright earns an additional <span className="text-accent">+3</span> on top of everything else they've scored.</p>
      </Section>

      <Section title="7–8. Tiered cut-line penalty (Round 3+)">
        <p>
          For golfers who made the cut but play poorly over the weekend, an additional penalty applies starting in Round 3,
          based on how many strokes over the cut line they're sitting. This <span className="text-text">stacks on top of</span> their
          regular stroke score and cut bonus — it's an extra deduction, not a replacement, and it can reduce a golfer's total below zero
          even after earning the +3 cut bonus.
        </p>
        <table className="w-full mt-2 text-sm">
          <thead>
            <tr className="text-left text-muted border-b border-border">
              <th className="py-1 font-normal">Strokes over cut line</th>
              <th className="py-1 font-normal text-right">Penalty</th>
            </tr>
          </thead>
          <tbody>
            {TIER_BANDS.map((b) => (
              <tr key={b.range} className="border-b border-border last:border-b-0">
                <td className="py-1.5">{b.range}</td>
                <td className="py-1.5 text-right text-danger">{b.penalty === '0' ? '0' : b.penalty}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-muted mt-2">
          This penalty only applies when enabled for the tournament, and only to golfers who made the cut.
        </p>
      </Section>

      <Section title="Entry & leaderboard totals">
        <p>An entry's total score is the sum of all 6 golfers' points. Entries are ranked by total points, descending, with ties sharing the same rank (standard golf-style tie handling — if two entries tie for 2nd, both show rank 2, and the next entry jumps to rank 4).</p>
      </Section>

      <Section title="Entry limit">
        <p>Each person can submit up to <span className="text-text">5 entries per tournament</span>. Once you've hit 5, submission is locked for that tournament — your existing entries still play, you just can't add more.</p>
      </Section>

      <Section title="Payout structure">
        <p>
          The prize pool is entry count × entry fee. How it splits depends on how many entries there are that
          tournament — bigger fields pay more places, not just a bigger 1st prize.
        </p>
        <table className="w-full mt-2 text-sm">
          <thead>
            <tr className="text-left text-muted border-b border-border">
              <th className="py-1 font-normal">Entries</th>
              <th className="py-1 font-normal">Payout split</th>
            </tr>
          </thead>
          <tbody>
            {PAYOUT_BANDS.map((b) => (
              <tr key={b.range} className="border-b border-border last:border-b-0">
                <td className="py-1.5 pr-3 text-text whitespace-nowrap">{b.range}</td>
                <td className="py-1.5">{b.split}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-muted mt-2">
          A tie consumes as many places as are tied and splits their combined payout evenly — e.g. two entries tied
          for 1st in a 20-entry pool (80% / 20% split) each get 50% (the combined 80% + 20%, halved), not 80% each.
        </p>
      </Section>

      <Section title="1v1 matches">
        <p>
          A separate side-bet format, played alongside the main pool. Two players draft <span className="text-text">6 golfers each</span> from
          the same tournament's field — <span className="text-text">5 starters plus 1 extra</span> — via a snake draft: picks alternate back and
          forth, reversing order each round, so both sides get a fair mix of favorites and longshots. A coin flip decides who picks first.
          Once a golfer is drafted by either side, they're off the board — but only for that one match; the same golfer can be drafted in
          everyone else's matches too.
        </p>
        <p>
          Each side's total is the sum of their 5 starters' points, scored by the exact same rules as the main pool above (including that
          tournament's own tiered-penalty setting). The 6th golfer, the extra, normally doesn't count — with two exceptions:
        </p>
        <p>
          <span className="text-text">Auto-substitution:</span> if a starter withdraws before the end of Round 2, the extra's score
          replaces theirs in the total. Only the first such withdrawal gets a substitute — there's just one extra to go around, so a second
          withdrawn starter takes the normal flat withdrawal penalty instead.
        </p>
        <p>
          <span className="text-text">Tiebreaker:</span> if neither side needed a substitution and the two totals are exactly equal, whoever's
          extra golfer scored higher wins the tie. If a substitution already happened and the totals still tie, there's no separate number
          left to break it with — that's a <span className="text-text">push</span>, and no money changes hands.
        </p>
        <p>
          A match can be proposed at a specific person (chosen from everyone who's ever played in this pool) or posted <span className="text-text">open
          to anyone</span> — whoever accepts first claims it. Either way, the whole thing — propose, accept, and the full draft — has to
          finish before the same picks deadline as the main pool. A draft that's still incomplete once that deadline passes is voided; no
          wager happens. The $ amount is just a record for reference, same as everything else money-related here — settled outside the app.
        </p>
      </Section>

      <p className="text-xs text-muted px-1">
        ** Starting with the <span className="text-text">2025 Open Championship</span> (July 17, 2025), the made-cut bonus / missed-cut penalty magnitude changed from ±2 to ±3, and the tiered cut-line penalty (rules 7–8) was introduced. Both apply to every major from that point forward, including all 2026 majors. Separately, entry fees changed from $10 to $20 starting with the <span className="text-text">2026 Open Championship</span> (July 16, 2026). Further back, every <span className="text-text">2023 major</span> used 5-golfer teams instead of 6 — same scoring rules otherwise, just one fewer pick per entry.
      </p>
    </div>
  );
}
