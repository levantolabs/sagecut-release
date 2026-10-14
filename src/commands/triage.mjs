// sagecut triage <sweep-run-dir> [--video FILE] [--edge N] [--json]
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import * as ff from '../core/ffmpeg.mjs';
import { SageClient } from '../core/sage.mjs';
import { readJson, writeJson, say, setQuiet } from '../core/log.mjs';
import { loadBank, badAnswer } from '../sweep/bank.mjs';
import { makeExplainer, splitFlags, flagRows, typedFrames } from '../sweep/runs.mjs';
import { runControlled, runVerdict, zeroUsage } from '../sweep/controlled.mjs';
import { makeControl, inkInfo } from '../sweep/synth.mjs';
import { decodeFrame, pngUri } from '../sweep/images.mjs';
import { popRatio } from '../sweep/measure.mjs';
import { loadContext, num } from '../sweep/common.mjs';

export const help = 'Explain sweep flags by the schedule, then ask Sage about the rest, each question with a control.';

const POP_CONFIRM = 3.0;

export function sampleFrames(run) {
  const l = run.list;
  return l.length <= 3 ? [...l] : [l[0], l[Math.floor(l.length / 2)], l[l.length - 1]];
}

async function pickControlFrame({ video, info, root, typed, flagged, count = 8 }) {
  const pool = (typed.size ? [...typed].sort((a, b) => a - b) : Array.from({ length: info.frames }, (_, i) => i))
    .filter((f) => ![...flagged].some((x) => Math.abs(x - f) <= 10));
  if (!pool.length) return null;
  const picks = Array.from({ length: Math.min(count, pool.length) }, (_, i) => pool[Math.floor(((i + 0.5) * pool.length) / Math.min(count, pool.length))]);
  let best = null;
  for (const f of picks) {
    const fr = await decodeFrame(video, f, { root, width: 480, fps: info.fps });
    const ink = inkInfo(fr);
    if (ink.usable && (!best || ink.count > best.count)) best = { frame: f, count: ink.count };
  }
  return best ? best.frame : null;
}

