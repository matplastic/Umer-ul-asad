import React, { useMemo, useState } from 'react';
import { Plus, Pin, Printer, Trash2, MessageSquareWarning, Megaphone } from 'lucide-react';
import { Employee } from '../../types';
import {
  useHRCollection, HRNotice, HRGrievance, newId, nextRef, todayStr, fmtD, daysUntil, logAudit,
} from '../../lib/hrStore';
import { exportLetterPdf } from '../../lib/hrPdf';
import {
  Modal, Field, EmployeeSelect, inputCls, btnPrimary, btnGhost, StatCard, Badge, Empty, SearchBox, SubTabs, runSave, useConfirm, hrToast,
} from './hrUi';

interface Props { employees: Employee[]; user?: string }

const catTone = (c: HRNotice['category']) => c === 'Urgent' ? 'rose' : c === 'Safety' ? 'amber' : c === 'Holiday' || c === 'Event' ? 'emerald' : c === 'Policy' ? 'violet' : 'slate';
const gStatusTone = (s: HRGrievance['status']) => s === 'Resolved' || s === 'Closed' ? 'emerald' : s === 'In Review' ? 'sky' : 'amber';

export const EmployeeRelations: React.FC<Props> = ({ employees, user }) => {
  const noticeC = useHRCollection<HRNotice>('hrNotices');
  const grievC = useHRCollection<HRGrievance>('hrGrievances');
  const [tab, setTab] = useState('notices');
  const [showNotice, setShowNotice] = useState(false);
  const [showGr, setShowGr] = useState(false);
  const [openG, setOpenG] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const { ask, node } = useConfirm();

  const departments = useMemo(() => Array.from(new Set(employees.map(e => e.department).filter(Boolean))).sort(), [employees]);
  const liveNotices = useMemo(() => [...noticeC.items]
    .filter(n => !n.expiresOn || (daysUntil(n.expiresOn) ?? 0) >= 0)
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.createdAt.localeCompare(a.createdAt)), [noticeC.items]);
  const expired = noticeC.items.length - liveNotices.length;

  const gr = useMemo(() => {
    const s = q.trim().toLowerCase();
    return [...grievC.items].filter(g => !s || g.subject.toLowerCase().includes(s) || (g.employeeName || '').toLowerCase().includes(s) || g.refNo.toLowerCase().includes(s))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [grievC.items, q]);
  const openCount = grievC.items.filter(g => g.status === 'Open' || g.status === 'In Review').length;
  const openedG = grievC.items.find(g => g.id === openG) || null;

  const printNotice = (n: HRNotice) => exportLetterPdf({
    refNo: `NOTICE/${n.createdAt.slice(0, 4)}`, date: n.createdAt.slice(0, 10), addressedTo: n.audience === 'All' ? 'To: All Employees' : `To: ${n.audience} Department`,
    subject: n.title, paragraphs: n.body.split(/\n+/).map(s => s.trim()).filter(Boolean), signatoryTitle: 'Human Resources Department', filename: `Notice_${n.title.replace(/\W+/g, '_').slice(0, 40)}`,
  });

  return (
    <div className="space-y-4">
      {node}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Active notices" value={liveNotices.length} tone="violet" icon={<Megaphone className="h-4 w-4" />} onClick={() => setTab('notices')} />
        <StatCard label="Open complaints / suggestions" value={openCount} tone={openCount ? 'amber' : 'slate'} icon={<MessageSquareWarning className="h-4 w-4" />} onClick={() => setTab('grievances')} />
        <StatCard label="Resolved" value={grievC.items.filter(g => g.status === 'Resolved' || g.status === 'Closed').length} tone="emerald" />
        <StatCard label="Suggestions received" value={grievC.items.filter(g => g.kind === 'Suggestion').length} tone="slate" />
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <SubTabs active={tab} onChange={setTab} tabs={[{ id: 'notices', label: 'Notice board' }, { id: 'grievances', label: 'Complaints & suggestions', badge: openCount }]} />
        {tab === 'notices'
          ? <button className={btnPrimary} onClick={() => setShowNotice(true)}><Plus className="h-4 w-4" />New notice</button>
          : <button className={btnPrimary} onClick={() => setShowGr(true)}><Plus className="h-4 w-4" />Log complaint / suggestion</button>}
      </div>

      {tab === 'notices' && (liveNotices.length === 0 ? <Empty text="No active notices." /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {liveNotices.map(n => (
            <div key={n.id} className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-1.5 flex-wrap">{n.pinned && <Pin className="h-3.5 w-3.5 text-violet-600" />}<span className="font-black text-slate-800 text-sm">{n.title}</span></div>
                <Badge tone={catTone(n.category)}>{n.category}</Badge>
              </div>
              <p className="text-sm text-slate-600 whitespace-pre-line">{n.body}</p>
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>{n.audience === 'All' ? 'All employees' : n.audience} · {fmtD(n.createdAt)}{n.expiresOn ? ` · until ${fmtD(n.expiresOn)}` : ''}</span>
                <span className="flex gap-2">
                  <button className={btnGhost} onClick={() => printNotice(n)}><Printer className="h-3 w-3" />Print</button>
                  <button className="text-slate-300 hover:text-rose-600" aria-label="Delete" onClick={async () => { if (!(await ask(`Delete notice "${n.title}"?`))) return; const ok = await runSave(() => noticeC.remove(n.id), 'Notice deleted'); if (ok) logAudit(user, 'Notice board', `Deleted "${n.title}"`); }}><Trash2 className="h-4 w-4" /></button>
                </span>
              </div>
            </div>
          ))}
          {expired > 0 && <p className="text-[11px] text-slate-400 col-span-full">{expired} expired notice(s) are hidden.</p>}
        </div>
      ))}

      {tab === 'grievances' && (<>
        <SearchBox value={q} onChange={setQ} placeholder="Subject, name or ref…" />
        {gr.length === 0 ? <Empty text="Nothing logged yet." /> : (
          <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
            {gr.map(g => (
              <button key={g.id} onClick={() => setOpenG(g.id)} className="w-full text-left px-4 py-3 hover:bg-slate-50">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-mono text-slate-400">{g.refNo}</span><span className="font-bold text-slate-800 text-sm">{g.subject}</span>
                  <Badge tone={g.kind === 'Suggestion' ? 'emerald' : g.kind === 'Grievance' ? 'rose' : 'amber'}>{g.kind}</Badge><Badge tone={gStatusTone(g.status)}>{g.status}</Badge>
                </div>
                <div className="text-xs text-slate-500 mt-0.5 truncate">{g.employeeName || 'Anonymous'} · {fmtD(g.createdAt)} — {g.details}</div>
              </button>
            ))}
          </div>
        )}
      </>)}

      {showNotice && <NewNotice departments={departments} user={user} onClose={() => setShowNotice(false)} save={async n => { const ok = await runSave(() => noticeC.save(n), 'Notice published'); if (ok) { logAudit(user, 'Notice board', `Published "${n.title}"`); setShowNotice(false); } }} />}
      {showGr && <NewGrievance employees={employees} user={user} existing={grievC.items} onClose={() => setShowGr(false)} save={async g => { const ok = await runSave(() => grievC.save(g), 'Logged'); if (ok) { logAudit(user, 'Employee relations', `Logged ${g.kind} ${g.refNo}`, g.employeeName); setShowGr(false); } }} />}
      {openedG && <GrievanceModal g={openedG} user={user} onClose={() => setOpenG(null)} save={grievC.save} />}
    </div>
  );
};

