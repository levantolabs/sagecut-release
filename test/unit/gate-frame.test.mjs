import test from 'node:test';
import assert from 'node:assert/strict';
import { edgeCheck, colourCheck, maskInkCheck, paletteLab, toGrey } from '../../src/gate/frame.mjs';
import { hexRgb } from '../../src/gate/color.mjs';

function canvas(w, h, rgb) {
  const data = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) { data[i * 3] = rgb[0]; data[i * 3 + 1] = rgb[1]; data[i * 3 + 2] = rgb[2]; }
  return { w, h, data };
}
function rect(img, x0, y0, x1, y1, rgb) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const o = (y * img.w + x) * 3; img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2]; }
}
const PAPER = [244, 240, 229], INK = [11, 18, 51];

test('toGrey follows the PIL formula', () => {
  const g = toGrey(canvas(2, 1, [255, 0, 0]));
  assert.equal(g[0], 76);
});

test('edgeCheck: ink inside the safe margin is found, with the gap', () => {
  const img = canvas(400, 300, PAPER);
  rect(img, 30, 100, 150, 140, INK);        // 30 px from the left edge, margin is 60
  const { res } = edgeCheck(img, 60, new Set());
  assert.equal(res.left, 30);
  assert.equal(res.right, undefined);
});

test('edgeCheck: a clean frame has no contact; an object connected to an allowed edge is exempt', () => {
  const clean = canvas(400, 300, PAPER);
  rect(clean, 100, 100, 300, 200, INK);
  assert.deepEqual(edgeCheck(clean, 60, new Set()).res, {});
  const hand = canvas(400, 300, PAPER);
  rect(hand, 0, 120, 120, 180, INK);        // enters from the left edge
  assert.equal(edgeCheck(hand, 60, new Set()).res.left, 0);
  assert.deepEqual(edgeCheck(hand, 60, new Set(['left'])).res, {});
});

test('edgeCheck: a full-bleed flat field is background, not ink', () => {
  const field = canvas(400, 300, [20, 56, 212]);
  rect(field, 100, 100, 300, 200, [255, 255, 255]);
  assert.deepEqual(edgeCheck(field, 60, new Set()).res, {});
});

test('colourCheck: a large flat off-palette area is a finding, a palette area is not', () => {
  const plab = paletteLab(['#f4f0e5', '#0b1233', '#1438d4']);
  const toks = ['#f4f0e5', '#0b1233', '#1438d4'];
  const ok = canvas(320, 240, PAPER);
  rect(ok, 40, 40, 200, 160, hexRgb('#1438D4'));
  assert.equal(colourCheck(ok, toks, plab, []).rows.length, 0);
  const bad = canvas(320, 240, PAPER);
  rect(bad, 40, 40, 200, 160, [18, 183, 164]);
  const r = colourCheck(bad, toks, plab, []).rows;
  assert.equal(r.length, 1);
  assert.ok(r[0].delta_e > 6 && r[0].share_pct > 20);
  assert.deepEqual(r[0].bbox.map((v) => v % 8), [0, 0, 0, 0]);
  assert.equal(colourCheck(bad, toks, plab, [[32, 32, 208, 168]]).rows.length, 0);    // inside an image region
});

test('maskInkCheck: thick ink-coloured strokes near a mask', () => {
  const img = canvas(400, 300, PAPER);
  rect(img, 100, 100, 160, 130, INK);
  const masks = [{ id: 'hand', rect: [0, 0, 98, 300] }];
  assert.equal(maskInkCheck(img, masks, 10, '#0B1233').length, 1);
  assert.equal(maskInkCheck(img, [{ id: 'hand', rect: [0, 0, 98, 300], frames: [20, 30] }], 10, '#0B1233').length, 0);
  assert.equal(maskInkCheck(img, [{ id: 'far', rect: [0, 0, 40, 300] }], 10, '#0B1233').length, 0);
});
