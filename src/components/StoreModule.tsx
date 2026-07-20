import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  Boxes, Package, ClipboardCheck, Printer, Plus, Trash2, CheckCircle2, XCircle,
  RefreshCw, AlertTriangle, X, Clock, ListChecks, TrendingUp, Upload, Download,
  Truck, BarChart3, FileSpreadsheet, Star, Search, FileDown, FileText, ShieldCheck, PauseCircle,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  dbFetchMaterials, dbSaveMaterial, dbDeleteMaterial, dbAdjustMaterialStock,
  dbFetchBomItems, dbSaveBomItem, dbDeleteBomItem,
  dbFetchMaterialRequests, dbDecideMaterialRequestBatch, dbMarkMaterialRequestBatchPrinted,
  dbBulkImportMaterials, dbFetchIncomingMaterials, dbCreateIncomingMaterial, dbDeleteIncomingMaterial,
  dbFetchConsumptionAnalytics, dbFetchConsumptionLogs, dbFetchFloorStock, dbFetchMaterialReturns,
} from '../lib/firebaseService';
import { Material, BOMItem, MaterialRequest, IncomingMaterial, ConsumptionLog, FloorStock, MaterialReturn, SECTION_DEFINITIONS, SUPERVISOR_SECTIONS } from '../types';

type Tab = 'requests' | 'floor' | 'bom' | 'inventory' | 'incoming' | 'quality' | 'traceability' | 'reports' | 'key';

// ==========================================================
// PDF letterhead helpers — logo + company header + footer used by every
// exported report below, so all four (Consumption, Incoming, Inventory,
// Floor) look like the same ERP system produced them, not four one-off
// exports. Logo is fetched once and cached at module scope since it never
// changes between exports/reloads within a session.
// ==========================================================
const COMPANY_NAME = 'MAT PLASTIC INDUSTRIES LLC';
const BRAND_ORANGE: [number, number, number] = [234, 88, 12];

let logoCache: Promise<{ dataUrl: string; ratio: number } | null> | null = null;
const loadLogo = (): Promise<{ dataUrl: string; ratio: number } | null> => {
  if (!logoCache) {
    logoCache = (async () => {
      try {
        const res = await fetch('/logo.png');
        if (!res.ok) return null;
        const blob = await res.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        const ratio = await new Promise<number>((resolve) => {
          const img = new Image();
          img.onload = () => resolve((img.naturalWidth || 1) / (img.naturalHeight || 1));
          img.onerror = () => resolve(1);
          img.src = dataUrl;
        });
        return { dataUrl, ratio };
      } catch {
        return null;
      }
    })();
  }
  return logoCache;
};

// Draws the logo + company name + report title/subtitle block at the top of
// whichever page jsPDF is currently on, and returns the Y position the table
// body should start at. Passed into autoTable's `didDrawPage` so it repeats
// identically on every page of a multi-page report, not just the first.
const drawPdfHeader = (doc: jsPDF, logo: { dataUrl: string; ratio: number } | null, title: string, subtitle: string): number => {
  const pageWidth = doc.internal.pageSize.getWidth();
  const logoH = 13;
  const logoW = logo ? logoH * logo.ratio : 0;
  if (logo) {
    try { doc.addImage(logo.dataUrl, 'PNG', 14, 9, logoW, logoH); } catch { /* corrupt/unreadable logo — skip it, rest of header still renders */ }
  }
  const textX = logo ? 14 + logoW + 4 : 14;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12.5);
  doc.setTextColor(20, 20, 20);
  doc.text(COMPANY_NAME, textX, 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text('Store Department — ERP System', textX, 19);
  doc.setFontSize(7.5);
  doc.text(`Generated ${new Date().toLocaleString()}`, pageWidth - 14, 12, { align: 'right' });

  doc.setDrawColor(...BRAND_ORANGE);
  doc.setLineWidth(0.9);
  doc.line(14, 25, pageWidth - 14, 25);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(20, 20, 20);
  doc.text(title, 14, 33);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(110, 110, 110);
  doc.text(subtitle, 14, 39);

  return 45;
};

// Thin rule + "Page X of Y" footer, stamped onto every page already in the
// document — call this once, after all tables are drawn, so the total page
// count is correct.
const drawPdfFooter = (doc: jsPDF) => {
  const pageCount = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.3);
    doc.line(14, pageHeight - 14, pageWidth - 14, pageHeight - 14);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(140, 140, 140);
    doc.text(`${COMPANY_NAME} — Store Department ERP`, 14, pageHeight - 9);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - 14, pageHeight - 9, { align: 'right' });
  }
};

interface StoreModuleProps {
  currentUserName: string;
  projectNames: string[];
  poolTypesByProject: Record<string, string[]>;
}

