// Reads brand evidence out of CSS text: custom properties, colours, font families, @font-face sources.
import { parseColor, colorsIn } from './color.mjs';

const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace',
  'ui-rounded', 'emoji', 'math', 'fangsong', 'inherit', 'initial', 'unset', 'revert', 'revert-layer', '-apple-system', 'blinkmacsystemfont',
  'segoe ui', 'roboto', 'helvetica', 'helvetica neue', 'arial', 'times new roman', 'times', 'courier new', 'courier', 'apple color emoji',
  'segoe ui emoji', 'segoe ui symbol', 'noto color emoji', 'sf pro', 'sf pro text', 'sf pro display', 'oxygen', 'ubuntu', 'cantarell', 'fira sans', 'droid sans', 'menlo', 'consolas', 'monaco', 'liberation mono', 'sfmono-regular', 'sf mono', 'georgia', 'verdana', 'tahoma', 'trebuchet ms']);

export function stripComments(css) { return css.replace(/\/\*[\s\S]*?\*\//g, ''); }

export function blocks(css) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (const m of css.matchAll(re)) out.push({ selector: m[1].trim().replace(/^[^{}]*;\s*/, ''), body: m[2] });
  return out;
}

export function declarations(body) {
  const d = [];
  for (const part of body.split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    d.push([part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).trim()]);
  }
  return d;
}

