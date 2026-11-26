import React, { useMemo, useState } from 'react';
import { FileText, Download, Banknote, Settings2, ShieldCheck, TriangleAlert, Table2, Save } from 'lucide-react';
import { Employee } from '../../types';
import {
  useHRCollection, HRProfile, HRPayrollSettings, DEFAULT_PAYROLL_SETTINGS, PayrollLite, LeaveLite, monthStr, fmtAED, fmtD, logAudit,
} from '../../lib/hrStore';
import { buildWpsRows, buildSif, settingsProblems, unpaidLeaveDays, validateUaeIban, isEmployerId, isRouting, WpsRow } from '../../lib/wps';
import { exportPayslipsPdf, PayslipData } from '../../lib/payslipPdf';
import { downloadSheet } from '../../lib/excelImport';
import { ImportButton } from './ExcelImport';
import { Field, inputCls, btnPrimary, btnGhost, StatCard, Badge, Empty, SearchBox, SubTabs, SectionCard, runSave, useConfirm, hrToast } from './hrUi';
import { OrgFilters, matchOrg, orgLabel } from './OrgManager';

interface Props {
  employees: Employee[];
  payroll: PayrollLite[];
  leaves: LeaveLite[];
  user?: string;
  saveEmployees?: (list: Employee[]) => void | Promise<void>;
  onNavigate: (tab: string) => void;
}

