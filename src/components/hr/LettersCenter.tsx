import React, { useEffect, useMemo, useState } from 'react';
import { FileText, Printer } from 'lucide-react';
import { Employee } from '../../types';
import {
  useHRCollection, HRLetterLog, HRProfile, PayrollLite, newId, nextRef, todayStr, fmtD, logAudit,
} from '../../lib/hrStore';
import { composeLetter, exportLetterPdf, LetterKind, EmploymentTerms } from '../../lib/hrPdf';
import {
  Field, EmployeeSelect, inputCls, btnPrimary, SectionCard, Empty, Badge, SearchBox, runSave, hrToast,
} from './hrUi';

interface Props { employees: Employee[]; user?: string; payroll: PayrollLite[] }

const KINDS: { id: LetterKind; hint: string }[] = [
  { id: 'Offer Letter', hint: 'Job offer with salary & terms — for a new hire or candidate' },
  { id: 'Appointment Letter', hint: 'Confirms appointment, salary & terms for a joining employee' },
  { id: 'Experience Certificate', hint: 'For employees who have left, or a service letter' },
  { id: 'Salary Certificate', hint: 'For banks, visas, rent contracts' },
  { id: 'NOC', hint: 'No-objection for licence, travel, etc.' },
  { id: 'Appreciation Letter', hint: 'Recognise good work' },
  { id: 'Warning Letter', hint: 'Standalone warning (cases print their own)' },
  { id: 'Custom Letter', hint: 'Any other official letter' },
];

