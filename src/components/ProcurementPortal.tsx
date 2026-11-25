import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  RefreshCw, Plus, Search, ClipboardList, Scale, ShoppingCart, Wallet, Building2, LayoutDashboard, Download,
  AlertTriangle, ChevronRight, Loader2, FileText, Landmark, Paperclip, ClipboardCheck, Settings, Table, ArrowRight, Clock, Inbox,
} from 'lucide-react';
import type { IncomingMaterial, Material, ProcurementSettings, PurchaseOrder, Rfq, Stf, Supplier, SupplierInvoice, SupplierPayment, TradeFinance } from '../types';
import {
  dbFetchHRPurchaseRequests, dbFetchIncomingMaterials, dbFetchMaterials, dbFetchPurchaseOrders, dbFetchRfqs,
  dbFetchSupervisorPurchaseRequests, dbFetchProcurementSettings, dbFetchStfs, dbFetchSupplierInvoices, dbFetchSupplierPayments, dbFetchSuppliers, dbFetchTradeFinances, dbLinkStfPo, dbPoAction, dbSaveRfq, dbSetPaymentClearing,
} from '../lib/firebaseService';
import {
  STAGE_META, canAutoClose, cheapestQuoteId, dateFmt, daysUntil, money, openRequisitions, poFinance, poProgress, poStage, poTotals, qtyFmt,
  quoteTotal, type PoStage,
} from '../lib/procurement';
import { PoEditor, type PoSeed } from './PoEditor';
import { PoDetailPanel } from './PoDetailPanel';
import { RfqEditor, type RfqSeed } from './RfqEditor';
import { StfEditor, type StfSeed } from './StfEditor';
import { StfPanel } from './StfPanel';
import { ConvertStfDialog } from './ConvertStfDialog';
import { ProcurementSettingsDialog } from './ProcurementSettingsDialog';
import { buildRegister } from '../lib/procurementRegister';
import { exportRegisterExcel } from '../lib/procurementExcel';
import { STF_STATUS_META, budgetTier, defaultProcurementSettings, sameName, stfTotals } from '../lib/stf';
import { TradeFinanceEditor } from './TradeFinanceEditor';
import { TradeFinancePanel } from './TradeFinancePanel';
import { TF_STATUS_META, tfPosition, tfTypeLabel } from '../lib/tradeFinance';
import { SuppliersPage } from './SuppliersPage';
import { ProgressBar, Stat, StageBadge, btn, inputCls } from './ProcurementUi';
import { useTabReset } from '../hooks/useTabReset';

// ─────────────────────────────────────────────────────────────────────────────
// PROCUREMENT PORTAL — the purchasing desk
//   Requisitions → Quotations (compare quotes) → PO → approval → Store receives against the PO
//   → supplier invoice (3-way match) → payment → closed
// ─────────────────────────────────────────────────────────────────────────────

type Tab = 'dashboard' | 'requisitions' | 'rfq' | 'stf' | 'po' | 'payments' | 'tf' | 'register' | 'suppliers';
// The sidebar follows the life of a purchase: ask → approve (STF) → order → pay. Nothing is ordered without an approved STF.
const NAV: { group: string; items: { id: Tab; label: string; icon: React.ElementType }[] }[] = [
  { group: '', items: [{ id: 'dashboard', label: 'Overview', icon: LayoutDashboard }] },
  { group: '1 · Source', items: [{ id: 'requisitions', label: 'Requisitions', icon: ClipboardList }, { id: 'rfq', label: 'Quotations', icon: Scale }] },
  { group: '2 · Approve', items: [{ id: 'stf', label: 'STF approval', icon: ClipboardCheck }] },
  { group: '3 · Order', items: [{ id: 'po', label: 'Purchase orders', icon: ShoppingCart }] },
  { group: '4 · Pay', items: [{ id: 'payments', label: 'Payments', icon: Wallet }, { id: 'tf', label: 'Trade finance', icon: Landmark }] },
  { group: 'Records', items: [{ id: 'register', label: 'Register', icon: Table }, { id: 'suppliers', label: 'Suppliers', icon: Building2 }] },
];

const norm = (s: string) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');

interface Row { po: PurchaseOrder; progress: ReturnType<typeof poProgress>; fin: ReturnType<typeof poFinance>; stage: PoStage; total: number }

interface Props { currentUserName: string; canApprove: boolean }

