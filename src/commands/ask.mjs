// sagecut ask --images <glob> --question "<text>" [--width N] [--control cut|black|frozen|ghost|offbrand|none] [--control-expect yes|no]
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { SageClient } from '../core/sage.mjs';
import { writeJson, say, setQuiet } from '../core/log.mjs';
import { runControlled } from '../sweep/controlled.mjs';
import { makeControl, defaultControl, CONTROL_KINDS } from '../sweep/synth.mjs';
import { expandGlob, decodeImageFile, pngUri } from '../sweep/images.mjs';
import { loadContext, num } from '../sweep/common.mjs';

export const help = 'Ask Sage one yes/no question about some images, with an automatic control.';

export async function run(argv, { root, config }) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    root: { type: 'string' }, images: { type: 'string', multiple: true }, question: { type: 'string' }, width: { type: 'string' },
    control: { type: 'string' }, 'control-expect': { type: 'string' }, out: { type: 'string' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } });
  if (values.help || !(values.images || positionals.length) || !values.question) {
    console.log('usage: sagecut ask --images <glob> --question "<text>" [--width N] [--control cut|black|frozen|ghost|offbrand|none]\n' +
      '                   [--control-expect yes|no] [--out FILE] [--json]\n\n' +
      'Asks Sage one yes/no question on each image (scaled to --width, default the test width). A control made from your first\n' +
      'image runs in the same batch. If Sage misses the defect in the control, the run is unreliable: its "no" answers prove nothing.\n' +
      'Without --control, the control is chosen from the question words; --control none turns it off.');
    return values.help ? 0 : 2;
  }
  if (values.json) setQuiet(true);
  const expect = values['control-expect'] || 'yes';
  if (!['yes', 'no'].includes(expect)) throw new Error('--control-expect must be yes or no');
  const kind = values.control || defaultControl(values.question) || 'none';
  if (kind !== 'none' && !CONTROL_KINDS.includes(kind)) throw new Error(`--control must be one of ${CONTROL_KINDS.join(', ')} or none (got "${kind}")`);
  const ctx = loadContext(config);
  const width = Math.round(num(values.width, ctx.testWidth));

  const files = [];
  for (const g of [...(values.images || []), ...positionals]) {
    const hit = expandGlob(g);
    if (!hit.length && fs.existsSync(g)) hit.push(path.resolve(g));
    if (!hit.length) throw new Error(`no files match ${g}`);
    files.push(...hit);
  }
  const unique = [...new Set(files)];
  const client = new SageClient({ root, workers: config.workers || 4, plan: config.plan, tag: 'ask' });
  client.headers();

  const frames = [];
  for (const f of unique) frames.push(await decodeImageFile(f, { root, width }));
  const items = unique.map((f, i) => ({ id: f, label: path.basename(f), media: pngUri(frames[i]) }));

  let control = null; let controlNote = null;
  if (kind !== 'none') {
    const made = makeControl(kind, frames[0], { palette: ctx.palette });
    if (made) control = { kind, pos: pngUri(made) };
    else controlNote = `a "${kind}" control could not be made from ${path.basename(unique[0])} (no text found to move)`;
  } else if (!values.control) controlNote = 'no control fits this question; its answers are not verified';
  // The control is judged on the expected answer only (the user's question can have any polarity).
  const res = await runControlled(client, { items, variants: [{ id: 'q', instructions: values.question }], control, bad: expect, what: 'ask' });
  const c = res.controls.q;
  const verified = !!control;
  const unreliable = verified ? !c.ok : false;
  const rows = res.rows.map((r) => ({ id: r.id, label: r.label, answer: r.answers.q.answer, p: r.answers.q.p, null: r.answers.q.answer == null, error: r.answers.q.error || null }));
  const out = {
    question: values.question, width, control: control ? { kind: control.kind, expect, ok: c.ok, reason: c.reason, answer: c.pos && c.pos.answer, p: c.pos && c.pos.p } : { kind: 'none', note: controlNote },
    unreliable, count: rows.length, usage: res.usage, usd: Number(res.usd.toFixed(6)), seconds: Number(res.seconds.toFixed(1)), results: rows,
  };
  if (values.out) writeJson(path.resolve(values.out), out);
  if (values.json) console.log(JSON.stringify(out));
  else {
    const w = Math.max(...rows.map((r) => r.label.length), 5);
    for (const r of rows) say(`${r.label.padEnd(w)}  ${(r.answer || 'null').padEnd(4)}  p=${r.p != null ? r.p.toFixed(3) : '-'}${r.error ? `  error: ${r.error}` : ''}`);
    say('');
    if (control) say(`control (${control.kind}, expected ${expect}): ${c.ok ? 'OK' : 'FAILED'}, ${c.reason}${unreliable ? '\nUNRELIABLE: Sage missed the defect in the control, so its "no" answers above prove nothing. Measure instead.' : ''}`);
    else say(`control: none${controlNote ? ` (${controlNote})` : ''}`);
    say(`${rows.length} images, billed input ${res.usage.billed_input_tokens}, output ${res.usage.output_tokens}, cost $${res.usd.toFixed(6)}`);
  }
  return unreliable ? 1 : 0;
}
