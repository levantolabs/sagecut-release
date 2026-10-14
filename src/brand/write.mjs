// brand set: validates a brand, fetches fonts, writes sagecut/brand.yaml, src/brand.ts and the saved copy.
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { validateBrand } from '../core/brand.mjs';
import { userDataDir, sagecutDir, ensureDir } from '../core/paths.mjs';
import { fetchLimited } from './fromurl.mjs';

const MODERN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'brand';
const safeFile = (s) => String(s).replace(/[^A-Za-z0-9._-]+/g, '-');

export function readBrandFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  return /\.json$/i.test(file) ? JSON.parse(text) : YAML.parse(text);
}

async function download(url, dest) {
  const r = await fetchLimited(url, { used: 0, cap: 20 * 1048576 }, { binary: true, ua: MODERN_UA });
  fs.writeFileSync(dest, r.buf);
}

// Google Fonts CSS2 API: the Latin file of each weight.
export async function googleFontFiles(family, weights) {
  const ws = [...new Set(weights.map(Number).filter(Boolean))].sort((a, b) => a - b);
  const spec = ws.length ? `:wght@${ws.join(';')}` : '';
  const u = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}${spec}&display=swap`;
  const r = await fetchLimited(u, { used: 0, cap: 2 * 1048576 }, { ua: MODERN_UA });
  const out = [];
  for (const m of r.text.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g)) {
    if (m[1] !== 'latin') continue;
    const w = (m[2].match(/font-weight:\s*(\d+)/) || [])[1];
    const url = (m[2].match(/url\(([^)]+)\)/) || [])[1];
    if (url && !/font-style:\s*italic/.test(m[2])) out.push({ weight: Number(w) || 400, url: url.replace(/['"]/g, '') });
  }
  if (!out.length) {   // a family with one file for every subset (no comments)
    for (const m of r.text.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
      const w = (m[1].match(/font-weight:\s*(\d+)/) || [])[1]; const url = (m[1].match(/url\(([^)]+)\)/) || [])[1];
      if (url) out.push({ weight: Number(w) || 400, url: url.replace(/['"]/g, '') });
    }
  }
  return out;
}

// Puts font files in public/fonts and sets fonts.<role>.file / .files. Returns a list of messages.
export async function installFonts(brand, { root, brandDir }) {
  const msgs = [];
  const outDir = ensureDir(path.join(root, 'public', 'fonts'));
  for (const role of ['heading', 'body', 'mono']) {
    const f = brand.fonts && brand.fonts[role];
    if (!f || !f.family) continue;
    const weights = (f.weights && f.weights.length ? f.weights : [400]).map(Number);
    const files = {};
    try {
      const local = f.file && [path.resolve(root, f.file), path.resolve(brandDir, f.file), path.resolve(root, 'public', f.file)].find((p) => fs.existsSync(p));
      if (local) {
        const dest = path.join(outDir, path.basename(local));
        if (path.resolve(local) !== path.resolve(dest)) fs.copyFileSync(local, dest);
        files[weights[0]] = `fonts/${path.basename(local)}`;
        msgs.push(`${role}: ${f.family} -> public/fonts/${path.basename(local)}`);
      } else if (f.url) {
        const ext = (path.extname(new URL(f.url).pathname) || '.woff2').toLowerCase();
        const name = `${safeFile(f.family)}-${weights[0]}${ext}`;
        await download(f.url, path.join(outDir, name));
        files[weights[0]] = `fonts/${name}`;
        msgs.push(`${role}: ${f.family} downloaded -> public/fonts/${name}`);
      } else {
        const got = await googleFontFiles(f.family, weights);
        if (!got.length) throw new Error('not found on Google Fonts');
        for (const g of got) {
          const ext = (path.extname(new URL(g.url).pathname) || '.woff2').toLowerCase();
          const name = `${safeFile(f.family)}-${g.weight}${ext}`;
          await download(g.url, path.join(outDir, name));
          files[g.weight] = `fonts/${name}`;
        }
        msgs.push(`${role}: ${f.family} from Google Fonts (${Object.keys(files).join(', ')}) -> public/fonts/`);
      }
      const first = Object.keys(files).map(Number).sort((a, b) => a - b)[0];
      f.file = files[first];
      f.files = files;
    } catch (e) {
      msgs.push(`WARNING ${role}: could not get ${f.family} (${e.message}). Add the font file to public/fonts/ and set fonts.${role}.file.`);
    }
  }
  return msgs;
}

function installLogos(brand, { root, brandDir }) {
  const msgs = []; const out = [];
  const dir = path.join(root, 'public', 'brand');
  for (const rel of (brand.logo && brand.logo.files) || []) {
    const src = [path.resolve(root, rel), path.resolve(brandDir, rel)].find((p) => fs.existsSync(p));
    if (!src) { msgs.push(`WARNING logo ${rel} not found`); continue; }
    ensureDir(dir);
    fs.copyFileSync(src, path.join(dir, path.basename(src)));
    out.push(`brand/${path.basename(src)}`);
  }
  if (out.length) msgs.push(`logo: ${out.join(', ')} -> public/brand/`);
  return { public: out, msgs };
}

export function brandTs(brand, logoPublic) {
  const q = (s) => JSON.stringify(s);
  const fonts = {};
  const faces = [];
  for (const role of ['heading', 'body', 'mono']) {
    const f = brand.fonts && brand.fonts[role];
    if (!f) continue;
    fonts[role] = f.family;
    for (const [w, file] of Object.entries(f.files || (f.file ? { [(f.weights || [400])[0]]: f.file } : {}))) {
      if (!faces.some((x) => x.family === f.family && x.file === file)) faces.push({ family: f.family, weight: String(w), file });
    }
  }
  const c = brand.colors;
  return `// Written by SageCut from sagecut/brand.yaml. Do not edit by hand: edit the brand file, then run "sagecut brand set sagecut/brand.yaml".
