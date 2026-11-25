// ───────────────────────────────────────────────────────────
// MAT-ERP — Payslip PDF (one page per employee; many employees → one PDF).
// Same overtime rules as the Payroll tab: normal OT = basic ÷ 30 ÷ 8 × 1.22, Sunday OT × 1.50.
// ───────────────────────────────────────────────────────────
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { PDF_COLORS, loadLogo } from './pdfTheme';
import { amountInWords } from './wps';
import { fmtD } from './hrStore';

export interface PayslipData {
  companyName: string;
  companyAddress?: string;
  month: string;                 // YYYY-MM
  employee: { id: string; name: string; department?: string; designation?: string; joiningDate?: string; paymentMode?: string; bankName?: string; iban?: string };
  base: number; allowances: number;
  normalOtHours: number; sundayOtHours: number;
  deductions: number;
  net: number;
  status?: string; paidAt?: string;
  unpaidLeaveDays?: number;
}

const NORMAL = 1.22, SUNDAY = 1.5;
const aed = (n: number) => (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthLabel = (m: string) => new Date(m + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

export function payslipLines(d: PayslipData) {
  const hourly = d.base / 30 / 8;
  const normalPay = Math.round(d.normalOtHours * hourly * NORMAL * 100) / 100;
  const sundayPay = Math.round(d.sundayOtHours * hourly * SUNDAY * 100) / 100;
  const computed = Math.round((d.base + d.allowances + normalPay + sundayPay - d.deductions) * 100) / 100;
  const adjustment = Math.round((d.net - computed) * 100) / 100;   // only non-zero for old/edited records
  const earnings = d.base + d.allowances + normalPay + sundayPay + (adjustment > 0 ? adjustment : 0);
  const deductions = d.deductions + (adjustment < 0 ? -adjustment : 0);
  return { hourly, normalPay, sundayPay, adjustment, earnings, deductions };
}

function drawPage(doc: jsPDF, d: PayslipData, logo: Awaited<ReturnType<typeof loadLogo>>) {
  const C = PDF_COLORS;
  const pw = doc.internal.pageSize.getWidth(), ph = doc.internal.pageSize.getHeight(), mx = 48;
  const L = payslipLines(d);

  // header
  doc.setFillColor(...C.teal); doc.rect(0, 0, pw, 6, 'F');
  let tx = mx;
  if (logo) { const h = 40, w = h * logo.ratio; try { doc.addImage(logo.dataUrl, 'PNG', mx, 20, w, h); } catch { /* skip */ } tx = mx + w + 12; }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(...C.ink); doc.text(d.companyName.toUpperCase(), tx, 38);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...C.muted); if (d.companyAddress) doc.text(d.companyAddress, tx, 52);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(...C.teal); doc.text('PAYSLIP', pw - mx, 38, { align: 'right' });
  doc.setFontSize(10); doc.setTextColor(...C.text); doc.text(monthLabel(d.month), pw - mx, 54, { align: 'right' });
  doc.setDrawColor(...C.line); doc.line(mx, 76, pw - mx, 76);

  // employee box
  const e = d.employee;
  const left: [string, string][] = [['Employee', e.name], ['Badge No', e.id], ['Department', e.department || '—'], ['Designation', e.designation || '—']];
  const right: [string, string][] = [['Joining date', e.joiningDate ? fmtD(e.joiningDate) : '—'], ['Salary paid by', e.paymentMode === 'Cash' ? 'Cash' : (e.bankName ? `Bank transfer · ${e.bankName}` : 'Bank transfer')],
    ['Account', e.paymentMode === 'Cash' || !e.iban ? '—' : `•••• ${e.iban.slice(-4)}`], ['Unpaid leave', `${d.unpaidLeaveDays || 0} day(s)`]];
  doc.setFillColor(...C.tealSoft); doc.roundedRect(mx, 88, pw - mx * 2, 84, 6, 6, 'F');
  const col = (rows: [string, string][], x: number) => rows.forEach(([k, v], i) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...C.muted); doc.text(k, x, 108 + i * 18);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...C.ink); doc.text(String(v), x + 78, 108 + i * 18);
  });
  col(left, mx + 12); col(right, pw / 2 + 4);

  // earnings
  const earn: (string | number)[][] = [['Basic salary', '', aed(d.base)], ['Allowances', '', aed(d.allowances)]];
  if (d.normalOtHours) earn.push([`Overtime (normal ×${NORMAL})`, `${d.normalOtHours} h × ${aed(L.hourly * NORMAL)}`, aed(L.normalPay)]);
  if (d.sundayOtHours) earn.push([`Overtime (Sunday ×${SUNDAY})`, `${d.sundayOtHours} h × ${aed(L.hourly * SUNDAY)}`, aed(L.sundayPay)]);
  if (L.adjustment > 0) earn.push(['Adjustment', '', aed(L.adjustment)]);
  earn.push(['TOTAL EARNINGS', '', aed(L.earnings)]);
  const ded: (string | number)[][] = [['Deductions (loan / advance / fines / other)', '', aed(d.deductions)]];
  if (L.adjustment < 0) ded.push(['Adjustment', '', aed(-L.adjustment)]);
  ded.push(['TOTAL DEDUCTIONS', '', aed(L.deductions)]);

  const tbl = (head: string, body: (string | number)[][], y: number) => {
    autoTable(doc, {
      startY: y, margin: { left: mx, right: mx }, head: [[head, 'Details', 'Amount (AED)']], body: body as any, theme: 'plain',
      styles: { fontSize: 9.5, cellPadding: { top: 5, bottom: 5, left: 8, right: 8 }, textColor: C.text },
      headStyles: { fillColor: C.teal, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9 },
      columnStyles: { 0: { cellWidth: 230 }, 1: { textColor: C.muted, fontSize: 8.5 }, 2: { halign: 'right', cellWidth: 100 } },
      didParseCell: (h) => { if (h.section === 'body' && h.row.index === body.length - 1) { h.cell.styles.fontStyle = 'bold'; h.cell.styles.fillColor = C.stripe as any; } if (h.section === 'head' && h.column.index === 2) h.cell.styles.halign = 'right'; },
      didDrawCell: (h) => { if (h.section === 'body') { doc.setDrawColor(...C.line); doc.line(h.cell.x, h.cell.y + h.cell.height, h.cell.x + h.cell.width, h.cell.y + h.cell.height); } },
    });
    return (doc as any).lastAutoTable.finalY as number;
  };
  let y = tbl('Earnings', earn, 190) + 14;
  y = tbl('Deductions', ded, y) + 18;

  // net box
  doc.setFillColor(...C.teal); doc.roundedRect(mx, y, pw - mx * 2, 52, 6, 6, 'F');
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.text('NET SALARY PAYABLE', mx + 16, y + 21);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.text(`AED ${aed(d.net)}`, pw - mx - 16, y + 33, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.text(amountInWords(d.net), mx + 16, y + 42, { maxWidth: pw - mx * 2 - 190 });
  y += 70;
  doc.setTextColor(...C.muted); doc.setFontSize(8.5);
  doc.text(`Status: ${d.status === 'Paid' ? `Paid${d.paidAt ? ` on ${fmtD(d.paidAt)}` : ''}` : 'Processing'}`, mx, y);

  // footer
  doc.setDrawColor(...C.line); doc.line(mx, ph - 56, pw - mx, ph - 56);
  doc.setFontSize(8); doc.setTextColor(...C.faint);
  doc.text('This is a computer-generated payslip and does not require a signature.', mx, ph - 42);
  doc.text('Confidential — for the named employee only.', pw - mx, ph - 42, { align: 'right' });
}

export function buildPayslipDoc(list: PayslipData[], logo: Awaited<ReturnType<typeof loadLogo>>): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
  list.forEach((d, i) => { if (i > 0) doc.addPage(); drawPage(doc, d, logo); });
  return doc;
}

export async function exportPayslipsPdf(list: PayslipData[], fileName: string) {
  if (!list.length) return;
  const doc = buildPayslipDoc(list, await loadLogo());
  doc.save(fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`);
}
