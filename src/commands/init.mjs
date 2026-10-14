// sagecut init: adds the sagecut/ folder, the schedule hook file and the ignore lines. Never overwrites a file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { pluginRoot, sagecutDir, metricsDir, ensureDir } from '../core/paths.mjs';
import { say } from '../core/log.mjs';

export const help = 'add sagecut/, the schedule skeleton and src/sagecut/useSchedule.ts to a Remotion project';

function templateDir() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const d of [path.join(pluginRoot(), 'templates'), path.join(here, '..', 'templates'), path.join(here, '..', '..', 'templates')]) {
    if (fs.existsSync(path.join(d, 'useSchedule.ts'))) return d;
  }
  throw new Error('SageCut templates not found. Reinstall the plugin.');
}

export async function run(argv, ctx) {
  const { values } = parseArgs({ args: argv, options: {
    composition: { type: 'string' }, fps: { type: 'string' }, frames: { type: 'string' }, width: { type: 'string' }, height: { type: 'string' },
    root: { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help) { say('usage: sagecut init [--composition ID] [--fps N --frames N --width W --height H]'); return 0; }
  const root = ctx.root;
  const tpl = templateDir();
  const created = []; const kept = [];
  const writeNew = (file, content) => {
    if (fs.existsSync(file)) { kept.push(path.relative(root, file)); return; }
    ensureDir(path.dirname(file));
    fs.writeFileSync(file, content);
    created.push(path.relative(root, file));
  };
  const num = (v, d) => { const n = Number(v); return v !== undefined && Number.isFinite(n) && n > 0 ? n : d; };
  const fps = num(values.fps, 30), frames = num(values.frames, 300), width = num(values.width, 1920), height = num(values.height, 1080);
  const composition = values.composition || 'Main';

  writeNew(path.join(sagecutDir(root), 'sagecut.yaml'),
    fs.readFileSync(path.join(tpl, 'sagecut.yaml'), 'utf8').replace('__COMPOSITION__', composition).replace(/^# composition: .*$/m, `composition: ${composition}`));
  writeNew(path.join(sagecutDir(root), 'schedule.json'), JSON.stringify({
    film: composition, fps, frames, width, height, safe_margin_px: Math.round(width * 0.05),
    _help: 'Element role (optional): headline | body | caption | url sets the legibility floor. effects: designed effects, { kind: "flash" | "glitch", frames: [first, last] }; the brand motion.designed list only skips findings inside declared cuts, transitions and effects. static_holds: [[first, last]] declares holds longer than 1.5 s.',
    beats: [{ id: 'intro', start: 0, end: frames, elements: [{ id: 'title', in: 0, out: frames, text: 'Your title', role: 'headline' }] }],
    transitions: [],
    effects: [],
  }, null, 2) + '\n');
  ensureDir(metricsDir(root));
  writeNew(path.join(root, 'src', 'sagecut', 'useSchedule.ts'), fs.readFileSync(path.join(tpl, 'useSchedule.ts'), 'utf8'));
  writeNew(path.join(root, '.env.example'), fs.readFileSync(path.join(tpl, 'env.example'), 'utf8'));

  // .gitignore: append the lines that are missing.
  const gi = path.join(root, '.gitignore');
  const have = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
  const want = ['.env', 'sagecut/qa/*/raw/'].filter((l) => !have.split(/\r?\n/).some((x) => x.trim() === l));
  if (want.length) {
    fs.writeFileSync(gi, have + (have && !have.endsWith('\n') ? '\n' : '') + want.join('\n') + '\n');
    created.push(`.gitignore (+${want.join(', ')})`);
  } else kept.push('.gitignore');

  if (created.length) say(`Created:\n${created.map((x) => `  ${x}`).join('\n')}`);
  if (kept.length) say(`Kept (already there):\n${kept.map((x) => `  ${x}`).join('\n')}`);
  say('The schedule has a "_help" line that explains element role, effects and static_holds. Delete it when you no longer need it.');
  say('Next: set "resolveJsonModule": true in tsconfig.json, edit sagecut/schedule.json, and import { useBeat, Scheduled } from "./sagecut/useSchedule" in your composition.');
  return 0;
}
