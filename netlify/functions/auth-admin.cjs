// Netlify Function — account administration (Phase 2 of moving to real Firebase Auth).
//
// Replaces the browser reading/writing the account list (and its password
// hashes) directly in Firestore. Every request must carry the Firebase ID token
// from the server-side sign-in (auth-login). The caller's permissions are then
// read from the STORED account, never trusted from the browser:
//
//   list / create / update / resetPassword / deactivate  → management, hr_portal, hr_admin
//   resetAll (every password)                             → management only
//   changePassword / findByQuickCode                      → any active signed-in account
//
// Extra guard: only Management-level accounts can grant, edit, reset or
// deactivate Management access (stops an HR account promoting itself).
//
// The ID token is verified with Node's crypto (no firebase-admin/auth, which
// fails to load on this runtime — see auth-login.cjs).
const crypto = require('crypto');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

const ADMIN_ROLES = ['management', 'hr_portal', 'hr_admin'];
const TEMP_WORDS = ['Falcon', 'Harbor', 'Quartz', 'Summit', 'Ember', 'Cedar', 'Marlin', 'Onyx',
  'Ridge', 'Delta', 'Aspen', 'Cobalt', 'Willow', 'Granite', 'Meridian', 'Pioneer'];

const normalize = (raw) => String(raw || '').trim().toLowerCase().replace(/\s+/g, '.');
const validRole = (r) => typeof r === 'string' && /^[a-z_]{2,40}$/.test(r);
const unique = (arr) => Array.from(new Set(arr));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rolesOf = (a) => new Set([a.role, ...(Array.isArray(a.allowedRoles) ? a.allowedRoles : [])]);
const isAdmin = (a) => ADMIN_ROLES.some((r) => rolesOf(a).has(r));
const isManagement = (a) => rolesOf(a).has('management');
const publicUser = (a) => { const { passwordHash, passwordSalt, ...rest } = a; return rest; };

// ── Passwords (same PBKDF2-SHA256 / 100k rounds / hex format the app already uses) ──
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  return { passwordHash: hash.toString('hex'), passwordSalt: salt.toString('hex') };
}
function passwordMatches(password, hashHex, saltHex) {
  try {
    const c = crypto.pbkdf2Sync(password, Buffer.from(saltHex, 'hex'), 100000, 32, 'sha256');
    const s = Buffer.from(hashHex, 'hex');
    return c.length === s.length && crypto.timingSafeEqual(c, s);
  } catch { return false; }
}
// Bulk-reset passwords: 8 characters from an alphabet without look-alikes (no 0/O/1/I/L), e.g. K7M2-QX9R
const BULK_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const bulkPassword = () => {
  const part = () => Array.from({ length: 4 }, () => BULK_ALPHABET[crypto.randomInt(BULK_ALPHABET.length)]).join('');
  return `${part()}-${part()}`;
};
const tempPassword = () => `${TEMP_WORDS[crypto.randomInt(TEMP_WORDS.length)]}-${crypto.randomInt(1000, 10000)}`;
const strengthError = (p) => (!p || p.length < 8 ? 'Password must be at least 8 characters long.' : null);

// ── Firebase ID-token verification (RS256, Google's public certificates) ──
let certCache = { certs: null, expires: 0 };
async function getGoogleCerts() {
  if (certCache.certs && Date.now() < certCache.expires) return certCache.certs;
  const res = await fetch('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
  if (!res.ok) throw new Error('Could not load Google signing certificates.');
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') || '')?.[1] || 3600);
  certCache = { certs: await res.json(), expires: Date.now() + maxAge * 1000 };
  return certCache.certs;
}

async function verifyIdToken(idToken, projectId, loadCerts = getGoogleCerts) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new Error('Malformed token');
  const [h, p, s] = parts;
  const header = JSON.parse(Buffer.from(h, 'base64url').toString());
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Bad token header');
  const certs = await loadCerts();
  const pem = certs[header.kid];
  if (!pem) throw new Error('Unknown signing key');
  const publicKey = new crypto.X509Certificate(pem).publicKey;
  const ok = crypto.createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(s, 'base64url'));
  if (!ok) throw new Error('Bad signature');
  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId) throw new Error('Wrong audience');
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('Wrong issuer');
  if (typeof payload.exp !== 'number' || payload.exp <= now) throw new Error('Token expired');
  if (typeof payload.iat !== 'number' || payload.iat > now + 300) throw new Error('Token issued in the future');
  if (!payload.sub || typeof payload.sub !== 'string') throw new Error('No subject');
  return payload;
}

