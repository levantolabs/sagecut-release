// OCR through tesseract.js (same results on Windows, macOS and Linux; no install). Language data ships in assets/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pluginRoot, userDataDir, ensureDir } from './paths.mjs';

function findFirst(candidates, test) {
  for (const c of candidates) { try { if (test(c)) return c; } catch { /* next */ } }
  return null;
}

export function ocrPaths() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const roots = [...new Set([path.resolve(here, '..'), path.resolve(here, '..', '..'), pluginRoot()])];
  const worker = findFirst(roots.map((r) => path.join(r, 'bin', 'ocr', 'worker.cjs')), fs.existsSync)
    || findFirst(roots.map((r) => path.join(r, 'ocr', 'worker.cjs')), fs.existsSync);
  const langPath = findFirst(roots.map((r) => path.join(r, 'assets')), (d) => fs.existsSync(path.join(d, 'eng.traineddata')));
  return { worker, langPath };
}

export async function createOcr() {
  const { worker: workerPath, langPath } = ocrPaths();
  if (!langPath) throw new Error('OCR language data (assets/eng.traineddata) not found. Reinstall the plugin.');
  const mod = await import('tesseract.js');
  const createWorker = (mod.default && mod.default.createWorker) || mod.createWorker;
  const cachePath = ensureDir(path.join(userDataDir(), 'ocr-cache'));
  const options = { langPath, cachePath, cacheMethod: 'write', gzip: false, logger: () => {}, errorHandler: () => {} };
  if (workerPath) options.workerPath = workerPath;
  const worker = await createWorker('eng', 1, options);
  await worker.setParameters({ tessedit_pageseg_mode: '11', user_defined_dpi: '150', debug_file: '/dev/null' });   // sparse text: video frames
  return {
    async read(png) {
      const t0 = Date.now();
      const { data } = await worker.recognize(png, {}, { blocks: true });
      const lines = [];
      for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) {
        const text = (l.text || '').trim();
        if (text) lines.push({ text, bbox: { x0: l.bbox.x0, y0: l.bbox.y0, x1: l.bbox.x1, y1: l.bbox.y1 }, confidence: l.confidence });
      }
      return { lines, ms: Date.now() - t0 };
    },
    async close() { await worker.terminate(); },
  };
}

// Callers use this: returns null (and the caller reports "OCR skipped") when OCR is not available.
export async function tryCreateOcr() {
  try { return await createOcr(); } catch (e) { return null; }
}
