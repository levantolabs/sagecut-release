// sagecut check-schedule: schema, video facts and brand copy rules, before any render.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { validateSchedule, normalize, rolelessText } from '../core/schedule.mjs';
import { probe } from '../core/ffmpeg.mjs';
import { loadBrand } from '../core/brand.mjs';
import { say } from '../core/log.mjs';

export const help = 'check schedule.json: schema, video fps/frames/size, brand copy rules';

// Text that is not prose: URL, domain, handle, hashtag, path, code or file name.
export function looksLikeCode(text) {
  const t = text.trim();
  return /^[@#/]/.test(t) || /^[a-z0-9-]+\.[a-z]{2,}/i.test(t) || (/\./.test(t) && !/\s/.test(t)) || /[`{}<>=;]|\(\)/.test(t);
}

const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function copyFindings(schedule, brand) {
  const out = [];
  const copy = (brand && brand.copy) || {};
  const avoid = (copy.avoid || []).map(String).filter(Boolean);
  for (const beat of schedule.beats) {
    let prev = null;   // the previous text element of this beat
    for (const el of beat.elements) {
      const text = typeof el.text === 'string' ? el.text : '';
      if (!text || el.literal) continue;
      const startsSentence = prev === null || /[.!?:]["')\]]*\s*$/.test(prev);
      prev = text;
      const where = `beat ${beat.id}, element ${el.id}, frames ${el.in}-${el.out}`;
      for (const w of avoid) {
        if (new RegExp(`(^|[^\\p{L}\\p{N}])${esc(w)}($|[^\\p{L}\\p{N}])`, 'iu').test(text)) out.push({ level: 'error', where, frame: el.in, message: `uses "${w}", a word the brand avoids: "${text}"` });
      }
      if (looksLikeCode(text)) continue;
      const letters = text.replace(/[^\p{L}]/gu, '');
      if (!letters) continue;
      if (copy.case === 'lower' && text !== text.toLowerCase()) out.push({ level: 'error', where, frame: el.in, message: `brand case is lower case: "${text}"` });
      if (copy.case === 'upper' && text !== text.toUpperCase()) out.push({ level: 'error', where, frame: el.in, message: `brand case is upper case: "${text}"` });
      if (startsSentence && (copy.case === 'sentence' || copy.case === 'title') && /^\p{Ll}/u.test(text.trim())) {
        out.push({ level: 'warn', where, frame: el.in, message: `brand case is ${copy.case} case but the text starts a sentence with a lower-case letter: "${text}"` });
      }
    }
  }
  return out;
}

export async function run(argv, ctx) {
  const { values } = parseArgs({ args: argv, options: { video: { type: 'string' }, json: { type: 'boolean' }, root: { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help) { say('usage: sagecut check-schedule [--video FILE] [--json]'); return 0; }
  const file = ctx.config.schedulePath;
  if (!fs.existsSync(file)) { console.error(`No schedule at ${path.relative(ctx.root, file)}. Run "sagecut init".`); return 2; }
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.error(`${file} is not valid JSON: ${e.message}`); return 2; }
  const findings = validateSchedule(raw).map((m) => ({ level: 'error', where: 'schema', message: m }));
  if (!findings.length) {
    for (const id of rolelessText(raw)) findings.push({ level: 'warn', where: 'roles', message: `${id}: text has no role, so it is checked as a caption (the smallest floor). Set "role" to headline, body, caption or url.` });
  }
  const info = [];
  if (!findings.length) {
    const s = normalize(raw);
    if (values.video) {
      try {
        const v = await probe(values.video, { root: ctx.root });
        const cmp = (what, a, b, tol = 0) => { if (Math.abs(a - b) > tol) findings.push({ level: 'error', where: 'video', message: `${what}: schedule says ${a}, the video has ${b}` }); };
        cmp('fps', s.fps, Math.round(v.fps * 1000) / 1000, 0.01);
        cmp('frames', s.frames, v.frames, 1);
        cmp('width', s.width, v.width); cmp('height', s.height, v.height);
        info.push(`video ${v.width}x${v.height} at ${v.fps} fps, ${v.frames} frames`);
      } catch (e) { findings.push({ level: 'error', where: 'video', message: e.message }); }
    }
    let brand = null;
    try { brand = loadBrand(ctx.config.brandPath); } catch (e) { findings.push({ level: 'warn', where: 'brand', message: e.message }); }
    if (!brand) info.push('no brand file: copy rules not checked');
    findings.push(...copyFindings(s, brand));
    info.push(`${s.beats.length} beats, ${s.beats.reduce((n, b) => n + b.elements.length, 0)} elements`);
  }
  const errors = findings.filter((f) => f.level === 'error').length;
  if (values.json) { say(JSON.stringify({ ok: errors === 0, errors, findings, info }, null, 1)); return errors ? 1 : 0; }
  info.forEach((m) => say(m));
  for (const f of findings) say(`${f.level === 'error' ? 'ERROR' : 'WARN '}  ${f.where}${f.frame !== undefined ? ` (frame ${f.frame})` : ''}: ${f.message}`);
  say(errors ? `${errors} error(s).` : 'Schedule OK.');
  return errors ? 1 : 0;
}
