import React, { useMemo, useState } from 'react';
import { Plus, Download, Search, X, Pencil, Trash2, AlertTriangle } from 'lucide-react';
import * as XLSX from 'xlsx';
import type { Supplier, SupplierStatus, IncomingMaterial, Material } from '../types';
import { buildSupplierStats, acceptanceTone, type SupplierStats } from '../lib/suppliers';
import { dbSaveSupplier, dbDeleteSupplier, SupplierError } from '../lib/firebaseService';

interface Props {
  suppliers: Supplier[];
  incoming: IncomingMaterial[];
  materials: Material[];
  currentUserName: string;
  onChanged: () => void;
  onOpenMaterial: (m: Material) => void;
}

const STATUS_META: Record<SupplierStatus, { label: string; cls: string }> = {
  active: { label: 'Active', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  on_hold: { label: 'On hold', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  blocked: { label: 'Blocked', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
};
const TONE_CLS = {
  good: 'text-emerald-700', warn: 'text-amber-700', bad: 'text-rose-700', none: 'text-slate-500',
};
const PAYMENT_TERMS = ['Advance', 'Cash on delivery', 'Net 15', 'Net 30', 'Net 45', 'Net 60', 'Net 90', 'PDC'];

const fmt = (n: number) => (Math.round(n * 1000) / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 });
const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

type FormState = {
  id?: string; name: string; status: SupplierStatus; category: string;
  contactPerson: string; phone: string; email: string; website: string;
  address: string; city: string; country: string;
  taxNo: string; paymentTerms: string; currency: string; creditLimit: string; leadTimeDays: string;
  bankName: string; iban: string; notes: string;
};
const emptyForm = (name = ''): FormState => ({
  name, status: 'active', category: '', contactPerson: '', phone: '', email: '', website: '',
  address: '', city: '', country: 'UAE', taxNo: '', paymentTerms: '', currency: 'AED', creditLimit: '', leadTimeDays: '',
  bankName: '', iban: '', notes: '',
});
const toForm = (s: Supplier): FormState => ({
  id: s.id, name: s.name, status: s.status || 'active', category: s.category || '',
  contactPerson: s.contactPerson || '', phone: s.phone || '', email: s.email || '', website: s.website || '',
  address: s.address || '', city: s.city || '', country: s.country || '',
  taxNo: s.taxNo || '', paymentTerms: s.paymentTerms || '', currency: s.currency || '',
  creditLimit: s.creditLimit != null ? String(s.creditLimit) : '', leadTimeDays: s.leadTimeDays != null ? String(s.leadTimeDays) : '',
  bankName: s.bankName || '', iban: s.iban || '', notes: s.notes || '',
});
const orNull = (v: string) => (v.trim() ? v.trim() : null);

export const SuppliersPage: React.FC<Props> = ({ suppliers, incoming, materials, currentUserName, onChanged, onOpenMaterial }) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | SupplierStatus>('all');
  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<'overview' | 'materials' | 'receipts'>('overview');
  const [importing, setImporting] = useState(false);

  const { stats, unregistered } = useMemo(
    () => buildSupplierStats(suppliers, incoming, materials),
    [suppliers, incoming, materials],
  );

  const q = search.trim().toLowerCase();
  const shown = useMemo(() => stats
    .filter((st) => statusFilter === 'all' || st.supplier.status === statusFilter)
    .filter((st) => {
      if (!q) return true;
      const s = st.supplier;
      return [s.name, s.code, s.category, s.contactPerson, s.phone, s.email, s.taxNo, s.city, s.country]
        .filter(Boolean).join(' ').toLowerCase().includes(q);
    })
    .sort((a, b) => a.supplier.name.localeCompare(b.supplier.name)),
  [stats, statusFilter, q]);

  const detail: SupplierStats | undefined = stats.find((st) => st.supplier.id === detailId);

  const openNew = (name = '') => { setFormError(null); setForm(emptyForm(name)); };
  const openEdit = (s: Supplier) => { setFormError(null); setForm(toForm(s)); };
  const set = (k: keyof FormState, v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const save = async () => {
    if (!form) return;
    if (!form.name.trim()) { setFormError('Supplier name is required.'); return; }
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) { setFormError('That email address does not look right.'); return; }
    const credit = form.creditLimit.trim() === '' ? null : Number(form.creditLimit);
    const lead = form.leadTimeDays.trim() === '' ? null : Number(form.leadTimeDays);
    if ((credit != null && (!Number.isFinite(credit) || credit < 0)) || (lead != null && (!Number.isFinite(lead) || lead < 0))) {
      setFormError('Credit limit and lead time must be positive numbers.'); return;
    }
    setSaving(true); setFormError(null);
    try {
      await dbSaveSupplier({
        id: form.id, name: form.name, status: form.status,
        category: orNull(form.category), contactPerson: orNull(form.contactPerson), phone: orNull(form.phone),
        email: orNull(form.email), website: orNull(form.website), address: orNull(form.address),
        city: orNull(form.city), country: orNull(form.country), taxNo: orNull(form.taxNo),
        paymentTerms: orNull(form.paymentTerms), currency: orNull(form.currency), creditLimit: credit,
        leadTimeDays: lead, bankName: orNull(form.bankName), iban: orNull(form.iban), notes: orNull(form.notes),
      }, currentUserName);
      setForm(null);
      onChanged();
    } catch (e: any) {
      setFormError(e instanceof SupplierError ? e.message : (e?.message || 'Could not save the supplier.'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (st: SupplierStats) => {
    const warn = st.receiptCount > 0
      ? `"${st.supplier.name}" has ${st.receiptCount} receipt(s) on file. Their history stays, but the supplier profile will be removed.\n\nTip: use status "Blocked" instead if you just want to stop buying from them.\n\nDelete anyway?`
      : `Delete supplier "${st.supplier.name}"?`;
    if (!window.confirm(warn)) return;
    await dbDeleteSupplier(st.supplier.id);
    if (detailId === st.supplier.id) setDetailId(null);
    onChanged();
  };

  const addAllUnregistered = async () => {
    if (!window.confirm(`Create ${unregistered.length} supplier record(s) from the names already used on your receipts and materials? You can fill in their details afterwards.`)) return;
    setImporting(true);
    try {
      for (const u of unregistered) await dbSaveSupplier({ name: u.name, status: 'active' }, currentUserName); // one at a time so codes stay unique
    } finally {
      setImporting(false);
      onChanged();
    }
  };

  const exportList = () => {
    const rows = shown.map((st) => ({
      Code: st.supplier.code, Supplier: st.supplier.name, Status: STATUS_META[st.supplier.status || 'active'].label,
      Category: st.supplier.category || '', 'Contact Person': st.supplier.contactPerson || '', Phone: st.supplier.phone || '',
      Email: st.supplier.email || '', Website: st.supplier.website || '', Address: st.supplier.address || '',
      City: st.supplier.city || '', Country: st.supplier.country || '', 'Tax / TRN': st.supplier.taxNo || '',
      'Payment Terms': st.supplier.paymentTerms || '', Currency: st.supplier.currency || '',
      'Credit Limit': st.supplier.creditLimit ?? '', 'Lead Time (days)': st.supplier.leadTimeDays ?? '',
      'Bank': st.supplier.bankName || '', IBAN: st.supplier.iban || '',
      Receipts: st.receiptCount, 'Last Receipt': fmtDate(st.lastReceiptAt),
      'QC Acceptance %': st.acceptancePct == null ? '' : Math.round(st.acceptancePct * 10) / 10,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ Code: '', Supplier: '' }]), 'Suppliers');
    XLSX.writeFile(wb, `Suppliers_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const exportReceipts = (st: SupplierStats) => {
    const rows = st.receipts.map((r) => ({
      Date: fmtDate(r.receivedAt), Material: r.materialName, Qty: Number(r.qty), Unit: r.unit,
      Invoice: r.invoiceNo || '', Batch: r.batchNo || '', 'QC Status': (r.qcStatus || 'pending').toUpperCase(),
      Passed: r.qtyPassed ?? '', Rejected: r.qtyFailed ?? '', Hold: r.qtyHold ?? '', 'Received By': r.receivedByName,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ Date: '' }]), 'Receipts');
    XLSX.writeFile(wb, `${st.supplier.code}_${st.supplier.name.replace(/[^a-z0-9]+/gi, '_').slice(0, 30)}_receipts.xlsx`);
  };

  const chip = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all ${active ? 'bg-primary-600 text-white shadow' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`;
  const input = 'bg-slate-100 border border-slate-300 rounded-lg px-2.5 py-2 text-xs text-slate-900 w-full';
  const label = 'text-[10px] uppercase font-bold text-slate-500 mb-1 block';
  const statusPill = (s: SupplierStatus) => (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase border ${STATUS_META[s || 'active'].cls}`}>{STATUS_META[s || 'active'].label}</span>
  );
  const accept = (st: SupplierStats) => st.acceptancePct == null
    ? <span className="text-slate-400">—</span>
    : <span className={`font-mono font-bold ${TONE_CLS[acceptanceTone(st.acceptancePct)]}`}>{st.acceptancePct.toFixed(1)}%</span>;

  const activeCount = suppliers.filter((s) => (s.status || 'active') === 'active').length;
  const restrictedCount = suppliers.length - activeCount;

  return (
    <div className="bg-white border border-slate-200 rounded-xl" data-testid="suppliers-page">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-200">
        <div>
          <h3 className="text-sm font-black text-slate-900">Suppliers</h3>
          <div className="text-[11px] text-slate-500">Your approved vendor list — contacts, payment terms, and how each supplier's deliveries perform at quality inspection.</div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportList} data-testid="suppliers-export" className="flex items-center gap-1.5 px-3 py-2 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg text-xs font-bold cursor-pointer">
            <Download className="h-3.5 w-3.5" /> Excel
          </button>
          <button onClick={() => openNew()} data-testid="supplier-add" className="flex items-center gap-1.5 px-3 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-xs font-bold cursor-pointer">
            <Plus className="h-3.5 w-3.5" /> Add Supplier
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 py-3 border-b border-slate-200">
        {[
          { label: 'Suppliers', value: suppliers.length, cls: 'text-slate-900' },
          { label: 'Active', value: activeCount, cls: 'text-emerald-700' },
          { label: 'On hold / blocked', value: restrictedCount, cls: restrictedCount ? 'text-rose-700' : 'text-slate-500' },
          { label: 'Not yet in list', value: unregistered.length, cls: unregistered.length ? 'text-amber-700' : 'text-slate-500' },
        ].map((c) => (
          <div key={c.label} className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
            <div className="text-[10px] uppercase font-bold text-slate-500">{c.label}</div>
            <div className={`font-mono font-black text-base ${c.cls}`} data-testid={`suppliers-kpi-${c.label.split(' ')[0].toLowerCase()}`}>{c.value}</div>
          </div>
        ))}
      </div>

      {unregistered.length > 0 && (
        <div className="mx-4 mt-3 p-3 rounded-xl border border-amber-200 bg-amber-50" data-testid="suppliers-unregistered">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2 text-xs font-bold text-amber-700">
              <AlertTriangle className="h-4 w-4" /> {unregistered.length} supplier name{unregistered.length > 1 ? 's are' : ' is'} used on receipts or materials but not in your supplier list
            </div>
            <button onClick={addAllUnregistered} disabled={importing} data-testid="suppliers-add-all" className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-lg text-[11px] font-bold cursor-pointer">
              {importing ? 'Adding…' : `Add all ${unregistered.length}`}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {unregistered.slice(0, 30).map((u) => (
              <button key={u.name} onClick={() => openNew(u.name)} title="Add this supplier and fill in their details" className="px-2.5 py-1 rounded-full bg-slate-100 hover:bg-slate-200 border border-slate-300 text-[11px] text-slate-800 cursor-pointer">
                + {u.name} <span className="text-slate-500">· {u.receipts} receipt{u.receipts === 1 ? '' : 's'}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="px-4 py-3 flex flex-wrap items-center gap-2">
        {(['all', 'active', 'on_hold', 'blocked'] as const).map((s) => (
          <button key={s} onClick={() => setStatusFilter(s)} className={chip(statusFilter === s)}>{s === 'all' ? 'All' : STATUS_META[s].label}</button>
        ))}
        <div className="relative ml-auto">
          <Search className="h-3.5 w-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, code, contact, phone, TRN…" data-testid="suppliers-search"
            className="bg-slate-100 border border-slate-300 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-900 w-72" />
        </div>
      </div>

      <div className="overflow-auto max-h-[64vh] px-4 pb-4">
        <table className="w-full text-xs min-w-[980px]">
          <thead className="sticky top-0 bg-white z-10">
            <tr className="text-[10px] uppercase text-slate-500">
              <th className="text-left py-2 pr-3">Code</th>
              <th className="text-left py-2 pr-3">Supplier</th>
              <th className="text-left py-2 pr-3">Contact</th>
              <th className="text-left py-2 pr-3">Payment terms</th>
              <th className="text-right py-2 pr-3">Receipts</th>
              <th className="text-left py-2 pr-3">Last receipt</th>
              <th className="text-right py-2 pr-3">QC acceptance</th>
              <th className="text-center py-2 pr-3">Status</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((st) => {
              const s = st.supplier;
              return (
                <tr key={s.id} data-testid={`supplier-row-${s.code}`} className="border-t border-slate-200 hover:bg-slate-50">
                  <td className="py-2 pr-3 font-mono text-slate-500">{s.code}</td>
                  <td className="py-2 pr-3 min-w-[170px]">
                    <button onClick={() => { setDetailId(s.id); setDetailTab('overview'); }} className="text-left text-slate-900 font-semibold hover:text-primary-700 hover:underline decoration-dotted underline-offset-2 cursor-pointer">{s.name}</button>
                    {s.category && <div className="text-[10px] text-slate-500">{s.category}</div>}
                  </td>
                  <td className="py-2 pr-3 text-slate-700">
                    {s.contactPerson || '—'}
                    {s.phone && <div className="text-[10px] text-slate-500 font-mono">{s.phone}</div>}
                    {s.email && <div className="text-[10px] text-slate-500">{s.email}</div>}
                  </td>
                  <td className="py-2 pr-3 text-slate-700">{s.paymentTerms || '—'}</td>
                  <td className="py-2 pr-3 text-right font-mono text-slate-700">{st.receiptCount}</td>
                  <td className="py-2 pr-3 text-slate-500 whitespace-nowrap">{fmtDate(st.lastReceiptAt)}</td>
                  <td className="py-2 pr-3 text-right">{accept(st)}</td>
                  <td className="py-2 pr-3 text-center">{statusPill(s.status)}</td>
                  <td className="py-2 text-right whitespace-nowrap">
                    <button onClick={() => { setDetailId(s.id); setDetailTab('overview'); }} className="text-sky-700 hover:text-sky-700 text-[11px] font-bold cursor-pointer mr-3">View</button>
                    <button onClick={() => openEdit(s)} data-testid={`supplier-edit-${s.code}`} className="text-slate-500 hover:text-emerald-700 cursor-pointer mr-3" title="Edit"><Pencil className="h-3.5 w-3.5 inline" /></button>
                    <button onClick={() => remove(st)} className="text-slate-500 hover:text-rose-700 cursor-pointer" title="Delete"><Trash2 className="h-3.5 w-3.5 inline" /></button>
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr><td colSpan={9} className="text-center text-slate-500 py-12">
                {suppliers.length === 0 ? 'No suppliers yet — click “Add Supplier” to create your first one.' : 'No suppliers match your search.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ---------- SUPPLIER DETAIL ---------- */}
      {detail && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-3 z-50" data-testid="supplier-detail">
          <div className="bg-white border border-slate-300 rounded-2xl w-full max-w-5xl shadow-2xl max-h-[92vh] flex flex-col">
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-200">
              <div>
                <div className="text-[10px] uppercase font-bold text-slate-500">{detail.supplier.code}{detail.supplier.category ? ` · ${detail.supplier.category}` : ''}</div>
                <h2 className="text-lg font-black text-slate-900">{detail.supplier.name}</h2>
                <div className="mt-1">{statusPill(detail.supplier.status)}</div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => openEdit(detail.supplier)} className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-bold cursor-pointer"><Pencil className="h-3.5 w-3.5" /> Edit</button>
                <button onClick={() => setDetailId(null)} data-testid="supplier-detail-close" className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-lg cursor-pointer"><X className="h-4 w-4" /></button>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 px-5 py-3 border-b border-slate-200">
              {[
                { label: 'Receipts', value: String(detail.receiptCount) },
                { label: 'Materials', value: String(detail.materials.length) },
                { label: 'Last receipt', value: fmtDate(detail.lastReceiptAt) },
                { label: 'Rejected / on hold', value: `${fmt(detail.qtyFailed + detail.qtyHold)} of ${fmt(detail.qtyReceived)}` },
              ].map((c) => (
                <div key={c.label} className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                  <div className="text-[10px] uppercase font-bold text-slate-500">{c.label}</div>
                  <div className="font-mono font-black text-sm text-slate-900">{c.value}</div>
                </div>
              ))}
              <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                <div className="text-[10px] uppercase font-bold text-slate-500">QC acceptance</div>
                <div className="font-black text-base" data-testid="supplier-detail-acceptance">{accept(detail)}</div>
              </div>
            </div>

            <div className="px-5 pt-3 flex gap-2">
              {(['overview', 'materials', 'receipts'] as const).map((t) => (
                <button key={t} onClick={() => setDetailTab(t)} data-testid={`supplier-tab-${t}`} className={chip(detailTab === t)}>
                  {t === 'overview' ? 'Details' : t === 'materials' ? `Materials (${detail.materials.length})` : `Receipts (${detail.receiptCount})`}
                </button>
              ))}
              {detailTab === 'receipts' && detail.receiptCount > 0 && (
                <button onClick={() => exportReceipts(detail)} className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg text-xs font-bold cursor-pointer"><Download className="h-3.5 w-3.5" /> Excel</button>
              )}
            </div>

            <div className="overflow-auto flex-1 px-5 py-4">
              {detailTab === 'overview' && (
                <div className="grid md:grid-cols-2 gap-x-8 gap-y-5 text-xs">
                  {[
                    { title: 'Contact', rows: [['Contact person', detail.supplier.contactPerson], ['Phone', detail.supplier.phone], ['Email', detail.supplier.email], ['Website', detail.supplier.website]] },
                    { title: 'Address', rows: [['Address', detail.supplier.address], ['City', detail.supplier.city], ['Country', detail.supplier.country]] },
                    { title: 'Commercial', rows: [['Tax / TRN', detail.supplier.taxNo], ['Payment terms', detail.supplier.paymentTerms], ['Currency', detail.supplier.currency], ['Credit limit', detail.supplier.creditLimit != null ? fmt(detail.supplier.creditLimit) : null], ['Lead time', detail.supplier.leadTimeDays != null ? `${detail.supplier.leadTimeDays} days` : null]] },
                    { title: 'Bank', rows: [['Bank', detail.supplier.bankName], ['IBAN', detail.supplier.iban]] },
                  ].map((blk) => (
                    <div key={blk.title}>
                      <div className="text-[10px] uppercase font-bold text-slate-500 mb-2">{blk.title}</div>
                      <table className="w-full"><tbody>
                        {blk.rows.map(([k, v]) => (
                          <tr key={k as string} className="border-t border-slate-200">
                            <td className="py-1.5 pr-3 text-slate-500 w-32">{k}</td>
                            <td className="py-1.5 text-slate-800 break-words">{(v as string) || '—'}</td>
                          </tr>
                        ))}
                      </tbody></table>
                    </div>
                  ))}
                  {detail.supplier.notes && (
                    <div className="md:col-span-2">
                      <div className="text-[10px] uppercase font-bold text-slate-500 mb-1">Notes</div>
                      <div className="text-slate-700 whitespace-pre-wrap">{detail.supplier.notes}</div>
                    </div>
                  )}
                  <div className="md:col-span-2 text-[10px] text-slate-400">
                    Added {fmtDate(detail.supplier.createdAt)}{detail.supplier.createdByName ? ` by ${detail.supplier.createdByName}` : ''}
                    {detail.supplier.updatedAt && detail.supplier.updatedAt !== detail.supplier.createdAt ? ` · last updated ${fmtDate(detail.supplier.updatedAt)}` : ''}
                  </div>
                </div>
              )}

              {detailTab === 'materials' && (
                <table className="w-full text-xs">
                  <thead><tr className="text-[10px] uppercase text-slate-500">
                    <th className="text-left py-2 pr-3">Material</th>
                    <th className="text-right py-2 pr-3">Received (QC passed)</th>
                    <th className="text-left py-2 pr-3">Last received</th>
                    <th className="text-right py-2">In stock now</th>
                  </tr></thead>
                  <tbody>
                    {detail.materials.map((m) => {
                      const mat = materials.find((x) => x.id === m.materialId);
                      return (
                        <tr key={m.materialId} className="border-t border-slate-200 hover:bg-slate-50">
                          <td className="py-2 pr-3">
                            <button onClick={() => mat && onOpenMaterial(mat)} title="Open this material's stock ledger" className="text-slate-800 font-semibold hover:text-primary-700 hover:underline decoration-dotted underline-offset-2 cursor-pointer text-left">{m.name}</button>
                            {m.listed && <span className="ml-2 text-[10px] text-slate-500">listed supplier</span>}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono text-emerald-700">{m.totalReceived ? `+${fmt(m.totalReceived)} ${m.unit}` : '—'}</td>
                          <td className="py-2 pr-3 text-slate-500">{fmtDate(m.lastReceivedAt)}</td>
                          <td className="py-2 text-right font-mono text-slate-800">{fmt(m.currentStock)} {m.unit}</td>
                        </tr>
                      );
                    })}
                    {detail.materials.length === 0 && <tr><td colSpan={4} className="text-center text-slate-500 py-10">No materials linked to this supplier yet.</td></tr>}
                  </tbody>
                </table>
              )}

              {detailTab === 'receipts' && (
                <table className="w-full text-xs">
                  <thead><tr className="text-[10px] uppercase text-slate-500">
                    <th className="text-left py-2 pr-3">Date</th>
                    <th className="text-left py-2 pr-3">Material</th>
                    <th className="text-right py-2 pr-3">Qty</th>
                    <th className="text-left py-2 pr-3">Invoice</th>
                    <th className="text-left py-2 pr-3">Batch</th>
                    <th className="text-left py-2 pr-3">QC</th>
                    <th className="text-right py-2 pr-3">Passed</th>
                    <th className="text-right py-2">Rejected</th>
                  </tr></thead>
                  <tbody>
                    {detail.receipts.map((r) => (
                      <tr key={r.id} className="border-t border-slate-200 hover:bg-slate-50">
                        <td className="py-2 pr-3 text-slate-500 whitespace-nowrap">{fmtDate(r.receivedAt)}</td>
                        <td className="py-2 pr-3 text-slate-800 font-semibold">{r.materialName}</td>
                        <td className="py-2 pr-3 text-right font-mono text-slate-800">{fmt(Number(r.qty))} {r.unit}</td>
                        <td className="py-2 pr-3 text-slate-500 font-mono">{r.invoiceNo || '—'}</td>
                        <td className="py-2 pr-3 text-slate-500 font-mono">{r.batchNo || '—'}</td>
                        <td className="py-2 pr-3 text-slate-700 uppercase text-[10px] font-bold">{r.qcStatus || 'pending'}</td>
                        <td className="py-2 pr-3 text-right font-mono text-emerald-700">{r.qtyPassed != null ? fmt(Number(r.qtyPassed)) : '—'}</td>
                        <td className="py-2 text-right font-mono text-rose-700">{r.qtyFailed ? fmt(Number(r.qtyFailed)) : '—'}</td>
                      </tr>
                    ))}
                    {detail.receipts.length === 0 && <tr><td colSpan={8} className="text-center text-slate-500 py-10">No receipts from this supplier yet. Receipts are linked by supplier name when material is logged under Incoming.</td></tr>}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ---------- ADD / EDIT FORM ---------- */}
      {form && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-3 z-[60]" data-testid="supplier-form">
          <div className="bg-white border border-slate-300 rounded-2xl w-full max-w-3xl shadow-2xl max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <h2 className="text-base font-black text-slate-900">{form.id ? 'Edit Supplier' : 'Add Supplier'}</h2>
              <button onClick={() => setForm(null)} className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-lg cursor-pointer"><X className="h-4 w-4" /></button>
            </div>
            <div className="overflow-auto px-5 py-4 space-y-5">
              <div>
                <div className="text-[10px] uppercase font-black text-primary-700 mb-2">General</div>
                <div className="grid md:grid-cols-3 gap-3">
                  <div className="md:col-span-2"><label className={label}>Supplier name *</label><input data-testid="sf-name" value={form.name} onChange={(e) => set('name', e.target.value)} className={input} autoFocus /></div>
                  <div><label className={label}>Status</label>
                    <select data-testid="sf-status" value={form.status} onChange={(e) => set('status', e.target.value)} className={input}>
                      <option value="active">Active</option><option value="on_hold">On hold</option><option value="blocked">Blocked</option>
                    </select></div>
                  <div className="md:col-span-3"><label className={label}>Category (what they supply)</label><input value={form.category} onChange={(e) => set('category', e.target.value)} placeholder="e.g. Resin, Steel, Paint, Fasteners" className={input} /></div>
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase font-black text-primary-700 mb-2">Contact</div>
                <div className="grid md:grid-cols-2 gap-3">
                  <div><label className={label}>Contact person</label><input value={form.contactPerson} onChange={(e) => set('contactPerson', e.target.value)} className={input} /></div>
                  <div><label className={label}>Phone</label><input data-testid="sf-phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} className={input} /></div>
                  <div><label className={label}>Email</label><input data-testid="sf-email" value={form.email} onChange={(e) => set('email', e.target.value)} className={input} /></div>
                  <div><label className={label}>Website</label><input value={form.website} onChange={(e) => set('website', e.target.value)} className={input} /></div>
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase font-black text-primary-700 mb-2">Address</div>
                <div className="grid md:grid-cols-3 gap-3">
                  <div className="md:col-span-3"><label className={label}>Address</label><input value={form.address} onChange={(e) => set('address', e.target.value)} className={input} /></div>
                  <div><label className={label}>City</label><input value={form.city} onChange={(e) => set('city', e.target.value)} className={input} /></div>
                  <div><label className={label}>Country</label><input value={form.country} onChange={(e) => set('country', e.target.value)} className={input} /></div>
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase font-black text-primary-700 mb-2">Commercial</div>
                <div className="grid md:grid-cols-3 gap-3">
                  <div><label className={label}>Tax / TRN number</label><input value={form.taxNo} onChange={(e) => set('taxNo', e.target.value)} className={input} /></div>
                  <div><label className={label}>Payment terms</label>
                    <input list="supplier-terms" value={form.paymentTerms} onChange={(e) => set('paymentTerms', e.target.value)} placeholder="e.g. Net 30" className={input} />
                    <datalist id="supplier-terms">{PAYMENT_TERMS.map((t) => <option key={t} value={t} />)}</datalist></div>
                  <div><label className={label}>Currency</label><input value={form.currency} onChange={(e) => set('currency', e.target.value)} className={input} /></div>
                  <div><label className={label}>Credit limit</label><input type="number" min={0} value={form.creditLimit} onChange={(e) => set('creditLimit', e.target.value)} className={input} /></div>
                  <div><label className={label}>Lead time (days)</label><input type="number" min={0} value={form.leadTimeDays} onChange={(e) => set('leadTimeDays', e.target.value)} className={input} /></div>
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase font-black text-primary-700 mb-2">Bank</div>
                <div className="grid md:grid-cols-2 gap-3">
                  <div><label className={label}>Bank name</label><input value={form.bankName} onChange={(e) => set('bankName', e.target.value)} className={input} /></div>
                  <div><label className={label}>IBAN</label><input value={form.iban} onChange={(e) => set('iban', e.target.value)} className={input} /></div>
                </div>
              </div>
              <div><label className={label}>Notes</label><textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={3} className={input} /></div>
              {form.id && (
                <p className="text-[11px] text-slate-500">
                  Receipts and materials are linked to a supplier by name. If you rename this supplier, older receipts keep the old name and will show as “not yet in list”.
                </p>
              )}
            </div>
            <div className="px-5 py-4 border-t border-slate-200 flex items-center justify-between gap-3">
              <div className="text-xs text-rose-700 min-h-[1rem]" data-testid="sf-error">{formError}</div>
              <div className="flex gap-2">
                <button onClick={() => setForm(null)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold cursor-pointer">Cancel</button>
                <button onClick={save} disabled={saving} data-testid="sf-save" className="px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold cursor-pointer">{saving ? 'Saving…' : form.id ? 'Save changes' : 'Add supplier'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
