// JSON-lines logs and JSON files. Each writer makes its folder first (a fresh project has no folders).
import fs from 'node:fs';
import path from 'node:path';

export function appendJsonl(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify({ iso: new Date().toISOString(), ...obj }) + '\n');
}

export function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 1) + '\n');
  return file;
}

export function readJson(file, fallback = undefined) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { if (fallback !== undefined) return fallback; throw e; }
}

// Console output for the CLI: one place, so --json mode can silence it.
let quiet = false;
export const setQuiet = (q) => { quiet = q; };
export const say = (...a) => { if (!quiet) console.log(...a); };
export const warn = (...a) => console.error(...a);
