// Number formats shared by the results card (numbers.mjs) and the savings line (savings.mjs).
export const fmtUsd = (x) => (x === null || x === undefined ? 'not measured' : `$${x >= 1 ? x.toFixed(2) : x.toFixed(4)}`);

export function fmtSeconds(s) {
  if (s === null || s === undefined) return 'not measured';
  if (s < 120) return `${Math.round(s)} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${Math.round(s - m * 60)} s`;
}
