// ───────────────────────────────────────────────────────────
// MAT-ERP — attendance sheet → overtime → salary. Pure functions, no UI.
//
// DEFAULT RULES (all changeable in the screen):
//   Normal day : first 9 hours (punch-in → punch-out) are normal duty; every hour after that is overtime
//                paid at 1.25 × hourly basic.
//   Sunday     : 1 hour break is deducted; ALL remaining hours are paid at 1.5 × hourly basic.
//   Hourly basic = basic salary ÷ 30 ÷ 8.
// Sheet layouts understood: daily In/Out (your biometric export), raw punch log, hours per day, monthly grid.
// ───────────────────────────────────────────────────────────
import type { PayrollLite, LeaveLite, HRHoliday } from './hrStore';
import { mapColumns, parseDate, cellText, matchEmployee, normName, ImportCol, Cell, MatchResult, PersonLike } from './excelImport';
import { holidayDateSet } from './leaveBalance';

export interface OvertimeRules {
  id: string;
  dutyHours: number;          // normal duty hours per day (presence). Time beyond this = overtime.
  normalMultiplier: number;   // 1.25
  sundayMultiplier: number;   // 1.5
  sundayBreakHours: number;   // 1 — deducted on the weekly off day
  weekdayBreakHours: number;  // 0 — break already inside the duty hours
  weeklyOffDay: number;       // 0 = Sunday … 6 = Saturday
  holidayLikeSunday: boolean; // company holidays are paid like Sunday
  hourlyDaysDivisor: number;  // 30
  hourlyHoursDivisor: number; // 8
  minOvertimeMinutes: number; // weekday overtime below this is ignored (0 = count everything)
  roundMinutes: number;       // overtime is rounded DOWN to this step (1 = exact minute)
  deductAbsence: boolean;     // take unpaid absence off the salary
}
export const DEFAULT_OT_RULES: OvertimeRules = {
  id: 'rules', dutyHours: 9, normalMultiplier: 1.25, sundayMultiplier: 1.5, sundayBreakHours: 1, weekdayBreakHours: 0,
  weeklyOffDay: 0, holidayLikeSunday: false, hourlyDaysDivisor: 30, hourlyHoursDivisor: 8, minOvertimeMinutes: 0, roundMinutes: 1, deductAbsence: false,
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const pad = (n: number) => String(n).padStart(2, '0');
export const hourlyBasic = (basic: number, r: OvertimeRules) => basic / r.hourlyDaysDivisor / r.hourlyHoursDivisor;

// ─── Time parsing ───────────────────────────────────────────
/** Minutes since midnight from an Excel time fraction, "8:05", "08:05:30", "8:05 PM"; null for blank / "Absent" / "00:00". */
export function parseTime(v: Cell): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') {
    if (v <= 0) return null;
    const frac = v % 1;                          // 45000.35 → 0.35 (a date+time serial keeps only the time)
    return frac > 0 || v < 1 ? Math.round(frac * 1440 * 100) / 100 : null;
  }
  if (v instanceof Date) return v.getHours() * 60 + v.getMinutes();
  const s = String(v).trim();
  if (!s || /^(absent|a|-|--|n\/?a|nil|off|leave)$/i.test(s)) return null;
  const m = s.match(/(\d{1,2})[:.](\d{2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!m) return null;
  let h = +m[1]; const mi = +m[2]; const ap = (m[4] || '').toLowerCase();
  if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0;
  if (h > 23 || mi > 59) return null;
  const mins = h * 60 + mi + (m[3] ? +m[3] / 60 : 0);
  return mins === 0 && /^0{1,2}[:.]00/.test(s) ? null : mins;     // 00:00 = "no punch" on most devices
}

/** Hours from 9.5, "9:30", or an Excel duration fraction. */
export function parseHours(v: Cell): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v > 0 ? (v < 1 ? r2(v * 24) : v) : null;
  const s = String(v).trim();
  const hm = s.match(/^(\d{1,2}):(\d{2})/);
  if (hm) return +hm[1] + +hm[2] / 60;
  const n = Number(s.replace(',', '.'));
  return isFinite(n) && n > 0 ? n : null;
}

