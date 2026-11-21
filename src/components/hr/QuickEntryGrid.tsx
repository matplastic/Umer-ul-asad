import React, { useMemo, useRef, useState } from 'react';
import { Save, Undo2 } from 'lucide-react';
import { Employee } from '../../types';
import { useHRCollection, HRProfile, bulkUpsertHR, logAudit } from '../../lib/hrStore';
import { parseDate, parseNum } from '../../lib/excelImport';
import { FIELDS, GROUPS, FieldDef, FieldGroup, getValue, isActive, isoToDisplay } from './employeeFields';
import { SearchBox, SubTabs, Empty, inputCls, btnPrimary, btnGhost, hrToast, runSave } from './hrUi';

interface Props {
  employees: Employee[];
  user?: string;
  saveEmployees?: (list: Employee[]) => void | Promise<void>;
}

type Edits = Record<string, Record<string, string>>;   // employeeId → fieldKey → typed text

/** The value as it should be shown / compared (dates as dd/mm/yyyy). */
const shownValue = (f: FieldDef, raw: string) => f.kind === 'date' ? isoToDisplay(raw) : raw;

/** Typed text → what would be stored; `ok:false` when it cannot be understood. */
function normalise(f: FieldDef, typed: string): { ok: boolean; value: string } {
  const t = typed.trim();
  if (t === '') return { ok: true, value: '' };
  if (f.kind === 'date') { const d = parseDate(t); return d === null || d === '' ? { ok: false, value: '' } : { ok: true, value: d }; }
  if (f.kind === 'number') { const n = parseNum(t); return n === null || n === '' ? { ok: false, value: '' } : { ok: true, value: String(n) }; }
  if (f.kind === 'select') { const hit = f.options?.find(o => o.toLowerCase() === t.toLowerCase() || o.toLowerCase().startsWith(t.toLowerCase())); return hit ? { ok: true, value: hit } : { ok: false, value: '' }; }
  return { ok: true, value: f.upper ? t.toUpperCase() : t };
}

