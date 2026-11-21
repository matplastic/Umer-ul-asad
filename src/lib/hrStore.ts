// ───────────────────────────────────────────────────────────
// MAT-ERP — HR Suite data layer
//
// 1 MiB-PROOF DESIGN
//   • Every HR record is its OWN Firestore document in a top-level collection
//     named after the list (hrCases/{id}, hrProfiles/{employeeId}, …). A list
//     can grow to any size — no single document ever holds a list, so the
//     1 MiB document limit can never be reached by adding more records.
//   • A single record is a few KB at most (files are NEVER embedded — they
//     live in Firebase Storage and the record only keeps a small link; see
//     hrFiles.ts, which also caps every file at 1 MB).
//   • Writes touch exactly one document (setDoc / deleteDoc / one-doc
//     transaction), so two HR users can never overwrite each other's work.
//   • The same names are registered in firebaseService COLLECTION_BACKED so
//     the existing backup / restore treats them as collections.
// ───────────────────────────────────────────────────────────
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  collection, doc, onSnapshot, setDoc, deleteDoc, getDoc, getDocs, runTransaction, writeBatch,
  query, orderBy, limit, Unsubscribe,
} from 'firebase/firestore';
import { clientDb } from './googleDrive.ts';

// ─── Document names ─────────────────────────────────────────
export type HRDocName =
  | 'hrProfiles' | 'hrDocuments' | 'hrLifecycle' | 'hrCases' | 'hrRequests'
  | 'hrTraining' | 'hrPPE' | 'hrAccidentCases' | 'hrReviews' | 'hrLetters' | 'hrAudit'
  | 'hrVacancies' | 'hrCandidates' | 'hrSettlements' | 'hrNotices' | 'hrGrievances'
  | 'hrVehicles' | 'hrFuelLogs' | 'hrVehicleService' | 'hrVehicleFines';

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
  { id: 'hrVacancies', label: 'HR vacancies' },
  { id: 'hrCandidates', label: 'HR recruitment candidates' },
  { id: 'hrSettlements', label: 'HR final settlements' },
  { id: 'hrNotices', label: 'HR notice board' },
  { id: 'hrGrievances', label: 'HR grievances & suggestions' },
  { id: 'hrVehicles', label: 'Fleet — vehicles & assignments' },
  { id: 'hrFuelLogs', label: 'Fleet — daily km & fuel log' },
  { id: 'hrVehicleService', label: 'Fleet — maintenance records' },
  { id: 'hrVehicleFines', label: 'Fleet — fines & Salik' },
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
  /** Scans / photos kept in Firebase Storage (max 1 MB each). Only this small link is stored here. */
  files?: HRFile[];
  createdAt: string;
  createdBy?: string;
}

