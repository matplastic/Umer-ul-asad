import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { ActivityLog, Pool, StageId, Team } from '../types';
import { STAGES } from '../data/mockData';

// Rejection Log — VIEW ONLY
// ──────────────────────────────────────────────────────────────────────────
// Same data Management sees in its Rejection Log tab: every pool rejected at
// QC inspection, which stage, which team, inspector notes, filterable by
// day/range/stage. Purely informational — there's nothing to edit or delete
// here, so a Factory Supervisor can look but not touch, same as Pool Register.

interface RejectionLogViewProps {
  pools: Pool[];
  teams: Team[];
  logs: ActivityLog[];
}

const toLocalDateStr = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const todayStr = toLocalDateStr(new Date().toISOString());

export const RejectionLogView: React.FC<RejectionLogViewProps> = ({ pools, teams, logs }) => {
  const [rejectionFilterDate, setRejectionFilterDate] = useState<string>(todayStr);
  const [rejectionFilterMode, setRejectionFilterMode] = useState<'day' | 'range'>('day');
  const [rejectionFromDate, setRejectionFromDate] = useState<string>(todayStr);
  const [rejectionToDate, setRejectionToDate] = useState<string>(todayStr);
  const [rejectionStageFilter, setRejectionStageFilter] = useState<StageId | 'ALL'>('ALL');

  const rejectionLogsRaw = logs.filter(l => {
    if (l.type !== 'REJECTED') return false;
    const d = toLocalDateStr(l.timestamp);
    const inRange = rejectionFilterMode === 'day'
      ? d === rejectionFilterDate
      : d >= rejectionFromDate && d <= rejectionToDate;
    if (!inRange) return false;
    if (rejectionStageFilter !== 'ALL' && l.stageId !== rejectionStageFilter) return false;
    return true;
  }).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const rejectionRows = rejectionLogsRaw.map(l => {
    const stage = STAGES.find(s => s.id === l.stageId);
    const pool = pools.find(p => p.id === l.poolId);
    const team = teams.find(t => (l.teamId ? t.id === l.teamId : t.name === l.teamName));
    return {
      id: l.id,
      poolNo: l.poolNo,
      projectName: l.projectName,
      poolType: pool?.poolType || 'Type 3',
      stageName: stage?.name || l.stageId,
      stageColor: stage?.color || '#94a3b8',
      teamName: team?.name || l.teamName || 'Unknown Team',
      inspectorName: l.operatorName || '—',
      notes: l.notes || '—',
      date: toLocalDateStr(l.timestamp),
      time: new Date(l.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    };
  });

  const rejectionsByStage = STAGES.map(stage => ({
    stage,
    count: rejectionRows.filter(r => r.stageName === stage.name).length,
  })).filter(s => s.count > 0).sort((a, b) => b.count - a.count);

  const rejectionsByPoolMap = rejectionRows.reduce((acc: Record<string, { poolNo: string; projectName: string; count: number }>, r) => {
    const key = `${r.projectName}__${r.poolNo}`;
    if (!acc[key]) acc[key] = { poolNo: r.poolNo, projectName: r.projectName, count: 0 };
    acc[key].count += 1;
    return acc;
  }, {});
  const rejectionsByPool = (Object.values(rejectionsByPoolMap) as { poolNo: string; projectName: string; count: number }[])
    .sort((a, b) => b.count - a.count);

  return (
    <div className="space-y-6">

      {/* Filter header */}
      <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              Rejection Log
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Every pool rejected at QC inspection — pool number, stage, team, inspector notes. Filter by day or by a date range.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex rounded-xl border border-slate-200 overflow-hidden">
              <button
                onClick={() => setRejectionFilterMode('day')}
                className={`text-xs font-bold px-3 py-2 cursor-pointer ${rejectionFilterMode === 'day' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
              >
                Single Day
              </button>
              <button
                onClick={() => setRejectionFilterMode('range')}
                className={`text-xs font-bold px-3 py-2 cursor-pointer ${rejectionFilterMode === 'range' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
              >
                Date Range
              </button>
            </div>
            {rejectionFilterMode === 'day' ? (
              <>
                <input
                  type="date"
                  value={rejectionFilterDate}
                  onChange={(e) => setRejectionFilterDate(e.target.value)}
                  className="text-xs border border-slate-200 rounded-xl px-3 py-2 font-semibold text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
                <button
                  onClick={() => setRejectionFilterDate(todayStr)}
                  className="text-xs font-bold px-3 py-2 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 cursor-pointer"
                >
                  Today
                </button>
              </>
            ) : (
              <>
                <input
                  type="date"
                  value={rejectionFromDate}
                  onChange={(e) => setRejectionFromDate(e.target.value)}
                  className="text-xs border border-slate-200 rounded-xl px-3 py-2 font-semibold text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
                <span className="text-xs text-slate-400 font-bold">to</span>
                <input
                  type="date"
                  value={rejectionToDate}
                  onChange={(e) => setRejectionToDate(e.target.value)}
                  className="text-xs border border-slate-200 rounded-xl px-3 py-2 font-semibold text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </>
            )}
            <select
              value={rejectionStageFilter}
              onChange={(e) => setRejectionStageFilter(e.target.value as StageId | 'ALL')}
              className="text-xs border border-slate-200 rounded-xl px-3 py-2 font-semibold text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-400"
            >
              <option value="ALL">All Stages</option>
              {STAGES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Summary strip */}
      <div className="bg-slate-900 text-white rounded-2xl p-5 flex items-center justify-between flex-wrap gap-4">
        <div>
          <p className="text-[10px] uppercase font-black tracking-wider text-slate-400">
            {rejectionFilterMode === 'day'
              ? new Date(rejectionFilterDate + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
              : `${rejectionFromDate} to ${rejectionToDate}`}
          </p>
          <p className="text-2xl font-extrabold mt-1">{rejectionRows.length} pool rejection{rejectionRows.length === 1 ? '' : 's'}</p>
        </div>
        <div className="flex gap-4 flex-wrap justify-end">
          {rejectionsByStage.map(s => (
            <div key={s.stage.id} className="text-center px-3">
              <span className="block text-lg font-bold">{s.count}</span>
              <span className="text-[9px] text-slate-400 uppercase font-bold tracking-wide">{s.stage.name}</span>
            </div>
          ))}
        </div>
      </div>

      {rejectionRows.length === 0 ? (
        <div className="text-center py-16 bg-white border border-slate-100 rounded-2xl">
          <AlertTriangle className="h-8 w-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm font-bold text-slate-500">No rejections recorded for this filter.</p>
          <p className="text-xs text-slate-400 mt-1">Try another date, range, or stage.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Detailed rejection list */}
          <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-100">
              <span className="text-xs font-bold text-slate-700">Rejection Details</span>
            </div>
            <div className="divide-y divide-slate-100 max-h-[520px] overflow-y-auto">
              {rejectionRows.map((r) => (
                <div key={r.id} className="px-4 py-3 hover:bg-slate-50">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <p className="font-black text-slate-800 text-sm truncate">{r.poolNo}</p>
                      <span className="text-[9px] px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded font-bold uppercase shrink-0">{r.poolType}</span>
                      <span
                        className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase shrink-0 text-white"
                        style={{ background: r.stageColor }}
                      >
                        {r.stageName}
                      </span>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-[10px] font-bold text-slate-500">{r.date}</p>
                      <p className="text-[10px] text-slate-400">{r.time}</p>
                    </div>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">{r.projectName}</p>
                  <div className="flex items-center justify-between gap-2 mt-1.5">
                    <p className="text-xs text-slate-600"><span className="font-bold">Team:</span> {r.teamName}</p>
                    <p className="text-xs text-slate-600"><span className="font-bold">Inspector:</span> {r.inspectorName}</p>
                  </div>
                  {r.notes && r.notes !== '—' && (
                    <p className="text-xs text-red-600 mt-1.5 bg-red-50 rounded-lg px-2 py-1.5">{r.notes}</p>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Side breakdown: most-rejected pools */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-100">
              <span className="text-xs font-bold text-slate-700">Most Rejected Pools (this filter)</span>
            </div>
            <div className="divide-y divide-slate-100 max-h-[520px] overflow-y-auto">
              {rejectionsByPool.map((p, idx) => (
                <div key={`${p.projectName}-${p.poolNo}-${idx}`} className="px-4 py-2.5 flex items-center justify-between text-xs">
                  <div className="min-w-0">
                    <p className="font-bold text-slate-700 truncate">{p.poolNo}</p>
                    <p className="text-slate-400 truncate">{p.projectName}</p>
                  </div>
                  <span className="text-rose-600 font-black shrink-0 ml-2">{p.count}×</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
