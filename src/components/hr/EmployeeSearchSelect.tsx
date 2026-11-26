// Searchable employee picker — replaces the long plain dropdowns.
// Click it, start typing a name / department / ID, pick with the mouse or
// ↑ ↓ Enter. The list opens in a portal so it is never clipped by a popup
// or a scrolling panel.
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, ChevronDown } from 'lucide-react';

export interface PickableEmployee { id: string; name: string; department?: string; role?: string | null }

interface Props {
  employees: PickableEmployee[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  /** When set, a first "clear" row with this label is shown (e.g. "— None —"). */
  clearLabel?: string;
  disabled?: boolean;
  testId?: string;
  /** focus-ring colour to match the surrounding form */
  accent?: 'violet' | 'rose' | 'teal';
  className?: string;
  /** Let the person type a name that is not in the employee list (e.g. a new hire for an offer letter).
   *  Typing shows a "Use “…”" row; picking it calls onFreeText(name). */
  onFreeText?: (name: string) => void;
  /** The typed name currently in use (shown in the closed box when no employee is selected). */
  freeText?: string;
}

const RING = { violet: 'focus-within:ring-violet-500', rose: 'focus-within:ring-rose-500', teal: 'focus-within:ring-teal-500' };
const MAX_SHOWN = 60;
const FREE_ID = '__free__';

export const EmployeeSearchSelect: React.FC<Props> = ({
  employees, value, onChange, placeholder = 'Select employee…', clearLabel, disabled, testId, accent = 'violet', className = '', onFreeText, freeText = '',
}) => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const [rect, setRect] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = employees.find(e => e.id === value);

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    const sorted = [...employees].sort((a, b) => a.name.localeCompare(b.name));
    if (!s) return sorted;
    // name starts-with first, then anything that contains the text
    const starts: PickableEmployee[] = [], contains: PickableEmployee[] = [];
    for (const e of sorted) {
      const name = e.name.toLowerCase();
      if (name.startsWith(s) || name.split(/\s+/).some(w => w.startsWith(s))) starts.push(e);
      else if (name.includes(s) || (e.department || '').toLowerCase().includes(s) || (e.role || '').toLowerCase().includes(s) || e.id.toLowerCase().includes(s)) contains.push(e);
    }
    return [...starts, ...contains];
  }, [employees, q]);

  const shown = matches.slice(0, MAX_SHOWN);
  const rows: { id: string; label: string; sub?: string }[] = [
    ...(clearLabel ? [{ id: '', label: clearLabel }] : []),
    ...shown.map(e => ({ id: e.id, label: e.name, sub: e.department })),
    ...(onFreeText && q.trim() ? [{ id: FREE_ID, label: `Use “${q.trim()}” (not in the employee list)`, sub: 'type a new name' }] : []),
  ];

  const place = () => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const spaceBelow = window.innerHeight - r.bottom;
    setRect({ left: r.left, top: r.bottom + 4, width: Math.max(r.width, 240), up: spaceBelow < 260 && r.top > spaceBelow });
  };
  useLayoutEffect(() => { if (open) place(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onScroll = () => place();
    const onDown = (ev: MouseEvent | TouchEvent) => {
      const t = ev.target as Node;
      if (box.current?.contains(t) || listRef.current?.contains(t)) return;
      close();
    };
    window.addEventListener('resize', onScroll);
    window.addEventListener('scroll', onScroll, true);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [open]);
  useEffect(() => { setHi(0); }, [q, open]);
  useEffect(() => {   // keep the highlighted row in view
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-row="${hi}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [hi, open]);

  const close = () => { setOpen(false); setQ(''); };
  const pick = (id: string) => {
    if (id === FREE_ID) { onFreeText?.(q.trim()); onChange(''); close(); return; }
    onChange(id); close();
  };
  const openList = () => { if (!disabled) { setOpen(true); setTimeout(() => input.current?.focus(), 0); } };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(rows.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(0, h - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (rows[hi]) pick(rows[hi].id); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') close();
  };

  return (
    <div ref={box} className={`relative ${className}`}>
      <div
        className={`flex items-center gap-2 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus-within:ring-2 ${RING[accent]} ${disabled ? 'opacity-60' : 'cursor-text'}`}
        onClick={openList}
      >
        <Search className="h-4 w-4 text-slate-400 shrink-0" />
        {open ? (
          <input
            ref={input} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey} data-testid={testId}
            placeholder={selected ? selected.name : 'Type a name…'}
            className="flex-1 min-w-0 bg-transparent outline-none placeholder:text-slate-400"
            autoComplete="off"
          />
        ) : (
          <button type="button" disabled={disabled} data-testid={testId} onFocus={openList} className="flex-1 min-w-0 text-left truncate bg-transparent outline-none">
            {selected ? <span className="text-slate-800">{selected.name}{selected.department ? <span className="text-slate-400"> · {selected.department}</span> : null}</span>
              : freeText ? <span className="text-slate-800">{freeText}<span className="text-slate-400"> · typed name</span></span>
              : <span className="text-slate-400">{placeholder}</span>}
          </button>
        )}
        {!selected && freeText && !disabled && !open
          ? <span role="button" aria-label="Clear" className="text-slate-300 hover:text-slate-600" onClick={ev => { ev.stopPropagation(); onFreeText?.(''); }}><X className="h-3.5 w-3.5" /></span>
          : selected && !disabled && !open && clearLabel !== undefined
          ? <span role="button" aria-label="Clear" className="text-slate-300 hover:text-slate-600" onClick={ev => { ev.stopPropagation(); onChange(''); }}><X className="h-3.5 w-3.5" /></span>
          : <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />}
      </div>

      {open && rect && createPortal(
        <div
          ref={listRef}
          style={{ position: 'fixed', left: rect.left, width: rect.width, zIndex: 90, ...(rect.up ? { bottom: window.innerHeight - (box.current?.getBoundingClientRect().top ?? 0) + 4 } : { top: rect.top }) }}
          className="bg-white border border-slate-200 rounded-xl shadow-xl max-h-64 overflow-y-auto py-1"
        >
          {rows.length === 0 && <div className="px-3 py-3 text-sm text-slate-400">{onFreeText ? 'Type a name to use it directly.' : <>No employee matches “{q}”.</>}</div>}
          {rows.map((r, i) => (
            <button
              type="button" key={r.id || '__clear'} data-row={i}
              onMouseEnter={() => setHi(i)} onClick={() => pick(r.id)}
              className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-3 ${i === hi ? 'bg-violet-50' : ''} ${r.id === value ? 'font-bold text-violet-700' : 'text-slate-700'}`}
            >
              <span className="truncate">{r.label}</span>
              {r.sub && <span className="text-[11px] text-slate-400 truncate">{r.sub}</span>}
            </button>
          ))}
          {matches.length > MAX_SHOWN && <div className="px-3 py-2 text-[11px] text-slate-400 border-t border-slate-100">Showing {MAX_SHOWN} of {matches.length} — keep typing to narrow it down.</div>}
        </div>,
        document.body,
      )}
    </div>
  );
};
