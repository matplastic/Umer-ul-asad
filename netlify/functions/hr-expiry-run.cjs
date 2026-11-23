// Netlify Function — used by the HR screen (Expiry Reminders): check what is due, send a test e-mail, send now.
// Only signed-in HR Executive / Management accounts may call it (Firebase ID token is verified).
const { runHrExpiryCheck } = require('./lib/hrExpiryCore.cjs');
const { verifyIdToken } = require('./auth-admin.cjs');

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const ALLOWED_ROLES = ['management', 'hr_portal'];

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Bad request' }); }
  const action = String(body.action || '');
  if (!['status', 'preview', 'test', 'send'].includes(action)) return json(400, { error: 'Unknown action' });

  const header = event.headers.authorization || event.headers.Authorization || '';
  const idToken = header.startsWith('Bearer ') ? header.slice(7) : '';
  try {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    if (!projectId) throw new Error('Firebase Admin credentials are not configured.');
    let claims;
    try { claims = await verifyIdToken(idToken, projectId); } catch { return json(401, { error: 'Please sign in again.' }); }

    const db = require('./lib/dailyRequestUsage.cjs').getAdminDb();
    const snap = await db.collection('system_state').doc('authUsers').get();
    const list = snap.exists && Array.isArray(snap.data().data) ? snap.data().data : [];
    const caller = list.find((a) => a.id === claims.sub && a.active);
    const roles = caller ? [caller.role, ...(caller.allowedRoles || [])] : [];
    if (!caller || !roles.some((r) => ALLOWED_ROLES.includes(r))) return json(403, { error: 'You do not have permission to manage HR reminders.' });

    const siteUrl = process.env.APP_BASE_URL || process.env.URL || `https://${event.headers.host}`;
    const mode = action === 'status' ? 'preview' : action;
    const result = await runHrExpiryCheck({ mode, force: !!body.force, siteUrl });
    if (action === 'status') delete result.items;
    return json(200, result);
  } catch (err) {
    console.error('[hr-expiry-run] Error:', err);
    return json(500, { error: err.message || 'Something went wrong.' });
  }
};
