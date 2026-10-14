// End to end: a small generated video through the whole gate (measurement only, no Sage, no OCR).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runGate, summaryText } from '../../src/gate/pipeline.mjs';
import { loadConfig } from '../../src/core/config.mjs';
import { locate } from '../../src/core/ffmpeg.mjs';

const tools = locate(process.cwd());
const make = (out, { moving = false, after = '' } = {}) => {
  const args = ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0xF4F0E5:s=320x180:r=30:d=3'];
  const chain = [];
  if (moving) { args.push('-f', 'lavfi', '-i', 'color=c=0x1438D4:s=40x40:r=30:d=3'); chain.push("[0][1]overlay=x='100+t*20':y=60"); }
  if (after) chain.push(after);
  if (chain.length) args.push('-filter_complex', chain.map((c, i) => (i === 0 && !moving ? `[0]${c}` : c)).join(','));
  args.push('-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-crf', '12', out);
  return spawnSync(tools.ffmpeg, args, { env: tools.env, encoding: 'utf8' });
};
const canMake = (() => {
  const p = path.join(os.tmpdir(), `sagecut-probe-${process.pid}.mp4`);
  const ok = make(p, { moving: true }).status === 0;
  fs.rmSync(p, { force: true });
  return ok;
})();

const BLACK = (frames) => `drawbox=x=0:y=0:w=320:h=180:color=black:t=fill:enable='${frames}'`;
const SCHEDULE = { film: 'test', fps: 30, frames: 90, width: 320, height: 180, safe_margin_px: 10,
  beats: [{ id: 'one', start: 0, end: 44, hold: [20, 44], elements: [{ id: 'box', in: 4, text: 'Box' }] }, { id: 'two', start: 45, end: 89, hold: [60, 89], elements: [{ id: 'box2', in: 50, text: 'Box' }] }],
  transitions: [{ from: 'one', to: 'two', frames: [44, 50] }] };

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sagecut-gate-'));
  fs.mkdirSync(path.join(root, 'sagecut'), { recursive: true });
  fs.writeFileSync(path.join(root, 'sagecut', 'schedule.json'), JSON.stringify(SCHEDULE));
  return root;
}

test('gate finds a black frame, writes every output and exits as findings', { skip: !canMake && 'ffmpeg with lavfi is not available' }, async () => {
  const root = project(), video = path.join(root, 'bad.mp4');
  assert.equal(make(video, { moving: true, after: BLACK('between(n,40,41)') }).status, 0);
  const out = path.join(root, 'run');
  const r = await runGate({ video, root, config: loadConfig(root), outDir: out, noSage: true, noOcr: true });
  assert.ok(r.findings.some((f) => f.check === 'black_frames' && f.frames[0] === 40 && f.frames[1] === 41), JSON.stringify(r.findings.map((f) => f.check)));
  assert.equal(r.sage.ran, false);
  for (const f of ['findings.json', 'summary.md', 'critic-frames/index.json', 'critic-frames/contact.png']) assert.ok(fs.existsSync(path.join(out, f)), f);
  const idx = JSON.parse(fs.readFileSync(path.join(out, 'critic-frames', 'index.json'), 'utf8'));
  assert.ok(idx.frames.length >= 3 && idx.frames.length <= 24);
  assert.ok(idx.frames.some((x) => x.reason.includes('black_frames')) && idx.frames.some((x) => x.reason.includes('settled')) && idx.frames.some((x) => x.reason.includes('transition')));
  for (const x of idx.frames) assert.ok(fs.existsSync(path.join(out, 'critic-frames', x.file)));
  const png = fs.readFileSync(path.join(out, 'critic-frames', 'contact.png'));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  const summary = fs.readFileSync(path.join(out, 'summary.md'), 'utf8');
  assert.match(summary, /black_frames f40-41/);
  assert.match(summary, /OCR checks off/);
  assert.match(summary, /Brand colour check skipped/);
  assert.ok(summary.split('\n').length <= 30);
  assert.ok(!/[A-Z0-9]{30,}/.test(summary));
  fs.rmSync(root, { recursive: true, force: true });
});

