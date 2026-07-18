import React, { useMemo, useState } from 'react';
import { DailyDefectReport as DailyDefectReportType, DailyDefectPoolEntry } from '../types';
import { WORKSHOP_DEFECT_CATALOG, WORKSHOP_TITLES } from './QCDefectPanel';
import {
  ClipboardList, Plus, Trash2, X, Save, ChevronDown, ChevronUp,
  AlertTriangle, CheckCircle2, FileBarChart2, Calendar, Building2,
} from 'lucide-react';

// The 6 workshops that have a printed paper form, in the order the paper
// binder is usually filled out on the shop floor.
const WORKSHOP_ORDER = ['steel_fabrication', 'steel_primer', 'cladding', 'lamination', 'plumbing', 'mosaic'];

interface DailyDefectReportProps {
  reports: DailyDefectReportType[];
  controllerName: string;
  onSaveReport: (report: DailyDefectReportType) => void;
  onDeleteReport: (id: string) => void;
}

const emptyPool = (poolNo = ''): DailyDefectPoolEntry => ({ poolNo, defects: [] });

export const DailyDefectReport: React.FC<DailyDefectReportProps> = ({
  reports,
  controllerName,
  onSaveReport,
  onDeleteReport,
}) => {
  const [stageId, setStageId] = useState(WORKSHOP_ORDER[0]);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [projectName, setProjectName] = useState('');
  const [shiftI, setShiftI] = useState(0);
  const [shiftII, setShiftII] = useState(0);
  const [shiftIII, setShiftIII] = useState(0);
  const [pools, setPools] = useState<DailyDefectPoolEntry[]>([emptyPool()]);
  const [remarks, setRemarks] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [expandedReportId, setExpandedReportId] = useState<string | null>(null);
  const [filterStageId, setFilterStageId] = useState<string>('all');

  const catalog = WORKSHOP_DEFECT_CATALOG[stageId] || [];
  const totalQty = shiftI + shiftII + shiftIII;

  const resetForm = () => {
    setProjectName('');
    setShiftI(0); setShiftII(0); setShiftIII(0);
    setPools([emptyPool()]);
    setRemarks('');
    setErrorMsg('');
  };

  const updatePoolNo = (idx: number, value: string) => {
    setPools(prev => prev.map((p, i) => (i === idx ? { ...p, poolNo: value } : p)));
  };

  const toggleDefect = (idx: number, defect: string) => {
    setPools(prev => prev.map((p, i) => {
      if (i !== idx) return p;
      const has = p.defects.includes(defect);
      return { ...p, defects: has ? p.defects.filter(d => d !== defect) : [...p.defects, defect] };
    }));
  };

  const addPoolRow = () => setPools(prev => [...prev, emptyPool()]);
  const removePoolRow = (idx: number) => setPools(prev => prev.filter((_, i) => i !== idx));

  const handleSave = () => {
    if (!projectName.trim()) {
      setErrorMsg('Please enter the project name.');
      return;
    }
    if (!controllerName) {
      setErrorMsg('No controller/inspector selected. Select one at the top of the Quality portal.');
      return;
    }
    const cleanedPools = pools.filter(p => p.poolNo.trim() !== '');
    if (cleanedPools.length === 0) {
      setErrorMsg('Please enter at least one pool number.');
      return;
    }
    setErrorMsg('');

    const report: DailyDefectReportType = {
      id: `ddr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      stageId: stageId as any,
      workshopName: WORKSHOP_TITLES[stageId] || stageId,
      date,
      projectName: projectName.trim(),
      controller: controllerName,
      shiftQuantities: { I: shiftI, II: shiftII, III: shiftIII },
      pools: cleanedPools,
      remarks: remarks.trim() || undefined,
      createdBy: controllerName,
      createdAt: new Date().toISOString(),
    };

    onSaveReport(report);
    resetForm();
  };

  // Auto-computed defect summary for the report currently being built, e.g.
  // "Bubbles - Pinholes: 3 pools"
  const liveSummary = useMemo(() => {
    const counts: Record<string, number> = {};
    pools.forEach(p => p.defects.forEach(d => { counts[d] = (counts[d] || 0) + 1; }));
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [pools]);

  const filteredReports = (filterStageId === 'all' ? reports : reports.filter(r => r.stageId === filterStageId))
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt.localeCompare(a.createdAt)));

  const summaryFor = (report: DailyDefectReportType) => {
    const counts: Record<string, number> = {};
    report.pools.forEach(p => p.defects.forEach(d => { counts[d] = (counts[d] || 0) + 1; }));
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  };

  return (
    <div className="space-y-6">
      {/* ── Report builder ─────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-5">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-emerald-500" />
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider">New Daily Defect Report</h3>
        </div>

        {/* Workshop tabs */}
        <div className="flex flex-wrap gap-1.5">
          {WORKSHOP_ORDER.map(id => (
            <button
              key={id}
              type="button"
              onClick={() => { setStageId(id); setPools([emptyPool()]); }}
              className={`text-[11px] font-bold px-3 py-1.5 rounded-lg border transition-colors cursor-pointer ${
                stageId === id
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {WORKSHOP_TITLES[id]}
            </button>
          ))}
        </div>

        {/* Header fields */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">Date</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full bg-white border border-slate-200 text-xs text-slate-800 font-medium px-3 py-2 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-400"
            />
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">Project Name *</label>
            <input
              type="text"
              value={projectName}
              onChange={e => setProjectName(e.target.value)}
              placeholder="e.g. SKYROS"
              className="w-full bg-white border border-slate-200 text-xs text-slate-800 font-medium px-3 py-2 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-400"
            />
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">Controller</label>
            <div className="w-full bg-slate-50 border border-slate-200 text-xs text-slate-700 font-bold px-3 py-2 rounded-lg">
              {controllerName || '— none selected —'}
            </div>
          </div>
        </div>

        {/* Shift quantities */}
        <div>
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">
            Shift (Quantity of Pools) — Total: {totalQty}
          </label>
          <div className="grid grid-cols-3 gap-2 max-w-md">
            {[
              ['I', shiftI, setShiftI],
              ['II', shiftII, setShiftII],
              ['III', shiftIII, setShiftIII],
            ].map(([label, val, setter]: any) => (
              <div key={label} className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
                <span className="text-[10px] font-black text-slate-400">{label}</span>
                <input
                  type="number"
                  min={0}
                  value={val}
                  onChange={e => setter(Math.max(0, Number(e.target.value)))}
                  className="w-full bg-transparent text-xs font-bold text-slate-800 focus:outline-none"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Per-pool defect ticking */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider">
              Description (Pool Number) & Defects
            </label>
            <button
              type="button"
              onClick={addPoolRow}
              className="flex items-center gap-1 text-[10px] font-black text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2 py-1 rounded-lg cursor-pointer"
            >
              <Plus className="h-3 w-3" /> Add Pool
            </button>
          </div>

          <div className="space-y-2">
            {pools.map((pool, idx) => (
              <div key={idx} className="border border-slate-100 rounded-xl p-3 bg-slate-50/40">
                <div className="flex items-center gap-2 mb-2">
                  <input
                    type="text"
                    value={pool.poolNo}
                    onChange={e => updatePoolNo(idx, e.target.value)}
                    placeholder="Pool number, e.g. 1301"
                    className="w-40 bg-white border border-slate-200 text-xs font-bold text-slate-800 px-2.5 py-1.5 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-400"
                  />
                  {pool.defects.length > 0 && (
                    <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                      {pool.defects.length} defect{pool.defects.length > 1 ? 's' : ''}
                    </span>
                  )}
                  {pools.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removePoolRow(idx)}
                      className="ml-auto text-slate-400 hover:text-rose-600 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {catalog.map(defect => {
                    const active = pool.defects.includes(defect);
                    return (
                      <button
                        key={defect}
                        type="button"
                        onClick={() => toggleDefect(idx, defect)}
                        className={`text-[10px] font-bold px-2 py-1 rounded-lg border transition-colors cursor-pointer ${
                          active
                            ? 'bg-rose-600 text-white border-rose-600'
                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {defect}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Live summary preview */}
        {liveSummary.length > 0 && (
          <div className="bg-amber-50/60 border border-amber-100 rounded-xl p-3 space-y-1">
            <p className="text-[10px] font-black text-amber-800 uppercase tracking-wider">Live Summary</p>
            <div className="flex flex-wrap gap-1.5">
              {liveSummary.map(([defect, count]) => (
                <span key={defect} className="text-[11px] font-bold text-amber-800 bg-white border border-amber-200 px-2 py-0.5 rounded">
                  {defect}: {count} pool{count > 1 ? 's' : ''}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Remarks */}
        <div>
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">Remarks (optional)</label>
          <textarea
            value={remarks}
            onChange={e => setRemarks(e.target.value)}
            rows={2}
            className="w-full bg-white border border-slate-200 text-xs text-slate-700 px-3 py-2 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-400 resize-none"
          />
        </div>

        {errorMsg && (
          <div className="flex items-center gap-2 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2 text-xs font-bold text-rose-700">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {errorMsg}
          </div>
        )}

        <button
          type="button"
          onClick={handleSave}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black rounded-xl cursor-pointer transition-colors"
        >
          <Save className="h-4 w-4" /> Save Daily Defect Report
        </button>
      </div>

      {/* ── History / saved reports ────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <FileBarChart2 className="h-5 w-5 text-indigo-500" />
            <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider">Saved Reports ({filteredReports.length})</h3>
          </div>
          <select
            value={filterStageId}
            onChange={e => setFilterStageId(e.target.value)}
            className="bg-slate-50 border border-slate-200 text-xs font-bold text-slate-700 px-3 py-1.5 rounded-lg cursor-pointer focus:outline-none"
          >
            <option value="all">All Workshops</option>
            {WORKSHOP_ORDER.map(id => (
              <option key={id} value={id}>{WORKSHOP_TITLES[id]}</option>
            ))}
          </select>
        </div>

        {filteredReports.length === 0 ? (
          <div className="py-10 text-center">
            <CheckCircle2 className="h-8 w-8 text-emerald-300 mx-auto mb-2" />
            <p className="text-xs text-slate-400 font-medium">No daily defect reports saved yet.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredReports.map(report => {
              const isExpanded = expandedReportId === report.id;
              const sum = summaryFor(report);
              return (
                <div key={report.id} className="border border-slate-100 rounded-xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setExpandedReportId(isExpanded ? null : report.id)}
                    className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer text-left"
                  >
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-[10px] font-black text-white bg-slate-800 px-2 py-0.5 rounded">{report.workshopName}</span>
                      <span className="flex items-center gap-1 text-xs font-bold text-slate-700">
                        <Calendar className="h-3.5 w-3.5 text-slate-400" /> {report.date}
                      </span>
                      <span className="flex items-center gap-1 text-xs font-bold text-slate-700">
                        <Building2 className="h-3.5 w-3.5 text-slate-400" /> {report.projectName}
                      </span>
                      <span className="text-[10px] font-mono text-slate-400">
                        {report.shiftQuantities.I + report.shiftQuantities.II + report.shiftQuantities.III} pools · {report.controller}
                      </span>
                    </div>
                    {isExpanded ? <ChevronUp className="h-4 w-4 text-slate-400 shrink-0" /> : <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />}
                  </button>

                  {isExpanded && (
                    <div className="p-4 space-y-3">
                      {sum.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {sum.map(([defect, count]) => (
                            <span key={defect} className="text-[11px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded">
                              {defect}: {count} pool{count > 1 ? 's' : ''}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-emerald-600 font-bold flex items-center gap-1">
                          <CheckCircle2 className="h-3.5 w-3.5" /> No defects recorded — clean run.
                        </p>
                      )}

                      <div className="divide-y divide-slate-100 border border-slate-100 rounded-lg overflow-hidden">
                        {report.pools.map((p, i) => (
                          <div key={i} className="px-3 py-2 flex flex-wrap items-center gap-2">
                            <span className="text-xs font-black text-slate-800 w-24 shrink-0">{p.poolNo}</span>
                            {p.defects.length === 0 ? (
                              <span className="text-[10px] text-slate-400">No defects</span>
                            ) : (
                              p.defects.map(d => (
                                <span key={d} className="text-[10px] font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">{d}</span>
                              ))
                            )}
                          </div>
                        ))}
                      </div>

                      {report.remarks && (
                        <p className="text-xs text-slate-500 italic">"{report.remarks}"</p>
                      )}

                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => onDeleteReport(report.id)}
                          className="flex items-center gap-1 text-[10px] font-bold text-rose-600 hover:text-rose-800 cursor-pointer"
                        >
                          <X className="h-3 w-3" /> Delete Report
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
