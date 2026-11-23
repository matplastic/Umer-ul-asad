// Netlify Scheduled Function — every morning (08:00 UAE time, see netlify.toml) checks all HR expiry
// dates and e-mails anything that has newly entered a reminder window. Scheduled functions only run on
// the published (production) deploy.
const { runHrExpiryCheck } = require('./lib/hrExpiryCore.cjs');

exports.handler = async () => {
  try {
    const siteUrl = process.env.APP_BASE_URL || process.env.URL || '';
    const result = await runHrExpiryCheck({ mode: 'scheduled', siteUrl });
    console.log('[hr-expiry-scheduled]', JSON.stringify({ ok: result.ok, sent: result.sent, skipped: result.skipped, summary: result.summary }));
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (err) {
    console.error('[hr-expiry-scheduled] Error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
