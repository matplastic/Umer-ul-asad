// Purchase Order document (A4, company letterhead) — what is sent to the supplier.
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  COMPANY_NAME, PDF_COLORS, PDF_LAYOUT, loadLogo, drawLetterhead, drawFooter, themedTable, currentPage,
} from './pdfTheme';
import type { PurchaseOrder, Supplier } from '../types';
import { STAGE_META, dateFmt, lineTotal, money, poTotals, qtyFmt, type PoStage } from './procurement';

export async function exportPurchaseOrderPdf(po: PurchaseOrder, supplier: Supplier | null, stage?: PoStage) {
  const logo = await loadLogo();
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pw = doc.internal.pageSize.getWidth();
  const mx = PDF_LAYOUT.marginX;
  const C = PDF_COLORS;
  const dept = 'Procurement Department';
  const draft = po.status === 'draft' || po.status === 'pending_approval';
  const cancelled = po.status === 'cancelled';
  const badge = cancelled ? 'CANCELLED' : draft ? 'DRAFT — NOT APPROVED' : stage ? STAGE_META[stage].label.toUpperCase() : 'APPROVED';
  const t = poTotals(po);

  const header = (first: boolean) => drawLetterhead(doc, {
    logo, dept, title: `Purchase Order  ${po.poNo}`,
    subtitle: `${po.supplierName}  ·  ${dateFmt(po.orderDate)}`, firstPage: first, badge: first ? badge : undefined,
    badgeTone: cancelled ? C.bad : draft ? C.warn : C.teal,
  });
  let y = header(true);

  // ── two boxes: supplier | order details ──
  const boxW = (pw - mx * 2 - 12) / 2;
  const box = (x: number, title: string, rows: [string, string][]) => {
    const rowH = 13;
    const h = 26 + rows.length * rowH;
    doc.setFillColor(...C.stripe); doc.setDrawColor(...C.line); doc.setLineWidth(0.6);
    doc.roundedRect(x, y, boxW, h, 4, 4, 'FD');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...C.teal);
    doc.text(title.toUpperCase(), x + 10, y + 15);
    rows.forEach(([k, v], i) => {
      const ry = y + 30 + i * rowH;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...C.muted);
      doc.text(k, x + 10, ry);
      doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.text);
      const val = doc.splitTextToSize(v || '—', boxW - 92)[0] as string;
      doc.text(val, x + 82, ry);
    });
    return h;
  };
  const addr = [supplier?.address, supplier?.city, supplier?.country].filter(Boolean).join(', ');
  const h1 = box(mx, 'Supplier', [
    ['Name', po.supplierName],
    ['Supplier code', po.supplierCode || supplier?.code || ''],
    ['TRN', po.supplierTaxNo || supplier?.taxNo || ''],
    ['Contact', [supplier?.contactPerson, supplier?.phone].filter(Boolean).join(' · ')],
    ['E-mail', supplier?.email || ''],
    ['Address', addr],
  ]);
  const h2 = box(mx + boxW + 12, 'Order details', [
    ['PO number', po.poNo],
    ['Order date', dateFmt(po.orderDate)],
    ['Delivery by', dateFmt(po.expectedDate)],
    ['Deliver to', po.deliveryLocation || ''],
    ['Payment terms', po.paymentTerms || supplier?.paymentTerms || ''],
    ['Quotation ref.', po.rfqNo || '—'],
  ]);
  y += Math.max(h1, h2) + 16;

  // ── items ──
  const head = ['#', 'Item', 'ERP code', 'Unit', 'Qty', `Unit price (${po.currency})`, `Amount (${po.currency})`];
  const body = po.lines.map((l, i) => [
    String(i + 1), l.itemName, l.erpCode || '—', l.unit, qtyFmt(l.qty), money(l.unitPrice), money(lineTotal(l)),
  ]);
  const startPage = currentPage(doc);
  autoTable(doc, {
    ...themedTable(head, body),
    startY: y,
    head: [head],
    body,
    margin: { top: PDF_LAYOUT.nextTop, left: mx, right: mx, bottom: PDF_LAYOUT.bottom },
    columnStyles: { 0: { cellWidth: 24, halign: 'center' }, 1: { cellWidth: 'auto', halign: 'left' }, 2: { halign: 'left' }, 3: { halign: 'center' } },
    didDrawPage: () => { if (currentPage(doc) !== startPage) header(false); },
  });
  y = ((doc as any).lastAutoTable?.finalY ?? y) + 14;

  // ── totals (right) ──
  const need = 130;
  if (y + need > doc.internal.pageSize.getHeight() - PDF_LAYOUT.bottom) { doc.addPage(); header(false); y = PDF_LAYOUT.nextTop; }
  const tw = 220, tx = pw - mx - tw;
  const tRow = (label: string, val: string, bold = false, ty = y) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(bold ? 10 : 8.5);
    doc.setTextColor(...(bold ? C.ink : C.text));
    doc.text(label, tx + 8, ty); doc.text(val, tx + tw - 8, ty, { align: 'right' });
  };
  doc.setDrawColor(...C.line); doc.setLineWidth(0.6);
  tRow('Subtotal', money(t.subtotal), false, y);
  if (t.discount > 0) tRow('Discount', `− ${money(t.discount)}`, false, y += 14);
  tRow(`VAT ${po.vatRate}%`, money(t.vat), false, y += 14);
  doc.line(tx, y + 6, tx + tw, y + 6);
  doc.setFillColor(...C.tealSoft); doc.rect(tx, y + 8, tw, 22, 'F');
  tRow(`TOTAL (${po.currency})`, money(t.total), true, y += 23);
  y += 22;

  // ── notes ──
  if (po.notes) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...C.teal);
    doc.text('NOTES / TERMS', mx, y);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.text);
    const lines = doc.splitTextToSize(po.notes, pw - mx * 2) as string[];
    doc.text(lines, mx, y + 12);
    y += 14 + lines.length * 11;
  }

  // ── signatures ──
  if (y + 70 > doc.internal.pageSize.getHeight() - PDF_LAYOUT.bottom) { doc.addPage(); header(false); y = PDF_LAYOUT.nextTop; }
  y += 18;
  const sw = (pw - mx * 2 - 24) / 3;
  const sig: [string, string][] = [
    ['Prepared by', po.createdByName],
    ['Approved by', po.approvedByName && !/^Auto/.test(po.approvedByName) ? po.approvedByName : (po.approvedByName || '')],
    ['Supplier acknowledgement', ''],
  ];
  sig.forEach(([label, name], i) => {
    const sx = mx + i * (sw + 12);
    doc.setDrawColor(...C.muted); doc.setLineWidth(0.6);
    doc.line(sx, y + 28, sx + sw, y + 28);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...C.text);
    if (name) doc.text(name, sx, y + 24);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.muted);
    doc.text(label, sx, y + 40);
  });
  doc.setFontSize(7.5); doc.setTextColor(...C.faint);
  doc.text('Please quote the PO number on your delivery order and invoice. Goods are subject to inspection on receipt.', mx, y + 62);

  drawFooter(doc, `${COMPANY_NAME}  ·  ${dept}`);
  doc.save(`${po.poNo}.pdf`);
}
