// schedule.json: the single source of timing. The Remotion composition imports it, and SageCut checks against it.
import fs from 'node:fs';

const REQUIRED = ['film', 'fps', 'frames', 'width', 'height', 'safe_margin_px', 'beats', 'transitions'];

export const EDGE_SIDES = ['left', 'right', 'top', 'bottom'];

export const TEXT_ROLES = ['headline', 'body', 'caption', 'url'];
export function rolelessText(schedule) {
  return (schedule.beats || []).flatMap((b) => (b.elements || [])
    .filter((e) => e && e.text !== undefined && !TEXT_ROLES.includes(e.role))
    .map((e) => `${b.id}/${e.id}`));
}

export function edgeContactSides(v) {
  if (v === undefined || v === null || v === false) return [];
  if (v === true) return [...EDGE_SIDES];
  if (Array.isArray(v) && v.every((s) => EDGE_SIDES.includes(s))) return [...new Set(v)];
  return null;
}

export function validateSchedule(s) {
  const errors = [];
  if (s.allow_edge_contact !== undefined && edgeContactSides(s.allow_edge_contact) === null) {
    errors.push('"allow_edge_contact" must be true, false, or a list of "left", "right", "top" and "bottom"');
  }
  for (const k of REQUIRED) if (s[k] === undefined) errors.push(`missing "${k}"`);
  if (!Array.isArray(s.beats)) return errors.concat('"beats" must be a list');
  s.beats.forEach((b, i) => {
    const where = `beats[${i}]${b && b.id ? ` (${b.id})` : ''}`;
    for (const k of ['id', 'start', 'end']) if (b[k] === undefined) errors.push(`${where}: missing "${k}"`);
    if (b.start > b.end) errors.push(`${where}: start ${b.start} is after end ${b.end}`);
    if (b.end > s.frames) errors.push(`${where}: end ${b.end} is after the last frame (${s.frames})`);
    (b.elements || []).forEach((e, j) => {
      if (e.id === undefined || e.in === undefined) errors.push(`${where}.elements[${j}]: needs "id" and "in"`);
      if (e.in < b.start || e.in > b.end) errors.push(`${where}.elements[${j}] (${e.id}): in ${e.in} is outside the beat ${b.start}-${b.end}`);
      if (e.out !== undefined && e.out < e.in) errors.push(`${where}.elements[${j}] (${e.id}): out ${e.out} is before in ${e.in}`);
    });
  });
  (s.transitions || []).forEach((t, i) => {
    if (!Array.isArray(t.frames) || t.frames.length !== 2) errors.push(`transitions[${i}]: "frames" must be [first, last]`);
  });
  return errors;
}

export function loadSchedule(file) {
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  const errors = validateSchedule(s);
  if (errors.length) {
    const e = new Error(`schedule ${file} has ${errors.length} error(s):\n  ${errors.join('\n  ')}`);
    e.errors = errors; throw e;
  }
  return normalize(s);
}

// Fill defaults so every consumer sees the same shape.
export function normalize(s) {
  for (const b of s.beats) {
    b.elements = (b.elements || []).map((e) => ({ ...e, out: e.out ?? b.end }));
    if (b.hold !== undefined && !Array.isArray(b.hold)) b.hold = [b.hold, b.end];
  }
  s.transitions = s.transitions || [];
  s.cuts = s.cuts || [];
  s.image_regions = s.image_regions || [];
  s.static_holds = s.static_holds || [];
  return s;
}

export const beatAt = (s, f) => s.beats.find((b) => f >= b.start && f <= b.end) || null;
export const elementsOnAt = (s, f) => s.beats.flatMap((b) => b.elements.filter((e) => f >= e.in && f <= e.out).map((e) => ({ ...e, beat: b.id })));
export const inTransition = (s, f) => s.transitions.find((t) => f >= t.frames[0] && f <= t.frames[1]) || null;
