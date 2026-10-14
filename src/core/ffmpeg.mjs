// ffmpeg / ffprobe for SageCut. First choice: the binaries that Remotion 4 ships in @remotion/compositor-<platform>
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const IS_WIN = process.platform === 'win32';
const EXE = IS_WIN ? '.exe' : '';

function isMusl() {
  if (process.platform !== 'linux') return false;
  try { return !process.report.getReport().header.glibcVersionRuntime; } catch { return false; }
}

export function compositorPackage() {
  const { platform, arch } = process;
  if (platform === 'darwin') return `@remotion/compositor-darwin-${arch === 'arm64' ? 'arm64' : 'x64'}`;
  if (platform === 'win32') return arch === 'x64' ? '@remotion/compositor-win32-x64-msvc' : null;   // Remotion: Windows x64 only
  if (platform === 'linux') return `@remotion/compositor-linux-${arch === 'arm64' ? 'arm64' : 'x64'}-${isMusl() ? 'musl' : 'gnu'}`;
  return null;
}

function findCompositorDir(projectRoot) {
  const pkg = compositorPackage();
  if (!pkg) return null;
  try {
    const req = createRequire(path.join(projectRoot, 'package.json'));
    return path.dirname(req.resolve(`${pkg}/package.json`));
  } catch { }
  let dir = path.resolve(projectRoot);
  for (;;) {
    const cand = path.join(dir, 'node_modules', ...pkg.split('/'));
    if (fs.existsSync(cand)) return cand;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

let cached = null;
// Returns { ffmpeg, ffprobe, env, source } or throws with a fix the user can act on.
export function locate(projectRoot = process.cwd()) {
  if (cached && cached.root === projectRoot) return cached.tools;
  let tools = null;
  if (process.env.SAGECUT_FFMPEG && process.env.SAGECUT_FFPROBE) {
    tools = { ffmpeg: process.env.SAGECUT_FFMPEG, ffprobe: process.env.SAGECUT_FFPROBE, env: { ...process.env }, source: 'env' };
  }
  if (!tools) {
    const dir = findCompositorDir(projectRoot);
    if (dir && fs.existsSync(path.join(dir, `ffmpeg${EXE}`))) {
      const env = { ...process.env };
      if (process.platform === 'darwin') env.DYLD_LIBRARY_PATH = [dir, env.DYLD_LIBRARY_PATH].filter(Boolean).join(':');
      else if (process.platform === 'linux') env.LD_LIBRARY_PATH = [dir, env.LD_LIBRARY_PATH].filter(Boolean).join(':');
      else if (IS_WIN) env.PATH = [dir, env.PATH || env.Path].filter(Boolean).join(';');
      tools = { ffmpeg: path.join(dir, `ffmpeg${EXE}`), ffprobe: path.join(dir, `ffprobe${EXE}`), env, source: `remotion:${path.basename(dir)}` };
    }
  }
  if (!tools) tools = { ffmpeg: `ffmpeg${EXE}`, ffprobe: `ffprobe${EXE}`, env: { ...process.env }, source: 'path' };
  cached = { root: projectRoot, tools };
  return tools;
}

export function run(bin, args, { root = process.cwd(), input = null } = {}) {
  const t = locate(root);
  const exe = bin === 'ffprobe' ? t.ffprobe : t.ffmpeg;
  return new Promise((resolve, reject) => {
    const p = spawn(exe, args, { env: t.env, windowsHide: true });
    const out = []; let err = '';
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => { err += d.toString(); if (err.length > 2_000_000) err = err.slice(-1_000_000); });
    p.on('error', (e) => reject(new Error(`${bin} could not start (${exe}): ${e.message}. Run "sagecut doctor".`)));
    p.on('close', (code) => resolve({ code, stdout: Buffer.concat(out), stderr: err }));
    if (input) { p.stdin.write(input); }
    p.stdin.end();
  });
}

// Video facts: width, height, fps, frames, duration, pixFmt, colorRange, hasAudio, codec.
export async function probe(video, { root = process.cwd() } = {}) {
  const r = await run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', video], { root });
  if (r.code !== 0) throw new Error(`ffprobe failed on ${video}: ${r.stderr.trim().slice(0, 300)}`);
  const j = JSON.parse(r.stdout.toString());
  const v = (j.streams || []).find((s) => s.codec_type === 'video');
  if (!v) throw new Error(`${video} has no video stream`);
  const [num, den] = String(v.avg_frame_rate || v.r_frame_rate || '30/1').split('/').map(Number);
  const fps = den ? num / den : num;
  const duration = Number(v.duration || (j.format && j.format.duration) || 0);
  const frames = v.nb_frames ? Number(v.nb_frames) : Math.round(duration * fps);
  return {
    width: v.width, height: v.height, fps, frames, duration, codec: v.codec_name, pixFmt: v.pix_fmt,
    colorRange: v.color_range || 'unknown', sar: v.sample_aspect_ratio || null,
    hasAudio: (j.streams || []).some((s) => s.codec_type === 'audio'), formatName: j.format && j.format.format_name,
  };
}

export async function* frames(video, { root = process.cwd(), width, height, gray = true, start = 0, end = null } = {}) {
  const pix = gray ? 'gray' : 'rgb24';
  const size = width * height * (gray ? 1 : 3);
  const vf = [];
  if (start > 0 || end != null) vf.push(`trim=start_frame=${start}${end != null ? `:end_frame=${end}` : ''}`);
  vf.push(`scale=${width}:${height}:flags=area`, `format=${pix}`);
  const t = locate(root);
  const p = spawn(t.ffmpeg, ['-v', 'error', '-i', video, '-vf', vf.join(','), '-f', 'image2pipe', '-c:v', 'rawvideo', '-pix_fmt', pix, 'pipe:1'],
    { env: t.env, windowsHide: true });
  let err = '';
  p.stderr.on('data', (d) => { err += d.toString(); });
  let buf = Buffer.alloc(0); let index = start;
  try {
    for await (const chunk of p.stdout) {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      while (buf.length >= size) {
        yield { index: index++, data: buf.subarray(0, size) };
        buf = buf.subarray(size);
      }
    }
  } finally {
    if (p.exitCode === null) p.kill();
  }
  const code = await new Promise((r) => (p.exitCode !== null ? r(p.exitCode) : p.on('close', r)));
  if (code !== 0 && code !== null && index === start) throw new Error(`ffmpeg decode failed: ${err.trim().slice(0, 300)}`);
}

const IMAGE_FILE = /\.(png|jpe?g|webp|bmp|tiff?)$/i;

export async function still(video, frame, { root = process.cwd(), fps, width = null, crop = null, format = 'png', quality = 3 } = {}) {
  const isImage = IMAGE_FILE.test(video);
  if (!fps && !isImage) fps = (await probe(video, { root })).fps;
  const t = isImage ? 0 : Math.max(0, (frame - 0.25) / fps);
  const vf = [];
  if (crop) vf.push(`crop=${Math.round(crop.w)}:${Math.round(crop.h)}:${Math.round(crop.x)}:${Math.round(crop.y)}`);
  if (width) vf.push(`scale=${width}:-2:flags=lanczos`);
  vf.push(format === 'jpg' ? 'format=yuvj420p' : 'format=rgb24');
  const codec = format === 'jpg' ? ['-c:v', 'mjpeg', '-q:v', String(quality)] : ['-c:v', 'png'];
  const seek = isImage ? [] : ['-ss', t.toFixed(6)];
  const r = await run('ffmpeg', ['-v', 'error', ...seek, '-i', video, '-frames:v', '1', '-vf', vf.join(','),
    '-f', 'image2pipe', ...codec, 'pipe:1'], { root });
  if (r.code !== 0 || !r.stdout.length) throw new Error(`frame ${frame} extract failed: ${r.stderr.trim().slice(0, 300)}`);
  return r.stdout;
}

export const toDataUri = (buf, format = 'png') => `data:image/${format === 'jpg' ? 'jpeg' : 'png'};base64,${buf.toString('base64')}`;

export async function loudness(video, { root = process.cwd() } = {}) {
  const r = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', video, '-vn', '-af', 'loudnorm=print_format=json', '-f', 'null', '-'], { root });
  const m = r.stderr.match(/\{[\s\S]*"input_i"[\s\S]*?\}/);
  if (!m) return null;
  const j = JSON.parse(m[0]);
  return { lufs: Number(j.input_i), truePeak: Number(j.input_tp), lra: Number(j.input_lra) };
}
