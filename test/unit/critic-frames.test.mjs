import test from 'node:test';
import assert from 'node:assert/strict';
import { selectCriticFrames, topMotionFrames, MAX_CRITIC_FRAMES } from '../../src/gate/critic.mjs';

test('an element that enters mid-beat, with no declared transition, gets a critic frame', () => {
  const sched = { beats: [{ id: 'a', start: 0, end: 200, elements: [{ id: 'parts', in: 120 }] }], transitions: [] };
  const picks = selectCriticFrames({ sched, settled: [{ frame: 190, beat: 'a' }], rows: [], beatOf: () => 'a', total: 200, motion: [] });
  const frames = picks.map((p) => p.frame);
  assert.ok(frames.includes(120), `frames were ${frames}`);
  assert.ok(frames.includes(128));
  assert.match(picks.find((p) => p.frame === 120).reason, /element parts arrives \(beat a\)/);
});

test('motion peaks are picked, spaced at least 5 frames apart, strongest first', () => {
  const d = new Float64Array(100);
  d[20] = 5; d[22] = 4.9; d[40] = 3; d[70] = 2;
  const peaks = topMotionFrames(d, 3);
  assert.deepEqual(peaks.map((p) => p.frame), [20, 40, 70]);   // 22 is too close to 20
});

test('the total is capped at MAX_CRITIC_FRAMES, and the cap is 32', () => {
  assert.equal(MAX_CRITIC_FRAMES, 32);
  const beats = Array.from({ length: 10 }, (_, i) => ({ id: `b${i}`, start: i * 100, end: i * 100 + 99, elements: Array.from({ length: 10 }, (_, j) => ({ id: `e${i}${j}`, in: i * 100 + j * 9 })) }));
  const picks = selectCriticFrames({ sched: { beats, transitions: [] }, settled: [], rows: [], beatOf: () => 'x', total: 1000, motion: topMotionFrames(new Float64Array(1000).map((_, f) => f % 7)) });
  assert.ok(picks.length <= MAX_CRITIC_FRAMES);
});
