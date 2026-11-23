import React, { useMemo, useState } from 'react';
import { Settings2, Download, Plus, Trash2, CalendarCheck, TriangleAlert } from 'lucide-react';
import { Employee } from '../../types';
import {
  useHRCollection, HRLeavePolicy, HRLeaveAdjust, HRHoliday, HRProfile, LeaveLite, DEFAULT_LEAVE_POLICY, newId, todayStr, fmtD, logAudit,
} from '../../lib/hrStore';
import { computeBalance, requestDays, leaveYearOf, leaveYearLabel, leaveYearRange, Balance } from '../../lib/leaveBalance';
import { downloadSheet } from '../../lib/excelImport';
import { ImportButton } from './ExcelImport';
import {
  Modal, Field, inputCls, btnPrimary, btnGhost, StatCard, Badge, Empty, SearchBox, SectionCard, runSave, useConfirm, hrToast,
} from './hrUi';

const usePolicyData = () => {
  const polC = useHRCollection<HRLeavePolicy>('hrLeavePolicy');
  const adjC = useHRCollection<HRLeaveAdjust>('hrLeaveAdjust');
  const holC = useHRCollection<HRHoliday>('hrHolidays');
  const policy: HRLeavePolicy = { ...DEFAULT_LEAVE_POLICY, ...(polC.items.find(p => p.id === 'policy') || {}) };
  return { polC, adjC, holC, policy };
};

interface Props { employees: Employee[]; leaves: LeaveLite[]; user?: string; saveEmployees?: (list: Employee[]) => void | Promise<void> }

