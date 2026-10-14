// Small numeric helpers shared by the gate modules.
export function median(arr) {
  const n = arr.length;
  if (!n) return NaN;
  const a = Float64Array.from(arr).sort();
  const m = n >> 1;
  return n % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// Median of 8-bit values through a histogram (exact, no sort of millions of numbers).
export function medianU8(buf, step = 1) {
  const h = new Uint32Array(256);
  let n = 0;
  for (let i = 0; i < buf.length; i += step) { h[buf[i]]++; n++; }
  const at = (k) => { let c = 0; for (let v = 0; v < 256; v++) { c += h[v]; if (c > k) return v; } return 255; };
  return n % 2 ? at(n >> 1) : (at(n / 2 - 1) + at(n / 2)) / 2;
}

export const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : NaN);
export const round = (x, d = 0) => { const k = 10 ** d; return Math.round(x * k) / k; };

// numpy.round: halves go to the even neighbour.
export function roundHalfEven(x) {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

// Run fn over items with at most `limit` in flight. Results keep the order of items.
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => { for (;;) { const i = next++; if (i >= items.length) return; out[i] = await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// Frame windows: [[a, b], ...] from pairs or bare frame numbers.
export function windows(v) {
  return (v || []).map((x) => (Array.isArray(x) ? [Math.trunc(x[0]), Math.trunc(x[1])] : [Math.trunc(x), Math.trunc(x)]));
}
export const inWindows = (f, wins, pad = 0) => wins.some(([a, b]) => a - pad <= f && f <= b + pad);
export const rectOf = (x) => ((x && x.rect) || x).map(Number);
export function rectsAt(items, frame) {
  const out = [];
  for (const x of items || []) {
    const win = x && !Array.isArray(x) ? x.frames : null;
    if (win && !(win[0] <= frame && frame <= win[1])) continue;
    out.push(rectOf(x));
  }
  return out;
}

const DESIGNED_NOTE = /designed|intended|by design|deliberate/i;
const DESIGNED_KIND = /wipe|cut|flash|snap|fill|pop/i;
// Transition windows whose note says the wipe or cut is designed.
export function designedWindows(sched) {
  const out = [];
  for (const t of sched.transitions || []) {
    const note = t.note || '';
    if (DESIGNED_NOTE.test(note) && DESIGNED_KIND.test(note)) out.push([Math.trunc(t.frames[0]), Math.trunc(t.frames[1])]);
  }
  return out;
}
