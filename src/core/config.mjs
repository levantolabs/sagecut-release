// sagecut/sagecut.yaml: per-project settings. Every key is optional.
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { sagecutDir } from './paths.mjs';

export const DEFAULTS = { schedule: 'sagecut/schedule.json', brand: 'sagecut/brand.yaml', plan: 'developer', workers: 4, test_width: null,
  question_bank: null, composition: null, audio: 'auto' };   // audio: auto | required | none (deliver-check)

export const TEST_WIDTH = { '16:9': 350, '9:16': 210, '1:1': 375 };

export function loadConfig(root) {
  const file = path.join(sagecutDir(root), 'sagecut.yaml');
  let cfg = {};
  if (fs.existsSync(file)) cfg = YAML.parse(fs.readFileSync(file, 'utf8')) || {};
  const out = { ...DEFAULTS, ...cfg, root, file };
  out.schedulePath = path.resolve(root, out.schedule);
  out.brandPath = path.resolve(root, out.brand);
  return out;
}
