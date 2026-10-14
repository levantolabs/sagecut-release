// Measurement over the whole video: one grey pass (480 x 270) and one colour pass (960 x 540), then the series checks.
import { frames as streamFrames } from '../core/ffmpeg.mjs';
import * as C from './consts.mjs';
import { median, medianU8, inWindows } from './util.mjs';
import { longFreezes, FROZEN_MAX_DIFF } from '../core/frozen.mjs';

const f2 = (x, d = 2) => Number(x).toFixed(d);
const r3 = (x) => Math.round(x * 1000) / 1000;
const r2 = (x) => Math.round(x * 100) / 100;

// ---------- decode ----------

// All frames as 480 x 270 grey. Returns an array of Uint8Array (one per frame).
export async function decodeGrey(video, { root }) {
  const rows = [];
  for await (const fr of streamFrames(video, { root, width: C.MEASURE_W, height: C.MEASURE_H, gray: true })) rows.push(Uint8Array.from(fr.data));
  return rows;
}

export async function scanVideo(video, { root, skip = [] }) {
  const W = C.SCAN_W, H = C.SCAN_H, hw = W / 2, hh = H / 2;
  const cx = [], cy = [], cnt = [], ff = [];
  const grey = new Int16Array(W * H);
  const hot = new Uint8Array((H - 2) * (W - 2));
  const col = new Float64Array(hw), row = new Float64Array(hh);
  let fi = -1;
  for await (const fr of streamFrames(video, { root, width: W, height: H, gray: false })) {
    fi++;
    const a = fr.data;
    col.fill(0); row.fill(0);
    let c = 0;
    for (let y = 0; y < hh; y++) {
      for (let x = 0; x < hw; x++) {
        const i = (2 * y * W + 2 * x) * 3;
        const r = a[i], g = a[i + 1], b = a[i + 2];
        const mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
        const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
        if (mx - mn > C.SAT_MIN * mx && mx > C.VAL_MIN * 255) { col[x]++; row[y]++; c++; }
      }
    }
    cnt.push(c);
    if (c >= C.CENT_MIN_PX) {
      let sx = 0, sy = 0;
      for (let x = 0; x < hw; x++) sx += col[x] * x;
      for (let y = 0; y < hh; y++) sy += row[y] * y;
      cx.push(sx / c); cy.push(sy / c);
    } else { cx.push(NaN); cy.push(NaN); }
    for (let i = 0, j = 0; i < W * H; i++, j += 3) grey[i] = (a[j] * 77 + a[j + 1] * 150 + a[j + 2] * 29) >> 8;
    hot.fill(0);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        const n0 = grey[i - 1], n1 = grey[i + 1], n2 = grey[i - W], n3 = grey[i + W], n4 = grey[i - W - 1], n5 = grey[i - W + 1], n6 = grey[i + W - 1], n7 = grey[i + W + 1];
        const dev = grey[i] - ((n0 + n1 + n2 + n3 + n4 + n5 + n6 + n7) >> 3);
        if (dev > C.FF_DELTA || dev < -C.FF_DELTA) {
          const mx = Math.max(n0, n1, n2, n3, n4, n5, n6, n7), mn = Math.min(n0, n1, n2, n3, n4, n5, n6, n7);
          if (mx - mn <= C.FF_FLAT) hot[(y - 1) * (W - 2) + (x - 1)] = 1;
        }
      }
    }
    for (const [x0, y0, x1, y1, win] of skip) {
      if (win && !(win[0] <= fi && fi <= win[1])) continue;
      const ya = Math.max(0, Math.trunc(y0) - 1), yb = Math.min(H - 2, Math.max(0, Math.trunc(y1) - 1));
      const xa = Math.max(0, Math.trunc(x0) - 1), xb = Math.min(W - 2, Math.max(0, Math.trunc(x1) - 1));
      for (let y = ya; y < yb; y++) hot.fill(0, y * (W - 2) + xa, y * (W - 2) + xb);
    }
    let s = 0;
    for (let i = 0; i < hot.length; i++) s += hot[i];
    ff.push(s);
  }
  return { cx, cy, cnt, ff };
}

// ---------- basic series ----------

