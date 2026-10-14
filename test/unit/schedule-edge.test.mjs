import test from 'node:test';
import assert from 'node:assert/strict';
import { edgeContactSides, validateSchedule, EDGE_SIDES } from '../../src/core/schedule.mjs';

test('edgeContactSides: true is all four sides, false and absent are none, a list is kept', () => {
  assert.deepEqual(edgeContactSides(true), EDGE_SIDES);
  assert.deepEqual(edgeContactSides(false), []);
  assert.deepEqual(edgeContactSides(undefined), []);
  assert.deepEqual(edgeContactSides(['left', 'bottom', 'left']), ['left', 'bottom']);
  assert.deepEqual(edgeContactSides([]), []);
});

test('edgeContactSides: any other value is rejected', () => {
  assert.equal(edgeContactSides('left'), null);
  assert.equal(edgeContactSides(['left', 'middle']), null);
  assert.equal(edgeContactSides(1), null);
});

test('validateSchedule: a bad allow_edge_contact is a schedule error, not a crash', () => {
  const base = { film: 'x', fps: 30, frames: 30, width: 1280, height: 720, safe_margin_px: 60, beats: [], transitions: [], decorative: [] };
  assert.deepEqual(validateSchedule({ ...base, allow_edge_contact: true }), []);
  assert.deepEqual(validateSchedule({ ...base, allow_edge_contact: ['left'] }), []);
  const errs = validateSchedule({ ...base, allow_edge_contact: 'left' });
  assert.equal(errs.length, 1);
  assert.match(errs[0], /allow_edge_contact/);
});
