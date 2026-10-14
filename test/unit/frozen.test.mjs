import test from 'node:test';
import assert from 'node:assert/strict';
import { longFreezes, identicalRuns, FROZEN_MIN_SECONDS } from '../../src/core/frozen.mjs';

// diffs with a stillness of `len` frames starting at frame `at` (the picture moves otherwise)
function series(n, at, len) {
  const d = new Float64Array(n).fill(3);
  for (let f = at; f < at + len; f++) d[f] = 0.01;
  return d;
}

test('fixture A: a 2.0 s freeze outside static_holds is an unheld long freeze', () => {
  const fps = 30, d = series(200, 40, 60);                 // 60 frames = 2.0 s
  const long = longFreezes(d, fps, []);
  assert.equal(long.length, 1);
  assert.equal(long[0].held, false);
  assert.ok(long[0].seconds >= 2.0);
});

test('fixture B: a 0.8 s freeze is within the limit', () => {
  const fps = 30, d = series(200, 40, 24);                 // 24 frames = 0.8 s
  assert.equal(longFreezes(d, fps, []).length, 0);
  assert.equal(identicalRuns(d).length, 1);                // still seen, just not long
});

test('fixture C: a 2.0 s freeze inside static_holds is held (designed)', () => {
  const fps = 30, d = series(200, 40, 60);
  const long = longFreezes(d, fps, [[40, 100]]);
  assert.equal(long.length, 1);
  assert.equal(long[0].held, true);
});

test('the limit is 1.5 s at the frame rate', () => {
  assert.equal(FROZEN_MIN_SECONDS, 1.5);
  const fps = 24, d = series(200, 40, 40);                 // 40 frames at 24 fps = 1.67 s
  assert.equal(longFreezes(d, fps, []).length, 1);
});

test('skip excludes frames (black frames belong to the black check)', () => {
  const fps = 30, d = series(200, 40, 60);
  const skip = new Array(200).fill(false);
  for (let f = 40; f < 100; f++) skip[f] = true;
  assert.equal(longFreezes(d, fps, [], skip).length, 0);
});
