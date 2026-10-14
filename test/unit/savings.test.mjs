import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { savingsRow, upsertRow, readRows, totals, deliveryLine, sessionLine, startSession, takeFresh, readSession } from '../../src/core/savings.mjs';

// Every test writes to its own folder, so the real ~/.sagecut is never touched.
function home() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sagecut-savings-'));
  process.env.SAGECUT_HOME = dir;
  return dir;
}

const numbers = (over = {}) => ({
  video_sha256_12: 'aaaaaaaaaaaa',
  sagecut: { frames_read: 300, sage_usd: 0.0066, qa_seconds: 122, critics_usd: 0.363, ...over.sagecut },
  old_review_estimate: { usd: 3.97, seconds: 549, ...over.old },
});

test('savingsRow: SageCut cost includes the critics; saved = old review minus SageCut', () => {
  const r = savingsRow(numbers(), { video: '/x/out/test.mp4', ts: '2026-10-13T10:00:00.000Z' });
  assert.equal(r.sagecut_usd, 0.3696);
  assert.equal(r.saved_usd, 3.6004);
  assert.equal(r.sagecut_seconds, 122);
  assert.equal(r.saved_seconds, 427);
  assert.equal(r.video, 'test.mp4');
  assert.equal(r.critics_measured, true);
});

test('savingsRow: no estimate means no row; no critics means the row says so', () => {
  assert.equal(savingsRow({ ...numbers(), old_review_estimate: null }), null);
  assert.equal(savingsRow({ ...numbers(), video_sha256_12: null }, { sha: undefined }), null);
  const r = savingsRow(numbers({ sagecut: { critics_usd: null } }));
  assert.equal(r.critics_measured, false);
  assert.equal(r.sagecut_usd, 0.0066);
});

test('upsertRow: one row per video hash; a second run replaces the first', () => {
  const file = path.join(home(), 'savings.jsonl');
  upsertRow({ sha: 'a', ts: '2026-10-13T10:00:00Z', saved_usd: 1 }, file);
  upsertRow({ sha: 'b', ts: '2026-10-13T11:00:00Z', saved_usd: 2 }, file);
  upsertRow({ sha: 'a', ts: '2026-10-13T12:00:00Z', saved_usd: 5 }, file);
  const rows = readRows(file);
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.sha === 'a').saved_usd, 5);
});

test('totals: sums all rows, or only rows at or after a session start', () => {
  const rows = [
    { ts: '2026-10-13T09:00:00Z', frames: 300, sagecut_usd: 1, sagecut_seconds: 60, old_usd: 4, old_seconds: 300, saved_usd: 3, saved_seconds: 240 },
    { ts: '2026-10-13T11:00:00Z', frames: 300, sagecut_usd: 0.5, sagecut_seconds: 30, old_usd: 2, old_seconds: 100, saved_usd: 1.5, saved_seconds: 70 },
  ];
  assert.equal(totals(rows).films, 2);
  assert.equal(totals(rows).saved_usd, 4.5);
  const since = totals(rows, '2026-10-13T10:00:00Z');
  assert.equal(since.films, 1);
  assert.equal(since.saved_seconds, 70);
});

test('lines name the estimate and the basis', () => {
  const row = savingsRow(numbers(), { video: 'test.mp4', ts: '2026-10-13T10:00:00Z' });
  assert.match(deliveryLine(row), /^Saved on this video: about \$3\.60 and 7 min 7 s \(estimate\)\. /);
  assert.match(deliveryLine(row), /SageCut: \$0\.3696 in 2 min 2 s \(measured\)/);
  assert.match(deliveryLine(row), /estimate from a measured sample of this video, Claude API list prices/);
  const house = savingsRow(numbers({ old: { reference: 'house' } }), { video: 'test.mp4', ts: '2026-10-13T10:00:00Z' });
  assert.equal(house.old_basis, 'house');
  assert.match(deliveryLine(house), /rate measured on Levanto's reference build, Claude API list prices/);
  const noCritics = savingsRow(numbers({ sagecut: { critics_usd: null } }), { video: 'test.mp4', ts: '2026-10-13T10:00:00Z' });
  assert.match(deliveryLine(noCritics), /The critics were not measured/);
  const line = sessionLine(totals([row], null));
  assert.match(line, /^SageCut this session: 1 video\. /);
  assert.match(sessionLine(totals([], null), 'SageCut, all videos'), /^SageCut, all videos: 0 videos\./);
});

test('time saved subtracts the critics time too', () => {
  const r = savingsRow(numbers({ sagecut: { critics_seconds: 100 } }), { video: 'test.mp4', ts: '2026-10-13T10:00:00Z' });
  assert.equal(r.sagecut_seconds, 222);            // 122 s of QA commands + 100 s of critics
  assert.equal(r.saved_seconds, 549 - 222);        // the old review minus all of SageCut's time
});

test('takeFresh: a Stop hook announces each new row once per session', () => {
  const dir = home();
  const sessFile = path.join(dir, 'session.json');
  const rowsFile = path.join(dir, 'savings.jsonl');
  assert.deepEqual(takeFresh(sessFile, rowsFile).fresh, []);            // no session started yet

  startSession('2026-10-13T10:00:00.000Z', sessFile);
  upsertRow({ sha: 'a', ts: '2026-10-13T10:30:00.000Z', saved_usd: 1 }, rowsFile);
  upsertRow({ sha: 'old', ts: '2026-10-13T09:00:00.000Z', saved_usd: 9 }, rowsFile);   // before this session
  assert.equal(takeFresh(sessFile, rowsFile).fresh.length, 1);
  assert.equal(takeFresh(sessFile, rowsFile).fresh.length, 0);          // already shown

  upsertRow({ sha: 'a', ts: '2026-10-13T11:00:00.000Z', saved_usd: 2 }, rowsFile);   // same film, numbers run again
  assert.equal(takeFresh(sessFile, rowsFile).fresh.length, 1);
  assert.equal(readSession(sessFile).shown.length, 2);
});

test('a video with no saving says so, never "about $-X"', () => {
  const row = savingsRow(numbers({ old: { usd: 0.1, seconds: 60 } }), { video: 'test.mp4', ts: '2026-10-13T10:00:00Z' });
  assert.ok(row.saved_usd < 0 && row.saved_seconds < 0);
  assert.match(deliveryLine(row), /^No saving on this video \(estimate\)\. /);
  assert.doesNotMatch(deliveryLine(row), /\$-/);
});

test('totals recompute the saving from both sides of each row', () => {
  const row = { ts: '2026-10-13T09:00:00Z', frames: 300, sagecut_usd: 1, sagecut_seconds: 160, old_usd: 4, old_seconds: 300, saved_usd: 3, saved_seconds: 240 };
  assert.equal(totals([row]).saved_seconds, 140);      // 300 - 160, not the stored 240
});
