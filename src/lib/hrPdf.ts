// ───────────────────────────────────────────────────────────
// MAT-ERP — HR Suite PDFs: official letters + employee profile sheet.
// Same MAT teal look as every other PDF in the ERP (see pdfTheme.ts).
// ───────────────────────────────────────────────────────────
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  COMPANY_NAME, PDF_COLORS, PDF_LAYOUT, loadLogo, drawLetterhead, drawFooter, themedTable, currentPage,
} from './pdfTheme';
import { fmtD, fmtAED, HRProfile } from './hrStore';

export interface LetterSpec {
  refNo: string;
  date: string; // ISO yyyy-mm-dd
  addressedTo?: string;
  subject: string;
  paragraphs: string[];
  signatoryName?: string;
  signatoryTitle?: string;
  /** adds an "Employee acknowledgment" block (warning letters) */
  acknowledgment?: boolean;
  filename: string;
}

export async function exportLetterPdf(spec: LetterSpec) {
  const logo = await loadLogo();
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const mx = 56;
  const C = PDF_COLORS;

  // Letterhead
  doc.setFillColor(...C.teal); doc.rect(0, 0, pw, 6, 'F');
  let tx = mx;
  if (logo) {
    const h = 42, w = h * logo.ratio;
    try { doc.addImage(logo.dataUrl, 'PNG', mx, 22, w, h); } catch { /* skip logo */ }
    tx = mx + w + 12;
  }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...C.ink);
  doc.text(COMPANY_NAME, tx, 42);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...C.muted);
  doc.text('Human Resources Department', tx, 56);
  doc.setDrawColor(...C.line); doc.setLineWidth(0.8); doc.line(mx, 76, pw - mx, 76);
  doc.setDrawColor(...C.teal); doc.setLineWidth(2.2); doc.line(mx, 76, mx + 64, 76);

  // Ref + date
  let y = 104;
  doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.text);
  doc.text(`Ref: ${spec.refNo}`, mx, y);
  doc.text(`Date: ${fmtD(spec.date)}`, pw - mx, y, { align: 'right' });
  y += 30;

  if (spec.addressedTo) {
    doc.setFont('helvetica', 'bold'); doc.text(spec.addressedTo, mx, y); y += 22;
  }

  // Subject
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...C.ink);
  const subj = doc.splitTextToSize(spec.subject.toUpperCase(), pw - mx * 2) as string[];
  doc.text(subj, pw / 2, y, { align: 'center' });
  const sw = Math.min(doc.getTextWidth(subj[0]), pw - mx * 2);
  doc.setDrawColor(...C.ink); doc.setLineWidth(0.8);
  doc.line(pw / 2 - sw / 2, y + subj.length * 14 - 10, pw / 2 + sw / 2, y + subj.length * 14 - 10);
  y += subj.length * 14 + 20;

  // Body
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(...C.text);
  const lh = 16;
  for (const p of spec.paragraphs) {
    const lines = doc.splitTextToSize(p, pw - mx * 2) as string[];
    if (y + lines.length * lh > ph - 190) { doc.addPage(); y = 70; }
    doc.text(lines, mx, y, { align: 'left', lineHeightFactor: 1.45 });
    y += lines.length * lh + 10;
  }

  // Signature block
  if (y > ph - 200) { doc.addPage(); y = 70; }
  y += 26;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5);
  doc.text('Yours sincerely,', mx, y);
  y += 54;
  doc.setDrawColor(...C.muted); doc.setLineWidth(0.6); doc.line(mx, y, mx + 170, y);
  doc.setFont('helvetica', 'bold'); doc.text(spec.signatoryName || 'HR Manager', mx, y + 14);
  doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.muted);
  doc.text(spec.signatoryTitle || 'Human Resources Department', mx, y + 27);
  doc.text(COMPANY_NAME, mx, y + 40);
  // stamp placeholder
  doc.setDrawColor(...C.line); doc.setLineDashPattern([3, 3], 0);
  doc.circle(pw - mx - 50, y - 10, 38);
  doc.setLineDashPattern([], 0);
  doc.setFontSize(7); doc.setTextColor(...C.faint); doc.text('COMPANY STAMP', pw - mx - 50, y - 8, { align: 'center' });

  if (spec.acknowledgment) {
    y += 78;
    if (y > ph - 120) { doc.addPage(); y = 70; }
    doc.setFillColor(...C.tealSoft); doc.setDrawColor(...C.line);
    doc.roundedRect(mx, y, pw - mx * 2, 78, 6, 6, 'FD');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...C.ink);
    doc.text('EMPLOYEE ACKNOWLEDGMENT', mx + 12, y + 18);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...C.text);
    doc.text('I confirm that I have received and read this letter.', mx + 12, y + 33);
    doc.setDrawColor(...C.muted);
    doc.line(mx + 12, y + 64, mx + 190, y + 64); doc.line(pw / 2 + 10, y + 64, pw / 2 + 170, y + 64);
    doc.setFontSize(8); doc.setTextColor(...C.muted);
    doc.text('Employee signature', mx + 12, y + 74); doc.text('Date', pw / 2 + 10, y + 74);
  }

  drawFooter(doc, `${COMPANY_NAME}  ·  HR Department`);
  doc.save(`${spec.filename}.pdf`);
}

