import React, { useMemo, useState } from 'react';
import { Plus, Printer, Star, Trash2 } from 'lucide-react';
import { Employee } from '../../types';
import {
  useHRCollection, HRCandidate, HRVacancy, HRLetterLog, CANDIDATE_STAGES, CandidateStage,
  newId, nextRef, todayStr, fmtD, fmtAED, logAudit,
} from '../../lib/hrStore';
import { composeLetter, exportLetterPdf } from '../../lib/hrPdf';
import {
  Modal, Field, inputCls, btnPrimary, btnGhost, StatCard, Badge, Empty, SearchBox, SubTabs, runSave, useConfirm, hrToast,
} from './hrUi';

interface Props { employees: Employee[]; user?: string }

const stageTone = (s: CandidateStage) => s === 'Hired' ? 'emerald' : s === 'Rejected' ? 'rose' : s === 'Offer' ? 'violet' : s === 'Applied' ? 'slate' : 'sky';
const SOURCES = ['Walk-in', 'Referral', 'Agency', 'Job portal', 'Social media', 'Other'];

export const Recruitment: React.FC<Props> = ({ employees, user }) => {
  const candC = useHRCollection<HRCandidate>('hrCandidates');
  const vacC = useHRCollection<HRVacancy>('hrVacancies');
  const lettersC = useHRCollection<HRLetterLog>('hrLetters');
  const [tab, setTab] = useState('pipeline');
  const [q, setQ] = useState('');
  const [vacF, setVacF] = useState('All');
  const [showNew, setShowNew] = useState(false);
  const [showVac, setShowVac] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const { ask, node } = useConfirm();

  const cands = candC.items;
  const departments = useMemo(() => Array.from(new Set(employees.map(e => e.department).filter(Boolean))).sort(), [employees]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return cands.filter(c => vacF === 'All' || c.vacancyId === vacF)
      .filter(c => !s || c.name.toLowerCase().includes(s) || c.position.toLowerCase().includes(s));
  }, [cands, q, vacF]);

  const monthStart = todayStr().slice(0, 8) + '01';
  const stats = {
    openVac: vacC.items.filter(v => v.status === 'Open').length,
    active: cands.filter(c => c.stage !== 'Hired' && c.stage !== 'Rejected').length,
    offers: cands.filter(c => c.stage === 'Offer').length,
    hired: cands.filter(c => c.stage === 'Hired' && (c.updatedAt || c.createdAt).slice(0, 10) >= monthStart).length,
  };
  const open = cands.find(c => c.id === openId) || null;

  return (
    <div className="space-y-4">
      {node}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Open vacancies" value={stats.openVac} tone="violet" onClick={() => setTab('vacancies')} />
        <StatCard label="Active candidates" value={stats.active} tone="slate" onClick={() => setTab('pipeline')} />
        <StatCard label="Offers out" value={stats.offers} tone={stats.offers ? 'amber' : 'slate'} />
        <StatCard label="Hired this month" value={stats.hired} tone="emerald" />
      </div>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <SubTabs active={tab} onChange={setTab} tabs={[{ id: 'pipeline', label: 'Candidate pipeline' }, { id: 'vacancies', label: 'Vacancies' }]} />
        <div className="flex gap-2">
          <button className={btnGhost} onClick={() => setShowVac(true)}><Plus className="h-3.5 w-3.5" />Vacancy</button>
          <button className={btnPrimary} onClick={() => setShowNew(true)}><Plus className="h-4 w-4" />Add candidate</button>
        </div>
      </div>

      {tab === 'pipeline' && (<>
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox value={q} onChange={setQ} placeholder="Name or position…" />
          <select className={inputCls + ' !w-auto'} value={vacF} onChange={e => setVacF(e.target.value)}>
            <option value="All">All vacancies</option>{vacC.items.map(v => <option key={v.id} value={v.id}>{v.title}</option>)}
          </select>
        </div>
        {cands.length === 0 ? <Empty text="No candidates yet. Add the first one." /> : (
          <div className="flex gap-3 overflow-x-auto pb-2">
            {CANDIDATE_STAGES.map(stage => {
              const col = shown.filter(c => c.stage === stage);
              return (
                <div key={stage} className="min-w-[210px] w-[210px] bg-slate-50 border border-slate-200 rounded-xl p-2 shrink-0">
                  <div className="flex items-center justify-between px-1 pb-2"><Badge tone={stageTone(stage)}>{stage}</Badge><span className="text-xs font-bold text-slate-400">{col.length}</span></div>
                  <div className="space-y-2">
                    {col.map(c => {
                      const avg = c.interviews.length ? c.interviews.reduce((s, i) => s + i.rating, 0) / c.interviews.length : 0;
                      return (
                        <button key={c.id} onClick={() => setOpenId(c.id)} className="w-full text-left bg-white border border-slate-200 rounded-lg p-2.5 hover:shadow-md transition-shadow">
                          <div className="text-sm font-bold text-slate-800 truncate">{c.name}</div>
                          <div className="text-[11px] text-slate-500 truncate">{c.position}</div>
                          <div className="flex items-center justify-between mt-1.5 text-[11px] text-slate-400">
                            <span>{fmtD(c.createdAt)}</span>
                            {avg > 0 && <span className="inline-flex items-center gap-0.5 text-amber-600 font-bold"><Star className="h-3 w-3" />{avg.toFixed(1)}</span>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </>)}

      {tab === 'vacancies' && (
        vacC.items.length === 0 ? <Empty text="No vacancies yet." /> : (
          <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
            {vacC.items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(v => {
              const n = cands.filter(c => c.vacancyId === v.id).length;
              return (
                <div key={v.id} className="px-4 py-3 flex flex-wrap items-center gap-3 justify-between">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap"><span className="font-bold text-slate-800 text-sm">{v.title}</span><Badge tone="slate">{v.department}</Badge><Badge tone={v.status === 'Open' ? 'emerald' : v.status === 'Filled' ? 'sky' : 'amber'}>{v.status}</Badge></div>
                    <div className="text-xs text-slate-500 mt-0.5">{v.openings} opening(s) · {n} candidate(s){v.requestedBy ? ` · requested by ${v.requestedBy}` : ''}{v.requirements ? ` — ${v.requirements}` : ''}</div>
                  </div>
                  <div className="flex gap-2 items-center">
                    <select className={inputCls + ' !w-auto !py-1 text-xs'} value={v.status} onChange={async e => { const ok = await runSave(() => vacC.save({ ...v, status: e.target.value as any }), 'Vacancy updated'); if (ok) logAudit(user, 'Recruitment', `Vacancy ${v.title} → ${e.target.value}`); }}>
                      <option>Open</option><option>On Hold</option><option>Filled</option><option>Closed</option>
                    </select>
                    <button className="text-slate-300 hover:text-rose-600" aria-label="Delete" onClick={async () => { if (!(await ask(`Delete vacancy "${v.title}"?`))) return; const ok = await runSave(() => vacC.remove(v.id), 'Vacancy deleted'); if (ok) logAudit(user, 'Recruitment', `Deleted vacancy ${v.title}`); }}><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {showVac && <NewVacancy departments={departments} user={user} onClose={() => setShowVac(false)} save={async v => { const ok = await runSave(() => vacC.save(v), 'Vacancy added'); if (ok) { logAudit(user, 'Recruitment', `Opened vacancy ${v.title}`); setShowVac(false); } }} />}
      {showNew && <NewCandidate vacancies={vacC.items.filter(v => v.status === 'Open')} departments={departments} onClose={() => setShowNew(false)} save={async c => { const ok = await runSave(() => candC.save(c), 'Candidate added'); if (ok) { logAudit(user, 'Recruitment', 'Added candidate', c.name); setShowNew(false); } }} />}
      {open && <CandidateModal c={open} user={user} letters={lettersC.items} onClose={() => setOpenId(null)} save={candC.save} saveLetter={lettersC.save}
        remove={async () => { if (!(await ask(`Delete candidate ${open.name}?`))) return; const ok = await runSave(() => candC.remove(open.id), 'Candidate deleted'); if (ok) { logAudit(user, 'Recruitment', 'Deleted candidate', open.name); setOpenId(null); } }} />}
    </div>
  );
};

const NewVacancy: React.FC<{ departments: string[]; user?: string; onClose: () => void; save: (v: HRVacancy) => void }> = ({ departments, user, onClose, save }) => {
  const [f, setF] = useState({ title: '', department: departments[0] || '', openings: '1', requestedBy: user || '', requirements: '' });
  return (
    <Modal title="New vacancy" onClose={onClose} footer={<><button className={btnGhost} onClick={onClose}>Cancel</button><button className={btnPrimary} onClick={() => {
      if (!f.title.trim()) { hrToast('Enter the job title', 'err'); return; }
      save({ id: newId('vac'), title: f.title.trim(), department: f.department || 'General', openings: Math.max(1, parseInt(f.openings) || 1), status: 'Open', requestedBy: f.requestedBy.trim() || undefined, requirements: f.requirements.trim() || undefined, createdAt: new Date().toISOString() });
    }}>Open vacancy</button></>}>
      <Field label="Job title *"><input className={inputCls} value={f.title} onChange={e => setF(p => ({ ...p, title: e.target.value }))} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Department"><input list="dept-list" className={inputCls} value={f.department} onChange={e => setF(p => ({ ...p, department: e.target.value }))} /><datalist id="dept-list">{departments.map(d => <option key={d} value={d} />)}</datalist></Field>
        <Field label="Openings"><input type="number" min={1} className={inputCls} value={f.openings} onChange={e => setF(p => ({ ...p, openings: e.target.value }))} /></Field>
      </div>
      <Field label="Requested by"><input className={inputCls} value={f.requestedBy} onChange={e => setF(p => ({ ...p, requestedBy: e.target.value }))} /></Field>
      <Field label="Requirements"><textarea rows={2} className={inputCls + ' resize-none'} value={f.requirements} onChange={e => setF(p => ({ ...p, requirements: e.target.value }))} /></Field>
    </Modal>
  );
};

const NewCandidate: React.FC<{ vacancies: HRVacancy[]; departments: string[]; onClose: () => void; save: (c: HRCandidate) => void }> = ({ vacancies, onClose, save }) => {
  const [f, setF] = useState({ name: '', phone: '', email: '', nationality: '', vacancyId: '', position: '', source: 'Walk-in', expectedSalary: '', visa: '', notes: '' });
  const pickVac = (id: string) => { const v = vacancies.find(x => x.id === id); setF(p => ({ ...p, vacancyId: id, position: v ? v.title : p.position })); };
  return (
    <Modal title="Add candidate" onClose={onClose} footer={<><button className={btnGhost} onClick={onClose}>Cancel</button><button className={btnPrimary} onClick={() => {
      if (!f.name.trim() || !f.position.trim()) { hrToast('Name and position are required', 'err'); return; }
      const v = vacancies.find(x => x.id === f.vacancyId);
      save({ id: newId('cand'), name: f.name.trim(), phone: f.phone.trim() || undefined, email: f.email.trim() || undefined, nationality: f.nationality.trim() || undefined,
        vacancyId: f.vacancyId || undefined, position: f.position.trim(), department: v?.department, source: f.source, currentVisaStatus: f.visa.trim() || undefined,
        expectedSalary: parseFloat(f.expectedSalary) || undefined, stage: 'Applied', interviews: [], notes: f.notes.trim() || undefined, createdAt: new Date().toISOString() });
    }}>Add</button></>}>
      <Field label="Full name *"><input className={inputCls} value={f.name} onChange={e => setF(p => ({ ...p, name: e.target.value }))} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Phone"><input className={inputCls} value={f.phone} onChange={e => setF(p => ({ ...p, phone: e.target.value }))} /></Field>
        <Field label="Email"><input className={inputCls} value={f.email} onChange={e => setF(p => ({ ...p, email: e.target.value }))} /></Field>
        <Field label="Nationality"><input className={inputCls} value={f.nationality} onChange={e => setF(p => ({ ...p, nationality: e.target.value }))} /></Field>
        <Field label="Current visa status"><input className={inputCls} value={f.visa} onChange={e => setF(p => ({ ...p, visa: e.target.value }))} placeholder="Visit / Cancelled / Employed" /></Field>
      </div>
      <Field label="Vacancy"><select className={inputCls} value={f.vacancyId} onChange={e => pickVac(e.target.value)}><option value="">— none —</option>{vacancies.map(v => <option key={v.id} value={v.id}>{v.title} ({v.department})</option>)}</select></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Position applied *"><input className={inputCls} value={f.position} onChange={e => setF(p => ({ ...p, position: e.target.value }))} /></Field>
        <Field label="Source"><select className={inputCls} value={f.source} onChange={e => setF(p => ({ ...p, source: e.target.value }))}>{SOURCES.map(s => <option key={s}>{s}</option>)}</select></Field>
      </div>
      <Field label="Expected salary (AED)"><input type="number" className={inputCls} value={f.expectedSalary} onChange={e => setF(p => ({ ...p, expectedSalary: e.target.value }))} /></Field>
      <Field label="Notes"><textarea rows={2} className={inputCls + ' resize-none'} value={f.notes} onChange={e => setF(p => ({ ...p, notes: e.target.value }))} /></Field>
    </Modal>
  );
};

const CandidateModal: React.FC<{ c: HRCandidate; user?: string; letters: HRLetterLog[]; onClose: () => void; save: (c: HRCandidate) => Promise<void>; saveLetter: (l: HRLetterLog) => Promise<void>; remove: () => void }> = ({ c, user, letters, onClose, save, saveLetter, remove }) => {
  const [iv, setIv] = useState({ date: todayStr(), interviewer: user || '', rating: 3, notes: '' });
  const [offer, setOffer] = useState({ salary: c.offerSalary ? String(c.offerSalary) : (c.expectedSalary ? String(c.expectedSalary) : ''), joining: c.expectedJoining || '', terms: '' });
  const [reject, setReject] = useState('');
  const update = async (patch: Partial<HRCandidate>, msg: string, audit?: string) => {
    const ok = await runSave(() => save({ ...c, ...patch, updatedAt: new Date().toISOString() }), msg);
    if (ok && audit) logAudit(user, 'Recruitment', audit, c.name);
    return ok;
  };
  const move = (stage: CandidateStage) => update({ stage }, `Moved to ${stage}`, `Moved to ${stage}`);
  const addInterview = () => {
    if (!iv.interviewer.trim()) { hrToast('Enter the interviewer', 'err'); return; }
    update({ interviews: [...c.interviews, { id: newId('iv'), ...iv, interviewer: iv.interviewer.trim(), notes: iv.notes.trim() }], stage: c.stage === 'Applied' || c.stage === 'Screening' ? 'Interview' : c.stage }, 'Interview logged', 'Logged interview');
    setIv(p => ({ ...p, notes: '', rating: 3 }));
  };
  const printOffer = async () => {
    const sal = parseFloat(offer.salary);
    if (!(sal > 0)) { hrToast('Enter the offered monthly salary', 'err'); return; }
    const comp = composeLetter({ kind: 'Offer Letter', person: { name: c.name, department: c.department }, offerPosition: c.position, offerSalary: sal, offerJoining: offer.joining || undefined, reason: offer.terms.trim() || undefined });
    const refNo = nextRef('MAT/HR', letters.map(l => l.refNo));
    await exportLetterPdf({ refNo, date: todayStr(), addressedTo: comp.addressedTo, subject: comp.subject, paragraphs: comp.paragraphs, acknowledgment: true, filename: `Offer_Letter_${c.name.replace(/\s+/g, '_')}` });
    await saveLetter({ id: newId('lt'), refNo, type: 'Offer Letter', employeeId: '', employeeName: c.name, issuedBy: user || 'HR', issuedAt: new Date().toISOString() });
    await update({ offerSalary: sal, offerDate: todayStr(), expectedJoining: offer.joining || undefined, stage: c.stage === 'Hired' ? 'Hired' : 'Offer' }, `Offer ${refNo} generated`, `Offer letter ${refNo}`);
  };
  const avg = c.interviews.length ? c.interviews.reduce((s, i) => s + i.rating, 0) / c.interviews.length : 0;
  return (
    <Modal wide title={c.name} onClose={onClose}>
      <div className="flex items-center gap-2 flex-wrap">
        <Badge tone={stageTone(c.stage)}>{c.stage}</Badge><span className="text-sm text-slate-600">{c.position}{c.department ? ` · ${c.department}` : ''}</span>
        {avg > 0 && <Badge tone="amber">Avg {avg.toFixed(1)}/5</Badge>}
      </div>
      <div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-600 grid grid-cols-2 gap-1">
        <div>Phone: {c.phone || '—'}</div><div>Email: {c.email || '—'}</div>
        <div>Nationality: {c.nationality || '—'}</div><div>Visa: {c.currentVisaStatus || '—'}</div>
        <div>Source: {c.source || '—'}</div><div>Expected salary: {c.expectedSalary ? fmtAED(c.expectedSalary) : '—'}</div>
        {c.notes && <div className="col-span-2">Notes: {c.notes}</div>}
        {c.rejectReason && <div className="col-span-2 text-rose-600">Rejected: {c.rejectReason}</div>}
      </div>

      <div>
        <div className="text-xs font-bold text-slate-500 mb-1.5">Move to stage</div>
        <div className="flex gap-1.5 flex-wrap">
          {CANDIDATE_STAGES.filter(s => s !== 'Rejected').map(s => (
            <button key={s} disabled={c.stage === s} onClick={() => move(s)} className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${c.stage === s ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>{s}</button>
          ))}
        </div>
      </div>

      <div className="border border-slate-200 rounded-xl p-3 space-y-2">
        <div className="text-sm font-black text-slate-800">Interviews ({c.interviews.length})</div>
        {c.interviews.map(i => (
          <div key={i.id} className="text-xs text-slate-600 border-b border-slate-100 pb-1.5">
            <b>{fmtD(i.date)}</b> · {i.interviewer} · <span className="text-amber-600 font-bold">{i.rating}/5</span>{i.notes && <div className="text-slate-500">{i.notes}</div>}
          </div>
        ))}
        <div className="grid grid-cols-1 sm:grid-cols-[130px_1fr_90px] gap-2">
          <input type="date" className={inputCls} value={iv.date} onChange={e => setIv(p => ({ ...p, date: e.target.value }))} />
          <input className={inputCls} placeholder="Interviewer" value={iv.interviewer} onChange={e => setIv(p => ({ ...p, interviewer: e.target.value }))} />
          <select className={inputCls} value={iv.rating} onChange={e => setIv(p => ({ ...p, rating: parseInt(e.target.value) }))}>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} / 5</option>)}</select>
        </div>
        <textarea rows={2} className={inputCls + ' resize-none'} placeholder="Interview notes / trade test result" value={iv.notes} onChange={e => setIv(p => ({ ...p, notes: e.target.value }))} />
        <button className={btnGhost} onClick={addInterview}><Plus className="h-3.5 w-3.5" />Log interview</button>
      </div>

      <div className="border border-violet-200 bg-violet-50 rounded-xl p-3 space-y-2">
        <div className="text-sm font-black text-violet-800">Offer</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Monthly salary offered (AED)"><input type="number" className={inputCls} value={offer.salary} onChange={e => setOffer(p => ({ ...p, salary: e.target.value }))} /></Field>
          <Field label="Expected joining date"><input type="date" className={inputCls} value={offer.joining} onChange={e => setOffer(p => ({ ...p, joining: e.target.value }))} /></Field>
        </div>
        <Field label="Salary breakdown / extra terms (optional)"><input className={inputCls} value={offer.terms} onChange={e => setOffer(p => ({ ...p, terms: e.target.value }))} placeholder="Basic 1,200 + Housing 400 + Transport 200 …" /></Field>
        <button className={btnPrimary} onClick={printOffer}><Printer className="h-4 w-4" />Generate offer letter</button>
        {c.offerDate && <div className="text-[11px] text-violet-700">Last offer: {fmtAED(c.offerSalary)} on {fmtD(c.offerDate)}</div>}
      </div>

      {c.stage !== 'Hired' && c.stage !== 'Rejected' && (
        <div className="flex items-end gap-2 flex-wrap">
          <Field label="Reject — reason" className="flex-1 min-w-[200px]"><input className={inputCls} value={reject} onChange={e => setReject(e.target.value)} /></Field>
          <button className="bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold px-3 py-2 rounded-lg" onClick={() => { if (!reject.trim()) { hrToast('Give a reason', 'err'); return; } update({ stage: 'Rejected', rejectReason: reject.trim() }, 'Candidate rejected', 'Rejected candidate'); }}>Reject</button>
        </div>
      )}
      {c.stage === 'Hired' && <p className="text-xs text-emerald-700 bg-emerald-50 rounded-lg p-2">Hired. Add them to the Directory, then open Employee 360 → Onboarding to start their checklist.</p>}
      <div className="flex justify-between pt-1">
        <button className="text-xs text-rose-500 hover:text-rose-700 font-bold" onClick={remove}>Delete candidate</button>
        {(c.stage === 'Rejected') && <button className={btnGhost} onClick={() => update({ stage: 'Applied', rejectReason: undefined }, 'Reopened', 'Reopened candidate')}>Reopen</button>}
      </div>
    </Modal>
  );
};
