// Synthetic positive controls, made in Node from the user's OWN frames (raw rgb24 buffers).

const dist = (r, g, b, c) => Math.abs(r - c[0]) + Math.abs(g - c[1]) + Math.abs(b - c[2]);

// Background = the most common colour (5 bits per channel). Ink = pixels far from the background.
export function inkInfo({ rgb, w, h }, { threshold = 60 } = {}) {
  const hist = new Map();
  for (let i = 0; i < w * h; i += 3) {
    const o = i * 3;
    const key = ((rgb[o] >> 3) << 10) | ((rgb[o + 1] >> 3) << 5) | (rgb[o + 2] >> 3);
    hist.set(key, (hist.get(key) || 0) + 1);
  }
  let best = 0; let bestN = -1;
  for (const [k, n] of hist) if (n > bestN) { best = k; bestN = n; }
  const bg = [((best >> 10) & 31) * 8 + 4, ((best >> 5) & 31) * 8 + 4, (best & 31) * 8 + 4];
  const rows = new Uint32Array(h); const cols = new Uint32Array(w);
  let count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3;
      if (dist(rgb[o], rgb[o + 1], rgb[o + 2], bg) > threshold) { rows[y]++; cols[x]++; count++; }
    }
  }
  const rMin = Math.max(3, Math.round(w * 0.004)); const cMin = Math.max(3, Math.round(h * 0.004));
  let y0 = 0; let y1 = h - 1; let x0 = 0; let x1 = w - 1;
  while (y0 < h && rows[y0] < rMin) y0++;
  while (y1 > y0 && rows[y1] < rMin) y1--;
  while (x0 < w && cols[x0] < cMin) x0++;
  while (x1 > x0 && cols[x1] < cMin) x1--;
  const found = y0 < h && x0 < w && count > 0;
  return { bg, count, frac: count / (w * h), bbox: found ? { x0, y0, x1, y1 } : null, usable: found && count / (w * h) < 0.5 && count > w * 0.5 };
}

const clone = (f) => ({ rgb: Buffer.from(f.rgb), w: f.w, h: f.h });

export function makeBlack({ w, h }) {
  return { rgb: Buffer.alloc(w * h * 3), w, h };
}

export function makeFrozen(f) {
  const w2 = f.w * 2; const out = Buffer.alloc(w2 * f.h * 3);
  for (let y = 0; y < f.h; y++) {
    const row = f.rgb.subarray(y * f.w * 3, (y + 1) * f.w * 3);
    row.copy(out, y * w2 * 3); row.copy(out, (y * w2 + f.w) * 3);
  }
  return { rgb: out, w: w2, h: f.h };
}

export function makeCut(f, info = inkInfo(f)) {
  if (!info.bbox) return null;
  const { x0, y0, x1, y1 } = info.bbox;
  const bw = x1 - x0 + 1; const bh = y1 - y0 + 1;
  const out = clone(f);
  const bg = info.bg;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const o = (y * f.w + x) * 3; out.rgb[o] = bg[0]; out.rgb[o + 1] = bg[1]; out.rgb[o + 2] = bg[2]; }
  const toRight = (x0 + x1) / 2 <= f.w / 2;
  const nx0 = toRight ? Math.round(f.w - 0.55 * bw) : Math.round(-0.45 * bw);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const dx = nx0 + x;
      if (dx < 0 || dx >= f.w) continue;     // the part beyond the edge is lost: that is the cut
      const s = ((y0 + y) * f.w + (x0 + x)) * 3; const d = ((y0 + y) * f.w + dx) * 3;
      out.rgb[d] = f.rgb[s]; out.rgb[d + 1] = f.rgb[s + 1]; out.rgb[d + 2] = f.rgb[s + 2];
    }
  }
  return out;
}

