// Pure helpers behind the "Supplier & Receipts" tab of the material window:
// every goods receipt (GRN) for one material, and a per-supplier roll-up.
import type { IncomingMaterial } from '../types';
import { normName, qcBreakdown } from './suppliers';

export const NO_SUPPLIER_KEY = '__none__';
export const NO_SUPPLIER_LABEL = 'Supplier not recorded';

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const supplierKeyOf = (r: Pick<IncomingMaterial, 'supplier'>) => normName(r.supplier) || NO_SUPPLIER_KEY;

// Newest delivery first.
export function receiptsForMaterial(materialId: string, incoming: IncomingMaterial[]): IncomingMaterial[] {
  return incoming
    .filter((r) => r.materialId === materialId)
    .slice()
    .sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : a.receivedAt > b.receivedAt ? -1 : 0));
}

export const hasDoc = (r: IncomingMaterial, kind: 'do' | 'invoice') =>
  (r.attachments || []).some((a) => a.kind === kind);

export interface SupplierSummary {
  key: string;
  name: string;           // display name from the most recent delivery
  deliveries: number;
  qtyReceived: number;
  qtyPassed: number;
  qtyFailed: number;
  firstAt: string;
  lastAt: string;
  lastInvoice: string | null;
  lastDo: string | null;
  missingDocs: number;    // deliveries lacking a DO file or an invoice file
}

// `receipts` must already be newest-first (see receiptsForMaterial).
export function summariseSuppliers(receipts: IncomingMaterial[]): SupplierSummary[] {
  const map = new Map<string, SupplierSummary>();
  for (const r of receipts) {
    const key = supplierKeyOf(r);
    const b = qcBreakdown(r);
    let s = map.get(key);
    if (!s) {
      s = {
        key,
        name: key === NO_SUPPLIER_KEY ? NO_SUPPLIER_LABEL : String(r.supplier).trim().replace(/\s+/g, ' '),
        deliveries: 0, qtyReceived: 0, qtyPassed: 0, qtyFailed: 0,
        firstAt: r.receivedAt, lastAt: r.receivedAt,
        lastInvoice: r.invoiceNo || null, lastDo: r.doNo || null, missingDocs: 0,
      };
      map.set(key, s);
    }
    s.deliveries += 1;
    s.qtyReceived += num(r.qty);
    s.qtyPassed += b.passed;
    s.qtyFailed += b.failed;
    if (r.receivedAt < s.firstAt) s.firstAt = r.receivedAt;
    if (r.receivedAt > s.lastAt) { s.lastAt = r.receivedAt; s.lastInvoice = r.invoiceNo || s.lastInvoice; s.lastDo = r.doNo || s.lastDo; }
    if (!hasDoc(r, 'do') || !hasDoc(r, 'invoice')) s.missingDocs += 1;
  }
  return [...map.values()].sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
}

// Number of distinct *named* suppliers (unrecorded ones are not counted).
export const namedSupplierCount = (receipts: IncomingMaterial[]) =>
  new Set(receipts.map(supplierKeyOf).filter((k) => k !== NO_SUPPLIER_KEY)).size;