export async function run(argv, { root, config }) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    root: { type: 'string' }, video: { type: 'string' }, edge: { type: 'string' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } });
  if (values.help || !positionals.length) {
    console.log('usage: sagecut triage <sweep-run-dir> [--video FILE] [--edge N] [--json]\n\n' +
      'Explains sweep flags by the schedule (tolerance --edge frames, default 15), then asks Sage about the residual runs.\n' +
      'Each question has a synthetic control from your own frames. Writes triage.json and triage.md in the run folder.');
    return values.help ? 0 : 2;
  }
  if (values.json) setQuiet(true);
  let dir = path.resolve(positionals[0]);
  if (fs.existsSync(dir) && fs.statSync(dir).isFile()) dir = path.dirname(dir);
  const sweepFile = path.join(dir, 'sweep.json');
  if (!fs.existsSync(sweepFile)) throw new Error(`no sweep.json in ${dir}. Run "sagecut sweep <video>" first.`);
  const sw = readJson(sweepFile);
  const video = path.resolve(values.video || sw.video);
  if (!fs.existsSync(video)) throw new Error(`video not found: ${video}. Pass --video FILE.`);
  const info = await ff.probe(video, { root });
  const ctx = loadContext(config);
  const bank = loadBank(config);
  const pmin = sw.pmin ?? bank.pmin ?? 0.8;
  const edge = Math.round(num(values.edge, 15));
  const gap = 3 * (sw.step || 1);
  const t0 = Date.now();

  // 1. measurement: flags and the schedule
  const flags = flagRows(sw.rows.filter((r) => !r.error), pmin);
  const why = makeExplainer(ctx.schedule, { tolerance: edge, frames: info.frames, designed: ctx.designed });
  const { explained, residual } = splitFlags(flags, why, gap);
  const flaggedAll = new Set(Object.values(flags).flat());
  say(`flagged ${[...flaggedAll].length} frames; explained ${Object.values(explained).reduce((a, b) => a + b, 0)} frame-answers ${JSON.stringify(explained)}; residual runs ${residual.length}`);

  // 2. glitch runs are measured; the others get targeted Sage asks
  let usage = zeroUsage(); let usd = 0;
  const controls = {};
  const byQ = {};
  for (const r of residual) (byQ[r.q] = byQ[r.q] || []).push(r);
  for (const [q, runs] of Object.entries(byQ)) {
    if (q === 'glitch') {
      for (const r of runs) {
        const m = await popRatio(video, { root, fps: info.fps, total: info.frames, run: r });
        r.check = 'measurement';
        r.measure = m;
        if (m.ratio == null) { r.label = 'to-measure'; r.detail = 'too few frames around the run to measure'; }
        else if (m.ratio >= POP_CONFIRM) { r.label = 'confirmed'; r.detail = `one-frame pop ${m.pop} is ${m.ratio}x the local median (f${m.frame})`; }
        else { r.label = 'cleared-by-measurement'; r.detail = `one-frame pop ${m.pop} is ${m.ratio}x the local median (f${m.frame}), under ${POP_CONFIRM}x`; }
      }
      continue;
    }
    const tq = bank.triage[q];
    if (!tq) {
      for (const r of runs) { r.check = 'none'; r.label = 'to-measure'; r.detail = `no targeted question for "${q}": measure it`; }
      continue;
    }
    const width = tq.width === 'test' ? ctx.testWidth : Number(tq.width) || 960;
    const bad = tq.bad || badAnswer(q);
    const variants = tq.questions.map((t, i) => ({ id: `v${i}`, instructions: t }));
    const client = new SageClient({ root, workers: config.workers || 4, plan: config.plan, tag: 'triage' });
    client.headers();
    // the control, from the user's own clean frame
    let control = null;
    const cf = await pickControlFrame({ video, info, root, typed: typedFrames(ctx.schedule), flagged: flaggedAll });
    if (cf !== null) {
      const clean = await decodeFrame(video, cf, { root, width, fps: info.fps });
      const made = makeControl(tq.control, clean, { palette: ctx.palette });
      if (made) control = { kind: tq.control, pos: pngUri(made), neg: pngUri(clean), frame: cf };
    }
    const frames = [...new Set(runs.flatMap(sampleFrames))].sort((a, b) => a - b);
    const items = [];
    for (const f of frames) items.push({ id: `f${f}`, label: `f${f}`, media: ff.toDataUri(await ff.still(video, f, { root, fps: info.fps, width, format: 'png' }), 'png') });
    say(`triage: ${q}: ${items.length} frames, control ${control ? control.kind : 'none'}`);
    const res = await runControlled(client, { items, variants, control, bad, pmin, what: `triage:${q}` });
    usage = { billed_input_tokens: usage.billed_input_tokens + res.usage.billed_input_tokens, output_tokens: usage.output_tokens + res.usage.output_tokens,
      image_tokens: usage.image_tokens + res.usage.image_tokens, calls: usage.calls + res.usage.calls };
    usd += res.usd;
    controls[q] = { kind: control ? control.kind : null, frame: control ? control.frame : null, width, bad, variants: res.controls };
    const rowOf = new Map(res.rows.map((x) => [x.id, x]));
    for (const r of runs) {
      const answers = [];
      for (const f of sampleFrames(r)) {
        const row = rowOf.get(`f${f}`);
        if (!row) continue;
        for (const v of variants) { const a = row.answers[v.id]; if (a) answers.push({ frame: f, variantId: v.id, answer: a.answer, p: a.p, error: a.error || null }); }
      }
      const v = runVerdict(answers, res.controls, bad, pmin);
      r.check = 'sage'; r.label = v.label; r.detail = v.detail; r.votes = { n: v.n, problems: v.problems, voided: v.voided, weak: v.weak };
      r.answers = answers.map(({ frame, variantId, answer, p }) => ({ frame, variant: variantId, answer, p }));
    }
  }

  const counts = { 'cleared-by-measurement': 0, 'cleared-by-sage': 0, confirmed: 0, 'to-measure': 0 };
  for (const r of residual) counts[r.label]++;
  const out = {
    sweep: path.basename(dir), video, pmin, edge, flagged: sw.flagged || Object.fromEntries(Object.entries(flags).map(([q, v]) => [q, v.length])),
    explained, residual_runs: residual.length, counts,
    residual: residual.map((r) => ({ q: r.q, frames: r.frames, n: r.n, ask_frame: r.ask_frame, label: r.label, check: r.check, detail: r.detail,
      measure: r.measure, votes: r.votes, answers: r.answers })),
    controls, usage, usd: Number(usd.toFixed(6)), plan: config.plan, seconds: Number(((Date.now() - t0) / 1000).toFixed(1)),
  };
  writeJson(path.join(dir, 'triage.json'), out);
  const md = markdown(out);
  fs.writeFileSync(path.join(dir, 'triage.md'), md);
  if (values.json) console.log(JSON.stringify(out)); else say(md);
  return counts.confirmed || counts['to-measure'] ? 1 : 0;
}

function markdown(o) {
  const L = [`# Triage of ${o.sweep}`, ''];
  const nExpl = Object.values(o.explained).reduce((a, b) => a + b, 0);
  L.push(`${nExpl} flagged frame-answers explained by the schedule: ${Object.entries(o.explained).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}.`);
  L.push(`${o.residual_runs} residual runs: ${Object.entries(o.counts).map(([k, v]) => `${k} ${v}`).join(', ')}.`, '');
  if (o.residual.length) {
    L.push('| question | frames | label | how | detail |', '|---|---|---|---|---|');
    for (const r of o.residual) L.push(`| ${r.q} | f${r.frames[0]}-${r.frames[1]} (${r.n}) | ${r.label} | ${r.check} | ${r.detail} |`);
    L.push('');
  }
  const cs = Object.entries(o.controls);
  if (cs.length) {
    L.push('## Controls', '');
    for (const [q, c] of cs) {
      for (const [v, x] of Object.entries(c.variants)) L.push(`- ${q}/${v}: ${x.kind ? `${x.kind} control from f${c.frame}` : 'no control'} ${x.ok ? 'OK' : 'FAILED'} (${x.reason})`);
    }
    L.push('');
  }
  L.push(`Sage cost $${o.usd.toFixed(6)}, ${o.usage.billed_input_tokens} text + ${o.usage.image_tokens || 0} image input tokens, ${o.seconds} s.`);
  L.push('"confirmed" means a repeated flag: measure it next. A Sage answer alone is never proof.');
  return L.join('\n') + '\n';
}
