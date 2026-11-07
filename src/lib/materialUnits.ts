import { Material, ExtraUnit } from '../types';

/**
 * Extra measurements for a Store material.
 *
 * A material is COUNTED in one main unit (e.g. "bars"). Optionally it also
 * knows what ONE main unit contains in other units, e.g. 1 bar = 6 m = 24 kg.
 * Stock stays counted in the main unit (single source of truth); the other
 * units are always calculated from it:  20 bars → 120 m · 480 kg.
 */

export const cleanExtraUnits = (list?: ExtraUnit[] | null): ExtraUnit[] =>
  (list || [])
    .map(u => ({ label: String(u.label || '').trim(), unit: String(u.unit || '').trim(), perUnit: Number(u.perUnit) }))
    .filter(u => u.unit && Number.isFinite(u.perUnit) && u.perUnit > 0);

export const extraUnitsOf = (m?: Pick<Material, 'extraUnits'> | null): ExtraUnit[] => cleanExtraUnits(m?.extraUnits);

const fmt = (n: number): string => {
  const r = Math.round(n * 1000) / 1000;
  return r.toLocaleString('en-US', { maximumFractionDigits: 3 });
};

/** [{label:'Length', unit:'m', value:120}, …] for a given quantity of the main unit. */
export const equivalents = (m: Pick<Material, 'extraUnits'> | null | undefined, qty: number) =>
  extraUnitsOf(m).map(u => ({ label: u.label, unit: u.unit, value: (Number(qty) || 0) * u.perUnit }));

/** "120 m · 480 kg" ('' when the material has no extra units). */
export const equivalentsText = (m: Pick<Material, 'extraUnits'> | null | undefined, qty: number): string =>
  equivalents(m, qty).map(e => `${fmt(e.value)} ${e.unit}`).join(' · ');

/** "6 m · 24 kg per bar" — what ONE main unit contains. */
export const perUnitText = (m: Pick<Material, 'extraUnits' | 'unit'> | null | undefined): string => {
  const u = extraUnitsOf(m);
  if (u.length === 0) return '';
  return `${u.map(x => `${fmt(x.perUnit)} ${x.unit}`).join(' · ')} per ${m?.unit || 'unit'}`;
};
