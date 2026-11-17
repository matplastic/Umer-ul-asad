// ───────────────────────────────────────────────────────────
// MAT-ERP — HR Suite data layer
//
// Every new HR record list lives in its own `system_state/<name>` document
// (same `{ data: [...] }` shape the rest of the ERP uses, so the existing
// Firestore rules, backup and restore all work with it).
//
// RACE SAFETY: every write is a Firestore *transaction* that re-reads the
// document, changes ONLY the one record involved (matched by id), and writes
// it back. Two HR users editing different records at the same time can never
// overwrite each other, and a stale screen can never wipe the list.
// ───────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState } from 'react';
import { doc, onSnapshot, runTransaction, Unsubscribe } from 'firebase/firestore';
import { clientDb } from './googleDrive.ts';

// ─── Document names ─────────────────────────────────────────
export type HRDocName =
  | 'hrProfiles' | 'hrDocuments' | 'hrLifecycle' | 'hrCases' | 'hrRequests'
  | 'hrTraining' | 'hrPPE' | 'hrAccidentCases' | 'hrReviews' | 'hrLetters' | 'hrAudit';

/** Every list the HR Suite owns — also registered for backup/restore. */
export const HR_SUITE_DOCS: { id: HRDocName; label: string }[] = [
  { id: 'hrProfiles', label: 'HR employee profiles (extended)' },
  { id: 'hrDocuments', label: 'HR document vault' },
  { id: 'hrLifecycle', label: 'HR onboarding / exit checklists' },
  { id: 'hrCases', label: 'HR disciplinary cases' },
  { id: 'hrRequests', label: 'HR requests (advances, loans, OT, letters)' },
  { id: 'hrTraining', label: 'HR training records' },
  { id: 'hrPPE', label: 'HR PPE issue log' },
  { id: 'hrAccidentCases', label: 'HR accident follow-ups' },
  { id: 'hrReviews', label: 'HR performance reviews' },
  { id: 'hrLetters', label: 'HR letters issued' },
  { id: 'hrAudit', label: 'HR audit trail' },
];

