// Vercel Cron target (see vercel.json) — runs once daily at 11:59 PM Central
// to pull fresh live scores for the pool's active tournament and record one
// snapshot row per entry. The app itself never wrote to the snapshots table
// during live play (see src/lib/storage.js's comment on the `snapshots` key)
// — this is what populates it going forward, so future majors accumulate
// real round-by-round history to backtest the win-probability model against
// (src/lib/winProb.js).
//
// Scoring logic below mirrors src/lib/scoring.js — duplicated rather than
// imported so this stays a standalone Node function; keep in sync if the
// scoring rules change.

import { createClient } from '@supabase/supabase-js';

const SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard';

const FOLD = { 'ø': 'o', 'æ': 'ae', 'œ': 'oe', 'ß': 'ss', 'đ': 'd', 'ł': 'l', 'ð': 'd', 'þ': 'th' };
function normalizeName(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[øæœßđłðþ]/g, (c) => FOLD[c] || c);
}

function parseToPar(s) {
  if (s == null || s === '') return 0;
  if (typeof s === 'number') return s;
  if (s === 'E' || s === 'EVEN' || s === 'Even') return 0;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : 0;
}

function normalizeEspn(raw) {
  const event = raw?.events?.[0];
  if (!event) return { golfers: [], currentRound: 1, cutLine: null };
  const competition = event.competitions?.[0];
  const competitors = competition?.competitors || [];
  const currentRound = competition?.status?.period || 1;

  const golfers = competitors.map((c) => {
    const athlete = c.athlete || {};
    const strokesToPar = parseToPar(c.score);
    const espnStatus = (c.status?.type?.name || '').toLowerCase();
    let mappedStatus = 'playing';
    if (espnStatus.includes('cut')) mappedStatus = 'missed_cut';
    else if (espnStatus.includes('wd') || espnStatus.includes('withdrawn')) mappedStatus = 'withdrawn';
    return {
      name: athlete.displayName || athlete.shortName,
      strokesToPar,
      thru: c.status?.thru ?? null,
      position: c.status?.position?.displayName ?? null,
      status: mappedStatus,
      won: !!c.winner,
    };
  });

  let cutLine = null;
  if (currentRound > 2) {
    const madeCut = golfers.filter((g) => g.status !== 'missed_cut' && g.status !== 'withdrawn');
    if (madeCut.length) cutLine = Math.max(...madeCut.map((g) => g.strokesToPar ?? 0));
  }

  return { currentRound, cutLine, golfers };
}

function tieredPenaltyBand(overCut) {
  if (overCut <= 1) return 0;
  if (overCut <= 4) return -1;
  if (overCut <= 7) return -2;
  if (overCut <= 10) return -3;
  if (overCut <= 13) return -4;
  return -5;
}

function scoreGolfer(golfer, opts) {
  const { tieredPenaltyEnabled = false, cutLine = null, currentRound = 1, cutBonusPoints = 3 } = opts;
  if (golfer.status === 'withdrawn' && !golfer.withdrawnAfterCut) return -cutBonusPoints;
  if (golfer.status === 'withdrawn' && golfer.withdrawnAfterCut) return 0;
  if (golfer.status === 'missed_cut') return -cutBonusPoints;

  const strokes = golfer.strokesToPar ?? 0;
  let points = strokes < 0 ? -strokes : 0;
  if (golfer.status === 'made_cut') points += cutBonusPoints;
  if (golfer.won) points += 3;
  if (tieredPenaltyEnabled && currentRound >= 3 && cutLine != null && golfer.status === 'made_cut') {
    points += tieredPenaltyBand((golfer.strokesToPar ?? 0) - cutLine);
  }
  return points;
}

function rankEntries(entries, golfers, opts) {
  const lookup = new Map(golfers.map((g) => [g.id, g]));
  const scored = entries.map((e) => {
    const picks = (e.golfer_ids || []).map((id) => lookup.get(id)).filter(Boolean);
    const total = picks.reduce((sum, g) => sum + scoreGolfer(g, opts), 0);
    return { entryId: e.id, total };
  });
  scored.sort((a, b) => b.total - a.total);
  let lastTotal = null;
  let lastRank = 0;
  scored.forEach((row, i) => {
    if (row.total === lastTotal) {
      row.rank = lastRank;
    } else {
      row.rank = i + 1;
      lastRank = row.rank;
      lastTotal = row.total;
    }
  });
  return scored;
}

