import React, { useEffect, useRef, useState } from 'react';
import { Timer, Check } from 'lucide-react';
import { IDLE_OPTIONS, IDLE_MAX_MIN, useIdleTimeoutMinutes } from '../lib/idleTimeoutSetting';

/**
 * Small "auto-logout time" picker that sits next to the theme switch in the
 * top bar, so it is available in every portal. Each user sets their own value
 * (1 to 60 minutes). The change applies immediately.
 */
export const IdleTimeoutSetting: React.FC<{ userId: string }> = ({ userId }) => {
  const [minutes, setMinutes] = useIdleTimeoutMinutes(userId);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const label = `Auto-logout after ${minutes} min of inactivity`;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={label}
        aria-expanded={open}
        title={label}
        data-testid="idle-timeout-setting"
        className="h-10 shrink-0 flex items-center justify-center gap-1 px-2.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900 active:scale-95 transition-all cursor-pointer"
      >
        <Timer className="h-[18px] w-[18px]" />
        <span className="text-xs font-bold tabular-nums">{minutes}m</span>
      </button>

      {open && (
        <div className="absolute right-0 top-12 z-50 w-56 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
          <p className="text-xs font-bold text-slate-800">Auto-logout time</p>
          <p className="mt-0.5 mb-2 text-[11px] leading-snug text-slate-500">
            Sign me out after this long without activity (max {IDLE_MAX_MIN} min).
          </p>
          <div className="grid grid-cols-4 gap-1.5">
            {IDLE_OPTIONS.map(m => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMinutes(m);
                  setOpen(false);
                }}
                className={`h-8 rounded-lg border text-xs font-bold transition-colors cursor-pointer ${
                  minutes === m
                    ? 'bg-amber-500 text-white border-amber-500'
                    : 'bg-white text-slate-700 border-slate-200 hover:border-amber-400 hover:text-amber-700'
                }`}
              >
                {m === 60 ? '1h' : `${m}m`}
              </button>
            ))}
          </div>
          <p className="mt-2 flex items-center gap-1 text-[11px] text-slate-400">
            <Check className="h-3 w-3" /> Saved on this device for your account
          </p>
        </div>
      )}
    </div>
  );
};
