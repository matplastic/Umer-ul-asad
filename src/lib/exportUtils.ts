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

// Section groupings that mirror the paper "Swimming Pool Control Sheet"
// (FRM-01/WI-04). Each roman-numeral section on the paper form maps to one
// or more StageIds from mockData's STAGES — this is what lets the digital
// certificate follow the exact same section order the QC team already
// knows from the paper form, while still pulling live data per stage.
const BIRTH_CERT_SECTIONS: { title: string; stageIds: string[] }[] = [
  { title: 'I - Steel Structure Fabrication', stageIds: ['steel_fabrication'] },
  { title: 'II - Metal Primer', stageIds: ['steel_primer'] },
  { title: 'III - Plumbing Workshop', stageIds: ['plumbing'] },
  { title: 'IV - GRP/FRP Workshop', stageIds: ['cladding', 'skimmer_fitting', 'lamination', 'mechanical_fitting', 'skimmer_test', 'door_cutting'] },
  { title: 'V - Acrylic Fixing Workshop', stageIds: ['acrylic'] },
  { title: 'VI - Copping and Mosaic Tile Fixation', stageIds: ['mosaic', 'grouting'] },
];

function statusToNcrBadges(status?: string): { opened: boolean; closed: boolean; hold: boolean; ok: boolean } {
  return {
    opened: status === 'REJECTED',
    closed: status === 'APPROVED' && (false),
    hold: status === 'PENDING_INSPECTION',
    ok: status === 'APPROVED' || status === 'SKIPPED' || status === 'CARRIED_ON_SITE',
  };
}

/**
 * Pool "Birth Certificate" — the digital equivalent of the paper Swimming
 * Pool Control Sheet (FRM-01/WI-04), auto-filled from live stage/checklist
 * data instead of being filled out by hand. Same section order (Steel
 * Structure Fabrication -> Metal Primer -> Plumbing -> GRP/FRP -> Acrylic
 * Fixing -> Copping/Mosaic), each with Process/Situation rows, inspector +
 * date, and NCR Opened/Closed/Hold/OK status, followed by an OK-for-dispatch
 * block. `checklistTemplates` is optional — when supplied, checklist item
 * ids are resolved to their human-readable labels; when omitted, the
 * certificate still renders fully using stage status/team/inspector/notes.
 */
