// The question bank and the Sage round of the gate. Sage is reached only through core/sage.mjs (SageClient).
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { chunk, sageUsd } from '../core/sage.mjs';
import { appendJsonl } from '../core/log.mjs';
import { metricsDir, pluginRoot } from '../core/paths.mjs';
import { SCALE_MARGIN } from './consts.mjs';

export const defaultBankPath = () => path.join(pluginRoot(), 'assets', 'bank', 'gate-default.yaml');

export function loadBank(file) {
  if (!fs.existsSync(file)) throw new Error(`Question bank not found: ${file}`);
  const bank = YAML.parse(fs.readFileSync(file, 'utf8'));
  if (!bank || !Array.isArray(bank.questions)) throw new Error(`Question bank ${file} has no "questions" list`);
  return { path: file, questions: Object.fromEntries(bank.questions.map((q) => [q.id, q])) };
}

// The question as Sage receives it: placeholders in {braces} filled from params.
export function renderQuestion(q, params = {}) {
  let instr = q.instructions;
  for (const [k, v] of Object.entries(params)) if (typeof v === 'string') instr = instr.split(`{${k}}`).join(v);
  if (/\{[a-z_]+\}/.test(instr)) throw new Error(`question ${q.id}: unfilled placeholder in "${instr.slice(0, 100)}"`);
  const out = { id: q.id, kind: q.kind, instructions: instr.trim() };
  if (q.kind === 'scale') out.levels = q.levels.map((l) => ({ level: l.level, description: l.description }));
  return out;
}

export async function askSage(client, groups, { maxBilled, onEstimate = () => {} } = {}) {
  const t0 = Date.now();
  const chunks = chunk(groups.map((g, i) => ({ ...g, id: i })));
  let lo = 0, hi = 0;
  for (const c of chunks) {
    const e = await client.estimate(c);
    if (e) { lo += e.min_input_tokens || 0; hi += e.max_input_tokens || 0; }
  }
  onEstimate({ lo, hi, groups: groups.length, chunks: chunks.length });
  if (hi > maxBilled) throw new Error(`Sage estimate ${hi.toLocaleString('en-US')} input tokens is above --max-billed ${maxBilled.toLocaleString('en-US')}. Raise the limit or send fewer frames.`);
  const answers = new Map(), usage = { billed_input_tokens: 0, output_tokens: 0, image_tokens: 0, calls: 0 };
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= chunks.length) return;
      let results;
      try { results = await client.callChunk(chunks[i]); }
      catch (err) {
        for (const g of chunks[i]) answers.set(g.id, new Map(g.questions.map((q) => [q.id, { ok: false, error: err.message }])));
        continue;
      }
      for (const { groups: gs, resp } of results) {
        usage.calls++;
        const u = (resp.meta && resp.meta.usage) || {};
        usage.billed_input_tokens += u.billed_input_tokens || 0;
        usage.output_tokens += u.output_tokens || u.billed_output_tokens || 0;
        usage.image_tokens += u.image_tokens || 0;
        gs.forEach((g, k) => {
          const gr = (resp.results || [])[k] || {};
          const m = new Map();
          g.questions.forEach((q, j) => {
            const a = (gr.answers || [])[j] || {};
            const rid = a.result && a.result.id;
            const ans = rid && rid !== q.id ? (gr.answers || []).find((x) => x.result && x.result.id === q.id) || a : a;
            if (ans.ok) {
              const r = (ans.result && ans.result.result) || {};
              m.set(q.id, { ok: true, answer: r.answer ?? null, p: r.probability ?? null, expectation: r.expectation ?? null });
            } else m.set(q.id, { ok: false, error: ans.error || 'no answer' });
          });
          answers.set(g.id, m);
        });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(client.workers, chunks.length) }, worker));
  const usd = sageUsd(usage, client.plan);
  const seconds = (Date.now() - t0) / 1000;
  appendJsonl(path.join(metricsDir(client.root), 'sage.jsonl'), { tag: 'gate', what: 'gate', groups: groups.length, ...usage, usd: Number(usd.toFixed(6)), plan: client.plan, seconds });
  return { answers, usage, usd, estimate: [lo, hi], calls: usage.calls, seconds };
}

// Decision on one answer: { status: fail | escalate | pass, answer, p, note }.
export function judge(q, ans) {
  if (!ans || !ans.ok) return { status: 'error', answer: null, p: null, note: `no answer: ${(ans && ans.error) || 'no response'}` };
  if (q.kind === 'yesno') {
    if (ans.answer == null) return { status: 'escalate', answer: null, p: ans.p, note: 'null answer' };
    return { status: ans.answer === q.fail ? 'fail' : 'pass', answer: ans.answer, p: ans.p, note: '' };
  }
  if (q.kind === 'scale') {
    const e = ans.expectation, line = q.pass_at_least;
    if (e == null) return { status: 'escalate', answer: null, p: null, note: 'null expectation' };
    const near = line != null && Math.abs(e - line) < SCALE_MARGIN, low = line != null && e < line;
    const r = Math.round(e * 100) / 100;
    if (q.escalate_only) return { status: low || near ? 'escalate' : 'pass', answer: r, p: r, note: low ? 'escalate-only, below the pass line' : near ? 'near the pass line' : '' };
    if (near) return { status: 'escalate', answer: r, p: r, note: 'near the pass line' };
    return { status: low ? 'fail' : 'pass', answer: r, p: r, note: '' };
  }
  return { status: 'escalate', answer: null, p: null, note: `unsupported kind ${q.kind}` };
}