export const LettersCenter: React.FC<Props> = ({ employees, user, payroll }) => {
  const logC = useHRCollection<HRLetterLog>('hrLetters');
  const profC = useHRCollection<HRProfile>('hrProfiles');
  const [kind, setKind] = useState<LetterKind>('Experience Certificate');
  const [empId, setEmpId] = useState('');
  const [f, setF] = useState({ addressedTo: '', basic: '', allowances: '', purpose: '', reason: '', warningType: 'Written', incidentDate: todayStr(), subject: '', body: '', signatory: '', signatoryTitle: 'HR Manager', date: todayStr() });
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  // Offer / Appointment letter details
  const [cand, setCand] = useState({ name: '', nationality: '', passport: '', gender: '' });
  const [t, setT] = useState({
    position: '', department: '', reportingTo: '', workLocation: 'Umm Al Quwain, UAE', contractType: 'Limited (fixed-term)',
    joiningDate: '', probationMonths: '6', basic: '', housing: '', transport: '', other: '',
    workHours: '8 hours a day, 48 hours a week, with one weekly day off', annualLeave: '30', noticeDays: '30',
    validUntil: '', benefits: '', offerDate: '',
  });
  const isContract = kind === 'Offer Letter' || kind === 'Appointment Letter';
  const num = (v: string) => parseFloat(v) || 0;

  const emp = employees.find(e => e.id === empId);
  const prof = profC.items.find(p => p.id === empId);

  // Salary figures: profile basic first, else the latest payroll entry.
  useEffect(() => {
    if (!empId) return;
    const last = payroll.filter(p => p.employeeId === empId).sort((a, b) => b.month.localeCompare(a.month))[0];
    setF(p => ({ ...p, basic: String(prof?.basicSalary ?? last?.baseSalary ?? ''), allowances: String(last?.allowances ?? '') }));
  }, [empId, prof?.basicSalary, payroll]);

  // Pre-fill the offer / appointment terms from the employee's HR profile.
  useEffect(() => {
    if (!empId || !emp) return;
    setT(p => ({
      ...p,
      position: prof?.designation || emp.role || p.position,
      department: emp.department || p.department,
      reportingTo: prof?.reportingTo || p.reportingTo,
      joiningDate: prof?.joiningDate || p.joiningDate,
      basic: prof?.basicSalary ? String(prof.basicSalary) : p.basic,
    }));
  }, [empId, emp?.department, emp?.role, prof?.designation, prof?.reportingTo, prof?.joiningDate, prof?.basicSalary]);

  const person = useMemo(() => emp ? {
    name: emp.name, department: emp.department, gender: prof?.gender, designation: prof?.designation || emp.role || undefined,
    passportNumber: emp.passportNumber, nationality: emp.passportCountry, joiningDate: prof?.joiningDate, exitDate: prof?.exitDate,
  } : (isContract && cand.name.trim() ? {
    name: cand.name.trim(), nationality: cand.nationality.trim() || undefined, passportNumber: cand.passport.trim() || undefined,
    gender: (cand.gender || undefined) as 'Male' | 'Female' | undefined,
    department: t.department.trim() || undefined, designation: t.position.trim() || undefined,
  } : null), [emp, prof, isContract, cand, t.department, t.position]);

  const terms: EmploymentTerms | undefined = isContract ? {
    position: t.position.trim(), department: t.department.trim() || undefined, reportingTo: t.reportingTo.trim() || undefined,
    workLocation: t.workLocation.trim() || undefined, contractType: t.contractType || undefined, joiningDate: t.joiningDate || undefined,
    probationMonths: num(t.probationMonths), basic: num(t.basic), housing: num(t.housing), transport: num(t.transport), other: num(t.other),
    workHours: t.workHours.trim() || undefined, annualLeave: num(t.annualLeave) || undefined, noticeDays: num(t.noticeDays) || undefined,
    validUntil: t.validUntil || undefined, benefits: t.benefits.trim() || undefined, offerDate: t.offerDate || undefined,
  } : undefined;

  const composed = useMemo(() => person ? composeLetter({
    kind, person, addressedTo: f.addressedTo.trim() || undefined, basicSalary: parseFloat(f.basic) || 0, allowances: parseFloat(f.allowances) || 0,
    purpose: f.purpose.trim() || undefined, reason: f.reason.trim() || undefined, warningType: f.warningType, incidentDate: f.incidentDate,
    subject: f.subject.trim() || undefined, body: f.body, terms,
  }) : null, [kind, person, f, terms]);

  const missing: string[] = [];
  if (person && (kind === 'Experience Certificate') && !person.joiningDate) missing.push('joining date (Employee 360 → Overview)');
  if (person && (kind === 'Experience Certificate' || kind === 'Salary Certificate') && !person.designation) missing.push('designation (Employee 360 → Overview)');


  const generate = async () => {
    if (!person || !composed) { hrToast(isContract ? 'Type the name, or choose an employee' : 'Choose an employee first', 'err'); return; }
    if (isContract) {
      if (!t.position.trim()) { hrToast('Enter the position / job title', 'err'); return; }
      if (!(num(t.basic) > 0)) { hrToast('Enter the basic salary', 'err'); return; }
      if (!t.joiningDate) { hrToast('Enter the joining date', 'err'); return; }
    }
    if (kind === 'Custom Letter' && (!f.subject.trim() || !f.body.trim())) { hrToast('Enter a subject and the letter text', 'err'); return; }
    if (kind === 'Salary Certificate' && !(parseFloat(f.basic) > 0)) { hrToast('Enter the basic salary', 'err'); return; }
    setBusy(true);
    try {
      const refPrefix = kind === 'Offer Letter' ? 'MAT/HR/OFR' : kind === 'Appointment Letter' ? 'MAT/HR/APT' : 'MAT/HR';
      const refNo = nextRef(refPrefix, logC.items.map(l => l.refNo));
      await exportLetterPdf({
        refNo, date: f.date, addressedTo: composed.addressedTo, subject: composed.subject, paragraphs: composed.paragraphs,
        acknowledgment: composed.acknowledgment, acknowledgmentText: composed.acknowledgmentText,
        tables: composed.tables, closingParagraphs: composed.closingParagraphs, signatoryName: f.signatory.trim() || undefined, signatoryTitle: f.signatoryTitle.trim() || undefined,
        filename: `${composed.subject.replace(/\s+/g, '_')}_${person.name.replace(/\s+/g, '_')}`,
      });
      const ok = await runSave(() => logC.save({ id: newId('lt'), refNo, type: composed.subject, employeeId: empId || '', employeeName: person.name, issuedBy: user || 'HR', issuedAt: new Date().toISOString() }), `Letter ${refNo} generated`);
      if (ok) logAudit(user, 'Letters', `Issued ${composed.subject} (${refNo})`, person.name);
    } finally { setBusy(false); }
  };

  const log = useMemo(() => {
    const s = q.trim().toLowerCase();
    return [...logC.items].filter(l => !s || l.employeeName.toLowerCase().includes(s) || l.refNo.toLowerCase().includes(s) || l.type.toLowerCase().includes(s)).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt)).slice(0, 100);
  }, [logC.items, q]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-4">
      <div className="space-y-4 min-w-0">
        <SectionCard title="Create a letter">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-4">
            {KINDS.map(k => (
              <button key={k.id} onClick={() => setKind(k.id)}
                className={`text-left p-3 rounded-xl border transition-colors ${kind === k.id ? 'border-violet-500 bg-violet-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
                <div className="flex items-center gap-1.5 text-sm font-bold text-slate-800"><FileText className="h-3.5 w-3.5 text-violet-600" />{k.id}</div>
                <div className="text-[11px] text-slate-400 mt-0.5">{k.hint}</div>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={isContract ? 'Employee (optional — or just type the name below)' : 'Employee *'}><EmployeeSelect employees={employees} value={empId} onChange={setEmpId} placeholder={isContract ? 'Select employee, or type a name…' : undefined}
              onFreeText={isContract ? (n => setCand(p => ({ ...p, name: n }))) : undefined} freeText={isContract && !empId ? cand.name : ''} /></Field>
            <Field label="Letter date"><input type="date" className={inputCls} value={f.date} onChange={e => setF(p => ({ ...p, date: e.target.value }))} /></Field>
            <Field label="Addressed to (optional)"><input className={inputCls} value={f.addressedTo} onChange={e => setF(p => ({ ...p, addressedTo: e.target.value }))} placeholder="To Whom It May Concern" /></Field>
            {isContract && (<>
              {!empId && (<>
                <Field label={kind === 'Offer Letter' ? 'Candidate name *' : 'Employee name *'}><input className={inputCls} value={cand.name} onChange={e => setCand(p => ({ ...p, name: e.target.value }))} placeholder="Type the full name" /></Field>
                <Field label="Mr. / Ms. (optional)"><select className={inputCls} value={cand.gender} onChange={e => setCand(p => ({ ...p, gender: e.target.value }))}><option value="">— none —</option><option value="Male">Mr.</option><option value="Female">Ms.</option></select></Field>
                <Field label="Nationality"><input className={inputCls} value={cand.nationality} onChange={e => setCand(p => ({ ...p, nationality: e.target.value }))} /></Field>
                <Field label="Passport number"><input className={inputCls} value={cand.passport} onChange={e => setCand(p => ({ ...p, passport: e.target.value }))} /></Field>
              </>)}
              <Field label="Position / job title *"><input className={inputCls} value={t.position} onChange={e => setT(p => ({ ...p, position: e.target.value }))} /></Field>
              <Field label="Department"><input className={inputCls} value={t.department} onChange={e => setT(p => ({ ...p, department: e.target.value }))} /></Field>
              <Field label="Reporting to"><input className={inputCls} value={t.reportingTo} onChange={e => setT(p => ({ ...p, reportingTo: e.target.value }))} /></Field>
              <Field label="Place of work"><input className={inputCls} value={t.workLocation} onChange={e => setT(p => ({ ...p, workLocation: e.target.value }))} /></Field>
              <Field label="Contract type"><select className={inputCls} value={t.contractType} onChange={e => setT(p => ({ ...p, contractType: e.target.value }))}><option>Limited (fixed-term)</option><option>Unlimited</option><option>Part-time</option><option>Temporary</option></select></Field>
              <Field label={kind === 'Offer Letter' ? 'Expected joining date *' : 'Joining date *'}><input type="date" className={inputCls} value={t.joiningDate} onChange={e => setT(p => ({ ...p, joiningDate: e.target.value }))} /></Field>
              <Field label="Probation (months, 0 = none)"><input type="number" min="0" max="6" className={inputCls} value={t.probationMonths} onChange={e => setT(p => ({ ...p, probationMonths: e.target.value }))} /></Field>
              {kind === 'Offer Letter' && <Field label="Offer valid until"><input type="date" className={inputCls} value={t.validUntil} onChange={e => setT(p => ({ ...p, validUntil: e.target.value }))} /></Field>}
              {kind === 'Appointment Letter' && <Field label="Offer letter date (optional)"><input type="date" className={inputCls} value={t.offerDate} onChange={e => setT(p => ({ ...p, offerDate: e.target.value }))} /></Field>}
              <Field label="Basic salary (AED) *"><input type="number" className={inputCls} value={t.basic} onChange={e => setT(p => ({ ...p, basic: e.target.value }))} /></Field>
              <Field label="Housing allowance (AED)"><input type="number" className={inputCls} value={t.housing} onChange={e => setT(p => ({ ...p, housing: e.target.value }))} /></Field>
              <Field label="Transport allowance (AED)"><input type="number" className={inputCls} value={t.transport} onChange={e => setT(p => ({ ...p, transport: e.target.value }))} /></Field>
              <Field label="Other allowance (AED)"><input type="number" className={inputCls} value={t.other} onChange={e => setT(p => ({ ...p, other: e.target.value }))} /></Field>
              <Field label="Working hours" className="sm:col-span-2"><input className={inputCls} value={t.workHours} onChange={e => setT(p => ({ ...p, workHours: e.target.value }))} /></Field>
              <Field label="Annual leave (days)"><input type="number" className={inputCls} value={t.annualLeave} onChange={e => setT(p => ({ ...p, annualLeave: e.target.value }))} /></Field>
              <Field label="Notice period (days)"><input type="number" className={inputCls} value={t.noticeDays} onChange={e => setT(p => ({ ...p, noticeDays: e.target.value }))} /></Field>
              {kind === 'Offer Letter' && <Field label="Other benefits (optional)" className="sm:col-span-2"><input className={inputCls} value={t.benefits} onChange={e => setT(p => ({ ...p, benefits: e.target.value }))} placeholder="Employment visa, medical insurance, annual air ticket …" /></Field>}
            </>)}
            {kind === 'Salary Certificate' && (<>
              <Field label="Basic salary (AED) *"><input type="number" className={inputCls} value={f.basic} onChange={e => setF(p => ({ ...p, basic: e.target.value }))} /></Field>
              <Field label="Allowances (AED)"><input type="number" className={inputCls} value={f.allowances} onChange={e => setF(p => ({ ...p, allowances: e.target.value }))} /></Field>
            </>)}
            {(kind === 'Salary Certificate' || kind === 'NOC') && <Field label={kind === 'NOC' ? 'Purpose (what the NOC allows)' : 'Purpose (optional)'} className="sm:col-span-2"><input className={inputCls} value={f.purpose} onChange={e => setF(p => ({ ...p, purpose: e.target.value }))} placeholder={kind === 'NOC' ? 'obtaining a UAE driving licence' : 'opening a bank account'} /></Field>}
            {(kind === 'Appreciation Letter' || kind === 'Warning Letter') && <Field label={kind === 'Warning Letter' ? 'Reason / incident *' : 'Reason for appreciation'} className="sm:col-span-2"><textarea rows={3} className={inputCls + ' resize-none'} value={f.reason} onChange={e => setF(p => ({ ...p, reason: e.target.value }))} /></Field>}
            {kind === 'Warning Letter' && (<>
              <Field label="Warning type"><select className={inputCls} value={f.warningType} onChange={e => setF(p => ({ ...p, warningType: e.target.value }))}><option>Verbal</option><option>Written</option><option>Final</option></select></Field>
              <Field label="Incident date"><input type="date" className={inputCls} value={f.incidentDate} onChange={e => setF(p => ({ ...p, incidentDate: e.target.value }))} /></Field>
            </>)}
            {kind === 'Custom Letter' && (<>
              <Field label="Subject *" className="sm:col-span-2"><input className={inputCls} value={f.subject} onChange={e => setF(p => ({ ...p, subject: e.target.value }))} /></Field>
              <Field label="Letter text * (new line = new paragraph)" className="sm:col-span-2"><textarea rows={6} className={inputCls + ' resize-none'} value={f.body} onChange={e => setF(p => ({ ...p, body: e.target.value }))} /></Field>
            </>)}
            <Field label="Signatory name"><input className={inputCls} value={f.signatory} onChange={e => setF(p => ({ ...p, signatory: e.target.value }))} placeholder="Leave empty to print a blank line" /></Field>
            <Field label="Signatory title"><input className={inputCls} value={f.signatoryTitle} onChange={e => setF(p => ({ ...p, signatoryTitle: e.target.value }))} /></Field>
          </div>

          {missing.length > 0 && <p className="text-xs text-amber-600 font-semibold mt-3">Add the {missing.join(' and ')} first — the letter will show a placeholder otherwise.</p>}
        </SectionCard>

        <SectionCard title="Preview" right={<button className={btnPrimary} disabled={busy || !composed} onClick={generate}><Printer className="h-4 w-4" />Generate PDF</button>}>
          {!composed ? <Empty text={isContract ? 'Type the name (or choose an employee) to see the letter.' : 'Choose an employee to see the letter.'} /> : (
            <div className="bg-white border border-slate-200 rounded-lg p-6 text-sm text-slate-700 leading-relaxed space-y-3 max-w-2xl mx-auto shadow-sm">
              <div className="flex justify-between text-xs font-bold"><span>Ref: (assigned on generate)</span><span>Date: {fmtD(f.date)}</span></div>
              <div className="font-bold">{composed.addressedTo}</div>
              <div className="text-center font-black underline tracking-wide uppercase">{composed.subject}</div>
              {composed.paragraphs.map((p, i) => <p key={i}>{p}</p>)}
              {composed.tables?.map(tb => (
                <div key={tb.title} className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="bg-teal-700 text-white text-[11px] font-bold px-3 py-1.5">{tb.title}</div>
                  {tb.rows.map(([k, v], i) => (
                    <div key={i} className={`flex justify-between gap-3 px-3 py-1.5 text-xs border-t border-slate-100 ${tb.amount && i === tb.rows.length - 1 ? 'font-bold bg-teal-50' : ''}`}>
                      <span className="font-semibold text-slate-500">{k}</span><span className="text-right">{v}</span>
                    </div>
                  ))}
                </div>
              ))}
              {composed.closingParagraphs?.map((p, i) => <p key={`c${i}`}>{p}</p>)}
              <div className="pt-4 text-xs text-slate-500">Yours sincerely,<br /><b className="text-slate-700">{f.signatory || '____________'}</b><br />{f.signatoryTitle}</div>
            </div>
          )}
        </SectionCard>
      </div>

      <SectionCard title={`Letters issued (${logC.items.length})`}>
        <div className="mb-2"><SearchBox value={q} onChange={setQ} placeholder="Name, ref or type…" /></div>
        {log.length === 0 ? <Empty text="No letters issued yet." /> : (
          <div className="divide-y divide-slate-100 max-h-[70vh] overflow-y-auto">
            {log.map(l => (
              <div key={l.id} className="py-2">
                <div className="flex items-center justify-between gap-2"><span className="text-xs font-mono text-slate-400">{l.refNo}</span><Badge tone="violet">{l.type}</Badge></div>
                <div className="text-sm font-semibold text-slate-800">{l.employeeName}</div>
                <div className="text-[11px] text-slate-400">{fmtD(l.issuedAt)} · {l.issuedBy}</div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
};