export async function exportPoolBirthCertificatePdf(
  pool: any,
  stages: { id: string; name: string }[],
  checklistTemplates?: { stageId: string; items: { id: string; label: string }[] }[]
) {
  const logo = await loadLogo();
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginLeft = 32;
  const marginRight = pageWidth - 32;

  const labelFor = (stageId: string, itemId: string): string => {
    const tmpl = checklistTemplates?.find(t => t.stageId === stageId);
    const item = tmpl?.items.find(i => i.id === itemId);
    return item?.label || itemId;
  };

  let y = drawPdfHeader(doc, logo, 'Quality Control — Swimming Pool Control Sheet', `Pool Birth Certificate — ${pool.poolNo}`, `${pool.projectName}  •  FRM-01/WI-04-REV1`);

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - 40) {
      doc.addPage();
      y = 32;
    }
  };

  // ── Identity block: Project / Serial / Type / Size / Date ──────────────
  autoTable(doc, {
    startY: y,
    head: [['Project', 'Serial (Pool No.)', 'Type', 'Size', 'Date']],
    body: [[
      pool.projectName || '—',
      pool.poolNo || '—',
      pool.poolType || pool.shape || '—',
      pool.dimensions || '—',
      pool.createdAt ? new Date(pool.createdAt).toLocaleDateString('en-GB') : '—',
    ]],
    styles: { fontSize: 8.5, cellPadding: 5, halign: 'center' },
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold' },
    margin: { left: marginLeft, right: 32 },
  });
  y = (doc as any).lastAutoTable.finalY + 14;

  // ── One block per paper-form section ────────────────────────────────────
  for (const section of BIRTH_CERT_SECTIONS) {
    ensureSpace(70);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(20, 20, 20);
    doc.text(section.title, marginLeft, y);
    y += 6;

    for (const stageId of section.stageIds) {
      const stageDef = stages.find(s => s.id === stageId);
      const h = pool.stageHistory?.[stageId];
      const stageName = stageDef?.name || stageId;

      if (!h || h.status === 'NOT_STARTED') {
        ensureSpace(24);
        autoTable(doc, {
          startY: y + 4,
          body: [[stageName, 'Not started', '—', '—']],
          styles: { fontSize: 8, cellPadding: 4, textColor: [148, 163, 184] },
          columnStyles: { 0: { fontStyle: 'bold', textColor: [30, 41, 59] } },
          margin: { left: marginLeft, right: 32 },
        });
        y = (doc as any).lastAutoTable.finalY + 6;
        continue;
      }

      const badges = statusToNcrBadges(h.status);
      const items: any[] = h.checklistResult?.items || [];

      ensureSpace(30 + items.length * 14);

      // Process / Situation summary row for this stage
      autoTable(doc, {
        startY: y + 4,
        head: [[stageName, 'Team', 'Inspected By', 'Date', 'Status']],
        body: [[
          items.length ? `${items.filter(i => i.passed).length}/${items.length} checklist items passed` : (h.inspectorNotes || 'Situation recorded'),
          h.teamName || h.teamId || '—',
          h.inspectorId || '—',
          h.inspectionTime ? new Date(h.inspectionTime).toLocaleDateString('en-GB') : (h.endTime ? new Date(h.endTime).toLocaleDateString('en-GB') : '—'),
          h.status,
        ]],
        styles: { fontSize: 7.8, cellPadding: 4 },
        headStyles: { fillColor: [241, 245, 249], textColor: [30, 41, 59], fontStyle: 'bold', lineWidth: 0.5 },
        margin: { left: marginLeft, right: 32 },
      });
      y = (doc as any).lastAutoTable.finalY + 2;

      // Checklist item detail, if this stage used a digital checklist
      if (items.length) {
        autoTable(doc, {
          startY: y,
          head: [['Checkpoint', 'Result', 'Note']],
          body: items.map(it => [
            labelFor(stageId, it.itemId),
            it.passed ? 'Pass' : 'Fail',
            it.note || (it.measuredValue != null ? String(it.measuredValue) : '—'),
          ]),
          styles: { fontSize: 7.5, cellPadding: 3 },
          headStyles: { fillColor: [255, 255, 255], textColor: [100, 116, 139], fontStyle: 'italic', lineWidth: 0.25 },
          columnStyles: { 1: { halign: 'center', cellWidth: 50 } },
          didParseCell: (data) => {
            if (data.section === 'body' && data.column.index === 1) {
              data.cell.styles.textColor = data.cell.raw === 'Pass' ? [16, 185, 129] : [225, 29, 72];
              data.cell.styles.fontStyle = 'bold';
            }
          },
          margin: { left: marginLeft + 14, right: 32 },
        });
        y = (doc as any).lastAutoTable.finalY + 2;
      }

      if (h.overridden || h.rejectionCount > 0 || h.inspectorNotes) {
        ensureSpace(14);
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(7.5);
        doc.setTextColor(100, 116, 139);
        const note = [
          h.overridden ? `Override: ${h.overrideReason || 'reason not recorded'}` : '',
          h.rejectionCount > 0 ? `Rejections: ${h.rejectionCount}` : '',
          h.inspectorNotes ? `Notes: ${h.inspectorNotes}` : '',
        ].filter(Boolean).join('   •   ');
        if (note) {
          doc.text(note, marginLeft + 14, y + 8);
          y += 12;
        }
      }

      // NCR status badges — Opened / Closed / Hold / OK, derived from stage status
      ensureSpace(16);
      const badgeY = y + 6;
      const badgeDefs: [string, boolean, [number, number, number]][] = [
        ['NCR Opened', badges.opened, [225, 29, 72]],
        ['Hold', badges.hold, [217, 119, 6]],
        ['OK', badges.ok, [16, 185, 129]],
      ];
      let bx = marginLeft + 14;
      doc.setFontSize(7.5);
      badgeDefs.forEach(([label, active]) => {
        const w = doc.getTextWidth(label) + 12;
        doc.setFillColor(...(active ? badgeDefs.find(b => b[0] === label)![2] : [226, 232, 240] as [number, number, number]));
        doc.roundedRect(bx, badgeY - 8, w, 12, 3, 3, 'F');
        doc.setTextColor(active ? 255 : 148, active ? 255 : 163, active ? 255 : 184);
        doc.setFont('helvetica', 'bold');
        doc.text(label, bx + 6, badgeY);
        bx += w + 6;
      });
      y = badgeY + 14;
    }

    y += 4;
    ensureSpace(2);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.5);
    doc.line(marginLeft, y, marginRight, y);
    y += 14;
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
