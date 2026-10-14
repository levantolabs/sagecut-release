// brand from-folder: reads logo, font, CSS, JSON token and text guide files from a brand kit folder.
import fs from 'node:fs';
import path from 'node:path';
import { analyseCss, mergeAnalyses } from './css.mjs';
import { assignRoles, parseColor } from './color.mjs';

const MAX_FILES = 600;
const SKIP_DIR = /^(node_modules|\.git|__MACOSX)$/;

function walk(dir, depth = 0, out = []) {
  if (depth > 4 || out.length >= MAX_FILES) return out;
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (e.name.startsWith('.') || SKIP_DIR.test(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, depth + 1, out); else if (e.isFile()) out.push(p);
    if (out.length >= MAX_FILES) break;
  }
  return out;
}

export function sfntNames(buf) {
  try {
    const tag = buf.toString('latin1', 0, 4);
    if (!['\x00\x01\x00\x00', 'OTTO', 'true', 'ttcf'].includes(tag)) return null;
    const n = buf.readUInt16BE(4);
    for (let i = 0; i < n; i++) {
      const o = 12 + i * 16;
      if (buf.toString('latin1', o, o + 4) !== 'name') continue;
      const off = buf.readUInt32BE(o + 8);
      const count = buf.readUInt16BE(off + 2), strOff = off + buf.readUInt16BE(off + 4);
      const names = {};
      for (let j = 0; j < count; j++) {
        const r = off + 6 + j * 12;
        const plat = buf.readUInt16BE(r), id = buf.readUInt16BE(r + 6), len = buf.readUInt16BE(r + 8), so = buf.readUInt16BE(r + 10);
        if (![1, 2, 4, 16, 17].includes(id)) continue;
        const raw = buf.subarray(strOff + so, strOff + so + len);
        const s = plat === 1 ? raw.toString('latin1') : Buffer.from(raw).swap16().toString('utf16le');
        if (!names[id] || plat === 3) names[id] = s;
      }
      const os2 = findTable(buf, n, 'OS/2');
      const weight = os2 !== null && buf.length > os2 + 6 ? buf.readUInt16BE(os2 + 4) : null;
      return { family: names[16] || names[1] || null, sub: names[17] || names[2] || null, weight };
    }
  } catch { /* fall through */ }
  return null;
}
function findTable(buf, n, want) {
  for (let i = 0; i < n; i++) { const o = 12 + i * 16; if (buf.toString('latin1', o, o + 4) === want) return buf.readUInt32BE(o + 8); }
  return null;
}

