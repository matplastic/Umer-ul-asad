// Shared building blocks for the HR Suite screens. Uses the same Tailwind
// look as the existing HR Portal tabs (violet accent, slate neutrals) so the
// light/dark theme overrides apply automatically.
import React, { useCallback, useEffect, useState } from 'react';
import { X, AlertTriangle, CheckCircle, Search } from 'lucide-react';

export const inputCls =
  'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white';
export const labelCls = 'text-xs font-semibold text-slate-500 block mb-1';
export const btnPrimary =
  'inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-bold px-4 py-2 rounded-lg transition-colors';
export const btnGhost =
  'inline-flex items-center gap-1.5 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold px-3 py-1.5 rounded-lg transition-colors';
export const btnDanger =
  'inline-flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors';

// ─── Toast (tiny, module-level so any screen can call hrToast()) ───
type ToastMsg = { id: number; text: string; tone: 'ok' | 'err' };
let toastSeq = 0;
const toastListeners = new Set<(t: ToastMsg) => void>();
export function hrToast(text: string, tone: 'ok' | 'err' = 'ok') {
  const t = { id: ++toastSeq, text, tone };
  toastListeners.forEach(l => l(t));
}
export const HRToastHost: React.FC = () => {
  const [list, setList] = useState<ToastMsg[]>([]);
  useEffect(() => {
    const l = (t: ToastMsg) => {
      setList(p => [...p, t]);
      setTimeout(() => setList(p => p.filter(x => x.id !== t.id)), 3500);
    };
    toastListeners.add(l);
    return () => { toastListeners.delete(l); };
  }, []);
  if (list.length === 0) return null;
  return (
    <div className="fixed bottom-5 right-5 z-[70] space-y-2">
      {list.map(t => (
        <div key={t.id}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-lg text-sm font-semibold text-white ${t.tone === 'ok' ? 'bg-emerald-600' : 'bg-rose-600'}`}>
          {t.tone === 'ok' ? <CheckCircle className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          {t.text}
        </div>
      ))}
    </div>
  );
};

/** Run a save and show a success / failure toast. */
export async function runSave(fn: () => Promise<void>, okMsg = 'Saved'): Promise<boolean> {
  try { await fn(); hrToast(okMsg); return true; }
  catch (e) { console.error('[HR] save failed', e); hrToast('Could not save — check your connection and try again', 'err'); return false; }
}

// ─── Confirm dialog hook ───
export function useConfirm() {
  const [state, setState] = useState<{ msg: string; resolve: (v: boolean) => void } | null>(null);
  const ask = useCallback((msg: string) => new Promise<boolean>(resolve => setState({ msg, resolve })), []);
  const node = state ? (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-slate-900/60 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <div className="flex gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-sm text-slate-700">{state.msg}</p>
        </div>
        <div className="flex justify-end gap-2">
          <button className={btnGhost} onClick={() => { state.resolve(false); setState(null); }}>Cancel</button>
          <button className={btnDanger} onClick={() => { state.resolve(true); setState(null); }}>Confirm</button>
        </div>
      </div>
    </div>
  ) : null;
  return { ask, node };
}

// ─── Layout pieces ───
export const Modal: React.FC<{
  title: string; onClose: () => void; children: React.ReactNode; wide?: boolean; footer?: React.ReactNode;
}> = ({ title, onClose, children, wide, footer }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
    <div className={`bg-white rounded-2xl shadow-2xl w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[92vh] flex flex-col`}>
      <div className="flex items-center justify-between px-6 pt-5 pb-3">
        <h3 className="font-black text-slate-800">{title}</h3>
        <button onClick={onClose} aria-label="Close"><X className="h-5 w-5 text-slate-400" /></button>
      </div>
      <div className="px-6 pb-4 overflow-y-auto space-y-3">{children}</div>
      {footer && <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">{footer}</div>}
    </div>
  </div>
);

export const Field: React.FC<{ label: string; children: React.ReactNode; className?: string }> = ({ label, children, className }) => (
  <div className={className}>
    <label className={labelCls}>{label}</label>
    {children}
  </div>
);

export const StatCard: React.FC<{
  label: string; value: React.ReactNode; sub?: string; tone?: 'violet' | 'emerald' | 'amber' | 'rose' | 'slate'; onClick?: () => void; icon?: React.ReactNode;
}> = ({ label, value, sub, tone = 'slate', onClick, icon }) => {
  const tones: Record<string, string> = {
    violet: 'bg-violet-50 border-violet-200 text-violet-700',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
    rose: 'bg-rose-50 border-rose-200 text-rose-700',
    slate: 'bg-white border-slate-200 text-slate-700',
  };
  const Tag: any = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick}
      className={`text-left rounded-xl border p-4 ${tones[tone]} ${onClick ? 'hover:shadow-md transition-shadow cursor-pointer' : ''}`}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wide opacity-80">{label}</span>
        {icon}
      </div>
      <div className="text-2xl font-black mt-1">{value}</div>
      {sub && <div className="text-[11px] opacity-70 mt-0.5">{sub}</div>}
    </Tag>
  );
};

export const Badge: React.FC<{ tone?: 'slate' | 'violet' | 'emerald' | 'amber' | 'rose' | 'sky'; children: React.ReactNode }> = ({ tone = 'slate', children }) => {
  const t: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-700 border-slate-200',
    violet: 'bg-violet-50 text-violet-700 border-violet-200',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    rose: 'bg-rose-50 text-rose-700 border-rose-200',
    sky: 'bg-sky-50 text-sky-700 border-sky-200',
  };
  return <span className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded-full border ${t[tone]}`}>{children}</span>;
};

export const Empty: React.FC<{ text: string }> = ({ text }) => (
  <div className="text-center text-sm text-slate-400 py-10 border border-dashed border-slate-200 rounded-xl">{text}</div>
);

export const SectionCard: React.FC<{ title?: string; right?: React.ReactNode; children: React.ReactNode }> = ({ title, right, children }) => (
  <div className="bg-white border border-slate-200 rounded-xl p-4">
    {(title || right) && (
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-black text-slate-800">{title}</h4>{right}
      </div>
    )}
    {children}
  </div>
);

export const SearchBox: React.FC<{ value: string; onChange: (v: string) => void; placeholder?: string }> = ({ value, onChange, placeholder }) => (
  <div className="relative">
    <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
    <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder || 'Search…'}
      className="border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white w-56" />
  </div>
);

export const SubTabs: React.FC<{ tabs: { id: string; label: string; badge?: number }[]; active: string; onChange: (id: string) => void }> = ({ tabs, active, onChange }) => (
  <div className="flex gap-1 border-b border-slate-200 flex-wrap">
    {tabs.map(t => (
      <button key={t.id} onClick={() => onChange(t.id)}
        className={`px-3 py-2 text-xs font-bold border-b-2 -mb-px transition-colors ${active === t.id ? 'border-violet-600 text-violet-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
        {t.label}
        {!!t.badge && <span className="ml-1.5 bg-amber-500 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full">{t.badge}</span>}
      </button>
    ))}
  </div>
);

export const EmployeeSelect: React.FC<{
  employees: { id: string; name: string; department?: string }[]; value: string; onChange: (id: string) => void; placeholder?: string;
}> = ({ employees, value, onChange, placeholder }) => (
  <select value={value} onChange={e => onChange(e.target.value)} className={inputCls}>
    <option value="">{placeholder || 'Select employee…'}</option>
    {[...employees].sort((a, b) => a.name.localeCompare(b.name)).map(e => (
      <option key={e.id} value={e.id}>{e.name}{e.department ? ` — ${e.department}` : ''}</option>
    ))}
  </select>
);

export const ExpiryBadge: React.FC<{ date?: string | null; warnDays?: number }> = ({ date, warnDays = 60 }) => {
  if (!date) return <span className="text-slate-300 text-xs">—</span>;
  const d = Math.round((new Date(date + 'T00:00:00').getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000);
  if (isNaN(d)) return <span className="text-slate-300 text-xs">—</span>;
  if (d < 0) return <Badge tone="rose">Expired {Math.abs(d)}d ago</Badge>;
  if (d <= warnDays) return <Badge tone="amber">{d === 0 ? 'Expires today' : `${d}d left`}</Badge>;
  return <Badge tone="emerald">Valid</Badge>;
};
