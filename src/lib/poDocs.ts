// Supplier paperwork per PURCHASE ORDER delivery.
//
// A PO can arrive in several deliveries (trucks). The Store books each delivery against the PO; every
// delivery should have the supplier's DO (delivery note) and/or invoice uploaded. This file works out,
// for one PO, how many deliveries there were and how many have a DO / invoice file — and the traffic light:
//
//   GREY    no delivery yet
//   RED     deliveries received, but NO DO / invoice uploaded for any of them
//   YELLOW  some deliveries have a DO / invoice and some don't,
//           OR every delivery has one but the PO is not fully received yet (more is still to come)
//   GREEN   the PO is fully received and EVERY delivery has a DO or invoice uploaded
//
// A delivery counts as documented when it has at least one file of kind "do" or "invoice" ("other" does not count).
import type { GrnAttachment, IncomingMaterial, PurchaseOrder } from '../types';
import { poProgress, type PoProgress } from './procurement';

export interface PoDeliveryFile { att: GrnAttachment; receiptId: string }

export interface PoDelivery {
  key: string;
  receivedAt: string;
  doNo: string | null;
  invoiceNo: string | null;
  receipts: IncomingMaterial[];
  files: PoDeliveryFile[];       // every file on any receipt of this delivery (one entry per file)
  hasDo: boolean;
  hasInvoice: boolean;
  documented: boolean;           // has a DO or an invoice file
  holderId: string;              // receipt that new files are attached to
}

export type DocLevel = 'none' | 'green' | 'yellow' | 'red';
export interface PoDocStatus {
  level: DocLevel;
  deliveries: PoDelivery[];
  documented: number;
  total: number;
  qtyComplete: boolean;
  label: string;                 // short text for the badge
  hint: string;                  // one-sentence explanation
}

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const dayOf = (r: IncomingMaterial) => String(r.receivedAt || r.createdAt || '').slice(0, 10);
export const deliveryKeyOf = (r: IncomingMaterial) => r.deliveryId || `${r.poId || ''}|${dayOf(r)}|${norm(r.doNo)}`;
const isPaperwork = (a: GrnAttachment) => a.kind === 'do' || a.kind === 'invoice';

export function poDeliveries(po: PurchaseOrder, incoming: IncomingMaterial[]): PoDelivery[] {
  const mine = incoming.filter((i) => i.poId === po.id);
  const groups = new Map<string, IncomingMaterial[]>();
  for (const r of mine) {
    const k = deliveryKeyOf(r);
    groups.set(k, [...(groups.get(k) || []), r]);
  }
  const out: PoDelivery[] = [];
  for (const [key, list] of groups) {
    const receipts = [...list].sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    const seen = new Set<string>();
    const files: PoDeliveryFile[] = [];
    for (const r of receipts) for (const a of r.attachments || []) { if (!seen.has(a.id)) { seen.add(a.id); files.push({ att: a, receiptId: r.id }); } }
    out.push({
      key,
      receivedAt: receipts.map((r) => r.receivedAt || r.createdAt || '').filter(Boolean).sort()[0] || '',
      doNo: receipts.map((r) => r.doNo).find(Boolean) || null,
      invoiceNo: receipts.map((r) => r.invoiceNo).find(Boolean) || null,
      receipts, files,
      hasDo: files.some((f) => f.att.kind === 'do'),
      hasInvoice: files.some((f) => f.att.kind === 'invoice'),
      documented: files.some((f) => isPaperwork(f.att)),
      holderId: receipts[0].id,
    });
  }
  return out.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
}

export function poDocStatus(po: PurchaseOrder, incoming: IncomingMaterial[], progress?: PoProgress): PoDocStatus {
  const deliveries = poDeliveries(po, incoming);
  const total = deliveries.length;
  const documented = deliveries.filter((d) => d.documented).length;
  // A PO that was closed (short or complete) will not receive anything more.
  const qtyComplete = (progress || poProgress(po, incoming)).complete || po.status === 'closed';
  const n = (x: number) => `${x} deliver${x === 1 ? 'y' : 'ies'}`;
  const allHave = total === 1 ? 'The delivery has' : `All ${total} deliveries have`;

  if (total === 0) return { level: 'none', deliveries, documented, total, qtyComplete, label: 'No delivery yet', hint: 'Nothing has been received against this PO yet.' };
  if (documented === 0) return { level: 'red', deliveries, documented, total, qtyComplete, label: 'No DO / invoice', hint: `${n(total)} received, but no supplier DO or invoice has been uploaded.` };
  if (documented < total) return { level: 'yellow', deliveries, documented, total, qtyComplete, label: `${documented}/${total} have DO / invoice`, hint: `${documented} of ${n(total)} have a DO or invoice uploaded — ${total - documented} still missing.` };
  if (!qtyComplete) return { level: 'yellow', deliveries, documented, total, qtyComplete, label: 'Partly received', hint: `${allHave} a DO / invoice${total === 1 ? ' so far' : ''}, but the PO is not fully received yet.` };
  return { level: 'green', deliveries, documented, total, qtyComplete, label: 'DO / invoice OK', hint: `${allHave} a DO or invoice uploaded.` };
}
