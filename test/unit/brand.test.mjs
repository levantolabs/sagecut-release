import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import YAML from 'yaml';
import { parseColor, assignRoles } from '../../src/brand/color.mjs';
import { analyseCss, pickFontSource } from '../../src/brand/css.mjs';
import { brandFromUrl, findLogos } from '../../src/brand/fromurl.mjs';
import { brandFromFolder, sfntNames } from '../../src/brand/fromfolder.mjs';
import { setBrand, brandTs } from '../../src/brand/write.mjs';
import { validateBrand } from '../../src/core/brand.mjs';
import * as brandCmd from '../../src/commands/brand.mjs';
import { loadConfig } from '../../src/core/config.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sagecut-test-brand-'));
process.env.SAGECUT_HOME = path.join(tmp, 'home');
const mk = (n) => { const d = path.join(tmp, n); fs.mkdirSync(d, { recursive: true }); return d; };

test('colour parsing', () => {
  assert.equal(parseColor('#FFF'), '#ffffff');
  assert.equal(parseColor('#1438D4'), '#1438d4');
  assert.equal(parseColor('rgb(20, 56, 212)'), '#1438d4');
  assert.equal(parseColor('rgb(20 56 212 / 90%)'), '#1438d4');
  assert.equal(parseColor('hsl(0, 100%, 50%)'), '#ff0000');
  assert.equal(parseColor('rgba(0,0,0,0.1)'), null);
  assert.equal(parseColor('red'), null);
});

const CSS = `
:root { --color-primary: #1438D4; --color-bg: #F4F0E5; --color-text: #101010; --font-heading: "Playfair Display", serif; --accent: rgb(255, 120, 0); }
body { background-color: var(--color-bg); color: var(--color-text); font-family: "Geist", system-ui, sans-serif; }
h1, h2 { font-family: var(--font-heading); }
code { font-family: "Geist Mono", monospace; }
.btn { background: #1438D4; color: #fff; } .tag { color: #1438d4 }
@font-face { font-family: "Geist"; src: url(/fonts/geist.woff2) format("woff2"), url(/fonts/geist.ttf) format("truetype"); font-weight: 400; }
@font-face { font-family: "Geist"; src: url(/fonts/geist-700.woff2) format("woff2"); font-weight: 700; }
`;

test('css analysis finds tokens, fonts and sources', () => {
  const a = analyseCss(CSS, 'https://example.test/');
  assert.equal(a.named.primary, '#1438d4');
  assert.equal(a.families.heading, 'Playfair Display');
  assert.equal(a.families.body, 'Geist');
  assert.equal(a.families.mono, 'Geist Mono');
  const src = pickFontSource(a.faces, 'Geist');
  assert.equal(src.url, 'https://example.test/fonts/geist.woff2');
  assert.deepEqual(src.weights, [400, 700]);
  const roles = assignRoles({ counts: a.counts, named: a.named });
  assert.equal(roles.primary, '#1438d4');
  assert.equal(roles.text, '#101010');
});

test('logo candidates rank an inline header svg first', () => {
  const html = `<html><head><link rel="icon" href="/favicon.ico"><meta property="og:image" content="/og.png"></head><body><header><a><svg viewBox="0 0 10 10" class="logo">${'<path d="M0 0L10 10"/>'.repeat(8)}</svg></a></header></body></html>`;
  const c = findLogos(html, 'https://example.test/');
  assert.equal(c[0].kind, 'inline-svg');
  assert.ok(c.some((x) => x.kind === 'og:image'));
});

