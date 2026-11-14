import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithPopup, 
  signInWithRedirect, 
  getRedirectResult, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  User 
} from 'firebase/auth';
const getFirebaseConfig = () => ({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
});
// Initialize Firebase App
export const app = initializeApp(getFirebaseConfig());
export const auth = getAuth(app);

// ─────────────────────────────────────────────────────────────────────────
// SHARED FIRESTORE CLIENT — single source of truth
//
// THE BUG: firebaseService.ts, authClient.ts and presence.ts each called
// their own `getFirestore(app)`. That's harmless on its own, BUT it meant
// nobody ever called `initializeFirestore(app, {...})` with long-polling
// options BEFORE the first `getFirestore(app)` ran. Once any code calls
// plain `getFirestore(app)`, Firestore locks in its default transport
// (WebChannel over HTTP/3-QUIC) for that app instance — after that,
// calling `initializeFirestore` anywhere else throws
// "Firestore has already been started". So the QUIC long-polling fallback
// could never actually take effect, no matter which file it was added to.
//
// On factory-floor networks that block/throttle QUIC (common with
// corporate proxies, some routers, and mobile hotspots), `onSnapshot`
// connects to Firestore but then just sits there — no error thrown, no
// data, no live updates. It LOOKS like "sync isn't working" because from
// the app's point of view, nothing failed; it's just silently stalled.
//
// THE FIX: initialize Firestore exactly once, HERE, before any other file
// gets a chance to call plain getFirestore(app) first — and force long
// polling instead of trying to "auto-detect" it (auto-detect still starts
// with a QUIC probe that can hang on some of these networks).
// ─────────────────────────────────────────────────────────────────────────
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';

// OFFLINE COPY: Firestore keeps its own offline copy of everything the app
// reads, in the browser's IndexedDB (hundreds of MB, managed automatically,
// shared safely between open tabs). Writes made while offline are saved there
// too and uploaded by Firestore itself when the connection returns. This
// replaces copying big lists into localStorage (5 MB limit), which was
// crashing the app with "exceeded the quota". If IndexedDB is unavailable we
// fall back to the previous behaviour and localStorage caching stays on
// (see src/lib/safeStorage.ts, which checks this flag).
let firestoreInstance: ReturnType<typeof initializeFirestore>;
let persistentCacheActive = false;
try {
  firestoreInstance = initializeFirestore(app, {
    experimentalForceLongPolling: true,
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
  persistentCacheActive = typeof indexedDB !== 'undefined';
} catch (e) {
  console.warn('Persistent Firestore cache unavailable, using default:', e);
  try {
    firestoreInstance = initializeFirestore(app, { experimentalForceLongPolling: true });
  } catch {
    firestoreInstance = getFirestore(app);
  }
}
(globalThis as any).__matFirestorePersistent = persistentCacheActive;
export const clientDb = firestoreInstance;

// Request Google Drive scopes
const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/drive');
provider.addScope('https://www.googleapis.com/auth/drive.file');

// Token storage with localStorage cache to keep Drive connection active upon reload
// Google OAuth access tokens last about 1 hour. Without tracking this, a token saved in
// localStorage was reused forever, and every Drive call then failed with a 401 that showed
// up as a blank "Search folder failed:" message. We now remember WHEN the token was issued
// and treat it as disconnected once it is (almost) expired.
const TOKEN_KEY = 'apex_gdrive_token';
const TOKEN_TIME_KEY = 'apex_gdrive_token_time';
const TOKEN_MAX_AGE_MS = 50 * 60 * 1000; // refresh a little before Google's 60 min limit

const clearStoredToken = () => {
  cachedAccessToken = null;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_TIME_KEY);
};

const storeToken = (token: string) => {
  cachedAccessToken = token;
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(TOKEN_TIME_KEY, String(Date.now()));
};

const loadStoredToken = (): string | null => {
  const token = localStorage.getItem(TOKEN_KEY);
  const issuedAt = Number(localStorage.getItem(TOKEN_TIME_KEY) || 0);
  if (!token) return null;
  // Old tokens saved before this fix have no timestamp -> treat as expired.
  if (!issuedAt || Date.now() - issuedAt > TOKEN_MAX_AGE_MS) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_TIME_KEY);
    return null;
  }
  return token;
};

let cachedAccessToken: string | null = loadStoredToken();
let isSigningIn = false;

const SESSION_EXPIRED_MSG =
  'Google Drive session expired. Please click "Sign in with Google" / reconnect Google Drive, then try again.';

// Returns a usable token or throws a clear message (also drops tokens that have aged out).
const requireToken = (): string => {
  if (cachedAccessToken) {
    const issuedAt = Number(localStorage.getItem(TOKEN_TIME_KEY) || 0);
    if (issuedAt && Date.now() - issuedAt <= TOKEN_MAX_AGE_MS) return cachedAccessToken;
  }
  clearStoredToken();
  throw new Error(SESSION_EXPIRED_MSG);
};

