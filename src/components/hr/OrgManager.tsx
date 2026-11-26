// Companies & departments — create them once, then pick them everywhere (no more typing "Factory" five ways).
//  • OrgManagerModal : add / rename / remove companies and departments
//  • OrgFilters      : the Company + Department dropdowns used on every HR list
//  • matchOrg        : the filter rule behind those dropdowns
import React, { useMemo, useState } from 'react';
import { Plus, Trash2, Pencil, Check, X, Building2, Layers } from 'lucide-react';
import type { Employee } from '../../types';
import { DEPARTMENT_SUGGESTIONS, mergeOptions } from '../../lib/hrStore';
import { Modal, inputCls, btnPrimary, hrToast } from './hrUi';

export const UNASSIGNED = '(Not set)';

/** Company + department filter rule. 'All' = no filter; UNASSIGNED = employees with nothing set. */
export function matchOrg(e: Pick<Employee, 'companyName' | 'department'>, company: string, dept: string): boolean {
  const c = (e.companyName || '').trim();
  const d = (e.department || '').trim();
  const okC = company === 'All' || (company === UNASSIGNED ? !c : c === company);
  const okD = dept === 'All' || (dept === UNASSIGNED ? !d : d === dept);
  return okC && okD;
}

/** "Company · Department" for subtitles. */
export const orgLabel = (e: Pick<Employee, 'companyName' | 'department'>) =>
  [e.companyName, e.department].map(x => (x || '').trim()).filter(Boolean).join(' · ');

/** Options for the two dropdowns, built from what employees actually have (plus any saved lists). */
export function useOrgOptions(employees: Employee[], savedCompanies: string[] = [], savedDepartments: string[] = []) {
  return useMemo(() => {
    const companies = mergeOptions(savedCompanies, employees.map(e => e.companyName));
    const departments = mergeOptions(savedDepartments, employees.map(e => e.department));
    return {
      companies, departments,
      hasNoCompany: employees.some(e => !(e.companyName || '').trim()),
      hasNoDept: employees.some(e => !(e.department || '').trim()),
    };
  }, [employees, savedCompanies, savedDepartments]);
}

export const OrgFilters: React.FC<{
  employees: Employee[];
  company: string; dept: string;
  onCompany: (v: string) => void; onDept: (v: string) => void;
  savedCompanies?: string[]; savedDepartments?: string[];
  className?: string;
}> = ({ employees, company, dept, onCompany, onDept, savedCompanies, savedDepartments, className }) => {
  const o = useOrgOptions(employees, savedCompanies, savedDepartments);
  const cls = className || (inputCls + ' !w-auto');
  return (
    <>
      <select className={cls} value={company} onChange={e => onCompany(e.target.value)} title="Company">
        <option value="All">All companies</option>
        {o.companies.map(c => <option key={c} value={c}>{c}</option>)}
        {o.hasNoCompany && <option value={UNASSIGNED}>{UNASSIGNED}</option>}
      </select>
      <select className={cls} value={dept} onChange={e => onDept(e.target.value)} title="Department">
        <option value="All">All departments</option>
        {o.departments.map(d => <option key={d} value={d}>{d}</option>)}
        {o.hasNoDept && <option value={UNASSIGNED}>{UNASSIGNED}</option>}
      </select>
    </>
  );
};

// ─── Manage lists ───────────────────────────────────────────

type Kind = 'company' | 'department';

interface ModalProps {
  employees: Employee[];
  companies: string[];                       // HR's saved company list
  departments: string[];                     // HR's saved department list
  onSaveCompanies?: (list: string[]) => void;
  onSaveDepartments: (list: string[]) => void | Promise<void>;
  /** needed to rename (re-labels every employee that uses the old name) */
  saveEmployees?: (list: Employee[]) => void | Promise<void>;
  initialTab?: Kind;
  onClose: () => void;
}

