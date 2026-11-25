// ───────────────────────────────────────────────────────────
// MAT-ERP — UAE WPS salary file (SIF) + IBAN check. Pure functions.
//
// File layout (Central Bank / MOHRE standard, same for every agent bank):
//   EDR,<employee ID 14 digits>,<bank routing 9>,<IBAN 23>,<pay start>,<pay end>,<days>,<fixed>,<variable>,<unpaid leave days>
//   SCR,<employer ID 13>,<employer bank routing 9>,<file date>,<file time HHmm>,<salary month MMYYYY>,<EDR count>,<total>,AED,<remarks>
// File name: <employer ID 13 digits><YYMMDD><HHMMSS>.SIF
// Rules enforced here: every EDR row complete, dates inside ONE month, EDR count = number of rows,
// SCR total = sum of fixed + variable to the fils.
// ───────────────────────────────────────────────────────────
import type { PayrollLite, HRProfile, HRPayrollSettings, LeaveLite } from './hrStore';

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const digits = (s: unknown) => String(s ?? '').replace(/\s+/g, '');

/** ISO 13616 mod-97 check + UAE shape (23 chars: AE + 2 check digits + 3-digit bank code + 16-digit account). */
export function validateUaeIban(raw: string): { ok: boolean; problem?: string; iban: string } {
  const iban = digits(raw).toUpperCase();
  if (!iban) return { ok: false, problem: 'IBAN is missing', iban };
  if (!/^AE\d{21}$/.test(iban)) return { ok: false, problem: 'IBAN must be 23 characters: AE + 21 digits', iban };
  const moved = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const v = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1 ? { ok: true, iban } : { ok: false, problem: 'IBAN check digits are wrong (a digit is mistyped)', iban };
}

export const isRouting = (s: string) => /^\d{9}$/.test(digits(s));
export const isPersonCode = (s: string) => /^\d{14}$/.test(digits(s));
export const isEmployerId = (s: string) => /^\d{13}$/.test(digits(s));

export function monthBounds(month: string): { start: string; end: string; days: number } {
  const [y, m] = month.split('-').map(Number);
  const days = new Date(y, m, 0).getDate();
  return { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(days)}`, days };
}

/** Approved UNPAID leave days that fall inside the month. */
export function unpaidLeaveDays(employeeId: string, month: string, leaves: LeaveLite[]): number {
  const { start, end } = monthBounds(month);
  let n = 0;
  for (const l of leaves) {
    if (l.employeeId !== employeeId || l.status !== 'Approved' || l.leaveType !== 'Unpaid') continue;
    const a = l.fromDate > start ? l.fromDate : start, b = l.toDate < end ? l.toDate : end;
    if (b >= a) n += Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000) + 1;
  }
  return n;
}

export interface WpsRow {
  recordId: string;
  employeeId: string;
  name: string;
  net: number;
  fixed: number;
  variable: number;
  leaveDays: number;
  personCode: string;
  routing: string;
  iban: string;
  mode: 'WPS Bank' | 'Cash';
  problems: string[];
}

/** One WPS row per payroll record, with every reason it could be rejected. */
export function buildWpsRows(records: PayrollLite[], profiles: Map<string, HRProfile>, leaves: LeaveLite[], month: string): WpsRow[] {
  return records.filter(r => r.month === month).map(r => {
    const p = profiles.get(r.employeeId);
    const mode = p?.paymentMode === 'Cash' ? 'Cash' : 'WPS Bank';
    const net = Math.round((r.netSalary || 0) * 100) / 100;
    // Fixed = basic + allowances (capped at what is actually paid); variable = the rest (overtime etc.)
    const fixed = Math.min(Math.round(((r.baseSalary || 0) + (r.allowances || 0)) * 100) / 100, net);
    const variable = Math.round((net - fixed) * 100) / 100;
    const person = digits(p?.personCode), routing = digits(p?.bankRoutingCode);
    const ib = validateUaeIban(p?.iban || '');
    const problems: string[] = [];
    if (mode === 'WPS Bank') {
      if (!isPersonCode(person)) problems.push(person ? 'Person code must be 14 digits' : 'Person code (labour card ID) missing');
      if (!isRouting(routing)) problems.push(routing ? 'Bank routing code must be 9 digits' : 'Bank routing code missing');
      if (!ib.ok) problems.push(ib.problem || 'IBAN problem');
      if (net <= 0) problems.push('Net salary is zero or negative');
    }
    return { recordId: r.id, employeeId: r.employeeId, name: r.employeeName || '', net, fixed, variable, leaveDays: unpaidLeaveDays(r.employeeId, month, leaves), personCode: person, routing, iban: ib.iban, mode, problems };
  });
}

export function settingsProblems(s: Partial<HRPayrollSettings> | undefined): string[] {
  const out: string[] = [];
  if (!s?.establishmentId || !isEmployerId(s.establishmentId)) out.push('Employer (establishment) ID must be 13 digits');
  if (!s?.employerRoutingCode || !isRouting(s.employerRoutingCode)) out.push('Company bank routing code must be 9 digits');
  return out;
}

export interface SifResult { fileName: string; content: string; count: number; total: number }

export function buildSif(rows: WpsRow[], s: HRPayrollSettings, month: string, now: Date = new Date()): SifResult {
  const { start, end, days } = monthBounds(month);
  const [y, m] = month.split('-');
  const edr = rows.map(r => ['EDR', r.personCode, r.routing, r.iban, start, end, String(days), money(r.fixed), money(r.variable), String(r.leaveDays)].join(','));
  // total from the same rounded numbers that go into the rows, so it matches to the fils
  const total = Math.round(rows.reduce((t, r) => t + Math.round(r.fixed * 100) + Math.round(r.variable * 100), 0)) / 100;
  const d = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const hhmm = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  const remarks = (s.companyName || '').replace(/[,\r\n]+/g, ' ').slice(0, 35);
  const scr = ['SCR', digits(s.establishmentId), digits(s.employerRoutingCode), d, hhmm, `${m}${y}`, String(rows.length), money(total), 'AED', remarks].join(',');
  const fileName = `${digits(s.establishmentId)}${pad(now.getFullYear() % 100)}${pad(now.getMonth() + 1)}${pad(now.getDate())}${hhmm}${pad(now.getSeconds())}.SIF`;
  return { fileName, content: [...edr, scr].join('\r\n') + '\r\n', count: rows.length, total };
}

// ─── Amount in words (for payslips) ─────────────────────────
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function below1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) { parts.push(`${ONES[Math.floor(n / 100)]} Hundred`); n %= 100; }
  if (n >= 20) { parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '')); } else if (n > 0) parts.push(ONES[n]);
  return parts.join(' ');
}
export function amountInWords(amount: number): string {
  const total = Math.round(Math.abs(amount) * 100);
  const dirhams = Math.floor(total / 100), fils = total % 100;
  const scale = [[1_000_000, 'Million'], [1000, 'Thousand']] as const;
  let n = dirhams; const out: string[] = [];
  for (const [v, w] of scale) { if (n >= v) { out.push(`${below1000(Math.floor(n / v))} ${w}`); n %= v; } }
  if (n > 0 || out.length === 0) out.push(n === 0 ? 'Zero' : below1000(n));
  return `UAE Dirhams ${out.join(' ')}${fils ? ` and ${below1000(fils)} Fils` : ''} Only`;
}
