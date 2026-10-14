// The one frozen-frame rule. The gate (src/gate/series.mjs) and the delivery check (src/commands/deliver-check.mjs) both use it.
export const FROZEN_MAX_DIFF = 0.25;
export const FROZEN_MIN_SECONDS = 1.5;

export function holdRanges(schedule) {
  const out = [];
  for (const h of (schedule && schedule.static_holds) || []) {
    if (Array.isArray(h) && h.length >= 2) out.push([Number(h[0]), Number(h[1])]);
    else if (h && Array.isArray(h.frames)) out.push([Number(h.frames[0]), Number(h.frames[1])]);
    else if (h && typeof h === 'object') {
      const a = h.start ?? h.from ?? h.in, b = h.end ?? h.to ?? h.out;
      if (a !== undefined && b !== undefined) out.push([Number(a), Number(b)]);
    }
  }
  return out.filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
}

// Is every frame of [s, e] inside the union of the declared holds (2-frame tolerance at each end)?
export function covered(s, e, holds, tol = 2) {
  let pos = s;
  const sorted = [...holds].sort((a, b) => a[0] - b[0]);
  for (const [a, b] of sorted) {
    if (a - tol <= pos && b >= pos) pos = b + 1;
    if (pos > e - tol + 0) break;
  }
  return pos >= e - tol + 1 || pos > e;
}

// Runs of true flags, as [first, last] indexes, at least minLen long.
export function runs(flags, minLen) {
  const out = []; let s = -1;
  for (let i = 0; i <= flags.length; i++) {
    if (i < flags.length && flags[i]) { if (s < 0) s = i; }
    else if (s >= 0) { if (i - s >= minLen) out.push([s, i - 1]); s = -1; }
  }
  return out;
}

export function identicalRuns(diffs, { maxDiff = FROZEN_MAX_DIFF, skip = null } = {}) {
  const flags = Array.from(diffs, (d, f) => f > 0 && d < maxDiff && !(skip && skip[f]));
  return runs(flags, 1).map(([s, e]) => [s - 1, e]);
}

export function longFreezes(diffs, fps, holds = [], skip = null) {
  const limit = Math.ceil(FROZEN_MIN_SECONDS * fps);
  return identicalRuns(diffs, { skip })
    .filter(([s, e]) => e - s + 1 > limit)
    .map(([s, e]) => ({ frames: [s, e], length: e - s + 1, seconds: (e - s + 1) / fps, held: covered(s, e, holds) }));
}
