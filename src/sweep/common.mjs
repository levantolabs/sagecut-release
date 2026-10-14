// Shared by sweep, triage, ask: project context (schedule, brand, test width) and small helpers.
import fs from 'node:fs';
import path from 'node:path';
import { loadSchedule } from '../core/schedule.mjs';
import { loadBrand, brandPalette, designedEffects } from '../core/brand.mjs';
import { TEST_WIDTH } from '../core/config.mjs';
import { warn } from '../core/log.mjs';

export function loadContext(config) {
  let schedule = null; let brand = null;
  if (fs.existsSync(config.schedulePath)) {
    try { schedule = loadSchedule(config.schedulePath); } catch (e) { warn(`sagecut: schedule not used: ${e.message.split('\n')[0]}`); }
  }
  try { brand = loadBrand(config.brandPath); } catch (e) { warn(`sagecut: brand not used: ${e.message}`); }
  const testWidth = Number(config.test_width) || (brand && TEST_WIDTH[brand.format]) || 350;
  return { schedule, brand, testWidth, palette: brandPalette(brand), designed: designedEffects(brand) };
}

export const num = (v, d) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));

// "120-340" -> [120, 340]
export function parseRange(s, frames) {
  if (!s) return [0, frames - 1];
  const m = /^(\d+)-(\d+)$/.exec(String(s));
  if (!m) throw new Error(`--range must look like 0-599 (got "${s}")`);
  return [Number(m[1]), Math.min(Number(m[2]), frames - 1)];
}

export const rel = (root, p) => path.relative(root, p) || '.';
