// ─────────────────────────────────────────────────────────────────────────────
// MAT-ERP — Universal Export Utilities
// Reusable Excel + PDF export functions used across every dashboard.
// Built on xlsx, jspdf, jspdf-autotable (all already installed).
// ─────────────────────────────────────────────────────────────────────────────
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

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
 * Generic table-style PDF — branded header, auto-paged, color-banded.
 */
export function exportTablePdf(opts: {
  title: string;
  subtitle?: string;
  columns: { header: string; dataKey: string }[];
  rows: Record<string, any>[];
  filename: string;
  orientation?: 'portrait' | 'landscape';
}) {
  const doc = new jsPDF({
    orientation: opts.orientation || 'landscape',
    unit: 'pt',
    format: 'a4',
  });

  // Brand header band
  doc.setFillColor(79, 70, 229); // indigo-600
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 54, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('MAT-ERP', 32, 28);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(opts.title, 32, 44);

  // Generated timestamp (right-aligned)
  const ts = new Date().toLocaleString('en-GB');
  doc.setFontSize(8);
  doc.text(`Generated: ${ts}`, doc.internal.pageSize.getWidth() - 32, 28, {
    align: 'right',
  });

  if (opts.subtitle) {
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(9);
    doc.text(opts.subtitle, 32, 72);
  }

  autoTable(doc, {
    startY: opts.subtitle ? 88 : 70,
    head: [opts.columns.map((c) => c.header)],
    body: opts.rows.map((r) => opts.columns.map((c) => r[c.dataKey] ?? '')),
    styles: { fontSize: 8, cellPadding: 4, textColor: [30, 41, 59] },
    headStyles: {
      fillColor: [79, 70, 229],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { top: 86, left: 24, right: 24 },
    didDrawPage: (data) => {
      // Page footer
      const pageCount = (doc as any).internal.getNumberOfPages();
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      doc.text(
        `Page ${data.pageNumber} of ${pageCount}  •  MAT-ERP Production Ledger`,
        doc.internal.pageSize.getWidth() / 2,
        doc.internal.pageSize.getHeight() - 12,
        { align: 'center' }
      );
    },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  doc.save(`${opts.filename}_${stamp}.pdf`);
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
