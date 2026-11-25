// Structured Trade Finance rules — what a bank-financed purchase costs, what is owed, when it matures.
import type { TfRepayment, TfStatus, TfType, TradeFinance } from '../types';
import { round2 } from './procurement';

export const TF_TYPES: { id: TfType; label: string; hint: string }[] = [
  { id: 'usance_lc', label: 'Usance Letter of Credit (LC)', hint: 'Bank guarantees payment to the supplier at a later date (e.g. 90 days). You repay the bank at maturity.' },
  { id: 'sight_lc', label: 'Sight Letter of Credit (LC)', hint: 'Bank pays the supplier on presentation of compliant documents. Often refinanced with a trust receipt loan.' },
  { id: 'trust_receipt', label: 'Trust Receipt (TR) loan', hint: 'Bank pays the supplier / retires the LC; you hold the goods in trust and repay at maturity or on sale.' },
  { id: 'import_loan', label: 'Import trade loan', hint: 'Short-term loan used to pay for imports under LC, documentary collection or open account.' },
  { id: 'doc_collection', label: 'Documentary collection (D/A)', hint: 'Bank releases shipping documents against your acceptance and you pay at maturity.' },
  { id: 'advance_loan', label: 'Short-term loan — advance payment', hint: 'Financing for a supplier advance / deposit.' },
  { id: 'murabaha', label: 'Murabaha (Islamic import finance)', hint: 'Bank buys the goods and sells them to you on deferred payment at an agreed profit.' },
  { id: 'other', label: 'Other facility', hint: '' },
];
export const tfTypeLabel = (t: TfType) => TF_TYPES.find(x => x.id === t)?.label || t;

export const TF_DOC_KINDS: { id: string; label: string }[] = [
  { id: 'application', label: 'Application form' },
  { id: 'approval', label: 'Bank approval / sanction letter' },
  { id: 'lc_copy', label: 'LC / TR copy' },
  { id: 'bill_of_lading', label: 'Bill of lading / airway bill' },
  { id: 'invoice', label: 'Commercial invoice' },
  { id: 'packing_list', label: 'Packing list' },
  { id: 'bank_advice', label: 'Bank advice / debit note' },
  { id: 'other', label: 'Other' },
];
export const tfDocLabel = (k: string) => TF_DOC_KINDS.find(x => x.id === k)?.label || k;

export const CURRENCIES: { code: string; defaultRate: number | null }[] = [
  { code: 'AED', defaultRate: 1 }, { code: 'USD', defaultRate: 3.6725 }, { code: 'EUR', defaultRate: null },
  { code: 'GBP', defaultRate: null }, { code: 'TRY', defaultRate: null }, { code: 'CNY', defaultRate: null }, { code: 'INR', defaultRate: null },
];

export const TF_BANKS = [
  'Emirates NBD', 'First Abu Dhabi Bank (FAB)', 'Abu Dhabi Commercial Bank (ADCB)', 'Mashreq Bank', 'RAKBANK', 'Commercial Bank of Dubai (CBD)',
  'Dubai Islamic Bank', 'Emirates Islamic', 'Sharjah Islamic Bank', 'National Bank of Fujairah (NBF)', 'Union National Bank / UAB', 'Ajman Bank', 'HSBC UAE', 'Standard Chartered UAE',
];

export const TF_STATUS_META: Record<TfStatus, { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'bg-slate-100 text-slate-700 border-slate-300' },
  applied: { label: 'Applied — with bank', cls: 'bg-amber-50 text-amber-800 border-amber-300' },
  approved: { label: 'Approved — awaiting drawdown', cls: 'bg-sky-50 text-sky-800 border-sky-300' },
  drawn: { label: 'Drawn — repayment running', cls: 'bg-violet-50 text-violet-800 border-violet-300' },
  settled: { label: 'Settled', cls: 'bg-emerald-50 text-emerald-800 border-emerald-300' },
  cancelled: { label: 'Cancelled', cls: 'bg-rose-50 text-rose-700 border-rose-300' },
};

export type TfTerms = Pick<TradeFinance, 'currency' | 'fxRate' | 'invoiceAmount' | 'marginPct' | 'tenorDays' | 'interestRate' | 'commissionPct' | 'otherFees'>;

// Money conventions: interest is simple, on the amount the BANK finances, on a 360-day year (the usual UAE basis).
export function tfAmounts(t: TfTerms) {
  const invoiceAed = round2((Number(t.invoiceAmount) || 0) * (Number(t.fxRate) || 0));
  const marginAed = round2(invoiceAed * (Number(t.marginPct) || 0) / 100);
  const financedAed = round2(invoiceAed - marginAed);
  const interest = round2(financedAed * (Number(t.interestRate) || 0) / 100 * (Number(t.tenorDays) || 0) / 360);
  const commission = round2(invoiceAed * (Number(t.commissionPct) || 0) / 100);
  const fees = round2(Number(t.otherFees) || 0);
  const totalDue = round2(financedAed + interest + commission + fees);      // everything payable to the bank
  const cost = round2(interest + commission + fees);                        // what the finance costs
  const days = Number(t.tenorDays) || 0;
  const costPctPa = financedAed > 0 && days > 0 ? round2((cost / financedAed) * (360 / days) * 100) : 0;   // all-in annualised cost
  return { invoiceAed, marginAed, financedAed, interest, commission, fees, totalDue, cost, costPctPa };
}

export const addDays = (iso: string, days: number) => {
  const d = new Date(iso.slice(0, 10) + 'T00:00:00'); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10);
};

export function tfPosition(tf: TradeFinance, today = new Date()) {
  const a = tfAmounts(tf);
  const repaid = round2(tf.repayments.filter(r => !r.voided).reduce((t, r) => t + r.amount, 0));
  const outstanding = Math.max(0, round2(a.totalDue - repaid));
  const maturity = tf.maturityDate || (tf.drawDate ? addDays(tf.drawDate, tf.tenorDays) : null);
  const t0 = new Date(today.toISOString().slice(0, 10) + 'T00:00:00').getTime();
  const daysToMaturity = maturity ? Math.round((new Date(maturity + 'T00:00:00').getTime() - t0) / 86400000) : null;
  const live = tf.status === 'drawn' && outstanding > 0.005;
  return { ...a, repaid, outstanding, maturity, daysToMaturity, live, overdue: live && daysToMaturity != null && daysToMaturity < 0, dueSoon: live && daysToMaturity != null && daysToMaturity >= 0 && daysToMaturity <= 30 };
}

export const activeRepayments = (tf: TradeFinance): TfRepayment[] => tf.repayments.filter(r => !r.voided);
