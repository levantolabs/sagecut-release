// sagecut numbers [--runs DIR ...] [--critics-marker M] [--baseline DIR] [--json]
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { qaDir } from '../core/paths.mjs';
import { readJson, writeJson, say, setQuiet } from '../core/log.mjs';
import { sageUsd } from '../core/sage.mjs';
import { HOUSE_REVIEW } from '../core/costs.mjs';
import { measureMarker } from '../claude/sessions.mjs';
import { fmtUsd, fmtSeconds } from '../core/format.mjs';
import { savingsRow, upsertRow, deliveryLine } from '../core/savings.mjs';

export const help = 'Write the measured QA numbers and the results card (numbers.json, card.md).';

export const ESTIMATE_METHOD = (n) => `estimate from ${n} measured frames, Claude API list prices`;
export const HOUSE_METHOD = `estimate: Opus 5.5 critics viewing the same frames, at the rate measured on Levanto's reference build ($${HOUSE_REVIEW.usd_per_frame} and ${HOUSE_REVIEW.seconds_per_frame} s per frame view: ${HOUSE_REVIEW.source}), scaled linearly to the frames Sage read; another film, not a measurement of this video; Claude API list prices`;
const runUsd = (r, plan) => (r?.usage ? sageUsd(r.usage, r.plan || plan) : (r?.usd || 0));

const exists = (p) => { try { return fs.existsSync(p); } catch { return false; } };
const dirsOf = (qa, prefix) => { try { return fs.readdirSync(qa, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name.startsWith(prefix)).map((d) => path.join(qa, d.name)).sort(); } catch { return []; } };

export function openedImages(file) {
  const j = readJson(file);
  const list = Array.isArray(j) ? j : (j.images || j.opened || j.opened_by_opus || []);
  return list.map((x) => (typeof x === 'string' ? x : x.frame !== undefined && x.frame !== null ? `frame:${x.frame}` : x.sha256 || x.hash || x.path || x.id || JSON.stringify(x)));
}

export { fmtUsd, fmtSeconds };

// Pure: the numbers object from what the files hold. Used by the command and by the unit tests.
export function computeNumbers({ sweeps = [], triages = [], gates = [], opened = [], openedRecorded = opened.length > 0, critics = null, baseline = null, plan = 'developer' }) {
  const shas = new Set([...sweeps, ...gates].map((x) => x.video_sha256_12).filter(Boolean));
  if (baseline && baseline.video_sha256_12) shas.add(baseline.video_sha256_12);
  const out = { problems: [], video_sha256_12: shas.size === 1 ? [...shas][0] : null };
  if (shas.size > 1) out.problems.push(`the runs come from ${shas.size} different videos (${[...shas].join(', ')}); numbers from different videos are never added`);
  const sweepUsd = sweeps.reduce((a, s) => a + runUsd(s, plan), 0);
  const triageUsd = triages.reduce((a, t) => a + runUsd(t, plan), 0);
  const gateTokens = (g) => (g.billed_input_tokens || 0) + (g.image_tokens || 0) + (g.output_tokens || 0);
  const gateUsd = gates.reduce((a, g) => a + (gateTokens(g) ? sageUsd({ billed_input_tokens: g.billed_input_tokens, image_tokens: g.image_tokens, output_tokens: g.output_tokens }, g.plan || plan) : (g.usd || 0)), 0);
  const seconds = [...sweeps, ...triages, ...gates].reduce((a, r) => a + (r.seconds || 0), 0);
  const distinct = new Set(opened);
  out.sagecut = {
    frames_read: sweeps.length ? Math.max(...sweeps.map((s) => s.frames_read || 0)) : 0,
    qa_seconds: Number(seconds.toFixed(1)),
    sage_usd: Number((sweepUsd + triageUsd + gateUsd).toFixed(6)),
    sage_usd_parts: { sweep: Number(sweepUsd.toFixed(6)), triage: Number(triageUsd.toFixed(6)), gate: Number(gateUsd.toFixed(6)) },
    sage_plan: plan,
    critics_usd: critics ? critics.usd : null,
    critics_price_unknown: critics ? critics.price_unknown : [],
    critics_tokens: critics ? critics.tokens : null,
    critics_agents: critics ? critics.agents : 0,
    critics_image_views: critics ? critics.image_views : null,
    critics_distinct_images: critics ? critics.distinct_images : null,
    frames_opened_by_claude: openedRecorded ? distinct.size : null,   // null: no opened.json, so nothing was recorded
    critics_seconds: critics && Number.isFinite(critics.seconds) ? Number(critics.seconds.toFixed(1)) : null,
    sage_asked: gates.reduce((a, g) => a + (g.sage_asked || 0), 0),
    sage_errors: gates.reduce((a, g) => a + (g.sage_errors || 0), 0),
  };
  const sum = (xs) => (xs.length ? Number(xs.reduce((a, x) => a + (x || 0), 0).toFixed(1)) : null);
  out.time_by_step = {
    render_seconds: null,
    gate_seconds: sum(gates.map((g) => g.seconds)),
    sweep_seconds: sum(sweeps.map((s) => s.seconds)),
    triage_seconds: sum(triages.map((x) => x.seconds)),
    critics_seconds: out.sagecut.critics_seconds,
    baseline_seconds: baseline && Number.isFinite(baseline.seconds) ? Number(baseline.seconds.toFixed(1)) : null,
  };
  const t = triages[triages.length - 1];
  if (t) out.triage = { residual_runs: t.residual_runs, counts: t.counts };
  const b = baseline;
  if (b && b.usd_per_frame !== null && b.usd_per_frame !== undefined && !out.problems.length && out.sagecut.frames_read > 0) {
    const n = b.frames_reviewed;
    out.old_review_estimate = {
      estimate: true, baseline_frames: n, baseline_id: b.id, frames: out.sagecut.frames_read,
      usd: Number((b.usd_per_frame * out.sagecut.frames_read).toFixed(2)),
      seconds: Math.round(b.seconds_per_frame * out.sagecut.frames_read),
      usd_per_frame: b.usd_per_frame, seconds_per_frame: b.seconds_per_frame,
      method: ESTIMATE_METHOD(n),
    };
  } else if (!b && !out.problems.length && out.sagecut.frames_read > 0) {
    const f = out.sagecut.frames_read;
    out.old_review_estimate = {
      estimate: true, reference: 'house', frames: f,
      usd: Number((HOUSE_REVIEW.usd_per_frame * f).toFixed(2)),
      seconds: Math.round(HOUSE_REVIEW.seconds_per_frame * f),
      usd_per_frame: HOUSE_REVIEW.usd_per_frame, seconds_per_frame: HOUSE_REVIEW.seconds_per_frame,
      method: HOUSE_METHOD,
    };
  } else out.old_review_estimate = null;
  out.baseline_note = out.old_review_estimate ? null
    : out.problems.length ? 'the runs are not all from the same video: no comparison is shown'
      : !out.sagecut.frames_read ? 'no sweep: Sage read no frames, so no comparison is shown'
        : `the baseline model has no list price (${(b.price_unknown || []).join(', ')}): no comparison is shown`;
  return out;
}

