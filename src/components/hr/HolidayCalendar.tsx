import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Pencil, Trash2, CalendarDays } from 'lucide-react';
import { Employee } from '../../types';
import { useHRCollection, HRHoliday, LeaveLite, newId, todayStr, fmtD, daysUntil, logAudit } from '../../lib/hrStore';
import { Modal, Field, inputCls, btnPrimary, btnGhost, Badge, Empty, SectionCard, StatCard, runSave, useConfirm, hrToast } from './hrUi';

interface Props { employees: Employee[]; leaves: LeaveLite[]; user?: string }

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const kindCls = (k: HRHoliday['kind']) => k === 'Public' ? 'bg-rose-100 text-rose-800 border-rose-200' : k === 'Company' ? 'bg-violet-100 text-violet-800 border-violet-200' : 'bg-amber-100 text-amber-800 border-amber-200';
const lastDay = (h: HRHoliday) => (h.endDate && h.endDate >= h.date ? h.endDate : h.date);
const covers = (h: HRHoliday, date: string) => date >= h.date && date <= lastDay(h);
const span = (h: HRHoliday) => Math.round((new Date(lastDay(h) + 'T00:00:00').getTime() - new Date(h.date + 'T00:00:00').getTime()) / 86400000) + 1;

export const HolidayCalendar: React.FC<Props> = ({ employees, leaves, user }) => {
  const holC = useHRCollection<HRHoliday>('hrHolidays');
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [sel, setSel] = useState<string>(todayStr());
  const [edit, setEdit] = useState<HRHoliday | { date: string } | null>(null);
  const { ask, node } = useConfirm();

  const today = todayStr();
  const first = new Date(cursor.y, cursor.m, 1);
  const lead = (first.getDay() + 6) % 7;                    // Monday first
  const dim = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: dim }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);

  const empById = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees]);
  const approved = useMemo(() => leaves.filter(l => l.status === 'Approved'), [leaves]);
  const offOn = (date: string) => approved.filter(l => l.fromDate <= date && l.toDate >= date);
  const holOn = (date: string) => holC.items.filter(h => covers(h, date));

  const yearItems = useMemo(() => holC.items.filter(h => h.date.startsWith(String(cursor.y)) || lastDay(h).startsWith(String(cursor.y))).sort((a, b) => a.date.localeCompare(b.date)), [holC.items, cursor.y]);
  const upcoming = useMemo(() => holC.items.filter(h => lastDay(h) >= today).sort((a, b) => a.date.localeCompare(b.date))[0], [holC.items, today]);
  const daysOffYear = yearItems.filter(h => h.kind !== 'Optional').reduce((s, h) => s + span(h), 0);

  const go = (delta: number) => setCursor(c => { const d = new Date(c.y, c.m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() }; });

  const quickAdd = async () => {
    const y = cursor.y;
    const fixed: Omit<HRHoliday, 'id'>[] = [
      { date: `${y}-01-01`, name: "New Year's Day", kind: 'Public' },
      { date: `${y}-12-02`, endDate: `${y}-12-03`, name: 'UAE National Day', kind: 'Public' },
    ];
    const want = fixed.filter(w => !holC.items.some(h => h.date === w.date && h.name === w.name));
    if (!want.length) { hrToast(`Those holidays are already in ${y}`, 'err'); return; }
    const ok = await runSave(async () => { for (const w of want) await holC.save({ id: newId('hol'), ...w }); }, `${want.length} holiday(s) added`);
    if (ok) logAudit(user, 'Holiday calendar', `Added fixed-date holidays for ${y}`);
  };

  const selHols = holOn(sel), selOff = offOn(sel);

  return (
    <div className="space-y-4">
      {node}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <StatCard label={`Holidays in ${cursor.y}`} value={yearItems.length} sub={`${daysOffYear} paid day(s) off`} tone="violet" icon={<CalendarDays className="h-4 w-4" />} />
        <StatCard label="Next holiday" value={upcoming ? upcoming.name : '—'} sub={upcoming ? `${fmtD(upcoming.date)} · in ${Math.max(0, daysUntil(upcoming.date) ?? 0)} day(s)` : 'None scheduled'} tone="emerald" />
        <StatCard label="On leave today" value={offOn(today).length} tone="slate" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button className={btnGhost} onClick={() => go(-1)} aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></button>
          <div className="text-lg font-black text-slate-800 w-48 text-center">{MONTHS[cursor.m]} {cursor.y}</div>
          <button className={btnGhost} onClick={() => go(1)} aria-label="Next month"><ChevronRight className="h-4 w-4" /></button>
          <button className={btnGhost} onClick={() => { setCursor({ y: now.getFullYear(), m: now.getMonth() }); setSel(today); }}>Today</button>
        </div>
        <div className="flex gap-2">
          <button className={btnGhost} onClick={quickAdd}>Add New Year & National Day {cursor.y}</button>
          <button className={btnPrimary} onClick={() => setEdit({ date: sel })}><Plus className="h-4 w-4" />Add holiday</button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4">
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="grid grid-cols-7 text-[11px] font-bold uppercase text-slate-400 bg-slate-50 border-b border-slate-100">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <div key={d} className="px-2 py-2 text-center">{d}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((d, i) => {
              if (d === null) return <div key={i} className="min-h-[84px] border-b border-r border-slate-50 bg-slate-50/40" />;
              const date = ymd(cursor.y, cursor.m, d);
              const hs = holOn(date); const off = offOn(date).length;
              const isSel = date === sel, isToday = date === today, weekend = i % 7 >= 5;
              return (
                <button key={i} onClick={() => setSel(date)} className={`min-h-[84px] text-left p-1.5 border-b border-r border-slate-100 align-top hover:bg-violet-50/50 ${isSel ? 'bg-violet-50 ring-2 ring-inset ring-violet-400' : weekend ? 'bg-slate-50/60' : 'bg-white'}`}>
                  <div className={`text-xs font-bold inline-flex h-5 w-5 items-center justify-center rounded-full ${isToday ? 'bg-violet-600 text-white' : 'text-slate-600'}`}>{d}</div>
                  <div className="mt-1 space-y-0.5">
                    {hs.slice(0, 2).map(h => <div key={h.id} className={`text-[10px] font-semibold border rounded px-1 truncate ${kindCls(h.kind)}`}>{h.name}</div>)}
                    {hs.length > 2 && <div className="text-[10px] text-slate-400">+{hs.length - 2} more</div>}
                    {off > 0 && <div className="text-[10px] text-sky-700 font-semibold">{off} on leave</div>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <SectionCard title={fmtD(sel)} right={<button className={btnGhost} onClick={() => setEdit({ date: sel })}><Plus className="h-3.5 w-3.5" />Holiday</button>}>
          <div className="space-y-3">
            <div>
              <div className="text-[11px] font-bold uppercase text-slate-400 mb-1">Holiday</div>
              {selHols.length === 0 ? <p className="text-xs text-slate-400">No holiday on this day.</p> : selHols.map(h => (
                <div key={h.id} className="flex items-center justify-between gap-2 py-1">
                  <div><div className="text-sm font-semibold text-slate-800">{h.name}</div><div className="text-[11px] text-slate-400">{h.kind} · {span(h) > 1 ? `${fmtD(h.date)} – ${fmtD(lastDay(h))}` : '1 day'}</div></div>
                  <span className="flex gap-2"><button className="text-slate-400 hover:text-violet-600" aria-label="Edit" onClick={() => setEdit(h)}><Pencil className="h-4 w-4" /></button>
                    <button className="text-slate-300 hover:text-rose-600" aria-label="Delete" onClick={async () => { if (!(await ask(`Delete "${h.name}"?`))) return; const ok = await runSave(() => holC.remove(h.id), 'Holiday deleted'); if (ok) logAudit(user, 'Holiday calendar', `Deleted ${h.name}`); }}><Trash2 className="h-4 w-4" /></button></span>
                </div>
              ))}
            </div>
            <div>
              <div className="text-[11px] font-bold uppercase text-slate-400 mb-1">On approved leave ({selOff.length})</div>
              {selOff.length === 0 ? <p className="text-xs text-slate-400">Nobody.</p> : (
                <div className="max-h-48 overflow-y-auto divide-y divide-slate-50">
                  {selOff.map(l => <div key={l.id} className="py-1 flex items-center justify-between text-sm"><span className="text-slate-800">{empById.get(l.employeeId)?.name || 'Employee'}</span><Badge tone="sky">{l.leaveType}</Badge></div>)}
                </div>
              )}
            </div>
          </div>
        </SectionCard>
      </div>

      <SectionCard title={`All holidays ${cursor.y}`}>
        {yearItems.length === 0 ? <Empty text={`No holidays added for ${cursor.y} yet. Use "Add holiday", or add New Year & National Day in one click. Eid and other moon-sighting dates are entered when they are announced.`} /> : (
          <div className="divide-y divide-slate-100">
            {yearItems.map(h => {
              const d = daysUntil(h.date);
              return (
                <div key={h.id} className="py-2 flex items-center justify-between gap-3">
                  <div className="min-w-0"><div className="text-sm font-semibold text-slate-800">{h.name} <span className={`text-[10px] font-bold border rounded px-1.5 py-0.5 ml-1 ${kindCls(h.kind)}`}>{h.kind}</span></div>
                    <div className="text-[11px] text-slate-400">{fmtD(h.date)}{span(h) > 1 ? ` – ${fmtD(lastDay(h))} (${span(h)} days)` : ''}{h.notes ? ` · ${h.notes}` : ''}</div></div>
                  <div className="flex items-center gap-3 shrink-0"><span className="text-xs text-slate-400">{d === null ? '' : lastDay(h) < today ? 'past' : d <= 0 ? 'now' : `in ${d} day(s)`}</span>
                    <button className="text-slate-400 hover:text-violet-600" aria-label="Edit" onClick={() => setEdit(h)}><Pencil className="h-4 w-4" /></button></div>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      {edit && <HolidayForm existing={'id' in edit ? edit : undefined} presetDate={'id' in edit ? undefined : edit.date} all={holC.items} onClose={() => setEdit(null)}
        save={async h => { const ok = await runSave(() => holC.save(h), 'Holiday saved'); if (ok) { logAudit(user, 'Holiday calendar', `${'id' in edit ? 'Edited' : 'Added'} ${h.name} (${h.date})`); setEdit(null); } }} />}
    </div>
  );
};

const HolidayForm: React.FC<{ existing?: HRHoliday; presetDate?: string; all: HRHoliday[]; onClose: () => void; save: (h: HRHoliday) => void }> = ({ existing, presetDate, all, onClose, save }) => {
  const [f, setF] = useState({ name: existing?.name || '', kind: existing?.kind || 'Public' as HRHoliday['kind'], date: existing?.date || presetDate || todayStr(), endDate: existing?.endDate || '', notes: existing?.notes || '' });
  return (
    <Modal title={existing ? 'Edit holiday' : 'Add holiday'} onClose={onClose} footer={<><button className={btnGhost} onClick={onClose}>Cancel</button><button className={btnPrimary} onClick={() => {
      if (!f.name.trim()) { hrToast('Enter the holiday name', 'err'); return; }
      if (!f.date) { hrToast('Choose the date', 'err'); return; }
      if (f.endDate && f.endDate < f.date) { hrToast('The last day is before the first day', 'err'); return; }
      if (all.some(h => h.id !== existing?.id && h.date === f.date && h.name.toLowerCase() === f.name.trim().toLowerCase())) { hrToast('This holiday is already in the calendar', 'err'); return; }
      save({ id: existing?.id || newId('hol'), name: f.name.trim(), kind: f.kind, date: f.date, endDate: f.endDate || undefined, notes: f.notes.trim() || undefined });
    }}>Save</button></>}>
      <Field label="Holiday name *"><input className={inputCls} value={f.name} onChange={e => setF(p => ({ ...p, name: e.target.value }))} placeholder="Eid Al Fitr" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="First day *"><input type="date" className={inputCls} value={f.date} onChange={e => setF(p => ({ ...p, date: e.target.value }))} /></Field>
        <Field label="Last day (if several days)"><input type="date" className={inputCls} value={f.endDate} min={f.date} onChange={e => setF(p => ({ ...p, endDate: e.target.value }))} /></Field>
      </div>
      <Field label="Type">
        <select className={inputCls} value={f.kind} onChange={e => setF(p => ({ ...p, kind: e.target.value as any }))}>
          <option value="Public">Public holiday (paid day off for everyone)</option><option value="Company">Company holiday (paid day off for everyone)</option><option value="Optional">Optional (not counted as a day off)</option>
        </select>
      </Field>
      <Field label="Notes"><input className={inputCls} value={f.notes} onChange={e => setF(p => ({ ...p, notes: e.target.value }))} /></Field>
      <p className="text-[11px] text-slate-400">Public and company holidays are not charged to annual leave that spans them (set in the Leave policy).</p>
    </Modal>
  );
};
