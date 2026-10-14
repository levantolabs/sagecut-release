// sagecut sweep <video> [--out DIR] [--workers N] [--step N] [--range A-B] [--pmin P] [--json]
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import * as ff from '../core/ffmpeg.mjs';
import { SageClient } from '../core/sage.mjs';
import { newRunDir, ensureDir } from '../core/paths.mjs';
import { writeJson, say, warn, setQuiet } from '../core/log.mjs';
import { loadBank } from '../sweep/bank.mjs';
import { flagRows, allRuns, typedFrames } from '../sweep/runs.mjs';
import { safeDecide, pool, zeroUsage } from '../sweep/controlled.mjs';
import { loadContext, num, parseRange } from '../sweep/common.mjs';
import { fileSha12 } from '../sweep/images.mjs';

export const help = 'Sage reads every frame of a video (problem questions; legibility inside text windows).';

const BIG_WIDTH = 960;

export async function run(argv, { root, config }) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    root: { type: 'string' }, out: { type: 'string' }, workers: { type: 'string' }, step: { type: 'string' }, range: { type: 'string' },
    pmin: { type: 'string' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } });
  if (values.help || !positionals.length) {
    console.log('usage: sagecut sweep <video> [--out DIR] [--workers N] [--step N] [--range A-B] [--pmin P] [--json]\n\n' +
      'Sage reads every frame at 960 px with the problem questions. Inside text windows it also asks the legibility question\n' +
      'at the test width. Writes sweep.json and summary.md in the output folder.');
    return values.help ? 0 : 2;
  }
  if (values.json) setQuiet(true);
  const video = path.resolve(positionals[0]);
  if (!fs.existsSync(video)) throw new Error(`video not found: ${video}`);
  const info = await ff.probe(video, { root });
  const ctx = loadContext(config);
  const bank = loadBank(config);
  const pmin = num(values.pmin, bank.pmin ?? 0.8);
  const step = Math.max(1, Math.round(num(values.step, 1)));
  const workers = Math.max(1, Math.round(num(values.workers, config.workers || 4)));
  const [f0, f1] = parseRange(values.range, info.frames);
  const typed = typedFrames(ctx.schedule);
  const client = new SageClient({ root, workers, plan: config.plan, tag: 'sweep' });
  client.headers();                                                   // fails early, with a fix, when there is no key
  const out = ensureDir(values.out ? path.resolve(values.out) : newRunDir(root, 'sweep'));

  const list = [];
  for (let f = f0; f <= f1; f += step) list.push(f);
  const batchFrames = workers * 10;
  const batches = [];
  for (let i = 0; i < list.length; i += batchFrames) batches.push(list.slice(i, i + batchFrames));

  const jpg = (f, width) => ff.still(video, f, { root, fps: info.fps, width, format: 'jpg' });
  const prepare = async (frames) => {
    const groups = [];
    const made = await pool(frames, workers * 2, async (f) => {
      const big = await jpg(f, BIG_WIDTH);
      const feed = typed.has(f) ? await jpg(f, ctx.testWidth) : null;
      return { f, big, feed };
    });
    for (const { f, big, feed } of made) {
      groups.push({ id: `${f}|big`, label: String(f), f, content: { kind: 'image', media: ff.toDataUri(big, 'jpg') },
        questions: Object.entries(bank.problems).map(([id, q]) => ({ id, kind: 'yesno', instructions: q })) });
      if (feed) groups.push({ id: `${f}|feed`, label: String(f), f, content: { kind: 'image', media: ff.toDataUri(feed, 'jpg') },
        questions: [{ id: 'legible', kind: 'yesno', instructions: bank.legible }] });
    }
    return groups;
  };

  const t0 = Date.now();
  const rows = []; let usage = zeroUsage(); let usd = 0; let requests = 0;
  let pending = batches.length ? prepare(batches[0]) : null;
  for (let b = 0; b < batches.length; b++) {
    const groups = await pending;
    pending = b + 1 < batches.length ? prepare(batches[b + 1]) : null;     // decode the next batch while Sage reads this one
    const r = await safeDecide(client, groups, { what: 'sweep' });
    requests += groups.length;
    const fOf = new Map(groups.map((g) => [g.id, g.f]));
    for (const row of r.rows) {
      for (const [q, a] of Object.entries(row.answers)) rows.push({ f: fOf.get(row.id), q, answer: a.answer, p: a.p, error: a.error || null });
    }
    usage = { billed_input_tokens: usage.billed_input_tokens + r.usage.billed_input_tokens, output_tokens: usage.output_tokens + r.usage.output_tokens,
      image_tokens: usage.image_tokens + r.usage.image_tokens, calls: usage.calls + r.usage.calls };
    usd += r.usd;
    say(`sweep: ${Math.min(list.length, (b + 1) * batchFrames)}/${list.length} frames`);
  }
  const seconds = (Date.now() - t0) / 1000;

  const withAnswer = new Set(rows.filter((r) => !r.error).map((r) => r.f));
  const failed = [...new Set(rows.filter((r) => r.error).map((r) => r.f))].filter((f) => !withAnswer.has(f)).sort((a, b) => a - b);
  const errors = rows.filter((r) => r.error).length;
  const nulls = rows.filter((r) => r.answer == null && !r.error).length;
  const flags = flagRows(rows, pmin);
  const runs = allRuns(flags, 3 * step);
  const res = {
    video, video_sha256_12: await fileSha12(video), fps: info.fps, video_frames: info.frames, range: [f0, f1], step,
    frames_read: withAnswer.size, requests, answers: rows.length, nulls, errors, failed_frames: failed,
    usage, usd: Number(usd.toFixed(6)), plan: config.plan, seconds: Number(seconds.toFixed(1)), workers,
    pmin, test_width: ctx.testWidth, schedule_used: !!ctx.schedule, typed_frames: typed.size,
    bank: bank.problems, legible: bank.legible,
    flagged: Object.fromEntries(Object.entries(flags).map(([q, v]) => [q, v.length])),
    runs: runs.map((r) => ({ q: r.q, frames: r.frames, n: r.n })), rows,
  };
  writeJson(path.join(out, 'sweep.json'), res);
  const md = summary(res, runs, bank);
  fs.writeFileSync(path.join(out, 'summary.md'), md);
  if (values.json) console.log(JSON.stringify({ ...res, rows: undefined, out }));
  else { say(md); say(`written: ${path.relative(root, out) || out}`); }
  if (failed.length) { warn(`sagecut: ${failed.length} frames were NOT read (Sage errors after retries). Run them again with --range, then use frames_read.`); return 2; }
  return runs.length ? 1 : 0;
}

