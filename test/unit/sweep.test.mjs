import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBank, isProblem, badAnswer } from '../../src/sweep/bank.mjs';
import { flagRows, groupRuns, allRuns, typedFrames, onscreenFrames } from '../../src/sweep/runs.mjs';
import { runControlled, safeDecide, pool, zeroUsage } from '../../src/sweep/controlled.mjs';

const schedule = {
  fps: 30, frames: 300,
  beats: [{ id: 'a', start: 0, end: 100, hold: [40, 80], elements: [
    { id: 'h', in: 10, out: 100, text: 'Hello' }, { id: 'pic', in: 5, out: 100 }] }],
  transitions: [], cuts: [],
};

test('default bank has generic wording only', () => {
  const bank = loadBank({ root: process.cwd() });
  assert.deepEqual(Object.keys(bank.problems), ['cut', 'over', 'overlap', 'glitch']);
  const all = JSON.stringify(bank).toLowerCase();
  for (const w of ['statue', 'stone', 'stairs', 'screen', 'film', 'levan' + 'to', 'chris' + 'topher']) assert.ok(!all.includes(w), `bank must not mention "${w}"`);
  assert.ok(bank.legible.length > 10);
});

test('isProblem: p is the probability of yes', () => {
  assert.equal(isProblem('yes', 0.9, 'yes', 0.8), true);
  assert.equal(isProblem('yes', 0.7, 'yes', 0.8), false);
  assert.equal(isProblem('no', 0.1, 'no', 0.8), true);     // legible = no with 90 % confidence
  assert.equal(isProblem('no', 0.4, 'no', 0.8), false);
  assert.equal(isProblem(null, null, 'yes', 0.8), false);
  assert.equal(badAnswer('legible'), 'no');
  assert.equal(badAnswer('cut'), 'yes');
});

test('flagRows ignores errors and low confidence', () => {
  const rows = [
    { f: 1, q: 'cut', answer: 'yes', p: 0.95 }, { f: 2, q: 'cut', answer: 'yes', p: 0.5 },
    { f: 3, q: 'legible', answer: 'no', p: 0.05 }, { f: 4, q: 'cut', answer: 'yes', p: 1, error: 'x' },
    { f: 5, q: 'glitch', answer: null, p: null },
  ];
  assert.deepEqual(flagRows(rows, 0.8), { cut: [1], legible: [3] });
});

test('groupRuns joins frames with a gap of at most 3', () => {
  const runs = groupRuns('cut', [1, 2, 4, 20, 21], 3);
  assert.deepEqual(runs.map((r) => r.frames), [[1, 4], [20, 21]]);
  assert.deepEqual(runs.map((r) => r.n), [3, 2]);
  assert.deepEqual(groupRuns('cut', [], 3), []);
  const all = allRuns({ cut: [50], glitch: [10] }, 3);
  assert.deepEqual(all.map((r) => r.q), ['glitch', 'cut']);    // sorted by first frame
});

test('typedFrames: text elements inside the beat hold only', () => {
  const t = typedFrames(schedule);
  assert.equal(t.has(39), false);
  assert.equal(t.has(40), true);
  assert.equal(t.has(80), true);
  assert.equal(t.has(81), false);
  assert.equal(typedFrames(null).size, 0);
});

test('onscreenFrames: from in to out for text elements; no text means none', () => {
  const o = onscreenFrames(schedule);
  assert.equal(o.has(10), true); assert.equal(o.has(100), true); assert.equal(o.has(9), false);
  assert.equal(o.has(5), false);                        // the picture element has no text
});

function fakeClient(answerFor) {
  return {
    workers: 2,
    async decide(groups) {
      return {
        rows: groups.map((g) => ({ id: g.id, label: g.label, answers: Object.fromEntries(g.questions.map((q) => [q.id, answerFor(g, q)])) })),
        usage: { billed_input_tokens: 10 * groups.length, output_tokens: 1, image_tokens: 0, calls: 1 }, usd: 0.001, seconds: 0.1,
      };
    },
  };
}

test('runControlled: control in every slice; ok when Sage finds the defect', async () => {
  const seen = [];
  const client = fakeClient((g) => { seen.push(g.id); return { answer: g.id === '__control_pos' ? 'yes' : 'no', p: g.id === '__control_pos' ? 0.95 : 0.05 }; });
  const items = Array.from({ length: 40 }, (_, i) => ({ id: `i${i}`, label: `i${i}`, media: 'data:x' }));
  const r = await runControlled(client, { items, variants: [{ id: 'q', instructions: 'Is it cut?' }], control: { kind: 'cut', pos: 'data:p', neg: 'data:n' }, bad: 'yes', pmin: 0.8 });
  assert.equal(r.rows.length, 40);
  assert.equal(seen.filter((x) => x === '__control_pos').length, 3);      // 40 items / 18 per slice = 3 slices, each with the control
  assert.equal(r.controls.q.ok, true);
  assert.equal(r.usage.calls, 3);
});

test('runControlled: a missed control marks the question not ok', async () => {
  const client = fakeClient(() => ({ answer: 'no', p: 0.1 }));
  const r = await runControlled(client, { items: [{ id: 'a', label: 'a', media: 'm' }], variants: [{ id: 'q', instructions: 'x' }], control: { kind: 'cut', pos: 'p' }, bad: 'yes', pmin: 0.8 });
  assert.equal(r.controls.q.ok, false);
  assert.match(r.controls.q.reason, /did not find/);
});

test('runControlled: no control means not verified', async () => {
  const client = fakeClient(() => ({ answer: 'no', p: 0.1 }));
  const r = await runControlled(client, { items: [{ id: 'a', label: 'a', media: 'm' }], variants: [{ id: 'q', instructions: 'x' }], control: null, bad: 'yes' });
  assert.equal(r.controls.q.ok, false);
});

test('safeDecide splits a failing batch and records single failures as errors', async () => {
  const client = { async decide(groups) {
    if (groups.some((g) => g.id === 'bad')) throw new Error('Sage /decide/batch HTTP 504: gateway');
    return { rows: groups.map((g) => ({ id: g.id, label: g.id, answers: { q: { answer: 'no', p: 0.1 } } })), usage: { billed_input_tokens: 1, output_tokens: 0, image_tokens: 0, calls: 1 }, usd: 0, seconds: 0 };
  } };
  const groups = ['a', 'b', 'bad', 'c'].map((id) => ({ id, questions: [{ id: 'q' }] }));
  const r = await safeDecide(client, groups);
  assert.equal(r.rows.length, 4);
  assert.ok(r.rows.find((x) => x.id === 'bad').answers.q.error);
  assert.equal(r.rows.find((x) => x.id === 'a').answers.q.error, undefined);
});

test('safeDecide rethrows a rejected key', async () => {
  const client = { async decide() { throw new Error('Sage rejected the key (HTTP 401). Check SAGE_API_KEY in .env.'); } };
  await assert.rejects(() => safeDecide(client, [{ id: 'a', questions: [] }, { id: 'b', questions: [] }]), /rejected the key/);
});

test('pool keeps order and limits concurrency', async () => {
  let live = 0; let max = 0;
  const r = await pool([1, 2, 3, 4, 5, 6], 2, async (x) => { live++; max = Math.max(max, live); await new Promise((s) => setTimeout(s, 5)); live--; return x * 2; });
  assert.deepEqual(r, [2, 4, 6, 8, 10, 12]);
  assert.ok(max <= 2);
  assert.deepEqual(zeroUsage(), { billed_input_tokens: 0, output_tokens: 0, image_tokens: 0, calls: 0 });
});
