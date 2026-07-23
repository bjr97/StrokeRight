// Vercel serverless endpoint: generates the final post-tournament recap.
// Called once, client-side, from Admin.jsx's "Mark complete" flow (which
// already has the winner/team/standings context computed) — this endpoint
// just holds the Anthropic key server-side, builds the prompt, calls Claude,
// and writes the result into the `recaps` table (docs/2026-07-add-recaps.sql).
//
// Round-by-round recaps are a separate thing, generated inside
// api/capture-snapshot.js (the existing daily cron) since that's where the
// live round data already lives.

import { createClient } from '@supabase/supabase-js';

const ANTHROPIC_MODEL = 'claude-sonnet-5';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY.' });
    return;
  }

  const url = (process.env.VITE_SUPABASE_URL || '').replace(/\s+/g, '');
  const key = (process.env.VITE_SUPABASE_ANON_KEY || '').replace(/\s+/g, '');
  if (!url || !key) {
    res.status(500).json({ error: 'Server is missing Supabase env vars.' });
    return;
  }
  const supabase = createClient(url, key);

  try {
    const {
      tournamentId, tournamentName, eventTypeLabel, course, winnerNames, team,
      totalPoints, prize, entryCount, highlight, storyContext, runnerUp,
    } = req.body || {};

    if (!tournamentId || !tournamentName || !winnerNames) {
      res.status(400).json({ error: 'Missing required fields (tournamentId, tournamentName, winnerNames).' });
      return;
    }

    const teamLines = (team || [])
      .map((g) => `${g.name} (${g.points >= 0 ? '+' : ''}${g.points})`)
      .join(', ');

    const contextLines = (storyContext || []).map((line) => `- ${line}`).join('\n');
    const runnerUpLine = runnerUp
      ? `Runner-up: ${runnerUp.name} — ${runnerUp.points >= 0 ? '+' : ''}${runnerUp.points} pts, lost by ${totalPoints - runnerUp.points} pt${(totalPoints - runnerUp.points) === 1 ? '' : 's'}.`
      : '';

    const prompt = `You're writing a short recap of a fantasy golf pool result for a group chat of friends who play together. Casual, sharp, a little fun — not corporate, not cheesy. 3-5 sentences max, plain prose (no headers, no bullet points, no markdown).

Tournament: ${tournamentName}${eventTypeLabel ? ` (${eventTypeLabel})` : ''}${course ? ` at ${course}` : ''}
Winner: ${winnerNames} — ${entryCount ?? '?'} entries, $${prize ?? '?'} prize, ${totalPoints >= 0 ? '+' : ''}${totalPoints} pts
Winning team (${winnerNames}'s picks): ${teamLines}
${highlight ? `Notable about the WINNING team specifically: ${highlight}` : ''}
${runnerUpLine}
${contextLines ? `Storylines to weave in if they're genuinely interesting (skip anything forced):\n${contextLines}` : ''}

Write the recap now.`;

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text().catch(() => '');
      throw new Error(`Anthropic ${aiRes.status}: ${errText.slice(0, 500)}`);
    }
    const aiJson = await aiRes.json();
    // Response content can include a leading "thinking" block before the
    // actual text block — find the text block by type, don't assume [0].
    const text = aiJson?.content?.find((c) => c.type === 'text')?.text?.trim();
    if (!text) throw new Error('Anthropic returned no text.');

    const { error } = await supabase.from('recaps').upsert({
      tournament_id: tournamentId,
      final: text,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'tournament_id', ignoreDuplicates: false });
    if (error) throw error;

    res.status(200).json({ ok: true, text });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
}