export function basics(g) {
  const n = g.length, P = g[0].length;
  const paper = Math.trunc(medianU8(g[0]));
  const ink = new Float64Array(n), diff = new Float64Array(n), L = new Float64Array(n);
  for (let f = 0; f < n; f++) {
    const a = g[f];
    let k = 0, s = 0, d = 0;
    const b = f ? g[f - 1] : null;
    for (let i = 0; i < P; i++) {
      const v = a[i];
      s += v;
      if (Math.abs(v - paper) > C.INK_DELTA) k++;
      if (b) d += Math.abs(v - b[i]);
    }
    ink[f] = k / P; L[f] = s / P; diff[f] = b ? d / P : 0;
  }
  return { n, paper, ink, diff, L };
}

export function meanAbsDiff(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
  return d / a.length;
}

export function measureBeats(g, B, sched, fps, excused, designed) {
  const { n, ink, diff } = B;
  const trans = (sched.transitions || []).map((t) => [t.frames[0], t.frames[1]]);
  const inTrans = (f) => trans.some(([a, b]) => a <= f && f <= b);
  const entries = sched.beats.flatMap((b) => b.elements.map((e) => [b.id, e.id, e.in]));

  const firstIn = entries.length ? Math.min(...entries.map((e) => e[2])) : 0;
  const start = Math.max(C.DEAD_START_FLOOR, firstIn + Math.round(C.DEAD_INTRO_GRACE_S * fps));
  const runs = [];
  let s = null;
  for (let f = start; f < n - 1; f++) {
    if (ink[f] < C.DEAD_INK_SHARE) { if (s === null) s = f; }
    else if (s !== null) { runs.push([s, f - 1]); s = null; }
  }
  if (s !== null) runs.push([s, n - 2]);
  const dead = [];
  for (const [a, b] of runs) {
    const length = b - a + 1;
    const touches = trans.some(([ta, tb]) => !(b < ta || a > tb));
    const limit = touches ? Math.max(C.DEAD_MIN_RUN, Math.round(C.DEAD_MIN_RUN_TRANSITION_S * fps)) : C.DEAD_MIN_RUN;
    const limitEsc = touches ? Math.max(C.DEAD_MIN_RUN, Math.round(C.DEAD_ESC_RUN_TRANSITION_S * fps)) : C.DEAD_MIN_RUN;
    if (length >= limitEsc) {
      let mx = 0;
      for (let i = a; i <= b; i++) mx = Math.max(mx, ink[i]);
      dead.push({ frames: [a, b], length, touches_transition: touches, limit, tier: length >= limit ? 'finding' : 'escalation', max_ink_pct: Math.round(mx * 1e6) / 1e4 });
    }
  }

  const med = (f) => {
    const lo = Math.max(1, f - 8), hi = Math.min(n - 1, f + 8), v = [];
    for (let i = lo; i <= hi; i++) if (i !== f) v.push(diff[i]);
    return median(v);
  };
  const isSpike = (f) => f >= 1 && f < n - 1 && !excused(f) && !inWindows(f, designed)
    && diff[f] > Math.max(C.V1_SPIKE_ABS, C.V1_SPIKE_K * med(f)) && diff[f] > C.V1_SPIKE_R * diff[f - 1];
  let spikes = [];
  const seen = new Set();
  trans.forEach(([a, b], ti) => {
    for (let f = Math.max(1, a); f <= Math.min(n - 1, b); f++) {
      if (isSpike(f)) { spikes.push({ frame: f, diff: r3(diff[f]), where: 'transition', window: ti }); seen.add(f); }
    }
  });
  for (const [bid, eid, fin] of entries) {
    for (let f = fin - C.ENTRY_PAD; f <= fin + C.ENTRY_PAD; f++) {
      if (!seen.has(f) && isSpike(f)) { spikes.push({ frame: f, diff: r3(diff[f]), where: inTrans(f) ? 'transition' : 'entry', beat: bid, element: eid }); seen.add(f); }
    }
  }
  spikes.sort((x, y) => y.diff - x.diff);
  spikes = spikes.slice(0, C.V1_SPIKE_CAP);

  const tmax = trans.map(([a, b], ti) => {
    const lo = Math.max(1, a), hi = Math.min(n - 1, b);
    let f = lo;
    for (let i = lo; i <= hi; i++) if (diff[i] > diff[f]) f = i;
    return { window: ti, frames: [a, b], frame: f, diff: r3(diff[f]), median_in_window: r3(median(Array.from(diff.subarray(lo, hi + 1)))) };
  });

  const settled = sched.beats.map((b) => {
    let [h0, h1] = b.hold || [b.start, b.end];
    h0 = Math.max(2, h0); h1 = Math.min(n - 3, h1);
    if (h1 < h0) { h0 = Math.max(2, Math.min(b.start, n - 3)); h1 = n - 3; }
    const cs = [], sc = [];
    for (let c = h0; c <= h1; c++) { cs.push(c); sc.push(meanAbsDiff(g[c + 2], g[c - 2])); }
    const best = Math.min(...sc);
    const near = cs.filter((c, i) => sc[i] <= best + 0.02);
    const mid = (h0 + h1) / 2;
    let c = near[0];
    for (const x of near) if (Math.abs(x - mid) < Math.abs(c - mid)) c = x;
    return { beat: b.id, frame: c, score: Math.round(best * 1e4) / 1e4, settled: best < C.SETTLED_MAX };
  });
  return { dead, spikes, tmax, settled, trans, entries, dead_start: start };
}

