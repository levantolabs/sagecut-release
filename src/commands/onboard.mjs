// sagecut onboard status|welcome|done: the onboarding state of this user (~/.sagecut/state.json).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { userDataDir, pluginRoot, sagecutDir } from '../core/paths.mjs';
import { loadSageEnv, KEY_PAGE } from '../core/env.mjs';
import { readJson, writeJson, say } from '../core/log.mjs';

export const help = 'onboarding state: status | welcome | done';

const stateFile = () => path.join(userDataDir(), 'state.json');
const FALLBACK = 'Welcome to SageCut, a way to produce Remotion videos faster and cheaper, with every frame checked by the Sage decision model.';

function isRemotionProject(root) {
  try {
    const p = readJson(path.join(root, 'package.json'));
    const deps = { ...(p.dependencies || {}), ...(p.devDependencies || {}) };
    return Boolean(deps.remotion || deps['@remotion/cli']);
  } catch { return false; }
}

export function status(root, config) {
  const state = readJson(stateFile(), {});
  return {
    onboarded: Boolean(state.onboarded),
    hasKey: loadSageEnv(root).hasKey,
    hasBrand: fs.existsSync(config ? config.brandPath : path.join(sagecutDir(root), 'brand.yaml')),
    hasSchedule: fs.existsSync(config ? config.schedulePath : path.join(sagecutDir(root), 'schedule.json')),
    isRemotionProject: isRemotionProject(root),
    keyPage: KEY_PAGE,
  };
}

function welcomeText() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const cands = [path.join(pluginRoot(), 'assets', 'welcome.txt'), path.join(here, '..', 'assets', 'welcome.txt'), path.join(here, '..', '..', 'assets', 'welcome.txt')];
  for (const f of cands) { try { return fs.readFileSync(f, 'utf8').replace(/\s+$/, ''); } catch { /* next */ } }
  return FALLBACK;
}

export async function run(argv, ctx) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { json: { type: 'boolean' }, root: { type: 'string' }, help: { type: 'boolean' } } });
  const sub = positionals[0];
  if (values.help || !sub) { say('usage: sagecut onboard status [--json] | welcome | done'); return values.help ? 0 : 2; }
  if (sub === 'status') {
    const s = status(ctx.root, ctx.config);
    if (values.json) say(JSON.stringify(s));
    else for (const [k, v] of Object.entries(s)) say(`${k.padEnd(18)} ${v}`);
    return 0;
  }
  if (sub === 'welcome') { say(welcomeText()); return 0; }
  if (sub === 'done') {
    const prev = readJson(stateFile(), {});
    writeJson(stateFile(), { ...prev, onboarded: true, onboardedAt: prev.onboardedAt || new Date().toISOString() });
    say('Onboarding finished.');
    return 0;
  }
  console.error(`sagecut onboard: unknown "${sub}". Use status, welcome or done.`);
  return 2;
}