test('gate: a clean video has no findings; brand motion.designed marks a flash as designed', { skip: !canMake && 'ffmpeg with lavfi is not available' }, async () => {
  const root = project(), clean = path.join(root, 'clean.mp4'), flash = path.join(root, 'flash.mp4');
  assert.equal(make(clean, { moving: true }).status, 0);
  const r0 = await runGate({ video: clean, root, config: loadConfig(root), outDir: path.join(root, 'r0'), noSage: true, noOcr: true });
  assert.deepEqual(r0.findings.map((f) => f.check), [], JSON.stringify(r0.findings));
  assert.equal(r0.escalations.length, 0);
  assert.equal(make(flash, { moving: true, after: BLACK('eq(n,40)') }).status, 0);
  const plain = await runGate({ video: flash, root, config: loadConfig(root), outDir: path.join(root, 'r1'), noSage: true, noOcr: true });
  assert.ok(plain.findings.some((f) => f.check === 'black_frames'));
  fs.writeFileSync(path.join(root, 'sagecut', 'brand.yaml'), 'name: t\ncolors: { background: "#F4F0E5", text: "#0B1233", primary: "#1438D4" }\nfonts: { heading: { family: Geist } }\nmotion: { style: energetic, designed: [flash] }\n');
  const undeclared = await runGate({ video: flash, root, config: loadConfig(root), outDir: path.join(root, 'r2a'), noSage: true, noOcr: true });
  assert.ok(undeclared.findings.some((f) => f.check === 'black_frames'));     // brand alone suppresses nothing
  assert.ok(undeclared.notes.some((n) => /brand allows flash; declare its frames in schedule effects/.test(n)));
  assert.match(summaryText(undeclared, null), /brand allows flash; declare its frames/);
  fs.writeFileSync(path.join(root, 'sagecut', 'schedule.json'), JSON.stringify({ ...SCHEDULE, effects: [{ kind: 'flash', frames: [39, 42] }] }));
  const designed = await runGate({ video: flash, root, config: loadConfig(root), outDir: path.join(root, 'r2'), noSage: true, noOcr: true });
  assert.ok(!designed.findings.some((f) => f.check === 'black_frames'));
  assert.ok(designed.designed.some((f) => f.check === 'black_frames' && f.designed_effect === 'flash'));
  assert.match(summaryText(designed, null), /Marked as designed, not defects/);
  assert.ok(!designed.skipped.some((s) => s.startsWith('Brand colour')));
  fs.rmSync(root, { recursive: true, force: true });
});

test('gate fails with a fix when the schedule or the video is missing', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sagecut-gate-'));
  await assert.rejects(runGate({ video: path.join(root, 'none.mp4'), root, config: loadConfig(root), outDir: path.join(root, 'o'), noSage: true }), /Video not found/);
  fs.writeFileSync(path.join(root, 'v.mp4'), 'x');
  await assert.rejects(runGate({ video: path.join(root, 'v.mp4'), root, config: loadConfig(root), outDir: path.join(root, 'o'), noSage: true }), /No schedule at .*sagecut init/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('the command: exit 1 on findings, --json output, --out folder, and the key is never written', { skip: !canMake && 'ffmpeg with lavfi is not available' }, async () => {
  const gate = await import('../../src/commands/gate.mjs');
  const root = project(), video = path.join(root, 'bad.mp4'), out = path.join(root, 'cmd-out');
  assert.equal(make(video, { moving: true, after: BLACK('between(n,40,41)') }).status, 0);
  const secret = 'sk-test-secret-0123456789';
  const prev = process.env.SAGE_API_KEY; process.env.SAGE_API_KEY = secret;
  const chunks = []; const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (c) => { chunks.push(String(c)); return true; };
  let code;
  try { code = await gate.run([video, '--json', '--no-sage', '--no-ocr', '--out', out], { root, config: loadConfig(root) }); }
  finally { process.stdout.write = write; if (prev === undefined) delete process.env.SAGE_API_KEY; else process.env.SAGE_API_KEY = prev; }
  assert.equal(code, 1);
  const j = JSON.parse(chunks.find((c) => c.startsWith('{') && c.includes('"exit"')));
  assert.equal(j.exit, 1); assert.equal(j.out, out); assert.ok(j.counts.findings >= 1 && j.critic_frames.length >= 3);
  assert.ok(j.findings.some((f) => f.check === 'black_frames'));
  for (const f of fs.readdirSync(out, { recursive: true })) {
    const full = path.join(out, f);
    if (fs.statSync(full).isFile() && /\.(json|md)$/.test(f)) assert.ok(!fs.readFileSync(full, 'utf8').includes(secret), f);
  }
  assert.equal(await gate.run([], { root, config: loadConfig(root) }), 2);                                  // no video: usage error
  assert.equal(await gate.run([path.join(root, 'nope.mp4'), '--no-sage'], { root, config: loadConfig(root) }), 2);
  fs.rmSync(root, { recursive: true, force: true });
});
