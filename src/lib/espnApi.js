// ESPN public golf scoreboard. No auth needed.
// Unofficial — schema may change. We normalize into a stable shape.

const SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard';

export async function fetchEspnScoreboard() {
  const res = await fetch(SCOREBOARD);
  if (!res.ok) throw new Error(`ESPN ${res.status}`);
  return res.json();
}

// Normalize ESPN response → list of golfers with the fields scoring needs.
export function normalizeEspn(raw) {
  const event = raw?.events?.[0];
  if (!event) return { tournamentName: 'Unknown', golfers: [], currentRound: 1, cutLine: null };

  const competition = event.competitions?.[0];
  const competitors = competition?.competitors || [];
  const status = competition?.status?.type || {};
  const currentRound = competition?.status?.period || 1;

  const golfers = competitors.map((c) => {
    const athlete = c.athlete || {};
    const score = c.score; // total to par, like "-8" or "E" or "+3"
    const strokesToPar = parseToPar(score);
    const espnStatus = (c.status?.type?.name || '').toLowerCase();
    const won = !!c.winner;

    // ESPN's per-player status.type.name is usually empty in the scoreboard endpoint,
    // so we only set status when ESPN tells us something explicit. Defaulting to
    // 'made_cut' post-R2 was wrong — it overwrites legitimate missed_cut entries.
    // Cut detection happens out-of-band (admin or one-off script) and the merge
    // in App.jsx preserves any non-'playing' status.
    let mappedStatus = 'playing';
    if (espnStatus.includes('cut')) mappedStatus = 'missed_cut';
    else if (espnStatus.includes('wd') || espnStatus.includes('withdrawn')) mappedStatus = 'withdrawn';

    return {
      id: athlete.id || athlete.shortName,
      name: athlete.displayName || athlete.shortName,
      strokesToPar,
      thru: c.status?.thru ?? null,
      todayToPar: parseToPar(c.linescores?.[currentRound - 1]?.displayValue),
      position: c.status?.position?.displayName ?? null,
      status: mappedStatus,
      won,
      withdrawnAfterCut: false, // ESPN doesn't expose this cleanly; admin can override
    };
  });

  // Auto-detect cut line: highest strokesToPar among made_cut golfers (post R2).
  let cutLine = null;
  if (currentRound > 2) {
    const madeCut = golfers.filter((g) => g.status !== 'missed_cut' && g.status !== 'withdrawn');
    if (madeCut.length) cutLine = Math.max(...madeCut.map((g) => g.strokesToPar ?? 0));
  }

  return {
    tournamentName: event.name,
    eventId: event.id,
    currentRound,
    cutLine,
    golfers,
  };
}

function parseToPar(s) {
  if (s == null || s === '') return 0;
  if (typeof s === 'number') return s;
  if (s === 'E' || s === 'EVEN' || s === 'Even') return 0;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : 0;
}
