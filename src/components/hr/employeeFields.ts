// The employee details that Data Health checks and Quick Entry edits.
// Some live on the Directory record (Employee), some on the HR profile (HRProfile).
import type { Employee } from '../../types';
import type { HRProfile } from '../../lib/hrStore';
import type { ImportTypeId } from './importTypes';

export type FieldKind = 'text' | 'date' | 'number' | 'select';
export type FieldGroup = 'passport' | 'profile' | 'ids' | 'contact';

export interface FieldDef {
  key: string;
  label: string;
  source: 'emp' | 'prof';
  kind: FieldKind;
  group: FieldGroup;
  options?: string[];
  /** counted when measuring how complete an employee's record is */
  health?: boolean;
  /** which Excel import fills this field */
  importType?: ImportTypeId;
  width: number;      // px, for the grid
  upper?: boolean;
}

export const GROUPS: { id: FieldGroup; label: string }[] = [
  { id: 'passport', label: 'Passport & visa' }, { id: 'profile', label: 'Job & personal' },
  { id: 'ids', label: 'Emirates ID & labour card' }, { id: 'contact', label: 'Contact & emergency' },
];

export const FIELDS: FieldDef[] = [
  { key: 'passportNumber', label: 'Passport No', source: 'emp', kind: 'text', group: 'passport', health: true, importType: 'passport', width: 130, upper: true },
  { key: 'passportCountry', label: 'Nationality', source: 'emp', kind: 'text', group: 'passport', importType: 'passport', width: 120 },
  { key: 'passportIssueDate', label: 'Passport Issue', source: 'emp', kind: 'date', group: 'passport', importType: 'passport', width: 120 },
  { key: 'passportExpiryDate', label: 'Passport Expiry', source: 'emp', kind: 'date', group: 'passport', health: true, importType: 'passport', width: 120 },
  { key: 'visaExpiryDate', label: 'Visa Expiry', source: 'emp', kind: 'date', group: 'passport', health: true, importType: 'passport', width: 120 },

  { key: 'designation', label: 'Designation', source: 'prof', kind: 'text', group: 'profile', health: true, importType: 'profile', width: 160 },
  { key: 'employmentType', label: 'Employment Type', source: 'prof', kind: 'select', options: ['Permanent', 'Contract', 'Probation', 'Daily Wage'], group: 'profile', importType: 'profile', width: 130 },
  { key: 'joiningDate', label: 'Joining Date', source: 'prof', kind: 'date', group: 'profile', health: true, importType: 'profile', width: 120 },
  { key: 'dob', label: 'Date of Birth', source: 'prof', kind: 'date', group: 'profile', health: true, importType: 'profile', width: 120 },
  { key: 'gender', label: 'Gender', source: 'prof', kind: 'select', options: ['Male', 'Female'], group: 'profile', importType: 'profile', width: 100 },
  { key: 'basicSalary', label: 'Basic Salary', source: 'prof', kind: 'number', group: 'profile', health: true, importType: 'profile', width: 110 },

  { key: 'emiratesId', label: 'Emirates ID', source: 'prof', kind: 'text', group: 'ids', health: true, importType: 'profile', width: 170 },
  { key: 'emiratesIdExpiry', label: 'EID Expiry', source: 'prof', kind: 'date', group: 'ids', health: true, importType: 'profile', width: 120 },
  { key: 'labourCardNo', label: 'Labour Card No', source: 'prof', kind: 'text', group: 'ids', health: true, importType: 'profile', width: 130 },
  { key: 'labourCardExpiry', label: 'Labour Card Expiry', source: 'prof', kind: 'date', group: 'ids', health: true, importType: 'profile', width: 130 },

  { key: 'phone', label: 'Phone', source: 'emp', kind: 'text', group: 'contact', health: true, width: 130 },
  { key: 'emergencyName', label: 'Emergency Contact', source: 'prof', kind: 'text', group: 'contact', importType: 'profile', width: 150 },
  { key: 'emergencyRelation', label: 'Relation', source: 'prof', kind: 'text', group: 'contact', importType: 'profile', width: 100 },
  { key: 'emergencyPhone', label: 'Emergency Phone', source: 'prof', kind: 'text', group: 'contact', health: true, importType: 'profile', width: 130 },
  { key: 'uaeAddress', label: 'UAE Address', source: 'prof', kind: 'text', group: 'contact', importType: 'profile', width: 200 },
];

/** Current stored value as a plain string (dates stay ISO yyyy-mm-dd). */
export function getValue(f: FieldDef, emp: Employee, prof?: HRProfile): string {
  const v = f.source === 'emp' ? (emp as any)[f.key] : (prof as any)?.[f.key];
  return v === undefined || v === null ? '' : String(v);
}

export const isFilled = (f: FieldDef, emp: Employee, prof?: HRProfile) => getValue(f, emp, prof).trim() !== '';

/** dd/mm/yyyy for display and typing */
export function isoToDisplay(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

export function isActive(emp: Employee, profiles: Map<string, HRProfile>): boolean {
  const st = profiles.get(emp.id)?.status;
  return !st || st === 'Active';
}
