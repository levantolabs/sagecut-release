import test from 'node:test';
import assert from 'node:assert/strict';
import { judge } from '../../src/gate/bank.mjs';
import { summaryText } from '../../src/gate/pipeline.mjs';

const yesno = { kind: 'yesno', fail: 'yes', severity: 'major' };

test('judge: no answer from Sage is an error, not an escalation', () => {
  assert.equal(judge(yesno, { ok: false, error: 'HTTP 500' }).status, 'error');
  assert.equal(judge(yesno, undefined).status, 'error');
});

test('judge: Sage answers but is unsure is still an escalation', () => {
  assert.equal(judge(yesno, { ok: true, answer: null, p: 0.5 }).status, 'escalate');
});

test('summaryText: errors appear in their own line, with the count', () => {
  const r = {
    findings: [], escalations: [], designed: [], passes: [], skipped: [], notes: [], critic_frames: [], seconds: 1,
    measure: { v2: { designed_effects: [] } }, version: 'gate test', video: '/x/out/test.mp4', video_info: { frames: 30, fps: 30 }, sage_asked: 4,
    sage_errors: [{ check: 'pop', frames: [5, 5], t_s: '0.17', beat: 'a', error: 'no answer: HTTP 500' }],
    sage: { ran: true, billed_input_tokens: 0, image_tokens: 0, calls: 1, usd: 0, latency_s_total: 0 },
  };
  const text = summaryText(r, null);
  assert.match(text, /Sage returned no answer for 1 of 4 questions\. These are errors, not judgements/);
  assert.match(text, /- error pop f5 \(0\.17 s, a\): no answer: HTTP 500/);
  assert.doesNotMatch(text, /check whether/);
});
