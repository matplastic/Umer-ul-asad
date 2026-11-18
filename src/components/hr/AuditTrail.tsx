import React, { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { useHRCollection, HRAuditEntry } from '../../lib/hrStore';
import { exportToExcel } from '../../lib/exportUtils';
import { inputCls, btnGhost, Badge, Empty, SearchBox, hrToast } from './hrUi';

export const AuditTrail: React.FC = () => {
  const auditC = useHRCollection<HRAuditEntry>('hrAudit');
  const [q, setQ] = useState('');
  const [mod, setMod] = useState('All');
  const modules = useMemo(() => ['All', ...Array.from(new Set(auditC.items.map(a => a.module))).sort()], [auditC.items]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return auditC.items.filter(a => mod === 'All' || a.module === mod)
      .filter(a => !s || a.by.toLowerCase().includes(s) || a.action.toLowerCase().includes(s) || (a.target || '').toLowerCase().includes(s))
      .sort((a, b) => b.at.localeCompare(a.at));
  }, [auditC.items, q, mod]);
  const fmt = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox value={q} onChange={setQ} placeholder="User, action or employee…" />
          <select className={inputCls + ' !w-auto'} value={mod} onChange={e => setMod(e.target.value)}>{modules.map(m => <option key={m}>{m}</option>)}</select>
        </div>
        <button className={btnGhost} onClick={() => shown.length ? exportToExcel(shown.map(a => ({ When: fmt(a.at), User: a.by, Module: a.module, Action: a.action, Employee: a.target || '' })), 'HR_Audit_Trail', 'Audit') : hrToast('Nothing to export', 'err')}><Download className="h-3.5 w-3.5" />Excel</button>
      </div>
      <p className="text-xs text-slate-400">Every change made in the new HR modules is logged here with who did it and when. All entries are kept permanently; the newest 500 are shown here.</p>
      {shown.length === 0 ? <Empty text="No activity recorded yet." /> : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase text-slate-400 border-b border-slate-100"><th className="px-4 py-2">When</th><th className="px-4 py-2">User</th><th className="px-4 py-2">Module</th><th className="px-4 py-2">Action</th><th className="px-4 py-2">Employee</th></tr></thead>
            <tbody className="divide-y divide-slate-50">
              {shown.slice(0, 300).map(a => (
                <tr key={a.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 whitespace-nowrap text-slate-500">{fmt(a.at)}</td>
                  <td className="px-4 py-2 font-semibold text-slate-800">{a.by}</td>
                  <td className="px-4 py-2"><Badge tone="violet">{a.module}</Badge></td>
                  <td className="px-4 py-2 text-slate-700">{a.action}</td>
                  <td className="px-4 py-2 text-slate-500">{a.target || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length > 300 && <p className="text-[11px] text-slate-400 px-4 py-2">Showing the latest 300 of {shown.length}. Export to Excel for everything.</p>}
        </div>
      )}
    </div>
  );
};