export const LeaveBalance: React.FC<Props> = ({ employees, leaves, user, saveEmployees }) => {
  const { polC, adjC, holC, policy } = usePolicyData();
  const profC = useHRCollection<HRProfile>('hrProfiles');
  const today = todayStr();
  const [year, setYear] = useState(() => leaveYearOf(today, DEFAULT_LEAVE_POLICY.leaveYearStartMonth));
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('All');
  const [lowOnly, setLowOnly] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showPolicy, setShowPolicy] = useState(false);

  const pmap = useMemo(() => new Map(profC.items.map(p => [p.id, p])), [profC.items]);
  const active = useMemo(() => employees.filter(e => { const s = pmap.get(e.id)?.status; return !s || s === 'Active'; }), [employees, pmap]);
  const depts = useMemo(() => ['All', ...Array.from(new Set(active.map(e => e.department).filter(Boolean))).sort()], [active]);
  const years = useMemo(() => { const cur = leaveYearOf(today, policy.leaveYearStartMonth); return [cur + 1, cur, cur - 1, cur - 2]; }, [today, policy.leaveYearStartMonth]);

  const rows = useMemo(() => active.map(e => ({
    e, b: computeBalance({ employeeId: e.id, joiningDate: pmap.get(e.id)?.joiningDate, leaves, adjusts: adjC.items, holidays: holC.items, policy, year, today }),
  })), [active, pmap, leaves, adjC.items, holC.items, policy, year, today]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter(r => dept === 'All' || r.e.department === dept)
      .filter(r => !s || r.e.name.toLowerCase().includes(s) || r.e.id.toLowerCase().includes(s))
      .filter(r => !lowOnly || r.b.balance < 5)
      .sort((a, b) => a.b.balance - b.b.balance || a.e.name.localeCompare(b.e.name));
  }, [rows, q, dept, lowOnly]);

  const stats = useMemo(() => ({
    taken: rows.reduce((s, r) => s + r.b.taken, 0),
    over: rows.filter(r => r.b.balance < 0).length,
    low: rows.filter(r => r.b.balance >= 0 && r.b.balance < 5).length,
    avg: rows.length ? Math.round((rows.reduce((s, r) => s + r.b.balance, 0) / rows.length) * 10) / 10 : 0,
  }), [rows]);

  const range = leaveYearRange(year, policy.leaveYearStartMonth);
  const open = rows.find(r => r.e.id === openId);

  const exportXlsx = () => {
    const head = ['Badge No', 'Employee', 'Department', 'Joined', 'Entitlement', 'Earned so far', 'Carried forward', 'Taken before ERP', 'Adjustment', 'Annual taken', 'Annual pending', 'Balance now', 'Balance (full year)', 'Sick used', 'Emergency used', 'Unpaid days'];
    const data = shown.map(({ e, b }) => [e.id, e.name, e.department || '', pmap.get(e.id)?.joiningDate || '', b.entitledFull, b.accrued, b.carryForward, b.takenBeforeErp, b.adjustment, b.taken, b.pending, b.balance, b.balanceFullYear, b.sickUsed, b.emergencyUsed, b.unpaidUsed]);
    if (!data.length) { hrToast('Nothing to export', 'err'); return; }
    downloadSheet(`Leave_balances_${leaveYearLabel(year, policy.leaveYearStartMonth).replace('/', '-')}.xlsx`, head, data, 'Leave balances');
  };

  const cell = 'px-3 py-2 text-right whitespace-nowrap';
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Average balance" value={`${stats.avg} days`} tone="violet" icon={<CalendarCheck className="h-4 w-4" />} />
        <StatCard label="Annual days taken" value={stats.taken} sub={`leave year ${leaveYearLabel(year, policy.leaveYearStartMonth)}`} tone="slate" />
        <StatCard label="Over-drawn (below 0)" value={stats.over} tone={stats.over ? 'rose' : 'slate'} onClick={() => setLowOnly(true)} icon={<TriangleAlert className="h-4 w-4" />} />
        <StatCard label="Low (under 5 days)" value={stats.low} tone={stats.low ? 'amber' : 'slate'} onClick={() => setLowOnly(true)} />
      </div>

      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <select className={inputCls + ' !w-auto'} value={year} onChange={e => setYear(Number(e.target.value))}>{years.map(y => <option key={y} value={y}>Leave year {leaveYearLabel(y, policy.leaveYearStartMonth)}</option>)}</select>
          <SearchBox value={q} onChange={setQ} placeholder="Employee or badge…" />
          <select className={inputCls + ' !w-auto'} value={dept} onChange={e => setDept(e.target.value)}>{depts.map(d => <option key={d}>{d}</option>)}</select>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600"><input type="checkbox" className="accent-violet-600" checked={lowOnly} onChange={e => setLowOnly(e.target.checked)} />Low / over-drawn only</label>
        </div>
        <div className="flex gap-2">
          <ImportButton employees={employees} user={user} saveEmployees={saveEmployees} types={['leavebalance']} initialType="leavebalance" label="Import opening balances" />
          <button className={btnGhost} onClick={exportXlsx}><Download className="h-3.5 w-3.5" />Excel</button>
          <button className={btnGhost} onClick={() => setShowPolicy(true)}><Settings2 className="h-3.5 w-3.5" />Leave policy</button>
        </div>
      </div>
      <p className="text-[11px] text-slate-400">{fmtD(range.from)} – {fmtD(range.to)} · {policy.annualDays} annual days · {policy.accrual === 'monthly' ? 'earned day by day through the year' : 'full entitlement from day one'}{policy.excludeHolidays ? ' · public holidays inside annual leave are not charged' : ''}.</p>

      {shown.length === 0 ? <Empty text="No employees match." /> : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase text-slate-400 border-b border-slate-100">
              <th className="px-3 py-2">Employee</th><th className="px-3 py-2">Joined</th><th className="px-3 py-2 text-right">Entitlement</th><th className="px-3 py-2 text-right">Earned</th>
              <th className="px-3 py-2 text-right">Carried / adj.</th><th className="px-3 py-2 text-right">Taken</th><th className="px-3 py-2 text-right">Pending</th><th className="px-3 py-2 text-right">Balance</th>
              <th className="px-3 py-2 text-right">Sick</th><th className="px-3 py-2 text-right">Emerg.</th><th className="px-3 py-2 text-right">Unpaid</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-50">
              {shown.slice(0, 500).map(({ e, b }) => (
                <tr key={e.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setOpenId(e.id)}>
                  <td className="px-3 py-2"><div className="font-semibold text-slate-800">{e.name}</div><div className="text-[11px] text-slate-400">Badge {e.id}{e.department ? ` · ${e.department}` : ''}</div></td>
                  <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{b.joiningMissing ? <Badge tone="amber">missing</Badge> : fmtD(pmap.get(e.id)?.joiningDate)}</td>
                  <td className={cell}>{b.entitledFull}</td><td className={cell}>{b.accrued}</td>
                  <td className={cell}>{Math.round((b.carryForward + b.adjustment - b.takenBeforeErp) * 10) / 10}</td>
                  <td className={cell}>{b.taken}</td><td className={cell + ' text-slate-400'}>{b.pending || '—'}</td>
                  <td className={cell + ' font-black ' + (b.balance < 0 ? 'text-rose-600' : b.balance < 5 ? 'text-amber-600' : 'text-emerald-600')}>{b.balance}</td>
                  <td className={cell + (b.sickUsed > policy.sickDays ? ' text-rose-600 font-bold' : '')}>{b.sickUsed || '—'}</td><td className={cell}>{b.emergencyUsed || '—'}</td><td className={cell}>{b.unpaidUsed || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length > 500 && <p className="text-[11px] text-slate-400 px-4 py-2">Showing 500 of {shown.length}. Filter by department, or export to Excel.</p>}
        </div>
      )}
      <p className="text-[11px] text-slate-400">Employees without a joining date are treated as having the full-year entitlement — add it in Employee 360 or with the profile import.</p>

      {showPolicy && <PolicyModal policy={policy} user={user} onClose={() => setShowPolicy(false)} save={async p => { const ok = await runSave(() => polC.save(p), 'Leave policy saved'); if (ok) { logAudit(user, 'Leave balance', 'Updated leave policy'); setShowPolicy(false); } }} />}
      {open && <DetailModal row={open} year={year} policy={policy} leaves={leaves} adjusts={adjC.items} holidays={holC.items} user={user} onClose={() => setOpenId(null)} adjC={adjC} />}
    </div>
  );
};