export default async function handler(req, res) {
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
  }

  const url = (process.env.VITE_SUPABASE_URL || '').replace(/\s+/g, '');
  const key = (process.env.VITE_SUPABASE_ANON_KEY || '').replace(/\s+/g, '');
  if (!url || !key) {
    res.status(500).json({ error: 'Server is missing Supabase env vars (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).' });
    return;
  }
  const supabase = createClient(url, key);

  try {
    const { data: cfgRow, error: cfgErr } = await supabase
      .from('app_config').select('value').eq('key', 'active-tournament-id').maybeSingle();
    if (cfgErr) throw cfgErr;
    const tournamentId = cfgRow?.value;
    if (!tournamentId) {
      res.status(200).json({ skipped: 'no active tournament' });
      return;
    }

    const [{ data: tRow, error: tErr }, { data: golferRow, error: gErr }, { data: entryRows, error: eErr }] = await Promise.all([
      supabase.from('tournaments').select('*').eq('id', tournamentId).maybeSingle(),
      supabase.from('golfers').select('*').eq('tournament_id', tournamentId).maybeSingle(),
      supabase.from('entries').select('*').eq('tournament_id', tournamentId),
    ]);
    if (tErr) throw tErr;
    if (gErr) throw gErr;
    if (eErr) throw eErr;

    if (!tRow || tRow.status === 'completed') {
      res.status(200).json({ skipped: 'active tournament missing or already completed' });
      return;
    }

    const currentGolfers = golferRow?.data || [];
    const espnRes = await fetch(SCOREBOARD);
    if (!espnRes.ok) throw new Error(`ESPN ${espnRes.status}`);
    const raw = await espnRes.json();
    const { golfers: liveGolfers, currentRound: espnRound, cutLine: espnCutLine } = normalizeEspn(raw);

    // Same merge as the client's manual "Live sync" button: overlay live
    // fields by golfer name, never let a synced status revert an
    // admin/cut-logic-set terminal one.
    const TERMINAL = new Set(['made_cut', 'missed_cut', 'withdrawn']);
    const byName = new Map(liveGolfers.map((g) => [normalizeName(g.name), g]));
    const mergedGolfers = currentGolfers.map((g) => {
      const live = byName.get(normalizeName(g.name));
      if (!live) return g;
      const status = TERMINAL.has(g.status) ? g.status : live.status;
      const won = g.won || live.won;
      return { ...g, strokesToPar: live.strokesToPar, thru: live.thru, position: live.position, status, won };
    });

    await supabase.from('golfers').upsert({
      tournament_id: tournamentId,
      data: mergedGolfers,
      updated_at: new Date().toISOString(),
    });

    // Same fallback-only semantics as the client: only adopt ESPN's detected
    // round/cut-line if the admin hasn't already set one — advancing the
    // round is a deliberate admin action (it gates tiered-penalty scoring),
    // not something this job should do on its own.
    const currentRound = tRow.current_round || espnRound;
    const cutLine = tRow.cut_line ?? espnCutLine;
    if (currentRound !== tRow.current_round || cutLine !== tRow.cut_line) {
      await supabase.from('tournaments')
        .update({ current_round: currentRound, cut_line: cutLine, updated_at: new Date().toISOString() })
        .eq('id', tournamentId);
    }

    const ranked = rankEntries(entryRows || [], mergedGolfers, {
      tieredPenaltyEnabled: tRow.tiered_penalty_enabled,
      cutLine,
      currentRound,
      cutBonusPoints: tRow.cut_bonus_points ?? 3,
    });

    if (ranked.length) {
      // Tagged with ESPN's actual detected round (not the admin-gated
      // `currentRound` above) so the snapshot's round always reflects which
      // real round was being played the day of capture.
      const rows = ranked.map((r) => ({
        tournament_id: tournamentId,
        entry_id: r.entryId,
        round: espnRound,
        points: r.total,
        rank: r.rank,
      }));
      const { error } = await supabase
        .from('snapshots')
        .upsert(rows, { onConflict: 'tournament_id,entry_id,round' });
      if (error) throw error;
    }

    res.status(200).json({ ok: true, tournamentId, round: espnRound, entriesSnapshot: ranked.length });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
}
