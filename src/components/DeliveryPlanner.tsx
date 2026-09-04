import React, { useMemo, useState } from 'react';
import { CalendarClock, Search, X, Truck, AlertTriangle, CheckCircle2, Printer, Download, Trash2, UploadCloud, Check, PackageCheck } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Pool } from '../types';
import { STAGES } from '../data/mockData';
import { exportToExcel, exportTablePdf } from '../lib/exportUtils';

interface DeliveryPlannerProps {
  pools: Pool[];
  onUpdatePool?: (poolId: string, updates: Partial<Pool>) => void;
}

function currentStageLabel(pool: Pool): string {
  if (pool.isDelivered) return 'Delivered';
  if (pool.completedAt || pool.currentStageIndex >= STAGES.length) return 'Completed (awaiting delivery)';
  const stage = STAGES[pool.currentStageIndex];
  return stage ? stage.name : 'Unknown';
}

// Days remaining until the scheduled date, counting today as day 0.
// Negative = overdue.
// 'Today' as a plain YYYY-MM-DD in UAE time — not the browser's local date,
// which can differ from UAE's calendar day near midnight if the device's
// timezone isn't set to Dubai.
function todayInUAE(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find(p => p.type === 'year')!.value;
  const m = parts.find(p => p.type === 'month')!.value;
  const d = parts.find(p => p.type === 'day')!.value;
  return `${y}-${m}-${d}`;
}

function daysRemaining(dateStr: string): number {
  // Pure calendar-day arithmetic on 'YYYY-MM-DD' strings, deliberately
  // avoiding `new Date(str)` (which parses as the browser's local
  // timezone) — that's what caused the "date 7 in Excel becomes date 6 on
  // screen" bug on devices not set to Dubai time. Date.UTC anchors both
  // sides identically so no timezone can shift the count.
  const today = todayInUAE();
  const [ty, tm, td] = today.split('-').map(Number);
  const [dy, dm, dd] = dateStr.split('-').map(Number);
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((Date.UTC(dy, dm - 1, dd) - Date.UTC(ty, tm - 1, td)) / msPerDay);
}

function urgencyStyle(days: number, isDelivered?: boolean): { badge: string; label: string } {
  if (isDelivered) return { badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'Delivered' };
  if (days < 0) return { badge: 'bg-rose-50 text-rose-700 border-rose-200', label: `${Math.abs(days)}d OVERDUE` };
  if (days === 0) return { badge: 'bg-rose-50 text-rose-700 border-rose-200', label: 'Due today' };
  if (days <= 3) return { badge: 'bg-amber-50 text-amber-700 border-amber-200', label: `${days}d left` };
  return { badge: 'bg-slate-100 text-slate-600 border-slate-200', label: `${days}d left` };
}

// Turns whatever a spreadsheet cell hands us — Excel's own displayed text
// for that cell — into a clean 'YYYY-MM-DD' string.
//
// DELIBERATELY works from the sheet's own displayed text (what the reader
// passed in with { raw: false }, i.e. exactly what Excel shows in the
// cell — "Monday, September 07, 2026", "07/09/2026", etc.) and pulls the
// year/month/day out with plain string parsing. It never constructs a
// `new Date(...)` from that text and never touches getters or
// toISOString — those all interpret through *some* timezone (the
// reading machine's local zone, or UTC) and can silently roll the day
// forward or back. Reading the digits straight out of the text Excel
// already printed means the app shows exactly the date in the file,
// with zero conversion of any kind.
const MONTH_NAMES: Record<string, string> = {
  jan: '01', january: '01', feb: '02', february: '02', mar: '03', march: '03',
  apr: '04', april: '04', may: '05', jun: '06', june: '06', jul: '07', july: '07',
  aug: '08', august: '08', sep: '09', sept: '09', september: '09',
  oct: '10', october: '10', nov: '11', november: '11', dec: '12', december: '12',
};

