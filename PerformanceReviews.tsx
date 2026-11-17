import React, { useMemo, useState } from 'react';
import { Plus, Printer, Star, Trash2 } from 'lucide-react';
import { Employee } from '../../types';
import {
  useHRCollection, HRReview, HRProfile, REVIEW_CRITERIA, newId, fmtD, logAudit, daysUntil,
} from '../../lib/hrStore';
import { exportMultiTablePdf } from '../../lib/exportUtils';
import {
  Modal, Field, EmployeeSelect, inputCls, btnPrimary, btnGhost, StatCard, Badge, Empty, SearchBox, SectionCard,
  runSave, useConfirm, hrToast,
} from './hrUi';

interface Props { employees: Employee[]; user?: string }

const RECS: HRReview['recommendation'][] = ['None', 'Increment', 'Promotion', 'Training', 'Improvement Plan', 'Warning'];
const scoreTone = (n: number) => n >= 4 ? 'emerald' : n >= 3 ? 'sky' : n >= 2 ? 'amber' : 'rose';
const scoreWord = (n: number) => n >= 4.5 ? 'Outstanding' : n >= 3.5 ? 'Exceeds expectations' : n >= 2.5 ? 'Meets expectations' : n >= 1.5 ? 'Needs improvement' : 'Unsatisfactory';

