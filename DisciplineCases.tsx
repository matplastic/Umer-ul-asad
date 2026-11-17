import React, { useMemo, useState } from 'react';
import { Plus, Printer, Gavel, ChevronRight } from 'lucide-react';
import { Employee } from '../../types';
import {
  useHRCollection, HRCase, CaseStatus, CaseDecision, HRLetterLog, WarningLite, HRProfile,
  CASE_CATEGORIES, newId, nextRef, fmtD, todayStr, logAudit,
} from '../../lib/hrStore';
import { composeLetter, exportLetterPdf } from '../../lib/hrPdf';
import {
  Modal, Field, EmployeeSelect, inputCls, btnPrimary, btnGhost, StatCard, Badge, Empty, SearchBox, runSave, hrToast,
} from './hrUi';

interface Props {
  employees: Employee[];
  user?: string;
  warnings: WarningLite[];
  /** Adds the warning to the existing Warnings tab so both stay in sync. */
  onIssueWarning: (w: { id: string; employeeId: string; employeeName: string; type: 'Verbal' | 'Written' | 'Final'; reason: string; issuedAt: string; issuedBy: string }) => void;
}

const STAGES: CaseStatus[] = ['Reported', 'Investigation', 'Hearing', 'Decided', 'Closed'];
const stageTone = (s: CaseStatus) => s === 'Closed' ? 'emerald' : s === 'Decided' ? 'violet' : s === 'Reported' ? 'amber' : 'sky';
const DECISIONS: CaseDecision[] = ['No Action', 'Verbal Warning', 'Written Warning', 'Final Warning', 'Suspension', 'Termination'];

/** Progressive-discipline hint from the employee's warnings in the last 12 months. */
function suggestion(severity: HRCase['severity'], recent: WarningLite[]): { next: CaseDecision; why: string } {
  const has = (t: string) => recent.some(w => w.type === t);
  if (severity === 'Gross') return { next: 'Final Warning', why: 'Gross misconduct — consider Final Warning, Suspension or Termination (needs management approval).' };
  if (has('Final')) return { next: 'Termination', why: 'Already has a Final Warning in the last 12 months — termination review (needs management approval).' };
  if (has('Written')) return { next: 'Final Warning', why: 'Has a Written Warning in the last 12 months — next step is a Final Warning.' };
  if (has('Verbal')) return { next: 'Written Warning', why: 'Has a Verbal Warning in the last 12 months — next step is a Written Warning.' };
  return { next: severity === 'Major' ? 'Written Warning' : 'Verbal Warning', why: 'No warnings in the last 12 months — start with the first step.' };
}

