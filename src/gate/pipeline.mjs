// The gate: measure every frame, check the settled frame of every beat, and ask Sage about prepared pictures.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { probe, still, toDataUri } from '../core/ffmpeg.mjs';
import { say } from '../core/log.mjs';
import { tryCreateOcr } from '../core/ocr.mjs';
import { SageClient } from '../core/sage.mjs';
import { loadSchedule, edgeContactSides, rolelessText } from '../core/schedule.mjs';
import { loadBrand, brandPalette, designedEffects } from '../core/brand.mjs';
import { TEST_WIDTH } from '../core/config.mjs';
import { VERSION } from '../core/version.mjs';
import * as C from './consts.mjs';
import * as S from './series.mjs';
import { edgeCheck, colourCheck, paletteLab, maskInkCheck } from './frame.mjs';
import { hexRgb } from './color.mjs';
import { textChecks, normaliseLines } from './text.mjs';
import { rawFrame, resizeRGB, toPng, writePng, outline, shrink, diffImage, makeSheet, timecode } from './images.mjs';
import { loadBank, renderQuestion, askSage, judge, defaultBankPath } from './bank.mjs';
import { selectCriticFrames, writeCriticFrames, topMotionFrames } from './critic.mjs';
import { median, roundHalfEven, mapLimit, windows, inWindows, rectsAt, designedWindows } from './util.mjs';

export const GATE_VERSION = `sagecut gate ${VERSION}`;
const JPEG_OVER = 1_500_000;

export function effectWindows(sched) {
  const trans = (sched.transitions || []).map((t) => [t.frames[0], t.frames[1]]);
  const eff = (kind) => (sched.effects || []).filter((e) => e && e.kind === kind && Array.isArray(e.frames)).map((e) => [e.frames[0], e.frames[1], 0]);
  return {
    hard_cut: [...windows(sched.cuts).map(([a, b]) => [a, b, 2]), ...trans.flatMap(([a, b]) => [[a, a, 2], [b, b, 2]])],
    flash: eff('flash'),
    glitch: eff('glitch'),
  };
}

export function designedBy(row, designed, wins) {
  if (!designed.size || !wins) return null;
  const c = row.check, kind = row.spike_kind || (row.metrics && row.metrics.spike_kind);
  const fr = row.frames, ra = fr[0], rb = fr[fr.length - 1];
  const inside = (name) => (wins[name] || []).some(([a, b, pad]) => ra >= a - pad && rb <= b + pad);
  const hit = (name, ok) => (designed.has(name) && ok && inside(name) ? name : null);
  return hit('flash', c === 'luma_pop' || (c === 'abrupt_motion' && kind === 'glitch') || (c === 'black_frames' && (row.length || rb - ra + 1) <= 3))
    || hit('hard_cut', (c === 'abrupt_motion' && kind !== 'glitch') || c === 'motion_jump' || c === 'local_pop' || c === 'pop' || c === 'abrupt_change' || c === 'seam_jump')
    || hit('glitch', (c === 'abrupt_motion' && kind === 'glitch') || c === 'luma_pop' || c === 'fireflies' || c === 'local_pop')
    || null;
}

function sha12(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 12); }

function sheetFrames(beat) {
  const first = Math.min(...beat.elements.map((e) => e.in));
  const h0 = Math.max((beat.hold || [beat.end])[0], first + 1);
  const keys = new Set([first, h0, ...beat.elements.map((e) => Math.min(e.in + 8, h0))]);
  let cands = [...keys].sort((a, b) => a - b);
  if (cands.length < C.SHEET_MAX) {
    for (let i = 0; i < C.SHEET_MAX; i++) {
      const f = roundHalfEven(first + ((h0 - first) * i) / (C.SHEET_MAX - 1));
      if (!keys.has(f) && cands.length < C.SHEET_MAX) cands.push(f);
    }
  }
  cands = [...new Set(cands)].sort((a, b) => a - b);
  while (cands.length > C.SHEET_MAX) {
    let best = null;
    for (let i = 1; i < cands.length - 1; i++) { const gap = cands[i + 1] - cands[i - 1]; if (!best || gap < best[0]) best = [gap, i]; }
    cands.splice(best[1], 1);
  }
  return cands;
}

const expectedOrder = (beat) => {
  const txt = Object.fromEntries(beat.elements.map((e) => [e.id, e.order_text || e.text || e.id]));
  const order = beat.order || [...beat.elements].sort((a, b) => a.in - b.in).map((e) => e.id);
  return order.map((i) => txt[i]).join(', then ');
};

