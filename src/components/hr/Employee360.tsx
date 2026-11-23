import React, { useEffect, useMemo, useState } from 'react';
import { Save, Printer, Plus, Trash2, UserCheck, UserX, Phone, Briefcase, CalendarDays, ShieldAlert } from 'lucide-react';
import { Employee } from '../../types';
import {
  useHRCollection, HRProfile, HRDocument, HRLifecycle, HRCase, HRRequest, HRTraining, HRPPE, HRReview, HRVehicle, HRVehicleFine,
  LeaveLite, WarningLite, AccidentLite, MedicalLite, PayrollLite,
  ONBOARDING_TEMPLATE, EXIT_TEMPLATE, newId, fmtD, fmtAED, daysUntil, logAudit, todayStr,
} from '../../lib/hrStore';
import { exportEmployeeProfilePdf } from '../../lib/hrPdf';
import {
  Field, inputCls, btnPrimary, btnGhost, Badge, ExpiryBadge, SectionCard, SearchBox, SubTabs, Empty,
  runSave, useConfirm, hrToast,
} from './hrUi';
import { ImportButton } from './ExcelImport';
import { LeaveBalanceCard } from './LeaveBalance';
import { AddDocumentModal, DocFilesModal, DocRowActions, buildDocRows } from './DocumentsVault';

interface Props {
  employees: Employee[];
  user?: string;
  leaves: LeaveLite[];
  warnings: WarningLite[];
  accidents: AccidentLite[];
  medicals: MedicalLite[];
  payroll: PayrollLite[];
  initialEmployeeId?: string | null;
  /** change this number to jump to `initialEmployeeId` while the screen is already open (Ctrl+K) */
  focusNonce?: number;
  saveEmployees?: (list: Employee[]) => void | Promise<void>;
}

const statusTone = (s?: string) => s === 'Active' || !s ? 'emerald' : s === 'Resigned' ? 'amber' : 'rose';

