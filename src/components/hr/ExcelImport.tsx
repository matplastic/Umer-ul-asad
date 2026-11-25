import React, { useMemo, useRef, useState } from 'react';
import { FileSpreadsheet, Upload, Download, CheckCircle2, AlertTriangle, X } from 'lucide-react';
import { Employee } from '../../types';
import {
  useHRCollection, HRProfile, HRDocument, HRTraining, HRPPE, HRVehicle, HRFuelLog, HRLeaveAdjust, HRExpense, logAudit,
} from '../../lib/hrStore';
import {
  readWorkbook, mapColumns, matchEmployee, cellText, downloadTemplate, downloadRows, Cell, MatchResult,
} from '../../lib/excelImport';
import { IMPORT_TYPES, IMPORT_ORDER, ImportTypeId, ImportCtx, RowResult } from './importTypes';
import { EmployeeSearchSelect } from './EmployeeSearchSelect';
import { btnPrimary, btnGhost, Badge, Empty, hrToast, StatCard } from './hrUi';

interface Props {
  employees: Employee[];
  user?: string;
  /** which imports this screen may offer */
  types?: ImportTypeId[];
  initialType?: ImportTypeId;
  /** Needed for the passport & visa import (it updates the Directory). */
  saveEmployees?: (list: Employee[]) => void | Promise<void>;
  onClose: () => void;
}

interface RawRow { n: number; vals: Record<string, Cell>; badge: string; name: string; match: MatchResult; hasWho: boolean }

const matchLabel: Record<string, { text: string; tone: 'emerald' | 'sky' | 'amber' | 'rose' }> = {
  badge: { text: 'Badge', tone: 'emerald' }, name: { text: 'Name', tone: 'sky' }, 'name-partial': { text: 'Name (partial) – check', tone: 'amber' },
  conflict: { text: 'Badge & name differ', tone: 'rose' }, ambiguous: { text: 'Several matches', tone: 'amber' }, none: { text: 'Not found', tone: 'rose' },
};
const actionTone = (a: RowResult['action']) => a === 'add' ? 'emerald' : a === 'update' ? 'sky' : a === 'skip' ? 'slate' : 'rose';
const actionText = (a: RowResult['action']) => a === 'add' ? 'Add' : a === 'update' ? 'Update' : a === 'skip' ? 'No change' : 'Problem';