// ---------- 1. frozen frames ----------

function sameMotion(g, a, b) {
  const H = C.MEASURE_H, W = C.MEASURE_W, hb = Math.floor(H / 8), wb = Math.floor(W / 8);
  const blocks = (i, j) => {
    const m = new Uint8Array(hb * wb);
    let k = 0;
    for (let y = 0; y < hb * 8; y++) {
      for (let x = 0; x < wb * 8; x++) {
        if (Math.abs(g[j][y * W + x] - g[i][y * W + x]) > 4) { m[(y >> 3) * wb + (x >> 3)] = 1; }
      }
    }
    for (let i2 = 0; i2 < m.length; i2++) k += m[i2];
    return [m, k];
  };
  if (a < 1 || b + 1 >= g.length) return false;
  const [bp, np_] = blocks(a - 1, a), [bq, nq] = blocks(b, b + 1);
  const mn = Math.min(np_, nq);
  if (mn < C.SAME_MIN_BLOCKS) return false;
  let both = 0;
  for (let i = 0; i < bp.length; i++) if (bp[i] && bq[i]) both++;
  return both / mn >= C.SAME_MOTION;
}

export function findFrozen(d, g, holds, fps = 30) {
  const n = d.length;
  const wins = [];
  for (let i = 1; i < Math.max(2, n - 30); i += 15) wins.push(median(Array.from(d.slice(i, i + 30))));
  const continuous = wins.length > 0 && wins.filter((w) => w >= C.FROZEN_MOVING).length / wins.length >= C.FROZEN_CONTINUOUS;
  const out = [];
  for (const r of longFreezes(d, fps, holds)) {
    if (r.held) continue;                               // declared in static_holds: designed, not a finding
    const [a, b] = r.frames;
    if (b >= n - 2) continue;                           // a freeze at the very end is the end card
    const pre = Array.from(d.slice(Math.max(1, a - C.FROZEN_FLANK), a));
    const post = Array.from(d.slice(b + 1, b + 1 + C.FROZEN_FLANK));
    const preMed = pre.length ? median(pre) : 0, postMed = post.length ? median(post) : 0;
    const step = b + 1 < n ? d[b + 1] : 0;
    const same = sameMotion(g, a, b);
    const jump = preMed >= C.FROZEN_MOVING && step >= C.FROZEN_JUMP * preMed && same;
    const info = `${r.length} identical frames, ${r.seconds.toFixed(1)} s (f${a}-f${b}, mean abs diff < ${FROZEN_MAX_DIFF}); not declared in static_holds`;
    const motion = `the picture moved before (median diff ${f2(preMed)}) and after (${f2(postMed)})`;
    const row = { check: 'frozen_frames', kind: 'finding', frames: [a, b], length: r.length, pre_median: r3(preMed), post_median: r3(postMed), resume_step: r3(step), same_area: same };
    if (jump) Object.assign(row, { severity: 'major', evidence: `${info}; ${motion}; the same area resumes with a step of ${f2(step)} (${(step / Math.max(preMed, 0.05)).toFixed(1)}x the earlier motion).` });
    else Object.assign(row, { severity: 'minor', evidence: `${info}; ${motion}${continuous ? '; the rest of the film never stands still' : ''}.` });
    out.push(row);
  }
  return { rows: out, continuous };
}

