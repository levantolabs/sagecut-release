import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as onboard from '../../src/commands/onboard.mjs';
import * as init from '../../src/commands/init.mjs';
import * as doctor from '../../src/commands/doctor.mjs';
import { loadConfig } from '../../src/core/config.mjs';
import { validateSchedule } from '../../src/core/schedule.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sagecut-test-platform-'));
process.env.SAGECUT_HOME = path.join(tmp, 'home');
const proj = path.join(tmp, 'proj'); fs.mkdirSync(proj);
fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ dependencies: { remotion: '4.0.0' } }));
const ctx = () => ({ root: proj, config: loadConfig(proj) });

async function capture(fn) {
  const out = []; const orig = console.log;
  console.log = (...a) => out.push(a.join(' '));
  try { const code = await fn(); return { code, text: out.join('\n') }; } finally { console.log = orig; }
}

test('hooks.json is the exec form with the plugin root', () => {
  const h = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8'));
  const e = h.hooks.SessionStart[0].hooks[0];
  assert.equal(e.type, 'command'); assert.equal(e.command, 'node');
  assert.deepEqual(e.args, ['${CLAUDE_PLUGIN_ROOT}/hooks/welcome.mjs']);
});

test('welcome hook prints once and never fails', () => {
  const data = path.join(tmp, 'plugin-data');
  const env = { ...process.env, CLAUDE_PLUGIN_DATA: data };
  const run = () => spawnSync(process.execPath, [path.join(ROOT, 'hooks', 'welcome.mjs')], { env, encoding: 'utf8' });
  const a = run(); assert.equal(a.status, 0);
  assert.deepEqual(JSON.parse(a.stdout), { systemMessage: 'SageCut is installed. Type /sagecut:start to begin.' });
  const b = run(); assert.equal(b.status, 0); assert.equal(b.stdout, '');
  const bad = spawnSync(process.execPath, [path.join(ROOT, 'hooks', 'welcome.mjs')], { env: { ...process.env, CLAUDE_PLUGIN_DATA: path.join(__filename_dummy(), 'x') }, encoding: 'utf8' });
  assert.equal(bad.status, 0);
});
function __filename_dummy() { return path.join(tmp, 'plugin-data', 'welcomed'); }   // a file, so mkdir below it fails

test('onboard status, welcome, done', async () => {
  let r = await capture(() => onboard.run(['status', '--json'], ctx()));
  const s = JSON.parse(r.text);
  assert.equal(s.onboarded, false); assert.equal(s.isRemotionProject, true); assert.equal(s.hasBrand, false); assert.ok(s.keyPage);
  r = await capture(() => onboard.run(['welcome'], ctx()));
  assert.match(r.text, /SageCut/);
  r = await capture(() => onboard.run(['done'], ctx()));
  assert.equal(r.code, 0);
  r = await capture(() => onboard.run(['status', '--json'], ctx()));
  assert.equal(JSON.parse(r.text).onboarded, true);
  assert.ok(fs.existsSync(path.join(tmp, 'home', 'state.json')));
});

test('init writes the files and never overwrites', async () => {
  fs.writeFileSync(path.join(proj, '.gitignore'), 'node_modules\n.env\n');
  let r = await capture(() => init.run(['--composition', 'Promo', '--fps', '60', '--frames', '600'], ctx()));
  assert.equal(r.code, 0);
  for (const f of ['sagecut/sagecut.yaml', 'sagecut/schedule.json', 'src/sagecut/useSchedule.ts', '.env.example']) assert.ok(fs.existsSync(path.join(proj, f)), f);
  assert.ok(fs.existsSync(path.join(proj, 'sagecut', 'metrics')));
  const sched = JSON.parse(fs.readFileSync(path.join(proj, 'sagecut', 'schedule.json'), 'utf8'));
  assert.deepEqual(validateSchedule(sched), []);
  assert.equal(sched.fps, 60);
  assert.deepEqual(sched.effects, []);
  assert.equal(sched.beats[0].elements[0].role, 'headline');
  assert.match(sched._help, /role/);
  assert.match(fs.readFileSync(path.join(proj, 'sagecut', 'sagecut.yaml'), 'utf8'), /^audio: auto\s+#/m);
  const gi = fs.readFileSync(path.join(proj, '.gitignore'), 'utf8');
  assert.equal(gi.split('\n').filter((l) => l === '.env').length, 1);
  assert.match(gi, /sagecut\/qa\/\*\/raw\//);
  assert.match(fs.readFileSync(path.join(proj, 'sagecut', 'sagecut.yaml'), 'utf8'), /^composition: Promo$/m);
  const ts = fs.readFileSync(path.join(proj, 'src', 'sagecut', 'useSchedule.ts'), 'utf8');
  assert.match(ts, /export function useBeat/); assert.match(ts, /export const Scheduled/);
  // second run keeps everything
  fs.writeFileSync(path.join(proj, 'sagecut', 'schedule.json'), '{"mine":true}');
  r = await capture(() => init.run([], ctx()));
  assert.match(r.text, /Kept/);
  assert.equal(fs.readFileSync(path.join(proj, 'sagecut', 'schedule.json'), 'utf8'), '{"mine":true}');
});

test('doctor reports every check and masks the key', async () => {
  const saved = process.env.SAGE_API_KEY; process.env.SAGE_API_KEY = 'sk-test-secret-1234';
  try {
    const checks = await doctor.checks(ctx());
    const names = checks.map((c) => c.name);
    for (const n of ['node', 'ffmpeg', 'sage key', 'sage server', 'ocr', 'brand', 'schedule']) assert.ok(names.includes(n), n);
    assert.ok(!JSON.stringify(checks).includes('secret'));
    assert.match(checks.find((c) => c.name === 'sage key').detail, /1234/);
    assert.equal(checks.find((c) => c.name === 'node').status, 'pass');
    assert.equal(checks.find((c) => c.name === 'ocr').status, 'pass');
  } finally { if (saved === undefined) delete process.env.SAGE_API_KEY; else process.env.SAGE_API_KEY = saved; }
});

test('cleanup', () => { fs.rmSync(tmp, { recursive: true, force: true }); });
