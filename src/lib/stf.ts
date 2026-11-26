// STF — the purchase approval form. Rules for who may do what, and how big a purchase is.
import type { ProcurementSettings, Stf, StfStatus } from '../types';
import { poTotals, round2 } from './procurement';

export const QUEUE_FINISHED = 'FINISHED';
export const QUEUE_BOARD = 'BOARD';

export const PROJECT_TYPES = ['SALES', 'STOCK', 'FACTORY', 'MAINTENANCE', 'OFFICE', 'OTHER'];

export const PAYMENT_TERM_PRESETS = [
  'PDC - 30 Days', 'PDC - 60 Days', 'PDC - 90 Days', '50% Advance Payment, Remaining PDC - 30 Days',
  '100% Advance Payment', 'Cash on delivery', 'Net 30', 'Net 60',
];

export const STF_STATUS_META: Record<StfStatus, { label: string; cls: string }> = {
  pending: { label: 'Pending', cls: 'bg-amber-50 text-amber-800 border-amber-300' },
  approved: { label: 'Approved', cls: 'bg-emerald-50 text-emerald-800 border-emerald-300' },
  board: { label: 'Board', cls: 'bg-violet-50 text-violet-800 border-violet-300' },
  rejected: { label: 'Rejected', cls: 'bg-rose-50 text-rose-700 border-rose-300' },
  cancelled: { label: 'Cancelled', cls: 'bg-slate-200 text-slate-700 border-slate-300' },
};

// Starting point taken from the company's STF-PO-PAYMENT sheet (names in the Que list, 5000 EUR tier).
// Everything here can be changed in Settings.
export function defaultProcurementSettings(now = new Date()): ProcurementSettings {
  return {
    id: 'settings',
    approvers: [
      { name: 'ALI BERK BEHRENK', finalForAbove: false },
      { name: 'OMER FARUK ERGIN', finalForAbove: true },
      { name: 'HUSSEIN KHALIL', finalForAbove: false },
      { name: 'CUMHUR TOPAL', finalForAbove: false },
      { name: 'ZEYNEP AKIN', finalForAbove: false },
    ],
    tierEur: 5000,
    eurToAed: 4.3,
    seqYear: now.getFullYear(),
    lastStfSeq: 26,
    lastPoSeq: 24,
  };
}

export const sameName = (a?: string | null, b?: string | null) =>
  !!a && !!b && a.trim().toLowerCase().replace(/\s+/g, ' ') === b.trim().toLowerCase().replace(/\s+/g, ' ');

export function stfTotals(stf: Pick<Stf, 'lines' | 'vatRate' | 'fxRate'>) {
  const t = poTotals({ lines: stf.lines as any, discount: 0, vatRate: stf.vatRate });
  return { ...t, totalAed: round2(t.total * (Number(stf.fxRate) || 1)) };
}

// "5000 EUR +" / "5000 EUR -", exactly as in the sheet's Budget column
export function budgetTier(stf: Pick<Stf, 'lines' | 'vatRate' | 'fxRate'>, s: ProcurementSettings) {
  const eur = round2(stfTotals(stf).totalAed / (s.eurToAed || 1));
  const above = eur >= s.tierEur;
  return { eur, above, label: `${s.tierEur} EUR ${above ? '+' : '-'}` };
}

// The approval route picked on the STF form. `queue` is the approver whose turn it is; routeNext is the one after them
// (null when the current approver is the last one — or the STF was forwarded outside the route — so approving finishes it).
export function routeNext(stf: Pick<Stf, 'queue' | 'approvalRoute'>): string | null {
  const r = stf.approvalRoute || [];
  const i = r.findIndex(n => sameName(n, stf.queue));
  return i >= 0 && i < r.length - 1 ? r[i + 1] : null;
}

// Keeps only names that exist in Settings, drops duplicates, and — when the STF is above the budget tier — makes sure the
// route ENDS with a final approver (the rule from the company sheet), adding one if the buyer did not.
export function normalizeRoute(route: string[] | null | undefined, s: ProcurementSettings, stf: Pick<Stf, 'lines' | 'vatRate' | 'fxRate'>): string[] {
  let out: string[] = [];
  for (const n of route || []) {
    const a = s.approvers.find(x => sameName(x.name, n));
    if (a && !out.some(o => sameName(o, a.name))) out.push(a.name);
  }
  if (out.length && budgetTier(stf, s).above) {
    const last = s.approvers.find(a => sameName(a.name, out[out.length - 1]));
    if (!last?.finalForAbove) {
      const fin = s.approvers.find(a => a.finalForAbove && out.some(o => sameName(o, a.name))) || s.approvers.find(a => a.finalForAbove);
      if (fin) out = out.filter(n => !sameName(n, fin.name)).concat(fin.name);
    }
  }
  return out;
}

export interface StfPermissions {
  canEdit: boolean;
  canForward: boolean;
  canApprove: boolean;
  approveBlockedReason: string | null;
  canToBoard: boolean;
  canBoardDecide: boolean;
  canReject: boolean;
  canCancel: boolean;
  canReopen: boolean;
}

// `manager` = a management account (it can act for anyone, like the Excel sheet where anybody could change a cell).
export function stfPermissions(stf: Stf, s: ProcurementSettings, user: { name: string; manager: boolean }): StfPermissions {
  const holder = sameName(stf.queue, user.name);
  const creator = sameName(stf.createdByName, user.name);
  const isFinal = s.approvers.some(a => a.finalForAbove && sameName(a.name, user.name));
  const above = budgetTier(stf, s).above;
  const open = stf.status === 'pending';
  const hasNext = !!routeNext(stf);   // a route step in between: this approval only passes it on
  let blocked: string | null = null;
  if (open && !user.manager) {
    if (!holder) blocked = `It is waiting for ${stf.queue}.`;
    else if (above && !isFinal && !hasNext) {
      const who = s.approvers.filter(a => a.finalForAbove).map(a => a.name).join(' or ');
      blocked = `This STF is above ${s.tierEur} EUR — final approval must come from ${who || 'management'}. Forward it.`;
    }
  }
  return {
    canEdit: stf.status === 'pending' && (creator || holder || user.manager),
    canForward: open && (holder || creator || user.manager),
    canApprove: open && !blocked,
    approveBlockedReason: open ? blocked : null,
    canToBoard: open && (holder || user.manager),
    canBoardDecide: stf.status === 'board' && user.manager,
    canReject: (open && (holder || user.manager)) || (stf.status === 'board' && user.manager),
    canCancel: (stf.status === 'pending' || stf.status === 'board' || stf.status === 'approved') && !stf.poId && (creator || holder || user.manager),
    canReopen: (stf.status === 'rejected' || stf.status === 'cancelled') && user.manager,
  };
}
