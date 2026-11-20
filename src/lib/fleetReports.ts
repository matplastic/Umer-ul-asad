// ───────────────────────────────────────────────────────────
// MAT-ERP — Fleet report maths (pure functions, no UI).
// Group the daily km / fuel log — and optionally maintenance and fines —
// by vehicle, employee, day, week (Mon–Sun) or month.
// ───────────────────────────────────────────────────────────
import type { HRFuelLog, HRVehicle, HRVehicleFine, HRVehicleService } from './hrStore';

export type GroupBy = 'vehicle' | 'employee' | 'day' | 'week' | 'month';
export interface ReportFilters { vehicleId?: string; employeeId?: string; from?: string; to?: string }
export interface ReportRow {
  key: string;
  label: string;
  entries: number;
  days: number;
  km: number;
  liters: number;
  fuelCost: number;
  kmPerL: number | null;    // km per liter (null when no fuel recorded)
  costPerKm: number | null; // fuel cost per km
  kmPerDay: number | null;
  serviceCost: number;
  fines: number;
  totalCost: number;
}

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Monday of the week that contains the date (ISO week, Monday start). */
export function weekStart(date: string): string {
  const d = new Date(date + 'T00:00:00');
  const dow = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
  d.setDate(d.getDate() - dow);
  return ymd(d);
}
export const monthOf = (date: string) => date.slice(0, 7);

const fmtDay = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const fmtMonth = (ym: string) => new Date(ym + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const round2 = (n: number) => Math.round(n * 100) / 100;

function within(date: string, f: ReportFilters) {
  return (!f.from || date >= f.from) && (!f.to || date <= f.to);
}

interface Acc { key: string; label: string; entries: number; dates: Set<string>; km: number; liters: number; fuelCost: number; serviceCost: number; fines: number }

export function buildReport(
  logs: HRFuelLog[], services: HRVehicleService[], fines: HRVehicleFine[], vehicles: HRVehicle[],
  groupBy: GroupBy, f: ReportFilters,
): { rows: ReportRow[]; totals: ReportRow } {
  const plateOf = new Map(vehicles.map(v => [v.id, v.plate]));
  const map = new Map<string, Acc>();
  const touch = (key: string, label: string): Acc => {
    let a = map.get(key);
    if (!a) { a = { key, label, entries: 0, dates: new Set(), km: 0, liters: 0, fuelCost: 0, serviceCost: 0, fines: 0 }; map.set(key, a); }
    return a;
  };
  const keyFor = (date: string, vehicleId: string, empId?: string, empName?: string): { key: string; label: string } => {
    switch (groupBy) {
      case 'vehicle': return { key: vehicleId, label: plateOf.get(vehicleId) || 'Unknown vehicle' };
      case 'employee': return { key: empId || '—', label: empName || (empId ? 'Unknown' : 'No driver recorded') };
      case 'day': return { key: date, label: fmtDay(date) };
      case 'week': { const w = weekStart(date); return { key: w, label: `Week of ${fmtDay(w)}` }; }
      case 'month': { const m = monthOf(date); return { key: m, label: fmtMonth(m) }; }
    }
  };

  const t: Acc = { key: 'total', label: 'Total', entries: 0, dates: new Set(), km: 0, liters: 0, fuelCost: 0, serviceCost: 0, fines: 0 };

  for (const l of logs) {
    if (!within(l.date, f)) continue;
    if (f.vehicleId && l.vehicleId !== f.vehicleId) continue;
    if (f.employeeId && l.employeeId !== f.employeeId) continue;
    const { key, label } = keyFor(l.date, l.vehicleId, l.employeeId, l.employeeName);
    for (const a of [touch(key, label), t]) {
      a.entries++; a.dates.add(`${l.vehicleId}|${l.date}`);
      a.km += l.km || 0; a.liters += l.liters || 0; a.fuelCost += l.fuelCost || 0;
    }
  }
  // Maintenance cannot be tied to a driver, so it is left out when grouping or filtering by employee.
  if (!f.employeeId && groupBy !== 'employee') {
    for (const s of services) {
      if (!within(s.date, f)) continue;
      if (f.vehicleId && s.vehicleId !== f.vehicleId) continue;
      const { key, label } = keyFor(s.date, s.vehicleId);
      touch(key, label).serviceCost += s.cost || 0; t.serviceCost += s.cost || 0;
    }
  }
  for (const x of fines) {
    if (!within(x.date, f)) continue;
    if (f.vehicleId && x.vehicleId !== f.vehicleId) continue;
    if (f.employeeId && x.employeeId !== f.employeeId) continue;
    const { key, label } = keyFor(x.date, x.vehicleId, x.employeeId, x.employeeName);
    touch(key, label).fines += x.amount || 0; t.fines += x.amount || 0;
  }

  const finish = (a: Acc): ReportRow => {
    const days = a.dates.size;
    return {
      key: a.key, label: a.label, entries: a.entries, days, km: round2(a.km), liters: round2(a.liters), fuelCost: round2(a.fuelCost),
      kmPerL: a.liters > 0 && a.km > 0 ? round2(a.km / a.liters) : null,
      costPerKm: a.km > 0 && a.fuelCost > 0 ? round2(a.fuelCost / a.km) : null,
      kmPerDay: days > 0 && a.km > 0 ? round2(a.km / days) : null,
      serviceCost: round2(a.serviceCost), fines: round2(a.fines),
      totalCost: round2(a.fuelCost + a.serviceCost + a.fines),
    };
  };
  let rows = Array.from(map.values()).map(finish);
  rows = groupBy === 'day' || groupBy === 'week' || groupBy === 'month'
    ? rows.sort((a, b) => b.key.localeCompare(a.key))
    : rows.sort((a, b) => b.km - a.km || a.label.localeCompare(b.label));
  return { rows, totals: finish(t) };
}

export function presetRange(preset: 'today' | 'week' | 'month' | 'lastMonth' | 'year'): { from: string; to: string } {
  const now = new Date();
  const today = ymd(now);
  if (preset === 'today') return { from: today, to: today };
  if (preset === 'week') return { from: weekStart(today), to: today };
  if (preset === 'month') return { from: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`, to: today };
  if (preset === 'lastMonth') {
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const last = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: ymd(first), to: ymd(last) };
  }
  return { from: `${now.getFullYear()}-01-01`, to: today };
}
