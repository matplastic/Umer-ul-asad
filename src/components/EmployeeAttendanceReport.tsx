import React, { useState, useMemo } from 'react';
import { UserCheck, UserX, CalendarClock, Printer, Download, HeartPulse, MapPin, CalendarOff } from 'lucide-react';
import { exportToExcel, exportTablePdf } from '../lib/exportUtils';
import { Employee, EmployeePunch } from '../types';

// Loosely typed so this component works whether it's fed HR's local
// LeaveRequest/MedicalRecord/SiteDeployedEntry shapes or the plain Firestore
// arrays the Report Portal already fetches — only the fields below are read.
interface LeaveLike { employeeId: string; status: string; fromDate: string; toDate: string; }
interface MedicalLike { employeeId: string; date: string; }
interface DeployedLike { employeeId: string; }

interface EmployeeAttendanceReportProps {
  employees: Employee[];
  employeePunches: EmployeePunch[];
  leaves: LeaveLike[];
  medicals: MedicalLike[];
  siteDeployed: DeployedLike[];
}

type DayStatus = 'Present' | 'Absent' | 'On Leave' | 'Medical' | 'Deployed' | 'Holiday';

interface DayRow {
  date: string;
  dayName: string;
  status: DayStatus;
  inTime?: string;
  outTime?: string;
}

const STATUS_STYLE: Record<DayStatus, string> = {
  Present: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Absent: 'bg-rose-50 text-rose-700 border-rose-200',
  'On Leave': 'bg-amber-50 text-amber-700 border-amber-200',
  Medical: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  Deployed: 'bg-sky-50 text-sky-700 border-sky-200',
  Holiday: 'bg-slate-100 text-slate-500 border-slate-200',
};

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function getPresetRange(preset: string): { startDate: string; endDate: string } {
  const today = new Date();
  switch (preset) {
    case 'week': {
      const start = new Date(today);
      start.setDate(today.getDate() - today.getDay());
      return { startDate: fmt(start), endDate: fmt(today) };
    }
    case 'month': {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      return { startDate: fmt(start), endDate: fmt(today) };
    }
    case 'lastMonth': {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const end = new Date(today.getFullYear(), today.getMonth(), 0);
      return { startDate: fmt(start), endDate: fmt(end) };
    }
    case 'year': {
      const start = new Date(today.getFullYear(), 0, 1);
      return { startDate: fmt(start), endDate: fmt(today) };
    }
    default:
      return { startDate: fmt(today), endDate: fmt(today) };
  }
}

function enumerateDates(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = new Date(start + 'T00:00:00');
  const last = new Date(end + 'T00:00:00');
  // Safety cap so a mistyped huge range can't hang the browser.
  let guard = 0;
  while (cur <= last && guard < 3660) {
    out.push(fmt(cur));
    cur.setDate(cur.getDate() + 1);
    guard++;
  }
  return out;
}

