import { useCallback, useEffect, useState } from 'react';

/**
 * Per-user auto-logout (idle) timeout.
 *
 * - Each signed-in user picks their own value (saved on this device, like the
 *   theme): key "mat_idle_timeout_min:<userId>".
 * - Hard maximum is 60 minutes (1 hour). Anything higher is clamped.
 * - Users who have not chosen yet fall back to the company default that the HR
 *   portal writes to "mat_idle_timeout_min", and finally to 3 minutes.
 */

export const IDLE_DEFAULT_MIN = 3;
export const IDLE_MAX_MIN = 60;
export const IDLE_OPTIONS = [1, 3, 5, 10, 15, 30, 60];

const COMPANY_DEFAULT_KEY = 'mat_idle_timeout_min';
const CHANGE_EVENT = 'mat-idle-timeout-change';

const userKey = (userId: string) => `${COMPANY_DEFAULT_KEY}:${userId}`;
const clamp = (n: number) => Math.min(IDLE_MAX_MIN, Math.max(1, Math.round(n)));

const readKey = (key: string): number | null => {
  try {
    const raw = localStorage.getItem(key);
    const n = raw ? parseInt(raw, 10) : NaN;
    return !isNaN(n) && n > 0 ? clamp(n) : null;
  } catch {
    return null;
  }
};

export const getIdleTimeoutMinutes = (userId?: string | null): number =>
  (userId ? readKey(userKey(userId)) : null) ?? readKey(COMPANY_DEFAULT_KEY) ?? IDLE_DEFAULT_MIN;

export const setIdleTimeoutMinutes = (userId: string, minutes: number) => {
  const value = clamp(minutes);
  try {
    localStorage.setItem(userKey(userId), String(value));
  } catch {
    /* blocked / full storage: the choice just won't be remembered */
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
};

/** Current idle timeout (minutes) for this user + a setter. Updates live. */
export const useIdleTimeoutMinutes = (userId?: string | null): [number, (m: number) => void] => {
  const [minutes, setMinutes] = useState<number>(() => getIdleTimeoutMinutes(userId));

  useEffect(() => {
    const refresh = () => setMinutes(getIdleTimeoutMinutes(userId));
    refresh();
    window.addEventListener(CHANGE_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(CHANGE_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [userId]);

  const update = useCallback(
    (m: number) => {
      if (userId) setIdleTimeoutMinutes(userId, m);
    },
    [userId],
  );

  return [minutes, update];
};
