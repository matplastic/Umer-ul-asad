// ───────────────────────────────────────────────────────────
// MAT-ERP — Shared PDF theme
// One look for every PDF the ERP produces: MAT teal letterhead, clean
// striped tables, coloured status words, and a "Page X of Y" footer.
// Used by lib/exportUtils.ts and by the Store module's reports.
//
// All measurements are in points — create documents with
//   new jsPDF({ unit: 'pt', format: 'a4', orientation: ... })
// ───────────────────────────────────────────────────────────
import type jsPDF from 'jspdf';
import type { CellHookData, UserOptions } from 'jspdf-autotable';

export type RGB = [number, number, number];

export const COMPANY_NAME = 'MAT PLASTIC INDUSTRIES LLC';

export const PDF_COLORS = {
  teal: [15, 118, 110] as RGB,       // MAT teal — table headers, accents
  tealDark: [17, 94, 89] as RGB,
  tealSoft: [236, 246, 245] as RGB,  // light panel / badge background
  ink: [15, 23, 42] as RGB,          // titles
  text: [30, 41, 59] as RGB,         // body text
  muted: [100, 116, 139] as RGB,     // secondary text
  faint: [148, 163, 184] as RGB,     // footer text
  line: [226, 232, 240] as RGB,      // hairlines
  stripe: [247, 250, 251] as RGB,    // alternate rows
  good: [21, 128, 61] as RGB,
  bad: [185, 28, 28] as RGB,
  warn: [180, 83, 9] as RGB,
};

/** Page geometry shared by every report (points). */
export const PDF_LAYOUT = {
  marginX: 32,
  /** table start on the first page of a report (below the full letterhead) */
  firstTop: 118,
  /** table start on later pages (below the slim running header) */
  nextTop: 68,
  /** room kept free for the footer */
  bottom: 46,
};

// ── Logo ────────────────────────────────────────────────────
export interface PdfLogo { dataUrl: string; ratio: number }

let logoCache: Promise<PdfLogo | null> | null = null;
export function loadLogo(): Promise<PdfLogo | null> {
  if (!logoCache) {
    logoCache = (async () => {
      try {
        const res = await fetch('/logo.png');
        if (!res.ok) return null;
        const blob = await res.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        const ratio = await new Promise<number>((resolve) => {
          const img = new Image();
          img.onload = () => resolve((img.naturalWidth || 1) / (img.naturalHeight || 1));
          img.onerror = () => resolve(1);
          img.src = dataUrl;
        });
        return { dataUrl, ratio };
      } catch {
        return null;
      }
    })();
  }
  return logoCache;
}

// ── Status words get a colour ───────────────────────────────
const GOOD = new Set(['approved', 'ok', 'pass', 'passed', 'completed', 'complete', 'delivered', 'present', 'received', 'done', 'active', 'in stock', 'on time', 'released', 'resolved', 'closed', 'accepted', 'yes']);
const BAD = new Set(['rejected', 'reject', 'fail', 'failed', 'absent', 'delayed', 'overdue', 'cancelled', 'canceled', 'expired', 'critical', 'out of stock', 'declined', 'open ncr', 'no']);
const WARN = new Set(['pending', 'hold', 'on hold', 'in progress', 'partial', 'partially received', 'low', 'warning', 'pending inspection', 'awaiting', 'waiting', 'in transit', 'in production', 'rework']);

export function statusTone(raw: unknown): RGB | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().toLowerCase().replace(/_/g, ' ');
  if (!t || t.length > 24) return null;
  if (GOOD.has(t)) return PDF_COLORS.good;
  if (BAD.has(t)) return PDF_COLORS.bad;
  if (WARN.has(t)) return PDF_COLORS.warn;
  return null;
}

const NUMERIC = /^[-+]?\d{1,3}(,\d{3})*(\.\d+)?\s?(%|[a-zA-Z]{1,5})?$|^[-+]?\d+(\.\d+)?\s?(%|[a-zA-Z]{1,5})?$/;
const isNumericLike = (v: unknown) =>
  typeof v === 'number' || (typeof v === 'string' && NUMERIC.test(v.trim()));

