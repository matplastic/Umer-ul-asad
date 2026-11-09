// ----------------------------------------------------
// STOCK ALERTS — shared rules for Reorder / Urgent levels
// ----------------------------------------------------
// One place that decides whether a material is OK, at/below its Reorder
// Level, or at/below its (lower) Urgent Level. The Inventory table, the
// Reorder page and the settings modal all use this, and
// netlify/functions/lib/stockAlertCore.cjs mirrors the same rule for the
// e-mail check — keep the two in sync if you ever change it.
//
//   stock <= urgentLevel  (and urgentLevel  > 0)  -> 'urgent'
//   stock <= reorderLevel (and reorderLevel > 0)  -> 'reorder'
//   otherwise                                     -> 'ok'
//
// A level of 0 (or empty) means "that level is switched off".

import type { Material } from '../types';

export type StockStatus = 'ok' | 'reorder' | 'urgent';

export const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function getStockStatus(
  m: Pick<Material, 'currentStock' | 'reorderLevel' | 'urgentLevel'>,
): StockStatus {
  const stock = num(m.currentStock);
  const urgent = num(m.urgentLevel);
  const reorder = num(m.reorderLevel);
  if (urgent > 0 && stock <= urgent) return 'urgent';
  if (reorder > 0 && stock <= reorder) return 'reorder';
  return 'ok';
}

// "Following" = e-mail alerts are on for this material. Materials saved
// before this field existed have no value and count as following.
export const isFollowed = (m: Pick<Material, 'alertsEnabled'>): boolean => m.alertsEnabled !== false;

export const STATUS_ROW_CLASS: Record<StockStatus, string> = {
  ok: '',
  reorder: 'bg-rose-950/30 border-l-4 border-l-rose-700',
  urgent: 'bg-rose-950/70 border-l-4 border-l-rose-500',
};

// ----------------------------------------------------
// Immediate e-mail check
// ----------------------------------------------------
// Called (debounced) by firebaseService every time the materials list is
// written, so a stock drop from ANY device (store keeper, supervisor
// approval, QC incoming, Excel import …) asks the server to look at stock
// right away. The Netlify function only e-mails when an item has newly
// crossed into Reorder/Urgent, so extra calls are harmless. A scheduled
// function runs the same check every 15 minutes as a safety net.
let alertTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleStockAlertCheck(delayMs = 4000): void {
  if (typeof window === 'undefined') return;
  if (alertTimer) clearTimeout(alertTimer);
  alertTimer = setTimeout(() => {
    alertTimer = null;
    fetch('/.netlify/functions/stock-alert-check', { method: 'POST' }).catch(() => {
      /* offline / local dev without Netlify — the scheduled check will catch it */
    });
  }, delayMs);
}
