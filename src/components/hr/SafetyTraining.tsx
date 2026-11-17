import React, { useMemo, useState } from 'react';
import { Plus, Trash2, ChevronDown, ChevronRight, ShieldCheck, HardHat, Siren } from 'lucide-react';
import { Employee } from '../../types';
import {
  useHRCollection, HRTraining, HRPPE, HRAccidentCase, HRProfile, AccidentLite,
  TRAINING_COURSES, MANDATORY_COURSES, PPE_ITEMS, newId, todayStr, daysUntil, expiryState, fmtD, logAudit,
} from '../../lib/hrStore';
import {
  Modal, Field, EmployeeSelect, inputCls, btnPrimary, btnGhost, StatCard, Badge, ExpiryBadge, Empty, SearchBox,
  SubTabs, SectionCard, runSave, useConfirm, hrToast,
} from './hrUi';

interface Props {
  employees: Employee[];
  user?: string;
  accidents: AccidentLite[];
  onAccidentStatus: (id: string, status: AccidentLite['status']) => void;
}

export const SafetyTraining: React.FC<Props> = ({ employees, user, accidents, onAccidentStatus }) => {
  const [tab, setTab] = useState('training');
  return (
    <div className="space-y-4">
      <SubTabs active={tab} onChange={setTab} tabs={[
        { id: 'training', label: 'Training & certificates' }, { id: 'ppe', label: 'PPE issue log' }, { id: 'followup', label: 'Accident follow-up' },
      ]} />
      {tab === 'training' && <TrainingPanel employees={employees} user={user} />}
      {tab === 'ppe' && <PPEPanel employees={employees} user={user} />}
      {tab === 'followup' && <FollowUpPanel employees={employees} user={user} accidents={accidents} onAccidentStatus={onAccidentStatus} />}
    </div>
  );
};

