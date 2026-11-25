import React, { useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Download, Wallet, Receipt, Coffee, HandCoins, Paperclip, ExternalLink } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip } from 'recharts';
import { Employee } from '../../types';
import {
  useHRCollection, HRExpense, HRPettyCash, HRExpenseBudgets, HRFile, DEFAULT_EXPENSE_BUDGETS, EXPENSE_CATEGORIES, EXPENSE_METHODS,
  newId, todayStr, monthStr, fmtD, fmtAED, logAudit,
} from '../../lib/hrStore';
import { uploadHRFile, deleteHRFile, fmtBytes, HR_MAX_FILES_PER_RECORD } from '../../lib/hrFiles';
import { exportToExcel, exportTablePdf } from '../../lib/exportUtils';
import { chartTokens, chartAxisDefaults } from '../../lib/chartTokens';
import { ImportButton } from './ExcelImport';
import { FilePicker } from './DocumentsVault';
import { EmployeeSearchSelect } from './EmployeeSearchSelect';
import { Modal, Field, inputCls, btnPrimary, btnGhost, StatCard, Badge, Empty, SearchBox, SubTabs, SectionCard, runSave, useConfirm, hrToast } from './hrUi';

interface Props { employees: Employee[]; user?: string }

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (s: string) => { const n = parseFloat(s); return isNaN(n) ? 0 : n; };
const isPantry = (c: string) => c.startsWith('Pantry');
const monthName = (m: string) => new Date(m + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const shortMonth = (m: string) => new Date(m + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'short' });
const lastMonths = (n: number) => Array.from({ length: n }, (_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - (n - 1 - i)); return monthStr(d); });

export const Expenses: React.FC<Props> = ({ employees, user }) => {
  const expC = useHRCollection<HRExpense>('hrExpenses');
  const pettyC = useHRCollection<HRPettyCash>('hrPettyCash');
  const budC = useHRCollection<HRExpenseBudgets>('hrExpenseBudgets');
  const budgets: HRExpenseBudgets = { ...DEFAULT_EXPENSE_BUDGETS, ...(budC.items.find(b => b.id === 'budgets') || {}) };
  const [tab, setTab] = useState('overview');
  const [month, setMonth] = useState(monthStr());

  // Petty cash balance = float + top-ups − returns − expenses paid from petty cash
  const pettyBalance = useMemo(() => {
    const inflow = pettyC.items.reduce((s, p) => s + (p.kind === 'Return to cash' ? -p.amount : p.amount), 0);
    const out = expC.items.filter(e => e.method === 'Petty cash').reduce((s, e) => s + e.total, 0);
    return round2(inflow - out);
  }, [pettyC.items, expC.items]);
  const toReimburse = useMemo(() => expC.items.filter(e => e.method === 'Paid by employee (to reimburse)' && !e.reimbursed), [expC.items]);

  const props = { employees, user, expC, pettyC, budgets, budC, pettyBalance, toReimburse, month, setMonth, setTab };
  return (
    <div className="space-y-4">
      <SubTabs active={tab} onChange={setTab} tabs={[{ id: 'overview', label: 'Overview' }, { id: 'list', label: 'Expenses' }, { id: 'petty', label: 'Petty cash' }, { id: 'budgets', label: 'Budgets & settings' }]} />
      {tab === 'overview' && <Overview {...props} />}
      {tab === 'list' && <ExpenseList {...props} />}
      {tab === 'petty' && <PettyCash {...props} />}
      {tab === 'budgets' && <BudgetSettings {...props} />}
    </div>
  );
};

type Shared = {
  employees: Employee[]; user?: string; expC: ReturnType<typeof useHRCollection<HRExpense>>; pettyC: ReturnType<typeof useHRCollection<HRPettyCash>>;
  budgets: HRExpenseBudgets; budC: ReturnType<typeof useHRCollection<HRExpenseBudgets>>; pettyBalance: number; toReimburse: HRExpense[];
  month: string; setMonth: (m: string) => void; setTab: (t: string) => void;
};