export function renderCard(n, runsUsed) {
  const s = n.sagecut; const L = ['# SageCut results', ''];
  L.push('## SageCut (measured)', '');
  L.push(`- Frames Sage read: ${s.frames_read}`);
  L.push(`- QA time: ${fmtSeconds(s.qa_seconds)}`);
  L.push(`- Sage cost: ${fmtUsd(s.sage_usd)} (${s.sage_plan} plan rate)`);
  L.push(`- Critics' cost: ${s.critics_usd === null ? (s.critics_price_unknown.length ? `price unknown for ${s.critics_price_unknown.join(', ')}` : 'not measured') : `${fmtUsd(s.critics_usd)} at Claude API list prices`}`);
  L.push(s.frames_opened_by_claude === null ? '- Frames recorded as opened by Claude: not recorded (no opened.json in the run)' : `- Frames recorded as opened by Claude (from opened.json): ${s.frames_opened_by_claude}`);
  if (s.critics_image_views !== null) L.push(`- Critics' image views: ${s.critics_image_views} (${s.critics_distinct_images} different images)`);
  if (s.sage_asked) L.push(`- Sage questions with no answer (errors): ${s.sage_errors} of ${s.sage_asked}`);
  if (n.triage) L.push(`- Open items after triage: ${Object.entries(n.triage.counts).map(([k, v]) => `${v} ${k}`).join(', ')}`);
  L.push('');
  L.push('## The old review of the same frames (estimate)', '');
  const e = n.old_review_estimate;
  if (e) {
    L.push(`- Time: ${fmtSeconds(e.seconds)} (estimate)`);
    L.push(`- Cost: ${fmtUsd(e.usd)} (estimate)`);
    L.push(`- Method: ${e.method}.`);
    L.push(e.reference === 'house'
      ? `- The same ${e.frames} frames that Sage read, at ${fmtUsd(e.usd_per_frame)} and ${e.seconds_per_frame} s per frame view (the reference build's rate, scaled linearly).`
      : `- The same ${e.frames} frames that Sage read; ${fmtSeconds(e.seconds_per_frame)} and ${fmtUsd(e.usd_per_frame)} per frame, measured on ${e.baseline_frames} frames.`);
  } else L.push(`- ${n.baseline_note || 'not available'}.`);
  const tb = n.time_by_step || {};
  const step = (label, v) => `- ${label}: ${v === null || v === undefined ? 'not measured' : fmtSeconds(v)}`;
  L.push('', '## Time by step', '');
  L.push('- Render: not measured by SageCut');
  L.push(step('Gate', tb.gate_seconds), step('Sweep', tb.sweep_seconds), step('Triage', tb.triage_seconds));
  L.push(step('Critics', tb.critics_seconds), step('Baseline', tb.baseline_seconds));
  L.push('', '## Sources', '');
  for (const r of runsUsed) L.push(`- ${r}`);
  if (n.problems.length) { L.push('', '## Problems', ''); for (const p of n.problems) L.push(`- ${p}`); }
  return L.join('\n') + '\n';
}

