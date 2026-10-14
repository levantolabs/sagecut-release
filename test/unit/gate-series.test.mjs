import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../../src/gate/series.mjs';
import { median, medianU8, inWindows, windows, designedWindows } from '../../src/gate/util.mjs';

const flatGrey = (n, P = 64) => Array.from({ length: n }, () => new Uint8Array(P).fill(200));
const noExcuse = () => false;

test('median and medianU8', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(medianU8(Uint8Array.from([1, 2, 3, 4])), 2.5);
  assert.equal(medianU8(Uint8Array.from([9, 9, 9])), 9);
});

test('windows helpers and designed transition windows', () => {
  assert.deepEqual(windows([5, [10, 12]]), [[5, 5], [10, 12]]);
  assert.ok(inWindows(11, [[10, 12]]) && !inWindows(13, [[10, 12]]) && inWindows(13, [[10, 12]], 1));
  const s = { transitions: [{ frames: [10, 20], note: 'a designed wipe' }, { frames: [30, 40], note: 'a wipe' }, { frames: [50, 60] }] };
  assert.deepEqual(designedWindows(s), [[10, 20]]);
});

test('findFrozen: a stall longer than 1.5 s is a finding; a declared hold is skipped', () => {
  const n = 200, fps = 30;
  const g = Array.from({ length: n }, () => new Uint8Array(480 * 270));
  // moving square: columns shift 4 px per frame, frozen for 70 frames (2.3 s at 30 fps)
  const put = (f, x) => { for (let y = 100; y < 160; y++) for (let k = 0; k < 40; k++) g[f][y * 480 + x + k] = 255; };
  let x = 10;
  for (let f = 0; f < n; f++) { if (!(f >= 50 && f < 120)) x += 4; put(f, Math.min(x, 420)); }
  const d = new Float64Array(n);
  for (let f = 1; f < n; f++) { let s = 0; for (let i = 0; i < g[f].length; i++) s += Math.abs(g[f][i] - g[f - 1][i]); d[f] = s / g[f].length; }
  const r = S.findFrozen(d, g, [], fps);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].check, 'frozen_frames');
  assert.equal(r.rows[0].kind, 'finding');
  assert.ok(['major', 'minor'].includes(r.rows[0].severity));   // severity depends on the jump; the finding does not
  assert.ok(r.rows[0].frames[0] >= 49 && r.rows[0].frames[1] <= 120 && r.rows[0].length >= 60);
  assert.equal(S.findFrozen(d, g, [[40, 130]], fps).rows.length, 0);
});

test('findFrozen: a stall of 10 frames (0.33 s at 30 fps) is within the limit and is not a finding', () => {
  const n = 120, fps = 30;
  const g = Array.from({ length: n }, () => new Uint8Array(480 * 270));
  const put = (f, x) => { for (let y = 100; y < 160; y++) for (let k = 0; k < 40; k++) g[f][y * 480 + x + k] = 255; };
  let x = 10;
  for (let f = 0; f < n; f++) { if (!(f >= 50 && f < 60)) x += 4; put(f, Math.min(x, 420)); }
  const d = new Float64Array(n);
  for (let f = 1; f < n; f++) { let s = 0; for (let i = 0; i < g[f].length; i++) s += Math.abs(g[f][i] - g[f - 1][i]); d[f] = s / g[f].length; }
  assert.equal(S.findFrozen(d, g, [], fps).rows.length, 0);
});

test('findSpikes: one frame that changes the picture is a pop, a smooth ramp is not', () => {
  const n = 60, d = new Float64Array(n).fill(0.3), ink = new Float64Array(n).fill(2);
  d[30] = 6; ink[30] = 5;
  const g = flatGrey(n);
  const rows = S.findSpikes(d, g, ink, noExcuse, []);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].frames, [29, 30]);
  assert.equal(rows[0].spike_kind, 'pop');
  assert.equal(S.findSpikes(d, g, ink, (f) => f === 30, []).length, 0);       // an excused cut
  assert.equal(S.findSpikes(d, g, ink, noExcuse, [[28, 32]]).length, 0);      // a designed window
  const ramp = new Float64Array(n).fill(0.3); for (let f = 30; f < 40; f++) ramp[f] = 0.3 + (f - 29) * 0.5;
  let level = 20; const rg = Array.from({ length: n }, (_, f) => { if (f) level += ramp[f]; return new Uint8Array(64).fill(Math.round(level)); });
  const flatInk = new Float64Array(n).fill(2);
  assert.equal(S.findSpikes(ramp, rg, flatInk, noExcuse, []).length, 0);
});

