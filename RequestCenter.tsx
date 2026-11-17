import React, { useMemo, useState } from 'react';
import { Plus, Check, X, Download, FileText } from 'lucide-react';
import { Employee } from '../../types';
import {
  useHRCollection, HRRequest, RequestType, newId, nextRef, fmtD, fmtAED, monthStr, loanInfo, logAudit,
} from '../../lib/hrStore';
import { exportToExcel } from '../../lib/exportUtils';
import {
  Modal, Field, EmployeeSelect, inputCls, btnPrimary, btnGhost, StatCard, Badge, Empty, SearchBox, SubTabs,
  runSave, hrToast,
} from './hrUi';

interface Props { employees: Employee[]; user?: string; onGoLetters?: () => void }

const TYPES: RequestType[] = ['Salary Advance', 'Loan', 'Overtime', 'NOC', 'Salary Certificate', 'Experience Letter', 'Other'];
const isMoney = (t: RequestType) => t === 'Salary Advance' || t === 'Loan';
const isLetter = (t: RequestType) => t === 'NOC' || t === 'Salary Certificate' || t === 'Experience Letter';
const tone = (s: HRRequest['status']) => s === 'Approved' ? 'emerald' : s === 'Completed' ? 'sky' : s === 'Rejected' ? 'rose' : 'amber';

