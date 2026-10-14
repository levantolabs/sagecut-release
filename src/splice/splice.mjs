// GOP splice: re-encode one GOP-aligned frame range of a delivered H.264 master and stream-copy everything else.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { run as ff, locate, probe } from '../core/ffmpeg.mjs';
import { avcC, isFaststart } from './mp4.mjs';

export function parseRange(str) {
  const m = String(str || '').match(/^(\d+)-(\d+)$/);
  if (!m) throw new Error(`--frames must look like 300-340 (first-last frame). Got "${str}".`);
  const a = Number(m[1]), b = Number(m[2]);
  if (b < a) throw new Error(`--frames ${str}: the last frame is before the first.`);
  return [a, b];
}

async function packets(file, stream, root) {
  const r = await ff('ffprobe', ['-v', 'error', '-select_streams', stream, '-show_entries', 'packet=pts,pts_time,dts_time,duration_time,flags,size', '-of', 'json', file], { root });
  if (r.code !== 0) throw new Error(`ffprobe failed on ${file}: ${r.stderr.trim().slice(0, 300)}`);
  return JSON.parse(r.stdout.toString()).packets || [];
}

// Video packets in display order, with the keyframe flag. index = frame number.
export async function videoIndex(file, root) {
  const p = (await packets(file, 'v:0', root)).map((x) => ({ pts: Number(x.pts), time: x.pts_time, key: /K/.test(x.flags || ''), size: Number(x.size) }));
  p.sort((a, b) => a.pts - b.pts);
  return p;
}

export async function planSplice(master, [a, b], { root }) {
  const idx = await videoIndex(master, root);
  const total = idx.length;
  if (b >= total) throw new Error(`--frames ${a}-${b}: the master has ${total} frames (0 to ${total - 1}).`);
  const keys = idx.map((p, i) => (p.key ? i : -1)).filter((i) => i >= 0);
  let g0 = 0; for (const k of keys) if (k <= a) g0 = k;
  const next = keys.find((k) => k > b);
  const g1 = next === undefined ? total - 1 : next - 1;
  const info = await probe(master, { root });
  return { total, keyframes: keys, g0, g1, frames: g1 - g0 + 1, fps: info.fps, requested: [a, b], index: idx, info };
}

// "x264 - core 164 ... options: cabac=1 ref=3 ..." from the encoder SEI of the master.
export function readX264Options(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size; const CH = 4 * 1048576; const buf = Buffer.alloc(CH + 4096);
    for (let pos = 0; pos < size; pos += CH) {
      const n = fs.readSync(fd, buf, 0, CH + 4096, pos);
      const at = buf.subarray(0, n).indexOf('x264 - core ');
      if (at >= 0) {
        let end = at; while (end < n && buf[end] !== 0) end++;
        const text = buf.toString('latin1', at, end);
        const o = text.indexOf('options:');
        return { text, options: o >= 0 ? text.slice(o + 8).trim() : null };
      }
    }
  } finally { fs.closeSync(fd); }
  return { text: null, options: null };
}

const DROP = new Set(['threads', 'lookahead_threads', 'sliced_threads', 'rc', 'sync_lookahead', 'nr', 'cqm', 'interlaced', 'analyse']);
const RENAME = { decimate: 'dct-decimate', mixed_ref: 'mixed-refs', ip_ratio: 'ipratio', pb_ratio: 'pbratio' };

// The SEI prints some settings in a packed form. Convert them back to the names x264 accepts.
function partitions(analyse) {
  const m = String(analyse || '').match(/^0x([0-9a-f]+)[:,]0x([0-9a-f]+)$/i);
  if (!m) return null;
  const intra = parseInt(m[1], 16), inter = parseInt(m[2], 16); const list = [];
  if (intra & 0x1) list.push('i4x4'); if (intra & 0x2) list.push('i8x8');
  if (inter & 0x10) list.push('p8x8'); if (inter & 0x20) list.push('p4x4'); if (inter & 0x100) list.push('b8x8');
  return list.length ? list.join(',') : 'none';
}

