// The "STF – PO – PAYMENT" register: one row per STF, with the PO, delivery and payment that followed —
// the same columns as the company's Excel sheet, filled in from the live records.
import type { IncomingMaterial, ProcurementSettings, PurchaseOrder, Stf, SupplierInvoice, SupplierPayment } from '../types';
import { poFinance, poProgress, poTotals, dateFmt, qtyFmt, type PoFinance, type PoProgress } from './procurement';
import { STF_STATUS_META, budgetTier, stfTotals } from './stf';

export type DeliveryStatus = 'WAITING' | 'PARTIAL RECEIVED' | 'RECEIVED';
export type DeliveryDoc = 'WAITING' | 'DELIVERY NOTE' | 'INVOICE';
export type PayStatus = 'WAITING' | 'READY' | 'PARTIAL PAID' | 'PAID' | 'CANCELLED';

export function deliveryInfo(progress: PoProgress) {
  const status: DeliveryStatus = !progress.anyReceived ? 'WAITING' : progress.complete ? 'RECEIVED' : 'PARTIAL RECEIVED';
  const withInv = progress.receipts.filter(r => r.invoiceNo);
  const withDo = progress.receipts.filter(r => r.doNo);
  const docType: DeliveryDoc = withInv.length ? 'INVOICE' : withDo.length ? 'DELIVERY NOTE' : 'WAITING';
  const nos = Array.from(new Set(progress.receipts.map(r => r.invoiceNo || r.doNo).filter(Boolean) as string[]));
  const details = progress.receipts.map(r => `${dateFmt(r.receivedAt || r.createdAt)}: ${qtyFmt(r.qty)} ${r.unit} ${r.materialName}`).join('; ');
  return { status, docType, docNos: nos.join(', '), lastDate: progress.lastReceiptAt, details };
}

export function payStatus(po: PurchaseOrder, fin: PoFinance): PayStatus {
  if (po.status === 'cancelled') return 'CANCELLED';
  if (fin.paid > 0 && ((fin.invoiced > 0 && fin.paid >= fin.invoiced - 0.005) || fin.paid >= fin.poTotal - 0.005)) return 'PAID';
  if (fin.paid > 0) return 'PARTIAL PAID';
  if (fin.pdcIssued > 0) return 'READY';
  return 'WAITING';
}

export interface RegisterItem { code: string; description: string; qty: number; unit: string; unitPrice: number; total: number; received: number; balance: number }
export interface RegisterRow {
  no: number;
  date: string;
  stf: Stf | null;
  po: PurchaseOrder | null;
  stfNo: string;
  description: string;
  poNo: string;
  supplier: string;
  projectType: string;
  projectName: string;
  stfStatus: string;
  lastStatusDate: string | null;
  budget: string;
  queue: string;
  paymentTerms: string;
  delivery: ReturnType<typeof deliveryInfo> | null;
  payStatus: PayStatus | '';
  payDate: string | null;
  paidAmount: number;
  paymentDetails: string;
  currency: string;
  vatRate: number;
  items: RegisterItem[];
  subtotal: number; vat: number; total: number;
}

const METHOD_TEXT: Record<string, string> = { bank_transfer: 'Transaction Reference', cheque: 'Cheque', pdc: 'PDC', cash: 'Cash', card: 'Card', trade_finance: 'Bank-paid (trade finance)' };

