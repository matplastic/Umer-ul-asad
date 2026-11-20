// Netlify Function — server-side sign-in (Phase 1 of moving to real Firebase Auth).
//
// WHY: until now the browser downloaded every account (with password hashes)
// from Firestore, checked the password itself, and saved a role in localStorage.
// Here the password is checked on the server and Firebase receives a signed
// sign-in token that CARRIES the user's role (request.auth.token.role), which
// Firestore security rules can then trust.
//
// Works with your EXISTING passwords: PBKDF2-SHA256, 100,000 rounds, hex salt/hash.
//
// NOTE: the sign-in token is built with Node's own crypto instead of
// firebase-admin/auth, because that module pulls in `jwks-rsa`, which fails to
// load on this Netlify runtime (ERR_REQUIRE_ESM). The token format is Firebase's
// documented "custom token": an RS256 JWT signed with the service-account key.
//
// Needs (already set for your other functions):
//   FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY
const crypto = require('crypto');

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

const b64url = (input) =>
  Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

function readServiceAccount() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').trim();
  if ((privateKey.startsWith('"') && privateKey.endsWith('"')) || (privateKey.startsWith("'") && privateKey.endsWith("'"))) {
    privateKey = privateKey.slice(1, -1);
  }
  privateKey = privateKey.replace(/\\n/g, '\n');
  if (!projectId || !clientEmail || !privateKey) throw new Error('Firebase Admin credentials are not configured.');
  return { projectId, clientEmail, privateKey };
}

// Firebase custom token: RS256 JWT, valid up to 1 hour, claims <= 1000 bytes.
function makeCustomToken({ clientEmail, privateKey }, uid, claims) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: clientEmail,
    sub: clientEmail,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: now,
    exp: now + 3600,
    uid,
    claims,
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(privateKey);
  return `${unsigned}.${b64url(signature)}`;
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
    const sa = readServiceAccount();
    const { initializeApp, getApps, cert } = require('firebase-admin/app');
    const { getFirestore } = require('firebase-admin/firestore');
    if (!getApps().length) {
      initializeApp({ credential: cert({ projectId: sa.projectId, clientEmail: sa.clientEmail, privateKey: sa.privateKey }) });
    }
    const db = getFirestore();
    const ref = db.collection('system_state').doc('authUsers');

    const snap = await ref.get();
    const accounts = snap.exists && Array.isArray(snap.data().data) ? snap.data().data : [];
    const account = accounts.find((a) => a.username === username);

    // Same message for "no such user" and "wrong password" so usernames can't be guessed.
    if (!account || !passwordMatches(password, account.passwordHash, account.passwordSalt)) {
      await sleep(600); // slows down guessing
      return json(401, { error: 'Invalid username or password.' });
    }
    if (!account.active) return json(403, { error: 'This account has been disabled. Contact HR or Management.' });

    // Firebase limits custom claims to 1000 bytes; the full portal list is
    // included when it fits so security rules can honour multi-portal accounts.
    const claims = { role: account.role, username: account.username, userId: account.id };
    const allowed = Array.isArray(account.allowedRoles) && account.allowedRoles.length ? account.allowedRoles : [account.role];
    if (JSON.stringify({ ...claims, allowedRoles: allowed }).length <= 900) claims.allowedRoles = allowed;
    const token = makeCustomToken(sa, account.id, claims);

    const now = new Date().toISOString();
    // Record the login (best effort — never blocks sign-in).
    try {
      await db.runTransaction(async (tx) => {
        const cur = await tx.get(ref);
        const list = cur.exists && Array.isArray(cur.data().data) ? cur.data().data : [];
        if (!list.length) return;
        tx.update(ref, { data: list.map((a) => (a.id === account.id ? { ...a, lastLoginAt: now } : a)) });
      });
    } catch (e) {
      console.warn('[auth-login] Could not record lastLoginAt:', e.message);
    }

    const { passwordHash, passwordSalt, ...user } = account;
    return json(200, { user: { ...user, lastLoginAt: now }, token });
  } catch (err) {
    console.error('[auth-login] Error:', err);
    return json(500, { error: 'Sign-in service unavailable.' });
  }
};

exports.makeCustomToken = makeCustomToken; // exported for testing
