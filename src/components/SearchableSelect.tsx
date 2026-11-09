import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { rankAndFilter } from '../lib/searchUtils';

export interface SearchableOption {
  id: string;
  label: string;     // main line, e.g. "MARINE PELLETS 1MM - EMP18000 (PC)"
  sub?: string;      // small grey line, e.g. "ERP · brand · supplier · location"
  right?: string;    // small green text on the right, e.g. "stock: 120 PC"
  search?: string;   // extra text that should be searchable but isn't shown
}

interface Props {
  options: SearchableOption[];
  value: string;                       // selected option id ('' = nothing)
  onChange: (id: string) => void;
  placeholder?: string;
  className?: string;                  // wrapper classes (e.g. md:col-span-2)
  testId?: string;
  disabled?: boolean;
  maxShown?: number;
  emptyText?: string;
}

// A drop-in replacement for a long <select>: click it and start typing to
// filter. Multi-word, any order (see lib/searchUtils.ts). Keyboard: ↑ ↓ to
// move, Enter to pick, Esc to close. The × button clears the choice.
export const SearchableSelect: React.FC<Props> = ({
  options, value, onChange, placeholder = 'Search…', className = '', testId, disabled, maxShown = 100, emptyText,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => options.find(o => o.id === value), [options, value]);
  const matches = useMemo(() => rankAndFilter(options, query), [options, query]);
  const shown = matches.slice(0, maxShown);

  // Close when clicking anywhere outside.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Keep the highlighted row visible while arrowing through a long list.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${active}"]`) as HTMLElement | null;
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const choose = (opt: SearchableOption) => {
    onChange(opt.id);
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      setActive(a => Math.min(a + 1, Math.max(shown.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(a => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && shown[active]) { e.preventDefault(); choose(shown[active]); }
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      setOpen(false);
      setQuery('');
    }
  };

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <Search className="h-3.5 w-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        autoComplete="off"
        disabled={disabled}
        data-testid={testId}
        value={open ? query : (selected ? selected.label : '')}
        placeholder={open && selected ? selected.label : placeholder}
        onFocus={() => { setOpen(true); setQuery(''); setActive(0); }}
        onClick={() => setOpen(true)}
        onChange={e => { setQuery(e.target.value); setOpen(true); setActive(0); }}
        onKeyDown={onKeyDown}
        className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-8 pr-7 py-2 text-xs text-white placeholder:text-slate-500 disabled:opacity-50 focus:outline-none focus:border-orange-500"
      />
      {value && !disabled && (
        <button
          type="button"
          title="Clear"
          data-testid={testId ? `${testId}-clear` : undefined}
          onMouseDown={e => { e.preventDefault(); onChange(''); setQuery(''); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white cursor-pointer"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}

      {open && !disabled && (
        <div
          ref={listRef}
          role="listbox"
          className="absolute z-30 mt-1 w-full min-w-[280px] max-h-72 overflow-y-auto bg-slate-800 border border-slate-700 rounded-lg shadow-2xl"
        >
          {shown.length === 0 && (
            <div className="px-3 py-3 text-xs text-slate-500">
              {emptyText || (query ? `Nothing matches "${query}".` : 'Nothing to choose from.')}
            </div>
          )}
          {shown.map((o, i) => (
            <div
              key={o.id}
              data-idx={i}
              role="option"
              aria-selected={o.id === value}
              data-testid={testId ? `${testId}-option` : undefined}
              onMouseDown={e => { e.preventDefault(); choose(o); }}
              onMouseEnter={() => setActive(i)}
              className={`px-3 py-2 border-b border-slate-900 last:border-b-0 cursor-pointer ${i === active ? 'bg-slate-700' : ''} ${o.id === value ? 'border-l-2 border-l-orange-500' : ''}`}
            >
              <div className="text-xs font-semibold text-white flex items-center justify-between gap-2">
                <span>{o.label}</span>
                {o.right && <span className="text-emerald-400 font-mono shrink-0">{o.right}</span>}
              </div>
              {o.sub && <div className="text-[10px] text-slate-500 truncate">{o.sub}</div>}
            </div>
          ))}
          {matches.length > shown.length && (
            <div className="px-3 py-2 text-[10px] text-slate-500 bg-slate-900/60 sticky bottom-0">
              Showing first {shown.length} of {matches.length} — keep typing to narrow it down.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
