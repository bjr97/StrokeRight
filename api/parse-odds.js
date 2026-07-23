// Vercel serverless endpoint: turns whatever messy odds-board text someone
// pastes (multi-column tables, ranked lists, inconsistent spacing — the raw
// copy-paste straight off a sportsbook page) into the clean {name, odds}
// list the New Tournament wizard's field-import step needs. Replaces the
// old strict "Name, +odds per line" textarea parser in Admin.jsx's
// TierManager — that parser is gone; this is now the only way in.

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

  const { text } = req.body || {};
  if (!text || !text.trim()) {
    res.status(400).json({ error: 'No text provided.' });
    return;
  }

  const prompt = `You're extracting a golf tournament's betting field from raw pasted text — it might be a clean list, a multi-column table copy-pasted from a webpage (columns run together, headers repeat, rankings interleaved with names and odds), or anything in between.

Extract every golfer name and their odds. Normalize odds to American-odds format as a string starting with "+" (e.g. "+450", "+15000") — if the source has odds without a sign, or as decimal/fractional odds, convert to the closest equivalent positive American odds. Skip any row that isn't actually a golfer + odds pair (headers, column labels, stray numbers).

Return ONLY a raw JSON array, nothing else — no markdown code fences, no commentary, no explanation. Format: [{"name": "Scottie Scheffler", "odds": "+450"}, {"name": "Rory McIlroy", "odds": "+600"}, ...]

Text to parse:
${text}`;

  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 8000,
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
    let raw = aiJson?.content?.find((c) => c.type === 'text')?.text?.trim();
    if (!raw) throw new Error('Anthropic returned no text.');

    // Defensive: strip markdown code fences if the model added them anyway.
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();

    let golfers;
    try {
      golfers = JSON.parse(raw);
    } catch {
      throw new Error('Could not parse the AI response as JSON.');
    }
    if (!Array.isArray(golfers) || !golfers.length) {
      throw new Error('No golfers found in that text.');
    }
    golfers = golfers
      .filter((g) => g && typeof g.name === 'string' && g.name.trim())
      .map((g) => ({
        name: g.name.trim(),
        odds: typeof g.odds === 'string' && g.odds.startsWith('+') ? g.odds : `+${String(g.odds).replace(/^\+/, '')}`,
      }));
    if (!golfers.length) throw new Error('No valid golfer entries found in that text.');

    res.status(200).json({ golfers });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
}