// `--runs A B C` -> `--runs A --runs B --runs C` (parseArgs only takes one value per flag).
export function expandRuns(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--runs') { out.push(argv[i]); continue; }
    while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out.push('--runs', argv[++i]);
  }
  return out;
}

export async function run(argv, { root, config }) {
  const { values } = parseArgs({ args: expandRuns(argv), allowPositionals: true, options: {
    root: { type: 'string' }, runs: { type: 'string', multiple: true }, 'critics-marker': { type: 'string' }, baseline: { type: 'string' },
    json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } });
  if (values.help) {
    console.log('usage: sagecut numbers [--runs DIR ...] [--critics-marker M] [--baseline DIR] [--json]\n\n' +
      'Writes sagecut/qa/numbers.json and card.md from the QA files. Default runs: the newest sweep folder (with its triage) and the newest\n' +
      'gate folder. Pass --runs for the runs of the exact file you deliver. The old review is estimated at the reference rate\n' +
      '(src/core/costs.mjs); --baseline DIR uses a measured sample of this video instead.');
    return 0;
  }
  if (values.json) setQuiet(true);
  const qa = qaDir(root);
  let runDirs = (values.runs || []).map((d) => path.resolve(d));
  if (!runDirs.length) {
    const sw = dirsOf(qa, 'sweep-').filter((d) => exists(path.join(d, 'sweep.json'))).pop();
    const gt = dirsOf(qa, 'gate-').filter((d) => exists(path.join(d, 'findings.json'))).pop();
    runDirs = [sw, gt].filter(Boolean);
  }
  if (!runDirs.length) throw new Error('no QA runs found in sagecut/qa. Run "sagecut sweep <video>" first, or pass --runs DIR.');
  const sweeps = []; const triages = []; const gates = []; const opened = []; const used = []; let openedRecorded = false;
  for (const d of runDirs) {
    if (!exists(d)) throw new Error(`run folder not found: ${d}`);
    const rel = path.relative(root, d) || d;
    let hit = false;
    if (exists(path.join(d, 'sweep.json'))) { const j = readJson(path.join(d, 'sweep.json')); sweeps.push({ ...j, rows: undefined }); used.push(`${rel}/sweep.json`); hit = true; }
    if (exists(path.join(d, 'triage.json'))) { triages.push(readJson(path.join(d, 'triage.json'))); used.push(`${rel}/triage.json`); hit = true; }
    if (exists(path.join(d, 'findings.json'))) {
      const f = readJson(path.join(d, 'findings.json')); const sg = f.sage || {};
      gates.push({ video: f.video, video_sha256_12: f.video_sha256_12, usd: sg.usd, billed_input_tokens: sg.billed_input_tokens || 0, image_tokens: sg.image_tokens || 0, output_tokens: sg.output_tokens || 0, seconds: Number(f.seconds || 0),
        sage_asked: f.sage_asked || 0, sage_errors: (f.sage_errors || []).length });
      used.push(`${rel}/findings.json`); hit = true;
    }
    for (const of of [path.join(d, 'opened.json'), path.join(d, 'triage', 'opened.json')]) {
      if (exists(of)) { opened.push(...openedImages(of)); openedRecorded = true; used.push(path.relative(root, of) || of); hit = true; }
    }
    if (!hit) throw new Error(`${rel} holds no sweep.json, triage.json, findings.json or opened.json`);
  }
  let critics = null;
  if (values['critics-marker']) {
    critics = await measureMarker(values['critics-marker']);
    if (!critics.agents) throw new Error(`no Claude Code sub-agent file contains ${values['critics-marker']}. Start each critic with that line in its prompt.`);
    used.push(`${critics.agents} critic session file(s) with ${values['critics-marker']}`);
  }
  let baseline = null;
  const bdir = values.baseline ? path.resolve(values.baseline) : null;      // only an explicit baseline replaces the reference rate
  if (bdir && exists(path.join(bdir, 'baseline.json'))) { baseline = readJson(path.join(bdir, 'baseline.json')); used.push(`${path.relative(root, bdir) || bdir}/baseline.json`); }
  else if (bdir) throw new Error(`no baseline.json in ${bdir}. Run "sagecut baseline measure <marker>" first.`);
  if (!baseline) used.push(`reference rate for the old review: src/core/costs.mjs HOUSE_REVIEW (${HOUSE_REVIEW.source})`);

  const n = computeNumbers({ sweeps, triages, gates, opened, openedRecorded, critics, baseline, plan: config.plan });
  n.generated = new Date().toISOString();
  n.sources = used;
  writeJson(path.join(qa, 'numbers.json'), n);
  const card = renderCard(n, used);
  fs.writeFileSync(path.join(qa, 'card.md'), card);
  // A delivered film version: one ledger row per video hash, replaced when the numbers are run again.
  const row = n.problems.length ? null : savingsRow(n, { video: gates.find((g) => g.video)?.video });
  if (row) upsertRow(row);
  if (values.json) console.log(JSON.stringify(n));
  else { say(card); if (row) say(deliveryLine(row)); }
  return n.problems.length ? 2 : 0;
}