// ---------- 2a. spikes anywhere ----------

export function findSpikes(d, g, inkPct, excused, designed) {
  const n = d.length, out = [];
  for (let f = 2; f < n - 1; f++) {
    if (excused(f) || inWindows(f, designed)) continue;
    const nb = [];
    for (let i = Math.max(1, f - 8); i <= Math.min(n - 1, f + 8); i++) if (Math.abs(i - f) > 1) nb.push(d[i]);
    const base = Math.max(median(nb), C.SPIKE_BASE_FLOOR);
    const nbr = Math.max(d[f - 1], d[f + 1], 0.005);
    const dink = Math.abs(inkPct[f] - inkPct[f - 1]);
    let kind = null;
    if (d[f] >= C.SPIKE_ABS && d[f] >= C.SPIKE_K * base && d[f] >= C.SPIKE_ISO * nbr && (d[f] >= C.SPIKE_STRONG || dink >= C.SPIKE_INK)) kind = 'pop';
    else if (Math.min(d[f], d[f + 1]) >= Math.max(C.SPIKE_ABS, C.SPIKE_K * base)) {
      if (meanAbsDiff(g[f + 1], g[f - 1]) <= C.GLITCH_RETURN * Math.min(d[f], d[f + 1])) kind = 'glitch';
    }
    if (!kind) continue;
    const what = kind === 'pop'
      ? 'one frame changes the picture' + (dink >= C.SPIKE_INK ? ` (ink area changes ${f2(dink)}% of the frame)` : '')
      : 'one frame differs from both its neighbours, which match each other';
    out.push({ check: 'abrupt_motion', kind: 'finding', severity: d[f] >= 1.0 ? 'major' : 'minor',
      frames: kind === 'pop' ? [f - 1, f] : [f, f], diff: r3(d[f]), baseline: r3(base), spike_kind: kind,
      evidence: `Mean abs diff ${f2(d[f], 3)} at f${f - 1}->f${f}, ${(d[f] / base).toFixed(0)}x the local median ${f2(base, 3)}: ${what}.` });
  }
  out.sort((x, y) => y.diff - x.diff);
  return out.slice(0, C.SPIKE_CAP);
}

// ---------- 2b. centre-of-motion jumps ----------

export function findCentroidJumps(cx, cy, cnt, excused, designed) {
  const n = cx.length, step = new Float64Array(n).fill(NaN), out = [];
  for (let f = 1; f < n; f++) step[f] = Math.hypot(cx[f] - cx[f - 1], cy[f] - cy[f - 1]);
  for (let f = 9; f < n - 8; f++) {
    const s = step[f];
    if (!Number.isFinite(s) || s < C.CENT_ABS || excused(f) || inWindows(f, designed)) continue;
    const nb = [];
    for (let i = f - 8; i < f; i++) if (Number.isFinite(step[i])) nb.push(step[i]);
    for (let i = f + 1; i < f + 9; i++) if (Number.isFinite(step[i])) nb.push(step[i]);
    if (nb.length < 6) continue;
    const med = Math.max(median(nb), 0.3);
    if (s < C.CENT_K * med) continue;
    const dm = (Math.abs(cnt[f] - cnt[f - 1]) / Math.max(cnt[f], cnt[f - 1], 1)) * 100;
    if (dm > C.CENT_MASS_PCT) continue;
    out.push({ check: 'motion_jump', kind: 'finding', severity: 'major', frames: [f - 1, f], step_px: r2(s), local_median_px: r2(med), mass_change_pct: r2(dm),
      evidence: `Centre of the coloured moving mass jumps ${f2(s, 1)} px (480 px scale) at f${f - 1}->f${f}, ${(s / med).toFixed(0)}x the local median step ${f2(med)} px, while the mass changes only ${f2(dm, 1)}%: the motion skips ahead.` });
  }
  return out;
}