// ─── Letter text builders ───────────────────────────────────
export interface PersonCtx {
  name: string;
  department?: string;
  gender?: 'Male' | 'Female';
  designation?: string;
  passportNumber?: string | null;
  nationality?: string | null;
  joiningDate?: string;
  exitDate?: string;
}
const pron = (g?: 'Male' | 'Female') =>
  g === 'Male' ? { title: 'Mr.', he: 'he', his: 'his', him: 'him' }
    : g === 'Female' ? { title: 'Ms.', he: 'she', his: 'her', him: 'her' }
      : { title: '', he: 'they', his: 'their', him: 'them' };
const who = (p: PersonCtx) => `${pron(p.gender).title ? pron(p.gender).title + ' ' : ''}${p.name}`;

export type LetterKind = 'Offer Letter' | 'Experience Certificate' | 'Salary Certificate' | 'NOC' | 'Appreciation Letter' | 'Warning Letter' | 'Custom Letter';
export interface LetterInput {
  kind: LetterKind;
  person: PersonCtx;
  addressedTo?: string;
  // Salary certificate
  basicSalary?: number; allowances?: number;
  // NOC / Appreciation / Warning / Custom
  purpose?: string; reason?: string;
  warningType?: string; incidentDate?: string;
  subject?: string; body?: string;
  // Offer letter
  offerPosition?: string; offerSalary?: number; offerJoining?: string;
}

