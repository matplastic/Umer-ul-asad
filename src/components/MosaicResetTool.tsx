import React, { useMemo, useState } from 'react';
import { RotateCcw, ShieldCheck, Download, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Pool, Team } from '../types';
import { planMosaicReset } from '../lib/mosaicReset';
import { dbApplyStageMerge, dbFetchRawPoolsAndTeams } from '../lib/firebaseService';

/**
 * Management card (Teams Allocation tab): put EVERY pool that is inside the
 * Mosaic stage back in the unclaimed area — claimed, being worked, and waiting
 * for QC all go back to "waiting to be claimed". The teams holding them are
 * released. Shows the numbers first; saves only when the button is pressed,
 * after downloading a backup file.
 */

interface Props {
  pools: Pool[];
  teams: Team[];
  isOnline: boolean;
}

type Phase = 'idle' | 'working' | 'done' | 'error';

const downloadJson = (name: string, payload: unknown) => {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};

export const MosaicResetTool: React.FC<Props> = ({ pools, teams, isOnline }) => {
  const [includeRejected, setIncludeRejected] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [step, setStep] = useState('');
  const [error, setError] = useState('');

  const plan = useMemo(() => planMosaicReset(pools, teams, { includeRejected }), [pools, teams, includeRejected]);
  const s = plan.summary;

  const run = async () => {
    const ok = window.confirm(
      `Put ${s.total} Mosaic pool(s) back to UNCLAIMED?\n\n` +
      `• ${s.claimed} claimed\n• ${s.inProgress} being worked\n• ${s.inspection} waiting for QC` +
      (includeRejected ? `\n• ${s.rejectedReset} rejected` : '') +
      `\n\nTheir teams are released. A backup file is downloaded first.`
    );
    if (!ok) return;
    setPhase('working');
    setError('');
    try {
      setStep('Reading the latest data…');
      const raw = await dbFetchRawPoolsAndTeams();
      const fresh = planMosaicReset(raw.pools, raw.teams, { includeRejected });
      if (fresh.changedPools.length === 0 && fresh.changedTeams.length === 0) {
        setPhase('done');
        setStep('Nothing to reset — every Mosaic pool is already unclaimed.');
        return;
      }
      setStep('Downloading a backup file…');
      downloadJson(`MAT_ERP_before_Mosaic_reset_${new Date().toISOString().slice(0, 10)}.json`, {
        note: 'Pools and teams exactly as they were BEFORE the Mosaic reset to unclaimed.',
        exportedAt: new Date().toISOString(),
        pools: raw.pools,
        teams: raw.teams,
      });
      await new Promise(r => setTimeout(r, 1200));

      setStep(`Saving ${fresh.changedPools.length} pools and ${fresh.changedTeams.length} teams…`);
      await dbApplyStageMerge(fresh.changedPools, fresh.changedTeams, raw.pools);

      setStep('Checking the saved data…');
      const check = await dbFetchRawPoolsAndTeams();
      const again = planMosaicReset(check.pools, check.teams, { includeRejected });
      if (again.changedPools.length > 0) throw new Error(`${again.changedPools.length} pool(s) were not saved. Press the button again.`);

      setPhase('done');
      setStep(`Done — ${fresh.changedPools.length} pools are back in the unclaimed area. Reloading…`);
      setTimeout(() => window.location.reload(), 2000);
    } catch (e: any) {
      console.error('[mosaic reset] failed', e);
      setError(e?.message || 'Could not save.');
      setPhase('error');
    }
  };

  return (
    <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm space-y-4" data-testid="mosaic-reset-tool">
      <div className="flex items-start gap-3">
        <div className="bg-lime-50 rounded-xl p-2.5"><RotateCcw className="h-5 w-5 text-lime-700" /></div>
        <div>
          <h3 className="text-sm font-extrabold text-slate-800">Mosaic — put all pools back to Unclaimed</h3>
          <p className="text-xs text-slate-500 mt-0.5 max-w-2xl">
            Every Mosaic pool that is claimed, being worked or waiting for QC returns to the unclaimed area, and its team is released.
            Any Mosaic team can then claim it again.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-center">
        <div className="rounded-xl bg-slate-50 border border-slate-100 p-3"><p className="text-xl font-black text-slate-800">{s.claimed}</p><p className="text-[10px] uppercase font-bold text-slate-400">claimed</p></div>
        <div className="rounded-xl bg-blue-50 border border-blue-100 p-3"><p className="text-xl font-black text-blue-700">{s.inProgress}</p><p className="text-[10px] uppercase font-bold text-blue-700/70">being worked</p></div>
        <div className="rounded-xl bg-amber-50 border border-amber-100 p-3"><p className="text-xl font-black text-amber-700">{s.inspection}</p><p className="text-[10px] uppercase font-bold text-amber-700/70">waiting for QC</p></div>
        <div className="rounded-xl bg-rose-50 border border-rose-100 p-3"><p className="text-xl font-black text-rose-700">{includeRejected ? s.rejectedReset : s.rejectedKept}</p><p className="text-[10px] uppercase font-bold text-rose-700/70">rejected {includeRejected ? '(will reset)' : '(kept)'}</p></div>
        <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3"><p className="text-xl font-black text-emerald-700">{s.alreadyUnclaimed}</p><p className="text-[10px] uppercase font-bold text-emerald-700/70">already unclaimed</p></div>
      </div>

      <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
        <input type="checkbox" checked={includeRejected} onChange={e => setIncludeRejected(e.target.checked)} className="h-3.5 w-3.5" />
        Also reset <strong>rejected</strong> pools (their rejection reason is kept in the pool's history but no longer shown on the board)
      </label>

      {s.total > 0 && (
        <p className="text-xs text-slate-500">
          <strong>{s.total}</strong> pool(s) will be reset. Teams released: {s.teamsReleased.length > 0 ? s.teamsReleased.join(', ') : 'none'}.
        </p>
      )}

      {phase === 'idle' && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={run}
            disabled={!isOnline || s.total === 0}
            data-testid="mosaic-reset-apply"
            className="flex items-center gap-2 px-4 py-2 text-sm font-black rounded-xl bg-lime-600 text-white hover:bg-lime-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed cursor-pointer"
          >
            <ShieldCheck className="h-4 w-4" /> Back up &amp; reset {s.total} pool(s) to unclaimed
          </button>
          <button
            onClick={() => downloadJson(`MAT_ERP_before_Mosaic_reset_${new Date().toISOString().slice(0, 10)}.json`, { exportedAt: new Date().toISOString(), pools, teams })}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" /> Download backup only
          </button>
          {s.total === 0 && <span className="text-xs text-emerald-700 font-bold flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Nothing to reset — all Mosaic pools are already unclaimed.</span>}
          {!isOnline && <span className="text-xs text-rose-600 font-bold">Connect to the cloud first.</span>}
        </div>
      )}
      {phase === 'working' && (
        <div className="flex items-center gap-3 text-sm font-bold text-lime-800 bg-lime-50 border border-lime-100 rounded-xl px-4 py-3">
          <RefreshCw className="h-4 w-4 animate-spin" /> {step} <span className="font-normal text-lime-600">Please do not close this page.</span>
        </div>
      )}
      {phase === 'done' && (
        <div className="flex items-center gap-2 text-sm font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3"><CheckCircle2 className="h-4 w-4" /> {step}</div>
      )}
      {phase === 'error' && (
        <div className="space-y-2">
          <div className="flex items-start gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-100 rounded-xl px-4 py-3"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> <span><strong>Not finished:</strong> {error}</span></div>
          <button onClick={() => setPhase('idle')} className="px-4 py-2 text-sm font-bold rounded-lg bg-lime-600 text-white hover:bg-lime-700 cursor-pointer">Try again</button>
        </div>
      )}
    </div>
  );
};