const WEIGHTS = { thin: 100, hairline: 100, extralight: 200, ultralight: 200, light: 300, regular: 400, book: 400, normal: 400, medium: 500, semibold: 600, demibold: 600, bold: 700, extrabold: 800, ultrabold: 800, black: 900, heavy: 900 };
function fromFileName(file) {
  const base = path.basename(file, path.extname(file));
  const parts = base.split(/[-_ ]+/);
  let weight = 400; let italic = false; const fam = [];
  for (const p of parts) {
    const low = p.toLowerCase().replace(/italic|oblique/, () => { italic = true; return ''; });
    if (WEIGHTS[low]) weight = WEIGHTS[low]; else if (low) fam.push(p);
  }
  return { family: fam.join(' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim() || base, weight, italic };
}

const PNG_SIG = '89504e470d0a1a0a';
function pngSize(buf) { return buf.subarray(0, 8).toString('hex') === PNG_SIG ? { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) } : null; }

function flattenTokens(obj, pathArr = [], out = []) {
  if (obj && typeof obj === 'object') {
    const v = obj.$value ?? obj.value;
    if (typeof v === 'string') out.push([pathArr.join('.').toLowerCase(), v]);
    else for (const [k, val] of Object.entries(obj)) flattenTokens(val, [...pathArr, k], out);
  } else if (typeof obj === 'string') out.push([pathArr.join('.').toLowerCase(), obj]);
  return out;
}

export function brandFromFolder(dirArg, { root }) {
  const dir = path.resolve(dirArg);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`"${dirArg}" is not a folder.`);
  const files = walk(dir);
  const notes = []; const warnings = [];
  const counts = new Map(); const named = { accents: [] };
  const cssParts = [];
  const fontFiles = []; const logos = [];
  const addColor = (hex, n = 1) => { if (hex) counts.set(hex, (counts.get(hex) || 0) + n); };
  const families = { heading: null, body: null, mono: null };
  const avoid = [];

  for (const f of files) {
    const ext = path.extname(f).toLowerCase(); const base = path.basename(f).toLowerCase();
    try {
      if (['.ttf', '.otf', '.woff', '.woff2'].includes(ext)) {
        const names = ['.ttf', '.otf'].includes(ext) ? sfntNames(fs.readFileSync(f)) : null;
        const fn = fromFileName(f);
        fontFiles.push({ file: f, family: (names && names.family) || fn.family, weight: (names && names.weight) || fn.weight, italic: fn.italic || /italic|oblique/i.test((names && names.sub) || ''), ext });
      } else if (ext === '.svg' || ext === '.png') {
        const isLogo = /logo|mark|wordmark|brand|lockup|icon/.test(base);
        if (!isLogo && !/logo/i.test(path.relative(dir, path.dirname(f)))) continue;
        let score = 10; if (ext === '.svg') score += 30; if (/logo/.test(base)) score += 20; if (/wordmark|lockup/.test(base)) score += 5;
        if (/(white|reverse|dark|mono|negative|favicon|icon)/.test(base)) score -= 15;
        let size = null;
        if (ext === '.png') { size = pngSize(fs.readFileSync(f).subarray(0, 32)); if (size && size.w < 128) score -= 10; }
        else if (/<svg/i.test(fs.readFileSync(f, 'utf8').slice(0, 2000)) === false) continue;
        logos.push({ file: f, score, size });
      } else if (ext === '.css') {
        cssParts.push(fs.readFileSync(f, 'utf8'));
      } else if (ext === '.json') {
        const j = JSON.parse(fs.readFileSync(f, 'utf8'));
        const toks = flattenTokens(j);
        let used = 0;
        for (const [k, v] of toks) {
          const hex = parseColor(v);
          if (hex) {
            used++; addColor(hex, 3);
            if (/primary|brand/.test(k) && !named.primary) named.primary = hex;
            else if (/accent|secondary/.test(k)) named.accents.push(hex);
            else if (/(background|bg|surface)/.test(k) && !named.background) named.background = hex;
            else if (/(text|foreground|ink)/.test(k) && !named.text) named.text = hex;
          } else if (/font.*(family|heading|display)|typography.*(heading|display)/.test(k) && !families.heading) families.heading = v.split(',')[0].replace(/['"]/g, '').trim();
          else if (/font.*(body|text|family|sans)/.test(k) && !families.body) families.body = v.split(',')[0].replace(/['"]/g, '').trim();
          else if (/font.*mono/.test(k) && !families.mono) families.mono = v.split(',')[0].replace(/['"]/g, '').trim();
        }
        if (used) notes.push(`${path.relative(dir, f)}: ${used} colour token(s)`);
      } else if (['.txt', '.md', '.markdown'].includes(ext)) {
        const t = fs.readFileSync(f, 'utf8').slice(0, 200000);
        for (const line of t.split(/\r?\n/)) {
          const hexes = [...line.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g)].map((m) => parseColor(m[0])).filter(Boolean);
          for (const h of hexes) {
            addColor(h, 4);
            if (/primary|brand colou?r|main/i.test(line) && !named.primary) named.primary = h;
            else if (/accent|secondary|highlight/i.test(line)) named.accents.push(h);
            else if (/background|paper|canvas/i.test(line) && !named.background) named.background = h;
            else if (/\btext\b|ink|foreground/i.test(line) && !named.text) named.text = h;
          }
          const fm = line.match(/(heading|headline|display|body|text|mono(?:space)?|code)?\s*(?:font|typeface)s?\s*[:=\-]\s*\**([A-Z][\w ]{1,40})/i);
          if (fm) {
            const role = /mono|code/i.test(fm[1] || '') ? 'mono' : /body|text/i.test(fm[1] || '') ? 'body' : 'heading';
            const val = fm[2].trim().replace(/\s+(for|in|at|and)\b.*$/i, '');
            if (!families[role]) families[role] = val;
          }
          const am = line.match(/(?:avoid|never use|don'?t use|do not use)(?: the words?)?\s*[:\-]\s*(.+)/i);
          if (am) avoid.push(...am[1].split(/[,;]/).map((s) => s.replace(/["'*.]/g, '').trim()).filter((s) => s && s.length < 30));
        }
        notes.push(`${path.relative(dir, f)}: guide read`);
      }
    } catch (e) { warnings.push(`${path.relative(dir, f)}: ${e.message}`); }
  }

  const cssAn = cssParts.length ? mergeAnalyses(cssParts.map((c) => analyseCss(c))) : null;
  if (cssAn) {
    for (const [h, n] of cssAn.counts) addColor(h, n);
    for (const k of ['primary', 'background', 'text']) if (!named[k] && cssAn.named[k]) named[k] = cssAn.named[k];
    named.accents.push(...cssAn.named.accents);
    for (const k of Object.keys(families)) if (!families[k] && cssAn.families[k]) families[k] = cssAn.families[k];
  }
  const roles = assignRoles({ counts, named });
  if (!roles.primary) roles.primary = roles.text;

  // fonts: group files by family
  const byFam = new Map();
  for (const ff of fontFiles) { const k = ff.family.toLowerCase(); if (!byFam.has(k)) byFam.set(k, []); byFam.get(k).push(ff); }
  const famNames = [...byFam.keys()];
  const pickFamily = (want) => (want && byFam.has(want.toLowerCase()) ? want.toLowerCase() : null);
  if (!families.heading && famNames.length) families.heading = byFam.get(famNames[0])[0].family;
  if (!families.body) families.body = famNames.length > 1 ? byFam.get(famNames[1])[0].family : families.heading;
  const fonts = {};
  for (const [role, family] of Object.entries(families)) {
    if (!family) continue;
    const mine = (byFam.get(pickFamily(family)) || []).filter((f) => !f.italic);
    const rank = (f) => ['.woff2', '.woff', '.ttf', '.otf'].indexOf(f.ext);
    const regular = [...mine].sort((a, b) => Math.abs(a.weight - 400) - Math.abs(b.weight - 400) || rank(a) - rank(b))[0];
    fonts[role] = { family, weights: [...new Set(mine.map((f) => f.weight))].sort((a, b) => a - b) };
    if (!fonts[role].weights.length) fonts[role].weights = [400, 700];
    if (regular) fonts[role].file = regular.file;
  }
  if (!fonts.heading && !fonts.body) notes.push('no fonts found');

  logos.sort((a, b) => b.score - a.score);
  const assetsDir = path.join(root, 'sagecut', 'brand-assets');
  const logoFiles = [];
  for (const l of logos.slice(0, 2)) {
    fs.mkdirSync(assetsDir, { recursive: true });
    const dest = path.join(assetsDir, path.basename(l.file));
    fs.copyFileSync(l.file, dest);
    logoFiles.push(path.relative(root, dest).split(path.sep).join('/'));
  }

  const draft = {
    name: path.basename(dir).replace(/[-_]*(brand[-_ ]?kit|brand[-_ ]?guidelines?|assets)$/i, '') || path.basename(dir),
    colors: { background: roles.background, text: roles.text, primary: roles.primary, accent: roles.accent, allowed: roles.allowed },
    fonts,
    logo: { files: logoFiles, min_px: 48, clear_space: 0.5 },
    type: {},
    motion: { style: 'restrained', designed: [] },
    copy: { case: 'sentence', avoid: [...new Set(avoid)], grammar: 'proper' },
    format: '16:9',
    source: { kind: 'folder', ref: dir },
  };
  return { draft, found: { colours: counts.size, fonts: Object.keys(fonts).length, logos: logoFiles.length, files: files.length }, notes, warnings };
}
