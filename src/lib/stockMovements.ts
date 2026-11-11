import type { Material, MaterialRequest, IncomingMaterial, StockAdjustment } from '../types';

// One line in a material's stock ledger.
//   qty is SIGNED: positive = stock in, negative = stock out.
export interface StockMovement {
  id: string;
  at: string;                    // ISO timestamp
  type: 'IN' | 'OUT' | 'ADJ';
  qty: number;
  ref: string;                   // DO number / GRN batch / "Adjustment"
  isDo: boolean;                 // true when ref is a real Delivery Order number
  details: string;               // project / pool / supplier / note
  by: string;                    // who did it
  balance: number;               // stock after this movement
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Builds the full movement history of ONE material from the records the app
// already keeps — no separate ledger collection to migrate:
//   IN  : every QC-passed portion of a goods receipt (dated by the QC decision)
//   OUT : every confirmed Delivery Order line (dated by hand-over time), plus
//         older approvals that deducted stock at approval time (no DO number)
//   ADJ : manual corrections from the Inventory "Adjust" button
// Running balances are computed BACKWARDS from the real current stock, so the
// last balance always equals what Inventory shows today. Whatever happened
// before the first recorded movement (opening stock, imports, old unlogged
// adjustments) is shown as the opening balance.
export function buildMovements(
  material: Material,
  requests: MaterialRequest[],
  incoming: IncomingMaterial[],
  adjustments: StockAdjustment[],
): { movements: StockMovement[]; openingBalance: number } {
  const rows: Omit<StockMovement, 'balance'>[] = [];

  for (const rec of incoming) {
    if (rec.materialId !== material.id) continue;
    const grn = rec.batchNo || rec.invoiceNo || `GRN-${String(rec.id).slice(-6).toUpperCase()}`;
    const details = [rec.supplier, rec.invoiceNo ? `Inv ${rec.invoiceNo}` : ''].filter(Boolean).join(' · ') || 'Goods received';
    const decisions = (rec.qcDecisions || []).filter((d) => d.decision === 'passed' && num(d.qty) > 0);
    if (decisions.length > 0) {
      decisions.forEach((d, i) => rows.push({
        id: `in-${rec.id}-${i}`, at: d.at || rec.qcAt || rec.receivedAt, type: 'IN', qty: num(d.qty),
        ref: grn, isDo: false, details, by: d.byName || rec.receivedByName || '',
      }));
    } else {
      const passed = rec.qtyPassed != null ? num(rec.qtyPassed) : (rec.qcStatus === 'passed' ? num(rec.qty) : 0);
      if (passed > 0) rows.push({
        id: `in-${rec.id}`, at: rec.qcAt || rec.receivedAt || rec.createdAt, type: 'IN', qty: passed,
        ref: grn, isDo: false, details, by: rec.qcByName || rec.receivedByName || '',
      });
    }
  }

  for (const r of requests) {
    if (r.materialId !== material.id) continue;
    const where = [r.projectName, r.poolType, r.poolNo ? `#${r.poolNo}` : ''].filter(Boolean).join(' / ');
    const detail = `${where || 'Material request'} · ${r.requestedByRole || ''}${r.requestedByName ? ` (${r.requestedByName})` : ''}`.trim();
    if (r.status === 'DELIVERED' && r.awaitingDelivery && num(r.qtyDelivered) > 0) {
      rows.push({
        id: `out-${r.id}`, at: r.deliveredAt || r.decidedAt || r.createdAt, type: 'OUT', qty: -num(r.qtyDelivered),
        ref: r.doNumber || 'Delivered', isDo: !!r.doNumber, details: detail, by: r.deliveredByName || '',
      });
    } else if (!r.awaitingDelivery && (r.status === 'APPROVED' || r.status === 'PRINTED' || r.status === 'DELIVERED')) {
      // Older flow: stock left the Store at approval time.
      const q = num(r.qtyApproved ?? r.qtyRequested);
      if (q > 0) rows.push({
        id: `out-${r.id}`, at: r.decidedAt || r.createdAt, type: 'OUT', qty: -q,
        ref: r.doNumber || 'Issued (no DO)', isDo: !!r.doNumber, details: detail, by: r.decidedByName || '',
      });
    }
  }

  for (const a of adjustments) {
    if (a.materialId !== material.id || num(a.delta) === 0) continue;
    rows.push({
      id: `adj-${a.id}`, at: a.at, type: 'ADJ', qty: num(a.delta), ref: 'Stock adjustment', isDo: false,
      details: a.note || 'Manual correction', by: a.byName || '',
    });
  }

  rows.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : x.id < y.id ? -1 : 1));

  const net = rows.reduce((t, r) => t + r.qty, 0);
  const openingBalance = num(material.currentStock) - net;
  let running = openingBalance;
  const movements = rows.map((r) => {
    running += r.qty;
    return { ...r, balance: running };
  });
  return { movements, openingBalance };
}

// ── periods ──────────────────────────────────────────────────────────────────

export type PeriodKey = 'all' | 'today' | 'week' | 'month' | 'custom';

