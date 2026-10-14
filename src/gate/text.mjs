// Text checks on the settled frame of a beat, from OCR lines: changed or cut words, and text under the legibility floor.
import * as C from './consts.mjs';
import { rgbToLab, deltaE2000 } from './color.mjs';
import { rectOf } from './util.mjs';

// ---- difflib.SequenceMatcher.ratio (Ratcliff/Obershelp) ----
function longestMatch(a, b, alo, ahi, blo, bhi) {
  let bi = alo, bj = blo, bs = 0;
  let prev = new Map();
  for (let i = alo; i < ahi; i++) {
    const cur = new Map();
    for (let j = blo; j < bhi; j++) {
      if (a[i] !== b[j]) continue;
      const k = (prev.get(j - 1) || 0) + 1;
      cur.set(j, k);
      if (k > bs) { bi = i - k + 1; bj = j - k + 1; bs = k; }
    }
    prev = cur;
  }
  return [bi, bj, bs];
}

export function similarity(a, b) {
  if (!a.length && !b.length) return 1;
  let matches = 0;
  const queue = [[0, a.length, 0, b.length]];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop();
    const [i, j, k] = longestMatch(a, b, alo, ahi, blo, bhi);
    if (!k) continue;
    matches += k;
    if (alo < i && blo < j) queue.push([alo, i, blo, j]);
    if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
  }
  return (2 * matches) / (a.length + b.length);
}

// Lowercase alphanumeric words ('$5,000,000' -> '5000000'). Punctuation and bullets drop.
export function words(s) {
  const t = String(s).toLowerCase().replace(/[·•/—–]/g, ' ');
  return t.split(/\s+/).map((w) => w.replace(/[^0-9a-z]/g, '')).filter(Boolean);
}

export function literalText(el) {
  if (el.literal === false) return false;
  if (el.literal === true) return true;
  const t = el.text || '';
  if (el.order_text && !words(el.order_text).join(' ').includes(words(t).join(' '))) return false;
  const n = words(t).length;
  return n > 0 && n <= 10;
}

export function normaliseLines(lines) {
  return (lines || []).map((l) => ({
    text: l.text, x: l.bbox.x0, y: l.bbox.y0, w: l.bbox.x1 - l.bbox.x0, h: l.bbox.y1 - l.bbox.y0,
    conf: l.confidence > 1 ? l.confidence / 100 : l.confidence,
  }));
}

// ---- legibility floors (house rules) ----
const URL_LIKE = /(https?:\/\/|www\.|\b[\w-]+\.(com|io|ai|app|dev|org|net|xyz|co|so|me)\b)/i;
export const ROLES = ['headline', 'body', 'caption', 'url'];

export function roleOf(el, lineText) {
  if (el && ROLES.includes(el.role)) return el.role;
  return URL_LIKE.test(lineText || '') ? 'url' : 'caption';
}

// The floor in px of type for a role, scaled to the video width.
export const floorPx = (role, videoWidth) => (C.HOUSE_FLOORS[role] * videoWidth) / C.FLOOR_REF_W;
// Estimated size of the type from the OCR height of a line.
export const typePx = (lineH) => lineH / C.OCR_TO_TYPE;

function groundOf(png, ln) {
  const { w, h, data } = png;
  const x0 = Math.max(0, Math.trunc(ln.x)), y0 = Math.max(0, Math.trunc(ln.y)), x1 = Math.min(w, Math.trunc(ln.x + ln.w)), y1 = Math.min(h, Math.trunc(ln.y + ln.h));
  const n = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  if (n < 200) return null;
  const counts = new Map();
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * w + x) * 3, key = (data[o] >> 3) * 1024 + (data[o + 1] >> 3) * 32 + (data[o + 2] >> 3);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  let mode = -1, best = -1;
  for (const [k, c] of counts) if (c > best || (c === best && k < mode)) { best = c; mode = k; }
  const sum = [0, 0, 0];
  let m = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * w + x) * 3;
      if ((((data[o] >> 3) * 1024 + (data[o + 1] >> 3) * 32 + (data[o + 2] >> 3))) === mode) { sum[0] += data[o]; sum[1] += data[o + 1]; sum[2] += data[o + 2]; m++; }
    }
  }
  const ground = sum.map((v) => v / m);
  let flat = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * w + x) * 3;
      if (Math.max(Math.abs(data[o] - ground[0]), Math.abs(data[o + 1] - ground[1]), Math.abs(data[o + 2] - ground[2])) <= 20) flat++;
    }
  }
  return { ground, flat: flat / n };
}

function pageColour(png) {
  const { data } = png;
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  for (let i = 0; i < data.length; i += 3) { hist[0][data[i]]++; hist[1][data[i + 1]]++; hist[2][data[i + 2]]++; }
  const n = data.length / 3;
  return hist.map((h) => {
    const at = (k) => { let c = 0; for (let v = 0; v < 256; v++) { c += h[v]; if (c > k) return v; } return 255; };
    return n % 2 ? at(n >> 1) : (at(n / 2 - 1) + at(n / 2)) / 2;
  });
}

