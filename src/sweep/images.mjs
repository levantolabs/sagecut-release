// Image helpers for ask/triage: expand globs, decode any image or video frame to raw RGB through the Remotion ffmpeg.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import * as ff from '../core/ffmpeg.mjs';
import { encodePng } from '../core/png.mjs';

const escapeRe = (s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
function segmentRe(seg) {
  let out = '';
  for (const ch of seg) out += ch === '*' ? '[^/\\\\]*' : ch === '?' ? '[^/\\\\]' : escapeRe(ch);
  return new RegExp(`^${out}$`);
}

export function expandGlob(pattern, cwd = process.cwd()) {
  const norm = pattern.replace(/\\/g, '/');
  const abs = path.isAbsolute(pattern) || /^[a-zA-Z]:\//.test(norm);
  const parts = norm.split('/').filter((p, i) => p !== '' || i === 0);
  let bases = [abs ? (norm.startsWith('/') ? '/' : parts.shift() + '/') : cwd];
  if (abs && norm.startsWith('/')) parts.shift();
  const out = [];
  const walk = (dir, i) => {
    if (i === parts.length) { out.push(dir); return; }
    const seg = parts[i];
    if (seg === '**') {
      walk(dir, i + 1);
      for (const d of safeDirs(dir)) walk(path.join(dir, d), i);
      return;
    }
    if (!/[*?]/.test(seg)) {
      const next = path.join(dir, seg);
      if (fs.existsSync(next)) walk(next, i + 1);
      return;
    }
    const re = segmentRe(seg);
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const n of names.sort()) if (re.test(n)) walk(path.join(dir, n), i + 1);
  };
  for (const b of bases) walk(b, 0);
  return [...new Set(out)].sort().filter((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });
}

function safeDirs(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules').map((d) => d.name); }
  catch { return []; }
}

export const evenHeight = (w, h, width) => Math.max(2, Math.round((width * h / w) / 2) * 2);

// Decode an 8-bit, non-interlaced PNG (what the ffmpeg png encoder writes) to raw rgb24.
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8; let w = 0; let h = 0; let ct = 0; const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos); const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; if (data[8] !== 8 || data[12] !== 0) throw new Error('only 8-bit non-interlaced PNG is supported'); }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const ch = { 0: 1, 2: 3, 6: 4 }[ct];
  if (!ch) throw new Error(`unsupported PNG colour type ${ct}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch; const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]; const src = y * (stride + 1) + 1; const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[dst + x - ch] : 0; const b = y > 0 ? px[dst - stride + x] : 0; const c = x >= ch && y > 0 ? px[dst - stride + x - ch] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pa = Math.abs(b - c); const pb = Math.abs(a - c); const pc = Math.abs(a + b - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[dst + x] = v & 255;
    }
  }
  if (ch === 3) return { rgb: px, w, h };
  const rgb = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) for (let k = 0; k < 3; k++) rgb[i * 3 + k] = ch === 1 ? px[i] : px[i * 4 + k];
  return { rgb, w, h };
}

export async function decodeFrame(video, frame, { root, width, fps }) {
  return decodePng(await ff.still(video, frame, { root, fps: fps || 1, width }));
}

export async function decodeImageFile(file, { root, width }) {
  const info = await ff.probe(file, { root });
  const w = Math.min(width, info.width);
  const r = await ff.run('ffmpeg', ['-v', 'error', '-i', file, '-frames:v', '1', '-vf', `scale=${w}:-2:flags=lanczos,format=rgb24`, '-f', 'image2pipe', '-c:v', 'png', 'pipe:1'], { root });
  if (r.code !== 0 || !r.stdout.length) throw new Error(`could not read image ${file}: ${r.stderr.trim().slice(0, 200)}`);
  return decodePng(r.stdout);
}

export const pngUri = ({ rgb, w, h }) => `data:image/png;base64,${encodePng(rgb, w, h, 3).toString('base64')}`;

// sha256 (first 12 hex) of a whole file, streamed.
export function fileSha12(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex').slice(0, 12))).on('error', reject);
  });
}
