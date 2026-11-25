// Procurement rules in one place — shared by the Procurement portal and the Store's
// "receive against PO" panel, so both always agree on what is ordered, received,
// still owed and payable.
import type {
  IncomingMaterial, PoLine, ProcurementSettings, PurchaseOrder, Rfq, RfqQuote, Stf, SupplierInvoice, SupplierPayment,
} from '../types';

// ── house rules (change here) ────────────────────────────────────────────────
export const VAT_RATE = 5;                 // UAE standard VAT, %
export const APPROVAL_THRESHOLD = 5000;    // AED — a PO above this needs management approval
export const OVER_RECEIPT_TOLERANCE = 0.10; // receiving up to 10% over the ordered qty is allowed (with a warning)
const EPS = 1e-9;

export const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
export const money = (n: number) =>
  (Number(n) || 0).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const qtyFmt = (n: number) => (Math.round((Number(n) || 0) * 1000) / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 });
export const dateFmt = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
export const dayKey = (iso?: string | null) => (iso || '').slice(0, 10);

// ── totals ───────────────────────────────────────────────────────────────────
export const lineTotal = (l: Pick<PoLine, 'qty' | 'unitPrice'>) => round2((Number(l.qty) || 0) * (Number(l.unitPrice) || 0));

// VAT is kept per line (each item has its own %). Older records have no line rate and fall back to the document's rate.
export const lineRate = (l: { vatRate?: number | null }, fallback: number) =>
  l.vatRate != null && String(l.vatRate) !== '' && !isNaN(Number(l.vatRate)) ? Number(l.vatRate) : Number(fallback) || 0;

// "5%" when every line has the same rate, "mixed" when they differ
export function vatLabel(lines: { vatRate?: number | null }[], fallback: number) {
  const rates = Array.from(new Set(lines.map(l => lineRate(l, fallback))));
  return rates.length === 1 ? `${rates[0]}%` : rates.length === 0 ? `${Number(fallback) || 0}%` : 'mixed';
}

export function poTotals(po: Pick<PurchaseOrder, 'lines' | 'discount' | 'vatRate'>) {
  const subtotal = round2(po.lines.reduce((t, l) => t + lineTotal(l), 0));
  const discount = Math.min(round2(po.discount || 0), subtotal);
  const taxable = round2(subtotal - discount);
  const keep = subtotal > 0 ? 1 - discount / subtotal : 1;          // the discount is shared across lines pro-rata
  const vat = round2(po.lines.reduce((t, l) => t + lineTotal(l) * keep * lineRate(l as any, po.vatRate) / 100, 0));
  return { subtotal, discount, taxable, vat, total: round2(taxable + vat) };
}

// ── receiving progress (from the Store's goods receipts) ─────────────────────
export interface PoLineProgress {
  line: PoLine;
  ordered: number;
  received: number;     // booked at the gate
  rejected: number;     // failed Quality Control (goes back to the supplier)
  accepted: number;     // received − rejected: what we really keep
  remaining: number;    // still owed by the supplier
  pct: number;          // accepted / ordered, 0–100
  receipts: IncomingMaterial[];
}
export interface PoProgress {
  lines: PoLineProgress[];
  ordered: number; received: number; rejected: number; accepted: number; remaining: number;
  pct: number;                // share of the PO's VALUE accepted so far (units differ per line, so quantities are never added up)
  linesComplete: number;
  anyReceived: boolean;
  complete: boolean;
  firstReceiptAt: string | null;
  lastReceiptAt: string | null;
  receipts: IncomingMaterial[];
  acceptedSubtotal: number;   // accepted qty × PO price, before discount / VAT
}

