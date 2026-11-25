// Excel export of the STF – PO – PAYMENT register, in the SAME layout as the company's sheet
// (orange header, one block per STF: header row, CODE/DESCRIPTION… row, items, TOTAL / VAT / G. TOTAL,
// drop-down lists on the status columns, formulas for the totals) so it can still be used the old way.
import type { ProcurementSettings } from '../types';
import type { RegisterRow } from './procurementRegister';
import { QUEUE_FINISHED } from './stf';

const HEAD = ['No', 'Date', 'STF Number', 'STF Description', 'PO Number', 'Company', 'Project Type', 'Project Name', 'STF Status', 'Last Status\nDate',
  'Budget', 'Que', 'Payment \nTerms', 'Delivery \nStatus', 'Delivery Date', 'Delivery Note\nInvoice', 'Delivery Note / Invoice No', 'Delivery Details',
  'Payment\nStatus', 'Payment\nDate', 'Paid Amount', 'Payment\nDetails'];
const WIDTHS = [4.8, 10.2, 16, 52, 21.9, 40, 11, 16, 13.8, 11, 11, 20, 24, 16, 11.9, 16, 16.4, 40, 13, 11, 15.4, 31];
const SUBHEAD = ['CODE', 'DESCRIPTION', 'QTY', 'UNIT', 'UNIT PRICE', 'TOTAL', 'Received', 'Balance'];

