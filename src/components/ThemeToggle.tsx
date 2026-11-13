import React, { useCallback, useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

/**
 * Light / dark theme switch.
 *
 * - The choice is saved on the device ("mat-theme" = light | dark) and applied
 *   as the "dark" class on <html>. index.html applies it before the first paint
 *   so there is no white flash on reload.
 * - Light is the default until someone picks dark.
 * - All dark colours live in src/theme-dark.css.
 */

export type ThemeMode = 'light' | 'dark';
const STORAGE_KEY = 'mat-theme';
const CHANGE_EVENT = 'mat-theme-change';

export const getStoredTheme = (): ThemeMode => {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
};

export const applyTheme = (mode: ThemeMode) => {
  const root = document.documentElement;
  root.classList.toggle('dark', mode === 'dark');
  root.style.colorScheme = mode;
  // Phone status bar / browser toolbar colour (installed app)
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', mode === 'dark' ? '#0b1117' : '#ffffff');
};

export const setTheme = (mode: ThemeMode) => {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* private mode / blocked storage: the choice just won't be remembered */
  }
  applyTheme(mode);
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: mode }));
};

export const useTheme = (): [ThemeMode, () => void] => {
  const [mode, setMode] = useState<ThemeMode>(() =>
    document.documentElement.classList.contains('dark') ? 'dark' : getStoredTheme(),
  );

  useEffect(() => {
    applyTheme(mode);
    const onChange = (e: Event) => setMode((e as CustomEvent<ThemeMode>).detail);
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CHANGE_EVENT, onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = useCallback(() => setTheme(mode === 'dark' ? 'light' : 'dark'), [mode]);
  return [mode, toggle];
};

export const ThemeToggle: React.FC<{ className?: string }> = ({ className = '' }) => {
  const [mode, toggle] = useTheme();
  const isDark = mode === 'dark';
  const label = isDark ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      data-testid="theme-toggle"
      className={`h-10 w-10 shrink-0 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900 active:scale-95 transition-all cursor-pointer ${className}`}
    >
      {isDark ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
    </button>
  );
};
