import { signOut as firebaseSignOut, signInAnonymously } from 'firebase/auth';
import { auth, clientDb } from './googleDrive';
import { doc, getDoc, runTransaction } from 'firebase/firestore';
import { getApiUrl } from './firebaseService';
import type { ViewRole } from '../types';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: ViewRole;
  employeeId: string | null;
  active: number;
  mustChangePassword: number;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string | null;
  lastLoginAt: string | null;
  /** Short numeric PIN (4-6 digits) so this person can identify themselves
   *  on a shared shop-floor computer without typing their full username and
   *  password each time — same idea as Team.code for workers. Only meaningful
   *  for section_supervisor accounts today, but kept generic. */
  quickCode?: string | null;
  /** Full set of portals this account is allowed to open. `role` above stays
   *  the "primary" portal — the one they land on right after login, and the
   *  one used by any older single-portal logic elsewhere in the app (kiosk
   *  PIN lookups, station locks, etc). `allowedRoles` is what actually gates
   *  access now: an account can see and switch between EVERY portal listed
   *  here, and nothing else — e.g. an account with
   *  allowedRoles: ['management', 'quality_inspector'] can use those two
   *  portals only, never HR, Store, etc.
   *  Omitted or empty on older accounts — those fall back to just [role],
   *  preserving exactly the old single-portal behavior with no migration
   *  needed. */
  allowedRoles?: ViewRole[] | null;
}

export const ALL_VIEW_ROLES: ViewRole[] = [
  'planning_department', 'production_engineer', 'stage_worker', 'quality_inspector',
  'factory_entrance', 'management', 'section_dashboard', 'trolley_prod', 'hr_portal',
  'store', 'section_supervisor', 'factory_supervisor', 'reports_analytics',
];

/** The actual set of portals an account may use.
 *
 *  - If the admin has EXPLICITLY set `allowedRoles` on this account (even to
 *    just one entry), that list wins — this is what lets an admin create an
 *    account that can ONLY see, say, Management + Quality Assurance, and
 *    nothing else, no matter what its primary `role` is.
 *  - Otherwise (no `allowedRoles` ever set — true for every account created
 *    before this feature existed), fall back to the exact old behavior so
 *    nobody gets locked out by this change: a 'management' account keeps
 *    full access to every portal (that's how it already worked), and every
 *    other role keeps single-portal access to just its own `role`.
 */
export function getAllowedRoles(user: Pick<AuthUser, 'role' | 'allowedRoles'>): ViewRole[] {
  if (user.allowedRoles && user.allowedRoles.length > 0) {
    return Array.from(new Set([user.role, ...user.allowedRoles]));
  }
  if (user.role === 'management') return ALL_VIEW_ROLES; // legacy default: full access, unchanged
  return [user.role]; // legacy default: single-portal, unchanged
}

// Internal shape actually stored in Firestore — same as AuthUser plus the
// password hash/salt, which we always strip before handing records back to
// any caller so a hash never ends up rendered in the UI or kept in memory
// longer than necessary.
interface StoredAuthUser extends AuthUser {
  passwordHash: string;
  passwordSalt: string;
}

const SESSION_KEY = 'apex_logged_in_user';
const AUTH_DOC = 'authUsers';

// ─── Browser-safe password hashing (Web Crypto PBKDF2) ──────────────────────
// authUtils.ts uses Node's `crypto` module and only runs inside server.ts.
// This app also needs to manage accounts with no backend deployed, so this
// is a self-contained equivalent that runs entirely in the browser.

function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBuf(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

async function deriveBits(password: string, salt: Uint8Array): Promise<ArrayBuffer> {
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt as BufferSource, iterations: 100_000, hash: 'SHA-256' }, keyMaterial, 256);
}

async function hashPasswordBrowser(password: string): Promise<{ hash: string; salt: string }> {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const bits = await deriveBits(password, saltBytes);
  return { hash: bufToHex(bits), salt: bufToHex(saltBytes.buffer) };
}

async function verifyPasswordBrowser(password: string, hash: string, salt: string): Promise<boolean> {
  try {
    const bits = await deriveBits(password, hexToBuf(salt));
    return bufToHex(bits) === hash;
  } catch {
    return false;
  }
}

const TEMP_WORDS = [
  'Falcon', 'Harbor', 'Quartz', 'Summit', 'Ember', 'Cedar', 'Marlin', 'Onyx',
  'Ridge', 'Delta', 'Aspen', 'Cobalt', 'Willow', 'Granite', 'Meridian', 'Pioneer',
];

