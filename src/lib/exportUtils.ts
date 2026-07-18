// ─────────────────────────────────────────────────────────────────────────────
// MAT-ERP — Universal Export Utilities
// Reusable Excel + PDF export functions used across every dashboard.
// Built on xlsx, jspdf, jspdf-autotable (all already installed).
// ─────────────────────────────────────────────────────────────────────────────
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// ─────────────────────────────────────────────────────────────────────────────
// Shared PDF letterhead — logo + company name + orange accent bar, repeated
// identically on every page of every report this file exports, so a
// multi-page report (e.g. 182 absentees) never loses its header/footer or
// bleeds into the next page's content. Coordinates are in points (jsPDF's
// 'pt' unit), matching the a4/pt documents built below.
// ─────────────────────────────────────────────────────────────────────────────
const COMPANY_NAME = 'MAT PLASTIC INDUSTRIES LLC';
const BRAND_ORANGE: [number, number, number] = [234, 88, 12];

let logoCache: Promise<{ dataUrl: string; ratio: number } | null> | null = null;
function loadLogo(): Promise<{ dataUrl: string; ratio: number } | null> {
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

/**
 * Draws logo + company name + report title/subtitle at the top of whichever
 * page the doc is currently on. Meant to be called from autoTable's
 * `didDrawPage` so it repeats on every page of a multi-page report — this is
 * what actually fixes overlap: the header is only ever drawn in the fixed
 * band above `margin.top`, autoTable never lets table rows draw above that
 * band, and each new page gets its own fresh copy instead of the first
 * page's header bleeding into page 2's row content.
 */
function drawPdfHeader(doc: jsPDF, logo: { dataUrl: string; ratio: number } | null, deptLine: string, title: string, subtitle?: string): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const logoH = 34;
  const logoW = logo ? logoH * logo.ratio : 0;
  if (logo) {
    try { doc.addImage(logo.dataUrl, 'PNG', 32, 12, logoW, logoH); } catch { /* unreadable logo — skip, rest of header still renders */ }
  }
  const textX = logo ? 32 + logoW + 10 : 32;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(20, 20, 20);
  doc.text(COMPANY_NAME, textX, 26);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text(deptLine, textX, 37);
  doc.setFontSize(7.5);
  doc.text(`Generated: ${new Date().toLocaleString('en-GB')}`, pageWidth - 32, 18, { align: 'right' });

  doc.setDrawColor(...BRAND_ORANGE);
  doc.setLineWidth(1.1);
  doc.line(32, 50, pageWidth - 32, 50);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12.5);
  doc.setTextColor(20, 20, 20);
  doc.text(title, 32, 64);
  let y = 74;
  if (subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(subtitle, 32, y);
    y += 10;
  }
  return y + 12; // table startY
}

/** Thin rule + "Page X of Y" footer stamped on every page already in the doc. */
function drawPdfFooter(doc: jsPDF, footerLabel: string) {
  const pageCount = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.5);
    doc.line(32, pageHeight - 28, pageWidth - 32, pageHeight - 28);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text(footerLabel, 32, pageHeight - 16);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - 32, pageHeight - 16, { align: 'right' });
  }
}

/**
 * Export any array of records to an .xlsx file the user can download.
 * - rows: array of plain JS objects (column = key, value = cell)
 * - filename: file name without extension; date stamp auto-appended
 * - sheetName: worksheet tab name (max 31 chars)
 */
export function exportToExcel(
  rows: Record<string, any>[],
  filename: string,
  sheetName: string = 'Sheet1'
) {
  if (!rows || rows.length === 0) {
    alert('Nothing to export — table is empty.');
    return;
  }
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));

  // Auto-size columns based on longest cell
  const cols = Object.keys(rows[0]).map((key) => ({
    wch: Math.max(
      key.length,
      ...rows.map((r) => (r[key] == null ? 0 : String(r[key]).length))
    ) + 2,
  }));
  (ws as any)['!cols'] = cols;

  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `${filename}_${stamp}.xlsx`);
}

/**
 * Generic table-style PDF — branded letterhead, auto-paged, color-banded.
 * Same call signature as before (title/subtitle/columns/rows/filename/
 * orientation) — no changes needed at any call site.
 */
