// Colour parsing and ranking for brand extraction. Pure functions; no I/O.
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const h2 = (n) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');
export const toHex = (r, g, b) => `#${h2(r)}${h2(g)}${h2(b)}`;

function num(tok, scale = 1) {
  tok = tok.trim();
  if (tok.endsWith('%')) return (parseFloat(tok) / 100) * scale;
  return parseFloat(tok);
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360; s = clamp(s, 0, 1); l = clamp(l, 0, 1);
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

// Returns '#rrggbb' (lower case) or null. Transparent or mostly transparent colours return null.
export function parseColor(str) {
  if (!str) return null;
  const s = String(str).trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    if (h.length === 8 && parseInt(h.slice(6), 16) < 128) return null;
    return `#${h.slice(0, 6)}`;
  }
  m = s.match(/^(rgba?|hsla?)\(([^)]*)\)$/);
  if (!m) return null;
  const parts = m[2].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const alpha = parts[3] !== undefined ? num(parts[3], 1) : 1;
  if (Number.isFinite(alpha) && alpha < 0.5) return null;
  if (m[1].startsWith('rgb')) {
    const v = parts.slice(0, 3).map((p) => num(p, 255));
    return v.every(Number.isFinite) ? toHex(...v) : null;
  }
  const hh = parseFloat(parts[0]);
  const ss = num(parts[1], 1), ll = num(parts[2], 1);
  if (![hh, ss, ll].every(Number.isFinite)) return null;
  return toHex(...hslToRgb(hh, ss > 1 ? ss / 100 : ss, ll > 1 ? ll / 100 : ll));
}

export const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

export function hsl(hex) {
  const [r, g, b] = rgbOf(hex).map((v) => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  const d = mx - mn;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: ((h * 60) + 360) % 360, s, l };
}

export function luminance(hex) {
  const [r, g, b] = rgbOf(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
export const isNeutral = (hex) => { const v = rgbOf(hex); return (Math.max(...v) - Math.min(...v)) / 255 < 0.14; };
export const dist = (a, b) => { const p = rgbOf(a), q = rgbOf(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };

// All colour values in a CSS or style text -> Map(hex -> count).
export function colorsIn(text) {
  const counts = new Map();
  const re = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\([^)]*\)/g;
  for (const m of text.matchAll(re)) {
    const hex = parseColor(m[0]);
    if (hex) counts.set(hex, (counts.get(hex) || 0) + 1);
  }
  return counts;
}

const chromaOf = (h) => { const v = rgbOf(h); return (Math.max(...v) - Math.min(...v)) / 255; };
const okSat = (h) => { const v = rgbOf(h); return (Math.max(...v) - Math.min(...v)) / 255 >= 0.25; };
export function assignRoles({ counts, named = {}, theme = null }) {
  const all = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex);
  const neutrals = all.filter(isNeutral);
  const chromatic = all.filter((h) => !isNeutral(h));
  const score = new Map(all.map((h) => [h, counts.get(h)]));
  if (theme && !score.has(theme)) score.set(theme, 1);
  const bump = (h, n) => { if (h) score.set(h, (score.get(h) || 0) + n); };
  bump(theme, 6); bump(named.primary, 12); (named.accents || []).forEach((h) => bump(h, 5));
  const ranked = (list) => [...list].sort((a, b) => (score.get(b) || 0) - (score.get(a) || 0));

  const chroma = ranked([...new Set([...chromatic, ...(theme && !isNeutral(theme) ? [theme] : []), ...(named.primary && !isNeutral(named.primary) ? [named.primary] : [])])])
    .filter((h) => { const l = hsl(h).l; return l > 0.08 && l < 0.95; });
  const okPrimary = named.primary && !isNeutral(named.primary) && hsl(named.primary).l > 0.08 && hsl(named.primary).l < 0.95;
  const primary = okPrimary ? named.primary : (chroma[0] || (theme || null));

  let background = named.background && chromaOf(named.background) < 0.08 ? named.background : null;
  if (!background) {
    const ext = all.filter((h) => luminance(h) > 0.8 || luminance(h) < 0.04);
    const top = Math.max(1, ...ext.map((h) => score.get(h) || 0));
    background = ['#ffffff', '#000000'].find((h) => (score.get(h) || 0) >= top * 0.25) || ranked(ext.filter(isNeutral))[0] || ranked(ext)[0] || '#ffffff';
  }
  let text = named.text && contrast(named.text, background) >= 7 ? named.text : null;
  if (!text) {
    const cands = all.filter((h) => contrast(h, background) >= 7 && h !== primary);
    text = ranked(cands)[0] || (luminance(background) > 0.5 ? '#111111' : '#f5f5f5');
  }
  const accent = [];
  for (const h of chroma) {
    if (h === primary || accent.length >= 3) continue;
    if (dist(h, primary || '#000000') < 60 || accent.some((a) => dist(a, h) < 60)) continue;
    accent.push(h);
  }
  for (const h of named.accents || []) if (accent.length < 3 && h !== primary && !accent.includes(h)) accent.push(h);
  const core = new Set([background, text, primary, ...accent].filter(Boolean));
  const allowed = ranked(all).filter((h) => !core.has(h)).slice(0, 8);
  return { background, text, primary, accent, allowed };
}