const ProcurementPortal: React.FC<Props> = ({ currentUserName, canApprove }) => {
  const [tab, setTab] = useState<Tab>('dashboard');
  const { select: selectTab, resetKey: tabResetKey } = useTabReset(tab, setTab);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [incoming, setIncoming] = useState<IncomingMaterial[]>([]);
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [rfqs, setRfqs] = useState<Rfq[]>([]);
  const [tfs, setTfs] = useState<TradeFinance[]>([]);
  const [stfs, setStfs] = useState<Stf[]>([]);
  const [settings, setSettings] = useState<ProcurementSettings>(() => defaultProcurementSettings());
  const [invoices, setInvoices] = useState<SupplierInvoice[]>([]);
  const [payments, setPayments] = useState<SupplierPayment[]>([]);
  const [supReqs, setSupReqs] = useState<any[]>([]);
  const [hrReqs, setHrReqs] = useState<any[]>([]);

  const [selectedPoId, setSelectedPoId] = useState<string | null>(null);
  const [poEditor, setPoEditor] = useState<{ initial?: PurchaseOrder | null; seed?: PoSeed | null } | null>(null);
  const [selectedStfId, setSelectedStfId] = useState<string | null>(null);
  const [stfEditor, setStfEditor] = useState<{ initial?: Stf | null; seed?: StfSeed | null } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [convert, setConvert] = useState<{ expected?: Stf | null } | null>(null);
  const [selectedTfId, setSelectedTfId] = useState<string | null>(null);
  const [tfEditor, setTfEditor] = useState<{ initial?: TradeFinance | null; forPoId?: string | null } | null>(null);
  const [rfqEditor, setRfqEditor] = useState<{ initial?: Rfq | null; seed?: RfqSeed | null } | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, m, inc, p, st, inv, pay, sr, hr, tf, sf, cfg] = await Promise.all([
        dbFetchSuppliers(), dbFetchMaterials(), dbFetchIncomingMaterials(), dbFetchPurchaseOrders(), dbFetchRfqs(),
        dbFetchSupplierInvoices(), dbFetchSupplierPayments(), dbFetchSupervisorPurchaseRequests(), dbFetchHRPurchaseRequests(), dbFetchTradeFinances(), dbFetchStfs(), dbFetchProcurementSettings(),
      ]);
      setSuppliers(s); setMaterials(m); setIncoming(inc); setPos(p); setRfqs(st); setInvoices(inv); setPayments(pay); setSupReqs(sr); setHrReqs(hr); setTfs(tf); setStfs(sf); setSettings(cfg);
      setLoadError(null);
    } catch (e: any) {
      setLoadError(e?.message || 'Could not load procurement data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); const t = window.setInterval(load, 60000); return () => window.clearInterval(t); }, [load]);

  const rows: Row[] = useMemo(() => pos.map(po => {
    const progress = poProgress(po, incoming);
    const fin = poFinance(po, invoices, payments);
    return { po, progress, fin, stage: poStage(po, progress, fin), total: poTotals(po).total };
  }).sort((a, b) => b.po.poNo.localeCompare(a.po.poNo)), [pos, incoming, invoices, payments]);

  const requisitions = useMemo(() => openRequisitions(supReqs, hrReqs, pos, stfs), [supReqs, hrReqs, pos, stfs]);
  const selectedRow = rows.find(r => r.po.id === selectedPoId) || null;
  const selectedTf = tfs.find(t => t.id === selectedTfId) || null;
  const selectedStf = stfs.find(x => x.id === selectedStfId) || null;

  // A PO that is fully received, invoiced and paid (e.g. paid by the bank under trade finance) closes by itself.
  const autoTried = React.useRef<Set<string>>(new Set());
  useEffect(() => {
    const todo = rows.filter(r => canAutoClose(r.po, r.progress, r.fin) && !autoTried.current.has(r.po.id));
    if (todo.length === 0) return;
    todo.forEach(r => autoTried.current.add(r.po.id));
    (async () => {
      for (const r of todo) { try { await dbPoAction(r.po.id, 'close', currentUserName, { closedReason: 'completed', notes: 'Received in full and fully paid.' }); } catch { /* stays open; can be closed by hand */ } }
      load();
    })();
  }, [rows, currentUserName, load]);

  const tfPos = useMemo(() => tfs.map(t => ({ tf: t, pos: tfPosition(t) })), [tfs]);
  const tfLive = tfPos.filter(x => x.tf.status === 'drawn');
  const tfOutstanding = tfLive.reduce((t, x) => t + x.pos.outstanding, 0);
  const tfOverdue = tfLive.filter(x => x.pos.overdue);
  const tfSoon = tfLive.filter(x => x.pos.dueSoon);

  // ---- derived numbers for the dashboard / payments ----
  const byStage = (...s: PoStage[]) => rows.filter(r => s.includes(r.stage));
  const fxOf = (po: PurchaseOrder) => Number(po.fxRate) || 1;               // AED per 1 unit of the PO's currency
  const aed = (r: Row, n: number) => n * fxOf(r.po);
  const outstandingRows = rows.filter(r => (r.po.status === 'approved' || r.po.status === 'closed') && r.fin.outstanding > 0);
  const dueDate = (r: Row) => r.fin.invoices.map(i => i.dueDate).sort()[0] || null;
  const overdueRows = outstandingRows.filter(r => { const d = dueDate(r); return d && daysUntil(d) < 0; });
  const monthKey = new Date().toISOString().slice(0, 7);
  const poById = new Map<string, PurchaseOrder>(pos.map(p => [p.id, p] as [string, PurchaseOrder]));
  const spendMonth = payments.filter(p => !p.voided && p.clearStatus !== 'bounced' && !(p.method === 'pdc' && p.clearStatus !== 'cleared') && p.paidAt.startsWith(monthKey))
    .reduce((t, p) => t + p.amount * (poById.get(p.poId) ? fxOf(poById.get(p.poId)!) : 1), 0);
  // post-dated cheques waiting to be cashed
  const pdcOpen = payments.filter(p => !p.voided && p.method === 'pdc' && p.clearStatus === 'issued' && p.chequeDate).sort((a, b) => (a.chequeDate || '').localeCompare(b.chequeDate || ''));
  const pdcSoon = pdcOpen.filter(p => daysUntil((p.chequeDate || '').slice(0, 10)) <= 7);
  const stfWaitingForMe = stfs.filter(x => x.status === 'pending' && sameName(x.queue, currentUserName));
  const lateDeliveries = rows.filter(r => r.po.status === 'approved' && !r.progress.complete && r.po.expectedDate && daysUntil(r.po.expectedDate.slice(0, 10)) < 0);
  const needInvoice = byStage('received');

  // ---- opening editors from requisitions ----
  const matchMaterial = (r: { erpCode?: string | null; itemName: string }) =>
    materials.find(m => r.erpCode && (m as any).erpCode === r.erpCode) || materials.find(m => norm(m.name) === norm(r.itemName)) || null;
  const toSeedLines = (sel: typeof requisitions) => sel.map(r => ({
    materialId: matchMaterial(r)?.id, itemName: r.itemName, qty: r.qty, sourceRequestId: r.id, sourceKind: r.kind,
  }));

  // PO saved (from an STF, or raised directly)
  const afterPoSaved = async (po: PurchaseOrder, seedStf?: Stf | null) => {
    if (seedStf) { try { await dbLinkStfPo(seedStf.id, { id: po.id, poNo: po.poNo }, currentUserName); } catch { /* the PO is saved; the STF link can be added later */ } }
    setPoEditor(null);
    await load();
    setSelectedPoId(po.id);
    setTab('po');
  };

  // Issue the PO from an APPROVED STF: supplier, terms, project, currency, VAT and prices all carry over.
  const convertStf = (stf: Stf) => {
    setConvert(null);
    setSelectedStfId(null);
    setPoEditor({
      seed: {
        stf, supplierName: stf.supplierName, paymentTerms: stf.paymentTerms || null, currency: stf.currency, fxRate: stf.fxRate, vatRate: stf.vatRate,
        projectType: stf.projectType, projectName: stf.projectName, notes: stf.description,
        lines: stf.lines.map(l => ({ materialId: l.materialId, itemName: l.itemName, qty: l.qty, unitPrice: l.unitPrice, vatRate: l.vatRate ?? stf.vatRate, sourceRequestId: l.sourceRequestId, sourceKind: l.sourceKind })),
      },
    });
  };

  // The quotation sheet is decided → start the STF with the winner's prices and the quotation PDF(s)
  const createStfFromRfq = (rfq: Rfq) => {
    const q = rfq.quotes.find(x => x.id === rfq.awardedQuoteId);
    if (!q) return;
    setRfqEditor(null);
    setStfEditor({
      seed: {
        rfq, description: rfq.title, supplierName: q.supplierName, paymentTerms: q.paymentTerms || null,
        attachments: (q.attachments || []).map(a => ({ ...a, kind: 'quotation', shared: true })),
        lines: rfq.lines.map(l => ({ materialId: l.materialId, itemName: l.itemName, qty: l.qty, unitPrice: q.unitPrices[l.id] ?? null, sourceRequestId: l.sourceRequestId, sourceKind: l.sourceKind })),
      },
    });
  };

  // ---- exports ----
  const exportPos = () => {
    const data = rows.map(r => {
      const t = poTotals(r.po);
      return {
        'PO No.': r.po.poNo, 'Date': dateFmt(r.po.orderDate), 'Supplier': r.po.supplierName, 'Status': STAGE_META[r.stage].label,
        'Items': r.po.lines.length, 'Subtotal': t.subtotal, 'VAT': t.vat, 'Total': t.total,
        'Received %': Math.round(r.progress.pct), 'Invoiced': r.fin.invoiced, 'Paid': r.fin.paid, 'Outstanding': r.fin.outstanding,
        'Due by': dateFmt(r.po.expectedDate),
      };
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Purchase orders');
    XLSX.writeFile(wb, `Purchase_Orders_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };
  const exportPayments = () => {
    const data = payments.filter(p => !p.voided).sort((a, b) => b.paidAt.localeCompare(a.paidAt)).map(p => ({
      'Date': dateFmt(p.paidAt), 'PO No.': p.poNo, 'Supplier': p.supplierName, 'Type': p.kind === 'advance' ? 'Advance' : 'Invoice payment',
      'Amount (AED)': p.amount, 'Method': p.method.replace('_', ' '), 'Reference': p.reference || '', 'Recorded by': p.byName,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Payments');
    XLSX.writeFile(wb, `Supplier_Payments_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  if (loading) return <div className="flex items-center justify-center py-24 text-slate-500 text-sm gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading procurement…</div>;

  const readyForPo = stfs.filter(x => x.status === 'approved' && !x.poId);
  const stfOpen = stfs.filter(x => x.status === 'pending' || x.status === 'board');
  const navBadge = (id: Tab) => id === 'requisitions' ? requisitions.length : id === 'stf' ? stfWaitingForMe.length : id === 'po' ? readyForPo.length + byStage('awaiting_approval').length : id === 'payments' ? overdueRows.length : 0;
  const badgeTone = (id: Tab) => id === 'payments' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-800';
  const title = NAV.flatMap(g => g.items).find(i => i.id === tab)?.label || '';

  return (
    <div className="flex flex-col lg:flex-row gap-4 items-start" data-testid="procurement-portal">
      {/* ───────── sidebar ───────── */}
      <aside className="w-full lg:w-56 shrink-0 lg:sticky lg:top-2 rounded-2xl border border-slate-200 bg-white p-3 space-y-3">
        <div className="flex items-center gap-2.5 px-1">
          <div className="h-9 w-9 rounded-xl bg-primary-600 text-white flex items-center justify-center"><ShoppingCart className="h-4 w-4" /></div>
          <div className="leading-tight"><div className="text-sm font-black text-slate-900">Procurement</div><div className="text-[10px] text-slate-500">STF → PO → Pay</div></div>
        </div>
        <button onClick={() => setStfEditor({})} className={`${btn.primary} w-full justify-center`} data-testid="stf-new-side"><Plus className="h-3.5 w-3.5" /> New STF</button>
        <button onClick={() => setConvert({})} className={`${btn.soft} w-full justify-center ${readyForPo.length ? 'ring-1 ring-emerald-300 bg-emerald-50 text-emerald-800' : ''}`} data-testid="convert-open">
          <ArrowRight className="h-3.5 w-3.5" /> Convert STF to PO{readyForPo.length > 0 && <span className="ml-1 px-1.5 rounded-full bg-emerald-600 text-white text-[10px] font-black">{readyForPo.length}</span>}
        </button>
        <nav className="flex lg:block gap-1 overflow-x-auto lg:overflow-visible pb-1 lg:pb-0">
          {NAV.map(g => (
            <div key={g.group || 'top'} className="lg:mb-2 flex lg:block gap-1 shrink-0">
              {g.group && <div className="hidden lg:block px-2 pb-1 text-[10px] font-black uppercase tracking-wide text-slate-400">{g.group}</div>}
              {g.items.map(t => {
                const n = navBadge(t.id); const on = tab === t.id;
                return (
                  <button key={t.id} onClick={() => selectTab(t.id)} data-testid={`proc-tab-${t.id}`}
                    className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-bold cursor-pointer whitespace-nowrap transition-colors ${on ? 'bg-primary-600 text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}>
                    <t.icon className="h-3.5 w-3.5 shrink-0" /> <span className="flex-1 text-left">{t.label}</span>
                    {n > 0 && <span className={`px-1.5 rounded-full text-[10px] font-black ${on ? 'bg-white/25 text-white' : badgeTone(t.id)}`}>{n}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="hidden lg:flex gap-2 pt-1 border-t border-slate-100">
          <button onClick={load} className={`${btn.soft} flex-1 justify-center`} title="Refresh"><RefreshCw className="h-3.5 w-3.5" /></button>
          <button onClick={() => setShowSettings(true)} className={`${btn.soft} flex-1 justify-center`} data-testid="proc-settings" title="Approval queue, budget tier, numbering"><Settings className="h-3.5 w-3.5" /></button>
        </div>
      </aside>

      {/* ───────── content ───────── */}
      <main className="flex-1 min-w-0 w-full space-y-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-black text-slate-900">{title}</h1>
          <div className="lg:hidden ml-auto flex gap-2">
            <button onClick={load} className={btn.soft}><RefreshCw className="h-3.5 w-3.5" /></button>
            <button onClick={() => setShowSettings(true)} className={btn.soft}><Settings className="h-3.5 w-3.5" /></button>
          </div>
        </div>
        {loadError && <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{loadError}</div>}

        <React.Fragment key={tabResetKey}>
        {/* ============ OVERVIEW ============ */}
        {tab === 'dashboard' && (
          <div className="space-y-4">
            {/* the flow — a PO is only ever the 4th step */}
            <div className="rounded-2xl border border-slate-200 bg-white p-2 overflow-x-auto">
              <div className="flex items-stretch gap-1 min-w-[720px]">
                {([
                  ['Requisition', requisitions.length, 'approved, nothing started', 'requisitions'],
                  ['Quotation', rfqs.filter(r => r.status === 'draft' || r.status === 'awarded').length, 'being compared', 'rfq'],
                  ['STF approval', stfOpen.length, 'pending / with the Board', 'stf'],
                  ['Ready for PO', readyForPo.length, 'approved STF, no PO', 'po'],
                  ['Delivery', byStage('issued', 'partially_received').length, 'PO issued, goods due', 'po'],
                  ['Invoice & pay', byStage('received', 'part_paid').length, 'received, not paid', 'payments'],
                ] as [string, number, string, Tab][]).map(([label, n, sub, go], i, arr) => (
                  <React.Fragment key={label}>
                    <button onClick={() => setTab(go)} className={`flex-1 text-left rounded-xl px-3 py-2.5 cursor-pointer hover:bg-slate-50 ${label === 'Ready for PO' && n > 0 ? 'bg-emerald-50 ring-1 ring-emerald-200' : ''}`}>
                      <div className="text-[10px] uppercase font-bold text-slate-500">{label}</div>
                      <div className={`text-2xl font-black font-mono ${n > 0 ? 'text-primary-700' : 'text-slate-300'}`}>{n}</div>
                      <div className="text-[10px] text-slate-500 leading-tight">{sub}</div>
                    </button>
                    {i < arr.length - 1 && <ChevronRight className="h-4 w-4 self-center text-slate-300 shrink-0" />}
                  </React.Fragment>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Stat label="Open POs" value={String(rows.filter(r => r.po.status === 'approved').length)} sub={`AED ${money(rows.filter(r => r.po.status === 'approved').reduce((t, r) => t + aed(r, r.total), 0))}`} onClick={() => setTab('po')} />
              <Stat label="Outstanding payables" value={money(outstandingRows.reduce((t, r) => t + aed(r, r.fin.outstanding), 0))} sub="AED invoiced, not paid" onClick={() => setTab('payments')} />
              <Stat label="Overdue" value={money(overdueRows.reduce((t, r) => t + aed(r, r.fin.outstanding), 0))} tone={overdueRows.length ? 'bad' : 'good'} sub={`${overdueRows.length} PO(s) past due`} onClick={() => setTab('payments')} />
              <Stat label="Paid this month" value={money(spendMonth)} sub="AED" tone="good" />
            </div>
            {tfs.length > 0 && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Stat label="Owed to banks" value={money(tfOutstanding)} sub={`${tfLive.length} drawn facility(ies)`} onClick={() => setTab('tf')} />
                <Stat label="Maturing ≤ 30 days" value={String(tfSoon.length)} tone={tfSoon.length ? 'warn' : 'default'} sub={`AED ${money(tfSoon.reduce((t, x) => t + x.pos.outstanding, 0))}`} onClick={() => setTab('tf')} />
                <Stat label="Facilities overdue" value={String(tfOverdue.length)} tone={tfOverdue.length ? 'bad' : 'good'} sub={`AED ${money(tfOverdue.reduce((t, x) => t + x.pos.outstanding, 0))}`} onClick={() => setTab('tf')} />
                <Stat label="Awaiting bank" value={String(tfs.filter(t => t.status === 'applied' || t.status === 'approved').length)} sub="applied or approved" onClick={() => setTab('tf')} />
              </div>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
              {/* inbox */}
              <div className="xl:col-span-3 rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-center gap-1.5 text-xs font-extrabold text-slate-900 mb-3"><Inbox className="h-4 w-4 text-primary-600" /> Needs your attention</div>
                {(() => {
                  const item = (key: string, onClick: () => void, no: string, text: React.ReactNode, tone: 'amber' | 'rose' | 'emerald' | 'slate', action?: React.ReactNode) => (
                    <li key={key} className="flex items-center gap-2">
                      <button onClick={onClick} className="flex-1 min-w-0 text-left text-xs rounded-lg px-2 py-1.5 hover:bg-slate-50 cursor-pointer flex items-baseline gap-2">
                        <span className={`shrink-0 h-1.5 w-1.5 rounded-full self-center ${{ amber: 'bg-amber-500', rose: 'bg-rose-500', emerald: 'bg-emerald-500', slate: 'bg-slate-400' }[tone]}`} />
                        <span className="font-mono font-bold shrink-0">{no}</span><span className="truncate text-slate-700">{text}</span>
                      </button>
                      {action}
                    </li>
                  );
                  const list: React.ReactNode[] = [
                    ...stfWaitingForMe.map(x => item(`w${x.id}`, () => setSelectedStfId(x.id), x.stfNo, <>{x.description} — <b className="text-amber-700">waiting for you</b> ({budgetTier(x, settings).label})</>, 'amber')),
                    ...readyForPo.map(x => item(`r${x.id}`, () => setSelectedStfId(x.id), x.stfNo, <>{x.supplierName} — <b className="text-emerald-700">approved, issue the PO</b></>, 'emerald',
                      <button onClick={() => setConvert({ expected: x })} className={`${btn.green} !py-1 !px-2.5 shrink-0`}>Convert <ArrowRight className="h-3 w-3" /></button>)),
                    ...byStage('awaiting_approval').map(r => item(`a${r.po.id}`, () => setSelectedPoId(r.po.id), r.po.poNo, <>{r.po.supplierName} — <b className="text-amber-700">PO waiting for approval</b> (AED {money(r.total)})</>, 'amber')),
                    ...lateDeliveries.map(r => item(`l${r.po.id}`, () => setSelectedPoId(r.po.id), r.po.poNo, <>{r.po.supplierName} — <b className="text-rose-700">delivery late</b>, was due {dateFmt(r.po.expectedDate)} ({Math.round(r.progress.pct)}% in)</>, 'rose')),
                    ...needInvoice.map(r => item(`i${r.po.id}`, () => setSelectedPoId(r.po.id), r.po.poNo, <>{r.po.supplierName} — <b className="text-emerald-700">fully received</b>, record the invoice</>, 'emerald')),
                    ...overdueRows.map(r => item(`o${r.po.id}`, () => setSelectedPoId(r.po.id), r.po.poNo, <>{r.po.supplierName} — <b className="text-rose-700">payment overdue</b> AED {money(r.fin.outstanding)}</>, 'rose')),
                    ...pdcSoon.map(p => item(`p${p.id}`, () => setSelectedPoId(p.poId), p.poNo, <>{p.supplierName} — <b className={daysUntil((p.chequeDate || '').slice(0, 10)) < 0 ? 'text-rose-700' : 'text-amber-700'}>PDC {p.reference || ''} {dateFmt(p.chequeDate)}</b> ({money(p.amount)})</>, 'amber')),
                    ...tfOverdue.map(x => item(`t${x.tf.id}`, () => setSelectedTfId(x.tf.id), x.tf.tfNo, <>{x.tf.bankName} — <b className="text-rose-700">bank repayment overdue</b> AED {money(x.pos.outstanding)}</>, 'rose')),
                    ...tfSoon.map(x => item(`s${x.tf.id}`, () => setSelectedTfId(x.tf.id), x.tf.tfNo, <>{x.tf.bankName} — <b className="text-amber-700">matures in {x.pos.daysToMaturity} day(s)</b></>, 'amber')),
                  ];
                  if (requisitions.length > 0) list.push(item('req', () => setTab('requisitions'), `${requisitions.length}`, 'approved request(s) have no STF yet', 'slate'));
                  return list.length ? <ul className="space-y-0.5">{list}</ul> : <div className="text-xs text-slate-500 flex items-center gap-1.5 py-4"><Clock className="h-3.5 w-3.5" /> Nothing is waiting.</div>;
                })()}
              </div>
              {/* spend */}
              <div className="xl:col-span-2 rounded-2xl border border-slate-200 bg-white p-4">
                <div className="text-xs font-extrabold text-slate-900 mb-3">Spend by supplier (paid)</div>
                {(() => {
                  const m = new Map<string, number>();
                  payments.filter(p => !p.voided).forEach(p => m.set(p.supplierName, (m.get(p.supplierName) || 0) + p.amount));
                  const top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
                  const max = top[0]?.[1] || 1;
                  return top.length === 0 ? <div className="text-xs text-slate-500">No payments recorded yet.</div> : (
                    <div className="space-y-2.5">{top.map(([n, v]) => (
                      <div key={n}><div className="flex justify-between text-xs"><span className="font-semibold text-slate-800 truncate">{n}</span><span className="font-mono">{money(v)}</span></div><ProgressBar pct={(v / max) * 100} tone="sky" /></div>
                    ))}</div>
                  );
                })()}
              </div>
            </div>
          </div>
        )}

        {/* ============ REQUISITIONS ============ */}
        {tab === 'requisitions' && <RequisitionsTab
          items={requisitions}
          onStf={sel => setStfEditor({ seed: { description: sel.length === 1 ? sel[0].itemName : `${sel[0].itemName} +${sel.length - 1} more`, lines: toSeedLines(sel) } })}
          onRfq={sel => setRfqEditor({ seed: { title: sel.length === 1 ? sel[0].itemName : `${sel[0].itemName} +${sel.length - 1} more`, lines: toSeedLines(sel) } })}
        />}

        {/* ============ QUOTATIONS ============ */}
        {tab === 'rfq' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="text-xs text-slate-500">Compare supplier quotations first. Awarding one pre-fills a new STF for approval.</div>
              <button onClick={() => setRfqEditor({})} className={`${btn.primary} ml-auto shrink-0`} data-testid="rfq-new"><Plus className="h-3.5 w-3.5" /> Record quotations</button>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
              <table className="w-full min-w-[640px] text-xs">
                <thead><tr className="bg-slate-50 text-slate-500 uppercase text-[10px]">
                  <th className="text-left px-3 py-2">Quotation</th><th className="text-left px-3 py-2">Title</th><th className="text-right px-3 py-2">Items</th>
                  <th className="text-right px-3 py-2">Quotes</th><th className="text-right px-3 py-2">PDFs</th><th className="text-right px-3 py-2">Lowest</th><th className="text-left px-3 py-2">Awarded to</th><th className="text-left px-3 py-2">Status</th>
                </tr></thead>
                <tbody>
                  {[...rfqs].sort((a, b) => b.rfqNo.localeCompare(a.rfqNo)).map(s => {
                    const cheap = cheapestQuoteId(s);
                    const cq = s.quotes.find(q => q.id === cheap);
                    const win = s.quotes.find(q => q.id === s.awardedQuoteId);
                    return (
                      <tr key={s.id} onClick={() => setRfqEditor({ initial: s })} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer">
                        <td className="px-3 py-2.5 font-mono font-bold">{s.rfqNo}</td>
                        <td className="px-3 py-2.5 font-semibold text-slate-800">{s.title}<div className="text-[10px] font-normal text-slate-500">{dateFmt(s.createdAt)} · {s.createdByName}</div></td>
                        <td className="px-3 py-2.5 text-right">{s.lines.length}</td>
                        <td className="px-3 py-2.5 text-right">{s.quotes.length}</td>
                        <td className="px-3 py-2.5 text-right">{(() => { const n = s.quotes.reduce((t, q) => t + (q.attachments?.length || 0), 0); return n ? <span className="inline-flex items-center gap-1 text-primary-700 font-bold"><Paperclip className="h-3 w-3" />{n}</span> : <span className="text-slate-300">—</span>; })()}</td>
                        <td className="px-3 py-2.5 text-right font-mono">{cq ? `${money(quoteTotal(s, cq) || 0)}` : '—'}<div className="text-[10px] text-slate-500 font-sans">{cq?.supplierName}</div></td>
                        <td className="px-3 py-2.5">{win?.supplierName || '—'}</td>
                        <td className="px-3 py-2.5"><span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase border ${s.status === 'draft' ? 'bg-slate-100 text-slate-700 border-slate-300' : s.status === 'awarded' ? 'bg-amber-50 text-amber-800 border-amber-300' : 'bg-emerald-50 text-emerald-800 border-emerald-300'}`}>{s.status === 'po_created' ? 'STF / PO made' : s.status}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {rfqs.length === 0 && <div className="text-center text-slate-500 text-sm py-10">No quotations yet.</div>}
            </div>
          </div>
        )}

        {tab === 'stf' && <StfBoard stfs={stfs} settings={settings} me={currentUserName} onOpen={id => setSelectedStfId(id)} onNew={() => setStfEditor({})} onConvert={x => setConvert({ expected: x })} />}
        {tab === 'register' && <RegisterTab rows={buildRegister(stfs, pos, incoming, invoices, payments, settings)} onOpenStf={id => setSelectedStfId(id)} onOpenPo={id => setSelectedPoId(id)} onExport={() => exportRegisterExcel(buildRegister(stfs, pos, incoming, invoices, payments, settings), settings)} />}
        {tab === 'tf' && <TradeFinanceTab tfs={tfs} onOpen={id => setSelectedTfId(id)} onNew={() => setTfEditor({})} />}
        {tab === 'po' && <PoList rows={rows} readyForPo={readyForPo} onOpen={id => setSelectedPoId(id)} onConvert={() => setConvert({})} onOpenStf={id => setSelectedStfId(id)} onExport={exportPos} />}
        {tab === 'payments' && <PaymentsTab rows={rows} payments={payments} pdcOpen={pdcOpen} dueDate={dueDate} onOpen={id => setSelectedPoId(id)} onExport={exportPayments} onClearing={async (id, st) => { try { await dbSetPaymentClearing(id, st, currentUserName); await load(); } catch (e: any) { window.alert(e?.message || 'Could not update the cheque.'); } }} />}
        {tab === 'suppliers' && (
          <SuppliersPage suppliers={suppliers} incoming={incoming} materials={materials} currentUserName={currentUserName} onChanged={load} onOpenMaterial={() => { /* materials live in the Store */ }} />
        )}
        </React.Fragment>
      </main>

      {/* ---- overlays ---- */}
      {selectedRow && (
        <PoDetailPanel
          po={selectedRow.po} suppliers={suppliers} incoming={incoming} invoices={invoices} payments={payments} rfqs={rfqs} tradeFinances={tfs}
          currentUserName={currentUserName} canApprove={canApprove}
          onNewTf={po => setTfEditor({ forPoId: po.id })} onOpenTf={id => setSelectedTfId(id)}
          onClose={() => setSelectedPoId(null)} onChanged={load}
          onEdit={po => setPoEditor({ initial: po })}
        />
      )}
      {selectedTf && (
        <TradeFinancePanel
          tf={selectedTf} po={pos.find(p => p.id === selectedTf.poId) || null} invoices={invoices} payments={payments}
          currentUserName={currentUserName} onClose={() => setSelectedTfId(null)} onChanged={load}
          onEdit={tf => setTfEditor({ initial: tf })} onOpenPo={id => { setSelectedPoId(id); }}
        />
      )}
      {tfEditor && (
        <TradeFinanceEditor
          pos={pos.filter(p => p.status === 'approved')} tfs={tfs} initial={tfEditor.initial} forPoId={tfEditor.forPoId} currentUserName={currentUserName}
          onClose={() => setTfEditor(null)}
          onSaved={async tf => { setTfEditor(null); await load(); setSelectedTfId(tf.id); setTab('tf'); }}
        />
      )}
      {selectedStf && (
        <StfPanel
          stf={selectedStf} settings={settings} currentUserName={currentUserName} manager={canApprove}
          onClose={() => setSelectedStfId(null)} onChanged={load}
          onEdit={x => setStfEditor({ initial: x })} onIssuePo={x => setConvert({ expected: x })} onOpenPo={id => { setSelectedStfId(null); setSelectedPoId(id); }}
        />
      )}
      {stfEditor && (
        <StfEditor
          suppliers={suppliers} materials={materials} stfs={stfs} settings={settings} initial={stfEditor.initial} seed={stfEditor.seed} currentUserName={currentUserName}
          onClose={() => setStfEditor(null)}
          onSaved={async x => { setStfEditor(null); await load(); setSelectedStfId(x.id); setTab('stf'); }}
        />
      )}
      {convert && <ConvertStfDialog stfs={stfs} pos={pos} settings={settings} expected={convert.expected} onClose={() => setConvert(null)} onConvert={convertStf} />}
      {showSettings && <ProcurementSettingsDialog settings={settings} canEdit={canApprove} onClose={() => setShowSettings(false)} onSaved={async () => { setShowSettings(false); await load(); }} />}
      {poEditor && (
        <PoEditor
          suppliers={suppliers} materials={materials} pos={pos} initial={poEditor.initial} seed={poEditor.seed} currentUserName={currentUserName}
          onClose={() => setPoEditor(null)} onSaved={(po) => afterPoSaved(po, poEditor.seed?.stf)}
        />
      )}
      {rfqEditor && (
        <RfqEditor
          suppliers={suppliers} materials={materials} initial={rfqEditor.initial} seed={rfqEditor.seed} currentUserName={currentUserName}
          onClose={() => setRfqEditor(null)}
          onSaved={async () => { await load(); }}
          onCreatePo={createStfFromRfq}
        />
      )}
    </div>
  );
};

const RequisitionsTab: React.FC<{
  items: ReturnType<typeof openRequisitions>;
  onStf: (sel: ReturnType<typeof openRequisitions>) => void;
  onRfq: (sel: ReturnType<typeof openRequisitions>) => void;
}> = ({ items, onStf, onRfq }) => {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const sel = items.filter(i => picked.has(i.key));
  const toggle = (k: string) => setPicked(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-xs text-slate-500">Requests already approved by the manager. Tick what to buy together, then compare quotes or go straight to an STF for approval.</div>
        <div className="ml-auto flex gap-2">
          <button disabled={sel.length === 0} onClick={() => onRfq(sel)} className={btn.soft} data-testid="req-rfq"><Scale className="h-3.5 w-3.5" /> Compare quotes</button>
          <button disabled={sel.length === 0} onClick={() => onStf(sel)} className={btn.primary} data-testid="req-stf"><ClipboardCheck className="h-3.5 w-3.5" /> Create STF</button>
        </div>
      </div>
      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
        <table className="w-full min-w-[640px] text-xs">
          <thead><tr className="bg-slate-50 text-slate-500 uppercase text-[10px]">
            <th className="w-8 px-3 py-2"><input type="checkbox" checked={items.length > 0 && picked.size === items.length} onChange={e => setPicked(e.target.checked ? new Set(items.map(i => i.key)) : new Set())} /></th>
            <th className="text-left px-2 py-2">Item</th><th className="text-right px-2 py-2">Approved qty</th><th className="text-left px-2 py-2">From</th>
            <th className="text-left px-2 py-2">Requested by</th><th className="text-left px-2 py-2">Date</th><th className="text-left px-2 py-2">Purpose</th>
          </tr></thead>
          <tbody>
            {items.map(i => (
              <tr key={i.key} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2"><input type="checkbox" checked={picked.has(i.key)} onChange={() => toggle(i.key)} /></td>
                <td className="px-2 py-2 font-semibold text-slate-800">{i.itemName}{i.erpCode && <div className="text-[10px] font-mono font-normal text-slate-500">{i.erpCode}</div>}</td>
                <td className="px-2 py-2 text-right font-mono">{qtyFmt(i.qty)} {i.unit}</td>
                <td className="px-2 py-2">{i.kind === 'hr' ? 'HR' : 'Supervisor'}</td>
                <td className="px-2 py-2">{i.requestedByName}</td>
                <td className="px-2 py-2 whitespace-nowrap">{dateFmt(i.requestedAt)}</td>
                <td className="px-2 py-2 text-slate-600 max-w-[220px] truncate">{i.purpose || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 && <div className="text-center text-slate-500 text-sm py-10">No approved requests are waiting. You can still start an STF from the STF page.</div>}
      </div>
    </div>
  );
};

// ── Purchase order list ──────────────────────────────────────────────────────
const PoList: React.FC<{ rows: Row[]; readyForPo: Stf[]; onOpen: (id: string) => void; onConvert: () => void; onOpenStf: (id: string) => void; onExport: () => void }> = ({ rows, readyForPo, onOpen, onConvert, onOpenStf, onExport }) => {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'active' | 'all' | PoStage>('active');
  const chips: { id: 'active' | 'all' | PoStage; label: string }[] = [
    { id: 'active', label: 'Active' }, { id: 'awaiting_approval', label: 'Awaiting approval' }, { id: 'issued', label: 'Awaiting delivery' },
    { id: 'partially_received', label: 'Partially received' }, { id: 'received', label: 'Ready to pay' }, { id: 'draft', label: 'Draft' }, { id: 'closed', label: 'Closed' }, { id: 'all', label: 'All' },
  ];
  const shown = rows.filter(r => {
    if (filter === 'active' && !['awaiting_approval', 'issued', 'partially_received', 'received', 'part_paid', 'paid', 'draft'].includes(r.stage)) return false;
    if (filter === 'closed' && !['closed', 'closed_short', 'cancelled'].includes(r.stage)) return false;
    if (filter !== 'active' && filter !== 'all' && filter !== 'closed' && r.stage !== filter) return false;
    const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return true;
    const hay = `${r.po.poNo} ${r.po.supplierName} ${r.po.lines.map(l => l.itemName).join(' ')}`.toLowerCase();
    return tokens.every(t => hay.includes(t));
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="h-3.5 w-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search PO number, supplier or item…" className={`${inputCls} pl-8`} data-testid="po-search" />
        </div>
        <button onClick={onExport} className={btn.green}><Download className="h-3.5 w-3.5" /> Excel</button>
        <button onClick={onConvert} className={btn.primary} data-testid="po-new"><ArrowRight className="h-3.5 w-3.5" /> Convert STF to PO</button>
      </div>
      {readyForPo.length > 0 && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 flex flex-wrap items-center gap-x-3 gap-y-1">
          <b>{readyForPo.length} approved STF{readyForPo.length > 1 ? 's' : ''} waiting for a PO:</b>
          {readyForPo.map(x => <button key={x.id} onClick={() => onOpenStf(x.id)} className="font-mono font-bold underline cursor-pointer">{x.stfNo}</button>)}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {chips.map(c => <button key={c.id} onClick={() => setFilter(c.id)} className={`px-3 py-1 rounded-lg text-[11px] font-bold border cursor-pointer ${filter === c.id ? 'bg-slate-800 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900'}`}>{c.label}</button>)}
      </div>
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full min-w-[900px] text-xs">
          <thead><tr className="bg-slate-50 text-slate-500 uppercase text-[10px]">
            <th className="text-left px-3 py-2">PO</th><th className="text-left px-2 py-2">STF</th><th className="text-left px-2 py-2">Supplier</th><th className="text-right px-2 py-2">Total</th>
            <th className="px-2 py-2 w-36">Received</th><th className="text-left px-2 py-2">Delivery due</th><th className="text-right px-2 py-2">Outstanding</th><th className="text-left px-2 py-2">Stage</th><th className="w-6" />
          </tr></thead>
          <tbody>
            {shown.map(r => {
              const late = r.po.status === 'approved' && !r.progress.complete && r.po.expectedDate && daysUntil(r.po.expectedDate.slice(0, 10)) < 0;
              return (
                <tr key={r.po.id} onClick={() => onOpen(r.po.id)} data-testid={`po-row-${r.po.poNo}`} className="border-t border-slate-200 hover:bg-slate-50 cursor-pointer">
                  <td className="px-3 py-2.5 font-mono font-bold">{r.po.poNo}<div className="text-[10px] font-sans font-normal text-slate-500">{dateFmt(r.po.orderDate)} · {r.po.lines.length} item(s)</div></td>
                  <td className="px-2 py-2.5 font-mono text-[11px]">{r.po.stfNo || <span className="text-slate-300">—</span>}</td>
                  <td className="px-2 py-2.5 font-semibold text-slate-800">{r.po.supplierName}</td>
                  <td className="px-2 py-2.5 text-right font-mono">{money(r.total)}{r.po.currency && r.po.currency !== 'AED' && <span className="ml-1 text-[10px] text-slate-500 font-sans">{r.po.currency}</span>}</td>
                  <td className="px-2 py-2.5">
                    {r.po.status === 'approved' || r.po.status === 'closed' ? <>
                      <ProgressBar pct={r.progress.pct} tone={r.progress.complete ? 'emerald' : 'violet'} />
                      <div className="text-[10px] text-slate-500 mt-0.5">{Math.round(r.progress.pct)}% · {r.progress.linesComplete}/{r.progress.lines.length} items</div>
                    </> : <span className="text-slate-300">—</span>}
                  </td>
                  <td className={`px-2 py-2.5 whitespace-nowrap ${late ? 'text-rose-700 font-bold' : ''}`}>{dateFmt(r.po.expectedDate)}{late ? ' · late' : ''}</td>
                  <td className={`px-2 py-2.5 text-right font-mono ${r.fin.outstanding > 0 ? 'text-rose-700 font-bold' : 'text-slate-300'}`}>{r.fin.outstanding > 0 ? money(r.fin.outstanding) : '—'}</td>
                  <td className="px-2 py-2.5"><StageBadge stage={r.stage} /></td>
                  <td className="px-1 text-slate-400"><ChevronRight className="h-4 w-4" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {shown.length === 0 && <div className="text-center text-slate-500 text-sm py-10">{rows.length === 0 ? 'No purchase orders yet. Create an STF, get it approved, then convert it here.' : 'No PO matches this filter.'}</div>}
      </div>
    </div>
  );
};

// ── Payments ─────────────────────────────────────────────────────────────────
const PaymentsTab: React.FC<{ rows: Row[]; payments: SupplierPayment[]; pdcOpen: SupplierPayment[]; dueDate: (r: Row) => string | null; onOpen: (id: string) => void; onExport: () => void; onClearing: (id: string, st: 'cleared' | 'bounced') => void }> = ({ rows, payments, pdcOpen, dueDate, onOpen, onExport, onClearing }) => {
  const [filter, setFilter] = useState<'due' | 'overdue' | 'invoice' | 'all'>('due');
  const payable = rows.filter(r => r.po.status === 'approved' || r.po.status === 'closed');
  const list = payable.filter(r => {
    const d = dueDate(r);
    if (filter === 'invoice') return r.stage === 'received';
    if (filter === 'overdue') return r.fin.outstanding > 0 && !!d && daysUntil(d) < 0;
    if (filter === 'due') return r.fin.outstanding > 0 || r.stage === 'received';
    return r.fin.invoiced > 0 || r.fin.paid > 0 || r.progress.complete;
  });
  const live = payments.filter(p => !p.voided).sort((a, b) => b.paidAt.localeCompare(a.paidAt));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {([['due', 'To pay'], ['overdue', 'Overdue'], ['invoice', 'Received — needs invoice'], ['all', 'All']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setFilter(id)} className={`px-3 py-1 rounded-lg text-[11px] font-bold border cursor-pointer ${filter === id ? 'bg-slate-800 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900'}`}>{label}</button>
        ))}
        <button onClick={onExport} className={`${btn.green} ml-auto`}><Download className="h-3.5 w-3.5" /> Payments Excel</button>
      </div>
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full min-w-[760px] text-xs">
          <thead><tr className="bg-slate-100 text-slate-500 uppercase text-[10px]">
            <th className="text-left px-3 py-2">PO</th><th className="text-left px-2 py-2">Supplier</th><th className="text-right px-2 py-2">Invoiced</th><th className="text-right px-2 py-2">Paid</th>
            <th className="text-right px-2 py-2">Outstanding</th><th className="text-left px-2 py-2">Due</th><th className="text-left px-2 py-2">Stage</th><th className="w-6" />
          </tr></thead>
          <tbody>
            {list.map(r => {
              const d = dueDate(r); const dd = d ? daysUntil(d) : null;
              return (
                <tr key={r.po.id} onClick={() => onOpen(r.po.id)} className="border-t border-slate-200 hover:bg-slate-50 cursor-pointer">
                  <td className="px-3 py-2.5 font-mono font-bold">{r.po.poNo}</td>
                  <td className="px-2 py-2.5 font-semibold text-slate-800">{r.po.supplierName}</td>
                  <td className="px-2 py-2.5 text-right font-mono">{r.fin.invoiced ? money(r.fin.invoiced) : <span className="text-amber-700 font-sans">no invoice</span>}</td>
                  <td className="px-2 py-2.5 text-right font-mono">{money(r.fin.paid)}</td>
                  <td className={`px-2 py-2.5 text-right font-mono ${r.fin.outstanding > 0 ? 'text-rose-700 font-bold' : ''}`}>{money(r.fin.outstanding)}</td>
                  <td className={`px-2 py-2.5 whitespace-nowrap ${dd != null && dd < 0 && r.fin.outstanding > 0 ? 'text-rose-700 font-bold' : ''}`}>{d ? `${dateFmt(d)}${dd != null && dd < 0 && r.fin.outstanding > 0 ? ` · ${-dd}d overdue` : ''}` : '—'}</td>
                  <td className="px-2 py-2.5"><StageBadge stage={r.stage} /></td>
                  <td className="px-1 text-slate-400"><ChevronRight className="h-4 w-4" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {list.length === 0 && <div className="text-center text-slate-500 text-sm py-8">Nothing here.</div>}
      </div>

      {pdcOpen.length > 0 && (
        <div data-testid="pdc-register">
          <div className="text-xs font-extrabold text-slate-900 mb-2 flex items-center gap-1.5"><FileText className="h-4 w-4 text-amber-600" /> Post-dated cheques waiting to be cashed</div>
          <div className="bg-white border border-amber-200 rounded-xl overflow-x-auto">
            <table className="w-full min-w-[640px] text-xs">
              <thead><tr className="bg-amber-50 text-slate-500 uppercase text-[10px]"><th className="text-left px-3 py-2">Cheque date</th><th className="text-left px-2 py-2">Cheque no.</th><th className="text-left px-2 py-2">PO</th><th className="text-left px-2 py-2">Supplier</th><th className="text-right px-2 py-2">Amount</th><th className="w-32" /></tr></thead>
              <tbody>
                {pdcOpen.map(p => { const d = daysUntil((p.chequeDate || '').slice(0, 10)); return (
                  <tr key={p.id} className="border-t border-amber-100">
                    <td className={`px-3 py-2 whitespace-nowrap ${d < 0 ? 'text-rose-700 font-bold' : d <= 7 ? 'text-amber-700 font-bold' : ''}`}>{dateFmt(p.chequeDate)}{d < 0 ? ` · ${-d}d past` : d <= 7 ? ` · in ${d}d` : ''}</td>
                    <td className="px-2 py-2 font-mono">{p.reference || '—'}</td><td className="px-2 py-2 font-mono">{p.poNo}</td><td className="px-2 py-2">{p.supplierName}</td>
                    <td className="px-2 py-2 text-right font-mono">{money(p.amount)}</td>
                    <td className="px-2 py-2 text-right whitespace-nowrap">
                      <button onClick={() => onClearing(p.id, 'cleared')} className="text-[11px] font-bold text-emerald-700 hover:underline cursor-pointer mr-2" data-testid={`pdc-tab-clear-${p.id}`}>Cleared</button>
                      <button onClick={() => onClearing(p.id, 'bounced')} className="text-[11px] font-bold text-rose-700 hover:underline cursor-pointer">Bounced</button>
                    </td>
                  </tr>
                ); })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div>
        <div className="text-xs font-extrabold text-slate-900 mb-2 flex items-center gap-1.5"><FileText className="h-4 w-4 text-slate-500" /> Payment register</div>
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full min-w-[640px] text-xs">
            <thead><tr className="bg-slate-100 text-slate-500 uppercase text-[10px]">
              <th className="text-left px-3 py-2">Date</th><th className="text-left px-2 py-2">PO</th><th className="text-left px-2 py-2">Supplier</th><th className="text-left px-2 py-2">Type</th>
              <th className="text-left px-2 py-2">Method / ref.</th><th className="text-right px-2 py-2">Amount</th><th className="text-left px-2 py-2">By</th>
            </tr></thead>
            <tbody>
              {live.slice(0, 100).map(p => (
                <tr key={p.id} className="border-t border-slate-200">
                  <td className="px-3 py-2 whitespace-nowrap">{dateFmt(p.paidAt)}</td><td className="px-2 py-2 font-mono">{p.poNo}</td><td className="px-2 py-2">{p.supplierName}</td>
                  <td className="px-2 py-2">{p.kind === 'advance' ? 'Advance' : 'Invoice'}</td><td className="px-2 py-2">{p.method.replace('_', ' ')}{p.reference ? ` · ${p.reference}` : ''}</td>
                  <td className="px-2 py-2 text-right font-mono">{money(p.amount)}</td><td className="px-2 py-2">{p.byName}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {live.length === 0 && <div className="text-center text-slate-500 text-sm py-6">No payments recorded yet.</div>}
        </div>
      </div>
    </div>
  );
};

// ── Structured Trade Finance ───────────────────────────────────────────
const TradeFinanceTab: React.FC<{ tfs: TradeFinance[]; onOpen: (id: string) => void; onNew: () => void }> = ({ tfs, onOpen, onNew }) => {
  const [filter, setFilter] = useState<'active' | 'drawn' | 'due' | 'all'>('active');
  const rows = tfs.map(t => ({ tf: t, p: tfPosition(t) })).sort((a, b) => b.tf.tfNo.localeCompare(a.tf.tfNo));
  const shown = rows.filter(({ tf, p }) => {
    if (filter === 'active') return !['settled', 'cancelled'].includes(tf.status);
    if (filter === 'drawn') return tf.status === 'drawn';
    if (filter === 'due') return p.overdue || p.dueSoon;
    return true;
  });
  const exportStf = () => {
    const data = rows.map(({ tf, p }) => ({
      'Ref.': tf.tfNo, 'PO No.': tf.poNo, 'Supplier': tf.supplierName, 'Bank': tf.bankName, 'Type': tfTypeLabel(tf.type), 'Reference': tf.facilityRef || '',
      'Status': TF_STATUS_META[tf.status].label, 'Goods value (AED)': p.invoiceAed, 'Cash margin': p.marginAed, 'Bank financed': p.financedAed, 'Interest': p.interest,
      'Commission': p.commission, 'Other charges': p.fees, 'Payable to bank': p.totalDue, 'Repaid': p.repaid, 'Outstanding': p.outstanding,
      'Drawdown': dateFmt(tf.drawDate), 'Maturity': dateFmt(p.maturity),
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Trade finance');
    XLSX.writeFile(wb, `Trade_Finance_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-xs text-slate-500 flex-1 min-w-[260px]">Structured Trade Finance (bank-financed purchases): the bank pays the supplier (LC, trust receipt, import loan…) and you repay the bank at maturity.</div>
        <button onClick={exportStf} className={btn.green}><Download className="h-3.5 w-3.5" /> Excel</button>
        <button onClick={onNew} className={btn.primary} data-testid="tf-new"><Plus className="h-3.5 w-3.5" /> New facility</button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {([['active', 'Active'], ['drawn', 'Drawn — repaying'], ['due', 'Due within 30 days / overdue'], ['all', 'All']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setFilter(id)} className={`px-3 py-1 rounded-lg text-[11px] font-bold border cursor-pointer ${filter === id ? 'bg-slate-800 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900'}`}>{label}</button>
        ))}
      </div>
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full min-w-[860px] text-xs">
          <thead><tr className="bg-slate-100 text-slate-500 uppercase text-[10px]">
            <th className="text-left px-3 py-2">Ref.</th><th className="text-left px-2 py-2">Bank / type</th><th className="text-left px-2 py-2">PO / supplier</th>
            <th className="text-right px-2 py-2">Goods (AED)</th><th className="text-right px-2 py-2">Payable to bank</th><th className="text-right px-2 py-2">Outstanding</th>
            <th className="text-left px-2 py-2">Maturity</th><th className="text-left px-2 py-2">Status</th><th className="w-6" />
          </tr></thead>
          <tbody>
            {shown.map(({ tf, p }) => (
              <tr key={tf.id} onClick={() => onOpen(tf.id)} data-testid={`tf-row-${tf.tfNo}`} className="border-t border-slate-200 hover:bg-slate-50 cursor-pointer">
                <td className="px-3 py-2.5 font-mono font-bold">{tf.tfNo}{tf.facilityRef && <div className="text-[10px] font-normal text-slate-500">{tf.facilityRef}</div>}</td>
                <td className="px-2 py-2.5 font-semibold text-slate-800">{tf.bankName}<div className="text-[10px] font-normal text-slate-500">{tfTypeLabel(tf.type)}</div></td>
                <td className="px-2 py-2.5">{tf.poNo}<div className="text-[10px] text-slate-500">{tf.supplierName}</div></td>
                <td className="px-2 py-2.5 text-right font-mono">{money(p.invoiceAed)}</td>
                <td className="px-2 py-2.5 text-right font-mono">{money(p.totalDue)}</td>
                <td className={`px-2 py-2.5 text-right font-mono ${tf.status === 'drawn' && p.outstanding > 0 ? 'text-rose-700 font-bold' : 'text-slate-400'}`}>{tf.status === 'drawn' ? money(p.outstanding) : '—'}</td>
                <td className={`px-2 py-2.5 whitespace-nowrap ${p.overdue ? 'text-rose-700 font-bold' : p.dueSoon ? 'text-amber-700 font-bold' : ''}`}>{p.maturity && tf.status === 'drawn' ? `${dateFmt(p.maturity)}${p.overdue ? ' · overdue' : p.dueSoon ? ` · ${p.daysToMaturity}d` : ''}` : '—'}</td>
                <td className="px-2 py-2.5"><span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase border whitespace-nowrap ${TF_STATUS_META[tf.status].cls}`}>{TF_STATUS_META[tf.status].label}</span></td>
                <td className="px-1 text-slate-400"><ChevronRight className="h-4 w-4" /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <div className="text-center text-slate-500 text-sm py-10">{tfs.length === 0 ? 'No trade finance yet. Issue a PO, then add the bank facility (LC, trust receipt, import loan) that pays for it.' : 'Nothing matches this filter.'}</div>}
      </div>
    </div>
  );
};

// ── STF list ─────────────────────────────────────────────────────────────────
const StfBoard: React.FC<{ stfs: Stf[]; settings: ProcurementSettings; me: string; onOpen: (id: string) => void; onNew: () => void; onConvert: (s: Stf) => void }> = ({ stfs, settings, me, onOpen, onNew, onConvert }) => {
  const [q, setQ] = useState('');
  const [mineOnly, setMineOnly] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const match = (x: Stf) => {
    if (mineOnly && !(x.status === 'pending' && sameName(x.queue, me))) return false;
    const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return true;
    const hay = `${x.stfNo} ${x.description} ${x.supplierName} ${x.projectName} ${x.queue} ${x.poNo || ''}`.toLowerCase();
    return tokens.every(t => hay.includes(t));
  };
  const sorted = [...stfs].filter(match).sort((a, b) => b.stfNo.localeCompare(a.stfNo));
  const mineCount = stfs.filter(x => x.status === 'pending' && sameName(x.queue, me)).length;
  const cols: { id: string; title: string; hint: string; tone: string; items: Stf[] }[] = [
    { id: 'pending', title: 'In approval', hint: 'with an approver', tone: 'border-amber-300 bg-amber-50/60', items: sorted.filter(x => x.status === 'pending') },
    { id: 'board', title: 'With the Board', hint: 'board decision', tone: 'border-violet-300 bg-violet-50/60', items: sorted.filter(x => x.status === 'board') },
    { id: 'ready', title: 'Approved — issue PO', hint: 'convert by typing the STF number', tone: 'border-emerald-300 bg-emerald-50/60', items: sorted.filter(x => x.status === 'approved' && !x.poId) },
    { id: 'done', title: 'PO issued', hint: 'converted', tone: 'border-slate-300 bg-slate-50', items: sorted.filter(x => x.status === 'approved' && !!x.poId).slice(0, 30) },
  ];
  const closed = sorted.filter(x => x.status === 'rejected' || x.status === 'cancelled');
  const Card: React.FC<{ x: Stf; ready?: boolean }> = ({ x, ready }) => {
    const t = stfTotals(x); const tier = budgetTier(x, settings); const mine = x.status === 'pending' && sameName(x.queue, me);
    const age = Math.max(0, -daysUntil((x.statusDate || x.date).slice(0, 10)));
    return (
      <div onClick={() => onOpen(x.id)} data-testid={`stf-row-${x.stfNo}`} className={`rounded-xl border bg-white p-3 cursor-pointer hover:shadow-md transition-shadow ${mine ? 'border-primary-500 ring-1 ring-primary-300' : 'border-slate-200'}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="font-mono text-xs font-black text-slate-900 break-all">{x.stfNo}</div>
          <span className={`shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-black border ${tier.above ? 'bg-amber-50 border-amber-300 text-amber-800' : 'bg-slate-50 border-slate-300 text-slate-600'}`}>{tier.label}</span>
        </div>
        <div className="text-xs font-semibold text-slate-800 mt-1 line-clamp-2">{x.description}</div>
        <div className="text-[11px] text-slate-500 mt-0.5 truncate">{x.supplierName}{x.projectName ? ` · ${x.projectName}` : ''}</div>
        <div className="flex items-end justify-between mt-2">
          <div className="font-mono text-sm font-black text-slate-900">{money(t.total)} <span className="text-[10px] font-sans font-bold text-slate-500">{x.currency}</span></div>
          <div className="text-[10px] text-slate-500 text-right">
            {x.status === 'pending' && <div className={`font-bold ${mine ? 'text-primary-700' : 'text-slate-700'}`}>{mine ? 'waiting for you' : x.queue}</div>}
            {x.poNo && <div className="font-mono font-bold text-slate-700">{x.poNo}</div>}
            <div>{age === 0 ? 'today' : `${age} day${age > 1 ? 's' : ''}`}</div>
          </div>
        </div>
        {ready && <button onClick={e => { e.stopPropagation(); onConvert(x); }} className={`${btn.green} w-full justify-center mt-2.5`} data-testid={`stf-convert-${x.stfNo}`}>Convert to PO <ArrowRight className="h-3.5 w-3.5" /></button>}
      </div>
    );
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]"><Search className="h-3.5 w-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search STF number, description, supplier, project…" className={`${inputCls} pl-8`} data-testid="stf-search" /></div>
        <button onClick={() => setMineOnly(v => !v)} className={`px-3 py-2 rounded-lg text-xs font-bold border cursor-pointer ${mineOnly ? 'bg-slate-800 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-600'}`}>Waiting for me{mineCount ? ` (${mineCount})` : ''}</button>
        <button onClick={onNew} className={btn.primary} data-testid="stf-new"><Plus className="h-3.5 w-3.5" /> New STF</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 items-start">
        {cols.map(c => (
          <div key={c.id} className={`rounded-2xl border p-2.5 space-y-2 ${c.tone}`}>
            <div className="px-1 flex items-baseline justify-between">
              <div><div className="text-xs font-black text-slate-900">{c.title}</div><div className="text-[10px] text-slate-500">{c.hint}</div></div>
              <div className="text-lg font-black font-mono text-slate-700">{c.items.length}</div>
            </div>
            {c.items.map(x => <Card key={x.id} x={x} ready={c.id === 'ready'} />)}
            {c.items.length === 0 && <div className="text-center text-[11px] text-slate-400 py-6">{stfs.length === 0 && c.id === 'pending' ? 'No STF yet — create the first one.' : 'Nothing here'}</div>}
          </div>
        ))}
      </div>
      {closed.length > 0 && (
        <div>
          <button onClick={() => setShowClosed(v => !v)} className="text-[11px] font-bold text-slate-500 hover:text-slate-800 cursor-pointer">{showClosed ? '▾' : '▸'} Rejected / cancelled ({closed.length})</button>
          {showClosed && <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mt-2 opacity-80">{closed.map(x => <Card key={x.id} x={x} />)}</div>}
        </div>
      )}
    </div>
  );
};

// ── Register — the STF – PO – PAYMENT sheet, live ────────────────────────────
const RegisterTab: React.FC<{ rows: ReturnType<typeof buildRegister>; onOpenStf: (id: string) => void; onOpenPo: (id: string) => void; onExport: () => void }> = ({ rows, onOpenStf, onOpenPo, onExport }) => {
  const [q, setQ] = useState('');
  const [pay, setPay] = useState('all');
  const [open, setOpen] = useState<Set<number>>(new Set());
  const shown = rows.filter(r => {
    if (pay !== 'all' && r.payStatus !== pay) return false;
    const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return true;
    const hay = `${r.stfNo} ${r.poNo} ${r.description} ${r.supplier} ${r.projectName} ${r.queue}`.toLowerCase();
    return tokens.every(t => hay.includes(t));
  });
  const pill = (txt: string, tone: string) => <span className={`px-1.5 py-0.5 rounded text-[10px] font-black ${tone}`}>{txt}</span>;
  const tone = (s: string) => ({ PAID: 'bg-emerald-100 text-emerald-800', 'PARTIAL PAID': 'bg-teal-100 text-teal-800', READY: 'bg-sky-100 text-sky-800', WAITING: 'bg-slate-100 text-slate-600', RECEIVED: 'bg-emerald-100 text-emerald-800', 'PARTIAL RECEIVED': 'bg-violet-100 text-violet-800', APPROVED: 'bg-emerald-100 text-emerald-800', PENDING: 'bg-amber-100 text-amber-800', BOARD: 'bg-violet-100 text-violet-800', CANCELLED: 'bg-slate-200 text-slate-600', REJECTED: 'bg-rose-100 text-rose-700' } as Record<string, string>)[s] || 'bg-slate-100 text-slate-600';
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-xs text-slate-500 flex-1 min-w-[260px]">The same columns as the company’s STF-PO-PAYMENT sheet — filled in automatically. Click a row for its items.</div>
        <div className="relative min-w-[220px]"><Search className="h-3.5 w-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" className={`${inputCls} pl-8`} data-testid="register-search" /></div>
        <select value={pay} onChange={e => setPay(e.target.value)} className="bg-slate-100 border border-slate-300 rounded-lg px-2 py-2 text-xs text-slate-900"><option value="all">All payment statuses</option>{['WAITING', 'READY', 'PARTIAL PAID', 'PAID'].map(s => <option key={s} value={s}>{s}</option>)}</select>
        <button onClick={onExport} className={btn.green} data-testid="register-export"><Download className="h-3.5 w-3.5" /> Excel (sheet layout)</button>
      </div>
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full min-w-[1400px] text-[11px]">
          <thead><tr className="bg-amber-400/80 text-slate-900 uppercase text-[10px]">
            {['No', 'Date', 'STF Number', 'STF Description', 'PO Number', 'Company', 'Project', 'STF Status', 'Budget', 'Que', 'Payment Terms', 'Delivery', 'Delivery Note / Invoice', 'Payment', 'Paid Amount', 'Payment Details'].map(h => <th key={h} className="text-left px-2 py-2 whitespace-nowrap">{h}</th>)}
          </tr></thead>
          <tbody>
            {shown.map(r => {
              const cancelled = r.stfStatus === 'CANCELLED' || r.stfStatus === 'REJECTED';
              const isOpen = open.has(r.no);
              return (
                <React.Fragment key={r.no}>
                  <tr onClick={() => setOpen(o => { const n = new Set(o); n.has(r.no) ? n.delete(r.no) : n.add(r.no); return n; })} className={`border-t border-slate-200 hover:bg-slate-50 cursor-pointer ${cancelled ? 'bg-slate-100 text-slate-400' : ''}`}>
                    <td className="px-2 py-2">{r.no}</td><td className="px-2 py-2 whitespace-nowrap">{dateFmt(r.date)}</td>
                    <td className="px-2 py-2 font-mono font-bold">{r.stf ? <button onClick={e => { e.stopPropagation(); onOpenStf(r.stf!.id); }} className="text-primary-700 hover:underline cursor-pointer">{r.stfNo}</button> : '—'}</td>
                    <td className="px-2 py-2 max-w-[220px]">{r.description}</td>
                    <td className="px-2 py-2 font-mono font-bold">{r.po ? <button onClick={e => { e.stopPropagation(); onOpenPo(r.po!.id); }} className="text-primary-700 hover:underline cursor-pointer">{r.poNo}</button> : cancelled ? 'CANCELLED' : '—'}</td>
                    <td className="px-2 py-2">{cancelled ? '' : r.supplier}</td>
                    <td className="px-2 py-2">{cancelled ? '' : <>{r.projectType}<div className="text-[10px] text-slate-500">{r.projectName}</div></>}</td>
                    <td className="px-2 py-2">{r.stfStatus && pill(r.stfStatus, tone(r.stfStatus))}<div className="text-[10px] text-slate-500">{dateFmt(r.lastStatusDate)}</div></td>
                    <td className="px-2 py-2 whitespace-nowrap">{r.budget}</td><td className="px-2 py-2 whitespace-nowrap font-bold">{r.queue}</td>
                    <td className="px-2 py-2 max-w-[160px]">{r.paymentTerms}</td>
                    <td className="px-2 py-2 whitespace-nowrap">{r.delivery ? <>{pill(r.delivery.status, tone(r.delivery.status))}<div className="text-[10px] text-slate-500">{dateFmt(r.delivery.lastDate)}</div></> : ''}</td>
                    <td className="px-2 py-2">{r.delivery ? <>{r.delivery.docType}<div className="font-mono text-[10px] text-slate-500">{r.delivery.docNos}</div></> : ''}</td>
                    <td className="px-2 py-2 whitespace-nowrap">{r.payStatus && pill(r.payStatus, tone(r.payStatus))}<div className="text-[10px] text-slate-500">{dateFmt(r.payDate)}</div></td>
                    <td className="px-2 py-2 text-right font-mono">{r.paidAmount ? money(r.paidAmount) : ''}</td>
                    <td className="px-2 py-2 whitespace-pre-line max-w-[200px]">{r.paymentDetails}</td>
                  </tr>
                  {isOpen && !cancelled && (
                    <tr className="bg-slate-50"><td colSpan={16} className="px-4 py-3">
                      <table className="text-[11px] w-full max-w-4xl">
                        <thead><tr className="text-slate-500 uppercase text-[10px]"><th className="text-left pr-3">Code</th><th className="text-left pr-3">Description</th><th className="text-right pr-3">Qty</th><th className="text-left pr-3">Unit</th><th className="text-right pr-3">Unit price</th><th className="text-right pr-3">Total</th><th className="text-right pr-3">Received</th><th className="text-right">Balance</th></tr></thead>
                        <tbody>{r.items.map((it, i) => <tr key={i} className="border-t border-slate-200"><td className="pr-3 font-mono text-[10px]">{it.code}</td><td className="pr-3 font-semibold">{it.description}</td><td className="pr-3 text-right font-mono">{qtyFmt(it.qty)}</td><td className="pr-3">{it.unit}</td><td className="pr-3 text-right font-mono">{money(it.unitPrice)}</td><td className="pr-3 text-right font-mono">{money(it.total)}</td><td className="pr-3 text-right font-mono text-emerald-700">{qtyFmt(it.received)}</td><td className={`text-right font-mono ${it.balance > 0 ? 'text-amber-700 font-bold' : 'text-slate-400'}`}>{qtyFmt(it.balance)}</td></tr>)}</tbody>
                        <tfoot><tr className="border-t border-slate-300"><td colSpan={5} className="text-right pr-3 font-bold text-slate-500">TOTAL</td><td className="text-right pr-3 font-mono">{money(r.subtotal)}</td></tr>
                          <tr><td colSpan={5} className="text-right pr-3 font-bold text-slate-500">VAT {r.vatText}</td><td className="text-right pr-3 font-mono">{money(r.vat)}</td></tr>
                          <tr><td colSpan={5} className="text-right pr-3 font-black">G. TOTAL{r.currency !== 'AED' ? ` (${r.currency})` : ''}</td><td className="text-right pr-3 font-mono font-black">{money(r.total)}</td></tr></tfoot>
                      </table>
                    </td></tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
        {shown.length === 0 && <div className="text-center text-slate-500 text-sm py-10">{rows.length === 0 ? 'Nothing recorded yet.' : 'No row matches.'}</div>}
      </div>
    </div>
  );
};

export default ProcurementPortal;