// ─── Reading the sheet ──────────────────────────────────────
export interface DayInput {
  badge: string; name: string; dept: string; date: string;
  inMin: number | null; outMin: number | null; hours: number | null;
  row: number; punchesInDay?: number;
}
export interface ParsedSheet { layout: 'inout' | 'punches' | 'hours' | 'grid' | 'unknown'; days: DayInput[]; issues: string[]; headerRow: number; maxDate: string; minDate: string }

const C = (key: string, label: string, aliases: string[], kind: ImportCol['kind'] = 'text'): ImportCol => ({ key, label, aliases, kind, example: '' });
const COLS: ImportCol[] = [
  C('badge', 'Badge No', ['badgenumber', 'badge', 'badgeno', 'employeeid', 'empid', 'empno', 'employeeno', 'id', 'cardno', 'userid', 'staffno']),
  C('name', 'Employee Name', ['employeename', 'name', 'employee', 'staffname', 'worker']),
  C('dept', 'Department', ['departmentname', 'department', 'dept', 'section']),
  C('date', 'Date', ['attendancedate', 'date', 'workdate', 'logdate', 'day'], 'date'),
  C('in', 'Check In', ['actualcheckin', 'checkin', 'timein', 'intime', 'firstin', 'clockin', 'firstpunch', 'in']),
  C('out', 'Check Out', ['actualcheckout', 'checkout', 'timeout', 'outtime', 'lastout', 'clockout', 'lastpunch', 'out']),
  C('hours', 'Hours', ['totalhours', 'workedhours', 'workinghours', 'totalworkhours', 'duration', 'hours', 'hrs']),
  C('stamp', 'Punch Time', ['datetime', 'timestamp', 'punchtime', 'checktime', 'punchdatetime', 'logtime', 'time']),
];

const monthDays = (month: string) => { const [y, m] = month.split('-').map(Number); return new Date(y, m, 0).getDate(); };

function splitStamp(v: Cell): { date: string; min: number | null } {
  if (typeof v === 'number' && v > 20000) return { date: parseDate(Math.floor(v)) || '', min: parseTime(v) };
  if (v instanceof Date) return { date: parseDate(v) || '', min: v.getHours() * 60 + v.getMinutes() };
  const s = cellText(v);
  const m = s.match(/^(.*?)[T\s]+(\d{1,2}[:.]\d{2}(?::\d{2})?\s*(?:am|pm)?)\s*$/i);
  if (m) return { date: parseDate(m[1]) || '', min: parseTime(m[2]) };
  return { date: parseDate(s) || '', min: null };
}

