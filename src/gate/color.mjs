// sRGB -> CIELAB and CIEDE2000, for the off-palette check.
export function hexRgb(h) {
  const s = String(h).trim().replace(/^#/, '');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
}
export const rgbHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();

const XN = 0.95047, YN = 1.0, ZN = 1.08883;
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fxyz = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

// r, g, b may be fractional (block means). Returns [L, a, b].
export function rgbToLab(r, g, b) {
  const R = lin(r / 255), G = lin(g / 255), B = lin(b / 255);
  const x = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / XN;
  const y = (0.2126729 * R + 0.7151522 * G + 0.0721750 * B) / YN;
  const z = (0.0193339 * R + 0.1191920 * G + 0.9503041 * B) / ZN;
  const fx = fxyz(x), fy = fxyz(y), fz = fxyz(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const rad = (d) => (d * Math.PI) / 180;
const mod360 = (d) => ((d % 360) + 360) % 360;

export function deltaE2000(l1, l2) {
  const [L1, a1, b1] = l1, [L2, a2, b2] = l2;
  const c1 = Math.hypot(a1, b1), c2 = Math.hypot(a2, b2), cm = (c1 + c2) / 2;
  const g = 0.5 * (1 - Math.sqrt(cm ** 7 / (cm ** 7 + 25 ** 7)));
  const a1p = (1 + g) * a1, a2p = (1 + g) * a2;
  const c1p = Math.hypot(a1p, b1), c2p = Math.hypot(a2p, b2);
  const h1p = mod360((Math.atan2(b1, a1p) * 180) / Math.PI), h2p = mod360((Math.atan2(b2, a2p) * 180) / Math.PI);
  const dl = L2 - L1, dc = c2p - c1p;
  let dh = h2p - h1p;
  if (dh > 180) dh -= 360; else if (dh < -180) dh += 360;
  const zero = c1p * c2p === 0;
  if (zero) dh = 0;
  const dH = 2 * Math.sqrt(c1p * c2p) * Math.sin(rad(dh / 2));
  const lm = (L1 + L2) / 2, cpm = (c1p + c2p) / 2, hs = h1p + h2p;
  let hm = Math.abs(h1p - h2p) > 180 ? (hs + 360) / 2 : hs / 2;
  if (zero) hm = hs;
  const t = 1 - 0.17 * Math.cos(rad(hm - 30)) + 0.24 * Math.cos(rad(2 * hm)) + 0.32 * Math.cos(rad(3 * hm + 6)) - 0.20 * Math.cos(rad(4 * hm - 63));
  const sl = 1 + (0.015 * (lm - 50) ** 2) / Math.sqrt(20 + (lm - 50) ** 2);
  const sc = 1 + 0.045 * cpm, sh = 1 + 0.015 * cpm * t;
  const rt = -2 * Math.sqrt(cpm ** 7 / (cpm ** 7 + 25 ** 7)) * Math.sin(rad(60 * Math.exp(-(((hm - 275) / 25) ** 2))));
  return Math.sqrt((dl / sl) ** 2 + (dc / sc) ** 2 + (dH / sh) ** 2 + rt * (dc / sc) * (dH / sh));
}
