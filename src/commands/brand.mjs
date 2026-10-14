// sagecut brand from-url | from-folder | set | use | show | list
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import YAML from 'yaml';
import { sagecutDir, userDataDir, ensureDir } from '../core/paths.mjs';
import { loadBrand } from '../core/brand.mjs';
import { say } from '../core/log.mjs';
import { brandFromUrl } from '../brand/fromurl.mjs';
import { brandFromFolder } from '../brand/fromfolder.mjs';
import { setBrand, slug } from '../brand/write.mjs';

export const help = 'make or load the brand: from-url | from-folder | set | use | show | list';

const USAGE = `usage: sagecut brand from-url <URL>
       sagecut brand from-folder <PATH>
       sagecut brand set <FILE.yaml|FILE.json>
       sagecut brand use <NAME>
       sagecut brand show [--json]
       sagecut brand list [--json]`;

function summary(b) {
  const c = b.colors;
  const lines = [`name:       ${b.name}`, `background: ${c.background}   text: ${c.text}   primary: ${c.primary}`];
  if ((c.accent || []).length) lines.push(`accent:     ${c.accent.join(' ')}`);
  if ((c.allowed || []).length) lines.push(`allowed:    ${c.allowed.join(' ')}`);
  for (const r of ['heading', 'body', 'mono']) if (b.fonts && b.fonts[r]) lines.push(`font ${r.padEnd(8)} ${b.fonts[r].family}${b.fonts[r].file ? ` (${b.fonts[r].file})` : b.fonts[r].url ? ' (web font file found)' : ' (no file: Google Fonts is tried on "brand set")'}`);
  lines.push(`logo:       ${(b.logo && b.logo.files && b.logo.files.length) ? b.logo.files.join(', ') : '(none found)'}`);
  lines.push(`motion:     ${(b.motion && b.motion.style) || 'restrained'}   format: ${b.format || '16:9'}`);
  return lines.join('\n');
}

function writeDraft(root, draft) {
  const f = path.join(sagecutDir(root), 'brand.draft.yaml');
  ensureDir(path.dirname(f));
  fs.writeFileSync(f, YAML.stringify(draft));
  return f;
}

export async function run(argv, ctx) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { json: { type: 'boolean' }, root: { type: 'string' }, help: { type: 'boolean' } } });
  const [sub, arg] = positionals;
  if (values.help || !sub) { say(USAGE); return values.help ? 0 : 2; }
  const root = ctx.root;

  if (sub === 'from-url') {
    if (!arg) { console.error('sagecut brand from-url: give a URL. Example: sagecut brand from-url https://example.com'); return 2; }
    const r = await brandFromUrl(arg, { root });
    for (const w of r.warnings) console.error(`note: ${w}`);
    if (!r.found.colours && !r.found.fonts && !r.found.logos) {
      console.log(`Found no colours, fonts or logo on ${arg}. The page may build its styles with JavaScript.`);
      console.log('Use "sagecut brand from-folder <PATH>" with a brand kit folder, or answer the brand questions in /sagecut:start.');
      return 1;
    }
    const f = writeDraft(root, r.draft);
    console.log(summary(r.draft));
    r.logoNotes.forEach((n) => console.log(`logo source: ${n}`));
    // Say what was found and what was not read, so a partial result does not look complete.
    console.log(`\nCoverage: colours ${r.found.colours ? 'found' : 'none'}, fonts ${r.found.fonts ? 'found' : 'none'}, logos ${r.found.logos ? 'found' : 'none'}.`);
    if (!r.cssFiles) console.log('No stylesheet is linked from the page. Styles built by JavaScript are not read.');
    console.log('This reads static HTML and CSS only. Styles built by JavaScript are not read. A website gives no video format, so check the format yourself.');
    console.log(`Draft: ${path.relative(root, f)}  (${r.cssFiles} CSS file(s), ${(r.bytes / 1024).toFixed(0)} KB read)`);
    console.log('Confirm that you have the right to use these files before you use this brand. Then run "sagecut brand set sagecut/brand.draft.yaml".');
    return 0;
  }

  if (sub === 'from-folder') {
    if (!arg) { console.error('sagecut brand from-folder: give a folder path.'); return 2; }
    const r = brandFromFolder(arg, { root });
    for (const w of r.warnings) console.error(`note: ${w}`);
    if (!r.found.colours && !r.found.fonts && !r.found.logos) {
      console.log(`Found no colours, fonts or logo in ${arg} (${r.found.files} files read).`);
      console.log('Answer the brand questions in /sagecut:start instead, or point to a folder with logo, font, CSS or guide files.');
      return 1;
    }
    const f = writeDraft(root, r.draft);
    console.log(summary(r.draft));
    r.notes.forEach((n) => console.log(`read: ${n}`));
    console.log(`\nDraft: ${path.relative(root, f)}`);
    console.log('Confirm that you have the right to use these files before you use this brand. Then run "sagecut brand set sagecut/brand.draft.yaml".');
    return 0;
  }

  if (sub === 'set') {
    if (!arg) { console.error('sagecut brand set: give a brand file (.yaml or .json).'); return 2; }
    try { await setBrand(path.resolve(arg), { root, log: (m) => say(m) }); } catch (e) { console.error(`sagecut: ${e.message}`); return e.errors ? 1 : 2; }
    return 0;
  }

  if (sub === 'use') {
    if (!arg) { console.error('sagecut brand use: give a saved brand name. See "sagecut brand list".'); return 2; }
    const f = path.join(userDataDir(), 'brands', `${slug(arg)}.yaml`);
    if (!fs.existsSync(f)) { console.error(`No saved brand "${arg}" in ${path.dirname(f)}. See "sagecut brand list".`); return 2; }
    try { await setBrand(f, { root, log: (m) => say(m) }); } catch (e) { console.error(`sagecut: ${e.message}`); return 2; }
    return 0;
  }

  if (sub === 'show') {
    const b = loadBrand(ctx.config.brandPath);
    if (!b) { console.error('No brand file yet. Run /sagecut:start or "sagecut brand from-url <URL>".'); return 1; }
    say(values.json ? JSON.stringify(b, null, 1) : summary(b));
    return 0;
  }

  if (sub === 'list') {
    const dir = path.join(userDataDir(), 'brands');
    const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => x.endsWith('.yaml')).map((x) => path.basename(x, '.yaml')) : [];
    if (values.json) say(JSON.stringify(names)); else say(names.length ? names.join('\n') : 'No saved brands yet.');
    return 0;
  }

  console.error(`sagecut brand: unknown "${sub}".\n${USAGE}`);
  return 2;
}
