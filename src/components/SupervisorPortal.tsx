import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  HardHat, PackagePlus, Send, CheckCircle2, XCircle, Clock, Factory, ClipboardList,
  RefreshCw, AlertTriangle, Filter, Plus, Trash2, TrendingUp, Boxes,
} from 'lucide-react';
import {
  dbFetchMaterials, dbFetchBomItems, dbSubmitMaterialRequest, dbFetchMaterialRequests,
  dbFetchConsumptionLogs, dbCreateConsumptionLog, dbDeleteConsumptionLog,
  dbFetchProductionLogs, dbCreateProductionLog, dbDeleteProductionLog,
} from '../lib/firebaseService';
import {
  Material, BOMItem, MaterialRequest, ConsumptionLog, ProductionLog,
  SECTION_DEFINITIONS,
} from '../types';

interface SupervisorPortalProps {
  currentUserName: string;
  projectNames: string[];
  poolTypesByProject: Record<string, string[]>;
}

type Tab = 'consumption' | 'production' | 'request' | 'history';

// Supervisor Portal shows only these 2 broad working sections (per request).
// This is intentionally local to this file only — it does not affect the
// production-stage pipeline (Stage Shop Floor, Quality Inspector, targets,
// etc.), which still uses the full SECTION_DEFINITIONS/StageId list from types.ts.
const SUPERVISOR_SECTIONS: { id: string; name: string }[] = [
  { id: 'mep_material', name: 'MEP Material' },
  { id: 'civil_material', name: 'Civil Material' },
];

const todayStr = () => new Date().toISOString().slice(0, 10);

