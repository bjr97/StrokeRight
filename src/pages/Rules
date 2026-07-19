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
        <p>A golfer who officially makes the cut earns a flat <span className="text-accent">+3</span>, separate from their stroke score.</p>
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
    </div>
  );
}
