// sagecut baseline prepare <video> [--frames 10]    sagecut baseline measure <marker>
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { parseArgs } from 'node:util';
import * as ff from '../core/ffmpeg.mjs';
import { qaDir, ensureDir } from '../core/paths.mjs';
import { readJson, writeJson, say, setQuiet } from '../core/log.mjs';
import { measureMarker } from '../claude/sessions.mjs';
import { fileSha12 } from '../sweep/images.mjs';

export const help = 'Record the time and tokens of one critic reviewing N frames the old way (baseline for the results card).';

export const MARKER_PREFIX = 'SAGECUT-BASELINE-';

// N frame numbers spread evenly over the video (the middle of N equal parts).
export function pickFrames(total, n) {
  const k = Math.max(1, Math.min(n, total));
  return Array.from({ length: k }, (_, i) => Math.min(total - 1, Math.floor(((i + 0.5) * total) / k)));
}

export function buildPrompt({ marker, dir, frames, files, fps }) {
  const list = frames.map((f, i) => `${i + 1}. ${files[i]}   (frame ${f}, ${(f / fps).toFixed(2)} s)`).join('\n');
  return `${marker}

You are a video critic. This is a timed review of ${frames.length} frames of one video. Review them the way a reviewer without tools does it: open each frame yourself.

Open each of these image files with the Read tool, one at a time, in this order. Do not open any other file. Do not run code.

${list}

For each frame, write one line with these five answers (yes or no) and a short note only where the answer shows a problem:
1. cut: is any word or letter cut off by the edge of the picture or partly hidden?
2. over: does any text sit on a busy picture or object instead of a plain background?
3. overlap: does any text overlap other text?
4. glitch: is there a rendering glitch (a dark band, a smear, a hole, a doubled shape, a stray object)?
5. legible: could a viewer read every large word and number on a phone screen?

After the last frame, write the line DONE and the number of frames you opened.
`;
}

async function prepare(argv, { root }) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    root: { type: 'string' }, frames: { type: 'string' }, json: { type: 'boolean' } } });
  if (!positionals.length) throw new Error('usage: sagecut baseline prepare <video> [--frames 10]');
  const video = path.resolve(positionals[0]);
  if (!fs.existsSync(video)) throw new Error(`video not found: ${video}`);
  const n = Math.max(1, Math.round(Number(values.frames) || 10));
  const info = await ff.probe(video, { root });
  const id = crypto.randomBytes(4).toString('hex');
  const marker = `${MARKER_PREFIX}${id}`;
  const dir = ensureDir(path.join(qaDir(root), `baseline-${id}`));
  const framesDir = ensureDir(path.join(dir, 'frames'));
  const frames = pickFrames(info.frames, n);
  const files = [];
  for (const f of frames) {
    const file = path.join(framesDir, `f${String(f).padStart(5, '0')}.png`);
    fs.writeFileSync(file, await ff.still(video, f, { root, fps: info.fps, format: 'png' }));
    files.push(file);
  }
  const prompt = buildPrompt({ marker, dir, frames, files, fps: info.fps });
  fs.writeFileSync(path.join(dir, 'prompt.md'), prompt);
  writeJson(path.join(dir, 'meta.json'), { id, marker, video, video_sha256_12: await fileSha12(video), fps: info.fps, video_frames: info.frames,
    frames, files, created: new Date().toISOString() });
  if (values.json) { setQuiet(true); console.log(JSON.stringify({ id, marker, dir, frames, prompt_file: path.join(dir, 'prompt.md') })); return 0; }
  say(`marker: ${marker}`);
  say(`folder: ${path.relative(root, dir) || dir}`);
  say(`Start ONE critic sub-agent with exactly this prompt (the first line is the marker; do not change it):\n`);
  say(prompt);
  say(`Then run: sagecut baseline measure ${marker}`);
  return 0;
}

async function measure(argv, { root }) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { root: { type: 'string' }, json: { type: 'boolean' } } });
  if (!positionals.length) throw new Error('usage: sagecut baseline measure <marker>');
  const raw = positionals[0];
  const id = raw.startsWith(MARKER_PREFIX) ? raw.slice(MARKER_PREFIX.length) : raw;
  const marker = `${MARKER_PREFIX}${id}`;
  const dir = path.join(qaDir(root), `baseline-${id}`);
  const metaFile = path.join(dir, 'meta.json');
  if (!fs.existsSync(metaFile)) throw new Error(`no baseline folder for ${marker} (${dir}). Run "sagecut baseline prepare <video>" first.`);
  const meta = readJson(metaFile);
  const m = await measureMarker(marker, { sinceMs: Date.parse(meta.created) - 60_000 });
  if (!m.agents) throw new Error(`no Claude Code sub-agent file contains ${marker}. The critic must start with the prompt in ${path.join(dir, 'prompt.md')} and must have finished.`);
  const n = meta.frames.length;
  const notes = [...m.notes];
  if (m.agents > 1) notes.push(`${m.agents} sub-agent files contain the marker; their numbers are summed`);
  if (m.image_views < n) notes.push(`the critic opened ${m.image_views} images for ${n} frames`);
  const out = {
    id, marker, video: meta.video, video_sha256_12: meta.video_sha256_12, frames: meta.frames, frames_reviewed: n,
    agents: m.agents, turns: m.turns, models: m.models, tokens: m.tokens,
    usd: m.usd, price_unknown: m.price_unknown, usd_per_frame: m.usd === null ? null : Number((m.usd / n).toFixed(6)),
    seconds: m.seconds, seconds_per_frame: Number((m.seconds / n).toFixed(3)),
    image_views: m.image_views, distinct_images: m.distinct_images,
    method: 'tokens summed from the critic\'s Claude Code session file (deduplicated by message id), priced at Claude API list prices with the measured cache TTL split; seconds = first to last timestamp of that file',
    files: m.files.map((f) => path.basename(f)), notes, measured: new Date().toISOString(),
  };
  writeJson(path.join(dir, 'baseline.json'), out);
  if (values.json) { console.log(JSON.stringify(out)); return 0; }
  say(`baseline ${id}: ${n} frames, ${out.turns} turns, ${out.seconds} s (${out.seconds_per_frame} s per frame)`);
  say(`tokens: input ${m.tokens.input}, output ${m.tokens.output}, cache read ${m.tokens.cache_read}, cache write 5 min ${m.tokens.cache_write_5m}, 1 h ${m.tokens.cache_write_1h}`);
  say(m.usd === null ? `price unknown for: ${m.price_unknown.join(', ')} (tokens reported; no USD)` : `cost $${m.usd.toFixed(4)} at API list prices ($${out.usd_per_frame} per frame)`);
  say(`image views ${m.image_views}, distinct images ${m.distinct_images}`);
  for (const x of notes) say(`note: ${x}`);
  say(`written: ${path.relative(root, path.join(dir, 'baseline.json')) || path.join(dir, 'baseline.json')}`);
  return 0;
}

export async function run(argv, ctx) {
  const i = argv.indexOf('--root');
  const args = i >= 0 ? [...argv.slice(0, i), ...argv.slice(i + 2)] : argv;   // --root may come before the subcommand
  const [sub, ...rest] = args;
  if (sub === 'prepare') return prepare(i >= 0 ? [...rest, '--root', argv[i + 1]] : rest, ctx);
  if (sub === 'measure') return measure(i >= 0 ? [...rest, '--root', argv[i + 1]] : rest, ctx);
  console.log('usage: sagecut baseline prepare <video> [--frames 10]\n       sagecut baseline measure <marker>');
  return sub === '--help' || sub === '-h' ? 0 : 2;
}