// Needs @remotion/fonts in the project: npx remotion add @remotion/fonts
import { staticFile } from 'remotion';
import { loadFont } from '@remotion/fonts';

export const BRAND_NAME = ${q(brand.name)};

export const colors = {
  background: ${q(c.background)},
  text: ${q(c.text)},
  primary: ${q(c.primary)},
  accent: ${q(c.accent || [])} as readonly string[],
  allowed: ${q(c.allowed || [])} as readonly string[],
} as const;

export const fonts = ${JSON.stringify(fonts, null, 2).replace(/"(\w+)":/g, '$1:')} as const;

export const type = ${JSON.stringify(brand.type || {})} as const;
export const motion = ${JSON.stringify(brand.motion || { style: 'restrained' })} as const;
export const copyRules = ${JSON.stringify(brand.copy || {})} as const;
export const format = ${q(brand.format || '16:9')};
export const logos: readonly string[] = [${logoPublic.map((l) => `staticFile(${q(l)})`).join(', ')}];

const FONT_FACES = [
${faces.map((f) => `  { family: ${q(f.family)}, weight: ${q(f.weight)}, url: staticFile(${q('' + f.file)}) },`).join('\n')}
];

// Load every brand font. Call it once and wait before the first frame renders:
//   const handle = delayRender(); loadBrandFonts().then(() => continueRender(handle));
export const loadBrandFonts = () => Promise.all(FONT_FACES.map((f) => loadFont(f)));
`;
}

export async function setBrand(file, { root, log = console.log }) {
  const brandDir = path.dirname(path.resolve(file));
  const brand = readBrandFile(file);
  const errors = validateBrand(brand);
  if (errors.length) { const e = new Error(`${file} is not a valid brand:\n  ${errors.join('\n  ')}`); e.errors = errors; throw e; }
  const msgs = [...await installFonts(brand, { root, brandDir })];
  const logos = installLogos(brand, { root, brandDir }); msgs.push(...logos.msgs);

  const dest = path.join(sagecutDir(root), 'brand.yaml');
  ensureDir(path.dirname(dest));
  fs.writeFileSync(dest, YAML.stringify(brand));
  ensureDir(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'brand.ts'), brandTs(brand, logos.public));
  const saved = path.join(ensureDir(path.join(userDataDir(), 'brands')), `${slug(brand.name)}.yaml`);
  fs.writeFileSync(saved, YAML.stringify(brand));
  msgs.push(`wrote sagecut/brand.yaml, src/brand.ts and ${saved}`);
  for (const m of msgs) log(m);
  return { brand, messages: msgs, saved };
}
