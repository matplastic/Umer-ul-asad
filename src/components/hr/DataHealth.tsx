import React, { useMemo, useState } from 'react';
import { ClipboardCheck, Download, Table2 } from 'lucide-react';
import { Employee } from '../../types';
import { useHRCollection, HRProfile } from '../../lib/hrStore';
import { downloadSheet } from '../../lib/excelImport';
import { IMPORT_TYPES } from './importTypes';
import { FIELDS, FieldDef, getValue, isFilled, isActive } from './employeeFields';
import { OrgFilters, matchOrg, orgLabel } from './OrgManager';
import { ImportButton } from './ExcelImport';
import { StatCard, SectionCard, Empty, SearchBox, inputCls, btnGhost, btnPrimary, Badge, hrToast } from './hrUi';

interface Props {
  employees: Employee[];
  user?: string;
  saveEmployees?: (list: Employee[]) => void | Promise<void>;
  onNavigate: (tab: string) => void;
}

// Excel column key → field key, so a pre-filled sheet carries what is already saved.
const COLMAP: Record<'passport' | 'profile', Record<string, string>> = {
  passport: { no: 'passportNumber', country: 'passportCountry', issue: 'passportIssueDate', expiry: 'passportExpiryDate', visa: 'visaExpiryDate' },
  profile: { designation: 'designation', type: 'employmentType', joining: 'joiningDate', dob: 'dob', gender: 'gender', salary: 'basicSalary', eid: 'emiratesId', eidExp: 'emiratesIdExpiry', lc: 'labourCardNo', lcExp: 'labourCardExpiry', emName: 'emergencyName', emRel: 'emergencyRelation', emPhone: 'emergencyPhone', address: 'uaeAddress', pmode: 'paymentMode', pcode: 'personCode', bank: 'bankName', routing: 'bankRoutingCode', iban: 'iban' },
};