export const OrgManagerModal: React.FC<ModalProps> = ({ employees, companies, departments, onSaveCompanies, onSaveDepartments, saveEmployees, initialTab = 'department', onClose }) => {
  const [tab, setTab] = useState<Kind>(initialTab);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editVal, setEditVal] = useState('');

  const field = tab === 'company' ? 'companyName' : 'department';
  // what the person sees: saved list + anything already on employees
  const list = useMemo(
    () => mergeOptions(tab === 'company' ? companies : departments, employees.map(e => (e as any)[field])),
    [tab, companies, departments, employees, field],
  );
  const savedSet = useMemo(() => new Set((tab === 'company' ? companies : departments).map(x => x.toLowerCase())), [tab, companies, departments]);
  const count = (v: string) => employees.filter(e => ((e as any)[field] || '').trim() === v).length;
  const noun = tab === 'company' ? 'company' : 'department';

  const persist = (next: string[]) => (tab === 'company' ? onSaveCompanies?.(next) : onSaveDepartments(next));

  const add = (raw?: string) => {
    const v = (raw ?? name).trim();
    if (!v) return;
    if (list.some(x => x.toLowerCase() === v.toLowerCase())) { hrToast(`"${v}" is already in the list`, 'err'); setName(''); return; }
    persist([...list, v]);       // saving the merged list keeps every in-use value too
    setName('');
  };

  const remove = (v: string) => {
    const n = count(v);
    if (n > 0) { hrToast(`${n} employee(s) still use "${v}". Rename it, or move them first.`, 'err'); return; }
    persist(list.filter(x => x !== v));
  };

  const rename = async (oldV: string) => {
    const nv = editVal.trim();
    if (!nv || nv === oldV) { setEditing(null); return; }
    if (list.some(x => x !== oldV && x.toLowerCase() === nv.toLowerCase())) { hrToast(`"${nv}" already exists`, 'err'); return; }
    const affected = employees.filter(e => ((e as any)[field] || '').trim() === oldV);
    if (affected.length) {
      if (!saveEmployees) { hrToast('Renaming isn\'t available here', 'err'); return; }
      if (!window.confirm(`Rename "${oldV}" to "${nv}" for ${affected.length} employee(s)?`)) return;
      await saveEmployees(affected.map(e => ({ ...e, [field]: nv } as Employee)));
    }
    persist(list.map(x => (x === oldV ? nv : x)));
    setEditing(null);
    hrToast(`Renamed to "${nv}"`);
  };

  const suggestions = tab === 'department' ? DEPARTMENT_SUGGESTIONS.filter(s => !list.some(x => x.toLowerCase() === s.toLowerCase())) : [];

  return (
    <Modal title="Companies & Departments" onClose={onClose} footer={<button className={btnPrimary} onClick={onClose}>Done</button>}>
      <p className="text-xs text-slate-500">
        Create your companies and departments once (for example <b>Factory</b>, <b>Office</b>, <b>PMO</b>, <b>Dubai Office</b>, <b>Umm Al Quwain Office</b>), then pick them for each employee.
        They appear as dropdowns and filters in Directory, Employee 360, Quick Entry and the reports, and sync to every device.
      </p>

      <div className="flex gap-1">
        {([['department', 'Departments', Layers], ['company', 'Companies', Building2]] as const).map(([k, label, Icon]) => (
          <button key={k} onClick={() => { setTab(k); setEditing(null); setName(''); }}
            className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full border ${tab === k ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-500 border-slate-200'}`}>
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <input className={inputCls} value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); }}
          placeholder={tab === 'company' ? 'e.g. MAT Fiber Solutions LLC' : 'e.g. Dubai Office'} />
        <button className={btnPrimary} onClick={() => add()}><Plus className="h-4 w-4" /> Add</button>
      </div>

      {suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-slate-400">Quick add:</span>
          {suggestions.map(s => (
            <button key={s} onClick={() => add(s)} className="text-[11px] font-bold px-2 py-0.5 rounded-full border border-dashed border-violet-300 text-violet-700 hover:bg-violet-50">+ {s}</button>
          ))}
        </div>
      )}

      <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-lg">
        {list.length === 0 ? (
          <p className="text-center py-8 text-slate-400 text-sm">No {noun === 'company' ? 'companies' : 'departments'} yet — add one above.</p>
        ) : list.map(v => {
          const n = count(v);
          return (
            <div key={v} className="flex items-center justify-between gap-2 px-3 py-2.5">
              {editing === v ? (
                <input autoFocus className={inputCls} value={editVal} onChange={e => setEditVal(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') rename(v); if (e.key === 'Escape') setEditing(null); }} />
              ) : (
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-700 truncate">{v}</p>
                  <p className="text-[11px] text-slate-400">
                    {n} employee{n === 1 ? '' : 's'}{!savedSet.has(v.toLowerCase()) ? ' · found on employees, not in your list yet' : ''}
                  </p>
                </div>
              )}
              <div className="flex items-center gap-1 shrink-0">
                {editing === v ? (
                  <>
                    <button className="text-emerald-600 p-1" title="Save" onClick={() => rename(v)}><Check className="h-4 w-4" /></button>
                    <button className="text-slate-400 p-1" title="Cancel" onClick={() => setEditing(null)}><X className="h-4 w-4" /></button>
                  </>
                ) : (
                  <>
                    <button className="text-slate-300 hover:text-violet-600 p-1" title="Rename" onClick={() => { setEditing(v); setEditVal(v); }}><Pencil className="h-4 w-4" /></button>
                    <button className="text-slate-300 hover:text-rose-600 p-1" title={n ? 'Move the employees first' : 'Remove'} onClick={() => remove(v)}><Trash2 className="h-4 w-4" /></button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-slate-400">Tip: to put many people in a department at once, use <b>Quick Entry</b> (type or pick in the grid) or add a "Department" / "Company" column to your Excel import.</p>
    </Modal>
  );
};