// ─── Training ───
const TrainingPanel: React.FC<{ employees: Employee[]; user?: string }> = ({ employees, user }) => {
  const trainC = useHRCollection<HRTraining>('hrTraining');
  const profC = useHRCollection<HRProfile>('hrProfiles');
  const [q, setQ] = useState('');
  const [courseF, setCourseF] = useState('All');
  const [stateF, setStateF] = useState<'all' | 'expired' | 'soon' | 'ok'>('all');
  const [showNew, setShowNew] = useState(false);
  const [openGap, setOpenGap] = useState<string | null>(null);
  const { ask, node } = useConfirm();

  const active = useMemo(() => {
    const st = new Map(profC.items.map(p => [p.id, p.status]));
    return employees.filter(e => !st.get(e.id) || st.get(e.id) === 'Active');
  }, [employees, profC.items]);

  const items = trainC.items;
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items
      .filter(t => courseF === 'All' || t.course === courseF)
      .filter(t => stateF === 'all' || expiryState(t.expiryDate, 30) === stateF)
      .filter(t => !s || t.employeeName.toLowerCase().includes(s) || t.course.toLowerCase().includes(s))
      .sort((a, b) => b.completedDate.localeCompare(a.completedDate));
  }, [items, q, courseF, stateF]);

  // Who has NO valid certificate for each mandatory course.
  const gaps = useMemo(() => MANDATORY_COURSES.map(course => {
    const valid = new Set(items.filter(t => t.course === course && expiryState(t.expiryDate, 0) !== 'expired').map(t => t.employeeId));
    return { course, missing: active.filter(e => !valid.has(e.id)) };
  }), [items, active]);

  const expired = items.filter(t => expiryState(t.expiryDate, 30) === 'expired').length;
  const soon = items.filter(t => expiryState(t.expiryDate, 30) === 'soon').length;

  return (
    <div className="space-y-4">
      {node}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Certificates on file" value={items.length} tone="violet" icon={<ShieldCheck className="h-4 w-4" />} />
        <StatCard label="Expired" value={expired} tone={expired ? 'rose' : 'slate'} onClick={() => setStateF('expired')} />
        <StatCard label="Expiring ≤ 30 days" value={soon} tone={soon ? 'amber' : 'slate'} onClick={() => setStateF('soon')} />
        <StatCard label="Mandatory gaps" value={gaps.reduce((s, g) => s + g.missing.length, 0)} sub="people missing a valid certificate" tone={gaps.some(g => g.missing.length) ? 'rose' : 'emerald'} />
      </div>

      <SectionCard title="Mandatory training — who is missing it">
        <div className="space-y-1">
          {gaps.map(g => (
            <div key={g.course}>
              <button className="w-full flex items-center justify-between text-sm py-1.5" onClick={() => setOpenGap(openGap === g.course ? null : g.course)}>
                <span className="flex items-center gap-1.5 font-semibold text-slate-700">{openGap === g.course ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}{g.course}</span>
                {g.missing.length === 0 ? <Badge tone="emerald">Everyone covered</Badge> : <Badge tone="rose">{g.missing.length} missing</Badge>}
              </button>
              {openGap === g.course && g.missing.length > 0 && (
                <div className="ml-6 mb-2 flex flex-wrap gap-1.5">{g.missing.map(e => <span key={e.id} className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">{e.name}</span>)}</div>
              )}
            </div>
          ))}
        </div>
      </SectionCard>

      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox value={q} onChange={setQ} placeholder="Employee or course…" />
          <select className={inputCls + ' !w-auto'} value={courseF} onChange={e => setCourseF(e.target.value)}><option>All</option>{TRAINING_COURSES.map(c => <option key={c}>{c}</option>)}</select>
          <select className={inputCls + ' !w-auto'} value={stateF} onChange={e => setStateF(e.target.value as any)}><option value="all">All</option><option value="expired">Expired</option><option value="soon">Expiring soon</option><option value="ok">Valid</option></select>
        </div>
        <button className={btnPrimary} onClick={() => setShowNew(true)}><Plus className="h-4 w-4" />Add training record</button>
      </div>

      {shown.length === 0 ? <Empty text="No training records match." /> : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase text-slate-400 border-b border-slate-100"><th className="px-4 py-2">Employee</th><th className="px-4 py-2">Course</th><th className="px-4 py-2">Completed</th><th className="px-4 py-2">Valid until</th><th className="px-4 py-2">Status</th><th className="px-4 py-2" /></tr></thead>
            <tbody className="divide-y divide-slate-50">
              {shown.map(t => (
                <tr key={t.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 font-semibold text-slate-800">{t.employeeName}</td>
                  <td className="px-4 py-2">{t.course}{t.certificateNo && <span className="text-slate-400 text-xs"> · {t.certificateNo}</span>}</td>
                  <td className="px-4 py-2">{fmtD(t.completedDate)}</td>
                  <td className="px-4 py-2">{fmtD(t.expiryDate)}</td>
                  <td className="px-4 py-2">{t.expiryDate ? <ExpiryBadge date={t.expiryDate} warnDays={30} /> : <Badge>No expiry</Badge>}</td>
                  <td className="px-4 py-2 text-right"><button className="text-slate-300 hover:text-rose-600" aria-label="Delete" onClick={async () => {
                    if (!(await ask(`Delete ${t.course} record for ${t.employeeName}?`))) return;
                    const ok = await runSave(() => trainC.remove(t.id), 'Record deleted'); if (ok) logAudit(user, 'Training', `Deleted ${t.course}`, t.employeeName);
                  }}><Trash2 className="h-4 w-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showNew && <NewTraining employees={employees} user={user} onClose={() => setShowNew(false)} save={async rs => {
        const ok = await runSave(async () => { for (const r of rs) await trainC.save(r); }, rs.length > 1 ? `${rs.length} records added` : 'Record added');
        if (ok) { logAudit(user, 'Training', `Added ${rs[0].course} for ${rs.length} employee(s)`, rs.length === 1 ? rs[0].employeeName : undefined); setShowNew(false); }
      }} />}
    </div>
  );
};

const NewTraining: React.FC<{ employees: Employee[]; user?: string; onClose: () => void; save: (r: HRTraining[]) => void }> = ({ employees, onClose, save }) => {
  const [course, setCourse] = useState(TRAINING_COURSES[0]);
  const [ids, setIds] = useState<string[]>([]);
  const [f, setF] = useState({ provider: '', completedDate: todayStr(), expiryDate: '', certificateNo: '', notes: '' });
  const [search, setSearch] = useState('');
  const list = employees.filter(e => !search || e.name.toLowerCase().includes(search.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
  const submit = () => {
    if (ids.length === 0) { hrToast('Select at least one employee', 'err'); return; }
    const now = new Date().toISOString();
    save(ids.map(id => {
      const e = employees.find(x => x.id === id)!;
      return { id: newId('tr'), employeeId: e.id, employeeName: e.name, course, provider: f.provider.trim() || undefined, completedDate: f.completedDate, expiryDate: f.expiryDate || undefined, certificateNo: f.certificateNo.trim() || undefined, notes: f.notes.trim() || undefined, createdAt: now };
    }));
  };
  return (
    <Modal wide title="Add training record" onClose={onClose} footer={<><button className={btnGhost} onClick={onClose}>Cancel</button><button className={btnPrimary} onClick={submit}>Save for {ids.length || 'selected'} employee(s)</button></>}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Course"><select className={inputCls} value={course} onChange={e => setCourse(e.target.value)}>{TRAINING_COURSES.map(c => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Provider / trainer"><input className={inputCls} value={f.provider} onChange={e => setF(p => ({ ...p, provider: e.target.value }))} /></Field>
        <Field label="Completed on"><input type="date" className={inputCls} value={f.completedDate} onChange={e => setF(p => ({ ...p, completedDate: e.target.value }))} /></Field>
        <Field label="Valid until (leave empty if none)"><input type="date" className={inputCls} value={f.expiryDate} onChange={e => setF(p => ({ ...p, expiryDate: e.target.value }))} /></Field>
        <Field label="Certificate no."><input className={inputCls} value={f.certificateNo} onChange={e => setF(p => ({ ...p, certificateNo: e.target.value }))} /></Field>
      </div>
      <Field label={`Employees who attended (${ids.length} selected)`}>
        <div className="flex gap-2 mb-2"><SearchBox value={search} onChange={setSearch} placeholder="Find…" />
          <button className={btnGhost} onClick={() => setIds(Array.from(new Set([...ids, ...list.map(e => e.id)])))}>Select shown</button>
          <button className={btnGhost} onClick={() => setIds([])}>Clear</button></div>
        <div className="border border-slate-200 rounded-lg max-h-56 overflow-y-auto divide-y divide-slate-50">
          {list.map(e => (
            <label key={e.id} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-slate-50">
              <input type="checkbox" className="accent-violet-600" checked={ids.includes(e.id)} onChange={() => setIds(p => p.includes(e.id) ? p.filter(x => x !== e.id) : [...p, e.id])} />
              {e.name}<span className="text-xs text-slate-400">{e.department}</span>
            </label>
          ))}
        </div>
      </Field>
    </Modal>
  );
};

// ─── PPE ───
const PPEPanel: React.FC<{ employees: Employee[]; user?: string }> = ({ employees, user }) => {
  const ppeC = useHRCollection<HRPPE>('hrPPE');
  const [q, setQ] = useState('');
  const [itemF, setItemF] = useState('All');
  const [view, setView] = useState<'issued' | 'due' | 'returned'>('issued');
  const [showNew, setShowNew] = useState(false);
  const { ask, node } = useConfirm();

  const items = ppeC.items;
  const due = items.filter(p => !p.returnedDate && p.replaceDueDate && (daysUntil(p.replaceDueDate) ?? 999) <= 14);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items
      .filter(p => view === 'returned' ? !!p.returnedDate : view === 'due' ? due.includes(p) : !p.returnedDate)
      .filter(p => itemF === 'All' || p.item === itemF)
      .filter(p => !s || p.employeeName.toLowerCase().includes(s))
      .sort((a, b) => b.issueDate.localeCompare(a.issueDate));
  }, [items, q, itemF, view, due]);

  return (
    <div className="space-y-4">
      {node}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard label="Items currently issued" value={items.filter(p => !p.returnedDate).reduce((s, p) => s + p.qty, 0)} tone="violet" icon={<HardHat className="h-4 w-4" />} onClick={() => setView('issued')} />
        <StatCard label="Replacement due / overdue" value={due.length} tone={due.length ? 'amber' : 'slate'} onClick={() => setView('due')} />
        <StatCard label="Returned" value={items.filter(p => p.returnedDate).length} tone="slate" onClick={() => setView('returned')} />
      </div>
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox value={q} onChange={setQ} placeholder="Employee…" />
          <select className={inputCls + ' !w-auto'} value={itemF} onChange={e => setItemF(e.target.value)}><option>All</option>{PPE_ITEMS.map(i => <option key={i}>{i}</option>)}</select>
          <select className={inputCls + ' !w-auto'} value={view} onChange={e => setView(e.target.value as any)}><option value="issued">Currently issued</option><option value="due">Due for replacement</option><option value="returned">Returned</option></select>
        </div>
        <button className={btnPrimary} onClick={() => setShowNew(true)}><Plus className="h-4 w-4" />Issue PPE</button>
      </div>
      {shown.length === 0 ? <Empty text="No PPE records here." /> : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase text-slate-400 border-b border-slate-100"><th className="px-4 py-2">Employee</th><th className="px-4 py-2">Item</th><th className="px-4 py-2">Qty</th><th className="px-4 py-2">Issued</th><th className="px-4 py-2">Replace by</th><th className="px-4 py-2" /></tr></thead>
            <tbody className="divide-y divide-slate-50">
              {shown.map(p => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 font-semibold text-slate-800">{p.employeeName}</td>
                  <td className="px-4 py-2">{p.item}{p.size && <span className="text-xs text-slate-400"> · {p.size}</span>}</td>
                  <td className="px-4 py-2">{p.qty}</td>
                  <td className="px-4 py-2">{fmtD(p.issueDate)}</td>
                  <td className="px-4 py-2">{p.returnedDate ? <Badge>Returned {fmtD(p.returnedDate)}</Badge> : p.replaceDueDate ? <span className="inline-flex items-center gap-2">{fmtD(p.replaceDueDate)}<ExpiryBadge date={p.replaceDueDate} warnDays={14} /></span> : '—'}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    {!p.returnedDate && <button className={btnGhost} onClick={async () => { const ok = await runSave(() => ppeC.save({ ...p, returnedDate: todayStr() }), 'Marked returned'); if (ok) logAudit(user, 'PPE', `Returned ${p.item}`, p.employeeName); }}>Returned</button>}
                    <button className="ml-2 text-slate-300 hover:text-rose-600" aria-label="Delete" onClick={async () => { if (!(await ask(`Delete this ${p.item} record for ${p.employeeName}?`))) return; const ok = await runSave(() => ppeC.remove(p.id), 'Record deleted'); if (ok) logAudit(user, 'PPE', `Deleted ${p.item}`, p.employeeName); }}><Trash2 className="h-4 w-4 inline" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showNew && <NewPPE employees={employees} user={user} onClose={() => setShowNew(false)} save={async rs => {
        const ok = await runSave(async () => { for (const r of rs) await ppeC.save(r); }, 'PPE issued');
        if (ok) { logAudit(user, 'PPE', `Issued ${rs.map(r => r.item).join(', ')}`, rs[0].employeeName); setShowNew(false); }
      }} />}
    </div>
  );
};

const NewPPE: React.FC<{ employees: Employee[]; user?: string; onClose: () => void; save: (r: HRPPE[]) => void }> = ({ employees, user, onClose, save }) => {
  const [empId, setEmpId] = useState('');
  const [issueDate, setIssueDate] = useState(todayStr());
  const [chosen, setChosen] = useState<Record<string, { qty: number; size: string; months: string }>>({});
  const toggle = (item: string) => setChosen(p => { const n = { ...p }; if (n[item]) delete n[item]; else n[item] = { qty: 1, size: '', months: '6' }; return n; });
  const submit = () => {
    const emp = employees.find(e => e.id === empId);
    if (!emp) { hrToast('Choose an employee', 'err'); return; }
    const keys = Object.keys(chosen);
    if (!keys.length) { hrToast('Tick at least one item', 'err'); return; }
    const now = new Date().toISOString();
    save(keys.map(item => {
      const c = chosen[item];
      const m = parseInt(c.months) || 0;
      let replace: string | undefined;
      if (m > 0) { const d = new Date(issueDate + 'T00:00:00'); d.setMonth(d.getMonth() + m); replace = todayStr(d); }
      return { id: newId('ppe'), employeeId: emp.id, employeeName: emp.name, item, size: c.size.trim() || undefined, qty: Math.max(1, c.qty), issueDate, replaceDueDate: replace, issuedBy: user, createdAt: now };
    }));
  };
  return (
    <Modal wide title="Issue PPE" onClose={onClose} footer={<><button className={btnGhost} onClick={onClose}>Cancel</button><button className={btnPrimary} onClick={submit}>Issue</button></>}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Employee *"><EmployeeSelect employees={employees} value={empId} onChange={setEmpId} /></Field>
        <Field label="Issue date"><input type="date" className={inputCls} value={issueDate} onChange={e => setIssueDate(e.target.value)} /></Field>
      </div>
      <div className="border border-slate-200 rounded-lg divide-y divide-slate-50">
        {PPE_ITEMS.map(item => {
          const c = chosen[item];
          return (
            <div key={item} className="px-3 py-2 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer min-w-[170px]"><input type="checkbox" className="accent-violet-600" checked={!!c} onChange={() => toggle(item)} />{item}</label>
              {c && (<>
                <label className="text-xs text-slate-500">Qty <input type="number" min={1} className="w-16 border border-slate-200 rounded px-2 py-1 text-sm" value={c.qty} onChange={e => setChosen(p => ({ ...p, [item]: { ...p[item], qty: parseInt(e.target.value) || 1 } }))} /></label>
                <label className="text-xs text-slate-500">Size <input className="w-20 border border-slate-200 rounded px-2 py-1 text-sm" value={c.size} onChange={e => setChosen(p => ({ ...p, [item]: { ...p[item], size: e.target.value } }))} /></label>
                <label className="text-xs text-slate-500">Replace after (months) <input type="number" min={0} className="w-16 border border-slate-200 rounded px-2 py-1 text-sm" value={c.months} onChange={e => setChosen(p => ({ ...p, [item]: { ...p[item], months: e.target.value } }))} /></label>
              </>)}
            </div>
          );
        })}
      </div>
    </Modal>
  );
};

// ─── Accident follow-up ───
const SEVERITIES: NonNullable<HRAccidentCase['severity']>[] = ['Near Miss', 'First Aid', 'Medical Treatment', 'Lost Time', 'Serious'];
const FollowUpPanel: React.FC<{ employees: Employee[]; user?: string; accidents: AccidentLite[]; onAccidentStatus: Props['onAccidentStatus'] }> = ({ user, accidents, onAccidentStatus }) => {
  const caseC = useHRCollection<HRAccidentCase>('hrAccidentCases');
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const cmap = useMemo(() => new Map(caseC.items.map(c => [c.id, c])), [caseC.items]);

  const sorted = useMemo(() => [...accidents].sort((a, b) => b.date.localeCompare(a.date)), [accidents]);
  const shown = sorted.filter(a => filter === 'all' || a.status !== 'Closed');
  const lastDate = sorted.length ? sorted[0].date : null;
  const sinceLast = lastDate ? -(daysUntil(lastDate) ?? 0) : null;
  const overdueActions = caseC.items.reduce((s, c) => s + c.actions.filter(a => !a.done && (daysUntil(a.dueDate) ?? 1) < 0).length, 0);
  const year = String(new Date().getFullYear());
  const lostTime = caseC.items.filter(c => (c.severity === 'Lost Time' || c.severity === 'Serious') && accidents.find(a => a.id === c.id)?.date.startsWith(year)).length;

  const open = accidents.find(a => a.id === openId) || null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Days since last accident" value={sinceLast ?? '—'} tone={sinceLast !== null && sinceLast < 30 ? 'amber' : 'emerald'} icon={<Siren className="h-4 w-4" />} sub={lastDate ? `Last: ${fmtD(lastDate)}` : 'No accidents recorded'} />
        <StatCard label="Open investigations" value={accidents.filter(a => a.status !== 'Closed').length} tone={accidents.some(a => a.status !== 'Closed') ? 'amber' : 'slate'} onClick={() => setFilter('open')} />
        <StatCard label="Overdue corrective actions" value={overdueActions} tone={overdueActions ? 'rose' : 'slate'} />
        <StatCard label={`Lost-time cases ${year}`} value={lostTime} tone={lostTime ? 'rose' : 'slate'} />
      </div>
      <div className="flex gap-2 items-center">
        <select className={inputCls + ' !w-auto'} value={filter} onChange={e => setFilter(e.target.value as any)}><option value="open">Open only</option><option value="all">All accidents</option></select>
        <span className="text-xs text-slate-400">New accidents are logged in the Accidents tab; manage the investigation and corrective actions here.</span>
      </div>
      {shown.length === 0 ? <Empty text="No accidents to follow up." /> : (
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
          {shown.map(a => {
            const c = cmap.get(a.id);
            const total = c?.actions.length || 0, done = c?.actions.filter(x => x.done).length || 0;
            return (
              <button key={a.id} onClick={() => setOpenId(a.id)} className="w-full text-left px-4 py-3 hover:bg-slate-50 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-slate-800 text-sm">{a.employeeName}</span>
                    <Badge tone={a.status === 'Closed' ? 'emerald' : a.status === 'Open' ? 'amber' : 'sky'}>{a.status}</Badge>
                    {c?.severity && <Badge tone={c.severity === 'Serious' || c.severity === 'Lost Time' ? 'rose' : 'slate'}>{c.severity}</Badge>}
                    {total > 0 && <Badge tone={done === total ? 'emerald' : 'amber'}>Actions {done}/{total}</Badge>}
                  </div>
                  <div className="text-xs text-slate-500 truncate mt-0.5">{fmtD(a.date)} · {a.department} — {a.description}</div>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-300" />
              </button>
            );
          })}
        </div>
      )}
      {open && <AccidentCaseModal acc={open} rec={cmap.get(open.id)} user={user} onClose={() => setOpenId(null)} save={caseC.save} onAccidentStatus={onAccidentStatus} />}
    </div>
  );
};

const AccidentCaseModal: React.FC<{ acc: AccidentLite; rec?: HRAccidentCase; user?: string; onClose: () => void; save: (c: HRAccidentCase) => Promise<void>; onAccidentStatus: Props['onAccidentStatus'] }> = ({ acc, rec, user, onClose, save, onAccidentStatus }) => {
  const [c, setC] = useState<HRAccidentCase>(rec || { id: acc.id, actions: [] });
  const [na, setNa] = useState({ action: '', owner: '', dueDate: '' });
  const persist = async (next: HRAccidentCase, msg = 'Saved') => {
    const rec2 = { ...next, updatedAt: new Date().toISOString() };
    setC(rec2);
    const ok = await runSave(() => save(rec2), msg);
    if (ok) logAudit(user, 'Accident follow-up', msg, acc.employeeName);
    return ok;
  };
  const addAction = () => {
    if (!na.action.trim() || !na.owner.trim() || !na.dueDate) { hrToast('Action, owner and due date are required', 'err'); return; }
    persist({ ...c, actions: [...c.actions, { id: newId('ac'), action: na.action.trim(), owner: na.owner.trim(), dueDate: na.dueDate, done: false }] }, 'Action added');
    setNa({ action: '', owner: '', dueDate: '' });
  };
  const allDone = c.actions.length > 0 && c.actions.every(a => a.done);
  return (
    <Modal wide title={`Accident — ${acc.employeeName} (${fmtD(acc.date)})`} onClose={onClose}>
      <div className="bg-slate-50 rounded-lg p-3 text-sm space-y-1">
        <div className="text-slate-700">{acc.description}</div>
        <div className="text-xs text-slate-500">Immediate action taken: {acc.actionTaken || '—'}</div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Severity"><select className={inputCls} value={c.severity || ''} onChange={e => setC(p => ({ ...p, severity: (e.target.value || undefined) as any }))}><option value="">—</option>{SEVERITIES.map(s => <option key={s}>{s}</option>)}</select></Field>
        <Field label="Lost working days"><input type="number" min={0} className={inputCls} value={c.lostDays ?? ''} onChange={e => setC(p => ({ ...p, lostDays: e.target.value === '' ? undefined : parseInt(e.target.value) || 0 }))} /></Field>
        <div className="flex items-end"><button className={btnGhost} onClick={() => persist(c, 'Investigation saved')}>Save</button></div>
      </div>
      <Field label="Root cause"><textarea rows={2} className={inputCls + ' resize-none'} value={c.rootCause || ''} onChange={e => setC(p => ({ ...p, rootCause: e.target.value || undefined }))} placeholder="Why did it happen? (unsafe act, missing guard, no PPE, training gap…)" /></Field>

      <SectionCard title={`Corrective & preventive actions (${c.actions.filter(a => a.done).length}/${c.actions.length})`}>
        {c.actions.length === 0 && <p className="text-xs text-slate-400 mb-2">No actions yet.</p>}
        <div className="space-y-1 mb-3">
          {c.actions.map(a => {
            const late = !a.done && (daysUntil(a.dueDate) ?? 1) < 0;
            return (
              <label key={a.id} className="flex items-start gap-2 text-sm py-1 cursor-pointer">
                <input type="checkbox" className="mt-0.5 accent-violet-600" checked={a.done} onChange={() => persist({ ...c, actions: c.actions.map(x => x.id === a.id ? { ...x, done: !x.done, doneAt: !x.done ? new Date().toISOString() : undefined } : x) }, 'Action updated')} />
                <span className={a.done ? 'line-through text-slate-400' : 'text-slate-700'}>{a.action}</span>
                <span className="ml-auto text-[11px] text-slate-400 whitespace-nowrap">{a.owner} · due {fmtD(a.dueDate)} {late && <Badge tone="rose">Overdue</Badge>}</span>
              </label>
            );
          })}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px_150px_auto] gap-2 items-end">
          <Field label="New action"><input className={inputCls} value={na.action} onChange={e => setNa(p => ({ ...p, action: e.target.value }))} /></Field>
          <Field label="Owner"><input className={inputCls} value={na.owner} onChange={e => setNa(p => ({ ...p, owner: e.target.value }))} /></Field>
          <Field label="Due"><input type="date" className={inputCls} value={na.dueDate} onChange={e => setNa(p => ({ ...p, dueDate: e.target.value }))} /></Field>
          <button className={btnPrimary} onClick={addAction}><Plus className="h-4 w-4" /></button>
        </div>
      </SectionCard>

      <div className="flex gap-2 flex-wrap">
        {acc.status === 'Open' && <button className={btnGhost} onClick={() => { onAccidentStatus(acc.id, 'Under Investigation'); logAudit(user, 'Accident follow-up', 'Moved to investigation', acc.employeeName); hrToast('Moved to Under Investigation'); }}>Start investigation</button>}
        {acc.status !== 'Closed' && <button className={btnPrimary} disabled={!allDone || !c.rootCause?.trim()}
          title={!allDone ? 'Add actions and complete them all first' : !c.rootCause?.trim() ? 'Record the root cause first' : ''}
          onClick={async () => { const ok = await persist({ ...c, closedAt: new Date().toISOString() }, 'Accident closed'); if (ok) onAccidentStatus(acc.id, 'Closed'); }}>Close accident</button>}
        {acc.status === 'Closed' && <button className={btnGhost} onClick={async () => { const ok = await persist({ ...c, closedAt: undefined }, 'Accident reopened'); if (ok) onAccidentStatus(acc.id, 'Under Investigation'); }}>Reopen</button>}
      </div>
      {acc.status !== 'Closed' && <p className="text-[11px] text-slate-400">To close: record the root cause and complete every corrective action.</p>}
    </Modal>
  );
};