export function textChecks(beat, lines, frame, W, H, masks, png) {
  const out = [], ocrWords = [];
  for (const ln of lines) for (const wd of words(ln.text)) ocrWords.push([wd, ln]);
  const page = png ? pageColour(png) : null;
  const seenLines = new Set(), small = [];
  for (const el of beat.elements || []) {
    if (!literalText(el)) continue;
    const want = words(el.text), pool = [...ocrWords], hitLines = [], missing = [];
    for (const wd of want) {
      const idx = pool.findIndex(([ow]) => ow === wd);
      if (idx < 0) missing.push(wd); else hitLines.push(pool.splice(idx, 1)[0][1]);
    }
    for (const wd of missing) {
      let best = 0, bi = null;
      pool.forEach(([ow], i) => {
        if (ow.length < 3 || wd.length < 3) return;
        const r = similarity(wd, ow);
        if (r > best) { best = r; bi = i; }
      });
      if (bi !== null && best >= C.OCR_NEAR) {
        const [ow, ln] = pool.splice(bi, 1)[0];
        out.push({ check: 'text_match', kind: 'finding', severity: 'major', frames: [frame, frame], element: el.id, expected: wd, read: ow,
          evidence: `Element '${el.id}' should read "${el.text}" but the frame reads "${ln.text}": '${ow}' where the schedule has '${wd}'.`, bbox: [ln.x, ln.y, ln.w, ln.h] });
      }
    }
    const uniq = [...new Set(hitLines)];
    for (const ln of uniq) {
      if (seenLines.has(ln)) continue;
      const role = roleOf(el, ln.text), floor = floorPx(role, W), size = typePx(ln.h);
      if (size < floor * C.FLOOR_TOLERANCE) { seenLines.add(ln); small.push({ el, ln, role, floor, size }); }
    }
    if (png) {
      for (const ln of uniq) {
        const g = groundOf(png, ln);
        if (!g || g.flat < 0.55) continue;
        const dE = deltaE2000(rgbToLab(...g.ground), rgbToLab(...page));
        if (dE > 10) {
          const hex = '#' + g.ground.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
          out.push({ check: 'text_on_field', kind: 'escalation', severity: 'review', frames: [frame, frame], element: el.id,
            evidence: `Element '${el.id}' ("${ln.text}") sits on a flat field ${hex}, not on the page colour (dE ${dE.toFixed(0)}); check it is a designed chip or card, not type on top of a graphic.`,
            bbox: [ln.x, ln.y, ln.w, ln.h] });
        }
      }
    }
  }
  if (small.length) {
    const worst = small.reduce((p, q) => (q.size / q.floor < p.size / p.floor ? q : p));
    const names = [...new Set(small.map((s) => `'${s.el.id}'`))].join(', ');
    out.push({ check: 'text_size', kind: 'finding', severity: 'major', frames: [frame, frame], element: worst.el.id, role: worst.role,
      size_px: Math.round(worst.size), floor_px: Math.round(worst.floor),
      evidence: `${small.length} text line(s) of element(s) ${names} are under the legibility floor for ${W} px wide video; the smallest `
        + `("${worst.ln.text}", ${worst.role}) is about ${worst.size.toFixed(0)} px type (OCR height ${worst.ln.h.toFixed(0)} px), the ${worst.role} floor is ${worst.floor.toFixed(0)} px (flagged below ${(worst.floor * C.FLOOR_TOLERANCE).toFixed(0)} px) `
        + `(${C.HOUSE_FLOORS[worst.role]} px at ${C.FLOOR_REF_W} px wide).`,
      bbox: [worst.ln.x, worst.ln.y, worst.ln.w, worst.ln.h] });
  }
  const minH = C.OCR_TO_TYPE * floorPx('url', W);
  for (const m of masks || []) {
    const win = m.frames;
    if (win && !(win[0] <= frame && frame <= win[1])) continue;
    const [rx0, ry0, rx1, ry1] = rectOf(m);
    for (const ln of lines) {
      if (ln.h < minH || ln.conf < 0.5) continue;
      const lx0 = ln.x, ly0 = ln.y, lx1 = ln.x + ln.w, ly1 = ln.y + ln.h;
      const gap = Math.max(rx0 - lx1, lx0 - rx1, ry0 - ly1, ly0 - ry1);
      if (gap < C.MASK_PAD) {
        out.push({ check: 'type_over_object', kind: 'finding', severity: 'major', frames: [frame, frame], mask: m.id,
          evidence: `Type "${ln.text}" is ${gap < 0 ? 'inside' : Math.round(gap) + ' px from'} the masked object '${m.id}' (clearance floor ${C.MASK_PAD} px).`, bbox: [ln.x, ln.y, ln.w, ln.h] });
      }
    }
  }
  return out;
}
