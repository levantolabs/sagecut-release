// sagecut deliver-check <video> [--fix]: the delivery spec of the house rules, measured on the delivered file.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { probe, frames as streamFrames, still, loudness, run as ff } from '../core/ffmpeg.mjs';
import { loadBrand } from '../core/brand.mjs';
import { TEST_WIDTH } from '../core/config.mjs';
import { newRunDir, ensureDir } from '../core/paths.mjs';
import { tryCreateOcr } from '../core/ocr.mjs';
import { say } from '../core/log.mjs';
import { isFaststart } from '../splice/mp4.mjs';
import { holdRanges, covered, runs, longFreezes, FROZEN_MIN_SECONDS } from '../core/frozen.mjs';

export { holdRanges, covered };

export const help = 'check the delivery spec (colour range, loudness, black/frozen frames, faststart, audio, placeholders); --fix repairs it';

const PLACEHOLDER = [/placeholder/i, /\b8,?888\b/, /\$\s?8\.88/, /lorem ipsum/i];
const BLACK_MEAN = 22;          // gray level (limited-range black is 16)

export async function scanFrames(video, info, { root }) {
  const w = 480; const h = Math.max(2, Math.round((w * info.height / info.width) / 2) * 2);   // the gate's grid, so both checks measure the same thing
  const means = []; const diffs = []; let prev = null;
  for await (const f of streamFrames(video, { root, width: w, height: h, gray: true })) {
    let sum = 0, bright = 0;
    const d = f.data;
    for (let i = 0; i < d.length; i++) { sum += d[i]; if (d[i] > 40) bright++; }
    means.push({ mean: sum / d.length, bright: bright / d.length });
    if (prev) { let ds = 0; for (let i = 0; i < d.length; i++) ds += Math.abs(d[i] - prev[i]); diffs.push(ds / d.length); } else diffs.push(Infinity);
    prev = Buffer.from(d);
  }
  return { means, diffs };
}

async function silenceRuns(video, root) {
  const r = await ff('ffmpeg', ['-hide_banner', '-nostats', '-i', video, '-vn', '-af', 'silencedetect=noise=0.000001:d=0.5', '-f', 'null', '-'], { root });
  const out = []; let start = null;
  for (const line of r.stderr.split(/\r?\n/)) {
    const a = line.match(/silence_start:\s*(-?[\d.]+)/); if (a) start = Number(a[1]);
    const b = line.match(/silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/);
    if (b) { out.push({ start: start ?? Number(b[1]) - Number(b[2]), duration: Number(b[2]) }); start = null; }
  }
  if (start !== null) out.push({ start, duration: null });
  return out;
}