export function poProgress(po: PurchaseOrder, incoming: IncomingMaterial[]): PoProgress {
  const mine = incoming.filter(i => i.poId === po.id);
  const lines: PoLineProgress[] = po.lines.map(line => {
    const receipts = mine.filter(i => i.poLineId === line.id);
    const received = receipts.reduce((t, i) => t + (Number(i.qty) || 0), 0);
    const rejected = receipts.reduce((t, i) => t + (Number(i.qtyFailed) || 0), 0);
    const accepted = Math.max(0, received - rejected);
    const ordered = Number(line.qty) || 0;
    const remaining = Math.max(0, ordered - accepted);
    return { line, ordered, received, rejected, accepted, remaining, pct: ordered > 0 ? Math.min(100, (accepted / ordered) * 100) : 0, receipts };
  });
  const sum = (k: 'ordered' | 'received' | 'rejected' | 'accepted' | 'remaining') => lines.reduce((t, l) => t + l[k], 0);
  const ordered = sum('ordered');
  const accepted = sum('accepted');
  const orderedValue = lines.reduce((t, l) => t + l.ordered * (Number(l.line.unitPrice) || 0), 0);
  const acceptedValue = lines.reduce((t, l) => t + Math.min(l.accepted, l.ordered) * (Number(l.line.unitPrice) || 0), 0);
  const pct = orderedValue > 0
    ? Math.min(100, (acceptedValue / orderedValue) * 100)
    : (lines.length ? lines.reduce((t, l) => t + l.pct, 0) / lines.length : 0);
  const times = mine.map(i => i.receivedAt || i.createdAt).filter(Boolean).sort();
  return {
    lines, ordered, received: sum('received'), rejected: sum('rejected'), accepted, remaining: sum('remaining'),
    pct,
    linesComplete: lines.filter(l => l.remaining <= EPS).length,
    anyReceived: mine.length > 0,
    complete: lines.length > 0 && lines.every(l => l.remaining <= EPS),
    firstReceiptAt: times[0] || null,
    lastReceiptAt: times[times.length - 1] || null,
    receipts: [...mine].sort((a, b) => (a.receivedAt || a.createdAt || '').localeCompare(b.receivedAt || b.createdAt || '')),
    acceptedSubtotal: round2(lines.reduce((t, l) => t + l.accepted * (Number(l.line.unitPrice) || 0), 0)),
  };
}

// What the supplier may invoice for what we accepted so far (PO prices, discount shared pro-rata, VAT on top).
export function expectedInvoiceAmount(po: PurchaseOrder, progress: PoProgress): number {
  const t = poTotals(po);
  const keep = t.subtotal > 0 ? 1 - t.discount / t.subtotal : 1;
  return round2(progress.lines.reduce((sum, l) => sum + l.accepted * (Number(l.line.unitPrice) || 0) * keep * (1 + lineRate(l.line as any, po.vatRate) / 100), 0));
}

// How much more of the PO a receipt may still bring in (ordered + tolerance − accepted/received so far)
export function maxReceivable(lp: PoLineProgress): number {
  const cap = lp.ordered * (1 + OVER_RECEIPT_TOLERANCE);
  return Math.max(0, cap - lp.accepted);
}

// ── money: invoices and payments ─────────────────────────────────────────────
export interface PoFinance {
  invoices: SupplierInvoice[];
  payments: SupplierPayment[];
  invoiced: number;       // live (non-void) invoices, incl. VAT
  paid: number;           // money that has really left: cleared cheques, transfers, cash, bank-paid
  pdcIssued: number;      // post-dated cheques handed over but not cleared yet — arranged, not paid
  advance: number;        // paid before an invoice
  outstanding: number;    // invoiced − paid (never below 0)
  unarranged: number;     // invoiced − paid − PDCs: what still has to be arranged
  poTotal: number;
  payCap: number;         // the most we may pay in total on this PO
}
const isOpenPdc = (p: SupplierPayment) => p.method === 'pdc' && p.clearStatus !== 'cleared';
export function poFinance(po: PurchaseOrder, invoices: SupplierInvoice[], payments: SupplierPayment[]): PoFinance {
  const inv = invoices.filter(i => i.poId === po.id && !i.voided);
  const pay = payments.filter(p => p.poId === po.id && !p.voided && p.clearStatus !== 'bounced');
  const invoiced = round2(inv.reduce((t, i) => t + i.amount, 0));
  const paid = round2(pay.filter(p => !isOpenPdc(p)).reduce((t, p) => t + p.amount, 0));
  const pdcIssued = round2(pay.filter(isOpenPdc).reduce((t, p) => t + p.amount, 0));
  const poTotal = poTotals(po).total;
  return {
    invoices: inv, payments: pay, invoiced, paid, pdcIssued,
    advance: round2(pay.filter(p => p.kind === 'advance' && !isOpenPdc(p)).reduce((t, p) => t + p.amount, 0)),
    outstanding: Math.max(0, round2(invoiced - paid)),
    unarranged: Math.max(0, round2(invoiced - paid - pdcIssued)),
    poTotal,
    payCap: Math.max(poTotal, invoiced),
  };
}

export function invoiceMatch(amount: number, expected: number): { status: 'matched' | 'mismatch'; variance: number } {
  const variance = round2(amount - expected);
  const tol = Math.max(1, expected * 0.005);   // AED 1 or 0.5%, whichever is bigger
  return { status: Math.abs(variance) <= tol ? 'matched' : 'mismatch', variance };
}

