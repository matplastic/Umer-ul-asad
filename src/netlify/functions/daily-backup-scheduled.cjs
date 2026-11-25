// Netlify SCHEDULED function — runs every night (schedule is in netlify.toml)
// and starts the background backup function. Scheduled functions only have
// ~30 seconds, a full backup can take longer, hence the hand-off.
// Scheduled functions only run on the published production deploy.
const { runBackup } = require('./lib/backupCore.cjs');

exports.handler = async () => {
  const base = process.env.URL || process.env.APP_BASE_URL || '';
  if (base) {
    try {
      const res = await fetch(`${base.replace(/\/$/, '')}/.netlify/functions/daily-backup-background`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trigger: 'scheduled' }),
      });
      console.log('[daily-backup-scheduled] started background backup, HTTP', res.status);
      if (res.status === 202 || res.ok) return { statusCode: 200 };
    } catch (err) {
      console.error('[daily-backup-scheduled] could not start background function:', err);
    }
  }
  // Fallback: do it here (fine for small databases; the 30 s limit still applies).
  try {
    const result = await runBackup({ trigger: 'scheduled' });
    console.log('[daily-backup-scheduled] ran inline:', JSON.stringify(result));
    return { statusCode: 200 };
  } catch (err) {
    console.error('[daily-backup-scheduled] FAILED:', err);
    return { statusCode: 500 };
  }
};