const NewNotice: React.FC<{ departments: string[]; user?: string; onClose: () => void; save: (n: HRNotice) => void }> = ({ departments, user, onClose, save }) => {
  const [f, setF] = useState({ title: '', body: '', category: 'General' as HRNotice['category'], audience: 'All', pinned: false, expiresOn: '' });
  return (
    <Modal title="New notice" onClose={onClose} footer={<><button className={btnGhost} onClick={onClose}>Cancel</button><button className={btnPrimary} onClick={() => {
      if (!f.title.trim() || !f.body.trim()) { hrToast('Title and message are required', 'err'); return; }
      save({ id: newId('nt'), title: f.title.trim(), body: f.body.trim(), category: f.category, audience: f.audience, pinned: f.pinned || undefined, expiresOn: f.expiresOn || undefined, createdBy: user, createdAt: new Date().toISOString() });
    }}>Publish</button></>}>
      <Field label="Title *"><input className={inputCls} value={f.title} onChange={e => setF(p => ({ ...p, title: e.target.value }))} /></Field>
      <Field label="Message *"><textarea rows={5} className={inputCls + ' resize-none'} value={f.body} onChange={e => setF(p => ({ ...p, body: e.target.value }))} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category"><select className={inputCls} value={f.category} onChange={e => setF(p => ({ ...p, category: e.target.value as any }))}>{['General', 'Safety', 'Policy', 'Holiday', 'Event', 'Urgent'].map(c => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Audience"><select className={inputCls} value={f.audience} onChange={e => setF(p => ({ ...p, audience: e.target.value }))}><option value="All">All employees</option>{departments.map(d => <option key={d}>{d}</option>)}</select></Field>
        <Field label="Hide after (optional)"><input type="date" className={inputCls} value={f.expiresOn} onChange={e => setF(p => ({ ...p, expiresOn: e.target.value }))} /></Field>
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-600 mt-6"><input type="checkbox" className="accent-violet-600" checked={f.pinned} onChange={e => setF(p => ({ ...p, pinned: e.target.checked }))} />Pin to top</label>
      </div>
    </Modal>
  );
};

