// sagecut doctor: checks the set-up and prints the fix for each failure.
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { locate, run as ff } from '../core/ffmpeg.mjs';
import { loadSageEnv, maskKey, KEY_PAGE } from '../core/env.mjs';
import { SageClient } from '../core/sage.mjs';
import { createOcr } from '../core/ocr.mjs';
import { loadBrand } from '../core/brand.mjs';
import { validateSchedule } from '../core/schedule.mjs';
import { VERSION } from '../core/version.mjs';

export const help = 'check Node, ffmpeg, the Sage key and server, OCR, brand and schedule';

export async function checks(ctx) {
  const out = [];
  const add = (name, status, detail, fix) => out.push({ name, status, detail, ...(fix ? { fix } : {}) });
  const root = ctx.root;

  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 18) add('node', 'pass', `Node ${process.versions.node}`);
  else add('node', 'fail', `Node ${process.versions.node}`, 'Install Node 18 or later: https://nodejs.org');

  try {
    const t = locate(root);
    const v = await ff('ffmpeg', ['-hide_banner', '-version'], { root });
    const p = await ff('ffprobe', ['-hide_banner', '-version'], { root });
    if (v.code === 0 && p.code === 0) {
      const ver = (v.stdout.toString().match(/ffmpeg version (\S+)/) || [])[1] || '?';
      if (t.source.startsWith('remotion:')) add('ffmpeg', 'pass', `ffmpeg ${ver} and ffprobe (source: ${t.source})`);
      else add('ffmpeg', 'warn', `ffmpeg ${ver} and ffprobe (source: ${t.source})`, "using a system ffmpeg; in your Remotion project run npm install so SageCut uses Remotion's bundled ffmpeg");
    } else add('ffmpeg', 'fail', 'ffmpeg or ffprobe did not run', 'Run "npm install" in your Remotion project (it installs @remotion/compositor-*), or set SAGECUT_FFMPEG and SAGECUT_FFPROBE.');
  } catch (e) {
    add('ffmpeg', 'fail', e.message.split('\n')[0], 'Run "npm install" in your Remotion project (it installs @remotion/compositor-*), or set SAGECUT_FFMPEG and SAGECUT_FFPROBE.');
  }

  const env = loadSageEnv(root);
  if (env.hasKey) add('sage key', 'pass', `SAGE_API_KEY present (${maskKey(env.key)})`);
  else add('sage key', 'fail', 'SAGE_API_KEY not found', `Make a key at ${KEY_PAGE}, then put SAGE_API_KEY=... in your project's .env file.`);

  const client = new SageClient({ root });
  const rd = await client.ready();
  if (rd.ok) add('sage server', 'pass', `${env.endpoint}/ready answered 200`);
  else add('sage server', 'fail', `${env.endpoint}/ready ${rd.status ? 'answered ' + rd.status : 'did not answer'}`, 'Check your network and SAGE_ENDPOINT. If this persists, see sagecut/qa/reference/troubleshooting.md.');

  if (env.hasKey && rd.ok) {
    try {
      await client.post('/usage/estimate', { requests: [{ content: 'SageCut doctor check', questions: [{ id: 'q', kind: 'yesno', instructions: 'Is this text a test?' }] }] }, 1);
      add('sage key check', 'pass', 'the server accepted the key (POST /usage/estimate answered 200)');
    } catch (e) {
      if (/rejected the key/.test(e.message)) add('sage key check', 'fail', 'the server rejected the key', `the server rejected the key: check SAGE_API_KEY in .env, make a key at ${KEY_PAGE}`);
      else add('sage key check', 'warn', `could not check the key: ${e.message.replace(env.key, '(key)').split('\n')[0].slice(0, 160)}`, 'Run "sagecut doctor" again; if it persists see sagecut/qa/reference/troubleshooting.md.');
    }
  }

  try { const o = await createOcr(); await o.close(); add('ocr', 'pass', 'tesseract.js ready (local language data)'); }
  catch (e) { add('ocr', 'fail', e.message.split('\n')[0], 'Reinstall the plugin: assets/eng.traineddata or bin/ocr/ is missing.'); }

  if (fs.existsSync(ctx.config.brandPath)) {
    try { const b = loadBrand(ctx.config.brandPath); add('brand', 'pass', `brand "${b.name}" (${ctx.config.brand})`); }
    catch (e) { add('brand', 'fail', e.message, 'Fix the listed fields, then run "sagecut brand set sagecut/brand.yaml".'); }
  } else add('brand', 'warn', `no brand file at ${ctx.config.brand}`, 'Run /sagecut:start, or "sagecut brand from-url <URL>".');

  if (fs.existsSync(ctx.config.schedulePath)) {
    try {
      const errs = validateSchedule(JSON.parse(fs.readFileSync(ctx.config.schedulePath, 'utf8')));
      if (errs.length) add('schedule', 'fail', `${errs.length} error(s): ${errs[0]}`, 'Run "sagecut check-schedule" for the full list.');
      else add('schedule', 'pass', ctx.config.schedule);
    } catch (e) { add('schedule', 'fail', e.message, 'Fix the JSON in the schedule file.'); }
  } else add('schedule', 'warn', `no schedule at ${ctx.config.schedule}`, 'Run "sagecut init".');
  return out;
}

export async function run(argv, ctx) {
  const { values } = parseArgs({ args: argv, options: { json: { type: 'boolean' }, root: { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help) { console.log('usage: sagecut doctor [--json]'); return 0; }
  const results = await checks(ctx);
  const failed = results.some((r) => r.status === 'fail');
  if (values.json) { console.log(JSON.stringify({ version: VERSION, ok: !failed, checks: results }, null, 1)); return failed ? 1 : 0; }
  console.log(`sagecut ${VERSION} doctor (project: ${ctx.root})`);
  const mark = { pass: 'PASS', fail: 'FAIL', warn: 'WARN' };
  for (const r of results) {
    console.log(`${mark[r.status]}  ${r.name.padEnd(12)} ${r.detail}`);
    if (r.fix && r.status !== 'pass') console.log(`      fix: ${r.fix}`);
  }
  return failed ? 1 : 0;
}