export const RequestCenter: React.FC<Props> = ({ employees, user, onGoLetters }) => {
  const reqC = useHRCollection<HRRequest>('hrRequests');
  const [tab, setTab] = useState('requests');
  const [q, setQ] = useState('');
  const [statusF, setStatusF] = useState<'All' | HRRequest['status']>('Pending');
  const [typeF, setTypeF] = useState<'All' | RequestType>('All');
  const [showNew, setShowNew] = useState(false);
  const [decide, setDecide] = useState<{ r: HRRequest; approve: boolean } | null>(null);
  const [otMonth, setOtMonth] = useState(monthStr());

  const all = reqC.items;
  const pending = all.filter(r => r.status === 'Pending').length;

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return all
      .filter(r => statusF === 'All' || r.status === statusF)
      .filter(r => typeF === 'All' || r.type === typeF)
      .filter(r => !s || r.employeeName.toLowerCase().includes(s) || r.reqNo.toLowerCase().includes(s))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [all, q, statusF, typeF]);

  const loans = useMemo(() => all.filter(r => isMoney(r.type) && (r.status === 'Approved' || r.status === 'Completed')), [all]);
  const outstanding = loans.reduce((s, r) => s + loanInfo(r).balance, 0);

  const otRows = useMemo(() => {
    const m = new Map<string, { name: string; normal: number; sunday: number; n: number }>();
    all.filter(r => r.type === 'Overtime' && (r.status === 'Approved' || r.status === 'Completed') && (r.otDate || '').startsWith(otMonth))
      .forEach(r => {
        const cur = m.get(r.employeeId) || { name: r.employeeName, normal: 0, sunday: 0, n: 0 };
        if (r.otKind === 'Sunday') cur.sunday += r.otHours || 0; else cur.normal += r.otHours || 0;
        cur.n++; m.set(r.employeeId, cur);
      });
    return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [all, otMonth]);

  const finish = async (r: HRRequest, status: HRRequest['status'], note?: string) => {
    const ok = await runSave(() => reqC.save({ ...r, status, decidedBy: user || 'HR', decidedAt: new Date().toISOString(), decisionNote: note || r.decisionNote }), `Request ${status.toLowerCase()}`);
    if (ok) logAudit(user, 'Requests', `${r.reqNo} ${status}`, r.employeeName);
    return ok;
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Pending approval" value={pending} tone={pending ? 'amber' : 'slate'} onClick={() => { setTab('requests'); setStatusF('Pending'); }} />
        <StatCard label="Active loans / advances" value={loans.filter(r => !loanInfo(r).cleared).length} tone="violet" onClick={() => setTab('loans')} />
        <StatCard label="Outstanding balance" value={fmtAED(outstanding)} tone={outstanding ? 'rose' : 'slate'} onClick={() => setTab('loans')} />
        <StatCard label={`OT hours (${otMonth})`} value={otRows.reduce((s, r) => s + r.normal + r.sunday, 0)} tone="emerald" onClick={() => setTab('ot')} />
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <SubTabs active={tab} onChange={setTab} tabs={[{ id: 'requests', label: 'Requests', badge: pending }, { id: 'loans', label: 'Loans & advances' }, { id: 'ot', label: 'Overtime summary' }]} />
        <button className={btnPrimary} onClick={() => setShowNew(true)}><Plus className="h-4 w-4" />New request</button>
      </div>

      {tab === 'requests' && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <SearchBox value={q} onChange={setQ} placeholder="Employee or request no…" />
            <select className={inputCls + ' !w-auto'} value={statusF} onChange={e => setStatusF(e.target.value as any)}>
              <option>All</option><option>Pending</option><option>Approved</option><option>Rejected</option><option>Completed</option>
            </select>
            <select className={inputCls + ' !w-auto'} value={typeF} onChange={e => setTypeF(e.target.value as any)}>
              <option>All</option>{TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          {shown.length === 0 ? <Empty text="No requests match." /> : (
            <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
              {shown.map(r => (
                <div key={r.id} className="px-4 py-3 flex flex-wrap items-center gap-3 justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-mono text-slate-400">{r.reqNo}</span>
                      <span className="text-sm font-bold text-slate-800">{r.employeeName}</span>
                      <Badge tone="violet">{r.type}</Badge><Badge tone={tone(r.status)}>{r.status}</Badge>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {isMoney(r.type) && <>{fmtAED(r.amount)} in {r.installments || 1} installment(s) from {r.startMonth || r.createdAt.slice(0, 7)} · </>}
                      {r.type === 'Overtime' && <>{r.otHours}h {r.otKind || 'Normal'} on {fmtD(r.otDate)} · </>}
                      {r.reason} <span className="text-slate-300">· by {r.requestedBy}, {fmtD(r.createdAt)}</span>
                    </div>
                    {r.decidedBy && <div className="text-[11px] text-slate-400">{r.status} by {r.decidedBy} on {fmtD(r.decidedAt)}{r.decisionNote ? ` — ${r.decisionNote}` : ''}</div>}
                  </div>
                  <div className="flex gap-2">
                    {r.status === 'Pending' && (<>
                      <button className="inline-flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg" onClick={() => setDecide({ r, approve: true })}><Check className="h-3.5 w-3.5" />Approve</button>
                      <button className="inline-flex items-center gap-1 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg" onClick={() => setDecide({ r, approve: false })}><X className="h-3.5 w-3.5" />Reject</button>
                    </>)}
                    {r.status === 'Approved' && isLetter(r.type) && onGoLetters && <button className={btnGhost} onClick={onGoLetters}><FileText className="h-3.5 w-3.5" />Create letter</button>}
                    {r.status === 'Approved' && (r.type === 'Other' || isLetter(r.type)) && <button className={btnGhost} onClick={() => finish(r, 'Completed')}>Mark completed</button>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'loans' && (
        loans.length === 0 ? <Empty text="No approved loans or advances yet." /> : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase text-slate-400 border-b border-slate-100">
                <th className="px-4 py-2">Employee</th><th className="px-4 py-2">Type</th><th className="px-4 py-2 text-right">Amount</th>
                <th className="px-4 py-2 text-right">Installment</th><th className="px-4 py-2 text-right">Paid</th><th className="px-4 py-2 text-right">Balance</th><th className="px-4 py-2" />
              </tr></thead>
              <tbody className="divide-y divide-slate-50">
                {loans.map(r => {
                  const li = loanInfo(r);
                  return (
                    <tr key={r.id}>
                      <td className="px-4 py-2 font-semibold text-slate-800">{r.employeeName}<div className="text-[11px] text-slate-400 font-normal">from {r.startMonth || r.createdAt.slice(0, 7)}</div></td>
                      <td className="px-4 py-2">{r.type}</td>
                      <td className="px-4 py-2 text-right">{fmtAED(li.amount)}</td>
                      <td className="px-4 py-2 text-right">{fmtAED(li.installment)}</td>
                      <td className="px-4 py-2 text-right">{li.paidCount}/{li.installments}</td>
                      <td className="px-4 py-2 text-right font-bold">{li.cleared ? <Badge tone="emerald">Cleared</Badge> : <span className="text-rose-600">{fmtAED(li.balance)}</span>}</td>
                      <td className="px-4 py-2 text-right">
                        {!li.cleared && <button className={btnGhost} onClick={async () => {
                          const m = monthStr();
                          if ((r.deductedMonths || []).includes(m)) { hrToast('This month is already recorded', 'err'); return; }
                          const ok = await runSave(() => reqC.save({ ...r, deductedMonths: [...(r.deductedMonths || []), m] }), 'Deduction recorded');
                          if (ok) logAudit(user, 'Requests', `Recorded ${m} deduction`, r.employeeName);
                        }}>Record {monthStr()} deduction</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-[11px] text-slate-400 px-4 py-2">Payroll picks these installments up automatically when you add a payroll entry for the month.</p>
          </div>
        )
      )}

      {tab === 'ot' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <input type="month" className={inputCls + ' !w-auto'} value={otMonth} onChange={e => setOtMonth(e.target.value)} />
            <button className={btnGhost} onClick={() => otRows.length ? exportToExcel(otRows.map(r => ({ Employee: r.name, 'Normal OT hrs': r.normal, 'Sunday OT hrs': r.sunday, Requests: r.n })), `HR_Overtime_${otMonth}`, 'Overtime') : hrToast('Nothing to export', 'err')}><Download className="h-3.5 w-3.5" />Excel</button>
          </div>
          {otRows.length === 0 ? <Empty text="No approved overtime for this month." /> : (
            <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] uppercase text-slate-400 border-b border-slate-100"><th className="px-4 py-2">Employee</th><th className="px-4 py-2 text-right">Normal OT (×1.22)</th><th className="px-4 py-2 text-right">Sunday OT (×1.50)</th><th className="px-4 py-2 text-right">Requests</th></tr></thead>
                <tbody className="divide-y divide-slate-50">
                  {otRows.map(r => <tr key={r.name}><td className="px-4 py-2 font-semibold text-slate-800">{r.name}</td><td className="px-4 py-2 text-right">{r.normal}</td><td className="px-4 py-2 text-right">{r.sunday}</td><td className="px-4 py-2 text-right text-slate-400">{r.n}</td></tr>)}
                </tbody>
              </table>
              <p className="text-[11px] text-slate-400 px-4 py-2">These approved hours can be applied in one click when adding the employee's payroll entry.</p>
            </div>
          )}
        </div>
      )}

      {showNew && <NewRequest employees={employees} user={user} existing={all} onClose={() => setShowNew(false)}
        save={async r => { const ok = await runSave(() => reqC.save(r), 'Request submitted'); if (ok) { logAudit(user, 'Requests', `Submitted ${r.reqNo} (${r.type})`, r.employeeName); setShowNew(false); } }} />}

      {decide && <DecideModal r={decide.r} approve={decide.approve} onClose={() => setDecide(null)}
        onDone={async note => { if (await finish(decide.r, decide.approve ? 'Approved' : 'Rejected', note)) setDecide(null); }} />}
    </div>
  );
};

const NewRequest: React.FC<{ employees: Employee[]; user?: string; existing: HRRequest[]; onClose: () => void; save: (r: HRRequest) => Promise<void> }> = ({ employees, user, existing, onClose, save }) => {
  const [f, setF] = useState({
    type: 'Salary Advance' as RequestType, employeeId: '', reason: '', amount: '', installments: '1', startMonth: monthStr(),
    otDate: '', otHours: '', otKind: 'Normal' as 'Normal' | 'Sunday', requestedBy: user || '',
  });
  const submit = () => {
    if (!f.employeeId) { hrToast('Choose an employee', 'err'); return; }
    if (isMoney(f.type) && !(parseFloat(f.amount) > 0)) { hrToast('Enter the amount', 'err'); return; }
    if (f.type === 'Overtime' && (!f.otDate || !(parseFloat(f.otHours) > 0))) { hrToast('Enter the OT date and hours', 'err'); return; }
    if (!f.reason.trim()) { hrToast('Write a reason', 'err'); return; }
    const emp = employees.find(e => e.id === f.employeeId)!;
    save({
      id: newId('req'), reqNo: nextRef('RQ', existing.map(r => r.reqNo)), type: f.type, employeeId: emp.id, employeeName: emp.name,
      requestedBy: f.requestedBy.trim() || user || 'HR', reason: f.reason.trim(), status: 'Pending', createdAt: new Date().toISOString(),
      ...(isMoney(f.type) ? { amount: parseFloat(f.amount), installments: Math.max(1, parseInt(f.installments) || 1), startMonth: f.startMonth, deductedMonths: [] } : {}),
      ...(f.type === 'Overtime' ? { otDate: f.otDate, otHours: parseFloat(f.otHours), otKind: f.otKind } : {}),
    });
  };
  const inst = Math.max(1, parseInt(f.installments) || 1);
  return (
    <Modal title="New request" onClose={onClose} footer={<><button className={btnGhost} onClick={onClose}>Cancel</button><button className={btnPrimary} onClick={submit}>Submit</button></>}>
      <Field label="Type"><select className={inputCls} value={f.type} onChange={e => setF(p => ({ ...p, type: e.target.value as RequestType }))}>{TYPES.map(t => <option key={t}>{t}</option>)}</select></Field>
      <Field label="Employee *"><EmployeeSelect employees={employees} value={f.employeeId} onChange={id => setF(p => ({ ...p, employeeId: id }))} /></Field>
      {isMoney(f.type) && (<>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount (AED) *"><input type="number" className={inputCls} value={f.amount} onChange={e => setF(p => ({ ...p, amount: e.target.value }))} /></Field>
          <Field label="Installments (months)"><input type="number" min={1} className={inputCls} value={f.installments} onChange={e => setF(p => ({ ...p, installments: e.target.value }))} /></Field>
        </div>
        <Field label="First deduction month"><input type="month" className={inputCls} value={f.startMonth} onChange={e => setF(p => ({ ...p, startMonth: e.target.value }))} /></Field>
        {parseFloat(f.amount) > 0 && <p className="text-xs text-violet-700 bg-violet-50 rounded-lg p-2">{fmtAED(Math.ceil((parseFloat(f.amount) / inst) * 100) / 100)} will be deducted per month for {inst} month(s).</p>}
      </>)}
      {f.type === 'Overtime' && (
        <div className="grid grid-cols-3 gap-3">
          <Field label="OT date *"><input type="date" className={inputCls} value={f.otDate} onChange={e => setF(p => ({ ...p, otDate: e.target.value }))} /></Field>
          <Field label="Hours *"><input type="number" step="0.5" className={inputCls} value={f.otHours} onChange={e => setF(p => ({ ...p, otHours: e.target.value }))} /></Field>
          <Field label="Rate"><select className={inputCls} value={f.otKind} onChange={e => setF(p => ({ ...p, otKind: e.target.value as any }))}><option>Normal</option><option>Sunday</option></select></Field>
        </div>
      )}
      <Field label="Reason / details *"><textarea rows={2} className={inputCls + ' resize-none'} value={f.reason} onChange={e => setF(p => ({ ...p, reason: e.target.value }))} /></Field>
      <Field label="Requested by"><input className={inputCls} value={f.requestedBy} onChange={e => setF(p => ({ ...p, requestedBy: e.target.value }))} placeholder="Employee / supervisor name" /></Field>
    </Modal>
  );
};

const DecideModal: React.FC<{ r: HRRequest; approve: boolean; onClose: () => void; onDone: (note: string) => void }> = ({ r, approve, onClose, onDone }) => {
  const [note, setNote] = useState('');
  return (
    <Modal title={`${approve ? 'Approve' : 'Reject'} ${r.reqNo}`} onClose={onClose}
      footer={<><button className={btnGhost} onClick={onClose}>Cancel</button><button className={approve ? btnPrimary : 'inline-flex items-center gap-2 bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold px-4 py-2 rounded-lg'} onClick={() => { if (!approve && !note.trim()) { hrToast('Give a reason for rejecting', 'err'); return; } onDone(note.trim()); }}>{approve ? 'Approve' : 'Reject'}</button></>}>
      <p className="text-sm text-slate-600"><b>{r.employeeName}</b> — {r.type}{r.amount ? ` · ${fmtAED(r.amount)}` : ''}{r.otHours ? ` · ${r.otHours}h` : ''}</p>
      <Field label={approve ? 'Note (optional)' : 'Reason for rejection *'}><textarea rows={2} className={inputCls + ' resize-none'} value={note} onChange={e => setNote(e.target.value)} /></Field>
    </Modal>
  );
};
