// src/lib/attendanceEngine.ts
// Pure functions: raw punches -> daily attendance -> overtime -> monthly salary.
// All rules live in AttendanceRules so HR can change them from a settings screen.
// Check the default values against UAE labour law / your company policy before payroll use.

export type AttendanceRules = {
  shiftStart: string;          // "08:00"
  shiftHours: number;          // paid regular hours per day, e.g. 8
  breakHours: number;          // unpaid break deducted, e.g. 1
  graceMinutes: number;        // late allowed before it counts as late
  duplicateWindowMin: number;  // ignore repeat punches within this window
  minOvertimeMin: number;      // OT below this is ignored
  overtimeRoundMin: number;    // round OT down to this step (15, 30...)
  maxOvertimeHoursPerDay: number;
  weeklyOffDays: number[];     // 0 = Sunday ... 5 = Friday
  otRateNormal: number;        // 1.25 = basic hourly + 25%
  otRateNight: number;         // 1.5  (e.g. 22:00-04:00)
  otRateOffDayOrHoliday: number; // 1.5
  nightStartHour: number;      // 22
  nightEndHour: number;        // 4
  daysInPayPeriodDivisor: number; // 30 = monthly salary / 30 for daily rate
  requireApprovedOvertime: boolean;
};

export const defaultRules: AttendanceRules = {
  shiftStart: "08:00",
  shiftHours: 8,
  breakHours: 1,
  graceMinutes: 10,
  duplicateWindowMin: 3,
  minOvertimeMin: 30,
  overtimeRoundMin: 15,
  maxOvertimeHoursPerDay: 2,
  weeklyOffDays: [5],
  otRateNormal: 1.25,
  otRateNight: 1.5,
  otRateOffDayOrHoliday: 1.5,
  nightStartHour: 22,
  nightEndHour: 4,
  daysInPayPeriodDivisor: 30,
  requireApprovedOvertime: false,
};

export type DayStatus =
  | "PRESENT" | "ABSENT" | "LEAVE_PAID" | "LEAVE_UNPAID"
  | "HOLIDAY" | "WEEKLY_OFF" | "MISSING_PUNCH";

export type DayResult = {
  date: string;                // YYYY-MM-DD
  status: DayStatus;
  firstIn?: Date;
  lastOut?: Date;
  workedHours: number;
  lateMinutes: number;
  overtimeHours: number;
  overtimeRate: number;        // multiplier applied to hourly basic
  note?: string;
};

export type DayContext = {
  date: string;
  punches: Date[];             // all punches for that employee's working day
  isHoliday: boolean;
  leave?: "PAID" | "UNPAID";   // approved leave from the HR portal
  overtimeApprovedHours?: number;
};

const minutes = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 60000;

export function cleanPunches(punches: Date[], windowMin: number): Date[] {
  const sorted = [...punches].sort((a, b) => a.getTime() - b.getTime());
  const out: Date[] = [];
  for (const p of sorted) {
    if (!out.length || minutes(out[out.length - 1], p) > windowMin) out.push(p);
  }
  return out;
}

// Hours of [start, end] that fall inside the night window
function nightHours(start: Date, end: Date, r: AttendanceRules): number {
  let total = 0;
  for (let t = start.getTime(); t < end.getTime(); t += 60000) {
    const h = new Date(t).getHours();
    if (h >= r.nightStartHour || h < r.nightEndHour) total += 1;
  }
  return total / 60;
}

