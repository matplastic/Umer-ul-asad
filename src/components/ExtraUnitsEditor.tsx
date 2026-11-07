import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { ExtraUnit } from '../types';
import { equivalentsText } from '../lib/materialUnits';

/**
 * Edits the "extra units" of a material — what ONE main unit contains.
 * Example: main unit "bars"  →  Length 6 m, Weight 24 kg.
 * `previewQty` (optional) shows the calculated equivalents, e.g. 20 bars = 120 m · 480 kg.
 */

interface Props {
  unit: string; // main unit, e.g. "bars"
  value: ExtraUnit[];
  onChange: (next: ExtraUnit[]) => void;
  previewQty?: number;
  testIdPrefix?: string;
}

const PRESETS: { label: string; unit: string }[] = [
  { label: 'Length', unit: 'm' },
  { label: 'Weight', unit: 'kg' },
  { label: 'Area', unit: 'm²' },
  { label: 'Volume', unit: 'ltr' },
];

export const ExtraUnitsEditor: React.FC<Props> = ({ unit, value, onChange, previewQty, testIdPrefix = 'extra-unit' }) => {
  const mainUnit = unit.trim() || 'unit';
  const update = (i: number, patch: Partial<ExtraUnit>) => onChange(value.map((u, k) => (k === i ? { ...u, ...patch } : u)));
  const remove = (i: number) => onChange(value.filter((_, k) => k !== i));
  const add = (label = '', u = '') => onChange([...value, { label, unit: u, perUnit: 0 }]);

  const input = 'bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white';
  const preview = previewQty !== undefined && previewQty > 0 ? equivalentsText({ extraUnits: value }, previewQty) : '';

  return (
    <div className="space-y-2" data-testid={`${testIdPrefix}-editor`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
          Extra units — what ONE {mainUnit} contains
        </span>
        <span className="text-[11px] text-slate-500">add:</span>
        {PRESETS.filter(p => !value.some(v => v.label.toLowerCase() === p.label.toLowerCase())).map(p => (
          <button
            key={p.label}
            type="button"
            onClick={() => add(p.label, p.unit)}
            data-testid={`${testIdPrefix}-add-${p.label.toLowerCase()}`}
            className="px-2 py-1 text-[11px] font-bold rounded-lg bg-slate-800 hover:bg-slate-700 text-orange-300 border border-slate-700 cursor-pointer"
          >
            + {p.label} ({p.unit})
          </button>
        ))}
        <button
          type="button"
          onClick={() => add()}
          data-testid={`${testIdPrefix}-add-custom`}
          className="px-2 py-1 text-[11px] font-bold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer flex items-center gap-1"
        >
          <Plus className="h-3 w-3" /> Other
        </button>
      </div>

      {value.length === 0 ? (
        <p className="text-[11px] text-slate-500">
          Optional. Example: a metal bar counted in “bars” — add Length (m) and Weight (kg) per bar, and the Store will show the total meters and kilograms in stock.
        </p>
      ) : (
        <div className="space-y-1.5">
          {value.map((u, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2" data-testid={`${testIdPrefix}-row-${i}`}>
              <span className="text-[11px] text-slate-400">1 {mainUnit} =</span>
              <input
                type="number"
                step="any"
                min="0"
                placeholder="amount"
                value={u.perUnit || ''}
                onChange={e => update(i, { perUnit: Number(e.target.value) })}
                data-testid={`${testIdPrefix}-amount-${i}`}
                className={`${input} w-24`}
              />
              <input
                placeholder="unit (m, kg…)"
                value={u.unit}
                onChange={e => update(i, { unit: e.target.value })}
                data-testid={`${testIdPrefix}-unit-${i}`}
                className={`${input} w-24`}
              />
              <input
                placeholder="name (Length…)"
                value={u.label}
                onChange={e => update(i, { label: e.target.value })}
                data-testid={`${testIdPrefix}-label-${i}`}
                className={`${input} w-32`}
              />
              <button type="button" onClick={() => remove(i)} title="Remove" className="text-slate-500 hover:text-rose-400 cursor-pointer">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {preview && (
        <p className="text-[11px] text-emerald-400 font-mono" data-testid={`${testIdPrefix}-preview`}>
          {previewQty} {mainUnit} = {preview}
        </p>
      )}
    </div>
  );
};