export async function exportTablePdf(opts: {
  title: string;
  subtitle?: string;
  columns: { header: string; dataKey: string }[];
  rows: Record<string, any>[];
  filename: string;
  orientation?: 'portrait' | 'landscape';
  /** Shown under the company name in the header, e.g. "HR Department — ERP System". Defaults to a generic ERP line. */
  deptLine?: string;
}) {
  const logo = await loadLogo();
  const doc = new jsPDF({
    orientation: opts.orientation || 'landscape',
    unit: 'pt',
    format: 'a4',
  });
  const deptLine = opts.deptLine || 'Store & Production ERP';

  autoTable(doc, {
    startY: 96,
    head: [opts.columns.map((c) => c.header)],
    body: opts.rows.map((r) => opts.columns.map((c) => r[c.dataKey] ?? '')),
    styles: { fontSize: 8, cellPadding: 4, textColor: [30, 41, 59] },
    headStyles: {
      fillColor: BRAND_ORANGE,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    // page-break rules keep a row from being sliced in half at a page
    // boundary, and the top margin leaves the exact space the header needs
    // — so the header never overlaps row content, on page 1 or any page after.
    margin: { top: 96, left: 32, right: 32, bottom: 44 },
    rowPageBreak: 'avoid',
    didDrawPage: () => { drawPdfHeader(doc, logo, deptLine, opts.title, opts.subtitle); },
  });

  const finalY = (doc as any).lastAutoTable?.finalY || 96;
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text(`${opts.rows.length} record${opts.rows.length === 1 ? '' : 's'}`, 32, finalY + 14);

  drawPdfFooter(doc, `${COMPANY_NAME} — ERP System`);

  const stamp = new Date().toISOString().slice(0, 10);
  doc.save(`${opts.filename}_${stamp}.pdf`);
}

/**
 * Daily Defect Report PDF — matches the printed shop-floor "Quality Control
 * Report" sheet layout, but split into two pages:
 *   Page 1 — DEFECTS ONLY: one row per defect type, how many pools had it,
 *            and which pool numbers.
 *   Page 2 — PRODUCTION: shift I/II/III/Total quantities plus the full pool
 *            number list (clean + defective) for the day.
 */
export async function exportDailyDefectReportPdf(report: {
  workshopName: string;
  date: string;
  projectName: string;
  controller: string;
  shiftQuantities: { I: number; II: number; III: number };
  pools: { poolNo: string; defects: string[] }[];
  remarks?: string;
}) {
  const logo = await loadLogo();
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const subtitle = `${report.projectName}  •  Date: ${report.date}  •  Controller: ${report.controller}`;

  // ── PAGE 1 — DEFECTS ────────────────────────────────────────────────────
  const defectCounts: Record<string, string[]> = {};
  report.pools.forEach(p => p.defects.forEach(d => {
    if (!defectCounts[d]) defectCounts[d] = [];
    defectCounts[d].push(p.poolNo);
  }));
  const defectRows = Object.entries(defectCounts)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([defect, poolNos]) => [defect, String(poolNos.length), poolNos.join(', ')]);

  autoTable(doc, {
    startY: 96,
    head: [['Defect', 'Qty of Pools', 'Pool Number(s)']],
    body: defectRows.length > 0 ? defectRows : [['— No defects recorded — clean run —', '', '']],
    styles: { fontSize: 8.5, cellPadding: 5, textColor: [30, 41, 59] },
    headStyles: { fillColor: BRAND_ORANGE, textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 0: { cellWidth: 160 }, 1: { cellWidth: 70, halign: 'center' }, 2: { cellWidth: 'auto' } },
    margin: { top: 96, left: 32, right: 32, bottom: 44 },
    rowPageBreak: 'avoid',
    didDrawPage: () => { drawPdfHeader(doc, logo, report.workshopName, 'Quality Control Report — Defects', subtitle); },
  });

  const p1FinalY = (doc as any).lastAutoTable?.finalY || 96;
  if (report.remarks) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    doc.text(`Remarks: ${report.remarks}`, 32, p1FinalY + 16, { maxWidth: doc.internal.pageSize.getWidth() - 64 });
  }
  drawPdfFooter(doc, `${COMPANY_NAME} — ${report.workshopName} — Defect Page`);

  // ── PAGE 2 — PRODUCTION ────────────────────────────────────────────────
  doc.addPage();
  autoTable(doc, {
    startY: 96,
    head: [['Shift', 'Quantity of Pools']],
    body: [
      ['I', String(report.shiftQuantities.I)],
      ['II', String(report.shiftQuantities.II)],
      ['III', String(report.shiftQuantities.III)],
      ['Total', String(report.shiftQuantities.I + report.shiftQuantities.II + report.shiftQuantities.III)],
    ],
    styles: { fontSize: 9, cellPadding: 5, textColor: [30, 41, 59] },
    headStyles: { fillColor: BRAND_ORANGE, textColor: [255, 255, 255], fontStyle: 'bold' },
    bodyStyles: { fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 100 }, 1: { cellWidth: 140 } },
    margin: { top: 96, left: 32, right: 32, bottom: 44 },
    didDrawPage: () => { drawPdfHeader(doc, logo, report.workshopName, 'Quality Control Report — Production', subtitle); },
  });

  const shiftTableY = (doc as any).lastAutoTable?.finalY || 96;
  const poolRows = report.pools.map(p => [p.poolNo, p.defects.length === 0 ? 'OK' : `${p.defects.length} defect${p.defects.length > 1 ? 's' : ''}`]);
  autoTable(doc, {
    startY: shiftTableY + 20,
    head: [['Pool Number', 'Status']],
    body: poolRows.length > 0 ? poolRows : [['— No pools recorded —', '']],
    styles: { fontSize: 8.5, cellPadding: 4, textColor: [30, 41, 59] },
    headStyles: { fillColor: [51, 65, 85], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 0: { cellWidth: 200 }, 1: { cellWidth: 140 } },
    margin: { top: 96, left: 32, right: 32, bottom: 44 },
    rowPageBreak: 'avoid',
    didDrawPage: () => { drawPdfHeader(doc, logo, report.workshopName, 'Quality Control Report — Production', subtitle); },
  });

  drawPdfFooter(doc, `${COMPANY_NAME} — ${report.workshopName} — Production Page`);

  const stamp = report.date || new Date().toISOString().slice(0, 10);
  doc.save(`${report.workshopName.replace(/\s+/g, '_')}_${report.projectName.replace(/\s+/g, '_')}_${stamp}.pdf`);
}

