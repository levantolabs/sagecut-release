import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run as ff, locate } from '../../src/core/ffmpeg.mjs';
import { parseRange, planSplice, applySplice, x264Params, readX264Options } from '../../src/splice/splice.mjs';
import { isFaststart, avcC } from '../../src/splice/mp4.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sagecut-test-splice-'));
const root = tmp;
let have = true;
try { const r = await ff('ffmpeg', ['-hide_banner', '-encoders'], { root }); have = r.code === 0 && /libx264/.test(r.stdout.toString()); } catch { have = false; }
const opts = { skip: have ? false : 'ffmpeg with libx264 not available' };

const master = path.join(tmp, 'master.mp4'), patch = path.join(tmp, 'patch.mp4'), out = path.join(tmp, 'out.mp4');

test('parseRange', () => {
  assert.deepEqual(parseRange('30-59'), [30, 59]);
  assert.throws(() => parseRange('59-30'));
  assert.throws(() => parseRange('abc'));
});

test('x264Params turns SEI text into x264-params', () => {
  const p = x264Params('cabac=1 ref=3 deblock=1:0:0 threads=12 keyint=250 scenecut=40', { sar11: true, minKeyint: 30 });
  assert.match(p, /deblock=0,0/);
  assert.match(p, /scenecut=0/);
  assert.match(p, /sar=1\/1/);
  assert.doesNotMatch(p, /threads/);
  const q = x264Params('analyse=0x3:0x113 deadzone=21,11 aq=1:1.00 psy_rd=1.00:0.00', { sar11: false, minKeyint: 30 });
  assert.match(q, /partitions=i4x4,i8x8,p8x8,b8x8/);
  assert.match(q, /deadzone-inter=21:deadzone-intra=11:aq-mode=1:aq-strength=1.00:psy_rd=1.00,0.00/);
});

test('make a master and a patch', opts, async () => {
  const enc = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-x264-params', 'keyint=30:min-keyint=30:scenecut=0:bframes=0:sar=1/1'];
  let r = await ff('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    '-vf', 'setsar=1', ...enc, '-c:a', 'aac', '-shortest', master], { root });
  assert.equal(r.code, 0, r.stderr);
  r = await ff('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30:duration=1,hue=h=120,drawbox=x=40:y=40:w=120:h=60:color=red:t=fill', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', patch], { root });
  assert.equal(r.code, 0, r.stderr);
  assert.ok(readX264Options(master).options.includes('keyint=30'));
  assert.equal(isFaststart(master), false);
  assert.ok(avcC(master).length > 8);
});

test('plan aligns a range to the GOP', opts, async () => {
  const p = await planSplice(master, [35, 40], { root });
  assert.deepEqual([p.g0, p.g1, p.frames, p.total], [30, 59, 30, 90]);
});

test('apply: frames outside the range are bit-identical and packets keep their timing', opts, async () => {
  const proof = await applySplice(master, patch, [30, 59], { root, out });
  assert.equal(proof.decodedFramesIdenticalOutsideRange, true, JSON.stringify(proof.outsideMismatches));
  assert.equal(proof.videoPacketTimingIdentical, true, proof.videoPacketDiffs.join('; '));
  assert.equal(proof.audioPacketTimingIdentical, true, proof.audioPacketDiffs.join('; '));
  assert.equal(proof.spsIdenticalToMaster, true);
  assert.ok(proof.framesChangedInsideRange > 25, `changed ${proof.framesChangedInsideRange}`);
  assert.equal(proof.frameCount.out, 90);
  assert.equal(proof.pass, true);
  assert.ok(fs.existsSync(`${out}.proof.json`));
});

test('apply refuses a range that is not GOP-aligned', opts, async () => {
  await assert.rejects(() => applySplice(master, patch, [31, 59], { root, out: path.join(tmp, 'x.mp4') }), /not GOP-aligned/);
});

test('cleanup', () => { fs.rmSync(tmp, { recursive: true, force: true }); });