export function composeLetter(inp: LetterInput): { subject: string; addressedTo: string; paragraphs: string[]; acknowledgment?: boolean } {
  const p = inp.person;
  const pr = pron(p.gender);
  const idLine = [
    p.passportNumber ? `holder of passport number ${p.passportNumber}` : '',
    p.nationality ? `${p.nationality} national` : '',
  ].filter(Boolean).join(', ');
  const idPart = idPart_(idLine);
  function idPart_(s: string) { return s ? `, ${s},` : ''; }
  const role = p.designation || 'staff member';
  const dept = p.department ? ` in the ${p.department} department` : '';

  switch (inp.kind) {
    case 'Offer Letter':
      return {
        subject: 'Offer of Employment',
        addressedTo: inp.addressedTo || `Dear ${p.name},`,
        paragraphs: [
          `We are pleased to offer you the position of ${inp.offerPosition || role}${dept} at ${COMPANY_NAME}${inp.offerJoining ? `, with an expected joining date of ${fmtD(inp.offerJoining)}` : ''}.`,
          `Your monthly salary will be ${fmtAED(inp.offerSalary)}${inp.reason ? `, as follows: ${inp.reason}` : ''}. This offer is subject to a valid UAE work visa, a satisfactory medical fitness test, and the terms of your employment contract and the UAE Labour Law.`,
          'Please sign and return a copy of this letter to confirm your acceptance. We look forward to welcoming you to the team.',
        ],
        acknowledgment: true,
      };
    case 'Experience Certificate': {
      const to = p.joiningDate ? fmtD(p.joiningDate) : '[joining date]';
      const end = p.exitDate ? fmtD(p.exitDate) : 'date';
      return {
        subject: 'Experience Certificate',
        addressedTo: inp.addressedTo || 'To Whom It May Concern',
        paragraphs: [
          `This is to certify that ${who(p)}${idPart} was employed with ${COMPANY_NAME} as ${role}${dept} from ${to} ${p.exitDate ? `to ${end}` : 'until the present date'}.`,
          `During ${pr.his} service with the company, ${pr.he} performed ${pr.his} duties diligently and professionally, and ${pr.his} conduct was found satisfactory.`,
          `This certificate is issued at the request of the employee, without any liability on the company. We wish ${pr.him} every success in ${pr.his} future career.`,
        ],
      };
    }
    case 'Salary Certificate': {
      const total = (inp.basicSalary || 0) + (inp.allowances || 0);
      return {
        subject: 'Salary Certificate',
        addressedTo: inp.addressedTo || 'To Whom It May Concern',
        paragraphs: [
          `This is to certify that ${who(p)}${idPart} is employed with ${COMPANY_NAME} as ${role}${dept}${p.joiningDate ? ` since ${fmtD(p.joiningDate)}` : ''}, and is currently in service.`,
          `${pr.he.charAt(0).toUpperCase() + pr.he.slice(1)} receives a monthly salary as follows:  Basic salary ${fmtAED(inp.basicSalary)}  ·  Allowances ${fmtAED(inp.allowances)}  ·  Total monthly salary ${fmtAED(total)}.`,
          `This certificate is issued upon the employee's request${inp.purpose ? ` for ${inp.purpose}` : ''}, without any liability or responsibility on the company.`,
        ],
      };
    }
    case 'NOC':
      return {
        subject: 'No Objection Certificate',
        addressedTo: inp.addressedTo || 'To Whom It May Concern',
        paragraphs: [
          `This is to certify that ${who(p)}${idPart} is an employee of ${COMPANY_NAME} working as ${role}${dept}.`,
          `The company has no objection to ${pr.him} ${inp.purpose || 'proceeding with the above-mentioned request'}.`,
          'This certificate is issued upon the employee\'s request, without any liability on the company.',
        ],
      };
    case 'Appreciation Letter':
      return {
        subject: 'Letter of Appreciation',
        addressedTo: inp.addressedTo || `Dear ${p.name},`,
        paragraphs: [
          `On behalf of the management of ${COMPANY_NAME}, I would like to express our sincere appreciation for your outstanding work as ${role}${dept}.`,
          inp.reason || 'Your dedication, discipline and commitment to quality are valued by everyone at the company.',
          'We thank you for your contribution and look forward to your continued excellence.',
        ],
      };
    case 'Warning Letter':
      return {
        subject: `${inp.warningType || 'Written'} Warning`,
        addressedTo: inp.addressedTo || `To: ${who(p)}${p.department ? ` — ${p.department}` : ''}`,
        acknowledgment: true,
        paragraphs: [
          `This letter is a formal ${(inp.warningType || 'written').toLowerCase()} regarding your conduct${inp.incidentDate ? ` on ${fmtD(inp.incidentDate)}` : ''}.`,
          inp.reason || '[Describe the incident]',
          'You are required to correct this behaviour with immediate effect. Any repetition may lead to further disciplinary action in accordance with the company policy and the UAE Labour Law.',
          'Please sign below to acknowledge that you have received and read this letter. Your signature does not mean you agree with its contents.',
        ],
      };
    default:
      return {
        subject: inp.subject || 'Letter',
        addressedTo: inp.addressedTo || 'To Whom It May Concern',
        paragraphs: (inp.body || '').split(/\n{1,}/).map(s => s.trim()).filter(Boolean),
      };
  }
}

// ─── Employee profile sheet ─────────────────────────────────
export async function exportEmployeeProfilePdf(opts: {
  name: string;
  basics: [string, string][];
  profile: HRProfile | undefined;
  documents: { docType: string; docNumber?: string; issueDate?: string; expiryDate?: string }[];
  summary: [string, string][];
}) {
  const logo = await loadLogo();
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
  const startPage = currentPage(doc);
  const hdr = () => drawLetterhead(doc, {
    logo, dept: 'Human Resources Department', title: 'Employee Profile', subtitle: opts.name,
    firstPage: currentPage(doc) === startPage,
  });
  const pairs = (rows: [string, string][]) => rows.map(r => [r[0], r[1] || '—']);

  const section = (title: string, rows: [string, string][], startY: number) => {
    autoTable(doc, {
      ...themedTable([title, ''], pairs(rows)),
      startY, head: [[title, '']], body: pairs(rows),
      columnStyles: { 0: { cellWidth: 150, fontStyle: 'bold', textColor: PDF_COLORS.muted }, 1: { halign: 'left' } },
      didParseCell: (d) => { if (d.section === 'body' && d.column.index === 1) d.cell.styles.halign = 'left'; },
      didDrawPage: () => { hdr(); },
    });
    return (doc as any).lastAutoTable.finalY + 14;
  };

  let y = PDF_LAYOUT.firstTop;
  y = section('Personal & employment', opts.basics, y);
  y = section('Summary', opts.summary, y);
  if (opts.documents.length) {
    const head = ['Document', 'Number', 'Issued', 'Expiry'];
    const body = opts.documents.map(d => [d.docType, d.docNumber || '—', fmtD(d.issueDate), fmtD(d.expiryDate)]);
    autoTable(doc, { ...themedTable(head, body), startY: y, head: [head], body, didDrawPage: () => { hdr(); } });
  }
  drawFooter(doc, `${COMPANY_NAME}  ·  HR Department`);
  doc.save(`Employee_Profile_${opts.name.replace(/\s+/g, '_')}.pdf`);
}

