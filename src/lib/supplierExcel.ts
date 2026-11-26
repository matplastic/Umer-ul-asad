// ───────────────────────────────────────────────────────────
// Supplier Excel import (pure helpers, no UI).
//  • reads the columns of a supplier sheet by flexible header names
//  • checks every row and decides: NEW supplier, UPDATE of an existing one, or ERROR
//  • existing suppliers are matched by NAME first, then by TRN / tax number
//  • blank cells never wipe existing data on an update
// The file reading / header mapping / template download come from excelImport.ts.
// ───────────────────────────────────────────────────────────
import type { Supplier, SupplierStatus } from '../types';
import { mapColumns, cellText, parseNum, downloadTemplate, type Cell, type ImportCol } from './excelImport';
import { normName } from './suppliers';

export const SUPPLIER_COLS: ImportCol[] = [
  { key: 'name', label: 'Supplier Name', aliases: ['supplier', 'name', 'vendor', 'vendor name', 'company', 'company name'], kind: 'text', required: true, example: 'ABC Chemicals LLC' },
  { key: 'status', label: 'Status', aliases: [], kind: 'text', example: 'Active' },
  { key: 'category', label: 'Category', aliases: ['supplies', 'material category'], kind: 'text', example: 'Resin' },
  { key: 'contactPerson', label: 'Contact Person', aliases: ['contact', 'contact name'], kind: 'text', example: 'Ahmed Khan' },
  { key: 'phone', label: 'Phone', aliases: ['mobile', 'telephone', 'contact number', 'tel no'], kind: 'text', example: '+971 50 123 4567' },
  { key: 'email', label: 'Email', aliases: ['e-mail', 'email address'], kind: 'text', example: 'sales@abc-chem.ae' },
  { key: 'website', label: 'Website', aliases: ['web site', 'url'], kind: 'text', example: 'www.abc-chem.ae' },
  { key: 'address', label: 'Address', aliases: ['street address'], kind: 'text', example: 'Industrial Area 4' },
  { key: 'city', label: 'City', aliases: ['emirate'], kind: 'text', example: 'Sharjah' },
  { key: 'country', label: 'Country', aliases: [], kind: 'text', example: 'UAE' },
  { key: 'taxNo', label: 'Tax / TRN', aliases: ['trn', 'tax no', 'tax number', 'vat number', 'vat no', 'tax registration number'], kind: 'text', example: '100123456700003' },
  { key: 'paymentTerms', label: 'Payment Terms', aliases: ['terms', 'credit terms'], kind: 'text', example: 'Net 30' },
  { key: 'currency', label: 'Currency', aliases: [], kind: 'text', example: 'AED' },
  { key: 'creditLimit', label: 'Credit Limit', aliases: [], kind: 'number', example: '50000' },
  { key: 'leadTimeDays', label: 'Lead Time (days)', aliases: ['lead time', 'lead time days'], kind: 'number', example: '7' },
  { key: 'bankName', label: 'Bank', aliases: ['bank name'], kind: 'text', example: 'Emirates NBD' },
  { key: 'iban', label: 'IBAN', aliases: [], kind: 'text', example: 'AE070331234567890123456' },
  { key: 'notes', label: 'Notes', aliases: ['remarks', 'comments'], kind: 'text', example: '' },
];

export function downloadSupplierTemplate() {
  downloadTemplate('Supplier_Import_Template.xlsx', SUPPLIER_COLS, [
    'Fill one supplier per row, starting under the header row. Only "Supplier Name" is required.',
    'Status can be Active, On hold or Blocked (blank = Active for new suppliers).',
    'A supplier that already exists (same name, or same Tax / TRN) is UPDATED with the cells you filled in — blank cells never erase existing data.',
    'New suppliers get the next code (SUP-0001, SUP-0002 …) automatically. Do not put codes in this file.',
    'Delete the grey example row before uploading.',
  ]);
}

// ─── Reading the rows ───────────────────────────────────────
export type RowAction = 'new' | 'update' | 'error';

export interface ImportRow {
  rowNo: number;                                  // row number as seen in Excel
  name: string;
  input: Partial<Supplier> & { name: string };    // only the fields that will be written
  action: RowAction;
  matchId?: string;                               // existing supplier this row updates
  matchCode?: string;
  matchedBy?: 'name' | 'trn';
  errors: string[];                               // row is NOT imported
  warnings: string[];                             // row is imported, but something was left out / adjusted
}