test('brand from-url against a local site', async () => {
  const html = `<!doctype html><title>Acme Rockets | Home</title><meta name="theme-color" content="#1438d4"><link rel="stylesheet" href="/site.css"><link rel="icon" href="/icon.svg">
<header><a href="/"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" class="logo">${'<circle cx="5" cy="5" r="4"/>'.repeat(6)}</svg></a></header><h1>Hi</h1>`;
  const server = http.createServer((req, res) => {
    if (req.url === '/') { res.setHeader('content-type', 'text/html'); res.end(html); }
    else if (req.url === '/site.css') { res.setHeader('content-type', 'text/css'); res.end(CSS); }
    else if (req.url === '/icon.svg') { res.setHeader('content-type', 'image/svg+xml'); res.end('<svg xmlns="http://www.w3.org/2000/svg"/>'); }
    else { res.statusCode = 404; res.end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const root = mk('site');
    const r = await brandFromUrl(`http://127.0.0.1:${server.address().port}/`, { root });
    assert.equal(r.draft.name, 'Acme Rockets');
    assert.equal(r.draft.colors.primary, '#1438d4');
    assert.equal(r.draft.colors.background, '#f4f0e5');
    assert.equal(r.draft.fonts.heading.family, 'Playfair Display');
    assert.match(r.draft.fonts.body.url, /\/fonts\/geist\.woff2$/);
    assert.equal(r.draft.source.kind, 'website');
    assert.ok(fs.existsSync(path.join(root, r.draft.logo.files[0])));
    assert.deepEqual(validateBrand(r.draft), []);
  } finally { server.close(); }
});

test('brand from-folder reads css, guide text, logo and fonts', () => {
  const dir = mk('kit');
  fs.writeFileSync(path.join(dir, 'tokens.css'), ':root{--brand-primary:#c8102e;}');
  fs.writeFileSync(path.join(dir, 'guide.md'), 'Background: #FAFAFA\nText: #111111\nHeading font: Space Grotesk\nAvoid: synergy, leverage\n');
  fs.writeFileSync(path.join(dir, 'logo.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>`);
  fs.writeFileSync(path.join(dir, 'SpaceGrotesk-Bold.woff2'), Buffer.from('wOF2fake'));
  const root = mk('kitproj');
  const r = brandFromFolder(dir, { root });
  assert.equal(r.draft.colors.primary, '#c8102e');
  assert.equal(r.draft.colors.background, '#fafafa');
  assert.equal(r.draft.fonts.heading.family, 'Space Grotesk');
  assert.deepEqual(r.draft.copy.avoid, ['synergy', 'leverage']);
  assert.equal(r.draft.logo.files.length, 1);
  assert.ok(r.draft.fonts.heading.file.endsWith('SpaceGrotesk-Bold.woff2'));
  assert.equal(r.draft.source.kind, 'folder');
});

test('sfnt name parsing on a system font when present', { skip: !fs.existsSync('/System/Library/Fonts/Supplemental/Arial.ttf') }, () => {
  const n = sfntNames(fs.readFileSync('/System/Library/Fonts/Supplemental/Arial.ttf'));
  assert.equal(n.family, 'Arial');
});

test('brand set copies fonts and logo, writes brand.yaml, brand.ts and the saved copy', async () => {
  const root = mk('setproj');
  fs.mkdirSync(path.join(root, 'assets'));
  fs.writeFileSync(path.join(root, 'assets', 'Display-Bold.woff2'), 'x');
  fs.writeFileSync(path.join(root, 'assets', 'mark.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const file = path.join(root, 'draft.yaml');
  fs.writeFileSync(file, YAML.stringify({
    name: 'Acme Rockets', colors: { background: '#f4f0e5', text: '#101010', primary: '#1438d4', accent: ['#ff7800'], allowed: [] },
    fonts: { heading: { family: 'Display', file: 'assets/Display-Bold.woff2', weights: [700] }, body: { family: 'Display', file: 'assets/Display-Bold.woff2', weights: [700] } },
    logo: { files: ['assets/mark.svg'] }, motion: { style: 'restrained' }, format: '16:9',
  }));
  const msgs = [];
  const { saved } = await setBrand(file, { root, log: (m) => msgs.push(m) });
  assert.ok(fs.existsSync(path.join(root, 'public', 'fonts', 'Display-Bold.woff2')));
  assert.ok(fs.existsSync(path.join(root, 'public', 'brand', 'mark.svg')));
  assert.ok(fs.existsSync(path.join(root, 'sagecut', 'brand.yaml')));
  assert.ok(fs.existsSync(saved));
  const ts = fs.readFileSync(path.join(root, 'src', 'brand.ts'), 'utf8');
  assert.match(ts, /primary: "#1438d4"/);
  assert.match(ts, /staticFile\("fonts\/Display-Bold\.woff2"\)/);
  assert.match(ts, /loadBrandFonts/);
  // use + list + show through the command
  const ctx = { root, config: loadConfig(root) };
  const out = []; const orig = console.log; console.log = (...a) => out.push(a.join(' '));
  try {
    assert.equal(await brandCmd.run(['list', '--json'], ctx), 0);
    assert.deepEqual(JSON.parse(out.pop()), ['acme-rockets']);
    assert.equal(await brandCmd.run(['show'], ctx), 0);
    assert.match(out.pop(), /name:\s+Acme Rockets/);
    const root2 = mk('useproj');
    assert.equal(await brandCmd.run(['use', 'Acme Rockets'], { root: root2, config: loadConfig(root2) }), 0);
    assert.ok(fs.existsSync(path.join(root2, 'src', 'brand.ts')));
  } finally { console.log = orig; }
});

test('brand set rejects an invalid brand with the list of errors', async () => {
  const root = mk('badproj');
  const file = path.join(root, 'bad.yaml');
  fs.writeFileSync(file, YAML.stringify({ name: 'X', colors: { background: 'white', text: '#000000', primary: '#111111' }, fonts: {} }));
  await assert.rejects(() => setBrand(file, { root }), /colors\.background|fonts\.heading/);
  assert.ok(typeof brandTs === 'function');
});

test('cleanup', () => { fs.rmSync(tmp, { recursive: true, force: true }); });
