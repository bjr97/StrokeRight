// Vercel serverless function — proxies The Odds API so the API key never
// reaches the browser. Free tier covers the 4 real majors only.
//
// GET /api/fetch-golf-odds?eventType=masters|pga|us_open|open
// -> { golfers: [{ name, odds }], bookmaker, commenceTime }

const SPORT_KEYS = {
  masters: 'golf_masters_tournament_winner',
  pga: 'golf_pga_championship_winner',
  us_open: 'golf_us_open_winner',
  open: 'golf_the_open_championship_winner',
};

export default async function handler(req, res) {
  const eventType = req.query?.eventType;
  const sportKey = SPORT_KEYS[eventType];
  if (!sportKey) {
    res.status(400).json({
      error: `Live odds aren't available for event type "${eventType}". Only the 4 majors (masters, pga, us_open, open) are covered.`,
    });
    return;
  }

  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Server is missing ODDS_API_KEY.' });
    return;
  }

  try {
    const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${apiKey}&regions=us&oddsFormat=american&markets=outrights`;
    const upstream = await fetch(url);
    if (!upstream.ok) {
      const text = await upstream.text();
      res.status(upstream.status).json({ error: `The Odds API returned ${upstream.status}: ${text}` });
      return;
    }
    const events = await upstream.json();
    const event = events[0];
    if (!event) {
      res.status(200).json({ golfers: [], bookmaker: null, commenceTime: null });
      return;
    }

    const bookmaker = event.bookmakers?.[0];
    const market = bookmaker?.markets?.find((m) => m.key === 'outrights');
    const golfers = (market?.outcomes || []).map((o) => ({
      name: o.name,
      odds: toAmericanOddsString(o.price),
    }));

    res.status(200).json({ golfers, bookmaker: bookmaker?.title || null, commenceTime: event.commence_time || null });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
}

function toAmericanOddsString(price) {
  const n = Math.round(price);
  return n >= 0 ? `+${n}` : `${n}`;
}
