// Checks on one full-resolution frame: safe-margin edge contact, off-palette flat colour, type near a masked object.
import * as C from './consts.mjs';
import { rgbToLab, deltaE2000, hexRgb, rgbHex } from './color.mjs';
import { medianU8, roundHalfEven } from './util.mjs';

// PIL's convert("L"): (R*19595 + G*38470 + B*7471 + 0x8000) >> 16
export function toGrey({ w, h, data }) {
  const out = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < out.length; i++, j += 3) out[i] = (data[j] * 19595 + data[j + 1] * 38470 + data[j + 2] * 7471 + 0x8000) >> 16;
  return out;
}

// 3 x 3 dilation of a boolean grid.
export function dilate(m, h, w) {
  const out = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!m[y * w + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx >= 0 && xx < w) out[yy * w + xx] = 1; }
      }
    }
  }
  return out;
}

function erode(m, h, w) {
  const out = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let all = 1;
      for (let dy = -1; dy <= 1 && all; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy, xx = x + dx;
          if (yy < 0 || yy >= h || xx < 0 || xx >= w || !m[yy * w + xx]) { all = 0; break; }
        }
      }
      out[y * w + x] = all;
    }
  }
  return out;
}

function edgeExempt(active, h, w, allow) {
  const reach = new Uint8Array(active.length), stack = [];
  const seed = (y, x) => { const i = y * w + x; if (active[i] && !reach[i]) { reach[i] = 1; stack.push(i); } };
  if (allow.has('left')) for (let y = 0; y < h; y++) seed(y, 0);
  if (allow.has('right')) for (let y = 0; y < h; y++) seed(y, w - 1);
  if (allow.has('top')) for (let x = 0; x < w; x++) seed(0, x);
  if (allow.has('bottom')) for (let x = 0; x < w; x++) seed(h - 1, x);
  while (stack.length) {
    const i = stack.pop(), y = (i / w) | 0, x = i % w;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue;
        const j = yy * w + xx;
        if (active[j] && !reach[j]) { reach[j] = 1; stack.push(j); }
      }
    }
  }
  return reach;
}

export function edgeCheck(frame, margin, allow) {
  const { w, h } = frame;
  const a = toGrey(frame);
  const bg = Math.trunc(medianU8(a));
  const struct = new Uint8Array(a.length), strong = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - bg); struct[i] = d > C.EDGE_STRUCT ? 1 : 0; strong[i] = d > C.EDGE_STRONG ? 1 : 0; }
  if (allow.size) {
    const B = C.EDGE_BLOCK, hb = Math.floor(h / B), wb = Math.floor(w / B);
    const blk = new Uint8Array(hb * wb);
    for (let y = 0; y < hb * B; y++) for (let x = 0; x < wb * B; x++) if (struct[y * w + x]) blk[((y / B) | 0) * wb + ((x / B) | 0)] = 1;
    const ex = edgeExempt(dilate(blk, hb, wb), hb, wb, allow);
    for (let y = 0; y < hb * B; y++) {
      for (let x = 0; x < wb * B; x++) {
        if (ex[((y / B) | 0) * wb + ((x / B) | 0)]) { struct[y * w + x] = 0; strong[y * w + x] = 0; }
      }
    }
  }
  const slen = Math.max(20, Math.round(C.EDGE_STRUCT_LEN * h / 1080));
  const res = {}, boxes = [];
  const bands = {
    left: [0, h, 0, margin], right: [0, h, w - margin, w], top: [0, margin, 0, w], bottom: [h - margin, h, 0, w],
  };
  for (const [name, [y0, y1, x0, x1]] of Object.entries(bands)) {
    let gap = null, n = 0, xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    const cols = new Uint32Array(x1 - x0), rows = new Uint32Array(y1 - y0);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = y * w + x;
        if (strong[i]) { n++; xmin = Math.min(xmin, x - x0); xmax = Math.max(xmax, x - x0); ymin = Math.min(ymin, y - y0); ymax = Math.max(ymax, y - y0); }
        if (struct[i]) { cols[x - x0]++; rows[y - y0]++; }
      }
    }
    if (n >= C.EDGE_MIN_PX) {
      gap = name === 'left' ? xmin : name === 'right' ? margin - 1 - xmax : name === 'top' ? ymin : margin - 1 - ymax;
      boxes.push([xmin + (name === 'right' ? w - margin : 0), ymin + (name === 'bottom' ? h - margin : 0), xmax + (name === 'right' ? w - margin : 0), ymax + (name === 'bottom' ? h - margin : 0)]);
    }
    const sums = name === 'left' || name === 'right' ? cols : rows;
    let lo = -1, hi = -1;
    for (let i = 0; i < sums.length; i++) if (sums[i] >= slen) { if (lo < 0) lo = i; hi = i; }
    if (lo >= 0) {
      const g2 = name === 'left' || name === 'top' ? lo : margin - 1 - hi;
      if (gap === null || g2 < gap) {
        gap = g2;
        if (name === 'left') boxes.push([g2, 0, g2 + 2, h]);
        else if (name === 'right') boxes.push([w - margin + hi, 0, w - margin + hi + 2, h]);
        else if (name === 'top') boxes.push([0, g2, w, g2 + 2]);
        else boxes.push([0, h - margin + hi, w, h - margin + hi + 2]);
      }
    }
    if (gap !== null) res[name] = gap;
  }
  return { res, boxes };
}