// ── The actions. Pure: takes the stored list, returns the new list + result. ──
function applyAction(action, body, caller, accounts) {
  const now = new Date().toISOString();
  const find = (id) => accounts.find((a) => a.id === id);
  const needAdmin = () => { if (!isAdmin(caller)) throw new HttpError(403, 'You do not have permission to manage accounts.'); };
  const guardGrant = (role, allowed) => {
    if ([role, ...(allowed || [])].includes('management') && !isManagement(caller)) {
      throw new HttpError(403, 'Only Management can give an account Management access.');
    }
  };
  const guardTarget = (t) => {
    if (isManagement(t) && !isManagement(caller)) throw new HttpError(403, 'Only Management can change a Management account.');
  };
  const target = () => {
    const t = find(body.id);
    if (!t) throw new HttpError(404, 'Account not found.');
    guardTarget(t);
    return t;
  };
  const replace = (id, next) => accounts.map((a) => (a.id === id ? next : a));

  switch (action) {
    case 'list':
      needAdmin();
      return { accounts: null, result: { users: accounts.map(publicUser) }, audit: null };

    case 'create': {
      needAdmin();
      const username = normalize(body.username);
      if (!username) throw new HttpError(400, 'Username is required.');
      const displayName = String(body.displayName || '').trim();
      if (!displayName) throw new HttpError(400, 'Display name is required.');
      if (!validRole(body.role)) throw new HttpError(400, 'A valid role is required.');
      const allowedIn = Array.isArray(body.allowedRoles) ? body.allowedRoles.filter(validRole) : [];
      guardGrant(body.role, allowedIn);
      if (accounts.some((a) => a.username === username)) throw new HttpError(409, `Username "${username}" is already taken.`);
      const custom = typeof body.password === 'string' ? body.password.trim() : '';
      if (custom) { const e = strengthError(custom); if (e) throw new HttpError(400, e); }
      const finalPassword = custom || tempPassword();
      const user = {
        id: `user_${Date.now()}_${crypto.randomBytes(4).toString('hex').slice(0, 6)}`,
        username, displayName, role: body.role,
        allowedRoles: allowedIn.length ? unique([body.role, ...allowedIn]) : [body.role],
        employeeId: body.employeeId || null,
        active: 1,
        mustChangePassword: custom ? 0 : 1,
        createdByName: caller.displayName || null,
        createdAt: now, updatedAt: null, lastLoginAt: null,
        ...hashPassword(finalPassword),
      };
      return {
        accounts: [...accounts, user],
        result: { user: publicUser(user), tempPassword: finalPassword, isCustomPassword: !!custom },
        audit: { action: 'create', targetId: user.id, targetUsername: username },
      };
    }

    case 'update': {
      needAdmin();
      const t = target();
      const patch = body.patch && typeof body.patch === 'object' ? body.patch : {};
      const next = { ...t };
      if ('displayName' in patch) {
        const v = String(patch.displayName || '').trim();
        if (!v) throw new HttpError(400, 'Display name is required.');
        next.displayName = v;
      }
      if ('role' in patch) {
        if (!validRole(patch.role)) throw new HttpError(400, 'A valid role is required.');
        next.role = patch.role;
      }
      if ('employeeId' in patch) next.employeeId = patch.employeeId || null;
      if ('active' in patch) next.active = Number(patch.active) ? 1 : 0;
      if ('quickCode' in patch) next.quickCode = patch.quickCode == null ? null : (String(patch.quickCode).trim() || null);
      const patchRoles = Array.isArray(patch.allowedRoles) ? patch.allowedRoles.filter(validRole) : null;
      if (patchRoles) next.allowedRoles = patchRoles;
      // Keep the primary role inside allowedRoles once an explicit list exists.
      const hadExplicit = Array.isArray(t.allowedRoles) && t.allowedRoles.length > 0;
      const patchHasExplicit = !!patchRoles && patchRoles.length > 0;
      if (hadExplicit || patchHasExplicit) {
        next.allowedRoles = unique([next.role, ...(patchHasExplicit ? patchRoles : t.allowedRoles)]);
      }
      guardGrant(next.role, next.allowedRoles);
      next.updatedAt = now;
      return {
        accounts: replace(t.id, next),
        result: { user: publicUser(next) },
        audit: { action: 'update', targetId: t.id, targetUsername: t.username, fields: Object.keys(patch) },
      };
    }

    case 'resetPassword': {
      needAdmin();
      const t = target();
      const custom = typeof body.password === 'string' ? body.password.trim() : '';
      if (custom) { const e = strengthError(custom); if (e) throw new HttpError(400, e); }
      const finalPassword = custom || tempPassword();
      const next = { ...t, ...hashPassword(finalPassword), mustChangePassword: custom ? 0 : 1, updatedAt: now };
      return {
        accounts: replace(t.id, next),
        result: { tempPassword: finalPassword, isCustomPassword: !!custom },
        audit: { action: 'resetPassword', targetId: t.id, targetUsername: t.username },
      };
    }

    case 'deactivate': {
      needAdmin();
      const t = target();
      return {
        accounts: replace(t.id, { ...t, active: 0, updatedAt: now }),
        result: { ok: true },
        audit: { action: 'deactivate', targetId: t.id, targetUsername: t.username },
      };
    }

    case 'resetAll': {
      // Management only — this touches every account, including other admins.
      if (!isManagement(caller)) throw new HttpError(403, 'Only Management can reset every password.');
      const sheet = [];
      let disabledInvalidated = 0;
      const next = accounts.map((a) => {
        if (a.active) {
          const pw = bulkPassword();
          sheet.push({ id: a.id, username: a.username, displayName: a.displayName, role: a.role, tempPassword: pw });
          return { ...a, ...hashPassword(pw), mustChangePassword: 1, updatedAt: now };
        }
        // Disabled accounts get an unknown random password so their old (exposed)
        // hash is useless; an admin must reset them if they are ever re-enabled.
        disabledInvalidated += 1;
        return { ...a, ...hashPassword(crypto.randomBytes(24).toString('hex')), mustChangePassword: 1, updatedAt: now };
      });
      return {
        accounts: next,
        result: { sheet, disabledInvalidated },
        audit: { action: 'resetAll', count: sheet.length, disabledInvalidated },
      };
    }

    case 'changePassword': {
      const current = typeof body.currentPassword === 'string' ? body.currentPassword : '';
      const fresh = typeof body.newPassword === 'string' ? body.newPassword : '';
      if (!passwordMatches(current, caller.passwordHash, caller.passwordSalt)) throw new HttpError(400, 'Current password is incorrect.');
      const e = strengthError(fresh);
      if (e) throw new HttpError(400, e);
      const next = { ...caller, ...hashPassword(fresh), mustChangePassword: 0, updatedAt: now };
      return {
        accounts: replace(caller.id, next),
        result: { ok: true },
        audit: { action: 'changePassword', targetId: caller.id, targetUsername: caller.username },
      };
    }

    case 'findByQuickCode': {
      const code = String(body.code || '').trim();
      const role = body.role ? String(body.role) : null;
      const match = code
        ? accounts.find((a) => a.quickCode === code && !!a.active && (!role || a.role === role))
        : null;
      return { accounts: null, result: { user: match ? publicUser(match) : null }, audit: null };
    }

    default:
      throw new HttpError(400, 'Unknown action.');
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Bad request' }); }
  const action = String(body.action || '');
  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  try {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').trim().replace(/^["']|["']$/g, '').replace(/\\n/g, '\n');
    if (!projectId || !clientEmail || !privateKey) throw new Error('Firebase Admin credentials are not configured.');

    let claims;
    try { claims = await verifyIdToken(idToken, projectId); }
    catch (e) { return json(401, { error: 'Please sign in again.' }); }

    const { initializeApp, getApps, cert } = require('firebase-admin/app');
    const { getFirestore } = require('firebase-admin/firestore');
    if (!getApps().length) initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
    const db = getFirestore();
    const ref = db.collection('system_state').doc('authUsers');

    const outcome = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const list = snap.exists && Array.isArray(snap.data().data) ? snap.data().data : [];
      const caller = list.find((a) => a.id === claims.sub && a.active);
      if (!caller) throw new HttpError(401, 'Account not found or disabled.');
      const r = applyAction(action, body, caller, list);
      if (r.accounts) {
        if (!r.accounts.length && list.length) throw new HttpError(500, 'Refusing to empty the account list.');
        tx.update(ref, { data: r.accounts });
      }
      return { r, caller };
    });

    if (action === 'findByQuickCode' && !outcome.r.result.user) await sleep(400); // slows down guessing

    if (outcome.r.audit) { // simple audit trail; best effort
      try {
        await db.collection('accountAudit').add({
          at: new Date().toISOString(),
          byId: outcome.caller.id,
          byUsername: outcome.caller.username,
          ...outcome.r.audit,
        });
      } catch (e) { console.warn('[auth-admin] audit write failed:', e.message); }
    }
    return json(200, outcome.r.result);
  } catch (err) {
    if (err instanceof HttpError) return json(err.status, { error: err.message });
    console.error('[auth-admin] Error:', err);
    return json(500, { error: 'Account service unavailable.' });
  }
};

exports.applyAction = applyAction;     // exported for testing
exports.verifyIdToken = verifyIdToken; // exported for testing
