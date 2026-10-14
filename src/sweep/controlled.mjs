// Sage asks with a positive control in the same batch.
import { isProblem } from './bank.mjs';

export const CONTROL_PMIN = 0.7;
const CTL_POS = '__control_pos';
const CTL_NEG = '__control_neg';

const addUsage = (a, b) => ({
  billed_input_tokens: (a.billed_input_tokens || 0) + (b.billed_input_tokens || 0),
  output_tokens: (a.output_tokens || 0) + (b.output_tokens || 0),
  image_tokens: (a.image_tokens || 0) + (b.image_tokens || 0),
  calls: (a.calls || 0) + (b.calls || 0),
});

export const zeroUsage = () => ({ billed_input_tokens: 0, output_tokens: 0, image_tokens: 0, calls: 0 });

const fatal = (e) => /rejected the key|No Sage key/.test(e.message || '');

export async function safeDecide(client, groups, opts = {}) {
  try { return await client.decide(groups, opts); }
  catch (e) {
    if (fatal(e)) throw e;
    if (groups.length > 1) {
      const h = Math.ceil(groups.length / 2);
      const [a, b] = [await safeDecide(client, groups.slice(0, h), opts), await safeDecide(client, groups.slice(h), opts)];
      return { rows: [...a.rows, ...b.rows], usage: addUsage(a.usage, b.usage), usd: a.usd + b.usd, seconds: a.seconds + b.seconds };
    }
    const g = groups[0]; const answers = {};
    for (const q of g.questions) answers[q.id] = { answer: null, p: null, null: true, error: `batch failed: ${String(e.message).slice(0, 160)}` };
    return { rows: [{ id: g.id, label: g.label || String(g.id), answers }], usage: zeroUsage(), usd: 0, seconds: 0 };
  }
}

// Run fn over list with at most n at a time.
export async function pool(list, n, fn) {
  const out = new Array(list.length); let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, list.length)) }, async () => {
    for (;;) { const i = next++; if (i >= list.length) return; out[i] = await fn(list[i], i); }
  }));
  return out;
}

// Judge one control answer set. bad = the answer that means "defect present".
export function judgeControl(pos, neg, bad, pmin) {
  const posOk = !!pos && isProblem(pos.answer, pos.p, bad, CONTROL_PMIN);
  const negFlag = !!neg && isProblem(neg.answer, neg.p, bad, pmin);
  const ok = posOk;
  const reason = !pos ? 'no control answer' : posOk ? (negFlag ? 'control found, but the question also flags the clean frame' : 'control found')
    : (pos.answer == null ? 'Sage was unsure on the control' : `Sage did not find the defect in the control (${pos.answer}, p=${pos.p})`);
  return { ok, clean_frame_flagged: negFlag, reason };
}

export async function runControlled(client, { items, variants, control, bad = 'yes', pmin = 0.8, slice = 18, what = 'ask' }) {
  const questions = variants.map((v) => ({ id: v.id, kind: 'yesno', instructions: v.instructions }));
  const slices = [];
  for (let i = 0; i < items.length; i += slice) slices.push(items.slice(i, i + slice));
  if (!slices.length && control) slices.push([]);
  const results = await pool(slices, client.workers, async (part) => {
    const groups = [];
    if (control) {
      groups.push({ id: CTL_POS, label: `control:${control.kind}`, content: { kind: 'image', media: control.pos }, questions });
      if (control.neg) groups.push({ id: CTL_NEG, label: 'clean frame', content: { kind: 'image', media: control.neg }, questions });
    }
    for (const it of part) groups.push({ id: it.id, label: it.label, content: { kind: 'image', media: it.media }, questions });
    return safeDecide(client, groups, { what });
  });
  let usage = zeroUsage(); let usd = 0; let seconds = 0; const rows = [];
  const controls = {};
  for (const v of variants) controls[v.id] = control ? { ok: true, kind: control.kind, pos: null, neg: null, clean_frame_flagged: false, reason: 'control found' }
    : { ok: false, kind: null, pos: null, neg: null, clean_frame_flagged: false, reason: 'no control could be made for this question' };
  for (const r of results) {
    usage = addUsage(usage, r.usage); usd += r.usd; seconds = Math.max(seconds, r.seconds);
    for (const row of r.rows) {
      if (row.id === CTL_POS || row.id === CTL_NEG) {
        for (const v of variants) {
          const c = controls[v.id]; const a = row.answers[v.id];
          if (row.id === CTL_POS) {
            const j = judgeControl(a, null, bad, pmin);
            if (c.pos === null || !j.ok) { c.pos = a; c.ok = c.ok && j.ok; if (!j.ok) c.reason = j.reason; }
          } else {
            c.neg = a;
            if (isProblem(a.answer, a.p, bad, pmin)) { c.clean_frame_flagged = true; if (c.ok) c.reason = 'control found, but the question also flags the clean frame'; }
          }
        }
      } else rows.push(row);
    }
  }
  return { rows, controls, usage, usd, seconds };
}

export function runVerdict(answers, controls, bad, pmin) {
  let n = 0; let pc = 0; let voided = 0; let weak = 0;
  for (const a of answers) {
    if (a.answer == null) continue;
    const c = controls[a.variantId];
    if (isProblem(a.answer, a.p, bad, pmin)) {
      if (c && c.clean_frame_flagged) { voided++; continue; }
      n++; pc++;
    } else if (a.answer === bad) weak++;       // the problem answer with low confidence
    else if (c && c.ok) n++;
    else voided++;
  }
  const base = { n, problems: pc, voided, weak };
  if (n === 0) return { label: 'to-measure', detail: voided ? 'the control failed, so the "no" answers prove nothing' : 'Sage gave no usable answer', ...base };
  if (pc >= 1 && pc * 2 >= n) return { label: 'confirmed', detail: `${pc} of ${n} answers flag it`, ...base };
  if (pc === 0 && n >= 2 && weak === 0) return { label: 'cleared-by-sage', detail: `${n} answers say no, control ok`, ...base };
  return { label: 'to-measure', detail: pc === 0 ? (weak ? 'a weak "yes" remains' : 'only one valid "no" answer') : `${pc} of ${n} answers flag it (mixed)`, ...base };
}