// ─────────────── Overview ───────────────
const Overview: React.FC<Shared> = ({ expC, budgets, pettyBalance, toReimburse, month, setMonth, setTab, user }) => {
  const inMonth = useMemo(() => expC.items.filter(e => e.date.startsWith(month)), [expC.items, month]);
  const total = round2(inMonth.reduce((s, e) => s + e.total, 0));
  const pantry = round2(inMonth.filter(e => isPantry(e.category)).reduce((s, e) => s + e.total, 0));
  const budgetTotal = (Object.values(budgets.monthly) as number[]).reduce((s, n) => s + (n || 0), 0);
  const byCat = useMemo(() => {
    const m = new Map<string, number>();
    inMonth.forEach(e => m.set(e.category, round2((m.get(e.category) || 0) + e.total)));
    Object.keys(budgets.monthly).forEach(c => { if (!m.has(c) && budgets.monthly[c] > 0) m.set(c, 0); });
    return Array.from(m.entries()).map(([c, spent]) => ({ c, spent, budget: budgets.monthly[c] || 0 })).sort((a, b) => b.spent - a.spent);
  }, [inMonth, budgets]);
  const trend = useMemo(() => lastMonths(6).map(m => ({ name: shortMonth(m), total: round2(expC.items.filter(e => e.date.startsWith(m)).reduce((s, e) => s + e.total, 0)) })), [expC.items]);
  const vendors = useMemo(() => {
    const m = new Map<string, number>();
    inMonth.forEach(e => { const v = (e.vendor || '').trim(); if (v) m.set(v, round2((m.get(v) || 0) + e.total)); });
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [inMonth]);
  const owed = useMemo(() => {
    const m = new Map<string, { name: string; amount: number; ids: string[] }>();
    toReimburse.forEach(e => { const k = e.paidById || e.paidByName || '?'; const cur = m.get(k) || { name: e.paidByName || 'Employee', amount: 0, ids: [] }; cur.amount = round2(cur.amount + e.total); cur.ids.push(e.id); m.set(k, cur); });
    return Array.from(m.values()).sort((a, b) => b.amount - a.amount);
  }, [toReimburse]);
  const lowPetty = pettyBalance < budgets.minPettyCash;

  const markPaid = async (ids: string[], name: string) => {
    const ok = await runSave(async () => { for (const id of ids) { const e = expC.items.find(x => x.id === id); if (e) await expC.save({ ...e, reimbursed: true }); } }, `Marked as reimbursed — ${name}`);
    if (ok) logAudit(user, 'Expenses', `Reimbursed ${ids.length} expense(s)`, name);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <input type="month" className={inputCls + ' !w-auto'} value={month} onChange={e => setMonth(e.target.value)} />
        <span className="text-sm text-slate-500">{monthName(month)}</span>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Spent this month" value={fmtAED(total)} sub={budgetTotal ? `of ${fmtAED(budgetTotal)} budget (${Math.round((total / budgetTotal) * 100)}%)` : 'No budget set'} tone={budgetTotal && total > budgetTotal ? 'rose' : 'violet'} icon={<Receipt className="h-4 w-4" />} onClick={() => setTab('list')} />
        <StatCard label="Pantry this month" value={fmtAED(pantry)} tone="amber" icon={<Coffee className="h-4 w-4" />} />
        <StatCard label="Petty cash balance" value={fmtAED(pettyBalance)} sub={lowPetty ? `Below the minimum of ${fmtAED(budgets.minPettyCash)}` : undefined} tone={lowPetty ? 'rose' : 'emerald'} icon={<Wallet className="h-4 w-4" />} onClick={() => setTab('petty')} />
        <StatCard label="To reimburse staff" value={fmtAED(toReimburse.reduce((s, e) => s + e.total, 0))} sub={`${toReimburse.length} expense(s)`} tone={toReimburse.length ? 'amber' : 'slate'} icon={<HandCoins className="h-4 w-4" />} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <SectionCard title="Last 6 months">
          <div className="h-56"><ResponsiveContainer width="100%" height="100%"><BarChart data={trend} margin={{ left: -6, right: 8 }}>
            <CartesianGrid stroke={chartAxisDefaults.gridStroke} /><XAxis dataKey="name" stroke={chartAxisDefaults.axisStroke} fontSize={11} /><YAxis stroke={chartAxisDefaults.axisStroke} fontSize={11} />
            <RTooltip formatter={(v: any) => fmtAED(Number(v))} /><Bar dataKey="total" name="Spent" fill={chartTokens.primary[500]} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
        </SectionCard>
        <SectionCard title="By category (budget vs spent)">
          {byCat.length === 0 ? <p className="text-sm text-slate-400 py-6 text-center">No expenses this month.</p> : (
            <div className="space-y-2 max-h-56 overflow-y-auto">
              {byCat.map(r => { const pct = r.budget ? Math.min(100, (r.spent / r.budget) * 100) : 100; const over = r.budget > 0 && r.spent > r.budget; return (
                <div key={r.c}><div className="flex justify-between text-xs"><span className="font-semibold text-slate-700 truncate">{r.c}</span><span className={over ? 'text-rose-600 font-bold' : 'text-slate-500'}>{fmtAED(r.spent)}{r.budget ? ` / ${fmtAED(r.budget)}` : ''}</span></div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className={`h-full ${over ? 'bg-rose-500' : r.budget ? 'bg-emerald-500' : 'bg-violet-400'}`} style={{ width: `${pct}%` }} /></div></div>); })}
            </div>
          )}
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <SectionCard title="Top vendors this month">
          {vendors.length === 0 ? <p className="text-sm text-slate-400 py-3 text-center">No vendors recorded.</p> : vendors.map(([v, a]) => <div key={v} className="flex justify-between text-sm py-1"><span className="text-slate-700">{v}</span><span className="font-semibold">{fmtAED(a)}</span></div>)}
        </SectionCard>
        <SectionCard title="Staff to reimburse">
          {owed.length === 0 ? <p className="text-sm text-emerald-600 font-semibold py-3 text-center">Nobody is waiting to be reimbursed.</p> : owed.map(o => (
            <div key={o.name} className="flex items-center justify-between text-sm py-1"><span className="text-slate-700">{o.name}</span><span className="flex items-center gap-2"><b>{fmtAED(o.amount)}</b><button className={btnGhost} onClick={() => markPaid(o.ids, o.name)}>Mark paid</button></span></div>
          ))}
        </SectionCard>
      </div>
    </div>
  );
};

// ─────────────── Expense list ───────────────
const ExpenseList: React.FC<Shared> = ({ employees, user, expC, budgets, pettyBalance }) => {
  const [mFilter, setMFilter] = useState(monthStr());
  const [cat, setCat] = useState('All');
  const [method, setMethod] = useState('All');
  const [who, setWho] = useState('');
  const [q, setQ] = useState('');
  const [noReceipt, setNoReceipt] = useState(false);
  const [form, setForm] = useState<HRExpense | 'new' | null>(null);
  const { ask, node } = useConfirm();

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return expC.items.filter(e => (!mFilter || e.date.startsWith(mFilter)) && (cat === 'All' || e.category === cat) && (method === 'All' || e.method === method) && (!who || e.paidById === who)
      && (!noReceipt || (!(e.files?.length) && !e.receiptNo)) && (!s || [e.description, e.vendor, e.receiptNo, e.notes].some(x => (x || '').toLowerCase().includes(s))))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }, [expC.items, mFilter, cat, method, who, q, noReceipt]);
  const tot = shown.reduce((s, e) => ({ a: s.a + e.amount, v: s.v + e.vat, t: s.t + e.total }), { a: 0, v: 0, t: 0 });

  const rowsOut = () => shown.map(e => ({ Date: e.date, Category: e.category, Description: e.description, Vendor: e.vendor || '', 'Amount (AED)': e.amount, 'VAT (AED)': e.vat, 'Total (AED)': e.total, 'Paid via': e.method, 'Paid by': e.paidByName || '', 'Receipt no.': e.receiptNo || '', Reimbursed: e.method.startsWith('Paid by employee') ? (e.reimbursed ? 'Yes' : 'No') : '' }));
  const del = async (e: HRExpense) => {
    if (!(await ask(`Delete this expense (${e.description}, ${fmtAED(e.total)})?`))) return;
    const ok = await runSave(() => expC.remove(e.id), 'Expense deleted');
    if (ok) { await Promise.all((e.files || []).map(deleteHRFile)); logAudit(user, 'Expenses', `Deleted ${e.category} ${fmtAED(e.total)}`); }
  };

  return (
    <div className="space-y-4">
      {node}
      <div className="flex flex-wrap items-end gap-2 justify-between">
        <div className="flex flex-wrap items-end gap-2">
          <input type="month" className={inputCls + ' !w-auto'} value={mFilter} onChange={e => setMFilter(e.target.value)} />
          <button className="text-xs font-bold text-violet-600" onClick={() => setMFilter('')}>All months</button>
          <select className={inputCls + ' !w-auto'} value={cat} onChange={e => setCat(e.target.value)}><option>All</option>{EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select>
          <select className={inputCls + ' !w-auto'} value={method} onChange={e => setMethod(e.target.value)}><option>All</option>{EXPENSE_METHODS.map(c => <option key={c}>{c}</option>)}</select>
          <div className="w-52"><EmployeeSearchSelect employees={employees} value={who} onChange={setWho} placeholder="Paid by: anyone" clearLabel="Anyone" /></div>
          <SearchBox value={q} onChange={setQ} placeholder="Description, vendor, receipt…" />
          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600"><input type="checkbox" className="accent-violet-600" checked={noReceipt} onChange={e => setNoReceipt(e.target.checked)} />No receipt</label>
        </div>
        <div className="flex gap-2">
          <ImportButton employees={employees} user={user} types={['expenses']} initialType="expenses" />
          <button className={btnGhost} onClick={() => shown.length ? exportToExcel(rowsOut(), `Office_expenses_${mFilter || 'all'}`, 'Expenses') : hrToast('Nothing to export', 'err')}><Download className="h-3.5 w-3.5" />Excel</button>
          <button className={btnGhost} onClick={() => shown.length ? exportTablePdf({ title: 'Office & Pantry Expenses', subtitle: `${mFilter ? monthName(mFilter) : 'All months'} · ${shown.length} entries · total ${fmtAED(tot.t)}`, deptLine: 'Human Resources Department',
            columns: ['Date', 'Category', 'Description', 'Vendor', 'Total (AED)', 'Paid via', 'Paid by'].map(h => ({ header: h, dataKey: h })), rows: rowsOut(), filename: `Office_expenses_${mFilter || 'all'}`, orientation: 'landscape' }) : hrToast('Nothing to export', 'err')}><Download className="h-3.5 w-3.5" />PDF</button>
          <button className={btnPrimary} onClick={() => setForm('new')}><Plus className="h-4 w-4" />Add expense</button>
        </div>
      </div>

      {shown.length === 0 ? <Empty text="No expenses match." /> : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase text-slate-400 border-b border-slate-100">
              <th className="px-3 py-2">Date</th><th className="px-3 py-2">Category</th><th className="px-3 py-2">Description</th><th className="px-3 py-2">Paid via</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2 text-right">VAT</th><th className="px-3 py-2 text-right">Total</th><th className="px-3 py-2">Receipt</th><th className="px-3 py-2" />
            </tr></thead>
            <tbody className="divide-y divide-slate-50">
              {shown.slice(0, 500).map(e => (
                <tr key={e.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 whitespace-nowrap">{fmtD(e.date)}</td>
                  <td className="px-3 py-2"><Badge tone={isPantry(e.category) ? 'amber' : 'slate'}>{e.category}</Badge></td>
                  <td className="px-3 py-2"><div className="font-semibold text-slate-800">{e.description}</div><div className="text-[11px] text-slate-400">{e.vendor}{e.paidByName ? ` · ${e.paidByName}` : ''}</div></td>
                  <td className="px-3 py-2 text-xs">{e.method}{e.method.startsWith('Paid by employee') && <div>{e.reimbursed ? <Badge tone="emerald">Reimbursed</Badge> : <Badge tone="amber">To reimburse</Badge>}</div>}</td>
                  <td className="px-3 py-2 text-right">{fmtAED(e.amount)}</td><td className="px-3 py-2 text-right text-slate-400">{e.vat ? fmtAED(e.vat) : '—'}</td><td className="px-3 py-2 text-right font-bold">{fmtAED(e.total)}</td>
                  <td className="px-3 py-2 text-xs">{e.files?.length ? <a className="inline-flex items-center gap-1 text-violet-600 font-semibold" href={e.files[0].url} target="_blank" rel="noreferrer"><Paperclip className="h-3 w-3" />{e.files.length}</a> : e.receiptNo ? <span className="text-slate-500">#{e.receiptNo}</span> : <span className="text-slate-300">—</span>}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button className="text-slate-400 hover:text-violet-600 mr-2" aria-label="Edit" onClick={() => setForm(e)}><Pencil className="h-4 w-4 inline" /></button>
                    <button className="text-slate-300 hover:text-rose-600" aria-label="Delete" onClick={() => del(e)}><Trash2 className="h-4 w-4 inline" /></button>
                  </td>
                </tr>
              ))}
              <tr className="bg-violet-50 font-black text-slate-800"><td className="px-3 py-2" colSpan={4}>Total ({shown.length})</td><td className="px-3 py-2 text-right">{fmtAED(tot.a)}</td><td className="px-3 py-2 text-right">{fmtAED(tot.v)}</td><td className="px-3 py-2 text-right">{fmtAED(tot.t)}</td><td colSpan={2} /></tr>
            </tbody>
          </table>
          {shown.length > 500 && <p className="text-[11px] text-slate-400 px-4 py-2">Showing 500 of {shown.length}. Narrow the filters or export to Excel.</p>}
        </div>
      )}
      {form && <ExpenseForm existing={form === 'new' ? undefined : form} all={expC.items} employees={employees} user={user} vatRate={budgets.vatRate} pettyBalance={pettyBalance} onClose={() => setForm(null)}
        save={async r => { const ok = await runSave(() => expC.save(r), 'Expense saved'); if (ok) { logAudit(user, 'Expenses', `${form === 'new' ? 'Added' : 'Edited'} ${r.category} ${fmtAED(r.total)}`, r.vendor); setForm(null); } return ok; }} />}
    </div>
  );
};

const ExpenseForm: React.FC<{ existing?: HRExpense; all: HRExpense[]; employees: Employee[]; user?: string; vatRate: number; pettyBalance: number; onClose: () => void; save: (r: HRExpense) => Promise<boolean> }> = ({ existing, all, employees, user, vatRate, pettyBalance, onClose, save }) => {
  const { ask, node } = useConfirm();
  const [f, setF] = useState({
    date: existing?.date || todayStr(), category: existing?.category || EXPENSE_CATEGORIES[0], description: existing?.description || '', vendor: existing?.vendor || '',
    amount: existing ? String(existing.amount) : '', vat: existing ? String(existing.vat) : '', withVat: existing ? existing.vat > 0 : true,
    method: existing?.method || 'Petty cash' as HRExpense['method'], paidById: existing?.paidById || '', receiptNo: existing?.receiptNo || '', notes: existing?.notes || '',
  });
  const [keep, setKeep] = useState<HRFile[]>(existing?.files || []);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const amount = num(f.amount);
  const vat = f.withVat ? (f.vat !== '' ? num(f.vat) : round2(amount * vatRate / 100)) : 0;
  const total = round2(amount + vat);
  const owes = f.method.startsWith('Paid by employee');

  const submit = async () => {
    if (!f.description.trim()) { hrToast('Describe what was bought', 'err'); return; }
    if (!(amount > 0)) { hrToast('Enter the amount', 'err'); return; }
    if (owes && !f.paidById) { hrToast('Choose who paid, so they can be reimbursed', 'err'); return; }
    if (f.method === 'Petty cash' && !existing && total > pettyBalance && !(await ask(`This is more than the petty cash balance (${fmtAED(pettyBalance)}). Save anyway?`))) return;
    if (!existing && all.some(e => e.date === f.date && round2(e.total) === total && (e.vendor || '').toLowerCase() === f.vendor.trim().toLowerCase() && e.description.toLowerCase() === f.description.trim().toLowerCase()) && !(await ask('An identical expense (same date, vendor, description and amount) already exists. Add it again?'))) return;
    const id = existing?.id || newId('ex');
    setBusy(true);
    const uploaded: HRFile[] = [];
    try { for (const file of files) uploaded.push(await uploadHRFile(file, 'expenses', id, user)); }
    catch (e: any) { await Promise.all(uploaded.map(deleteHRFile)); hrToast(e?.message || 'Upload failed', 'err'); setBusy(false); return; }
    const emp = employees.find(e => e.id === f.paidById);
    const removed = (existing?.files || []).filter(x => !keep.some(k => k.id === x.id));
    const allFiles = [...keep, ...uploaded];
    const ok = await save({
      id, date: f.date, category: f.category, description: f.description.trim(), vendor: f.vendor.trim() || undefined, amount: round2(amount), vat: round2(vat), total,
      method: f.method, paidById: emp?.id, paidByName: emp?.name, reimbursed: owes ? (existing?.reimbursed || false) : undefined, receiptNo: f.receiptNo.trim() || undefined,
      files: allFiles.length ? allFiles : undefined, notes: f.notes.trim() || undefined, createdBy: existing?.createdBy || user, createdAt: existing?.createdAt || new Date().toISOString(),
    });
    setBusy(false);
    if (ok) await Promise.all(removed.map(deleteHRFile)); else await Promise.all(uploaded.map(deleteHRFile));
  };

  return (
    <Modal wide title={existing ? 'Edit expense' : 'Add expense'} onClose={onClose} footer={<><button className={btnGhost} onClick={onClose} disabled={busy}>Cancel</button><button className={btnPrimary} onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></>}>
      {node}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Date"><input type="date" className={inputCls} value={f.date} onChange={e => setF(p => ({ ...p, date: e.target.value }))} /></Field>
        <Field label="Category" className="sm:col-span-2"><select className={inputCls} value={f.category} onChange={e => setF(p => ({ ...p, category: e.target.value }))}>{EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></Field>
      </div>
      <Field label="What was bought *"><input className={inputCls} value={f.description} onChange={e => setF(p => ({ ...p, description: e.target.value }))} placeholder="Tea bags, milk, sugar" /></Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Vendor / shop"><input className={inputCls} value={f.vendor} onChange={e => setF(p => ({ ...p, vendor: e.target.value }))} /></Field>
        <Field label="Receipt / invoice no."><input className={inputCls} value={f.receiptNo} onChange={e => setF(p => ({ ...p, receiptNo: e.target.value }))} /></Field>
      </div>
      <div className="grid grid-cols-3 gap-3 items-end">
        <Field label="Amount before VAT (AED) *"><input type="number" step="0.01" min={0} className={inputCls} value={f.amount} onChange={e => setF(p => ({ ...p, amount: e.target.value }))} /></Field>
        <Field label={`VAT ${vatRate}% (AED)`}><input type="number" step="0.01" min={0} disabled={!f.withVat} className={inputCls} value={f.withVat ? (f.vat !== '' ? f.vat : (amount ? String(round2(amount * vatRate / 100)) : '')) : ''} onChange={e => setF(p => ({ ...p, vat: e.target.value }))} /></Field>
        <div className="pb-2 text-lg font-black text-violet-700">{fmtAED(total)}</div>
      </div>
      <label className="flex items-center gap-2 text-xs font-semibold text-slate-600"><input type="checkbox" className="accent-violet-600" checked={f.withVat} onChange={e => setF(p => ({ ...p, withVat: e.target.checked, vat: '' }))} />This bill includes VAT</label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Paid via"><select className={inputCls} value={f.method} onChange={e => setF(p => ({ ...p, method: e.target.value as any }))}>{EXPENSE_METHODS.map(m => <option key={m}>{m}</option>)}</select></Field>
        <Field label={owes ? 'Who paid (to reimburse) *' : 'Who bought it (optional)'}><EmployeeSearchSelect employees={employees} value={f.paidById} onChange={id => setF(p => ({ ...p, paidById: id }))} clearLabel={owes ? undefined : '— nobody —'} /></Field>
      </div>
      <Field label="Notes"><input className={inputCls} value={f.notes} onChange={e => setF(p => ({ ...p, notes: e.target.value }))} /></Field>
      <Field label="Receipt photo / PDF (kept permanently, max 1 MB each)">
        {keep.map(k => (<div key={k.id} className="flex items-center justify-between text-xs bg-slate-50 rounded-lg px-3 py-1.5 mb-1"><span className="truncate">{k.name} <span className="text-slate-400">· {fmtBytes(k.size)}</span></span>
          <span className="flex gap-2"><a href={k.url} target="_blank" rel="noreferrer" className="text-violet-600"><ExternalLink className="h-3.5 w-3.5" /></a><button type="button" className="text-slate-300 hover:text-rose-600" aria-label="Remove" onClick={() => setKeep(keep.filter(x => x.id !== k.id))}><Trash2 className="h-3.5 w-3.5" /></button></span></div>))}
        {keep.length + files.length < HR_MAX_FILES_PER_RECORD && <FilePicker files={files} setFiles={setFiles} max={HR_MAX_FILES_PER_RECORD - keep.length} />}
      </Field>
    </Modal>
  );
};

// ─────────────── Petty cash ───────────────
const PettyCash: React.FC<Shared> = ({ expC, pettyC, budgets, pettyBalance, user }) => {
  const [form, setForm] = useState(false);
  const { ask, node } = useConfirm();

  const ledger = useMemo(() => {
    const items = [
      ...pettyC.items.map(p => ({ id: p.id, date: p.date, at: p.createdAt, label: p.kind, note: p.note || '', delta: p.kind === 'Return to cash' ? -p.amount : p.amount, kind: 'cash' as const })),
      ...expC.items.filter(e => e.method === 'Petty cash').map(e => ({ id: e.id, date: e.date, at: e.createdAt, label: e.category, note: e.description, delta: -e.total, kind: 'expense' as const })),
    ].sort((a, b) => a.date.localeCompare(b.date) || a.at.localeCompare(b.at));
    let bal = 0;
    return items.map(i => { bal = round2(bal + i.delta); return { ...i, bal }; }).reverse();
  }, [pettyC.items, expC.items]);
  const lastTopUp = useMemo(() => [...pettyC.items].filter(p => p.kind !== 'Return to cash').sort((a, b) => b.date.localeCompare(a.date))[0], [pettyC.items]);
  const spentSince = lastTopUp ? round2(expC.items.filter(e => e.method === 'Petty cash' && e.date >= lastTopUp.date).reduce((s, e) => s + e.total, 0)) : 0;
  const low = pettyBalance < budgets.minPettyCash;

  return (
    <div className="space-y-4">
      {node}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <StatCard label="Petty cash balance" value={fmtAED(pettyBalance)} tone={low ? 'rose' : 'emerald'} icon={<Wallet className="h-4 w-4" />} sub={low ? `Below the minimum (${fmtAED(budgets.minPettyCash)})` : undefined} />
        <StatCard label="Spent since last top-up" value={fmtAED(spentSince)} sub={lastTopUp ? `since ${fmtD(lastTopUp.date)}` : 'No top-up recorded yet'} tone="amber" />
        <StatCard label="Suggested top-up" value={fmtAED(spentSince)} sub="restores the cash you had" tone="slate" />
      </div>
      <div className="flex justify-end"><button className={btnPrimary} onClick={() => setForm(true)}><Plus className="h-4 w-4" />Cash in / out</button></div>
      {ledger.length === 0 ? <Empty text="Start by recording the opening float (the cash in the petty cash box)." /> : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase text-slate-400 border-b border-slate-100"><th className="px-3 py-2">Date</th><th className="px-3 py-2">What</th><th className="px-3 py-2">Note</th><th className="px-3 py-2 text-right">In / (out)</th><th className="px-3 py-2 text-right">Balance</th><th className="px-3 py-2" /></tr></thead>
            <tbody className="divide-y divide-slate-50">
              {ledger.slice(0, 300).map(l => (
                <tr key={`${l.kind}${l.id}`}>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtD(l.date)}</td><td className="px-3 py-2">{l.kind === 'cash' ? <Badge tone="emerald">{l.label}</Badge> : <span className="text-slate-700">{l.label}</span>}</td>
                  <td className="px-3 py-2 text-slate-500">{l.note}</td>
                  <td className={`px-3 py-2 text-right font-semibold ${l.delta < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{l.delta < 0 ? `(${fmtAED(-l.delta)})` : fmtAED(l.delta)}</td>
                  <td className="px-3 py-2 text-right font-bold">{fmtAED(l.bal)}</td>
                  <td className="px-3 py-2 text-right">{l.kind === 'cash' && <button className="text-slate-300 hover:text-rose-600" aria-label="Delete" onClick={async () => { if (!(await ask('Delete this cash entry?'))) return; const ok = await runSave(() => pettyC.remove(l.id), 'Deleted'); if (ok) logAudit(user, 'Petty cash', `Deleted ${l.label} ${fmtAED(l.delta)}`); }}><Trash2 className="h-4 w-4" /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {form && <PettyForm suggested={spentSince} onClose={() => setForm(false)} save={async p => { const ok = await runSave(() => pettyC.save({ ...p, createdBy: user }), 'Saved'); if (ok) { logAudit(user, 'Petty cash', `${p.kind} ${fmtAED(p.amount)}`); setForm(false); } }} />}
    </div>
  );
};

const PettyForm: React.FC<{ suggested: number; onClose: () => void; save: (p: HRPettyCash) => void }> = ({ suggested, onClose, save }) => {
  const [f, setF] = useState({ kind: 'Top-up' as HRPettyCash['kind'], date: todayStr(), amount: suggested > 0 ? String(suggested) : '', note: '' });
  return (
    <Modal title="Petty cash — cash in / out" onClose={onClose} footer={<><button className={btnGhost} onClick={onClose}>Cancel</button><button className={btnPrimary} onClick={() => { const a = num(f.amount); if (!(a > 0)) { hrToast('Enter the amount', 'err'); return; } save({ id: newId('pc'), date: f.date, kind: f.kind, amount: round2(a), note: f.note.trim() || undefined, createdAt: new Date().toISOString() }); }}>Save</button></>}>
      <Field label="Type"><select className={inputCls} value={f.kind} onChange={e => setF(p => ({ ...p, kind: e.target.value as any }))}><option>Opening float</option><option>Top-up</option><option>Return to cash</option></select></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date"><input type="date" className={inputCls} value={f.date} onChange={e => setF(p => ({ ...p, date: e.target.value }))} /></Field>
        <Field label="Amount (AED)"><input type="number" step="0.01" min={0} className={inputCls} value={f.amount} onChange={e => setF(p => ({ ...p, amount: e.target.value }))} /></Field>
      </div>
      <Field label="Note"><input className={inputCls} value={f.note} onChange={e => setF(p => ({ ...p, note: e.target.value }))} placeholder="Cheque no., who gave the cash…" /></Field>
      <p className="text-[11px] text-slate-400">Opening float and top-ups add cash. "Return to cash" takes cash back out of the petty cash box (for example when it is banked).</p>
    </Modal>
  );
};

// ─────────────── Budgets & settings ───────────────
const BudgetSettings: React.FC<Shared> = ({ budgets, budC, user }) => {
  const [monthly, setMonthly] = useState<Record<string, string>>(Object.fromEntries(EXPENSE_CATEGORIES.map(c => [c, budgets.monthly[c] ? String(budgets.monthly[c]) : ''])));
  const [minPetty, setMinPetty] = useState(String(budgets.minPettyCash));
  const [vatRate, setVatRate] = useState(String(budgets.vatRate));
  const total = EXPENSE_CATEGORIES.reduce((s, c) => s + num(monthly[c] || ''), 0);
  return (
    <div className="space-y-4">
      <SectionCard title="Monthly budget per category (AED)">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
          {EXPENSE_CATEGORIES.map(c => (
            <div key={c} className="flex items-center justify-between gap-3"><span className="text-sm text-slate-700">{c}</span>
              <input type="number" min={0} className={inputCls + ' !w-28 text-right'} value={monthly[c]} onChange={e => setMonthly(p => ({ ...p, [c]: e.target.value }))} placeholder="no limit" /></div>
          ))}
        </div>
        <p className="text-xs text-slate-500 mt-3">Total monthly budget: <b>{fmtAED(total)}</b>. Leave blank for no limit. Categories over budget show in red on the Overview.</p>
      </SectionCard>
      <SectionCard title="Petty cash and VAT">
        <div className="grid grid-cols-2 gap-3 max-w-md">
          <Field label="Warn when petty cash is below (AED)"><input type="number" min={0} className={inputCls} value={minPetty} onChange={e => setMinPetty(e.target.value)} /></Field>
          <Field label="VAT rate (%)"><input type="number" min={0} step="0.5" className={inputCls} value={vatRate} onChange={e => setVatRate(e.target.value)} /></Field>
        </div>
      </SectionCard>
      <button className={btnPrimary} onClick={async () => {
        const m: Record<string, number> = {}; EXPENSE_CATEGORIES.forEach(c => { const n = num(monthly[c] || ''); if (n > 0) m[c] = n; });
        const ok = await runSave(() => budC.save({ id: 'budgets', monthly: m, minPettyCash: Math.max(0, num(minPetty)), vatRate: Math.max(0, num(vatRate)), updatedAt: new Date().toISOString() }), 'Budgets saved');
        if (ok) logAudit(user, 'Expenses', 'Updated budgets and settings');
      }}>Save budgets & settings</button>
    </div>
  );
};
