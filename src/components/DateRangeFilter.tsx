import React, { useState } from 'react';
import { Calendar } from 'lucide-react';

export interface DateRange {
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
}

interface DateRangeFilterProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function getPresetRange(preset: string): DateRange {
  const today = new Date();
  switch (preset) {
    case 'today':
      return { startDate: fmt(today), endDate: fmt(today) };
    case 'week': {
      const start = new Date(today);
      start.setDate(today.getDate() - today.getDay());
      return { startDate: fmt(start), endDate: fmt(today) };
    }
    case 'month': {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      return { startDate: fmt(start), endDate: fmt(today) };
    }
    case 'lastMonth': {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const end = new Date(today.getFullYear(), today.getMonth(), 0);
      return { startDate: fmt(start), endDate: fmt(end) };
    }
    case 'year': {
      const start = new Date(today.getFullYear(), 0, 1);
      return { startDate: fmt(start), endDate: fmt(today) };
    }
    default:
      return { startDate: fmt(today), endDate: fmt(today) };
  }
}

export const DateRangeFilter: React.FC<DateRangeFilterProps> = ({ value, onChange }) => {
  const [activePreset, setActivePreset] = useState('month');

  const presets = [
    { id: 'today', label: 'Today' },
    { id: 'week', label: 'This Week' },
    { id: 'month', label: 'This Month' },
    { id: 'lastMonth', label: 'Last Month' },
    { id: 'year', label: 'This Year' },
  ];

  const applyPreset = (id: string) => {
    setActivePreset(id);
    onChange(getPresetRange(id));
  };

  return (
    <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1.5 text-slate-400 text-xs font-bold uppercase tracking-wider shrink-0">
        <Calendar className="h-3.5 w-3.5" />
        Date Range
      </div>
      <div className="flex gap-1 flex-wrap">
        {presets.map(p => (
          <button
            key={p.id}
            onClick={() => applyPreset(p.id)}
            data-testid={`date-preset-${p.id}`}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
              activePreset === p.id
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 ml-auto">
        <input
          type="date"
          value={value.startDate}
          onChange={(e) => {
            setActivePreset('custom');
            onChange({ ...value, startDate: e.target.value });
          }}
          data-testid="date-range-start"
          className="px-2 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-1 focus:ring-indigo-400"
        />
        <span className="text-slate-400 text-xs">to</span>
        <input
          type="date"
          value={value.endDate}
          onChange={(e) => {
            setActivePreset('custom');
            onChange({ ...value, endDate: e.target.value });
          }}
          data-testid="date-range-end"
          className="px-2 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-1 focus:ring-indigo-400"
        />
      </div>
    </div>
  );
};

export default DateRangeFilter;
