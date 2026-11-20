// Netlify Function — server-side sign-in (Phase 1 of moving to real Firebase Auth).
//
// WHY: until now the browser downloaded every account (with password hashes)
// from Firestore, checked the password itself, and saved a role in localStorage.
// Here the password is checked on the server and Firebase issues a signed
// sign-in token that CARRIES the user's role (request.auth.token.role), which
// Firestore security rules can then trust. Nothing is trusted from the browser.
//
// Works with your EXISTING passwords: the browser uses PBKDF2-SHA256 (100,000
// rounds, hex salt/hash), and this function verifies the same format.
//
// Needs (already set for your other functions):
//   FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY
const crypto = require('crypto');

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

function adminApp() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  if (!getApps().length) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
    if (!projectId || !clientEmail || !privateKey) throw new Error('Firebase Admin credentials are not configured.');
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  }
}

function passwordMatches(password, hashHex, saltHex) {
  try {
    const candidate = crypto.pbkdf2Sync(password, Buffer.from(saltHex, 'hex'), 100000, 32, 'sha256');
    const stored = Buffer.from(hashHex, 'hex');
    return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
  } catch {
    return false;
  }
}

const normalize = (raw) => String(raw || '').trim().toLowerCase().replace(/\s+/g, '.');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Bad request' }); }
  const username = normalize(body.username);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!username || !password) return json(400, { error: 'Enter your username and password.' });

  try {
    adminApp();
    const { getFirestore } = require('firebase-admin/firestore');
    const { getAuth } = require('firebase-admin/auth');

    const snap = await getFirestore().collection('system_state').doc('authUsers').get();
    const accounts = snap.exists && Array.isArray(snap.data().data) ? snap.data().data : [];
    const account = accounts.find((a) => a.username === username);

    // Same message for "no such user" and "wrong password" so usernames can't be guessed.
    if (!account || !passwordMatches(password, account.passwordHash, account.passwordSalt)) {
      await sleep(600); // slows down guessing
      return json(401, { error: 'Invalid username or password.' });
    }
    if (!account.active) return json(403, { error: 'This account has been disabled. Contact HR or Management.' });

    const token = await getAuth().createCustomToken(account.id, {
      role: account.role,
      username: account.username,
      userId: account.id,
    });

    const { passwordHash, passwordSalt, ...user } = account;
    return json(200, { user: { ...user, lastLoginAt: new Date().toISOString() }, token });
  } catch (err) {
    console.error('[auth-login] Error:', err);
    return json(500, { error: 'Sign-in service unavailable.' });
  }
};