const WHAT = (testW) => ({
  dead_frame: 'the frame is essentially empty',
  pop: 'a large part of the picture changes in one frame step',
  abrupt_change: 'a large part of the picture changes at once',
  overlap: 'text overlaps other text or a busy graphic, or a moving item crosses a label',
  legible_feed: `some text is not readable at the test width (${testW} px)`,
  text_integrity: 'a word is partly hidden, split, overlapped or broken',
  hierarchy: 'the reading order is unclear',
});

export async function runGate(opts) {
  const { video, root, config, outDir, noSage = false, noOcr = false, maxBilled = 200_000 } = opts;
  const t0 = Date.now(), started = new Date().toISOString().slice(0, 19);
  const skipped = [];

  // ----- inputs -----
  if (!fs.existsSync(video)) throw new Error(`Video not found: ${video}`);
  const schedPath = opts.schedulePath || config.schedulePath;
  if (!fs.existsSync(schedPath)) throw new Error(`No schedule at ${schedPath}. Run "sagecut init", or pass --schedule FILE.`);
  const sched = loadSchedule(schedPath);
  const brand = loadBrand(opts.brandPath || config.brandPath);
  const bank = loadBank(opts.bankPath || config.question_bank || defaultBankPath());
  const qs = bank.questions;
  const info = await probe(video, { root });
  const { fps } = info, FW = info.width, FH = info.height;
  fs.mkdirSync(path.join(outDir, 'img'), { recursive: true });
  const rel = (p) => path.relative(outDir, p).split(path.sep).join('/');
  const imgDir = path.join(outDir, 'img');
  if (Math.abs((sched.fps || fps) - fps) > 0.01 || (sched.width && (sched.width !== FW || sched.height !== FH))) {
    skipped.push(`schedule says ${sched.width}x${sched.height} at ${sched.fps} fps, the video is ${FW}x${FH} at ${fps} fps: check the schedule`);
  }

  const margin = Number.isFinite(Number(sched.safe_margin_px)) ? Number(sched.safe_margin_px) : 96;
  const cuts = windows(sched.cuts), holds = windows(sched.static_holds);
  const allowEdge = new Set(edgeContactSides(sched.allow_edge_contact) || []);
  const seams = (sched.seams || []).map(Number);
  const masks = (sched.masks || []).filter((m) => m && typeof m === 'object' && m.rect).map((m) => ({ ...m, rect: m.rect.map(Number) }));
  const imgRegions = (sched.image_regions || []).map((x) => (Array.isArray(x) ? { rect: x } : x));
  const designedWins = designedWindows(sched);
  const excused = (f) => inWindows(f, cuts, C.CUT_PAD);
  const designedFx = designedEffects(brand);
  const fxWins = effectWindows(sched);
  const notes = [];
  const roleless = rolelessText(sched);
  if (roleless.length) notes.push(`${roleless.length} text element${roleless.length === 1 ? ' has' : 's have'} no role and ${roleless.length === 1 ? 'was' : 'were'} checked as caption (the smallest floor): ${roleless.slice(0, 5).join(', ')}${roleless.length > 5 ? ', ...' : ''}`);
  for (const e of designedFx) {
    const declared = e === 'hard_cut' ? (sched.cuts || []).length : (sched.effects || []).some((x) => x && x.kind === e);
    if (!declared) notes.push(`brand allows ${e}; declare its frames in schedule ${e === 'hard_cut' ? 'cuts' : 'effects'} so QA can skip them`);
  }
  const testW = Number(config.test_width) || (brand && TEST_WIDTH[brand.format]) || C.DEFAULT_TEST_WIDTH;
  if (!sched.static_holds || !sched.static_holds.length) skipped.push('static_holds not declared: frozen frames judged by context (a film that never stands still, or the same area resuming with a jump)');
  if (!seams.length) skipped.push('seams not declared: seam check uses the generic spike check only');
  if (!masks.length) skipped.push('masks not declared: type-over-object skipped');

  // ----- measurement -----
  say(`${GATE_VERSION}: measuring ${path.basename(video)}`);
  const g = await S.decodeGrey(video, { root });
  const B = S.basics(g);
  const n = B.n;
  const M = S.measureBeats(g, B, sched, fps, excused, designedWins);
  const tS = (f) => Math.round((f / fps) * 100) / 100;
  const beats = Object.fromEntries(sched.beats.map((b) => [b.id, b]));
  const settled = Object.fromEntries(M.settled.map((s) => [s.beat, s]));
  const beatOf = (f) => (sched.beats.find((b) => b.start <= f && f < b.end) || {}).id ?? null;

  const skip960 = imgRegions.filter((x) => x.grain).map((x) => [x.rect[0] * C.SCAN_W / FW, x.rect[1] * C.SCAN_H / FH, x.rect[2] * C.SCAN_W / FW, x.rect[3] * C.SCAN_H / FH, x.frames || null]);
  const scan = await S.scanVideo(video, { root, skip: skip960 });
  const d = B.diff, inkPct = Array.from(B.ink, (v) => v * 100);
  let v2 = [];
  const fz = S.findFrozen(d, g, holds, fps);
  v2.push(...fz.rows);
  const spikeRows = S.findSpikes(d, g, inkPct, excused, designedWins);
  v2.push(...spikeRows);
  v2.push(...S.findCentroidJumps(scan.cx, scan.cy, scan.cnt, excused, designedWins));
  v2.push(...S.findLuma(B.L, excused));
  v2.push(...S.findBlack(B.L, excused));
  v2.push(...S.findFireflies(scan.ff));
  v2.push(...S.findSeams(d, seams));
  v2.push(...S.findInkDips(inkPct, sched.transitions || [], beats));
  const cp = S.findCellPops(g, (f) => cuts.some(([a, b]) => a - 1 <= f && f <= b + C.CELL_CUT_AFTER), designedWins, imgRegions, FW, FH);
  v2.push(...cp.rows);
  v2 = S.dedupe(v2);
  const spikeKept = spikeRows.filter((r) => v2.includes(r));

  // ----- rows -----
  const findings = [], escalations = [], designedRows = [], passes = [];
  const add = (row, kind) => {
    const fx = designedBy(row, designedFx, fxWins);
    if (fx) { designedRows.push({ ...row, designed: true, designed_effect: fx }); return; }
    (kind === 'finding' ? findings : escalations).push(row);
  };
  const measureRows = [];
  const addMeasure = (kind, row) => { measureRows.push(row); add(row, kind); };
  const crop = (name, im, boxes, color) => {
    const drawn = boxes && boxes.length ? outline(im, boxes, color) : im;
    const file = path.join(imgDir, `${name}.png`);
    writePng(file, shrink(drawn, C.CROP_W));
    return rel(file);
  };
  const full = (name, im) => { const file = path.join(imgDir, `${name}.png`); const buf = writePng(file, im); return { path: rel(file), buf }; };
  const grabFull = (f) => rawFrame(video, f, { root, fps, w: FW, h: FH });
  const grabAt = (f, w) => rawFrame(video, f, { root, fps, w, h: Math.round((FH * w) / FW), scale: w !== FW });

  // v2 series rows: one picture each
  const abruptByFrame = new Map();
  await mapLimit(v2, 3, async (r) => {
    const [a, b] = r.frames;
    let img;
    const stepKind = ['abrupt_motion', 'motion_jump', 'seam_jump', 'local_pop'].includes(r.check) && a + 1 === b;
    let f0, boxes = null;
    if (stepKind) {
      f0 = b;
      const [p0, p1] = await Promise.all([grabAt(b - 1, C.CROP_W), grabAt(b, C.CROP_W)]);
      img = diffImage(p0, p1);
      if (r.check === 'local_pop') boxes = [r.box.map((v, i) => v * C.CROP_W / FW)];
    } else if (r.check === 'ink_dip') { f0 = (a + b) >> 1; img = await grabAt(f0, C.CROP_W); }
    else if (r.check === 'frozen_frames') { f0 = Math.min(n - 1, b + 1); img = await grabAt(f0, C.CROP_W); }
    else { f0 = a; img = await grabAt(a, C.CROP_W); }
    const c = crop(`${r.check}-f${f0}`, img, boxes, [255, 0, 0]);
    r._image = c; r._f0 = f0;
  });
  for (const r of v2) {
    const [a, b] = r.frames;
    const row = { id: a !== b ? `${r.check}-f${a}-f${b}` : `${r.check}-f${a}`, check: r.check, source: 'measure', beat: beatOf(a), frames: r.frames, t_s: tS(a),
      severity: r.severity, evidence: r.evidence, sage_answer: null, sage_p: null, image: r._image, crop: r._image,
      metrics: Object.fromEntries(Object.entries(r).filter(([k]) => !['check', 'kind', 'severity', 'frames', 'evidence'].includes(k) && !k.startsWith('_'))) };
    addMeasure(r.kind, row);
    if (r.check === 'abrupt_motion') abruptByFrame.set(b, row);
  }

  // ----- per beat: settled frame, edge, colour, text -----
  let ocr = null;
  if (noOcr) skipped.push('OCR checks off (--no-ocr): copy, text size and text-on-field skipped; type over masks uses ink colour');
  else {
    ocr = await tryCreateOcr();
    if (!ocr) { skipped.push('OCR skipped: no OCR engine available (copy, text size and text-on-field not checked; type over masks uses ink colour)'); say('OCR skipped'); }
  }
  let palette = null;
  if (brand) palette = brandPalette(brand);
  else if (sched.palette) palette = (Array.isArray(sched.palette) ? sched.palette : Object.values(sched.palette)).map((x) => String(x).toLowerCase());
  if (palette && palette.length) palette = [...new Set([...palette, '#ffffff', '#000000'])];
  else { palette = null; skipped.push('Brand colour check skipped: no brand file with a palette (run "sagecut brand")'); }
  const plab = palette ? paletteLab(palette) : null;

  const edgeRows = [], colourSeen = new Map(), sageGroups = [];
  const metas = [];     // { gi, qid, meta }
  const mediaOf = async (buf, f) => {
    if (buf.length > JPEG_OVER && f != null) return toDataUri(await still(video, f, { root, fps, format: 'jpg', quality: 2 }), 'jpg');
    return toDataUri(buf, 'png');
  };
  const addGroup = (media, items) => {
    const gi = sageGroups.length;
    sageGroups.push({ content: { kind: 'image', media }, questions: items.map(([qid, params]) => renderQuestion(qs[qid], params)) });
    items.forEach(([qid, , meta]) => metas.push({ gi, qid, meta }));
  };
  let ocrFailed = null;
  for (const b of sched.beats) {
    const bid = b.id, s = settled[bid], f = s.frame;
    const frm = await grabFull(f);
    const { path: fullPath, buf: pngBuf } = full(`${bid}-f${f}`, frm);
    const cropPath = crop(`${bid}-f${f}-crop`, frm);
    const base = { beat: bid, frames: [f], t_s: tS(f), image: cropPath, crop: cropPath, settled: s.settled };
    const e = edgeCheck(frm, Math.round((margin * FH) / (sched.height || FH)), allowEdge);
    edgeRows.push({ beat: bid, frame: f, ...Object.fromEntries(['left', 'right', 'top', 'bottom'].map((k) => [k, e.res[k] ?? null])) });
    if (Object.keys(e.res).length) {
      const ec = crop(`edge-${bid}-f${f}`, frm, e.boxes);
      const worst = Object.entries(e.res).reduce((p, q) => (q[1] < p[1] ? q : p));
      addMeasure('finding', { id: `edge_margin-${bid}-f${f}`, check: 'edge_margin', source: 'measure', beat: bid, frames: [f], t_s: tS(f), severity: 'major',
        evidence: `Text or graphics reach ${worst[1]} px from the ${worst[0]} edge on the settled frame (safe margin ${margin} px); edges hit: ${Object.entries(e.res).map(([k, v]) => `${k} ${v} px`).join(', ')}`
          + (allowEdge.size ? `. Objects connected to ${[...allowEdge].join(',')} are exempt.` : '.'),
        sage_answer: null, sage_p: null, image: ec, crop: ec });
    }
    if (plab) {
      const cc = colourCheck(frm, palette, plab, rectsAt(imgRegions, f));
      for (const c of cc.rows) {
        if (colourSeen.has(c.hex)) { colourSeen.get(c.hex).beats.push(bid); continue; }
        const ccrop = crop(`colour-${bid}-f${f}`, frm, [c.bbox], [255, 0, 255]);
        const row = { id: `brand_colour-${bid}-f${f}`, check: 'brand_colour', source: 'measure', beat: bid, frames: [f], t_s: tS(f), severity: 'major',
          evidence: `${c.share_pct}% of the frame is flat ${c.hex}, CIEDE2000 ${c.delta_e} from the nearest palette colour ${c.nearest} (limit ${C.COLOUR_DE.toFixed(1)}).`,
          sage_answer: null, sage_p: null, image: ccrop, crop: ccrop, beats: [bid] };
        colourSeen.set(c.hex, row);
        addMeasure('finding', row);
      }
    }
    let lines = null;
    if (ocr && !ocrFailed) {
      try { lines = normaliseLines((await ocr.read(pngBuf)).lines); }
      catch (err) { ocrFailed = err.message; skipped.push(`OCR failed: ${err.message} (text checks skipped; type over masks uses ink colour)`); }
    }
    const maskHit = new Set();
    if (lines) {
      for (const r of textChecks(b, lines, f, FW, FH, masks, frm)) {
        if (r.check === 'type_over_object') maskHit.add(r.mask);
        const tc = r.bbox ? crop(`${r.check}-${bid}-f${f}`, frm, [[r.bbox[0], r.bbox[1], r.bbox[0] + r.bbox[2], r.bbox[1] + r.bbox[3]]], [255, 128, 0]) : cropPath;
        addMeasure(r.kind, { id: `${r.check}-${bid}-f${f}-${r.element ?? r.mask}`, check: r.check, source: 'measure', beat: bid, frames: [f], t_s: tS(f), severity: r.severity,
          evidence: r.evidence, sage_answer: null, sage_p: null, image: tc, crop: tc });
      }
    }
    const darkest = palette && [...palette].filter((t) => t !== '#000000').sort((p, q) => hexRgb(p).reduce((x, y) => x + y) - hexRgb(q).reduce((x, y) => x + y))[0];
    const inkHex = (brand && brand.colors && brand.colors.text) || darkest;
    const maskRest = masks.filter((m) => !maskHit.has(m.id));
    if (maskRest.length && inkHex) {
      for (const r of maskInkCheck(frm, maskRest, f, inkHex)) {
        const bb = r.bbox, tc = crop(`type_over_object-${bid}-f${f}`, frm, [[bb[0], bb[1], bb[0] + bb[2], bb[1] + bb[3]]], [255, 128, 0]);
        addMeasure('finding', { id: `type_over_object-${bid}-f${f}-${r.mask}`, check: 'type_over_object', source: 'measure', beat: bid, frames: [f], t_s: tS(f), severity: r.severity,
          evidence: r.evidence, sage_answer: null, sage_p: null, image: tc, crop: tc });
      }
    }
    if (noSage) continue;
    const mk = (q) => ({ ...base, id: `${q}-${bid}-f${f}`, check: q });
    addGroup(await mediaOf(pngBuf, f), ['overlap', 'text_integrity', 'hierarchy'].map((q) => [q, {}, mk(q)]));
    const feedW = Math.min(testW, FW), feed = resizeRGB(frm, feedW, Math.round((FH * feedW) / FW));
    const fp = full(`${bid}-f${f}-test${feedW}`, feed);
    addGroup(toDataUri(fp.buf, 'png'), [['legible_feed', {}, { ...mk('legible_feed'), image: cropPath }]]);
  }
  if (ocr) { try { await ocr.close(); } catch { } }

  // ----- Sage pictures: staging sheets, difference images, dead frames -----
  const popJobs = new Map(), abruptJobs = new Map();
  let v1Spikes = M.spikes.map((s) => ({ ...s }));
  for (const r of spikeKept) {
    const f = r.frames[r.frames.length - 1];
    if (!v1Spikes.some((s) => Math.abs(f - s.frame) <= 1)) v1Spikes.push({ frame: f, diff: r.diff, where: M.trans.some(([a, b]) => a <= f && f <= b) ? 'transition' : 'entry' });
  }
  for (const t of M.tmax) {
    if (!v1Spikes.some((s) => Math.abs(t.frame - s.frame) <= 1) && !inWindows(t.frame, designedWins) && !excused(t.frame)) {
      v1Spikes.push({ frame: t.frame, diff: t.diff, where: 'transition', window: t.window, tmax: true });
    }
  }
  for (const s of v1Spikes) {
    if (s.where === 'transition') popJobs.set(s.frame, { why: s.tmax ? 'max diff in transition window' : 'measured spike in transition', diff: s.diff, window: s.window, tmax: !!s.tmax });
    else abruptJobs.set(s.frame, { diff: s.diff, beat: s.beat, element: s.element });
  }
  for (const f of [...abruptJobs.keys()]) if (popJobs.has(f)) abruptJobs.delete(f);
  const deadJobs = M.dead.map((d0) => ({ run: d0, frame: (d0.frames[0] + d0.frames[1]) >> 1 }));
  const deadMeta = new Map();

  if (!noSage) {
    // staging sheets
    const sheetBeats = sched.beats.filter((b) => b.elements.length);
    const sheetImgs = await mapLimit(sheetBeats.flatMap((b) => sheetFrames(b).map((x) => [b.id, Math.max(0, Math.min(n - 1, x))])), 4,
      async ([bid, x]) => ({ bid, x, img: await grabAt(x, 480) }));
    for (const b of sheetBeats) {
      const bid = b.id, sf = sheetFrames(b).map((x) => Math.max(0, Math.min(n - 1, x)));
      const cells = sf.map((x) => ({ img: sheetImgs.find((s) => s.bid === bid && s.x === x).img, label: `f${x}  ${timecode(x, fps)}` }));
      const sh = makeSheet(cells, { cellW: 480, cols: 4 });
      const sp = full(`sheet-${bid}`, sh);
      const scrop = crop(`sheet-${bid}-crop`, sh);
      addGroup(toDataUri(sp.buf, 'png'), [['staging_order', { expected_order: expectedOrder(b) },
        { beat: bid, frames: [sf[0], sf[sf.length - 1]], t_s: tS(sf[0]), id: `staging_order-${bid}`, check: 'staging_order', image: scrop, crop: scrop }]]);
    }
    const diffGroup = async (f, name, qid, meta) => {
      const [p0, p1] = await Promise.all([grabFull(f - 1), grabFull(f)]);
      const di = diffImage(p0, p1);
      const dp = full(name, di);
      const c = crop(`${name}-crop`, di);
      addGroup(toDataUri(dp.buf, 'png'), [[qid, {}, { ...meta, image: c, crop: c }]]);
    };
    for (const [f, j] of [...popJobs].sort((a, b) => a[0] - b[0])) {
      await diffGroup(f, `pop-f${f}`, 'pop', { beat: beatOf(f), frames: [f - 1, f], t_s: tS(f), id: `pop-f${f}`, check: 'pop',
        note: `${j.why}, mean abs diff ${j.diff}`, spike_diff: j.tmax ? null : j.diff, tmax: j.tmax });
    }
    for (const [f, j] of [...abruptJobs].sort((a, b) => a[0] - b[0])) {
      await diffGroup(f, `abrupt-f${f}`, 'abrupt_change', { beat: j.beat || beatOf(f), frames: [f - 1, f], t_s: tS(f), id: `abrupt_change-f${f}`, check: 'abrupt_change',
        note: `entry spike, mean abs diff ${j.diff}`, spike_diff: j.diff });
    }
  }
  for (const dj of deadJobs) {
    const f = dj.frame, frm = await grabFull(f);
    const fp = full(`dead-f${f}`, frm);
    const c = crop(`dead-f${f}-crop`, frm);
    const meta = { beat: beatOf(f), frames: dj.run.frames, t_s: tS(dj.run.frames[0]), id: `dead_frame-f${f}`, check: 'dead_frame', image: c, crop: c, run: dj.run };
    deadMeta.set(dj.run.frames[0], meta);
    if (!noSage) addGroup(await mediaOf(fp.buf, f), [['dead_frame', {}, meta]]);
  }

  // ----- the Sage round -----
  let answers = new Map(), usage = { billed_input_tokens: 0, output_tokens: 0, image_tokens: 0 }, sageInfo = { calls: 0, estimate: [0, 0], seconds: 0, usd: 0 };
  if (!noSage) {
    const client = new SageClient({ root, workers: config.workers, plan: config.plan, tag: 'gate' });
    if (!client.key) throw new Error('No Sage key. Put SAGE_API_KEY=... in your project .env file, or run with --no-sage (measurement only).');
    const r = await askSage(client, sageGroups, { maxBilled, onEstimate: (e) => say(`${GATE_VERSION} estimate: ${sageGroups.reduce((a, g2) => a + g2.questions.length, 0)} questions, ${e.groups} images, ${e.chunks} batches, ${e.lo.toLocaleString('en-US')}-${e.hi.toLocaleString('en-US')} input tokens (abort above ${maxBilled.toLocaleString('en-US')})`) });
    answers = r.answers; usage = r.usage; sageInfo = { calls: r.calls, estimate: r.estimate, seconds: r.seconds, usd: r.usd };
  } else say(`${GATE_VERSION}: --no-sage, measurement only`);

  // ----- decisions on Sage answers -----
  const what = WHAT(testW);
  const deadStatus = new Map();
  const sageErrors = [];
  for (const { gi, qid, meta } of metas) {
    const q = qs[qid], j = judge(q, (answers.get(gi) || new Map()).get(qid));
    if (j.status === 'error' && qid !== 'dead_frame') {
      sageErrors.push({ check: qid, beat: meta.beat ?? null, frames: meta.frames, t_s: meta.t_s, error: j.note });
      continue;
    }
    const row = { id: meta.id, check: qid, source: 'sage', beat: meta.beat ?? null, frames: meta.frames, t_s: meta.t_s, severity: q.severity, sage_answer: j.answer, sage_p: j.p, image: meta.image, crop: meta.crop };
    if ('settled' in meta && !meta.settled) row.settled = false;
    const extra = meta.note ? ` (${meta.note})` : '';
    if (qid === 'dead_frame') { deadStatus.set(meta.frames[0], { ...j, meta }); continue; }
    const wh = qid === 'staging_order' ? `elements do not arrive one at a time in the scheduled order (${expectedOrder(beats[meta.beat])})` : what[qid];
    if (qid === 'pop' || qid === 'abrupt_change') {
      const f = meta.frames[meta.frames.length - 1];
      const hit = abruptByFrame.get(f) || [...abruptByFrame].find(([fr]) => Math.abs(fr - f) <= 1)?.[1];
      if (hit) { hit.sage_answer = j.answer; hit.sage_p = j.p; hit.evidence += ` Sage ${qid} says '${j.answer}' (p=${j.p}).`; continue; }
    }
    if (j.status === 'fail' && meta.tmax) {
      row.evidence = `Sage answered '${j.answer}' (p=${j.p}): ${wh}${extra}. No measured one-frame spike backs it; look at the diff image.`;
      row.severity = 'review'; add(row, 'escalation');
    } else if (j.status === 'fail') {
      row.evidence = `Sage answered '${j.answer}' (p=${j.p}): ${wh}${extra}.`; add(row, 'finding');
    } else if (j.status === 'escalate') {
      row.evidence = `Sage ${j.note || 'is near the line'} (answer ${j.answer}, p=${j.p}): check whether ${wh}${extra}.`;
      row.severity = qid === 'hierarchy' ? 'review' : q.severity; add(row, 'escalation');
    } else if (meta.spike_diff) {
      row.evidence = `Measured spike: mean abs diff ${meta.spike_diff} in one frame step, far above its neighbours; Sage says '${j.answer}' (p=${j.p}). Look at the diff image.`;
      add(row, 'escalation');
    } else passes.push(Object.fromEntries(['id', 'check', 'beat', 'frames', 't_s', 'sage_answer', 'sage_p'].map((k) => [k, row[k]])));
  }

  for (const d0 of M.dead) {
    const [a0, b0] = d0.frames, st = deadStatus.get(a0), meta = deadMeta.get(a0);
    const status = st ? st.status : 'escalate', av = st ? st.answer : null, p = st ? st.p : null;
    if (status === 'error') sageErrors.push({ check: 'dead_frame', beat: meta ? meta.beat : null, frames: [a0, b0], t_s: tS(a0), error: st.note });
    const row = { id: `dead_frames-f${a0}-f${b0}`, check: 'dead_frames', source: 'measure', beat: meta ? meta.beat : null, frames: [a0, b0], t_s: tS(a0), severity: 'minor',
      sage_answer: av, sage_p: p, image: meta ? meta.image : null, crop: meta ? meta.crop : null };
    const baseTxt = `${d0.length} consecutive frames (${tS(a0)} s to ${tS(b0)} s) have under ${(C.DEAD_INK_SHARE * 100).toFixed(1)}% ink (peak ${d0.max_ink_pct}%)`;
    if (d0.tier === 'escalation') {
      row.evidence = `${baseTxt}, inside a transition window; clean renders dip for up to 13 frames, this is ${d0.length} (findings start at ${d0.limit}).`
        + (av !== null ? ` Sage says the mid frame is empty: '${av}'.` : '');
      add(row, 'escalation');
    } else if (status === 'pass') {
      row.evidence = `${baseTxt}; Sage says the mid frame is NOT empty (p=${p}), check for a deliberate hold.`; add(row, 'escalation');
    } else {
      row.evidence = baseTxt + (status === 'fail' ? '; Sage confirms the mid frame is empty.' : noSage ? '; Sage not run.' : status === 'error' ? '; Sage returned no answer, so the measurement stands alone.' : '; Sage gave no clear answer.');
      add(row, 'finding');
    }
  }
  for (const lst of [findings, escalations]) lst.sort((a, b) => (C.SEVERITY_RANK[a.severity] ?? 2.5) - (C.SEVERITY_RANK[b.severity] ?? 2.5) || a.frames[0] - b.frames[0]);

  // ----- critic frames -----
  const picks = selectCriticFrames({ sched, settled: M.settled, rows: [...findings, ...escalations], beatOf, total: n, motion: topMotionFrames(d) });
  const criticIndex = await writeCriticFrames(path.join(outDir, 'critic-frames'), video, info, picks, { root });

  const seconds = Math.round((Date.now() - t0) / 100) / 10;
  const result = {
    version: GATE_VERSION, video: path.resolve(video), video_sha256_12: sha12(video), schedule: path.resolve(schedPath), bank: path.resolve(bank.path), bank_sha256_12: sha12(bank.path),
    brand: brand ? brand.name : null, started, seconds, video_info: { fps, frames: n, w: FW, h: FH }, test_width: testW,
    sage: { ran: !noSage, calls: sageInfo.calls, billed_input_tokens: usage.billed_input_tokens, output_tokens: usage.output_tokens, image_tokens: usage.image_tokens,
      latency_s_total: Math.round(sageInfo.seconds * 10) / 10, estimate: sageInfo.estimate, usd: Math.round(sageInfo.usd * 1e6) / 1e6 },
    measure: {
      dead_runs: M.dead, spikes: M.spikes, transition_max_diff: M.tmax, settled: M.settled, edge: edgeRows,
      v2: { continuous_motion_film: fz.continuous, schedule_fields: { static_holds: holds, cuts, allow_edge_contact: [...allowEdge], seams, masks: masks.map((m) => m.id), image_regions: imgRegions.length, palette },
        designed_transition_windows: designedWins, designed_effects: [...designedFx], staged_cadence_frames: cp.cadence.map((r) => r.frames[r.frames.length - 1]), ocr: !!ocr && !ocrFailed,
        firefly_median: median(scan.ff), items: v2.map(({ evidence, _image, _f0, ...rest }) => rest) },
    },
    skipped, notes, findings, escalations, designed: designedRows, passes, critic_frames: criticIndex,
    sage_asked: metas.length, sage_errors: sageErrors,
  };
  fs.writeFileSync(path.join(outDir, 'findings.json'), JSON.stringify(result, null, 1) + '\n');
  fs.writeFileSync(path.join(outDir, 'summary.md'), summaryText(result, outDir));
  return result;
}