export async function checkVideo(video, ctx, { frameSet = null, ocr = true } = {}) {
  const root = ctx.root;
  const checks = [];
  const add = (name, status, detail, extra = {}) => checks.push({ name, status, detail, ...extra });
  const info = await probe(video, { root });
  let schedule = null;
  try { schedule = JSON.parse(fs.readFileSync(ctx.config.schedulePath, 'utf8')); } catch { /* no schedule: no declared holds */ }
  let brand = null; try { brand = loadBrand(ctx.config.brandPath); } catch { /* ignore */ }
  const holds = holdRanges(schedule);
  const fps = info.fps;

  add('video', 'info', `${info.codec} ${info.width}x${info.height} ${info.pixFmt} at ${fps} fps, ${info.frames} frames`);
  add('codec', info.codec === 'h264' ? 'pass' : 'fail', info.codec === 'h264' ? 'H.264' : `codec is ${info.codec}, the spec asks for H.264`);

  // colour range
  if (info.colorRange === 'tv') add('colour range', 'pass', 'limited (tv)');
  else if (info.colorRange === 'pc' || /^yuvj/.test(info.pixFmt || '')) add('colour range', 'fail', `full range (${info.pixFmt}); the spec asks for limited (tv)`, { fixable: true });
  else add('colour range', 'pass', `not tagged (${info.pixFmt}); players read it as limited`);

  // faststart
  if (/mp4|mov/.test(info.formatName || '')) {
    if (isFaststart(video)) add('faststart', 'pass', 'moov atom before mdat');
    else add('faststart', 'fail', 'moov atom is after mdat; players wait for the full download', { fixable: true });
  } else add('faststart', 'skip', `container ${info.formatName}`);

  // audio, loudness, silence
  const audioMode = ['auto', 'required', 'none'].includes(ctx.config.audio) ? ctx.config.audio : 'auto';
  if (audioMode === 'none') {
    add('audio stream', 'info', 'audio: none in sagecut.yaml; loudness and silence checks skipped');
  } else if (!info.hasAudio) {
    if (audioMode === 'required') add('audio stream', 'fail', 'no audio stream (audio: required in sagecut.yaml)');
    else add('audio stream', 'warn', 'no audio stream. If the video should have sound, add the track; if it is silent by design, set audio: none in sagecut/sagecut.yaml');
  } else {
    add('audio stream', 'pass', 'present');
    const l = await loudness(video, { root });
    if (!l) add('loudness', 'skip', 'could not measure');
    else {
      add('loudness', Math.abs(l.lufs + 14) <= 1 ? 'pass' : 'fail', `${l.lufs.toFixed(1)} LUFS (target -14 +/- 1)`);
      add('true peak', l.truePeak <= -1 ? 'pass' : 'fail', `${l.truePeak.toFixed(1)} dBTP (limit -1)`);
    }
    const sil = await silenceRuns(video, root);
    if (sil.length) add('digital silence', 'fail', `${sil.length} run(s) of true zero audio of 0.5 s or more: ${sil.slice(0, 5).map((s) => `${s.start.toFixed(2)} s${s.duration ? ` for ${s.duration.toFixed(2)} s` : ' to the end'}`).join(', ')}. Use room tone.`);
    else add('digital silence', 'pass', 'no run of true zero audio of 0.5 s or more');
  }

  // black and frozen frames, measured in Node
  const { means, diffs } = await scanFrames(video, info, { root });
  const black = means.map((m) => m.mean < BLACK_MEAN && m.bright < 0.005);
  const blackRuns = runs(black, 1);
  const bad = [];
  if (black[0]) bad.push(`opens on black (frame 0${blackRuns[0] ? `-${blackRuns[0][1]}` : ''})`);
  for (const [s, e] of blackRuns) {
    if (s === 0) continue;
    if (e === means.length - 1 && e - s < fps) continue;   // fade to black at the very end
    if (e - s + 1 >= 2 && !covered(s, e, holds)) bad.push(`black frames ${s}-${e} (${((e - s + 1) / fps).toFixed(2)} s)`);
  }
  add('black frames', bad.length ? 'fail' : 'pass', bad.length ? bad.join('; ') : 'no black opening, no black run inside');
  const long = longFreezes(diffs, fps, holds, black);
  const unheld = long.filter((r) => !r.held);
  add('frozen frames', unheld.length ? 'fail' : 'pass',
    unheld.length ? `frozen longer than ${FROZEN_MIN_SECONDS} s and not declared in static_holds: ${unheld.slice(0, 6).map((r) => `${r.frames[0]}-${r.frames[1]} (${r.seconds.toFixed(1)} s)`).join(', ')}` : `no frozen run over ${FROZEN_MIN_SECONDS} s outside static_holds${long.length ? ` (${long.length} declared)` : ''}`);

  // placeholder text (OCR) and the test-width frame set
  if (ocr) {
    const engine = await tryCreateOcr();
    if (!engine) add('placeholder text', 'skip', 'OCR not available (run "sagecut doctor")');
    else {
      try {
        const step = Math.max(Math.round(fps), Math.floor(info.frames / 40));
        const picks = []; for (let f = Math.min(10, info.frames - 1); f < info.frames; f += step) picks.push(f);
        if (!picks.includes(info.frames - 1)) picks.push(info.frames - 1);
        const hits = [];
        for (const f of picks) {
          const png = await still(video, f, { root, fps, width: Math.min(1280, info.width) });
          const r = await engine.read(png);
          for (const l of r.lines) if (PLACEHOLDER.some((re) => re.test(l.text))) hits.push(`frame ${f}: "${l.text}"`);
        }
        add('placeholder text', hits.length ? 'fail' : 'pass', hits.length ? hits.slice(0, 6).join('; ') : `none found in ${picks.length} sampled frames`);
      } finally { await engine.close(); }
    }
  }
  if (frameSet) {
    const tw = ctx.config.test_width || TEST_WIDTH[(brand && brand.format) || '16:9'] || 350;
    ensureDir(frameSet);
    const n = Math.min(12, info.frames); const files = [];
    for (let i = 0; i < n; i++) {
      const f = Math.min(info.frames - 1, Math.round(((i + 0.5) / n) * info.frames));
      const png = await still(video, f, { root, fps, width: tw });
      const file = path.join(frameSet, `f${String(f).padStart(6, '0')}.png`);
      fs.writeFileSync(file, png); files.push(file);
    }
    add('test-width frames', 'info', `${files.length} frames at ${tw} px in ${frameSet}`, { dir: frameSet, width: tw, files });
  }
  return { info, checks };
}