const pad = (n: number) => String(n).padStart(2, '0');
export const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// Monday-start week (UAE working week), as local YYYY-MM-DD.
export function weekStartOf(day: string): string {
  const d = new Date(`${day}T12:00:00`);
  const diff = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
  d.setDate(d.getDate() - diff);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function periodRange(period: PeriodKey, customFrom: string, customTo: string, todayIso = new Date().toISOString()): { from: string; to: string } {
  const today = localDay(todayIso);
  if (period === 'today') return { from: today, to: today };
  if (period === 'week') return { from: weekStartOf(today), to: today };
  if (period === 'month') return { from: `${today.slice(0, 7)}-01`, to: today };
  if (period === 'custom') return { from: customFrom || '0000-01-01', to: customTo || '9999-12-31' };
  return { from: '0000-01-01', to: '9999-12-31' };
}

export interface LedgerSummary {
  opening: number;
  totalIn: number;
  totalOut: number;      // positive number
  adjustments: number;   // signed
  closing: number;
}

export function filterAndSummarise(
  movements: StockMovement[],
  openingBalance: number,
  range: { from: string; to: string },
): { rows: StockMovement[]; summary: LedgerSummary } {
  const rows = movements.filter((m) => {
    const d = localDay(m.at);
    return d >= range.from && d <= range.to;
  });
  const before = movements.filter((m) => localDay(m.at) < range.from);
  const opening = before.length > 0 ? before[before.length - 1].balance : openingBalance;
  const totalIn = rows.filter((r) => r.type === 'IN').reduce((t, r) => t + r.qty, 0);
  const totalOut = -rows.filter((r) => r.type === 'OUT').reduce((t, r) => t + r.qty, 0);
  const adjustments = rows.filter((r) => r.type === 'ADJ').reduce((t, r) => t + r.qty, 0);
  const closing = rows.length > 0 ? rows[rows.length - 1].balance : opening;
  return { rows, summary: { opening, totalIn, totalOut, adjustments, closing } };
}

export type GroupBy = 'transactions' | 'daily' | 'weekly' | 'monthly';

export interface PeriodBucket {
  key: string;
  label: string;
  count: number;
  totalIn: number;
  totalOut: number;
  adjustments: number;
  closing: number;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const prettyDay = (day: string) => `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`;

export function groupMovements(rows: StockMovement[], by: Exclude<GroupBy, 'transactions'>): PeriodBucket[] {
  const map = new Map<string, PeriodBucket>();
  for (const r of rows) {
    const day = localDay(r.at);
    const key = by === 'daily' ? day : by === 'weekly' ? weekStartOf(day) : day.slice(0, 7);
    const label = by === 'daily' ? prettyDay(day)
      : by === 'weekly' ? `Week of ${prettyDay(key)}`
      : `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
    let b = map.get(key);
    if (!b) { b = { key, label, count: 0, totalIn: 0, totalOut: 0, adjustments: 0, closing: r.balance }; map.set(key, b); }
    b.count += 1;
    if (r.type === 'IN') b.totalIn += r.qty;
    else if (r.type === 'OUT') b.totalOut += -r.qty;
    else b.adjustments += r.qty;
    b.closing = r.balance;
  }
  return Array.from(map.values()).sort((a, b) => (a.key < b.key ? -1 : 1));
}

// ── all materials together (Inventory Ledger tab) ───────────────────────────

export interface LedgerRow extends StockMovement {
  materialId: string;
  materialName: string;
  unit: string;
}

export interface MaterialLedger {
  material: Material;
  movements: StockMovement[];
  openingBalance: number;
}

// Builds every material's ledger in one pass. Records are grouped by material
// first, so this stays fast with thousands of requests/receipts.
export function buildAllLedgers(
  materials: Material[],
  requests: MaterialRequest[],
  incoming: IncomingMaterial[],
  adjustments: StockAdjustment[],
): MaterialLedger[] {
  const group = <T extends { materialId: string }>(list: T[]) => {
    const map = new Map<string, T[]>();
    for (const x of list) {
      const arr = map.get(x.materialId);
      if (arr) arr.push(x); else map.set(x.materialId, [x]);
    }
    return map;
  };
  const reqBy = group(requests);
  const incBy = group(incoming);
  const adjBy = group(adjustments);
  return materials.map((material) => {
    const { movements, openingBalance } = buildMovements(
      material, reqBy.get(material.id) || [], incBy.get(material.id) || [], adjBy.get(material.id) || [],
    );
    return { material, movements, openingBalance };
  });
}

export interface MaterialSummaryRow extends LedgerSummary {
  material: Material;
  count: number;
}

export interface DoSummary {
  doNumber: string;
  at: string;
  details: string;
  by: string;
  lines: { materialId: string; materialName: string; unit: string; qty: number }[];
}

// Everything the combined ledger shows for one period.
export function summariseAllLedgers(
  ledgers: MaterialLedger[],
  range: { from: string; to: string },
): { rows: LedgerRow[]; perMaterial: MaterialSummaryRow[]; deliveryOrders: DoSummary[] } {
  const rows: LedgerRow[] = [];
  const perMaterial: MaterialSummaryRow[] = [];
  const doMap = new Map<string, DoSummary>();

  for (const l of ledgers) {
    const { rows: inRange, summary } = filterAndSummarise(l.movements, l.openingBalance, range);
    perMaterial.push({ material: l.material, count: inRange.length, ...summary });
    for (const r of inRange) {
      rows.push({ ...r, materialId: l.material.id, materialName: l.material.name, unit: l.material.unit });
      if (r.type === 'OUT' && r.isDo) {
        let d = doMap.get(r.ref);
        if (!d) { d = { doNumber: r.ref, at: r.at, details: r.details, by: r.by, lines: [] }; doMap.set(r.ref, d); }
        d.lines.push({ materialId: l.material.id, materialName: l.material.name, unit: l.material.unit, qty: -r.qty });
      }
    }
  }
  rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? 1 : -1)); // newest first
  const deliveryOrders = Array.from(doMap.values()).sort((a, b) => (a.at < b.at ? 1 : -1));
  return { rows, perMaterial, deliveryOrders };
}
