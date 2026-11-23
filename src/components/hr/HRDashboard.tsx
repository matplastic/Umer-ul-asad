import React, { useMemo } from 'react';
import { Cake, Award, Users, UserCheck, CalendarOff, Inbox, FileWarning, Gavel, Siren, ChevronRight } from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
} from 'recharts';
import { Employee, EmployeePunch } from '../../types';
import {
  useHRCollection, HRProfile, HRDocument, HRCase, HRRequest, HRTraining, HRPPE, HRAccidentCase, HRHoliday, HRVehicle, HRVehicleFine,
  LeaveLite, WarningLite, AccidentLite, MANDATORY_COURSES, todayStr, daysUntil, expiryState, fmtD,
} from '../../lib/hrStore';
import { chartTokens, chartAxisDefaults } from '../../lib/chartTokens';
import { StatCard, SectionCard } from './hrUi';
import { buildDocRows } from './DocumentsVault';

interface Props {
  employees: Employee[];
  employeePunches: EmployeePunch[];
  leaves: LeaveLite[];
  warnings: WarningLite[];
  accidents: AccidentLite[];
  onNavigate: (tab: string) => void;
}

type Alert = { tone: 'rose' | 'amber' | 'sky'; text: string; tab: string };

export const HRDashboard: React.FC<Props> = ({ employees, employeePunches, leaves, warnings, accidents, onNavigate }) => {
  const profC = useHRCollection<HRProfile>('hrProfiles');
  const docsC = useHRCollection<HRDocument>('hrDocuments');
  const casesC = useHRCollection<HRCase>('hrCases');
  const reqC = useHRCollection<HRRequest>('hrRequests');
  const trainC = useHRCollection<HRTraining>('hrTraining');
  const ppeC = useHRCollection<HRPPE>('hrPPE');
  const accC = useHRCollection<HRAccidentCase>('hrAccidentCases');
  const holC = useHRCollection<HRHoliday>('hrHolidays');
  const vehC = useHRCollection<HRVehicle>('hrVehicles');
  const fineC = useHRCollection<HRVehicleFine>('hrVehicleFines');

  const d = useMemo(() => {
    const pm = new Map(profC.items.map(p => [p.id, p]));
    const active = employees.filter(e => { const s = pm.get(e.id)?.status; return !s || s === 'Active'; });
    const today = todayStr();
    const ago = (n: number) => todayStr(new Date(Date.now() - n * 86400000));

    // Attendance — only staff who actually use the badge machine.
    const punching = active.filter(e => !e.nonPunching);
    const punchedOn = (date: string) => new Set(employeePunches.filter(p => p.date === date && p.punchType === 'IN').map(p => p.employeeId));
    const presentToday = punching.filter(e => punchedOn(today).has(e.id)).length;
    const trend = Array.from({ length: 14 }, (_, i) => {
      const date = ago(13 - i);
      const set = punchedOn(date);
      return { date: date.slice(5), present: punching.filter(e => set.has(e.id)).length, sunday: new Date(date + 'T00:00:00').getDay() === 0 };
    }).filter(r => !r.sunday);

    const onLeave = leaves.filter(l => l.status === 'Approved' && l.fromDate <= today && l.toDate >= today).length;
    const pendingLeave = leaves.filter(l => l.status === 'Pending').length;
    const pendingReq = reqC.items.filter(r => r.status === 'Pending').length;
    const joined30 = active.filter(e => (pm.get(e.id)?.joiningDate || '') >= ago(30)).length;
    const exited90 = employees.filter(e => { const p = pm.get(e.id); return p?.status && p.status !== 'Active' && (p.exitDate || '') >= ago(90); }).length;

    const docRows = buildDocRows(employees, profC.items, docsC.items);
    const docExpired = docRows.filter(r => expiryState(r.expiryDate) === 'expired').length;
    const docSoon = docRows.filter(r => { const x = daysUntil(r.expiryDate); return x !== null && x >= 0 && x <= 30; }).length;

    const openCases = casesC.items.filter(c => c.status !== 'Closed').length;
    const unsigned = casesC.items.filter(c => c.decision && c.decision !== 'No Action' && c.ackStatus === 'Pending').length;
    const warn30 = warnings.filter(w => w.issuedAt.slice(0, 10) >= ago(30)).length;

    const lastAcc = [...accidents].sort((a, b) => b.date.localeCompare(a.date))[0];
    const daysSinceAcc = lastAcc ? Math.max(0, -(daysUntil(lastAcc.date) ?? 0)) : null;
    const openAcc = accidents.filter(a => a.status !== 'Closed').length;
    const overdueActions = accC.items.reduce((s, c) => s + c.actions.filter(a => !a.done && (daysUntil(a.dueDate) ?? 1) < 0).length, 0);

    const missingTraining = MANDATORY_COURSES.reduce((sum, course) => {
      const valid = new Set(trainC.items.filter(t => t.course === course && expiryState(t.expiryDate, 0) !== 'expired').map(t => t.employeeId));
      return sum + active.filter(e => !valid.has(e.id)).length;
    }, 0);
    const ppeDue = ppeC.items.filter(p => !p.returnedDate && p.replaceDueDate && (daysUntil(p.replaceDueDate) ?? 999) <= 14).length;

    // Headcount by department
    const byDept = new Map<string, number>();
    active.forEach(e => byDept.set(e.department || 'Unassigned', (byDept.get(e.department || 'Unassigned') || 0) + 1));
    const deptData = Array.from(byDept.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 12);

    // Needs attention
    const alerts: Alert[] = [];
    if (docExpired) alerts.push({ tone: 'rose', text: `${docExpired} document(s) already expired`, tab: 'docs' });
    if (docSoon) alerts.push({ tone: 'amber', text: `${docSoon} document(s) expire within 30 days`, tab: 'docs' });
    if (pendingReq) alerts.push({ tone: 'amber', text: `${pendingReq} request(s) waiting for approval`, tab: 'requests' });
    if (pendingLeave) alerts.push({ tone: 'amber', text: `${pendingLeave} leave request(s) pending`, tab: 'leave' });
    if (unsigned) alerts.push({ tone: 'rose', text: `${unsigned} disciplinary letter(s) not yet signed by the employee`, tab: 'cases' });
    if (overdueActions) alerts.push({ tone: 'rose', text: `${overdueActions} accident corrective action(s) overdue`, tab: 'safety' });
    if (missingTraining) alerts.push({ tone: 'amber', text: `${missingTraining} missing mandatory training certificate(s)`, tab: 'safety' });
    if (ppeDue) alerts.push({ tone: 'amber', text: `${ppeDue} PPE item(s) due for replacement`, tab: 'safety' });
    const fleet = vehC.items.filter(v => v.status !== 'Sold');
    const regExp = fleet.filter(v => ['expired', 'soon'].includes(expiryState(v.registrationExpiry, 30))).length;
    const insExp = fleet.filter(v => ['expired', 'soon'].includes(expiryState(v.insuranceExpiry, 30))).length;
    const unpaidFines = fineC.items.filter(f => f.status === 'Unpaid').length;
    if (regExp) alerts.push({ tone: 'amber', text: `${regExp} vehicle registration(s) expired or expiring within 30 days`, tab: 'fleet' });
    if (insExp) alerts.push({ tone: 'amber', text: `${insExp} vehicle insurance(s) expired or expiring within 30 days`, tab: 'fleet' });
    if (unpaidFines) alerts.push({ tone: 'amber', text: `${unpaidFines} unpaid vehicle fine(s) / Salik`, tab: 'fleet' });
    active.forEach(e => {
      const p = pm.get(e.id);
      const pr = daysUntil(p?.probationEndDate); const ce = daysUntil(p?.contractEndDate);
      if (pr !== null && pr >= 0 && pr <= 30) alerts.push({ tone: 'sky', text: `${e.name}: probation ends in ${pr} day(s) — review due`, tab: 'reviews' });
      if (ce !== null && ce >= 0 && ce <= 60) alerts.push({ tone: 'sky', text: `${e.name}: contract ends ${fmtD(p!.contractEndDate)}`, tab: 'emp360' });
    });

    // Birthdays & work anniversaries in the next 14 days (and today)
    const celebrations: { name: string; kind: 'birthday' | 'anniversary'; days: number; label: string }[] = [];
    const now = new Date(); now.setHours(0, 0, 0, 0);
    active.forEach(e => {
      const p = pm.get(e.id);
      const upcoming = (iso?: string) => {
        if (!iso) return null;
        const src = new Date(iso + 'T00:00:00'); if (isNaN(src.getTime())) return null;
        let next = new Date(now.getFullYear(), src.getMonth(), src.getDate());
        if (next < now) next = new Date(now.getFullYear() + 1, src.getMonth(), src.getDate());
        return { days: Math.round((next.getTime() - now.getTime()) / 86400000), years: next.getFullYear() - src.getFullYear() };
      };
      const b = upcoming(p?.dob); if (b && b.days <= 14) celebrations.push({ name: e.name, kind: 'birthday', days: b.days, label: 'Birthday' });
      const a = upcoming(p?.joiningDate); if (a && a.days <= 14 && a.years >= 1) celebrations.push({ name: e.name, kind: 'anniversary', days: a.days, label: `${a.years} year${a.years > 1 ? 's' : ''} with the company` });
    });
    celebrations.sort((x, y) => x.days - y.days);

    return { celebrations, activeCount: active.length, presentToday, punchingCount: punching.length, trend, onLeave, pendingLeave, pendingReq, joined30, exited90,
      docExpired, docSoon, openCases, unsigned, warn30, daysSinceAcc, openAcc, deptData, alerts };
  }, [employees, employeePunches, leaves, warnings, accidents, profC.items, docsC.items, casesC.items, reqC.items, trainC.items, ppeC.items, accC.items, vehC.items, fineC.items]);

  const rate = d.punchingCount ? Math.round((d.presentToday / d.punchingCount) * 100) : 0;
  const toneCls = { rose: 'bg-rose-50 border-rose-200 text-rose-800', amber: 'bg-amber-50 border-amber-200 text-amber-800', sky: 'bg-sky-50 border-sky-200 text-sky-800' };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Active headcount" value={d.activeCount} sub={`+${d.joined30} joined · ${d.exited90} left (90d)`} tone="violet" icon={<Users className="h-4 w-4" />} onClick={() => onNavigate('emp360')} />
        <StatCard label="Present today" value={d.presentToday ? `${d.presentToday}/${d.punchingCount}` : '—'} sub={d.presentToday ? `${rate}% of badge staff` : 'No punches uploaded for today yet'} tone="emerald" icon={<UserCheck className="h-4 w-4" />} onClick={() => onNavigate('attendance')} />
        <StatCard label="On leave today" value={d.onLeave} sub={`${d.pendingLeave} pending approval`} tone="slate" icon={<CalendarOff className="h-4 w-4" />} onClick={() => onNavigate('leave')} />
        <StatCard label="Waiting for approval" value={d.pendingReq + d.pendingLeave} sub="leave + requests" tone={d.pendingReq + d.pendingLeave ? 'amber' : 'slate'} icon={<Inbox className="h-4 w-4" />} onClick={() => onNavigate('requests')} />
        <StatCard label="Documents expiring / expired" value={`${d.docSoon} / ${d.docExpired}`} sub="next 30 days / already" tone={d.docExpired ? 'rose' : d.docSoon ? 'amber' : 'slate'} icon={<FileWarning className="h-4 w-4" />} onClick={() => onNavigate('docs')} />
        <StatCard label="Open disciplinary cases" value={d.openCases} sub={`${d.warn30} warning(s) in 30 days`} tone={d.openCases ? 'amber' : 'slate'} icon={<Gavel className="h-4 w-4" />} onClick={() => onNavigate('cases')} />
        <StatCard label="Days since last accident" value={d.daysSinceAcc ?? '—'} sub={`${d.openAcc} open investigation(s)`} tone={d.daysSinceAcc !== null && d.daysSinceAcc < 30 ? 'amber' : 'emerald'} icon={<Siren className="h-4 w-4" />} onClick={() => onNavigate('safety')} />
        <StatCard label="Unsigned warning letters" value={d.unsigned} tone={d.unsigned ? 'rose' : 'slate'} onClick={() => onNavigate('cases')} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
          <SectionCard title="Headcount by department">
            {d.deptData.length === 0 ? <p className="text-sm text-slate-400 py-8 text-center">No employees yet.</p> : (
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.deptData} layout="vertical" margin={{ left: 10, right: 16 }}>
                    <CartesianGrid stroke={chartAxisDefaults.gridStroke} horizontal={false} />
                    <XAxis type="number" allowDecimals={false} stroke={chartAxisDefaults.axisStroke} fontSize={11} />
                    <YAxis type="category" dataKey="name" width={96} stroke={chartAxisDefaults.axisStroke} fontSize={11} />
                    <RTooltip />
                    <Bar dataKey="count" name="Employees" fill={chartTokens.primary[500]} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </SectionCard>
          <SectionCard title="Attendance — last 14 days (Sundays hidden)">
            {d.trend.every(t => t.present === 0) ? <p className="text-sm text-slate-400 py-8 text-center">No punch data in the last 14 days.</p> : (
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={d.trend} margin={{ left: -10, right: 12 }}>
                    <CartesianGrid stroke={chartAxisDefaults.gridStroke} />
                    <XAxis dataKey="date" stroke={chartAxisDefaults.axisStroke} fontSize={11} />
                    <YAxis allowDecimals={false} stroke={chartAxisDefaults.axisStroke} fontSize={11} domain={[0, d.punchingCount || 'auto']} />
                    <RTooltip />
                    <Line type="monotone" dataKey="present" name="Present" stroke={chartAxisDefaults.primaryLineStroke} strokeWidth={2} dot={{ r: 2 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </SectionCard>
        </div>

        <div className="space-y-4">
        <SectionCard title={`Needs attention (${d.alerts.length})`}>
          {d.alerts.length === 0 ? <p className="text-sm text-emerald-600 font-semibold py-6 text-center">All clear — nothing needs action right now.</p> : (
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {d.alerts.map((a, i) => (
                <button key={i} onClick={() => onNavigate(a.tab)} className={`w-full text-left flex items-center justify-between gap-2 text-xs font-semibold px-3 py-2 rounded-lg border ${toneCls[a.tone]} hover:brightness-95`}>
                  <span>{a.text}</span><ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" />
                </button>
              ))}
            </div>
          )}
        </SectionCard>
        <SectionCard title="Upcoming holidays">
          {(() => {
            const t = todayStr();
            const next = holC.items.filter(h => (h.endDate && h.endDate >= h.date ? h.endDate : h.date) >= t).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3);
            if (!next.length) return <p className="text-sm text-slate-400 py-3 text-center">No holidays added yet — open Holiday Calendar.</p>;
            return <div className="space-y-1.5">{next.map(h => { const d = daysUntil(h.date) ?? 0; return (
              <div key={h.id} className="flex items-center justify-between text-sm"><span className="font-semibold text-slate-800 truncate">{h.name}</span>
                <span className="text-[11px] text-slate-500 whitespace-nowrap">{fmtD(h.date)}{h.endDate && h.endDate > h.date ? ` – ${fmtD(h.endDate)}` : ''} · {d <= 0 ? 'now' : `in ${d}d`}</span></div>); })}</div>;
          })()}
        </SectionCard>
        <SectionCard title="Birthdays & anniversaries (next 14 days)">
          {d.celebrations.length === 0 ? <p className="text-sm text-slate-400 py-3 text-center">Nothing coming up. Add date of birth and joining date in Employee 360.</p> : (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {d.celebrations.map((c, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  {c.kind === 'birthday' ? <Cake className="h-4 w-4 text-pink-500 shrink-0" /> : <Award className="h-4 w-4 text-violet-500 shrink-0" />}
                  <span className="font-semibold text-slate-800 truncate">{c.name}</span>
                  <span className="text-xs text-slate-400 truncate">{c.label}</span>
                  <span className="ml-auto text-[11px] font-bold text-slate-500 whitespace-nowrap">{c.days === 0 ? 'Today' : c.days === 1 ? 'Tomorrow' : `in ${c.days}d`}</span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
        </div>
      </div>
    </div>
  );
};
