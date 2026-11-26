// Request for Quotation document (A4, company letterhead) — the PDF you send to each supplier.
// It lists what we need and what the supplier must state in the reply; prices are left blank for them to fill.
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { COMPANY_NAME, PDF_COLORS, PDF_LAYOUT, loadLogo, drawLetterhead, drawFooter, themedTable, currentPage } from './pdfTheme';
import type { Rfq, RfqLine, Supplier } from '../types';
import { dateFmt, qtyFmt } from './procurement';

export interface RfqPdfInput {
  rfqNo: string;
  title: string;
  projectName?: string | null;
  rfqDate?: string | null;
  neededBy?: string | null;
  notes?: string | null;
  lines: RfqLine[];
  createdByName?: string | null;
}

export async function exportRfqRequestPdf(rfq: RfqPdfInput | Rfq, supplierName: string | null, supplier?: Supplier | null) {
  const logo = await loadLogo();
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pw = doc.internal.pageSize.getWidth();
  const mx = PDF_LAYOUT.marginX;
  const C = PDF_COLORS;
  const dept = 'Procurement Department';
  const today = ((rfq as any).rfqDate || new Date().toISOString().slice(0, 10)) as string;

  const header = (first: boolean) => drawLetterhead(doc, {
    logo, dept, title: `Request for Quotation  ${rfq.rfqNo}`,
    subtitle: `${supplierName || 'All suppliers'}  ·  ${dateFmt(today)}`, firstPage: first,
  });
  let y = header(true);

  const boxW = (pw - mx * 2 - 12) / 2;
  const box = (x: number, title: string, rows: [string, string][]) => {
    const rowH = 13, h = 26 + rows.length * rowH;
    doc.setFillColor(...C.stripe); doc.setDrawColor(...C.line); doc.setLineWidth(0.6);
    doc.roundedRect(x, y, boxW, h, 4, 4, 'FD');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...C.teal);
    doc.text(title.toUpperCase(), x + 10, y + 15);
    rows.forEach(([k, v], i) => {
      const ry = y + 30 + i * rowH;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...C.muted); doc.text(k, x + 10, ry);
      doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.text);
      doc.text(doc.splitTextToSize(v || '—', boxW - 92)[0] as string, x + 82, ry);
    });
    return h;
  };
  const addr = [supplier?.address, supplier?.city, supplier?.country].filter(Boolean).join(', ');
  const h1 = box(mx, 'To (supplier)', [
    ['Name', supplierName || ''],
    ['Contact', [supplier?.contactPerson, supplier?.phone].filter(Boolean).join(' · ')],
    ['E-mail', supplier?.email || ''],
    ['Address', addr],
  ]);
  const h2 = box(mx + boxW + 12, 'Request details', [
    ['RFQ number', rfq.rfqNo],
    ['Date', dateFmt(today)],
    ['Delivery required', dateFmt(rfq.neededBy)],
    ['Project', rfq.projectName || ''],
    ['Subject', rfq.title],
  ]);
  y += Math.max(h1, h2) + 16;

  // items — price columns left empty for the supplier
  const head = ['#', 'Item / description', 'Unit', 'Qty', 'Unit price', 'Amount'];
  const body = rfq.lines.map((l, i) => [String(i + 1), l.itemName, l.unit, qtyFmt(l.qty), '', '']);
  const startPage = currentPage(doc);
  autoTable(doc, {
    ...themedTable(head, body),
    startY: y, head: [head], body,
    margin: { top: PDF_LAYOUT.nextTop, left: mx, right: mx, bottom: PDF_LAYOUT.bottom },
    columnStyles: { 0: { cellWidth: 24, halign: 'center' }, 1: { cellWidth: 'auto', halign: 'left' }, 2: { halign: 'center' }, 4: { cellWidth: 80 }, 5: { cellWidth: 80 } },
    styles: { minCellHeight: 20 },
    didDrawPage: () => { if (currentPage(doc) !== startPage) header(false); },
  });
  y = ((doc as any).lastAutoTable?.finalY ?? y) + 16;

  if (y + 150 > doc.internal.pageSize.getHeight() - PDF_LAYOUT.bottom) { doc.addPage(); header(false); y = PDF_LAYOUT.nextTop; }

  // what the supplier must state
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...C.teal);
  doc.text('PLEASE STATE IN YOUR QUOTATION', mx, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...C.text);
  const asks = ['Unit price for every item above, and the currency', 'Delivery / freight charge (or “free delivery”)', 'Lead time (days from order)', 'Payment terms', 'Quotation number, date and how long the prices are valid', 'Your quotation as a signed PDF, quoting our RFQ number'];
  asks.forEach((a, i) => doc.text(`${i + 1}.  ${a}`, mx + 4, y + 14 + i * 12));
  y += 14 + asks.length * 12 + 8;

  if (rfq.notes) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...C.teal); doc.text('REMARKS', mx, y);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.text);
    const ls = doc.splitTextToSize(rfq.notes, pw - mx * 2) as string[];
    doc.text(ls, mx, y + 12); y += 14 + ls.length * 11;
  }
  y += 10;
  doc.setFontSize(7.5); doc.setTextColor(...C.faint);
  doc.text('This is a request for quotation only and is not a purchase order.', mx, y);
  if (rfq.createdByName) doc.text(`Prepared by ${rfq.createdByName}`, pw - mx, y, { align: 'right' });

  drawFooter(doc, `${COMPANY_NAME}  ·  ${dept}`);
  const safe = (supplierName || 'all').replace(/[^\w\-]+/g, '_').slice(0, 30);
  doc.save(`${rfq.rfqNo}_${safe}.pdf`);
}