export function processDay(ctx: DayContext, r: AttendanceRules): DayResult {
  const dow = new Date(`${ctx.date}T12:00:00`).getDay();
  const isOff = r.weeklyOffDays.includes(dow);
  const base = { date: ctx.date, workedHours: 0, lateMinutes: 0, overtimeHours: 0, overtimeRate: 0 };

  const punches = cleanPunches(ctx.punches, r.duplicateWindowMin);

  if (punches.length === 0) {
    if (ctx.leave) return { ...base, status: ctx.leave === "PAID" ? "LEAVE_PAID" : "LEAVE_UNPAID" };
    if (ctx.isHoliday) return { ...base, status: "HOLIDAY" };
    if (isOff) return { ...base, status: "WEEKLY_OFF" };
    return { ...base, status: "ABSENT" };
  }

  if (punches.length < 2) {
    return { ...base, status: "MISSING_PUNCH", firstIn: punches[0], note: "Only one punch - HR must correct" };
  }

  const firstIn = punches[0];
  const lastOut = punches[punches.length - 1];
  const grossHours = minutes(firstIn, lastOut) / 60;
  const worked = Math.max(0, grossHours - r.breakHours);

  const [sh, sm] = r.shiftStart.split(":").map(Number);
  const shiftStart = new Date(firstIn); shiftStart.setHours(sh, sm, 0, 0);
  const late = Math.max(0, minutes(shiftStart, firstIn));
  const lateMinutes = late > r.graceMinutes ? Math.round(late) : 0;

  // Overtime: everything on an off day / holiday, otherwise only beyond the shift
  const workedOnOffDay = isOff || ctx.isHoliday;
  let otHours = workedOnOffDay ? worked : Math.max(0, worked - r.shiftHours);

  if (otHours * 60 < r.minOvertimeMin) otHours = 0;
  otHours = Math.floor((otHours * 60) / r.overtimeRoundMin) * r.overtimeRoundMin / 60;
  otHours = Math.min(otHours, r.maxOvertimeHoursPerDay);
  if (r.requireApprovedOvertime) otHours = Math.min(otHours, ctx.overtimeApprovedHours ?? 0);

  // Rate: off day/holiday > night > normal
  let rate = r.otRateNormal;
  if (workedOnOffDay) rate = r.otRateOffDayOrHoliday;
  else if (otHours > 0) {
    const otStart = new Date(lastOut.getTime() - otHours * 3600000);
    if (nightHours(otStart, lastOut, r) > otHours / 2) rate = r.otRateNight;
  }

  return {
    ...base,
    status: "PRESENT",
    firstIn, lastOut,
    workedHours: Math.round(worked * 100) / 100,
    lateMinutes,
    overtimeHours: otHours,
    overtimeRate: otHours > 0 ? rate : 0,
  };
}

export type SalaryInput = {
  basic: number;
  allowances: number;          // housing, transport, etc.
  fixedDeductions?: number;    // loans, advances
  otherAdditions?: number;
};

export type SalaryResult = {
  presentDays: number; absentDays: number; unpaidLeaveDays: number;
  overtimeHours: number; overtimeAmount: number;
  absenceDeduction: number; lateDeduction: number;
  gross: number; net: number;
};

export function calculateMonthlySalary(
  days: DayResult[], s: SalaryInput, r: AttendanceRules
): SalaryResult {
  const dailyRate = (s.basic + s.allowances) / r.daysInPayPeriodDivisor;
  const hourlyBasic = s.basic / r.daysInPayPeriodDivisor / r.shiftHours; // OT is on basic wage
  const perMinute = dailyRate / (r.shiftHours * 60);

  const count = (st: DayStatus) => days.filter(d => d.status === st).length;
  const absentDays = count("ABSENT");
  const unpaidLeaveDays = count("LEAVE_UNPAID");

  const overtimeHours = days.reduce((a, d) => a + d.overtimeHours, 0);
  const overtimeAmount = days.reduce((a, d) => a + d.overtimeHours * d.overtimeRate * hourlyBasic, 0);
  const absenceDeduction = (absentDays + unpaidLeaveDays) * dailyRate;
  const lateDeduction = days.reduce((a, d) => a + d.lateMinutes, 0) * perMinute;

  const gross = s.basic + s.allowances + overtimeAmount + (s.otherAdditions ?? 0);
  const net = gross - absenceDeduction - lateDeduction - (s.fixedDeductions ?? 0);
  const r2 = (n: number) => Math.round(n * 100) / 100;

  return {
    presentDays: count("PRESENT"), absentDays, unpaidLeaveDays,
    overtimeHours, overtimeAmount: r2(overtimeAmount),
    absenceDeduction: r2(absenceDeduction), lateDeduction: r2(lateDeduction),
    gross: r2(gross), net: r2(net),
  };
}
