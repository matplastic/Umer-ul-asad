import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, User, LayoutGrid, CornerDownLeft } from 'lucide-react';

interface Item { kind: 'employee' | 'tab'; id: string; label: string; sub?: string }
interface Props {
  employees: { id: string; name: string; department?: string }[];
  tabs: { id: string; label: string }[];
  onOpenEmployee: (id: string) => void;
  onGoTab: (id: string) => void;
  onClose: () => void;
}

/** Ctrl+K: find an employee (name / badge / department) or jump to any HR screen. */
export const CommandPalette: React.FC<Props> = ({ employees, tabs, onOpenEmployee, onGoTab, onClose }) => {
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { input.current?.focus(); }, []);

  const items: Item[] = useMemo(() => {
    const s = q.trim().toLowerCase();
    const t = tabs.filter(x => !s || x.label.toLowerCase().includes(s)).slice(0, s ? 6 : 8).map(x => ({ kind: 'tab' as const, id: x.id, label: x.label, sub: 'Go to screen' }));
    if (!s) return t;
    const emps = employees
      .filter(e => e.name.toLowerCase().includes(s) || e.id.toLowerCase() === s || e.id.toLowerCase().includes(s) || (e.department || '').toLowerCase().includes(s))
      .sort((a, b) => Number(b.name.toLowerCase().startsWith(s)) - Number(a.name.toLowerCase().startsWith(s)) || a.name.localeCompare(b.name))
      .slice(0, 8).map(e => ({ kind: 'employee' as const, id: e.id, label: e.name, sub: `Badge ${e.id}${e.department ? ` · ${e.department}` : ''}` }));
    return [...emps, ...t];
  }, [q, employees, tabs]);

  useEffect(() => { setHi(0); }, [q]);
  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-i="${hi}"]`)?.scrollIntoView({ block: 'nearest' }); }, [hi]);

  const choose = (it: Item | undefined) => {
    if (!it) return;
    if (it.kind === 'employee') onOpenEmployee(it.id); else onGoTab(it.id);
    onClose();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(items.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(0, h - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(items[hi]); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-start justify-center bg-slate-900/50 p-4 pt-[12vh]" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
          <Search className="h-4 w-4 text-slate-400" />
          <input ref={input} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey} placeholder="Search an employee (name or badge) or a screen…" className="flex-1 outline-none text-sm bg-transparent" />
          <kbd className="text-[10px] font-bold text-slate-400 border border-slate-200 rounded px-1.5 py-0.5">Esc</kbd>
        </div>
        <div ref={list} className="max-h-[50vh] overflow-y-auto py-1">
          {items.length === 0 && <div className="px-4 py-6 text-sm text-slate-400 text-center">Nothing found for “{q}”.</div>}
          {items.map((it, i) => (
            <button key={`${it.kind}:${it.id}`} data-i={i} onMouseEnter={() => setHi(i)} onClick={() => choose(it)}
              className={`w-full text-left px-4 py-2 flex items-center gap-3 ${i === hi ? 'bg-violet-50' : ''}`}>
              {it.kind === 'employee' ? <User className="h-4 w-4 text-violet-500 shrink-0" /> : <LayoutGrid className="h-4 w-4 text-slate-400 shrink-0" />}
              <span className="flex-1 min-w-0"><span className="block text-sm font-semibold text-slate-800 truncate">{it.label}</span><span className="block text-[11px] text-slate-400 truncate">{it.sub}</span></span>
              {i === hi && <CornerDownLeft className="h-3.5 w-3.5 text-slate-300" />}
            </button>
          ))}
        </div>
        <div className="px-4 py-2 border-t border-slate-100 text-[11px] text-slate-400 flex gap-4"><span>↑ ↓ to move</span><span>Enter to open</span><span>Ctrl + K anytime</span></div>
      </div>
    </div>,
    document.body,
  );
};