export const EmployeeAttendanceReport: React.FC<EmployeeAttendanceReportProps> = ({
  employees, employeePunches, leaves, medicals, siteDeployed,
}) => {
  const [employeeId, setEmployeeId] = useState<string>('');
  const [preset, setPreset] = useState<string>('month');
  const [range, setRange] = useState(() => getPresetRange('month'));

  const applyPreset = (id: string) => {
    setPreset(id);
    setRange(getPresetRange(id));
  };

  const employee = employees.find(e => e.id === employeeId) || null;
  const deployedIds = useMemo(() => new Set(siteDeployed.map(d => d.employeeId)), [siteDeployed]);

  const approvedLeavesForEmp = useMemo(
    () => leaves.filter(l => l.employeeId === employeeId && l.status === 'Approved'),
    [leaves, employeeId]
  );
  const medicalsForEmp = useMemo(
    () => new Set(medicals.filter(m => m.employeeId === employeeId).map(m => m.date)),
    [medicals, employeeId]
  );
  const punchesForEmp = useMemo(
    () => employeePunches.filter(p => p.employeeId === employeeId),
    [employeePunches, employeeId]
  );

  const dayRows: DayRow[] = useMemo(() => {
    if (!employeeId) return [];
    const dates = enumerateDates(range.startDate, range.endDate);
    return dates.map(date => {
      const dayName = new Date(date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short' });
      const dayPunches = punchesForEmp.filter(p => p.date === date);
      const inPunch = dayPunches.find(p => p.punchType === 'IN');
      const outPunch = [...dayPunches].reverse().find(p => p.punchType === 'OUT');

      if (inPunch) {
        return { date, dayName, status: 'Present' as DayStatus, inTime: inPunch.timestamp, outTime: outPunch?.timestamp };
      }
      // Sunday is the standing weekly holiday — a Sunday with no punch is a
      // day off, not an absence, and shouldn't count against the employee.
      const isSunday = new Date(date + 'T00:00:00').getDay() === 0;
      if (isSunday) {
        return { date, dayName, status: 'Holiday' as DayStatus };
      }
      if (deployedIds.has(employeeId)) {
        return { date, dayName, status: 'Deployed' as DayStatus };
      }
      const onLeave = approvedLeavesForEmp.some(l => date >= l.fromDate && date <= l.toDate);
      if (onLeave) {
        return { date, dayName, status: 'On Leave' as DayStatus };
      }
      if (medicalsForEmp.has(date)) {
        return { date, dayName, status: 'Medical' as DayStatus };
      }
      return { date, dayName, status: 'Absent' as DayStatus };
    });
  }, [employeeId, range, punchesForEmp, deployedIds, approvedLeavesForEmp, medicalsForEmp]);

  const summary = useMemo(() => {
    const counts: Record<DayStatus, number> = { Present: 0, Absent: 0, 'On Leave': 0, Medical: 0, Deployed: 0, Holiday: 0 };
    dayRows.forEach(r => { counts[r.status]++; });
    return counts;
  }, [dayRows]);

  const fmtTime = (t?: string) => (t ? new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—');

  const handleExportPdf = () => {
    if (!employee || dayRows.length === 0) return;
    exportTablePdf({
      title: `Attendance Report — ${employee.name}`,
      subtitle: `Badge: ${employee.id}  •  ${range.startDate} to ${range.endDate}  •  Present: ${summary.Present}  •  Absent: ${summary.Absent}  •  Leave: ${summary['On Leave']}  •  Medical: ${summary.Medical}  •  Deployed: ${summary.Deployed}  •  Sunday Holiday: ${summary.Holiday}`,
      columns: [
        { header: 'Date', dataKey: 'date' },
        { header: 'Day', dataKey: 'dayName' },
        { header: 'Status', dataKey: 'status' },
        { header: 'In', dataKey: 'inDisplay' },
        { header: 'Out', dataKey: 'outDisplay' },
      ],
      rows: dayRows.map(r => ({ ...r, inDisplay: fmtTime(r.inTime), outDisplay: fmtTime(r.outTime) })),
      filename: `Attendance_${employee.name.replace(/\s+/g, '_')}`,
      orientation: 'portrait',
      deptLine: 'HR Department — Employee Attendance Report',
    });
  };

  const handleExportExcel = () => {
    if (!employee || dayRows.length === 0) return;
    exportToExcel(
      dayRows.map(r => ({
        Date: r.date, Day: r.dayName, Status: r.status,
        In: fmtTime(r.inTime), Out: fmtTime(r.outTime),
      })),
      `Attendance_${employee.name.replace(/\s+/g, '_')}`,
      'Attendance'
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block mb-1">Employee</label>
          <select
            value={employeeId}
            onChange={e => setEmployeeId(e.target.value)}
            data-testid="attendance-report-employee"
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-500 min-w-[220px]"
          >
            <option value="">— Select employee —</option>
            {employees.map(e => (
              <option key={e.id} value={e.id}>{e.name} {e.department ? `(${e.department})` : ''}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block mb-1">Period</label>
          <div className="flex gap-1">
            {[
              { id: 'week', label: 'Weekly' },
              { id: 'month', label: 'Monthly' },
              { id: 'lastMonth', label: 'Last Month' },
              { id: 'year', label: 'Yearly' },
            ].map(p => (
              <button
                key={p.id}
                onClick={() => applyPreset(p.id)}
                data-testid={`attendance-report-preset-${p.id}`}
                className={`px-3 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                  preset === p.id ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="date"
            value={range.startDate}
            onChange={e => { setPreset('custom'); setRange(r => ({ ...r, startDate: e.target.value })); }}
            className="border border-slate-200 rounded-lg px-2 py-2 text-xs bg-slate-50"
          />
          <span className="text-slate-400 text-xs">to</span>
          <input
            type="date"
            value={range.endDate}
            onChange={e => { setPreset('custom'); setRange(r => ({ ...r, endDate: e.target.value })); }}
            className="border border-slate-200 rounded-lg px-2 py-2 text-xs bg-slate-50"
          />
        </div>

        {employee && dayRows.length > 0 && (
          <div className="flex gap-2 ml-auto">
            <button
              onClick={handleExportPdf}
              data-testid="attendance-report-pdf"
              className="bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs px-3 py-2 rounded-xl flex items-center gap-1.5 cursor-pointer"
            >
              <Printer className="h-3.5 w-3.5" /> PDF
            </button>
            <button
              onClick={handleExportExcel}
              data-testid="attendance-report-excel"
              className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold text-xs px-3 py-2 rounded-xl flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" /> Excel
            </button>
          </div>
        )}
      </div>

      {!employee && (
        <div className="text-sm text-slate-400 italic py-6 text-center border border-dashed border-slate-200 rounded-2xl">
          Pick an employee to see their day-by-day attendance breakdown.
        </div>
      )}

      {employee && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
              <div className="flex items-center gap-2 text-emerald-700 mb-1"><UserCheck className="h-4 w-4" /><span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Present</span></div>
              <p className="text-2xl font-black text-slate-800">{summary.Present}</p>
            </div>
            <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
              <div className="flex items-center gap-2 text-rose-700 mb-1"><UserX className="h-4 w-4" /><span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Absent</span></div>
              <p className="text-2xl font-black text-slate-800">{summary.Absent}</p>
            </div>
            <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
              <div className="flex items-center gap-2 text-amber-700 mb-1"><CalendarClock className="h-4 w-4" /><span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Leave</span></div>
              <p className="text-2xl font-black text-slate-800">{summary['On Leave']}</p>
            </div>
            <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
              <div className="flex items-center gap-2 text-indigo-700 mb-1"><HeartPulse className="h-4 w-4" /><span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Medical</span></div>
              <p className="text-2xl font-black text-slate-800">{summary.Medical}</p>
            </div>
            <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
              <div className="flex items-center gap-2 text-sky-700 mb-1"><MapPin className="h-4 w-4" /><span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Deployed</span></div>
              <p className="text-2xl font-black text-slate-800">{summary.Deployed}</p>
            </div>
            <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
              <div className="flex items-center gap-2 text-slate-500 mb-1"><CalendarOff className="h-4 w-4" /><span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Sunday Off</span></div>
              <p className="text-2xl font-black text-slate-800">{summary.Holiday}</p>
            </div>
          </div>

          <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
            <div className="max-h-[420px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50">
                  <tr>
                    <th className="text-left p-3 text-slate-500 font-bold uppercase tracking-wider">Date</th>
                    <th className="text-left p-3 text-slate-500 font-bold uppercase tracking-wider">Day</th>
                    <th className="text-left p-3 text-slate-500 font-bold uppercase tracking-wider">Status</th>
                    <th className="text-left p-3 text-slate-500 font-bold uppercase tracking-wider">In</th>
                    <th className="text-left p-3 text-slate-500 font-bold uppercase tracking-wider">Out</th>
                  </tr>
                </thead>
                <tbody>
                  {dayRows.map(r => (
                    <tr key={r.date} className="border-t border-slate-50 hover:bg-slate-50">
                      <td className="p-3 text-slate-700 whitespace-nowrap">{r.date}</td>
                      <td className="p-3 text-slate-500 whitespace-nowrap">{r.dayName}</td>
                      <td className="p-3">
                        <span className={`text-[10px] font-bold px-2 py-1 rounded-full border ${STATUS_STYLE[r.status]}`}>
                          {r.status}
                        </span>
                      </td>
                      <td className="p-3 text-slate-600 whitespace-nowrap">{fmtTime(r.inTime)}</td>
                      <td className="p-3 text-slate-600 whitespace-nowrap">{fmtTime(r.outTime)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default EmployeeAttendanceReport;
