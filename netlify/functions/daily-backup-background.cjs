// Netlify BACKGROUND function (the "-background" name is what gives it up to
// 15 minutes instead of ~10 seconds). Netlify answers the caller right away
// with 202 and keeps this running. Started by the nightly scheduled function
// and by the "Back up now" button in Management -> Google Drive Backups.
//
// It only ever WRITES to the system_backups collection, never to app data,
// and ignores a request if a backup already started in the last 15 minutes.
const { runBackup } = require('./lib/backupCore.cjs');

exports.handler = async (event) => {
  let trigger = 'manual';
  try { trigger = (JSON.parse((event && event.body) || '{}').trigger) === 'scheduled' ? 'scheduled' : 'manual'; } catch (_) { /* default */ }
  try {
    const result = await runBackup({ trigger });
    console.log('[daily-backup-background]', JSON.stringify(result));
  } catch (err) {
    console.error('[daily-backup-background] FAILED:', err);
  }
  return { statusCode: 200 };
};