export const ExcelImportModal: React.FC<Props> = ({ employees, user, types = IMPORT_ORDER, initialType, saveEmployees, onClose }) => {
  const [typeId, setTypeId] = useState<ImportTypeId>(initialType && types.includes(initialType) ? initialType : types[0]);
  const type = IMPORT_TYPES[typeId];
  const [fileName, setFileName] = useState('');
  const [raw, setRaw] = useState<RawRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [picked, setPicked] = useState<Record<number, string>>({});          // row → employee id chosen by hand
  const [included, setIncluded] = useState<Record<number, boolean>>({});     // row → manual tick
  const [filter, setFilter] = useState<'all' | 'ready' | 'problems' | 'nochange'>('all');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ added: number; updated: number; skipped: number; problems: number } | null>(null);
  const [drag, setDrag] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Existing data (needed to decide Add vs Update vs "already there") — only the lists this import uses.
  const profC = useHRCollection<HRProfile>('hrProfiles', typeId === 'profile');
  const docsC = useHRCollection<HRDocument>('hrDocuments', typeId === 'documents');
  const trainC = useHRCollection<HRTraining>('hrTraining', typeId === 'training');
  const ppeC = useHRCollection<HRPPE>('hrPPE', typeId === 'ppe');
  const vehC = useHRCollection<HRVehicle>('hrVehicles', typeId === 'vehicles' || typeId === 'fuel');
  const logC = useHRCollection<HRFuelLog>('hrFuelLogs', typeId === 'fuel');
  const adjC = useHRCollection<HRLeaveAdjust>('hrLeaveAdjust', typeId === 'leavebalance');
  const expC = useHRCollection<HRExpense>('hrExpenses', typeId === 'expenses');

  const ctx: ImportCtx = useMemo(() => ({
    employees, user, overwrite, profiles: profC.items, docs: docsC.items, training: trainC.items, ppe: ppeC.items,
    vehicles: vehC.items, logs: logC.items, leaveAdjusts: adjC.items, expenses: expC.items, saveEmployees: saveEmployees || (() => { throw new Error('Saving employees is not available here.'); }),
  }), [employees, user, overwrite, profC.items, docsC.items, trainC.items, ppeC.items, vehC.items, logC.items, adjC.items, expC.items, saveEmployees]);

  const reset = () => { setRaw(null); setFileName(''); setError(null); setPicked({}); setIncluded({}); setDone(null); setFilter('all'); };

  const onFile = async (file: File | undefined | null) => {
    if (!file) return;
    reset();
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) { setError('Please choose an Excel file (.xlsx or .xls) or a .csv file.'); return; }
    try {
      const { rows } = await readWorkbook(file);
      const { headerRow, index, missing } = mapColumns(rows, type.cols);
      const hasWho = index.badge !== undefined || index.name !== undefined;
      if (type.needsEmployee && !hasWho) { setError('The sheet needs a “Badge No” column and/or an “Employee Name” column so each row can be matched to an employee. Download the template to see the layout.'); return; }
      if (missing.length) { setError(`Missing column${missing.length > 1 ? 's' : ''}: ${missing.map(m => m.label).join(', ')}. Found headers: ${(rows[headerRow] || []).map(cellText).filter(Boolean).join(', ') || 'none'}.`); return; }
      const out: RawRow[] = [];
      for (let r = headerRow + 1; r < rows.length; r++) {
        const cells = rows[r] || [];
        if (!cells.some(c => cellText(c) !== '')) continue;
        const vals: Record<string, Cell> = {};
        for (const c of type.cols) vals[c.key] = index[c.key] !== undefined ? cells[index[c.key]] : '';
        const badge = cellText(vals.badge), name = cellText(vals.name);
        // skip a repeated header row
        if (/^(badge|employee)/i.test(badge) && /name/i.test(name)) continue;
        out.push({ n: r + 1, vals, badge, name, hasWho: !!(badge || name), match: hasWho && (badge || name) ? matchEmployee(badge, name, employees) : { status: 'none', candidates: [] } });
        if (out.length > 5000) { setError('That file has more than 5,000 rows. Please split it into smaller files.'); return; }
      }
      if (out.length === 0) { setError('No data rows were found under the header row.'); return; }
      setFileName(file.name); setRaw(out);
    } catch (e: any) { setError(e?.message || 'Could not read that file.'); }
  };

  // ── Evaluate every row against the chosen import type ──
  const rows = useMemo(() => {
    if (!raw) return [];
    const seen = new Map<string, number>();
    return raw.map(r => {
      const status = r.match.status;
      const auto = ['badge', 'name', 'name-partial'].includes(status) ? r.match.emp?.id : undefined;
      const empId = picked[r.n] ?? auto ?? '';
      const emp = employees.find(e => e.id === empId);
      let res = type.build(ctx, r.vals, emp, r.match);
      if (res.key && res.action !== 'error') {
        const prev = seen.get(res.key);
        if (prev !== undefined) res = { action: 'skip', message: `Same record as row ${prev} in this file`, summary: res.summary, key: res.key };
        else seen.set(res.key, r.n);
      }
      const ready = res.action === 'add' || res.action === 'update';
      // Partial-name matches are never ticked automatically — a person confirms them.
      const tick = included[r.n] ?? (ready && !(status === 'name-partial' && picked[r.n] === undefined));
      return { r, empId, emp, res, ready, tick: ready && tick };
    });
  }, [raw, picked, included, ctx, type, employees]);

  const counts = useMemo(() => ({
    add: rows.filter(x => x.res.action === 'add').length,
    update: rows.filter(x => x.res.action === 'update').length,
    skip: rows.filter(x => x.res.action === 'skip').length,
    error: rows.filter(x => x.res.action === 'error').length,
    selected: rows.filter(x => x.tick).length,
  }), [rows]);

  const shown = rows.filter(x => filter === 'all' || (filter === 'ready' && x.ready) || (filter === 'problems' && x.res.action === 'error') || (filter === 'nochange' && x.res.action === 'skip'));
  const showWho = type.needsEmployee || type.id === 'fuel' || type.id === 'expenses';

  const run = async () => {
    const take = rows.filter(x => x.tick && x.res.payload);
    if (!take.length) { hrToast('Nothing selected to import', 'err'); return; }
    setSaving(true);
    try {
      await type.commit(ctx, take.map(x => x.res.payload));
      const added = take.filter(x => x.res.action === 'add').length, updated = take.filter(x => x.res.action === 'update').length;
      logAudit(user, 'Excel import', `${type.label}: ${added} added, ${updated} updated (${fileName})`);
      setDone({ added, updated, skipped: counts.skip, problems: counts.error });
    } catch (e: any) {
      console.error('[excel import] save failed', e);
      setError(e?.message ? `Could not save: ${e.message}` : 'Could not save — nothing was changed. Check the connection and try again.');
    } finally { setSaving(false); }
  };

  const downloadProblems = () => downloadRows(`Import_problems_${type.id}.xlsx`, rows.filter(x => x.res.action === 'error' || (x.r.hasWho && !x.emp && type.needsEmployee)).map(x => ({
    'Excel row': x.r.n, 'Badge in sheet': x.r.badge, 'Name in sheet': x.r.name, 'Match result': matchLabel[x.r.match.status]?.text || '', 'Problem': x.res.message || '',
  })));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[94vh] flex flex-col">
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <h3 className="font-black text-slate-800 flex items-center gap-2"><FileSpreadsheet className="h-5 w-5 text-emerald-600" />Import from Excel</h3>
          <button onClick={onClose} aria-label="Close"><X className="h-5 w-5 text-slate-400" /></button>
        </div>

        <div className="px-6 pb-5 overflow-y-auto space-y-4">
          {/* choose what to import */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {types.map(id => (
              <button key={id} onClick={() => { setTypeId(id); reset(); }}
                className={`text-left p-3 rounded-xl border transition-colors ${typeId === id ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                <div className="text-sm font-bold text-slate-800">{IMPORT_TYPES[id].label}</div>
                <div className="text-[11px] text-slate-400 mt-0.5 line-clamp-2">{IMPORT_TYPES[id].blurb}</div>
              </button>
            ))}
          </div>

          {!done && (
            <div className="flex flex-wrap items-center gap-2">
              <button className={btnGhost} onClick={() => downloadTemplate(type.templateFile, type.cols, type.notes)}><Download className="h-3.5 w-3.5" />Download template</button>
              <span className="text-xs text-slate-400">Use the template, or your own sheet — columns are found by their names.</span>
            </div>
          )}

          {error && <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl px-4 py-3 text-sm"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /><span>{error}</span></div>}

          {/* upload */}
          {!raw && !done && (
            <div
              onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
              onDrop={e => { e.preventDefault(); setDrag(false); onFile(e.dataTransfer.files?.[0]); }}
              onClick={() => fileInput.current?.click()}
              className={`border-2 border-dashed rounded-2xl py-12 text-center cursor-pointer ${drag ? 'border-emerald-500 bg-emerald-50' : 'border-slate-300 hover:bg-slate-50'}`}>
              <Upload className="h-8 w-8 text-slate-400 mx-auto mb-2" />
              <div className="text-sm font-bold text-slate-700">Drop your Excel file here, or click to choose</div>
              <div className="text-xs text-slate-400 mt-1">.xlsx, .xls or .csv · up to 5,000 rows · nothing is saved until you press Import</div>
              <input ref={fileInput} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
            </div>
          )}

          {/* preview */}
          {raw && !done && (<>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm text-slate-600"><b>{fileName}</b> · {raw.length} row(s) read as <b>{type.label}</b></div>
              <button className={btnGhost} onClick={reset}>Choose another file</button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="Will be added" value={counts.add} tone="emerald" onClick={() => setFilter('ready')} />
              <StatCard label="Will be updated" value={counts.update} tone="violet" onClick={() => setFilter('ready')} />
              <StatCard label="No change / duplicate" value={counts.skip} tone="slate" onClick={() => setFilter('nochange')} />
              <StatCard label="Problems" value={counts.error} tone={counts.error ? 'rose' : 'slate'} onClick={() => setFilter('problems')} />
            </div>

            {type.supportsOverwrite && (
              <div className="flex flex-wrap items-center gap-4 bg-slate-50 rounded-xl px-4 py-2.5 text-sm">
                <label className="flex items-center gap-2 cursor-pointer"><input type="radio" className="accent-emerald-600" checked={!overwrite} onChange={() => setOverwrite(false)} />Only fill blanks <span className="text-xs text-slate-400">(keep what is already saved)</span></label>
                <label className="flex items-center gap-2 cursor-pointer"><input type="radio" className="accent-emerald-600" checked={overwrite} onChange={() => setOverwrite(true)} />Replace existing values with the sheet</label>
              </div>
            )}

            <div className="flex items-center gap-2">
              <select className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white" value={filter} onChange={e => setFilter(e.target.value as any)}>
                <option value="all">Show all rows</option><option value="ready">Ready to import</option><option value="problems">Problems only</option><option value="nochange">No change / duplicates</option>
              </select>
              <button className={btnGhost} onClick={() => setIncluded(Object.fromEntries(rows.filter(x => x.ready).map(x => [x.r.n, true])))}>Tick all ready</button>
              <button className={btnGhost} onClick={() => setIncluded(Object.fromEntries(rows.map(x => [x.r.n, false])))}>Untick all</button>
              {counts.error > 0 && <button className={btnGhost} onClick={downloadProblems}><Download className="h-3.5 w-3.5" />Problem rows (Excel)</button>}
            </div>

            {shown.length === 0 ? <Empty text="No rows in this view." /> : (
              <div className="border border-slate-200 rounded-xl overflow-auto max-h-[44vh]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white z-10"><tr className="text-left text-[11px] uppercase text-slate-400 border-b border-slate-100">
                    <th className="px-3 py-2 w-8" /><th className="px-3 py-2">Row</th><th className="px-3 py-2">In your Excel</th>
                    {showWho && <th className="px-3 py-2 min-w-[240px]">Matched employee</th>}<th className="px-3 py-2">What will happen</th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-50">
                    {shown.map(x => {
                      const ml = matchLabel[x.r.match.status];
                      return (
                        <tr key={x.r.n} className={x.res.action === 'error' ? 'bg-rose-50/40' : ''}>
                          <td className="px-3 py-2"><input type="checkbox" className="accent-emerald-600" disabled={!x.ready} checked={x.tick} onChange={e => setIncluded(p => ({ ...p, [x.r.n]: e.target.checked }))} /></td>
                          <td className="px-3 py-2 text-slate-400">{x.r.n}</td>
                          <td className="px-3 py-2 text-slate-700">{x.r.hasWho ? <>{x.r.badge && <b>{x.r.badge}</b>}{x.r.badge && x.r.name ? ' · ' : ''}{x.r.name}</> : <span className="text-slate-500">{cellText(x.r.vals.plate) || '—'}</span>}</td>
                          {showWho && (
                            <td className="px-3 py-2">
                              {x.r.hasWho ? (<div className="space-y-1">
                                <EmployeeSearchSelect employees={employees} value={x.empId} onChange={id => { setPicked(p => ({ ...p, [x.r.n]: id })); setIncluded(p => ({ ...p, [x.r.n]: true })); }} accent="teal" placeholder="Choose employee…" />
                                {picked[x.r.n] === undefined && ml && <Badge tone={ml.tone}>{ml.text}</Badge>}
                                {picked[x.r.n] !== undefined && <Badge tone="violet">Chosen by you</Badge>}
                              </div>) : <span className="text-xs text-slate-400">—</span>}
                            </td>
                          )}
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2 flex-wrap"><Badge tone={actionTone(x.res.action) as any}>{actionText(x.res.action)}</Badge>
                              <span className={`text-xs ${x.res.action === 'error' ? 'text-rose-700 font-semibold' : 'text-slate-600'}`}>{x.res.action === 'error' || x.res.action === 'skip' ? (x.res.message || x.res.summary) : x.res.summary}</span></div>
                            {x.res.action === 'skip' && x.res.message && x.res.summary && <div className="text-[11px] text-slate-400">{x.res.summary}</div>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
              <p className="text-xs text-slate-400">{counts.selected} row(s) ticked. Rows with a problem are never imported — fix the employee on the row, or correct your Excel and upload again.</p>
              <button className={btnPrimary} disabled={saving || counts.selected === 0} onClick={run}>{saving ? 'Saving…' : `Import ${counts.selected} record(s)`}</button>
            </div>
          </>)}

          {/* result */}
          {done && (
            <div className="text-center py-8 space-y-3">
              <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto" />
              <div className="text-lg font-black text-slate-800">Import finished</div>
              <div className="text-sm text-slate-600">{done.added} added · {done.updated} updated · {done.skipped} unchanged · {done.problems} not imported</div>
              <div className="flex justify-center gap-2 pt-2">
                {done.problems > 0 && <button className={btnGhost} onClick={downloadProblems}><Download className="h-3.5 w-3.5" />Download problem rows</button>}
                <button className={btnGhost} onClick={reset}>Import another file</button>
                <button className={btnPrimary} onClick={onClose}>Close</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/** Small “Import from Excel” button that opens the importer for the given types. */
export const ImportButton: React.FC<Omit<Props, 'onClose'> & { label?: string }> = ({ label = 'Import from Excel', ...rest }) => {
  const [open, setOpen] = useState(false);
  return (<>
    <button className={btnGhost} onClick={() => setOpen(true)}><FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />{label}</button>
    {open && <ExcelImportModal {...rest} onClose={() => setOpen(false)} />}
  </>);
};
