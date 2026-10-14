import test from 'node:test';
import assert from 'node:assert/strict';
import { rgbToLab, deltaE2000, hexRgb, rgbHex } from '../../src/gate/color.mjs';

test('rgbToLab: white, black and a mid grey', () => {
  const w = rgbToLab(255, 255, 255), k = rgbToLab(0, 0, 0), g = rgbToLab(119, 119, 119);
  assert.ok(Math.abs(w[0] - 100) < 0.1 && Math.abs(w[1]) < 0.1 && Math.abs(w[2]) < 0.1);
  assert.ok(Math.abs(k[0]) < 0.1);
  assert.ok(Math.abs(g[0] - 50) < 0.6);
});

test('deltaE2000 matches the published reference pairs (Sharma, Wu, Dalal 2005)', () => {
  const cases = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 2.5, 0], [50, 0, -2.5], 4.3065],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[50, 2.5, 0], [61, -5, 29], 22.8977],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
  ];
  for (const [a, b, want] of cases) assert.ok(Math.abs(deltaE2000(a, b) - want) < 0.001, `${a} vs ${b}`);
});

test('deltaE2000 is symmetric and zero for equal colours', () => {
  const a = rgbToLab(20, 56, 212), b = rgbToLab(59, 97, 228);
  assert.equal(deltaE2000(a, a), 0);
  assert.ok(Math.abs(deltaE2000(a, b) - deltaE2000(b, a)) < 1e-9);
  assert.ok(deltaE2000(a, b) > 6);   // the planted end-card blue is far from ultramarine
});

test('hex helpers', () => {
  assert.deepEqual(hexRgb('#1438D4'), [20, 56, 212]);
  assert.equal(rgbHex(20, 56, 212), '#1438D4');
});
