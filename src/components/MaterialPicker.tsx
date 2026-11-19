import React, { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { Material } from '../types';

// Searchable material selector for the Incoming (goods receipt) form.
// Type part of the name, ERP code or brand — pick from the short list.
interface Props {
  materials: Material[];
  value: string;
  onChange: (id: string) => void;
  testId?: string;
  className?: string;
}

const MAX = 50;

export const MaterialPicker: React.FC<Props> = ({ materials, value, onChange, testId, className = '' }) => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);

  const selected = materials.find(m => m.id === value) || null;
  const label = selected ? `${selected.name} (${selected.unit}) · stock: ${selected.currentStock}` : '';

  const results = useMemo(() => {
    const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return materials;
    return materials.filter(m => {
      const hay = `${m.name} ${(m as any).erpCode || ''} ${(m as any).brand || ''}`.toLowerCase();
      return tokens.every(t => hay.includes(t));
    });
  }, [materials, q]);
  const shown = results.slice(0, MAX);

  const choose = (m: Material) => { onChange(m.id); setOpen(false); setQ(''); };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, shown.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[hi]) choose(shown[hi]); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  return (
    <div className={`relative ${className}`}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
      <input
        type="text"
        data-testid={testId}
        value={open ? q : label}
        placeholder="Search material or ERP code…"
        onFocus={() => { setOpen(true); setQ(''); setHi(0); }}
        onChange={e => { setQ(e.target.value); setHi(0); setOpen(true); }}
        onBlur={() => setOpen(false)}
        onKeyDown={onKey}
        className="w-full rounded-lg border border-slate-300 bg-slate-100 py-2 pl-8 pr-7 text-xs text-slate-900"
      />
      {value && !open && (
        <button type="button" title="Clear" onMouseDown={e => e.preventDefault()} onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-rose-600 cursor-pointer">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl">
          {shown.length === 0 && <div className="px-3 py-3 text-xs text-slate-400">No material matches “{q}”.</div>}
          {shown.map((m, i) => (
            <button
              key={m.id}
              type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={() => choose(m)}
              onMouseEnter={() => setHi(i)}
              className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs cursor-pointer ${i === hi ? 'bg-teal-50' : ''}`}
            >
              <span className="min-w-0">
                <span className="block truncate font-semibold text-slate-800">{m.name}</span>
                {(m as any).erpCode && <span className="font-mono text-[10px] text-slate-400">{(m as any).erpCode}</span>}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-slate-500">{m.currentStock} {m.unit}</span>
            </button>
          ))}
          {results.length > MAX && <div className="border-t border-slate-100 px-3 py-1.5 text-[10px] text-slate-400">Showing first {MAX} of {results.length} — keep typing to narrow.</div>}
        </div>
      )}
    </div>
  );
};
