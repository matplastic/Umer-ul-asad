import React, { useEffect, useState, useCallback } from 'react';
import {
  Boxes, Package, ClipboardCheck, Printer, Plus, Trash2, CheckCircle2, XCircle,
  RefreshCw, AlertTriangle, X, Clock, ListChecks,
} from 'lucide-react';
import {
  dbFetchMaterials, dbSaveMaterial, dbDeleteMaterial, dbAdjustMaterialStock,
  dbFetchBomItems, dbSaveBomItem, dbDeleteBomItem,
  dbFetchMaterialRequests, dbDecideMaterialRequest, dbMarkMaterialRequestPrinted,
} from '../lib/firebaseService';
import { Material, BOMItem, MaterialRequest } from '../types';

type Tab = 'requests' | 'bom' | 'inventory';

interface StoreModuleProps {
  currentUserName: string;
  projectNames: string[]; // distinct project names, e.g. from existing pools/plannedPools
  poolTypesByProject: Record<string, string[]>; // project -> distinct pool types seen in planning
}

const emptyMaterial = { name: '', category: '', unit: 'kg', currentStock: 0, reorderLevel: 0, notes: '' };
const emptyBom = { projectName: '', poolType: '', materialId: '', qtyPerPool: '' };

export const StoreModule: React.FC<StoreModuleProps> = ({ currentUserName, projectNames, poolTypesByProject }) => {
  const [tab, setTab] = useState<Tab>('requests');
  const [materials, setMaterials] = useState<Material[]>([]);
  const [bom, setBom] = useState<BOMItem[]>([]);
  const [requests, setRequests] = useState<MaterialRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [printRequest, setPrintRequest] = useState<MaterialRequest | null>(null);

  // Form state
  const [newMaterial, setNewMaterial] = useState<any>(emptyMaterial);
  const [newBom, setNewBom] = useState<any>(emptyBom);
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});

  const loadAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [m, b, r] = await Promise.all([
        dbFetchMaterials(),
        dbFetchBomItems(),
        dbFetchMaterialRequests(),
      ]);
      setMaterials(Array.isArray(m) ? m : []);
      setBom(Array.isArray(b) ? b : []);
      setRequests(Array.isArray(r) ? r.map((x: any) => ({ ...x, qtyRequested: Number(x.qtyRequested) })) : []);
      setError(null);
    } catch (e: any) {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
    // Poll so approvals coming in from the manager's email link (which may happen
    // minutes later, from their phone) show up here without a manual refresh —
    // this is what drives the "pending print" queue.
    const interval = setInterval(() => loadAll(true), 15000);
    return () => clearInterval(interval);
  }, [loadAll]);

  const pendingPrintCount = requests.filter(r => r.status === 'APPROVED').length;
  const pendingApprovalCount = requests.filter(r => r.status === 'PENDING').length;

  // --- Materials ---
  const saveMaterial = async () => {
    if (!newMaterial.name || !newMaterial.unit) return;
    const item = { ...newMaterial, id: `mat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date().toISOString() };
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

  // --- Requests ---
  const decide = async (id: string, action: 'approve' | 'reject') => {
    await dbDecideMaterialRequest(id, action, currentUserName, decisionNotes[id] || undefined);
    loadAll(true);
  };

  const markPrinted = async (id: string) => {
    await dbMarkMaterialRequestPrinted(id);
    setPrintRequest(null);
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

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-orange-600/20 border border-orange-700/40 flex items-center justify-center">
            <Boxes className="h-5 w-5 text-orange-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Store &amp; BOM Portal</h1>
            <p className="text-xs text-slate-400">Raw material inventory, bill of materials, and issue approvals</p>
          </div>
        </div>
        <button onClick={() => loadAll()} className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium cursor-pointer">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 bg-rose-950/30 border border-rose-800 text-rose-300 text-sm px-4 py-3 rounded-lg">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 mb-6">
        <button onClick={() => setTab('requests')} className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold cursor-pointer transition-all ${tab === 'requests' ? 'bg-orange-600 text-white shadow-md' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'}`}>
          <ClipboardCheck className="h-4 w-4" /> Requests
          {pendingApprovalCount > 0 && <span className="ml-1 bg-amber-500 text-slate-950 rounded-full px-1.5 text-[10px]">{pendingApprovalCount}</span>}
          {pendingPrintCount > 0 && <span className="ml-1 bg-emerald-500 text-slate-950 rounded-full px-1.5 text-[10px]" title="Approved, awaiting print">{pendingPrintCount} to print</span>}
        </button>
        <button onClick={() => setTab('bom')} className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold cursor-pointer transition-all ${tab === 'bom' ? 'bg-orange-600 text-white shadow-md' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'}`}>
          <ListChecks className="h-4 w-4" /> Bill of Materials
        </button>
        <button onClick={() => setTab('inventory')} className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold cursor-pointer transition-all ${tab === 'inventory' ? 'bg-orange-600 text-white shadow-md' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'}`}>
          <Package className="h-4 w-4" /> Inventory
        </button>
      </div>

      {/* ---------- REQUESTS TAB ---------- */}
      {tab === 'requests' && (
        <div className="space-y-3">
          {requests.length === 0 && !loading && (
            <div className="text-center text-slate-500 text-sm py-16 border border-dashed border-slate-800 rounded-xl">No material requests yet.</div>
          )}
          {requests
            .slice()
            .sort((a, b) => (a.status === 'PENDING' ? -1 : 1) - (b.status === 'PENDING' ? -1 : 1))
            .map(r => (
              <div key={r.id} className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    {statusPill(r.status)}
                    <span className="text-xs text-slate-500 font-mono">{new Date(r.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="text-sm font-bold text-white">{r.materialName} — {r.qtyRequested} {r.unit}</div>
                  <div className="text-xs text-slate-400">
                    {r.projectName} / {r.poolType}{r.poolNo ? ` / Pool ${r.poolNo}` : ''} · requested by {r.requestedByName} ({r.requestedByRole})
                  </div>
                  {r.reason && <div className="text-xs text-slate-500 italic mt-0.5">"{r.reason}"</div>}
                  {r.decidedByName && (
                    <div className="text-[11px] text-slate-500 mt-1">Decided by {r.decidedByName}{r.decisionNotes ? ` — ${r.decisionNotes}` : ''}</div>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {r.status === 'PENDING' && (
                    <>
                      <input
                        type="text"
                        placeholder="Note (optional)"
                        value={decisionNotes[r.id] || ''}
                        onChange={e => setDecisionNotes(prev => ({ ...prev, [r.id]: e.target.value }))}
                        className="hidden md:block w-36 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white"
                      />
                      <button onClick={() => decide(r.id, 'approve')} className="flex items-center gap-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold cursor-pointer">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                      </button>
                      <button onClick={() => decide(r.id, 'reject')} className="flex items-center gap-1 px-3 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold cursor-pointer">
                        <XCircle className="h-3.5 w-3.5" /> Reject
                      </button>
                    </>
                  )}
                  {r.status === 'APPROVED' && (
                    <button onClick={() => setPrintRequest(r)} className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold cursor-pointer animate-pulse">
                      <Printer className="h-3.5 w-3.5" /> Print Issue Slip
                    </button>
                  )}
                  {r.status === 'PRINTED' && (
                    <span className="flex items-center gap-1 text-xs text-slate-500"><Clock className="h-3.5 w-3.5" /> Printed {r.printedAt ? new Date(r.printedAt).toLocaleTimeString() : ''}</span>
                  )}
                </div>
              </div>
            ))}
        </div>
      )}

      {/* ---------- BOM TAB ---------- */}
      {tab === 'bom' && (
        <div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-5 grid grid-cols-1 md:grid-cols-5 gap-2">
            <select value={newBom.projectName} onChange={e => setNewBom((p: any) => ({ ...p, projectName: e.target.value, poolType: '' }))} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white">
              <option value="">Project…</option>
              {projectNames.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <select value={newBom.poolType} onChange={e => setNewBom((p: any) => ({ ...p, poolType: e.target.value }))} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white" disabled={!newBom.projectName}>
              <option value="">Pool Type…</option>
              {(poolTypesByProject[newBom.projectName] || []).map(t => <option key={t} value={t}>{t}</option>)}
              {/* Allow a type not yet in production data (e.g. planning ahead) */}
              <option value="__custom__">Other (type manually)…</option>
            </select>
            {newBom.poolType === '__custom__' && (
              <input placeholder="Pool type name" onChange={e => setNewBom((p: any) => ({ ...p, poolType: e.target.value }))} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white" />
            )}
            <select value={newBom.materialId} onChange={e => setNewBom((p: any) => ({ ...p, materialId: e.target.value }))} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white">
              <option value="">Material…</option>
              {materials.map(m => <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}
            </select>
            <input type="number" step="any" placeholder="Qty per pool" value={newBom.qtyPerPool} onChange={e => setNewBom((p: any) => ({ ...p, qtyPerPool: e.target.value }))} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white" />
            <button onClick={saveBomItem} className="flex items-center justify-center gap-1.5 px-3 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-xs font-bold cursor-pointer"><Plus className="h-3.5 w-3.5" /> Add to BOM</button>
          </div>

          {projectNames.map(proj => {
            const rows = bom.filter(b => b.projectName === proj);
            if (rows.length === 0) return null;
            const types = Array.from(new Set(rows.map(r => r.poolType)));
            return (
              <div key={proj} className="mb-6">
                <h3 className="text-sm font-bold text-white mb-2">{proj}</h3>
                {types.map(type => (
                  <div key={type} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden mb-3">
                    <div className="bg-slate-850 bg-slate-800/60 px-4 py-2 text-xs font-bold text-orange-400 uppercase">{type}</div>
                    <table className="w-full text-xs">
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

      {/* ---------- INVENTORY TAB ---------- */}
      {tab === 'inventory' && (
        <div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-5 grid grid-cols-1 md:grid-cols-6 gap-2">
            <input placeholder="Material name" value={newMaterial.name} onChange={e => setNewMaterial((p: any) => ({ ...p, name: e.target.value }))} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white md:col-span-2" />
            <input placeholder="Category" value={newMaterial.category} onChange={e => setNewMaterial((p: any) => ({ ...p, category: e.target.value }))} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white" />
            <input placeholder="Unit (kg/ltr/pcs)" value={newMaterial.unit} onChange={e => setNewMaterial((p: any) => ({ ...p, unit: e.target.value }))} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white" />
            <input type="number" placeholder="Opening stock" value={newMaterial.currentStock} onChange={e => setNewMaterial((p: any) => ({ ...p, currentStock: Number(e.target.value) }))} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white" />
            <button onClick={saveMaterial} className="flex items-center justify-center gap-1.5 px-3 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-xs font-bold cursor-pointer"><Plus className="h-3.5 w-3.5" /> Add Material</button>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-850 bg-slate-800/60 text-slate-400 uppercase text-[10px]">
                  <th className="text-left px-4 py-2">Material</th>
                  <th className="text-left px-4 py-2">Category</th>
                  <th className="text-right px-4 py-2">Stock</th>
                  <th className="text-right px-4 py-2">Reorder At</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {materials.map(m => (
                  <tr key={m.id} className="border-t border-slate-800">
                    <td className="px-4 py-2 text-slate-200 font-semibold">{m.name}</td>
                    <td className="px-4 py-2 text-slate-400">{m.category || '—'}</td>
                    <td className={`px-4 py-2 text-right font-mono ${(m.reorderLevel || 0) > 0 && m.currentStock <= (m.reorderLevel || 0) ? 'text-rose-400 font-bold' : 'text-slate-200'}`}>
                      {m.currentStock} {m.unit}
                    </td>
                    <td className="px-4 py-2 text-right text-slate-500">{m.reorderLevel || 0}</td>
                    <td className="px-4 py-2 text-right flex items-center justify-end gap-2">
                      <button onClick={() => adjustStock(m.id)} className="text-slate-500 hover:text-emerald-400 cursor-pointer text-[11px] font-bold">Adjust</button>
                      <button onClick={() => deleteMaterial(m.id)} className="text-slate-500 hover:text-rose-400 cursor-pointer"><Trash2 className="h-3.5 w-3.5" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {materials.length === 0 && <div className="text-center text-slate-500 text-sm py-10">No materials yet. Add your raw materials above.</div>}
          </div>
        </div>
      )}

      {/* ---------- PRINT SLIP MODAL ---------- */}
      {printRequest && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <style dangerouslySetInnerHTML={{ __html: `
            @media print {
              body * { visibility: hidden !important; }
              #printable-slip, #printable-slip * { visibility: visible !important; }
              #printable-slip { position: absolute !important; left: 0; top: 0; width: 100%; background: white !important; color: black !important; padding: 1.5cm !important; }
              .no-print { display: none !important; }
            }
          `}} />
          <div className="bg-slate-900 border border-slate-700 p-5 rounded-2xl max-w-lg w-full shadow-2xl">
            <div className="no-print flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
              <span className="text-xs font-bold uppercase text-slate-400">Material Issue Slip</span>
              <div className="flex gap-2">
                <button onClick={() => setTimeout(() => window.print(), 50)} className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer">
                  <Printer className="h-3.5 w-3.5" /> Print
                </button>
                <button onClick={() => markPrinted(printRequest.id)} className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold cursor-pointer">Mark Printed</button>
                <button onClick={() => setPrintRequest(null)} className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded-lg cursor-pointer"><X className="h-4 w-4" /></button>
              </div>
            </div>
            <div id="printable-slip" className="bg-white text-slate-900 p-6 rounded-lg">
              <h2 className="text-lg font-bold mb-1">MAT Plastic Industries LLC — Store Issue Slip</h2>
              <p className="text-xs text-slate-500 mb-4">Slip #{printRequest.id.slice(-8).toUpperCase()} · {new Date().toLocaleString()}</p>
              <table className="w-full text-sm mb-4">
                <tbody>
                  <tr><td className="py-1 text-slate-500 w-40">Project</td><td className="py-1 font-semibold">{printRequest.projectName}</td></tr>
                  <tr><td className="py-1 text-slate-500">Pool Type</td><td className="py-1 font-semibold">{printRequest.poolType}</td></tr>
                  {printRequest.poolNo && <tr><td className="py-1 text-slate-500">Pool No.</td><td className="py-1 font-semibold">{printRequest.poolNo}</td></tr>}
                  <tr><td className="py-1 text-slate-500">Material</td><td className="py-1 font-semibold">{printRequest.materialName}</td></tr>
                  <tr><td className="py-1 text-slate-500">Quantity Issued</td><td className="py-1 font-semibold">{printRequest.qtyRequested} {printRequest.unit}</td></tr>
                  <tr><td className="py-1 text-slate-500">Requested By</td><td className="py-1">{printRequest.requestedByName} ({printRequest.requestedByRole})</td></tr>
                  <tr><td className="py-1 text-slate-500">Approved By</td><td className="py-1">{printRequest.decidedByName || '—'}</td></tr>
                </tbody>
              </table>
              <div className="grid grid-cols-2 gap-6 mt-10 text-xs">
                <div className="border-t border-slate-400 pt-1">Store Keeper Signature</div>
                <div className="border-t border-slate-400 pt-1">Received By Signature</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StoreModule;