// Palette -> Lab. `hexes` are #RRGGBB strings.
export function paletteLab(hexes) {
  return hexes.map((x) => rgbToLab(...hexRgb(x)));
}

export function colourCheck(frame, toks, plab, skipRects) {
  const { w, h, data } = frame, B = 8, hb = Math.floor(h / B), wb = Math.floor(w / B), N = hb * wb;
  const mean = new Float64Array(N * 3), flat = new Uint8Array(N), tex = new Float32Array(N);
  for (let by = 0; by < hb; by++) {
    for (let bx = 0; bx < wb; bx++) {
      const mx = [0, 0, 0], mn = [255, 255, 255], sum = [0, 0, 0];
      for (let y = 0; y < B; y++) {
        let o = ((by * B + y) * w + bx * B) * 3;
        for (let x = 0; x < B; x++) {
          for (let c = 0; c < 3; c++, o++) { const v = data[o]; sum[c] += v; if (v > mx[c]) mx[c] = v; if (v < mn[c]) mn[c] = v; }
        }
      }
      const rng = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]), i = by * wb + bx;
      flat[i] = rng <= C.FLAT_RANGE ? 1 : 0;
      tex[i] = rng >= C.TEX_RANGE ? 1 : 0;
      for (let c = 0; c < 3; c++) mean[i * 3 + c] = sum[c] / (B * B);
    }
  }
  let photo = new Uint8Array(N);
  for (let by = 0; by < hb; by++) {
    for (let bx = 0; bx < wb; bx++) {
      let s = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) { const y = by + dy, x = bx + dx; if (y >= 0 && y < hb && x >= 0 && x < wb) s += tex[y * wb + x]; }
      }
      photo[by * wb + bx] = s / 25 >= 0.5 ? 1 : 0;
    }
  }
  photo = dilate(dilate(photo, hb, wb), hb, wb);
  for (const r of skipRects) {
    const [x0, y0, x1, y1] = r.map((v) => v / B);
    for (let y = Math.max(0, Math.trunc(y0)); y < Math.min(hb, Math.ceil(y1)); y++) {
      for (let x = Math.max(0, Math.trunc(x0)); x < Math.min(wb, Math.ceil(x1)); x++) photo[y * wb + x] = 1;
    }
  }
  const offIdx = [], labs = new Map();
  let okCount = 0;
  for (let i = 0; i < N; i++) {
    if (!flat[i] || photo[i]) continue;
    okCount++;
    const lab = rgbToLab(mean[i * 3], mean[i * 3 + 1], mean[i * 3 + 2]);
    let dmin = Infinity;
    for (const p of plab) dmin = Math.min(dmin, deltaE2000(lab, p));
    if (dmin > C.COLOUR_DE) { offIdx.push(i); labs.set(i, lab); }
  }
  const out = [];
  if (!okCount) return { rows: out, info: { flat_blocks: 0 } };
  if (offIdx.length) {
    const groups = new Map();
    for (const i of offIdx) {
      const k = labs.get(i).map((v) => roundHalfEven(v / 4)), s = k.join(',');
      if (!groups.has(s)) groups.set(s, { key: k, idx: [] });
      groups.get(s).idx.push(i);
    }
    const keys = [...groups.values()].sort((p, q) => q.idx.length - p.idx.length);
    const used = new Set();
    for (const k of keys) {
      if (used.has(k)) continue;
      const grp = keys.filter((o) => !used.has(o) && o.key.every((v, j) => Math.abs(v - k.key[j]) <= 1));
      grp.forEach((o) => used.add(o));
      const idx = grp.flatMap((o) => o.idx);
      const share = (idx.length * B * B) / (h * w);
      if (share < C.FLAT_MIN_AREA) continue;
      const col = [0, 0, 0], labm = [0, 0, 0];
      let gx0 = Infinity, gy0 = Infinity, gx1 = -Infinity, gy1 = -Infinity;
      for (const i of idx) {
        for (let c = 0; c < 3; c++) { col[c] += mean[i * 3 + c]; labm[c] += labs.get(i)[c]; }
        const gy = (i / wb) | 0, gx = i % wb;
        gx0 = Math.min(gx0, gx); gx1 = Math.max(gx1, gx); gy0 = Math.min(gy0, gy); gy1 = Math.max(gy1, gy);
      }
      const colM = col.map((v) => v / idx.length), labM = labm.map((v) => v / idx.length);
      let ni = 0, dEmin = Infinity;
      plab.forEach((p, j) => { const d = deltaE2000(labM, p); if (d < dEmin) { dEmin = d; ni = j; } });
      out.push({ hex: rgbHex(...colM.map(roundHalfEven)), share_pct: Math.round(share * 1000) / 10, delta_e: Math.round(dEmin * 10) / 10, nearest: toks[ni],
        bbox: [gx0 * B, gy0 * B, (gx1 + 1) * B, (gy1 + 1) * B] });
    }
  }
  return { rows: out, info: { flat_blocks: okCount, off_blocks: offIdx.length } };
}