// ─── Policy ───
const PolicyModal: React.FC<{ policy: HRLeavePolicy; user?: string; onClose: () => void; save: (p: HRLeavePolicy) => void }> = ({ policy, user, onClose, save }) => {
  const [f, setF] = useState({ annualDays: String(policy.annualDays), sickDays: String(policy.sickDays), emergencyDays: String(policy.emergencyDays), startMonth: String(policy.leaveYearStartMonth), accrual: policy.accrual, carry: String(policy.carryForwardMax), excl: policy.excludeHolidays });
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return (
    <Modal title="Leave policy" onClose={onClose} footer={<><button className={btnGhost} onClick={onClose}>Cancel</button><button className={btnPrimary} onClick={() => {
      const a = Number(f.annualDays), s = Number(f.sickDays), em = Number(f.emergencyDays), c = Number(f.carry);
      if (![a, s, em, c].every(n => Number.isFinite(n) && n >= 0) || a === 0) { hrToast('Enter valid day counts (annual days must be above 0)', 'err'); return; }
      save({ ...policy, annualDays: a, sickDays: s, emergencyDays: em, carryForwardMax: c, leaveYearStartMonth: Number(f.startMonth), accrual: f.accrual, excludeHolidays: f.excl, updatedAt: new Date().toISOString(), updatedBy: user });
    }}>Save policy</button></>}>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Annual leave (days / year)"><input type="number" min={1} className={inputCls} value={f.annualDays} onChange={e => setF(p => ({ ...p, annualDays: e.target.value }))} /></Field>
        <Field label="Sick leave (days / year)"><input type="number" min={0} className={inputCls} value={f.sickDays} onChange={e => setF(p => ({ ...p, sickDays: e.target.value }))} /></Field>
        <Field label="Emergency (days / year)"><input type="number" min={0} className={inputCls} value={f.emergencyDays} onChange={e => setF(p => ({ ...p, emergencyDays: e.target.value }))} /></Field>
      </div>
      <Field label="Leave year starts in"><select className={inputCls} value={f.startMonth} onChange={e => setF(p => ({ ...p, startMonth: e.target.value }))}>{months.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></Field>
      <Field label="How leave is earned">
        <select className={inputCls} value={f.accrual} onChange={e => setF(p => ({ ...p, accrual: e.target.value as any }))}><option value="monthly">Earned day by day through the year (balance grows)</option><option value="upfront">Full entitlement available from the first day</option></select>
      </Field>
      <Field label="Maximum days that may be carried into the next year (guide)"><input type="number" min={0} className={inputCls} value={f.carry} onChange={e => setF(p => ({ ...p, carry: e.target.value }))} /></Field>
      <label className="flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" className="accent-violet-600 mt-0.5" checked={f.excl} onChange={e => setF(p => ({ ...p, excl: e.target.checked }))} />Public and company holidays that fall inside annual leave are not counted as leave days</label>
      <p className="text-[11px] text-slate-400">Set these to match your contracts and the UAE Labour Law. New joiners are prorated from their joining date.</p>
    </Modal>
  );
};

// ─── One employee: leaves + adjustments ───
const DetailModal: React.FC<{
  row: { e: Employee; b: Balance }; year: number; policy: HRLeavePolicy; leaves: LeaveLite[]; adjusts: HRLeaveAdjust[]; holidays: HRHoliday[]; user?: string; onClose: () => void;
  adjC: ReturnType<typeof useHRCollection<HRLeaveAdjust>>;
}> = ({ row, year, policy, leaves, adjusts, holidays, user, onClose, adjC }) => {
  const { e, b } = row;
  const { ask, node } = useConfirm();
  const [f, setF] = useState({ kind: 'Carry forward' as HRLeaveAdjust['kind'], days: '', note: '' });
  const mine = leaves.filter(l => l.employeeId === e.id && l.status !== 'Rejected' && l.toDate >= b.range.from && l.fromDate <= b.range.to).sort((a, c) => c.fromDate.localeCompare(a.fromDate));
  const myAdj = adjusts.filter(a => a.employeeId === e.id && a.year === year);

  const add = async () => {
    const d = Number(f.days);
    if (!Number.isFinite(d) || d === 0) { hrToast('Enter the number of days', 'err'); return; }
    if (f.kind !== 'Adjustment' && d < 0) { hrToast('Use a positive number here', 'err'); return; }
    const rec: HRLeaveAdjust = { id: newId('la'), employeeId: e.id, employeeName: e.name, year, kind: f.kind, days: d, note: f.note.trim() || undefined, createdAt: new Date().toISOString(), createdBy: user };
    const ok = await runSave(() => adjC.save(rec), 'Saved');
    if (ok) { logAudit(user, 'Leave balance', `${f.kind}: ${d} day(s)`, e.name); setF({ kind: 'Carry forward', days: '', note: '' }); }
  };

  return (
    <Modal wide title={`${e.name} — leave ${leaveYearLabel(year, policy.leaveYearStartMonth)}`} onClose={onClose}>
      {node}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center">
        {[['Entitlement', b.entitledFull], ['Earned so far', b.accrued], ['Taken', b.taken], ['Balance now', b.balance]].map(([l, v]) => (
          <div key={String(l)} className={`rounded-xl border p-3 ${l === 'Balance now' ? (Number(v) < 0 ? 'bg-rose-50 border-rose-200' : 'bg-emerald-50 border-emerald-200') : 'bg-slate-50 border-slate-200'}`}>
            <div className="text-[11px] font-bold uppercase text-slate-400">{l}</div><div className="text-xl font-black text-slate-800">{v}</div></div>
        ))}
      </div>
      {policy.accrual === 'monthly' && <p className="text-[11px] text-slate-400">If the whole year were available the balance would be <b>{b.balanceFullYear}</b> days.</p>}

      <SectionCard title={`Leave in this year (${mine.length})`}>
        {mine.length === 0 ? <p className="text-xs text-slate-400">No leave recorded.</p> : (
          <div className="divide-y divide-slate-100">
            {mine.map(l => {
              const r = requestDays(l.leaveType, l.fromDate, l.toDate, holidays, policy);
              return (<div key={l.id} className="py-1.5 flex items-center justify-between gap-2 text-sm">
                <span><b>{l.leaveType}</b> · {fmtD(l.fromDate)} → {fmtD(l.toDate)} <span className="text-slate-400">({r.calendar} day(s){r.holidaysInside ? `, ${r.holidaysInside} holiday(s) not charged` : ''})</span></span>
                <Badge tone={l.status === 'Approved' ? 'emerald' : 'amber'}>{l.status}</Badge></div>);
            })}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Carry-forward & adjustments">
        {myAdj.length === 0 ? <p className="text-xs text-slate-400 mb-2">None yet. Use these for days carried from last year, leave used before the ERP started, or a correction.</p> : (
          <div className="divide-y divide-slate-100 mb-3">
            {myAdj.map(a => (
              <div key={a.id} className="py-1.5 flex items-center justify-between gap-2 text-sm">
                <span><b>{a.kind}</b> {a.kind === 'Taken before ERP' ? `${a.days} day(s) used` : `${a.days > 0 ? '+' : ''}${a.days} day(s)`}{a.note ? <span className="text-slate-400"> · {a.note}</span> : ''}</span>
                <button className="text-slate-300 hover:text-rose-600" aria-label="Delete" onClick={async () => { if (!(await ask('Delete this entry?'))) return; const ok = await runSave(() => adjC.remove(a.id), 'Deleted'); if (ok) logAudit(user, 'Leave balance', `Deleted ${a.kind}`, e.name); }}><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-[170px_100px_1fr_auto] gap-2 items-end">
          <Field label="Type"><select className={inputCls} value={f.kind} onChange={e2 => setF(p => ({ ...p, kind: e2.target.value as any }))}><option>Carry forward</option><option>Taken before ERP</option><option>Adjustment</option></select></Field>
          <Field label="Days"><input type="number" step="0.5" className={inputCls} value={f.days} onChange={e2 => setF(p => ({ ...p, days: e2.target.value }))} /></Field>
          <Field label="Note"><input className={inputCls} value={f.note} onChange={e2 => setF(p => ({ ...p, note: e2.target.value }))} /></Field>
          <button className={btnPrimary} onClick={add}><Plus className="h-4 w-4" /></button>
        </div>
        {f.kind === 'Carry forward' && policy.carryForwardMax > 0 && Number(f.days) > policy.carryForwardMax && <p className="text-[11px] text-amber-600 mt-1 font-semibold">More than the policy maximum of {policy.carryForwardMax} days.</p>}
      </SectionCard>
    </Modal>
  );
};

// ─── Small card for Employee 360 ───
export const LeaveBalanceCard: React.FC<{ employeeId: string; joiningDate?: string; leaves: LeaveLite[] }> = ({ employeeId, joiningDate, leaves }) => {
  const { adjC, holC, policy } = usePolicyData();
  const today = todayStr();
  const year = leaveYearOf(today, policy.leaveYearStartMonth);
  const b = computeBalance({ employeeId, joiningDate, leaves, adjusts: adjC.items, holidays: holC.items, policy, year, today });
  return (
    <SectionCard title={`Leave balance ${leaveYearLabel(year, policy.leaveYearStartMonth)}`}>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
        {[['Entitlement', b.entitledFull], ['Earned', b.accrued], ['Taken', b.taken], ['Balance', b.balance]].map(([l, v]) => (
          <div key={String(l)} className="bg-slate-50 rounded-lg p-2"><div className="text-[10px] font-bold uppercase text-slate-400">{l}</div><div className={`text-lg font-black ${l === 'Balance' ? (Number(v) < 0 ? 'text-rose-600' : 'text-emerald-600') : 'text-slate-800'}`}>{v}</div></div>
        ))}
      </div>
      {(b.pending > 0 || b.sickUsed > 0) && <p className="text-[11px] text-slate-400 mt-2">{b.pending > 0 ? `${b.pending} annual day(s) pending approval. ` : ''}{b.sickUsed > 0 ? `Sick leave used: ${b.sickUsed} of ${policy.sickDays}.` : ''}</p>}
      {b.joiningMissing && <p className="text-[11px] text-amber-600 mt-1 font-semibold">Joining date is missing — the full-year entitlement is assumed.</p>}
    </SectionCard>
  );
};

// ─── Live hint inside the "New Leave Request" form ───
export const LeaveBalanceHint: React.FC<{ employeeId?: string; leaveType?: string; fromDate?: string; toDate?: string; leaves: LeaveLite[] }> = ({ employeeId, leaveType = 'Annual', fromDate, toDate, leaves }) => {
  const { adjC, holC, policy } = usePolicyData();
  const profC = useHRCollection<HRProfile>('hrProfiles');
  if (!employeeId) return null;
  const today = todayStr();
  const year = leaveYearOf(fromDate || today, policy.leaveYearStartMonth);
  const b = computeBalance({ employeeId, joiningDate: profC.items.find(p => p.id === employeeId)?.joiningDate, leaves, adjusts: adjC.items, holidays: holC.items, policy, year, today });
  const r = requestDays(leaveType, fromDate || '', toDate || '', holC.items, policy);
  const over = leaveType === 'Annual' && r.charged > 0 && r.charged > b.balance;
  return (
    <div className={`rounded-lg border px-3 py-2 text-xs ${over ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-violet-50 border-violet-200 text-violet-800'}`}>
      {leaveType === 'Annual' ? <>Annual leave balance now: <b>{b.balance}</b> day(s).</> : leaveType === 'Sick' ? <>Sick leave used this year: <b>{b.sickUsed}</b> of {policy.sickDays}.</> : leaveType === 'Emergency' ? <>Emergency leave used: <b>{b.emergencyUsed}</b> of {policy.emergencyDays}.</> : <>Unpaid leave taken this year: <b>{b.unpaidUsed}</b> day(s).</>}
      {r.calendar > 0 && <> This request is {r.calendar} day(s){r.holidaysInside ? `, ${r.holidaysInside} public holiday(s) not charged → ${r.charged} charged` : ''}.</>}
      {over && <> <b>It is {Math.round((r.charged - b.balance) * 10) / 10} day(s) more than the available balance.</b></>}
    </div>
  );
};
