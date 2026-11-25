// Netlify Scheduled Function — safety net that runs the same stock check every
// 15 minutes (schedule is declared in netlify.toml). It catches anything the
// immediate check missed, e.g. stock edited directly in the Firebase console
// or a device that was offline when its change synced. Scheduled functions
// only run on the published (production) deploy.
const { runStockAlertCheck } = require('./lib/stockAlertCore.cjs');

exports.handler = async () => {
  try {
    const siteUrl = process.env.APP_BASE_URL || process.env.URL || '';
    const result = await runStockAlertCheck({ siteUrl });
    console.log('[stock-alert-scheduled]', JSON.stringify(result));
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (err) {
    console.error('[stock-alert-scheduled] Error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