// ── Letterhead ──────────────────────────────────────────────
function fmtNow() {
  return new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export interface LetterheadOptions {
  logo: PdfLogo | null;
  /** department line under the company name, e.g. "Store Department — ERP System" */
  dept: string;
  title: string;
  subtitle?: string;
  /** small pill at the right of the title, e.g. "128 records" or "DELIVERED" */
  badge?: string;
  badgeTone?: RGB;
  /** true = full letterhead (first page of a report), false = slim running header */
  firstPage: boolean;
}

/**
 * Draws the page header at the top of the *current* page and returns the Y
 * where content should start. Call it from autoTable's `didDrawPage`.
 */
export function drawLetterhead(doc: jsPDF, o: LetterheadOptions): number {
  const pw = doc.internal.pageSize.getWidth();
  const mx = PDF_LAYOUT.marginX;
  const C = PDF_COLORS;

  // top colour bar
  doc.setFillColor(...C.teal);
  doc.rect(0, 0, pw, o.firstPage ? 6 : 4, 'F');

  if (!o.firstPage) {
    // slim running header: small logo + company on the left, report title on the right
    let x = mx;
    if (o.logo) {
      const h = 20, w = h * o.logo.ratio;
      try { doc.addImage(o.logo.dataUrl, 'PNG', x, 14, w, h); } catch { /* unreadable logo: skip */ }
      x += w + 8;
    }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...C.ink);
    doc.text(COMPANY_NAME, x, 28);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...C.muted);
    const t = doc.splitTextToSize(o.title, pw / 2 - mx)[0] as string;
    doc.text(t, pw - mx, 28, { align: 'right' });
    doc.setDrawColor(...C.line); doc.setLineWidth(0.8);
    doc.line(mx, 44, pw - mx, 44);
    return PDF_LAYOUT.nextTop;
  }

  // logo + company block
  let textX = mx;
  if (o.logo) {
    const h = 38, w = h * o.logo.ratio;
    try { doc.addImage(o.logo.dataUrl, 'PNG', mx, 18, w, h); } catch { /* unreadable logo: skip */ }
    textX = mx + w + 12;
  }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14.5); doc.setTextColor(...C.ink);
  doc.text(COMPANY_NAME, textX, 36);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...C.muted);
  doc.text(o.dept, textX, 49);

  // generated stamp, right
  doc.setFontSize(7); doc.setTextColor(...C.faint);
  doc.text('GENERATED', pw - mx, 27, { align: 'right' });
  doc.setFontSize(8.5); doc.setTextColor(...C.text);
  doc.text(fmtNow(), pw - mx, 39, { align: 'right' });

  // divider with a short teal accent
  doc.setDrawColor(...C.line); doc.setLineWidth(0.8);
  doc.line(mx, 66, pw - mx, 66);
  doc.setDrawColor(...C.teal); doc.setLineWidth(2.2);
  doc.line(mx, 66, mx + 64, 66);

  // title block (+ badge on the right)
  let badgeW = 0;
  if (o.badge) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
    badgeW = doc.getTextWidth(o.badge) + 18;
    const tone = o.badgeTone || C.teal;
    doc.setFillColor(...C.tealSoft); doc.setDrawColor(...tone); doc.setLineWidth(0.7);
    doc.roundedRect(pw - mx - badgeW, 76, badgeW, 20, 10, 10, 'FD');
    doc.setTextColor(...tone);
    doc.text(o.badge, pw - mx - badgeW / 2, 89, { align: 'center' });
  }
  const maxW = pw - mx * 2 - badgeW - (badgeW ? 12 : 0);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.setTextColor(...C.ink);
  const title = doc.splitTextToSize(o.title, maxW)[0] as string;
  doc.text(title, mx, 91);
  if (o.subtitle) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...C.muted);
    const sub = doc.splitTextToSize(o.subtitle, pw - mx * 2)[0] as string;
    doc.text(sub, mx, 106);
  }
  return PDF_LAYOUT.firstTop;
}

/** Hairline + company + "Page X of Y" on every page — call once, after all content is drawn. */
export function drawFooter(doc: jsPDF, label: string) {
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const mx = PDF_LAYOUT.marginX;
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setDrawColor(...PDF_COLORS.line); doc.setLineWidth(0.6);
    doc.line(mx, ph - 34, pw - mx, ph - 34);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...PDF_COLORS.faint);
    doc.text(label, mx, ph - 21);
    // centre note only when the label leaves room for it (narrow portrait pages)
    const note = 'Confidential — internal use only';
    if (mx + doc.getTextWidth(label) + 16 < pw / 2 - doc.getTextWidth(note) / 2) {
      doc.text(note, pw / 2, ph - 21, { align: 'center' });
    }
    doc.setFont('helvetica', 'bold'); doc.setTextColor(...PDF_COLORS.muted);
    doc.text(`Page ${i} of ${n}`, pw - mx, ph - 21, { align: 'right' });
  }
}

// ── Table style ─────────────────────────────────────────────
/**
 * Spread into an autoTable call:
 *   autoTable(doc, { ...themedTable(head, body), startY, head: [head], body, didDrawPage })
 * Gives MAT-teal header, striped rows, hairline row rules, right-aligned number
 * columns and coloured status words (Approved / Rejected / Pending …).
 */
export function themedTable(head: string[], body: (string | number | null | undefined)[][]): Partial<UserOptions> {
  const C = PDF_COLORS;
  // a column is numeric when every non-empty value in it looks like a number (first column is never right-aligned)
  const numericCols = new Set<number>();
  head.forEach((_, c) => {
    if (c === 0) return;
    const vals = body.map(r => r[c]).filter(v => v !== '' && v !== null && v !== undefined && v !== '—' && v !== '-');
    if (vals.length > 0 && vals.every(isNumericLike)) numericCols.add(c);
  });

  return {
    theme: 'plain',
    styles: {
      font: 'helvetica',
      fontSize: 8,
      cellPadding: { top: 5, bottom: 5, left: 6, right: 6 },
      textColor: C.text,
      lineColor: C.line,
      lineWidth: { top: 0, right: 0, bottom: 0.5, left: 0 } as any,
      valign: 'middle',
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: C.teal,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
      cellPadding: { top: 7, bottom: 7, left: 6, right: 6 },
      lineWidth: 0,
    },
    alternateRowStyles: { fillColor: C.stripe },
    margin: { top: PDF_LAYOUT.nextTop, left: PDF_LAYOUT.marginX, right: PDF_LAYOUT.marginX, bottom: PDF_LAYOUT.bottom },
    rowPageBreak: 'avoid',
    didParseCell: (d: CellHookData) => {
      if (numericCols.has(d.column.index) && d.cell.styles.halign === 'left') d.cell.styles.halign = 'right';
      if (d.section === 'body') {
        const tone = statusTone(d.cell.raw);
        if (tone) { d.cell.styles.textColor = tone; d.cell.styles.fontStyle = 'bold'; }
      }
    },
  };
}

/** The current (1-based) page number of the document. */
export const currentPage = (doc: jsPDF): number => doc.getCurrentPageInfo().pageNumber;