export function parseAttendanceSheet(rows: Cell[][], opts: { month: string }): ParsedSheet {
  const empty: ParsedSheet = { layout: 'unknown', days: [], issues: [], headerRow: 0, maxDate: '', minDate: '' };
  const { headerRow, index } = mapColumns(rows, COLS);
  const issues: string[] = [];
  const has = (k: string) => index[k] !== undefined;
  const hdr = rows[headerRow] || [];

  // monthly grid: header cells 1..31 across
  const dayCols: { col: number; day: number }[] = [];
  hdr.forEach((c, i) => { const n = typeof c === 'number' ? c : Number(String(c ?? '').trim()); if (Number.isInteger(n) && n >= 1 && n <= 31) dayCols.push({ col: i, day: n }); });
  const isGrid = dayCols.length >= 5 && !(has('in') && has('out'));

  const out: DayInput[] = [];
  const get = (cells: Cell[], k: string) => (has(k) ? cells[index[k]] : '');
  let layout: ParsedSheet['layout'] = 'unknown';

  if (isGrid) {
    layout = 'grid';
    const dim = monthDays(opts.month);
    for (let r = headerRow + 1; r < rows.length; r++) {
      const cells = rows[r] || []; const badge = cellText(get(cells, 'badge')), name = cellText(get(cells, 'name'));
      if (!badge && !name) continue;
      for (const { col, day } of dayCols) {
        if (day > dim) continue;
        const raw = cells[col]; if (raw === '' || raw === undefined || raw === null) continue;
        const date = `${opts.month}-${pad(day)}`;
        const two = typeof raw === 'string' ? raw.match(/(\d{1,2}[:.]\d{2}).*?(\d{1,2}[:.]\d{2})/) : null;
        if (two) out.push({ badge, name, dept: cellText(get(cells, 'dept')), date, inMin: parseTime(two[1]), outMin: parseTime(two[2]), hours: null, row: r + 1 });
        else { const h = parseHours(raw); if (h !== null) out.push({ badge, name, dept: cellText(get(cells, 'dept')), date, inMin: null, outMin: null, hours: h, row: r + 1 }); }
      }
    }
  } else if (has('in') && has('out')) {
    layout = 'inout';
    for (let r = headerRow + 1; r < rows.length; r++) {
      const cells = rows[r] || []; const badge = cellText(get(cells, 'badge')), name = cellText(get(cells, 'name'));
      if (!badge && !name) continue;
      if (/badge|statistic|employee ?name/i.test(badge + ' ' + name) && !/\d/.test(badge)) continue;           // repeated header / footer
      const d = parseDate(get(cells, 'date') as Cell);
      if (d === null) { issues.push(`Row ${r + 1}: “${cellText(get(cells, 'date'))}” is not a date`); continue; }
      if (d === '') { issues.push(`Row ${r + 1}: no date`); continue; }
      out.push({ badge, name, dept: cellText(get(cells, 'dept')), date: d, inMin: parseTime(get(cells, 'in')), outMin: parseTime(get(cells, 'out')), hours: has('hours') ? parseHours(get(cells, 'hours')) : null, row: r + 1 });
    }
  } else if (has('stamp') || (has('date') && has('in'))) {
    layout = 'punches';
    const groups = new Map<string, DayInput & { mins: number[] }>();
    for (let r = headerRow + 1; r < rows.length; r++) {
      const cells = rows[r] || []; const badge = cellText(get(cells, 'badge')), name = cellText(get(cells, 'name'));
      if (!badge && !name) continue;
      let date = '', min: number | null = null;
      if (has('stamp')) { const s = splitStamp(get(cells, 'stamp')); date = s.date; min = s.min; if (!date && has('date')) date = parseDate(get(cells, 'date') as Cell) || ''; }
      else { date = parseDate(get(cells, 'date') as Cell) || ''; min = parseTime(get(cells, 'in')); }
      if (!date || min === null) { issues.push(`Row ${r + 1}: could not read the punch date/time`); continue; }
      const k = `${badge}|${normName(name)}|${date}`;
      const g = groups.get(k) || { badge, name, dept: cellText(get(cells, 'dept')), date, inMin: null, outMin: null, hours: null, row: r + 1, mins: [] };
      g.mins.push(min); groups.set(k, g);
    }
    groups.forEach(g => { const m = g.mins.sort((a, b) => a - b); out.push({ ...g, inMin: m[0], outMin: m.length > 1 ? m[m.length - 1] : null, punchesInDay: m.length }); });
  } else if (has('hours') && has('date')) {
    layout = 'hours';
    for (let r = headerRow + 1; r < rows.length; r++) {
      const cells = rows[r] || []; const badge = cellText(get(cells, 'badge')), name = cellText(get(cells, 'name'));
      if (!badge && !name) continue;
      const d = parseDate(get(cells, 'date') as Cell);
      if (!d) { issues.push(`Row ${r + 1}: no valid date`); continue; }
      const h = parseHours(get(cells, 'hours')); if (h === null) continue;
      out.push({ badge, name, dept: cellText(get(cells, 'dept')), date: d, inMin: null, outMin: null, hours: h, row: r + 1 });
    }
  }
  if (layout === 'unknown') { issues.push('Could not recognise the layout. Expected columns like BadgeNumber, EmployeeName, AttendanceDate, ActualCheckIn, ActualCheckOut — or Badge, Date, Hours — or a monthly grid with day numbers 1–31 across.'); return { ...empty, issues, headerRow }; }
  const dates = out.map(d => d.date).sort();
  return { layout, days: out, issues, headerRow, minDate: dates[0] || '', maxDate: dates[dates.length - 1] || '' };
}

