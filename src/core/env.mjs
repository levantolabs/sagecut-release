// Sage key and endpoint. Order (first wins): process environment, <project>/.env, ./.env, then the user-level
import fs from 'node:fs';
import path from 'node:path';
import { userDataDir } from './paths.mjs';

export const DEFAULT_ENDPOINT = 'https://sage.levanto.ai';
export const KEY_PAGE = 'https://levanto.ai';

function parseDotenv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    const k = line.slice(0, i).replace(/^export\s+/, '').trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}

export function loadSageEnv(projectRoot = process.cwd()) {
  // lowest priority first: later files override earlier ones
  const files = [path.join(userDataDir(), '.env'), path.join(process.cwd(), '.env'), path.join(projectRoot, '.env')];
  const merged = {};
  for (const f of files) Object.assign(merged, parseDotenv(f));
  const key = process.env.SAGE_API_KEY || merged.SAGE_API_KEY || process.env.LEVANTO_API_KEY || merged.LEVANTO_API_KEY || '';
  const endpoint = (process.env.SAGE_ENDPOINT || merged.SAGE_ENDPOINT || DEFAULT_ENDPOINT).replace(/\/+$/, '');
  return { key, endpoint, hasKey: key.length > 0 };
}

// A masked form for messages: never more than the last 4 characters.
export const maskKey = (key) => (key ? `…${key.slice(-4)}` : '(none)');
