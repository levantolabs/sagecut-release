// Sage (Levanto Labs decision model) client. POST /decide/batch, POST /usage/estimate, GET /ready.
import path from 'node:path';
import { loadSageEnv } from './env.mjs';
import { appendJsonl } from './log.mjs';
import { metricsDir } from './paths.mjs';
import { VERSION } from './version.mjs';

export const MAX_GROUPS = 20;          // groups per batch call
export const BATCH_BYTES = 7_000_000;  // the API returns 413 above 8 MiB of JSON
export const PLAN_INPUT_USD = { developer: 0.05, starter: 0.046, pro: 0.042, growth: 0.038 };
export const OUTPUT_USD = 10.0;

export function sageUsd(usage, plan = 'developer') {
  const inRate = (PLAN_INPUT_USD[plan] ?? PLAN_INPUT_USD.developer) / 1e6;
  return ((usage.billed_input_tokens || 0) + (usage.image_tokens || 0)) * inRate + (usage.output_tokens || 0) * (OUTPUT_USD / 1e6);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const groupBytes = (g) => (typeof g.content === 'string' ? g.content.length : (g.content.media || '').length + (g.content.text || '').length)
  + JSON.stringify(g.questions).length + 64;

export function chunk(groups, { maxGroups = MAX_GROUPS, maxBytes = BATCH_BYTES } = {}) {
  const out = []; let cur = []; let n = 0;
  for (const g of groups) {
    const s = groupBytes(g);
    if (cur.length && (cur.length >= maxGroups || n + s > maxBytes)) { out.push(cur); cur = []; n = 0; }
    cur.push(g); n += s;
  }
  if (cur.length) out.push(cur);
  return out;
}

export class SageClient {
  constructor({ root = process.cwd(), workers = 4, plan = 'developer', tag = 'sagecut' } = {}) {
    const env = loadSageEnv(root);
    this.root = root; this.key = env.key; this.endpoint = env.endpoint; this.workers = workers; this.plan = plan; this.tag = tag;
  }

  headers() {
    if (!this.key) throw new Error('No Sage key. Put SAGE_API_KEY=... in your project .env file (run "sagecut doctor").');
    return { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json', 'User-Agent': `sagecut/${VERSION}` };
  }

  async ready() {
    try {
      const r = await fetch(`${this.endpoint}/ready`, { headers: { 'User-Agent': `sagecut/${VERSION}` } });
      return { ok: r.status === 200, status: r.status };
    } catch (e) { return { ok: false, status: 0, error: e.message }; }
  }

  async post(route, payload, tries = 5) {
    const body = JSON.stringify(payload);
    for (let n = 0; n < tries; n++) {
      let r;
      try { r = await fetch(`${this.endpoint}${route}`, { method: 'POST', headers: this.headers(), body }); }
      catch (e) { if (n < tries - 1) { await sleep(2000 * 2 ** n); continue; } throw new Error(`Sage ${route}: ${e.message}`); }
      if (r.status === 200) return r.json();
      if (r.status === 413) { const e = new Error('413'); e.code = 413; throw e; }
      if ([429, 500, 502, 503, 504].includes(r.status) && n < tries - 1) {
        const ra = Number(r.headers.get('retry-after'));
        await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 2000 * 2 ** n);
        continue;
      }
      const text = (await r.text()).slice(0, 400);
      if (r.status === 401 || r.status === 403) throw new Error(`Sage rejected the key (HTTP ${r.status}). Check SAGE_API_KEY in .env.`);
      throw new Error(`Sage ${route} HTTP ${r.status}: ${text}`);
    }
    throw new Error(`Sage ${route}: no answer after ${tries} tries`);
  }

  async estimate(groups) {
    const sum = { min_input_tokens: 0, max_input_tokens: 0, chunks: 0 };
    try {
      for (const c of chunk(groups)) {
        const j = await this.post('/usage/estimate', { requests: c.map((g) => ({ content: g.content, questions: g.questions })) }, 2);
        const u = (j && j.usage) || j || {};
        sum.min_input_tokens += u.min_input_tokens || 0;
        sum.max_input_tokens += u.max_input_tokens || 0;
        sum.chunks++;
      }
      return sum;
    } catch { return null; }
  }

  async callChunk(groups) {
    try {
      const j = await this.post('/decide/batch', { requests: groups.map((g) => ({ content: g.content, questions: g.questions })) });
      return [{ groups, resp: j }];
    } catch (e) {
      if (e.code === 413 && groups.length > 1) {
        const h = Math.ceil(groups.length / 2);
        return [...(await this.callChunk(groups.slice(0, h))), ...(await this.callChunk(groups.slice(h)))];
      }
      throw e;
    }
  }

  async decide(groups, { what = 'decide' } = {}) {
    const t0 = Date.now();
    const chunks = chunk(groups);
    const results = new Array(chunks.length);
    let next = 0;
    const worker = async () => {
      for (;;) {
        const i = next++;
        if (i >= chunks.length) return;
        results[i] = await this.callChunk(chunks[i]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.workers, chunks.length) }, worker));
    const usage = { billed_input_tokens: 0, output_tokens: 0, image_tokens: 0, calls: 0 };
    const rows = [];
    for (const parts of results) {
      for (const { groups: gs, resp } of parts) {
        usage.calls++;
        const u = (resp.meta && resp.meta.usage) || {};
        usage.billed_input_tokens += u.billed_input_tokens || 0;
        usage.output_tokens += u.output_tokens || u.billed_output_tokens || 0;
        usage.image_tokens += u.image_tokens || 0;
        gs.forEach((g, i) => {
          const gr = (resp.results || [])[i] || {};
          const answers = {};
          g.questions.forEach((q, j) => {
            const a = (gr.answers || [])[j] || {};
            if (a.ok) {
              const r = (a.result && a.result.result) || {};
              const expectation = r.expectation ?? null;   // scale questions answer with an expectation (e.g. 1..5)
              answers[q.id] = { answer: r.answer ?? null, p: r.probability ?? null, expectation, null: r.answer == null && expectation == null };
            } else answers[q.id] = { answer: null, p: null, expectation: null, null: true, error: a.error || 'no answer' };
          });
          rows.push({ id: g.id, label: g.label || String(g.id), answers });
        });
      }
    }
    const usd = sageUsd(usage, this.plan);
    const seconds = (Date.now() - t0) / 1000;
    appendJsonl(path.join(metricsDir(this.root), 'sage.jsonl'), { tag: this.tag, what, groups: groups.length, ...usage, usd: Number(usd.toFixed(6)), plan: this.plan, seconds });
    return { rows, usage, usd, seconds };
  }

  // One yes/no question on many images. images: [{ id, label, media }] (media = data URI)
  async yesno(images, instructions, opts = {}) {
    const groups = images.map((im) => ({ id: im.id, label: im.label, content: { kind: 'image', media: im.media },
      questions: [{ id: 'q', kind: 'yesno', instructions }] }));
    const r = await this.decide(groups, opts);
    return { ...r, rows: r.rows.map((row) => ({ id: row.id, label: row.label, ...row.answers.q })) };
  }
}