function summary(r, runs, bank) {
  const L = [];
  L.push(`# Sage sweep, frames ${r.range[0]}-${r.range[1]} (step ${r.step})`, '');
  L.push(`${r.frames_read} frames read by Sage, ${r.requests} image requests, ${r.answers} answers (${r.nulls} unsure), ` +
    `${r.usage.billed_input_tokens.toLocaleString('en-US')} text + ${(r.usage.image_tokens || 0).toLocaleString('en-US')} image input tokens, $${r.usd.toFixed(6)} (plan ${r.plan}), ${Math.round(r.seconds)} s. ` +
    `A flag needs the problem answer with p >= ${r.pmin}. Legibility is asked at ${r.test_width} px${r.schedule_used ? ` on ${r.typed_frames} frames with text` : ' (no schedule: not asked)'}.`, '');
  if (r.errors) L.push(`**${r.errors} answers failed after retries; ${r.failed_frames.length} frames NOT read** (first: ${r.failed_frames.slice(0, 10).join(', ') || 'none'}). Run those again with --range before you use frames_read.`, '');
  for (const q of [...Object.keys(bank.problems), 'legible']) L.push(`- ${q}: ${r.flagged[q] || 0} frames flagged`);
  L.push('', '## Runs (question, first-last frame, frames flagged)');
  if (!runs.length) L.push('- none');
  for (const x of runs) L.push(`- ${x.q} f${x.frames[0]}-${x.frames[1]} n=${x.n}`);
  L.push('', 'Next: sagecut triage <this folder>');
  return L.join('\n') + '\n';
}
