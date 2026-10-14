// Frames for the critics: each finding frame, each beat's settled frame, each transition midpoint, each element entrance
import path from 'node:path';
import fs from 'node:fs';
import { writeJson } from '../core/log.mjs';
import { SEVERITY_RANK } from './consts.mjs';
import { rawFrame, resizeRGB, writePng, makeSheet, timecode } from './images.mjs';
import { mapLimit } from './util.mjs';

export const MAX_CRITIC_FRAMES = 32;
const CAPS = { finding: 10, beat: 8, transition: 6, element: 8, motion: 6 };

export function topMotionFrames(d, n = CAPS.motion) {
  const order = Array.from(d, (v, f) => [v, f]).filter(([v, f]) => f > 0 && v > 0).sort((a, b) => b[0] - a[0]);
  const out = [];
  for (const [v, f] of order) {
    if (out.length >= n) break;
    if (out.every((x) => Math.abs(x.frame - f) >= 5)) out.push({ frame: f, diff: v });
  }
  return out;
}

export function frameOfRow(row) {
  const [a, b] = row.frames;
  return b === a + 1 ? b : (a + b) >> 1;
}

function evenly(list, k) {
  if (list.length <= k) return list;
  const out = [];
  for (let i = 0; i < k; i++) out.push(list[Math.round((i * (list.length - 1)) / (k - 1 || 1))]);
  return [...new Set(out)];
}

export function selectCriticFrames({ sched, settled, rows, beatOf, max = MAX_CRITIC_FRAMES, total, motion = [] }) {
  const sorted = [...rows].sort((a, b) => (SEVERITY_RANK[a.severity] ?? 2.5) - (SEVERITY_RANK[b.severity] ?? 2.5) || a.frames[0] - b.frames[0]);
  const q = {
    finding: sorted.map((r) => ({ frame: frameOfRow(r), reason: `${r.source === 'sage' ? 'Sage' : 'measured'} ${r.check}` })),
    beat: evenly(settled.map((s) => ({ frame: s.frame, reason: `beat ${s.beat} settled frame` })), CAPS.beat),
    transition: (sched.transitions || []).map((t) => ({ frame: Math.round((t.frames[0] + t.frames[1]) / 2), reason: `transition ${t.from || '?'} to ${t.to || '?'} midpoint` })),
    element: (sched.beats || []).flatMap((b) => (b.elements || []).flatMap((e) => [
      { frame: e.in, reason: `element ${e.id} arrives (beat ${b.id})` },
      { frame: e.in + 8, reason: `element ${e.id} settling (beat ${b.id})` },
    ])),
    motion: motion.map((m) => ({ frame: m.frame, reason: `motion peak (diff ${m.diff.toFixed(2)})` })),
  };
  const chosen = [];
  const add = (c) => {
    if (c.frame < 0 || (total != null && c.frame >= total)) return false;
    const near = chosen.find((x) => Math.abs(x.frame - c.frame) <= 1);
    if (near) { if (!near.reason.includes(c.reason)) near.reason += `; ${c.reason}`; return false; }
    if (chosen.length >= max) return false;
    chosen.push({ ...c, beat: beatOf(c.frame) });
    return true;
  };
  const rest = [];
  for (const k of ['finding', 'beat', 'transition', 'element', 'motion']) q[k].forEach((c, i) => { if (i < CAPS[k]) add(c); else rest.push(c); });
  for (const c of rest) add(c);
  return chosen.sort((a, b) => a.frame - b.frame);
}

export async function writeCriticFrames(dir, video, info, picks, { root, thumbW = 320 }) {
  fs.mkdirSync(dir, { recursive: true });
  const w = Math.min(info.width, 1280), h = Math.round((info.height * w) / info.width);
  const imgs = await mapLimit(picks, 4, (p) => rawFrame(video, p.frame, { root, fps: info.fps, w, h, scale: w !== info.width }));
  const index = picks.map((p, i) => {
    const file = `f${String(p.frame).padStart(5, '0')}.png`;
    writePng(path.join(dir, file), imgs[i]);
    return { frame: p.frame, beat: p.beat, reason: p.reason, file };
  });
  writeJson(path.join(dir, 'index.json'), { video: path.basename(video), fps: info.fps, frames: index });
  if (picks.length) {
    const cells = picks.map((p, i) => ({ img: resizeRGB(imgs[i], thumbW, Math.round((imgs[i].h * thumbW) / imgs[i].w)), label: `f${p.frame}  ${timecode(p.frame, info.fps)}` }));
    writePng(path.join(dir, 'contact.png'), makeSheet(cells, { cellW: thumbW, cols: picks.length <= 12 ? 4 : 6, scale: 2 }));
  }
  return index;
}
