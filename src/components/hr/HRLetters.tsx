import { useEffect, useMemo, useState } from 'react';
import {
  collection, doc, onSnapshot, orderBy, query, runTransaction, setDoc, updateDoc, deleteDoc,
} from 'firebase/firestore';
import { getDownloadURL, ref as sRef, uploadBytes } from 'firebase/storage';
import {
  FileText, Printer, Upload, Plus, CheckCircle2, Eye, Trash2, ArrowLeft, FileSignature, Send, Pencil, ExternalLink,
} from 'lucide-react';
// >>> adjust this import to wherever your app exports Firestore + Storage <<<
import { db, storage } from '../../firebase';

/* ───────────────────────── Types ───────────────────────── */
type Kind = 'offer' | 'appointment';
type Status = 'draft' | 'issued' | 'signed';

interface Letter {
  id: string;
  kind: Kind;
  refNo: string;
  status: Status;
  candidateName: string;
  nationality: string;
  passportNo: string;
  employeeId: string;
  position: string;
  department: string;
  reportingTo: string;
  workLocation: string;
  contractType: string;
  joiningDate: string;
  issueDate: string;
  validUntil: string;
  basic: number;
  housing: number;
  transport: number;
  other: number;
  probationMonths: number;
  workHours: string;
  annualLeave: number;
  noticeDays: number;
  signatoryName: string;
  signatoryTitle: string;
  offerId?: string;
  signedUrl?: string;
  signedName?: string;
  signedAt?: string;
  signedBy?: string;
  createdAt: string;
  createdBy: string;
}

const COMPANY = {
  name: 'MAT PLASTIC INDUSTRIES LLC',
  line: 'Swimming Pool Manufacturing  |  Umm Al Quwain, United Arab Emirates',
  logo: '/logo.png', // optional: put your logo in /public/logo.png (hidden automatically if missing)
};

const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d?: string) =>
  d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) : '—';