function parseSheetDate(val: any): string | null {
  if (val == null || val === '') return null;
  const str = String(val).trim();
  if (!str) return null;

  // Already ISO: 2026-09-07(...)
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);

  // Excel serial number typed/pasted as plain digits (rare, but possible
  // if a cell wasn't formatted as a date) — SSF decodes the serial's
  // calendar date directly, no Date object involved.
  if (/^\d+(\.\d+)?$/.test(str)) {
    const parsed = XLSX.SSF.parse_date_code(Number(str));
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
  }

  // "Monday, September 07, 2026" / "September 7, 2026" / "Sep 07 2026"
  const longForm = str.match(/([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (longForm) {
    const monthKey = longForm[1].toLowerCase();
    if (MONTH_NAMES[monthKey]) {
      const dd = longForm[2].padStart(2, '0');
      return `${longForm[3]}-${MONTH_NAMES[monthKey]}-${dd}`;
    }
  }

  // "07-Sep-2026" / "07 Sep 26"
  const dmyText = str.match(/^(\d{1,2})[\s\-](?:of\s)?([A-Za-z]+)\.?[\s\-](\d{2,4})$/);
  if (dmyText) {
    const monthKey = dmyText[2].toLowerCase();
    if (MONTH_NAMES[monthKey]) {
      let y = dmyText[3];
      if (y.length === 2) y = `20${y}`;
      const dd = dmyText[1].padStart(2, '0');
      return `${y}-${MONTH_NAMES[monthKey]}-${dd}`;
    }
  }

  // DD/MM/YYYY or DD-MM-YYYY (this app's convention throughout, matches
  // how dates are typed elsewhere in the ERP)
  const numeric = str.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (numeric) {
    let [, d, mo, y] = numeric;
    if (y.length === 2) y = `20${y}`;
    const ddN = Number(d), moN = Number(mo);
    if (moN >= 1 && moN <= 12 && ddN >= 1 && ddN <= 31) {
      return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
  }

  return null;
}

function normalizeKey(s: string): string {
  return s.trim().toLowerCase().replace(/[\s_-]+/g, '');
}

interface ImportRow {
  rowNum: number;
  poolNoRaw: string;
  projectNameRaw: string;
  dateRaw: string;
  parsedDate: string | null;
  matches: Pool[]; // pools whose poolNo matches (narrowed by project if given/needed)
}

/**
 * Bulk-upload modal: drop an Excel/CSV with Pool No / Project Name /
 * Delivery Date columns and set every matching pool's scheduled delivery
 * date in one go, instead of doing it one by one.
 */
const BulkDeliveryUploadModal: React.FC<{ pools: Pool[]; onUpdatePool?: (poolId: string, updates: Partial<Pool>) => void; onClose: () => void }> = ({ pools, onUpdatePool, onClose }) => {
  const [dragActive, setDragActive] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const buildPreview = (headers: string[], dataRows: any[][]) => {
    const norm = headers.map(normalizeKey);
    const poolIdx = norm.findIndex(h => h.includes('poolno') || h === 'pool' || h.includes('pool#') || h.includes('poolnumber'));
    const projectIdx = norm.findIndex(h => h.includes('project'));
    const dateIdx = norm.findIndex(h => h.includes('deliver') || h.includes('date'));

    if (poolIdx === -1 || dateIdx === -1) {
      setError('Could not find "Pool No" and "Delivery Date" columns. Make sure your header row has columns named something like Pool No, Project Name, and Delivery Date.');
      return;
    }

    const parsed: ImportRow[] = dataRows
      .map((r, i) => {
        const poolNoRaw = String(r[poolIdx] ?? '').trim();
        const projectNameRaw = projectIdx !== -1 ? String(r[projectIdx] ?? '').trim() : '';
        const dateRaw = String(r[dateIdx] ?? '').trim();
        if (!poolNoRaw && !dateRaw) return null; // skip fully blank rows
        const parsedDate = parseSheetDate(r[dateIdx]);
        let matches = pools.filter(p => normalizeKey(p.poolNo) === normalizeKey(poolNoRaw));
        if (matches.length > 1 && projectNameRaw) {
          const narrowed = matches.filter(p => normalizeKey(p.projectName) === normalizeKey(projectNameRaw));
          if (narrowed.length > 0) matches = narrowed;
        }
        return { rowNum: i + 2, poolNoRaw, projectNameRaw, dateRaw, parsedDate, matches };
      })
      .filter((r): r is ImportRow => r !== null);

    setRows(parsed);
    setError(null);
  };

  const handleFile = (f: File) => {
    setFileName(f.name);
    setError(null);
    setDone(null);
    const ext = f.name.split('.').pop()?.toLowerCase();
    const reader = new FileReader();
    if (ext === 'xlsx' || ext === 'xls') {
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const wb = XLSX.read(data, { type: 'array', cellDates: true, cellText: true });
          const ws = wb.Sheets[wb.SheetNames[0]];
          // raw:false returns each cell's formatted display text (exactly
          // what Excel shows, e.g. "Monday, September 07, 2026") instead
          // of a Date object — see parseSheetDate for why that matters.
          const sheetRows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false }) as any[][];
          if (sheetRows.length < 2) { setError('The selected file is empty.'); return; }
          const headerRowIdx = sheetRows.findIndex(r => r && r.length > 0);
          buildPreview(sheetRows[headerRowIdx].map((h: any) => String(h || '')), sheetRows.slice(headerRowIdx + 1));
        } catch (err: any) {
          setError('Failed to read the file: ' + err.message);
        }
      };
      reader.readAsArrayBuffer(f);
    } else {
      reader.onload = (e) => {
        const text = e.target?.result as string;
        if (!text) { setError('The selected file is empty or unreadable.'); return; }
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) { setError('File has no content rows.'); return; }
        const delim = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';
        const parseLine = (line: string) => line.split(delim).map(c => c.trim().replace(/^['"]|['"]$/g, ''));
        buildPreview(parseLine(lines[0]), lines.slice(1).map(parseLine));
      };
      reader.readAsText(f);
    }
  };

  const matchedRows = rows?.filter(r => r.matches.length === 1 && r.parsedDate) || [];
  const unmatchedRows = rows?.filter(r => r.matches.length !== 1 || !r.parsedDate) || [];

  const confirmImport = () => {
    if (!onUpdatePool || matchedRows.length === 0) return;
    setSaving(true);
    matchedRows.forEach(r => {
      onUpdatePool(r.matches[0].id, { scheduledDeliveryDate: r.parsedDate });
    });
    setDone(`Done — ${matchedRows.length} pool${matchedRows.length === 1 ? '' : 's'} updated.`);
    setSaving(false);
    setTimeout(onClose, 1800);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-black text-slate-800 flex items-center gap-2">
            <UploadCloud className="h-4 w-4 text-blue-600" /> Bulk Import Delivery Dates
          </h3>
          <button onClick={onClose}><X className="h-5 w-5 text-slate-400 hover:text-slate-600" /></button>
        </div>

        {!rows ? (
          <>
            <p className="text-xs text-slate-500">
              Upload an Excel or CSV file with columns for <strong>Pool No</strong>, <strong>Project Name</strong> (optional, used to disambiguate if a pool number repeats across projects), and <strong>Delivery Date</strong>.
            </p>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => { e.preventDefault(); setDragActive(false); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
              onClick={() => document.getElementById('delivery_planner_import_input')?.click()}
              className={`border-2 border-dashed rounded-xl py-8 text-center cursor-pointer transition-colors ${dragActive ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-blue-300'}`}
            >
              <input
                id="delivery_planner_import_input" type="file" accept=".xlsx,.xls,.csv" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
              <UploadCloud className="h-6 w-6 text-slate-300 mx-auto mb-2" />
              <p className="text-xs font-semibold text-slate-500">Drop the Excel/CSV file here, or click to browse</p>
              <p className="text-[10px] text-slate-400 mt-1">Columns: Pool No, Project Name, Delivery Date</p>
            </div>
            {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}
          </>
        ) : done ? (
          <div className="text-center py-8">
            <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto mb-3" />
            <p className="text-sm font-bold text-slate-700">{done}</p>
          </div>
        ) : (
          <>
            <p className="text-xs text-slate-500">
              From <strong>{fileName}</strong>: <strong className="text-emerald-600">{matchedRows.length}</strong> row{matchedRows.length === 1 ? '' : 's'} matched a pool and will be updated.
              {unmatchedRows.length > 0 && <> <strong className="text-rose-600">{unmatchedRows.length}</strong> row{unmatchedRows.length === 1 ? '' : 's'} couldn't be matched and will be skipped.</>}
            </p>

            <div className="border border-slate-100 rounded-xl max-h-64 overflow-y-auto divide-y divide-slate-50">
              {rows.map(r => {
                const ok = r.matches.length === 1 && r.parsedDate;
                return (
                  <div key={r.rowNum} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                    <div className="min-w-0 flex items-center gap-2">
                      {ok ? <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" /> : <AlertTriangle className="h-3.5 w-3.5 text-rose-500 shrink-0" />}
                      <span className="font-mono font-bold text-slate-600 shrink-0">{r.poolNoRaw || '(blank)'}</span>
                      <span className="text-slate-400 truncate">{r.projectNameRaw}</span>
                    </div>
                    <span className={`shrink-0 font-semibold ${ok ? 'text-slate-600' : 'text-rose-500'}`}>
                      {!r.parsedDate ? `Unrecognized date: "${r.dateRaw}"` : r.matches.length === 0 ? 'No matching pool' : r.matches.length > 1 ? `${r.matches.length} pools match — add project name` : r.parsedDate}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => { setRows(null); setFileName(null); }}
                className="flex-1 text-xs font-bold py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer"
              >
                Choose a different file
              </button>
              <button
                onClick={confirmImport}
                disabled={!onUpdatePool || saving || matchedRows.length === 0}
                className="flex-1 flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold py-2.5 rounded-xl cursor-pointer transition-colors"
              >
                <UploadCloud className="h-3.5 w-3.5" />
                {saving ? 'Saving...' : `Update ${matchedRows.length} Pool${matchedRows.length === 1 ? '' : 's'}`}
              </button>
            </div>
            {!onUpdatePool && (
              <span className="text-[10px] font-bold text-rose-500 block">Save is not wired up yet — ask your developer to connect onUpdatePool.</span>
            )}
          </>
        )}
      </div>
    </div>
  );
};

/**
 * Delivery Planner — lets management commit a target delivery date to any
 * pool, then reports it against that pool's live current production stage
 * so "what's due on the 12th, and where's each of those pools right now"
 * is a single screen instead of cross-referencing two tabs.
 *
 * Left: pick a pool (search by pool no. / project) and set/clear its date.
 * Right: every pool that currently has a scheduled date, grouped by date,
 * each row showing current stage + days remaining. Filterable by project
 * and exportable (PDF/Excel) for handing to a driver or client.
 */
export const DeliveryPlanner: React.FC<DeliveryPlannerProps> = ({ pools, onUpdatePool }) => {
  const [pickerQuery, setPickerQuery] = useState('');
  const [selectedPoolId, setSelectedPoolId] = useState<string | null>(null);
  const [dateInput, setDateInput] = useState('');
  const [notesInput, setNotesInput] = useState('');
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [readyFilter, setReadyFilter] = useState<'all' | 'ready' | 'not_ready'>('all');
  const [reportSearch, setReportSearch] = useState('');
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const selectedPool = useMemo(() => pools.find(p => p.id === selectedPoolId) || null, [pools, selectedPoolId]);

  const pickerMatches = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    const undelivered = pools.filter(p => !p.isDelivered);
    if (!q) return undelivered.slice(0, 40);
    return undelivered.filter(p =>
      p.poolNo.toLowerCase().includes(q) || p.projectName.toLowerCase().includes(q)
    ).slice(0, 40);
  }, [pools, pickerQuery]);

  const loadPool = (pool: Pool) => {
    setSelectedPoolId(pool.id);
    setDateInput(pool.scheduledDeliveryDate ? pool.scheduledDeliveryDate.slice(0, 10) : '');
    setNotesInput(pool.deliveryPlanNotes || '');
    setSaveMsg(null);
  };

  const handleSaveDate = () => {
    if (!selectedPool || !onUpdatePool) return;
    if (!dateInput) {
      setSaveMsg('Pick a date first.');
      return;
    }
    onUpdatePool(selectedPool.id, { scheduledDeliveryDate: dateInput, deliveryPlanNotes: notesInput || null });
    setSaveMsg('Delivery date saved.');
  };

  const handleClearDate = () => {
    if (!selectedPool || !onUpdatePool) return;
    onUpdatePool(selectedPool.id, { scheduledDeliveryDate: null, deliveryPlanNotes: null });
    setDateInput('');
    setNotesInput('');
    setSaveMsg('Delivery date cleared.');
  };

  const projectOptions = useMemo(
    () => Array.from(new Set(pools.filter(p => p.scheduledDeliveryDate).map(p => p.projectName))).sort(),
    [pools]
  );

  const scheduledPools = useMemo(() => {
    const q = reportSearch.trim().toLowerCase();
    return pools
      .filter(p => !!p.scheduledDeliveryDate)
      .filter(p => projectFilter === 'all' || p.projectName === projectFilter)
      .filter(p => {
        if (readyFilter === 'all') return true;
        const isReady = p.isDelivered || p.readyForDelivery;
        return readyFilter === 'ready' ? isReady : !isReady;
      })
      .filter(p => !q || p.poolNo.toLowerCase().includes(q) || p.projectName.toLowerCase().includes(q))
      .sort((a, b) => (a.scheduledDeliveryDate! < b.scheduledDeliveryDate! ? -1 : a.scheduledDeliveryDate! > b.scheduledDeliveryDate! ? 1 : 0));
  }, [pools, projectFilter, readyFilter, reportSearch]);

  // Group by date so "22 pools due on the 12th" reads as one block with a count.
  const groupedByDate = useMemo(() => {
    const groups: { date: string; pools: Pool[] }[] = [];
    scheduledPools.forEach(p => {
      const d = p.scheduledDeliveryDate!.slice(0, 10);
      let g = groups.find(x => x.date === d);
      if (!g) { g = { date: d, pools: [] }; groups.push(g); }
      g.pools.push(p);
    });
    return groups;
  }, [scheduledPools]);

  const allVisibleSelected = scheduledPools.length > 0 && scheduledPools.every(p => selectedIds.has(p.id));

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(scheduledPools.map(p => p.id)));
    }
  };

  const toggleSelectOne = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleDeleteSelected = () => {
    if (!onUpdatePool || selectedIds.size === 0) return;
    const count = selectedIds.size;
    if (!window.confirm(`Remove the scheduled delivery date from ${count} pool${count === 1 ? '' : 's'}? This only clears the plan — it won't affect production or actual delivery status.`)) return;
    selectedIds.forEach(id => {
      onUpdatePool(id, { scheduledDeliveryDate: null, deliveryPlanNotes: null });
    });
    setSelectedIds(new Set());
    if (selectedPoolId && selectedIds.has(selectedPoolId)) {
      setDateInput('');
      setNotesInput('');
    }
  };

  const exportRows = () =>
    scheduledPools.map(p => ({
      'Pool No': p.poolNo,
      'Project': p.projectName,
      'Current Stage': currentStageLabel(p),
      'Delivery Date': p.scheduledDeliveryDate,
      'Days Remaining': p.isDelivered ? 'Delivered' : daysRemaining(p.scheduledDeliveryDate!.slice(0, 10)),
      'Ready for Delivery': p.isDelivered ? 'Delivered' : p.readyForDelivery ? 'Yes' : 'No',
      'Notes': p.deliveryPlanNotes || '',
    }));

  return (
    <>
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-fadeIn">

      {/* Left: assign / update a pool's scheduled delivery date */}
      <div className="lg:col-span-4 bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-3">
        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
          <CalendarClock className="h-4 w-4 text-blue-500" />
          Schedule a Delivery
        </h3>
        <p className="text-xs text-slate-400">
          Pick a pool and set the date you're committing to deliver it by. It'll show up in the report on the right against its live production stage.
        </p>

        <div className="relative">
          <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={pickerQuery}
            onChange={(e) => setPickerQuery(e.target.value)}
            placeholder="Search by pool no. or project name..."
            className="w-full text-xs border border-slate-200 rounded-xl pl-8 pr-3 py-2 font-semibold text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-400"
          />
        </div>

        <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
          {pickerMatches.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-6">No undelivered pools match your search.</p>
          ) : (
            pickerMatches.map(pool => {
              const isSelected = selectedPoolId === pool.id;
              return (
                <button
                  key={pool.id}
                  onClick={() => loadPool(pool)}
                  className={`w-full text-left p-2.5 rounded-xl border cursor-pointer flex items-center justify-between gap-2 transition-colors ${
                    isSelected ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-100 hover:bg-slate-50'
                  }`}
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className={`font-mono font-black text-[10px] px-1.5 py-0.5 rounded shrink-0 ${
                      isSelected ? 'bg-slate-800 text-teal-400' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {pool.poolNo}
                    </span>
                    <span className="text-xs font-semibold truncate">{pool.projectName}</span>
                  </span>
                  {pool.scheduledDeliveryDate && (
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${isSelected ? 'bg-slate-700 text-teal-300' : 'bg-blue-50 text-blue-700'}`}>
                      {pool.scheduledDeliveryDate.slice(0, 10)}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>

        {selectedPool && (
          <div className="pt-3 border-t border-slate-100 space-y-2">
            <div className="text-xs">
              <span className="font-bold text-slate-700">{selectedPool.poolNo}</span>
              <span className="text-slate-400"> — {selectedPool.projectName}</span>
              <div className="text-[10px] text-slate-400 mt-0.5">Currently at: <strong className="text-slate-600">{currentStageLabel(selectedPool)}</strong></div>
            </div>

            <label className="text-xs font-bold text-slate-500 block">Scheduled delivery date</label>
            <input
              type="date"
              value={dateInput}
              onChange={(e) => setDateInput(e.target.value)}
              className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 font-semibold text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-400"
            />

            <label className="text-xs font-bold text-slate-500 block">Notes (optional)</label>
            <input
              type="text"
              value={notesInput}
              onChange={(e) => setNotesInput(e.target.value)}
              placeholder="e.g. client requested morning slot"
              className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 font-semibold text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-400"
            />

            <div className="flex gap-2 pt-1">
              <button
                onClick={handleSaveDate}
                disabled={!onUpdatePool}
                className="flex-1 flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold py-2.5 rounded-xl cursor-pointer transition-colors"
              >
                <Truck className="h-3.5 w-3.5" />
                Save Date
              </button>
              {selectedPool.scheduledDeliveryDate && (
                <button
                  onClick={handleClearDate}
                  disabled={!onUpdatePool}
                  title="Clear scheduled date"
                  className="flex items-center justify-center gap-1 bg-white border border-rose-200 hover:bg-rose-50 disabled:opacity-50 text-rose-600 text-xs font-bold px-3 py-2.5 rounded-xl cursor-pointer transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {saveMsg && <p className="text-[10.5px] font-bold text-emerald-600">{saveMsg}</p>}
            {!onUpdatePool && (
              <span className="text-[10px] font-bold text-rose-500 block">Save is not wired up yet — ask your developer to connect onUpdatePool.</span>
            )}
          </div>
        )}
      </div>

      {/* Right: report — every pool with a scheduled date, grouped by date */}
      <div className="lg:col-span-8 bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
            <CalendarClock className="h-4 w-4 text-blue-500" />
            Delivery Schedule Report
          </h3>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowBulkUpload(true)}
              disabled={!onUpdatePool}
              className="flex items-center gap-1 text-[10.5px] font-bold px-2.5 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50 cursor-pointer"
            >
              <UploadCloud className="h-3.5 w-3.5" /> Bulk Upload
            </button>
            <button
              onClick={() => exportTablePdf({
                title: 'Delivery Schedule Report',
                subtitle: projectFilter === 'all' ? 'All Projects' : projectFilter,
                columns: [
                  { header: 'Pool No', dataKey: 'poolNo' },
                  { header: 'Project', dataKey: 'project' },
                  { header: 'Current Stage', dataKey: 'stage' },
                  { header: 'Delivery Date', dataKey: 'date' },
                  { header: 'Days Remaining', dataKey: 'days' },
                  { header: 'Ready?', dataKey: 'ready' },
                  { header: 'Notes', dataKey: 'notes' },
                ],
                rows: scheduledPools.map(p => ({
                  poolNo: p.poolNo,
                  project: p.projectName,
                  stage: currentStageLabel(p),
                  date: p.scheduledDeliveryDate,
                  days: p.isDelivered ? 'Delivered' : daysRemaining(p.scheduledDeliveryDate!.slice(0, 10)),
                  ready: p.isDelivered ? 'Delivered' : p.readyForDelivery ? 'Yes' : 'No',
                  notes: p.deliveryPlanNotes || '',
                })),
                filename: 'delivery_schedule_report',
                orientation: 'landscape',
                deptLine: 'Delivery Planning',
              })}
              className="flex items-center gap-1 text-[10.5px] font-bold px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer"
            >
              <Printer className="h-3.5 w-3.5" /> PDF
            </button>
            <button
              onClick={() => exportToExcel(exportRows(), 'delivery_schedule_report', 'Delivery Schedule')}
              className="flex items-center gap-1 text-[10.5px] font-bold px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" /> Excel
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={reportSearch}
              onChange={(e) => setReportSearch(e.target.value)}
              placeholder="Search pool no. or project..."
              className="w-full text-xs border border-slate-200 rounded-xl pl-8 pr-3 py-2 font-semibold text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-400"
            />
          </div>
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="text-xs border border-slate-200 rounded-xl px-3 py-2 font-semibold text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-400"
          >
            <option value="all">All Projects</option>
            {projectOptions.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <select
            value={readyFilter}
            onChange={(e) => setReadyFilter(e.target.value as 'all' | 'ready' | 'not_ready')}
            className="text-xs border border-slate-200 rounded-xl px-3 py-2 font-semibold text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-400"
          >
            <option value="all">Ready + Not Ready</option>
            <option value="ready">Ready Only</option>
            <option value="not_ready">Not Ready Only</option>
          </select>
        </div>

        {scheduledPools.length > 0 && (
          <div className="flex items-center justify-between gap-2 px-1">
            <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleSelectAll}
                className="h-3.5 w-3.5 rounded border-slate-300 cursor-pointer"
              />
              Select all ({scheduledPools.length})
            </label>
            {selectedIds.size > 0 && (
              <button
                onClick={handleDeleteSelected}
                disabled={!onUpdatePool}
                className="flex items-center gap-1 text-[10.5px] font-bold px-2.5 py-1.5 rounded-lg border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 disabled:opacity-50 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete {selectedIds.size} Selected
              </button>
            )}
          </div>
        )}

        <div id="delivery-planner-report" className="space-y-4 max-h-[640px] overflow-y-auto pr-1">
          {groupedByDate.length === 0 ? (
            <p className="text-xs text-slate-400 py-10 text-center">No pools have a scheduled delivery date yet — set one on the left.</p>
          ) : (
            groupedByDate.map(group => {
              // Build from Date.UTC + format in UTC (not Asia/Dubai) — the
              // string is already the intended UAE calendar date, so this
              // just renders it as-is with zero risk of a local-timezone
              // parse shifting the day (see parseSheetDate/daysRemaining).
              const [gy, gm, gd] = group.date.split('-').map(Number);
              const dt = new Date(Date.UTC(gy, (gm || 1) - 1, gd || 1));
              const dayLabel = isNaN(dt.getTime()) ? group.date : dt.toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
              const overdueCount = group.pools.filter(p => !p.isDelivered && daysRemaining(group.date) < 0).length;
              const readyCount = group.pools.filter(p => p.readyForDelivery || p.isDelivered).length;
              return (
                <div key={group.date} className="border border-slate-100 rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-3.5 py-2 bg-slate-50 border-b border-slate-100">
                    <span className="text-xs font-black text-slate-700">{dayLabel}</span>
                    <span className="flex items-center gap-2">
                      {overdueCount > 0 && (
                        <span className="flex items-center gap-1 text-[10px] font-bold text-rose-600">
                          <AlertTriangle className="h-3 w-3" /> {overdueCount} overdue
                        </span>
                      )}
                      <span className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                        readyCount === group.pools.length ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'
                      }`}>
                        <PackageCheck className="h-3 w-3" /> {readyCount} of {group.pools.length} ready
                      </span>
                      <span className="text-[10.5px] font-bold text-slate-500 bg-white border border-slate-200 rounded-full px-2 py-0.5">
                        {group.pools.length} pool{group.pools.length !== 1 ? 's' : ''}
                      </span>
                    </span>
                  </div>
                  <div className="divide-y divide-slate-50">
                    {group.pools.map(pool => {
                      const days = daysRemaining(group.date);
                      const style = urgencyStyle(days, pool.isDelivered);
                      return (
                        <div key={pool.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs">
                          <div className="min-w-0 flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(pool.id)}
                              onChange={() => toggleSelectOne(pool.id)}
                              className="h-3.5 w-3.5 rounded border-slate-300 cursor-pointer shrink-0"
                            />
                            <span className="font-mono font-black text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded shrink-0">
                              {pool.poolNo}
                            </span>
                            <span className="font-semibold text-slate-800 truncate">{pool.projectName}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[10.5px] text-slate-500 hidden md:inline">{currentStageLabel(pool)}</span>
                            {pool.isDelivered && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${style.badge}`}>
                              {style.label}
                            </span>
                            {!pool.isDelivered && (
                              <button
                                onClick={() => onUpdatePool && onUpdatePool(pool.id, { readyForDelivery: !pool.readyForDelivery })}
                                disabled={!onUpdatePool}
                                title={pool.readyForDelivery ? 'Marked ready — click to undo' : 'Mark this pool ready for delivery'}
                                className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border cursor-pointer disabled:opacity-50 transition-colors ${
                                  pool.readyForDelivery
                                    ? 'bg-emerald-100 text-emerald-700 border-emerald-300 hover:bg-emerald-200'
                                    : 'bg-white text-slate-400 border-slate-200 hover:border-emerald-300 hover:text-emerald-600'
                                }`}
                              >
                                <PackageCheck className="h-3 w-3" />
                                {pool.readyForDelivery ? 'Ready' : 'Mark Ready'}
                              </button>
                            )}
                            <button
                              onClick={() => loadPool(pool)}
                              className="text-[10px] font-bold text-blue-600 hover:underline cursor-pointer"
                            >
                              Edit
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>

    {showBulkUpload && (
      <BulkDeliveryUploadModal pools={pools} onUpdatePool={onUpdatePool} onClose={() => setShowBulkUpload(false)} />
    )}
    </>
  );
};