// ─── Final settlement sheet ─────────────────────────────────
export async function exportSettlementPdf(r: {
  refNo: string; employeeName: string; joiningDate: string; lastWorkingDay: string; serviceYears: number; basicSalary: number;
  gratuity: number; leaveDays: number; leaveAmount: number; pendingSalaryDays: number; pendingSalaryAmount: number; noticePay: number;
  otherAdditions: number; loanDeduction: number; otherDeductions: number; net: number; notes?: string;
}) {
  const logo = await loadLogo();
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
  const startPage = currentPage(doc);
  const hdr = () => drawLetterhead(doc, {
    logo, dept: 'Human Resources Department', title: 'Final Settlement', subtitle: `${r.employeeName}  ·  Ref ${r.refNo}`,
    firstPage: currentPage(doc) === startPage,
  });
  const yrs = `${Math.floor(r.serviceYears)} yr ${Math.round((r.serviceYears % 1) * 12)} mo`;
  const info: [string, string][] = [
    ['Employee', r.employeeName], ['Joining date', fmtD(r.joiningDate)], ['Last working day', fmtD(r.lastWorkingDay)],
    ['Service (excl. unpaid leave)', yrs], ['Last basic salary', fmtAED(r.basicSalary)],
  ];
  autoTable(doc, { ...themedTable(['Details', ''], info), startY: PDF_LAYOUT.firstTop, head: [['Details', '']], body: info,
    columnStyles: { 0: { cellWidth: 170, fontStyle: 'bold', textColor: PDF_COLORS.muted } }, didDrawPage: () => { hdr(); } });
  const y1 = (doc as any).lastAutoTable.finalY + 14;
  const add: [string, string][] = [
    ['End-of-service gratuity', fmtAED(r.gratuity)],
    [`Unused annual leave (${r.leaveDays} day(s))`, fmtAED(r.leaveAmount)],
    [`Pending salary (${r.pendingSalaryDays} day(s))`, fmtAED(r.pendingSalaryAmount)],
    ['Notice pay', fmtAED(r.noticePay)], ['Other additions', fmtAED(r.otherAdditions)],
  ];
  const ded: [string, string][] = [['Loan / advance balance', fmtAED(r.loanDeduction)], ['Other deductions', fmtAED(r.otherDeductions)]];
  const body = [...add, ...ded, ['NET AMOUNT PAYABLE', fmtAED(r.net)]];
  autoTable(doc, { ...themedTable(['Item', 'Amount'], body), startY: y1, head: [['Item', 'Amount']], body,
    columnStyles: { 1: { halign: 'right' } },
    didParseCell: d => { if (d.section === 'body' && d.row.index === body.length - 1) { d.cell.styles.fontStyle = 'bold'; d.cell.styles.fillColor = PDF_COLORS.tealSoft as any; } },
    didDrawPage: () => { hdr(); } });
  let y = (doc as any).lastAutoTable.finalY + 14;
  if (r.notes) { doc.setFontSize(9); doc.setTextColor(...PDF_COLORS.muted); doc.text(doc.splitTextToSize(`Notes: ${r.notes}`, 480) as string[], 56, y); y += 30; }
  doc.setFontSize(8); doc.setTextColor(...PDF_COLORS.faint);
  doc.text('Gratuity estimated under UAE Federal Decree-Law 33/2021 (21 days per year for 5 years, 30 days after, capped at 2 years’ wage).', 56, y + 6);
  y += 60;
  doc.setDrawColor(...PDF_COLORS.muted); doc.setTextColor(...PDF_COLORS.text); doc.setFontSize(9);
  doc.line(56, y, 226, y); doc.line(330, y, 500, y);
  doc.text('HR Manager', 56, y + 12); doc.text('Employee signature & date', 330, y + 12);
  drawFooter(doc, `${COMPANY_NAME}  ·  HR Department`);
  doc.save(`Final_Settlement_${r.employeeName.replace(/\s+/g, '_')}.pdf`);
}
