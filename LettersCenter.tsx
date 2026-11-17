import React, { useEffect, useMemo, useState } from 'react';
import { FileText, Printer } from 'lucide-react';
import { Employee } from '../../types';
import {
  useHRCollection, HRLetterLog, HRProfile, PayrollLite, newId, nextRef, todayStr, fmtD, logAudit,
} from '../../lib/hrStore';
import { composeLetter, exportLetterPdf, LetterKind } from '../../lib/hrPdf';
import {
  Field, EmployeeSelect, inputCls, btnPrimary, SectionCard, Empty, Badge, SearchBox, runSave, hrToast,
} from './hrUi';

interface Props { employees: Employee[]; user?: string; payroll: PayrollLite[] }

const KINDS: { id: LetterKind; hint: string }[] = [
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

  const emp = employees.find(e => e.id === empId);
  const prof = profC.items.find(p => p.id === empId);

  // Salary figures: profile basic first, else the latest payroll entry.
  useEffect(() => {
    if (!empId) return;
    const last = payroll.filter(p => p.employeeId === empId).sort((a, b) => b.month.localeCompare(a.month))[0];
    setF(p => ({ ...p, basic: String(prof?.basicSalary ?? last?.baseSalary ?? ''), allowances: String(last?.allowances ?? '') }));
  }, [empId, prof?.basicSalary, payroll]);

  const person = useMemo(() => emp ? {
    name: emp.name, department: emp.department, gender: prof?.gender, designation: prof?.designation || emp.role || undefined,
    passportNumber: emp.passportNumber, nationality: emp.passportCountry, joiningDate: prof?.joiningDate, exitDate: prof?.exitDate,
  } : null, [emp, prof]);

  const composed = useMemo(() => person ? composeLetter({
    kind, person, addressedTo: f.addressedTo.trim() || undefined, basicSalary: parseFloat(f.basic) || 0, allowances: parseFloat(f.allowances) || 0,
    purpose: f.purpose.trim() || undefined, reason: f.reason.trim() || undefined, warningType: f.warningType, incidentDate: f.incidentDate,
    subject: f.subject.trim() || undefined, body: f.body,
  }) : null, [kind, person, f]);

  const missing: string[] = [];
  if (person && (kind === 'Experience Certificate') && !person.joiningDate) missing.push('joining date (Employee 360 → Overview)');
  if (person && (kind === 'Experience Certificate' || kind === 'Salary Certificate') && !person.designation) missing.push('designation (Employee 360 → Overview)');

  const generate = async () => {
    if (!person || !composed) { hrToast('Choose an employee first', 'err'); return; }
    if (kind === 'Custom Letter' && (!f.subject.trim() || !f.body.trim())) { hrToast('Enter a subject and the letter text', 'err'); return; }
    if (kind === 'Salary Certificate' && !(parseFloat(f.basic) > 0)) { hrToast('Enter the basic salary', 'err'); return; }
    setBusy(true);
    try {
      const refNo = nextRef('MAT/HR', logC.items.map(l => l.refNo));
      await exportLetterPdf({
        refNo, date: f.date, addressedTo: composed.addressedTo, subject: composed.subject, paragraphs: composed.paragraphs,
        acknowledgment: composed.acknowledgment, signatoryName: f.signatory.trim() || undefined, signatoryTitle: f.signatoryTitle.trim() || undefined,
        filename: `${composed.subject.replace(/\s+/g, '_')}_${person.name.replace(/\s+/g, '_')}`,
      });
      const ok = await runSave(() => logC.save({ id: newId('lt'), refNo, type: composed.subject, employeeId: empId, employeeName: person.name, issuedBy: user || 'HR', issuedAt: new Date().toISOString() }), `Letter ${refNo} generated`);
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
            <Field label="Employee *"><EmployeeSelect employees={employees} value={empId} onChange={setEmpId} /></Field>
            <Field label="Letter date"><input type="date" className={inputCls} value={f.date} onChange={e => setF(p => ({ ...p, date: e.target.value }))} /></Field>
            <Field label="Addressed to (optional)"><input className={inputCls} value={f.addressedTo} onChange={e => setF(p => ({ ...p, addressedTo: e.target.value }))} placeholder="To Whom It May Concern" /></Field>
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
          {!composed ? <Empty text="Choose an employee to see the letter." /> : (
            <div className="bg-white border border-slate-200 rounded-lg p-6 text-sm text-slate-700 leading-relaxed space-y-3 max-w-2xl mx-auto shadow-sm">
              <div className="flex justify-between text-xs font-bold"><span>Ref: (assigned on generate)</span><span>Date: {fmtD(f.date)}</span></div>
              <div className="font-bold">{composed.addressedTo}</div>
              <div className="text-center font-black underline tracking-wide uppercase">{composed.subject}</div>
              {composed.paragraphs.map((p, i) => <p key={i}>{p}</p>)}
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
