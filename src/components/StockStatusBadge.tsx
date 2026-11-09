import React from 'react';
import { StockStatus } from '../lib/stockAlerts';

export const StockStatusBadge: React.FC<{ status: StockStatus }> = ({ status }) => {
  if (status === 'urgent') {
    return (
      <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-rose-600 text-white tracking-wide">
        Urgent
      </span>
    );
  }
  if (status === 'reorder') {
    return (
      <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-rose-900/60 text-rose-300 border border-rose-700 tracking-wide">
        Reorder
      </span>
    );
  }
  return <span className="text-slate-600 text-[10px]">OK</span>;
};
