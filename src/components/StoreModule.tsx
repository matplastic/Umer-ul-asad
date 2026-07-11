import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  Boxes, Package, ClipboardCheck, Printer, Plus, Trash2, CheckCircle2, XCircle,
  RefreshCw, AlertTriangle, X, Clock, ListChecks, TrendingUp, Upload, Download,
  Truck, BarChart3, FileSpreadsheet, Star,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  dbFetchMaterials, dbSaveMaterial, dbDeleteMaterial, dbAdjustMaterialStock,
  dbFetchBomItems, dbSaveBomItem, dbDeleteBomItem,
  dbFetchMaterialRequests, dbDecideMaterialRequestBatch, dbMarkMaterialRequestBatchPrinted,
  dbBulkImportMaterials, dbFetchIncomingMaterials, dbCreateIncomingMaterial, dbDeleteIncomingMaterial,
  dbFetchConsumptionAnalytics, dbFetchConsumptionLogs, dbFetchFloorStock,
} from '../lib/firebaseService';
import { Material, BOMItem, MaterialRequest, IncomingMaterial, ConsumptionLog, FloorStock, SECTION_DEFINITIONS, SUPERVISOR_SECTIONS } from '../types';

type Tab = 'requests' | 'floor' | 'bom' | 'inventory' | 'incoming' | 'reports' | 'key';

interface StoreModuleProps {
  currentUserName: string;
  projectNames: string[];
  poolTypesByProject: Record<string, string[]>;
}

const emptyMaterial = { name: '', category: '', section: '', unit: 'kg', currentStock: 0, reorderLevel: 0, notes: '', erpCode: '', supplierName: '', brand: '', location: '', hsCode: '', isCritical: null as boolean | null };

// Keywords used to auto-detect "critical" bulk raw materials (steel, resin, fiber, mosaic, etc.)
// Matched against both the material's name and category, case-insensitively.
// Edit this list any time to add/remove which materials count as "key materials".
const CRITICAL_MATERIAL_KEYWORDS = ['steel', 'resin', 'fiber', 'fibre', 'glass', 'mosaic', 'gelcoat', 'gel coat', 'grp'];

// A material is critical if it was manually flagged, or (when not manually flagged either way)
// its name/category matches one of the keywords above.
const isMaterialCritical = (m: Material): boolean => {
  if (m.isCritical === true) return true;
  if (m.isCritical === false) return false;
  const haystack = `${m.name || ''} ${m.category || ''}`.toLowerCase();
  return CRITICAL_MATERIAL_KEYWORDS.some(k => haystack.includes(k));
};
const emptyBom = { projectName: '', poolType: '', materialId: '', qtyPerPool: '' };
const emptyIncoming = { materialId: '', qty: '', supplier: '', invoiceNo: '', notes: '' };

