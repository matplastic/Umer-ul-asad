import React, { useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

// Small sort dropdown that lives inside a table heading.
// The menu is position:fixed so the table's scroll container never clips it.
export interface SortOption { id: string; label: string }

interface Props {
  label: string;
  options: SortOption[];
  active: string | null;          // id of the active option for THIS column, or null
  onPick: (id: string | null) => void;
  align?: 'left' | 'right' | 'center';
  testId?: string;
}

export const SortHeader: React.FC<Props> = ({ label, options, active, onPick, align = 'left', testId }) => {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const MENU_W = 176;

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (pos) { setPos(null); return; }
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.min(Math.max(8, align === 'right' ? r.right - MENU_W : r.left), window.innerWidth - MENU_W - 8);
    setPos({ top: r.bottom + 4, left });
  };
  const pick = (id: string | null) => { onPick(id); setPos(null); };
  const justify = align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start';

  return (
    <div className={`flex items-center gap-1 ${justify}`}>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        data-testid={testId}
        title={`Sort / filter by ${label}`}
        className={`flex items-center gap-1 rounded-md px-1.5 py-1 uppercase font-semibold cursor-pointer transition ${active ? 'bg-teal-100 text-teal-800' : 'hover:bg-slate-200 text-slate-500'}`}
      >
        {label}
        <ChevronDown className={`h-3 w-3 transition-transform ${pos ? 'rotate-180' : ''}`} />
      </button>
      {pos && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setPos(null)} />
          <div
            style={{ top: pos.top, left: pos.left, width: MENU_W }}
            className="fixed z-50 rounded-lg border border-slate-200 bg-white py-1 shadow-xl normal-case"
          >
            {options.map(o => (
              <button
                key={o.id}
                type="button"
                onClick={() => pick(o.id)}
                className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs font-semibold cursor-pointer hover:bg-slate-50 ${active === o.id ? 'text-teal-700' : 'text-slate-700'}`}
              >
                {o.label}
                {active === o.id && <Check className="h-3.5 w-3.5" />}
              </button>
            ))}
            {active && (
              <button type="button" onClick={() => pick(null)} className="mt-1 w-full border-t border-slate-100 px-3 py-1.5 text-left text-[11px] font-bold text-slate-500 hover:bg-slate-50 cursor-pointer">
                Clear sort
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
};
