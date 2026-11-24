import { useCallback, useState } from 'react';

/**
 * Makes a tab bar "re-clickable".
 *
 * Normally clicking the tab that is already open does nothing, because the
 * state value does not change. With this hook:
 *   - clicking a DIFFERENT tab behaves as before (setCurrent(next));
 *   - clicking the tab that is ALREADY open runs `onReset` (put any
 *     sub-buttons / sub-views back to their default) and bumps `resetKey`.
 *
 * Wrap the tab's panels in <React.Fragment key={resetKey}> so the panel is
 * rebuilt from scratch and returns to its start page.
 */
export function useTabReset<T>(current: T, setCurrent: (next: T) => void, onReset?: () => void) {
  const [resetKey, setResetKey] = useState(0);

  const select = useCallback((next: T) => {
    if (next === current) {
      onReset?.();
      setResetKey(k => k + 1);
      return;
    }
    setCurrent(next);
  }, [current, setCurrent, onReset]);

  return { select, resetKey };
}