const aed = (n: number) => `AED ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* number → words (UAE Dirhams) */
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function below1000(n: number): string {
  let s = '';
  if (n >= 100) { s += ONES[Math.floor(n / 100)] + ' Hundred'; n %= 100; if (n) s += ' and '; }
  if (n >= 20) { s += TENS[Math.floor(n / 10)]; n %= 10; if (n) s += '-' + ONES[n]; }
  else if (n > 0) s += ONES[n];
  return s;
}
function aedWords(amount: number): string {
  const n = Math.floor(amount || 0);
  if (n === 0) return 'Zero Dirhams Only';
  const parts: string[] = [];
  const m = Math.floor(n / 1_000_000), k = Math.floor((n % 1_000_000) / 1000), r = n % 1000;
  if (m) parts.push(below1000(m) + ' Million');
  if (k) parts.push(below1000(k) + ' Thousand');
  if (r) parts.push(below1000(r));
  return parts.join(' ') + ' Dirhams Only';
}

async function nextRef(kind: Kind): Promise<string> {
  const prefix = kind === 'offer' ? 'OL' : 'AL';
  const ym = new Date().toISOString().slice(0, 7).replace('-', '');
  const cref = doc(db, 'counters', `${prefix}-${ym}`);
  return runTransaction(db, async (t) => {
    const snap = await t.get(cref);
    const n = (snap.exists() ? (snap.data().n as number) : 0) + 1;
    t.set(cref, { n });
    return `MAT/HR/${prefix}/${ym}/${String(n).padStart(3, '0')}`;
  });
}

const blank = (kind: Kind, by: string): Partial<Letter> => ({
  kind, status: 'draft', candidateName: '', nationality: '', passportNo: '', employeeId: '',
  position: '', department: '', reportingTo: '', workLocation: 'Umm Al Quwain, UAE',
  contractType: 'Unlimited', joiningDate: '', issueDate: today(), validUntil: '',
  basic: 0, housing: 0, transport: 0, other: 0, probationMonths: 6,
  workHours: '8 hours per day, 6 days per week', annualLeave: 30, noticeDays: 30,
  signatoryName: '', signatoryTitle: 'General Manager', createdBy: by,
});

/* ───────────────────────── Styles ───────────────────────── */
const CSS = `
.hrl{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--text,#1f2937)}
.hrl h2{margin:0 0 4px;font-size:20px}
.hrl .sub{color:#6b7280;font-size:13px;margin-bottom:16px}
.hrl .bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px}
.hrl .tab{padding:8px 16px;border:1px solid #d1d5db;background:#fff;border-radius:8px;cursor:pointer;font-size:14px;display:flex;gap:6px;align-items:center}
.hrl .tab.on{background:#0f3d6e;color:#fff;border-color:#0f3d6e}
.hrl .btn{padding:8px 14px;border:1px solid #d1d5db;background:#fff;border-radius:8px;cursor:pointer;font-size:13px;display:inline-flex;gap:6px;align-items:center;color:inherit}
.hrl .btn.pri{background:#0f3d6e;color:#fff;border-color:#0f3d6e}
.hrl .btn.ok{background:#15803d;color:#fff;border-color:#15803d}
.hrl .btn.bad{color:#b91c1c;border-color:#fecaca}
.hrl table.list{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;font-size:13px}
.hrl table.list th{background:#f3f4f6;text-align:left;padding:10px;font-weight:600}
.hrl table.list td{padding:10px;border-top:1px solid #e5e7eb}
.hrl .pill{padding:2px 10px;border-radius:99px;font-size:11px;font-weight:600}
.hrl .pill.draft{background:#e5e7eb;color:#374151}.hrl .pill.issued{background:#fef3c7;color:#92400e}.hrl .pill.signed{background:#dcfce7;color:#166534}
.hrl .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:12px}
.hrl .grid h4{grid-column:1/-1;margin:6px 0 0;font-size:13px;color:#0f3d6e;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #e5e7eb;padding-bottom:4px}
.hrl label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:#4b5563}
.hrl input,.hrl select{padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;background:#fff;color:#111}
/* A4 paper */
.hrl .paper-wrap{background:#e5e7eb;padding:16px;overflow:auto;border-radius:8px}
.hrl .paper{width:210mm;min-height:297mm;margin:0 auto;background:#fff;color:#111;padding:16mm 18mm;box-sizing:border-box;font-family:Georgia,'Times New Roman',serif;font-size:11.5pt;line-height:1.5;box-shadow:0 2px 12px rgba(0,0,0,.2);display:flex;flex-direction:column}
.hrl .lh{display:flex;align-items:center;gap:14px;border-bottom:3px solid #0f3d6e;padding-bottom:10px;margin-bottom:18px}
.hrl .lh img{height:56px}
.hrl .lh .nm{font-size:17pt;font-weight:700;color:#0f3d6e;letter-spacing:.03em;font-family:system-ui,sans-serif}
.hrl .lh .ln{font-size:9pt;color:#555;font-family:system-ui,sans-serif}
.hrl .meta{display:flex;justify-content:space-between;font-size:10.5pt;margin-bottom:14px}
.hrl .subj{font-weight:700;text-decoration:underline;margin:12px 0}
.hrl .paper table{width:100%;border-collapse:collapse;margin:8px 0 12px;font-size:10.5pt}
.hrl .paper td,.hrl .paper th{border:1px solid #9ca3af;padding:5px 9px;text-align:left;vertical-align:top}
.hrl .paper th{background:#eef2f7;width:36%}
.hrl .paper .tot td{font-weight:700;background:#eef2f7}
.hrl .paper ol{margin:6px 0 10px 18px;padding:0}.hrl .paper li{margin-bottom:4px;text-align:justify}
.hrl .paper p{margin:6px 0;text-align:justify}
.hrl .sig{display:flex;justify-content:space-between;gap:30px;margin-top:26px;break-inside:avoid}
.hrl .sig>div{flex:1}.hrl .sig .ln2{border-bottom:1px solid #111;height:42px;margin-bottom:4px}
.hrl .ft{margin-top:auto;border-top:1px solid #9ca3af;padding-top:6px;font-size:8.5pt;color:#555;text-align:center;font-family:system-ui,sans-serif}
@media print{
 body *{visibility:hidden}
 .hrl .paper,.hrl .paper *{visibility:visible}
 .hrl .paper{position:absolute;left:0;top:0;box-shadow:none;margin:0;width:100%}
 @page{size:A4;margin:0}
}
`;

/* ───────────────────────── Letter document ───────────────────────── */
function LetterDoc({ l }: { l: Letter }) {
  const total = (l.basic || 0) + (l.housing || 0) + (l.transport || 0) + (l.other || 0);
  const isOffer = l.kind === 'offer';
  return (
    <div className="paper">
      <div className="lh">
        <img src={COMPANY.logo} alt="" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
        <div><div className="nm">{COMPANY.name}</div><div className="ln">{COMPANY.line}</div></div>
      </div>

      <div className="meta">
        <div><b>Ref:</b> {l.refNo}</div>
        <div><b>Date:</b> {fmtDate(l.issueDate)}</div>
      </div>

      <div>
        <b>{l.candidateName}</b><br />
        {l.nationality && <>Nationality: {l.nationality}<br /></>}
        {l.passportNo && <>Passport No.: {l.passportNo}</>}
      </div>

      <div className="subj">
        {isOffer ? `Subject: Offer of Employment – ${l.position}` : `Subject: Letter of Appointment – ${l.position}`}
      </div>

      <p>Dear {l.candidateName},</p>
      {isOffer ? (
        <p>
          Further to the interview and discussions held with you, we are pleased to offer you the position of{' '}
          <b>{l.position}</b> with <b>{COMPANY.name}</b> (“the Company”) on the terms and conditions set out below.
        </p>
      ) : (
        <p>
          We are pleased to confirm your appointment as <b>{l.position}</b> with <b>{COMPANY.name}</b> (“the Company”),
          effective <b>{fmtDate(l.joiningDate)}</b>, on the terms and conditions set out below.
        </p>
      )}

      <table>
        <tbody>
          {!isOffer && l.employeeId && <tr><th>Employee ID</th><td>{l.employeeId}</td></tr>}
          <tr><th>Position</th><td>{l.position}</td></tr>
          <tr><th>Department</th><td>{l.department || '—'}</td></tr>
          {l.reportingTo && <tr><th>Reporting To</th><td>{l.reportingTo}</td></tr>}
          <tr><th>Place of Work</th><td>{l.workLocation}</td></tr>
          <tr><th>{isOffer ? 'Proposed Joining Date' : 'Effective Date'}</th><td>{fmtDate(l.joiningDate)}</td></tr>
          {!isOffer && <tr><th>Contract Type</th><td>{l.contractType}</td></tr>}
          <tr><th>Probation Period</th><td>{l.probationMonths} months from the date of joining</td></tr>
          <tr><th>Working Hours</th><td>{l.workHours}</td></tr>
          <tr><th>Annual Leave</th><td>{l.annualLeave} calendar days per completed year of service</td></tr>
          <tr><th>Notice Period</th><td>{l.noticeDays} days (written notice by either party)</td></tr>
        </tbody>
      </table>

      <b>Monthly Remuneration</b>
      <table>
        <tbody>
          <tr><th>Basic Salary</th><td>{aed(l.basic)}</td></tr>
          {l.housing > 0 && <tr><th>Housing Allowance</th><td>{aed(l.housing)}</td></tr>}
          {l.transport > 0 && <tr><th>Transport Allowance</th><td>{aed(l.transport)}</td></tr>}
          {l.other > 0 && <tr><th>Other Allowance</th><td>{aed(l.other)}</td></tr>}
          <tr className="tot"><td>Total Monthly Salary</td><td>{aed(total)}</td></tr>
        </tbody>
      </table>
      <p style={{ fontSize: '10pt', marginTop: 0 }}><i>({aedWords(total)})</i></p>

      <b>Terms &amp; Conditions</b>
      {isOffer ? (
        <ol>
          <li>This offer is conditional upon successful completion of the UAE medical fitness test, issuance of the work permit and residence visa, and verification of your documents and references.</li>
          <li>Your employment will be governed by the UAE Federal Decree-Law No. 33 of 2021 on the Regulation of Labour Relations and its amendments.</li>
          <li>You will be required to comply with the Company’s policies, safety regulations and code of conduct.</li>
          <li>You are required to maintain strict confidentiality of all Company information, designs, processes and client data.</li>
          <li>This offer is valid until <b>{fmtDate(l.validUntil)}</b>. Please sign and return a copy of this letter to confirm your acceptance.</li>
        </ol>
      ) : (
        <ol>
          <li>Your appointment is subject to a probationary period of {l.probationMonths} months, during which your performance and conduct will be assessed. Employment is confirmed in writing upon satisfactory completion.</li>
          <li>Your employment is governed by the UAE Federal Decree-Law No. 33 of 2021 on the Regulation of Labour Relations and its amendments. End-of-service gratuity will be paid as per UAE labour law.</li>
          <li>Salary is paid monthly through the Wages Protection System (WPS). Deductions will be made only as permitted by law.</li>
          <li>You shall perform duties assigned by your supervisor, comply with Company policies, health &amp; safety rules and quality procedures, and take proper care of Company property.</li>
          <li>You shall not disclose any confidential or proprietary information of the Company during or after your employment.</li>
          <li>Either party may terminate this contract by giving {l.noticeDays} days’ written notice, in accordance with the law.</li>
        </ol>
      )}

      <p>
        {isOffer
          ? 'We look forward to welcoming you to the team and wish you a successful career with us.'
          : 'We welcome you to the Company and wish you every success in your new role.'}
      </p>

      <div className="sig">
        <div>
          <p style={{ margin: 0 }}>For <b>{COMPANY.name}</b></p>
          <div className="ln2" />
          <b>{l.signatoryName || '________________'}</b><br />{l.signatoryTitle}
          <div style={{ fontSize: '9pt', color: '#555' }}>Company Stamp</div>
        </div>
        <div>
          <p style={{ margin: 0 }}><b>{isOffer ? 'Acceptance of Offer' : 'Employee Acknowledgement'}</b></p>
          <div className="ln2" />
          Name: <b>{l.candidateName}</b><br />Signature &amp; Date: ____________________
        </div>
      </div>

      <div className="ft">{COMPANY.name} · {COMPANY.line}</div>
    </div>
  );
}

/* ───────────────────────── Main component ───────────────────────── */
interface Props {
  employees?: any[];          // optional: your HR employee list, used to prefill appointment letters
  currentUserName?: string;
}

export default function HRLetters({ employees = [], currentUserName = 'HR' }: Props) {
  const [tab, setTab] = useState<Kind>('offer');
  const [letters, setLetters] = useState<Letter[]>([]);
  const [view, setView] = useState<'list' | 'form' | 'preview'>('list');
  const [draft, setDraft] = useState<Partial<Letter>>({});
  const [current, setCurrent] = useState<Letter | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    const q = query(collection(db, 'hrLetters'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (s) => setLetters(s.docs.map((d) => ({ ...(d.data() as Letter), id: d.id }))));
  }, []);

  // keep preview in sync with live data
  useEffect(() => {
    if (current) {
      const fresh = letters.find((x) => x.id === current.id);
      if (fresh) setCurrent(fresh);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [letters]);

  const shown = useMemo(() => letters.filter((x) => x.kind === tab), [letters, tab]);
  const set = (k: keyof Letter, v: any) => setDraft((d) => ({ ...d, [k]: v }));

  const startNew = () => { setDraft(blank(tab, currentUserName)); setErr(''); setView('form'); };

  const startAppointmentFromOffer = (o: Letter) => {
    setTab('appointment');
    setDraft({
      ...blank('appointment', currentUserName),
      candidateName: o.candidateName, nationality: o.nationality, passportNo: o.passportNo,
      position: o.position, department: o.department, reportingTo: o.reportingTo, workLocation: o.workLocation,
      joiningDate: o.joiningDate, basic: o.basic, housing: o.housing, transport: o.transport, other: o.other,
      probationMonths: o.probationMonths, workHours: o.workHours, annualLeave: o.annualLeave,
      noticeDays: o.noticeDays, signatoryName: o.signatoryName, signatoryTitle: o.signatoryTitle, offerId: o.id,
    });
    setView('form');
  };

  const prefillFromEmployee = (id: string) => {
    const e = employees.find((x) => String(x.id) === id);
    if (!e) return;
    setDraft((d) => ({
      ...d,
      employeeId: String(e.employeeId ?? e.id ?? ''),
      candidateName: e.name ?? e.fullName ?? d.candidateName,
      nationality: e.nationality ?? d.nationality,
      position: e.designation ?? e.position ?? d.position,
      department: e.department ?? d.department,
    }));
  };

  const save = async () => {
    setErr('');
    if (!draft.candidateName?.trim() || !draft.position?.trim() || !draft.joiningDate || !(Number(draft.basic) > 0)) {
      setErr('Name, position, joining date and basic salary are required.');
      return;
    }
    if (draft.kind === 'offer' && !draft.validUntil) { setErr('Offer validity date is required.'); return; }
    setBusy(true);
    try {
      const id = draft.id ?? doc(collection(db, 'hrLetters')).id;
      const refNo = draft.refNo ?? (await nextRef(draft.kind as Kind));
      const full = {
        ...blank(draft.kind as Kind, currentUserName), ...draft, id, refNo,
        basic: Number(draft.basic) || 0, housing: Number(draft.housing) || 0,
        transport: Number(draft.transport) || 0, other: Number(draft.other) || 0,
        probationMonths: Number(draft.probationMonths) || 0, annualLeave: Number(draft.annualLeave) || 0,
        noticeDays: Number(draft.noticeDays) || 0, createdAt: draft.createdAt ?? new Date().toISOString(),
      } as Letter;
      // Only write undefined-free data (Firestore rejects undefined)
      const clean = JSON.parse(JSON.stringify(full));
      await setDoc(doc(db, 'hrLetters', id), clean, { merge: true });
      setCurrent(full); setView('preview');
    } catch (e: any) {
      setErr(e?.message || 'Save failed');
    } finally { setBusy(false); }
  };

  const markIssued = async (l: Letter) => { await updateDoc(doc(db, 'hrLetters', l.id), { status: 'issued' }); };

  const uploadSigned = async (l: Letter, file: File) => {
    if (file.size > 10 * 1024 * 1024) { alert('File too large (max 10 MB).'); return; }
    setBusy(true);
    try {
      const path = `hr-letters/${l.id}/signed-${Date.now()}-${file.name.replace(/[^\w.\-]/g, '_')}`;
      const r = sRef(storage, path);
      await uploadBytes(r, file, { contentType: file.type });
      const url = await getDownloadURL(r);
      await updateDoc(doc(db, 'hrLetters', l.id), {
        status: 'signed', signedUrl: url, signedName: file.name,
        signedAt: new Date().toISOString(), signedBy: currentUserName,
      });
    } catch (e: any) {
      alert('Upload failed: ' + (e?.message || e));
    } finally { setBusy(false); }
  };

  const remove = async (l: Letter) => {
    if (!confirm(`Delete ${l.refNo}? This cannot be undone.`)) return;
    await deleteDoc(doc(db, 'hrLetters', l.id));
  };

  const F = (label: string, k: keyof Letter, type = 'text') => (
    <label>{label}
      <input type={type} value={(draft[k] as any) ?? ''} onChange={(e) => set(k, e.target.value)} />
    </label>
  );

  /* ── Views ── */
  return (
    <div className="hrl">
      <style>{CSS}</style>

      {view === 'list' && (
        <>
          <h2>Offer &amp; Appointment Letters</h2>
          <div className="sub">Generate professional letters, print/save as PDF, and upload the signed copy.</div>
          <div className="bar">
            <button className={`tab ${tab === 'offer' ? 'on' : ''}`} onClick={() => setTab('offer')}><FileText size={15} /> Offer Letters</button>
            <button className={`tab ${tab === 'appointment' ? 'on' : ''}`} onClick={() => setTab('appointment')}><FileSignature size={15} /> Appointment Letters</button>
            <span style={{ flex: 1 }} />
            <button className="btn pri" onClick={startNew}><Plus size={15} /> New {tab === 'offer' ? 'Offer' : 'Appointment'} Letter</button>
          </div>

          <table className="list">
            <thead><tr><th>Ref No.</th><th>Name</th><th>Position</th><th>Joining</th><th>Status</th><th>Signed Copy</th><th style={{ width: 260 }}>Actions</th></tr></thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: '#6b7280', padding: 24 }}>No letters yet.</td></tr>}
              {shown.map((l) => (
                <tr key={l.id}>
                  <td>{l.refNo}</td>
                  <td>{l.candidateName}</td>
                  <td>{l.position}</td>
                  <td>{fmtDate(l.joiningDate)}</td>
                  <td><span className={`pill ${l.status}`}>{l.status.toUpperCase()}</span></td>
                  <td>{l.signedUrl ? <a href={l.signedUrl} target="_blank" rel="noreferrer"><ExternalLink size={13} /> View</a> : '—'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button className="btn" onClick={() => { setCurrent(l); setView('preview'); }}><Eye size={14} /> Open</button>
                      {l.kind === 'offer' && l.status === 'signed' && (
                        <button className="btn" onClick={() => startAppointmentFromOffer(l)}><FileSignature size={14} /> Appointment</button>
                      )}
                      <button className="btn bad" onClick={() => remove(l)}><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {view === 'form' && (
        <>
          <div className="bar">
            <button className="btn" onClick={() => setView(current ? 'preview' : 'list')}><ArrowLeft size={15} /> Back</button>
            <h2 style={{ margin: 0 }}>{draft.id ? 'Edit' : 'New'} {draft.kind === 'offer' ? 'Offer' : 'Appointment'} Letter</h2>
          </div>

          <div className="grid">
            <h4>Candidate / Employee</h4>
            {draft.kind === 'appointment' && employees.length > 0 && (
              <label>Pick existing employee (optional)
                <select defaultValue="" onChange={(e) => prefillFromEmployee(e.target.value)}>
                  <option value="">— select —</option>
                  {employees.map((e) => <option key={e.id} value={e.id}>{e.name ?? e.fullName}</option>)}
                </select>
              </label>
            )}
            {F('Full Name *', 'candidateName')}
            {F('Nationality', 'nationality')}
            {F('Passport No.', 'passportNo')}
            {draft.kind === 'appointment' && F('Employee ID', 'employeeId')}

            <h4>Position</h4>
            {F('Position / Designation *', 'position')}
            {F('Department', 'department')}
            {F('Reporting To', 'reportingTo')}
            {F('Place of Work', 'workLocation')}
            {F(draft.kind === 'offer' ? 'Proposed Joining Date *' : 'Effective Date *', 'joiningDate', 'date')}
            {F('Letter Date', 'issueDate', 'date')}
            {draft.kind === 'offer' && F('Offer Valid Until *', 'validUntil', 'date')}
            {draft.kind === 'appointment' && (
              <label>Contract Type
                <select value={draft.contractType} onChange={(e) => set('contractType', e.target.value)}>
                  <option>Unlimited</option><option>Fixed Term</option>
                </select>
              </label>
            )}

            <h4>Monthly Salary (AED)</h4>
            {F('Basic Salary *', 'basic', 'number')}
            {F('Housing Allowance', 'housing', 'number')}
            {F('Transport Allowance', 'transport', 'number')}
            {F('Other Allowance', 'other', 'number')}

            <h4>Terms</h4>
            {F('Probation (months)', 'probationMonths', 'number')}
            {F('Working Hours', 'workHours')}
            {F('Annual Leave (days)', 'annualLeave', 'number')}
            {F('Notice Period (days)', 'noticeDays', 'number')}

            <h4>Signatory</h4>
            {F('Signatory Name', 'signatoryName')}
            {F('Signatory Title', 'signatoryTitle')}
          </div>

          {err && <div style={{ color: '#b91c1c', marginBottom: 8, fontSize: 13 }}>{err}</div>}
          <button className="btn pri" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save & Preview'}</button>
        </>
      )}

      {view === 'preview' && current && (
        <>
          <div className="bar">
            <button className="btn" onClick={() => { setView('list'); setCurrent(null); }}><ArrowLeft size={15} /> All Letters</button>
            <span className={`pill ${current.status}`}>{current.status.toUpperCase()}</span>
            <span style={{ flex: 1 }} />
            {current.status === 'draft' && (
              <button className="btn" onClick={() => { setDraft(current); setView('form'); }}><Pencil size={14} /> Edit</button>
            )}
            <button className="btn" onClick={() => window.print()}><Printer size={14} /> Print / Save PDF</button>
            {current.status === 'draft' && (
              <button className="btn pri" onClick={() => markIssued(current)}><Send size={14} /> Mark as Issued</button>
            )}
            {current.status !== 'draft' && (
              <label className="btn ok" style={{ flexDirection: 'row', cursor: 'pointer', color: '#fff' }}>
                <Upload size={14} /> {current.signedUrl ? 'Replace Signed Copy' : 'Upload Signed Copy'}
                <input type="file" accept=".pdf,image/*" hidden disabled={busy}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadSigned(current, f); e.currentTarget.value = ''; }} />
              </label>
            )}
            {current.signedUrl && (
              <a className="btn" href={current.signedUrl} target="_blank" rel="noreferrer"><CheckCircle2 size={14} /> View Signed</a>
            )}
          </div>
          {busy && <div className="sub">Uploading…</div>}
          {current.signedAt && (
            <div className="sub">Signed copy “{current.signedName}” uploaded by {current.signedBy} on {new Date(current.signedAt).toLocaleString('en-GB')}</div>
          )}
          <div className="paper-wrap"><LetterDoc l={current} /></div>
        </>
      )}
    </div>
  );
}