const defaultPeriod = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() < 6 ? 'H1' : 'H2'}`; };
const average = (r: Record<string, number>) => { const v = Object.values(r).filter(x => x > 0); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0; };

export const PerformanceReviews: React.FC<Props> = ({ employees, user }) => {
  const revC = useHRCollection<HRReview>('hrReviews');
  const profC = useHRCollection<HRProfile>('hrProfiles');
  const [q, setQ] = useState('');
  const [periodF, setPeriodF] = useState('All');
  const [showNew, setShowNew] = useState<HRReview | 'new' | null>(null);
  const { ask, node } = useConfirm();

  const items = revC.items;
  const periods = useMemo(() => ['All', ...Array.from(new Set(items.map(r => r.period))).sort().reverse()], [items]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter(r => periodF === 'All' || r.period === periodF)
      .filter(r => !s || r.employeeName.toLowerCase().includes(s))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [items, q, periodF]);

  const avg = shown.length ? shown.reduce((s, r) => s + r.overall, 0) / shown.length : 0;

  // Active employees with no review in the last 180 days (or whose probation is ending).
  const due = useMemo(() => {
    const cutoff = new Date(Date.now() - 180 * 86400000).toISOString();
    const pm = new Map(profC.items.map(p => [p.id, p]));
    return employees.filter(e => {
      const p = pm.get(e.id);
      if (p?.status && p.status !== 'Active') return false;
      const last = items.filter(r => r.employeeId === e.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      const probSoon = p?.probationEndDate && (daysUntil(p.probationEndDate) ?? 999) <= 30 && (daysUntil(p.probationEndDate) ?? -1) >= -30;
      return !last || last.createdAt < cutoff || probSoon;
    }).map(e => ({ e, probSoon: !!(pm.get(e.id)?.probationEndDate && (daysUntil(pm.get(e.id)!.probationEndDate) ?? 999) <= 30) }));
  }, [employees, items, profC.items]);

  const print = (r: HRReview) => exportMultiTablePdf({
    filename: `Performance_Review_${r.employeeName.replace(/\s+/g, '_')}_${r.period}`, deptLine: 'Human Resources Department', orientation: 'portrait',
    sections: [
      { title: `Performance Review — ${r.employeeName}`, subtitle: `Period ${r.period} · Reviewer ${r.reviewer} · Overall ${r.overall.toFixed(1)}/5 (${scoreWord(r.overall)})`, head: ['Criterion', 'Rating (1–5)'], rows: REVIEW_CRITERIA.map(c => [c, r.ratings[c] || '—']) },
      { title: 'Comments & recommendation', subtitle: r.employeeName, head: ['Section', 'Notes'], rows: [['Strengths', r.strengths || '—'], ['Areas to improve', r.improvements || '—'], ['Goals for next period', r.goals || '—'], ['Recommendation', r.recommendation], ['Status', r.status]] },
    ],
  });

  return (
    <div className="space-y-4">
      {node}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Reviews" value={shown.length} tone="violet" icon={<Star className="h-4 w-4" />} />
        <StatCard label="Average score" value={shown.length ? `${avg.toFixed(2)} / 5` : '—'} tone={shown.length ? scoreTone(avg) as any : 'slate'} />
        <StatCard label="Recommended for increment / promotion" value={shown.filter(r => r.recommendation === 'Increment' || r.recommendation === 'Promotion').length} tone="emerald" />
        <StatCard label="Due for review" value={due.length} tone={due.length ? 'amber' : 'slate'} sub="none in last 6 months" />
      </div>

      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox value={q} onChange={setQ} placeholder="Employee…" />
          <select className={inputCls + ' !w-auto'} value={periodF} onChange={e => setPeriodF(e.target.value)}>{periods.map(p => <option key={p}>{p}</option>)}</select>
        </div>
        <button className={btnPrimary} onClick={() => setShowNew('new')}><Plus className="h-4 w-4" />New review</button>
      </div>

      {shown.length === 0 ? <Empty text="No reviews yet." /> : (
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
          {shown.map(r => (
            <div key={r.id} className="px-4 py-3 flex flex-wrap items-center gap-3 justify-between">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-slate-800 text-sm">{r.employeeName}</span>
                  <Badge tone="slate">{r.period}</Badge>
                  <Badge tone={scoreTone(r.overall) as any}>{r.overall.toFixed(1)} · {scoreWord(r.overall)}</Badge>
                  {r.recommendation !== 'None' && <Badge tone="violet">{r.recommendation}</Badge>}
                  <Badge tone={r.status === 'Acknowledged' ? 'emerald' : r.status === 'Submitted' ? 'sky' : 'amber'}>{r.status}</Badge>
                </div>
                <div className="text-xs text-slate-400 mt-0.5">Reviewer {r.reviewer} · {fmtD(r.createdAt)}</div>
              </div>
              <div className="flex gap-2">
                <button className={btnGhost} onClick={() => print(r)}><Printer className="h-3.5 w-3.5" />Print</button>
                <button className={btnGhost} onClick={() => setShowNew(r)}>Open</button>
                <button className="text-slate-300 hover:text-rose-600" aria-label="Delete" onClick={async () => {
                  if (!(await ask(`Delete ${r.employeeName}'s ${r.period} review?`))) return;
                  const ok = await runSave(() => revC.remove(r.id), 'Review deleted'); if (ok) logAudit(user, 'Performance', `Deleted ${r.period} review`, r.employeeName);
                }}><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {due.length > 0 && (
        <SectionCard title={`Due for a review (${due.length})`}>
          <div className="flex flex-wrap gap-1.5">
            {due.slice(0, 24).map(d => <span key={d.e.id} className="text-xs bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 rounded">{d.e.name}{d.probSoon ? ' · probation ending' : ''}</span>)}
            {due.length > 24 && <span className="text-xs text-slate-400">+{due.length - 24} more</span>}
          </div>
        </SectionCard>
      )}

      {showNew && <ReviewForm key={typeof showNew === 'string' ? 'new' : showNew.id} employees={employees} user={user} existing={typeof showNew === 'string' ? undefined : showNew}
        onClose={() => setShowNew(null)}
        save={async r => { const ok = await runSave(() => revC.save(r), 'Review saved'); if (ok) { logAudit(user, 'Performance', `${r.status} review ${r.period}`, r.employeeName); setShowNew(null); } }} />}
    </div>
  );
};