export const DisciplineCases: React.FC<Props> = ({ employees, user, warnings, onIssueWarning }) => {
  const casesC = useHRCollection<HRCase>('hrCases');
  const lettersC = useHRCollection<HRLetterLog>('hrLetters');
  const profC = useHRCollection<HRProfile>('hrProfiles');
  const [q, setQ] = useState('');
  const [stageF, setStageF] = useState<'All' | 'Active' | CaseStatus>('Active');
  const [showNew, setShowNew] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const cases = casesC.items;
  const stats = useMemo(() => ({
    open: cases.filter(c => c.status !== 'Closed').length,
    inv: cases.filter(c => c.status === 'Investigation' || c.status === 'Hearing').length,
    ack: cases.filter(c => c.decision && c.decision !== 'No Action' && c.ackStatus === 'Pending').length,
    closed30: cases.filter(c => c.status === 'Closed' && (c.decidedAt || c.createdAt) >= new Date(Date.now() - 30 * 86400000).toISOString()).length,
  }), [cases]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return cases
      .filter(c => stageF === 'All' ? true : stageF === 'Active' ? c.status !== 'Closed' : c.status === stageF)
      .filter(c => !s || c.employeeName.toLowerCase().includes(s) || c.caseNo.toLowerCase().includes(s) || c.category.toLowerCase().includes(s))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [cases, q, stageF]);

  const open = cases.find(c => c.id === openId) || null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Open cases" value={stats.open} tone={stats.open ? 'amber' : 'slate'} onClick={() => setStageF('Active')} />
        <StatCard label="Investigation / hearing" value={stats.inv} tone="violet" />
        <StatCard label="Awaiting employee signature" value={stats.ack} tone={stats.ack ? 'rose' : 'slate'} />
        <StatCard label="Closed (30 days)" value={stats.closed30} tone="emerald" />
      </div>

      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox value={q} onChange={setQ} placeholder="Employee, case no. or type…" />
          <select className={inputCls + ' !w-auto'} value={stageF} onChange={e => setStageF(e.target.value as any)}>
            <option value="Active">All open</option><option value="All">Everything</option>
            {STAGES.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        <button className={btnPrimary} onClick={() => setShowNew(true)}><Plus className="h-4 w-4" />New case</button>
      </div>

      {shown.length === 0 ? <Empty text="No disciplinary cases match." /> : (
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
          {shown.map(c => (
            <button key={c.id} onClick={() => setOpenId(c.id)} className="w-full text-left px-4 py-3 hover:bg-slate-50 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-mono text-slate-400">{c.caseNo}</span>
                  <span className="font-bold text-slate-800 text-sm">{c.employeeName}</span>
                  <Badge tone={stageTone(c.status)}>{c.status}</Badge>
                  <Badge tone={c.severity === 'Gross' ? 'rose' : c.severity === 'Major' ? 'amber' : 'slate'}>{c.severity}</Badge>
                  {c.decision && <Badge tone="violet">{c.decision}</Badge>}
                  {c.decision && c.decision !== 'No Action' && c.ackStatus === 'Pending' && <Badge tone="rose">Unsigned</Badge>}
                </div>
                <div className="text-xs text-slate-500 truncate mt-0.5">{c.category} · {fmtD(c.incidentDate)} — {c.description}</div>
              </div>
              <ChevronRight className="h-4 w-4 text-slate-300" />
            </button>
          ))}
        </div>
      )}

      {showNew && <NewCase employees={employees} user={user} cases={cases} onClose={() => setShowNew(false)}
        save={async c => { const ok = await runSave(() => casesC.save(c), 'Case opened'); if (ok) { logAudit(user, 'Discipline', `Opened case ${c.caseNo}`, c.employeeName); setShowNew(false); setOpenId(c.id); } }} />}

      {open && <CaseDetail c={open} employees={employees} user={user} warnings={warnings} letters={lettersC.items}
        profile={profC.items.find(p => p.id === open.employeeId)}
        onClose={() => setOpenId(null)} saveCase={casesC.save} saveLetter={lettersC.save} onIssueWarning={onIssueWarning} />}
    </div>
  );
};