export function summaryText(r, outDir) {
  const rows = [...r.findings.map((x) => ['FINDING', x]), ...r.escalations.map((x) => ['ESCALATE', x])];
  rows.sort((a, b) => (C.SEVERITY_RANK[a[1].severity] ?? 2.5) - (C.SEVERITY_RANK[b[1].severity] ?? 2.5) || (a[0] === 'FINDING' ? 0 : 1) - (b[0] === 'FINDING' ? 0 : 1));
  const fr = (x) => (x.frames[0] === x.frames[x.frames.length - 1] ? `f${x.frames[0]}` : `f${x.frames[0]}-${x.frames[x.frames.length - 1]}`);
  const lines = [`# ${r.version} ${path.basename(r.video)} (${r.video_info.frames} frames, ${+r.video_info.fps.toFixed(3)} fps): ${r.findings.length} findings, ${r.escalations.length} escalations, ${r.passes.length} passes`];
  if (outDir) lines.push(`Run folder: ${outDir}. Image paths below are relative to it.`);
  const reserved = 2 + (r.notes || []).length + (r.skipped.length ? 1 : 0) + (r.designed.length ? 1 : 0) + 1;
  const cap = Math.max(5, 30 - reserved);
  for (const [kind, x] of rows.slice(0, cap)) lines.push(`- ${kind} [${x.severity}] ${x.check} ${fr(x)} (${x.t_s} s, ${x.beat || '-'}): ${x.evidence}${x.crop ? ` Image: ${x.crop}` : ''}`);
  if (rows.length > cap) lines.push(`- ... ${rows.length - cap} more in findings.json`);
  if (!rows.length) lines.push('- No findings. Nothing to open.');
  if (r.designed.length) lines.push(`Marked as designed, not defects (brand motion.designed and declared in the schedule: ${r.measure.v2.designed_effects.join(', ')}): ${r.designed.map((x) => `${x.check} ${fr(x)}`).join(', ')}.`);
  for (const n of r.notes || []) lines.push(`${n}.`);
  if (r.skipped.length) lines.push(`Not run or judged by default: ${r.skipped.join('; ')}.`);
  if ((r.sage_errors || []).length) {
    const n = r.sage_errors.length, asked = r.sage_asked || 0;
    lines.push(`Sage returned no answer for ${n} of ${asked} questions. These are errors, not judgements. The measurements above stand.${n === asked ? ' Sage answered none. Check the key, the endpoint and the network.' : ''}`);
    for (const e of r.sage_errors.slice(0, 5)) lines.push(`- error ${e.check} ${fr(e)} (${e.t_s} s, ${e.beat || '-'}): ${e.error}`);
  }
  const s = r.sage;
  lines.push(s.ran
    ? `Sage: ${s.billed_input_tokens.toLocaleString('en-US')} text + ${s.image_tokens.toLocaleString('en-US')} image input tokens, ${s.calls} calls, about $${s.usd.toFixed(4)}, ${s.latency_s_total.toFixed(1)} s; total ${r.seconds} s. Critic frames: ${r.critic_frames.length} in critic-frames/.`
    : `Sage: not run (--no-sage); total ${r.seconds} s. Critic frames: ${r.critic_frames.length} in critic-frames/.`);
  return lines.join('\n') + '\n';
}