const NewGrievance: React.FC<{ employees: Employee[]; user?: string; existing: HRGrievance[]; onClose: () => void; save: (g: HRGrievance) => void }> = ({ employees, user, existing, onClose, save }) => {
  const [f, setF] = useState({ kind: 'Complaint' as HRGrievance['kind'], employeeId: '', anonymous: false, subject: '', details: '' });
  return (
    <Modal title="Log complaint / suggestion" onClose={onClose} footer={<><button className={btnGhost} onClick={onClose}>Cancel</button><button className={btnPrimary} onClick={() => {
      if (!f.subject.trim() || !f.details.trim()) { hrToast('Subject and details are required', 'err'); return; }
      if (!f.anonymous && !f.employeeId) { hrToast('Choose the employee, or tick Anonymous', 'err'); return; }
      const emp = employees.find(e => e.id === f.employeeId);
      const now = new Date().toISOString();
      save({ id: newId('gr'), refNo: nextRef('GR', existing.map(g => g.refNo)), kind: f.kind, employeeId: f.anonymous ? undefined : emp?.id, employeeName: f.anonymous ? undefined : emp?.name,
        subject: f.subject.trim(), details: f.details.trim(), status: 'Open', history: [{ at: now, by: user || 'HR', action: 'Logged' }], createdAt: now });
    }}>Save</button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type"><select className={inputCls} value={f.kind} onChange={e => setF(p => ({ ...p, kind: e.target.value as any }))}><option>Complaint</option><option>Suggestion</option><option>Grievance</option></select></Field>
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-600 mt-6"><input type="checkbox" className="accent-violet-600" checked={f.anonymous} onChange={e => setF(p => ({ ...p, anonymous: e.target.checked }))} />Anonymous</label>
      </div>
      {!f.anonymous && <Field label="Raised by *"><EmployeeSelect employees={employees} value={f.employeeId} onChange={id => setF(p => ({ ...p, employeeId: id }))} /></Field>}
      <Field label="Subject *"><input className={inputCls} value={f.subject} onChange={e => setF(p => ({ ...p, subject: e.target.value }))} /></Field>
      <Field label="Details *"><textarea rows={4} className={inputCls + ' resize-none'} value={f.details} onChange={e => setF(p => ({ ...p, details: e.target.value }))} /></Field>
    </Modal>
  );
};

const GrievanceModal: React.FC<{ g: HRGrievance; user?: string; onClose: () => void; save: (g: HRGrievance) => Promise<void> }> = ({ g, user, onClose, save }) => {
  const [assigned, setAssigned] = useState(g.assignedTo || '');
  const [res, setRes] = useState(g.resolution || '');
  const upd = async (patch: Partial<HRGrievance>, action: string) => {
    const ok = await runSave(() => save({ ...g, ...patch, history: [...g.history, { at: new Date().toISOString(), by: user || 'HR', action }] }), 'Updated');
    if (ok) logAudit(user, 'Employee relations', `${g.refNo}: ${action}`, g.employeeName);
  };
  return (
    <Modal wide title={`${g.refNo} — ${g.subject}`} onClose={onClose}>
      <div className="flex gap-2 flex-wrap"><Badge tone={g.kind === 'Suggestion' ? 'emerald' : 'amber'}>{g.kind}</Badge><Badge tone={gStatusTone(g.status)}>{g.status}</Badge><span className="text-xs text-slate-400">{g.employeeName || 'Anonymous'} · {fmtD(g.createdAt)}</span></div>
      <p className="text-sm text-slate-700 bg-slate-50 rounded-lg p-3 whitespace-pre-line">{g.details}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Assigned to"><input className={inputCls} value={assigned} onChange={e => setAssigned(e.target.value)} onBlur={() => assigned !== (g.assignedTo || '') && upd({ assignedTo: assigned.trim() || undefined }, `Assigned to ${assigned || 'nobody'}`)} /></Field>
        <Field label="Status"><select className={inputCls} value={g.status} onChange={e => upd({ status: e.target.value as any }, `Status → ${e.target.value}`)}><option>Open</option><option>In Review</option><option>Resolved</option><option>Closed</option></select></Field>
      </div>
      <Field label="Resolution / response"><textarea rows={3} className={inputCls + ' resize-none'} value={res} onChange={e => setRes(e.target.value)} /></Field>
      <button className={btnGhost} onClick={() => upd({ resolution: res.trim() || undefined }, 'Resolution saved')}>Save resolution</button>
      <details className="text-xs text-slate-500"><summary className="cursor-pointer font-bold">History ({g.history.length})</summary>
        <div className="mt-2 space-y-1">{[...g.history].reverse().map((h, i) => <div key={i}>{fmtD(h.at)} · <b>{h.by}</b> — {h.action}</div>)}</div></details>
    </Modal>
  );
};
