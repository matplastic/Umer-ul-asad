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
  /** adds an "Employee acknowledgment" block (warning / offer letters) */
  acknowledgment?: boolean;
  /** wording inside the acknowledgment block (defaults to "received and read") */
  acknowledgmentText?: string;
  /** structured tables (offer / appointment terms) printed after `paragraphs` */
  tables?: LetterTable[];
  /** paragraphs printed after the tables */
  closingParagraphs?: string[];
  filename: string;
}

export interface LetterTable {
  title: string;
  rows: [string, string][];
  /** right-align the value column (money tables) */
  amount?: boolean;
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
  const lh = 16;
  const writeParas = (paras: string[]) => {
    for (const p of paras) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(...C.text);
      const lines = doc.splitTextToSize(p, pw - mx * 2) as string[];
      if (y + lines.length * lh > ph - 190) { doc.addPage(); y = 70; }
      doc.text(lines, mx, y, { align: 'left', lineHeightFactor: 1.45 });
      y += lines.length * lh + 10;
    }
  };
  writeParas(spec.paragraphs);

  // Structured tables (offer / appointment terms)
  for (const t of spec.tables || []) {
    if (y > ph - 170) { doc.addPage(); y = 70; }
    const base = themedTable([t.title, ''], t.rows);
    autoTable(doc, {
      ...base,
      styles: { ...(base.styles as object), fontSize: 9.5 },
      startY: y, margin: { left: mx, right: mx, top: 70, bottom: 60 },
      head: [[t.title, '']], body: t.rows,
      columnStyles: { 0: { cellWidth: 170, fontStyle: 'bold', textColor: C.muted }, 1: { halign: t.amount ? 'right' : 'left' } },
      didParseCell: (d) => {
        if (d.section === 'head') d.cell.styles.halign = 'left';
        if (d.section === 'body' && d.column.index === 1) d.cell.styles.halign = t.amount ? 'right' : 'left';
        if (d.section === 'body' && t.amount && d.row.index === t.rows.length - 1) {
          d.cell.styles.fontStyle = 'bold'; d.cell.styles.fillColor = C.tealSoft as any;
        }
      },
    });
    y = (doc as any).lastAutoTable.finalY + 16;
  }
  if (spec.closingParagraphs?.length) writeParas(spec.closingParagraphs);

  // Signature block
  if (y > ph - 200) { doc.addPage(); y = 70; }
  y += 26;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(...C.text);
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
    const ackLines = doc.splitTextToSize(
      spec.acknowledgmentText || 'I confirm that I have received and read this letter.', pw - mx * 2 - 24) as string[];
    const boxH = 76 + ackLines.length * 12;
    y += 78;
    if (y + boxH > ph - 50) { doc.addPage(); y = 70; }
    doc.setFillColor(...C.tealSoft); doc.setDrawColor(...C.line);
    doc.roundedRect(mx, y, pw - mx * 2, boxH, 6, 6, 'FD');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...C.ink);
    doc.text('EMPLOYEE ACKNOWLEDGMENT', mx + 12, y + 18);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...C.text);
    doc.text(ackLines, mx + 12, y + 33);
    const ly = y + 33 + ackLines.length * 12 + 24;
    doc.setDrawColor(...C.muted);
    doc.line(mx + 12, ly, mx + 190, ly); doc.line(pw / 2 + 10, ly, pw / 2 + 170, ly);
    doc.setFontSize(8); doc.setTextColor(...C.muted);
    doc.text('Employee signature', mx + 12, ly + 10); doc.text('Date', pw / 2 + 10, ly + 10);
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

export type LetterKind = 'Offer Letter' | 'Appointment Letter' | 'Experience Certificate' | 'Salary Certificate' | 'NOC' | 'Appreciation Letter' | 'Warning Letter' | 'Custom Letter';
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
  // Offer letter (simple form — used by Recruitment)
  offerPosition?: string; offerSalary?: number; offerJoining?: string;
  // Offer / Appointment letter (full terms — used by Letters Center)
  terms?: EmploymentTerms;
}

export interface EmploymentTerms {
  position: string;
  department?: string;
  reportingTo?: string;
  workLocation?: string;
  contractType?: string;
  joiningDate?: string;
  probationMonths?: number;
  basic: number; housing: number; transport: number; other: number;
  workHours?: string;
  annualLeave?: number;
  noticeDays?: number;
  /** offer letter: last date to accept */
  validUntil?: string;
  /** offer letter: extra benefits (visa, medical insurance, air ticket …) */
  benefits?: string;
  /** appointment letter: date of the offer letter being confirmed */
  offerDate?: string;
}

