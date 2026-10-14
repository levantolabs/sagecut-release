import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { encodePng } from '../../src/core/png.mjs';
import { decodePng, expandGlob } from '../../src/sweep/images.mjs';
import { inkInfo, makeCut, makeGhost, makeBlack, makeFrozen, makeOffbrand, makeControl, defaultControl, pickOffbrandMap, CONTROL_KINDS } from '../../src/sweep/synth.mjs';

// A 200x100 frame: dark background with a light "text" block.
function frame(w = 200, h = 100) {
  const rgb = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) { rgb[i * 3] = 10; rgb[i * 3 + 1] = 20; rgb[i * 3 + 2] = 40; }
  for (let y = 40; y < 56; y++) for (let x = 60; x < 140; x++) { const o = (y * w + x) * 3; rgb[o] = 240; rgb[o + 1] = 240; rgb[o + 2] = 230; }
  return { rgb, w, h };
}
const px = (f, x, y) => { const o = (y * f.w + x) * 3; return [f.rgb[o], f.rgb[o + 1], f.rgb[o + 2]]; };

test('png round trip: encodePng -> decodePng', () => {
  const f = frame();
  const back = decodePng(encodePng(f.rgb, f.w, f.h, 3));
  assert.equal(back.w, 200); assert.equal(back.h, 100);
  assert.ok(back.rgb.equals(f.rgb));
});

test('decodePng reads gray and RGBA', () => {
  const g = Buffer.from([0, 128, 255, 64]);
  const d = decodePng(encodePng(g, 2, 2, 1));
  assert.deepEqual([...d.rgb.subarray(0, 3)], [0, 0, 0]);
  assert.deepEqual([...d.rgb.subarray(3, 6)], [128, 128, 128]);
  const rgba = Buffer.from([1, 2, 3, 255, 4, 5, 6, 255]);
  assert.deepEqual([...decodePng(encodePng(rgba, 2, 1, 4)).rgb], [1, 2, 3, 4, 5, 6]);
});

test('inkInfo finds the text block and the background', () => {
  const i = inkInfo(frame());
  assert.deepEqual(i.bbox, { x0: 60, y0: 40, x1: 139, y1: 55 });
  assert.ok(Math.abs(i.bg[2] - 44) < 8);
  assert.equal(i.usable, true);
  assert.equal(inkInfo({ rgb: Buffer.alloc(200 * 100 * 3), w: 200, h: 100 }).usable, false);   // black frame: no ink
});

test('cut moves the text across the edge and loses part of it', () => {
  const f = frame(); const c = makeCut(f);
  const light = (fr) => { let n = 0; for (let i = 0; i < fr.w * fr.h; i++) if (fr.rgb[i * 3] > 200) n++; return n; };
  assert.ok(light(c) < light(f) * 0.7);
  assert.ok(light(c) > 0);
  assert.ok(f.rgb.equals(frame().rgb), 'the input is not changed');
});

test('ghost adds an offset copy and keeps the original', () => {
  const f = frame(); const g = makeGhost(f);
  assert.deepEqual(px(g, 60, 40), [240, 240, 230]);            // original still there
  const light = (fr) => { let n = 0; for (let i = 0; i < fr.w * fr.h; i++) if (fr.rgb[i * 3] > 200) n++; return n; };
  assert.ok(light(g) > light(f));                              // the copy covers new pixels
});

test('black and frozen', () => {
  const b = makeBlack(frame()); assert.ok(b.rgb.every((v) => v === 0));
  const z = makeFrozen(frame());
  assert.equal(z.w, 400);
  assert.deepEqual(px(z, 100, 45), px(z, 300, 45));
});

test('offbrand moves the colours away from the palette', () => {
  const palette = ['#0a1428', '#f0f0e6'];
  const { map, score } = pickOffbrandMap(palette);
  assert.ok(score > 100, `palette is moved far away (score ${score})`);
  const o = makeOffbrand(frame(), palette);
  const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  assert.ok(dist(px(o, 0, 0), [10, 20, 40]) > 100);
  assert.ok(map);
});

test('makeControl: every kind works; text controls need text; unknown kind throws', () => {
  for (const k of CONTROL_KINDS) assert.ok(makeControl(k, frame(), { palette: ['#0a1428'] }), k);
  const empty = { rgb: Buffer.alloc(200 * 100 * 3), w: 200, h: 100 };
  assert.equal(makeControl('cut', empty), null);
  assert.equal(makeControl('ghost', empty), null);
  assert.throws(() => makeControl('nope', frame()), /unknown control/);
});

test('defaultControl follows the question words', () => {
  assert.equal(defaultControl('Is any word cut off by the edge of the picture?'), 'cut');
  assert.equal(defaultControl('Does any text overlap other text?'), 'ghost');
  assert.equal(defaultControl('Is this frame frozen?'), 'frozen');
  assert.equal(defaultControl('Are the colours on brand?'), 'offbrand');
  assert.equal(defaultControl('Is the picture black?'), 'black');
  assert.equal(defaultControl('Is there a dog?'), null);
});

test('expandGlob: * ? ** and literal paths', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-glob-'));
  fs.mkdirSync(path.join(d, 'a', 'b'), { recursive: true });
  for (const f of ['x1.png', 'x2.png', 'y.jpg', 'a/z.png', 'a/b/w.png']) fs.writeFileSync(path.join(d, f), 'x');
  const names = (g) => expandGlob(g, d).map((p) => path.relative(d, p).split(path.sep).join('/'));
  assert.deepEqual(names('x*.png'), ['x1.png', 'x2.png']);
  assert.deepEqual(names('x?.png'), ['x1.png', 'x2.png']);
  assert.deepEqual(names('**/*.png'), ['a/b/w.png', 'a/z.png', 'x1.png', 'x2.png']);
  assert.deepEqual(names(path.join(d, 'y.jpg')), ['y.jpg']);
  assert.deepEqual(names('nope*.png'), []);
  fs.rmSync(d, { recursive: true, force: true });
});
