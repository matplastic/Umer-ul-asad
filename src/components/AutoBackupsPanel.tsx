import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Clock, DatabaseBackup, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { AutoBackupMeta, friendlyBackupError } from '../lib/backupSets';

interface Props {
  // Called with a snapshot's restorable lists once they have been downloaded.
  onRestore: (label: string, docs: Record<string, any[]>) => void;
  // Database / server access, supplied by the Management screen (lib/autoBackups.ts).
  api: {
    list: () => Promise<AutoBackupMeta[]>;
    load: (id: string) => Promise<Record<string, any[]>>;
    backupNow: () => Promise<void>;
  };
  pollMs?: number;
}

const fmtTime = (iso?: string) => (iso ? new Date(iso).toLocaleString() : '—');
const fmtSize = (b?: number) => (b ? (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`) : '—');

// Management -> Google Drive Backups -> "Automatic Daily Backups".
// Shown whether or not anyone is signed in to Google: these backups are made by
// the server, not through a Google login.
export const AutoBackupsPanel: React.FC<Props> = ({ onRestore, api, pollMs = 6000 }) => {
  const [backups, setBackups] = useState<AutoBackupMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState('');
  const [busyId, setBusyId] = useState('');
  const [showAll, setShowAll] = useState(false);
  // Snapshots that already existed when "Back up now" was pressed, so only a NEW one counts as the result.
  const baseline = useRef<Set<string>>(new Set());
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await api.list();
      setBackups(list);
      setError('');
      return list;
    } catch (e: any) {
      setError(friendlyBackupError(e));
      return null;
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { refresh(); return () => { if (pollTimer.current) clearInterval(pollTimer.current); }; }, [refresh]);

  const latestComplete = backups.find((b) => b.status === 'complete');

  const backupNow = async () => {
    setNote('');
    setRunning(true);
    baseline.current = new Set(backups.map((b) => b.id));
    try {
      await api.backupNow();
    } catch (e: any) {
      setRunning(false);
      setNote(e?.message || 'Could not start the backup.');
      return;
    }
    let tries = 0;
    if (pollTimer.current) clearInterval(pollTimer.current);
    pollTimer.current = setInterval(async () => {
      tries++;
      const list = await refresh();
      const fresh = list?.find((b) => !baseline.current.has(b.id) && (b.status === 'complete' || b.status === 'failed'));
      if (fresh || tries >= 40) {
        if (pollTimer.current) clearInterval(pollTimer.current);
        setRunning(false);
        setNote(fresh
          ? (fresh.status === 'complete' ? 'Backup finished.' : `The backup failed: ${fresh.error || 'unknown error'}`)
          : 'No new backup appeared. If one was started in the last 15 minutes this request is skipped — check the list, or look in Netlify → Functions → daily-backup-background.');
      }
    }, pollMs);
  };

  const restore = async (b: AutoBackupMeta) => {
    setBusyId(b.id);
    setNote('');
    try {
      const docs = await api.load(b.id);
      if (Object.keys(docs).length === 0) throw new Error('This backup does not contain any restorable lists.');
      onRestore(`Automatic backup of ${fmtTime(b.finishedAt || b.startedAt)}`, docs);
    } catch (e: any) {
      setNote(friendlyBackupError(e));
    } finally {
      setBusyId('');
    }
  };

  const shown = showAll ? backups : backups.slice(0, 8);

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm mb-6" data-testid="auto-backups-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div>
          <h4 className="text-sm font-black text-slate-500 uppercase tracking-wider flex items-center gap-2">
            <DatabaseBackup className="h-4 w-4 text-emerald-500" /> Automatic Daily Backups
          </h4>
          <p className="text-[11px] text-slate-500 mt-1">
            A full copy of the database (Store, requests, ledger records, production, QC, HR, pools, teams) is saved automatically every night — no Google sign-in needed.
            The last 14 days are kept, plus the first backup of each of the last 6 months.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={refresh} title="Refresh list" className="p-2 border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50 cursor-pointer"><RefreshCw className="h-3.5 w-3.5" /></button>
          <button
            onClick={backupNow}
            disabled={running}
            data-testid="backup-now"
            className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg cursor-pointer flex items-center gap-1.5"
          >
            {running ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Backing up…</> : <>Back up now</>}
          </button>
        </div>
      </div>

      <p className="text-[11px] mt-3" data-testid="auto-backup-status">
        {loading ? <span className="text-slate-400">Loading…</span>
          : error ? null
          : latestComplete
            ? <span className="text-emerald-700 font-semibold flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5" /> Last successful backup: {fmtTime(latestComplete.finishedAt || latestComplete.startedAt)}</span>
            : <span className="text-amber-700 font-semibold flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> No automatic backup has completed yet. Press "Back up now" to take the first one.</span>}
      </p>

      {error && <div className="mt-3 bg-amber-50 border border-amber-200 text-amber-900 text-[11px] rounded-xl p-3" data-testid="auto-backup-error">{error}</div>}
      {note && <div className="mt-3 bg-slate-50 border border-slate-200 text-slate-700 text-[11px] rounded-xl p-3">{note}</div>}

      {!error && backups.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-slate-400 uppercase text-[9.5px] tracking-widest border-b border-slate-100">
                <th className="py-2 pr-2">Taken</th><th className="pr-2">Type</th><th className="pr-2">Status</th>
                <th className="pr-2 text-right">Size</th><th className="pr-2 text-right">Lists</th><th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((b) => (
                <tr key={b.id} data-testid={`auto-backup-${b.id}`}>
                  <td className="py-2 pr-2 font-mono text-slate-600">{fmtTime(b.startedAt)}</td>
                  <td className="pr-2 text-slate-500">{b.trigger === 'manual' ? 'Manual' : 'Nightly'}</td>
                  <td className="pr-2">
                    {b.status === 'complete' && <span className="inline-flex items-center gap-1 text-emerald-700 font-bold"><CheckCircle2 className="h-3 w-3" /> Complete</span>}
                    {b.status === 'running' && <span className="inline-flex items-center gap-1 text-blue-600 font-bold"><Loader2 className="h-3 w-3 animate-spin" /> Running</span>}
                    {b.status === 'failed' && <span className="inline-flex items-center gap-1 text-rose-600 font-bold" title={b.error}><XCircle className="h-3 w-3" /> Failed</span>}
                  </td>
                  <td className="pr-2 text-right font-mono text-slate-500">{fmtSize(b.totalBytes)}</td>
                  <td className="pr-2 text-right font-mono text-slate-500">{b.sourceCount ?? '—'}</td>
                  <td className="text-right">
                    {b.status === 'complete' && (
                      <button
                        onClick={() => restore(b)}
                        disabled={!!busyId}
                        data-testid={`auto-restore-${b.id}`}
                        className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-mono font-bold text-[9px] uppercase border border-emerald-200 rounded cursor-pointer disabled:opacity-50"
                      >
                        {busyId === b.id ? 'Loading…' : 'Restore…'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {backups.length > 8 && (
            <button onClick={() => setShowAll((s) => !s)} className="mt-2 text-[10px] font-bold text-indigo-600 hover:underline cursor-pointer">{showAll ? 'Show fewer' : `Show all ${backups.length}`}</button>
          )}
        </div>
      )}
    </div>
  );
};
