// Frame pictures for the gate, built in Node: exact frame grabs as raw RGB, resizing, outlines, diff images, labelled sheets.
import fs from 'node:fs';
import path from 'node:path';
import { run } from '../core/ffmpeg.mjs';
import { encodePng, paste } from '../core/png.mjs';
import { toGrey } from './frame.mjs';

export async function rawFrame(video, frame, { root, fps, w, h, scale = false }) {
  const t = Math.max(0, (frame - 0.25) / fps);
  const vf = [];
  if (scale) vf.push(`scale=${w}:${h}:flags=area`);
  vf.push('format=rgb24');
  const r = await run('ffmpeg', ['-v', 'error', '-ss', t.toFixed(6), '-i', video, '-frames:v', '1', '-vf', vf.join(','),
    '-f', 'image2pipe', '-c:v', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { root });
  if (r.code !== 0 || r.stdout.length < w * h * 3) throw new Error(`frame ${frame} could not be read: ${r.stderr.trim().slice(0, 200)}`);
  return { w, h, data: r.stdout.subarray(0, w * h * 3) };
}

// Area-average resize of an RGB frame.
export function resizeRGB({ w, h, data }, tw, th) {
  if (tw === w && th === h) return { w, h, data };
  const out = Buffer.alloc(tw * th * 3), sx = w / tw, sy = h / th;
  for (let y = 0; y < th; y++) {
    const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.min(h, Math.ceil((y + 1) * sy)));
    for (let x = 0; x < tw; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.min(w, Math.ceil((x + 1) * sx)));
      let r = 0, g = 0, b = 0;
      for (let yy = y0; yy < y1; yy++) {
        let o = (yy * w + x0) * 3;
        for (let xx = x0; xx < x1; xx++, o += 3) { r += data[o]; g += data[o + 1]; b += data[o + 2]; }
      }
      const n = (y1 - y0) * (x1 - x0), j = (y * tw + x) * 3;
      out[j] = Math.round(r / n); out[j + 1] = Math.round(g / n); out[j + 2] = Math.round(b / n);
    }
  }
  return { w: tw, h: th, data: out };
}

export const toPng = ({ w, h, data }) => encodePng(Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.length), w, h, 3);

export function writePng(file, img) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const buf = toPng(img);
  fs.writeFileSync(file, buf);
  return buf;
}

// A copy of the frame with rectangles drawn on it (boxes: [x0, y0, x1, y1]).
export function outline(img, boxes, color = [255, 0, 0], width = 5, pad = 6) {
  const { w, h } = img, data = Buffer.from(img.data);
  const put = (x, y) => { if (x >= 0 && x < w && y >= 0 && y < h) { const o = (y * w + x) * 3; data[o] = color[0]; data[o + 1] = color[1]; data[o + 2] = color[2]; } };
  for (const b of boxes) {
    const x0 = Math.round(b[0]) - pad, y0 = Math.round(b[1]) - pad, x1 = Math.round(b[2]) + pad, y1 = Math.round(b[3]) + pad;
    for (let k = 0; k < width; k++) {
      for (let x = x0 - k; x <= x1 + k; x++) { put(x, y0 - k); put(x, y1 + k); }
      for (let y = y0 - k; y <= y1 + k; y++) { put(x0 - k, y); put(x1 + k, y); }
    }
  }
  return { w, h, data };
}

// A picture of at most `width` px wide (never enlarged).
export function shrink(img, width) {
  if (img.w <= width) return img;
  return resizeRGB(img, width, Math.round((img.h * width) / img.w));
}

export function diffImage(a, b) {
  const ga = toGrey(a), gb = toGrey(b), out = Buffer.alloc(a.w * a.h * 3);
  for (let i = 0; i < ga.length; i++) { const v = Math.min(255, Math.abs(ga[i] - gb[i]) * 4); out[i * 3] = v; out[i * 3 + 1] = v; out[i * 3 + 2] = v; }
  return { w: a.w, h: a.h, data: out };
}

// ---- a tiny bitmap font (5 x 7) for frame numbers and time codes ----
const GLYPHS = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  f: ['00110', '01000', '01000', '11100', '01000', '01000', '01000'],
  ':': ['00000', '00100', '00100', '00000', '00100', '00100', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

export function timecode(frame, fps) {
  const t = frame / fps, m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

export function labelStrip(text, width, scale = 3, fg = [255, 255, 0]) {
  const h = 7 * scale + 10, data = Buffer.alloc(width * h * 3);
  let x0 = 6;
  for (const ch of text) {
    const g = GLYPHS[ch] || GLYPHS[' '];
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 5; x++) {
        if (g[y][x] !== '1') continue;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const px = x0 + x * scale + dx, py = 5 + y * scale + dy;
            if (px < width) { const o = (py * width + px) * 3; data[o] = fg[0]; data[o + 1] = fg[1]; data[o + 2] = fg[2]; }
          }
        }
      }
    }
    x0 += 6 * scale;
  }
  return { w: width, h, data };
}

function stack(top, bottom) {
  const data = Buffer.concat([top.data, bottom.data]);
  return { w: top.w, h: top.h + bottom.h, data };
}

export function makeSheet(cells, { cellW = 480, cols = 4, scale = 3 } = {}) {
  const tiles = cells.map(({ img, label }) => {
    const r = resizeRGB(img, cellW, Math.max(1, Math.round((img.h * cellW) / img.w)));
    return stack(labelStrip(label, cellW, scale), r);
  });
  const ch = Math.max(...tiles.map((t) => t.h)), rows = Math.ceil(tiles.length / cols), gap = 4;
  const W = cols * cellW + (cols - 1) * gap, H = rows * ch + (rows - 1) * gap;
  const canvas = Buffer.alloc(W * H * 3, 40);
  tiles.forEach((t, i) => paste(canvas, W, t.data, t.w, t.h, (i % cols) * (cellW + gap), Math.floor(i / cols) * (ch + gap)));
  return { w: W, h: H, data: canvas };
}
