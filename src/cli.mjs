#!/usr/bin/env node
// sagecut <command> [args]. Each command is src/commands/<name>.mjs exporting
import { findProjectRoot } from './core/paths.mjs';
import { loadConfig } from './core/config.mjs';
import { VERSION } from './core/version.mjs';

import * as doctor from './commands/doctor.mjs';
import * as init from './commands/init.mjs';
import * as brand from './commands/brand.mjs';
import * as checkSchedule from './commands/check-schedule.mjs';
import * as gate from './commands/gate.mjs';
import * as sweep from './commands/sweep.mjs';
import * as triage from './commands/triage.mjs';
import * as ask from './commands/ask.mjs';
import * as baseline from './commands/baseline.mjs';
import * as numbers from './commands/numbers.mjs';
import * as deliverCheck from './commands/deliver-check.mjs';
import * as splice from './commands/splice.mjs';
import * as onboard from './commands/onboard.mjs';
import * as savings from './commands/savings.mjs';

const COMMANDS = {
  doctor, init, brand, 'check-schedule': checkSchedule, gate, sweep, triage, ask, baseline, numbers,
  'deliver-check': deliverCheck, splice, onboard, savings,
};

function usage() {
  const lines = Object.entries(COMMANDS).map(([k, m]) => `  ${k.padEnd(15)} ${m.help || ''}`);
  return `sagecut ${VERSION}: video QA for Remotion with the Sage decision model\n\nusage: sagecut <command> [options]\n\n${lines.join('\n')}\n\nsagecut <command> --help for the options of one command.`;
}

async function main() {
  const [cmd, ...argv] = process.argv.slice(2);
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') { console.log(usage()); return 0; }
  if (cmd === '--version' || cmd === '-v') { console.log(VERSION); return 0; }
  const mod = COMMANDS[cmd];
  if (!mod) { console.error(`unknown command "${cmd}"\n\n${usage()}`); return 2; }
  const rootArg = argv.indexOf('--root');
  const root = findProjectRoot(rootArg >= 0 ? argv[rootArg + 1] : process.cwd());
  const config = loadConfig(root);
  return mod.run(argv, { root, config });
}

main().then((code) => { process.exitCode = code ?? 0; }).catch((e) => {
  console.error(`sagecut: ${e.message}`);
  if (process.env.SAGECUT_DEBUG) console.error(e.stack);
  process.exitCode = 2;
});
