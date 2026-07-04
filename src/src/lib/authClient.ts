import { signInWithCustomToken, signOut as firebaseSignOut } from 'firebase/auth';
import { auth } from './googleDrive';
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

const SESSION_KEY = 'apex_logged_in_user';

async function parseJsonOrThrow(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || `Request failed (${response.status})`);
  }
  return data;
}

/** Attach the current Firebase ID token (minted from our custom token at login) to a request. */
async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const currentUser = auth.currentUser;
  if (currentUser) {
    const token = await currentUser.getIdToken();
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/**
 * Sign in with a username + password. On success this also establishes a
 * real Firebase Auth session (via the custom token the server mints), so
 * every existing authenticated fetch in the app keeps working unchanged.
 */
export async function loginWithPassword(username: string, password: string): Promise<AuthUser> {
  const response = await fetch(getApiUrl('/api/auth/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await parseJsonOrThrow(response);

  await signInWithCustomToken(auth, data.customToken);

  localStorage.setItem(SESSION_KEY, JSON.stringify(data.user));
  return data.user as AuthUser;
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
  const response = await fetch(getApiUrl('/api/auth/change-password'), {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  await parseJsonOrThrow(response);
}

// ─── HR Portal / Management: account administration ────────────────────────

export async function listUserAccounts(): Promise<AuthUser[]> {
  const response = await fetch(getApiUrl('/api/users'), { headers: await authHeaders() });
  return parseJsonOrThrow(response);
}

export async function createUserAccount(input: {
  username: string;
  displayName: string;
  role: ViewRole;
  employeeId?: string | null;
}): Promise<{ user: AuthUser; tempPassword: string }> {
  const response = await fetch(getApiUrl('/api/users'), {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow(response);
}

export async function updateUserAccount(
  id: string,
  patch: Partial<Pick<AuthUser, 'displayName' | 'role' | 'employeeId' | 'active'>>
): Promise<AuthUser> {
  const response = await fetch(getApiUrl(`/api/users/${id}`), {
    method: 'PUT',
    headers: await authHeaders(),
    body: JSON.stringify(patch),
  });
  return parseJsonOrThrow(response);
}

export async function resetUserPassword(id: string): Promise<{ tempPassword: string }> {
  const response = await fetch(getApiUrl(`/api/users/${id}/reset-password`), {
    method: 'POST',
    headers: await authHeaders(),
  });
  return parseJsonOrThrow(response);
}

export async function deactivateUserAccount(id: string): Promise<void> {
  const response = await fetch(getApiUrl(`/api/users/${id}`), {
    method: 'DELETE',
    headers: await authHeaders(),
  });
  await parseJsonOrThrow(response);
}