export const Employee360: React.FC<Props> = ({ employees, user, leaves, warnings, accidents, medicals, payroll, initialEmployeeId, focusNonce, saveEmployees }) => {
  const profC = useHRCollection<HRProfile>('hrProfiles');
  const docsC = useHRCollection<HRDocument>('hrDocuments');
  const lifeC = useHRCollection<HRLifecycle>('hrLifecycle');
  const casesC = useHRCollection<HRCase>('hrCases');
  const reqC = useHRCollection<HRRequest>('hrRequests');
  const trainC = useHRCollection<HRTraining>('hrTraining');
  const ppeC = useHRCollection<HRPPE>('hrPPE');
  const revC = useHRCollection<HRReview>('hrReviews');
  const vehC = useHRCollection<HRVehicle>('hrVehicles');
  const fineC = useHRCollection<HRVehicleFine>('hrVehicleFines');

  const [selId, setSelId] = useState<string | null>(initialEmployeeId || null);
  useEffect(() => { if (focusNonce && initialEmployeeId) { setSelId(initialEmployeeId); setTab('overview'); setStatusF('All'); setQ(''); } }, [focusNonce, initialEmployeeId]);
  const [q, setQ] = useState('');
  const [statusF, setStatusF] = useState<'Active' | 'Former' | 'All'>('Active');
  const [tab, setTab] = useState('overview');
  const [addDoc, setAddDoc] = useState<null | { type?: string; number?: string; expiry?: string | null }>(null);
  const [filesDoc, setFilesDoc] = useState<HRDocument | null>(null);
  const { ask, node } = useConfirm();

  const profMap = useMemo(() => new Map(profC.items.map(p => [p.id, p])), [profC.items]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return employees
      .filter(e => {
        const st = profMap.get(e.id)?.status || 'Active';
        return statusF === 'All' || (statusF === 'Active' ? st === 'Active' : st !== 'Active');
      })
      .filter(e => !s || e.name.toLowerCase().includes(s) || (e.department || '').toLowerCase().includes(s) || e.id.toLowerCase().includes(s))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [employees, q, statusF, profMap]);

  const emp = employees.find(e => e.id === selId) || null;
  const prof = emp ? profMap.get(emp.id) : undefined;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
      {node}
      {/* ── Employee list ── */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2 lg:max-h-[78vh] flex flex-col">
        <SearchBox value={q} onChange={setQ} placeholder="Name, dept or ID…" />
        <ImportButton employees={employees} user={user} saveEmployees={saveEmployees} types={['profile', 'passport', 'documents']} initialType="profile" label="Import profiles from Excel" />
        <div className="flex gap-1">
          {(['Active', 'Former', 'All'] as const).map(s => (
            <button key={s} onClick={() => setStatusF(s)}
              className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${statusF === s ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-500 border-slate-200'}`}>{s}</button>
          ))}
        </div>
        <div className="overflow-y-auto divide-y divide-slate-50 -mx-1">
          {list.length === 0 && <div className="text-xs text-slate-400 p-4 text-center">No employees</div>}
          {list.map(e => (
            <button key={e.id} onClick={() => { setSelId(e.id); setTab('overview'); }}
              className={`w-full text-left px-3 py-2 rounded-lg ${selId === e.id ? 'bg-violet-50' : 'hover:bg-slate-50'}`}>
              <div className="text-sm font-semibold text-slate-800 truncate">{e.name}</div>
              <div className="text-[11px] text-slate-400 truncate">{e.department}{profMap.get(e.id)?.designation ? ` · ${profMap.get(e.id)!.designation}` : ''}</div>
            </button>
          ))}
        </div>
        <div className="text-[11px] text-slate-400 text-center pt-1">{list.length} shown</div>
      </div>

      {/* ── Detail ── */}
      {!emp ? (
        <Empty text="Select an employee to open their full profile." />
      ) : (
        <div className="space-y-4 min-w-0">
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center gap-4 justify-between">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-violet-100 text-violet-700 font-black text-lg flex items-center justify-center">
                {emp.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
              </div>
              <div>
                <div className="font-black text-slate-800 text-lg leading-tight">{emp.name}</div>
                <div className="text-xs text-slate-500">{prof?.designation || emp.role || 'Employee'} · {emp.department} · ID {emp.id}</div>
                <div className="mt-1 flex gap-1.5 flex-wrap">
                  <Badge tone={statusTone(prof?.status)}>{prof?.status || 'Active'}</Badge>
                  {prof?.employmentType && <Badge tone="violet">{prof.employmentType}</Badge>}
                  {emp.companyName && <Badge>{emp.companyName}</Badge>}
                </div>
              </div>
            </div>
            <button className={btnGhost} onClick={() => exportEmployeeProfilePdf({
              name: emp.name,
              basics: [
                ['Employee ID', emp.id], ['Department', emp.department], ['Designation', prof?.designation || emp.role || ''],
                ['Company (visa)', emp.companyName || ''], ['Employment type', prof?.employmentType || ''], ['Joining date', fmtD(prof?.joiningDate)],
                ['Date of birth', fmtD(prof?.dob)], ['Gender', prof?.gender || ''], ['Marital status', prof?.maritalStatus || ''],
                ['Nationality', emp.passportCountry || ''], ['Phone', emp.phone || ''], ['Email', emp.email || ''],
                ['Emergency contact', [prof?.emergencyName, prof?.emergencyRelation, prof?.emergencyPhone].filter(Boolean).join(' · ')],
                ['Status', prof?.status || 'Active'],
              ],
              profile: prof,
              documents: buildDocRows([emp], profC.items, docsC.items, emp.id).map(r => ({ docType: r.docType, docNumber: r.docNumber, expiryDate: r.expiryDate || undefined })),
              summary: [
                ['Warnings on file', String(warnings.filter(w => w.employeeId === emp.id).length)],
                ['Accidents on file', String(accidents.filter(a => a.employeeId === emp.id).length)],
                ['Leave records', String(leaves.filter(l => l.employeeId === emp.id).length)],
                ['Training records', String(trainC.items.filter(t => t.employeeId === emp.id).length)],
                ['Reviews', String(revC.items.filter(r => r.employeeId === emp.id).length)],
              ],
            })}><Printer className="h-3.5 w-3.5" />Print profile</button>
          </div>

          <SubTabs active={tab} onChange={setTab} tabs={[
            { id: 'overview', label: 'Overview' }, { id: 'docs', label: 'Documents' },
            { id: 'life', label: 'Onboarding / Exit' }, { id: 'timeline', label: 'Timeline' },
          ]} />

          {tab === 'overview' && (
            <OverviewForm key={emp.id} emp={emp} prof={prof} user={user} save={profC.save} leaves={leaves} />
          )}

          {tab === 'docs' && (
            <SectionCard title="Documents & expiry" right={<button className={btnGhost} onClick={() => setAddDoc({})}><Plus className="h-3.5 w-3.5" />Add</button>}>
              {(() => {
                const rows = buildDocRows([emp], profC.items, docsC.items, emp.id);
                if (!rows.length) return <Empty text="No documents tracked yet. Use Add to store a passport, ID or visa with its scan." />;
                return (
                  <div className="divide-y divide-slate-100">
                    {rows.map(r => (
                      <div key={r.key} className="flex flex-wrap items-center justify-between py-2 gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-800">{r.docType} {r.docNumber && <span className="text-slate-400 font-normal">· {r.docNumber}</span>}</div>
                          <div className="text-[11px] text-slate-400">Expires {fmtD(r.expiryDate)} · {r.source}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <ExpiryBadge date={r.expiryDate} />
                          <DocRowActions row={r} docsC={docsC} user={user} onFiles={setFilesDoc}
                            onAttach={row => setAddDoc({ type: row.docType, number: row.docNumber, expiry: row.expiryDate })} />
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </SectionCard>
          )}

          {tab === 'life' && (
            <Lifecycle emp={emp} user={user} items={lifeC.items.filter(l => l.employeeId === emp.id)}
              save={lifeC.save} patch={lifeC.patch} prof={prof} saveProfile={profC.save} />
          )}

          {tab === 'timeline' && (
            <Timeline emp={emp} prof={prof} leaves={leaves} warnings={warnings} accidents={accidents} medicals={medicals} payroll={payroll}
              vehicles={vehC.items} fines={fineC.items} cases={casesC.items} requests={reqC.items} training={trainC.items} ppe={ppeC.items} reviews={revC.items} docs={docsC.items} lifecycle={lifeC.items} />
          )}
        </div>
      )}
      {addDoc && emp && <AddDocumentModal employees={employees} presetEmployeeId={emp.id} presetType={addDoc.type} presetNumber={addDoc.number} presetExpiry={addDoc.expiry} user={user} onClose={() => setAddDoc(null)} save={docsC.save} />}
      {filesDoc && <DocFilesModal doc={filesDoc} user={user} docsC={docsC} onClose={() => setFilesDoc(null)} />}
    </div>
  );
};

// ─── Overview / profile form ───
const OverviewForm: React.FC<{ emp: Employee; prof?: HRProfile; user?: string; save: (p: HRProfile) => Promise<void>; leaves: LeaveLite[] }> = ({ emp, prof, user, save, leaves }) => {
  const [f, setF] = useState<HRProfile>(prof || { id: emp.id });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof HRProfile, v: any) => setF(p => ({ ...p, [k]: v === '' ? undefined : v }));
  const txt = (k: keyof HRProfile, label: string, type = 'text') => (
    <Field label={label}>
      <input type={type} className={inputCls} value={(f[k] as any) ?? ''}
        onChange={e => set(k, type === 'number' ? (e.target.value === '' ? '' : parseFloat(e.target.value)) : e.target.value)} />
    </Field>
  );
  const sel = (k: keyof HRProfile, label: string, opts: string[]) => (
    <Field label={label}>
      <select className={inputCls} value={(f[k] as any) ?? ''} onChange={e => set(k, e.target.value)}>
        <option value="">—</option>{opts.map(o => <option key={o}>{o}</option>)}
      </select>
    </Field>
  );
  const submit = async () => {
    setBusy(true);
    const rec = { ...f, id: emp.id, updatedAt: new Date().toISOString(), updatedBy: user };
    const ok = await runSave(() => save(rec), 'Profile saved');
    setBusy(false);
    if (ok) logAudit(user, 'Employee 360', 'Updated profile', emp.name);
  };
  const probDays = daysUntil(f.probationEndDate);
  const contractDays = daysUntil(f.contractEndDate);
  return (
    <div className="space-y-4">
      <LeaveBalanceCard employeeId={emp.id} joiningDate={prof?.joiningDate} leaves={leaves} />
      <SectionCard title="Employment">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {txt('designation', 'Designation / job title')}
          {sel('employmentType', 'Employment type', ['Permanent', 'Contract', 'Probation', 'Daily Wage'])}
          {txt('joiningDate', 'Joining date', 'date')}
          {txt('probationEndDate', 'Probation ends', 'date')}
          {txt('contractEndDate', 'Contract ends', 'date')}
          {txt('reportingTo', 'Reports to (supervisor)')}
          {txt('basicSalary', 'Basic salary (AED / month)', 'number')}
          {sel('status', 'Status', ['Active', 'Resigned', 'Terminated', 'Absconded'])}
        </div>
        {(probDays !== null && probDays >= 0 && probDays <= 30) && <p className="text-xs text-amber-600 mt-2 font-semibold">Probation ends in {probDays} day(s) — review due.</p>}
        {(contractDays !== null && contractDays >= 0 && contractDays <= 60) && <p className="text-xs text-amber-600 mt-1 font-semibold">Contract ends in {contractDays} day(s).</p>}
      </SectionCard>

      <SectionCard title="Personal">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {txt('dob', 'Date of birth', 'date')}
          {sel('gender', 'Gender', ['Male', 'Female'])}
          {sel('maritalStatus', 'Marital status', ['Single', 'Married'])}
          {sel('bloodGroup', 'Blood group', ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'])}
          {txt('uaeAddress', 'UAE address / accommodation')}
          {txt('homeAddress', 'Home country address')}
        </div>
      </SectionCard>

      <SectionCard title="Government IDs">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {txt('emiratesId', 'Emirates ID number')}
          {txt('emiratesIdExpiry', 'Emirates ID expiry', 'date')}
          {txt('labourCardNo', 'Labour card number')}
          {txt('labourCardExpiry', 'Labour card expiry', 'date')}
        </div>
        <p className="text-[11px] text-slate-400 mt-2">Visa and passport details are edited in the Directory and appear automatically in Documents.</p>
      </SectionCard>

      <SectionCard title="Emergency contact">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {txt('emergencyName', 'Name')}{txt('emergencyRelation', 'Relation')}{txt('emergencyPhone', 'Phone')}
        </div>
      </SectionCard>

      {(f.status && f.status !== 'Active') && (
        <SectionCard title="Exit details">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {txt('exitDate', 'Last working day', 'date')}{txt('exitReason', 'Reason')}
          </div>
        </SectionCard>
      )}
      <div className="flex justify-end">
        <button className={btnPrimary} disabled={busy} onClick={submit}><Save className="h-4 w-4" />Save profile</button>
      </div>
    </div>
  );
};

// ─── Onboarding / Exit checklists ───
const Lifecycle: React.FC<{
  emp: Employee; user?: string; items: HRLifecycle[]; prof?: HRProfile;
  save: (l: HRLifecycle) => Promise<void>; patch: (id: string, fn: (c: HRLifecycle) => HRLifecycle) => Promise<void>;
  saveProfile: (p: HRProfile) => Promise<void>;
}> = ({ emp, user, items, save, patch, prof, saveProfile }) => {
  const { ask, node } = useConfirm();
  const start = async (kind: 'Onboarding' | 'Exit') => {
    if (items.some(i => i.kind === kind && !i.completedAt)) { hrToast(`An ${kind.toLowerCase()} checklist is already open`, 'err'); return; }
    const tpl = kind === 'Onboarding' ? ONBOARDING_TEMPLATE : EXIT_TEMPLATE;
    const rec: HRLifecycle = {
      id: newId('life'), employeeId: emp.id, employeeName: emp.name, kind, startedAt: new Date().toISOString(),
      items: tpl.map(label => ({ id: newId('ci'), label, done: false })),
    };
    const ok = await runSave(() => save(rec), `${kind} checklist started`);
    if (ok) logAudit(user, 'Lifecycle', `Started ${kind} checklist`, emp.name);
  };
  const toggle = async (c: HRLifecycle, itemId: string) => {
    await runSave(() => patch(c.id, cur => {
      const its = cur.items.map(i => i.id === itemId
        ? { ...i, done: !i.done, doneAt: !i.done ? new Date().toISOString() : undefined, doneBy: !i.done ? user : undefined } : i);
      const all = its.every(i => i.done);
      return { ...cur, items: its, completedAt: all ? (cur.completedAt || new Date().toISOString()) : undefined };
    }), 'Updated');
  };
  const completeExit = async (c: HRLifecycle) => {
    if (c.kind !== 'Exit') return;
    if (!(await ask(`Mark ${emp.name} as Resigned / exited today? They will move to "Former" employees.`))) return;
    const ok = await runSave(() => saveProfile({ ...(prof || { id: emp.id }), id: emp.id, status: prof?.status && prof.status !== 'Active' ? prof.status : 'Resigned', exitDate: prof?.exitDate || todayStr(), updatedAt: new Date().toISOString(), updatedBy: user }), 'Employee marked as exited');
    if (ok) logAudit(user, 'Lifecycle', 'Marked employee exited', emp.name);
  };
  return (
    <div className="space-y-4">
      {node}
      <div className="flex gap-2">
        <button className={btnGhost} onClick={() => start('Onboarding')}><UserCheck className="h-3.5 w-3.5" />Start onboarding</button>
        <button className={btnGhost} onClick={() => start('Exit')}><UserX className="h-3.5 w-3.5" />Start exit clearance</button>
      </div>
      {items.length === 0 && <Empty text="No checklists yet for this employee." />}
      {[...items].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).map(c => {
        const done = c.items.filter(i => i.done).length;
        const pct = Math.round((done / Math.max(1, c.items.length)) * 100);
        return (
          <SectionCard key={c.id} title={`${c.kind} — started ${fmtD(c.startedAt)}`}
            right={<div className="flex items-center gap-2">{c.completedAt ? <Badge tone="emerald">Completed {fmtD(c.completedAt)}</Badge> : <Badge tone="amber">{done}/{c.items.length}</Badge>}
              {c.kind === 'Exit' && c.completedAt && <button className={btnGhost} onClick={() => completeExit(c)}>Mark employee exited</button>}</div>}>
            <div className="h-1.5 bg-slate-100 rounded-full mb-3 overflow-hidden"><div className="h-full bg-violet-500" style={{ width: `${pct}%` }} /></div>
            <div className="space-y-1">
              {c.items.map(i => (
                <label key={i.id} className="flex items-start gap-2 text-sm py-1 cursor-pointer">
                  <input type="checkbox" checked={i.done} onChange={() => toggle(c, i.id)} className="mt-0.5 accent-violet-600" />
                  <span className={i.done ? 'text-slate-400 line-through' : 'text-slate-700'}>{i.label}</span>
                  {i.done && i.doneAt && <span className="text-[10px] text-slate-300 ml-auto whitespace-nowrap">{fmtD(i.doneAt)}{i.doneBy ? ` · ${i.doneBy}` : ''}</span>}
                </label>
              ))}
            </div>
          </SectionCard>
        );
      })}
    </div>
  );
};

// ─── Unified timeline ───
interface Ev { at: string; kind: string; tone: 'slate' | 'violet' | 'emerald' | 'amber' | 'rose' | 'sky'; title: string; detail?: string }
const Timeline: React.FC<{
  emp: Employee; prof?: HRProfile; leaves: LeaveLite[]; warnings: WarningLite[]; accidents: AccidentLite[]; medicals: MedicalLite[];
  payroll: PayrollLite[]; cases: HRCase[]; requests: HRRequest[]; training: HRTraining[]; ppe: HRPPE[]; reviews: HRReview[];
  docs: HRDocument[]; lifecycle: HRLifecycle[]; vehicles: HRVehicle[]; fines: HRVehicleFine[];
}> = ({ emp, prof, leaves, warnings, accidents, medicals, cases, requests, training, ppe, reviews, lifecycle, vehicles, fines }) => {
  const [filter, setFilter] = useState('All');
  const events = useMemo(() => {
    const id = emp.id;
    const ev: Ev[] = [];
    if (prof?.joiningDate) ev.push({ at: prof.joiningDate, kind: 'Employment', tone: 'emerald', title: 'Joined the company', detail: prof.designation });
    if (prof?.exitDate && prof.status && prof.status !== 'Active') ev.push({ at: prof.exitDate, kind: 'Employment', tone: 'rose', title: prof.status, detail: prof.exitReason });
    leaves.filter(l => l.employeeId === id).forEach(l => ev.push({ at: l.fromDate, kind: 'Leave', tone: l.status === 'Approved' ? 'sky' : l.status === 'Rejected' ? 'rose' : 'amber', title: `${l.leaveType} leave · ${l.days} day(s) · ${l.status}`, detail: `${fmtD(l.fromDate)} → ${fmtD(l.toDate)}` }));
    warnings.filter(w => w.employeeId === id).forEach(w => ev.push({ at: w.issuedAt, kind: 'Discipline', tone: 'rose', title: `${w.type} warning`, detail: w.reason }));
    cases.filter(c => c.employeeId === id).forEach(c => ev.push({ at: c.incidentDate, kind: 'Discipline', tone: 'rose', title: `Case ${c.caseNo} · ${c.category} · ${c.status}`, detail: c.decision ? `Decision: ${c.decision}` : c.description }));
    accidents.filter(a => a.employeeId === id).forEach(a => ev.push({ at: a.date, kind: 'Safety', tone: 'amber', title: `Accident report · ${a.status}`, detail: a.description }));
    medicals.filter(m => m.employeeId === id).forEach(m => ev.push({ at: m.date, kind: 'Medical', tone: 'sky', title: 'Medical record', detail: m.disease }));
    requests.filter(r => r.employeeId === id).forEach(r => ev.push({ at: r.createdAt, kind: 'Request', tone: r.status === 'Approved' || r.status === 'Completed' ? 'emerald' : r.status === 'Rejected' ? 'rose' : 'amber', title: `${r.type} · ${r.status}`, detail: r.amount ? fmtAED(r.amount) : r.reason }));
    training.filter(t => t.employeeId === id).forEach(t => ev.push({ at: t.completedDate, kind: 'Training', tone: 'violet', title: t.course, detail: t.expiryDate ? `Valid until ${fmtD(t.expiryDate)}` : undefined }));
    ppe.filter(p => p.employeeId === id).forEach(p => ev.push({ at: p.issueDate, kind: 'PPE', tone: 'slate', title: `${p.item} issued (×${p.qty})`, detail: p.returnedDate ? `Returned ${fmtD(p.returnedDate)}` : undefined }));
    reviews.filter(r => r.employeeId === id).forEach(r => ev.push({ at: r.createdAt, kind: 'Review', tone: 'violet', title: `Performance review ${r.period} · ${r.overall.toFixed(1)}/5`, detail: r.recommendation !== 'None' ? r.recommendation : undefined }));
    lifecycle.filter(l => l.employeeId === id).forEach(l => ev.push({ at: l.startedAt, kind: 'Employment', tone: 'slate', title: `${l.kind} checklist started`, detail: l.completedAt ? `Completed ${fmtD(l.completedAt)}` : undefined }));
    vehicles.forEach(v => v.assignments.filter(a => a.employeeId === id).forEach(a => {
      ev.push({ at: a.from, kind: 'Vehicle', tone: 'sky', title: `Vehicle ${v.plate} assigned`, detail: `${v.make} ${v.model}${a.startKm != null ? ` · ${a.startKm.toLocaleString()} km` : ''}` });
      if (a.to) ev.push({ at: a.to, kind: 'Vehicle', tone: 'slate', title: `Vehicle ${v.plate} returned`, detail: a.endKm != null && a.startKm != null ? `${(a.endKm - a.startKm).toLocaleString()} km driven` : undefined });
    }));
    fines.filter(f => f.employeeId === id).forEach(f => ev.push({ at: f.date, kind: 'Vehicle', tone: f.status === 'Unpaid' ? 'rose' : 'amber', title: `${f.kind} · ${fmtAED(f.amount)} · ${f.status}`, detail: `${f.plate}${f.reference ? ` · ${f.reference}` : ''}` }));
    return ev.filter(e => e.at).sort((a, b) => b.at.localeCompare(a.at));
  }, [emp.id, prof, leaves, warnings, accidents, medicals, cases, requests, training, ppe, reviews, lifecycle, vehicles, fines]);

  const kinds = ['All', ...Array.from(new Set(events.map(e => e.kind)))];
  const shown = events.filter(e => filter === 'All' || e.kind === filter);
  const icon = (k: string) => k === 'Safety' ? <ShieldAlert className="h-3.5 w-3.5" /> : k === 'Leave' ? <CalendarDays className="h-3.5 w-3.5" /> : k === 'Request' ? <Phone className="h-3.5 w-3.5" /> : <Briefcase className="h-3.5 w-3.5" />;
  const dot: Record<string, string> = { slate: 'bg-slate-400', violet: 'bg-violet-500', emerald: 'bg-emerald-500', amber: 'bg-amber-500', rose: 'bg-rose-500', sky: 'bg-sky-500' };
  return (
    <SectionCard title={`Timeline (${shown.length})`} right={
      <select className={inputCls + ' !w-auto !py-1 text-xs'} value={filter} onChange={e => setFilter(e.target.value)}>{kinds.map(k => <option key={k}>{k}</option>)}</select>}>
      {shown.length === 0 ? <Empty text="Nothing recorded for this employee yet." /> : (
        <div className="relative pl-5 space-y-3 max-h-[60vh] overflow-y-auto">
          <div className="absolute left-[7px] top-1 bottom-1 w-px bg-slate-200" />
          {shown.map((e, i) => (
            <div key={i} className="relative">
              <span className={`absolute -left-[18px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-white ${dot[e.tone]}`} />
              <div className="flex items-center gap-2 text-[11px] text-slate-400">{icon(e.kind)}<span className="font-bold uppercase tracking-wide">{e.kind}</span><span>· {fmtD(e.at)}</span></div>
              <div className="text-sm font-semibold text-slate-800">{e.title}</div>
              {e.detail && <div className="text-xs text-slate-500">{e.detail}</div>}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
};
