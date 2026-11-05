import React, { useMemo, useState } from 'react';
import { RefreshCw, ShieldCheck, Download, AlertTriangle, CheckCircle2, Layers, Users } from 'lucide-react';
import { Pool, Team } from '../types';
import { planStageMerge } from '../lib/stageMerge';
import { needsStageMerge } from '../lib/stageMerge';
import { dbApplyStageMerge, dbFetchRawPoolsAndTeams } from '../lib/firebaseService';

/**
 * Full-page screen shown (instead of the portals) while the one-time
 * "Mosaic + Grouting become one stage" upgrade has not been applied yet.
 *
 *  - Management sees exactly what will happen, then presses one button:
 *    it downloads a backup file, converts the pools/teams, saves them and
 *    reloads the page.
 *  - Everyone else sees a short "upgrade in progress" message and continues
 *    automatically as soon as the upgrade has been saved.
 *
 * Nothing is converted until Management presses the button.
 */

interface Props {
  pools: Pool[];
  teams: Team[];
  isManagement: boolean;
  isOnline: boolean;
}

type Phase = 'preview' | 'working' | 'done' | 'error';

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

export const StageMergeGate: React.FC<Props> = ({ pools, teams, isManagement, isOnline }) => {
  const plan = useMemo(() => planStageMerge(pools, teams), [pools, teams]);
  const s = plan.summary;
  const [phase, setPhase] = useState<Phase>('preview');
  const [step, setStep] = useState('');
  const [error, setError] = useState('');

  const run = async () => {
    setPhase('working');
    setError('');
    try {
      setStep('Reading the latest data from the cloud…');
      const raw = await dbFetchRawPoolsAndTeams();
      const fresh = planStageMerge(raw.pools, raw.teams);
      if (fresh.changedPools.length === 0 && fresh.changedTeams.length === 0) {
        setPhase('done');
        setStep('Nothing left to convert — it was already upgraded.');
        setTimeout(() => window.location.reload(), 1500);
        return;
      }

      setStep('Downloading a backup file of the current data…');
      downloadJson(`MAT_ERP_before_Mosaic_Grouting_merge_${new Date().toISOString().slice(0, 10)}.json`, {
        note: 'Pools and teams exactly as they were BEFORE the Mosaic + Grouting merge.',
        exportedAt: new Date().toISOString(),
        pools: raw.pools,
        teams: raw.teams,
      });
      await new Promise(r => setTimeout(r, 1200));

      setStep(`Saving ${fresh.changedPools.length} pools and ${fresh.changedTeams.length} teams…`);
      await dbApplyStageMerge(fresh.changedPools, fresh.changedTeams, raw.pools);

      setStep('Checking the saved data…');
      const check = await dbFetchRawPoolsAndTeams();
      if (needsStageMerge(check.pools, check.teams)) {
        throw new Error('Some records were not saved. Press the button again — it only converts what is left.');
      }
      setPhase('done');
      setStep('Upgrade complete. Reloading…');
      setTimeout(() => window.location.reload(), 2500);
    } catch (e: any) {
      console.error('[stage merge] failed', e);
      setError(e?.message || 'The upgrade could not be saved.');
      setPhase('error');
    }
  };

  // ── everyone except Management ──
  if (!isManagement) {
    return (
      <div className="max-w-xl mx-auto mt-16 bg-white border border-slate-200 rounded-2xl shadow-sm p-8 text-center space-y-4" data-testid="stage-merge-wait">
        <RefreshCw className="h-10 w-10 text-amber-500 mx-auto animate-spin" />
        <h2 className="text-xl font-black text-slate-800">System upgrade in progress</h2>
        <p className="text-sm text-slate-500">
          The Mosaic and Grouting stages are being combined into one. Management needs to finish a one-time upgrade first.
          This page continues by itself as soon as it is done — you do not need to do anything.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-bold hover:bg-slate-900 cursor-pointer"
        >
          Refresh
        </button>
      </div>
    );
  }

  // ── Management ──
  const c = s.carriedIntoMosaic;
  const a = s.actions;
  return (
    <div className="max-w-3xl mx-auto mt-8 bg-white border border-slate-200 rounded-2xl shadow-sm p-6 sm:p-8 space-y-5" data-testid="stage-merge-gate">
      <div className="flex items-start gap-3">
        <div className="bg-indigo-50 rounded-xl p-3"><Layers className="h-6 w-6 text-indigo-600" /></div>
        <div>
          <h2 className="text-xl font-black text-slate-800">One-time upgrade: Mosaic + Grouting become one stage</h2>
          <p className="text-sm text-slate-500 mt-1">
            The stage is called <strong>Mosaic</strong> and covers the tiles <em>and</em> the grouting, with one team and one QC sign-off.
            The factory pages are paused until this upgrade is saved.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
        <div className="rounded-xl bg-slate-50 border border-slate-100 p-3"><p className="text-2xl font-black text-slate-800">{s.oldFormatPools}</p><p className="text-[10px] uppercase font-bold text-slate-400">pools to convert</p></div>
        <div className="rounded-xl bg-lime-50 border border-lime-100 p-3"><p className="text-2xl font-black text-lime-700">{c.total}</p><p className="text-[10px] uppercase font-bold text-lime-700/70">still owe grouting → in Mosaic</p></div>
        <div className="rounded-xl bg-indigo-50 border border-indigo-100 p-3"><p className="text-2xl font-black text-indigo-700">{a.shifted}</p><p className="text-[10px] uppercase font-bold text-indigo-700/70">at Door Cutting / Acrylic (moved up one)</p></div>
        <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3"><p className="text-2xl font-black text-emerald-700">{s.teamsMoved}</p><p className="text-[10px] uppercase font-bold text-emerald-700/70">Grouting teams → Mosaic</p></div>
      </div>

      <div className="rounded-xl border border-slate-100 p-4 text-sm text-slate-600 space-y-2">
        <p className="font-bold text-slate-800">What the Mosaic list will contain for the {c.total} pool(s) that still owe grouting:</p>
        <ul className="list-disc pl-5 space-y-0.5">
          <li><strong>{c.waitingToClaim}</strong> waiting to be claimed</li>
          <li><strong>{c.inProgress}</strong> being worked by a team (same team, same start time)</li>
          <li><strong>{c.awaitingQc}</strong> waiting for QC</li>
          <li><strong>{c.rejected.length}</strong> rejected — with the inspector's reason and the rejection count kept</li>
        </ul>
        {c.rejected.length > 0 && (
          <div className="bg-rose-50 border border-rose-100 rounded-lg p-2 text-xs text-rose-700 space-y-0.5">
            {c.rejected.slice(0, 8).map(r => <div key={`${r.project}-${r.poolNo}`}>#{r.poolNo} {r.project} — “{r.reason}”</div>)}
          </div>
        )}
        <p className="text-xs text-slate-400">
          Pools that already finished their Mosaic and are waiting at the gate for another stage (re-opened for the grouting): {a.reopened_at_gate}.
          Pools that were at Grouting and go back into Mosaic: {a.back_to_mosaic_from_grouting}.
          Delivered pools keep their old Grouting record for history.
        </p>
        {s.staleClaimsReleased > 0 && (
          <p className="text-xs text-slate-500">
            Clean-up: <strong>{s.staleClaimsReleased}</strong> leftover claim(s) on {s.teamsCleaned} team(s) are released — pools a team still listed although they were
            already delivered, approved, deleted, or are now waiting unclaimed. They were using up the team's claim limit.
          </p>
        )}
        {s.teamNames.length > 0 && (
          <p className="text-xs text-slate-500 flex items-start gap-1.5"><Users className="h-3.5 w-3.5 mt-0.5 shrink-0" /> Teams moving to Mosaic: {s.teamNames.join(', ')}</p>
        )}
        {s.staleClaimsReleased > 0 && (
          <p className="text-xs text-slate-500">
            Also tidied: <strong>{s.staleClaimsReleased}</strong> leftover claim(s) on <strong>{s.teamsCleaned}</strong> team(s) — pools a team still listed although they were already delivered, approved, deleted or re-opened unclaimed. They used up the team's claim limit for nothing.
          </p>
        )}
      </div>

      <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-xl px-3 py-2.5">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
        <span>
          <strong>Before you press the button:</strong> ask everyone to close or refresh (Ctrl+Shift+R) their open ERP pages — supervisors, shop-floor tablets and TVs.
          A page that was not refreshed still uses the old stage list.
        </span>
      </div>

      {phase === 'preview' && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={run}
            disabled={!isOnline}
            data-testid="stage-merge-apply"
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-black rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 cursor-pointer"
          >
            <ShieldCheck className="h-4 w-4" /> Back up &amp; merge now
          </button>
          <button
            onClick={() => downloadJson(`MAT_ERP_before_Mosaic_Grouting_merge_${new Date().toISOString().slice(0, 10)}.json`, { exportedAt: new Date().toISOString(), pools, teams })}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" /> Download backup only
          </button>
          {!isOnline && <span className="text-xs text-rose-600 font-bold">Connect to the cloud first — the upgrade cannot be saved offline.</span>}
        </div>
      )}

      {phase === 'working' && (
        <div className="flex items-center gap-3 text-sm font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3">
          <RefreshCw className="h-4 w-4 animate-spin" /> {step} <span className="font-normal text-indigo-400">Please do not close this page.</span>
        </div>
      )}
      {phase === 'done' && (
        <div className="flex items-center gap-2 text-sm font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3">
          <CheckCircle2 className="h-4 w-4" /> {step}
        </div>
      )}
      {phase === 'error' && (
        <div className="space-y-2">
          <div className="text-sm text-rose-700 bg-rose-50 border border-rose-100 rounded-xl px-4 py-3"><strong>Not finished:</strong> {error}</div>
          <button onClick={run} className="px-4 py-2 text-sm font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 cursor-pointer">Try again</button>
        </div>
      )}
    </div>
  );
};