export const QuickEntryGrid: React.FC<Props> = ({ employees, user, saveEmployees }) => {
  const profC = useHRCollection<HRProfile>('hrProfiles');
  const [group, setGroup] = useState<FieldGroup>('passport');
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('All');
  const [onlyBlank, setOnlyBlank] = useState(false);
  const [edits, setEdits] = useState<Edits>({});
  const [saving, setSaving] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  const pmap = useMemo(() => new Map(profC.items.map(p => [p.id, p])), [profC.items]);
  const cols = useMemo(() => FIELDS.filter(f => f.group === group), [group]);
  const depts = useMemo(() => ['All', ...Array.from(new Set(employees.map(e => e.department).filter(Boolean))).sort()], [employees]);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return employees.filter(e => isActive(e, pmap))
      .filter(e => dept === 'All' || e.department === dept)
      .filter(e => !s || e.name.toLowerCase().includes(s) || e.id.toLowerCase().includes(s))
      .filter(e => !onlyBlank || cols.some(c => getValue(c, e, pmap.get(e.id)).trim() === ''))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [employees, pmap, q, dept, onlyBlank, cols]);

  // A cell is "dirty" when what was typed differs from what is stored; invalid when it cannot be understood.
  const cellState = (e: Employee, f: FieldDef) => {
    const typed = edits[e.id]?.[f.key];
    if (typed === undefined) return { dirty: false, invalid: false };
    const stored = getValue(f, e, pmap.get(e.id));
    const n = normalise(f, typed);
    if (!n.ok) return { dirty: true, invalid: true };
    return { dirty: n.value !== stored, invalid: false };
  };

  const summary = useMemo(() => {
    let cells = 0, bad = 0; const emps = new Set<string>();
    for (const e of employees) for (const f of FIELDS) {
      const typed = edits[e.id]?.[f.key]; if (typed === undefined) continue;
      const st = cellState(e, f); if (st.invalid) bad++; if (st.dirty) { cells++; emps.add(e.id); }
    }
    return { cells, bad, emps: emps.size };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edits, employees, pmap]);

  const setCell = (id: string, key: string, val: string) => setEdits(p => ({ ...p, [id]: { ...(p[id] || {}), [key]: val } }));

  const move = (rowIdx: number, key: string, delta: number) => {
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-cell="${rowIdx + delta}:${key}"]`);
    el?.focus(); (el as HTMLInputElement | undefined)?.select?.();
  };

  const discard = () => setEdits({});

  const save = async () => {
    if (summary.bad > 0) { hrToast(`${summary.bad} cell(s) are not valid (shown in red) — fix or clear them first`, 'err'); return; }
    // build the updated records
    const empUpdates: Employee[] = []; const profUpdates: HRProfile[] = []; const problems: string[] = [];
    for (const e of employees) {
      const ed = edits[e.id]; if (!ed) continue;
      let nextE: Employee | null = null; let nextP: HRProfile | null = null;
      for (const f of FIELDS) {
        if (ed[f.key] === undefined) continue;
        const stored = getValue(f, e, pmap.get(e.id)); const n = normalise(f, ed[f.key]);
        if (!n.ok || n.value === stored) continue;
        if (f.source === 'emp') { nextE = nextE || { ...e }; (nextE as any)[f.key] = n.value === '' ? null : n.value; }
        else {
          nextP = nextP || { ...(pmap.get(e.id) || { id: e.id }), id: e.id };
          (nextP as any)[f.key] = n.value === '' ? undefined : (f.kind === 'number' ? Number(n.value) : n.value);
        }
      }
      const issue = (nextE || e).passportIssueDate, expiry = (nextE || e).passportExpiryDate;
      if (nextE && issue && expiry && expiry <= issue) problems.push(`${e.name}: passport expiry is not after the issue date`);
      if (nextE) empUpdates.push(nextE);
      if (nextP) { nextP.updatedAt = new Date().toISOString(); nextP.updatedBy = user; profUpdates.push(nextP); }
    }
    if (problems.length) { hrToast(problems[0] + (problems.length > 1 ? ` (+${problems.length - 1} more)` : ''), 'err'); return; }
    if (!empUpdates.length && !profUpdates.length) { hrToast('No changes to save', 'err'); return; }
    if (empUpdates.length && !saveEmployees) { hrToast('Saving Directory details is not available here', 'err'); return; }
    setSaving(true);
    const ok = await runSave(async () => {
      if (empUpdates.length) await saveEmployees!(empUpdates);
      if (profUpdates.length) await bulkUpsertHR('hrProfiles', profUpdates);
    }, `Saved ${summary.cells} change(s) for ${summary.emps} employee(s)`);
    setSaving(false);
    if (ok) { logAudit(user, 'Quick entry', `${summary.cells} change(s) for ${summary.emps} employee(s) (${GROUPS.find(g => g.id === group)?.label})`); setEdits({}); }
  };

  return (
    <div className="space-y-3">
      <SubTabs active={group} onChange={g => setGroup(g as FieldGroup)} tabs={GROUPS.map(g => ({ id: g.id, label: g.label }))} />
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={q} onChange={setQ} placeholder="Employee or badge…" />
        <select className={inputCls + ' !w-auto'} value={dept} onChange={e => setDept(e.target.value)}>{depts.map(d => <option key={d}>{d}</option>)}</select>
        <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600"><input type="checkbox" className="accent-violet-600" checked={onlyBlank} onChange={e => setOnlyBlank(e.target.checked)} />Only people with blanks here</label>
        <span className="text-xs text-slate-400 ml-auto">Type in a cell · <b>Enter</b> or <b>↓</b> goes to the next person · dates as dd/mm/yyyy</span>
      </div>

      {rows.length === 0 ? <Empty text="No employees match." /> : (
        <div ref={gridRef} className="bg-white border border-slate-200 rounded-xl overflow-auto max-h-[62vh]">
          <table className="text-sm border-separate border-spacing-0">
            <thead className="sticky top-0 z-10">
              <tr className="text-left text-[11px] uppercase text-slate-500">
                <th className="sticky left-0 z-20 bg-slate-50 border-b border-slate-200 px-3 py-2 min-w-[220px]">Employee</th>
                {cols.map(c => <th key={c.key} className="bg-slate-50 border-b border-slate-200 px-2 py-2" style={{ minWidth: c.width }}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((e, ri) => (
                <tr key={e.id} className="hover:bg-violet-50/40">
                  <td className="sticky left-0 z-[5] bg-white border-b border-slate-100 px-3 py-1.5">
                    <div className="font-semibold text-slate-800 truncate max-w-[200px]">{e.name}</div>
                    <div className="text-[11px] text-slate-400">Badge {e.id}</div>
                  </td>
                  {cols.map(c => {
                    const typed = edits[e.id]?.[c.key];
                    const stored = getValue(c, e, pmap.get(e.id));
                    const st = cellState(e, c);
                    const val = typed !== undefined ? typed : shownValue(c, stored);
                    const cls = `w-full px-2 py-1.5 text-sm bg-transparent outline-none focus:ring-2 focus:ring-violet-400 rounded ${st.invalid ? 'bg-rose-100 text-rose-800' : st.dirty ? 'bg-amber-100' : stored === '' ? 'bg-slate-50/70' : ''}`;
                    const key = (ev: React.KeyboardEvent) => {
                      if (ev.key === 'Enter' || ev.key === 'ArrowDown') { ev.preventDefault(); move(ri, c.key, 1); }
                      else if (ev.key === 'ArrowUp') { ev.preventDefault(); move(ri, c.key, -1); }
                    };
                    return (
                      <td key={c.key} className="border-b border-slate-100 p-0.5">
                        {c.kind === 'select' ? (
                          <select data-cell={`${ri}:${c.key}`} className={cls} value={typed !== undefined ? typed : stored} onChange={ev => setCell(e.id, c.key, ev.target.value)} onKeyDown={key}>
                            <option value="" />{c.options?.map(o => <option key={o}>{o}</option>)}
                          </select>
                        ) : (
                          <input
                            data-cell={`${ri}:${c.key}`} className={cls} value={val} placeholder={c.kind === 'date' ? 'dd/mm/yyyy' : ''}
                            inputMode={c.kind === 'number' ? 'decimal' : undefined}
                            onChange={ev => setCell(e.id, c.key, c.upper ? ev.target.value.toUpperCase() : ev.target.value)} onKeyDown={key}
                            onFocus={ev => ev.target.select()}
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className={`sticky bottom-2 z-10 flex items-center justify-between gap-3 flex-wrap rounded-xl border px-4 py-2.5 shadow-lg ${summary.cells ? 'bg-amber-50 border-amber-300' : 'bg-white border-slate-200'}`}>
        <span className="text-sm text-slate-700">{summary.cells ? <><b>{summary.cells}</b> unsaved change(s) for <b>{summary.emps}</b> employee(s){summary.bad > 0 && <span className="text-rose-600 font-bold"> · {summary.bad} invalid</span>}</> : 'No unsaved changes'}</span>
        <span className="flex gap-2">
          <button className={btnGhost} disabled={!summary.cells} onClick={discard}><Undo2 className="h-3.5 w-3.5" />Discard</button>
          <button className={btnPrimary} disabled={saving || !summary.cells} onClick={save}><Save className="h-4 w-4" />{saving ? 'Saving…' : 'Save changes'}</button>
        </span>
      </div>
    </div>
  );
};