export const DataHealth: React.FC<Props> = ({ employees, user, saveEmployees, onNavigate }) => {
  const profC = useHRCollection<HRProfile>('hrProfiles');
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('All');
  const [company, setCompany] = useState('All');
  const [fieldF, setFieldF] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(true);

  const pmap = useMemo(() => new Map(profC.items.map(p => [p.id, p])), [profC.items]);
  const active = useMemo(() => employees.filter(e => isActive(e, pmap)), [employees, pmap]);
  const health = useMemo(() => FIELDS.filter(f => f.health), []);

  const rows = useMemo(() => active.map(e => {
    const prof = pmap.get(e.id);
    // people paid in cash need no bank details
    const applicable = health.filter(f => !(f.group === 'bank' && prof?.paymentMode === 'Cash'));
    const missing = applicable.filter(f => !isFilled(f, e, prof));
    return { e, prof, missing, n: applicable.length, pct: Math.round(((applicable.length - missing.length) / applicable.length) * 100) };
  }), [active, pmap, health]);

  const totals = useMemo(() => {
    const miss = rows.reduce((s, r) => s + r.missing.length, 0);
    const cells = rows.reduce((s, r) => s + r.n, 0);
    return { complete: rows.filter(r => r.missing.length === 0).length, incomplete: rows.filter(r => r.missing.length > 0).length, miss, pct: cells ? Math.round(((cells - miss) / cells) * 100) : 100 };
  }, [rows, health]);

  const byField = useMemo(() => health.map(f => ({ f, n: rows.filter(r => r.missing.includes(f)).length })).sort((a, b) => b.n - a.n), [rows, health]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows
      .filter(r => matchOrg(r.e, company, dept))
      .filter(r => !fieldF || r.missing.some(f => f.key === fieldF))
      .filter(r => !onlyMissing || r.missing.length > 0)
      .filter(r => !s || r.e.name.toLowerCase().includes(s) || r.e.id.toLowerCase().includes(s))
      .sort((a, b) => a.pct - b.pct || a.e.name.localeCompare(b.e.name));
  }, [rows, q, dept, company, fieldF, onlyMissing]);

  const prefilled = (type: 'passport' | 'profile', onlyThoseMissing: boolean) => {
    const t = IMPORT_TYPES[type];
    const fkeys = Object.values(COLMAP[type]);
    const list = rows.filter(r => matchOrg(r.e, company, dept) && (!onlyThoseMissing || r.missing.some(f => fkeys.includes(f.key))));
    if (!list.length) { hrToast('Nobody is missing details in this group — nothing to download', 'err'); return; }
    const fdef = (k: string): FieldDef | undefined => FIELDS.find(x => x.key === k);
    const out = list.map(r => t.cols.map(c => {
      if (c.key === 'badge') return r.e.id;
      if (c.key === 'name') return r.e.name;
      const fk = COLMAP[type][c.key]; const f = fk ? fdef(fk) : undefined;
      return f ? getValue(f, r.e, r.prof) : '';
    }));
    downloadSheet(`Fill_${type}_details${dept !== 'All' ? `_${dept.replace(/\W+/g, '_')}` : ''}${company !== 'All' ? `_${company.replace(/\W+/g, '_')}` : ''}.xlsx`, t.cols.map(c => c.label), out, 'To fill');
    hrToast(`Sheet for ${list.length} employee(s) downloaded — fill the blanks, then use "Import filled sheet"`);
  };

  const exportStatus = () => {
    const headers = ['Badge No', 'Employee Name', 'Department', 'Complete %', 'Missing'];
    const data = shown.map(r => [r.e.id, r.e.name, r.e.department || '', r.pct, r.missing.map(f => f.label).join(', ')]);
    if (!data.length) { hrToast('Nothing to export', 'err'); return; }
    downloadSheet('Employee_data_status.xlsx', headers, data, 'Status');
  };

  const tone = (p: number) => p >= 90 ? 'bg-emerald-500' : p >= 60 ? 'bg-amber-500' : 'bg-rose-500';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Records complete" value={`${totals.pct}%`} sub={`${active.length} active employees`} tone={totals.pct >= 90 ? 'emerald' : totals.pct >= 60 ? 'amber' : 'rose'} icon={<ClipboardCheck className="h-4 w-4" />} />
        <StatCard label="Fully complete" value={totals.complete} tone="emerald" />
        <StatCard label="Missing something" value={totals.incomplete} tone={totals.incomplete ? 'amber' : 'slate'} onClick={() => { setOnlyMissing(true); setFieldF(''); }} />
        <StatCard label="Blank details" value={totals.miss} sub="across all employees" tone="slate" />
      </div>

      <SectionCard title="Fastest way to fill the gaps">
        <div className="flex flex-wrap gap-2">
          <button className={btnPrimary} onClick={() => prefilled('passport', true)}><Download className="h-4 w-4" />Sheet: passport & visa gaps</button>
          <button className={btnPrimary} onClick={() => prefilled('profile', true)}><Download className="h-4 w-4" />Sheet: profile, ID & labour card gaps</button>
          <ImportButton employees={employees} user={user} saveEmployees={saveEmployees} types={['passport', 'profile', 'documents']} initialType="passport" label="Import filled sheet" />
          <button className={btnGhost} onClick={() => onNavigate('grid')}><Table2 className="h-3.5 w-3.5" />Type them in the Quick Entry grid</button>
        </div>
        <p className="text-[11px] text-slate-400 mt-2">The downloaded sheets already contain each person's badge and name and what is saved so far — you only type the blanks, then upload it back.</p>
      </SectionCard>

      <SectionCard title="What is missing most">
        <div className="space-y-1.5">
          {byField.map(({ f, n }) => (
            <button key={f.key} onClick={() => { setFieldF(fieldF === f.key ? '' : f.key); setOnlyMissing(true); }} className={`w-full flex items-center gap-3 text-left rounded-lg px-2 py-1 ${fieldF === f.key ? 'bg-violet-50' : 'hover:bg-slate-50'}`}>
              <span className="w-40 text-xs font-semibold text-slate-700 truncate">{f.label}</span>
              <span className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden"><span className={`block h-full ${n === 0 ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${rows.length ? ((rows.length - n) / rows.length) * 100 : 100}%` }} /></span>
              <span className="w-24 text-right text-xs text-slate-500">{n === 0 ? 'all filled' : `${n} missing`}</span>
            </button>
          ))}
        </div>
      </SectionCard>

      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox value={q} onChange={setQ} placeholder="Employee or badge…" />
          <OrgFilters employees={active} company={company} dept={dept} onCompany={setCompany} onDept={setDept} />
          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600"><input type="checkbox" className="accent-violet-600" checked={onlyMissing} onChange={e => setOnlyMissing(e.target.checked)} />Only incomplete</label>
          {fieldF && <button className="text-xs" onClick={() => setFieldF('')}><Badge tone="violet">{FIELDS.find(f => f.key === fieldF)?.label} ✕</Badge></button>}
        </div>
        <button className={btnGhost} onClick={exportStatus}><Download className="h-3.5 w-3.5" />Export status (Excel)</button>
      </div>

      {shown.length === 0 ? <Empty text={rows.length ? 'Nothing matches — or every record here is complete.' : 'No active employees yet.'} /> : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase text-slate-400 border-b border-slate-100"><th className="px-4 py-2">Employee</th><th className="px-4 py-2 w-40">Complete</th><th className="px-4 py-2">Missing</th></tr></thead>
            <tbody className="divide-y divide-slate-50">
              {shown.slice(0, 400).map(r => (
                <tr key={r.e.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2"><div className="font-semibold text-slate-800">{r.e.name}</div><div className="text-[11px] text-slate-400">Badge {r.e.id}{orgLabel(r.e) ? ` · ${orgLabel(r.e)}` : ''}</div></td>
                  <td className="px-4 py-2"><div className="flex items-center gap-2"><span className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden"><span className={`block h-full ${tone(r.pct)}`} style={{ width: `${r.pct}%` }} /></span><span className="text-xs font-bold text-slate-600 w-9 text-right">{r.pct}%</span></div></td>
                  <td className="px-4 py-2"><div className="flex flex-wrap gap-1">{r.missing.slice(0, 7).map(f => <span key={f.key} className="text-[11px] bg-amber-50 text-amber-800 border border-amber-200 rounded px-1.5 py-0.5">{f.label}</span>)}{r.missing.length > 7 && <span className="text-[11px] text-slate-400">+{r.missing.length - 7} more</span>}{r.missing.length === 0 && <Badge tone="emerald">Complete</Badge>}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length > 400 && <p className="text-[11px] text-slate-400 px-4 py-2">Showing 400 of {shown.length}. Filter by department, or export to Excel for everything.</p>}
        </div>
      )}
    </div>
  );
};
