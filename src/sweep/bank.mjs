// The question bank. Default: assets/bank/sweep-default.json (generic wording; no film or scene names).
import fs from 'node:fs';
import path from 'node:path';
import { pluginRoot } from '../core/paths.mjs';

export function loadBank(config) {
  const base = JSON.parse(fs.readFileSync(path.join(pluginRoot(), 'assets', 'bank', 'sweep-default.json'), 'utf8'));
  if (!config || !config.question_bank) return base;
  const file = path.resolve(config.root || process.cwd(), config.question_bank);
  let mine;
  try { mine = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { throw new Error(`question bank ${file}: ${e.message}`); }
  if (!mine.problems && !mine.legible && !mine.triage && !mine.pmin) mine = { problems: mine };
  return {
    problems: mine.problems || base.problems,
    legible: mine.legible || base.legible,
    pmin: mine.pmin ?? base.pmin,
    triage: { ...base.triage, ...(mine.triage || {}) },
  };
}

export const badAnswer = (qid) => (qid === 'legible' ? 'no' : 'yes');

export function isProblem(answer, p, bad, pmin) {
  if (answer == null || p == null) return false;
  return bad === 'yes' ? answer === 'yes' && p >= pmin : answer === 'no' && 1 - p >= pmin;
}
