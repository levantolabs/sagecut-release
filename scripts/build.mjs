// Build the single-file tool: src/cli.mjs -> bin/sagecut.mjs, plus the OCR worker and core wasm in bin/ocr/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (...p) => path.join(ROOT, ...p);
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

const versions = { 'package.json': readJson(rel('package.json')).version };
versions['src/core/version.mjs'] = (fs.readFileSync(rel('src/core/version.mjs'), 'utf8').match(/VERSION\s*=\s*['"]([^'"]+)['"]/) || [])[1];
if (fs.existsSync(rel('.claude-plugin/plugin.json'))) versions['.claude-plugin/plugin.json'] = readJson(rel('.claude-plugin/plugin.json')).version;
if (new Set(Object.values(versions)).size !== 1) {
  console.error(`build: the versions do not agree: ${JSON.stringify(versions)}`);
  process.exit(2);
}

const { checkDocs } = await import('./check-docs.mjs');
const docErrors = await checkDocs(ROOT);
if (docErrors.length) {
  for (const e of docErrors) console.error(`build: ${e}`);
  process.exit(2);
}

const placeholders = [];
const placeholderPlugin = {
  name: 'placeholder-commands',
  setup(build) {
    build.onResolve({ filter: /^\.\/commands\/[\w-]+\.mjs$/ }, (args) => {
      const file = path.join(path.dirname(args.importer), args.path);
      if (fs.existsSync(file)) return null;
      placeholders.push(path.basename(file));
      return { path: file, namespace: 'placeholder' };
    });
    build.onLoad({ filter: /.*/, namespace: 'placeholder' }, (args) => {
      const name = path.basename(args.path, '.mjs');
      return { loader: 'js', contents: `export const help = '(not built yet)';
export async function run() { console.error('sagecut ${name}: this command is not in this build yet.'); return 2; }` };
    });
  },
};

fs.mkdirSync(rel('bin/ocr'), { recursive: true });

// 3. The tool.
const metas = [];
await esbuild.build({
  entryPoints: [rel('src/cli.mjs')],
  outfile: rel('bin/sagecut.mjs'),
  bundle: true, platform: 'node', format: 'esm', target: 'node18', legalComments: 'none',
  banner: { js: "#!/usr/bin/env node\nimport { createRequire as __sagecutCreateRequire } from 'node:module';\nconst require = __sagecutCreateRequire(import.meta.url);\nimport { fileURLToPath as __sagecutFtu } from 'node:url';\nimport { dirname as __sagecutDirname } from 'node:path';\nconst __filename = __sagecutFtu(import.meta.url);\nconst __dirname = __sagecutDirname(__filename);" },
  plugins: [placeholderPlugin],
  logLevel: 'warning', metafile: true,
}).then((r) => { metas.push(r.metafile); });
let tool = fs.readFileSync(rel('bin/sagecut.mjs'), 'utf8');
// keep one shebang (the source file has its own)
const lines = tool.split('\n');
const extra = lines.findIndex((l, i) => i > 0 && l.startsWith('#!'));
if (extra > 0) { lines.splice(extra, 1); tool = lines.join('\n'); fs.writeFileSync(rel('bin/sagecut.mjs'), tool); }
try { fs.chmodSync(rel('bin/sagecut.mjs'), 0o755); } catch { /* Windows */ }

await esbuild.build({
  entryPoints: [rel('node_modules/tesseract.js/src/worker-script/node/index.js')],
  outfile: rel('bin/ocr/worker.cjs'),
  bundle: true, platform: 'node', format: 'cjs', target: 'node18', legalComments: 'none', logLevel: 'warning',
  metafile: true,
  alias: {
    'tesseract.js-core/tesseract-core': 'tesseract.js-core/tesseract-core-lstm',
    'tesseract.js-core/tesseract-core-simd': 'tesseract.js-core/tesseract-core-simd-lstm',
    'tesseract.js-core/tesseract-core-relaxedsimd': 'tesseract.js-core/tesseract-core-relaxedsimd-lstm',
  },
}).then((r) => { metas.push(r.metafile); });
const core = rel('node_modules/tesseract.js-core');
for (const f of ['tesseract-core-lstm.wasm', 'tesseract-core-simd-lstm.wasm', 'tesseract-core-relaxedsimd-lstm.wasm']) {
  fs.copyFileSync(path.join(core, f), rel('bin/ocr', f));
}
fs.copyFileSync(rel('node_modules/tesseract.js/LICENSE.md'), rel('bin/ocr/LICENSE.tesseract.js.md'));

const size = (f) => (fs.statSync(f).size / 1024 / 1024).toFixed(2);
console.log(`build ok: version ${Object.values(versions)[0]}`);
console.log(`  bin/sagecut.mjs ${size(rel('bin/sagecut.mjs'))} MB`);
console.log(`  bin/ocr/ ${fs.readdirSync(rel('bin/ocr')).map((f) => `${f} ${size(rel('bin/ocr', f))} MB`).join(', ')}`);
console.log(`  assets/eng.traineddata ${size(rel('assets/eng.traineddata'))} MB`);
if (placeholders.length) console.log(`  PLACEHOLDERS (command file missing): ${[...new Set(placeholders)].join(', ')}`);

const pkgs = new Set();
for (const m of metas) for (const f of Object.keys(m.inputs)) {
  const hit = f.match(/^node_modules\/((?:@[^/]+\/)?[^/]+)\//);
  if (hit) pkgs.add(hit[1]);
}
pkgs.add('tesseract.js-core');
fs.mkdirSync(rel('bin/licenses'), { recursive: true });
const missing = [];
for (const name of [...pkgs].sort()) {
  const dir = rel('node_modules', name);
  const lic = fs.existsSync(dir) && fs.readdirSync(dir).find((f) => /^(licen[cs]e|copying)([-._].*)?$/i.test(f));
  if (lic) fs.copyFileSync(path.join(dir, lic), rel('bin/licenses', `${name.replace('/', '__')}.LICENSE.txt`));
  else missing.push(name);
}
fs.copyFileSync(rel('assets/LICENSE.tessdata_fast.txt'), rel('bin/licenses/tessdata_fast.LICENSE.txt'));
console.log(`  bin/licenses/: ${[...pkgs].sort().join(', ')}, tessdata_fast`);
if (missing.length) console.log(`  no licence file in the npm package (text is in THIRD_PARTY_NOTICES.md): ${missing.join(', ')}`);
if (!fs.existsSync(rel('THIRD_PARTY_NOTICES.md'))) console.log('  WARNING: THIRD_PARTY_NOTICES.md is missing');
