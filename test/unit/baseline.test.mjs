import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { priceFor, tokensUsd, CLAUDE_PRICES } from '../../src/claude/prices.mjs';
import { parseSessionFile, summarize, findMarkedFiles, listSessionFiles, claudeConfigDir } from '../../src/claude/sessions.mjs';
import { pickFrames, buildPrompt, MARKER_PREFIX } from '../../src/commands/baseline.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sc-sess-'));
const line = (o) => JSON.stringify(o);
const asst = (id, usage, model = 'claude-opus-5-5', ts = '2026-10-13T10:00:00.000Z') =>
  line({ type: 'assistant', timestamp: ts, message: { id, model, usage, content: [] } });
const img = (data) => line({ type: 'user', timestamp: '2026-10-13T10:00:05.000Z', message: { role: 'user', content: [
  { type: 'tool_result', tool_use_id: 't', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data } }] }] } });

test('prices: list prices from the brief and a family match', () => {
  assert.deepEqual(CLAUDE_PRICES['claude-opus-5-5'], { input: 4, output: 20, cache_read: 0.20, cache_write_5m: 5.0, cache_write_1h: 8.0 });
  assert.deepEqual(CLAUDE_PRICES['claude-sonnet-5-5'], { input: 2, output: 10, cache_read: 0.20, cache_write_5m: 2.5, cache_write_1h: 4.0 });
  assert.deepEqual(CLAUDE_PRICES['claude-haiku-5-5'], { input: 0.10, output: 0.50, cache_read: 0.01, cache_write_5m: 0.125, cache_write_1h: 0.20 });
  assert.equal(priceFor('claude-opus-5-5').id, 'claude-opus-5-5');
  assert.equal(priceFor('claude-opus-5-5-20261001').id, 'claude-opus-5-5');
  assert.equal(priceFor('claude-opus-5-5[1m]').id, 'claude-opus-5-5');
  assert.equal(priceFor('claude-fable-5-1'), null);
  assert.equal(priceFor('claude-opus-5-50'), null);
  assert.equal(tokensUsd('claude-fable-5-1', { input: 1 }), null);
  assert.equal(tokensUsd('claude-opus-5-5', { input: 1e6, output: 1e6, cache_read: 1e6, cache_write_5m: 1e6, cache_write_1h: 1e6 }), 4 + 20 + 0.2 + 5 + 8);
});

test('parseSessionFile: dedupe by message id (last wins), TTL split, image views vs distinct', async () => {
  const d = tmp(); const f = path.join(d, 'agent-a1.jsonl');
  fs.writeFileSync(f, [
    asst('m1', { input_tokens: 5, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 100, cache_creation: { ephemeral_5m_input_tokens: 40, ephemeral_1h_input_tokens: 60 } }),
    asst('m1', { input_tokens: 5, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 100, cache_creation: { ephemeral_5m_input_tokens: 40, ephemeral_1h_input_tokens: 60 } }, 'claude-opus-5-5', '2026-10-13T10:00:10.000Z'),
    img('AAAA'), img('AAAA'), img('BBBB'),
    asst('m2', { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 1000, cache_creation_input_tokens: 10 }, 'claude-sonnet-5-5', '2026-10-13T10:01:00.000Z'),
    asst('m3', { input_tokens: 9, output_tokens: 9 }, '<synthetic>'),
    'not json',
  ].join('\n') + '\n');
  const p = await parseSessionFile(f);
  assert.equal(p.turns, 3);
  assert.deepEqual({ ...p.models['claude-opus-5-5'] }, { input: 5, output: 50, cache_read: 0, cache_write_5m: 40, cache_write_1h: 60, turns: 1 });
  assert.equal(p.models['claude-sonnet-5-5'].cache_write_5m, 10);          // no TTL split: priced as 5 minutes, never 1 hour
  assert.equal(p.models['claude-sonnet-5-5'].cache_write_1h, 0);
  assert.equal(p.models['<synthetic>'], undefined);
  assert.equal(p.image_views, 3);
  assert.equal(p.distinct_images.size, 2);
  assert.equal(p.seconds, 60);                                              // 10:00:00 -> 10:01:00
  assert.ok(p.notes.some((n) => /no TTL split/.test(n)));
  const s = summarize([p]);
  const want = (5 * 4 + 50 * 20 + 40 * 5 + 60 * 8) / 1e6 + (1 * 2 + 2 * 10 + 1000 * 0.2 + 10 * 2.5) / 1e6;
  assert.ok(Math.abs(s.usd - want) < 1e-6, `${s.usd} vs ${want}`);
  assert.equal(s.image_views, 3); assert.equal(s.distinct_images, 2);
  fs.rmSync(d, { recursive: true, force: true });
});

