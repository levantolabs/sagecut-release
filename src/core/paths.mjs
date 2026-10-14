// Paths for SageCut. Every path is built with node:path, so the same code works on Windows, macOS and Linux.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function pluginRoot() {
  if (process.env.CLAUDE_PLUGIN_ROOT) return process.env.CLAUDE_PLUGIN_ROOT;
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, '.claude-plugin'))) return dir;
    dir = path.dirname(dir);
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}

export function findProjectRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  let remotionDir = null;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'sagecut', 'sagecut.yaml'))) return dir;
    const pj = path.join(dir, 'package.json');
    if (!remotionDir && fs.existsSync(pj)) {
      try {
        const p = JSON.parse(fs.readFileSync(pj, 'utf8'));
        const deps = { ...(p.dependencies || {}), ...(p.devDependencies || {}) };
        if (deps.remotion || deps['@remotion/cli']) remotionDir = dir;
      } catch { }
    }
    const up = path.dirname(dir);
    if (up === dir) return remotionDir || path.resolve(start);
    dir = up;
  }
}

// Per-project SageCut folder: <project>/sagecut
export const sagecutDir = (root) => path.join(root, 'sagecut');
export const qaDir = (root) => path.join(root, 'sagecut', 'qa');
export const metricsDir = (root) => path.join(root, 'sagecut', 'metrics');

export function userDataDir() {
  return process.env.SAGECUT_HOME || path.join(os.homedir(), '.sagecut');
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// A new run folder under sagecut/qa: <prefix>-YYYYMMDD-HHMMSS (never overwrites an earlier run)
export function newRunDir(root, prefix) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  let dir = path.join(qaDir(root), `${prefix}-${stamp}`);
  let n = 2;
  while (fs.existsSync(dir)) dir = path.join(qaDir(root), `${prefix}-${stamp}-${n++}`);
  return ensureDir(dir);
}
