// sagecut/brand.yaml: the brand. The build reads it through src/brand.ts; the QA reads it here.
import fs from 'node:fs';
import YAML from 'yaml';

const HEX = /^#[0-9a-fA-F]{6}$/;

export function validateBrand(b) {
  const errors = [];
  if (!b || typeof b !== 'object') return ['brand file is empty'];
  if (!b.name) errors.push('missing "name"');
  const c = b.colors || {};
  for (const k of ['background', 'text', 'primary']) if (!HEX.test(c[k] || '')) errors.push(`colors.${k} must be a #RRGGBB hex value`);
  for (const v of [...(c.accent || []), ...(c.allowed || [])]) if (!HEX.test(v)) errors.push(`colour ${v} is not a #RRGGBB hex value`);
  if (!b.fonts || !b.fonts.heading || !b.fonts.heading.family) errors.push('fonts.heading.family is missing');
  if (b.format && !['16:9', '9:16', '1:1'].includes(b.format)) errors.push('format must be 16:9, 9:16 or 1:1');
  const m = b.motion || {};
  if (m.style && !['restrained', 'energetic'].includes(m.style)) errors.push('motion.style must be restrained or energetic');
  return errors;
}

export function loadBrand(file, { required = false } = {}) {
  if (!fs.existsSync(file)) {
    if (required) throw new Error(`No brand file at ${file}. Run "sagecut brand" (or /sagecut:start).`);
    return null;
  }
  const b = YAML.parse(fs.readFileSync(file, 'utf8'));
  const errors = validateBrand(b);
  if (errors.length) throw new Error(`brand ${file}: ${errors.join('; ')}`);
  return b;
}

// Every colour the brand allows (for the off-palette check).
export function brandPalette(b) {
  if (!b) return [];
  const c = b.colors || {};
  return [...new Set([c.background, c.text, c.primary, ...(c.accent || []), ...(c.allowed || [])].filter(Boolean).map((x) => x.toLowerCase()))];
}

export const designedEffects = (b) => new Set(((b && b.motion && b.motion.designed) || []).map(String));
