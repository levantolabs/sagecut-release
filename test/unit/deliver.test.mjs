import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run as ff } from '../../src/core/ffmpeg.mjs';
import { checkVideo, fixVideo, holdRanges, covered } from '../../src/commands/deliver-check.mjs';
import { copyFindings, looksLikeCode } from '../../src/commands/check-schedule.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sagecut-test-deliver-'));
let have = true;
try { const r = await ff('ffmpeg', ['-hide_banner', '-encoders'], { root: tmp }); have = r.code === 0 && /libx264/.test(r.stdout.toString()); } catch { have = false; }
const opts = { skip: have ? false : 'ffmpeg with libx264 not available' };
const bad = path.join(tmp, 'bad.mp4'), fixed = path.join(tmp, 'bad-delivery.mp4');
const ctx = (extra = {}) => ({ root: tmp, config: { schedulePath: path.join(tmp, 'none.json'), brandPath: path.join(tmp, 'none.yaml'), test_width: null, ...extra } });
const by = (checks, name) => checks.find((c) => c.name === name);

test('hold helpers', () => {
  assert.deepEqual(holdRanges({ static_holds: [[10, 20], { start: 30, end: 40 }, { frames: [50, 60] }] }), [[10, 20], [30, 40], [50, 60]]);
  assert.equal(covered(12, 18, [[10, 20]]), true);
  assert.equal(covered(5, 30, [[10, 20]]), false);
  assert.equal(covered(10, 40, [[10, 20], [21, 40]]), true);
});

test('copy rules find avoided words and case', () => {
  const s = { beats: [{ id: 'a', start: 0, end: 90, elements: [{ id: 't', in: 0, out: 60, text: 'We are the best solution' }, { id: 'u', in: 0, out: 60, text: 'NASA', literal: true }] }] };
  const f = copyFindings(s, { copy: { avoid: ['solution'], case: 'lower' } });
  assert.equal(f.length, 2);
  assert.ok(f.some((x) => /solution/.test(x.message)));
  assert.ok(f.every((x) => x.frame === 0));
});

test('sentence case applies only where a sentence starts, never to URLs or handles', () => {
  const el = (id, text) => ({ id, in: 0, out: 30, text });
  const s = { beats: [
    { id: 'a', start: 0, end: 90, elements: [el('1', 'Raising'), el('2', 'a seed round.'), el('3', 'Then more.'), el('4', 'levanto.ai'), el('5', '@levanto')] },
    { id: 'b', start: 91, end: 180, elements: [el('6', 'lower start')] },
  ] };
  const f = copyFindings(s, { copy: { case: 'sentence' } });
  assert.deepEqual(f.map((x) => x.message.match(/"(.*)"/)[1]), ['lower start']);
  const g = copyFindings({ beats: [{ id: 'c', start: 0, end: 90, elements: [el('1', 'Intro:'), el('2', 'next thing')] }] }, { copy: { case: 'sentence' } });
  assert.equal(g.length, 1);
  for (const t of ['levanto.ai', '@me', '#tag', '/docs/a', 'file.mp4', 'a.b']) assert.equal(looksLikeCode(t), true, t);
  assert.equal(looksLikeCode('a seed round'), false);
});

test('make a bad file', opts, async () => {
  const fc = '[0:v][1:v][2:v]concat=n=3:v=1:a=0,scale=out_range=full,format=yuv420p[v]';
  const r = await ff('ffmpeg', ['-v', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=black:s=320x240:r=30:d=1', '-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=30:d=2', '-f', 'lavfi', '-i', 'color=c=0x336699:s=320x240:r=30:d=2.5',
    '-f', 'lavfi', '-i', "sine=f=440:d=5.5,volume=enable='between(t,2,3.6)':volume=0",
    '-filter_complex', fc, '-map', '[v]', '-map', '3:a', '-c:v', 'libx264', '-color_range', 'pc', '-c:a', 'aac', bad], { root: tmp });
  assert.equal(r.code, 0, r.stderr);
});

test('a bad file fails the right checks', opts, async () => {
  const { checks } = await checkVideo(bad, ctx(), { ocr: false });
  assert.equal(by(checks, 'colour range').status, 'fail');
  assert.equal(by(checks, 'faststart').status, 'fail');
  assert.equal(by(checks, 'black frames').status, 'fail');
  assert.match(by(checks, 'black frames').detail, /opens on black/);
  assert.equal(by(checks, 'frozen frames').status, 'fail');
  assert.equal(by(checks, 'digital silence').status, 'fail');
  assert.equal(by(checks, 'audio stream').status, 'pass');
});

test('a declared hold clears the frozen check', opts, async () => {
  const sched = path.join(tmp, 'schedule.json');
  fs.writeFileSync(sched, JSON.stringify({ static_holds: [[90, 165]] }));
  const { checks } = await checkVideo(bad, ctx({ schedulePath: sched }), { ocr: false });
  assert.equal(by(checks, 'frozen frames').status, 'pass');
});

test('--fix repairs colour range and faststart, and writes a frame set', opts, async () => {
  const { checks } = await checkVideo(bad, ctx(), { ocr: false, frameSet: path.join(tmp, 'set') });
  assert.equal(fs.readdirSync(path.join(tmp, 'set')).length, 12);
  const fx = await fixVideo(bad, checks, fixed, { root: tmp });
  assert.ok(fx && fs.existsSync(fixed));
  const after = (await checkVideo(fixed, ctx(), { ocr: false })).checks;
  assert.equal(by(after, 'colour range').status, 'pass');
  assert.equal(by(after, 'faststart').status, 'pass');
});

test('audio policy: a silent video warns, fails when required, and is info when none', opts, async () => {
  const silent = path.join(tmp, 'silent.mp4');
  const r = await ff('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=30:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', silent], { root: tmp });
  assert.equal(r.code, 0, r.stderr);
  let c = (await checkVideo(silent, ctx(), { ocr: false })).checks;
  assert.equal(by(c, 'audio stream').status, 'warn');
  assert.match(by(c, 'audio stream').detail, /audio: none/);
  c = (await checkVideo(silent, ctx({ audio: 'required' }), { ocr: false })).checks;
  assert.equal(by(c, 'audio stream').status, 'fail');
  c = (await checkVideo(bad, ctx({ audio: 'none' }), { ocr: false })).checks;
  assert.equal(by(c, 'audio stream').status, 'info');
  assert.equal(by(c, 'loudness'), undefined);
  assert.equal(by(c, 'digital silence'), undefined);
});

test('cleanup', () => { fs.rmSync(tmp, { recursive: true, force: true }); });
