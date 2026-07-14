import { useEffect, useRef } from 'react';

const DEFAULT_ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keydown', 'wheel', 'touchstart', 'scroll'];

/**
 * Calls `onIdle` after `timeoutMs` of no user activity (mouse, keyboard,
 * touch, scroll). The timer resets on any activity and pauses entirely
 * while `enabled` is false (e.g. while logged out), so it never fires for a
 * signed-out user.
 */
export function useIdleTimeout(enabled: boolean, timeoutMs: number, onIdle: () => void): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  useEffect(() => {
    if (!enabled) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    const resetTimer = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => onIdleRef.current(), timeoutMs);
    };

    resetTimer();
    DEFAULT_ACTIVITY_EVENTS.forEach(evt => window.addEventListener(evt, resetTimer, { passive: true }));

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      DEFAULT_ACTIVITY_EVENTS.forEach(evt => window.removeEventListener(evt, resetTimer));
    };
  }, [enabled, timeoutMs]);
}