/**
 * Pool lifecycle PDF — full history for a single pool, ready for filing.
 */
export function exportPoolHistoryPdf(pool: any, stages: { id: string; name: string }[]) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const w = doc.internal.pageSize.getWidth();

  // Header band
  doc.setFillColor(79, 70, 229);
  doc.rect(0, 0, w, 60, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(`Pool ${pool.poolNo}`, 32, 30);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`${pool.projectName} • ${pool.orientation} • ${pool.shape}`, 32, 48);

  // Meta block
  doc.setTextColor(30, 41, 59);
  doc.setFontSize(9);
  let y = 82;
  const metaRows = [
    ['Pool ID', pool.id],
    ['Project', pool.projectName],
    ['Pool No.', pool.poolNo],
    ['Orientation', pool.orientation],
    ['Dimensions', pool.dimensions || '—'],
    ['Shape', pool.shape || '—'],
    ['Notes', pool.notes || '—'],
    ['Created', pool.createdAt ? new Date(pool.createdAt).toLocaleString('en-GB') : '—'],
    ['Status', pool.isDelivered ? 'DELIVERED' : pool.completedAt ? 'COMPLETED' : 'IN PRODUCTION'],
  ];
  metaRows.forEach(([k, v]) => {
    doc.setFont('helvetica', 'bold');
    doc.text(String(k) + ':', 32, y);
    doc.setFont('helvetica', 'normal');
    doc.text(String(v), 130, y);
    y += 14;
  });

  // Stage history table
  const historyRows = stages.map((s) => {
    const h = pool.stageHistory?.[s.id] || {};
    return {
      stage: s.name,
      status: h.status || 'NOT_STARTED',
      team: h.teamId || '—',
      start: h.startTime ? new Date(h.startTime).toLocaleString('en-GB') : '—',
      end: h.endTime ? new Date(h.endTime).toLocaleString('en-GB') : '—',
      duration: h.durationMinutes ? `${h.durationMinutes} min` : '—',
      inspector: h.inspectorId || '—',
      rejections: h.rejectionCount ?? 0,
    };
  });

  autoTable(doc, {
    startY: y + 8,
    head: [['Stage', 'Status', 'Team', 'Start', 'End', 'Duration', 'Inspector', 'Rej.']],
    body: historyRows.map((r) => [
      r.stage,
      r.status,
      r.team,
      r.start,
      r.end,
      r.duration,
      r.inspector,
      r.rejections,
    ]),
    styles: { fontSize: 7, cellPadding: 3 },
    headStyles: { fillColor: [79, 70, 229], textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 24, right: 24 },
  });

  // Footer
  doc.setFontSize(7);
  doc.setTextColor(148, 163, 184);
  doc.text(
    `Generated ${new Date().toLocaleString('en-GB')}  •  MAT-ERP`,
    w / 2,
    doc.internal.pageSize.getHeight() - 16,
    { align: 'center' }
  );

  doc.save(`Pool_${pool.poolNo}_history_${new Date().toISOString().slice(0, 10)}.pdf`);
}
