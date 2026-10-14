// Claude Code session files (<config>/projects/<encoded-cwd>/<session>.jsonl and the sub-agent files), read for token usage.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { priceFor, tokensUsd } from './prices.mjs';

export function claudeConfigDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

const HEAD_BYTES = 512 * 1024;

function readHead(file, bytes = HEAD_BYTES) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n).toString('utf8');
  } finally { fs.closeSync(fd); }
}

// All session files, newest first. Sub-agent files carry `agent: true`.
export function listSessionFiles(configDir = claudeConfigDir()) {
  const out = [];
  const projects = path.join(configDir, 'projects');
  let dirs = [];
  try { dirs = fs.readdirSync(projects, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return out; }
  const add = (file, agent) => {
    try { out.push({ file, agent, mtime: fs.statSync(file).mtimeMs }); } catch { /* file vanished */ }
  };
  for (const d of dirs) {
    const pdir = path.join(projects, d.name);
    let entries = [];
    try { entries = fs.readdirSync(pdir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.jsonl')) add(path.join(pdir, e.name), false);
      else if (e.isDirectory()) {
        const sub = path.join(pdir, e.name, 'subagents');
        let files = [];
        try { files = fs.readdirSync(sub); } catch { continue; }
        for (const f of files) if (f.startsWith('agent-') && f.endsWith('.jsonl')) add(path.join(sub, f), true);
      }
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

export function findMarkedFiles(marker, { configDir = claudeConfigDir(), sinceMs = 0 } = {}) {
  const hits = [];
  for (const f of listSessionFiles(configDir)) {
    if (!f.agent) continue;
    if (sinceMs && f.mtime < sinceMs) continue;
    let head = '';
    try { head = readHead(f.file); } catch { continue; }
    const nl = head.indexOf('\n');
    const first = nl >= 0 ? head.slice(0, nl) : head;
    if (first.includes(marker)) hits.push(f.file);
  }
  return hits;
}

const emptyTokens = () => ({ input: 0, output: 0, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0 });

export async function parseSessionFile(file) {
  const byId = new Map();
  const hashes = new Set();
  let views = 0; let other = 0; let first = null; let last = null; let noSplit = 0;
  // Session files reach gigabytes (image data), so read line by line.
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o.timestamp) {
      const t = Date.parse(o.timestamp);
      if (Number.isFinite(t)) { if (first === null || t < first) first = t; if (last === null || t > last) last = t; }
    }
    const m = o.message;
    if (!m) continue;
    if (o.type === 'assistant' && m.usage) {
      const id = m.id || o.uuid;
      byId.set(id, { model: m.model || null, usage: m.usage });
    } else if (o.type === 'user' && Array.isArray(m.content)) {
      for (const blk of m.content) {
        if (!blk || typeof blk !== 'object') continue;
        if (blk.type === 'tool_result' && Array.isArray(blk.content)) {
          for (const x of blk.content) {
            if (x && x.type === 'image') {
              views++;
              hashes.add(crypto.createHash('sha256').update(String((x.source && x.source.data) || JSON.stringify(x.source || {}))).digest('hex'));
            }
          }
        } else if (blk.type === 'image') other++;
      }
    }
  }
  const models = {};
  for (const { model, usage: u } of byId.values()) {
    if (!model || model === '<synthetic>') continue;
    const t = (models[model] = models[model] || { ...emptyTokens(), turns: 0 });
    t.turns++;
    t.input += u.input_tokens || 0;
    t.output += u.output_tokens || 0;
    t.cache_read += u.cache_read_input_tokens || 0;
    const cc = u.cache_creation;
    const total = u.cache_creation_input_tokens || 0;
    if (cc && (cc.ephemeral_5m_input_tokens !== undefined || cc.ephemeral_1h_input_tokens !== undefined)) {
      const w5 = cc.ephemeral_5m_input_tokens || 0; const w1 = cc.ephemeral_1h_input_tokens || 0;
      t.cache_write_5m += w5; t.cache_write_1h += w1;
      if (total > w5 + w1) { t.cache_write_5m += total - w5 - w1; noSplit += total - w5 - w1; }
    } else if (total) { t.cache_write_5m += total; noSplit += total; }
  }
  const notes = [];
  if (noSplit) notes.push(`${noSplit} cache-write tokens had no TTL split and are priced at the 5-minute rate`);
  return {
    file, models, turns: byId.size, image_views: views, distinct_images: hashes, other_image_blocks: other,
    first_ts: first, last_ts: last, seconds: first !== null && last !== null ? (last - first) / 1000 : 0, notes,
  };
}

export function summarize(parsed) {
  const models = {};
  const hashes = new Set();
  let views = 0; let turns = 0; let seconds = 0; let other = 0; const notes = [];
  for (const p of parsed) {
    views += p.image_views; turns += p.turns; seconds += p.seconds; other += p.other_image_blocks;
    for (const h of p.distinct_images) hashes.add(h);
    notes.push(...p.notes);
    for (const [model, t] of Object.entries(p.models)) {
      const a = (models[model] = models[model] || { ...emptyTokens(), turns: 0 });
      for (const k of Object.keys(a)) a[k] += t[k] || 0;
    }
  }
  const tokens = emptyTokens();
  let usd = 0; const unknown = [];
  const per_model = {};
  for (const [model, t] of Object.entries(models)) {
    for (const k of Object.keys(tokens)) tokens[k] += t[k];
    const cost = tokensUsd(model, t);
    const price = priceFor(model);
    per_model[model] = { ...t, price_id: price ? price.id : null, usd: cost === null ? null : Number(cost.toFixed(6)) };
    if (cost === null) unknown.push(model); else usd += cost;
  }
  return {
    files: parsed.map((p) => p.file), agents: parsed.length, turns, tokens, models: per_model,
    usd: unknown.length ? null : Number(usd.toFixed(6)), usd_known_models: Number(usd.toFixed(6)), price_unknown: unknown,
    image_views: views, distinct_images: hashes.size, other_image_blocks: other, seconds: Number(seconds.toFixed(1)),
    notes: [...new Set(notes)],
  };
}

export async function measureMarker(marker, opts = {}) {
  const files = findMarkedFiles(marker, opts);
  const parsed = [];
  for (const f of files) parsed.push(await parseSessionFile(f));
  return { marker, ...summarize(parsed) };
}