export function maskInkCheck(frame, masks, frameNo, inkHex) {
  const { w, h, data } = frame, out = [], ink = hexRgb(inkHex);
  for (const m of masks) {
    const win = m.frames;
    if (win && !(win[0] <= frameNo && frameNo <= win[1])) continue;
    let [x0, y0, x1, y1] = m.rect.map((v) => Math.trunc(v));
    x0 = Math.max(0, x0 - C.MASK_PAD); y0 = Math.max(0, y0 - C.MASK_PAD); x1 = Math.min(w, x1 + C.MASK_PAD); y1 = Math.min(h, y1 + C.MASK_PAD);
    const cw = x1 - x0, ch = y1 - y0;
    if (cw <= 0 || ch <= 0) continue;
    const near = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const o = ((y0 + y) * w + x0 + x) * 3;
        near[y * cw + x] = Math.max(Math.abs(data[o] - ink[0]), Math.abs(data[o + 1] - ink[1]), Math.abs(data[o + 2] - ink[2])) <= 28 ? 1 : 0;
      }
    }
    const thick = erode(near, ch, cw);
    let n = 0, xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    for (let i = 0; i < thick.length; i++) {
      if (thick[i]) { n++; const x = i % cw, y = (i / cw) | 0; xmin = Math.min(xmin, x); xmax = Math.max(xmax, x); ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); }
    }
    if (n >= C.MASK_INK_MIN) {
      out.push({ check: 'type_over_object', kind: 'finding', severity: 'major', frames: [frameNo, frameNo], mask: m.id,
        evidence: `${n} px of thick ink-coloured strokes (type) lie within ${C.MASK_PAD} px of the masked object '${m.id}' (clean frames have none).`,
        bbox: [x0 + xmin, y0 + ymin, xmax - xmin, ymax - ymin] });
    }
  }
  return out;
}
