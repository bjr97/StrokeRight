// American-odds string ("+450", "+50000") -> numeric magnitude for comparison.
export function oddsToNum(odds) {
  if (!odds) return -1;
  const n = parseInt(String(odds).replace(/[+]/, ''), 10);
  return Number.isFinite(n) ? n : -1;
}
