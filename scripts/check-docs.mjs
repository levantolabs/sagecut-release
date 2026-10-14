// Checks that the docs, the manifests and the code agree. The build runs it, and it fails on any mismatch.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function checkDocs(root = HERE) {
  const errors = [];
  const rd = (f) => fs.readFileSync(path.join(root, f), 'utf8');
  const js = (f) => JSON.parse(rd(f));
  const meta = (f) => (rd(f).match(/^\s+version:\s*"([^"]+)"/m) || [])[1];

  // 1. one version everywhere
  const versions = {
    'package.json': js('package.json').version,
    'src/core/version.mjs': (rd('src/core/version.mjs').match(/VERSION\s*=\s*'([^']+)'/) || [])[1],
    '.claude-plugin/plugin.json': js('.claude-plugin/plugin.json').version,
    '.claude-plugin/marketplace.json': js('.claude-plugin/marketplace.json').plugins[0].version,
    'skills/start/SKILL.md': meta('skills/start/SKILL.md'),
    'skills/qa/SKILL.md': meta('skills/qa/SKILL.md'),
  };
  if (new Set(Object.values(versions)).size !== 1) errors.push(`versions differ: ${JSON.stringify(versions)}`);

  // 2. the critic count: three, everywhere
  for (const f of ['skills/start/SKILL.md', 'skills/qa/SKILL.md', 'README.md']) {
    if (/\b(two|2)\s+critics\b/i.test(rd(f))) errors.push(`${f} says two critics. The workflow uses three (craft, clarity, freshness).`);
  }

  // 3. the install address: one repo, from the plugin manifest
  const expected = js('.claude-plugin/plugin.json').repository.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
  for (const f of ['README.md', 'skills/start/SKILL.md', 'skills/qa/SKILL.md']) {
    for (const m of rd(f).matchAll(/(?:marketplace add|--marketplace) ([\w.-]+\/[\w.-]+)/g)) {
      if (m[1] !== expected) errors.push(`${f} installs from ${m[1]}. The repo is ${expected}.`);
    }
  }

  // 4. no repeated step number inside one section
  for (const f of ['skills/start/SKILL.md', 'skills/qa/SKILL.md']) {
    let section = '';
    const seen = new Set();
    rd(f).split('\n').forEach((line, i) => {
      if (/^#{1,4} /.test(line)) { section = line; seen.clear(); return; }
      const m = line.match(/^(\d+)\. /);
      if (!m) return;
      if (seen.has(m[1])) errors.push(`${f} line ${i + 1}: step ${m[1]} repeats in "${section.trim()}".`);
      seen.add(m[1]);
    });
  }

  // 5. the reference rate the docs quote is the one in the code
  const costs = await import(pathToFileURL(path.join(root, 'src/core/costs.mjs')).href);
  const H = costs.HOUSE_REVIEW;
  const quotes = [`$${H.usd_per_frame}`, `${H.seconds_per_frame} s`, `${H.frames_viewed.toLocaleString('en-US')} frame views (${H.distinct_frames} distinct frames)`, `$${H.usd}`, `${H.clock_hours} h`];
  for (const f of ['README.md', 'skills/start/SKILL.md', 'skills/qa/reference/cost-claims.md']) {
    for (const q of quotes) if (!rd(f).includes(q)) errors.push(`${f} does not quote "${q}" of the reference rate in src/core/costs.mjs.`);
  }
  for (const f of ['README.md', 'skills/start/SKILL.md', 'skills/qa/SKILL.md']) {
    if (/(?<!no )test video/i.test(rd(f))) errors.push(`${f} mentions a test video. SageCut has none.`);
  }

  // 6. the footage limit is stated where users read
  for (const f of ['README.md', 'skills/qa/SKILL.md']) {
    if (!/tested on motion graphics only/i.test(rd(f))) errors.push(`${f} does not state that SageCut is tested on motion graphics only.`);
  }
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = await checkDocs();
  if (errors.length) { for (const e of errors) console.error(`check-docs: ${e}`); process.exit(1); }
  console.log('check-docs: ok');
}
