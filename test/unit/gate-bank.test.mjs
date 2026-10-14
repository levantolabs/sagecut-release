import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBank, renderQuestion, judge, defaultBankPath } from '../../src/gate/bank.mjs';
import { designedBy, effectWindows } from '../../src/gate/pipeline.mjs';

const bank = loadBank(defaultBankPath());

test('the default bank has the eight gate questions', () => {
  assert.deepEqual(Object.keys(bank.questions).sort(), ['abrupt_change', 'dead_frame', 'hierarchy', 'legible_feed', 'overlap', 'pop', 'staging_order', 'text_integrity']);
});

test('the shipped bank names no particular film or object', () => {
  const text = JSON.stringify(bank.questions).toLowerCase();
  for (const w of ['statue', 'stone', 'stair', 'marble']) assert.ok(!text.includes(w), w);
});

test('renderQuestion fills placeholders and refuses unfilled ones', () => {
  const q = renderQuestion(bank.questions.staging_order, { expected_order: 'A, then B' });
  assert.match(q.instructions, /Expected order: A, then B\./);
  assert.throws(() => renderQuestion(bank.questions.staging_order, {}), /unfilled placeholder/);
  const h = renderQuestion(bank.questions.hierarchy);
  assert.equal(h.kind, 'scale'); assert.equal(h.levels.length, 5);
});

test('judge: yes/no answers', () => {
  const q = bank.questions.overlap;       // fail on yes
  assert.equal(judge(q, { ok: true, answer: 'yes', p: 0.9 }).status, 'fail');
  assert.equal(judge(q, { ok: true, answer: 'no', p: 0.1 }).status, 'pass');
  assert.equal(judge(q, { ok: true, answer: null, p: 0.5 }).status, 'escalate');
  assert.equal(judge(bank.questions.legible_feed, { ok: true, answer: 'no', p: 0.1 }).status, 'fail');   // fail on no
  assert.equal(judge(q, { ok: false, error: 'x' }).status, 'error');   // no answer is an error, not a judgement
  assert.equal(judge(q, undefined).status, 'error');
});

test('judge: scale answers, escalate-only never fails', () => {
  const q = bank.questions.hierarchy;
  assert.equal(judge(q, { ok: true, expectation: 2.0 }).status, 'escalate');
  assert.equal(judge(q, { ok: true, expectation: 3.1 }).status, 'escalate');   // within 0.3 of the line
  assert.equal(judge(q, { ok: true, expectation: 3.8 }).status, 'pass');
  const strict = { ...q, escalate_only: false };
  assert.equal(judge(strict, { ok: true, expectation: 2.0 }).status, 'fail');
  assert.equal(judge(q, { ok: true, expectation: null }).status, 'escalate');
});

test('designedBy: the brand allows an effect, the schedule says where; undeclared frames are never suppressed', () => {
  const sched = { cuts: [100], effects: [{ kind: 'flash', frames: [40, 41] }], transitions: [{ from: 'a', to: 'b', frames: [200, 230] }] };
  const w = effectWindows(sched);
  const flash = new Set(['flash']), cut = new Set(['hard_cut']), glitch = new Set(['glitch']), all = new Set(['flash', 'hard_cut', 'glitch']);
  const pop = (a, b) => ({ check: 'abrupt_motion', spike_kind: 'pop', frames: [a, b] });
  assert.equal(designedBy(pop(99, 100), new Set(), w), null);
  assert.equal(designedBy(pop(99, 100), cut, null), null);
  assert.equal(designedBy(pop(99, 100), cut, w), 'hard_cut');          // declared cut
  assert.equal(designedBy(pop(101, 102), cut, w), 'hard_cut');         // within 2 frames
  assert.equal(designedBy(pop(134, 135), cut, w), null);               // undeclared pop stays a finding
  assert.equal(designedBy({ check: 'motion_jump', frames: [190, 191] }, cut, w), null);
  assert.equal(designedBy(pop(199, 200), cut, w), 'hard_cut');         // transition boundary
  assert.equal(designedBy({ check: 'luma_pop', frames: [40, 40] }, flash, w), 'flash');
  assert.equal(designedBy({ check: 'luma_pop', frames: [60, 60] }, flash, w), null);
  assert.equal(designedBy({ check: 'luma_pop', frames: [215, 215] }, flash, w), null);   // a transition window does not excuse a flash
  assert.equal(designedBy({ check: 'local_pop', frames: [215, 216] }, glitch, w), null);
  assert.equal(designedBy({ check: 'black_frames', frames: [40, 41], length: 2 }, flash, w), 'flash');
  assert.equal(designedBy({ check: 'black_frames', frames: [40, 60], length: 21 }, flash, w), null);
  assert.equal(designedBy({ check: 'fireflies', frames: [40, 41] }, glitch, w), null);     // no glitch window declared
  assert.equal(designedBy({ check: 'edge_margin', frames: [40] }, all, w), null);
  assert.equal(designedBy({ check: 'frozen_frames', frames: [40, 41] }, all, w), null);
});
