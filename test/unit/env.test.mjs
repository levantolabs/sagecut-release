import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('loadSageEnv: project .env wins over the user-level ~/.sagecut/.env, which still works alone', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-env-'));
  const home = path.join(tmp, 'home'); const proj = path.join(tmp, 'proj');
  fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(proj, { recursive: true });
  const saved = { home: process.env.SAGECUT_HOME, key: process.env.SAGE_API_KEY, lk: process.env.LEVANTO_API_KEY };
  process.env.SAGECUT_HOME = home; delete process.env.SAGE_API_KEY; delete process.env.LEVANTO_API_KEY;
  try {
    const { loadSageEnv } = await import('../../src/core/env.mjs');
    assert.equal(loadSageEnv(proj).hasKey, false);
    fs.writeFileSync(path.join(home, '.env'), 'SAGE_API_KEY=user-level-key\n');
    assert.equal(loadSageEnv(proj).key, 'user-level-key');
    fs.writeFileSync(path.join(proj, '.env'), 'SAGE_API_KEY="project-key"\n');
    assert.equal(loadSageEnv(proj).key, 'project-key');
  } finally {
    if (saved.home === undefined) delete process.env.SAGECUT_HOME; else process.env.SAGECUT_HOME = saved.home;
    if (saved.key !== undefined) process.env.SAGE_API_KEY = saved.key;
    if (saved.lk !== undefined) process.env.LEVANTO_API_KEY = saved.lk;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