// ─── Record types ───────────────────────────────────────────
export interface HRProfile {
  id: string; // = employeeId
  dob?: string;
  gender?: 'Male' | 'Female';
  maritalStatus?: 'Single' | 'Married';
  bloodGroup?: string;
  designation?: string;
  employmentType?: 'Permanent' | 'Contract' | 'Probation' | 'Daily Wage';
  joiningDate?: string;
  probationEndDate?: string;
  contractEndDate?: string;
  basicSalary?: number;
  emiratesId?: string;
  emiratesIdExpiry?: string;
  labourCardNo?: string;
  labourCardExpiry?: string;
  uaeAddress?: string;
  homeAddress?: string;
  emergencyName?: string;
  emergencyRelation?: string;
  emergencyPhone?: string;
  reportingTo?: string;
  status?: 'Active' | 'Resigned' | 'Terminated' | 'Absconded';
  exitDate?: string;
  exitReason?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface HRDocument {
  id: string;
  employeeId: string;
  employeeName: string;
  docType: string;
  docNumber?: string;
  issueDate?: string;
  expiryDate?: string;
  notes?: string;
  createdAt: string;
  createdBy?: string;
}

export interface ChecklistItem { id: string; label: string; done: boolean; doneAt?: string; doneBy?: string }
export interface HRLifecycle {
  id: string;
  employeeId: string;
  employeeName: string;
  kind: 'Onboarding' | 'Exit';
  startedAt: string;
  items: ChecklistItem[];
  completedAt?: string;
  notes?: string;
}

export type CaseStatus = 'Reported' | 'Investigation' | 'Hearing' | 'Decided' | 'Closed';
export type CaseDecision =
  | 'No Action' | 'Verbal Warning' | 'Written Warning' | 'Final Warning'
  | 'Suspension' | 'Termination';
export interface HRCase {
  id: string;
  caseNo: string;
  employeeId: string;
  employeeName: string;
  department: string;
  incidentDate: string;
  category: string;
  severity: 'Minor' | 'Major' | 'Gross';
  description: string;
  reportedBy: string;
  witnesses?: string;
  status: CaseStatus;
  investigationNotes?: string;
  employeeStatement?: string;
  hearingDate?: string;
  decision?: CaseDecision;
  decisionReason?: string;
  suspensionDays?: number;
  decidedBy?: string;
  decidedAt?: string;
  managerApprovedBy?: string;
  ackStatus?: 'Pending' | 'Acknowledged' | 'Refused';
  ackDate?: string;
  linkedWarningId?: string;
  history: { at: string; by: string; action: string }[];
  createdAt: string;
}

export type RequestType =
  | 'Salary Advance' | 'Loan' | 'Overtime' | 'NOC' | 'Salary Certificate'
  | 'Experience Letter' | 'Other';
export interface HRRequest {
  id: string;
  reqNo: string;
  type: RequestType;
  employeeId: string;
  employeeName: string;
  requestedBy: string;
  reason: string;
  amount?: number;
  installments?: number;
  startMonth?: string; // YYYY-MM — first deduction month
  deductedMonths?: string[];
  otDate?: string;
  otHours?: number;
  otKind?: 'Normal' | 'Sunday';
  status: 'Pending' | 'Approved' | 'Rejected' | 'Completed';
  decidedBy?: string;
  decidedAt?: string;
  decisionNote?: string;
  createdAt: string;
}

export interface HRTraining {
  id: string;
  employeeId: string;
  employeeName: string;
  course: string;
  provider?: string;
  completedDate: string;
  expiryDate?: string;
  certificateNo?: string;
  notes?: string;
  createdAt: string;
}

export interface HRPPE {
  id: string;
  employeeId: string;
  employeeName: string;
  item: string;
  size?: string;
  qty: number;
  issueDate: string;
  replaceDueDate?: string;
  returnedDate?: string;
  condition?: string;
  issuedBy?: string;
  notes?: string;
  createdAt: string;
}

export interface HRAccidentCase {
  id: string; // = accident report id
  severity?: 'Near Miss' | 'First Aid' | 'Medical Treatment' | 'Lost Time' | 'Serious';
  rootCause?: string;
  lostDays?: number;
  actions: { id: string; action: string; owner: string; dueDate: string; done: boolean; doneAt?: string }[];
  closedAt?: string;
  updatedAt?: string;
}

export const REVIEW_CRITERIA = [
  'Quality of Work', 'Productivity', 'Attendance & Punctuality',
  'Safety Compliance', 'Teamwork', 'Discipline & Conduct', 'Initiative',
] as const;
export interface HRReview {
  id: string;
  employeeId: string;
  employeeName: string;
  period: string;
  reviewer: string;
  ratings: Record<string, number>;
  overall: number;
  strengths?: string;
  improvements?: string;
  goals?: string;
  recommendation: 'None' | 'Increment' | 'Promotion' | 'Training' | 'Improvement Plan' | 'Warning';
  status: 'Draft' | 'Submitted' | 'Acknowledged';
  createdAt: string;
}

export interface HRLetterLog {
  id: string;
  refNo: string;
  type: string;
  employeeId: string;
  employeeName: string;
  issuedBy: string;
  issuedAt: string;
}

export interface HRAuditEntry {
  id: string;
  at: string;
  by: string;
  module: string;
  action: string;
  target?: string;
}

// ─── Minimal views of the existing HR records (owned by HRPortal) ───
export interface LeaveLite { id: string; employeeId: string; leaveType: string; fromDate: string; toDate: string; days: number; status: string; reason?: string }
export interface WarningLite { id: string; employeeId: string; type: string; reason: string; issuedAt: string; issuedBy: string }
export interface AccidentLite { id: string; date: string; employeeId: string; employeeName: string; department: string; description: string; actionTaken: string; status: 'Open' | 'Under Investigation' | 'Closed' }
export interface MedicalLite { id: string; date: string; employeeId: string; disease: string }
export interface PayrollLite { id: string; employeeId: string; month: string; baseSalary: number; allowances: number; netSalary: number; status: string }

// ─── Small helpers ──────────────────────────────────────────
export const newId = (p = 'hr') => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
export const todayStr = (d: Date = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const monthStr = (d: Date = new Date()) => todayStr(d).slice(0, 7);

/** Whole days from today to a date (negative = already past). null if no/invalid date. */
export function daysUntil(dateStr?: string | null): number | null {
  if (!dateStr) return null;
  const t = new Date(dateStr + (dateStr.length <= 10 ? 'T00:00:00' : ''));
  if (isNaN(t.getTime())) return null;
  const n = new Date(); n.setHours(0, 0, 0, 0);
  return Math.round((t.getTime() - n.getTime()) / 86400000);
}

export type ExpiryState = 'expired' | 'soon' | 'ok' | 'none';
export function expiryState(dateStr?: string | null, warnDays = 60): ExpiryState {
  const d = daysUntil(dateStr);
  if (d === null) return 'none';
  if (d < 0) return 'expired';
  if (d <= warnDays) return 'soon';
  return 'ok';
}

export const fmtD = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};
export const fmtAED = (n?: number | null) =>
  `AED ${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** Loan / advance maths — installment, how much is already deducted, what's left. */
export function loanInfo(r: HRRequest) {
  const amount = r.amount || 0;
  const n = Math.max(1, r.installments || 1);
  const installment = Math.ceil((amount / n) * 100) / 100;
  const paidCount = (r.deductedMonths || []).length;
  const repaid = Math.min(amount, installment * paidCount);
  const balance = Math.max(0, amount - repaid);
  return { amount, installments: n, installment, paidCount, repaid, balance, cleared: balance <= 0.009 };
}

/** The installment due for a given payroll month (0 if none / already done). */
export function loanDueIn(r: HRRequest, month: string): number {
  if (r.status !== 'Approved' || (r.type !== 'Loan' && r.type !== 'Salary Advance')) return 0;
  const li = loanInfo(r);
  if (li.cleared) return 0;
  if ((r.deductedMonths || []).includes(month)) return 0;
  const start = r.startMonth || r.createdAt.slice(0, 7);
  if (month < start) return 0;
  return Math.min(li.installment, li.balance);
}

// ─── Core read/write ────────────────────────────────────────
const ref = (name: HRDocName) => doc(clientDb, 'system_state', name);

export function subscribeHR<T>(name: HRDocName, cb: (items: T[]) => void): Unsubscribe {
  return onSnapshot(
    ref(name),
    snap => {
      const raw = snap.exists() ? snap.data() : null;
      cb(Array.isArray(raw?.data) ? (raw!.data as T[]) : []);
    },
    err => console.warn(`[hrStore] listener for '${name}' failed:`, err),
  );
}

function clean<T>(v: T): T {
  // Firestore rejects `undefined` anywhere in a document.
  return JSON.parse(JSON.stringify(v));
}

export async function upsertHR<T extends { id: string }>(name: HRDocName, rec: T): Promise<void> {
  const r = ref(name);
  await runTransaction(clientDb, async tx => {
    const snap = await tx.get(r);
    const cur: T[] = snap.exists() && Array.isArray(snap.data()?.data) ? snap.data()!.data : [];
    const i = cur.findIndex(x => x.id === rec.id);
    const next = i >= 0 ? cur.map((x, k) => (k === i ? rec : x)) : [rec, ...cur];
    tx.set(r, { data: clean(next) });
  });
}

export async function removeHR(name: HRDocName, id: string): Promise<void> {
  const r = ref(name);
  await runTransaction(clientDb, async tx => {
    const snap = await tx.get(r);
    const cur: { id: string }[] = snap.exists() && Array.isArray(snap.data()?.data) ? snap.data()!.data : [];
    if (!cur.some(x => x.id === id)) return;
    tx.set(r, { data: clean(cur.filter(x => x.id !== id)) });
  });
}

/** Atomically apply a function to ONE record (by id) using the freshest copy. */
export async function patchHR<T extends { id: string }>(name: HRDocName, id: string, fn: (cur: T) => T): Promise<void> {
  const r = ref(name);
  await runTransaction(clientDb, async tx => {
    const snap = await tx.get(r);
    const cur: T[] = snap.exists() && Array.isArray(snap.data()?.data) ? snap.data()!.data : [];
    const i = cur.findIndex(x => x.id === id);
    if (i < 0) return;
    const next = cur.map((x, k) => (k === i ? fn(x) : x));
    tx.set(r, { data: clean(next) });
  });
}

// ─── React hook ─────────────────────────────────────────────
export interface HRCollection<T extends { id: string }> {
  items: T[];
  loaded: boolean;
  save: (rec: T) => Promise<void>;
  remove: (id: string) => Promise<void>;
  patch: (id: string, fn: (cur: T) => T) => Promise<void>;
}

export function useHRCollection<T extends { id: string }>(name: HRDocName): HRCollection<T> {
  const [items, setItems] = useState<T[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Records saved on THIS screen but not yet confirmed by the server. They are
  // laid over every incoming snapshot so the screen never flickers back to old data.
  const pending = useRef<Map<string, T | null>>(new Map());

  useEffect(() => {
    const unsub = subscribeHR<T>(name, list => {
      let merged = list;
      if (pending.current.size > 0) {
        merged = list.filter(x => !pending.current.has(x.id));
        const adds: T[] = [];
        pending.current.forEach(v => { if (v) adds.push(v); });
        merged = [...adds, ...merged];
      }
      setItems(merged);
      setLoaded(true);
    });
    return () => unsub();
  }, [name]);

  const save = useCallback(async (rec: T) => {
    pending.current.set(rec.id, rec);
    setItems(prev => (prev.some(x => x.id === rec.id) ? prev.map(x => (x.id === rec.id ? rec : x)) : [rec, ...prev]));
    try { await upsertHR(name, rec); } finally { pending.current.delete(rec.id); }
  }, [name]);

  const remove = useCallback(async (id: string) => {
    pending.current.set(id, null);
    setItems(prev => prev.filter(x => x.id !== id));
    try { await removeHR(name, id); } finally { pending.current.delete(id); }
  }, [name]);

  const patch = useCallback(async (id: string, fn: (cur: T) => T) => {
    setItems(prev => prev.map(x => (x.id === id ? fn(x) : x)));
    await patchHR<T>(name, id, fn);
  }, [name]);

  return { items, loaded, save, remove, patch };
}

// ─── Audit trail ────────────────────────────────────────────
const AUDIT_CAP = 2000;
export function logAudit(by: string | undefined, module: string, action: string, target?: string): void {
  const entry: HRAuditEntry = { id: newId('au'), at: new Date().toISOString(), by: by || 'HR', module, action, target };
  const r = ref('hrAudit');
  runTransaction(clientDb, async tx => {
    const snap = await tx.get(r);
    const cur: HRAuditEntry[] = snap.exists() && Array.isArray(snap.data()?.data) ? snap.data()!.data : [];
    tx.set(r, { data: clean([entry, ...cur].slice(0, AUDIT_CAP)) });
  }).catch(err => console.warn('[hrStore] audit write failed:', err));
}

// ─── Reference numbers (letters, cases, requests) ───────────
export function nextRef(prefix: string, existing: string[]): string {
  const year = new Date().getFullYear();
  const head = `${prefix}/${year}/`;
  let max = 0;
  for (const s of existing) {
    if (s && s.startsWith(head)) {
      const n = parseInt(s.slice(head.length), 10);
      if (!isNaN(n) && n > max) max = n;
    }
  }
  return `${head}${String(max + 1).padStart(4, '0')}`;
}

// ─── Defaults ───────────────────────────────────────────────
export const ONBOARDING_TEMPLATE = [
  'Offer / contract signed',
  'Passport, photo & ID copies collected',
  'Visa & labour card processed',
  'Medical fitness completed',
  'Emirates ID applied',
  'Company ID card issued',
  'Safety induction completed',
  'PPE issued',
  'Accommodation / transport arranged',
  'Section & supervisor introduced',
  'Added to attendance system',
];
export const EXIT_TEMPLATE = [
  'Resignation / termination letter received',
  'Notice period & last working day confirmed',
  'Handover to supervisor completed',
  'PPE & tools returned',
  'Company ID card returned',
  'Accommodation vacated',
  'Outstanding loans / advances cleared',
  'Leave balance & final settlement calculated',
  'Visa cancellation processed',
  'Experience letter issued',
  'Removed from attendance system',
];
export const DOC_TYPES = [
  'Emirates ID', 'Labour Card', 'Employment Contract', 'Health Insurance',
  'Driving License', 'Medical Fitness', 'Safety Card', 'Educational Certificate', 'Other',
];
export const TRAINING_COURSES = [
  'HSE Safety Induction', 'First Aid', 'Fire Safety', 'Working at Height',
  'Confined Space', 'Chemical Handling (GRP / Resin)', 'PPE Usage', 'GMP Awareness',
  'ISO 9001 Awareness', 'Manual Handling', 'Forklift / Crane Operation', 'Other',
];
export const MANDATORY_COURSES = ['HSE Safety Induction', 'Fire Safety', 'Chemical Handling (GRP / Resin)', 'PPE Usage'];
export const PPE_ITEMS = [
  'Safety Shoes', 'Safety Helmet', 'Gloves', 'Safety Goggles', 'Dust Mask / Respirator',
  'Coverall', 'Ear Plugs', 'Safety Harness', 'Hi-Vis Vest', 'Other',
];
export const CASE_CATEGORIES = [
  'Absenteeism / Late', 'Safety Violation', 'Insubordination', 'Poor Quality / Negligence',
  'Misconduct / Behaviour', 'Fighting / Harassment', 'Damage to Property', 'Theft / Dishonesty',
  'Sleeping / Leaving Post', 'Other',
];