// Payment terms are free text, the way the company writes them: "PDC - 30 Days", "Net 30", "Cash on delivery",
// "50% Advance Payment / Remaining PDC - 30 Days".
export function parseTerms(terms?: string | null): { advancePct: number; creditDays: number | null; viaPdc: boolean } {
  const t = terms || '';
  const adv = /(\d+(?:\.\d+)?)\s*%\s*advance/i.exec(t);
  const pdc = /pdc[^\d]*(\d+)\s*days?/i.exec(t);
  const net = /net\s*(\d+)/i.exec(t);
  const creditDays = pdc ? Number(pdc[1]) : net ? Number(net[1]) : /cash|cod/i.test(t) ? 0 : null;
  const fullAdvance = /^\s*(100\s*%\s*)?advance/i.test(t) && !adv;
  return { advancePct: adv ? Number(adv[1]) : fullAdvance ? 100 : 0, creditDays, viaPdc: /pdc/i.test(t) };
}
// days between invoice and due date; null when the terms don't say
export function termsDays(terms?: string | null): number | null {
  if (!terms) return null;
  const p = parseTerms(terms);
  if (p.creditDays != null) return p.creditDays;
  if (p.advancePct >= 100) return 0;
  return /pdc/i.test(terms) ? 30 : null;
}
export function dueDateFor(invoiceDate: string, terms?: string | null): string {
  const d = new Date(invoiceDate + 'T00:00:00');
  d.setDate(d.getDate() + (termsDays(terms) ?? 0));
  return d.toISOString().slice(0, 10);
}
export const daysUntil = (dueDate: string, today = new Date()): number => {
  const a = new Date(dueDate + 'T00:00:00').getTime();
  const b = new Date(today.toISOString().slice(0, 10) + 'T00:00:00').getTime();
  return Math.round((a - b) / 86400000);
};

// ── stage: one plain-English label for where a PO is right now ───────────────
export type PoStage =
  | 'draft' | 'awaiting_approval' | 'issued' | 'partially_received' | 'received'
  | 'part_paid' | 'paid' | 'closed' | 'closed_short' | 'cancelled';

export function poStage(po: PurchaseOrder, progress: PoProgress, fin: PoFinance): PoStage {
  if (po.status === 'cancelled') return 'cancelled';
  if (po.status === 'draft') return 'draft';
  if (po.status === 'pending_approval') return 'awaiting_approval';
  if (po.status === 'closed') return po.closedReason === 'short_closed' ? 'closed_short' : 'closed';
  if (!progress.anyReceived) return 'issued';
  if (!progress.complete) return 'partially_received';
  if (fin.invoiced > 0 && fin.paid >= fin.invoiced - 0.005) return 'paid';
  if (fin.paid > 0) return 'part_paid';
  return 'received';
}

export const STAGE_META: Record<PoStage, { label: string; cls: string; hint: string }> = {
  draft: { label: 'Draft', cls: 'bg-slate-100 text-slate-700 border-slate-300', hint: 'Being prepared — not sent to the supplier' },
  awaiting_approval: { label: 'Awaiting approval', cls: 'bg-amber-50 text-amber-800 border-amber-300', hint: 'Waiting for management' },
  issued: { label: 'Issued — awaiting delivery', cls: 'bg-sky-50 text-sky-800 border-sky-300', hint: 'Approved and sent; nothing received yet' },
  partially_received: { label: 'Partially received', cls: 'bg-violet-50 text-violet-800 border-violet-300', hint: 'Still active — more is due from the supplier' },
  received: { label: 'Received — ready to pay', cls: 'bg-emerald-50 text-emerald-800 border-emerald-300', hint: 'Everything ordered has arrived' },
  part_paid: { label: 'Part paid', cls: 'bg-teal-50 text-teal-800 border-teal-300', hint: 'Received in full; payment in progress' },
  paid: { label: 'Paid — can close', cls: 'bg-emerald-100 text-emerald-900 border-emerald-400', hint: 'Fully received and fully paid' },
  closed: { label: 'Closed', cls: 'bg-slate-200 text-slate-700 border-slate-300', hint: 'Completed' },
  closed_short: { label: 'Closed short', cls: 'bg-orange-50 text-orange-800 border-orange-300', hint: 'Closed before everything arrived' },
  cancelled: { label: 'Cancelled', cls: 'bg-rose-50 text-rose-700 border-rose-300', hint: 'Cancelled' },
};

// Fully received, fully invoiced (to what was received) and fully paid → the PO can close by itself.
export function canAutoClose(po: PurchaseOrder, progress: PoProgress, fin: Pick<PoFinance, 'invoiced' | 'paid'>): boolean {
  if (po.status !== 'approved' || !progress.complete || fin.invoiced <= 0) return false;
  const expected = expectedInvoiceAmount(po, progress);
  return fin.paid >= fin.invoiced - 0.005 && fin.invoiced >= expected - Math.max(1, expected * 0.005);
}