const NewCase: React.FC<{ employees: Employee[]; user?: string; cases: HRCase[]; onClose: () => void; save: (c: HRCase) => Promise<void> }> = ({ employees, user, cases, onClose, save }) => {
  const [f, setF] = useState({ employeeId: '', incidentDate: todayStr(), category: CASE_CATEGORIES[0], severity: 'Minor' as HRCase['severity'], description: '', reportedBy: user || '', witnesses: '' });
  const submit = () => {
    if (!f.employeeId || !f.description.trim() || !f.reportedBy.trim()) { hrToast('Employee, description and reported-by are required', 'err'); return; }
    const emp = employees.find(e => e.id === f.employeeId)!;
    const now = new Date().toISOString();
    save({
      id: newId('case'), caseNo: nextRef('DC', cases.map(c => c.caseNo)), employeeId: emp.id, employeeName: emp.name, department: emp.department,
      incidentDate: f.incidentDate, category: f.category, severity: f.severity, description: f.description.trim(), reportedBy: f.reportedBy.trim(),
      witnesses: f.witnesses.trim() || undefined, status: 'Reported', createdAt: now,
      history: [{ at: now, by: user || 'HR', action: 'Case opened' }],
    });
  };
  return (
    <Modal title="New disciplinary case" onClose={onClose} footer={<><button className={btnGhost} onClick={onClose}>Cancel</button><button className={btnPrimary} onClick={submit}>Open case</button></>}>
      <Field label="Employee *"><EmployeeSelect employees={employees} value={f.employeeId} onChange={id => setF(p => ({ ...p, employeeId: id }))} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Incident date"><input type="date" className={inputCls} value={f.incidentDate} onChange={e => setF(p => ({ ...p, incidentDate: e.target.value }))} /></Field>
        <Field label="Severity"><select className={inputCls} value={f.severity} onChange={e => setF(p => ({ ...p, severity: e.target.value as any }))}><option>Minor</option><option>Major</option><option>Gross</option></select></Field>
      </div>
      <Field label="Category"><select className={inputCls} value={f.category} onChange={e => setF(p => ({ ...p, category: e.target.value }))}>{CASE_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></Field>
      <Field label="What happened *"><textarea rows={3} className={inputCls + ' resize-none'} value={f.description} onChange={e => setF(p => ({ ...p, description: e.target.value }))} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Reported by *"><input className={inputCls} value={f.reportedBy} onChange={e => setF(p => ({ ...p, reportedBy: e.target.value }))} /></Field>
        <Field label="Witnesses"><input className={inputCls} value={f.witnesses} onChange={e => setF(p => ({ ...p, witnesses: e.target.value }))} /></Field>
      </div>
    </Modal>
  );
};

const CaseDetail: React.FC<{
  c: HRCase; employees: Employee[]; user?: string; warnings: WarningLite[]; letters: HRLetterLog[]; profile?: HRProfile;
  onClose: () => void; saveCase: (c: HRCase) => Promise<void>; saveLetter: (l: HRLetterLog) => Promise<void>;
  onIssueWarning: Props['onIssueWarning'];
}> = ({ c, employees, user, warnings, letters, profile, onClose, saveCase, saveLetter, onIssueWarning }) => {
  const emp = employees.find(e => e.id === c.employeeId);
  const [inv, setInv] = useState(c.investigationNotes || '');
  const [stmt, setStmt] = useState(c.employeeStatement || '');
  const [hearing, setHearing] = useState(c.hearingDate || '');
  const [decision, setDecision] = useState<CaseDecision>(c.decision || 'Verbal Warning');
  const [reason, setReason] = useState(c.decisionReason || '');
  const [susp, setSusp] = useState(c.suspensionDays || 1);
  const [mgr, setMgr] = useState(c.managerApprovedBy || '');

  const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString();
  const recent = warnings.filter(w => w.employeeId === c.employeeId && w.issuedAt >= yearAgo);
  const sug = suggestion(c.severity, recent);
  const heavy = decision === 'Suspension' || decision === 'Termination';
  const decided = !!c.decision;

  const push = (action: string) => [...c.history, { at: new Date().toISOString(), by: user || 'HR', action }];
  const update = async (patch: Partial<HRCase>, action: string, ok = 'Saved') => {
    const success = await runSave(() => saveCase({ ...c, ...patch, history: push(action) }), ok);
    if (success) logAudit(user, 'Discipline', `${c.caseNo}: ${action}`, c.employeeName);
    return success;
  };

  const moveTo = (status: CaseStatus) => update({ status, investigationNotes: inv || undefined, employeeStatement: stmt || undefined, hearingDate: hearing || undefined }, `Moved to ${status}`);

  const recordDecision = async () => {
    if (!reason.trim()) { hrToast('Write the reason for the decision', 'err'); return; }
    if (heavy && !mgr.trim()) { hrToast('Suspension / termination needs the manager’s approval name', 'err'); return; }
    let linkedWarningId = c.linkedWarningId;
    const wType = decision === 'Verbal Warning' ? 'Verbal' : decision === 'Written Warning' ? 'Written' : decision === 'Final Warning' ? 'Final' : null;
    if (wType && !linkedWarningId) {
      linkedWarningId = newId('hr');
      onIssueWarning({ id: linkedWarningId, employeeId: c.employeeId, employeeName: c.employeeName, type: wType, reason: `[${c.caseNo}] ${c.category}: ${reason.trim()}`, issuedAt: new Date().toISOString(), issuedBy: user || 'HR' });
    }
    await update({
      status: 'Decided', decision, decisionReason: reason.trim(), suspensionDays: decision === 'Suspension' ? susp : undefined,
      managerApprovedBy: heavy ? mgr.trim() : undefined, decidedBy: user || 'HR', decidedAt: new Date().toISOString(),
      ackStatus: decision === 'No Action' ? undefined : 'Pending', linkedWarningId,
      investigationNotes: inv || undefined, employeeStatement: stmt || undefined, hearingDate: hearing || undefined,
    }, `Decision: ${decision}`, 'Decision recorded');
  };

  const printLetter = async () => {
    if (!c.decision || c.decision === 'No Action') return;
    const person = { name: c.employeeName, department: c.department, gender: profile?.gender, designation: profile?.designation, passportNumber: emp?.passportNumber, nationality: emp?.passportCountry };
    const typeLabel = c.decision === 'Suspension' ? 'Suspension Notice' : c.decision === 'Termination' ? 'Termination Notice' : c.decision;
    const body = c.decision === 'Suspension'
      ? `${c.decisionReason}\n\nYou are suspended from duty for ${c.suspensionDays || 1} day(s) as per the company policy. Please report to HR at the end of the suspension.`
      : c.decision === 'Termination'
        ? `${c.decisionReason}\n\nYour employment will end in accordance with the UAE Labour Law and the terms of your contract. Please contact HR to complete the clearance process.`
        : c.decisionReason || '';
    const comp = composeLetter({ kind: 'Warning Letter', person, warningType: c.decision.replace(' Warning', ''), reason: body, incidentDate: c.incidentDate });
    const refNo = nextRef('MAT/HR', letters.map(l => l.refNo));
    await exportLetterPdf({
      refNo, date: todayStr(), addressedTo: comp.addressedTo, subject: c.decision === 'Suspension' || c.decision === 'Termination' ? typeLabel : comp.subject,
      paragraphs: comp.paragraphs, acknowledgment: true, signatoryTitle: 'Human Resources Department', filename: `${typeLabel.replace(/\s+/g, '_')}_${c.employeeName.replace(/\s+/g, '_')}`,
    });
    await saveLetter({ id: newId('lt'), refNo, type: typeLabel, employeeId: c.employeeId, employeeName: c.employeeName, issuedBy: user || 'HR', issuedAt: new Date().toISOString() });
    logAudit(user, 'Discipline', `${c.caseNo}: printed ${typeLabel}`, c.employeeName);
  };

  const stageIdx = STAGES.indexOf(c.status);
  return (
    <Modal wide title={`${c.caseNo} — ${c.employeeName}`} onClose={onClose}>
      {/* progress */}
      <div className="flex items-center gap-1 flex-wrap">
        {STAGES.map((s, i) => (
          <React.Fragment key={s}>
            <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${i <= stageIdx ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-400'}`}>{s}</span>
            {i < STAGES.length - 1 && <ChevronRight className="h-3 w-3 text-slate-300" />}
          </React.Fragment>
        ))}
      </div>

      <div className="bg-slate-50 rounded-lg p-3 text-sm space-y-1">
        <div><b>{c.category}</b> · {c.severity} · {fmtD(c.incidentDate)} · {c.department}</div>
        <div className="text-slate-600">{c.description}</div>
        <div className="text-xs text-slate-400">Reported by {c.reportedBy}{c.witnesses ? ` · Witnesses: ${c.witnesses}` : ''}</div>
      </div>

      {c.status !== 'Closed' && !decided && (
        <>
          <Field label="Investigation notes"><textarea rows={3} className={inputCls + ' resize-none'} value={inv} onChange={e => setInv(e.target.value)} placeholder="Findings, evidence, CCTV, supervisor statements…" /></Field>
          <Field label="Employee's statement"><textarea rows={2} className={inputCls + ' resize-none'} value={stmt} onChange={e => setStmt(e.target.value)} placeholder="What the employee says happened" /></Field>
          <Field label="Hearing date"><input type="date" className={inputCls + ' !w-auto'} value={hearing} onChange={e => setHearing(e.target.value)} /></Field>
          <div className="flex gap-2 flex-wrap">
            {c.status === 'Reported' && <button className={btnGhost} onClick={() => moveTo('Investigation')}>Start investigation</button>}
            {(c.status === 'Reported' || c.status === 'Investigation') && <button className={btnGhost} onClick={() => moveTo('Hearing')}>Move to hearing</button>}
            {c.status !== 'Reported' && <button className={btnGhost} onClick={() => update({ investigationNotes: inv || undefined, employeeStatement: stmt || undefined, hearingDate: hearing || undefined }, 'Notes updated')}>Save notes</button>}
          </div>

          <div className="border border-violet-200 bg-violet-50 rounded-xl p-3 space-y-3">
            <div className="flex items-center gap-2 text-sm font-black text-violet-800"><Gavel className="h-4 w-4" />Decision</div>
            <p className="text-xs text-violet-700">
              <b>Suggested: {sug.next}.</b> {sug.why}
              {recent.length > 0 && <> Warnings in last 12 months: {recent.map(w => w.type).join(', ')}.</>}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Decision"><select className={inputCls} value={decision} onChange={e => setDecision(e.target.value as CaseDecision)}>{DECISIONS.map(d => <option key={d}>{d}</option>)}</select></Field>
              {decision === 'Suspension' && <Field label="Suspension days"><input type="number" min={1} className={inputCls} value={susp} onChange={e => setSusp(Math.max(1, parseInt(e.target.value) || 1))} /></Field>}
              {heavy && <Field label="Approved by (manager) *"><input className={inputCls} value={mgr} onChange={e => setMgr(e.target.value)} /></Field>}
            </div>
            <Field label="Reason for decision *"><textarea rows={2} className={inputCls + ' resize-none'} value={reason} onChange={e => setReason(e.target.value)} /></Field>
            <button className={btnPrimary} onClick={recordDecision}>Record decision</button>
          </div>
        </>
      )}

      {decided && (
        <div className="border border-slate-200 rounded-xl p-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge tone="violet">{c.decision}</Badge>
            {c.decision === 'Suspension' && <Badge>{c.suspensionDays} day(s)</Badge>}
            <span className="text-xs text-slate-400">by {c.decidedBy} · {fmtD(c.decidedAt)}{c.managerApprovedBy ? ` · approved by ${c.managerApprovedBy}` : ''}</span>
          </div>
          <div className="text-sm text-slate-700">{c.decisionReason}</div>
          {c.decision !== 'No Action' && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button className={btnGhost} onClick={printLetter}><Printer className="h-3.5 w-3.5" />Print letter</button>
              <span className="text-xs text-slate-500">Employee signature:</span>
              <select className={inputCls + ' !w-auto !py-1 text-xs'} value={c.ackStatus || 'Pending'}
                onChange={e => update({ ackStatus: e.target.value as any, ackDate: todayStr() }, `Acknowledgment: ${e.target.value}`)}>
                <option>Pending</option><option>Acknowledged</option><option>Refused</option>
              </select>
              {c.ackDate && <span className="text-[11px] text-slate-400">{fmtD(c.ackDate)}</span>}
            </div>
          )}
          {c.status !== 'Closed' && <button className={btnPrimary} onClick={() => update({ status: 'Closed' }, 'Case closed', 'Case closed')}>Close case</button>}
          {c.status === 'Closed' && <button className={btnGhost} onClick={() => update({ status: 'Decided' }, 'Case reopened', 'Case reopened')}>Reopen</button>}
        </div>
      )}

      <details className="text-xs text-slate-500">
        <summary className="cursor-pointer font-bold">History ({c.history.length})</summary>
        <div className="mt-2 space-y-1">{[...c.history].reverse().map((h, i) => <div key={i}>{fmtD(h.at)} · <b>{h.by}</b> — {h.action}</div>)}</div>
      </details>
    </Modal>
  );
};
