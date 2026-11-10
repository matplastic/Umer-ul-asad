// ----------------------------------------------------
// FLOOR USAGE — actual consumption on the floor vs the BOM
// ----------------------------------------------------
// How the numbers are built (all within the chosen date range):
//
//   Issued     = approved + printed material requests for that section
//                (this is what left Store's inventory and went to the floor)
//   Returned   = material the section sent back to Store
//   Consumed   = what the section's supervisor logged as used
//   On floor   = floor stock balance right now (not date-filtered)
//
//   Expected (BOM) = for each project + pool type the section logged
//                production for:  pools completed x BOM qty per pool
//   Variance       = Consumed - Expected
//   Wastage        = positive variance beyond the tolerance %
//
// Sections and production stages share the same ids (lamination, cladding…),
// so "pools logged at that stage" is the amount of work that section did.
//
// A material used by several sections is "shared": the BOM is per whole pool
// and doesn't say which stage uses how much, so comparing one section against
// the full per-pool quantity would under-report wastage. The "By material"
// view fixes that by counting each pool once (the busiest consuming stage's
// pool count) against the material's total consumption.

import type { BOMItem, ConsumptionLog, FloorStock, Material, MaterialRequest, MaterialReturn, ProductionLog } from '../types';
import { SECTION_DEFINITIONS, SUPERVISOR_SECTIONS } from '../types';

export type UsageStatus = 'over' | 'ok' | 'under' | 'no_bom' | 'no_production';

export interface FloorUsageInput {
  requests: MaterialRequest[];
  consumption: ConsumptionLog[];
  returns: MaterialReturn[];
  floorStock: FloorStock[];
  bom: BOMItem[];
  production: ProductionLog[];
  materials: Material[];
  from?: string;          // YYYY-MM-DD inclusive
  to?: string;            // YYYY-MM-DD inclusive
  tolerancePct: number;   // allowed difference before it's flagged, e.g. 5
}

export interface UsageRow {
  key: string;
  sectionId: string;      // '*' in the by-material view
  sectionName: string;
  materialId: string;
  materialName: string;
  unit: string;
  issued: number;
  returned: number;
  consumed: number;
  onFloor: number;
  expected: number | null;   // null = can't be worked out
  variance: number | null;   // consumed - expected
  variancePct: number | null;
  status: UsageStatus;
  shared: boolean;           // material also used by another section (by-section view)
  sectionsCount: number;     // sections that touched this material
}

const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

const round = (v: number): number => Math.round(v * 1000) / 1000;

export function sectionLabel(id: string): string {
  return SECTION_DEFINITIONS.find(s => s.id === id)?.name
    || SUPERVISOR_SECTIONS.find(s => s.id === id)?.name
    || id;
}

