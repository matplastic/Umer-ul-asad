// Netlify Function — "preview it / send it now" link for the Daily Store Report.
// Protected by a secret key (Netlify env var DAILY_REPORT_KEY). If that variable is not set, this link is switched off.
//
//   https://YOUR-SITE/.netlify/functions/daily-report-run?key=SECRET&preview=1     -> shows the report in the browser, sends nothing
//   https://YOUR-SITE/.netlify/functions/daily-report-run?key=SECRET               -> e-mails today's report right now
//   add &day=2026-11-26 to cover a different day
const crypto = require('crypto');
const { runDailyReport } = require('./lib/dailyReportCore.cjs');

const same = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const page = (statusCode, contentType, body) => ({ statusCode, headers: { 'Content-Type': contentType, 'Cache-Control': 'no-store' }, body });

exports.handler = async (event) => {
  const secret = process.env.DAILY_REPORT_KEY;
  if (!secret) return page(404, 'text/plain; charset=utf-8', 'Not found');
  const q = event.queryStringParameters || {};
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { /* query only */ }
  const key = q.key || body.key || '';
  if (!key || !same(key, secret)) return page(401, 'text/plain; charset=utf-8', 'Wrong or missing key.');

  try {
    const siteUrl = process.env.APP_BASE_URL || process.env.URL || `https://${event.headers.host}`;
    const preview = String(q.preview || body.preview || '') === '1';
    const result = await runDailyReport({ mode: preview ? 'preview' : 'manual', day: q.day || body.day || '', siteUrl });
    if (preview && result.html) return page(200, 'text/html; charset=utf-8', result.html);
    return page(result.ok ? 200 : 500, 'application/json', JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('[daily-report-run] Error:', err);
    return page(500, 'application/json', JSON.stringify({ error: err.message || 'Something went wrong.' }));
  }
};