export interface ParsedSheet {
  missingColumns: string[];                       // required columns not found → nothing can be imported
  rows: ImportRow[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normTrn = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function parseStatus(raw: string): SupplierStatus | null {
  const n = raw.toLowerCase().replace(/[^a-z]/g, '');
  if (['active', 'approved'].includes(n)) return 'active';
  if (['onhold', 'hold', 'suspended'].includes(n)) return 'on_hold';
  if (['blocked', 'block', 'blacklisted'].includes(n)) return 'blocked';
  return null;
}

export function parseSupplierRows(sheet: Cell[][], existing: Supplier[]): ParsedSheet {
  const { headerRow, index, missing } = mapColumns(sheet, SUPPLIER_COLS);
  if (missing.length) return { missingColumns: missing.map((c) => c.label), rows: [] };

  const byName = new Map<string, Supplier>();
  const trnCount = new Map<string, number>();
  for (const s of existing) {
    byName.set(normName(s.name), s);
    const t = normTrn(s.taxNo);
    if (t) trnCount.set(t, (trnCount.get(t) || 0) + 1);
  }
  const byTrn = new Map<string, Supplier>();
  for (const s of existing) {
    const t = normTrn(s.taxNo);
    if (t && trnCount.get(t) === 1) byTrn.set(t, s);   // only when the TRN is unambiguous
  }

  const get = (row: Cell[], key: string): string => (index[key] === undefined ? '' : cellText(row[index[key]]));
  const seenNames = new Map<string, number>();         // normalised name → first row it appeared on
  const seenTargets = new Map<string, number>();       // existing supplier id → first row that updates it
  const out: ImportRow[] = [];

  for (let r = headerRow + 1; r < sheet.length; r++) {
    const row = sheet[r] || [];
    if (!row.some((c) => cellText(c) !== '')) continue;   // empty line

    const errors: string[] = [];
    const warnings: string[] = [];
    const rowNo = r + 1;
    const name = get(row, 'name').replace(/\s+/g, ' ').trim();
    const input: Partial<Supplier> & { name: string } = { name };

    // text fields — only set when the cell has something in it
    for (const k of ['category', 'contactPerson', 'phone', 'website', 'address', 'city', 'country', 'taxNo', 'paymentTerms', 'currency', 'bankName', 'iban', 'notes'] as const) {
      const v = get(row, k);
      if (v) (input as any)[k] = v;
    }
    if (input.currency) input.currency = input.currency.toUpperCase();

    const email = get(row, 'email');
    if (email) {
      if (EMAIL_RE.test(email)) input.email = email;
      else warnings.push(`Email "${email}" does not look right — left blank`);
    }
    const st = get(row, 'status');
    if (st) {
      const parsed = parseStatus(st);
      if (parsed) input.status = parsed;
      else warnings.push(`Status "${st}" not recognised (use Active / On hold / Blocked) — ignored`);
    }
    for (const k of ['creditLimit', 'leadTimeDays'] as const) {
      if (index[k] === undefined) continue;
      const n = parseNum(row[index[k]]);
      if (n === '') continue;
      if (n === null || n < 0) warnings.push(`${k === 'creditLimit' ? 'Credit limit' : 'Lead time'} "${cellText(row[index[k]])}" is not a valid number — ignored`);
      else (input as any)[k] = n;
    }

    if (!name) errors.push('Supplier name is empty');

    // Is this an existing supplier?
    let target: Supplier | undefined;
    let matchedBy: 'name' | 'trn' | undefined;
    if (name) {
      target = byName.get(normName(name));
      if (target) matchedBy = 'name';
      else if (input.taxNo && byTrn.has(normTrn(input.taxNo))) {
        target = byTrn.get(normTrn(input.taxNo));
        matchedBy = 'trn';
        warnings.push(`Same TRN as ${target!.code} "${target!.name}" — updating that supplier, name kept`);
      }
    }

    // The same supplier twice in one file
    if (name) {
      const key = normName(name);
      const firstSeen = seenNames.get(key);
      if (firstSeen !== undefined) errors.push(`Duplicate of row ${firstSeen} in this file`);
      else seenNames.set(key, rowNo);
    }
    if (target) {
      const firstTarget = seenTargets.get(target.id);
      if (firstTarget !== undefined && !errors.length) errors.push(`Updates the same supplier (${target.code}) as row ${firstTarget}`);
      else if (firstTarget === undefined) seenTargets.set(target.id, rowNo);
    }

    if (target) {
      input.name = target.name;                       // never rename on import — receipts are linked by name
    } else {
      // new supplier: same defaults the Add Supplier form uses
      if (!input.status) input.status = 'active';
      if (!input.country) input.country = 'UAE';
      if (!input.currency) input.currency = 'AED';
    }

    out.push({
      rowNo, name: name || '(no name)', input,
      action: errors.length ? 'error' : target ? 'update' : 'new',
      matchId: target?.id, matchCode: target?.code, matchedBy, errors, warnings,
    });
  }
  return { missingColumns: [], rows: out };
}