export function firstFamily(value, vars = {}) {
  let v = resolveVars(value, vars);
  for (let fam of v.split(',')) {
    fam = fam.trim().replace(/!important/i, '').trim().replace(/^['"]|['"]$/g, '').trim();
    if (!fam || fam.startsWith('var(') || !/^[A-Za-z]/.test(fam) || /^(\d|calc|clamp)/.test(fam) || GENERIC.has(fam.toLowerCase())) continue;
    return fam;
  }
  return null;
}

export function resolveVars(value, vars, depth = 0) {
  if (!value || depth > 5 || !value.includes('var(')) return value || '';
  return resolveVars(value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g, (_, name, fb) => (vars[name] !== undefined ? vars[name] : (fb || ''))), vars, depth + 1);
}

const ROLE_BG = /(^|-)(bg|background|surface|canvas|page)(-|$)/;
const ROLE_TEXT = /(^|-)(text|foreground|fg|ink|body-color|on-background)(-|$)/;
const ROLE_PRIMARY = /(^|-)(primary|brand|main|theme)(-|$)/;
const ROLE_ACCENT = /(^|-)(accent|secondary|highlight|tertiary)(-|$)/;

export function analyseCss(cssRaw, baseUrl = null) {
  const css = stripComments(cssRaw);
  const vars = {};
  const rootBlocks = blocks(css).filter((b) => /^(:root|html|:host|body|\.dark|\[data-theme[^\]]*\])$/i.test(b.selector.split(',')[0].trim()) || /:root/.test(b.selector));
  for (const b of rootBlocks) for (const [k, v] of declarations(b.body)) if (k.startsWith('--')) vars[k] = v;

  const counts = colorsIn(css);
  const named = { accents: [] };
  for (const [k, v] of Object.entries(vars)) {
    const hex = parseColor(resolveVars(v, vars));
    if (!hex) continue;
    const name = k.slice(2).toLowerCase();
    if (/(hover|active|disabled|border|shadow|overlay|muted|subtle|light|dark|\d{2,3}$)/.test(name) && !ROLE_PRIMARY.test(name)) continue;
    if (ROLE_PRIMARY.test(name) && !named.primary) named.primary = hex;
    else if (ROLE_ACCENT.test(name)) named.accents.push(hex);
    else if (ROLE_BG.test(name) && !named.background) named.background = hex;
    else if (ROLE_TEXT.test(name) && !named.text) named.text = hex;
  }
  // body colours override variable guesses when they are plain values
  for (const b of blocks(css)) {
    const sel = b.selector.toLowerCase();
    if (sel === 'body' || sel === 'html' || sel === 'html, body' || sel === 'body, html') {
      for (const [k, v] of declarations(b.body)) {
        const hex = parseColor(resolveVars(v.split(/\s+/)[0] || v, vars)) || parseColor(resolveVars(v, vars));
        if ((k === 'background-color' || k === 'background') && hex && !named.background) named.background = hex;
        if (k === 'color' && hex && !named.text) named.text = hex;
      }
    }
  }

  // fonts
  const faces = [];
  for (const m of css.matchAll(/@font-face\s*\{([^{}]*)\}/gi)) {
    const d = Object.fromEntries(declarations(m[1]));
    const family = (d['font-family'] || '').replace(/^['"]|['"]$/g, '').trim();
    if (!family) continue;
    const srcs = [...(d.src || '').matchAll(/url\(\s*['"]?([^'")]+?)['"]?\s*\)(?:\s*format\(\s*['"]?([^'")]+)['"]?\s*\))?/gi)]
      .map((s) => ({ url: baseUrl ? safeUrl(s[1], baseUrl) : s[1], format: (s[2] || '').toLowerCase() })).filter((s) => s.url && !s.url.startsWith('data:'));
    faces.push({ family, weight: d['font-weight'] || '400', style: d['font-style'] || 'normal', range: d['unicode-range'] || '', srcs });
  }
  const fam = { heading: null, body: null, mono: null };
  for (const b of blocks(css)) {
    const sel = b.selector.toLowerCase();
    const ff = declarations(b.body).find(([k]) => k === 'font-family');
    if (!ff) continue;
    const f = firstFamily(ff[1], vars);
    if (!f) continue;
    if (/(^|[\s,])h1\b|(^|[\s,])h2\b|\.(display|heading|title)\b/.test(sel) && !fam.heading) fam.heading = f;
    else if (/(^|[\s,])(code|pre|kbd|samp)\b/.test(sel) && !fam.mono) fam.mono = f;
    else if (/(^|[\s,])(body|html|:root)\b/.test(sel) && !fam.body) fam.body = f;
  }
  for (const [k, v] of Object.entries(vars)) {
    const f = firstFamily(v, vars);
    if (!f || !/font|family|typeface/.test(k)) continue;
    if (/head|display|title/.test(k) && !fam.heading) fam.heading = f;
    else if (/mono|code/.test(k) && !fam.mono) fam.mono = f;
    else if (/body|text|sans|base|primary/.test(k) && !fam.body) fam.body = f;
  }
  return { vars, counts, named, faces, families: fam };
}

function safeUrl(u, base) { try { return new URL(u, base).href; } catch { return null; } }

export function mergeAnalyses(list) {
  const out = { vars: {}, counts: new Map(), named: { accents: [] }, faces: [], families: { heading: null, body: null, mono: null } };
  for (const a of list) {
    Object.assign(out.vars, a.vars);
    for (const [h, n] of a.counts) out.counts.set(h, (out.counts.get(h) || 0) + n);
    for (const k of ['primary', 'background', 'text']) if (!out.named[k] && a.named[k]) out.named[k] = a.named[k];
    for (const h of a.named.accents) if (!out.named.accents.includes(h)) out.named.accents.push(h);
    out.faces.push(...a.faces);
    for (const k of Object.keys(out.families)) if (!out.families[k] && a.families[k]) out.families[k] = a.families[k];
  }
  return out;
}

export function pickFontSource(faces, family) {
  const mine = faces.filter((f) => f.family.toLowerCase() === family.toLowerCase() && f.srcs.length);
  if (!mine.length) return null;
  const latin = mine.filter((f) => !f.range || /U\+0*(0000|0020|0041)|U\+0000-00FF/i.test(f.range));
  const pool = latin.length ? latin : mine;
  const rank = (s) => (/woff2/.test(s.format + s.url) ? 0 : /woff/.test(s.format + s.url) ? 1 : /tru|ttf|otf|open/.test(s.format + s.url) ? 2 : 3);
  const weights = [...new Set(pool.map((f) => String(f.weight).split(/\s+/)[0]).filter((w) => /^\d+$/.test(w)))].map(Number).sort((a, b) => a - b);
  const normal = pool.filter((f) => f.style === 'normal');
  const first = (normal.length ? normal : pool)[0];
  const src = [...first.srcs].sort((a, b) => rank(a) - rank(b))[0];
  return { url: src.url, weights: weights.length ? weights : [400] };
}