const ReviewForm: React.FC<{ employees: Employee[]; user?: string; existing?: HRReview; onClose: () => void; save: (r: HRReview) => void }> = ({ employees, user, existing, onClose, save }) => {
  const [f, setF] = useState<HRReview>(existing || {
    id: newId('rev'), employeeId: '', employeeName: '', period: defaultPeriod(), reviewer: user || '', ratings: {}, overall: 0,
    recommendation: 'None', status: 'Draft', createdAt: new Date().toISOString(),
  });
  const overall = average(f.ratings);
  const submit = (status: HRReview['status']) => {
    if (!f.employeeId) { hrToast('Choose an employee', 'err'); return; }
    if (!f.reviewer.trim()) { hrToast('Enter the reviewer name', 'err'); return; }
    if (status !== 'Draft' && Object.keys(f.ratings).length < REVIEW_CRITERIA.length) { hrToast('Rate all criteria before submitting', 'err'); return; }
    const emp = employees.find(e => e.id === f.employeeId);
    save({ ...f, employeeName: emp?.name || f.employeeName, overall, status });
  };
  return (
    <Modal wide title={existing ? 'Performance review' : 'New performance review'} onClose={onClose}
      footer={<><button className={btnGhost} onClick={onClose}>Cancel</button><button className={btnGhost} onClick={() => submit('Draft')}>Save draft</button><button className={btnPrimary} onClick={() => submit(f.status === 'Acknowledged' ? 'Acknowledged' : 'Submitted')}>Submit</button></>}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Employee *">{existing ? <input className={inputCls} disabled value={f.employeeName} /> : <EmployeeSelect employees={employees} value={f.employeeId} onChange={id => setF(p => ({ ...p, employeeId: id }))} />}</Field>
        <Field label="Period"><input className={inputCls} value={f.period} onChange={e => setF(p => ({ ...p, period: e.target.value }))} placeholder="2026-H2" /></Field>
        <Field label="Reviewer *"><input className={inputCls} value={f.reviewer} onChange={e => setF(p => ({ ...p, reviewer: e.target.value }))} /></Field>
      </div>
      <div className="border border-slate-200 rounded-xl divide-y divide-slate-100">
        {REVIEW_CRITERIA.map(c => (
          <div key={c} className="px-3 py-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold text-slate-700">{c}</span>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} onClick={() => setF(p => ({ ...p, ratings: { ...p.ratings, [c]: n } }))}
                  className={`h-8 w-8 rounded-lg text-sm font-black border ${f.ratings[c] === n ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>{n}</button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="text-sm font-bold text-slate-700">Overall: <span className="text-violet-700">{overall ? overall.toFixed(2) : '—'}</span>{overall > 0 && <span className="text-slate-400 font-normal"> · {scoreWord(overall)}</span>}</div>
      <Field label="Strengths"><textarea rows={2} className={inputCls + ' resize-none'} value={f.strengths || ''} onChange={e => setF(p => ({ ...p, strengths: e.target.value }))} /></Field>
      <Field label="Areas to improve"><textarea rows={2} className={inputCls + ' resize-none'} value={f.improvements || ''} onChange={e => setF(p => ({ ...p, improvements: e.target.value }))} /></Field>
      <Field label="Goals for next period"><textarea rows={2} className={inputCls + ' resize-none'} value={f.goals || ''} onChange={e => setF(p => ({ ...p, goals: e.target.value }))} /></Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Recommendation"><select className={inputCls} value={f.recommendation} onChange={e => setF(p => ({ ...p, recommendation: e.target.value as any }))}>{RECS.map(r => <option key={r}>{r}</option>)}</select></Field>
        <Field label="Status"><select className={inputCls} value={f.status} onChange={e => setF(p => ({ ...p, status: e.target.value as any }))}><option>Draft</option><option>Submitted</option><option>Acknowledged</option></select></Field>
      </div>
    </Modal>
  );
};
