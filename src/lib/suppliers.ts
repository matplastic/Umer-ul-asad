import type { Supplier, IncomingMaterial, Material } from '../types';

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// "ABC  Chemicals " and "abc chemicals" are the same supplier.
export const normName = (s: unknown) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

export interface SuppliedMaterial {
  materialId: string;
  name: string;
  unit: string;
  currentStock: number;
  totalReceived: number;     // QC-passed qty received from this supplier
  lastReceivedAt: string | null;
  listed: boolean;           // material's own "supplier" field names them
}

export interface SupplierStats {
  supplier: Supplier;
  receipts: IncomingMaterial[];          // newest first
  receiptCount: number;
  lastReceiptAt: string | null;
  // QC outcome, in units of quantity, across every receipt from this supplier
  qtyReceived: number;
  qtyPassed: number;
  qtyFailed: number;
  qtyHold: number;
  qtyPending: number;
  acceptancePct: number | null;          // passed / (passed + failed + hold); null until something is inspected
  materials: SuppliedMaterial[];
}

// Quantity of a receipt that has reached each QC outcome. Handles all three
// record shapes the app has produced over time: partial QC (qtyPassed/…),
// legacy all-or-nothing (qcStatus only) and still-pending.
export function qcBreakdown(r: IncomingMaterial) {
  const qty = num(r.qty);
  if (r.qtyPassed != null || r.qtyFailed != null || r.qtyHold != null) {
    const passed = num(r.qtyPassed), failed = num(r.qtyFailed), hold = num(r.qtyHold);
    return { passed, failed, hold, pending: Math.max(0, qty - passed - failed - hold) };
  }
  if (r.qcStatus === 'passed') return { passed: qty, failed: 0, hold: 0, pending: 0 };
  if (r.qcStatus === 'failed') return { passed: 0, failed: qty, hold: 0, pending: 0 };
  if (r.qcStatus === 'hold') return { passed: 0, failed: 0, hold: qty, pending: 0 };
  return { passed: 0, failed: 0, hold: 0, pending: qty };
}

export function buildSupplierStats(
  suppliers: Supplier[],
  incoming: IncomingMaterial[],
  materials: Material[],
): { stats: SupplierStats[]; unregistered: { name: string; receipts: number; materials: number }[] } {
  const byName = new Map<string, Supplier>();
  for (const s of suppliers) byName.set(normName(s.name), s);

  const receiptsBy = new Map<string, IncomingMaterial[]>();
  const unregReceipts = new Map<string, { name: string; receipts: number; mats: Set<string> }>();
  for (const r of incoming) {
    const key = normName(r.supplier);
    if (!key) continue;
    if (byName.has(key)) {
      const arr = receiptsBy.get(key);
      if (arr) arr.push(r); else receiptsBy.set(key, [r]);
    } else {
      const u = unregReceipts.get(key) || { name: String(r.supplier).trim(), receipts: 0, mats: new Set<string>() };
      u.receipts += 1; u.mats.add(r.materialId);
      unregReceipts.set(key, u);
    }
  }
  // Materials whose own "supplier" field names someone not in the master.
  for (const m of materials) {
    const key = normName((m as any).supplierName);
    if (!key || byName.has(key)) continue;
    const u = unregReceipts.get(key) || { name: String((m as any).supplierName).trim(), receipts: 0, mats: new Set<string>() };
    u.mats.add(m.id);
    unregReceipts.set(key, u);
  }

  const matById = new Map(materials.map((m) => [m.id, m]));
  const stats: SupplierStats[] = suppliers.map((supplier) => {
    const key = normName(supplier.name);
    const receipts = [...(receiptsBy.get(key) || [])].sort((a, b) => ((a.receivedAt || '') < (b.receivedAt || '') ? 1 : -1));
    let qtyReceived = 0, qtyPassed = 0, qtyFailed = 0, qtyHold = 0, qtyPending = 0;
    const perMat = new Map<string, SuppliedMaterial>();
    for (const r of receipts) {
      const b = qcBreakdown(r);
      qtyReceived += num(r.qty); qtyPassed += b.passed; qtyFailed += b.failed; qtyHold += b.hold; qtyPending += b.pending;
      const m = matById.get(r.materialId);
      const row = perMat.get(r.materialId) || {
        materialId: r.materialId, name: m?.name || r.materialName, unit: m?.unit || r.unit,
        currentStock: num(m?.currentStock), totalReceived: 0, lastReceivedAt: null, listed: false,
      };
      row.totalReceived += b.passed;
      if (!row.lastReceivedAt || (r.receivedAt || '') > row.lastReceivedAt) row.lastReceivedAt = r.receivedAt || null;
      perMat.set(r.materialId, row);
    }
    for (const m of materials) {
      if (normName((m as any).supplierName) !== key) continue;
      const row = perMat.get(m.id) || {
        materialId: m.id, name: m.name, unit: m.unit, currentStock: num(m.currentStock),
        totalReceived: 0, lastReceivedAt: null, listed: true,
      };
      row.listed = true;
      perMat.set(m.id, row);
    }
    const decided = qtyPassed + qtyFailed + qtyHold;
    return {
      supplier, receipts, receiptCount: receipts.length,
      lastReceiptAt: receipts[0]?.receivedAt || null,
      qtyReceived, qtyPassed, qtyFailed, qtyHold, qtyPending,
      acceptancePct: decided > 0 ? (qtyPassed / decided) * 100 : null,
      materials: Array.from(perMat.values()).sort((a, b) => a.name.localeCompare(b.name)),
    };
  });

  const unregistered = Array.from(unregReceipts.values())
    .map((u) => ({ name: u.name, receipts: u.receipts, materials: u.mats.size }))
    .sort((a, b) => b.receipts - a.receipts || a.name.localeCompare(b.name));
  return { stats, unregistered };
}

// Next supplier code, from the codes already on file: SUP-0001, SUP-0002 …
export function nextSupplierCode(existing: { code?: string | null }[]): string {
  let max = 0;
  for (const s of existing) {
    const m = /^SUP-(\d+)$/.exec(s.code || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `SUP-${String(max + 1).padStart(4, '0')}`;
}

export const acceptanceTone = (pct: number | null): 'good' | 'warn' | 'bad' | 'none' =>
  pct == null ? 'none' : pct >= 95 ? 'good' : pct >= 85 ? 'warn' : 'bad';

// The rules for creating/updating a supplier record, kept separate from the
// database call so they can be tested. Returns the new array plus either the
// saved supplier or a user-facing error message (array untouched on error).
export function applySupplierSave(
  arr: Supplier[],
  input: Partial<Supplier> & { name: string },
  byName: string,
  makeId: () => string,
  nowIso: string,
): { arr: Supplier[]; saved?: Supplier; error?: string } {
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (!name) return { arr, error: 'Supplier name is required.' };
  const clash = arr.find((s) => normName(s.name) === normName(name) && s.id !== input.id);
  if (clash) return { arr, error: `A supplier named "${clash.name}" already exists (${clash.code}).` };
  const next = [...arr];
  if (input.id) {
    const idx = next.findIndex((s) => s.id === input.id);
    if (idx === -1) return { arr, error: 'Supplier not found — it may have been deleted.' };
    const saved = { ...next[idx], ...input, name, updatedAt: nowIso } as Supplier;
    next[idx] = saved;
    return { arr: next, saved };
  }
  const saved = {
    status: 'active', ...input, id: makeId(), code: nextSupplierCode(arr), name,
    createdAt: nowIso, createdByName: byName, updatedAt: nowIso,
  } as Supplier;
  next.push(saved);
  return { arr: next, saved };
}