function inRange(date: string | null | undefined, from?: string, to?: string): boolean {
  if (!from && !to) return true;
  const d = (date || '').slice(0, 10);
  if (!d) return false;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

function classify(consumed: number, expected: number | null, hasBom: boolean, hasProd: boolean, tol: number): UsageStatus {
  if (!hasBom) return 'no_bom';
  if (!hasProd) return 'no_production';
  if (expected === null || expected <= 0) return 'no_bom';
  const t = Math.max(0, tol) / 100;
  if (consumed > expected * (1 + t) + 1e-9) return 'over';
  if (consumed < expected * (1 - t) - 1e-9) return 'under';
  return 'ok';
}

export function computeFloorUsage(input: FloorUsageInput): { bySection: UsageRow[]; byMaterial: UsageRow[]; sections: { id: string; name: string }[] } {
  const { requests, consumption, returns, floorStock, bom, production, materials, from, to, tolerancePct } = input;
  const matMeta = new Map(materials.map(m => [m.id, m]));

  // ---- per (section, material) money-trail numbers
  type Acc = { sectionId: string; materialId: string; name: string; unit: string; issued: number; returned: number; consumed: number; onFloor: number };
  const acc = new Map<string, Acc>();
  const get = (sectionId: string, materialId: string, name: string, unit: string): Acc => {
    const key = `${sectionId}__${materialId}`;
    let a = acc.get(key);
    if (!a) { a = { sectionId, materialId, name, unit, issued: 0, returned: 0, consumed: 0, onFloor: 0 }; acc.set(key, a); }
    return a;
  };

  for (const r of requests) {
    // PRINTED = approved and the issue slip has been printed. Both mean the
    // material left Store, so both count as issued.
    if (r.status !== 'APPROVED' && r.status !== 'PRINTED') continue;
    if (!inRange(r.decidedAt, from, to)) continue;
    get((r.stageId as string) || 'unassigned', r.materialId, r.materialName, r.unit).issued += n(r.qtyApproved ?? r.qtyRequested);
  }
  for (const c of consumption) {
    if (!inRange(c.date, from, to)) continue;
    get(c.sectionId || 'unassigned', c.materialId, c.materialName, c.unit).consumed += n(c.qty);
  }
  for (const rt of returns) {
    if (!inRange(rt.date, from, to)) continue;
    get(rt.sectionId || 'unassigned', rt.materialId, rt.materialName, rt.unit).returned += n(rt.qty);
  }
  for (const f of floorStock) {
    if (n(f.qty) === 0) continue;
    get(f.sectionId || 'unassigned', f.materialId, f.materialName, f.unit).onFloor += n(f.qty);
  }

  // ---- pools completed per (section, project, poolType)
  const pools = new Map<string, { sectionId: string; project: string; poolType: string; qty: number }>();
  for (const p of production) {
    if (!inRange(p.date, from, to)) continue;
    const key = `${p.sectionId}__${p.projectName}__${p.poolType}`;
    const cur = pools.get(key) || { sectionId: p.sectionId, project: p.projectName, poolType: p.poolType, qty: 0 };
    cur.qty += n(p.quantity);
    pools.set(key, cur);
  }
  const poolsBySection = new Map<string, { project: string; poolType: string; qty: number }[]>();
  for (const p of pools.values()) {
    const list = poolsBySection.get(p.sectionId) || [];
    list.push({ project: p.project, poolType: p.poolType, qty: p.qty });
    poolsBySection.set(p.sectionId, list);
  }

  // ---- BOM lookup: material -> (project|poolType) -> qty per pool
  const bomQty = new Map<string, Map<string, number>>();
  for (const b of bom) {
    const m = bomQty.get(b.materialId) || new Map<string, number>();
    const k = `${b.projectName}|${b.poolType}`;
    m.set(k, (m.get(k) || 0) + n(b.qtyPerPool));
    bomQty.set(b.materialId, m);
  }

  const sectionsByMaterial = new Map<string, Set<string>>();
  for (const a of acc.values()) {
    if (a.issued === 0 && a.returned === 0 && a.consumed === 0 && a.onFloor === 0) continue;
    const s = sectionsByMaterial.get(a.materialId) || new Set<string>();
    s.add(a.sectionId);
    sectionsByMaterial.set(a.materialId, s);
  }

  const expectedFor = (sectionId: string, materialId: string): { expected: number; hasProd: boolean } => {
    const list = poolsBySection.get(sectionId) || [];
    const perPool = bomQty.get(materialId);
    let expected = 0;
    if (perPool) for (const p of list) expected += p.qty * (perPool.get(`${p.project}|${p.poolType}`) || 0);
    return { expected, hasProd: list.length > 0 };
  };

  const bySection: UsageRow[] = [];
  for (const a of acc.values()) {
    if (a.issued === 0 && a.returned === 0 && a.consumed === 0 && a.onFloor === 0) continue;
    const meta = matMeta.get(a.materialId);
    const hasBom = bomQty.has(a.materialId);
    const { expected, hasProd } = expectedFor(a.sectionId, a.materialId);
    const status = classify(a.consumed, expected, hasBom, hasProd, tolerancePct);
    const assessable = status === 'over' || status === 'ok' || status === 'under';
    const sectionsCount = sectionsByMaterial.get(a.materialId)?.size || 1;
    bySection.push({
      key: `${a.sectionId}__${a.materialId}`,
      sectionId: a.sectionId, sectionName: sectionLabel(a.sectionId),
      materialId: a.materialId, materialName: meta?.name || a.name, unit: meta?.unit || a.unit,
      issued: round(a.issued), returned: round(a.returned), consumed: round(a.consumed), onFloor: round(a.onFloor),
      expected: assessable ? round(expected) : null,
      variance: assessable ? round(a.consumed - expected) : null,
      variancePct: assessable && expected > 0 ? round(((a.consumed - expected) / expected) * 100) : null,
      status, shared: sectionsCount > 1, sectionsCount,
    });
  }

  // ---- by material: count each pool once (busiest consuming stage)
  const byMaterial: UsageRow[] = [];
  const matIds = new Set<string>();
  for (const a of acc.values()) if (a.issued || a.returned || a.consumed || a.onFloor) matIds.add(a.materialId);
  for (const materialId of matIds) {
    const rows = Array.from(acc.values()).filter(a => a.materialId === materialId);
    const meta = matMeta.get(materialId);
    const total = rows.reduce((t, a) => ({ issued: t.issued + a.issued, returned: t.returned + a.returned, consumed: t.consumed + a.consumed, onFloor: t.onFloor + a.onFloor }),
      { issued: 0, returned: 0, consumed: 0, onFloor: 0 });
    const sectionIds = Array.from(new Set(rows.map(r => r.sectionId)));
    const perPool = bomQty.get(materialId);
    const hasBom = !!perPool;

    // pools per (project|poolType) = the max across the sections that touched this material
    const maxPools = new Map<string, number>();
    let hasProd = false;
    for (const sid of sectionIds) {
      for (const p of poolsBySection.get(sid) || []) {
        hasProd = true;
        const k = `${p.project}|${p.poolType}`;
        maxPools.set(k, Math.max(maxPools.get(k) || 0, p.qty));
      }
    }
    let expected = 0;
    if (perPool) for (const [k, qty] of maxPools) expected += qty * (perPool.get(k) || 0);

    const status = classify(total.consumed, expected, hasBom, hasProd, tolerancePct);
    const assessable = status === 'over' || status === 'ok' || status === 'under';
    byMaterial.push({
      key: `*__${materialId}`, sectionId: '*',
      sectionName: sectionIds.length === 1 ? sectionLabel(sectionIds[0]) : `${sectionIds.length} sections`,
      materialId, materialName: meta?.name || rows[0].name, unit: meta?.unit || rows[0].unit,
      issued: round(total.issued), returned: round(total.returned), consumed: round(total.consumed), onFloor: round(total.onFloor),
      expected: assessable ? round(expected) : null,
      variance: assessable ? round(total.consumed - expected) : null,
      variancePct: assessable && expected > 0 ? round(((total.consumed - expected) / expected) * 100) : null,
      status, shared: sectionIds.length > 1, sectionsCount: sectionIds.length,
    });
  }

  const order: Record<UsageStatus, number> = { over: 0, under: 1, ok: 2, no_bom: 3, no_production: 4 };
  const sortRows = (a: UsageRow, b: UsageRow) =>
    order[a.status] - order[b.status]
    || (b.variancePct ?? -1e9) - (a.variancePct ?? -1e9)
    || a.sectionName.localeCompare(b.sectionName) || a.materialName.localeCompare(b.materialName);
  bySection.sort(sortRows);
  byMaterial.sort(sortRows);

  const sections = Array.from(new Set(bySection.map(r => r.sectionId))).map(id => ({ id, name: sectionLabel(id) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { bySection, byMaterial, sections };
}