export const StoreModule: React.FC<StoreModuleProps> = ({ currentUserName, projectNames, poolTypesByProject }) => {
  const [tab, setTab] = useState<Tab>('inventory');
  const [materials, setMaterials] = useState<Material[]>([]);
  const [bom, setBom] = useState<BOMItem[]>([]);
  const [requests, setRequests] = useState<MaterialRequest[]>([]);
  const [incoming, setIncoming] = useState<IncomingMaterial[]>([]);
  const [consumptionLogs, setConsumptionLogs] = useState<ConsumptionLog[]>([]);
  const [floorStock, setFloorStock] = useState<FloorStock[]>([]);
  const [analytics, setAnalytics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [printBatch, setPrintBatch] = useState<MaterialRequest[] | null>(null);
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');

  const [newMaterial, setNewMaterial] = useState<any>(emptyMaterial);
  const [newBom, setNewBom] = useState<any>(emptyBom);
  const [newIncoming, setNewIncoming] = useState<any>(emptyIncoming);
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});
  const [sectionFilter, setSectionFilter] = useState<string>('');
  // Inventory tab search — matches name, ERP code, supplier, brand,
  // storage location, HS code, or category.
  const [inventorySearch, setInventorySearch] = useState('');
  const [importMode, setImportMode] = useState<'add' | 'update' | 'both'>('both');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [m, b, r, inc, an, cons, fs] = await Promise.all([
        dbFetchMaterials(),
        dbFetchBomItems(),
        dbFetchMaterialRequests(),
        dbFetchIncomingMaterials(),
        dbFetchConsumptionAnalytics(),
        dbFetchConsumptionLogs(),
        dbFetchFloorStock(),
      ]);
      setMaterials(Array.isArray(m) ? m : []);
      setBom(Array.isArray(b) ? b : []);
      setRequests(Array.isArray(r) ? r.map((x: any) => ({ ...x, qtyRequested: Number(x.qtyRequested) })) : []);
      setIncoming(Array.isArray(inc) ? inc.map((x: any) => ({ ...x, qty: Number(x.qty) })) : []);
      setConsumptionLogs(Array.isArray(cons) ? cons.map((x: any) => ({ ...x, qty: Number(x.qty) })) : []);
      setFloorStock(Array.isArray(fs) ? fs.map((x: any) => ({ ...x, qty: Number(x.qty) })) : []);
      setAnalytics(an);
      setError(null);
    } catch (e: any) {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
    const interval = setInterval(() => loadAll(true), 15000);
    return () => clearInterval(interval);
  }, [loadAll]);

  // Everything a supervisor sent together from one cart shares a batchId —
  // group by that so Store approves/rejects/prints ONE card per request,
  // not one per material line. Legacy requests with no batchId (sent before
  // batching existed) fall back to grouping by their own id ("batch of one").
  const requestGroups = useMemo(() => {
    const map = new Map<string, MaterialRequest[]>();
    for (const r of requests) {
      const key = r.batchId || r.id;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return Array.from(map.entries()).map(([key, items]) => ({
      key,
      items,
      // All lines in a batch move together (approved/rejected/printed as
      // one unit), so the first line's status represents the whole group.
      status: items[0].status,
      createdAt: items[0].createdAt,
    }));
  }, [requests]);

  const pendingPrintCount = requestGroups.filter(g => g.status === 'APPROVED').length;
  const pendingApprovalCount = requestGroups.filter(g => g.status === 'PENDING').length;

  const filteredMaterials = useMemo(() => {
    let list = !sectionFilter ? materials : materials.filter(m => (m.section || '') === sectionFilter);
    const q = inventorySearch.trim().toLowerCase();
    if (q) {
      list = list.filter(m => {
        const haystack = [m.name, (m as any).erpCode, (m as any).supplierName, (m as any).brand, (m as any).location, (m as any).hsCode, m.category]
          .filter(Boolean).join(' | ').toLowerCase();
        return haystack.includes(q);
      });
    }
    return list;
  }, [materials, sectionFilter, inventorySearch]);

  // Date-range helper: dates on records are 'YYYY-MM-DD' or ISO strings — a
  // plain string comparison works fine for both since they're lexicographic.
  const inDateRange = useCallback((dateStr: string | undefined | null) => {
    if (!dateStr) return true;
    const d = dateStr.slice(0, 10);
    if (fromDate && d < fromDate) return false;
    if (toDate && d > toDate) return false;
    return true;
  }, [fromDate, toDate]);

  const filteredIncoming = useMemo(() => {
    if (!fromDate && !toDate) return incoming;
    return incoming.filter(i => inDateRange(i.receivedAt));
  }, [incoming, fromDate, toDate, inDateRange]);

  const filteredConsumptionLogs = useMemo(() => {
    if (!fromDate && !toDate) return consumptionLogs;
    return consumptionLogs.filter(c => inDateRange(c.date));
  }, [consumptionLogs, fromDate, toDate, inDateRange]);

  // Recompute the same shape as dbFetchConsumptionAnalytics(), but scoped to
  // the selected date range, using the raw incoming/consumption logs already
  // loaded. When no date filter is set, use the server-computed all-time
  // analytics as-is (cheaper, and includes currentStock which logs don't).
  const displayedAnalytics = useMemo(() => {
    if (!fromDate && !toDate) return analytics;
    const byMaterial = (list: any[]) => {
      const map: Record<string, { materialId: string; materialName: string; unit: string; qty: number }> = {};
      for (const row of list) {
        if (!map[row.materialId]) map[row.materialId] = { materialId: row.materialId, materialName: row.materialName, unit: row.unit, qty: 0 };
        map[row.materialId].qty += Number(row.qty || 0);
      }
      return Object.values(map);
    };
    const sum = (list: any[], matchId: string) => list.filter(x => x.materialId === matchId).reduce((s, x) => s + Number(x.qty || 0), 0);
    const inventoryReport = materials.map(m => ({
      materialId: m.id,
      materialName: m.name,
      unit: m.unit,
      currentStock: m.currentStock || 0,
      totalIncoming: sum(filteredIncoming, m.id),
      totalConsumed: sum(filteredConsumptionLogs, m.id),
    }));
    const dailyBySection: Record<string, number> = {};
    for (const row of filteredConsumptionLogs) {
      const key = row.sectionId || 'unknown';
      dailyBySection[key] = (dailyBySection[key] || 0) + Number(row.qty || 0);
    }
    return {
      inventoryReport,
      consumptionByMaterial: byMaterial(filteredConsumptionLogs),
      incomingByMaterial: byMaterial(filteredIncoming),
      dailyBySection,
      plannedBySection: {},
      perProject: analytics?.perProject || {},
      perPoolType: analytics?.perPoolType || [],
    };
  }, [analytics, materials, filteredIncoming, filteredConsumptionLogs, fromDate, toDate]);

  // --- Materials ---
  const saveMaterial = async () => {
    if (!newMaterial.name || !newMaterial.unit) return;
    const item = {
      ...newMaterial,
      id: `mat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date().toISOString(),
      section: newMaterial.section || null,
    };
    await dbSaveMaterial(item);
    setNewMaterial(emptyMaterial);
    loadAll(true);
  };

  const deleteMaterial = async (id: string) => {
    if (!confirm('Delete this material? This cannot be undone.')) return;
    await dbDeleteMaterial(id);
    loadAll(true);
  };

  const adjustStock = async (id: string) => {
    const delta = prompt('Enter quantity to add to stock (use a negative number to correct downward):');
    if (delta === null || delta === '') return;
    await dbAdjustMaterialStock(id, Number(delta));
    loadAll(true);
  };

  const toggleCritical = async (mat: Material) => {
    const current = isMaterialCritical(mat);
    await dbSaveMaterial({ ...mat, isCritical: !current } as any);
    loadAll(true);
  };

  const editSection = async (mat: Material) => {
    const options = SECTION_DEFINITIONS.map(s => s.id).join(', ');
    const sec = prompt(`Assign section for "${mat.name}" (${options} or blank):`, mat.section || '');
    if (sec === null) return;
    await dbSaveMaterial({ ...mat, section: sec.trim() || null } as any);
    loadAll(true);
  };

  // --- Excel Import/Export ---
  const downloadTemplate = () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet([
      { name: 'Resin (example)', erpCode: 'MZ.SRF.RES.001', category: 'Resin', section: 'lamination', unit: 'kg', currentStock: 500, reorderLevel: 50, supplierName: 'ABC Chemicals', brand: 'Reichhold', location: 'Rack A-1', hsCode: '3907.30', notes: '' },
      { name: 'Fiber Mat (example)', erpCode: 'MZ.SRF.FIB.002', category: 'Fiberglass', section: 'lamination', unit: 'kg', currentStock: 300, reorderLevel: 30, supplierName: 'Global Fiber Co', brand: 'Owens Corning', location: 'Rack A-2', hsCode: '7019.31', notes: '' },
      { name: 'Primer Paint (example)', erpCode: 'MZ.SRF.PRM.003', category: 'Paint', section: 'steel_primer', unit: 'ltr', currentStock: 200, reorderLevel: 20, supplierName: 'Jotun', brand: 'Jotun', location: 'Rack B-1', hsCode: '3208.90', notes: '' },
    ]);
    XLSX.utils.book_append_sheet(wb, ws, 'Materials');
    XLSX.writeFile(wb, 'materials_import_template.xlsx');
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws);
      if (rows.length === 0) { setFlash('Sheet is empty.'); return; }
      const result = await dbBulkImportMaterials(rows, importMode);
      setFlash(`Imported: ${result.added || 0} added, ${result.updated || 0} updated, ${result.skipped || 0} skipped.`);
      setTimeout(() => setFlash(null), 5000);
      loadAll(true);
    } catch (err: any) {
      setError('Failed to parse or import file: ' + err.message);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // --- BOM ---
  const saveBomItem = async () => {
    const mat = materials.find(m => m.id === newBom.materialId);
    if (!newBom.projectName || !newBom.poolType || !mat || !newBom.qtyPerPool) return;
    await dbSaveBomItem({
      projectName: newBom.projectName,
      poolType: newBom.poolType,
      materialId: mat.id,
      materialName: mat.name,
      unit: mat.unit,
      qtyPerPool: String(newBom.qtyPerPool),
    } as any);
    setNewBom(emptyBom);
    loadAll(true);
  };

  const deleteBomItem = async (id: string) => {
    await dbDeleteBomItem(id);
    loadAll(true);
  };

  // --- Requests --- decide/print act on the WHOLE group (every material
  // line the supervisor sent together) in one call, not line by line.
  const decideGroup = async (ids: string[], action: 'approve' | 'reject', noteKey: string) => {
    await dbDecideMaterialRequestBatch(ids, action, currentUserName, decisionNotes[noteKey] || undefined);
    loadAll(true);
  };

  const markPrinted = async (ids: string[]) => {
    await dbMarkMaterialRequestBatchPrinted(ids);
    setPrintBatch(null);
    loadAll(true);
  };

  // --- Incoming ---
  const saveIncoming = async () => {
    if (!newIncoming.materialId || !newIncoming.qty) return;
    await dbCreateIncomingMaterial({
      materialId: newIncoming.materialId,
      materialName: '',
      unit: '',
      qty: Number(newIncoming.qty),
      supplier: newIncoming.supplier || null,
      invoiceNo: newIncoming.invoiceNo || null,
      notes: newIncoming.notes || null,
      receivedByName: currentUserName,
      receivedAt: new Date().toISOString(),
    } as any);
    setNewIncoming(emptyIncoming);
    loadAll(true);
  };

  const statusPill = (status: string) => {
    const map: Record<string, string> = {
      PENDING: 'bg-amber-950/40 text-amber-400 border-amber-800',
      APPROVED: 'bg-emerald-950/40 text-emerald-400 border-emerald-800',
      REJECTED: 'bg-rose-950/40 text-rose-400 border-rose-800',
      PRINTED: 'bg-slate-800 text-slate-400 border-slate-700',
    };
    return <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase border ${map[status] || map.PENDING}`}>{status}</span>;
  };

  const sectionLabel = (id?: string | null) => {
    if (!id) return '—';
    return SECTION_DEFINITIONS.find(s => s.id === id)?.name || id;
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6" data-testid="store-module">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-orange-600/20 border border-orange-700/40 flex items-center justify-center">
            <Boxes className="h-5 w-5 text-orange-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Store &amp; BOM Portal</h1>
            <p className="text-xs text-slate-400">Inventory, section-wise materials, GRN, BOM, requests &amp; consumption reports</p>
          </div>
        </div>
        <button onClick={() => loadAll()} data-testid="store-refresh" className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium cursor-pointer">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 bg-rose-950/30 border border-rose-800 text-rose-300 text-sm px-4 py-3 rounded-lg">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}
      {flash && (
        <div className="mb-4 flex items-center gap-2 bg-emerald-950/30 border border-emerald-800 text-emerald-300 text-sm px-4 py-3 rounded-lg" data-testid="store-flash">
          <CheckCircle2 className="h-4 w-4 shrink-0" /> {flash}
        </div>
      )}

      {(tab === 'incoming' || tab === 'reports') && (
        <div className="mb-4 flex flex-wrap items-center gap-2 bg-slate-900 border border-slate-800 rounded-xl p-3">
          <Clock className="h-3.5 w-3.5 text-slate-500" />
          <span className="text-xs font-bold uppercase text-slate-400">Date range:</span>
          <input type="date" data-testid="date-filter-from" value={fromDate} onChange={e => setFromDate(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white" />
          <span className="text-slate-500 text-xs">to</span>
          <input type="date" data-testid="date-filter-to" value={toDate} onChange={e => setToDate(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white" />
          {(fromDate || toDate) && (
            <button onClick={() => { setFromDate(''); setToDate(''); }} className="text-xs text-orange-400 hover:text-orange-300 cursor-pointer font-semibold">Clear</button>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 mb-6">
        <button onClick={() => setTab('key')} data-testid="tab-key" className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold cursor-pointer transition-all ${tab === 'key' ? 'bg-orange-600 text-white shadow-md' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'}`}>
          <Star className="h-4 w-4" /> Key Materials
        </button>
        <button onClick={() => setTab('inventory')} data-testid="tab-inventory" className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold cursor-pointer transition-all ${tab === 'inventory' ? 'bg-orange-600 text-white shadow-md' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'}`}>
          <Package className="h-4 w-4" /> Inventory
        </button>
        <button onClick={() => setTab('incoming')} data-testid="tab-incoming" className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold cursor-pointer transition-all ${tab === 'incoming' ? 'bg-orange-600 text-white shadow-md' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'}`}>
          <Truck className="h-4 w-4" /> Incoming
        </button>
        <button onClick={() => setTab('bom')} data-testid="tab-bom" className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold cursor-pointer transition-all ${tab === 'bom' ? 'bg-orange-600 text-white shadow-md' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'}`}>
          <ListChecks className="h-4 w-4" /> Bill of Materials
        </button>
        <button onClick={() => setTab('requests')} data-testid="tab-requests" className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold cursor-pointer transition-all ${tab === 'requests' ? 'bg-orange-600 text-white shadow-md' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'}`}>
          <ClipboardCheck className="h-4 w-4" /> Requests
          {pendingApprovalCount > 0 && <span className="ml-1 bg-amber-500 text-slate-950 rounded-full px-1.5 text-[10px]">{pendingApprovalCount}</span>}
          {pendingPrintCount > 0 && <span className="ml-1 bg-emerald-500 text-slate-950 rounded-full px-1.5 text-[10px]">{pendingPrintCount} print</span>}
        </button>
        <button onClick={() => setTab('floor')} data-testid="tab-floor" className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold cursor-pointer transition-all ${tab === 'floor' ? 'bg-orange-600 text-white shadow-md' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'}`}>
          <Boxes className="h-4 w-4" /> On Floor
        </button>
        <button onClick={() => setTab('reports')} data-testid="tab-reports" className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold cursor-pointer transition-all ${tab === 'reports' ? 'bg-orange-600 text-white shadow-md' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'}`}>
          <BarChart3 className="h-4 w-4" /> Consumption Reports
        </button>
      </div>

      {/* ---------- INVENTORY TAB (Excel + Section-wise) ---------- */}
      {tab === 'inventory' && (
        <div>
          {/* Excel toolbar */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-4 flex flex-wrap items-center gap-2">
            <div className="text-xs font-bold uppercase text-slate-400 mr-1 flex items-center gap-1.5"><FileSpreadsheet className="h-3.5 w-3.5" /> Excel:</div>
            <button onClick={downloadTemplate} data-testid="excel-template-btn" className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-bold cursor-pointer">
              <Download className="h-3.5 w-3.5" /> Download Template
            </button>
            <select value={importMode} onChange={e => setImportMode(e.target.value as any)} data-testid="excel-import-mode" className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white">
              <option value="both">Add new + update existing</option>
              <option value="add">Only add new</option>
              <option value="update">Only update existing stock</option>
            </select>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFileUpload} className="hidden" data-testid="excel-upload-input" />
            <button onClick={() => fileInputRef.current?.click()} data-testid="excel-upload-btn" className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold cursor-pointer">
              <Upload className="h-3.5 w-3.5" /> Upload Excel to Update Inventory
            </button>
            <div className="ml-auto flex items-center gap-2">
              <input
                type="text"
                placeholder="Search name, ERP code, brand, supplier, location…"
                value={inventorySearch}
                onChange={e => setInventorySearch(e.target.value)}
                data-testid="inventory-search"
                className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white w-64"
              />
              <label className="text-[10px] uppercase text-slate-400 font-bold">Filter by section:</label>
              <select value={sectionFilter} onChange={e => setSectionFilter(e.target.value)} data-testid="section-filter" className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white">
                <option value="">All sections</option>
                {SECTION_DEFINITIONS.map(s => <option key={s.id as string} value={s.id as string}>{s.name}</option>)}
                <option value="__blank__">Unassigned</option>
              </select>
            </div>
          </div>

          {/* Add material form */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-5 grid grid-cols-1 md:grid-cols-7 gap-2">
            <input placeholder="Material name" data-testid="new-mat-name" value={newMaterial.name} onChange={e => setNewMaterial((p: any) => ({ ...p, name: e.target.value }))} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white md:col-span-2" />
            <select value={newMaterial.section} onChange={e => setNewMaterial((p: any) => ({ ...p, section: e.target.value }))} data-testid="new-mat-section" className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white">
              <option value="">Section…</option>
              {SECTION_DEFINITIONS.map(s => <option key={s.id as string} value={s.id as string}>{s.name}</option>)}
            </select>
            <input placeholder="Category" value={newMaterial.category} onChange={e => setNewMaterial((p: any) => ({ ...p, category: e.target.value }))} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white" />
            <input placeholder="Unit (kg/ltr/pcs)" data-testid="new-mat-unit" value={newMaterial.unit} onChange={e => setNewMaterial((p: any) => ({ ...p, unit: e.target.value }))} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white" />
            <input type="number" placeholder="Opening stock" data-testid="new-mat-stock" value={newMaterial.currentStock} onChange={e => setNewMaterial((p: any) => ({ ...p, currentStock: Number(e.target.value) }))} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white" />
            <label className="flex items-center gap-1.5 px-2 py-2 text-xs text-slate-300 cursor-pointer" title="Force this into the Key Materials dashboard regardless of name/category">
              <input type="checkbox" checked={!!newMaterial.isCritical} onChange={e => setNewMaterial((p: any) => ({ ...p, isCritical: e.target.checked }))} className="accent-orange-500" />
              Critical
            </label>
            <button onClick={saveMaterial} data-testid="new-mat-save" className="flex items-center justify-center gap-1.5 px-3 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-xs font-bold cursor-pointer"><Plus className="h-3.5 w-3.5" /> Add Material</button>
            <input placeholder="ERP Code" data-testid="new-mat-erpcode" value={newMaterial.erpCode} onChange={e => setNewMaterial((p: any) => ({ ...p, erpCode: e.target.value }))} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white" />
            <input placeholder="Supplier name" data-testid="new-mat-supplier" value={newMaterial.supplierName} onChange={e => setNewMaterial((p: any) => ({ ...p, supplierName: e.target.value }))} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white md:col-span-2" />
            <input placeholder="Brand" data-testid="new-mat-brand" value={newMaterial.brand} onChange={e => setNewMaterial((p: any) => ({ ...p, brand: e.target.value }))} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white" />
            <input placeholder="Location (Rack/Bin)" data-testid="new-mat-location" value={newMaterial.location} onChange={e => setNewMaterial((p: any) => ({ ...p, location: e.target.value }))} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white" />
            <input placeholder="HS Code" data-testid="new-mat-hscode" value={newMaterial.hsCode} onChange={e => setNewMaterial((p: any) => ({ ...p, hsCode: e.target.value }))} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white" />
          </div>

          {/* Inventory table with incoming + consumed columns */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
            <table className="w-full min-w-[700px] text-xs">
              <thead>
                <tr className="bg-slate-800/60 text-slate-400 uppercase text-[10px]">
                  <th className="px-2 py-2" title="Key material"></th>
                  <th className="text-left px-4 py-2">Material</th>
                  <th className="text-left px-4 py-2">ERP Code</th>
                  <th className="text-left px-4 py-2">Section</th>
                  <th className="text-left px-4 py-2">Category</th>
                  <th className="text-left px-4 py-2">Brand</th>
                  <th className="text-left px-4 py-2">Supplier</th>
                  <th className="text-left px-4 py-2">Location</th>
                  <th className="text-right px-4 py-2">Incoming</th>
                  <th className="text-right px-4 py-2">Consumed</th>
                  <th className="text-right px-4 py-2">Current Stock</th>
                  <th className="text-right px-4 py-2">Reorder At</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {filteredMaterials
                  .filter(m => sectionFilter === '__blank__' ? !m.section : true)
                  .map(m => {
                    const inv = analytics?.inventoryReport?.find((r: any) => r.materialId === m.id);
                    return (
                      <tr key={m.id} className="border-t border-slate-800">
                        <td className="px-2 py-2 text-center">
                          <button onClick={() => toggleCritical(m)} title={isMaterialCritical(m) ? 'Marked as Key Material — click to unmark' : 'Click to mark as Key Material'} className="cursor-pointer">
                            <Star className={`h-3.5 w-3.5 ${isMaterialCritical(m) ? 'text-amber-400 fill-amber-400' : 'text-slate-600'}`} />
                          </button>
                        </td>
                        <td className="px-4 py-2 text-slate-200 font-semibold">{m.name}</td>
                        <td className="px-4 py-2 text-slate-400 font-mono">{(m as any).erpCode || '—'}</td>
                        <td className="px-4 py-2 text-slate-400"><button onClick={() => editSection(m)} className="hover:text-orange-400 cursor-pointer">{sectionLabel(m.section)}</button></td>
                        <td className="px-4 py-2 text-slate-400">{m.category || '—'}</td>
                        <td className="px-4 py-2 text-slate-400">{(m as any).brand || '—'}</td>
                        <td className="px-4 py-2 text-slate-400">{(m as any).supplierName || '—'}</td>
                        <td className="px-4 py-2 text-slate-400">{(m as any).location || '—'}</td>
                        <td className="px-4 py-2 text-right text-emerald-400 font-mono">+{(inv?.totalIncoming || 0).toFixed(2)}</td>
                        <td className="px-4 py-2 text-right text-rose-400 font-mono">−{(inv?.totalConsumed || 0).toFixed(2)}</td>
                        <td className={`px-4 py-2 text-right font-mono ${(m.reorderLevel || 0) > 0 && m.currentStock <= (m.reorderLevel || 0) ? 'text-rose-400 font-bold' : 'text-slate-200'}`}>
                          {m.currentStock} {m.unit}
                        </td>
                        <td className="px-4 py-2 text-right text-slate-500">{m.reorderLevel || 0}</td>
                        <td className="px-4 py-2 text-right flex items-center justify-end gap-2">
                          <button onClick={() => adjustStock(m.id)} data-testid={`adjust-${m.id}`} className="text-slate-500 hover:text-emerald-400 cursor-pointer text-[11px] font-bold">Adjust</button>
                          <button onClick={() => deleteMaterial(m.id)} className="text-slate-500 hover:text-rose-400 cursor-pointer"><Trash2 className="h-3.5 w-3.5" /></button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
            {filteredMaterials.length === 0 && (
              <div className="text-center text-slate-500 text-sm py-10">
                {inventorySearch ? `No materials match "${inventorySearch}".` : 'No materials found. Add materials above or upload Excel.'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---------- KEY MATERIALS TAB (steel, resin, fiber mat, mosaic, etc.) ---------- */}
      {tab === 'key' && (
        <KeyMaterialsDashboard materials={materials} analytics={analytics} onToggleCritical={toggleCritical} />
      )}

      {/* ---------- INCOMING TAB ---------- */}
      {tab === 'incoming' && (
        <div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-5 grid grid-cols-1 md:grid-cols-6 gap-2">
            <select value={newIncoming.materialId} onChange={e => setNewIncoming((p: any) => ({ ...p, materialId: e.target.value }))} data-testid="new-incoming-material" className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white md:col-span-2">
              <option value="">Material…</option>
              {materials.map(m => <option key={m.id} value={m.id}>{m.name} ({m.unit}) · stock: {m.currentStock}</option>)}
            </select>
            <input type="number" step="any" placeholder="Qty" data-testid="new-incoming-qty" value={newIncoming.qty} onChange={e => setNewIncoming((p: any) => ({ ...p, qty: e.target.value }))} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white" />
            <input placeholder="Supplier" value={newIncoming.supplier} onChange={e => setNewIncoming((p: any) => ({ ...p, supplier: e.target.value }))} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white" />
            <input placeholder="Invoice #" value={newIncoming.invoiceNo} onChange={e => setNewIncoming((p: any) => ({ ...p, invoiceNo: e.target.value }))} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white" />
            <button onClick={saveIncoming} data-testid="new-incoming-save" className="flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold cursor-pointer"><Plus className="h-3.5 w-3.5" /> Log Incoming</button>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
            <div className="px-4 py-2 border-b border-slate-800 text-xs font-bold uppercase text-slate-400">Recent GRN (Goods Received)</div>
            <table className="w-full min-w-[700px] text-xs">
              <thead>
                <tr className="text-slate-400 uppercase text-[10px]">
                  <th className="text-left px-4 py-2">Date</th>
                  <th className="text-left px-4 py-2">Material</th>
                  <th className="text-right px-4 py-2">Qty</th>
                  <th className="text-left px-4 py-2">Supplier</th>
                  <th className="text-left px-4 py-2">Invoice</th>
                  <th className="text-left px-4 py-2">Received By</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {filteredIncoming.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map(inc => (
                  <tr key={inc.id} className="border-t border-slate-800">
                    <td className="px-4 py-2 text-slate-500 font-mono">{new Date(inc.receivedAt).toLocaleDateString()}</td>
                    <td className="px-4 py-2 text-slate-200 font-semibold">{inc.materialName}</td>
                    <td className="px-4 py-2 text-right text-emerald-400 font-mono">+{Number(inc.qty)} {inc.unit}</td>
                    <td className="px-4 py-2 text-slate-400">{inc.supplier || '—'}</td>
                    <td className="px-4 py-2 text-slate-400">{inc.invoiceNo || '—'}</td>
                    <td className="px-4 py-2 text-slate-500">{inc.receivedByName}</td>
                    <td className="px-4 py-2 text-right"><button onClick={async () => { if (confirm('Delete this GRN and reverse stock?')) { await dbDeleteIncomingMaterial(inc.id); loadAll(true); } }} className="text-slate-500 hover:text-rose-400 cursor-pointer"><Trash2 className="h-3.5 w-3.5" /></button></td>
                  </tr>
                ))}
                {incoming.length === 0 && <tr><td colSpan={7} className="text-center text-slate-500 py-10">No incoming materials logged yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---------- REQUESTS TAB ---------- */}
      {tab === 'requests' && (
        <div className="space-y-3">
          {requestGroups.length === 0 && !loading && (
            <div className="text-center text-slate-500 text-sm py-16 border border-dashed border-slate-800 rounded-xl">No material requests yet.</div>
          )}
          {requestGroups
            .slice()
            .sort((a, b) => (a.status === 'PENDING' ? -1 : 1) - (b.status === 'PENDING' ? -1 : 1) || (a.createdAt < b.createdAt ? 1 : -1))
            .map(group => {
              const first = group.items[0];
              const ids = group.items.map(it => it.id);
              return (
                <div key={group.key} className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {statusPill(group.status)}
                      <span className="text-xs text-slate-500 font-mono">{new Date(first.createdAt).toLocaleString()}</span>
                      {group.items.length > 1 && <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-indigo-950/40 text-indigo-400 border border-indigo-800">{group.items.length} items</span>}
                    </div>
                    <div className="text-xs text-slate-400 mb-1.5">
                      {first.projectName} / {first.poolType}{first.poolNo ? ` / Pool ${first.poolNo}` : ''} · requested by {first.requestedByName} ({first.requestedByRole})
                    </div>
                    {/* Line items — every material in this request, whether it's 1 or 40 */}
                    <div className="flex flex-wrap gap-1.5 mb-1">
                      {group.items.map(it => (
                        <span key={it.id} className="px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-200">
                          {it.materialName}: <span className="font-mono font-bold text-white">{Number(it.qtyRequested)}</span> {it.unit}
                        </span>
                      ))}
                    </div>
                    {first.reason && <div className="text-xs text-slate-500 italic mt-0.5">&ldquo;{first.reason}&rdquo;</div>}
                    {first.decidedByName && (
                      <div className="text-[11px] text-slate-500 mt-1">Decided by {first.decidedByName}{first.decisionNotes ? ` — ${first.decisionNotes}` : ''}</div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {group.status === 'PENDING' && (
                      <>
                        <input
                          type="text"
                          placeholder="Note (optional)"
                          value={decisionNotes[group.key] || ''}
                          onChange={e => setDecisionNotes(prev => ({ ...prev, [group.key]: e.target.value }))}
                          className="hidden md:block w-36 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white"
                        />
                        <button onClick={() => decideGroup(ids, 'approve', group.key)} data-testid={`req-approve-${group.key}`} className="flex items-center gap-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold cursor-pointer">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Approve{group.items.length > 1 ? ' All' : ''}
                        </button>
                        <button onClick={() => decideGroup(ids, 'reject', group.key)} data-testid={`req-reject-${group.key}`} className="flex items-center gap-1 px-3 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold cursor-pointer">
                          <XCircle className="h-3.5 w-3.5" /> Reject{group.items.length > 1 ? ' All' : ''}
                        </button>
                      </>
                    )}
                    {group.status === 'APPROVED' && (
                      <button onClick={() => setPrintBatch(group.items)} className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold cursor-pointer animate-pulse">
                        <Printer className="h-3.5 w-3.5" /> Print Issue Slip
                      </button>
                    )}
                    {group.status === 'PRINTED' && (
                      <span className="flex items-center gap-1 text-xs text-slate-500"><Clock className="h-3.5 w-3.5" /> Printed {first.printedAt ? new Date(first.printedAt).toLocaleTimeString() : ''}</span>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {/* ---------- FLOOR STOCK TAB ---------- */}
      {tab === 'floor' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
            <Boxes className="h-4 w-4 text-orange-400" />
            <div className="text-sm font-bold text-white">Material Currently on the Floor</div>
            <div className="text-xs text-slate-500">Issued out of Store on approval, not yet consumed</div>
          </div>
          <table className="w-full min-w-[700px] text-xs">
            <thead>
              <tr className="bg-slate-800/60 text-slate-400 uppercase text-[10px]">
                <th className="text-left px-4 py-2">Section</th>
                <th className="text-left px-4 py-2">Material</th>
                <th className="text-right px-4 py-2">On Floor</th>
                <th className="text-left px-4 py-2">Last Movement</th>
              </tr>
            </thead>
            <tbody>
              {floorStock
                .slice()
                .sort((a, b) => (a.sectionName || a.sectionId).localeCompare(b.sectionName || b.sectionId) || a.materialName.localeCompare(b.materialName))
                .map(f => {
                  const sectionLbl = SUPERVISOR_SECTIONS.find(s => s.id === f.sectionId)?.name
                    || SECTION_DEFINITIONS.find(s => s.id === f.sectionId)?.name
                    || f.sectionName || f.sectionId;
                  return (
                    <tr key={f.id} className="border-t border-slate-800">
                      <td className="px-4 py-2 text-slate-300">{sectionLbl}</td>
                      <td className="px-4 py-2 text-slate-200 font-semibold">{f.materialName}</td>
                      <td className={`px-4 py-2 text-right font-mono font-bold ${f.qty <= 0 ? 'text-slate-500' : 'text-emerald-400'}`}>{f.qty} {f.unit}</td>
                      <td className="px-4 py-2 text-slate-500 font-mono">{f.updatedAt ? new Date(f.updatedAt).toLocaleString() : '—'}</td>
                    </tr>
                  );
                })}
              {floorStock.length === 0 && (
                <tr><td colSpan={4} className="text-center text-slate-500 py-10">Nothing issued to the floor yet. Approve a request to move material out of the Store.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ---------- BOM TAB ---------- */}
      {tab === 'bom' && (
        <div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-5 grid grid-cols-1 md:grid-cols-5 gap-2">
            <select value={newBom.projectName} onChange={e => setNewBom((p: any) => ({ ...p, projectName: e.target.value, poolType: '' }))} data-testid="bom-project" className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white">
              <option value="">Project…</option>
              {projectNames.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <select value={newBom.poolType} onChange={e => setNewBom((p: any) => ({ ...p, poolType: e.target.value }))} data-testid="bom-pool-type" className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white" disabled={!newBom.projectName}>
              <option value="">Pool Type…</option>
              {(poolTypesByProject[newBom.projectName] || []).map(t => <option key={t} value={t}>{t}</option>)}
              <option value="__custom__">Other (type manually)…</option>
            </select>
            {newBom.poolType === '__custom__' && (
              <input placeholder="Pool type name" onChange={e => setNewBom((p: any) => ({ ...p, poolType: e.target.value }))} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white" />
            )}
            <select value={newBom.materialId} onChange={e => setNewBom((p: any) => ({ ...p, materialId: e.target.value }))} data-testid="bom-material" className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white">
              <option value="">Material…</option>
              {materials.map(m => <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}
            </select>
            <input type="number" step="any" placeholder="Qty per pool" data-testid="bom-qty" value={newBom.qtyPerPool} onChange={e => setNewBom((p: any) => ({ ...p, qtyPerPool: e.target.value }))} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white" />
            <button onClick={saveBomItem} data-testid="bom-save" className="flex items-center justify-center gap-1.5 px-3 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-xs font-bold cursor-pointer"><Plus className="h-3.5 w-3.5" /> Add to BOM</button>
          </div>

          {projectNames.map(proj => {
            const rows = bom.filter(b => b.projectName === proj);
            if (rows.length === 0) return null;
            const types = Array.from(new Set(rows.map(r => r.poolType)));
            return (
              <div key={proj} className="mb-6">
                <h3 className="text-sm font-bold text-white mb-2">{proj}</h3>
                {types.map(type => (
                  <div key={type} className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto mb-3">
                    <div className="bg-slate-800/60 px-4 py-2 text-xs font-bold text-orange-400 uppercase">{type}</div>
                    <table className="w-full min-w-[700px] text-xs">
                      <tbody>
                        {rows.filter(r => r.poolType === type).map(r => (
                          <tr key={r.id} className="border-t border-slate-800">
                            <td className="px-4 py-2 text-slate-200">{r.materialName}</td>
                            <td className="px-4 py-2 text-slate-400">{Number(r.qtyPerPool)} {r.unit} / pool</td>
                            <td className="px-4 py-2 text-right"><button onClick={() => deleteBomItem(r.id)} className="text-slate-500 hover:text-rose-400 cursor-pointer"><Trash2 className="h-3.5 w-3.5" /></button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            );
          })}
          {bom.length === 0 && <div className="text-center text-slate-500 text-sm py-10 border border-dashed border-slate-800 rounded-xl">No BOM defined yet. Add material lines above for each Project + Pool Type.</div>}
        </div>
      )}

      {/* ---------- REPORTS TAB ---------- */}
      {tab === 'reports' && displayedAnalytics && (
        <ConsumptionReports analytics={displayedAnalytics} />
      )}

      {/* ---------- PRINT SLIP MODAL ---------- */}
      {printBatch && printBatch.length > 0 && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <style dangerouslySetInnerHTML={{ __html: `
            @media print {
              body * { visibility: hidden !important; }
              #printable-slip, #printable-slip * { visibility: visible !important; }
              #printable-slip { position: absolute !important; left: 0; top: 0; width: 100%; background: white !important; color: black !important; padding: 1.5cm !important; }
              .no-print { display: none !important; }
            }
          `}} />
          <div className="bg-slate-900 border border-slate-700 p-5 rounded-2xl max-w-2xl w-full shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="no-print flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
              <span className="text-xs font-bold uppercase text-slate-400">Material Issue Slip{printBatch.length > 1 ? ` — ${printBatch.length} items` : ''}</span>
              <div className="flex gap-2">
                <button onClick={() => setTimeout(() => window.print(), 50)} className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer">
                  <Printer className="h-3.5 w-3.5" /> Print
                </button>
                <button onClick={() => markPrinted(printBatch.map(it => it.id))} className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold cursor-pointer">Mark Printed</button>
                <button onClick={() => setPrintBatch(null)} className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded-lg cursor-pointer"><X className="h-4 w-4" /></button>
              </div>
            </div>
            <div id="printable-slip" className="bg-white text-slate-900 p-6 rounded-lg">
              <div className="flex items-center justify-between border-b-2 border-slate-900 pb-3 mb-4">
                <div className="flex items-center gap-3">
                  <img src="/logo.png" alt="MAT Plastic Industries LLC" className="h-12 w-auto object-contain" />
                  <div>
                    <h2 className="text-lg font-black tracking-tight">MAT PLASTIC INDUSTRIES LLC</h2>
                    <p className="text-xs text-slate-600">Store Department — Material Issue Slip</p>
                  </div>
                </div>
                <div className="text-right text-xs text-slate-600 shrink-0">
                  <div>Slip No. <span className="font-mono font-bold text-slate-900">MIS-{(printBatch[0].batchId || printBatch[0].id).slice(-8).toUpperCase()}</span></div>
                  <div>{new Date().toLocaleString()}</div>
                </div>
              </div>

              <table className="w-full text-sm mb-4">
                <tbody>
                  <tr><td className="py-1 text-slate-500 w-40">Project</td><td className="py-1 font-semibold">{printBatch[0].projectName}</td></tr>
                  <tr><td className="py-1 text-slate-500">Pool Type</td><td className="py-1 font-semibold">{printBatch[0].poolType}</td></tr>
                  {printBatch[0].poolNo && <tr><td className="py-1 text-slate-500">Pool No.</td><td className="py-1 font-semibold">{printBatch[0].poolNo}</td></tr>}
                  <tr><td className="py-1 text-slate-500">Requested By</td><td className="py-1">{printBatch[0].requestedByName} ({printBatch[0].requestedByRole})</td></tr>
                  <tr><td className="py-1 text-slate-500">Approved By</td><td className="py-1">{printBatch[0].decidedByName || '—'}{printBatch[0].decidedAt ? ` · ${new Date(printBatch[0].decidedAt).toLocaleString()}` : ''}</td></tr>
                  {printBatch[0].reason && <tr><td className="py-1 text-slate-500">Reason / Note</td><td className="py-1 italic">{printBatch[0].reason}</td></tr>}
                </tbody>
              </table>

              {/* Line items — one row per material, however many are in this batch */}
              <table className="w-full text-sm mb-4 border border-slate-300 rounded overflow-hidden">
                <thead>
                  <tr className="bg-slate-100 text-slate-600 text-xs uppercase">
                    <th className="text-left px-3 py-2 w-10">#</th>
                    <th className="text-left px-3 py-2">Material</th>
                    <th className="text-right px-3 py-2">Quantity Issued</th>
                  </tr>
                </thead>
                <tbody>
                  {printBatch.map((it, idx) => (
                    <tr key={it.id} className="border-t border-slate-200">
                      <td className="px-3 py-1.5 text-slate-500">{idx + 1}</td>
                      <td className="px-3 py-1.5 font-semibold">{it.materialName}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{Number(it.qtyRequested)} {it.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="text-xs bg-slate-100 border border-slate-300 rounded px-3 py-2 mb-6">
                Status: material has left the Store and is recorded on the <b>{printBatch[0].requestedByRole}</b> Floor Stock. It will be deducted from Floor Stock as it is consumed and logged in Consumption.
              </div>

              <div className="grid grid-cols-2 gap-6 mt-10 text-xs">
                <div className="border-t border-slate-400 pt-1">Store Keeper Signature &amp; Date</div>
                <div className="border-t border-slate-400 pt-1">Received By (Supervisor) Signature &amp; Date</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ==========================================================
// ConsumptionReports subcomponent
// ==========================================================

// Focused dashboard for the small set of big-ticket bulk raw materials (steel, resin,
// fiber mat, mosaic, etc.) so they don't get lost among masks/plumbing/hardware in the
// main Inventory tab. A material shows up here if it's auto-detected via
// CRITICAL_MATERIAL_KEYWORDS, or manually starred in the Inventory tab.
const KeyMaterialsDashboard: React.FC<{ materials: Material[]; analytics: any; onToggleCritical: (m: Material) => void }> = ({ materials, analytics, onToggleCritical }) => {
  const keyMaterials = useMemo(() => materials.filter(isMaterialCritical), [materials]);
  const lowStockCount = keyMaterials.filter(m => (m.reorderLevel || 0) > 0 && m.currentStock <= (m.reorderLevel || 0)).length;

  return (
    <div className="space-y-5" data-testid="key-materials-dashboard">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-slate-400">
          Showing <span className="text-white font-bold">{keyMaterials.length}</span> key material{keyMaterials.length === 1 ? '' : 's'}
          {lowStockCount > 0 && <span className="ml-2 text-rose-400 font-bold">· {lowStockCount} at/below reorder level</span>}
        </div>
        <div className="text-[10px] text-slate-500">
          Auto-included by name/category match (steel, resin, fiber/fibre, glass, mosaic, gelcoat, GRP) — or click the <Star className="inline h-3 w-3 text-amber-400 fill-amber-400 -mt-0.5" /> star on any material in the Inventory tab to add/remove it manually.
        </div>
      </div>

      {keyMaterials.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl text-center text-slate-500 text-sm py-10">
          No key materials found yet. Go to the Inventory tab and click the star next to steel, resin, fiber mat, mosaic, etc. to pin them here.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {keyMaterials.map(m => {
            const inv = analytics?.inventoryReport?.find((r: any) => r.materialId === m.id);
            const totalIncoming = inv?.totalIncoming || 0;
            const totalConsumed = inv?.totalConsumed || 0;
            const isLow = (m.reorderLevel || 0) > 0 && m.currentStock <= (m.reorderLevel || 0);
            const netMax = Math.max(totalIncoming, totalConsumed, 1);
            return (
              <div key={m.id} className={`bg-slate-900 border rounded-xl p-4 ${isLow ? 'border-rose-800' : 'border-slate-800'}`}>
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div>
                    <div className="text-sm font-bold text-white flex items-center gap-1.5">
                      {m.name}
                      <button onClick={() => onToggleCritical(m)} title="Unpin from Key Materials">
                        <Star className="h-3.5 w-3.5 text-amber-400 fill-amber-400 cursor-pointer" />
                      </button>
                    </div>
                    <div className="text-[10px] text-slate-500">{m.category || '—'}{m.erpCode ? ` · ${m.erpCode}` : ''}</div>
                  </div>
                  {isLow && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-rose-950/40 text-rose-400 border border-rose-800 shrink-0">
                      <AlertTriangle className="h-3 w-3" /> Low
                    </span>
                  )}
                </div>

                <div className="flex items-baseline gap-1 mb-3">
                  <span className={`text-2xl font-mono font-bold ${isLow ? 'text-rose-400' : 'text-white'}`}>{m.currentStock}</span>
                  <span className="text-xs text-slate-500">{m.unit} in stock</span>
                  {(m.reorderLevel || 0) > 0 && <span className="text-[10px] text-slate-600 ml-auto">reorder at {m.reorderLevel}</span>}
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className="w-16 text-slate-500 shrink-0">Incoming</span>
                    <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.max(4, (totalIncoming / netMax) * 100)}%` }} />
                    </div>
                    <span className="w-16 text-right font-mono text-emerald-400">+{totalIncoming.toFixed(1)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className="w-16 text-slate-500 shrink-0">Consumed</span>
                    <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-full bg-rose-500 rounded-full" style={{ width: `${Math.max(4, (totalConsumed / netMax) * 100)}%` }} />
                    </div>
                    <span className="w-16 text-right font-mono text-rose-400">−{totalConsumed.toFixed(1)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const ConsumptionReports: React.FC<{ analytics: any }> = ({ analytics }) => {
  const { inventoryReport = [], consumptionByMaterial = [], incomingByMaterial = [], dailyBySection = {}, perProject = {}, perPoolType = [] } = analytics || {};

  // Daily consumption chart: sum across all sections/materials per date
  const dailyTotals = useMemo(() => {
    const list: { date: string; qty: number }[] = [];
    for (const date of Object.keys(dailyBySection)) {
      let qty = 0;
      for (const secKey of Object.keys(dailyBySection[date] || {})) {
        for (const matKey of Object.keys(dailyBySection[date][secKey] || {})) {
          qty += Number(dailyBySection[date][secKey][matKey].qty || 0);
        }
      }
      list.push({ date, qty });
    }
    return list.sort((a, b) => (a.date < b.date ? -1 : 1));
  }, [dailyBySection]);

  return (
    <div className="space-y-6" data-testid="consumption-reports">
      {/* Overall inventory summary */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
          <Package className="h-4 w-4 text-orange-400" />
          <div className="text-sm font-bold text-white">Inventory Overview (current + incoming + consumption)</div>
        </div>
        <table className="w-full min-w-[700px] text-xs">
          <thead>
            <tr className="bg-slate-800/60 text-slate-400 uppercase text-[10px]">
              <th className="text-left px-4 py-2">Material</th>
              <th className="text-left px-4 py-2">Section</th>
              <th className="text-right px-4 py-2">Total Incoming</th>
              <th className="text-right px-4 py-2">Total Consumed</th>
              <th className="text-right px-4 py-2">Current Stock</th>
            </tr>
          </thead>
          <tbody>
            {inventoryReport.map((r: any) => (
              <tr key={r.materialId} className="border-t border-slate-800">
                <td className="px-4 py-2 text-slate-200">{r.materialName}</td>
                <td className="px-4 py-2 text-slate-400">{r.section ? (SECTION_DEFINITIONS.find(s => s.id === r.section)?.name || r.section) : '—'}</td>
                <td className="px-4 py-2 text-right text-emerald-400 font-mono">+{r.totalIncoming.toFixed(2)} {r.unit}</td>
                <td className="px-4 py-2 text-right text-rose-400 font-mono">−{r.totalConsumed.toFixed(2)} {r.unit}</td>
                <td className="px-4 py-2 text-right font-mono text-slate-200 font-bold">{r.currentStock} {r.unit}</td>
              </tr>
            ))}
            {inventoryReport.length === 0 && <tr><td colSpan={5} className="text-center text-slate-500 py-8">No materials yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Daily consumption sparkline */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-emerald-400" />
          <div className="text-sm font-bold text-white">Daily Consumption (all sections, all materials)</div>
        </div>
        {dailyTotals.length === 0 ? (
          <div className="text-center text-slate-500 py-8 text-sm">No consumption data yet.</div>
        ) : (
          <div className="p-4">
            <div className="flex items-end gap-2 h-32 overflow-x-auto">
              {dailyTotals.slice(-30).map(d => {
                const max = Math.max(...dailyTotals.map(x => x.qty), 1);
                const h = Math.max(4, (d.qty / max) * 100);
                return (
                  <div key={d.date} className="flex flex-col items-center gap-1 min-w-[36px]">
                    <div className="w-6 bg-gradient-to-t from-orange-600 to-amber-400 rounded-t" style={{ height: `${h}px` }} title={`${d.date}: ${d.qty.toFixed(1)}`} />
                    <div className="text-[9px] text-slate-500 font-mono">{d.date.slice(5)}</div>
                    <div className="text-[9px] text-slate-300 font-bold">{d.qty.toFixed(0)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Per project consumption */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
        <div className="px-4 py-3 border-b border-slate-800 text-sm font-bold text-white">Per-Project Material Consumption</div>
        {Object.keys(perProject).length === 0 ? (
          <div className="text-center text-slate-500 py-8 text-sm">No project consumption data yet.</div>
        ) : Object.keys(perProject).map(proj => (
          <div key={proj} className="border-b border-slate-800 last:border-0">
            <div className="px-4 py-2 bg-slate-800/40 text-xs font-bold text-orange-400 uppercase">{proj}</div>
            <table className="w-full min-w-[700px] text-xs">
              <tbody>
                {Object.entries(perProject[proj]).map(([matId, cell]: [string, any]) => (
                  <tr key={matId} className="border-t border-slate-800">
                    <td className="px-4 py-2 text-slate-200">{cell.materialName}</td>
                    <td className="px-4 py-2 text-right text-rose-400 font-mono">{cell.qty.toFixed(2)} {cell.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {/* Per pool type: planned vs actual */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
        <div className="px-4 py-3 border-b border-slate-800 text-sm font-bold text-white">Per-Pool-Type: Planned (BOM) vs Actual (attributed)</div>
        {perPoolType.length === 0 ? (
          <div className="text-center text-slate-500 py-8 text-sm">Log production and consumption to see this comparison.</div>
        ) : perPoolType.map((row: any) => {
          const matIds = Array.from(new Set([...Object.keys(row.plannedByMaterial || {}), ...Object.keys(row.actualByMaterial || {})]));
          return (
            <div key={row.poolTypeKey} className="border-b border-slate-800 last:border-0">
              <div className="px-4 py-2 bg-slate-800/40 flex items-center justify-between">
                <div className="text-xs font-bold text-orange-400 uppercase">{row.projectName} — {row.poolType}</div>
                <div className="text-[10px] text-slate-400">Pools produced: <span className="text-white font-bold">{row.poolsProduced}</span></div>
              </div>
              <table className="w-full min-w-[700px] text-xs">
                <thead>
                  <tr className="text-slate-400 uppercase text-[10px]">
                    <th className="text-left px-4 py-2">Material</th>
                    <th className="text-right px-4 py-2">Planned</th>
                    <th className="text-right px-4 py-2">Actual</th>
                    <th className="text-right px-4 py-2">Diff (per pool)</th>
                  </tr>
                </thead>
                <tbody>
                  {matIds.map(mid => {
                    const p = row.plannedByMaterial[mid];
                    const a = row.actualByMaterial[mid];
                    const planned = p?.qty || 0;
                    const actual = a?.qty || 0;
                    const diff = actual - planned;
                    const perPool = row.poolsProduced > 0 ? diff / row.poolsProduced : 0;
                    const name = p?.materialName || a?.materialName || mid;
                    const unit = p?.unit || a?.unit || '';
                    const cls = diff > 0 ? 'text-rose-400' : diff < 0 ? 'text-emerald-400' : 'text-slate-400';
                    return (
                      <tr key={mid} className="border-t border-slate-800">
                        <td className="px-4 py-2 text-slate-200">{name}</td>
                        <td className="px-4 py-2 text-right text-slate-300 font-mono">{planned.toFixed(2)} {unit}</td>
                        <td className="px-4 py-2 text-right text-slate-300 font-mono">{actual.toFixed(2)} {unit}</td>
                        <td className={`px-4 py-2 text-right font-mono font-bold ${cls}`}>{diff.toFixed(2)} {unit} <span className="text-[10px] opacity-70 ml-1">({perPool.toFixed(2)}/pool)</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default StoreModule;