export function buildRegister(
  stfs: Stf[], pos: PurchaseOrder[], incoming: IncomingMaterial[], invoices: SupplierInvoice[], payments: SupplierPayment[], settings: ProcurementSettings,
): RegisterRow[] {
  const used = new Set<string>();
  const rows: Omit<RegisterRow, 'no'>[] = [];

  const fromPo = (po: PurchaseOrder, stf: Stf | null) => {
    const progress = poProgress(po, incoming);
    const fin = poFinance(po, invoices, payments);
    const t = poTotals(po);
    const pays = payments.filter(p => p.poId === po.id && !p.voided && p.clearStatus !== 'bounced').sort((a, b) => a.paidAt.localeCompare(b.paidAt));
    return {
      progress, fin, t, pays,
      items: progress.lines.map(lp => ({
        code: lp.line.erpCode || '', description: lp.line.itemName, qty: lp.ordered, unit: lp.line.unit, unitPrice: lp.line.unitPrice,
        total: Math.round(lp.ordered * lp.line.unitPrice * 100) / 100, received: lp.received, balance: lp.remaining,
      })) as RegisterItem[],
      stf,
    };
  };

  const payText = (pays: SupplierPayment[]) => pays.map(p => {
    const ref = p.reference ? ` ${p.reference}` : '';
    if (p.method === 'pdc') return `PDC ${p.chequeDate ? dateFmt(p.chequeDate) : ''}${ref}${p.clearStatus === 'cleared' ? ' (cleared)' : ''}`.trim();
    return `${METHOD_TEXT[p.method] || p.method}:${ref}`.trim();
  }).join('\n');

  for (const stf of stfs) {
    const po = stf.poId ? pos.find(p => p.id === stf.poId) || null : null;
    if (po) used.add(po.id);
    const tier = budgetTier(stf, settings);
    const base = {
      date: stf.date, stf, po, stfNo: stf.stfNo, description: stf.description, poNo: po?.poNo || stf.poNo || '', supplier: stf.supplierName,
      projectType: stf.projectType, projectName: stf.projectName, stfStatus: STF_STATUS_META[stf.status].label.toUpperCase(), lastStatusDate: stf.statusDate,
      budget: tier.label, queue: stf.queue, paymentTerms: po?.paymentTerms || stf.paymentTerms || '', currency: stf.currency, vatRate: stf.vatRate,
    };
    if (po) {
      const x = fromPo(po, stf);
      rows.push({ ...base, delivery: deliveryInfo(x.progress), payStatus: payStatus(po, x.fin), payDate: x.pays.length ? x.pays[x.pays.length - 1].paidAt : null,
        paidAmount: x.fin.paid + x.fin.pdcIssued, paymentDetails: payText(x.pays), items: x.items, subtotal: x.t.subtotal, vat: x.t.vat, total: x.t.total });
    } else {
      const t = stfTotals(stf);
      rows.push({ ...base, delivery: null, payStatus: '', payDate: null, paidAmount: 0, paymentDetails: '',
        items: stf.lines.map(l => ({ code: l.erpCode || '', description: l.itemName, qty: l.qty, unit: l.unit, unitPrice: l.unitPrice, total: Math.round(l.qty * l.unitPrice * 100) / 100, received: 0, balance: l.qty })),
        subtotal: t.subtotal, vat: t.vat, total: t.total });
    }
  }
  // POs raised directly, without an STF
  for (const po of pos) {
    if (used.has(po.id) || po.status === 'draft') continue;
    const x = fromPo(po, null);
    rows.push({
      date: po.orderDate, stf: null, po, stfNo: '', description: po.notes || po.lines.map(l => l.itemName).join(', ').slice(0, 80), poNo: po.poNo, supplier: po.supplierName,
      projectType: po.projectType || '', projectName: po.projectName || '', stfStatus: '', lastStatusDate: po.approvedAt || po.createdAt, budget: '', queue: '',
      paymentTerms: po.paymentTerms || '', delivery: deliveryInfo(x.progress), payStatus: payStatus(po, x.fin), payDate: x.pays.length ? x.pays[x.pays.length - 1].paidAt : null,
      paidAmount: x.fin.paid + x.fin.pdcIssued, paymentDetails: payText(x.pays), currency: po.currency, vatRate: po.vatRate, items: x.items, subtotal: x.t.subtotal, vat: x.t.vat, total: x.t.total,
    });
  }
  return rows.sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.stfNo || a.poNo).localeCompare(b.stfNo || b.poNo)).map((r, i) => ({ ...r, no: i + 1 }));
}