export function x264Params(optionsText, { sar11, minKeyint }) {
  const kv = [];
  for (const tok of (optionsText || '').split(/\s+/).filter(Boolean)) {
    const i = tok.indexOf('=');
    if (i < 0) continue;
    const k = tok.slice(0, i), raw = tok.slice(i + 1), v = raw.replace(/:/g, k === 'sar' ? '/' : ',');
    if (k === 'analyse') { const pt = partitions(raw); if (pt) kv.push(['partitions', pt]); continue; }
    if (k === 'deadzone') { const [inter, intra] = v.split(','); kv.push(['deadzone-inter', inter], ['deadzone-intra', intra]); continue; }
    if (k === 'aq') { const [mode, str] = v.split(','); kv.push(['aq-mode', mode], ['aq-strength', str]); continue; }
    if (k === 'deblock') {   // printed as enabled:alpha:beta; x264 reads alpha,beta
      const [en, al, be] = v.split(',');
      if (en === '0') kv.push(['no-deblock', '1']); else kv.push(['deblock', `${al},${be}`]);
      continue;
    }
    if (k === 'chroma_qp_offset' && /\bmbtree=1\b/.test(optionsText)) { kv.push([k, String(Number(v) + 2)]); continue; }   // x264 lowers it by 2 with mbtree
    if (DROP.has(k)) continue;
    kv.push([RENAME[k] || k, v]);
  }
  const set = (k, v) => { const j = kv.findIndex(([x]) => x === k); if (j >= 0) kv[j][1] = v; else kv.push([k, v]); };
  set('scenecut', '0');
  const cur = Number((kv.find(([k]) => k === 'keyint') || [])[1]);
  if (!(cur >= minKeyint)) set('keyint', String(minKeyint));
  const mk = Number((kv.find(([k]) => k === 'keyint_min') || [])[1]);
  if (mk > minKeyint) set('keyint_min', '1');
  if (sar11 && !kv.some(([k]) => k === 'sar')) kv.push(['sar', '1/1']);
  return kv.map(([k, v]) => `${k}=${v}`).join(':');
}

async function streamMd5(file, root) {
  const t = locate(root);
  const p = spawn(t.ffmpeg, ['-v', 'error', '-i', file, '-map', '0:v:0', '-f', 'image2pipe', '-c:v', 'rawvideo', '-pix_fmt', 'yuv420p', 'pipe:1'], { env: t.env, windowsHide: true });
  const info = await probe(file, { root });
  const fsz = info.width * info.height * 3 / 2;
  const hashes = []; let buf = Buffer.alloc(0); let err = '';
  p.stderr.on('data', (d) => { err += d; });
  for await (const c of p.stdout) {
    buf = buf.length ? Buffer.concat([buf, c]) : c;
    while (buf.length >= fsz) { hashes.push(crypto.createHash('md5').update(buf.subarray(0, fsz)).digest('hex')); buf = buf.subarray(fsz); }
  }
  const code = await new Promise((r) => (p.exitCode !== null ? r(p.exitCode) : p.on('close', r)));
  if (code !== 0 && !hashes.length) throw new Error(`decode failed for ${file}: ${err.trim().slice(0, 200)}`);
  return hashes;
}

