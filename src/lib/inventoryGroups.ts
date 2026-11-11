// ----------------------------------------------------
// STORE INVENTORY GROUPS
// ----------------------------------------------------
// The portals a material can live under in Store: MEP, Civil, Consumable
// Items and Other. This is the ONE place that lists them — the Inventory tab,
// reports, Inventory Ledger and the supervisor's request form all read from
// here, so adding a fifth group later means editing this file (and nothing
// will silently fall back to "Other").
//
// Independent of a material's `section` (a production stage).

import type { Material } from '../types';

export type InventoryGroup = 'mep' | 'civil' | 'consumable' | 'other';

// Display order everywhere ("Other" stays last).
export const INVENTORY_GROUPS: readonly InventoryGroup[] = ['mep', 'civil', 'consumable', 'other'];

export const GROUP_LABELS: Record<InventoryGroup, string> = {
  mep: 'MEP Materials',
  civil: 'Civil Materials',
  consumable: 'Consumable Items',
  other: 'Other Materials',
};

export const GROUP_SHORT_LABELS: Record<InventoryGroup, string> = {
  mep: 'MEP',
  civil: 'Civil',
  consumable: 'Consumable',
  other: 'Other',
};

export const GROUP_BADGE: Record<InventoryGroup, string> = {
  mep: 'bg-sky-950/40 text-sky-400 border-sky-800',
  civil: 'bg-amber-950/40 text-amber-400 border-amber-800',
  consumable: 'bg-emerald-950/40 text-emerald-400 border-emerald-800',
  other: 'bg-slate-800 text-slate-400 border-slate-700',
};

// Materials saved before groups existed — or with an unrecognised value —
// are treated as 'other'.
export function groupOf(m: Pick<Material, 'inventoryGroup'> | null | undefined): InventoryGroup {
  const g = m?.inventoryGroup;
  return g && (INVENTORY_GROUPS as readonly string[]).includes(g) ? (g as InventoryGroup) : 'other';
}
