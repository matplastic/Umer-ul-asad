// Netlify Function — called by the app (debounced) right after the materials
// list is written, so Reorder / Urgent e-mails go out within seconds of a
// stock drop. Safe to call as often as you like: it only e-mails when a
// material has newly crossed a level (see lib/stockAlertCore.cjs).
const { runStockAlertCheck } = require('./lib/stockAlertCore.cjs');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  try {
    const siteUrl = process.env.APP_BASE_URL || process.env.URL || `https://${event.headers.host}`;
    const result = await runStockAlertCheck({ siteUrl });
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (err) {
    console.error('[stock-alert-check] Error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