// ─── One day ────────────────────────────────────────────────
export type DayStatus = 'WORKED' | 'MISSING_PUNCH' | 'NO_PUNCH';
export interface DayCalc {
  date: string; dow: number; offDay: boolean; holiday: boolean; status: DayStatus;
  inMin: number | null; outMin: number | null; gross: number; breakH: number; presence: number;
  normalOt: number; offHours: number; note: string;
}
const floorTo = (h: number, stepMin: number) => Math.floor(Math.round(h * 60 * 1000) / 1000 / Math.max(1, stepMin)) * Math.max(1, stepMin) / 60;

export function calcDay(d: { date: string; inMin: number | null; outMin: number | null; hours: number | null }, rules: OvertimeRules, holidays: Set<string>): DayCalc {
  const dow = new Date(d.date + 'T12:00:00').getDay();
  const holiday = holidays.has(d.date);
  const offDay = dow === rules.weeklyOffDay || (rules.holidayLikeSunday && holiday);
  const base = { date: d.date, dow, offDay, holiday, inMin: d.inMin, outMin: d.outMin, gross: 0, breakH: 0, presence: 0, normalOt: 0, offHours: 0, note: '' };
  let gross: number | null = null; let note = '';
  if (d.inMin !== null && d.outMin !== null) {
    gross = (d.outMin - d.inMin) / 60;
    if (gross < 0) { gross += 24; note = 'Night shift (out is after midnight)'; }
  } else if (d.hours !== null) gross = d.hours;
  else if (d.inMin !== null || d.outMin !== null) return { ...base, status: 'MISSING_PUNCH', note: 'Only one punch — enter the missing time' };
  else return { ...base, status: 'NO_PUNCH' };

  if (gross > 16) note = `CHECK: ${gross.toFixed(1)} hours in one day`;
  else if (gross < 1) note = note || 'CHECK: less than 1 hour';
  const breakH = offDay ? rules.sundayBreakHours : rules.weekdayBreakHours;
  const presence = Math.max(0, gross - breakH);
  let normalOt = 0, offHours = 0;
  if (offDay) offHours = floorTo(presence, rules.roundMinutes);
  else {
    normalOt = Math.max(0, presence - rules.dutyHours);
    if (normalOt * 60 < rules.minOvertimeMinutes) normalOt = 0;
    normalOt = floorTo(normalOt, rules.roundMinutes);
  }
  return { ...base, status: 'WORKED', gross: r2(gross), breakH, presence: r2(presence), normalOt: r2(normalOt), offHours: r2(offHours), note };
}

// ─── One employee, one month ────────────────────────────────
export interface EmployeeMonth {
  days: DayCalc[];
  daysWorked: number; missingPunchDays: number; absentDays: number; unpaidLeaveDays: number; paidLeaveDays: number; offDaysWorked: number;
  normalOtHours: number; offHours: number; hourly: number;
  normalOtAmount: number; offAmount: number; otTotal: number;
  absenceDeduction: number; gross: number; net: number;
}