// Lay an offset copy of the ink over the frame (about 1.2 % of the width right, 0.6 % down).
export function makeGhost(f, info = inkInfo(f)) {
  if (!info.bbox) return null;
  const { x0, y0, x1, y1 } = info.bbox;
  const dx = Math.max(3, Math.round(f.w * 0.012)); const dy = Math.max(2, Math.round(f.w * 0.006));
  const out = clone(f);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const s = (y * f.w + x) * 3;
      if (dist(f.rgb[s], f.rgb[s + 1], f.rgb[s + 2], info.bg) <= 60) continue;
      const tx = x + dx; const ty = y + dy;
      if (tx >= f.w || ty >= f.h) continue;
      const d = (ty * f.w + tx) * 3;
      out.rgb[d] = f.rgb[s]; out.rgb[d + 1] = f.rgb[s + 1]; out.rgb[d + 2] = f.rgb[s + 2];
    }
  }
  return out;
}

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const PERMS = [[0, 1, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0], [0, 2, 1], [1, 0, 2]];
const candidates = () => PERMS.flatMap((p) => Array.from({ length: 8 }, (_, inv) => ({ p, inv }))).filter((m) => !(m.inv === 0 && m.p[0] === 0 && m.p[1] === 1));
const applyMap = (c, m) => m.p.map((i, k) => ((m.inv >> k) & 1 ? 255 - c[i] : c[i]));

// Pick the colour map that moves the palette furthest away from itself. palette = ['#rrggbb', ...].
export function pickOffbrandMap(palette) {
  const pal = (palette || []).filter((x) => /^#[0-9a-fA-F]{6}$/.test(x)).map(hexToRgb);
  if (!pal.length) return { map: { p: [2, 0, 1], inv: 0 }, score: null };
  let best = null;
  for (const m of candidates()) {
    const score = Math.min(...pal.map((c) => { const t = applyMap(c, m); return Math.min(...pal.map((q) => dist(t[0], t[1], t[2], q))); }));
    if (!best || score > best.score) best = { map: m, score };
  }
  return best;
}

export function makeOffbrand(f, palette) {
  const { map } = pickOffbrandMap(palette);
  const out = clone(f);
  for (let o = 0; o < out.rgb.length; o += 3) {
    const c = [f.rgb[o], f.rgb[o + 1], f.rgb[o + 2]];
    const t = applyMap(c, map);
    out.rgb[o] = t[0]; out.rgb[o + 1] = t[1]; out.rgb[o + 2] = t[2];
  }
  return out;
}

export const CONTROL_KINDS = ['cut', 'black', 'frozen', 'ghost', 'offbrand'];

export function makeControl(kind, frame, { palette = [] } = {}) {
  switch (kind) {
    case 'black': return makeBlack(frame);
    case 'frozen': return makeFrozen(frame);
    case 'offbrand': return makeOffbrand(frame, palette);
    case 'cut': { const i = inkInfo(frame); return i.usable ? makeCut(frame, i) : null; }
    case 'ghost': { const i = inkInfo(frame); return i.usable ? makeGhost(frame, i) : null; }
    default: throw new Error(`unknown control "${kind}" (use ${CONTROL_KINDS.join(', ')} or none)`);
  }
}

// The control that fits a question, chosen from its words. null = no control fits.
export function defaultControl(question) {
  const q = ` ${String(question).toLowerCase()} `;
  if (/\b(cut off|cut-off|cropped|clipped|truncat\w*|beyond the edge|past the edge|edge of the (picture|frame|image))/.test(q)) return 'cut';
  if (/\b(overlap\w*|ghost\w*|double[ds]?|doubling|duplicate\w*|touch\w*|cross\w*|twice|echo\w*)\b/.test(q)) return 'ghost';
  if (/\b(frozen|freez\w*|identical|same picture|motion|moving)\b/.test(q)) return 'frozen';
  if (/\b(colou?rs?|palette|brand|off-brand|on-brand|style)\b/.test(q)) return 'offbrand';
  if (/\b(black|blank|empty|dark)\b/.test(q)) return 'black';
  return null;
}