test('summarize: an unknown model gives tokens and "price unknown", never a made-up USD', async () => {
  const d = tmp(); const f = path.join(d, 'agent-a2.jsonl');
  fs.writeFileSync(f, asst('m1', { input_tokens: 100, output_tokens: 10 }, 'claude-fable-5-1') + '\n' + asst('m2', { input_tokens: 100, output_tokens: 10 }) + '\n');
  const s = summarize([await parseSessionFile(f)]);
  assert.equal(s.usd, null);
  assert.deepEqual(s.price_unknown, ['claude-fable-5-1']);
  assert.equal(s.tokens.input, 200);
  assert.ok(s.usd_known_models > 0);
  fs.rmSync(d, { recursive: true, force: true });
});

test('findMarkedFiles: sub-agent files whose first record holds the marker, via CLAUDE_CONFIG_DIR', async () => {
  const cfg = tmp();
  const proj = path.join(cfg, 'projects', '-some-project');
  const sub = path.join(proj, 'sess1', 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  const mk = (file, text) => fs.writeFileSync(file, line({ type: 'user', message: { role: 'user', content: text } }) + '\n');
  mk(path.join(sub, 'agent-aaa.jsonl'), `SAGECUT-BASELINE-abcd1234\nreview these`);
  mk(path.join(sub, 'agent-bbb.jsonl'), 'SAGECUT-BASELINE-ffff0000\nother');
  mk(path.join(proj, 'sess1.jsonl'), 'a user typed SAGECUT-BASELINE-abcd1234 here');       // a main session file: not a critic
  const old = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = cfg;
  try {
    assert.equal(claudeConfigDir(), cfg);
    const hits = findMarkedFiles('SAGECUT-BASELINE-abcd1234');
    assert.deepEqual(hits.map((h) => path.basename(h)), ['agent-aaa.jsonl']);
    assert.equal(listSessionFiles().length, 3);
    assert.deepEqual(findMarkedFiles('SAGECUT-BASELINE-abcd1234', { sinceMs: Date.now() + 100000 }), []);
    assert.deepEqual(findMarkedFiles('SAGECUT-BASELINE-0000'), []);
  } finally {
    if (old === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = old;
    fs.rmSync(cfg, { recursive: true, force: true });
  }
});

test('pickFrames: N frames spread evenly, inside the video', () => {
  assert.deepEqual(pickFrames(600, 10), [30, 90, 150, 210, 270, 330, 390, 450, 510, 570]);
  assert.deepEqual(pickFrames(5, 10), [0, 1, 2, 3, 4]);
  assert.equal(pickFrames(600, 1).length, 1);
  assert.ok(pickFrames(1000, 7).every((f) => f >= 0 && f < 1000));
});

test('buildPrompt: the marker is the first line; lists every frame; no personal text', () => {
  const marker = `${MARKER_PREFIX}abcd1234`;
  const p = buildPrompt({ marker, dir: 'd', frames: [30, 90], files: ['/x/f00030.png', '/x/f00090.png'], fps: 30 });
  assert.equal(p.split('\n')[0], marker);
  assert.ok(p.includes('/x/f00030.png') && p.includes('/x/f00090.png'));
  assert.ok(p.includes('Read tool'));
  assert.ok(!new RegExp(['chris' + 'topher', 'levan' + 'to', '/Us' + 'ers/'].join('|'), 'i').test(p));
});