export function calcEmployeeMonth(i: {
  employeeId: string; month: string; days: DayInput[]; basic: number; allowances: number; deductions: number;
  rules: OvertimeRules; holidays: HRHoliday[]; leaves: LeaveLite[]; coverUntil: string;
}): EmployeeMonth {
  const hol = holidayDateSet(i.holidays);
  const byDate = new Map<string, DayInput>();
  for (const d of i.days) {     // if a day appears twice keep the one with the most information
    const cur = byDate.get(d.date);
    if (!cur || ((d.inMin !== null ? 1 : 0) + (d.outMin !== null ? 1 : 0) + (d.hours !== null ? 1 : 0)) > ((cur.inMin !== null ? 1 : 0) + (cur.outMin !== null ? 1 : 0) + (cur.hours !== null ? 1 : 0))) byDate.set(d.date, d);
  }
  const calc = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date)).map(d => calcDay(d, i.rules, hol));

  const dim = monthDays(i.month);
  const leaveOn = (date: string) => i.leaves.find(l => l.employeeId === i.employeeId && l.status === 'Approved' && l.fromDate <= date && l.toDate >= date);
  let absent = 0, unpaid = 0, paid = 0;
  for (let d = 1; d <= dim; d++) {
    const date = `${i.month}-${pad(d)}`;
    if (date > i.coverUntil) break;                          // do not count days after the last day in the sheet
    const dow = new Date(date + 'T12:00:00').getDay();
    if (dow === i.rules.weeklyOffDay || hol.has(date)) continue;
    const rec = byDate.get(date);
    if (rec && (rec.inMin !== null || rec.outMin !== null || rec.hours !== null)) continue;
    const lv = leaveOn(date);
    if (lv) { if (lv.leaveType === 'Unpaid') unpaid++; else paid++; continue; }
    absent++;
  }

  const worked = calc.filter(c => c.status === 'WORKED');
  const hourly = hourlyBasic(i.basic, i.rules);
  const normalOtHours = r2(worked.reduce((s, c) => s + c.normalOt, 0));
  const offHours = r2(worked.reduce((s, c) => s + c.offHours, 0));
  const normalOtAmount = r2(normalOtHours * hourly * i.rules.normalMultiplier);
  const offAmount = r2(offHours * hourly * i.rules.sundayMultiplier);
  const otTotal = r2(normalOtAmount + offAmount);
  const dailyRate = (i.basic + i.allowances) / i.rules.hourlyDaysDivisor;
  const absenceDeduction = i.rules.deductAbsence ? r2((absent + unpaid) * dailyRate) : 0;
  const gross = r2(i.basic + i.allowances + otTotal);
  const net = r2(gross - i.deductions - absenceDeduction);
  return {
    days: calc, daysWorked: worked.length, missingPunchDays: calc.filter(c => c.status === 'MISSING_PUNCH').length, absentDays: absent, unpaidLeaveDays: unpaid, paidLeaveDays: paid,
    offDaysWorked: worked.filter(c => c.offDay).length, normalOtHours, offHours, hourly: r2(hourly * 10000) / 10000, normalOtAmount, offAmount, otTotal, absenceDeduction, gross, net,
  };
}

// ─── Grouping rows by employee ──────────────────────────────
export interface SheetEmployee { key: string; badge: string; name: string; dept: string; days: DayInput[]; match: MatchResult }
export function groupByEmployee(days: DayInput[], employees: PersonLike[]): SheetEmployee[] {
  const map = new Map<string, SheetEmployee>();
  for (const d of days) {
    const k = d.badge ? `b:${d.badge.toLowerCase().replace(/^0+(?=\d)/, '')}` : `n:${normName(d.name)}`;
    const cur = map.get(k) || { key: k, badge: d.badge, name: d.name, dept: d.dept, days: [], match: { status: 'none', candidates: [] } as MatchResult };
    cur.days.push(d); if (!cur.name && d.name) cur.name = d.name; map.set(k, cur);
  }
  const list = Array.from(map.values());
  list.forEach(e => { e.match = matchEmployee(e.badge, e.name, employees); });
  return list.sort((a, b) => (a.name || a.badge).localeCompare(b.name || b.badge));
}

/** Basic / allowances to start from: HR profile basic, else the most recent payroll entry. */
export function latestPay(employeeId: string, payroll: PayrollLite[], month: string): { basic: number; allowances: number } {
  const last = payroll.filter(p => p.employeeId === employeeId && p.month <= month).sort((a, b) => b.month.localeCompare(a.month))[0];
  return { basic: last?.baseSalary || 0, allowances: last?.allowances || 0 };
}
export const minToClock = (m: number | null) => m === null ? '' : `${pad(Math.floor(m / 60))}:${pad(Math.round(m % 60))}`;
