#!/usr/bin/env node
// Keep the shipped CLI and its assets together after a skills CLI installation.
import { fileURLToPath } from 'node:url';

const runtime = new URL('../runtime/', import.meta.url);
// This is scoped to this Node process; it does not change the user's shell.
process.env.CLAUDE_PLUGIN_ROOT = fileURLToPath(runtime);
await import(new URL('bin/sagecut.mjs', runtime).href);
