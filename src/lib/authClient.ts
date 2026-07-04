import { signOut as firebaseSignOut } from 'firebase/auth';
import { auth, app } from './googleDrive';
import { getFirestore, doc, getDoc, runTransaction } from 'firebase/firestore';
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

// ─── Firestore-direct account store ──────────────────────────────────────────

const clientDb = getFirestore(app);

function stripSecret(u: StoredAuthUser): AuthUser {
  const { passwordHash, passwordSalt, ...rest } = u;
  return rest;
}

async function readAllAccounts(): Promise<StoredAuthUser[]> {
  const snap = await getDoc(doc(clientDb, 'system_state', AUTH_DOC));
  const data = snap.exists() ? snap.data()?.data : [];
  return Array.isArray(data) ? data : [];
}

/** Transaction-safe read-modify-write, with the same anti-wipe guard used
 *  everywhere else in this app: never let an updater accidentally collapse
 *  a non-empty account list down to nothing. */
async function updateAccounts(updater: (current: StoredAuthUser[]) => StoredAuthUser[]): Promise<StoredAuthUser[]> {
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
  const accounts = await readAllAccounts();
  const match = accounts.find(a => a.username === normalized);
  if (!match) throw new Error('Invalid username or password.');
  if (!match.active) throw new Error('This account has been disabled. Contact HR or Management.');

  const ok = await verifyPasswordBrowser(password, match.passwordHash, match.passwordSalt);
  if (!ok) throw new Error('Invalid username or password.');

  const publicUser = stripSecret({ ...match, lastLoginAt: new Date().toISOString() });
  await updateAccounts(current => current.map(a => a.id === match.id ? { ...a, lastLoginAt: publicUser.lastLoginAt } : a));

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
}): Promise<{ user: AuthUser; tempPassword: string }> {
  const backendResult = await tryBackend<{ user: AuthUser; tempPassword: string }>('/api/users', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (backendResult) return backendResult;

  const normalized = normalizeUsernameBrowser(input.username);
  if (!normalized) throw new Error('Username is required.');

  const tempPassword = generateTempPasswordBrowser();
  const { hash, salt } = await hashPasswordBrowser(tempPassword);
  const now = new Date().toISOString();
  const newUser: StoredAuthUser = {
    id: `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    username: normalized,
    displayName: input.displayName.trim(),
    role: input.role,
    employeeId: input.employeeId || null,
    active: 1,
    mustChangePassword: 1,
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

  return { user: stripSecret(newUser), tempPassword };
}

export async function updateUserAccount(
  id: string,
  patch: Partial<Pick<AuthUser, 'displayName' | 'role' | 'employeeId' | 'active'>>
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
    return updated;
  }));

  if (!updated) throw new Error('Account not found.');
  return stripSecret(updated);
}

export async function resetUserPassword(id: string): Promise<{ tempPassword: string }> {
  const backendResult = await tryBackend<{ tempPassword: string }>(`/api/users/${id}/reset-password`, { method: 'POST' });
  if (backendResult) return backendResult;

  const tempPassword = generateTempPasswordBrowser();
  const { hash, salt } = await hashPasswordBrowser(tempPassword);

  let found = false;
  await updateAccounts(current => current.map(a => {
    if (a.id !== id) return a;
    found = true;
    return { ...a, passwordHash: hash, passwordSalt: salt, mustChangePassword: 1, updatedAt: new Date().toISOString() };
  }));

  if (!found) throw new Error('Account not found.');
  return { tempPassword };
}

export async function deactivateUserAccount(id: string): Promise<void> {
  const backendResult = await tryBackend<void>(`/api/users/${id}`, { method: 'DELETE' });
  if (backendResult !== null) return;

  await updateAccounts(current => current.map(a => a.id === id ? { ...a, active: 0, updatedAt: new Date().toISOString() } : a));
}