function generateTempPasswordBrowser(): string {
  const word = TEMP_WORDS[Math.floor(Math.random() * TEMP_WORDS.length)];
  const digits = Math.floor(1000 + Math.random() * 9000);
  return `${word}-${digits}`;
}

function normalizeUsernameBrowser(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '.');
}

/** Mirrors authUtils.validatePasswordStrength for the browser-side flows. */
export function validatePasswordStrength(password: string): string | null {
  if (!password || password.length < 8) {
    return 'Password must be at least 8 characters long.';
  }
  return null;
}

// ─── Firestore-direct account store ──────────────────────────────────────────

// Many Firestore security-rule setups require `request.auth != null` for any
// read/write, including on the account list itself. This username/password
// system is intentionally separate from Firebase Auth, so without this there
// would be no `request.auth` at all and every call below would silently fail
// with a permission-denied error the first time someone tries to log in or
// an admin tries to manage accounts. Anonymous auth gives every visitor a
// `request.auth.uid`, which satisfies that kind of rule, while still keeping
// the actual username/password check fully separate and in our own control.
let anonSessionPromise: Promise<void> | null = null;
async function ensureFirebaseSession(): Promise<void> {
  if (auth.currentUser) return;
  if (!anonSessionPromise) {
    anonSessionPromise = signInAnonymously(auth)
      .then(() => undefined)
      .catch((err) => {
        console.warn('[authClient] Anonymous Firebase sign-in failed (Firestore calls may be rejected by security rules if they require auth):', err);
      })
      .finally(() => {
        anonSessionPromise = null;
      });
  }
  await anonSessionPromise;
}

function stripSecret(u: StoredAuthUser): AuthUser {
  const { passwordHash, passwordSalt, ...rest } = u;
  return rest;
}

async function readAllAccounts(): Promise<StoredAuthUser[]> {
  await ensureFirebaseSession();
  const snap = await getDoc(doc(clientDb, 'system_state', AUTH_DOC));
  const data = snap.exists() ? snap.data()?.data : [];
  return Array.isArray(data) ? data : [];
}

/** Transaction-safe read-modify-write, with the same anti-wipe guard used
 *  everywhere else in this app: never let an updater accidentally collapse
 *  a non-empty account list down to nothing. */
async function updateAccounts(updater: (current: StoredAuthUser[]) => StoredAuthUser[]): Promise<StoredAuthUser[]> {
  await ensureFirebaseSession();
  const docRef = doc(clientDb, 'system_state', AUTH_DOC);
  let result: StoredAuthUser[] = [];
  await runTransaction(clientDb, async (tx) => {
    const snap = await tx.get(docRef);
    const current: StoredAuthUser[] = snap.exists() && Array.isArray(snap.data()?.data) ? snap.data()!.data : [];
    result = updater([...current]);
    if (result.length === 0 && current.length > 0) {
      console.warn('[authClient] Refusing to write an empty account list over existing accounts.');
      result = current;
      return;
    }
    tx.set(docRef, { data: result });
  });
  return result;
}

// ─── Backend-first, Firestore-fallback helper ────────────────────────────────
// Mirrors the pattern already used by dbGetPins/dbUpdatePin: if a real API
// server is configured (VITE_API_URL) and reachable, use it. Otherwise — or
// if that call fails for any reason (no server deployed, wrong route, HTML
// fallback page, etc.) — fall back to talking to Firestore directly so the
// feature keeps working with zero backend deployment required.
async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const currentUser = auth.currentUser;
  if (currentUser) {
    try {
      const token = await currentUser.getIdToken();
      headers['Authorization'] = `Bearer ${token}`;
    } catch {
      // no Firebase Auth session in Firestore-direct mode — fine, proceed without it
    }
  }
  return headers;
}

async function tryBackend<T>(path: string, init: RequestInit = {}): Promise<T | null> {
  const base = ((import.meta as any).env?.VITE_API_URL || '').trim();
  if (!base) return null;
  try {
    const response = await fetch(getApiUrl(path), { ...init, headers: { ...(await authHeaders()), ...(init.headers || {}) } });
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) return null; // e.g. SPA index.html fallback — treat as "no backend"
    const data = await response.json().catch(() => null);
    if (data === null) return null;
    if (!response.ok) throw new Error(data?.error || `Request failed (${response.status})`);
    return data as T;
  } catch (err) {
    console.warn(`[authClient] Backend call to ${path} unavailable, using Firestore directly:`, err);
    return null;
  }
}

// ─── Public API (same signatures HRPortal.tsx already expects) ─────────────

