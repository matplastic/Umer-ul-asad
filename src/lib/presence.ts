import { getFirestore, doc, setDoc, deleteDoc, collection, onSnapshot, serverTimestamp, Timestamp } from 'firebase/firestore';
import { app } from './googleDrive';
import type { AuthUser } from './authClient';

// ─── "Who's online" presence tracking ───────────────────────────────────────
// Every logged-in tab writes a heartbeat doc to presence/{userId} every
// HEARTBEAT_MS. Anyone viewing the Online Users panel treats a doc as
// "online" only if its lastSeenAt is within STALE_AFTER_MS — this is what
// lets the UI recover automatically from crashed tabs, closed laptops, or
// lost network, none of which reliably fire a logout/unload event.

const clientDb = getFirestore(app);
const PRESENCE_COLLECTION = 'presence';

const HEARTBEAT_MS = 45_000;      // how often we refresh our own presence doc
export const STALE_AFTER_MS = 120_000; // how old a heartbeat can be before we stop counting it as "online"

export interface PresenceRecord {
  userId: string;
  username: string;
  displayName: string;
  role: string;
  loginAt: string;
  lastSeenAt: Timestamp | null;
}

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let currentUserId: string | null = null;

async function writeHeartbeat(user: AuthUser, loginAt: string) {
  try {
    await setDoc(doc(clientDb, PRESENCE_COLLECTION, user.id), {
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      loginAt,
      lastSeenAt: serverTimestamp(),
    });
  } catch (err) {
    // Non-fatal — presence is a "nice to have" visibility feature and should
    // never block or break the actual login/logout flow.
    console.warn('[presence] Failed to write heartbeat:', err);
  }
}

/** Call once right after a successful login (and once on app load if a
 *  session was already active from localStorage). Safe to call repeatedly —
 *  it clears any existing timer first so there's never more than one. */
export function startPresenceHeartbeat(user: AuthUser): void {
  stopPresenceHeartbeat();
  currentUserId = user.id;
  const loginAt = new Date().toISOString();
  writeHeartbeat(user, loginAt);
  heartbeatTimer = setInterval(() => writeHeartbeat(user, loginAt), HEARTBEAT_MS);

  // Best-effort cleanup on tab close — not guaranteed to fire (especially on
  // mobile or a crashed tab), which is exactly why the staleness check above
  // exists as the real safety net.
  window.addEventListener('beforeunload', beforeUnloadCleanup);
}

function beforeUnloadCleanup() {
  if (!currentUserId) return;
  try {
    // Fire-and-forget; the page is unloading so we can't await this.
    deleteDoc(doc(clientDb, PRESENCE_COLLECTION, currentUserId));
  } catch {
    // ignore
  }
}

/** Call on logout (manual or idle-triggered). Stops the heartbeat and
 *  removes this device's presence doc so it disappears immediately instead
 *  of waiting to go stale. */
export async function stopPresenceHeartbeat(): Promise<void> {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  window.removeEventListener('beforeunload', beforeUnloadCleanup);
  if (currentUserId) {
    try {
      await deleteDoc(doc(clientDb, PRESENCE_COLLECTION, currentUserId));
    } catch (err) {
      console.warn('[presence] Failed to clear presence doc on logout:', err);
    }
    currentUserId = null;
  }
}

/** Live-subscribes to all presence docs. Returns an unsubscribe function.
 *  Callback receives every doc currently in Firestore — callers should
 *  filter by STALE_AFTER_MS (see isOnline helper below) to decide who to
 *  actually display as "online" right now. */
export function subscribeToPresence(callback: (records: PresenceRecord[]) => void): () => void {
  const ref = collection(clientDb, PRESENCE_COLLECTION);
  return onSnapshot(ref, (snap) => {
    const records = snap.docs.map(d => d.data() as PresenceRecord);
    callback(records);
  }, (err) => {
    console.warn('[presence] Subscription error:', err);
  });
}

export function isOnline(record: PresenceRecord): boolean {
  if (!record.lastSeenAt) return false;
  const lastSeenMs = record.lastSeenAt.toMillis ? record.lastSeenAt.toMillis() : 0;
  return Date.now() - lastSeenMs < STALE_AFTER_MS;
}
