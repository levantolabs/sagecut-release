// SessionStart hook: prints the welcome line once. It never fails the session.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

try {
  const dir = process.env.CLAUDE_PLUGIN_DATA || process.env.SAGECUT_HOME || path.join(os.homedir(), '.sagecut');
  const marker = path.join(dir, 'welcomed');
  if (!fs.existsSync(marker)) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(marker, new Date().toISOString() + '\n');
    process.stdout.write(JSON.stringify({ systemMessage: 'SageCut is installed. Type /sagecut:start to begin.' }) + '\n');
  }
} catch { /* never fail the session */ }
process.exit(0);
