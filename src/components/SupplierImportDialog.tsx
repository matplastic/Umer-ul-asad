import React, { useMemo, useRef, useState } from 'react';
import { X, Upload, Download, FileSpreadsheet, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { Supplier } from '../types';
import { readWorkbook, downloadRows } from '../lib/excelImport';
import { parseSupplierRows, downloadSupplierTemplate, type ParsedSheet, type ImportRow } from '../lib/supplierExcel';
import { dbBulkSaveSuppliers, SupplierError } from '../lib/firebaseService';

interface Props {
  suppliers: Supplier[];            // the current list — used to tell NEW from UPDATE
  currentUserName: string;
  onClose: () => void;
  onDone: () => void;               // called after a successful import so the list reloads
}

type Filter = 'all' | 'new' | 'update' | 'error';

export const SupplierImportDialog: React.FC<Props> = ({ suppliers, currentUserName, onClose, onDone }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<ParsedSheet | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [updateExisting, setUpdateExisting] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ created: number; updated: number; failed: { name: string; error: string }[] } | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setReadError(null); setParsed(null); setResult(null); setFilter('all'); setFileName(file.name);
    try {
      const { rows } = await readWorkbook(file);
      setParsed(parseSupplierRows(rows, suppliers));
    } catch (e: any) {
      setReadError(e?.message || 'Could not read that file. Please upload an .xlsx, .xls or .csv file.');
    }
  };

  const rows: ImportRow[] = parsed?.rows || [];
  const counts = useMemo(() => ({
    all: rows.length,
    new: rows.filter((r) => r.action === 'new').length,
    update: rows.filter((r) => r.action === 'update').length,
    error: rows.filter((r) => r.action === 'error').length,
    warn: rows.filter((r) => r.action !== 'error' && r.warnings.length).length,
  }), [rows]);

  const toImport = rows.filter((r) => r.action === 'new' || (r.action === 'update' && updateExisting));
  const shown = rows.filter((r) => filter === 'all' || r.action === filter);

  const run = async () => {
    if (!toImport.length) return;
    setSaving(true);
    try {
      const res = await dbBulkSaveSuppliers(toImport.map((r) => ({ matchId: r.matchId, input: r.input })), currentUserName);
      setResult(res);
      onDone();
    } catch (e: any) {
      setReadError(e instanceof SupplierError ? e.message : (e?.message || 'Import failed — nothing was saved. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  const problemsReport = () => downloadRows(
    `Supplier_Import_Problems_${new Date().toISOString().slice(0, 10)}.xlsx`,
    rows.filter((r) => r.errors.length || r.warnings.length).map((r) => ({
      Row: r.rowNo, Supplier: r.name, Result: r.action === 'error' ? 'NOT imported' : 'Imported with notes',
      Problems: [...r.errors, ...r.warnings].join(' | '),
    })),
  );

  const chip = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all ${active ? 'bg-primary-600 text-white shadow' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`;
  const pill = (a: ImportRow['action']) => {
    const m = {
      new: 'bg-emerald-50 text-emerald-700 border-emerald-200', update: 'bg-sky-50 text-sky-700 border-sky-200', error: 'bg-rose-50 text-rose-700 border-rose-200',
    }[a];
    return <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase border ${m}`}>{a === 'new' ? 'New' : a === 'update' ? 'Update' : 'Error'}</span>;
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-3 z-[60]" data-testid="supplier-import">
      <div className="bg-white border border-slate-300 rounded-2xl w-full max-w-5xl shadow-2xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-base font-black text-slate-900">Upload suppliers from Excel</h2>
            <div className="text-[11px] text-slate-500">Add many suppliers at once. Existing suppliers (same name or TRN) are updated, not duplicated.</div>
          </div>
          <button onClick={onClose} className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-lg cursor-pointer"><X className="h-4 w-4" /></button>
        </div>

        <div className="overflow-auto px-5 py-4 space-y-4">
          {/* Step 1 — file */}
          <div className="flex flex-wrap items-center gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50">
            <button onClick={downloadSupplierTemplate} data-testid="supplier-import-template" className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-bold cursor-pointer">
              <Download className="h-3.5 w-3.5" /> Download template
            </button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" data-testid="supplier-import-file" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
            <button onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 px-3 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-xs font-bold cursor-pointer">
              <Upload className="h-3.5 w-3.5" /> Choose Excel file
            </button>
            {fileName && <span className="flex items-center gap-1.5 text-xs text-slate-600"><FileSpreadsheet className="h-4 w-4 text-emerald-700" /> {fileName}</span>}
          </div>

          {readError && <div className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-xs text-rose-700 font-semibold" data-testid="supplier-import-error">{readError}</div>}

          {parsed && parsed.missingColumns.length > 0 && (
            <div className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-xs text-rose-700">
              <b>Could not find the column: {parsed.missingColumns.join(', ')}.</b> Make sure the first row of your sheet has a “Supplier Name” heading, or download the template and copy your suppliers into it.
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50" data-testid="supplier-import-result">
              <div className="flex items-center gap-2 text-sm font-black text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Import finished</div>
              <div className="text-xs text-slate-700 mt-1">
                <b>{result.created}</b> new supplier{result.created === 1 ? '' : 's'} added · <b>{result.updated}</b> updated
                {result.failed.length > 0 && <> · <b className="text-rose-700">{result.failed.length} not saved</b></>}
              </div>
              {result.failed.length > 0 && (
                <ul className="mt-2 text-[11px] text-rose-700 list-disc ml-5">
                  {result.failed.slice(0, 10).map((f, i) => <li key={i}>{f.name}: {f.error}</li>)}
                </ul>
              )}
              <div className="text-[11px] text-slate-500 mt-2">The Store and Procurement supplier lists share the same data, so these suppliers are now available in both.</div>
            </div>
          )}

          {/* Step 2 — preview */}
          {parsed && parsed.missingColumns.length === 0 && !result && (
            rows.length === 0
              ? <div className="p-6 text-center text-xs text-slate-500">No supplier rows found under the header row.</div>
              : <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: 'New suppliers', value: counts.new, cls: 'text-emerald-700' },
                    { label: 'Will update existing', value: counts.update, cls: 'text-sky-700' },
                    { label: 'Rows with errors (skipped)', value: counts.error, cls: counts.error ? 'text-rose-700' : 'text-slate-500' },
                    { label: 'Imported with notes', value: counts.warn, cls: counts.warn ? 'text-amber-700' : 'text-slate-500' },
                  ].map((c) => (
                    <div key={c.label} className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                      <div className="text-[10px] uppercase font-bold text-slate-500">{c.label}</div>
                      <div className={`font-mono font-black text-base ${c.cls}`}>{c.value}</div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {(['all', 'new', 'update', 'error'] as const).map((f) => (
                    <button key={f} onClick={() => setFilter(f)} className={chip(filter === f)}>
                      {f === 'all' ? 'All' : f === 'new' ? 'New' : f === 'update' ? 'Updates' : 'Errors'} ({counts[f]})
                    </button>
                  ))}
                  <label className="ml-auto flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                    <input type="checkbox" checked={updateExisting} onChange={(e) => setUpdateExisting(e.target.checked)} />
                    Update suppliers that already exist
                  </label>
                  {(counts.error > 0 || counts.warn > 0) && (
                    <button onClick={problemsReport} className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-lg text-xs font-bold cursor-pointer">
                      <AlertTriangle className="h-3.5 w-3.5" /> Problems report
                    </button>
                  )}
                </div>

                <div className="overflow-auto max-h-[44vh] border border-slate-200 rounded-xl">
                  <table className="w-full text-xs min-w-[860px]">
                    <thead className="sticky top-0 bg-white z-10">
                      <tr className="text-[10px] uppercase text-slate-500">
                        <th className="text-left py-2 px-3">Row</th>
                        <th className="text-left py-2 px-3">Supplier</th>
                        <th className="text-left py-2 px-3">Result</th>
                        <th className="text-left py-2 px-3">Contact</th>
                        <th className="text-left py-2 px-3">TRN</th>
                        <th className="text-left py-2 px-3">Terms</th>
                        <th className="text-left py-2 px-3">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((r) => (
                        <tr key={r.rowNo} className="border-t border-slate-200 hover:bg-slate-50 align-top">
                          <td className="py-2 px-3 font-mono text-slate-500">{r.rowNo}</td>
                          <td className="py-2 px-3 font-semibold text-slate-900">{r.name}{r.matchCode && <div className="text-[10px] font-mono text-slate-500">{r.matchCode}</div>}</td>
                          <td className="py-2 px-3">{pill(r.action)}</td>
                          <td className="py-2 px-3 text-slate-700">{r.input.contactPerson || '—'}{r.input.phone && <div className="text-[10px] font-mono text-slate-500">{r.input.phone}</div>}{r.input.email && <div className="text-[10px] text-slate-500">{r.input.email}</div>}</td>
                          <td className="py-2 px-3 font-mono text-slate-700">{r.input.taxNo || '—'}</td>
                          <td className="py-2 px-3 text-slate-700">{r.input.paymentTerms || '—'}</td>
                          <td className="py-2 px-3 text-[11px]">
                            {r.errors.map((m, i) => <div key={`e${i}`} className="text-rose-700 font-semibold">{m}</div>)}
                            {r.warnings.map((m, i) => <div key={`w${i}`} className="text-amber-700">{m}</div>)}
                          </td>
                        </tr>
                      ))}
                      {shown.length === 0 && <tr><td colSpan={7} className="text-center text-slate-500 py-8">Nothing in this filter.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </>
          )}
        </div>

        <div className="px-5 py-4 border-t border-slate-200 flex items-center justify-between gap-3">
          <div className="text-[11px] text-slate-500">
            {parsed && !result && parsed.missingColumns.length === 0 && rows.length > 0
              ? `${toImport.length} of ${rows.length} row${rows.length === 1 ? '' : 's'} will be saved.`
              : 'Nothing is saved until you click Import.'}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold cursor-pointer">{result ? 'Close' : 'Cancel'}</button>
            {!result && (
              <button onClick={run} disabled={saving || toImport.length === 0} data-testid="supplier-import-run" className="px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold cursor-pointer">
                {saving ? 'Importing…' : `Import ${toImport.length || ''} supplier${toImport.length === 1 ? '' : 's'}`.replace('  ', ' ')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
