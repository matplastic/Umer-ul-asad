import { signOut as firebaseSignOut, signInWithCustomToken } from 'firebase/auth';
import { auth } from './googleDrive';
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
  'factory_entrance', 'management', 'section_dashboard', 'trolley_prod', 'hr_portal', 'hr_admin',
  'store', 'section_supervisor', 'factory_supervisor', 'reports_analytics', 'site_team', 'warehouse',
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

/** Mirrors authUtils.validatePasswordStrength for the browser-side flows. */
export function validatePasswordStrength(password: string): string | null {
  if (!password || password.length < 8) {
    return 'Password must be at least 8 characters long.';
  }
  return null;
}

const SESSION_KEY = 'apex_logged_in_user';

// ─── Server-only accounts ────────────────────────────────────────────────────
// Passwords are checked, and accounts are read/written, ONLY by the Netlify
// functions auth-login and auth-admin (Firebase Admin SDK). The browser never
// sees a password hash and never touches the account list in Firestore.

const LOGIN_UNAVAILABLE = 'Sign-in service unavailable. Check your connection and try again.';

async function requestLogin(username: string, password: string): Promise<{ user: AuthUser; token: string }> {
  let res: Response;
  try {
    res = await fetch('/.netlify/functions/auth-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  } catch {
    throw new Error(LOGIN_UNAVAILABLE);
  }
  const data = res.headers.get('content-type')?.includes('application/json')
    ? await res.json().catch(() => null)
    : null;
  if (res.ok && data?.user && data?.token) return data;
  throw new Error(data?.error || LOGIN_UNAVAILABLE);
}

/** Normal sign-in: checks the password on the server, then signs this browser
 *  in to Firebase with the role-carrying token the server returns. */
export async function loginWithPassword(username: string, password: string): Promise<AuthUser> {
  const { user, token } = await requestLogin(username, password);
  await signInWithCustomToken(auth, token);
  localStorage.setItem(SESSION_KEY, JSON.stringify(user));
  return user;
}

/** Checks someone's username/password WITHOUT changing who is signed in here
 *  (e.g. a manager authorising an action on a shared kiosk). */
export async function verifyCredentials(username: string, password: string): Promise<AuthUser> {
  return (await requestLogin(username, password)).user;
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

// Calls the auth-admin function with the signed-in user's Firebase ID token.
// Real "no" answers from the server (wrong password, no permission, duplicate
// username…) come back as errors with the server's message.
async function adminCall<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const SESSION_EXPIRED = 'Your session has expired. Please log out and sign in again.';
  const current = auth.currentUser;
  if (!current) throw new Error(SESSION_EXPIRED);
  let token: string;
  try { token = await current.getIdToken(); } catch { throw new Error(SESSION_EXPIRED); }
  let res: Response;
  try {
    res = await fetch('/.netlify/functions/auth-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, ...payload }),
    });
  } catch {
    throw new Error('Account service unavailable. Check your connection and try again.');
  }
  const data = res.headers.get('content-type')?.includes('application/json')
    ? await res.json().catch(() => null)
    : null;
  if (res.ok && data) return data as T;
  if (res.status === 401) throw new Error(SESSION_EXPIRED);
  throw new Error(data?.error || 'Account service unavailable. Please try again.');
}

export async function changeOwnPassword(currentPassword: string, newPassword: string): Promise<void> {
  await adminCall<{ ok: boolean }>('changePassword', { currentPassword, newPassword });
}

export async function listUserAccounts(): Promise<AuthUser[]> {
  const res = await adminCall<{ users: AuthUser[] }>('list');
  return res.users || [];
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
  allowedRoles?: ViewRole[] | null;
}): Promise<{ user: AuthUser; tempPassword: string; isCustomPassword: boolean }> {
  return adminCall('create', input as Record<string, unknown>);
}

export async function updateUserAccount(
  id: string,
  patch: Partial<Pick<AuthUser, 'displayName' | 'role' | 'employeeId' | 'active' | 'quickCode' | 'allowedRoles'>>
): Promise<AuthUser> {
  const res = await adminCall<{ user: AuthUser }>('update', { id, patch });
  return res.user;
}

export async function resetUserPassword(id: string, password?: string | null): Promise<{ tempPassword: string; isCustomPassword: boolean }> {
  return adminCall('resetPassword', { id, password: password || undefined });
}

/** Looks up an active account by its short quick-code PIN (see AuthUser.quickCode).
 *  Used by the shared shop-floor computer so a supervisor can identify themselves
 *  without typing their full username and password. Pass `role` to restrict the
 *  search (e.g. 'section_supervisor'). */
export async function findAccountByQuickCode(code: string, role?: ViewRole): Promise<AuthUser | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;
  const res = await adminCall<{ user: AuthUser | null }>('findByQuickCode', { code: trimmed, role });
  return res.user ?? null;
}

export async function deactivateUserAccount(id: string): Promise<void> {
  await adminCall<{ ok: boolean }>('deactivate', { id });
}
