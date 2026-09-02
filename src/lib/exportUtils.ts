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
  totalProduction: number;
  /** Every defect type in the workshop's catalogue, including zero-qty ones,
   *  each with the full list of pool occurrences (poolNo/project/orientation/type). */
  catalogRows: {
    defect: string;
    qty: number;
    occurrences: { poolNo: string; projectName: string; orientation: string; poolType: string }[];
  }[];
  pools: { poolNo: string; projectName: string; orientation: string; poolType: string; defects: string[] }[];
  remarks?: string;
}) {
  const logo = await loadLogo();
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const subtitle = `${report.projectName}  •  Date: ${report.date}  •  Controller: ${report.controller}`;

  // ── PAGE 1 — DEFECTS (every catalogue defect, zero-qty included) ───────
  // Each occurrence is its own line inside the "Pool Details" cell, formatted
  // "PoolNo — ProjectName — Orientation — Type" so a defect with several
  // affected pools reads as a clean stacked list, matching how the paper
  // form's "Description (Pool number)" column is filled in by hand.
  const defectRows = report.catalogRows.map(({ defect, qty, occurrences }) => {
    const detailLines = occurrences
      .map(o => [o.poolNo, o.projectName, o.orientation, o.poolType].filter(Boolean).join(' — '))
      .join('\n');
    return [defect, qty > 0 ? String(qty) : '-', detailLines || '-'];
  });

  autoTable(doc, {
    startY: 96,
    head: [['Defect', 'Qty', 'Pool No. — Project — Orientation — Type']],
    body: defectRows.length > 0 ? defectRows : [['— No defect catalogue configured for this workshop —', '', '']],
    styles: { fontSize: 8.5, cellPadding: 5, textColor: [30, 41, 59], valign: 'top' },
    headStyles: { fillColor: BRAND_ORANGE, textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 0: { cellWidth: 140 }, 1: { cellWidth: 40, halign: 'center' }, 2: { cellWidth: 'auto' } },
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

  // ── PAGE 2 — PRODUCTION (single shift) ─────────────────────────────────
  doc.addPage();
  autoTable(doc, {
    startY: 96,
    head: [['Total Pools Produced']],
    body: [[String(report.totalProduction)]],
    styles: { fontSize: 11, cellPadding: 8, textColor: [30, 41, 59], halign: 'center' },
    headStyles: { fillColor: BRAND_ORANGE, textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
    bodyStyles: { fontStyle: 'bold', fontSize: 14 },
    margin: { top: 96, left: 32, right: 32, bottom: 44 },
    didDrawPage: () => { drawPdfHeader(doc, logo, report.workshopName, 'Quality Control Report — Production', subtitle); },
  });

  const totalTableY = (doc as any).lastAutoTable?.finalY || 96;
  const poolRows = report.pools.map(p => [
    p.poolNo,
    p.projectName,
    [p.orientation, p.poolType].filter(Boolean).join(' / ') || '-',
    p.defects.length === 0 ? 'OK' : `${p.defects.length} defect${p.defects.length > 1 ? 's' : ''}`,
  ]);
  autoTable(doc, {
    startY: totalTableY + 20,
    head: [['Pool Number', 'Project', 'Orientation / Type', 'Status']],
    body: poolRows.length > 0 ? poolRows : [['— No pools recorded —', '', '', '']],
    styles: { fontSize: 8.5, cellPadding: 4, textColor: [30, 41, 59] },
    headStyles: { fillColor: [51, 65, 85], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 0: { cellWidth: 90 }, 1: { cellWidth: 150 }, 2: { cellWidth: 110 }, 3: { cellWidth: 'auto' } },
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

// The paper "Swimming Pool Control Sheet" (FRM-01/WI-04) has a FIXED set of
// columns per section — e.g. Section I is always Dimensions/Squareness/
// Cracks/Pits/Slag/Dents/Planety/Remarks, filled by hand as OK/No/Yes/notes.
// To reproduce that exact grid digitally, each column below is matched
// against the stage's checklist item labels (case-insensitive substring
// match) and rendered as OK/No/Yes/the item's note — falling back to a
// dash when no matching checklist item exists for that stage yet. This
// keeps the printed form identical to the paper one your QC team already
// knows, while still pulling live data wherever it's been recorded.
interface BirthCertColumn {
  header: string;
  /** Keywords checked (case-insensitive, substring) against checklist item
   *  labels/ids to find this column's value. First match wins. */
  keywords: string[];
  /** Optional override computed straight from the stage's StageHistory
   *  record — checked BEFORE keyword matching, so a stage-specific rule
   *  (e.g. holding time = inspection time minus sent-to-quality time) wins
   *  over a generic checklist-item lookup. Return null to fall through to
   *  keyword matching / the default dash. */
  compute?: (h: any) => string | null;
  /** What this column shows once the stage is APPROVED but no specific
   *  checklist item matched it — this is what makes the certificate read
   *  exactly like the paper form (every cell filled with OK/No, never a
   *  blank on a passed stage). 'ok' for a general condition column
   *  (Dimensions, Squareness, Layout...), 'no' for a defect-presence
   *  column (Cracks, Pits, Slag...), where No means "no defect found" —
   *  same convention QC already uses by hand. Left undefined only for
   *  columns where guessing a default would be misleading (none currently).
   *  Never applied unless the stage is actually APPROVED — a stage that
   *  hasn't been inspected yet still shows a dash, not a fabricated pass. */
  defaultOnApprove: 'OK' | 'No';
}
interface BirthCertSection {
  title: string;
  /** Stage(s) this section's Situation row is filled from. Multiple stages
   *  (e.g. Section IV) are checked in order — first stage with any
   *  recorded checklist data supplies the row. */
  stageIds: string[];
  columns: BirthCertColumn[];
  /** If true, render a free-text Remarks row (from inspectorNotes) instead
   *  of/alongside the column grid, matching sections IV/V/VI on the paper
   *  form which lean on a Remarks line rather than filling every column. */
  remarksLine?: boolean;
}

const BIRTH_CERT_SECTIONS: BirthCertSection[] = [
  {
    title: 'I - Steel Structure Fabrication',
    stageIds: ['steel_fabrication'],
    columns: [
      { header: 'Dimensions', keywords: ['dimension'], defaultOnApprove: 'OK' },
      { header: 'Squareness', keywords: ['square'], defaultOnApprove: 'OK' },
      { header: 'Cracks', keywords: ['crack'], defaultOnApprove: 'No' },
      { header: 'Pits', keywords: ['pit'], defaultOnApprove: 'No' },
      { header: 'Slag', keywords: ['slag'], defaultOnApprove: 'No' },
      { header: 'Dents', keywords: ['dent'], defaultOnApprove: 'No' },
      { header: 'Planety', keywords: ['planety', 'planarity', 'flatness'], defaultOnApprove: 'No' },
      { header: 'Remarks', keywords: ['remark', 'note'], defaultOnApprove: 'OK' },
    ],
  },
  {
    title: 'II - Metal Primer',
    stageIds: ['steel_primer'],
    columns: [
      { header: 'Dry Primer', keywords: ['dry primer', 'dry'], defaultOnApprove: 'OK' },
      { header: 'Uniform Color', keywords: ['uniform', 'color', 'colour'], defaultOnApprove: 'OK' },
      { header: 'Slag', keywords: ['slag'], defaultOnApprove: 'No' },
      { header: 'Pinholes', keywords: ['pinhole'], defaultOnApprove: 'No' },
      { header: 'Cracks', keywords: ['crack'], defaultOnApprove: 'No' },
      { header: 'Remarks', keywords: ['remark', 'note'], defaultOnApprove: 'OK' },
    ],
  },
  {
    title: 'III - Plumbing Workshop',
    stageIds: ['plumbing'],
    columns: [
      { header: 'Layout', keywords: ['layout'], defaultOnApprove: 'OK' },
      { header: 'Supports', keywords: ['support'], defaultOnApprove: 'OK' },
      { header: 'Spacing', keywords: ['spacing'], defaultOnApprove: 'OK' },
      { header: 'Cleanliness', keywords: ['clean'], defaultOnApprove: 'OK' },
      { header: 'Jointing', keywords: ['jointing', 'joint'], defaultOnApprove: 'OK' },
      { header: 'Alignment', keywords: ['alignment', 'align'], defaultOnApprove: 'OK' },
      { header: 'Valves Orientation', keywords: ['valve'], defaultOnApprove: 'OK' },
      {
        header: 'Test Pressure',
        keywords: ['pressure'],
        defaultOnApprove: 'OK',
        // MAT-ERP's standard plumbing test pressure — shown by default even
        // if no checklist item recorded a different reading for this pool.
        compute: (h) => {
          const measured = h?.checklistResult?.items?.find((it: any) =>
            (it.itemId || '').toLowerCase().includes('pressure')
          )?.measuredValue;
          return measured != null ? `${measured} bar` : '3 bar';
        },
      },
      {
        header: 'Holding Time',
        keywords: ['holding', 'hold time'],
        defaultOnApprove: 'OK',
        // Sent-to-Quality (endTime, set when the team finishes and hands the
        // pool to QC) -> Inspector's decision (inspectionTime, set when QC
        // approves/rejects). This is the real wait time in the QC queue,
        // computed automatically rather than typed by hand.
        compute: (h) => {
          if (!h?.endTime || !h?.inspectionTime) return null;
          const startMs = new Date(h.endTime).getTime();
          const endMs = new Date(h.inspectionTime).getTime();
          if (isNaN(startMs) || isNaN(endMs) || endMs < startMs) return null;
          const totalMinutes = Math.round((endMs - startMs) / 60000);
          const hrs = Math.floor(totalMinutes / 60);
          const mins = totalMinutes % 60;
          const St = new Date(h.endTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
          const End = new Date(h.inspectionTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
          const durationLabel = hrs > 0 ? `${hrs}h ${mins}m` : `${mins} min`;
          return `St:${St} End:${End} (${durationLabel})`;
        },
      },
      { header: 'Remarks', keywords: ['remark', 'note'], defaultOnApprove: 'OK' },
    ],
  },
  {
    title: 'IV - GRP/FRP Workshop',
    stageIds: ['cladding', 'skimmer_fitting', 'lamination', 'mechanical_fitting', 'skimmer_test', 'door_cutting'],
    columns: [
      { header: 'Skimmer Dimension', keywords: ['skimmer dimension'], defaultOnApprove: 'OK' },
      { header: 'GRP/FRP Thickness', keywords: ['thickness'], defaultOnApprove: 'OK' },
      { header: 'GRP/FRP Sheet Defect', keywords: ['sheet defect', 'defect'], defaultOnApprove: 'No' },
      { header: 'Sheet Fixition Leveling', keywords: ['fixition', 'fixation', 'sheet leveling'], defaultOnApprove: 'OK' },
      { header: 'Pipes Joints', keywords: ['pipes joint', 'pipe joint'], defaultOnApprove: 'OK' },
      { header: 'Lamination Leveling', keywords: ['lamination leveling', 'lamination level'], defaultOnApprove: 'OK' },
      { header: 'Skimmer Test', keywords: ['skimmer test'], defaultOnApprove: 'OK' },
      { header: 'Pipes Test', keywords: ['pipes test', 'pipe test'], defaultOnApprove: 'OK' },
      { header: 'Check After Repair', keywords: ['after repair', 'repair check'], defaultOnApprove: 'OK' },
    ],
    remarksLine: true,
  },
  {
    title: 'V - Acrylic Fixing Workshop',
    stageIds: ['acrylic'],
    columns: [
      { header: 'Dimension', keywords: ['dimension'], defaultOnApprove: 'OK' },
      { header: 'Alignment', keywords: ['alignment', 'align'], defaultOnApprove: 'OK' },
      { header: 'Curing', keywords: ['curing'], defaultOnApprove: 'OK' },
      { header: 'Water Leakage Test', keywords: ['leakage', 'leak'], defaultOnApprove: 'OK' },
      { header: 'Defects', keywords: ['defect'], defaultOnApprove: 'No' },
    ],
    remarksLine: true,
  },
  {
    title: 'VI - Copping and Mosaic Tile Fixation',
    stageIds: ['mosaic', 'grouting'],
    columns: [
      { header: 'Color', keywords: ['color', 'colour'], defaultOnApprove: 'OK' },
      { header: 'Leveling', keywords: ['leveling', 'level'], defaultOnApprove: 'OK' },
      { header: 'Lippage', keywords: ['lippage'], defaultOnApprove: 'No' },
      { header: 'Joints', keywords: ['joints'], defaultOnApprove: 'OK' },
      { header: 'Joints (Mosaic/Acrylic)', keywords: ['mosaic and acrylic', 'between mosaic'], defaultOnApprove: 'OK' },
    ],
    remarksLine: true,
  },
];

/** OK / No / Yes text derived from a checklist item's pass/fail + note,
 *  matching how the paper form is actually filled by hand. Prefers a
 *  literal note (inspectors often write "OK", "Re-touch", etc.) over a
 *  generic Pass/Fail translation. A column's `compute` (e.g. Holding Time,
 *  Test Pressure) is checked first and wins over keyword matching. If
 *  nothing matches AND the stage is APPROVED, falls back to the column's
 *  `defaultOnApprove` (OK / No) — exactly how the paper form reads once a
 *  stage passes: every box filled, none left blank. A stage that hasn't
 *  been approved yet still shows a dash rather than a fabricated pass. */
function cellValueForColumn(
  h: any,
  items: { itemId: string; passed: boolean; note?: string }[],
  templateItems: { id: string; label: string }[],
  column: BirthCertColumn
): string {
  if (column.compute) {
    const computed = column.compute(h);
    if (computed != null) return computed;
  }
  for (const item of items) {
    const tmplLabel = (templateItems.find(t => t.id === item.itemId)?.label || item.itemId).toLowerCase();
    if (column.keywords.some(k => tmplLabel.includes(k))) {
      if (item.note && item.note.trim()) return item.note.trim();
      return item.passed ? 'OK' : 'No';
    }
  }
  // No specific checklist item recorded for this column — once QC has
  // actually approved the stage, fill it the same way the paper form
  // would (every box OK/No, nothing left blank). A stage still awaiting
  // inspection keeps the dash rather than showing a fabricated pass.
  if (h?.status === 'APPROVED') return column.defaultOnApprove;
  return '—';
}

function statusToNcrBadges(status?: string): { opened: boolean; closed: boolean; hold: boolean; ok: boolean } {
  return {
    opened: status === 'REJECTED',
    closed: false,
    hold: status === 'PENDING_INSPECTION',
    ok: status === 'APPROVED' || status === 'SKIPPED' || status === 'CARRIED_ON_SITE',
  };
}

/**
 * Pool "Birth Certificate" — the digital equivalent of the paper Swimming
 * Pool Control Sheet (FRM-01/WI-04). Reproduces the exact same fixed grid
 * per section (Dimensions/Squareness/Cracks/... for Steel Structure, Dry
 * Primer/Uniform Color/... for Metal Primer, and so on through Copping and
 * Mosaic Tile Fixation), a Situation row, Inspected By + Date, NCR
 * Opened/Closed/Hold/OK, and an OK-for-dispatch block — filled from live
 * checklist/stage data wherever it's been recorded, dash where it hasn't.
 * Plumbing's Holding Time and Test Pressure are computed/defaulted rather
 * than matched from a checklist (see BIRTH_CERT_SECTIONS above). GRP/FRP's
 * Remarks line auto-states the Cladding and Lamination completion dates.
 * Any QCDefect logged against this pool (any stage) appears under the
 * matching section as its own "Defects Logged" line.
 * `checklistTemplates` is optional — when supplied, checklist item ids are
 * resolved to their human-readable labels for column matching; when
 * omitted, columns fall back to a dash and the certificate still renders
 * fully using stage status/team/inspector/notes. `qcDefects` is optional —
 * when omitted, the Defects Logged line is simply skipped.
 */
export async function exportPoolBirthCertificatePdf(
  pool: any,
  stages: { id: string; name: string }[],
  checklistTemplates?: { stageId: string; items: { id: string; label: string }[] }[],
  qcDefects?: { poolId: string; stageId: string; defectType: string; severity: string; status: string; notes?: string; loggedAt: string }[]
) {
  const logo = await loadLogo();
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginLeft = 32;
  const marginRight = pageWidth - 32;

  let y = drawPdfHeader(doc, logo, 'Quality Control — Swimming Pool Control Sheet', `Pool Birth Certificate — ${pool.poolNo}`, `${pool.projectName}  •  FRM-01/WI-04-REV1`);

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - 40) {
      doc.addPage();
      y = 32;
    }
  };

  // ── Identity block: Project / Serial / Flate No. / Status / Type / Size / Date ──
  autoTable(doc, {
    startY: y,
    head: [['Project', 'Serial', 'Flate No.', 'Status', 'Type', 'Size', 'Date']],
    body: [[
      pool.projectName || '—',
      pool.id ? String(pool.id).slice(0, 8) : '—',
      pool.poolNo || '—',
      pool.orientation || '—',
      pool.poolType || pool.shape || '—',
      pool.dimensions || '—',
      pool.createdAt ? new Date(pool.createdAt).toLocaleDateString('en-GB') : '—',
    ]],
    styles: { fontSize: 8, cellPadding: 5, halign: 'center' },
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold' },
    margin: { left: marginLeft, right: 32 },
  });
  y = (doc as any).lastAutoTable.finalY + 12;

  // ── One fixed-column grid per paper-form section ────────────────────────
  for (const section of BIRTH_CERT_SECTIONS) {
    ensureSpace(60);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(20, 20, 20);
    doc.text(section.title, marginLeft, y);
    y += 6;

    // Use the first stage in this section that has any recorded checklist
    // result; sections spanning several stages (e.g. IV) show whichever one
    // has data rather than repeating the grid per stage.
    let h: any = null;
    let matchedStageId = section.stageIds[0];
    for (const sid of section.stageIds) {
      const candidate = pool.stageHistory?.[sid];
      if (candidate && candidate.status !== 'NOT_STARTED') {
        h = candidate;
        matchedStageId = sid;
        break;
      }
    }

    const items: any[] = h?.checklistResult?.items || [];
    const templateItems = checklistTemplates?.find(t => t.stageId === matchedStageId)?.items || [];

    ensureSpace(40);
    autoTable(doc, {
      startY: y,
      head: [section.columns.map(c => c.header)],
      body: [section.columns.map(c => cellValueForColumn(h, items, templateItems, c))],
      styles: { fontSize: 7, cellPadding: 4, halign: 'center' },
      headStyles: { fillColor: [241, 245, 249], textColor: [30, 41, 59], fontStyle: 'bold', fontSize: 6.5 },
      margin: { left: marginLeft, right: 32 },
    });
    y = (doc as any).lastAutoTable.finalY + 2;

    if (section.remarksLine) {
      ensureSpace(30);
      // GRP/FRP Workshop: auto-state Cladding and Lamination completion
      // dates (matching how this section is actually filled by hand — see
      // the "GRP cladding on 17.06.26 / lamination done on 19.06.26" style
      // note), then append any free-text inspector notes after it.
      let remarksText = h?.inspectorNotes || '';
      if (section.title.startsWith('IV')) {
        const claddingDate = pool.stageHistory?.['cladding']?.inspectionTime || pool.stageHistory?.['cladding']?.endTime;
        const laminationDate = pool.stageHistory?.['lamination']?.inspectionTime || pool.stageHistory?.['lamination']?.endTime;
        const parts: string[] = [];
        if (claddingDate) parts.push(`GRP cladding on ${new Date(claddingDate).toLocaleDateString('en-GB')}`);
        if (laminationDate) parts.push(`Lamination done on ${new Date(laminationDate).toLocaleDateString('en-GB')}`);
        const autoRemark = parts.join('  /  ');
        remarksText = [autoRemark, remarksText].filter(Boolean).join('   —   ');
      }
      autoTable(doc, {
        startY: y,
        body: [['Remarks', remarksText || (h?.status === 'APPROVED' ? 'OK' : '—')]],
        styles: { fontSize: 7.5, cellPadding: 5 },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 60, fillColor: [248, 250, 252] } },
        margin: { left: marginLeft, right: 32 },
      });
      y = (doc as any).lastAutoTable.finalY + 2;
    }

    // Defects Logged — any QCDefect record raised against this pool at any
    // stage belonging to this section (not just the stage the grid above is
    // showing), so a defect logged mid-workshop is never silently dropped.
    const sectionDefects = (qcDefects || []).filter(
      d => d.poolId === pool.id && section.stageIds.includes(d.stageId)
    );
    if (sectionDefects.length > 0) {
      ensureSpace(20 + sectionDefects.length * 12);
      autoTable(doc, {
        startY: y,
        head: [['Defects Logged', 'Severity', 'Status', 'Date']],
        body: sectionDefects.map(d => [
          d.notes ? `${d.defectType} — ${d.notes}` : d.defectType,
          d.severity,
          d.status,
          d.loggedAt ? new Date(d.loggedAt).toLocaleDateString('en-GB') : '—',
        ]),
        styles: { fontSize: 7, cellPadding: 4 },
        headStyles: { fillColor: [254, 242, 242], textColor: [190, 18, 60], fontStyle: 'bold', fontSize: 6.5 },
        columnStyles: { 1: { cellWidth: 55 }, 2: { cellWidth: 55 }, 3: { cellWidth: 55 } },
        margin: { left: marginLeft, right: 32 },
      });
      y = (doc as any).lastAutoTable.finalY + 2;
    }

    // Inspected By / Date row
    ensureSpace(24);
    autoTable(doc, {
      startY: y,
      body: [[
        'Inspected By', h?.inspectorId || '—',
        'Date', h?.inspectionTime ? new Date(h.inspectionTime).toLocaleDateString('en-GB') : (h?.endTime ? new Date(h.endTime).toLocaleDateString('en-GB') : '—'),
      ]],
      styles: { fontSize: 7.5, cellPadding: 5 },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 70, fillColor: [248, 250, 252] },
        2: { fontStyle: 'bold', cellWidth: 40, fillColor: [248, 250, 252] },
      },
      margin: { left: marginLeft, right: 32 },
    });
    y = (doc as any).lastAutoTable.finalY + 4;

    // NCR Opened / Closed / Hold / OK badges, derived from stage status
    const badges = statusToNcrBadges(h?.status);
    ensureSpace(20);
    const badgeDefs: [string, boolean, [number, number, number]][] = [
      ['NCR Opened', badges.opened, [225, 29, 72]],
      ['Hold', badges.hold, [217, 119, 6]],
      ['OK', badges.ok, [16, 185, 129]],
    ];
    let bx = marginLeft;
    doc.setFontSize(7.5);
    badgeDefs.forEach(([label, active, color]) => {
      const bw = doc.getTextWidth(label) + 12;
      doc.setFillColor(...(active ? color : ([226, 232, 240] as [number, number, number])));
      doc.roundedRect(bx, y, bw, 14, 3, 3, 'F');
      doc.setTextColor(active ? 255 : 148, active ? 255 : 163, active ? 255 : 184);
      doc.setFont('helvetica', 'bold');
      doc.text(label, bx + 6, y + 10);
      bx += bw + 6;
    });
    y += 22;

    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.5);
    doc.line(marginLeft, y, marginRight, y);
    y += 12;
  }

  // ── OK for dispatch block ───────────────────────────────────────────────
  ensureSpace(60);
  autoTable(doc, {
    startY: y,
    head: [['OK for Dispatch', 'Date', 'Dispatched To', 'Delivered']],
    body: [[
      pool.completedAt ? 'Yes' : 'Pending',
      pool.deliveredAt ? new Date(pool.deliveredAt).toLocaleDateString('en-GB') : (pool.completedAt ? new Date(pool.completedAt).toLocaleDateString('en-GB') : '—'),
      pool.isDelivered ? (pool.projectName || '—') : '—',
      pool.isDelivered ? 'Yes' : 'No',
    ]],
    styles: { fontSize: 8.5, cellPadding: 5, halign: 'center' },
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold' },
    margin: { left: marginLeft, right: 32 },
  });

  drawPdfFooter(doc, `${COMPANY_NAME} — Quality Control — Pool Birth Certificate`);
  doc.save(`Pool_${pool.poolNo}_Birth_Certificate_${new Date().toISOString().slice(0, 10)}.pdf`);
}


/**
 * Employee recognition certificate — "Employee of the Month" / "Employee of
 * the Year" / "Section Best Team" etc. Landscape A4, gold-bordered, designed
 * to be printed and physically handed to the employee or framed.
 */
export async function exportEmployeeCertificatePdf(opts: {
  /** A person's name ("Umer Ul Asad") or a team's name ("Cladding Team A")
   *  — both print identically on the certificate, just centered as the
   *  recipient. */
  employeeName: string;
  department: string;
  roleTitle?: string;
  /** e.g. "EMPLOYEE OF THE MONTH", "EMPLOYEE OF THE YEAR", "SECTION BEST TEAM" */
  awardTitle: string;
  /** e.g. "August 2026" or "2026" */
  period: string;
  citation: string;
  signatoryName?: string;
  signatoryTitle?: string;
}) {
  const logo = await loadLogo();
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  const gold: [number, number, number] = [180, 140, 40];
  const goldLight: [number, number, number] = [212, 175, 90];
  const ink: [number, number, number] = [30, 27, 20];

  // Cream background
  doc.setFillColor(253, 251, 245);
  doc.rect(0, 0, w, h, 'F');

  // Outer + inner gold border, framing the whole certificate
  doc.setDrawColor(...gold);
  doc.setLineWidth(2.5);
  doc.rect(24, 24, w - 48, h - 48);
  doc.setLineWidth(0.75);
  doc.rect(34, 34, w - 68, h - 68);

  // Corner flourishes (simple diamond accents)
  const corners: [number, number][] = [[34, 34], [w - 34, 34], [34, h - 34], [w - 34, h - 34]];
  corners.forEach(([cx, cy]) => {
    doc.setFillColor(...gold);
    doc.circle(cx, cy, 3, 'F');
  });

  let y = 78;

  // Logo, centered
  if (logo) {
    const logoH = 120;
    const logoW = logoH * logo.ratio;
    doc.addImage(logo.dataUrl, 'PNG', w / 2 - logoW / 2, y - 30, logoW, logoH);
    y += 20;
  }

  // Company name
  doc.setFont('times', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...ink);

 // Move y down past the background logo/header elements
  y += 110; // Adjust this increment as needed for exact spacing

  // "Certificate of Recognition"
  doc.setFont('times', 'normal');
  doc.setFontSize(15);
  doc.setTextColor(90, 80, 60);
  doc.text('Certificate of Recognition', w / 2, y, { align: 'center' });
  
  y += 8;
  doc.setDrawColor(...goldLight);
  doc.setLineWidth(1);
  doc.line(w / 2 - 90, y, w / 2 + 90, y);
  
  y += 40; // Space before the "This certificate is proudly presented to" block

  // Award title, large
  doc.setFont('times', 'bold');
  doc.setFontSize(30);
  doc.setTextColor(...gold);
  doc.text(opts.awardTitle.toUpperCase(), w / 2, y, { align: 'center' });
  y += 16;
  doc.setFont('times', 'italic');
  doc.setFontSize(11);
  doc.setTextColor(120, 110, 90);
  doc.text(opts.period, w / 2, y, { align: 'center' });
  y += 42;

  // "This certificate is proudly presented to"
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  doc.setTextColor(90, 80, 60);
  doc.text('This certificate is proudly presented to', w / 2, y, { align: 'center' });
  y += 34;

  // Employee name, huge
  doc.setFont('times', 'bolditalic');
  doc.setFontSize(28);
  doc.setTextColor(...ink);
  doc.text(opts.employeeName, w / 2, y, { align: 'center' });
  y += 6;
  doc.setDrawColor(...gold);
  doc.setLineWidth(0.75);
  doc.line(w / 2 - 130, y, w / 2 + 130, y);
  y += 22;

  // Role / department
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  doc.setTextColor(110, 100, 80);
  const roleLine = [opts.roleTitle, opts.department].filter(Boolean).join(' · ');
  doc.text(roleLine, w / 2, y, { align: 'center' });
  y += 34;

  // Citation, wrapped
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(10.5);
  doc.setTextColor(70, 63, 48);
  const citationLines = doc.splitTextToSize(opts.citation, w - 220);
  doc.text(citationLines, w / 2, y, { align: 'center' });
  y += citationLines.length * 14;

  // Signature block, bottom of page (fixed position regardless of citation length)
  const sigY = h - 96;
  const sigLineWidth = 160;
  doc.setDrawColor(...ink);
  doc.setLineWidth(0.6);
  // Left signature (Hussein haj khalil)
  doc.line(w / 2 - 220, sigY, w / 2 - 220 + sigLineWidth, sigY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...ink);
  doc.text(opts.signatoryName || 'Hussein haj khalil', w / 2 - 220 + sigLineWidth / 2, sigY + 14, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(120, 110, 90);
  doc.text(opts.signatoryTitle || 'Factory Manager', w / 2 - 220 + sigLineWidth / 2, sigY + 26, { align: 'center' });

  // Right signature (date)
  doc.setDrawColor(...ink);
  doc.line(w / 2 + 220 - sigLineWidth, sigY, w / 2 + 220, sigY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...ink);
  doc.text(new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }), w / 2 + 220 - sigLineWidth / 2, sigY + 14, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(120, 110, 90);
  doc.text('Date Issued', w / 2 + 220 - sigLineWidth / 2, sigY + 26, { align: 'center' });

  const safeName = opts.employeeName.replace(/[^a-z0-9]+/gi, '_');
  doc.save(`Certificate_${safeName}_${opts.awardTitle.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`);
}
