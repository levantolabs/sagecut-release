// Measurements for triage that need no Sage call.
import { decodeFrame } from './images.mjs';
import { pool } from './controlled.mjs';

const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export function popValues(gray, w, h, cell = 30) {
  const gx = Math.floor(w / cell); const gy = Math.floor(h / cell);
  const out = [];
  for (let i = 1; i < gray.length - 1; i++) {
    const a = gray[i - 1]; const b = gray[i]; const c = gray[i + 1];
    const sums = new Float64Array(gx * gy);
    for (let y = 0; y < gy * cell; y++) {
      const cy = Math.floor(y / cell) * gx;
      for (let x = 0; x < gx * cell; x++) {
        const o = y * w + x;
        sums[cy + Math.floor(x / cell)] += Math.abs(b[o] - (a[o] + c[o]) / 2);
      }
    }
    let m = 0;
    for (const s of sums) if (s > m) m = s;
    out.push(m / (cell * cell));
  }
  return out;
}

const toGray = ({ rgb, w, h }) => {
  const g = Buffer.alloc(w * h);
  for (let i = 0; i < w * h; i++) g[i] = (rgb[i * 3] * 77 + rgb[i * 3 + 1] * 150 + rgb[i * 3 + 2] * 29) >> 8;
  return g;
};

export async function popRatio(video, { root, fps, total, run }) {
  const list = run.list.length > 100 ? [run.ask_frame] : run.list;
  const lo = Math.max(0, Math.min(...list) - 17); const hi = Math.min(total - 1, Math.max(...list) + 17);
  const nums = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  const decoded = await pool(nums, 6, (f) => decodeFrame(video, f, { root, width: 480, fps }));
  if (decoded.length < 3) return { ratio: null, pop: null, frame: null };
  const { w, h } = decoded[0];
  const P = popValues(decoded.map(toGray), w, h);
  const med = Math.max(median(P), 1e-3);
  let best = { ratio: 0, pop: 0, frame: list[0] };
  for (const f of list) {
    const i = f - lo - 1;
    if (i < 0 || i >= P.length) continue;
    const r = P[i] / med;
    if (r > best.ratio) best = { ratio: Number(r.toFixed(2)), pop: Number(P[i].toFixed(2)), frame: f };
  }
  return best;
}