export function findInkDips(ink, trans, beats) {
  const n = ink.length, out = [];
  const holdInk = (bid) => {
    const b = beats[bid];
    const [h0, h1] = b.hold || [b.start, b.end];
    return median(Array.from(ink.slice(Math.max(0, h0), Math.min(n, h1 + 1))));
  };
  for (const t of trans) {
    const [a, b] = t.frames;
    if (!(t.from in beats) || !(t.to in beats)) continue;
    const hf = holdInk(t.from), ht = holdInk(t.to), ref = Math.min(hf, ht), thr = C.DIP_FRAC * ref;
    const low = (f) => ink[f] < thr && ink[f] >= C.DIP_BLANK;
    let f = 0;
    while (f < n) {
      if (!low(f)) { f++; continue; }
      const s0 = f;
      while (f < n && low(f)) f++;
      const e0 = f - 1, ln = e0 - s0 + 1;
      if (e0 < a || s0 > b || ln < C.DIP_ESC) continue;
      let lo = Infinity, hi = -Infinity;
      for (let i = s0; i <= e0; i++) { lo = Math.min(lo, ink[i]); hi = Math.max(hi, ink[i]); }
      const find = ln >= C.DIP_FIND;
      out.push({ check: 'ink_dip', kind: find ? 'finding' : 'escalation', severity: find ? 'major' : 'minor', frames: [s0, e0], length: ln,
        ink_min_pct: r2(lo), ink_max_pct: r2(hi), hold_ink_pct: [r2(hf), r2(ht)], ratio_min: ref ? r3(lo / ref) : null, ratio_max: ref ? r3(hi / ref) : null,
        evidence: `The transition ${t.from} -> ${t.to} shows only ${f2(lo)}% to ${f2(hi)}% ink for ${ln} frames (f${s0}-f${e0}), `
          + `${(lo / ref * 100).toFixed(0)}% to ${(hi / ref * 100).toFixed(0)}% of the lower neighbouring hold (${f2(ref)}%; limit ${(C.DIP_FRAC * 100).toFixed(0)}%): `
          + `the picture nearly empties between beats (a finding from ${C.DIP_FIND} frames).` });
    }
  }
  return out;
}

// ---------- local one-frame pop ----------