export async function loginWithPassword(username: string, password: string): Promise<AuthUser> {
  const backendResult = await tryBackend<{ user: AuthUser }>('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (backendResult) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(backendResult.user));
    return backendResult.user;
  }

  const normalized = normalizeUsernameBrowser(username);
  let accounts: StoredAuthUser[];
  try {
    accounts = await readAllAccounts();
  } catch (err: any) {
    console.error('[authClient] Failed to read accounts from Firestore during login:', err);
    if (err?.code === 'permission-denied') {
      throw new Error('Sign-in is blocked by Firestore security rules (permission-denied). Ask an admin to check the rules for the "system_state/authUsers" document.');
    }
    throw new Error('Could not reach the account database. Check your connection and try again.');
  }
  const match = accounts.find(a => a.username === normalized);
  if (!match) throw new Error('Invalid username or password.');
  if (!match.active) throw new Error('This account has been disabled. Contact HR or Management.');

  const ok = await verifyPasswordBrowser(password, match.passwordHash, match.passwordSalt);
  if (!ok) throw new Error('Invalid username or password.');

  const publicUser = stripSecret({ ...match, lastLoginAt: new Date().toISOString() });
  try {
    await updateAccounts(current => current.map(a => a.id === match.id ? { ...a, lastLoginAt: publicUser.lastLoginAt } : a));
  } catch (err) {
    // Don't block sign-in just because the "last login" timestamp couldn't be saved.
    console.warn('[authClient] Failed to record lastLoginAt (non-fatal):', err);
  }

  localStorage.setItem(SESSION_KEY, JSON.stringify(publicUser));
  return publicUser;
}

export function getStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function logout(): Promise<void> {
  localStorage.removeItem(SESSION_KEY);
  try {
    await firebaseSignOut(auth);
  } catch {
    // best-effort — clearing local session is what matters most
  }
}

