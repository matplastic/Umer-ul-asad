// ───────────────────────────────────────────────────────────
// MAT-ERP — leave balance maths (pure functions, no UI).
//   Entitlement   annualDays per leave year, prorated for people who joined during it
//   Accrual       'monthly' = earned day by day through the year · 'upfront' = whole year available
//   Taken         approved Annual leave inside the leave year, minus public/company holidays that fall in it
//   Adjustments   carry forward (+), taken before the ERP (−), manual (+/−)
// ───────────────────────────────────────────────────────────
import type { HRHoliday, HRLeaveAdjust, HRLeavePolicy, LeaveLite } from './hrStore';

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s: string) => new Date(s + 'T00:00:00');
const DAY = 86400000;
const daysInclusive = (a: string, b: string) => Math.max(0, Math.round((parse(b).getTime() - parse(a).getTime()) / DAY) + 1);
const round1 = (n: number) => Math.round(n * 10) / 10;

/** First and last day of the leave year that STARTS in `year` (e.g. 2026 → 2026-01-01 … 2026-12-31). */
export function leaveYearRange(year: number, startMonth: number): { from: string; to: string } {
  const from = new Date(year, startMonth - 1, 1);
  const to = new Date(year + 1, startMonth - 1, 0);
  return { from: ymd(from), to: ymd(to) };
}
/** Which leave year (identified by its starting calendar year) a date belongs to. */
export function leaveYearOf(date: string, startMonth: number): number {
  const d = parse(date);
  return d.getMonth() + 1 >= startMonth ? d.getFullYear() : d.getFullYear() - 1;
}
export function leaveYearLabel(year: number, startMonth: number): string {
  return startMonth === 1 ? String(year) : `${year}/${String(year + 1).slice(2)}`;
}

/** Every date (yyyy-mm-dd) covered by the holidays — optional holidays are not days off for everyone. */
export function holidayDateSet(holidays: HRHoliday[]): Set<string> {
  const set = new Set<string>();
  for (const h of holidays) {
    if (h.kind === 'Optional') continue;
    const end = h.endDate && h.endDate >= h.date ? h.endDate : h.date;
    for (let t = parse(h.date).getTime(); t <= parse(end).getTime(); t += DAY) set.add(ymd(new Date(t)));
  }
  return set;
}

/** Calendar days of [from,to] inside [rFrom,rTo], optionally not counting holiday dates. */
export function chargeableDays(from: string, to: string, rFrom: string, rTo: string, holidays: Set<string> | null): number {
  const a = from > rFrom ? from : rFrom, b = to < rTo ? to : rTo;
  if (b < a) return 0;
  let n = 0;
  for (let t = parse(a).getTime(); t <= parse(b).getTime(); t += DAY) if (!holidays || !holidays.has(ymd(new Date(t)))) n++;
  return n;
}

export interface BalanceInput {
  employeeId: string;
  joiningDate?: string;
  leaves: LeaveLite[];
  adjusts: HRLeaveAdjust[];
  holidays: HRHoliday[];
  policy: HRLeavePolicy;
  year: number;            // leave year (start year)
  today: string;
}
export interface Balance {
  range: { from: string; to: string };
  entitledFull: number;    // for the whole leave year (prorated if joined during it)
  accrued: number;         // earned so far (== entitledFull when accrual is 'upfront' or the year is over)
  carryForward: number;
  takenBeforeErp: number;
  adjustment: number;
  taken: number;           // approved annual leave charged in this leave year
  pending: number;         // annual leave waiting for approval
  balance: number;         // available NOW  (accrued + carry − taken − before ERP + adjustment)
  balanceFullYear: number; // if the whole year's entitlement were available
  sickUsed: number; emergencyUsed: number; unpaidUsed: number;
  joiningMissing: boolean;
}

export function computeBalance(i: BalanceInput): Balance {
  const { policy: p } = i;
  const range = leaveYearRange(i.year, p.leaveYearStartMonth);
  const totalDays = daysInclusive(range.from, range.to);
  const joining = i.joiningDate && /^\d{4}-\d{2}-\d{2}$/.test(i.joiningDate) ? i.joiningDate : '';
  const start = joining && joining > range.from ? joining : range.from;

  let entitledFull = 0, accrued = 0;
  if (!joining || joining <= range.to) {
    const servedFull = daysInclusive(start, range.to);
    entitledFull = joining && joining > range.from ? p.annualDays * (servedFull / totalDays) : p.annualDays;
    const upTo = i.today < range.to ? i.today : range.to;
    const servedNow = i.today < start ? 0 : daysInclusive(start, upTo);
    accrued = p.accrual === 'upfront' ? entitledFull : Math.min(entitledFull, p.annualDays * (servedNow / totalDays));
  }

  const hol = p.excludeHolidays ? holidayDateSet(i.holidays) : null;
  let taken = 0, pending = 0, sick = 0, emergency = 0, unpaid = 0;
  for (const l of i.leaves) {
    if (l.employeeId !== i.employeeId) continue;
    if (l.status === 'Rejected') continue;
    const approved = l.status === 'Approved';
    if (l.leaveType === 'Annual') {
      const d = chargeableDays(l.fromDate, l.toDate, range.from, range.to, hol);
      if (approved) taken += d; else pending += d;
    } else if (approved) {
      const d = chargeableDays(l.fromDate, l.toDate, range.from, range.to, null);
      if (l.leaveType === 'Sick') sick += d; else if (l.leaveType === 'Emergency') emergency += d; else unpaid += d;
    }
  }

  let carry = 0, before = 0, adj = 0;
  for (const a of i.adjusts) {
    if (a.employeeId !== i.employeeId || a.year !== i.year) continue;
    if (a.kind === 'Carry forward') carry += a.days; else if (a.kind === 'Taken before ERP') before += a.days; else adj += a.days;
  }

  const balance = accrued + carry + adj - taken - before;
  const balanceFullYear = entitledFull + carry + adj - taken - before;
  return {
    range, entitledFull: round1(entitledFull), accrued: round1(accrued), carryForward: round1(carry), takenBeforeErp: round1(before), adjustment: round1(adj),
    taken, pending, balance: round1(balance), balanceFullYear: round1(balanceFullYear), sickUsed: sick, emergencyUsed: emergency, unpaidUsed: unpaid, joiningMissing: !joining,
  };
}

/** Days a NEW request would charge (for the hint on the leave form). */
export function requestDays(type: string, from: string, to: string, holidays: HRHoliday[], policy: HRLeavePolicy): { calendar: number; charged: number; holidaysInside: number } {
  const calendar = from && to && to >= from ? daysInclusive(from, to) : 0;
  if (!calendar) return { calendar: 0, charged: 0, holidaysInside: 0 };
  if (type !== 'Annual' || !policy.excludeHolidays) return { calendar, charged: calendar, holidaysInside: 0 };
  const charged = chargeableDays(from, to, from, to, holidayDateSet(holidays));
  return { calendar, charged, holidaysInside: calendar - charged };
}