export function findCellPops(g, excusedCell, designed, regions, FW, FH) {
  const n = g.length, W = C.MEASURE_W, H = C.MEASURE_H, R = C.CELL_ROWS, K = C.CELL_COLS;
  const ch = Math.floor(H / R), cw = Math.floor(W / K), NC = R * K;
  const M = new Float64Array(n * NC);
  for (let f = 0; f < n; f++) {
    const a = g[f];
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < K; c++) {
        let s = 0;
        for (let y = r * ch; y < r * ch + ch; y++) { const o = y * W + c * cw; for (let x = 0; x < cw; x++) s += a[o + x]; }
        M[f * NC + r * K + c] = s / (ch * cw);
      }
    }
  }
  const dM = (f, k) => (f ? M[f * NC + k] - M[(f - 1) * NC + k] : 0);
  const A = (f, k) => Math.abs(dM(f, k));
  const sx = W / FW, sy = H / FH;
  const ev = new Map();
  for (let f = 9; f < n - 9; f++) {
    if (excusedCell(f) || inWindows(f, designed)) continue;
    const act = [];
    for (const r of regions) {
      const win = r && !Array.isArray(r) ? r.frames : null;
      if (win && !(win[0] <= f && f <= win[1])) continue;
      const [x0, y0, x1, y1] = ((r && r.rect) || r).map(Number);
      act.push([x0 * sx, y0 * sy, x1 * sx, y1 * sy]);
    }
    for (let k = 0; k < NC; k++) {
      if (A(f, k) < C.CELL_ABS) continue;
      const cy = Math.floor(k / K), cx = k % K;
      const x0 = cx * cw, y0 = cy * ch, x1 = x0 + cw, y1 = y0 + ch;
      if (act.some((r) => Math.max(0, Math.min(x1, r[2]) - Math.max(x0, r[0])) * Math.max(0, Math.min(y1, r[3]) - Math.max(y0, r[1])) >= C.CELL_IMAGE_SHARE * cw * ch)) continue;
      const s = A(f, k);
      const nb = [];
      for (let i = f - 8; i < f - 1; i++) nb.push(A(i, k));
      for (let i = f + 2; i < f + 9; i++) nb.push(A(i, k));
      const base = Math.max(median(nb), 0.5);
      const nbr = Math.max(A(f - 1, k), A(f + 1, k), 0.5);
      if (s < C.CELL_K * base || s < C.CELL_ISO * nbr) continue;
      const m = (ff) => M[ff * NC + k];
      if (Math.abs(m(f - 1) - m(f - 4)) > C.CELL_STAB * s || Math.abs(m(f + 3) - m(f)) > C.CELL_STAB * s) continue;
      if (!ev.has(f)) ev.set(f, []);
      ev.get(f).push([cy, cx, dM(f, k), s / nbr]);
    }
  }
  const frames = [...ev.keys()].sort((a, b) => a - b);
  const cad = new Set();
  let i = 0;
  while (i < frames.length) {
    let j = i + 1;
    while (j < frames.length && Math.abs((frames[j] - frames[j - 1]) - (i + 1 < frames.length ? frames[i + 1] - frames[i] : 0)) <= 1) j++;
    if (j - i >= C.CADENCE_MIN) { for (let q = i; q < j; q++) cad.add(frames[q]); i = j; } else i++;
  }
  const out = [], cadence = [];
  for (const f of frames) {
    const cells = ev.get(f);
    const top = cells.reduce((p, c) => (Math.abs(c[2]) > Math.abs(p[2]) ? c : p));
    const box = [Math.min(...cells.map((c) => c[1])) * cw / sx, Math.min(...cells.map((c) => c[0])) * ch / sy,
      (Math.max(...cells.map((c) => c[1])) + 1) * cw / sx, (Math.max(...cells.map((c) => c[0])) + 1) * ch / sy].map(Math.trunc);
    const row = { check: 'local_pop', kind: 'finding', severity: 'major', frames: [f - 1, f], cells: cells.map((c) => [c[0], c[1], Math.round(c[2] * 10) / 10]), box,
      step_max: Math.round(Math.abs(top[2]) * 10) / 10, iso_min: Math.round(Math.min(...cells.map((c) => c[3])) * 10) / 10,
      evidence: `${cells.length} cell(s) of the ${K}x${R} grid change mean luma by up to ${Math.abs(top[2]).toFixed(0)} grey levels in one frame at f${f - 1}->f${f} `
        + `(each at least ${C.CELL_ISO.toFixed(0)}x its neighbouring steps and ${C.CELL_K.toFixed(0)}x its local median) and keep the new value: something vanishes or appears in one step. `
        + `Box x${box[0]}-${box[2]} y${box[1]}-${box[3]} px.` };
    (cad.has(f) ? cadence : out).push(row);
  }
  return { rows: out, cadence };
}

// ---------- plate checks: luma pops, black frames, fireflies, seams ----------

export function findLuma(L, excused) {
  const n = L.length, out = [];
  const dl = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i++) dl[i] = Math.abs(L[i + 1] - L[i]);
  for (let f = 1; f < n - 1; f++) {
    if (excused(f)) continue;
    const s = L[f] - L[f - 1], t = L[f] - L[f + 1];
    if (s * t <= 0) continue;
    const dev = Math.min(Math.abs(s), Math.abs(t));
    if (dev < 0.5 * Math.max(Math.abs(s), Math.abs(t))) continue;
    const noise = [];
    for (let i = Math.max(0, f - 9); i < Math.min(n - 1, f + 9); i++) if (i !== f - 1 && i !== f) noise.push(dl[i]);
    const nz = Math.max(median(noise), 0.05);
    if (dev >= Math.max(C.LUMA_ABS, C.LUMA_K * nz)) {
      out.push({ check: 'luma_pop', kind: 'finding', severity: 'major', frames: [f, f], luma_step: r2(dev),
        evidence: `Mean luma of f${f} is ${f2(L[f], 1)}, ${f2(Math.abs(s), 1)} and ${f2(Math.abs(t), 1)} grey levels ${s > 0 ? 'above' : 'below'} its neighbours (${f2(L[f - 1], 1)}, ${f2(L[f + 1], 1)}); the local frame-to-frame change is ${f2(nz)}.` });
    }
  }
  return out;
}

