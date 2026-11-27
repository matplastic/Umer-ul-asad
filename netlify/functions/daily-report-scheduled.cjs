// Netlify Scheduled Function — every morning at 07:00 UAE time (schedule is in netlify.toml) e-mails the
// Daily Store Report for YESTERDAY: consumption, incoming material, QC waiting list and current stock.
// Scheduled functions only run on the published (production) deploy.
const { runDailyReport } = require('./lib/dailyReportCore.cjs');

exports.handler = async () => {
  try {
    const siteUrl = process.env.APP_BASE_URL || process.env.URL || '';
    const result = await runDailyReport({ mode: 'scheduled', siteUrl });
    console.log('[daily-report-scheduled]', JSON.stringify({ ok: result.ok, sent: result.sent, skipped: result.skipped, day: result.day }));
    return { statusCode: 200, body: JSON.stringify({ ok: result.ok, sent: result.sent, skipped: result.skipped, day: result.day }) };
  } catch (err) {
    console.error('[daily-report-scheduled] Error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
