import React, { useMemo, useRef, useState } from 'react';
import { Upload, Download, Settings2, FileSpreadsheet, AlertTriangle, CheckCircle2, Clock, Search } from 'lucide-react';
import { Employee } from '../../types';
import { useHRCollection, HRProfile, HRHoliday, HRRequest, PayrollLite, LeaveLite, loanDueIn, fmtAED, fmtD, logAudit, monthStr } from '../../lib/hrStore';
import {
  DEFAULT_OT_RULES, OvertimeRules, parseAttendanceSheet, groupByEmployee, calcEmployeeMonth, latestPay, minToClock, hourlyBasic, EmployeeMonth, ParsedSheet,
} from '../../lib/overtimeEngine';
import { readWorkbook, downloadWorkbook, downloadSheet } from '../../lib/excelImport';
import { EmployeeSearchSelect } from './EmployeeSearchSelect';
import { Modal, Field, inputCls, btnPrimary, btnGhost, StatCard, Badge, Empty, SectionCard, runSave, hrToast } from './hrUi';

interface Props { employees: Employee[]; payroll: PayrollLite[]; leaves: LeaveLite[]; user?: string }

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const num = (s: string) => { const n = parseFloat(s); return isNaN(n) ? 0 : n; };
const defaultMonth = () => { const d = new Date(); if (d.getDate() <= 12) d.setMonth(d.getMonth() - 1); return monthStr(d); };
const monthName = (m: string) => new Date(m + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

interface Edit { basic?: string; allowances?: string; deductions?: string }

export const OvertimeSalary: React.FC<Props> = ({ employees, payroll, leaves, user }) => {
  const rulesC = useHRCollection<OvertimeRules>('hrOvertimeRules');
  const profC = useHRCollection<HRProfile>('hrProfiles');
  const holC = useHRCollection<HRHoliday>('hrHolidays');
  const reqC = useHRCollection<HRRequest>('hrRequests');
  const rules: OvertimeRules = { ...DEFAULT_OT_RULES, ...(rulesC.items.find(r => r.id === 'rules') || {}) };

  const [month, setMonth] = useState(defaultMonth());
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<ParsedSheet | null>(null);
  const [rawRows, setRawRows] = useState<any[][] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const pmap = useMemo(() => new Map(profC.items.map(p => [p.id, p])), [profC.items]);
  const emap = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees]);

  const load = async (file: File | undefined | null, forMonth = month) => {
    if (!file) return;
    setError(null); setPicked({}); setEdits({});
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) { setError('Please choose an Excel (.xlsx / .xls) or .csv file.'); return; }
    try {
      const { rows } = await readWorkbook(file);
      const p = parseAttendanceSheet(rows, { month: forMonth });
      if (!p.days.length) { setParsed(null); setError(p.issues[0] || 'No attendance rows were found.'); return; }
      // pick the month the sheet is about (unless it is a day-number grid, which needs the month chosen first)
      let m = forMonth;
      if (p.layout !== 'grid') {
        const counts = new Map<string, number>(); p.days.forEach(d => counts.set(d.date.slice(0, 7), (counts.get(d.date.slice(0, 7)) || 0) + 1));
        const top = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]; if (top) m = top[0];
      }
      setMonth(m); setFileName(file.name); setRawRows(rows); setParsed(p);
    } catch (e: any) { setParsed(null); setError(e?.message || 'Could not read that file.'); }
  };
  const changeMonth = (m: string) => {            // a grid sheet depends on the month: read it again
    setMonth(m);
    if (parsed?.layout === 'grid' && rawRows) setParsed(parseAttendanceSheet(rawRows, { month: m }));
  };

  const monthDays = useMemo(() => (parsed?.days || []).filter(d => d.date.startsWith(month)), [parsed, month]);
  const outside = (parsed?.days.length || 0) - monthDays.length;

  const sheetEmps = useMemo(() => groupByEmployee(monthDays, employees.map(e => ({ id: e.id, name: e.name, department: e.department }))), [monthDays, employees]);

  const rows = useMemo(() => {
    const out = sheetEmps.map(se => {
      const auto = ['badge', 'name'].includes(se.match.status) ? se.match.emp?.id : undefined;
      const empId = picked[se.key] ?? auto ?? '';
      return { se, empId };
    });
    // the same person twice in the sheet (badge row + name row) → merge their days
    const merged = new Map<string, { keys: string[]; se: typeof sheetEmps[0]; empId: string; days: typeof monthDays }>();
    out.forEach(({ se, empId }) => {
      const k = empId || `u:${se.key}`;
      const cur = merged.get(k);
      if (cur) { cur.days = [...cur.days, ...se.days]; cur.keys.push(se.key); } else merged.set(k, { keys: [se.key], se, empId, days: [...se.days] });
    });
    const coverUntil = (parsed?.maxDate && parsed.maxDate.startsWith(month) ? parsed.maxDate : `${month}-31`);
    return Array.from(merged.values()).map(m => {
      const emp = emap.get(m.empId);
      const prof = m.empId ? pmap.get(m.empId) : undefined;
      const pay = m.empId ? latestPay(m.empId, payroll, month) : { basic: 0, allowances: 0 };
      const loanDue = m.empId ? reqC.items.filter(r => r.employeeId === m.empId).reduce((s, r) => s + loanDueIn(r, month), 0) : 0;
      const ed = edits[m.empId || m.keys[0]] || {};
      const basic = ed.basic !== undefined ? num(ed.basic) : (prof?.basicSalary ?? pay.basic);
      const allowances = ed.allowances !== undefined ? num(ed.allowances) : pay.allowances;
      const deductions = ed.deductions !== undefined ? num(ed.deductions) : Math.round(loanDue * 100) / 100;
      const calc: EmployeeMonth | null = m.empId ? calcEmployeeMonth({ employeeId: m.empId, month, days: m.days, basic, allowances, deductions, rules, holidays: holC.items, leaves, coverUntil }) : null;
      return { ...m, emp, prof, basic, allowances, deductions, calc, basicFrom: ed.basic !== undefined ? 'typed' : prof?.basicSalary ? 'profile' : pay.basic ? 'last payroll' : 'missing', loanDue, edKey: m.empId || m.keys[0] };
    }).sort((a, b) => (a.se.name || a.se.badge).localeCompare(b.se.name || b.se.badge));
  }, [sheetEmps, picked, edits, emap, pmap, payroll, reqC.items, rules, holC.items, leaves, month, parsed]);

  const ok = rows.filter(r => r.calc);
  const unmatched = rows.filter(r => !r.calc);
  const noBasic = ok.filter(r => !(r.basic > 0));
  const totals = ok.reduce((s, r) => ({ ot: s.ot + r.calc!.otTotal, net: s.net + r.calc!.net, nOt: s.nOt + r.calc!.normalOtHours, sOt: s.sOt + r.calc!.offHours }), { ot: 0, net: 0, nOt: 0, sOt: 0 });
  const flagged = ok.flatMap(r => r.calc!.days.filter(d => d.status === 'MISSING_PUNCH' || d.note.startsWith('CHECK')).map(d => ({ r, d })));
  const open = rows.find(r => r.edKey === openKey);
  const setEdit = (key: string, patch: Edit) => setEdits(p => ({ ...p, [key]: { ...(p[key] || {}), ...patch } }));

  const exportXlsx = () => {
    if (!ok.length) { hrToast('Nothing to export yet', 'err'); return; }
    const salary = ok.map(r => { const c = r.calc!; return [r.emp?.id || '', r.emp?.name || r.se.name, r.emp?.department || r.se.dept, r.basic, r.allowances, c.daysWorked, c.normalOtHours, c.offHours, c.hourly, c.normalOtAmount, c.offAmount, c.otTotal, c.absentDays, c.unpaidLeaveDays, c.absenceDeduction, r.deductions, c.gross, c.net, [c.missingPunchDays ? `${c.missingPunchDays} missing punch day(s)` : '', !(r.basic > 0) ? 'BASIC SALARY MISSING' : ''].filter(Boolean).join('; ')]; });
    const sum = (i: number) => Math.round(salary.reduce((s, r) => s + Number(r[i] || 0), 0) * 100) / 100;
    salary.push(['', 'TOTAL', '', sum(3), sum(4), '', sum(6), sum(7), '', sum(9), sum(10), sum(11), '', '', sum(14), sum(15), sum(16), sum(17), '']);
    const detail = ok.flatMap(r => r.calc!.days.map(d => [r.emp?.id || '', r.emp?.name || r.se.name, d.date, DAYS[d.dow], d.offDay ? (d.holiday ? 'Holiday' : 'Weekly off') : 'Working', minToClock(d.inMin), minToClock(d.outMin), d.gross, d.breakH, d.presence, d.normalOt, d.offHours, d.status === 'WORKED' ? '' : d.status === 'MISSING_PUNCH' ? 'Missing punch' : 'No punch', d.note]));
    const exceptions: unknown[][] = [
      ...unmatched.map(r => ['Not matched to an employee', r.se.badge, r.se.name, `${r.days.length} day(s) in the sheet`]),
      ...flagged.map(({ r, d }) => [d.status === 'MISSING_PUNCH' ? 'Missing punch' : 'Please check', r.emp?.id || '', r.emp?.name || '', `${d.date}: ${d.note}`]),
      ...ok.filter(r => !(r.basic > 0)).map(r => ['Basic salary missing', r.emp?.id || '', r.emp?.name || '', 'Overtime cannot be priced']),
      ...(parsed?.issues || []).map(i => ['Sheet problem', '', '', i]),
      ...(outside > 0 ? [['Outside the month', '', '', `${outside} row(s) dated outside ${monthName(month)} were ignored`]] : []),
    ];
    const rulesSheet = [
      ['Month', monthName(month)], ['Normal duty hours per day', rules.dutyHours], ['Overtime after duty hours, × hourly basic', rules.normalMultiplier], ['Weekly off day', DAYS[rules.weeklyOffDay]],
      ['Break deducted on weekly off day (hours)', rules.sundayBreakHours], ['Weekly off day hours, × hourly basic', rules.sundayMultiplier], ['Break deducted on normal days (hours)', rules.weekdayBreakHours],
      ['Hourly basic = basic ÷ days ÷ hours', `${rules.hourlyDaysDivisor} ÷ ${rules.hourlyHoursDivisor}`], ['Company holidays paid like the weekly off day', rules.holidayLikeSunday ? 'Yes' : 'No'],
      ['Overtime rounded down to (minutes)', rules.roundMinutes], ['Ignore weekday overtime under (minutes)', rules.minOvertimeMinutes], ['Absence deducted from salary', rules.deductAbsence ? 'Yes' : 'No'],
      ['Source sheet', fileName], ['Created', new Date().toLocaleString('en-GB')],
    ];
    downloadWorkbook(`Salary_with_overtime_${month}.xlsx`, [
      { name: 'Salary', headers: ['Badge No', 'Employee', 'Department', 'Basic', 'Allowances', 'Days worked', 'Normal OT hours', 'Weekly-off hours (after break)', 'Hourly basic', 'Normal OT amount', 'Weekly-off amount', 'Total overtime', 'Absent days', 'Unpaid leave days', 'Absence deduction', 'Other deductions', 'Gross salary', 'Net salary', 'Remarks'], rows: salary, widths: [10, 26, 16, 10, 11, 11, 13, 16, 11, 14, 14, 13, 10, 12, 13, 13, 12, 12, 34] },
      { name: 'Daily detail', headers: ['Badge No', 'Employee', 'Date', 'Day', 'Day type', 'In', 'Out', 'Hours in factory', 'Break deducted', 'Counted hours', 'Normal OT hours', 'Weekly-off hours', 'Status', 'Note'], rows: detail },
      { name: 'Exceptions', headers: ['Type', 'Badge No', 'Employee', 'Details'], rows: exceptions.length ? exceptions : [['None', '', '', 'No problems found']], widths: [26, 10, 26, 60] },
      { name: 'Rules used', headers: ['Rule', 'Value'], rows: rulesSheet, widths: [48, 26] },
    ]);
    logAudit(user, 'Overtime & salary sheet', `Exported ${ok.length} employee(s) for ${month}`, fileName);
  };

  const sample = () => downloadSheet('Attendance_sheet_sample.xlsx', ['BadgeNumber', 'EmployeeName', 'DepartmentName', 'AttendanceDate', 'ActualCheckIn', 'ActualCheckOut'], [
    ['1023', 'Ali Hassan Khan', 'Lamination', '02/11/2026', '08:00', '18:30'], ['1023', 'Ali Hassan Khan', 'Lamination', '03/11/2026', '08:00', '17:00'], ['1023', 'Ali Hassan Khan', 'Lamination', '08/11/2026', '08:00', '17:00'],
    ['1024', 'Omar Said', 'Gelcoat', '02/11/2026', '07:30', '19:45'], ['1024', 'Omar Said', 'Gelcoat', '03/11/2026', '00:00', 'Absent'],
  ], 'Attendance');

  const saveRules = async (r: OvertimeRules) => { const ok2 = await runSave(() => rulesC.save(r), 'Overtime rules saved'); if (ok2) { logAudit(user, 'Overtime & salary sheet', 'Changed overtime rules'); setShowRules(false); } };

  return (
    <div className="space-y-4">
      <SectionCard title="Overtime rules in use" right={<button className={btnGhost} onClick={() => setShowRules(true)}><Settings2 className="h-3.5 w-3.5" />Change rules</button>}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <div className="bg-slate-50 rounded-lg p-3"><div className="text-[11px] font-bold uppercase text-slate-400">Normal day</div><div className="text-slate-700 mt-1">First <b>{rules.dutyHours} h</b> are normal duty. After that, each hour = <b>{rules.normalMultiplier}×</b> hourly basic.</div></div>
          <div className="bg-slate-50 rounded-lg p-3"><div className="text-[11px] font-bold uppercase text-slate-400">{DAYS[rules.weeklyOffDay]}</div><div className="text-slate-700 mt-1"><b>{rules.sundayBreakHours} h</b> break is deducted; every remaining hour = <b>{rules.sundayMultiplier}×</b> hourly basic.</div></div>
          <div className="bg-slate-50 rounded-lg p-3"><div className="text-[11px] font-bold uppercase text-slate-400">Hourly basic</div><div className="text-slate-700 mt-1">Basic ÷ <b>{rules.hourlyDaysDivisor}</b> ÷ <b>{rules.hourlyHoursDivisor}</b> {rules.holidayLikeSunday ? '· holidays paid like ' + DAYS[rules.weeklyOffDay] : ''}</div></div>
        </div>
      </SectionCard>

      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex items-center gap-2"><label className="text-xs font-bold text-slate-500">Salary month</label><input type="month" className={inputCls + ' !w-auto'} value={month} onChange={e => changeMonth(e.target.value)} /></div>
        <div className="flex gap-2">
          <button className={btnGhost} onClick={sample}><Download className="h-3.5 w-3.5" />Sample sheet</button>
          {parsed && <button className={btnGhost} onClick={() => { setParsed(null); setRawRows(null); setFileName(''); setPicked({}); setEdits({}); }}>Choose another file</button>}
          <button className={btnPrimary} disabled={!ok.length} onClick={exportXlsx}><FileSpreadsheet className="h-4 w-4" />Download salary Excel</button>
        </div>
      </div>

      {error && <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl px-4 py-3 text-sm"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /><span>{error}</span></div>}

      {!parsed && (
        <div onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); load(e.dataTransfer.files?.[0]); }} onClick={() => fileInput.current?.click()}
          className={`border-2 border-dashed rounded-2xl py-14 text-center cursor-pointer ${drag ? 'border-emerald-500 bg-emerald-50' : 'border-slate-300 hover:bg-slate-50'}`}>
          <Upload className="h-8 w-8 text-slate-400 mx-auto mb-2" />
          <div className="text-sm font-bold text-slate-700">Drop the attendance Excel sheet here, or click to choose</div>
          <div className="text-xs text-slate-400 mt-1 max-w-xl mx-auto">Your biometric export (BadgeNumber, EmployeeName, AttendanceDate, ActualCheckIn, ActualCheckOut) · a raw punch log · hours per day · or a monthly grid with day numbers across. Nothing is saved — you get an Excel file back.</div>
          <input ref={fileInput} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { load(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
      )}

      {parsed && (<>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <StatCard label="Employees calculated" value={ok.length} sub={`${fileName} · ${monthName(month)}`} tone="violet" icon={<CheckCircle2 className="h-4 w-4" />} />
          <StatCard label="Normal overtime" value={`${Math.round(totals.nOt * 100) / 100} h`} tone="slate" icon={<Clock className="h-4 w-4" />} />
          <StatCard label={`${DAYS[rules.weeklyOffDay]} hours`} value={`${Math.round(totals.sOt * 100) / 100} h`} tone="slate" />
          <StatCard label="Total overtime pay" value={fmtAED(totals.ot)} tone="amber" />
          <StatCard label="Total net salaries" value={fmtAED(totals.net)} tone="emerald" />
        </div>

        {(unmatched.length > 0 || noBasic.length > 0 || flagged.length > 0 || outside > 0 || parsed.issues.length > 0) && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-900 space-y-1">
            <div className="font-bold flex items-center gap-2"><AlertTriangle className="h-4 w-4" />Please check before you download</div>
            {unmatched.length > 0 && <div>• {unmatched.length} person(s) in the sheet are not matched to an employee — choose them in the table below (they are left out until you do).</div>}
            {noBasic.length > 0 && <div>• {noBasic.length} employee(s) have no basic salary — type it in the Basic column (or save it in Employee 360).</div>}
            {flagged.length > 0 && <div>• {flagged.length} day(s) have a missing punch or an unusual number of hours — see the details of each employee (flagged in the Excel “Exceptions” sheet).</div>}
            {outside > 0 && <div>• {outside} row(s) dated outside {monthName(month)} were ignored.</div>}
            {parsed.issues.slice(0, 3).map((i, k) => <div key={k}>• {i}</div>)}
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase text-slate-400 border-b border-slate-100">
              <th className="px-3 py-2">In your sheet</th><th className="px-3 py-2 min-w-[210px]">Matched employee</th><th className="px-3 py-2 text-right">Basic</th><th className="px-3 py-2 text-right">Allowances</th>
              <th className="px-3 py-2 text-right">Days</th><th className="px-3 py-2 text-right">Normal OT h</th><th className="px-3 py-2 text-right">{DAYS[rules.weeklyOffDay]} h</th><th className="px-3 py-2 text-right">Overtime pay</th>
              <th className="px-3 py-2 text-right">Deductions</th><th className="px-3 py-2 text-right">Net salary</th><th className="px-3 py-2" />
            </tr></thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map(r => {
                const c = r.calc; const k = r.edKey;
                return (
                  <tr key={k} className={!c ? 'bg-rose-50/40' : !(r.basic > 0) ? 'bg-amber-50/50' : ''}>
                    <td className="px-3 py-2"><div className="font-semibold text-slate-800">{r.se.name || '—'}</div><div className="text-[11px] text-slate-400">{r.se.badge ? `Badge ${r.se.badge}` : 'no badge'} · {r.days.length} row(s)</div></td>
                    <td className="px-3 py-2">
                      <EmployeeSearchSelect employees={employees} value={r.empId} onChange={id => setPicked(p => { const n = { ...p }; r.keys.forEach(kk => { n[kk] = id; }); return n; })} accent="teal" placeholder="Choose employee…" />
                      {!c && <div className="mt-1"><Badge tone="rose">{r.se.match.status === 'ambiguous' ? 'Several matches' : r.se.match.status === 'name-partial' ? 'Similar name — confirm' : r.se.match.status === 'conflict' ? 'Badge & name differ' : 'Not found'}</Badge></div>}
                    </td>
                    <td className="px-3 py-2 text-right">{c ? <input type="number" min={0} className="w-24 border border-slate-200 rounded px-2 py-1 text-right text-sm" value={edits[k]?.basic ?? (r.basic || '')} placeholder="0" onChange={e => setEdit(k, { basic: e.target.value })} title={`from ${r.basicFrom}`} /> : '—'}</td>
                    <td className="px-3 py-2 text-right">{c ? <input type="number" min={0} className="w-24 border border-slate-200 rounded px-2 py-1 text-right text-sm" value={edits[k]?.allowances ?? (r.allowances || '')} placeholder="0" onChange={e => setEdit(k, { allowances: e.target.value })} /> : '—'}</td>
                    <td className="px-3 py-2 text-right">{c ? <>{c.daysWorked}{c.missingPunchDays > 0 && <span className="ml-1 text-amber-600 font-bold" title="missing punch">⚠{c.missingPunchDays}</span>}</> : '—'}</td>
                    <td className="px-3 py-2 text-right">{c ? c.normalOtHours : '—'}</td><td className="px-3 py-2 text-right">{c ? c.offHours : '—'}</td>
                    <td className="px-3 py-2 text-right font-semibold">{c ? fmtAED(c.otTotal) : '—'}</td>
                    <td className="px-3 py-2 text-right">{c ? <input type="number" min={0} className="w-20 border border-slate-200 rounded px-2 py-1 text-right text-sm" value={edits[k]?.deductions ?? (r.deductions || '')} placeholder="0" onChange={e => setEdit(k, { deductions: e.target.value })} title={r.loanDue ? `loan installment ${fmtAED(r.loanDue)} suggested` : ''} /> : '—'}</td>
                    <td className="px-3 py-2 text-right font-black text-slate-800">{c ? fmtAED(c.net) : '—'}</td>
                    <td className="px-3 py-2 text-right">{c && <button className={btnGhost} onClick={() => setOpenKey(k)}><Search className="h-3.5 w-3.5" />Days</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-slate-400">Basic comes from the employee's HR profile (or the last payroll entry) — you can type over it for this calculation. Deductions start with any loan / advance installment due that month. Net = basic + allowances + overtime − deductions{rules.deductAbsence ? ' − absence' : ''}. This calculation is not saved; download the Excel for your records.</p>
      </>)}

      {!parsed && !error && <Empty text="Upload the attendance sheet to see overtime and salary for every employee." />}

      {open && open.calc && (
        <Modal wide title={`${open.emp?.name || open.se.name} — ${monthName(month)}`} onClose={() => setOpenKey(null)}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center">
            {[['Worked days', open.calc.daysWorked], ['Normal OT hours', open.calc.normalOtHours], [`${DAYS[rules.weeklyOffDay]} hours`, open.calc.offHours], ['Hourly basic', `AED ${hourlyBasic(open.basic, rules).toFixed(2)}`]].map(([l, v]) => (
              <div key={String(l)} className="bg-slate-50 rounded-lg p-2"><div className="text-[10px] font-bold uppercase text-slate-400">{l}</div><div className="text-lg font-black text-slate-800">{v}</div></div>
            ))}
          </div>
          <div className="text-xs text-slate-500 flex flex-wrap gap-x-4">
            <span>Normal OT: {open.calc.normalOtHours} h × {open.calc.hourly.toFixed(2)} × {rules.normalMultiplier} = <b>{fmtAED(open.calc.normalOtAmount)}</b></span>
            <span>{DAYS[rules.weeklyOffDay]}: {open.calc.offHours} h × {open.calc.hourly.toFixed(2)} × {rules.sundayMultiplier} = <b>{fmtAED(open.calc.offAmount)}</b></span>
            <span>Absent: {open.calc.absentDays} day(s){open.calc.paidLeaveDays ? ` · paid leave ${open.calc.paidLeaveDays}` : ''}{open.calc.unpaidLeaveDays ? ` · unpaid leave ${open.calc.unpaidLeaveDays}` : ''}{rules.deductAbsence ? ` · deduction ${fmtAED(open.calc.absenceDeduction)}` : ' (not deducted)'}</span>
          </div>
          <div className="border border-slate-200 rounded-xl overflow-x-auto max-h-[46vh]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white"><tr className="text-left text-[11px] uppercase text-slate-400 border-b border-slate-100"><th className="px-3 py-2">Date</th><th className="px-3 py-2">In</th><th className="px-3 py-2">Out</th><th className="px-3 py-2 text-right">Hours</th><th className="px-3 py-2 text-right">Break</th><th className="px-3 py-2 text-right">Normal OT</th><th className="px-3 py-2 text-right">{DAYS[rules.weeklyOffDay]}</th><th className="px-3 py-2">Note</th></tr></thead>
              <tbody className="divide-y divide-slate-50">
                {open.calc.days.map(d => (
                  <tr key={d.date} className={d.offDay ? 'bg-sky-50/40' : d.status !== 'WORKED' || d.note.startsWith('CHECK') ? 'bg-amber-50/50' : ''}>
                    <td className="px-3 py-1.5 whitespace-nowrap">{fmtD(d.date)} <span className="text-slate-400 text-xs">{DAYS[d.dow]}{d.holiday ? ' · holiday' : ''}</span></td>
                    <td className="px-3 py-1.5">{minToClock(d.inMin) || '—'}</td><td className="px-3 py-1.5">{minToClock(d.outMin) || '—'}</td>
                    <td className="px-3 py-1.5 text-right">{d.status === 'WORKED' ? d.gross : '—'}</td><td className="px-3 py-1.5 text-right text-slate-400">{d.breakH || '—'}</td>
                    <td className="px-3 py-1.5 text-right font-semibold">{d.normalOt || '—'}</td><td className="px-3 py-1.5 text-right font-semibold">{d.offHours || '—'}</td>
                    <td className="px-3 py-1.5 text-xs text-amber-700">{d.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}

      {showRules && <RulesModal rules={rules} onClose={() => setShowRules(false)} save={saveRules} />}
    </div>
  );
};

const RulesModal: React.FC<{ rules: OvertimeRules; onClose: () => void; save: (r: OvertimeRules) => void }> = ({ rules, onClose, save }) => {
  const [f, setF] = useState({ ...rules });
  const n = (k: keyof OvertimeRules, v: string) => setF(p => ({ ...p, [k]: v === '' ? ('' as any) : Number(v) }));
  const field = (k: keyof OvertimeRules, label: string, step = '0.01') => <Field label={label}><input type="number" step={step} min={0} className={inputCls} value={f[k] as any} onChange={e => n(k, e.target.value)} /></Field>;
  return (
    <Modal wide title="Overtime rules" onClose={onClose} footer={<><button className={btnGhost} onClick={() => setF({ ...DEFAULT_OT_RULES })}>Reset to standard</button><button className={btnGhost} onClick={onClose}>Cancel</button><button className={btnPrimary} onClick={() => {
      const nums = [f.dutyHours, f.normalMultiplier, f.sundayMultiplier, f.sundayBreakHours, f.weekdayBreakHours, f.hourlyDaysDivisor, f.hourlyHoursDivisor, f.minOvertimeMinutes, f.roundMinutes];
      if (nums.some(x => typeof x !== 'number' || !isFinite(x) || x < 0) || !(f.dutyHours > 0) || !(f.hourlyDaysDivisor > 0) || !(f.hourlyHoursDivisor > 0) || !(f.roundMinutes >= 1)) { hrToast('Check the numbers — duty hours and the divisors must be above 0, rounding at least 1 minute', 'err'); return; }
      save({ ...f, id: 'rules' });
    }}>Save rules</button></>}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {field('dutyHours', 'Normal duty hours per day')}{field('normalMultiplier', 'Overtime multiplier (after duty hours)')}{field('weekdayBreakHours', 'Break deducted on normal days (h)')}
        <Field label="Weekly off day"><select className={inputCls} value={f.weeklyOffDay} onChange={e => setF(p => ({ ...p, weeklyOffDay: Number(e.target.value) }))}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></Field>
        {field('sundayBreakHours', 'Break deducted on weekly off day (h)')}{field('sundayMultiplier', 'Weekly-off multiplier (all hours after break)')}
        {field('hourlyDaysDivisor', 'Hourly basic: days in month', '1')}{field('hourlyHoursDivisor', 'Hourly basic: hours per day', '0.5')}
        {field('roundMinutes', 'Round overtime DOWN to (minutes)', '1')}{field('minOvertimeMinutes', 'Ignore weekday overtime under (minutes)', '1')}
      </div>
      <label className="flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" className="accent-violet-600 mt-0.5" checked={f.holidayLikeSunday} onChange={e => setF(p => ({ ...p, holidayLikeSunday: e.target.checked }))} />Work on company / public holidays (from the Holiday Calendar) is paid like the weekly off day</label>
      <label className="flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" className="accent-violet-600 mt-0.5" checked={f.deductAbsence} onChange={e => setF(p => ({ ...p, deductAbsence: e.target.checked }))} />Deduct unpaid absence (working days with no punch and no approved leave) from the salary</label>
      <p className="text-[11px] text-slate-400">Hours are counted from the first punch to the last punch of the day. Weekly-off days and holidays are never counted as absent.</p>
    </Modal>
  );
};