export async function buildRegisterWorkbook(rows: RegisterRow[], settings: ProcurementSettings): Promise<any> {
  const ExcelJS: any = (await import('exceljs')).default || (await import('exceljs'));
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MAT Plastic Industries — ERP';
  const ws = wb.addWorksheet('STF-PO-PAYMENT', { views: [{ state: 'frozen', ySplit: 1 }] });
  WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  const thin = { style: 'thin', color: { argb: 'FF808080' } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const base = { font: { name: 'Calibri', size: 8 }, border, alignment: { vertical: 'middle', wrapText: true } };
  const style = (cell: any, extra: any = {}) => { Object.assign(cell, { ...base, ...extra }); cell.font = { ...base.font, ...(extra.font || {}) }; cell.alignment = { ...base.alignment, ...(extra.alignment || {}) }; };
  const money = '#,##0.00';
  const dateOf = (iso?: string | null) => (iso ? new Date(iso.slice(0, 10) + 'T00:00:00') : null);

  // header
  const h = ws.getRow(1);
  HEAD.forEach((t, i) => {
    const c = h.getCell(i + 1);
    c.value = t;
    style(c, { font: { bold: true }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC000' } }, alignment: { horizontal: 'center', wrapText: true } });
  });
  h.height = 30;
  ws.autoFilter = { from: 'A1', to: 'V1' };

  const approvers = settings.approvers.map(a => a.name);
  const validations: [string, string[]][] = [
    ['I', ['PENDING', 'APPROVED', 'BOARD', 'CANCELED', 'REJECTED']],
    ['K', [`${settings.tierEur} EUR +`, `${settings.tierEur} EUR -`]],
    ['L', [...approvers, 'BOARD', QUEUE_FINISHED]],
    ['N', ['WAITING', 'PARTIAL RECEIVED', 'RECEIVED']],
    ['P', ['WAITING', 'DELIVERY NOTE', 'INVOICE']],
    ['S', ['WAITING', 'READY', 'PAID', 'PARTIAL PAID']],
  ];

  let r = 2;
  const firstDataRow = r;
  for (const row of rows) {
    const cancelled = row.stfStatus === 'CANCELLED' || row.stfStatus === 'REJECTED';
    // ── the STF / PO / delivery / payment line
    const hr = ws.getRow(r);
    const put = (col: number, v: any, extra: any = {}) => { const c = hr.getCell(col); c.value = v; style(c, extra); };
    put(1, row.no, { alignment: { horizontal: 'center' } });
    put(2, dateOf(row.date), { numFmt: 'dd/mm/yyyy', alignment: { horizontal: 'center' } });
    put(3, row.stfNo);
    put(4, row.description);
    if (cancelled) {
      for (let c = 5; c <= 22; c++) put(c, 'CANCELLED', { alignment: { horizontal: 'center' } });
      put(9, row.stfStatus === 'REJECTED' ? 'REJECTED' : 'CANCELED', { alignment: { horizontal: 'center' } });
      ws.getRow(r).eachCell((c: any, n: number) => { if (n >= 5) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } }; });
      r += 1;
      continue;
    }
    put(5, row.poNo);
    put(6, row.supplier);
    put(7, row.projectType, { alignment: { horizontal: 'center' } });
    put(8, row.projectName);
    put(9, row.stfStatus === 'CANCELLED' ? 'CANCELED' : row.stfStatus, { alignment: { horizontal: 'center' } });
    put(10, dateOf(row.lastStatusDate), { numFmt: 'dd/mm/yyyy', alignment: { horizontal: 'center' } });
    put(11, row.budget, { alignment: { horizontal: 'center' } });
    put(12, row.queue, { alignment: { horizontal: 'center' } });
    put(13, row.paymentTerms);
    put(14, row.delivery?.status || 'WAITING', { alignment: { horizontal: 'center' } });
    put(15, dateOf(row.delivery?.lastDate), { numFmt: 'dd/mm/yyyy', alignment: { horizontal: 'center' } });
    put(16, row.delivery?.docType || 'WAITING', { alignment: { horizontal: 'center' } });
    put(17, row.delivery?.docNos || '');
    put(18, row.delivery?.details || '');
    put(19, row.payStatus || 'WAITING', { alignment: { horizontal: 'center' } });
    put(20, dateOf(row.payDate), { numFmt: 'dd/mm/yyyy', alignment: { horizontal: 'center' } });
    put(21, row.paidAmount || null, { numFmt: money });
    put(22, row.paymentDetails);
    r += 1;

    // ── items block
    const sh = ws.getRow(r);
    SUBHEAD.forEach((t, i) => { const c = sh.getCell(5 + i); c.value = t; style(c, { font: { bold: true }, alignment: { horizontal: 'center' } }); });
    r += 1;
    const first = r;
    for (const it of row.items) {
      const ir = ws.getRow(r);
      const cell = (col: number, v: any, extra: any = {}) => { const c = ir.getCell(col); c.value = v; style(c, extra); };
      cell(5, it.code); cell(6, it.description); cell(7, it.qty, { alignment: { horizontal: 'center' } }); cell(8, it.unit, { alignment: { horizontal: 'center' } });
      cell(9, it.unitPrice, { numFmt: money });
      cell(10, { formula: `G${r}*I${r}`, result: it.total }, { numFmt: money });
      cell(11, it.received, { alignment: { horizontal: 'center' } });
      cell(12, { formula: `G${r}-K${r}`, result: it.balance }, { alignment: { horizontal: 'center' } });
      r += 1;
    }
    const last = r - 1;
    const cur = row.currency && row.currency !== 'AED' ? ` (${row.currency})` : '';
    const tot = (label: string, f: string, res: number, bold = false) => {
      const tr = ws.getRow(r);
      const a = tr.getCell(9); a.value = label; style(a, { font: { bold: true }, alignment: { horizontal: 'right' } });
      const b = tr.getCell(10); b.value = { formula: f, result: res }; style(b, { numFmt: money, font: { bold } });
      r += 1;
    };
    const totalRow = r;
    tot('TOTAL', `SUM(J${first}:J${last})`, row.subtotal);
    tot(`VAT ${row.vatText}`, String(row.vat), row.vat);   // VAT is per item, so the figure is the sum of each line's VAT
    tot(`G. TOTAL${cur}`, `SUM(J${totalRow}:J${totalRow + 1})`, row.total, true);
  }

  // drop-down lists (same lists the sheet used), applied to the whole used range
  const lastRow = Math.max(r + 200, 400);
  for (const [col, list] of validations) {
    const formula = `"${list.join(',')}"`;
    if (formula.length > 250) {
      // Excel limits an inline list to 255 characters — long lists go to a hidden helper sheet
      const hs = wb.getWorksheet('Lists') || wb.addWorksheet('Lists', { state: 'hidden' });
      const colNo = validations.findIndex(v => v[0] === col) + 1;
      list.forEach((v, i) => { hs.getCell(i + 1, colNo).value = v; });
      const letter = String.fromCharCode(64 + colNo);
      for (let i = firstDataRow; i <= lastRow; i++) ws.getCell(`${col}${i}`).dataValidation = { type: 'list', allowBlank: true, formulae: [`Lists!$${letter}$1:$${letter}$${list.length}`] };
    } else {
      for (let i = firstDataRow; i <= lastRow; i++) ws.getCell(`${col}${i}`).dataValidation = { type: 'list', allowBlank: true, formulae: [formula] };
    }
  }
  return wb;
}

export async function exportRegisterExcel(rows: RegisterRow[], settings: ProcurementSettings) {
  const wb = await buildRegisterWorkbook(rows, settings);
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `STF-PO-PAYMENT_${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}