export function findBlack(L, excused) {
  const n = L.length, out = [];
  let f = 0;
  while (f < n) {
    if (!(L[f] < C.BLACK_LUMA)) { f++; continue; }
    const a = f;
    while (f < n && L[f] < C.BLACK_LUMA) f++;
    const b = f - 1;
    if (a < 2 || b > n - 3) continue;
    if (excused(a)) continue;
    if (L[a - 1] >= C.BLACK_NEIGHBOUR && L[b + 1] >= C.BLACK_NEIGHBOUR) {
      let mx = 0;
      for (let i = a; i <= b; i++) mx = Math.max(mx, L[i]);
      out.push({ check: 'black_frames', kind: 'finding', severity: 'blocker', frames: [a, b], length: b - a + 1,
        evidence: `${b - a + 1} black frame(s) (mean luma ${f2(mx, 1)}) between picture frames (luma ${L[a - 1].toFixed(0)} before, ${L[b + 1].toFixed(0)} after).` });
    }
  }
  return out;
}

export function findFireflies(ff) {
  const n = ff.length, hot = new Uint8Array(n), out = [];
  for (let f = 0; f < n; f++) {
    const base = [];
    for (let i = Math.max(0, f - 10); i < Math.min(n, f + 11); i++) if (Math.abs(i - f) > 2) base.push(ff[i]);
    const b = base.length ? median(base) : 0;
    hot[f] = ff[f] >= Math.max(C.FF_ABS, C.FF_K * Math.max(b, 1)) ? 1 : 0;
  }
  let f = 0;
  while (f < n) {
    if (!hot[f]) { f++; continue; }
    const a = f;
    while (f < n && hot[f]) f++;
    const b = f - 1;
    if (b - a + 1 > C.FF_MAX_RUN) continue;
    const base = [];
    for (let i = Math.max(0, a - 10); i < Math.min(n, b + 11); i++) if (!(a - 2 <= i && i <= b + 2)) base.push(ff[i]);
    const bm = base.length ? median(base) : 0;
    let peak = 0;
    for (let i = a; i <= b; i++) peak = Math.max(peak, ff[i]);
    out.push({ check: 'fireflies', kind: 'finding', severity: 'major', frames: [a, b], count_peak: peak, count_median: Math.round(bm * 10) / 10,
      evidence: `${peak} isolated bright or dark single pixels per frame at f${a}-f${b}; the film median is ${bm.toFixed(0)}.` });
  }
  return out;
}

export function findSeams(d, seams) {
  const n = d.length, out = [];
  for (const s of seams) {
    if (!(s >= 3 && s < n - 3)) continue;
    const nb = [];
    for (let i = Math.max(1, s - 3); i < Math.min(n, s + 4); i++) if (i !== s) nb.push(d[i]);
    const med = nb.length ? median(nb) : 0;
    if (med >= 0.05 && d[s] > C.SEAM_RATIO * med) {
      out.push({ check: 'seam_jump', kind: 'finding', severity: 'major', frames: [s - 1, s], diff: r3(d[s]),
        evidence: `Segment seam at f${s}: diff ${f2(d[s])} is ${(d[s] / med).toFixed(1)}x the neighbours' median ${f2(med)} (limit ${C.SEAM_RATIO}x): frames were skipped or jump.` });
    } else if (med >= 0.1 && d[s] < 0.1 * med) {
      out.push({ check: 'seam_jump', kind: 'finding', severity: 'minor', frames: [s - 1, s], diff: r3(d[s]),
        evidence: `Segment seam at f${s}: diff ${f2(d[s], 3)} against neighbours' median ${f2(med)}: the frame is a duplicate.` });
    }
  }
  return out;
}

export function dedupe(items) {
  const black = items.filter((r) => r.check === 'black_frames').map((r) => r.frames);
  items = items.filter((r) => !((r.check === 'luma_pop' || r.check === 'abrupt_motion') && black.some(([b0, b1]) => b0 - 1 <= r.frames[0] && r.frames[r.frames.length - 1] <= b1 + 1)));
  const luma = new Map(items.filter((r) => r.check === 'luma_pop').map((r) => [r.frames[0], r]));
  const keep = [];
  for (const r of items) {
    if (r.check === 'abrupt_motion' && r.spike_kind === 'glitch' && luma.has(r.frames[0])) {
      luma.get(r.frames[0]).evidence += ` The frame diff to both neighbours is ${r.diff} (${(r.diff / r.baseline).toFixed(0)}x the local median).`;
      continue;
    }
    keep.push(r);
  }
  return keep;
}
