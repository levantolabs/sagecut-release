// Flags -> runs, and schedule windows. Pure functions (unit tested).
import { badAnswer, isProblem } from './bank.mjs';

// rows: [{ f, q, answer, p, error }] -> { q: [frames] } of problem answers
export function flagRows(rows, pmin) {
  const flags = {};
  for (const r of rows) {
    if (r.error) continue;
    if (isProblem(r.answer, r.p, badAnswer(r.q), pmin)) (flags[r.q] = flags[r.q] || []).push(r.f);
  }
  for (const q of Object.keys(flags)) flags[q] = [...new Set(flags[q])].sort((a, b) => a - b);
  return flags;
}

export function groupRuns(q, frames, gap) {
  const runs = [];
  let cur = null;
  for (const f of frames) {
    if (cur && f - cur[cur.length - 1] <= gap) cur.push(f);
    else { if (cur) runs.push(cur); cur = [f]; }
  }
  if (cur) runs.push(cur);
  return runs.map((r) => ({ q, frames: [r[0], r[r.length - 1]], n: r.length, list: r }));
}

export function allRuns(flags, gap) {
  return Object.entries(flags).flatMap(([q, fs]) => groupRuns(q, fs, gap)).sort((a, b) => a.frames[0] - b.frames[0]);
}

// A beat's hold: [start, end] of the stable part of the beat.
const holdOf = (b) => (Array.isArray(b.hold) ? b.hold : [b.start, b.end]);

export function typedFrames(schedule) {
  const set = new Set();
  if (!schedule) return set;
  for (const b of schedule.beats) {
    const [h0, h1] = holdOf(b);
    for (const e of b.elements) {
      if (!(e.text || '').trim()) continue;
      for (let f = Math.max(h0, e.in); f <= Math.min(h1, e.out ?? h1); f++) set.add(f);
    }
  }
  return set;
}

// Frames where any text element is on screen at all (in -> out).
export function onscreenFrames(schedule) {
  const set = new Set();
  if (!schedule) return set;
  for (const b of schedule.beats) {
    for (const e of b.elements) {
      if (!(e.text || '').trim()) continue;
      for (let f = e.in; f <= (e.out ?? b.end); f++) set.add(f);
    }
  }
  return set;
}

export function makeExplainer(schedule, { tolerance = 15, frames = null, designed = new Set() } = {}) {
  const edges = []; const moving = new Set(); const onscreen = onscreenFrames(schedule);
  if (schedule) {
    for (const b of schedule.beats) {
      const [h0, h1] = holdOf(b);
      for (const e of b.elements) {
        const o = e.out ?? b.end;
        edges.push(e.in, o);
        if (!(e.text || '').trim()) continue;
        if (h0 - e.in >= 0 && h0 - e.in <= 90) for (let f = e.in; f <= h0; f++) moving.add(f);    // the whole reveal, up to the hold
        if (o - h1 >= 0 && o - h1 <= 90) for (let f = h1; f <= o; f++) moving.add(f);              // the whole exit, from the hold's end
      }
    }
  }
  const trans = schedule ? schedule.transitions.map((t) => t.frames) : [];
  const cuts = schedule ? [...schedule.cuts, ...(schedule.interim_cuts || []).map((c) => (typeof c === 'number' ? c : c.frame)).filter((x) => x != null)] : [];
  return function why(f, q) {
    if (q === 'legible' && schedule && !onscreen.has(f)) return 'no type on screen';
    if (moving.has(f) || edges.some((x) => Math.abs(f - x) <= tolerance)) return 'element enter/exit';
    if (trans.some(([a, b]) => f >= a && f <= b)) return 'transition';
    if (cuts.some((c) => Math.abs(f - c) <= 2)) return 'cut';
    if (frames != null && (f <= 1 || f >= frames - 2)) return 'frame edge (first or last frames)';
    if (q === 'glitch' && designed.has('glitch')) return 'designed effect (brand)';
    return null;
  };
}

// Split flagged frames into explained counts and residual runs.
export function splitFlags(flags, why, gap) {
  const explained = {}; const residual = [];
  for (const [q, fs] of Object.entries(flags)) {
    const left = [];
    for (const f of fs) {
      const w = why(f, q);
      if (w) explained[w] = (explained[w] || 0) + 1; else left.push(f);
    }
    for (const r of groupRuns(q, left, gap)) residual.push({ ...r, ask_frame: r.list[Math.floor(r.list.length / 2)] });
  }
  residual.sort((a, b) => a.frames[0] - b.frames[0]);
  return { explained, residual };
}