const emptyMaterial = { name: '', category: '', section: '', unit: 'kg', currentStock: 0, reorderLevel: 0, notes: '', erpCode: '', supplierName: '', brand: '', location: '', hsCode: '', isCritical: null as boolean | null, inventoryGroup: 'other' as 'mep' | 'civil' | 'other' };

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
  const [materialReturns, setMaterialReturns] = useState<MaterialReturn[]>([]);
  const [analytics, setAnalytics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [printBatch, setPrintBatch] = useState<MaterialRequest[] | null>(null);
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  // Quick period presets for the date-range bar (Daily / Weekly / Monthly).
  // Picking a preset sets fromDate/toDate for you; editing either date input
  // by hand drops back to 'custom' so the preset buttons never show a stale
  // highlight next to a range the user actually typed themselves.
  const [quickPeriod, setQuickPeriod] = useState<'today' | 'week' | 'month' | 'custom'>('custom');

  const [newMaterial, setNewMaterial] = useState<any>(emptyMaterial);
  const [newBom, setNewBom] = useState<any>(emptyBom);
  const [newIncoming, setNewIncoming] = useState<any>(emptyIncoming);
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});
  const [sectionFilter, setSectionFilter] = useState<string>('');
  // Inventory tab search — matches name, ERP code, supplier, brand,
  // storage location, HS code, or category.
  const [inventorySearch, setInventorySearch] = useState('');
  // Which of the 3 inventory portals is showing: MEP / Civil / Other / All.
  const [invGroupTab, setInvGroupTab] = useState<'mep' | 'civil' | 'other' | 'all'>('all');
  // Same MEP / Civil / Other split, applied to the Reports tab (Consumption
  // Log + Stock Ledger) so Store can look at each portal's consumption
  // separately too.
  const [reportsGroupTab, setReportsGroupTab] = useState<'mep' | 'civil' | 'other' | 'all'>('all');
  // Floor Stock tab search — matches material name or section.
  const [floorSearch, setFloorSearch] = useState('');
  // Consumption Log search — matches material, section, or logged-by name.
  const [logSearch, setLogSearch] = useState('');
  const [importMode, setImportMode] = useState<'add' | 'update' | 'both'>('both');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [m, b, r, inc, an, cons, fs, rets] = await Promise.all([
        dbFetchMaterials(),
        dbFetchBomItems(),
        dbFetchMaterialRequests(),
        dbFetchIncomingMaterials(),
        dbFetchConsumptionAnalytics(),
        dbFetchConsumptionLogs(),
        dbFetchFloorStock(),
        dbFetchMaterialReturns(),
      ]);
      setMaterials(Array.isArray(m) ? m : []);
      setBom(Array.isArray(b) ? b : []);
      setRequests(Array.isArray(r) ? r.map((x: any) => ({ ...x, qtyRequested: Number(x.qtyRequested) })) : []);
      setIncoming(Array.isArray(inc) ? inc.map((x: any) => ({ ...x, qty: Number(x.qty) })) : []);
      setConsumptionLogs(Array.isArray(cons) ? cons.map((x: any) => ({ ...x, qty: Number(x.qty) })) : []);
      setFloorStock(Array.isArray(fs) ? fs.map((x: any) => ({ ...x, qty: Number(x.qty) })) : []);
      setMaterialReturns(Array.isArray(rets) ? rets.map((x: any) => ({ ...x, qty: Number(x.qty) })) : []);
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
    return Array.from(map.entries()).map(([key, items]) => {
      // IMPORTANT: lines in a batch do NOT necessarily share one status.
      // The manager's email/WhatsApp decision page allows per-item
      // approve/reject (e.g. approve 9, reject 3 out of 12), so each line
      // can end up with its own independent status in Firestore. Collapsing
      // to items[0].status here would silently hide rejections whenever the
      // first line happened to be approved — compute per-status buckets
      // instead and let the UI reflect the real mix.
      const pending = items.filter(it => it.status === 'PENDING');
      const approved = items.filter(it => it.status === 'APPROVED');
      const rejected = items.filter(it => it.status === 'REJECTED');
      const printed = items.filter(it => it.status === 'PRINTED');
      // "status" is kept only as a rough summary for sorting/legacy use —
      // prefer pending/approved/rejected/printed below for anything that
      // needs to be correct.
      const status = pending.length > 0 ? 'PENDING'
        : approved.length > 0 ? 'APPROVED'
        : rejected.length > 0 && printed.length === 0 ? 'REJECTED'
        : 'PRINTED';
      return { key, items, pending, approved, rejected, printed, status, createdAt: items[0].createdAt };
    });
  }, [requests]);

  // Counts reflect groups that still have at least one line needing that
  // action — a batch with 9 approved + 3 rejected still needs printing
  // (for the 9) even though it's not "PENDING" anymore.
  const pendingPrintCount = requestGroups.filter(g => g.approved.length > 0).length;
  const pendingApprovalCount = requestGroups.filter(g => g.pending.length > 0).length;

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

  // Sets fromDate/toDate for the chosen quick period. 'today' = just today,
  // 'week' = Sunday through today, 'month' = the 1st through today. Picking
  // 'custom' leaves whatever fromDate/toDate are already set — it's what the
  // date inputs fall back to the moment the person edits them by hand.
  const applyQuickPeriod = useCallback((p: 'today' | 'week' | 'month' | 'custom') => {
    setQuickPeriod(p);
    if (p === 'custom') return;
    const now = new Date();
    const from = new Date(now);
    if (p === 'week') from.setDate(now.getDate() - now.getDay());
    else if (p === 'month') from.setDate(1);
    setFromDate(from.toISOString().slice(0, 10));
    setToDate(now.toISOString().slice(0, 10));
  }, []);

  const filteredFloorStock = useMemo(() => {
    let list = floorStock;
    // Floor Stock is a running balance, not a dated log — "period" here means
    // "rows whose last movement falls in this range", so exporting a
    // Daily/Weekly/Monthly floor report shows only what actually moved then.
    if (fromDate || toDate) list = list.filter(f => inDateRange((f.updatedAt || '').slice(0, 10)));
    const q = floorSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter(f => {
      const haystack = [f.materialName, f.sectionName, f.sectionId].filter(Boolean).join(' | ').toLowerCase();
      return haystack.includes(q);
    });
  }, [floorStock, floorSearch, fromDate, toDate, inDateRange]);

  const filteredIncoming = useMemo(() => {
    if (!fromDate && !toDate) return incoming;
    return incoming.filter(i => inDateRange(i.receivedAt));
  }, [incoming, fromDate, toDate, inDateRange]);

  // Only 'passed' GRNs count toward Inventory/stock reports; pending/failed/hold
  // are held back at the quality gate and shouldn't inflate incoming totals.
  const passedIncoming = useMemo(() => filteredIncoming.filter(i => i.qcStatus === 'passed'), [filteredIncoming]);
  const pendingQcCount = useMemo(() => incoming.filter(i => (i.qcStatus || 'pending') === 'pending').length, [incoming]);

  const filteredConsumptionLogs = useMemo(() => {
    if (!fromDate && !toDate) return consumptionLogs;
    return consumptionLogs.filter(c => inDateRange(c.date));
  }, [consumptionLogs, fromDate, toDate, inDateRange]);

  // Raw consumption log rows for the Reports tab table — same date range as
  // the rest of Reports, plus a free-text search over material/section/logger.
  const searchedConsumptionLogs = useMemo(() => {
    const q = logSearch.trim().toLowerCase();
    let list = filteredConsumptionLogs;
    if (q) {
      list = list.filter(c => {
        const haystack = [c.materialName, c.sectionName, c.sectionId, c.loggedByName, c.notes].filter(Boolean).join(' | ').toLowerCase();
        return haystack.includes(q);
      });
    }
    return list.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (a.createdAt < b.createdAt ? 1 : -1)));
  }, [filteredConsumptionLogs, logSearch]);

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
      totalIncoming: sum(passedIncoming, m.id),
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
      incomingByMaterial: byMaterial(passedIncoming),
      dailyBySection,
      plannedBySection: {},
      perProject: analytics?.perProject || {},
      perPoolType: analytics?.perPoolType || [],
    };
  }, [analytics, materials, passedIncoming, filteredConsumptionLogs, fromDate, toDate]);

  // Store-level stock ledger: Previous Stock → Issued to Floor → Consumed
  // (by supervisors) → Balance Stock, per material, for the selected date
  // range (or all-time if no range is set).
  //
  // currentStock only moves when material is received (Incoming, +) or a
  // request is approved (issued out to Floor, −); logging consumption never
  // touches it (that's tracked separately in FloorStock/ConsumptionLog — see
  // Floor Stock tab). So:
  //   Previous Stock = currentStock − totalIncoming(period) + totalIssued(period)
  //   Balance Stock  = currentStock (today's real Store shelf balance)
  // "Consumed" is shown for context (what supervisors logged off the floor
  // in that period) — it does not change Balance Stock, since that material
  // already left Store the moment it was issued, not the moment it's used.
  const stockLedger = useMemo(() => {
    const approvedInRange = requests.filter(r => r.status === 'APPROVED' && (!fromDate && !toDate ? true : inDateRange((r.decidedAt || '').slice(0, 10))));
    const issuedByMaterial: Record<string, number> = {};
    for (const r of approvedInRange) issuedByMaterial[r.materialId] = (issuedByMaterial[r.materialId] || 0) + Number(r.qtyRequested || 0);

    const incomingByMaterial: Record<string, number> = {};
    for (const i of passedIncoming) incomingByMaterial[i.materialId] = (incomingByMaterial[i.materialId] || 0) + Number(i.qty || 0);

    const consumedByMaterial: Record<string, number> = {};
    for (const c of filteredConsumptionLogs) consumedByMaterial[c.materialId] = (consumedByMaterial[c.materialId] || 0) + Number(c.qty || 0);

    return materials.map(m => {
      const issued = issuedByMaterial[m.id] || 0;
      const incoming = incomingByMaterial[m.id] || 0;
      const consumed = consumedByMaterial[m.id] || 0;
      const balance = m.currentStock || 0;
      const previous = balance - incoming + issued;
      return { materialId: m.id, materialName: m.name, unit: m.unit, previous, issued, incoming, consumed, balance };
    });
  }, [materials, requests, passedIncoming, filteredConsumptionLogs, fromDate, toDate, inDateRange]);

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

  // --- Consumption / Inventory report export (Excel) ---
  // Daily: one row per consumption-log entry in the selected date range
  // (or all logs, if no range is set), plus an inventory snapshot sheet.
  const exportDailyReport = () => {
    const rows = searchedConsumptionLogs.map(c => ({
      Date: c.date,
      Section: c.sectionName || c.sectionId,
      Material: c.materialName,
      Qty: c.qty,
      Unit: c.unit,
      'Logged By': c.loggedByName,
      Notes: c.notes || '',
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ Date: '', Section: '', Material: '', Qty: '', Unit: '', 'Logged By': '', Notes: '' }]), 'Daily Consumption');
    const ledgerRows = stockLedger
      .filter(r => r.previous !== 0 || r.issued !== 0 || r.consumed !== 0 || r.balance !== 0)
      .map(r => ({ Material: r.materialName, 'Previous Stock': r.previous, 'Issued to Floor': r.issued, Consumed: r.consumed, 'Balance Stock': r.balance, Unit: r.unit }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ledgerRows.length ? ledgerRows : [{ Material: '', 'Previous Stock': '', 'Issued to Floor': '', Consumed: '', 'Balance Stock': '', Unit: '' }]), 'Stock Ledger');
    const invRows = (displayedAnalytics?.inventoryReport || []).map((r: any) => ({
      Material: r.materialName,
      Section: r.section ? (SECTION_DEFINITIONS.find(s => s.id === r.section)?.name || r.section) : '',
      'Total Incoming': r.totalIncoming,
      'Total Consumed': r.totalConsumed,
      'Current Stock': r.currentStock,
      Unit: r.unit,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(invRows), 'Inventory Snapshot');
    const label = fromDate || toDate ? `${fromDate || 'start'}_to_${toDate || 'today'}` : new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `daily_consumption_report_${label}.xlsx`);
  };

  // Monthly: consumption logs (within the selected range, or all-time)
  // rolled up by calendar month + material + section. Shared by both the
  // Excel and PDF monthly exports so the two never drift apart.
  const monthlyRollupRows = useCallback(() => {
    const map = new Map<string, { month: string; section: string; material: string; unit: string; qty: number }>();
    for (const c of searchedConsumptionLogs) {
      const month = (c.date || '').slice(0, 7); // YYYY-MM
      const key = `${month}__${c.sectionId}__${c.materialId}`;
      if (!map.has(key)) {
        map.set(key, { month, section: c.sectionName || c.sectionId, material: c.materialName, unit: c.unit, qty: 0 });
      }
      map.get(key)!.qty += Number(c.qty || 0);
    }
    return Array.from(map.values())
      .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : a.material.localeCompare(b.material)));
  }, [searchedConsumptionLogs]);

  const exportMonthlyReport = () => {
    const rows = monthlyRollupRows().map(r => ({ Month: r.month, Section: r.section, Material: r.material, 'Total Consumed': Number(r.qty.toFixed(2)), Unit: r.unit }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ Month: '', Section: '', Material: '', 'Total Consumed': '', Unit: '' }]), 'Monthly Consumption');
    const label = fromDate || toDate ? `${fromDate || 'start'}_to_${toDate || 'today'}` : new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `monthly_consumption_report_${label}.xlsx`);
  };

  // --- PDF export plumbing ---
  // Human-readable period text shown under the title on every PDF, and the
  // filename-safe version of the same range used by every export (Excel and
  // PDF alike) so files from the same period always sort/name together.
  const periodLabel = () => {
    if (quickPeriod === 'today') return 'Daily';
    if (quickPeriod === 'week') return 'Weekly';
    if (quickPeriod === 'month') return 'Monthly';
    return fromDate || toDate ? `${fromDate || 'start'} to ${toDate || 'today'}` : 'All-time';
  };
  const fileLabel = () => (fromDate || toDate ? `${fromDate || 'start'}_to_${toDate || 'today'}` : new Date().toISOString().slice(0, 10));

  // Generic single-table PDF builder shared by every report below — logo +
  // company letterhead + title/period on every page (via autoTable's
  // didDrawPage), one autoTable body, landscape once there are enough
  // columns that portrait would get cramped.
  const pdfFromTable = async (title: string, head: string[], rows: (string | number)[][], filenamePrefix: string) => {
    const logo = await loadLogo();
    const doc = new jsPDF({ orientation: head.length > 5 ? 'landscape' : 'portrait' });
    autoTable(doc, {
      startY: 45,
      head: [head],
      body: rows,
      styles: { fontSize: 8 },
      headStyles: { fillColor: BRAND_ORANGE, textColor: 255 },
      margin: { top: 45, bottom: 18 },
      didDrawPage: () => { drawPdfHeader(doc, logo, title, `Period: ${periodLabel()}`); },
    });
    const finalY = (doc as any).lastAutoTable?.finalY || 45;
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(130, 130, 130);
    doc.text(`${rows.length} record${rows.length === 1 ? '' : 's'}`, 14, finalY + 6);
    drawPdfFooter(doc);
    doc.save(`${filenamePrefix}_${fileLabel()}.pdf`);
  };

  // Consumption Report (PDF) — same two tables as the Excel export's first
  // two sheets (raw log + stock ledger), one per page since jsPDF autotable
  // only draws one table per call cleanly.
  const exportDailyReportPDF = async () => {
    const logo = await loadLogo();
    const doc = new jsPDF({ orientation: 'landscape' });
    autoTable(doc, {
      startY: 45,
      head: [['Date', 'Section', 'Material', 'Qty', 'Unit', 'Logged By', 'Notes']],
      body: searchedConsumptionLogs.map(c => [c.date, c.sectionName || c.sectionId, c.materialName, Number(c.qty).toFixed(2), c.unit, c.loggedByName, c.notes || '']),
      styles: { fontSize: 8 },
      headStyles: { fillColor: BRAND_ORANGE, textColor: 255 },
      margin: { top: 45, bottom: 18 },
      didDrawPage: () => { drawPdfHeader(doc, logo, 'Consumption Report', `Period: ${periodLabel()}`); },
    });
    doc.addPage();
    autoTable(doc, {
      startY: 45,
      head: [['Material', 'Previous Stock', 'Issued to Floor', 'Consumed', 'Balance Stock', 'Unit']],
      body: stockLedger
        .filter(r => r.previous !== 0 || r.issued !== 0 || r.consumed !== 0 || r.balance !== 0)
        .map(r => [r.materialName, r.previous.toFixed(2), r.issued.toFixed(2), r.consumed.toFixed(2), r.balance.toFixed(2), r.unit]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: BRAND_ORANGE, textColor: 255 },
      margin: { top: 45, bottom: 18 },
      didDrawPage: () => { drawPdfHeader(doc, logo, 'Stock Ledger', `Period: ${periodLabel()}`); },
    });
    drawPdfFooter(doc);
    doc.save(`consumption_report_${fileLabel()}.pdf`);
  };

  const exportMonthlyReportPDF = () => {
    const rows = monthlyRollupRows().map(r => [r.month, r.section, r.material, r.qty.toFixed(2), r.unit]);
    pdfFromTable('Monthly Consumption Report', ['Month', 'Section', 'Material', 'Total Consumed', 'Unit'], rows, 'monthly_consumption_report');
  };

  // --- New Incoming Material report (Excel + PDF) ---
  const exportIncomingExcel = () => {
    const rows = filteredIncoming.slice().sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1)).map(inc => ({
      Date: (inc.receivedAt || '').slice(0, 10),
      Material: inc.materialName,
      Qty: inc.qty,
      Unit: inc.unit,
      Supplier: inc.supplier || '',
      Invoice: inc.invoiceNo || '',
      'Received By': inc.receivedByName,
      'QC Status': (inc.qcStatus || 'pending').toUpperCase(),
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ Date: '', Material: '', Qty: '', Unit: '', Supplier: '', Invoice: '', 'Received By': '', 'QC Status': '' }]), 'Incoming Materials');
    XLSX.writeFile(wb, `incoming_material_report_${fileLabel()}.xlsx`);
  };

  const exportIncomingPDF = () => {
    const rows = filteredIncoming.slice().sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1))
      .map(inc => [(inc.receivedAt || '').slice(0, 10), inc.materialName, Number(inc.qty).toFixed(2), inc.unit, inc.supplier || '—', inc.invoiceNo || '—', inc.receivedByName, (inc.qcStatus || 'pending').toUpperCase()]);
    pdfFromTable('New Incoming Material Report', ['Date', 'Material', 'Qty', 'Unit', 'Supplier', 'Invoice', 'Received By', 'QC Status'], rows, 'incoming_material_report');
  };

  // --- Material Traceability — one combined receiving + QC-decision log,
  // searchable by material/supplier/invoice/inspector name, scoped to the
  // same date range as the rest of Store. This is the audit trail: who
  // received it, when, what it weighed in at, and who passed/held/rejected
  // it and why. ---
  const [traceSearch, setTraceSearch] = useState('');
  const filteredTraceability = useMemo(() => {
    const q = traceSearch.trim().toLowerCase();
    if (!q) return filteredIncoming;
    return filteredIncoming.filter(inc => {
      const haystack = [inc.materialName, inc.supplier, inc.invoiceNo, inc.receivedByName, inc.qcByName, inc.qcNotes]
        .filter(Boolean).join(' | ').toLowerCase();
      return haystack.includes(q);
    });
  }, [filteredIncoming, traceSearch]);

  const exportTraceabilityExcel = () => {
    const rows = filteredTraceability.slice().sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1)).map(inc => ({
      'Date Received': (inc.receivedAt || '').slice(0, 10),
      Material: inc.materialName,
      Qty: inc.qty,
      Unit: inc.unit,
      Supplier: inc.supplier || '',
      Invoice: inc.invoiceNo || '',
      'Received By': inc.receivedByName,
      'QC Status': (inc.qcStatus || 'pending').toUpperCase(),
      'QC By': inc.qcByName || '',
      'QC Date': (inc.qcAt || '').slice(0, 10),
      'QC Notes': inc.qcNotes || '',
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(rows.length ? rows : [{ 'Date Received': '', Material: '', Qty: '', Unit: '', Supplier: '', Invoice: '', 'Received By': '', 'QC Status': '', 'QC By': '', 'QC Date': '', 'QC Notes': '' }]),
      'Material Traceability'
    );
    XLSX.writeFile(wb, `material_traceability_report_${fileLabel()}.xlsx`);
  };

  const exportTraceabilityPDF = () => {
    const rows = filteredTraceability.slice().sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1))
      .map(inc => [
        (inc.receivedAt || '').slice(0, 10),
        inc.materialName,
        `${Number(inc.qty).toFixed(2)} ${inc.unit}`,
        inc.supplier || '—',
        inc.invoiceNo || '—',
        inc.receivedByName,
        (inc.qcStatus || 'pending').toUpperCase(),
        inc.qcByName || '—',
        inc.qcNotes || '—',
      ]);
    pdfFromTable(
      'Material Traceability Report',
      ['Date Received', 'Material', 'Qty', 'Supplier', 'Invoice', 'Received By', 'QC Status', 'QC By', 'QC Notes'],
      rows,
      'material_traceability_report'
    );
  };



  // --- Inventory report (Excel + PDF) — Total Incoming/Consumed are scoped
  // to the selected period via displayedAnalytics; Current Stock is always
  // the live shelf balance, same convention the Reports tab already uses. ---
  const exportInventoryExcel = () => {
    const rows = (displayedAnalytics?.inventoryReport || []).map((r: any) => ({
      Material: r.materialName,
      'ERP Code': materials.find(m => m.id === r.materialId)?.erpCode || '',
      'Total Incoming': Number(r.totalIncoming.toFixed(2)),
      'Total Consumed': Number(r.totalConsumed.toFixed(2)),
      'Current Stock': r.currentStock,
      Unit: r.unit,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ Material: '', 'ERP Code': '', 'Total Incoming': '', 'Total Consumed': '', 'Current Stock': '', Unit: '' }]), 'Inventory Report');
    XLSX.writeFile(wb, `inventory_report_${fileLabel()}.xlsx`);
  };

  const exportInventoryPDF = () => {
    const rows = (displayedAnalytics?.inventoryReport || []).map((r: any) => [
      r.materialName,
      materials.find(m => m.id === r.materialId)?.erpCode || '—',
      r.totalIncoming.toFixed(2),
      r.totalConsumed.toFixed(2),
      `${r.currentStock} ${r.unit}`,
    ]);
    pdfFromTable('Inventory Report', ['Material', 'ERP Code', 'Total Incoming', 'Total Consumed', 'Current Stock'], rows, 'inventory_report');
  };

  // --- Floor Stock report (Excel + PDF) — filteredFloorStock already scopes
  // rows to the selected period by last-movement date (see its useMemo). ---
  const floorLabel = (f: FloorStock) => SUPERVISOR_SECTIONS.find(s => s.id === f.sectionId)?.name || SECTION_DEFINITIONS.find(s => s.id === f.sectionId)?.name || f.sectionName || f.sectionId;
  const sortedFloorForExport = () => filteredFloorStock.slice().sort((a, b) => floorLabel(a).localeCompare(floorLabel(b)) || a.materialName.localeCompare(b.materialName));

  const exportFloorExcel = () => {
    const rows = sortedFloorForExport().map(f => ({
      Section: floorLabel(f),
      Material: f.materialName,
      'On Floor': f.qty,
      Unit: f.unit,
      'Last Movement': f.updatedAt ? new Date(f.updatedAt).toLocaleString() : '',
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ Section: '', Material: '', 'On Floor': '', Unit: '', 'Last Movement': '' }]), 'Floor Stock');
    XLSX.writeFile(wb, `floor_stock_report_${fileLabel()}.xlsx`);
  };

  const exportFloorPDF = () => {
    const rows = sortedFloorForExport().map(f => [floorLabel(f), f.materialName, `${f.qty} ${f.unit}`, f.updatedAt ? new Date(f.updatedAt).toLocaleString() : '—']);
    pdfFromTable('Floor Stock Report', ['Section', 'Material', 'On Floor', 'Last Movement'], rows, 'floor_stock_report');
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
    if (action === 'approve') {
      // Same gap that consumption had: approving used to just subtract from
      // currentStock with no check, so Store could go negative if someone
      // approved more than what's actually on the shelf. This doesn't block
      // it outright (a store keeper may need to approve anyway and true up
      // stock later), but it does warn before doing something irreversible.
      const group = requests.filter(r => ids.includes(r.id));
      const shortfalls = group
        .map(r => {
          const mat = materials.find(m => m.id === r.materialId);
          const short = mat ? Number(mat.currentStock || 0) - Number(r.qtyRequested) : null;
          return short !== null && short < 0 ? { name: r.materialName, short: -short, unit: r.unit } : null;
        })
        .filter(Boolean) as { name: string; short: number; unit: string }[];
      if (shortfalls.length > 0) {
        const msg = shortfalls.map(s => `${s.name}: short by ${s.short} ${s.unit}`).join('\n');
        if (!window.confirm(`This will take Store stock negative for:\n\n${msg}\n\nApprove anyway?`)) return;
      }
    }
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

  const qcPill = (status?: string) => {
    const map: Record<string, string> = {
      pending: 'bg-amber-950/40 text-amber-400 border-amber-800',
      passed: 'bg-emerald-950/40 text-emerald-400 border-emerald-800',
      failed: 'bg-rose-950/40 text-rose-400 border-rose-800',
      hold: 'bg-slate-800 text-slate-300 border-slate-600',
    };
    const s = status || 'pending';
    const label: Record<string, string> = { pending: 'Pending QC', passed: 'Passed', failed: 'Rejected', hold: 'On Hold' };
    return <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase border ${map[s] || map.pending}`}>{label[s] || s}</span>;
  };

  const sectionLabel = (id?: string | null) => {
    if (!id) return '—';
    return SECTION_DEFINITIONS.find(s => s.id === id)?.name || id;
  };

  const GROUP_LABELS: Record<'mep' | 'civil' | 'other', string> = { mep: 'MEP Materials', civil: 'Civil Materials', other: 'Other Materials' };
  const GROUP_BADGE: Record<'mep' | 'civil' | 'other', string> = {
    mep: 'bg-sky-950/40 text-sky-400 border-sky-800',
    civil: 'bg-amber-950/40 text-amber-400 border-amber-800',
    other: 'bg-slate-800 text-slate-400 border-slate-700',
  };
  const materialGroup = (m: Material): 'mep' | 'civil' | 'other' => (m.inventoryGroup as any) || 'other';
  const setMaterialGroup = async (m: Material, group: 'mep' | 'civil' | 'other') => {
    await dbSaveMaterial({ ...m, inventoryGroup: group } as any);
    loadAll(true);
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

      {(tab === 'incoming' || tab === 'reports' || tab === 'inventory' || tab === 'floor' || tab === 'traceability') && (
        <div className="mb-4 flex flex-wrap items-center gap-2 bg-slate-900 border border-slate-800 rounded-xl p-3">
          <Clock className="h-3.5 w-3.5 text-slate-500" />
          <span className="text-xs font-bold uppercase text-slate-400">Period:</span>
          {(['today', 'week', 'month', 'custom'] as const).map(p => (
            <button
              key={p}
              onClick={() => applyQuickPeriod(p)}
              data-testid={`period-${p}`}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer border transition-all ${quickPeriod === p ? 'bg-orange-600 border-orange-600 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'}`}
            >
              {p === 'today' ? 'Daily' : p === 'week' ? 'Weekly' : p === 'month' ? 'Monthly' : 'Custom'}
            </button>
          ))}
          <input type="date" data-testid="date-filter-from" value={fromDate} onChange={e => { setFromDate(e.target.value); setQuickPeriod('custom'); }} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white" />
          <span className="text-slate-500 text-xs">to</span>
          <input type="date" data-testid="date-filter-to" value={toDate} onChange={e => { setToDate(e.target.value); setQuickPeriod('custom'); }} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white" />
          {(fromDate || toDate) && (
            <button onClick={() => { setFromDate(''); setToDate(''); setQuickPeriod('custom'); }} className="text-xs text-orange-400 hover:text-orange-300 cursor-pointer font-semibold">Clear</button>
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
        <button onClick={() => setTab('quality')} data-testid="tab-quality" className={`relative flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold cursor-pointer transition-all ${tab === 'quality' ? 'bg-orange-600 text-white shadow-md' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'}`}>
          <ShieldCheck className="h-4 w-4" /> Quality Status
          {pendingQcCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 bg-amber-500 text-slate-950 text-[10px] font-black rounded-full h-4 min-w-[16px] px-1 flex items-center justify-center">{pendingQcCount}</span>
          )}
        </button>
        <button onClick={() => setTab('traceability')} data-testid="tab-traceability" className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold cursor-pointer transition-all ${tab === 'traceability' ? 'bg-orange-600 text-white shadow-md' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'}`}>
          <Search className="h-4 w-4" /> Material Traceability
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
            <select value={newMaterial.inventoryGroup} onChange={e => setNewMaterial((p: any) => ({ ...p, inventoryGroup: e.target.value }))} data-testid="new-mat-group" className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white">
              <option value="mep">MEP Material</option>
              <option value="civil">Civil Material</option>
              <option value="other">Other Material</option>
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

          {/* Inventory portal switch: MEP / Civil / Other run as separate views */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {(['all', 'mep', 'civil', 'other'] as const).map(g => {
              const count = g === 'all' ? materials.length : materials.filter(m => materialGroup(m) === g).length;
              return (
                <button
                  key={g}
                  onClick={() => setInvGroupTab(g)}
                  data-testid={`inv-group-${g}`}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer border transition-all ${invGroupTab === g ? 'bg-orange-600 border-orange-600 text-white' : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'}`}
                >
                  {g === 'all' ? 'All Materials' : GROUP_LABELS[g]} <span className="opacity-70">({count})</span>
                </button>
              );
            })}
          </div>

          {/* Inventory report export — Total Incoming/Consumed follow the period bar above; Current Stock is always the live shelf balance */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 mb-4 flex flex-wrap items-center gap-2">
            <div className="text-xs font-bold uppercase text-slate-400 mr-1 flex items-center gap-1.5"><FileDown className="h-3.5 w-3.5" /> Export Inventory Report:</div>
            <button onClick={exportInventoryExcel} data-testid="export-inventory-excel" className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold cursor-pointer">
              <Download className="h-3.5 w-3.5" /> Excel
            </button>
            <button onClick={exportInventoryPDF} data-testid="export-inventory-pdf" className="flex items-center gap-1.5 px-3 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold cursor-pointer">
              <FileText className="h-3.5 w-3.5" /> PDF
            </button>
          </div>

          {/* Inventory table with incoming + consumed columns */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto overflow-y-auto max-h-[70vh]">
            <table className="w-full min-w-[700px] text-xs">
              <thead>
                <tr className="sticky top-0 z-10 bg-slate-800 text-slate-400 uppercase text-[10px]">
                  <th className="px-2 py-2" title="Key material"></th>
                  <th className="text-left px-4 py-2">ERP Code</th>
                  <th className="text-left px-4 py-2">Material</th>
                  <th className="text-left px-4 py-2">Portal</th>
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
                  .filter(m => invGroupTab === 'all' ? true : materialGroup(m) === invGroupTab)
                  .map(m => {
                    const inv = analytics?.inventoryReport?.find((r: any) => r.materialId === m.id);
                    const grp = materialGroup(m);
                    return (
                      <tr key={m.id} className="border-t border-slate-800">
                        <td className="px-2 py-2 text-center">
                          <button onClick={() => toggleCritical(m)} title={isMaterialCritical(m) ? 'Marked as Key Material — click to unmark' : 'Click to mark as Key Material'} className="cursor-pointer">
                            <Star className={`h-3.5 w-3.5 ${isMaterialCritical(m) ? 'text-amber-400 fill-amber-400' : 'text-slate-600'}`} />
                          </button>
                        </td>
                        <td className="px-4 py-2 text-slate-400 font-mono">{(m as any).erpCode || '—'}</td>
                        <td className="px-4 py-2 text-slate-200 font-semibold">{m.name}</td>
                        <td className="px-4 py-2">
                          <select value={grp} onChange={e => setMaterialGroup(m, e.target.value as any)} data-testid={`mat-group-${m.id}`} className={`px-1.5 py-0.5 rounded-full text-[10px] font-black uppercase border cursor-pointer bg-transparent ${GROUP_BADGE[grp]}`}>
                            <option className="bg-slate-900" value="mep">MEP</option>
                            <option className="bg-slate-900" value="civil">Civil</option>
                            <option className="bg-slate-900" value="other">Other</option>
                          </select>
                        </td>
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
            {filteredMaterials.filter(m => invGroupTab === 'all' ? true : materialGroup(m) === invGroupTab).length === 0 && (
              <div className="text-center text-slate-500 text-sm py-10">
                {inventorySearch ? `No materials match "${inventorySearch}".` : `No ${invGroupTab === 'all' ? '' : GROUP_LABELS[invGroupTab] + ' '}materials found. Add materials above or upload Excel.`}
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
            <button onClick={saveIncoming} data-testid="new-incoming-save" className="flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold cursor-pointer"><Plus className="h-3.5 w-3.5" /> Send to Quality</button>
          </div>
          <div className="mb-4 text-[11px] text-slate-500 flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-amber-400" /> New receipts go to <span className="text-amber-400 font-bold">Quality Check</span> first and only join Inventory stock once an inspector passes them.
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 mb-4 flex flex-wrap items-center gap-2">
            <div className="text-xs font-bold uppercase text-slate-400 mr-1 flex items-center gap-1.5"><FileDown className="h-3.5 w-3.5" /> Export:</div>
            <button onClick={exportIncomingExcel} data-testid="export-incoming-excel" className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold cursor-pointer">
              <Download className="h-3.5 w-3.5" /> Excel
            </button>
            <button onClick={exportIncomingPDF} data-testid="export-incoming-pdf" className="flex items-center gap-1.5 px-3 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold cursor-pointer">
              <FileText className="h-3.5 w-3.5" /> PDF
            </button>
            <div className="text-[10px] text-slate-500 ml-1">Uses the period set above (or all-time if none selected).</div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto overflow-y-auto max-h-[70vh]">
            <div className="px-4 py-2 border-b border-slate-800 text-xs font-bold uppercase text-slate-400">Recent GRN (Goods Received)</div>
            <table className="w-full min-w-[700px] text-xs">
              <thead>
                <tr className="sticky top-0 z-10 bg-slate-900 text-slate-400 uppercase text-[10px]">
                  <th className="text-left px-4 py-2">Date</th>
                  <th className="text-left px-4 py-2">Material</th>
                  <th className="text-right px-4 py-2">Qty</th>
                  <th className="text-left px-4 py-2">Supplier</th>
                  <th className="text-left px-4 py-2">Invoice</th>
                  <th className="text-left px-4 py-2">Received By</th>
                  <th className="text-left px-4 py-2">QC Status</th>
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
                    <td className="px-4 py-2">{qcPill(inc.qcStatus)}</td>
                    <td className="px-4 py-2 text-right"><button onClick={async () => { if (confirm(inc.qcStatus === 'passed' ? 'Delete this GRN and reverse stock?' : 'Delete this GRN record?')) { await dbDeleteIncomingMaterial(inc.id); loadAll(true); } }} className="text-slate-500 hover:text-rose-400 cursor-pointer"><Trash2 className="h-3.5 w-3.5" /></button></td>
                  </tr>
                ))}
                {incoming.length === 0 && <tr><td colSpan={8} className="text-center text-slate-500 py-10">No incoming materials logged yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---------- QUALITY STATUS TAB (read-only — decisions are made in the Quality Inspector portal) ---------- */}
      {tab === 'quality' && (
        <div className="space-y-6">
          <div className="bg-indigo-950/30 border border-indigo-800/60 rounded-xl px-4 py-3 flex items-start gap-2.5">
            <ShieldCheck className="h-4 w-4 text-indigo-400 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-indigo-200">
              Pass/Hold/Reject decisions for incoming material are made by the <strong>Quality Inspector</strong> from the Quality Control portal, not from Store. This tab is a read-only status view of every GRN awaiting or already through inspection.
            </p>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
            <div className="px-4 py-2 border-b border-slate-800 text-xs font-bold uppercase text-slate-400 flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-amber-400" /> Awaiting Inspection ({incoming.filter(i => (i.qcStatus || 'pending') === 'pending').length})
            </div>
            <table className="w-full min-w-[820px] text-xs">
              <thead>
                <tr className="sticky top-0 z-10 bg-slate-900 text-slate-400 uppercase text-[10px]">
                  <th className="text-left px-4 py-2">Received</th>
                  <th className="text-left px-4 py-2">Material</th>
                  <th className="text-right px-4 py-2">Qty</th>
                  <th className="text-left px-4 py-2">Supplier</th>
                  <th className="text-left px-4 py-2">Invoice</th>
                  <th className="text-left px-4 py-2">Received By</th>
                  <th className="text-left px-4 py-2">QC Status</th>
                </tr>
              </thead>
              <tbody>
                {incoming.filter(i => (i.qcStatus || 'pending') === 'pending')
                  .slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
                  .map(inc => (
                    <tr key={inc.id} className="border-t border-slate-800">
                      <td className="px-4 py-2 text-slate-500 font-mono">{new Date(inc.receivedAt).toLocaleDateString()}</td>
                      <td className="px-4 py-2 text-slate-200 font-semibold">{inc.materialName}</td>
                      <td className="px-4 py-2 text-right text-slate-300 font-mono">{Number(inc.qty)} {inc.unit}</td>
                      <td className="px-4 py-2 text-slate-400">{inc.supplier || '—'}</td>
                      <td className="px-4 py-2 text-slate-400">{inc.invoiceNo || '—'}</td>
                      <td className="px-4 py-2 text-slate-500">{inc.receivedByName}</td>
                      <td className="px-4 py-2">{qcPill(inc.qcStatus)}</td>
                    </tr>
                  ))}
                {incoming.filter(i => (i.qcStatus || 'pending') === 'pending').length === 0 && (
                  <tr><td colSpan={7} className="text-center text-slate-500 py-10">Nothing waiting on inspection.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
            <div className="px-4 py-2 border-b border-slate-800 text-xs font-bold uppercase text-slate-400 flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" /> On Hold / Rejected
            </div>
            <table className="w-full min-w-[820px] text-xs">
              <thead>
                <tr className="sticky top-0 z-10 bg-slate-900 text-slate-400 uppercase text-[10px]">
                  <th className="text-left px-4 py-2">Received</th>
                  <th className="text-left px-4 py-2">Material</th>
                  <th className="text-right px-4 py-2">Qty</th>
                  <th className="text-left px-4 py-2">Supplier</th>
                  <th className="text-left px-4 py-2">Status</th>
                  <th className="text-left px-4 py-2">Inspector</th>
                  <th className="text-left px-4 py-2">Notes</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {incoming.filter(i => i.qcStatus === 'failed' || i.qcStatus === 'hold')
                  .slice().sort((a, b) => ((a.qcAt || '') < (b.qcAt || '') ? 1 : -1))
                  .map(inc => (
                    <tr key={inc.id} className="border-t border-slate-800">
                      <td className="px-4 py-2 text-slate-500 font-mono">{new Date(inc.receivedAt).toLocaleDateString()}</td>
                      <td className="px-4 py-2 text-slate-200 font-semibold">{inc.materialName}</td>
                      <td className="px-4 py-2 text-right text-slate-300 font-mono">{Number(inc.qty)} {inc.unit}</td>
                      <td className="px-4 py-2 text-slate-400">{inc.supplier || '—'}</td>
                      <td className="px-4 py-2">{qcPill(inc.qcStatus)}</td>
                      <td className="px-4 py-2 text-slate-500">{inc.qcByName || '—'}</td>
                      <td className="px-4 py-2 text-slate-400">{inc.qcNotes || '—'}</td>
                      <td className="px-4 py-2 text-right">
                        <button onClick={async () => { if (confirm('Remove this record permanently? (Rejected/held stock never entered inventory, so this is safe.)')) { await dbDeleteIncomingMaterial(inc.id); loadAll(true); } }} className="text-slate-500 hover:text-rose-400 cursor-pointer"><Trash2 className="h-3.5 w-3.5" /></button>
                      </td>
                    </tr>
                  ))}
                {incoming.filter(i => i.qcStatus === 'failed' || i.qcStatus === 'hold').length === 0 && (
                  <tr><td colSpan={8} className="text-center text-slate-500 py-10">No held or rejected batches.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---------- MATERIAL TRACEABILITY TAB (combined receiving + QC log) ---------- */}
      {tab === 'traceability' && (
        <div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 mb-4 flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="h-3.5 w-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                placeholder="Search by material, supplier, invoice, or inspector…"
                value={traceSearch}
                onChange={e => setTraceSearch(e.target.value)}
                data-testid="traceability-search"
                className="bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-xs text-white w-full"
              />
            </div>
            <button onClick={exportTraceabilityExcel} data-testid="export-traceability-excel" className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold cursor-pointer">
              <Download className="h-3.5 w-3.5" /> Excel
            </button>
            <button onClick={exportTraceabilityPDF} data-testid="export-traceability-pdf" className="flex items-center gap-1.5 px-3 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold cursor-pointer">
              <FileText className="h-3.5 w-3.5" /> PDF
            </button>
          </div>
          <div className="mb-4 text-[11px] text-slate-500">
            One combined record of every GRN — what was received, when, by whom — and its full inspection history: who decided, when, and why. Uses the period set above (or all-time if none selected).
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto overflow-y-auto max-h-[70vh]">
            <div className="px-4 py-2 border-b border-slate-800 text-xs font-bold uppercase text-slate-400">
              Material Traceability ({filteredTraceability.length})
            </div>
            <table className="w-full min-w-[1000px] text-xs">
              <thead>
                <tr className="sticky top-0 z-10 bg-slate-900 text-slate-400 uppercase text-[10px]">
                  <th className="text-left px-4 py-2">Date Received</th>
                  <th className="text-left px-4 py-2">Material</th>
                  <th className="text-right px-4 py-2">Qty</th>
                  <th className="text-left px-4 py-2">Supplier</th>
                  <th className="text-left px-4 py-2">Invoice</th>
                  <th className="text-left px-4 py-2">Received By</th>
                  <th className="text-left px-4 py-2">QC Status</th>
                  <th className="text-left px-4 py-2">QC By</th>
                  <th className="text-left px-4 py-2">QC Date</th>
                  <th className="text-left px-4 py-2">QC Notes</th>
                </tr>
              </thead>
              <tbody>
                {filteredTraceability.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map(inc => (
                  <tr key={inc.id} className="border-t border-slate-800">
                    <td className="px-4 py-2 text-slate-500 font-mono">{new Date(inc.receivedAt).toLocaleDateString()}</td>
                    <td className="px-4 py-2 text-slate-200 font-semibold">{inc.materialName}</td>
                    <td className="px-4 py-2 text-right text-slate-300 font-mono">{Number(inc.qty)} {inc.unit}</td>
                    <td className="px-4 py-2 text-slate-400">{inc.supplier || '—'}</td>
                    <td className="px-4 py-2 text-slate-400">{inc.invoiceNo || '—'}</td>
                    <td className="px-4 py-2 text-slate-500">{inc.receivedByName}</td>
                    <td className="px-4 py-2">{qcPill(inc.qcStatus)}</td>
                    <td className="px-4 py-2 text-slate-500">{inc.qcByName || '—'}</td>
                    <td className="px-4 py-2 text-slate-500 font-mono">{inc.qcAt ? new Date(inc.qcAt).toLocaleDateString() : '—'}</td>
                    <td className="px-4 py-2 text-slate-400">{inc.qcNotes || '—'}</td>
                  </tr>
                ))}
                {filteredTraceability.length === 0 && (
                  <tr><td colSpan={10} className="text-center text-slate-500 py-10">No records match this search / period.</td></tr>
                )}
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
              // Buttons/prints must only ever touch the lines that are
              // actually still in that state — never "every id in the
              // group" — otherwise re-approving a mixed batch would also
              // resubmit lines the manager already rejected (harmless
              // since the backend re-guards on status !== PENDING, but
              // printing must never include rejected lines).
              const pendingIds = group.pending.map(it => it.id);
              return (
                <div key={group.key} className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      {/* Show every status actually present in this batch —
                          never collapse a mixed batch down to one pill. */}
                      {group.pending.length > 0 && statusPill('PENDING')}
                      {group.approved.length > 0 && <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-950/40 text-emerald-400 border border-emerald-800">{group.approved.length} Approved</span>}
                      {group.rejected.length > 0 && <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-rose-950/40 text-rose-400 border border-rose-800">{group.rejected.length} Rejected</span>}
                      {group.printed.length > 0 && <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">{group.printed.length} Printed</span>}
                      <span className="text-xs text-slate-500 font-mono">{new Date(first.createdAt).toLocaleString()}</span>
                      {group.items.length > 1 && <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-indigo-950/40 text-indigo-400 border border-indigo-800">{group.items.length} items</span>}
                    </div>
                    <div className="text-xs text-slate-400 mb-1.5">
                      {first.projectName} / {first.poolType}{first.poolNo ? ` / Pool ${first.poolNo}` : ''} · requested by {first.requestedByName} ({first.requestedByRole})
                    </div>
                    {/* Line items — every material in this request, whether it's 1 or 40.
                        Each chip shows its OWN decision so mixed batches are never ambiguous. */}
                    <div className="flex flex-wrap gap-1.5 mb-1">
                      {group.items.map(it => {
                        const lineColor = it.status === 'APPROVED' ? 'border-emerald-800 text-emerald-300'
                          : it.status === 'REJECTED' ? 'border-rose-800 text-rose-300 line-through opacity-70'
                          : it.status === 'PRINTED' ? 'border-slate-700 text-slate-400'
                          : 'border-slate-700 text-slate-200';
                        return (
                          <span key={it.id} className={`px-2 py-1 rounded-lg bg-slate-800 border text-xs ${lineColor}`} title={it.status}>
                            {it.materialName}: <span className="font-mono font-bold">{Number(it.qtyRequested)}</span> {it.unit}
                          </span>
                        );
                      })}
                    </div>
                    {first.reason && <div className="text-xs text-slate-500 italic mt-0.5">&ldquo;{first.reason}&rdquo;</div>}
                    {group.items.some(it => it.decidedByName) && (
                      <div className="text-[11px] text-slate-500 mt-1">
                        {group.items.filter(it => it.decidedByName).map(it => `${it.materialName}: decided by ${it.decidedByName}${it.decisionNotes ? ` — ${it.decisionNotes}` : ''}`).join(' · ')}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {group.pending.length > 0 && (
                      <>
                        <input
                          type="text"
                          placeholder="Note (optional)"
                          value={decisionNotes[group.key] || ''}
                          onChange={e => setDecisionNotes(prev => ({ ...prev, [group.key]: e.target.value }))}
                          className="hidden md:block w-36 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white"
                        />
                        <button onClick={() => decideGroup(pendingIds, 'approve', group.key)} data-testid={`req-approve-${group.key}`} className="flex items-center gap-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold cursor-pointer">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Approve{pendingIds.length > 1 ? ` (${pendingIds.length})` : ''}
                        </button>
                        <button onClick={() => decideGroup(pendingIds, 'reject', group.key)} data-testid={`req-reject-${group.key}`} className="flex items-center gap-1 px-3 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold cursor-pointer">
                          <XCircle className="h-3.5 w-3.5" /> Reject{pendingIds.length > 1 ? ` (${pendingIds.length})` : ''}
                        </button>
                      </>
                    )}
                    {group.approved.length > 0 && (
                      <button onClick={() => setPrintBatch(group.approved)} className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold cursor-pointer animate-pulse">
                        <Printer className="h-3.5 w-3.5" /> Print Issue Slip{group.approved.length > 1 ? ` (${group.approved.length})` : ''}
                      </button>
                    )}
                    {group.pending.length === 0 && group.approved.length === 0 && group.printed.length > 0 && (
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
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 mb-4 flex flex-wrap items-center gap-2">
          <div className="text-xs font-bold uppercase text-slate-400 mr-1 flex items-center gap-1.5"><FileDown className="h-3.5 w-3.5" /> Export Floor Stock Report:</div>
          <button onClick={exportFloorExcel} data-testid="export-floor-excel" className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold cursor-pointer">
            <Download className="h-3.5 w-3.5" /> Excel
          </button>
          <button onClick={exportFloorPDF} data-testid="export-floor-pdf" className="flex items-center gap-1.5 px-3 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold cursor-pointer">
            <FileText className="h-3.5 w-3.5" /> PDF
          </button>
          <div className="text-[10px] text-slate-500 ml-1">Filtered to the period above by last movement date (or all current floor stock if none selected).</div>
        </div>
      )}

      {tab === 'floor' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto overflow-y-auto max-h-[70vh]">
          <div className="px-4 py-3 border-b border-slate-800 flex flex-wrap items-center gap-2">
            <Boxes className="h-4 w-4 text-orange-400" />
            <div className="text-sm font-bold text-white">Material Currently on the Floor</div>
            <div className="text-xs text-slate-500">Issued out of Store on approval, not yet consumed</div>
            <div className="ml-auto relative">
              <Search className="h-3.5 w-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search material or section…"
                value={floorSearch}
                onChange={e => setFloorSearch(e.target.value)}
                data-testid="floor-search"
                className="bg-slate-800 border border-slate-700 rounded-lg pl-8 pr-2 py-1.5 text-xs text-white w-64"
              />
            </div>
          </div>
          <table className="w-full min-w-[700px] text-xs">
            <thead>
              <tr className="sticky top-0 z-10 bg-slate-800 text-slate-400 uppercase text-[10px]">
                <th className="text-left px-4 py-2">Section</th>
                <th className="text-left px-4 py-2">Material</th>
                <th className="text-right px-4 py-2">On Floor</th>
                <th className="text-left px-4 py-2">Last Movement</th>
              </tr>
            </thead>
            <tbody>
              {filteredFloorStock
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
              {filteredFloorStock.length === 0 && (
                <tr><td colSpan={4} className="text-center text-slate-500 py-10">
                  {floorSearch ? `No floor stock matches "${floorSearch}".` : 'Nothing issued to the floor yet. Approve a request to move material out of the Store.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'floor' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto overflow-y-auto max-h-[50vh] mt-4">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-amber-400" />
            <div className="text-sm font-bold text-white">Returns to Store</div>
            <div className="text-xs text-slate-500">Unused floor stock sent back — Store's stock and this section's floor balance were both updated</div>
          </div>
          <table className="w-full min-w-[700px] text-xs">
            <thead>
              <tr className="sticky top-0 z-10 bg-slate-800 text-slate-400 uppercase text-[10px]">
                <th className="text-left px-4 py-2">Date</th>
                <th className="text-left px-4 py-2">Section</th>
                <th className="text-left px-4 py-2">Material</th>
                <th className="text-right px-4 py-2">Qty Returned</th>
                <th className="text-left px-4 py-2">Returned By</th>
                <th className="text-left px-4 py-2">Reason</th>
              </tr>
            </thead>
            <tbody>
              {materialReturns
                .slice()
                .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
                .slice(0, 200)
                .map(ret => (
                  <tr key={ret.id} className="border-t border-slate-800">
                    <td className="px-4 py-2 text-slate-400 font-mono">{ret.date}</td>
                    <td className="px-4 py-2 text-slate-300">{ret.sectionName || ret.sectionId}</td>
                    <td className="px-4 py-2 text-slate-200 font-semibold">{ret.materialName}</td>
                    <td className="px-4 py-2 text-right text-emerald-400 font-mono">+{Number(ret.qty).toFixed(2)} {ret.unit}</td>
                    <td className="px-4 py-2 text-slate-400">{ret.returnedByName}</td>
                    <td className="px-4 py-2 text-slate-500">{ret.reason || '—'}</td>
                  </tr>
                ))}
              {materialReturns.length === 0 && (
                <tr><td colSpan={6} className="text-center text-slate-500 py-8">No returns logged yet.</td></tr>
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
        <div>
          {/* Same MEP / Civil / Other portal split as Inventory */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {(['all', 'mep', 'civil', 'other'] as const).map(g => (
              <button
                key={g}
                onClick={() => setReportsGroupTab(g)}
                data-testid={`reports-group-${g}`}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer border transition-all ${reportsGroupTab === g ? 'bg-orange-600 border-orange-600 text-white' : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'}`}
              >
                {g === 'all' ? 'All Materials' : GROUP_LABELS[g]}
              </button>
            ))}
          </div>
          <ConsumptionReports
            analytics={displayedAnalytics}
            logs={reportsGroupTab === 'all' ? searchedConsumptionLogs : searchedConsumptionLogs.filter(c => materialGroup(materials.find(m => m.id === c.materialId) || ({} as Material)) === reportsGroupTab)}
            logSearch={logSearch}
            onLogSearch={setLogSearch}
            onExportDaily={exportDailyReport}
            onExportDailyPDF={exportDailyReportPDF}
            onExportMonthly={exportMonthlyReport}
            onExportMonthlyPDF={exportMonthlyReportPDF}
            stockLedger={reportsGroupTab === 'all' ? stockLedger : stockLedger.filter(r => materialGroup(materials.find(m => m.id === r.materialId) || ({} as Material)) === reportsGroupTab)}
          />
        </div>
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

const ConsumptionReports: React.FC<{
  analytics: any;
  logs: ConsumptionLog[];
  logSearch: string;
  onLogSearch: (v: string) => void;
  onExportDaily: () => void;
  onExportDailyPDF: () => void;
  onExportMonthly: () => void;
  onExportMonthlyPDF: () => void;
  stockLedger: { materialId: string; materialName: string; unit: string; previous: number; issued: number; incoming: number; consumed: number; balance: number }[];
}> = ({ analytics, logs, logSearch, onLogSearch, onExportDaily, onExportDailyPDF, onExportMonthly, onExportMonthlyPDF, stockLedger }) => {
  const { inventoryReport = [], perProject = {}, perPoolType = [] } = analytics || {};

  // Daily consumption chart: sum qty per calendar date, computed directly
  // from the raw consumption log rows (each row already has a `date` field).
  // NOTE: this used to try to read a nested date→section→material shape out
  // of dailyBySection, but that field is actually a flat sectionId→qty map
  // (see dbFetchConsumptionAnalytics), so the chart was silently always
  // empty. Building it straight from `logs` avoids depending on that shape.
  const dailyTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of logs) {
      const d = (row.date || '').slice(0, 10);
      if (!d) continue;
      map.set(d, (map.get(d) || 0) + Number(row.qty || 0));
    }
    return Array.from(map.entries()).map(([date, qty]) => ({ date, qty })).sort((a, b) => (a.date < b.date ? -1 : 1));
  }, [logs]);

  return (
    <div className="space-y-6" data-testid="consumption-reports">
      {/* Report export toolbar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex flex-wrap items-center gap-2">
        <div className="text-xs font-bold uppercase text-slate-400 mr-1 flex items-center gap-1.5"><FileDown className="h-3.5 w-3.5" /> Export:</div>
        <button onClick={onExportDaily} data-testid="export-daily-report" className="flex items-center gap-1.5 px-3 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-xs font-bold cursor-pointer">
          <Download className="h-3.5 w-3.5" /> Daily Report (Excel)
        </button>
        <button onClick={onExportDailyPDF} data-testid="export-daily-report-pdf" className="flex items-center gap-1.5 px-3 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold cursor-pointer">
          <FileText className="h-3.5 w-3.5" /> Daily Report (PDF)
        </button>
        <button onClick={onExportMonthly} data-testid="export-monthly-report" className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-bold cursor-pointer">
          <Download className="h-3.5 w-3.5" /> Monthly Report (Excel)
        </button>
        <button onClick={onExportMonthlyPDF} data-testid="export-monthly-report-pdf" className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-bold cursor-pointer">
          <FileText className="h-3.5 w-3.5" /> Monthly Report (PDF)
        </button>
        <div className="text-[10px] text-slate-500 ml-1">Uses the period set above (or all-time if none selected).</div>
      </div>

      {/* Raw consumption log — one row per entry logged by a supervisor */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto overflow-y-auto max-h-[70vh]">
        <div className="px-4 py-3 border-b border-slate-800 flex flex-wrap items-center gap-2">
          <ListChecks className="h-4 w-4 text-orange-400" />
          <div className="text-sm font-bold text-white">Consumption Log</div>
          <div className="text-xs text-slate-500">Every consumption entry, most recent first</div>
          <div className="ml-auto relative">
            <Search className="h-3.5 w-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search material, section, logged by…"
              value={logSearch}
              onChange={e => onLogSearch(e.target.value)}
              data-testid="consumption-log-search"
              className="bg-slate-800 border border-slate-700 rounded-lg pl-8 pr-2 py-1.5 text-xs text-white w-72"
            />
          </div>
        </div>
        <table className="w-full min-w-[800px] text-xs">
          <thead>
            <tr className="sticky top-0 z-10 bg-slate-800 text-slate-400 uppercase text-[10px]">
              <th className="text-left px-4 py-2">Date</th>
              <th className="text-left px-4 py-2">Section</th>
              <th className="text-left px-4 py-2">Material</th>
              <th className="text-right px-4 py-2">Qty</th>
              <th className="text-left px-4 py-2">Logged By</th>
              <th className="text-left px-4 py-2">Notes</th>
            </tr>
          </thead>
          <tbody>
            {logs.slice(0, 500).map(c => (
              <tr key={c.id} className="border-t border-slate-800">
                <td className="px-4 py-2 text-slate-400 font-mono">{c.date}</td>
                <td className="px-4 py-2 text-slate-300">{c.sectionName || c.sectionId}</td>
                <td className="px-4 py-2 text-slate-200 font-semibold">{c.materialName}</td>
                <td className="px-4 py-2 text-right text-rose-400 font-mono">−{Number(c.qty).toFixed(2)} {c.unit}</td>
                <td className="px-4 py-2 text-slate-400">{c.loggedByName}</td>
                <td className="px-4 py-2 text-slate-500">{c.notes || '—'}</td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr><td colSpan={6} className="text-center text-slate-500 py-8">
                {logSearch ? `No consumption entries match "${logSearch}".` : 'No consumption logged for this date range yet.'}
              </td></tr>
            )}
          </tbody>
        </table>
        {logs.length > 500 && (
          <div className="px-4 py-2 text-[10px] text-slate-500 border-t border-slate-800">Showing first 500 of {logs.length} matching entries — narrow the date range or search to see more precisely.</div>
        )}
      </div>

      {/* Store-level stock ledger */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto overflow-y-auto max-h-[70vh]">
        <div className="px-4 py-3 border-b border-slate-800 flex flex-wrap items-center gap-2">
          <BarChart3 className="h-4 w-4 text-orange-400" />
          <div className="text-sm font-bold text-white">Stock Ledger</div>
          <div className="text-xs text-slate-500">Previous stock → issued to floor → consumed → balance, for the date range above</div>
        </div>
        <table className="w-full min-w-[760px] text-xs">
          <thead>
            <tr className="sticky top-0 z-10 bg-slate-800 text-slate-400 uppercase text-[10px]">
              <th className="text-left px-4 py-2">Material</th>
              <th className="text-right px-4 py-2">Previous Stock</th>
              <th className="text-right px-4 py-2">Issued to Floor</th>
              <th className="text-right px-4 py-2">Consumed</th>
              <th className="text-right px-4 py-2">Balance Stock</th>
            </tr>
          </thead>
          <tbody>
            {stockLedger
              .filter(r => !logSearch.trim() || r.materialName.toLowerCase().includes(logSearch.trim().toLowerCase()))
              .filter(r => r.previous !== 0 || r.issued !== 0 || r.consumed !== 0 || r.balance !== 0)
              .sort((a, b) => a.materialName.localeCompare(b.materialName))
              .map(r => (
                <tr key={r.materialId} className="border-t border-slate-800">
                  <td className="px-4 py-2 text-slate-200 font-semibold">{r.materialName}</td>
                  <td className="px-4 py-2 text-right text-slate-300 font-mono">{r.previous.toFixed(2)} {r.unit}</td>
                  <td className="px-4 py-2 text-right text-sky-400 font-mono">{r.issued ? `+${r.issued.toFixed(2)}` : '0'} {r.unit}</td>
                  <td className="px-4 py-2 text-right text-rose-400 font-mono">{r.consumed ? `−${r.consumed.toFixed(2)}` : '0'} {r.unit}</td>
                  <td className="px-4 py-2 text-right text-white font-mono font-bold">{r.balance.toFixed(2)} {r.unit}</td>
                </tr>
              ))}
            {stockLedger.filter(r => r.previous !== 0 || r.issued !== 0 || r.consumed !== 0 || r.balance !== 0).length === 0 && (
              <tr><td colSpan={5} className="text-center text-slate-500 py-8">No stock movement for this period.</td></tr>
            )}
          </tbody>
        </table>
        <div className="px-4 py-2 text-[10px] text-slate-500 border-t border-slate-800">
          "Consumed" is what supervisors logged off the floor — it doesn't change Balance Stock, since material leaves Store the moment it's issued, not the moment it's used. Check the Floor Stock tab for what's still sitting unused per section.
        </div>
      </div>

      {/* Overall inventory summary */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto overflow-y-auto max-h-[70vh]">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
          <Package className="h-4 w-4 text-orange-400" />
          <div className="text-sm font-bold text-white">Inventory Overview (current + incoming + consumption)</div>
        </div>
        <table className="w-full min-w-[700px] text-xs">
          <thead>
            <tr className="sticky top-0 z-10 bg-slate-800 text-slate-400 uppercase text-[10px]">
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
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto overflow-y-auto max-h-[70vh]">
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
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto overflow-y-auto max-h-[70vh]">
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
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto overflow-y-auto max-h-[70vh]">
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
                  <tr className="sticky top-0 z-10 bg-slate-900 text-slate-400 uppercase text-[10px]">
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