export interface HRFile {
  id: string;
  name: string;
  url: string;
  path: string;   // Firebase Storage path — used to delete the file
  type: string;   // application/pdf | image/jpeg | …
  size: number;   // bytes, after compression
  uploadedAt: string;
  uploadedBy?: string;
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

export interface HRVacancy {
  id: string;
  title: string;
  department: string;
  openings: number;
  status: 'Open' | 'On Hold' | 'Filled' | 'Closed';
  requestedBy?: string;
  requirements?: string;
  createdAt: string;
}
export const CANDIDATE_STAGES = ['Applied', 'Screening', 'Interview', 'Trade Test', 'Offer', 'Hired', 'Rejected'] as const;
export type CandidateStage = typeof CANDIDATE_STAGES[number];
export interface HRCandidate {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  nationality?: string;
  vacancyId?: string;
  position: string;
  department?: string;
  source?: string;
  currentVisaStatus?: string;
  expectedSalary?: number;
  stage: CandidateStage;
  interviews: { id: string; date: string; interviewer: string; rating: number; notes: string }[];
  offerSalary?: number;
  offerDate?: string;
  expectedJoining?: string;
  rejectReason?: string;
  notes?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface HRSettlement {
  id: string;
  refNo: string;
  employeeId: string;
  employeeName: string;
  joiningDate: string;
  lastWorkingDay: string;
  basicSalary: number;
  unpaidDays: number;
  serviceYears: number;
  gratuity: number;
  leaveDays: number;
  leaveAmount: number;
  pendingSalaryDays: number;
  pendingSalaryAmount: number;
  noticePay: number;
  otherAdditions: number;
  loanDeduction: number;
  otherDeductions: number;
  net: number;
  notes?: string;
  createdBy?: string;
  createdAt: string;
}

export interface HRNotice {
  id: string;
  title: string;
  body: string;
  category: 'General' | 'Safety' | 'Policy' | 'Holiday' | 'Event' | 'Urgent';
  audience: string; // 'All' or a department
  pinned?: boolean;
  expiresOn?: string;
  createdBy?: string;
  createdAt: string;
}

export interface HRGrievance {
  id: string;
  refNo: string;
  kind: 'Complaint' | 'Suggestion' | 'Grievance';
  employeeId?: string; // empty when raised anonymously
  employeeName?: string;
  subject: string;
  details: string;
  status: 'Open' | 'In Review' | 'Resolved' | 'Closed';
  assignedTo?: string;
  resolution?: string;
  history: { at: string; by: string; action: string }[];
  createdAt: string;
}

// ─── Company vehicles (fleet) ───────────────────────────────
export type VehicleStatus = 'Active' | 'In Maintenance' | 'Out of Service' | 'Sold';
export interface VehicleAssignment {
  id: string;
  employeeId: string;
  employeeName: string;
  from: string;          // date handed over
  to?: string;           // date returned (empty = still with the employee)
  startKm?: number;
  endKm?: number;
  purpose?: string;
  conditionOut?: string; // condition notes at handover
  conditionIn?: string;  // condition notes at return
}
export interface HRVehicle {
  id: string;
  plate: string;
  plateEmirate?: string;
  make: string;
  model: string;
  year?: number;
  color?: string;
  vehicleType?: 'Car' | 'Pickup' | 'Van' | 'Truck' | 'Bus' | 'Other';
  fuelType: 'Petrol' | 'Diesel' | 'Hybrid' | 'Electric';
  engineNo?: string;
  chassisNo?: string;
  registrationExpiry?: string; // Mulkiya
  insuranceExpiry?: string;
  insuranceCompany?: string;
  policyNo?: string;
  purchaseDate?: string;
  status: VehicleStatus;
  assignments: VehicleAssignment[];
  files?: HRFile[];      // Mulkiya / insurance scans (Storage, max 1 MB each)
  notes?: string;
  createdAt: string;
}
export interface HRFuelLog {
  id: string;
  vehicleId: string;
  plate: string;
  date: string;
  employeeId?: string;   // driver that day
  employeeName?: string;
  startKm?: number;
  endKm?: number;
  km: number;            // km driven that day
  liters?: number;
  fuelCost?: number;
  station?: string;
  notes?: string;
  createdBy?: string;
  createdAt: string;
}
export interface HRVehicleService {
  id: string;
  vehicleId: string;
  plate: string;
  date: string;
  type: string;
  odometer?: number;
  cost?: number;
  vendor?: string;
  nextDueDate?: string;
  nextDueKm?: number;
  notes?: string;
  createdAt: string;
}
export interface HRVehicleFine {
  id: string;
  vehicleId: string;
  plate: string;
  date: string;
  kind: 'Traffic fine' | 'Salik' | 'Parking' | 'Other';
  amount: number;
  employeeId?: string;   // who was driving / responsible
  employeeName?: string;
  reference?: string;
  status: 'Unpaid' | 'Paid' | 'Deducted from salary';
  notes?: string;
  createdAt: string;
}
export const SERVICE_TYPES = ['Oil change', 'General service', 'Tyres', 'Brakes', 'Battery', 'AC', 'Repair', 'Accident repair', 'Registration renewal', 'Other'];

/** Who had the vehicle on a given date (from the assignment history). */
export function driverOn(v: HRVehicle, date: string): VehicleAssignment | undefined {
  return [...v.assignments]
    .filter(a => a.from <= date && (!a.to || a.to >= date))
    .sort((a, b) => b.from.localeCompare(a.from))[0];
}
export const currentAssignment = (v: HRVehicle) => v.assignments.find(a => !a.to);

/** Highest odometer reading known for a vehicle (daily logs, services, hand-overs). */
export function latestOdometer(v: HRVehicle, logs: HRFuelLog[], services: HRVehicleService[]): number {
  let m = 0;
  logs.forEach(l => { if (l.vehicleId === v.id) m = Math.max(m, l.endKm || 0); });
  services.forEach(s => { if (s.vehicleId === v.id) m = Math.max(m, s.odometer || 0); });
  v.assignments.forEach(a => { m = Math.max(m, a.startKm || 0, a.endKm || 0); });
  return m;
}

/** UAE private-sector end-of-service gratuity (Federal Decree-Law 33/2021, Art. 51). */
export function calcGratuity(basicMonthly: number, joining: string, lastDay: string, unpaidDays = 0) {
  const j = new Date(joining + 'T00:00:00').getTime();
  const l = new Date(lastDay + 'T00:00:00').getTime();
  if (isNaN(j) || isNaN(l) || l < j || !(basicMonthly > 0)) return { years: 0, gratuity: 0, capped: false, eligible: false, daily: 0 };
  // Whole calendar years first (so leap years don't drift), then the remainder as a fraction.
  const js = new Date(joining + 'T00:00:00'); const end = new Date(new Date(lastDay + 'T00:00:00').getTime() + 86400000); // last day counts
  let whole = end.getFullYear() - js.getFullYear();
  let anchor = new Date(js.getFullYear() + whole, js.getMonth(), js.getDate());
  if (anchor > end) { whole--; anchor = new Date(js.getFullYear() + whole, js.getMonth(), js.getDate()); }
  const remDays = Math.round((end.getTime() - anchor.getTime()) / 86400000);
  const years = Math.max(0, whole + (remDays - Math.max(0, unpaidDays)) / 365);
  const daily = basicMonthly / 30;
  if (years < 1) return { years, gratuity: 0, capped: false, eligible: false, daily };
  const first = Math.min(years, 5) * 21 * daily;
  const rest = Math.max(0, years - 5) * 30 * daily;
  const raw = first + rest;
  const cap = basicMonthly * 24;
  return { years, gratuity: Math.round(Math.min(raw, cap) * 100) / 100, capped: raw > cap, eligible: true, daily };
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

// ─── Demo / sandbox mode ────────────────────────────────────
// The HR Administration portal shows the Executive-only screens as DEMOS.
// Inside <HRSandboxProvider> every list lives only in memory: nothing is read
// from or written to Firestore / Storage, no audit entry is written, and
// everything is thrown away when the demo screen is closed.
export const HRSandboxContext = createContext(false);
let SANDBOX_ON = false;
export const setHRSandboxActive = (v: boolean) => { SANDBOX_ON = v; };
export const isHRSandbox = () => SANDBOX_ON;
const sandboxData = new Map<string, any[]>();
const sandboxSubs = new Map<string, Set<() => void>>();
export const clearHRSandbox = () => { sandboxData.clear(); sandboxSubs.forEach(set => set.forEach(fn => fn())); };
const sbGet = (name: string): any[] => sandboxData.get(name) || [];
const sbSet = (name: string, list: any[]) => { sandboxData.set(name, list); sandboxSubs.get(name)?.forEach(fn => fn()); };
const sbSubscribe = (name: string, fn: () => void) => {
  if (!sandboxSubs.has(name)) sandboxSubs.set(name, new Set());
  sandboxSubs.get(name)!.add(fn);
  return () => { sandboxSubs.get(name)?.delete(fn); };
};

// ─── Core read/write (one document per record) ──────────────
const col = (name: HRDocName) => collection(clientDb, name);

function clean<T>(v: T): T {
  // Firestore rejects `undefined` anywhere in a document.
  return JSON.parse(JSON.stringify(v));
}

/** The audit trail only ever loads its newest entries (it can grow forever on disk). */
const AUDIT_LOAD_LIMIT = 500;

export function subscribeHR<T>(name: HRDocName, cb: (items: T[]) => void): Unsubscribe {
  const q = name === 'hrAudit' ? query(col(name), orderBy('at', 'desc'), limit(AUDIT_LOAD_LIMIT)) : col(name);
  return onSnapshot(
    q,
    snap => cb(snap.docs.map(d => { const data = d.data() as any; return (data && data.id ? data : { ...data, id: d.id }) as T; })),
    err => console.warn(`[hrStore] listener for '${name}' failed:`, err),
  );
}

export async function upsertHR<T extends { id: string }>(name: HRDocName, rec: T): Promise<void> {
  if (SANDBOX_ON) return;
  await setDoc(doc(clientDb, name, rec.id), clean(rec));
}

export async function removeHR(name: HRDocName, id: string): Promise<void> {
  if (SANDBOX_ON) return;
  await deleteDoc(doc(clientDb, name, id));
}

/** Save many records at once (Excel import). One batched write per 400 records. */
export async function bulkUpsertHR<T extends { id: string }>(name: HRDocName, recs: T[]): Promise<void> {
  if (recs.length === 0) return;
  if (SANDBOX_ON) {
    const cur = sbGet(name) as T[];
    const ids = new Set(recs.map(r => r.id));
    sbSet(name, [...recs, ...cur.filter(x => !ids.has(x.id))]);
    return;
  }
  for (let i = 0; i < recs.length; i += 400) {
    const batch = writeBatch(clientDb);
    recs.slice(i, i + 400).forEach(r => batch.set(doc(clientDb, name, r.id), clean(r)));
    await batch.commit();
  }
}

/** Atomically apply a function to ONE record (by id) using the freshest copy. */
export async function patchHR<T extends { id: string }>(name: HRDocName, id: string, fn: (cur: T) => T): Promise<void> {
  if (SANDBOX_ON) return;
  const r = doc(clientDb, name, id);
  await runTransaction(clientDb, async tx => {
    const snap = await tx.get(r);
    if (!snap.exists()) return;
    const data = snap.data() as any;
    const cur = (data && data.id ? data : { ...data, id }) as T;
    tx.set(r, clean(fn(cur)));
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

export function useHRCollection<T extends { id: string }>(name: HRDocName, enabled = true): HRCollection<T> {
  const [items, setItems] = useState<T[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Records saved on THIS screen but not yet confirmed by the server. They are
  // laid over every incoming snapshot so the screen never flickers back to old data.
  const pending = useRef<Map<string, T | null>>(new Map());
  const sandbox = useContext(HRSandboxContext);

  useEffect(() => {
    if (sandbox) {
      const push = () => { setItems([...(sbGet(name) as T[])]); setLoaded(true); };
      push();
      return sbSubscribe(name, push);
    }
    if (!enabled) { setItems([]); return; }
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
  }, [name, enabled, sandbox]);

  const save = useCallback(async (rec: T) => {
    if (sandbox) {
      const cur = sbGet(name) as T[];
      sbSet(name, cur.some(x => x.id === rec.id) ? cur.map(x => (x.id === rec.id ? rec : x)) : [rec, ...cur]);
      return;
    }
    pending.current.set(rec.id, rec);
    setItems(prev => (prev.some(x => x.id === rec.id) ? prev.map(x => (x.id === rec.id ? rec : x)) : [rec, ...prev]));
    try { await upsertHR(name, rec); } finally { pending.current.delete(rec.id); }
  }, [name, sandbox]);

  const remove = useCallback(async (id: string) => {
    if (sandbox) { sbSet(name, (sbGet(name) as T[]).filter(x => x.id !== id)); return; }
    pending.current.set(id, null);
    setItems(prev => prev.filter(x => x.id !== id));
    try { await removeHR(name, id); } finally { pending.current.delete(id); }
  }, [name, sandbox]);

  const patch = useCallback(async (id: string, fn: (cur: T) => T) => {
    if (sandbox) { sbSet(name, (sbGet(name) as T[]).map(x => (x.id === id ? fn(x) : x))); return; }
    setItems(prev => prev.map(x => (x.id === id ? fn(x) : x)));
    await patchHR<T>(name, id, fn);
  }, [name, sandbox]);

  return { items, loaded, save, remove, patch };
}

// ─── Audit trail (one small document per entry) ─────────────
export function logAudit(by: string | undefined, module: string, action: string, target?: string): void {
  if (SANDBOX_ON) return;
  const entry: HRAuditEntry = { id: newId('au'), at: new Date().toISOString(), by: by || 'HR', module, action, target };
  setDoc(doc(clientDb, 'hrAudit', entry.id), clean(entry))
    .catch(err => console.warn('[hrStore] audit write failed:', err));
}

// ─── One-time move from the old single-document lists ───────
// Version 1/2 of the HR Suite kept each list as ONE array inside
// system_state/<name>. That could eventually hit the 1 MiB limit, so every
// record is copied into its own document here. Safe to run any number of
// times: it only creates records that are missing (never overwrites newer
// edits) and leaves the old documents untouched as a backup.
export async function migrateHRSuiteIfNeeded(): Promise<{ moved: number } | null> {
  if (SANDBOX_ON) return null;
  const flagRef = doc(clientDb, 'system_state', 'hrSuiteMigrated');
  const flag = await getDoc(flagRef);
  if (flag.exists()) return null;
  let moved = 0;
  for (const { id: name } of HR_SUITE_DOCS) {
    const legacy = await getDoc(doc(clientDb, 'system_state', name));
    const arr: any[] = legacy.exists() && Array.isArray(legacy.data()?.data) ? legacy.data()!.data : [];
    if (arr.length === 0) continue;
    const existing = new Set((await getDocs(col(name))).docs.map(d => d.id));
    const todo = arr.filter(r => r && r.id && !existing.has(String(r.id)));
    for (let i = 0; i < todo.length; i += 400) {
      const batch = writeBatch(clientDb);
      todo.slice(i, i + 400).forEach(r => batch.set(doc(clientDb, name, String(r.id)), clean(r)));
      await batch.commit();
    }
    moved += todo.length;
  }
  await setDoc(flagRef, { done: true, at: new Date().toISOString(), moved });
  return { moved };
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
  'Company vehicle & keys returned (if assigned)',
  'Company ID card returned',
  'Accommodation vacated',
  'Outstanding loans / advances cleared',
  'Leave balance & final settlement calculated',
  'Visa cancellation processed',
  'Experience letter issued',
  'Removed from attendance system',
];
export const DOC_TYPES = [
  'Passport', 'Visa', 'Emirates ID', 'Labour Card', 'Employment Contract', 'Health Insurance',
  'Driving License', 'Medical Fitness', 'Safety Card', 'Educational Certificate', 'Photo', 'Other',
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