// Fetch wrapper for Drive calls that always produces a readable error. Google puts the
// real reason in the JSON body; statusText is empty on HTTP/2, which is why the old
// messages ended with nothing after the colon.
async function driveFetch(label: string, url: string, init: RequestInit = {}): Promise<Response> {
  const token = requireToken();
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
    });
  } catch (netErr: any) {
    throw new Error(`${label} failed: network error (${netErr?.message || 'no connection'})`);
  }
  if (res.ok) return res;

  let reason = '';
  let apiReason = '';
  try {
    const body = await res.json();
    reason = body?.error?.message || '';
    apiReason = body?.error?.errors?.[0]?.reason || body?.error?.status || '';
  } catch {
    try { reason = await res.text(); } catch { /* ignore */ }
  }

  if (res.status === 401) {
    clearStoredToken();
    throw new Error(SESSION_EXPIRED_MSG);
  }
  if (res.status === 403 && /accessNotConfigured|SERVICE_DISABLED/i.test(`${apiReason} ${reason}`)) {
    throw new Error(
      `${label} failed: the Google Drive API is not enabled for this Google Cloud project. ` +
      'Enable "Google Drive API" in Google Cloud Console > APIs & Services > Library.'
    );
  }
  if (res.status === 403 && /insufficient/i.test(`${apiReason} ${reason}`)) {
    clearStoredToken();
    throw new Error(
      `${label} failed: Drive permission was not granted. Reconnect Google Drive and tick ALL permission boxes on the Google consent screen.`
    );
  }
  throw new Error(
    `${label} failed: ${res.status}${reason ? ` - ${reason}` : ''}${apiReason ? ` (${apiReason})` : ''}`
  );
}

// Initialize auth listener
export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      const validToken = isSigningIn ? cachedAccessToken : loadStoredToken();
      if (validToken) {
        cachedAccessToken = validToken;
        if (onAuthSuccess) onAuthSuccess(user, validToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

// Main Sign-In with Popup
export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to get access token from Google Auth');
    }
    storeToken(credential.accessToken);
    return { user: result.user, accessToken: credential.accessToken };
  } catch (error: any) {
    console.error('Google Sign-in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

// Alternative Sign-In with Redirect (very useful in iframes if popups are blocked/nested)
export const googleSignInRedirect = async (): Promise<void> => {
  isSigningIn = true;
  await signInWithRedirect(auth, provider);
};

// Check for redirection result
export const checkRedirectResult = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    const result = await getRedirectResult(auth);
    if (result) {
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        storeToken(credential.accessToken);
        return { user: result.user, accessToken: credential.accessToken };
      }
    }
    return null;
  } catch (error) {
    console.error('Google checkRedirectResult error:', error);
    return null;
  }
};

// Retrieve in-memory token
export const getAccessToken = async (): Promise<string | null> => {
  return loadStoredToken();
};

// Sign out
export const googleSignOut = async () => {
  await auth.signOut();
  clearStoredToken();
};

// Escape a value for use inside a Drive query string literal ('...')
const escapeDriveQuery = (v: string) => v.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const FOLDER_ID_CACHE: Record<string, string> = {};

// Helper to find or create parent folder
async function findOrCreateFolder(folderName: string): Promise<string> {
  if (FOLDER_ID_CACHE[folderName]) return FOLDER_ID_CACHE[folderName];

  // 1. Search for existing active folder
  const q = `name = '${escapeDriveQuery(folderName)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const searchUrl =
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}` +
    `&spaces=drive&fields=files(id,name)&pageSize=10`;

  const searchResponse = await driveFetch('Search folder', searchUrl);
  const searchResult = await searchResponse.json();
  if (searchResult.files && searchResult.files.length > 0) {
    FOLDER_ID_CACHE[folderName] = searchResult.files[0].id;
    return searchResult.files[0].id;
  }

  // 2. Folder doesn't exist, create it
  const createResponse = await driveFetch('Folder creation', 'https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: folderName, mimeType: 'application/vnd.google-apps.folder' }),
  });
  const createdFolder = await createResponse.json();
  FOLDER_ID_CACHE[folderName] = createdFolder.id;
  return createdFolder.id;
}

const BACKUP_FOLDER = 'MAT_Plastic_Travelers';

// Upload a text/markdown/json document to "MAT_Plastic_Travelers" folder
export async function uploadToGoogleDrive(
  fileName: string,
  content: string,
  mimeType: string = 'text/plain'
): Promise<any> {
  // Get or create the folder (also validates the token)
  const folderId = await findOrCreateFolder(BACKUP_FOLDER);

  // Multi-part drive upload structure
  const metadata = { name: fileName, mimeType, parents: [folderId] };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', new Blob([content], { type: mimeType }));

  const response = await driveFetch(
    'Upload',
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    { method: 'POST', body: form }
  );
  return await response.json();
}

// List backup and traveler files in Google Drive
export async function listDriveFiles(): Promise<any[]> {
  if (!loadStoredToken()) return [];

  try {
    const folderId = await findOrCreateFolder(BACKUP_FOLDER);
    const q = `'${folderId}' in parents and trashed = false`;
    const listUrl =
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}` +
      `&fields=files(id,name,mimeType,createdTime,webViewLink,size)&orderBy=createdTime desc&pageSize=100`;
    const res = await driveFetch('Listing files', listUrl);
    const data = await res.json();
    return data.files || [];
  } catch (err) {
    console.error('Error listing files:', err);
    return [];
  }
}

// Fetch file content from Drive
export async function downloadFileFromDrive(fileId: string): Promise<string> {
  const res = await driveFetch(
    'Download',
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`
  );
  return await res.text();
}

// Delete file from Drive (Note: requires user confirmation before execution as per workspace guide)
export async function deleteFileFromDrive(fileId: string): Promise<boolean> {
  await driveFetch('Delete', `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
  });
  return true;
}
