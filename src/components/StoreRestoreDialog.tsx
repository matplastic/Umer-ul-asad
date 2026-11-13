import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck, X } from 'lucide-react';
import {
  BACKUP_DOC_IDS, BACKUP_GROUP_LABELS, BackupGroup, RestoreMode, RestoreReportRow, planRestore, BACKUP_DOC_BY_ID,
} from '../lib/backupSets';

interface Props {
  label: string;                              // where the backup came from, e.g. "Automatic backup 12 Nov 2026, 00:00"
  backupDocs: Record<string, any[]>;          // the lists inside that backup
  onClose: () => void;
  // Database access, supplied by the Management screen (firebaseService):
  loadCurrent: (ids: string[]) => Promise<Record<string, any[]>>;   // dbExportBackupDocs
  restore: (args: { docs: Record<string, any[]>; names: string[]; mode: RestoreMode; label: string }) => Promise<RestoreReportRow[]>;   // dbRestoreBackupDocs
}

const GROUP_ORDER: BackupGroup[] = ['store', 'production', 'hr'];

// Restore dialog for Store / production / QC / HR lists, used for both Google
// Drive backup files and automatic backups. It never changes anything until
// "Restore" is pressed, and the safety rules (copy first, refuse to erase,
// fail-safe) live in lib/backupSets.ts -> runRestore.
export const StoreRestoreDialog: React.FC<Props> = ({ label, backupDocs, onClose, loadCurrent, restore }) => {
  const [current, setCurrent] = useState<Record<string, any[]> | null>(null);
  const [loadError, setLoadError] = useState('');
  const [mode, setMode] = useState<RestoreMode>('merge');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmText, setConfirmText] = useState('');
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<RestoreReportRow[] | null>(null);

  const idsInBackup = useMemo(() => BACKUP_DOC_IDS.filter((id) => Array.isArray(backupDocs[id])), [backupDocs]);

  // Load what is in the database right now, so the preview is accurate.
  useEffect(() => {
    let alive = true;
    loadCurrent(idsInBackup)
      .then((c) => { if (alive) setCurrent(c); })
      .catch((e) => { if (alive) setLoadError(e?.message || 'Could not read the current data.'); });
    return () => { alive = false; };
  }, [idsInBackup, loadCurrent]);

  const rows = useMemo(() => (current ? planRestore(current, backupDocs).filter((r) => r.inBackup) : []), [current, backupDocs]);

  // Safe default: "add missing" with every list that has something to add ticked.
  useEffect(() => {
    if (!current) return;
    setSelected(new Set(rows.filter((r) => r.onlyInBackup > 0).map((r) => r.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  const switchMode = (m: RestoreMode) => {
    setMode(m);
    setConfirmText('');
    // Replacing is deliberate: start with nothing ticked.
    setSelected(m === 'merge' ? new Set(rows.filter((r) => r.onlyInBackup > 0).map((r) => r.id)) : new Set());
  };

  const toggle = (id: string) => setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleGroup = (g: BackupGroup, on: boolean) => setSelected((prev) => {
    const n = new Set(prev);
    rows.filter((r) => r.group === g).forEach((r) => { if (on) n.add(r.id); else n.delete(r.id); });
    return n;
  });

  const totalAdds = rows.filter((r) => selected.has(r.id)).reduce((t, r) => t + r.onlyInBackup, 0);
  const needsTyped = mode === 'replace';
  const canRun = !running && selected.size > 0 && (!needsTyped || confirmText.trim().toUpperCase() === 'RESTORE')
    && (mode === 'replace' || totalAdds > 0);

  const run = async () => {
    setRunning(true);
    try {
      const rep = await restore({ docs: backupDocs, names: [...selected], mode, label });
      setReport(rep);
    } catch (e: any) {
      setReport([{ id: '—', status: 'failed', before: 0, after: 0, added: 0, reason: e?.message || 'Restore failed.' }]);
    } finally {
      setRunning(false);
    }
  };

  const labelOf = (id: string) => BACKUP_DOC_BY_ID[id]?.label || id;

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-slate-900/60" data-testid="store-restore-dialog">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-slate-100">
          <div>
            <h3 className="text-base font-black text-slate-800">Restore Store / HR data</h3>
            <p className="text-xs text-slate-500 mt-0.5">From: <strong>{label}</strong></p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 cursor-pointer"><X className="h-5 w-5" /></button>
        </div>

        <div className="px-6 py-4 overflow-y-auto space-y-4 text-xs">
          {report ? (
            <div data-testid="restore-report">
              <div className="flex items-center gap-2 font-bold text-slate-800 mb-3">
                {report.some((r) => r.status === 'failed') ? <AlertTriangle className="h-4 w-4 text-amber-600" /> : <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                Restore finished
              </div>
              <table className="w-full text-[11px]">
                <thead><tr className="text-left text-slate-400 uppercase text-[10px]"><th className="py-1.5">List</th><th>Result</th><th className="text-right">Before</th><th className="text-right">After</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {report.map((r) => (
                    <tr key={r.id} data-testid={`restore-row-${r.id}`}>
                      <td className="py-2 font-semibold text-slate-700">{labelOf(r.id)}</td>
                      <td className={r.status === 'failed' ? 'text-rose-600' : r.status === 'skipped' ? 'text-amber-600' : 'text-emerald-700'}>
                        <span className="font-bold uppercase text-[10px]">{r.status}</span>
                        {r.added > 0 && <span> · {r.added} added</span>}
                        {r.reason && <div className="text-[10.5px] text-slate-500 font-normal">{r.reason}</div>}
                      </td>
                      <td className="text-right font-mono text-slate-500">{r.before}</td>
                      <td className="text-right font-mono text-slate-700">{r.after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-[11px] text-slate-500 flex items-start gap-1.5"><ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />A copy of each list as it was just before this restore was saved in the database (system_state → names starting "preRestore_"), in case you need to undo.</p>
            </div>
          ) : loadError ? (
            <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-4">
              <strong>Could not read the current data.</strong> {loadError}<br />A restore can't be previewed safely without it, so nothing has been changed.
            </div>
          ) : !current ? (
            <div className="flex items-center gap-2 text-slate-500 py-8 justify-center"><Loader2 className="h-4 w-4 animate-spin" /> Comparing the backup with your current data…</div>
          ) : (
            <>
              <div className="grid sm:grid-cols-2 gap-2">
                <label className={`border rounded-xl p-3 cursor-pointer ${mode === 'merge' ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200'}`}>
                  <input type="radio" name="mode" checked={mode === 'merge'} onChange={() => switchMode('merge')} data-testid="mode-merge" className="mr-2 accent-emerald-600" />
                  <strong className="text-slate-800">Add missing records only</strong> <span className="text-emerald-700 font-bold">(safe)</span>
                  <p className="text-slate-500 mt-1 ml-5">Brings back anything that was deleted or lost. Everything currently in the database is kept exactly as it is.</p>
                </label>
                <label className={`border rounded-xl p-3 cursor-pointer ${mode === 'replace' ? 'border-rose-400 bg-rose-50' : 'border-slate-200'}`}>
                  <input type="radio" name="mode" checked={mode === 'replace'} onChange={() => switchMode('replace')} data-testid="mode-replace" className="mr-2 accent-rose-600" />
                  <strong className="text-slate-800">Replace with the backup</strong> <span className="text-rose-700 font-bold">(overwrites)</span>
                  <p className="text-slate-500 mt-1 ml-5">Makes the chosen lists exactly match the backup — including stock levels. Changes made since the backup are lost.</p>
                </label>
              </div>

              {GROUP_ORDER.map((g) => {
                const groupRows = rows.filter((r) => r.group === g);
                if (groupRows.length === 0) return null;
                const allOn = groupRows.every((r) => selected.has(r.id));
                return (
                  <div key={g} className="border border-slate-200 rounded-xl overflow-hidden">
                    <div className="flex items-center justify-between bg-slate-50 px-3 py-2">
                      <span className="font-black text-slate-600 uppercase tracking-wider text-[10px]">{BACKUP_GROUP_LABELS[g]}</span>
                      <button onClick={() => toggleGroup(g, !allOn)} className="text-[10px] font-bold text-indigo-600 hover:underline cursor-pointer">{allOn ? 'Untick all' : 'Tick all'}</button>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {groupRows.map((r) => (
                        <label key={r.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-slate-50">
                          <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} data-testid={`restore-pick-${r.id}`} className="accent-indigo-600" />
                          <span className="flex-1 font-semibold text-slate-700">{r.label}</span>
                          <span className="font-mono text-[10.5px] text-slate-400">backup {r.backupCount} · now {r.currentCount}</span>
                          <span className="w-44 text-right text-[10.5px]">
                            {!r.differs ? <span className="text-slate-400">identical</span>
                              : mode === 'merge'
                                ? (r.onlyInBackup > 0 ? <span className="text-emerald-700 font-bold">+{r.onlyInBackup} would be added</span> : <span className="text-slate-400">nothing to add</span>)
                                : <span className="text-rose-700 font-bold">{r.onlyInCurrent > 0 ? `${r.onlyInCurrent} would be removed` : ''}{r.onlyInCurrent > 0 && r.onlyInBackup > 0 ? ', ' : ''}{r.onlyInBackup > 0 ? `${r.onlyInBackup} added` : ''}{r.onlyInCurrent === 0 && r.onlyInBackup === 0 ? 'values would change' : ''}</span>}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}

              {mode === 'replace' && (
                <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-rose-900">
                  <p className="font-bold flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" /> This overwrites live data.</p>
                  <p className="mt-1">Stock levels, requests and records will go back to what the backup holds. A copy of the current data is saved first. Type <strong>RESTORE</strong> to enable the button.</p>
                  <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="RESTORE" data-testid="restore-confirm-input" className="mt-2 border border-rose-300 rounded-lg px-3 py-1.5 text-xs w-40 font-mono" />
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-6 py-3 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
          <span className="text-[11px] text-slate-500">
            {!report && current && (mode === 'merge' ? `${selected.size} list(s) ticked · ${totalAdds} record(s) would be added` : `${selected.size} list(s) ticked`)}
          </span>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-xs font-bold rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 cursor-pointer">{report ? 'Close' : 'Cancel'}</button>
            {!report && (
              <button
                onClick={run}
                disabled={!canRun}
                data-testid="restore-run"
                className={`px-4 py-2 text-xs font-bold rounded-lg text-white cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${mode === 'replace' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}
              >
                {running ? 'Restoring…' : mode === 'replace' ? 'Replace with backup' : 'Add missing records'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
