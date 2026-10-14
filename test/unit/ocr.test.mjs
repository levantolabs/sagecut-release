import test from 'node:test';
import assert from 'node:assert/strict';
import { createOcr, ocrPaths } from '../../src/core/ocr.mjs';
import { encodePng } from '../../src/core/png.mjs';

const G = {
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

function textPng(text, scale = 14, pad = 60) {
  const w = (text.length * 6 - 1) * scale + pad * 2, h = 7 * scale + pad * 2;
  const px = Buffer.alloc(w * h * 3, 255);
  [...text].forEach((ch, i) => G[ch].forEach((row, y) => [...row].forEach((bit, x) => {
    if (bit !== '1') return;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const o = ((pad + y * scale + dy) * w + pad + (i * 6 + x) * scale + dx) * 3;
      px[o] = px[o + 1] = px[o + 2] = 20;
    }
  })));
  return encodePng(px, w, h, 3);
}

test('OCR data is found', () => {
  const p = ocrPaths();
  assert.ok(p.langPath, 'assets/eng.traineddata not found');
});

test('OCR reads big text without the network', async () => {
  const ocr = await createOcr();
  try {
    const r = await ocr.read(textPng('HELLO 42'));
    const all = r.lines.map((l) => l.text).join(' ');
    assert.match(all, /HELLO/i);
    assert.ok(r.lines[0].bbox.x1 > r.lines[0].bbox.x0);
    assert.ok(r.ms >= 0);
  } finally { await ocr.close(); }
});
