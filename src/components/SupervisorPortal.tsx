import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  HardHat, PackagePlus, Send, CheckCircle2, XCircle, Clock, Factory, ClipboardList,
  RefreshCw, AlertTriangle, Filter, Plus, Trash2, TrendingUp, Boxes,
} from 'lucide-react';
import {
  dbFetchMaterials, dbFetchBomItems, dbSubmitMaterialRequestBatch, dbFetchMaterialRequests,
  dbFetchConsumptionLogs, dbCreateConsumptionLog, dbDeleteConsumptionLog,
  dbFetchProductionLogs, dbCreateProductionLog, dbDeleteProductionLog,
  dbFetchFloorStock, dbCreateMaterialReturn,
} from '../lib/firebaseService';
import {
  Material, BOMItem, MaterialRequest, ConsumptionLog, ProductionLog, FloorStock,
  SECTION_DEFINITIONS, SUPERVISOR_SECTIONS,
} from '../types';

interface SupervisorPortalProps {
  currentUserName: string;
  projectNames: string[];
  poolTypesByProject: Record<string, string[]>;
}

type Tab = 'consumption' | 'production' | 'request' | 'history';

const todayStr = () => new Date().toISOString().slice(0, 10);

export const SupervisorPortal: React.FC<SupervisorPortalProps> = ({ currentUserName, projectNames, poolTypesByProject }) => {
  const [section, setSection] = useState<string>(SUPERVISOR_SECTIONS[0].id);
  const [tab, setTab] = useState<Tab>('consumption');
  const [materials, setMaterials] = useState<Material[]>([]);
  const [bom, setBom] = useState<BOMItem[]>([]);
  const [requests, setRequests] = useState<MaterialRequest[]>([]);
  const [consumption, setConsumption] = useState<ConsumptionLog[]>([]);
  const [production, setProduction] = useState<ProductionLog[]>([]);
  const [floorStock, setFloorStock] = useState<FloorStock[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  // Consumption form
  const [cDate, setCDate] = useState(todayStr());
  const [cMaterialId, setCMaterialId] = useState('');
  const [cQty, setCQty] = useState('');
  const [cNotes, setCNotes] = useState('');
  // Return-to-Store form — sends unused floor stock back, undoing exactly
  // what an approval did (Floor down, Store's currentStock up).
  const [showReturnForm, setShowReturnForm] = useState(false);
  const [retMaterialId, setRetMaterialId] = useState('');
  const [retQty, setRetQty] = useState('');
  const [retReason, setRetReason] = useState('');

  // Production form
  const [pDate, setPDate] = useState(todayStr());
  const [pStage, setPStage] = useState<string>(SECTION_DEFINITIONS[0].id as string);
  const [pProject, setPProject] = useState('');
  const [pPoolType, setPPoolType] = useState('');
  const [pPoolNo, setPPoolNo] = useState('');
  const [pQty, setPQty] = useState('1');

  // Request form — Project/Pool Type is picked once for the whole cart.
  // Each line (material + qty) gets added to `rCart` before sending, so a
  // supervisor can request 10, 40, however many materials in one go instead
  // of one request at a time.
  const [rProject, setRProject] = useState('');
  const [rPoolType, setRPoolType] = useState('');
  const [rMaterialId, setRMaterialId] = useState('');
  const [rQty, setRQty] = useState('');
  const [rReason, setRReason] = useState('');
  const [rCart, setRCart] = useState<Array<{ materialId: string; materialName: string; unit: string; qty: string }>>([]);
  // Search box for picking a material to request — searches the FULL
  // inventory (every section, not just this one) by name, ERP code,
  // supplier, brand, storage location, HS code, or category.
  const [rSearch, setRSearch] = useState('');
  // Same MEP / Civil / Other portal split as Store — narrows which
  // materials show up in the request search.
  const [rGroup, setRGroup] = useState<'mep' | 'civil' | 'other' | 'all'>('all');
  const materialGroup = (m: Material): 'mep' | 'civil' | 'other' => ((m as any).inventoryGroup) || 'other';
  const [rDropdownOpen, setRDropdownOpen] = useState(false);

  const loadAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [m, b, r, c, p, fs] = await Promise.all([
        dbFetchMaterials(),
        dbFetchBomItems(),
        dbFetchMaterialRequests(),
        dbFetchConsumptionLogs(),
        dbFetchProductionLogs(),
        dbFetchFloorStock(),
      ]);
      setMaterials(Array.isArray(m) ? m : []);
      setBom(Array.isArray(b) ? b : []);
      setRequests(Array.isArray(r) ? r : []);
      setConsumption(Array.isArray(c) ? c : []);
      setProduction(Array.isArray(p) ? p : []);
      setFloorStock(Array.isArray(fs) ? fs : []);
      setError(null);
    } catch (e: any) {
      setError('Could not reach the server. Check your connection.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); const t = setInterval(() => loadAll(true), 20000); return () => clearInterval(t); }, [loadAll]);

  const sectionName = SUPERVISOR_SECTIONS.find(s => s.id === section)?.name || section;
  // Materials for this section (both explicit `section` match and unassigned show up)
  const sectionMaterials = useMemo(() => {
    const list = materials.filter(m => !m.section || m.section === section);
    // Prioritize section-tagged first
    return list.sort((a, b) => {
      const aTag = a.section === section ? 0 : 1;
      const bTag = b.section === section ? 0 : 1;
      return aTag - bTag || a.name.localeCompare(b.name);
    });
  }, [materials, section]);

  // Material picker for the Request tab. Two things this fixes:
  //  1. Searches the FULL inventory across every section (not just this
  //     one) — the search box matches name, ERP code, supplier, brand,
  //     storage location, HS code, or category, so any of those terms finds
  //     the item.
  //  2. Only lists materials that actually have stock right now (>0), so
  //     supervisors can't even pick something that isn't available to
  //     request in the first place — no more scrolling past dozens of
  //     zero-stock lines to find something requestable.
  const requestSearchResults = useMemo(() => {
    const q = rSearch.trim().toLowerCase();
    const available = materials.filter(m => Number(m.currentStock || 0) > 0 && (rGroup === 'all' || materialGroup(m) === rGroup));
    const matches = !q ? available : available.filter(m => {
      const haystack = [m.name, m.erpCode, m.supplierName, m.brand, m.location, m.hsCode, m.category]
        .filter(Boolean).join(' | ').toLowerCase();
      return haystack.includes(q);
    });
    return matches
      .sort((a, b) => {
        const aTag = a.section === section ? 0 : 1;
        const bTag = b.section === section ? 0 : 1;
        return aTag - bTag || a.name.localeCompare(b.name);
      })
      .slice(0, 50);
  }, [materials, rSearch, section, rGroup]);

  // How much of each material has actually been issued to THIS section and
  // is sitting on the floor, not yet consumed. This is what a supervisor can
  // really consume from — not the Store's total stock.
  const sectionFloorStock = useMemo(() => {
    const map: Record<string, number> = {};
    for (const f of floorStock) {
      if (f.sectionId === section) map[f.materialId] = Number(f.qty || 0);
    }
    return map;
  }, [floorStock, section]);

  const myConsumption = useMemo(() => consumption
    .filter(c => c.sectionId === section)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [consumption, section]);

  const myProduction = useMemo(() => production
    .filter(p => p.sectionId === pStage)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [production, pStage]);

  // Group requests belonging to this section into "batches" — everything
  // sent together from one cart shares a batchId, so it shows as ONE row
  // here instead of one row per material. Legacy requests sent before
  // batching existed have no batchId, so they fall back to grouping by their
  // own id (a "batch of one").
  const myRequestBatches = useMemo(() => {
    const mine = requests.filter(r => (r.stageId || '') === section);
    const map = new Map<string, MaterialRequest[]>();
    for (const r of mine) {
      const key = r.batchId || r.id;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return Array.from(map.entries())
      .map(([key, items]) => ({ key, items, createdAt: items[0].createdAt, status: items[0].status }))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, 20);
  }, [requests, section]);

  // Compute planned vs actual for TODAY in this section
  const todayComparison = useMemo(() => {
    const day = todayStr();
    const todayProd = myProduction.filter(p => p.date === day);
    const todayCons = myConsumption.filter(c => c.date === day);

    // planned = sum over todayProd of pool.qty * bom.qtyPerPool for matching project+poolType
    const planned: Record<string, { qty: number; unit: string; materialName: string }> = {};
    for (const p of todayProd) {
      const lines = bom.filter(b => b.projectName === p.projectName && b.poolType === p.poolType);
      for (const l of lines) {
        planned[l.materialId] = planned[l.materialId] || { qty: 0, unit: l.unit, materialName: l.materialName };
        planned[l.materialId].qty += Number(l.qtyPerPool || 0) * Number(p.quantity || 1);
      }
    }
    const actual: Record<string, { qty: number; unit: string; materialName: string }> = {};
    for (const c of todayCons) {
      actual[c.materialId] = actual[c.materialId] || { qty: 0, unit: c.unit, materialName: c.materialName };
      actual[c.materialId].qty += Number(c.qty || 0);
    }
    const keys = Array.from(new Set([...Object.keys(planned), ...Object.keys(actual)]));
    return keys.map(k => ({
      materialId: k,
      materialName: (planned[k]?.materialName || actual[k]?.materialName || k),
      unit: planned[k]?.unit || actual[k]?.unit || '',
      planned: planned[k]?.qty || 0,
      actual: actual[k]?.qty || 0,
    })).sort((a, b) => a.materialName.localeCompare(b.materialName));
  }, [bom, myProduction, myConsumption]);

  const submitConsumption = async () => {
    if (!cMaterialId || !cQty) { setFlash('Select a material and quantity'); return; }
    const mat = materials.find(m => m.id === cMaterialId);
    if (!mat) return;
    // Check Floor Stock BEFORE logging — you can only consume what Store has
    // actually issued to this section. If nothing (or not enough) is on the
    // floor, block the submission with a clear error instead of logging it
    // anyway; the write itself is also guarded server-side against this.
    const available = sectionFloorStock[cMaterialId] || 0;
    if (Number(cQty) > available) {
      setFlash(available <= 0
        ? `No ${mat.name} on the floor for ${sectionName} — Store hasn't issued any yet. Ask Store to approve/issue it first.`
        : `Only ${available} ${mat.unit} of ${mat.name} is on the floor for ${sectionName} — you can't log more than that.`);
      setTimeout(() => setFlash(null), 6000);
      return;
    }
    try {
      await dbCreateConsumptionLog({
        date: cDate,
        sectionId: section,
        sectionName,
        materialId: mat.id,
        materialName: mat.name,
        unit: mat.unit,
        qty: Number(cQty),
        notes: cNotes || null,
        loggedByName: currentUserName,
      });
      setCMaterialId(''); setCQty(''); setCNotes('');
      setFlash('Consumption logged. Floor stock updated.');
      setTimeout(() => setFlash(null), 2500);
      loadAll(true);
    } catch (e: any) {
      setFlash(e?.message || 'Could not log consumption — floor stock may have changed. Refresh and try again.');
      setTimeout(() => setFlash(null), 6000);
    }
  };

  const submitReturn = async () => {
    if (!retMaterialId || !retQty) { setFlash('Select a material and quantity to return'); return; }
    const mat = materials.find(m => m.id === retMaterialId);
    if (!mat) return;
    const available = sectionFloorStock[retMaterialId] || 0;
    if (Number(retQty) > available) {
      setFlash(`Only ${available} ${mat.unit} of ${mat.name} is on the floor for ${sectionName} — you can't return more than that.`);
      setTimeout(() => setFlash(null), 6000);
      return;
    }
    try {
      await dbCreateMaterialReturn({
        date: todayStr(),
        sectionId: section,
        sectionName,
        materialId: mat.id,
        materialName: mat.name,
        unit: mat.unit,
        qty: Number(retQty),
        reason: retReason || null,
        returnedByName: currentUserName,
      });
      setRetMaterialId(''); setRetQty(''); setRetReason(''); setShowReturnForm(false);
      setFlash('Returned to Store. Floor stock and Store stock both updated.');
      setTimeout(() => setFlash(null), 3000);
      loadAll(true);
    } catch (e: any) {
      setFlash(e?.message || 'Could not process the return — floor stock may have changed. Refresh and try again.');
      setTimeout(() => setFlash(null), 6000);
    }
  };

  const submitProduction = async () => {
    if (!pProject || !pPoolType || !pQty) { setFlash('Fill project, pool type and quantity'); return; }
    const stageName = SECTION_DEFINITIONS.find(s => s.id === pStage)?.name || pStage;
    await dbCreateProductionLog({
      date: pDate,
      sectionId: pStage,
      sectionName: stageName,
      projectName: pProject,
      poolType: pPoolType,
      poolNo: pPoolNo || null,
      poolId: null,
      quantity: Number(pQty),
      loggedByName: currentUserName,
      notes: null,
    });
    setPPoolNo(''); setPQty('1');
    setFlash('Production logged.');
    setTimeout(() => setFlash(null), 2500);
    loadAll(true);
  };

  // Adds the currently-selected material+qty as one line in the cart. The
  // Project/Pool Type stay selected so the next line can be added right away.
  //
  // INVENTORY GUARD: a supervisor can only request a material that actually
  // exists in the Store's inventory, and only up to the quantity the Store
  // currently has in stock (minus whatever is already sitting in this cart
  // for the same material, since that hasn't been deducted yet). This
  // closes the gap where a material with 0 (or insufficient) stock could
  // still be requested and would only surface as a problem after a manager
  // approved it.
  const addToCart = () => {
    if (!rProject || !rPoolType) { setFlash('Pick a project and pool type first'); return; }
    if (!rMaterialId || !rQty) { setFlash('Select a material and quantity'); return; }
    const mat = materials.find(m => m.id === rMaterialId);
    if (!mat) { setFlash('That material is not in the inventory list.'); return; }

    const stock = Number(mat.currentStock || 0);
    if (stock <= 0) {
      setFlash(`${mat.name} is not available in inventory (0 ${mat.unit} in stock). Ask Store to add stock before requesting it.`);
      setTimeout(() => setFlash(null), 5000);
      return;
    }

    const alreadyInCart = rCart.find(l => l.materialId === mat.id);
    const requestedTotal = Number(alreadyInCart?.qty || 0) + Number(rQty);
    if (requestedTotal > stock) {
      const remaining = stock - Number(alreadyInCart?.qty || 0);
      setFlash(`Only ${stock} ${mat.unit} of ${mat.name} in stock${alreadyInCart ? ` (you already added ${alreadyInCart.qty} to this cart — ${Math.max(remaining, 0)} left to add)` : ''}. Reduce the quantity.`);
      setTimeout(() => setFlash(null), 6000);
      return;
    }

    setRCart(prev => {
      // If this material's already in the cart, bump its qty instead of a duplicate line.
      const idx = prev.findIndex(l => l.materialId === mat.id);
      if (idx !== -1) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: String(Number(next[idx].qty || 0) + Number(rQty)) };
        return next;
      }
      return [...prev, { materialId: mat.id, materialName: mat.name, unit: mat.unit, qty: rQty }];
    });
    setRMaterialId(''); setRQty(''); setRSearch('');
  };

  const removeFromCart = (materialId: string) => {
    setRCart(prev => prev.filter(l => l.materialId !== materialId));
  };

  // Sends every line in the cart together as one batch — one manager
  // email/WhatsApp with one Approve/Reject action, one issue slip at Store.
  const submitRequest = async () => {
    if (!rProject || !rPoolType) { setFlash('Pick a project and pool type'); return; }
    if (rCart.length === 0) { setFlash('Add at least one material to the cart first'); return; }
    await dbSubmitMaterialRequestBatch(rCart.map(line => ({
      projectName: rProject,
      poolType: rPoolType,
      poolId: null,
      poolNo: null,
      stageId: section as any,
      materialId: line.materialId,
      materialName: line.materialName,
      unit: line.unit,
      qtyRequested: Number(line.qty),
      reason: rReason || null,
      requestedByName: currentUserName,
      requestedByRole: `Section Supervisor - ${sectionName}`,
    })));
    setRCart([]); setRProject(''); setRPoolType(''); setRMaterialId(''); setRQty(''); setRReason(''); setRSearch('');
    setFlash('Request sent to store/manager for approval.');
    setTimeout(() => setFlash(null), 2500);
    loadAll(true);
  };

  const statusPill = (s: string) => {
    const map: Record<string, string> = {
      PENDING: 'bg-amber-950/40 text-amber-400 border-amber-800',
      APPROVED: 'bg-emerald-950/40 text-emerald-400 border-emerald-800',
      REJECTED: 'bg-rose-950/40 text-rose-400 border-rose-800',
      PRINTED: 'bg-slate-800 text-slate-400 border-slate-700',
    };
    return <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase border ${map[s] || map.PENDING}`}>{s}</span>;
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6" data-testid="supervisor-portal">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-amber-600/20 border border-amber-700/40 flex items-center justify-center">
            <HardHat className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Section Supervisor Portal</h1>
            <p className="text-xs text-slate-400">Log daily material consumption, pools produced, and request materials</p>
          </div>
        </div>
        <button
          onClick={() => loadAll()}
          data-testid="supervisor-refresh"
          className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium cursor-pointer">
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
        <div className="mb-4 flex items-center gap-2 bg-emerald-950/30 border border-emerald-800 text-emerald-300 text-sm px-4 py-3 rounded-lg" data-testid="supervisor-flash">
          <CheckCircle2 className="h-4 w-4 shrink-0" /> {flash}
        </div>
      )}

      {/* Section switcher */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-5">
        <div className="flex items-center gap-2 mb-2 text-xs font-bold uppercase text-slate-400">
          <Filter className="h-3.5 w-3.5" /> Working Section
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SUPERVISOR_SECTIONS.map(sec => (
            <button
              key={sec.id as string}
              onClick={() => setSection(sec.id as string)}
              data-testid={`section-tab-${sec.id}`}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                section === sec.id
                  ? 'bg-amber-600 text-white border-amber-500 shadow-md shadow-amber-900/40'
                  : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
              }`}
            >
              {sec.name}
            </button>
          ))}
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex flex-wrap gap-2 mb-5">
        <button onClick={() => setTab('consumption')} data-testid="tab-consumption" className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold cursor-pointer ${tab === 'consumption' ? 'bg-orange-600 text-white shadow-md' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'}`}>
          <Boxes className="h-4 w-4" /> Log Consumption
        </button>
        <button onClick={() => setTab('production')} data-testid="tab-production" className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold cursor-pointer ${tab === 'production' ? 'bg-orange-600 text-white shadow-md' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'}`}>
          <Factory className="h-4 w-4" /> Log Production
        </button>
        <button onClick={() => setTab('request')} data-testid="tab-request" className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold cursor-pointer ${tab === 'request' ? 'bg-orange-600 text-white shadow-md' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'}`}>
          <PackagePlus className="h-4 w-4" /> Request Material
        </button>
        <button onClick={() => setTab('history')} data-testid="tab-history" className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold cursor-pointer ${tab === 'history' ? 'bg-orange-600 text-white shadow-md' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'}`}>
          <ClipboardList className="h-4 w-4" /> Today vs Plan
        </button>
      </div>

      {/* CONSUMPTION TAB */}
      {tab === 'consumption' && (
        <div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-5">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] uppercase font-bold text-slate-500">Currently on the floor — {sectionName} (issued by Store, not yet consumed)</div>
              <button onClick={() => setShowReturnForm(v => !v)} data-testid="toggle-return-form" className="text-[11px] font-bold text-amber-400 hover:text-amber-300 cursor-pointer">
                {showReturnForm ? 'Cancel Return' : '↩ Return to Store'}
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.keys(sectionFloorStock).length === 0 && (
                <span className="text-xs text-slate-600">Nothing issued to this section yet — request material first.</span>
              )}
              {Object.entries(sectionFloorStock).filter(([, qty]) => qty !== 0).map(([matId, qty]) => {
                const mat = materials.find(m => m.id === matId);
                return (
                  <span key={matId} className="px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-200">
                    {mat?.name || matId}: <span className="font-mono font-bold text-emerald-400">{qty}</span> {mat?.unit || ''}
                  </span>
                );
              })}
            </div>
            {showReturnForm && (
              <div className="mt-3 pt-3 border-t border-slate-800 grid grid-cols-1 md:grid-cols-4 gap-2">
                <select value={retMaterialId} onChange={e => setRetMaterialId(e.target.value)} data-testid="return-material" className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white md:col-span-2">
                  <option value="">Material to return…</option>
                  {Object.entries(sectionFloorStock).filter(([, qty]) => Number(qty) > 0).map(([matId, qty]) => {
                    const mat = materials.find(m => m.id === matId);
                    return <option key={matId} value={matId}>{mat?.name || matId} — on floor: {qty} {mat?.unit || ''}</option>;
                  })}
                </select>
                <input type="number" step="any" placeholder="Qty to return" value={retQty} onChange={e => setRetQty(e.target.value)} data-testid="return-qty" className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white" />
                <input placeholder="Reason (optional)" value={retReason} onChange={e => setRetReason(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white" />
                <button onClick={submitReturn} data-testid="return-submit" className="md:col-span-4 flex items-center justify-center gap-1.5 px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold cursor-pointer">
                  Confirm Return to Store
                </button>
              </div>
            )}
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-5 grid grid-cols-1 md:grid-cols-6 gap-2">
            <input type="date" data-testid="cons-date" value={cDate} onChange={e => setCDate(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white" />
            <select value={cMaterialId} onChange={e => setCMaterialId(e.target.value)} data-testid="cons-material" className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white md:col-span-2">
              <option value="">Material used…</option>
              {sectionMaterials.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.unit}) — on floor: {sectionFloorStock[m.id] || 0}
                </option>
              ))}
            </select>
            <input type="number" step="any" data-testid="cons-qty" placeholder="Qty" value={cQty} onChange={e => setCQty(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white" />
            <input placeholder="Note (optional)" value={cNotes} onChange={e => setCNotes(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white" />
            <button onClick={submitConsumption} data-testid="cons-submit" className="flex items-center justify-center gap-1.5 px-3 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-xs font-bold cursor-pointer">
              <Plus className="h-3.5 w-3.5" /> Log
            </button>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto overflow-y-auto max-h-[70vh]">
            <div className="px-4 py-2 border-b border-slate-800 text-xs font-bold uppercase text-slate-400">
              My recent consumption ({sectionName})
            </div>
            <table className="w-full min-w-[700px] text-xs">
              <thead>
                <tr className="sticky top-0 z-10 bg-slate-900 text-slate-400 uppercase text-[10px]">
                  <th className="text-left px-4 py-2">Date</th>
                  <th className="text-left px-4 py-2">Material</th>
                  <th className="text-right px-4 py-2">Qty</th>
                  <th className="text-left px-4 py-2">Note</th>
                  <th className="text-left px-4 py-2">Logged by</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {myConsumption.slice(0, 30).map(c => (
                  <tr key={c.id} className="border-t border-slate-800">
                    <td className="px-4 py-2 text-slate-300 font-mono">{c.date}</td>
                    <td className="px-4 py-2 text-slate-200">{c.materialName}</td>
                    <td className="px-4 py-2 text-right text-slate-200 font-mono">{Number(c.qty)} {c.unit}</td>
                    <td className="px-4 py-2 text-slate-500">{c.notes || '—'}</td>
                    <td className="px-4 py-2 text-slate-500">{c.loggedByName}</td>
                    <td className="px-4 py-2 text-right"><button onClick={async () => { await dbDeleteConsumptionLog(c.id); loadAll(true); }} data-testid={`cons-del-${c.id}`} className="text-slate-500 hover:text-rose-400 cursor-pointer"><Trash2 className="h-3.5 w-3.5" /></button></td>
                  </tr>
                ))}
                {myConsumption.length === 0 && (
                  <tr><td colSpan={6} className="text-center text-slate-500 py-8">No consumption logged yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* PRODUCTION TAB */}
      {tab === 'production' && (
        <div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-5 grid grid-cols-1 md:grid-cols-7 gap-2">
            <input type="date" data-testid="prod-date" value={pDate} onChange={e => setPDate(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white" />
            <select value={pStage} onChange={e => setPStage(e.target.value)} data-testid="prod-stage" className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white">
              {SECTION_DEFINITIONS.map(s => <option key={s.id as string} value={s.id as string}>{s.name}</option>)}
            </select>
            <select value={pProject} onChange={e => { setPProject(e.target.value); setPPoolType(''); }} data-testid="prod-project" className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white">
              <option value="">Project…</option>
              {projectNames.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <select value={pPoolType} onChange={e => setPPoolType(e.target.value)} disabled={!pProject} data-testid="prod-pool-type" className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white">
              <option value="">Pool type…</option>
              {(poolTypesByProject[pProject] || []).map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <input placeholder="Pool No. (optional)" value={pPoolNo} onChange={e => setPPoolNo(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white" />
            <input type="number" step="1" min="1" data-testid="prod-qty" placeholder="Qty" value={pQty} onChange={e => setPQty(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white" />
            <button onClick={submitProduction} data-testid="prod-submit" className="flex items-center justify-center gap-1.5 px-3 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-xs font-bold cursor-pointer">
              <Plus className="h-3.5 w-3.5" /> Log
            </button>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto overflow-y-auto max-h-[70vh]">
            <div className="px-4 py-2 border-b border-slate-800 text-xs font-bold uppercase text-slate-400">
              My recent production ({SECTION_DEFINITIONS.find(s => s.id === pStage)?.name || pStage})
            </div>
            <table className="w-full min-w-[700px] text-xs">
              <thead>
                <tr className="sticky top-0 z-10 bg-slate-900 text-slate-400 uppercase text-[10px]">
                  <th className="text-left px-4 py-2">Date</th>
                  <th className="text-left px-4 py-2">Project</th>
                  <th className="text-left px-4 py-2">Pool Type</th>
                  <th className="text-left px-4 py-2">Pool #</th>
                  <th className="text-right px-4 py-2">Qty</th>
                  <th className="text-left px-4 py-2">By</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {myProduction.slice(0, 30).map(p => (
                  <tr key={p.id} className="border-t border-slate-800">
                    <td className="px-4 py-2 text-slate-300 font-mono">{p.date}</td>
                    <td className="px-4 py-2 text-slate-200">{p.projectName}</td>
                    <td className="px-4 py-2 text-slate-200">{p.poolType}</td>
                    <td className="px-4 py-2 text-slate-400">{p.poolNo || '—'}</td>
                    <td className="px-4 py-2 text-right text-slate-200 font-mono">{p.quantity}</td>
                    <td className="px-4 py-2 text-slate-500">{p.loggedByName}</td>
                    <td className="px-4 py-2 text-right"><button onClick={async () => { await dbDeleteProductionLog(p.id); loadAll(true); }} className="text-slate-500 hover:text-rose-400 cursor-pointer"><Trash2 className="h-3.5 w-3.5" /></button></td>
                  </tr>
                ))}
                {myProduction.length === 0 && (
                  <tr><td colSpan={7} className="text-center text-slate-500 py-8">No production logged yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* REQUEST TAB */}
      {tab === 'request' && (
        <div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-3 grid grid-cols-1 md:grid-cols-6 gap-2">
            <select value={rProject} onChange={e => { setRProject(e.target.value); setRPoolType(''); }} data-testid="req-project" className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white">
              <option value="">Project…</option>
              {projectNames.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <select value={rPoolType} onChange={e => setRPoolType(e.target.value)} disabled={!rProject} data-testid="req-pool-type" className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white">
              <option value="">Pool type…</option>
              {(poolTypesByProject[rProject] || []).map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={rGroup} onChange={e => setRGroup(e.target.value as any)} data-testid="req-material-group" className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white">
              <option value="all">All Portals</option>
              <option value="mep">MEP Materials</option>
              <option value="civil">Civil Materials</option>
              <option value="other">Other Materials</option>
            </select>
            <div className="relative md:col-span-2">
              <input
                type="text"
                data-testid="req-material-search"
                placeholder="Search material — name, ERP code, brand, supplier…"
                value={rSearch}
                onChange={e => { setRSearch(e.target.value); setRMaterialId(''); setRDropdownOpen(true); }}
                onFocus={() => setRDropdownOpen(true)}
                onBlur={() => setTimeout(() => setRDropdownOpen(false), 150)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white"
              />
              {rDropdownOpen && (
                <div className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto bg-slate-800 border border-slate-700 rounded-lg shadow-2xl">
                  {requestSearchResults.length === 0 && (
                    <div className="px-3 py-3 text-xs text-slate-500">
                      {rSearch ? `No available material matches "${rSearch}".` : 'No materials currently in stock.'}
                    </div>
                  )}
                  {requestSearchResults.map(m => (
                    <div
                      key={m.id}
                      onMouseDown={() => { setRMaterialId(m.id); setRSearch(m.name); setRDropdownOpen(false); }}
                      data-testid="req-material-option"
                      className="px-3 py-2 border-b border-slate-900 last:border-b-0 hover:bg-slate-700 cursor-pointer"
                    >
                      <div className="text-xs font-semibold text-white flex items-center justify-between gap-2">
                        <span>{m.name}</span>
                        <span className="text-emerald-400 font-mono">{m.currentStock} {m.unit}</span>
                      </div>
                      <div className="text-[10px] text-slate-500 truncate">
                        {[m.erpCode, m.brand, m.supplierName, m.location].filter(Boolean).join(' · ') || '—'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <input type="number" step="any" data-testid="req-qty" placeholder="Qty" value={rQty} onChange={e => setRQty(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white" />
            <button onClick={addToCart} data-testid="req-add-line" className="flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-xs font-bold cursor-pointer">
              <Plus className="h-3.5 w-3.5" /> Add to Cart
            </button>
          </div>

          {/* CART — every line added here goes out together as ONE request:
              one manager email/WhatsApp, one Approve/Reject action, one
              issue slip at Store — however many materials are in it. */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto mb-5" data-testid="req-cart">
            <div className="px-4 py-2 border-b border-slate-800 flex items-center justify-between">
              <span className="text-xs font-bold uppercase text-slate-400">
                Cart {rCart.length > 0 && <span className="text-orange-400">({rCart.length} item{rCart.length === 1 ? '' : 's'})</span>}
              </span>
              {rCart.length > 0 && <span className="text-[10px] text-slate-500">Sent together as one request</span>}
            </div>
            <table className="w-full min-w-[500px] text-xs">
              <tbody>
                {rCart.map(line => (
                  <tr key={line.materialId} className="border-t border-slate-800">
                    <td className="px-4 py-2 text-slate-200 font-semibold">{line.materialName}</td>
                    <td className="px-4 py-2 text-right text-slate-200 font-mono">{line.qty} {line.unit}</td>
                    <td className="px-4 py-2 text-right w-10">
                      <button onClick={() => removeFromCart(line.materialId)} className="text-slate-500 hover:text-rose-400 cursor-pointer"><Trash2 className="h-3.5 w-3.5" /></button>
                    </td>
                  </tr>
                ))}
                {rCart.length === 0 && (
                  <tr><td colSpan={3} className="text-center text-slate-500 py-6">Cart is empty — add materials above, then send them all at once.</td></tr>
                )}
              </tbody>
            </table>
            <div className="p-3 border-t border-slate-800 flex flex-col md:flex-row gap-2">
              <input placeholder="Reason (optional, applies to the whole request)" value={rReason} onChange={e => setRReason(e.target.value)} className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white" />
              <button onClick={submitRequest} data-testid="req-submit" className="flex items-center justify-center gap-1.5 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-xs font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed" disabled={rCart.length === 0}>
                <Send className="h-3.5 w-3.5" /> Send {rCart.length > 0 ? `${rCart.length} Item${rCart.length === 1 ? '' : 's'}` : 'Request'} for Approval
              </button>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto overflow-y-auto max-h-[70vh]">
            <div className="px-4 py-2 border-b border-slate-800 text-xs font-bold uppercase text-slate-400">
              My recent requests
            </div>
            <table className="w-full min-w-[700px] text-xs">
              <thead>
                <tr className="sticky top-0 z-10 bg-slate-900 text-slate-400 uppercase text-[10px]">
                  <th className="text-left px-4 py-2">Date</th>
                  <th className="text-left px-4 py-2">Project / Type</th>
                  <th className="text-left px-4 py-2">Materials</th>
                  <th className="text-left px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {myRequestBatches.map(batch => {
                  const first = batch.items[0];
                  const summary = batch.items.slice(0, 3).map(it => `${it.materialName} (${Number(it.qtyRequested)} ${it.unit})`).join(', ');
                  const more = batch.items.length > 3 ? ` +${batch.items.length - 3} more` : '';
                  return (
                    <tr key={batch.key} className="border-t border-slate-800">
                      <td className="px-4 py-2 text-slate-500 font-mono">{new Date(first.createdAt).toLocaleDateString()}</td>
                      <td className="px-4 py-2 text-slate-300">{first.projectName} / {first.poolType}</td>
                      <td className="px-4 py-2 text-slate-200">{summary}{more}</td>
                      <td className="px-4 py-2">{statusPill(batch.status)}</td>
                    </tr>
                  );
                })}
                {myRequestBatches.length === 0 && (
                  <tr><td colSpan={4} className="text-center text-slate-500 py-8">No requests yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* HISTORY / TODAY COMPARISON TAB */}
      {tab === 'history' && (
        <div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto overflow-y-auto max-h-[70vh]">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-400" />
              <div className="text-sm font-bold text-white">Today: planned vs actual</div>
              <div className="text-xs text-slate-500">{sectionName} · {todayStr()}</div>
            </div>
            <table className="w-full min-w-[700px] text-xs">
              <thead>
                <tr className="sticky top-0 z-10 bg-slate-900 text-slate-400 uppercase text-[10px]">
                  <th className="text-left px-4 py-2">Material</th>
                  <th className="text-right px-4 py-2">Planned (BOM)</th>
                  <th className="text-right px-4 py-2">Actual</th>
                  <th className="text-right px-4 py-2">Diff</th>
                </tr>
              </thead>
              <tbody>
                {todayComparison.map(r => {
                  const diff = r.actual - r.planned;
                  const cls = diff > 0 ? 'text-rose-400' : diff < 0 ? 'text-emerald-400' : 'text-slate-400';
                  const label = diff > 0 ? '+ over' : diff < 0 ? '− saved' : '=';
                  return (
                    <tr key={r.materialId} className="border-t border-slate-800">
                      <td className="px-4 py-2 text-slate-200 font-semibold">{r.materialName}</td>
                      <td className="px-4 py-2 text-right text-slate-300 font-mono">{r.planned.toFixed(2)} {r.unit}</td>
                      <td className="px-4 py-2 text-right text-slate-300 font-mono">{r.actual.toFixed(2)} {r.unit}</td>
                      <td className={`px-4 py-2 text-right font-mono font-bold ${cls}`}>{diff.toFixed(2)} {r.unit} <span className="text-[10px] ml-1 opacity-70">{label}</span></td>
                    </tr>
                  );
                })}
                {todayComparison.length === 0 && (
                  <tr><td colSpan={4} className="text-center text-slate-500 py-8">Log production + consumption today to see the comparison.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default SupervisorPortal;