const q = (s) => s.replace(/\\/g, '/').replace(/'/g, "'\\''");
const must = (r, what) => { if (r.code !== 0) throw new Error(`${what} failed: ${r.stderr.trim().split('\n').slice(-3).join(' | ').slice(0, 400)}`); return r; };

export async function applySplice(master, patchFile, [g0, g1], { root, out, log = () => {} }) {
  const plan = await planSplice(master, [g0, g1], { root });
  if (plan.g0 !== g0 || plan.g1 !== g1) {
    throw new Error(`--frames ${g0}-${g1} is not GOP-aligned. Run "sagecut splice plan ${path.basename(master)} --frames ${g0}-${g1}": it gives ${plan.g0}-${plan.g1}.`);
  }
  const n = g1 - g0 + 1;
  const minfo = plan.info;
  const pinfo = await probe(patchFile, { root });
  if (pinfo.width !== minfo.width || pinfo.height !== minfo.height) throw new Error(`The patch is ${pinfo.width}x${pinfo.height}; the master is ${minfo.width}x${minfo.height}.`);
  if (pinfo.frames !== n) throw new Error(`The patch has ${pinfo.frames} frames; frames ${g0}-${g1} are ${n}. Render with --frames=${g0}-${g1}.`);
  if (Math.abs(pinfo.fps - minfo.fps) > 0.01) throw new Error(`The patch runs at ${pinfo.fps} fps; the master runs at ${minfo.fps} fps.`);

  const sei = readX264Options(master);
  if (!sei.options) throw new Error('The master has no x264 encoder text, so SageCut cannot copy its encoder settings. Splice works on masters that x264 wrote (Remotion --codec h264).');
  const bframes = Number((sei.options.match(/\bbframes=(\d+)/) || [])[1] || 0);
  const warnings = [];
  if (bframes > 0) warnings.push(`The master uses ${bframes} B-frames. The proof checks the result; use --codec h264 with bframes=0 for the safest splice.`);

  const mpr = await ff('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate,color_range,color_space,color_primaries,color_transfer,sample_aspect_ratio', '-of', 'json', master], { root });
  const ms = JSON.parse(mpr.stdout.toString()).streams[0];
  const sar11 = ms.sample_aspect_ratio === '1:1';
  const params = x264Params(sei.options, { sar11, minKeyint: n });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sagecut-splice-'));
  const f = (name) => path.join(tmp, name);
  try {
    // 1. encode the patch with the master's settings
    const vf = [];
    if (pinfo.colorRange === 'pc') vf.push('scale=in_range=full:out_range=limited');
    vf.push('format=yuv420p');
    const tag = [];
    if (ms.color_range === 'tv' || ms.color_range === 'pc') tag.push('-color_range', ms.color_range);
    if (ms.color_space && ms.color_space !== 'unknown') tag.push('-colorspace', ms.color_space);
    if (ms.color_primaries && ms.color_primaries !== 'unknown') tag.push('-color_primaries', ms.color_primaries);
    if (ms.color_transfer && ms.color_transfer !== 'unknown') tag.push('-color_trc', ms.color_transfer);
    must(await ff('ffmpeg', ['-v', 'error', '-y', '-i', patchFile, '-map', '0:v:0', '-an', '-vf', vf.join(','), '-r', ms.r_frame_rate, '-c:v', 'libx264',
      '-x264-params', params, ...tag, f('patch.mp4')], { root }), 'encoding the patch');
    const spsMaster = avcC(master), spsPatch = avcC(f('patch.mp4'));
    const spsIdentical = Boolean(spsMaster && spsPatch && spsMaster.equals(spsPatch));
    if (!spsIdentical) warnings.push('The SPS/PPS of the new part differs from the master. Decoders may show a glitch at the join. Check the x264 settings of the master.');
    const patchIdx = await videoIndex(f('patch.mp4'), root);
    if (patchIdx.length !== n || patchIdx.filter((p) => p.key).length !== 1) warnings.push(`The new part has ${patchIdx.filter((p) => p.key).length} keyframes (expected 1).`);

    // 2. parts of the master, stream copy
    const list = [];
    if (g0 > 0) {
      must(await ff('ffmpeg', ['-v', 'error', '-y', '-i', master, '-map', '0:v:0', '-c', 'copy', '-an', '-frames:v', String(g0), f('a.mp4')], { root }), 'cutting the first part');
      list.push('a.mp4');
    }
    list.push('patch.mp4');
    if (g1 + 1 < plan.total) {
      const key = plan.index[g1 + 1];
      const tb = await ff('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=time_base', '-of', 'csv=p=0', master], { root });
      const [tn, td] = tb.stdout.toString().trim().split('/').map(Number);
      const exact = (key.pts * tn) / td;
      const want = plan.total - (g1 + 1);
      let ok = false;
      for (const dUs of [0, -1, 1, -2, 2, -3, 3, -5, 5]) {
        const ss = Math.max(0, Math.round(exact * 1e6) + dUs) / 1e6;
        must(await ff('ffmpeg', ['-v', 'error', '-y', '-ss', ss.toFixed(6), '-i', master, '-map', '0:v:0', '-c', 'copy', '-an', f('c.mp4')], { root }), 'cutting the last part');
        const ci = await packetsRaw(f('c.mp4'), root);
        if (ci.length === want && /K/.test(ci[0].flags) && !/D/.test(ci[0].flags) && Number(ci[0].pts) >= 0) { ok = true; break; }
      }
      if (!ok) throw new Error('Could not cut the last part exactly at its keyframe (the packet check failed). Try a range that ends at the end of the film.');
      list.push('c.mp4');
    }
    fs.writeFileSync(f('list.txt'), list.map((x) => `file '${q(f(x))}'`).join('\n') + '\n');

    // 3. join, with the master's audio copied
    const hasAudio = minfo.hasAudio;
    const fast = isFaststart(master);
    const args = ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', f('list.txt')];
    if (hasAudio) args.push('-i', master);
    args.push('-map', '0:v:0'); if (hasAudio) args.push('-map', '1:a');
    args.push('-c', 'copy'); if (fast) args.push('-movflags', '+faststart');
    args.push(out);
    must(await ff('ffmpeg', args, { root }), 'joining the parts');

    // 4. proof
    log('proof: decoding both files');
    const [hm, ho] = [await streamMd5(master, root), await streamMd5(out, root)];
    const outside = []; let changed = 0;
    for (let i = 0; i < Math.max(hm.length, ho.length); i++) {
      const inRange = i >= g0 && i <= g1;
      if (inRange) { if (hm[i] !== ho[i]) changed++; } else if (hm[i] !== ho[i]) outside.push(i);
    }
    const cmp = async (stream) => {
      const [x, y] = [await packetsRaw(master, root, stream), await packetsRaw(out, root, stream)];
      const diffs = [];
      if (x.length !== y.length) diffs.push(`packet count ${x.length} vs ${y.length}`);
      for (let i = 0; i < Math.min(x.length, y.length) && diffs.length < 10; i++) {
        for (const k of ['pts_time', 'dts_time', 'duration_time']) if (x[i][k] !== y[i][k]) { diffs.push(`packet ${i} ${k}: ${x[i][k]} vs ${y[i][k]}`); break; }
      }
      return diffs;
    };
    const vDiff = await cmp('v:0'); const aDiff = hasAudio ? await cmp('a:0') : [];
    const proof = {
      master: path.resolve(master), patch: path.resolve(patchFile), out: path.resolve(out),
      range: { first: g0, last: g1, frames: n }, frameCount: { master: hm.length, out: ho.length },
      decodedFramesIdenticalOutsideRange: outside.length === 0 && hm.length === ho.length, outsideMismatches: outside.slice(0, 20),
      framesChangedInsideRange: changed,
      videoPacketTimingIdentical: vDiff.length === 0, videoPacketDiffs: vDiff,
      audioPacketTimingIdentical: aDiff.length === 0, audioPacketDiffs: aDiff,
      spsIdenticalToMaster: spsIdentical, x264Params: params, warnings,
    };
    proof.pass = proof.decodedFramesIdenticalOutsideRange && proof.videoPacketTimingIdentical && proof.audioPacketTimingIdentical && spsIdentical;
    fs.writeFileSync(`${out}.proof.json`, JSON.stringify(proof, null, 1) + '\n');
    return proof;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function packetsRaw(file, root, stream = 'v:0') {
  const p = await packets(file, stream, root);
  return p.map((x) => ({ pts: x.pts, flags: x.flags || '', pts_time: x.pts_time, dts_time: x.dts_time, duration_time: x.duration_time }));
}
