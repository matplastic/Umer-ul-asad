import React, { useMemo, useState } from 'react';
import { Save, Send, Loader2, AlertTriangle } from 'lucide-react';
import type { PurchaseOrder, TfType, TradeFinance } from '../types';
import { Field, Modal, btn, inputCls, todayStr } from './ProcurementUi';
import { dbSaveTradeFinance, dbTradeFinanceAction } from '../lib/firebaseService';
import { CURRENCIES, TF_BANKS, TF_TYPES, addDays, tfAmounts } from '../lib/tradeFinance';
import { dateFmt, money, poTotals } from '../lib/procurement';

// Structured Trade Finance. A bank finances a purchase order: it pays the supplier, you pay a cash
// margin up front and repay the bank (with profit/interest and charges) at maturity.

interface Props {
  pos: PurchaseOrder[];                 // issued POs
  tfs: TradeFinance[];                  // existing facilities (bank suggestions + double-financing warning)
  initial?: TradeFinance | null;
  forPoId?: string | null;
  currentUserName: string;
  onClose: () => void;
  onSaved: (tf: TradeFinance) => void;
}

export const TradeFinanceEditor: React.FC<Props> = ({ pos, tfs, initial, forPoId, currentUserName, onClose, onSaved }) => {
  const [poId, setPoId] = useState(initial?.poId || forPoId || '');
  const [type, setType] = useState<TfType>(initial?.type || 'usance_lc');
  const [bankName, setBankName] = useState(initial?.bankName || '');
  const [facilityRef, setFacilityRef] = useState(initial?.facilityRef || '');
  const [currency, setCurrency] = useState(initial?.currency || 'AED');
  const [fxRate, setFxRate] = useState(String(initial?.fxRate ?? 1));
  const [invoiceAmount, setInvoiceAmount] = useState(initial ? String(initial.invoiceAmount) : '');
  const [marginPct, setMarginPct] = useState(String(initial?.marginPct ?? 0));
  const [tenorDays, setTenorDays] = useState(String(initial?.tenorDays ?? 90));
  const [interestRate, setInterestRate] = useState(initial ? String(initial.interestRate) : '');
  const [commissionPct, setCommissionPct] = useState(String(initial?.commissionPct ?? 0));
  const [otherFees, setOtherFees] = useState(String(initial?.otherFees ?? 0));
  const [expectedDrawDate, setExpectedDrawDate] = useState((initial?.expectedDrawDate || '').slice(0, 10));
  const [notes, setNotes] = useState(initial?.notes || '');
  const [busy, setBusy] = useState<'draft' | 'apply' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const po = pos.find(p => p.id === poId) || null;
  const poTotal = po ? poTotals(po).total : 0;
  const banks = useMemo(() => Array.from(new Set([...tfs.map(t => t.bankName), ...TF_BANKS])).sort(), [tfs]);
  const alreadyFinanced = tfs.filter(t => t.poId === poId && t.id !== initial?.id && t.status !== 'cancelled' && t.status !== 'draft').reduce((s, t) => s + tfAmounts(t).invoiceAed, 0);

  const terms = {
    currency, fxRate: Number(fxRate) || 0, invoiceAmount: Number(invoiceAmount) || 0, marginPct: Number(marginPct) || 0,
    tenorDays: Number(tenorDays) || 0, interestRate: Number(interestRate) || 0, commissionPct: Number(commissionPct) || 0, otherFees: Number(otherFees) || 0,
  };
  const a = tfAmounts(terms);
  const maturityGuess = terms.tenorDays > 0 ? addDays(expectedDrawDate || todayStr(), terms.tenorDays) : null;
  const typeInfo = TF_TYPES.find(t => t.id === type);

  const choosePo = (id: string) => {
    setPoId(id);
    const p = pos.find(x => x.id === id);
    if (p && !invoiceAmount) setInvoiceAmount(String(Math.round((poTotals(p).total / (Number(fxRate) || 1)) * 100) / 100));
  };
  const chooseCurrency = (c: string) => {
    setCurrency(c);
    const def = CURRENCIES.find(x => x.code === c)?.defaultRate;
    if (def != null) setFxRate(String(def));
    else setFxRate('');
    if (po) setInvoiceAmount('');
  };

  const save = async (apply: boolean) => {
    setError(null);
    if (!poId) { setError('Choose the purchase order being financed.'); return; }
    setBusy(apply ? 'apply' : 'draft');
    try {
      let tf = await dbSaveTradeFinance({
        id: initial?.id, poId, type, bankName: bankName.trim(), facilityRef: facilityRef.trim() || null, currency, fxRate: terms.fxRate,
        invoiceAmount: terms.invoiceAmount, marginPct: terms.marginPct, tenorDays: terms.tenorDays, interestRate: terms.interestRate,
        commissionPct: terms.commissionPct, otherFees: terms.otherFees, expectedDrawDate: expectedDrawDate || null, notes: notes.trim() || null,
      }, currentUserName);
      if (apply && tf.status === 'draft') tf = await dbTradeFinanceAction(tf.id, 'apply', currentUserName);
      onSaved(tf);
    } catch (e: any) {
      setError(e?.message || 'Could not save the facility.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      title={initial ? `Edit ${initial.tfNo}` : 'New trade finance facility'}
      subtitle="The bank pays the supplier; you repay the bank at maturity"
      onClose={onClose} width="max-w-5xl"
      footer={<>
        <button onClick={onClose} className={btn.soft}>Cancel</button>
        <button onClick={() => save(false)} disabled={!!busy} className={btn.soft} data-testid="tf-save-draft">{busy === 'draft' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save draft</button>
        {(!initial || initial.status === 'draft') && <button onClick={() => save(true)} disabled={!!busy} className={btn.primary} data-testid="tf-save-apply">{busy === 'apply' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Save &amp; mark as applied</button>}
      </>}
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Purchase order *" className="md:col-span-2">
              <select value={poId} onChange={e => choosePo(e.target.value)} disabled={!!initial} className={inputCls} data-testid="tf-po">
                <option value="">Choose an issued PO…</option>
                {pos.map(p => <option key={p.id} value={p.id}>{p.poNo} — {p.supplierName} — AED {money(poTotals(p).total)}</option>)}
              </select>
              {pos.length === 0 && <div className="text-[11px] text-amber-700 mt-1">There is no issued PO yet. Issue a PO first, then finance it.</div>}
              {alreadyFinanced > 0 && <div className="text-[11px] text-amber-700 mt-1">This PO already has AED {money(alreadyFinanced)} under another facility.</div>}
            </Field>
            <Field label="Facility type *" className="md:col-span-2">
              <select value={type} onChange={e => setType(e.target.value as TfType)} className={inputCls} data-testid="tf-type">
                {TF_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
              {typeInfo?.hint && <div className="text-[11px] text-slate-500 mt-1">{typeInfo.hint}</div>}
            </Field>
            <Field label="Bank *">
              <input value={bankName} onChange={e => setBankName(e.target.value)} list="tf-banks" placeholder="e.g. Emirates NBD" className={inputCls} data-testid="tf-bank" />
              <datalist id="tf-banks">{banks.map(b => <option key={b} value={b} />)}</datalist>
            </Field>
            <Field label="LC / TR / loan reference (when the bank gives it)"><input value={facilityRef} onChange={e => setFacilityRef(e.target.value)} className={`${inputCls} font-mono`} /></Field>
            <Field label="Currency">
              <select value={currency} onChange={e => chooseCurrency(e.target.value)} className={inputCls}>{CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code}</option>)}</select>
            </Field>
            <Field label={`Exchange rate (1 ${currency} = ? AED)`}><input type="number" min={0} step="any" value={fxRate} onChange={e => setFxRate(e.target.value)} disabled={currency === 'AED'} className={`${inputCls} font-mono`} /></Field>
            <Field label={`Goods value being financed (${currency}) *`}>
              <input type="number" min={0} step="any" value={invoiceAmount} onChange={e => setInvoiceAmount(e.target.value)} className={`${inputCls} font-mono`} data-testid="tf-amount" />
              {po && <div className="text-[11px] text-slate-500 mt-1">PO total incl. VAT: AED {money(poTotal)}</div>}
            </Field>
            <Field label="Cash margin paid by you up front (%)"><input type="number" min={0} max={99} step="any" value={marginPct} onChange={e => setMarginPct(e.target.value)} className={`${inputCls} font-mono`} data-testid="tf-margin" /></Field>
            <Field label="Tenor (days) *">
              <input type="number" min={1} value={tenorDays} onChange={e => setTenorDays(e.target.value)} list="tf-tenors" className={`${inputCls} font-mono`} data-testid="tf-tenor" />
              <datalist id="tf-tenors">{[30, 60, 90, 120, 150, 180].map(d => <option key={d} value={d} />)}</datalist>
            </Field>
            <Field label="Interest / profit rate (% per year) *"><input type="number" min={0} step="any" value={interestRate} onChange={e => setInterestRate(e.target.value)} className={`${inputCls} font-mono`} data-testid="tf-rate" /></Field>
            <Field label="Bank commission (% of goods value)"><input type="number" min={0} step="any" value={commissionPct} onChange={e => setCommissionPct(e.target.value)} className={`${inputCls} font-mono`} /></Field>
            <Field label="Other bank charges (AED)"><input type="number" min={0} step="any" value={otherFees} onChange={e => setOtherFees(e.target.value)} className={`${inputCls} font-mono`} /></Field>
            <Field label="Expected drawdown date"><input type="date" value={expectedDrawDate} onChange={e => setExpectedDrawDate(e.target.value)} className={inputCls} /></Field>
            <Field label="Notes"><input value={notes} onChange={e => setNotes(e.target.value)} className={inputCls} /></Field>
          </div>
          {error && <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 flex items-start gap-2" data-testid="tf-error"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</div>}
        </div>

        {/* live cost sheet */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs space-y-1.5 self-start" data-testid="tf-summary">
          <div className="text-[10px] uppercase font-bold text-slate-500 mb-1">What this costs</div>
          <div className="flex justify-between"><span className="text-slate-500">Goods value</span><span className="font-mono">{money(a.invoiceAed)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Your cash margin</span><span className="font-mono">− {money(a.marginAed)}</span></div>
          <div className="flex justify-between font-bold"><span>Bank finances</span><span className="font-mono">{money(a.financedAed)}</span></div>
          <div className="border-t border-slate-200 my-1" />
          <div className="flex justify-between"><span className="text-slate-500">Interest ({terms.tenorDays || 0} days)</span><span className="font-mono">{money(a.interest)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Commission</span><span className="font-mono">{money(a.commission)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Other charges</span><span className="font-mono">{money(a.fees)}</span></div>
          <div className="flex justify-between border-t border-slate-300 pt-1.5 text-sm font-black"><span>Payable to bank</span><span className="font-mono">{money(a.totalDue)}</span></div>
          <div className="text-[11px] text-slate-500 pt-1">Finance cost AED {money(a.cost)} — about <strong>{a.costPctPa}%</strong> a year all-in.</div>
          {maturityGuess && <div className="text-[11px] text-slate-500">If drawn {expectedDrawDate ? `on ${dateFmt(expectedDrawDate)}` : 'today'}, it matures on <strong>{dateFmt(maturityGuess)}</strong>.</div>}
          <div className="text-[10px] text-slate-400 pt-1">Simple interest on the financed amount, 360-day year. The bank’s own calculation is the final word — check its advice.</div>
        </div>
      </div>
    </Modal>
  );
};
