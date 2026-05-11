// Payout calculator. Scales with entry count, handles tie-splitting.
// Entry fee is per-tournament (defaults to $10 per the original spec).

export const DEFAULT_ENTRY_FEE = 10;

export function payoutStructure(entryCount, entryFee = DEFAULT_ENTRY_FEE) {
  const pool = entryCount * entryFee;
  if (entryCount <= 9) {
    return { pool, tiers: [{ place: 1, pct: 1.0, amount: pool, label: 'Winner take all' }] };
  }
  if (entryCount <= 19) {
    return {
      pool,
      tiers: [
        { place: 1, amount: pool - entryFee, label: '1st (pool minus 2nd refund)' },
        { place: 2, amount: entryFee,        label: '2nd gets entry back' },
      ],
    };
  }
  if (entryCount <= 29) {
    return {
      pool,
      tiers: [
        { place: 1, pct: 0.80, amount: pool * 0.80, label: '1st (80%)' },
        { place: 2, pct: 0.20, amount: pool * 0.20, label: '2nd (20%)' },
      ],
    };
  }
  return {
    pool,
    tiers: [
      { place: 1, pct: 0.65, amount: pool * 0.65, label: '1st (65%)' },
      { place: 2, pct: 0.25, amount: pool * 0.25, label: '2nd (25%)' },
      { place: 3, pct: 0.10, amount: pool * 0.10, label: '3rd (10%)' },
    ],
  };
}

/**
 * Apply tie-splitting to a ranked list.
 * @param {Array} rankedEntries - sorted by rank, each with { rank, total }
 * @param {number} entryCount
 * @returns {Map<entryId, number>} payout per entry id
 */
export function computePayouts(rankedEntries, entryCount, entryFee = DEFAULT_ENTRY_FEE) {
  const structure = payoutStructure(entryCount, entryFee);
  const payouts = new Map();

  // Group by rank
  const byRank = new Map();
  for (const row of rankedEntries) {
    if (!byRank.has(row.rank)) byRank.set(row.rank, []);
    byRank.get(row.rank).push(row);
  }

  let placeIndex = 0; // index into structure.tiers
  for (const [, group] of [...byRank.entries()].sort((a, b) => a[0] - b[0])) {
    if (placeIndex >= structure.tiers.length) break;

    // How many paying tiers does this rank-group consume?
    const groupSize = group.length;
    const consumed = structure.tiers.slice(placeIndex, placeIndex + groupSize);
    const combined = consumed.reduce((s, t) => s + t.amount, 0);
    const perEntry = combined / groupSize;

    for (const row of group) {
      payouts.set(row.entry.id, perEntry);
    }
    placeIndex += groupSize;
  }

  return { payouts, structure };
}

export function fmtMoney(n) {
  if (n == null) return '$0';
  return '$' + n.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