export async function fixVideo(video, checks, out, { root }) {
  const need = (n) => checks.some((c) => c.name === n && c.status === 'fail');
  const range = need('colour range');
  if (!range && !need('faststart')) return null;
  const args = ['-v', 'error', '-y', '-i', video];
  if (range) args.push('-vf', 'scale=in_range=full:out_range=limited,format=yuv420p', '-color_range', 'tv', '-c:v', 'libx264', '-crf', '17', '-c:a', 'copy', '-movflags', '+faststart');
  else args.push('-c', 'copy', '-movflags', '+faststart');
  args.push(out);
  const r = await ff('ffmpeg', args, { root });
  if (r.code !== 0) throw new Error(`the fix failed: ${r.stderr.trim().split('\n').slice(-3).join(' | ')}`);
  return { mode: range ? 're-encode (limited range, crf 17, faststart)' : 'remux (faststart)', out };
}

export async function run(argv, ctx) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    fix: { type: 'boolean' }, out: { type: 'string' }, json: { type: 'boolean' }, root: { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help || !positionals[0]) { say('usage: sagecut deliver-check <video> [--fix] [--out FILE] [--json]'); return values.help ? 0 : 2; }
  const video = path.resolve(positionals[0]);
  if (!fs.existsSync(video)) { console.error(`No such file: ${video}`); return 2; }
  const runDir = newRunDir(ctx.root, 'deliver');
  let { checks } = await checkVideo(video, ctx, { frameSet: path.join(runDir, 'frames-test-width') });
  let fixed = null; let recheck = null;
  if (values.fix) {
    const out = path.resolve(values.out || path.join(path.dirname(video), `${path.basename(video, path.extname(video))}-delivery.mp4`));
    if (out === video) { console.error('sagecut deliver-check: --out must not be the input file.'); return 2; }
    fixed = await fixVideo(video, checks, out, { root: ctx.root });
    if (fixed) recheck = (await checkVideo(out, ctx, { ocr: false })).checks;
  }
  const failing = (recheck || checks).filter((c) => c.status === 'fail');
  const report = { video, runDir, ok: failing.length === 0, checks, ...(fixed ? { fixed, recheck } : {}) };
  fs.writeFileSync(path.join(runDir, 'report.json'), JSON.stringify(report, null, 1) + '\n');
  if (values.json) { say(JSON.stringify(report, null, 1)); return failing.length ? 1 : 0; }
  const mark = { pass: 'PASS', fail: 'FAIL', warn: 'WARN', skip: 'SKIP', info: 'INFO' };
  const show = (list) => list.forEach((c) => say(`${mark[c.status]}  ${c.name.padEnd(18)} ${c.detail}`));
  show(checks);
  if (fixed) {
    say(`\nFixed: ${fixed.out}  (${fixed.mode})`);
    say('Check of the fixed file:'); show(recheck.filter((c) => c.status !== 'info'));
  } else if (values.fix) say('\nNothing to fix: colour range and faststart already pass.');
  say(`\nReport: ${path.join(runDir, 'report.json')}`);
  return failing.length ? 1 : 0;
}