export const SupervisorPortal: React.FC<SupervisorPortalProps> = ({ currentUserName, projectNames, poolTypesByProject }) => {
  const [section, setSection] = useState<string>(SUPERVISOR_SECTIONS[0].id);
  const [tab, setTab] = useState<Tab>('consumption');
  const [materials, setMaterials] = useState<Material[]>([]);
  const [bom, setBom] = useState<BOMItem[]>([]);
  const [requests, setRequests] = useState<MaterialRequest[]>([]);
  const [consumption, setConsumption] = useState<ConsumptionLog[]>([]);
  const [production, setProduction] = useState<ProductionLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  // Consumption form
  const [cDate, setCDate] = useState(todayStr());
  const [cMaterialId, setCMaterialId] = useState('');
  const [cQty, setCQty] = useState('');
  const [cNotes, setCNotes] = useState('');

  // Production form
  const [pDate, setPDate] = useState(todayStr());
  const [pStage, setPStage] = useState<string>(SECTION_DEFINITIONS[0].id as string);
  const [pProject, setPProject] = useState('');
  const [pPoolType, setPPoolType] = useState('');
  const [pPoolNo, setPPoolNo] = useState('');
  const [pQty, setPQty] = useState('1');

  // Request form
  const [rProject, setRProject] = useState('');
  const [rPoolType, setRPoolType] = useState('');
  const [rMaterialId, setRMaterialId] = useState('');
  const [rQty, setRQty] = useState('');
  const [rReason, setRReason] = useState('');

  const loadAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [m, b, r, c, p] = await Promise.all([
        dbFetchMaterials(),
        dbFetchBomItems(),
        dbFetchMaterialRequests(),
        dbFetchConsumptionLogs(),
        dbFetchProductionLogs(),
      ]);
      setMaterials(Array.isArray(m) ? m : []);
      setBom(Array.isArray(b) ? b : []);
      setRequests(Array.isArray(r) ? r : []);
      setConsumption(Array.isArray(c) ? c : []);
      setProduction(Array.isArray(p) ? p : []);
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

  const myConsumption = useMemo(() => consumption
    .filter(c => c.sectionId === section)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [consumption, section]);

  const myProduction = useMemo(() => production
    .filter(p => p.sectionId === pStage)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [production, pStage]);

  const myRequests = useMemo(() => requests
    .filter(r => (r.stageId || '') === section)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 20),
    [requests, section]);

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
    setFlash('Consumption logged. Stock updated.');
    setTimeout(() => setFlash(null), 2500);
    loadAll(true);
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

  const submitRequest = async () => {
    if (!rProject || !rPoolType || !rMaterialId || !rQty) { setFlash('Fill all request fields'); return; }
    const mat = materials.find(m => m.id === rMaterialId);
    if (!mat) return;
    await dbSubmitMaterialRequest({
      projectName: rProject,
      poolType: rPoolType,
      poolId: null,
      poolNo: null,
      stageId: section as any,
      materialId: mat.id,
      materialName: mat.name,
      unit: mat.unit,
      qtyRequested: Number(rQty),
      reason: rReason || null,
      requestedByName: currentUserName,
      requestedByRole: `Section Supervisor - ${sectionName}`,
    });
    setRMaterialId(''); setRQty(''); setRReason('');
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
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-5 grid grid-cols-1 md:grid-cols-6 gap-2">
            <input type="date" data-testid="cons-date" value={cDate} onChange={e => setCDate(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white" />
            <select value={cMaterialId} onChange={e => setCMaterialId(e.target.value)} data-testid="cons-material" className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white md:col-span-2">
              <option value="">Material used…</option>
              {sectionMaterials.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.unit}) {m.section === section ? '• section' : ''} — stock: {m.currentStock}
                </option>
              ))}
            </select>
            <input type="number" step="any" data-testid="cons-qty" placeholder="Qty" value={cQty} onChange={e => setCQty(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white" />
            <input placeholder="Note (optional)" value={cNotes} onChange={e => setCNotes(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white" />
            <button onClick={submitConsumption} data-testid="cons-submit" className="flex items-center justify-center gap-1.5 px-3 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-xs font-bold cursor-pointer">
              <Plus className="h-3.5 w-3.5" /> Log
            </button>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-2 border-b border-slate-800 text-xs font-bold uppercase text-slate-400">
              My recent consumption ({sectionName})
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-400 uppercase text-[10px]">
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

          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-2 border-b border-slate-800 text-xs font-bold uppercase text-slate-400">
              My recent production ({SECTION_DEFINITIONS.find(s => s.id === pStage)?.name || pStage})
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-400 uppercase text-[10px]">
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
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-5 grid grid-cols-1 md:grid-cols-6 gap-2">
            <select value={rProject} onChange={e => { setRProject(e.target.value); setRPoolType(''); }} data-testid="req-project" className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white">
              <option value="">Project…</option>
              {projectNames.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <select value={rPoolType} onChange={e => setRPoolType(e.target.value)} disabled={!rProject} data-testid="req-pool-type" className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white">
              <option value="">Pool type…</option>
              {(poolTypesByProject[rProject] || []).map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={rMaterialId} onChange={e => setRMaterialId(e.target.value)} data-testid="req-material" className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white md:col-span-2">
              <option value="">Material…</option>
              {sectionMaterials.map(m => <option key={m.id} value={m.id}>{m.name} ({m.unit}) — stock: {m.currentStock}</option>)}
            </select>
            <input type="number" step="any" data-testid="req-qty" placeholder="Qty" value={rQty} onChange={e => setRQty(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white" />
            <input placeholder="Reason (optional)" value={rReason} onChange={e => setRReason(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white" />
            <button onClick={submitRequest} data-testid="req-submit" className="md:col-span-6 flex items-center justify-center gap-1.5 px-3 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-xs font-bold cursor-pointer">
              <Send className="h-3.5 w-3.5" /> Send Request for Approval
            </button>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-2 border-b border-slate-800 text-xs font-bold uppercase text-slate-400">
              My recent requests
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-400 uppercase text-[10px]">
                  <th className="text-left px-4 py-2">Date</th>
                  <th className="text-left px-4 py-2">Project / Type</th>
                  <th className="text-left px-4 py-2">Material</th>
                  <th className="text-right px-4 py-2">Qty</th>
                  <th className="text-left px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {myRequests.map(r => (
                  <tr key={r.id} className="border-t border-slate-800">
                    <td className="px-4 py-2 text-slate-500 font-mono">{new Date(r.createdAt).toLocaleDateString()}</td>
                    <td className="px-4 py-2 text-slate-300">{r.projectName} / {r.poolType}</td>
                    <td className="px-4 py-2 text-slate-200">{r.materialName}</td>
                    <td className="px-4 py-2 text-right text-slate-200 font-mono">{Number(r.qtyRequested)} {r.unit}</td>
                    <td className="px-4 py-2">{statusPill(r.status)}</td>
                  </tr>
                ))}
                {myRequests.length === 0 && (
                  <tr><td colSpan={5} className="text-center text-slate-500 py-8">No requests yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* HISTORY / TODAY COMPARISON TAB */}
      {tab === 'history' && (
        <div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-400" />
              <div className="text-sm font-bold text-white">Today: planned vs actual</div>
              <div className="text-xs text-slate-500">{sectionName} · {todayStr()}</div>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-400 uppercase text-[10px]">
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