export async function changeOwnPassword(currentPassword: string, newPassword: string): Promise<void> {
  const backendResult = await tryBackend<void>('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  if (backendResult !== null) return;

  const stored = getStoredUser();
  if (!stored) throw new Error('You must be signed in to change your password.');
  if (newPassword.length < 8) throw new Error('Password must be at least 8 characters long.');

  const accounts = await readAllAccounts();
  const target = accounts.find(a => a.id === stored.id);
  if (!target) throw new Error('Account not found.');

  const ok = await verifyPasswordBrowser(currentPassword, target.passwordHash, target.passwordSalt);
  if (!ok) throw new Error('Current password is incorrect.');

  const { hash, salt } = await hashPasswordBrowser(newPassword);
  await updateAccounts(current => current.map(a =>
    a.id === stored.id ? { ...a, passwordHash: hash, passwordSalt: salt, mustChangePassword: 0, updatedAt: new Date().toISOString() } : a
  ));
}

// ─── HR Portal / Management: account administration ────────────────────────

export async function listUserAccounts(): Promise<AuthUser[]> {
  const backendResult = await tryBackend<AuthUser[]>('/api/users');
  if (backendResult) return Array.isArray(backendResult) ? backendResult : [];

  const accounts = await readAllAccounts();
  return accounts.map(stripSecret);
}

export async function createUserAccount(input: {
  username: string;
  displayName: string;
  role: ViewRole;
  employeeId?: string | null;
  /** If provided, this exact password is set on the account instead of an
   *  auto-generated one. The admin is asserting the person already knows it,
   *  so we don't force a change on first login. */
  password?: string | null;
  /** Every portal this account should be able to open. If omitted, the
   *  account gets single-portal access to just `role` — same as before this
   *  field existed. */
  allowedRoles?: ViewRole[];
}): Promise<{ user: AuthUser; tempPassword: string; isCustomPassword: boolean }> {
  const backendResult = await tryBackend<{ user: AuthUser; tempPassword: string; isCustomPassword?: boolean }>('/api/users', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (backendResult) return { ...backendResult, isCustomPassword: !!backendResult.isCustomPassword };

  const normalized = normalizeUsernameBrowser(input.username);
  if (!normalized) throw new Error('Username is required.');

  const customPassword = (input.password || '').trim();
  const isCustomPassword = customPassword.length > 0;
  if (isCustomPassword) {
    const strengthError = validatePasswordStrength(customPassword);
    if (strengthError) throw new Error(strengthError);
  }

  const finalPassword = isCustomPassword ? customPassword : generateTempPasswordBrowser();
  const { hash, salt } = await hashPasswordBrowser(finalPassword);
  const now = new Date().toISOString();
  const newUser: StoredAuthUser = {
    id: `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    username: normalized,
    displayName: input.displayName.trim(),
    role: input.role,
    allowedRoles: input.allowedRoles && input.allowedRoles.length > 0
      ? Array.from(new Set([input.role, ...input.allowedRoles]))
      : [input.role],
    employeeId: input.employeeId || null,
    active: 1,
    // Only force a change on next login for auto-generated passwords —
    // if the admin set a specific password on purpose, respect it as-is.
    mustChangePassword: isCustomPassword ? 0 : 1,
    createdByName: getStoredUser()?.displayName || null,
    createdAt: now,
    updatedAt: null,
    lastLoginAt: null,
    passwordHash: hash,
    passwordSalt: salt,
  };

  await updateAccounts(current => {
    if (current.some(a => a.username === normalized)) {
      throw new Error(`Username "${normalized}" is already taken.`);
    }
    return [...current, newUser];
  });

  return { user: stripSecret(newUser), tempPassword: finalPassword, isCustomPassword };
}

export async function updateUserAccount(
  id: string,
  patch: Partial<Pick<AuthUser, 'displayName' | 'role' | 'employeeId' | 'active' | 'quickCode' | 'allowedRoles'>>
): Promise<AuthUser> {
  const backendResult = await tryBackend<AuthUser>(`/api/users/${id}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
  if (backendResult) return backendResult;

  let updated: StoredAuthUser | null = null;
  await updateAccounts(current => current.map(a => {
    if (a.id !== id) return a;
    updated = { ...a, ...patch, updatedAt: new Date().toISOString() };
    // Fold the (possibly just-changed) primary role into allowedRoles
    // whenever there's an explicit allowedRoles to work with — either this
    // account already had one (from a prior access-editor save), or this
    // very patch is setting one (the access editor always includes it). If
    // NEITHER is true, leave allowedRoles untouched (still undefined): a
    // plain "change the primary role" edit on a legacy account should keep
    // behaving via the old fallback rules in getAllowedRoles (full access
    // if now 'management', single-portal otherwise) — NOT silently freeze
    // it down to one role just because its role field changed.
    const hadExplicit = a.allowedRoles && a.allowedRoles.length > 0;
    const patchHasExplicit = patch.allowedRoles && patch.allowedRoles.length > 0;
    if (hadExplicit || patchHasExplicit) {
      const base = patchHasExplicit ? patch.allowedRoles! : a.allowedRoles!;
      updated.allowedRoles = Array.from(new Set([updated.role, ...base]));
    }
    return updated;
  }));

  if (!updated) throw new Error('Account not found.');
  return stripSecret(updated);
}

export async function resetUserPassword(id: string, password?: string | null): Promise<{ tempPassword: string; isCustomPassword: boolean }> {
  const backendResult = await tryBackend<{ tempPassword: string; isCustomPassword?: boolean }>(`/api/users/${id}/reset-password`, {
    method: 'POST',
    body: JSON.stringify({ password: password || undefined }),
  });
  if (backendResult) return { ...backendResult, isCustomPassword: !!backendResult.isCustomPassword };

  const customPassword = (password || '').trim();
  const isCustomPassword = customPassword.length > 0;
  if (isCustomPassword) {
    const strengthError = validatePasswordStrength(customPassword);
    if (strengthError) throw new Error(strengthError);
  }

  const finalPassword = isCustomPassword ? customPassword : generateTempPasswordBrowser();
  const { hash, salt } = await hashPasswordBrowser(finalPassword);

  let found = false;
  await updateAccounts(current => current.map(a => {
    if (a.id !== id) return a;
    found = true;
    return { ...a, passwordHash: hash, passwordSalt: salt, mustChangePassword: isCustomPassword ? 0 : 1, updatedAt: new Date().toISOString() };
  }));

  if (!found) throw new Error('Account not found.');
  return { tempPassword: finalPassword, isCustomPassword };
}

/** Looks up an active account by its short quick-code PIN (see AuthUser.quickCode).
 *  Used by the shared shop-floor computer so a supervisor can identify themselves
 *  without typing their full username and password — mirrors how Team.code works
 *  for stage workers. Pass `role` to restrict the search (e.g. 'section_supervisor'). */
export async function findAccountByQuickCode(code: string, role?: ViewRole): Promise<AuthUser | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;
  const accounts = await readAllAccounts();
  const match = accounts.find(a =>
    a.quickCode === trimmed && !!a.active && (!role || a.role === role)
  );
  return match ? stripSecret(match) : null;
}

export async function deactivateUserAccount(id: string): Promise<void> {
  const backendResult = await tryBackend<void>(`/api/users/${id}`, { method: 'DELETE' });
  if (backendResult !== null) return;

  await updateAccounts(current => current.map(a => a.id === id ? { ...a, active: 0, updatedAt: new Date().toISOString() } : a));
}