function termTables(t: EmploymentTerms, offer: boolean): LetterTable[] {
  const total = (t.basic || 0) + (t.housing || 0) + (t.transport || 0) + (t.other || 0);
  const details: [string, string][] = [['Position', t.position]];
  if (t.department) details.push(['Department', t.department]);
  if (t.reportingTo) details.push(['Reporting to', t.reportingTo]);
  if (t.workLocation) details.push(['Place of work', t.workLocation]);
  if (t.contractType) details.push(['Contract type', t.contractType]);
  details.push([offer ? 'Expected date of joining' : 'Date of joining', t.joiningDate ? fmtD(t.joiningDate) : '[to be confirmed]']);
  details.push(['Probation period', t.probationMonths ? `${t.probationMonths} month(s)` : 'None']);
  if (offer && t.validUntil) details.push(['Offer valid until', fmtD(t.validUntil)]);

  const pay: [string, string][] = [['Basic salary', fmtAED(t.basic)]];
  if (t.housing > 0) pay.push(['Housing allowance', fmtAED(t.housing)]);
  if (t.transport > 0) pay.push(['Transport allowance', fmtAED(t.transport)]);
  if (t.other > 0) pay.push(['Other allowance', fmtAED(t.other)]);
  pay.push(['Total monthly salary', fmtAED(total)]);

  const work: [string, string][] = [];
  if (t.workHours) work.push(['Working hours', t.workHours]);
  if (t.annualLeave) work.push(['Annual leave', `${t.annualLeave} calendar days per year, as per UAE Labour Law`]);
  if (t.noticeDays) work.push(['Notice period', `${t.noticeDays} days, in writing, by either party`]);

  const out: LetterTable[] = [
    { title: offer ? 'Offer details' : 'Appointment details', rows: details },
    { title: 'Monthly remuneration (AED)', rows: pay, amount: true },
  ];
  if (work.length) out.push({ title: 'Working terms', rows: work });
  return out;
}

export interface ComposedLetter {
  subject: string; addressedTo: string; paragraphs: string[]; acknowledgment?: boolean;
  acknowledgmentText?: string; tables?: LetterTable[]; closingParagraphs?: string[];
}

export function composeLetter(inp: LetterInput): ComposedLetter {
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
    case 'Offer Letter': {
      if (inp.terms) {
        const t = inp.terms;
        const where = t.workLocation ? `, based at ${t.workLocation}` : '';
        const rep = t.reportingTo ? `, reporting to ${t.reportingTo}` : '';
        const tdept = t.department ? ` in the ${t.department} department` : '';
        const closing = [
          `This offer is conditional upon: (a) the issue of a valid UAE employment visa, labour card and Emirates ID; (b) a satisfactory medical fitness test; (c) verification of your documents, qualifications and references; and (d) the terms of your employment contract and the UAE Federal Decree-Law No. 33 of 2021 on the Regulation of Labour Relations.`,
        ];
        if (t.benefits?.trim()) closing.push(`In addition, the company will provide the following: ${t.benefits.trim()}`);
        closing.push(`${t.validUntil ? `This offer remains valid until ${fmtD(t.validUntil)}. ` : ''}Please sign and return a copy of this letter to confirm your acceptance. A formal letter of appointment will be issued once you join.`);
        closing.push('We look forward to welcoming you to the MAT team.');
        return {
          subject: 'Offer of Employment',
          addressedTo: inp.addressedTo || `Dear ${who(p)},`,
          paragraphs: [
            `With reference to your application and the discussions we have had, we are pleased to offer you the position of ${t.position}${tdept} at ${COMPANY_NAME}${rep}${where}. The main terms of this offer are set out below.`,
          ],
          tables: termTables(t, true),
          closingParagraphs: closing,
          acknowledgment: true,
          acknowledgmentText: `I, ${p.name}, accept the above offer of employment on the terms stated in this letter.`,
        };
      }
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
    }
    case 'Appointment Letter': {
      const t: EmploymentTerms = inp.terms || { position: role, basic: 0, housing: 0, transport: 0, other: 0 };
      const tdept = t.department ? ` in the ${t.department} department` : '';
      const idBits = [
        p.passportNumber ? `your passport number as ${p.passportNumber}` : '',
        p.nationality ? `your nationality as ${p.nationality}` : '',
      ].filter(Boolean);
      const idRecord = idBits.length ? ` Our records show ${idBits.join(' and ')}.` : '';
      const probation = t.probationMonths
        ? `You will be on probation for ${t.probationMonths} month(s) from your date of joining. During this period your performance, conduct and attendance will be reviewed, and your confirmation will be communicated to you in writing. Termination during probation is governed by the UAE Labour Law.`
        : '';
      const closing = [
        probation,
        'You are expected to perform your duties diligently, follow the lawful instructions of your superiors, comply with the company policies and safety rules, and keep all company information confidential during and after your employment.',
        `${t.noticeDays ? `Either party may terminate this contract by giving ${t.noticeDays} days' written notice, subject to the UAE Labour Law. ` : ''}On the end of your service you will receive your end-of-service gratuity and other dues as provided by the UAE Labour Law.`,
        'Please sign the acknowledgment below and return a copy of this letter to confirm that you accept the terms of your appointment.',
      ].filter(Boolean);
      return {
        subject: 'Letter of Appointment',
        addressedTo: inp.addressedTo || `Dear ${who(p)},`,
        paragraphs: [
          `${t.offerDate ? `Further to our offer of employment dated ${fmtD(t.offerDate)} and your acceptance of it, we` : 'We'} are pleased to confirm your appointment as ${t.position}${tdept} at ${COMPANY_NAME} (the "Company")${t.joiningDate ? `, with effect from ${fmtD(t.joiningDate)}` : ''}.${idRecord}`,
          'Your appointment is on the terms below and is subject to the UAE Federal Decree-Law No. 33 of 2021 on the Regulation of Labour Relations and its Executive Regulations.',
        ],
        tables: termTables(t, false),
        closingParagraphs: closing,
        acknowledgment: true,
        acknowledgmentText: `I, ${p.name}, confirm that I have read, understood and accept the terms of this letter of appointment.`,
      };
    }
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