// A PO the Store may receive against (approved, not closed)
export const isReceivable = (po: PurchaseOrder) => po.status === 'approved';
// "Active" = anything still moving (not draft/closed/cancelled) — used by dashboards
export const isOpenPo = (po: PurchaseOrder) => po.status === 'approved' || po.status === 'pending_approval';

// ── document numbers ─────────────────────────────────────────────────────────
//   STF   STF.P2026110022      STF.P + year + month + 4-digit running number
//   PO    PO.P20261100022      PO.P  + year + month + 5-digit running number
//   QTN   MAT-QTN-2026-0001    quotation sheets          TF  MAT-TF-2026-0001  trade finance
// The running number does not reset every month (it matches the company sheet: STF …0021, …0022 …) —
// it restarts each January. `floor` lets Settings say "we are already at number N this year", so the
// numbers carry on from the Excel sheet instead of starting again at 1. Called INSIDE the write.
export function nextDocNo(existing: string[], kind: 'PO' | 'STF' | 'QTN' | 'TF', now = new Date(), floor?: { seq: number; year: number }): string {
  const year = now.getFullYear();
  if (kind === 'STF' || kind === 'PO') {
    const re = kind === 'STF' ? /^STF\.P(\d{4})(\d{2})(\d{4})$/ : /^PO\.P(\d{4})(\d{2})(\d{5})$/;
    let max = floor && floor.year === year ? floor.seq : 0;
    for (const n of existing) {
      const m = re.exec(n || '');
      if (m && Number(m[1]) === year) max = Math.max(max, Number(m[3]));
    }
    const seq = String(max + 1).padStart(kind === 'STF' ? 4 : 5, '0');
    return `${kind === 'STF' ? 'STF.P' : 'PO.P'}${year}${String(now.getMonth() + 1).padStart(2, '0')}${seq}`;
  }
  const prefix = `MAT-${kind}-${year}-`;
  let max = 0;
  for (const n of existing) {
    if (n && n.startsWith(prefix)) max = Math.max(max, parseInt(n.slice(prefix.length), 10) || 0);
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

// ── Quotation comparison ───────────────────────────────────────────────────────────
export function quoteTotal(rfq: Pick<Rfq, 'lines'>, q: RfqQuote): number | null {
  let t = 0;
  for (const l of rfq.lines) {
    const p = q.unitPrices[l.id];
    if (p == null || Number.isNaN(Number(p))) return null;   // incomplete quote — not comparable
    t += l.qty * Number(p);
  }
  return round2(t);
}
export function cheapestQuoteId(rfq: Pick<Rfq, 'lines' | 'quotes'>): string | null {
  let best: { id: string; t: number } | null = null;
  for (const q of rfq.quotes) {
    const t = quoteTotal(rfq, q);
    if (t != null && (!best || t < best.t)) best = { id: q.id, t };
  }
  return best ? best.id : null;
}

// Approved Supervisor / HR purchase requests that no PO line covers yet
export function openRequisitions(
  supervisor: any[], hr: any[], pos: PurchaseOrder[], stfs: Stf[] = [],
): { key: string; kind: 'supervisor' | 'hr'; id: string; itemName: string; erpCode?: string | null; unit: string; qty: number; requestedByName: string; requestedAt: string; purpose?: string | null; estimatedCost?: number | null }[] {
  const covered = new Set<string>();
  for (const po of pos) {
    if (po.status === 'cancelled') continue;
    for (const l of po.lines) if (l.sourceRequestId) covered.add(l.sourceRequestId);
  }
  // a live STF (not rejected / cancelled) already covers its requests too
  for (const f of stfs) {
    if (f.status === 'cancelled' || f.status === 'rejected') continue;
    for (const l of f.lines) if (l.sourceRequestId) covered.add(l.sourceRequestId);
  }
  const take = (rows: any[], kind: 'supervisor' | 'hr') => rows
    .filter(r => r.status === 'Approved' && !covered.has(r.id))
    .map(r => ({
      key: `${kind}:${r.id}`, kind, id: r.id, itemName: r.itemName, erpCode: r.erpCode || null, unit: r.unit,
      qty: Number(r.qtyApproved != null ? r.qtyApproved : r.qty) || 0,
      requestedByName: r.requestedByName, requestedAt: r.requestedAt, purpose: r.purpose || null,
      estimatedCost: r.estimatedCost ?? null,
    }));
  return [...take(supervisor, 'supervisor'), ...take(hr, 'hr')].sort((a, b) => (a.requestedAt || '').localeCompare(b.requestedAt || ''));
}
