// sagecut savings show | session-start | stop: the savings ledger, and the two plugin hooks that use it.
import { say } from '../core/log.mjs';
import { readRows, readSession, totals, sessionLine, startSession, takeFresh } from '../core/savings.mjs';

export const help = 'savings so far (show); the plugin hooks (session-start, stop)';

export async function run(argv) {
  const sub = argv[0] || 'show';
  if (sub === 'session-start') {
    try { startSession(); } catch { /* never fail the session */ }
    return 0;
  }
  if (sub === 'stop') {
    try {
      const { sess, fresh, rows } = takeFresh();
      if (sess && fresh.length) process.stdout.write(JSON.stringify({ systemMessage: sessionLine(totals(rows, sess.startedAt)) }) + '\n');
    } catch { /* never fail the session */ }
    return 0;
  }
  if (sub !== 'show') { console.error(`sagecut savings: unknown "${sub}". Use show, session-start or stop.`); return 2; }
  const sess = readSession();
  const rows = readRows();
  if (!rows.length) { say('No delivered video has savings yet. Savings appear after "sagecut numbers" runs on a video that Sage swept.'); return 0; }
  say(sess ? sessionLine(totals(rows, sess.startedAt)) : sessionLine(totals(rows, null), 'SageCut, all videos'));
  return 0;
}
