// sagecut splice plan | apply: change a few seconds of a delivered H.264 file without rendering the whole film.
import path from 'node:path';
import { parseArgs } from 'node:util';
import { say } from '../core/log.mjs';
import { parseRange, planSplice, applySplice } from '../splice/splice.mjs';

export const help = 'replace a GOP-aligned frame range of a delivered video: plan | apply';

export async function run(argv, ctx) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    frames: { type: 'string' }, out: { type: 'string' }, json: { type: 'boolean' }, root: { type: 'string' }, help: { type: 'boolean' } } });
  const [sub, master, patch] = positionals;
  if (values.help || !sub) {
    say('usage: sagecut splice plan <master> --frames A-B\n       sagecut splice apply <master> <patch.mp4> --frames G0-G1 [--out FILE]');
    return values.help ? 0 : 2;
  }
  if (!master) { console.error('sagecut splice: give the master video file.'); return 2; }
  const root = ctx.root;
  try {
    if (sub === 'plan') {
      const range = parseRange(values.frames);
      const p = await planSplice(master, range, { root });
      if (values.json) { say(JSON.stringify({ first: p.g0, last: p.g1, frames: p.frames, keyframes: p.keyframes.length, total: p.total })); return 0; }
      say(`Master: ${p.total} frames at ${p.fps} fps, ${p.keyframes.length} keyframes.`);
      say(`You asked for frames ${range[0]}-${range[1]}. The GOP-aligned range is ${p.g0}-${p.g1} (${p.frames} frames).`);
      say(`Render it:  npx remotion render <id> patch.mp4 --codec h264 --crf 17 --frames=${p.g0}-${p.g1}`);
      say(`Then:       sagecut splice apply ${path.basename(master)} patch.mp4 --frames ${p.g0}-${p.g1}`);
      return 0;
    }
    if (sub === 'apply') {
      if (!patch) { console.error('sagecut splice apply: give the patch video file.'); return 2; }
      const range = parseRange(values.frames);
      const ext = path.extname(master);
      const out = values.out ? path.resolve(values.out) : path.join(path.dirname(path.resolve(master)), `${path.basename(master, ext)}-spliced${ext || '.mp4'}`);
      if (path.resolve(out) === path.resolve(master)) { console.error('sagecut splice: --out must not be the master file.'); return 2; }
      const proof = await applySplice(master, patch, range, { root, out, log: (m) => say(m) });
      if (values.json) say(JSON.stringify(proof));
      else {
        say(`Wrote ${out}`);
        say(`Proof (${out}.proof.json): ${proof.pass ? 'PASS' : 'FAIL'}`);
        say(`  decoded frames identical outside ${range[0]}-${range[1]}: ${proof.decodedFramesIdenticalOutsideRange}`);
        say(`  frames changed inside the range: ${proof.framesChangedInsideRange} of ${proof.range.frames}`);
        say(`  video packet pts/dts/duration identical: ${proof.videoPacketTimingIdentical}   audio: ${proof.audioPacketTimingIdentical}`);
        say(`  SPS/PPS identical to the master: ${proof.spsIdenticalToMaster}`);
        proof.warnings.forEach((w) => say(`  note: ${w}`));
      }
      return proof.pass ? 0 : 1;
    }
  } catch (e) { console.error(`sagecut splice: ${e.message}`); return 2; }
  console.error(`sagecut splice: unknown "${sub}". Use plan or apply.`);
  return 2;
}
