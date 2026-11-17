import React, { useEffect, useMemo, useState } from 'react';
import { Printer, Save, Trash2, Calculator } from 'lucide-react';
import { Employee } from '../../types';
import {
  useHRCollection, HRSettlement, HRProfile, HRRequest, calcGratuity, loanInfo, newId, nextRef, todayStr, fmtD, fmtAED, logAudit,
} from '../../lib/hrStore';
import { exportSettlementPdf } from '../../lib/hrPdf';
import { Field, EmployeeSelect, inputCls, btnPrimary, btnGhost, SectionCard, Badge, Empty, runSave, useConfirm, hrToast } from './hrUi';

interface Props { employees: Employee[]; user?: string }

const num = (s: string) => { const n = parseFloat(s); return isNaN(n) ? 0 : n; };

export const FinalSettlement: React.FC<Props> = ({ employees, user }) => {
  const setC = useHRCollection<HRSettlement>('hrSettlements');
  const profC = useHRCollection<HRProfile>('hrProfiles');
  const reqC = useHRCollection<HRRequest>('hrRequests');
  const { ask, node } = useConfirm();

  const [empId, setEmpId] = useState('');
  const [f, setF] = useState({ joining: '', lastDay: todayStr(), basic: '', total: '', unpaid: '0', leaveDays: '0', pendingDays: '0', notice: '0', addl: '0', otherDed: '0', loan: '0', notes: '' });
  const emp = employees.find(e => e.id === empId);
  const prof = profC.items.find(p => p.id === empId);

  // Pre-fill from the employee profile and any outstanding loans.
  const loanBalance = useMemo(() => reqC.items.filter(r => r.employeeId === empId && (r.type === 'Loan' || r.type === 'Salary Advance') && r.status === 'Approved')
    .reduce((s, r) => s + loanInfo(r).balance, 0), [reqC.items, empId]);
  useEffect(() => {
    if (!empId) return;
    setF(p => ({
      ...p, joining: prof?.joiningDate || '', lastDay: prof?.exitDate || todayStr(),
      basic: prof?.basicSalary ? String(prof.basicSalary) : '', total: prof?.basicSalary ? String(prof.basicSalary) : '',
      loan: String(Math.round(loanBalance * 100) / 100),
    }));
  }, [empId, prof?.joiningDate, prof?.exitDate, prof?.basicSalary, loanBalance]);

  const basic = num(f.basic);
  const g = calcGratuity(basic, f.joining, f.lastDay, num(f.unpaid));
  const leaveAmount = Math.round((basic / 30) * num(f.leaveDays) * 100) / 100;
  const pendingAmount = Math.round((num(f.total || f.basic) / 30) * num(f.pendingDays) * 100) / 100;
  const additions = g.gratuity + leaveAmount + pendingAmount + num(f.notice) + num(f.addl);
  const deductions = num(f.loan) + num(f.otherDed);
  const net = Math.round((additions - deductions) * 100) / 100;

  const record = (): HRSettlement | null => {
    if (!emp) { hrToast('Choose an employee', 'err'); return null; }
    if (!f.joining) { hrToast('Joining date is required (set it in Employee 360)', 'err'); return null; }
    if (!(basic > 0)) { hrToast('Enter the last basic salary', 'err'); return null; }
    return {
      id: newId('set'), refNo: nextRef('FS', setC.items.map(s => s.refNo)), employeeId: emp.id, employeeName: emp.name,
      joiningDate: f.joining, lastWorkingDay: f.lastDay, basicSalary: basic, unpaidDays: num(f.unpaid), serviceYears: g.years,
      gratuity: g.gratuity, leaveDays: num(f.leaveDays), leaveAmount, pendingSalaryDays: num(f.pendingDays), pendingSalaryAmount: pendingAmount,
      noticePay: num(f.notice), otherAdditions: num(f.addl), loanDeduction: num(f.loan), otherDeductions: num(f.otherDed), net,
      notes: f.notes.trim() || undefined, createdBy: user, createdAt: new Date().toISOString(),
    };
  };

  const saveAndPrint = async () => {
    const r = record(); if (!r) return;
    const ok = await runSave(() => setC.save(r), `Settlement ${r.refNo} saved`);
    if (!ok) return;
    logAudit(user, 'Final settlement', `Saved ${r.refNo} — net ${fmtAED(r.net)}`, r.employeeName);
    await exportSettlementPdf(r);
  };

  return (
    <div className="space-y-4">
      {node}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-4">
        <SectionCard title="Final settlement & gratuity calculator">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Employee *" className="sm:col-span-2"><EmployeeSelect employees={employees} value={empId} onChange={setEmpId} /></Field>
            <Field label="Joining date *"><input type="date" className={inputCls} value={f.joining} onChange={e => setF(p => ({ ...p, joining: e.target.value }))} /></Field>
            <Field label="Last working day *"><input type="date" className={inputCls} value={f.lastDay} onChange={e => setF(p => ({ ...p, lastDay: e.target.value }))} /></Field>
            <Field label="Last basic salary (AED / month) *"><input type="number" className={inputCls} value={f.basic} onChange={e => setF(p => ({ ...p, basic: e.target.value }))} /></Field>
            <Field label="Total monthly salary (for pending salary)"><input type="number" className={inputCls} value={f.total} onChange={e => setF(p => ({ ...p, total: e.target.value }))} /></Field>
            <Field label="Unpaid leave days (not counted in service)"><input type="number" min={0} className={inputCls} value={f.unpaid} onChange={e => setF(p => ({ ...p, unpaid: e.target.value }))} /></Field>
            <Field label="Unused annual leave (days)"><input type="number" min={0} step="0.5" className={inputCls} value={f.leaveDays} onChange={e => setF(p => ({ ...p, leaveDays: e.target.value }))} /></Field>
            <Field label="Pending salary (days worked, unpaid)"><input type="number" min={0} className={inputCls} value={f.pendingDays} onChange={e => setF(p => ({ ...p, pendingDays: e.target.value }))} /></Field>
            <Field label="Notice pay (AED)"><input type="number" min={0} className={inputCls} value={f.notice} onChange={e => setF(p => ({ ...p, notice: e.target.value }))} /></Field>
            <Field label="Other additions (AED)"><input type="number" min={0} className={inputCls} value={f.addl} onChange={e => setF(p => ({ ...p, addl: e.target.value }))} /></Field>
            <Field label={`Loan / advance balance${loanBalance ? ' (from Requests)' : ''}`}><input type="number" min={0} className={inputCls} value={f.loan} onChange={e => setF(p => ({ ...p, loan: e.target.value }))} /></Field>
            <Field label="Other deductions (AED)"><input type="number" min={0} className={inputCls} value={f.otherDed} onChange={e => setF(p => ({ ...p, otherDed: e.target.value }))} /></Field>
            <Field label="Notes" className="sm:col-span-2"><input className={inputCls} value={f.notes} onChange={e => setF(p => ({ ...p, notes: e.target.value }))} /></Field>
          </div>
        </SectionCard>

        <SectionCard title="Result" right={<Calculator className="h-4 w-4 text-violet-500" />}>
          {!emp ? <Empty text="Choose an employee." /> : (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-slate-500"><span>Service</span><b className="text-slate-800">{Math.floor(g.years)} yr {Math.round((g.years % 1) * 12)} mo</b></div>
              {!g.eligible && g.years > 0 && <p className="text-xs text-amber-600 bg-amber-50 rounded p-2 font-semibold">Less than 1 year of service — no gratuity is due.</p>}
              {g.capped && <p className="text-xs text-amber-600 bg-amber-50 rounded p-2 font-semibold">Gratuity was limited to 2 years’ wage (the legal cap).</p>}
              <Row label="Gratuity" v={g.gratuity} /><Row label="Leave encashment" v={leaveAmount} /><Row label="Pending salary" v={pendingAmount} />
              <Row label="Notice pay + other" v={num(f.notice) + num(f.addl)} />
              <Row label="Loan + other deductions" v={-deductions} neg />
              <div className="border-t border-slate-200 pt-2 flex justify-between text-base font-black"><span>Net payable</span><span className={net < 0 ? 'text-rose-600' : 'text-emerald-600'}>{fmtAED(net)}</span></div>
              <button className={btnPrimary + ' w-full justify-center'} onClick={saveAndPrint}><Printer className="h-4 w-4" />Save & print settlement</button>
              <p className="text-[11px] text-slate-400">Estimate under UAE Federal Decree-Law 33/2021: 21 days’ basic wage per year for the first 5 years, 30 days after, capped at 2 years’ wage. Confirm unusual cases with a labour-law adviser.</p>
            </div>
          )}
        </SectionCard>
      </div>

      <SectionCard title={`Saved settlements (${setC.items.length})`}>
        {setC.items.length === 0 ? <Empty text="No settlements saved yet." /> : (
          <div className="divide-y divide-slate-100">
            {[...setC.items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(s => (
              <div key={s.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2"><span className="text-xs font-mono text-slate-400">{s.refNo}</span><span className="font-bold text-sm text-slate-800">{s.employeeName}</span><Badge tone="emerald">{fmtAED(s.net)}</Badge></div>
                  <div className="text-[11px] text-slate-400">Last day {fmtD(s.lastWorkingDay)} · gratuity {fmtAED(s.gratuity)} · by {s.createdBy || 'HR'}</div>
                </div>
                <div className="flex gap-2">
                  <button className={btnGhost} onClick={() => exportSettlementPdf(s)}><Printer className="h-3.5 w-3.5" />Print</button>
                  <button className="text-slate-300 hover:text-rose-600" aria-label="Delete" onClick={async () => { if (!(await ask(`Delete settlement ${s.refNo}?`))) return; const ok = await runSave(() => setC.remove(s.id), 'Settlement deleted'); if (ok) logAudit(user, 'Final settlement', `Deleted ${s.refNo}`, s.employeeName); }}><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
};

const Row: React.FC<{ label: string; v: number; neg?: boolean }> = ({ label, v, neg }) => (
  <div className="flex justify-between text-slate-600"><span>{label}</span><span className={neg && v < 0 ? 'text-rose-600' : 'text-slate-800'}>{fmtAED(v)}</span></div>
);
