import React from 'react';
import { X } from 'lucide-react';
import { STAGE_META, type PoStage } from '../lib/procurement';

// Small shared pieces for the Procurement portal.

export const inputCls =
  'w-full bg-slate-100 border border-slate-300 rounded-lg px-2.5 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500/40 disabled:opacity-60';
export const labelCls = 'block text-[10px] font-bold uppercase text-slate-500 mb-1';

export const Field: React.FC<{ label: string; className?: string; children: React.ReactNode }> = ({ label, className = '', children }) => (
  <div className={className}><label className={labelCls}>{label}</label>{children}</div>
);

export const StageBadge: React.FC<{ stage: PoStage; className?: string }> = ({ stage, className = '' }) => {
  const m = STAGE_META[stage];
  return (
    <span title={m.hint} className={`inline-block whitespace-nowrap px-2 py-0.5 rounded-full text-[10px] font-black uppercase border ${m.cls} ${className}`}>
      {m.label}
    </span>
  );
};

export const ProgressBar: React.FC<{ pct: number; tone?: 'emerald' | 'violet' | 'sky' | 'amber' }> = ({ pct, tone = 'emerald' }) => {
  const color = { emerald: 'bg-emerald-500', violet: 'bg-violet-500', sky: 'bg-sky-500', amber: 'bg-amber-500' }[tone];
  return (
    <div className="h-1.5 w-full rounded-full bg-slate-200 overflow-hidden" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full ${color}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
};

export const Modal: React.FC<{
  title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode;
  width?: string; z?: string;
}> = ({ title, subtitle, onClose, children, footer, width = 'max-w-3xl', z = 'z-[60]' }) => (
  <div className={`fixed inset-0 ${z} flex items-start justify-center p-3 sm:p-6 bg-black/50 overflow-y-auto`} onClick={onClose}>
    <div className={`bg-white border border-slate-300 rounded-2xl w-full ${width} shadow-2xl my-auto`} onClick={e => e.stopPropagation()}>
      <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-slate-200">
        <div className="min-w-0">
          <h3 className="text-sm font-extrabold text-slate-900">{title}</h3>
          {subtitle && <div className="text-[11px] text-slate-500 mt-0.5">{subtitle}</div>}
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-900 cursor-pointer" title="Close"><X className="h-4 w-4" /></button>
      </div>
      <div className="px-5 py-4">{children}</div>
      {footer && <div className="px-5 py-3 border-t border-slate-200 flex flex-wrap justify-end gap-2">{footer}</div>}
    </div>
  </div>
);

export const Stat: React.FC<{ label: string; value: string; sub?: string; tone?: 'default' | 'good' | 'warn' | 'bad'; onClick?: () => void }> = ({ label, value, sub, tone = 'default', onClick }) => {
  const color = { default: 'text-slate-900', good: 'text-emerald-700', warn: 'text-amber-700', bad: 'text-rose-700' }[tone];
  const Tag: any = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} className={`text-left rounded-xl border border-slate-200 bg-white p-3 ${onClick ? 'hover:border-primary-400 hover:shadow-sm cursor-pointer' : ''}`}>
      <div className="text-[10px] uppercase font-bold text-slate-500">{label}</div>
      <div className={`text-lg font-black font-mono ${color}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </Tag>
  );
};

export const btn = {
  primary: 'flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-xs font-bold cursor-pointer',
  green: 'flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold cursor-pointer',
  soft: 'flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 text-xs font-bold cursor-pointer',
  danger: 'flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white hover:bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold cursor-pointer disabled:opacity-50',
  amber: 'flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-xs font-bold cursor-pointer',
};

export const QC_LABEL: Record<string, { label: string; cls: string }> = {
  pending: { label: 'In QC', cls: 'text-amber-700' },
  partial: { label: 'QC partly done', cls: 'text-amber-700' },
  passed: { label: 'Passed', cls: 'text-emerald-700' },
  failed: { label: 'Rejected', cls: 'text-rose-700' },
  hold: { label: 'On hold', cls: 'text-orange-700' },
  mixed: { label: 'Passed / rejected', cls: 'text-violet-700' },
};

export const todayStr = () => new Date().toISOString().slice(0, 10);