test('findBlack and findLuma', () => {
  const L = new Float64Array(80).fill(200); L[40] = 1; L[41] = 1;
  const b = S.findBlack(L, noExcuse);
  assert.equal(b.length, 1); assert.deepEqual(b[0].frames, [40, 41]); assert.equal(b[0].severity, 'blocker');
  const fade = new Float64Array(80).fill(200); for (let f = 70; f < 80; f++) fade[f] = 0;
  assert.equal(S.findBlack(fade, noExcuse).length, 0);                         // a fade out to black is fine
  const L2 = new Float64Array(80).fill(120); L2[30] = 140;
  const l = S.findLuma(L2, noExcuse);
  assert.equal(l.length, 1); assert.deepEqual(l[0].frames, [30, 30]);
  const step = new Float64Array(80).fill(120); for (let f = 40; f < 80; f++) step[f] = 140;
  assert.equal(S.findLuma(step, noExcuse).length, 0);                          // a cut is a step, not a spike
});

test('findFireflies: a burst above the film median', () => {
  const ff = new Float64Array(100).fill(2); ff[50] = 120; ff[51] = 90;
  const r = S.findFireflies(ff);
  assert.equal(r.length, 1); assert.deepEqual(r[0].frames, [50, 51]);
});

test('findSeams: skipped frames and duplicate frames', () => {
  const d = new Float64Array(40).fill(1); d[20] = 5;
  assert.equal(S.findSeams(d, [20]).length, 1);
  const dup = new Float64Array(40).fill(1); dup[20] = 0.01;
  const r = S.findSeams(dup, [20]);
  assert.equal(r.length, 1); assert.equal(r[0].severity, 'minor');
  assert.equal(S.findSeams(new Float64Array(40).fill(1), [20]).length, 0);
});

test('findInkDips: a long dip between beats is a finding, a short one an escalation', () => {
  const mk = (len) => { const ink = new Float64Array(200).fill(4); for (let f = 80; f < 80 + len; f++) ink[f] = 0.5; return ink; };
  const beats = { a: { id: 'a', start: 0, end: 70, hold: [10, 70] }, b: { id: 'b', start: 120, end: 199, hold: [130, 199] } };
  const trans = [{ from: 'a', to: 'b', frames: [70, 125] }];
  const long = S.findInkDips(mk(20), trans, beats), short = S.findInkDips(mk(8), trans, beats), tiny = S.findInkDips(mk(3), trans, beats);
  assert.equal(long.length, 1); assert.equal(long[0].kind, 'finding');
  assert.equal(short.length, 1); assert.equal(short[0].kind, 'escalation');
  assert.equal(tiny.length, 0);
});

test('findCentroidJumps: a rigid skip of the coloured mass', () => {
  const n = 80, cx = [], cy = [], cnt = [];
  for (let f = 0; f < n; f++) { cx.push(100 + f + (f >= 40 ? 30 : 0)); cy.push(100); cnt.push(1000); }
  const r = S.findCentroidJumps(cx, cy, cnt, noExcuse, []);
  assert.equal(r.length, 1); assert.deepEqual(r[0].frames, [39, 40]);
  cnt[40] = 1500;                                                               // the mass changes: an entry, not a skip
  assert.equal(S.findCentroidJumps(cx, cy, cnt, noExcuse, []).length, 0);
});

test('dedupe: a black frame hides its luma pop; a glitch folds into the luma pop', () => {
  const rows = [
    { check: 'black_frames', frames: [40, 41], evidence: 'b' },
    { check: 'luma_pop', frames: [40, 40], evidence: 'l' },
    { check: 'luma_pop', frames: [70, 70], evidence: 'l2' },
    { check: 'abrupt_motion', spike_kind: 'glitch', frames: [70, 70], diff: 3, baseline: 0.1, evidence: 'g' },
  ];
  const out = S.dedupe(rows);
  assert.deepEqual(out.map((r) => r.check), ['black_frames', 'luma_pop']);
  assert.match(out[1].evidence, /frame diff/);
});

test('findCellPops: one cell vanishes in one frame while the rest stays', () => {
  const n = 40, P = 480 * 270;
  const g = Array.from({ length: n }, (_, f) => { const a = new Uint8Array(P).fill(200); if (f < 20) for (let y = 0; y < 45; y++) for (let x = 0; x < 60; x++) a[y * 480 + x] = 40; return a; });
  const r = S.findCellPops(g, noExcuse, [], [], 1920, 1080);
  assert.equal(r.rows.length, 1); assert.deepEqual(r.rows[0].frames, [19, 20]);
  assert.equal(S.findCellPops(g, noExcuse, [], [{ rect: [0, 0, 300, 200] }], 1920, 1080).rows.length, 0);   // inside an image region
});