function downloadText(fileName: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const PayrollCompliance: React.FC<Props> = ({ employees, payroll, leaves, user, saveEmployees, onNavigate }) => {
  const profC = useHRCollection<HRProfile>('hrProfiles');
  const setC = useHRCollection<HRPayrollSettings>('hrPayrollSettings');
  const { ask, node } = useConfirm();
  const settings: HRPayrollSettings = { ...DEFAULT_PAYROLL_SETTINGS, ...(setC.items.find(s => s.id === 'settings') || {}) };

  const months = useMemo(() => Array.from(new Set(payroll.map(p => p.month))).sort().reverse(), [payroll]);
  const [month, setMonth] = useState(() => months[0] || monthStr());
  const [tab, setTab] = useState('payslips');
  const [q, setQ] = useState('');
  const [company, setCompany] = useState('All');
  const [dept, setDept] = useState('All');
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [excluded, setExcluded] = useState<Record<string, boolean>>({});

  const pmap = useMemo(() => new Map(profC.items.map(p => [p.id, p])), [profC.items]);
  const emap = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees]);
  const records = useMemo(() => payroll.filter(p => p.month === month).map(p => ({ ...p, employeeName: emap.get(p.employeeId)?.name || p.employeeName || 'Unknown' }))
    .sort((a, b) => (a.employeeName || '').localeCompare(b.employeeName || '')), [payroll, month, emap]);
  const shown = records.filter(r => { const e = emap.get(r.employeeId); return !e || matchOrg(e, company, dept); }).filter(r => !q.trim() || (r.employeeName || '').toLowerCase().includes(q.trim().toLowerCase()) || r.employeeId.toLowerCase().includes(q.trim().toLowerCase()));
  const total = records.reduce((s, r) => s + (r.netSalary || 0), 0);

  const slip = (r: PayrollLite): PayslipData => {
    const e = emap.get(r.employeeId), p = pmap.get(r.employeeId);
    return {
      companyName: settings.companyName, companyAddress: settings.address, month: r.month,
      employee: { id: r.employeeId, name: e?.name || r.employeeName || '', department: e?.department, designation: p?.designation || e?.role || undefined, joiningDate: p?.joiningDate, paymentMode: p?.paymentMode, bankName: p?.bankName, iban: p?.iban },
      base: r.baseSalary || 0, allowances: r.allowances || 0, normalOtHours: r.normalOtHours || 0, sundayOtHours: r.sundayOtHours || 0, deductions: r.deductions || 0, net: r.netSalary || 0,
      status: r.status, paidAt: r.paidAt, unpaidLeaveDays: unpaidLeaveDays(r.employeeId, r.month, leaves),
    };
  };
  const slipsFor = (list: PayrollLite[]) => list.map(slip);
  const chosen = records.filter(r => picked[r.id]);

  const wps: WpsRow[] = useMemo(() => buildWpsRows(records.map(r => ({ ...r })), pmap, leaves, month).map(r => ({ ...r, name: emap.get(r.employeeId)?.name || r.name })), [records, pmap, leaves, month, emap]);
  const sProblems = settingsProblems(settings);
  const bankRows = wps.filter(r => r.mode === 'WPS Bank');
  const cashRows = wps.filter(r => r.mode === 'Cash');
  const okRows = bankRows.filter(r => r.problems.length === 0 && !excluded[r.recordId]);
  const badRows = bankRows.filter(r => r.problems.length > 0);
  const sifTotal = okRows.reduce((s, r) => s + r.net, 0);

  const downloadSif = async () => {
    if (sProblems.length) { hrToast(sProblems[0], 'err'); return; }
    if (!okRows.length) { hrToast('No employees are ready for the WPS file', 'err'); return; }
    const skipped = bankRows.length - okRows.length;
    if (skipped > 0 && !(await ask(`${skipped} employee(s) are not ready or were unticked and will NOT be in this file (${bankRows.filter(r => !okRows.includes(r)).slice(0, 6).map(r => r.name).join(', ')}${skipped > 6 ? '…' : ''}). Download the file for the other ${okRows.length}?`))) return;
    const sif = buildSif(okRows, settings, month);
    downloadText(sif.fileName, sif.content);
    logAudit(user, 'Payroll / WPS', `WPS file ${sif.fileName}: ${sif.count} employees, AED ${sif.total.toFixed(2)}`);
    hrToast(`WPS file created: ${sif.count} employees · ${fmtAED(sif.total)}`);
  };

  const bankList = () => {
    const rows = [...okRows, ...cashRows].map(r => [r.employeeId, r.name, r.mode, r.iban, r.routing, r.net]);
    if (!rows.length) { hrToast('Nothing to export', 'err'); return; }
    downloadSheet(`Salary_transfer_list_${month}.xlsx`, ['Badge No', 'Employee', 'Paid by', 'IBAN', 'Routing code', 'Net salary (AED)'], rows, 'Salaries');
  };
  const register = () => {
    const rows = shown.map(r => [r.employeeId, r.employeeName, emap.get(r.employeeId)?.companyName || '', emap.get(r.employeeId)?.department || '', r.baseSalary, r.allowances, r.normalOtHours || 0, r.sundayOtHours || 0, r.deductions || 0, r.netSalary, r.status]);
    if (!rows.length) { hrToast('Nothing to export', 'err'); return; }
    downloadSheet(`Salary_register_${month}.xlsx`, ['Badge No', 'Employee', 'Company', 'Department', 'Basic', 'Allowances', 'Normal OT h', 'Sunday OT h', 'Deductions', 'Net', 'Status'], rows, 'Register');
  };

  return (
    <div className="space-y-4">
      {node}
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <SubTabs active={tab} onChange={setTab} tabs={[{ id: 'payslips', label: 'Payslips' }, { id: 'wps', label: 'WPS salary file', badge: badRows.length || undefined }, { id: 'settings', label: 'Company & bank setup' }]} />
        <select className={inputCls + ' !w-auto'} value={month} onChange={e => { setMonth(e.target.value); setPicked({}); setExcluded({}); }}>
          {(months.length ? months : [month]).map(m => <option key={m} value={m}>{new Date(m + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Payroll entries" value={records.length} tone="violet" icon={<Banknote className="h-4 w-4" />} />
        <StatCard label="Total net salary" value={fmtAED(total)} tone="slate" />
        <StatCard label="Ready for WPS" value={`${okRows.length} / ${bankRows.length}`} tone={badRows.length ? 'amber' : 'emerald'} icon={<ShieldCheck className="h-4 w-4" />} onClick={() => setTab('wps')} />
        <StatCard label="Paid in cash" value={cashRows.length} tone="slate" />
      </div>

      {records.length === 0 && <Empty text="No payroll entries for this month. Add them in the Payroll tab first — payslips and the WPS file are built from them." />}

      {tab === 'payslips' && records.length > 0 && (<>
        <div className="flex flex-wrap items-center gap-2 justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <SearchBox value={q} onChange={setQ} placeholder="Employee or badge…" />
            <OrgFilters employees={employees} company={company} dept={dept} onCompany={setCompany} onDept={setDept} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button className={btnGhost} onClick={register}><Download className="h-3.5 w-3.5" />Salary register (Excel)</button>
            <button className={btnGhost} disabled={!chosen.length} onClick={() => exportPayslipsPdf(slipsFor(chosen), `Payslips_selected_${month}`)}><FileText className="h-3.5 w-3.5" />Selected ({chosen.length})</button>
            <button className={btnPrimary} onClick={() => { exportPayslipsPdf(slipsFor(shown), `Payslips_${month}`); logAudit(user, 'Payroll / WPS', `Printed ${shown.length} payslip(s)`, month); }}><FileText className="h-4 w-4" />All payslips — one PDF ({shown.length})</button>
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase text-slate-400 border-b border-slate-100">
              <th className="px-3 py-2 w-8"><input type="checkbox" className="accent-violet-600" checked={shown.length > 0 && shown.every(r => picked[r.id])} onChange={e => setPicked(Object.fromEntries(shown.map(r => [r.id, e.target.checked])))} /></th>
              <th className="px-3 py-2">Employee</th><th className="px-3 py-2 text-right">Basic + allowances</th><th className="px-3 py-2 text-right">OT hours</th><th className="px-3 py-2 text-right">Deductions</th><th className="px-3 py-2 text-right">Net</th><th className="px-3 py-2">Status</th><th className="px-3 py-2" />
            </tr></thead>
            <tbody className="divide-y divide-slate-50">
              {shown.map(r => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2"><input type="checkbox" className="accent-violet-600" checked={!!picked[r.id]} onChange={e => setPicked(p => ({ ...p, [r.id]: e.target.checked }))} /></td>
                  <td className="px-3 py-2"><div className="font-semibold text-slate-800">{r.employeeName}</div><div className="text-[11px] text-slate-400">Badge {r.employeeId}{(() => { const e = emap.get(r.employeeId); return e && orgLabel(e) ? ` · ${orgLabel(e)}` : ''; })()}</div></td>
                  <td className="px-3 py-2 text-right">{fmtAED((r.baseSalary || 0) + (r.allowances || 0))}</td>
                  <td className="px-3 py-2 text-right text-slate-500">{(r.normalOtHours || 0) + (r.sundayOtHours || 0) || '—'}</td>
                  <td className="px-3 py-2 text-right text-slate-500">{r.deductions ? fmtAED(r.deductions) : '—'}</td>
                  <td className="px-3 py-2 text-right font-bold">{fmtAED(r.netSalary)}</td>
                  <td className="px-3 py-2"><Badge tone={r.status === 'Paid' ? 'emerald' : 'amber'}>{r.status}</Badge></td>
                  <td className="px-3 py-2 text-right"><button className={btnGhost} onClick={() => exportPayslipsPdf([slip(r)], `Payslip_${(r.employeeName || '').replace(/\s+/g, '_')}_${month}`)}><FileText className="h-3.5 w-3.5" />Payslip</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>)}

      {tab === 'wps' && (<>
        {sProblems.length > 0 ? (
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-4 py-3 text-sm"><TriangleAlert className="h-4 w-4 mt-0.5 shrink-0" />
            <div><b>Company details needed before a WPS file can be made:</b> {sProblems.join('; ')}. <button className="underline font-bold" onClick={() => setTab('settings')}>Open Company & bank setup</button></div></div>
        ) : null}
        {badRows.length > 0 && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-sm text-rose-900">
            <div className="font-bold mb-1 flex items-center gap-2"><TriangleAlert className="h-4 w-4" />{badRows.length} employee(s) cannot go in the file yet</div>
            <div className="flex flex-wrap gap-2 mt-2">
              <button className={btnGhost} onClick={() => onNavigate('grid')}><Table2 className="h-3.5 w-3.5" />Type bank details in Quick Entry</button>
              <ImportButton employees={employees} user={user} saveEmployees={saveEmployees} types={['profile']} initialType="profile" label="Import bank details from Excel" />
            </div>
          </div>
        )}
        {records.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase text-slate-400 border-b border-slate-100">
                <th className="px-3 py-2 w-8" /><th className="px-3 py-2">Employee</th><th className="px-3 py-2 text-right">Fixed</th><th className="px-3 py-2 text-right">Variable</th><th className="px-3 py-2 text-right">Net</th><th className="px-3 py-2 text-right">Unpaid leave</th><th className="px-3 py-2">Check</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-50">
                {wps.map(r => (
                  <tr key={r.recordId} className={r.problems.length ? 'bg-rose-50/40' : ''}>
                    <td className="px-3 py-2">{r.mode === 'WPS Bank' && r.problems.length === 0 && <input type="checkbox" className="accent-violet-600" checked={!excluded[r.recordId]} onChange={e => setExcluded(p => ({ ...p, [r.recordId]: !e.target.checked }))} />}</td>
                    <td className="px-3 py-2"><div className="font-semibold text-slate-800">{r.name}</div><div className="text-[11px] text-slate-400">Badge {r.employeeId}{r.iban ? ` · ${r.iban.slice(0, 4)}…${r.iban.slice(-4)}` : ''}</div></td>
                    <td className="px-3 py-2 text-right">{fmtAED(r.fixed)}</td><td className="px-3 py-2 text-right">{fmtAED(r.variable)}</td><td className="px-3 py-2 text-right font-bold">{fmtAED(r.net)}</td><td className="px-3 py-2 text-right text-slate-500">{r.leaveDays || '—'}</td>
                    <td className="px-3 py-2 text-xs">{r.mode === 'Cash' ? <Badge tone="slate">Paid in cash — not in WPS</Badge> : r.problems.length ? <span className="text-rose-700 font-semibold">{r.problems.join(' · ')}</span> : <Badge tone="emerald">Ready</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3">
          <div className="text-sm text-slate-700"><b>{okRows.length}</b> employee(s) · total <b>{fmtAED(sifTotal)}</b> · salary month {month}</div>
          <div className="flex gap-2"><button className={btnGhost} onClick={bankList}><Download className="h-3.5 w-3.5" />Bank transfer list (Excel)</button>
            <button className={btnPrimary} disabled={!okRows.length || sProblems.length > 0} onClick={downloadSif}><Download className="h-4 w-4" />Download WPS file (.SIF)</button></div>
        </div>
        <p className="text-[11px] text-slate-400">Upload the .SIF file in your bank's or exchange house's WPS portal. Fixed = basic + allowances; variable = overtime and other earnings, so the file total equals the net salary actually paid. Every bank's portal has its own final check — if it rejects a row, fix that employee here and download again.</p>
      </>)}

      {tab === 'settings' && <SettingsForm settings={settings} user={user} save={async s => { const ok = await runSave(() => setC.save(s), 'Company details saved'); if (ok) logAudit(user, 'Payroll / WPS', 'Updated company payroll settings'); return ok; }}
        missing={employees.filter(e => { const p = pmap.get(e.id); return (!p || p.paymentMode !== 'Cash') && (!p?.personCode || !p?.bankRoutingCode || !validateUaeIban(p?.iban || '').ok) && (!p?.status || p.status === 'Active'); }).length}
        onNavigate={onNavigate} employees={employees} saveEmployees={saveEmployees} />}
    </div>
  );
};

const SettingsForm: React.FC<{ settings: HRPayrollSettings; user?: string; save: (s: HRPayrollSettings) => Promise<boolean>; missing: number; onNavigate: (t: string) => void; employees: Employee[]; saveEmployees?: Props['saveEmployees'] }> = ({ settings, user, save, missing, onNavigate, employees, saveEmployees }) => {
  const [f, setF] = useState({ companyName: settings.companyName, establishmentId: settings.establishmentId || '', employerRoutingCode: settings.employerRoutingCode || '', bankName: settings.bankName || '', payerIban: settings.payerIban || '', address: settings.address || '' });
  const eid = f.establishmentId.replace(/\s+/g, ''), rc = f.employerRoutingCode.replace(/\s+/g, '');
  return (
    <div className="space-y-4">
      <SectionCard title="Company details (printed on payslips and used in the WPS file)">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Company name *"><input className={inputCls} value={f.companyName} onChange={e => setF(p => ({ ...p, companyName: e.target.value }))} /></Field>
          <Field label="Address (payslip header)"><input className={inputCls} value={f.address} onChange={e => setF(p => ({ ...p, address: e.target.value }))} placeholder="Sharjah, United Arab Emirates" /></Field>
          <Field label="Employer / establishment ID (MOHRE, 13 digits) *"><input className={inputCls} value={f.establishmentId} onChange={e => setF(p => ({ ...p, establishmentId: e.target.value }))} placeholder="0000000123456" />
            {eid && !isEmployerId(eid) && <span className="text-[11px] text-rose-600 font-semibold">Must be exactly 13 digits</span>}</Field>
          <Field label="Company bank routing code (9 digits) *"><input className={inputCls} value={f.employerRoutingCode} onChange={e => setF(p => ({ ...p, employerRoutingCode: e.target.value }))} placeholder="802420101" />
            {rc && !isRouting(rc) && <span className="text-[11px] text-rose-600 font-semibold">Must be exactly 9 digits</span>}</Field>
          <Field label="Company bank name"><input className={inputCls} value={f.bankName} onChange={e => setF(p => ({ ...p, bankName: e.target.value }))} /></Field>
          <Field label="Company account IBAN (for your reference)"><input className={inputCls} value={f.payerIban} onChange={e => setF(p => ({ ...p, payerIban: e.target.value.toUpperCase() }))} /></Field>
        </div>
        <div className="mt-3"><button className={btnPrimary} onClick={() => {
          if (!f.companyName.trim()) { hrToast('Enter the company name', 'err'); return; }
          if (eid && !isEmployerId(eid)) { hrToast('Employer ID must be 13 digits', 'err'); return; }
          if (rc && !isRouting(rc)) { hrToast('Routing code must be 9 digits', 'err'); return; }
          save({ ...settings, companyName: f.companyName.trim(), address: f.address.trim() || undefined, establishmentId: eid || undefined, employerRoutingCode: rc || undefined, bankName: f.bankName.trim() || undefined, payerIban: f.payerIban.replace(/\s+/g, '') || undefined, updatedAt: new Date().toISOString(), updatedBy: user });
        }}><Settings2 className="h-4 w-4" />Save company details</button></div>
        <p className="text-[11px] text-slate-400 mt-2">Your bank gives you the employer ID and routing code when WPS is set up for the company (they are also on your MOHRE establishment card / bank WPS agreement).</p>
      </SectionCard>
      <SectionCard title="Employee bank details">
        <p className="text-sm text-slate-600">{missing === 0 ? 'Every active employee paid by bank has a person code, routing code and a valid IBAN.' : <><b>{missing}</b> active employee(s) are missing a person code, routing code or valid IBAN.</>}</p>
        <div className="flex flex-wrap gap-2 mt-3">
          <button className={btnPrimary} onClick={() => onNavigate('grid')}><Table2 className="h-4 w-4" />Type them in Quick Entry → Bank & WPS</button>
          <ImportButton employees={employees} user={user} saveEmployees={saveEmployees} types={['profile']} initialType="profile" label="Import from Excel" />
          <button className={btnGhost} onClick={() => onNavigate('health')}><Save className="h-3.5 w-3.5" />Data Health (download a pre-filled sheet)</button>
        </div>
        <p className="text-[11px] text-slate-400 mt-2">Set "Salary Paid By" to <b>Cash</b> for anyone not paid through WPS — they are left out of the file.</p>
      </SectionCard>
    </div>
  );
};
