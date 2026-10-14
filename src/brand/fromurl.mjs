// brand from-url: fetch the page, up to 10 linked CSS files (5 MB in all), and read colours, fonts and logo candidates.
import fs from 'node:fs';
import path from 'node:path';
import { analyseCss, mergeAnalyses, pickFontSource, firstFamily } from './css.mjs';
import { assignRoles, parseColor } from './color.mjs';
import { VERSION } from '../core/version.mjs';

export const UA = `Mozilla/5.0 (compatible; SageCut/${VERSION}; +https://github.com/levantolabs/sagecut)`;
const CAP_BYTES = 5 * 1024 * 1024;
const MAX_CSS = 10;

export async function fetchLimited(url, budget, { binary = false, ua = UA, timeoutMs = 20000 } = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': ua, Accept: binary ? '*/*' : 'text/html,text/css,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const chunks = []; let n = 0;
  for await (const c of res.body) {
    n += c.length; budget.used += c.length;
    if (budget.used > budget.cap) throw new Error(`more than ${(budget.cap / 1048576).toFixed(0)} MB of data from ${url}`);
    chunks.push(c);
  }
  const buf = Buffer.concat(chunks);
  return { buf, text: binary ? null : buf.toString('utf8'), type: res.headers.get('content-type') || '', url: res.url };
}

const abs = (u, base) => { try { return new URL(u.replace(/&amp;/g, '&'), base).href; } catch { return null; } };
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')); return m ? (m[2] ?? m[3] ?? m[4]) : null; };

export function findLogos(html, base) {
  const cands = [];
  const regions = [...html.matchAll(/<(header|nav)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => m[2]);
  for (const r of regions) {
    for (const m of r.matchAll(/<svg\b[\s\S]*?<\/svg>/gi)) {
      if (m[0].length > 40000 || m[0].length < 120) continue;
      const hint = /logo|brand|wordmark/i.test(m[0].slice(0, 300));
      cands.push({ kind: 'inline-svg', svg: m[0], score: 90 + (hint ? 10 : 0) });
      break;
    }
    for (const m of r.matchAll(/<img\b[^>]*>/gi)) {
      const src = attr(m[0], 'src');
      if (!src || src.startsWith('data:')) continue;
      const hint = /logo|brand|wordmark/i.test(m[0]);
      cands.push({ kind: 'img', url: abs(src, base), score: (hint ? 95 : 60) - (/white|reverse|dark|inverse/i.test(src) ? 20 : 0) });
    }
  }
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = (attr(m[0], 'rel') || '').toLowerCase(); const href = attr(m[0], 'href');
    if (!href || !/icon|mask-icon/.test(rel)) continue;
    const u = abs(href, base);
    if (!u || u.startsWith('data:')) continue;
    const svg = /\.svg(\?|$)/i.test(u);
    cands.push({ kind: rel.includes('apple') ? 'apple-touch-icon' : 'icon', url: u, score: svg ? 80 : rel.includes('apple') ? 55 : 30 });
  }
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const p = (attr(m[0], 'property') || attr(m[0], 'name') || '').toLowerCase();
    if (p === 'og:image' || p === 'og:image:url') { const u = abs(attr(m[0], 'content') || '', base); if (u) cands.push({ kind: 'og:image', url: u, score: 40 }); }
  }
  const seen = new Set();
  return cands.filter((c) => { const k = c.url || c.svg.slice(0, 200); if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => b.score - a.score);
}

function metaContent(html, name) {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    if ((attr(m[0], 'name') || attr(m[0], 'property') || '').toLowerCase() === name) return attr(m[0], 'content');
  }
  return null;
}

export async function brandFromUrl(urlStr, { root, log = () => {} }) {
  let u;
  try { u = new URL(/^https?:\/\//i.test(urlStr) ? urlStr : `https://${urlStr}`); } catch { throw new Error(`"${urlStr}" is not a URL. Example: https://example.com`); }
  const budget = { used: 0, cap: CAP_BYTES };
  const page = await fetchLimited(u.href, budget);
  const html = page.text;
  const base = page.url;
  const warnings = [];

  const cssTexts = [];
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) cssTexts.push({ text: m[1], base });
  const links = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = (attr(m[0], 'rel') || '').toLowerCase(); const href = attr(m[0], 'href');
    if (href && rel.includes('stylesheet')) { const a = abs(href, base); if (a) links.push(a); }
  }
  const queue = [...new Set(links)]; let fetched = 0;
  while (queue.length && fetched < MAX_CSS) {
    const cu = queue.shift(); fetched++;
    try {
      const r = await fetchLimited(cu, budget, { ua: /fonts\.googleapis\.com/.test(cu) ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' : UA });
      cssTexts.push({ text: r.text, base: r.url });
      for (const im of r.text.matchAll(/@import\s+(?:url\()?['"]?([^'")\s;]+)/gi)) { const a = abs(im[1], r.url); if (a && !links.includes(a) && fetched + queue.length < MAX_CSS) { links.push(a); queue.push(a); } }
    } catch (e) { warnings.push(`could not read ${cu}: ${e.message}`); if (/more than/.test(e.message)) break; }
  }
  // inline style attributes (small sites)
  const inlineStyles = [...html.matchAll(/\bstyle\s*=\s*"([^"]*)"/gi)].map((m) => `x{${m[1]}}`).join('\n');
  if (inlineStyles) cssTexts.push({ text: inlineStyles, base });

  const merged = mergeAnalyses(cssTexts.map((c) => analyseCss(c.text, c.base)));
  const themeRaw = metaContent(html, 'theme-color');
  const theme = parseColor(themeRaw);
  const roles = assignRoles({ counts: merged.counts, named: merged.named, theme });
  if (!roles.primary) roles.primary = roles.text;

  // fonts
  const fam = merged.families;
  const gf = [...links.filter((l) => /fonts\.googleapis\.com/.test(l))].flatMap((l) => { try { return new URL(l).searchParams.getAll('family').map((f) => f.split(':')[0].replace(/\+/g, ' ')); } catch { return []; } });
  if (!fam.body) fam.body = gf[0] || firstFamily([...merged.faces.map((f) => f.family)].join(',')) || null;
  if (!fam.heading) fam.heading = fam.body;
  const fonts = {};
  for (const [role, family] of Object.entries(fam)) {
    if (!family) continue;
    const src = pickFontSource(merged.faces, family);
    fonts[role] = { family, weights: src ? src.weights : [400, 700], ...(src ? { url: src.url } : {}) };
  }

  const name = (metaContent(html, 'og:site_name') || (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || u.hostname.replace(/^www\./, '')).trim().split(/\s*[|–—-]\s*/)[0].slice(0, 60) || u.hostname;

  // logos
  const cands = findLogos(html, base);
  const assetsDir = path.join(root, 'sagecut', 'brand-assets');
  const logoFiles = []; const logoNotes = [];
  for (const c of cands.slice(0, 4)) {
    if (logoFiles.length >= 2) break;
    try {
      fs.mkdirSync(assetsDir, { recursive: true });
      if (c.kind === 'inline-svg') {
        let svg = c.svg; if (!/xmlns=/.test(svg.slice(0, 300))) svg = svg.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
        const f = path.join(assetsDir, `logo-inline-${logoFiles.length + 1}.svg`); fs.writeFileSync(f, svg);
        logoFiles.push(path.relative(root, f).split(path.sep).join('/')); logoNotes.push(`${c.kind} in the page header`);
      } else {
        const r = await fetchLimited(c.url, budget, { binary: true });
        if (r.type.includes('text/html')) continue;
        const ext = (path.extname(new URL(c.url).pathname) || (r.type.includes('svg') ? '.svg' : r.type.includes('png') ? '.png' : r.type.includes('jpeg') ? '.jpg' : r.type.includes('webp') ? '.webp' : '.ico')).toLowerCase();
        const f = path.join(assetsDir, `logo-${c.kind.replace(/[^a-z]/g, '')}-${logoFiles.length + 1}${ext}`); fs.writeFileSync(f, r.buf);
        logoFiles.push(path.relative(root, f).split(path.sep).join('/')); logoNotes.push(`${c.kind}: ${c.url}`);
      }
    } catch (e) { warnings.push(`logo ${c.kind}: ${e.message}`); }
  }

  const draft = {
    name,
    colors: { background: roles.background, text: roles.text, primary: roles.primary, accent: roles.accent, allowed: roles.allowed },
    fonts,
    logo: { files: logoFiles, min_px: 48, clear_space: 0.5 },
    type: {},
    motion: { style: 'restrained', designed: [] },
    copy: { case: 'sentence', avoid: [], grammar: 'proper' },
    format: '16:9',
    source: { kind: 'website', ref: u.href },
  };
  const found = { colours: merged.counts.size, fonts: Object.keys(fonts).length, logos: logoFiles.length };
  return { draft, found, logoNotes, warnings, cssFiles: fetched, bytes: budget.used, theme: themeRaw || null };
}
