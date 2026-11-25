import React from 'react';
import { CheckCircle, FileText, ArrowLeft, Award, Clock, DollarSign } from 'lucide-react';
import { RfqMaster, SupplierQuote } from '../types';

interface Props {
  rfq: RfqMaster;
  onBack: () => void;
  onAwardQuote: (rfq: RfqMaster, quote: SupplierQuote) => void;
  onEnterQuoteData: (quote: SupplierQuote) => void;
}

export const RfqComparisonMatrix: React.FC<Props> = ({ rfq, onBack, onAwardQuote, onEnterQuoteData }) => {
  // Find minimum price for each item across quotes that have submitted prices
  const minPrices: Record<string, number> = {};
  rfq.items.forEach(item => {
    let min = Infinity;
    rfq.suppliers.forEach(s => {
      const price = s.unitPrices[item.id];
      if (price && price > 0 && price < min) {
        min = price;
      }
    });
    if (min !== Infinity) minPrices[item.id] = min;
  });

  // Calculate total evaluation price per supplier
  const supplierTotals = rfq.suppliers.map(sup => {
    const itemSubtotal = rfq.items.reduce((sum, item) => sum + (item.quantity * (sup.unitPrices[item.id] || 0)), 0);
    const vat = itemSubtotal * (sup.vatPercent / 100);
    const grandTotal = itemSubtotal + vat + sup.freightCost;
    return { supplierId: sup.id, itemSubtotal, vat, grandTotal };
  });

  const lowestGrandTotal = Math.min(
    ...supplierTotals.filter(st => st.grandTotal > 0).map(st => st.grandTotal)
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between bg-slate-800/80 p-4 rounded-xl border border-slate-700">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg">
            <ArrowLeft size={20} />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-white">{rfq.title}</h2>
              <span className="font-mono bg-emerald-950 text-emerald-400 border border-emerald-800 text-xs px-2.5 py-0.5 rounded-full font-semibold">
                {rfq.requestNumber}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">Created on {rfq.createdAt} by {rfq.createdBy} | Dept: {rfq.department}</p>
          </div>
        </div>
      </div>

      {/* Comparison Matrix Table */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-x-auto shadow-2xl">
        <table className="w-full text-left text-xs text-slate-200 border-collapse">
          <thead>
            <tr className="bg-slate-900/90 text-slate-300 border-b border-slate-700">
              <th className="p-4 min-w-[200px] border-r border-slate-800">Items / Evaluation Metrics</th>
              <th className="p-4 text-center min-w-[80px] border-r border-slate-800">Qty / Unit</th>
              {rfq.suppliers.map(sup => {
                const totalObj = supplierTotals.find(st => st.supplierId === sup.id);
                const isBestOverall = totalObj && totalObj.grandTotal === lowestGrandTotal && lowestGrandTotal > 0;

                return (
                  <th key={sup.id} className={`p-4 min-w-[240px] text-center border-r border-slate-800 relative ${isBestOverall ? 'bg-emerald-950/40' : ''}`}>
                    {isBestOverall && (
                      <span className="absolute top-2 right-2 bg-emerald-500 text-slate-950 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">
                        Lowest Cost
                      </span>
                    )}
                    <p className="font-bold text-sm text-slate-100">{sup.supplierName}</p>
                    <p className="text-[11px] text-slate-400 font-mono mt-0.5">{sup.quoteReferenceNo || 'Quote Pending'}</p>
                    <button
                      onClick={() => onEnterQuoteData(sup)}
                      className="mt-2 text-[11px] text-cyan-400 hover:underline inline-flex items-center gap-1"
                    >
                      <FileText size={12} /> {sup.quoteReferenceNo ? 'Edit Quote Data' : 'Enter Received Quote'}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {/* Line items pricing rows */}
            {rfq.items.map((item, idx) => (
              <tr key={item.id} className={idx % 2 === 0 ? 'bg-slate-800/50' : 'bg-slate-900/30'}>
                <td className="p-4 font-medium border-r border-slate-800">
                  <p className="text-slate-100">{item.materialName}</p>
                  {item.description && <p className="text-[10px] text-slate-400">{item.description}</p>}
                </td>
                <td className="p-4 text-center font-mono border-r border-slate-800">
                  {item.quantity} {item.unit}
                </td>
                {rfq.suppliers.map(sup => {
                  const unitPrice = sup.unitPrices[item.id] || 0;
                  const lineTotal = unitPrice * item.quantity;
                  const isLowest = unitPrice > 0 && unitPrice === minPrices[item.id];

                  return (
                    <td key={sup.id} className={`p-4 text-center border-r border-slate-800 ${isLowest ? 'bg-emerald-900/20' : ''}`}>
                      {unitPrice > 0 ? (
                        <div>
                          <p className={`font-mono text-sm font-bold ${isLowest ? 'text-emerald-400' : 'text-slate-200'}`}>
                            AED {unitPrice.toFixed(2)}
                          </p>
                          <p className="text-[10px] text-slate-400 font-mono">Total: AED {lineTotal.toFixed(2)}</p>
                          {isLowest && <span className="text-[9px] text-emerald-400 font-semibold uppercase">(Lowest Rate)</span>}
                        </div>
                      ) : (
                        <span className="text-slate-500 italic">Not Quoted</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}

            {/* Evaluation Summary Section */}
            <tr className="bg-slate-900 font-semibold border-t-2 border-slate-700">
              <td className="p-3 border-r border-slate-800 text-slate-300">Subtotal Material Cost</td>
              <td className="p-3 border-r border-slate-800"></td>
              {rfq.suppliers.map(sup => {
                const totalObj = supplierTotals.find(st => st.supplierId === sup.id);
                return (
                  <td key={sup.id} className="p-3 text-center font-mono border-r border-slate-800 text-slate-200">
                    AED {(totalObj?.itemSubtotal || 0).toFixed(2)}
                  </td>
                );
              })}
            </tr>

            <tr className="bg-slate-900/70">
              <td className="p-3 border-r border-slate-800 text-slate-400">Freight & Handling</td>
              <td className="p-3 border-r border-slate-800"></td>
              {rfq.suppliers.map(sup => (
                <td key={sup.id} className="p-3 text-center font-mono border-r border-slate-800 text-slate-300">
                  AED {sup.freightCost.toFixed(2)}
                </td>
              ))}
            </tr>

            <tr className="bg-slate-900 font-bold border-t border-b border-slate-700">
              <td className="p-4 border-r border-slate-800 text-emerald-400 text-sm">TOTAL LANDED COMMERCIAL EVALUATION</td>
              <td className="p-4 border-r border-slate-800"></td>
              {rfq.suppliers.map(sup => {
                const totalObj = supplierTotals.find(st => st.supplierId === sup.id);
                const isBest = totalObj && totalObj.grandTotal === lowestGrandTotal && lowestGrandTotal > 0;

                return (
                  <td key={sup.id} className={`p-4 text-center border-r border-slate-800 ${isBest ? 'bg-emerald-950/60' : ''}`}>
                    <p className={`text-base font-mono font-black ${isBest ? 'text-emerald-400' : 'text-slate-100'}`}>
                      AED {(totalObj?.grandTotal || 0).toFixed(2)}
                    </p>
                    <p className="text-[10px] text-slate-400">Inc. {sup.vatPercent}% VAT</p>
                  </td>
                );
              })}
            </tr>

            {/* Terms Comparison Rows */}
            <tr className="bg-slate-800/40">
              <td className="p-3 border-r border-slate-800 text-slate-400 flex items-center gap-1.5"><Clock size={14}/> Payment Terms</td>
              <td className="p-3 border-r border-slate-800"></td>
              {rfq.suppliers.map(sup => (
                <td key={sup.id} className="p-3 text-center border-r border-slate-800 text-slate-300">
                  {sup.paymentTerms || 'N/A'}
                </td>
              ))}
            </tr>

            <tr className="bg-slate-800/40">
              <td className="p-3 border-r border-slate-800 text-slate-400">Delivery Lead Time</td>
              <td className="p-3 border-r border-slate-800"></td>
              {rfq.suppliers.map(sup => (
                <td key={sup.id} className="p-3 text-center border-r border-slate-800 text-slate-300">
                  {sup.leadTimeDays ? `${sup.leadTimeDays} Days` : 'N/A'}
                </td>
              ))}
            </tr>

            <tr className="bg-slate-800/40">
              <td className="p-3 border-r border-slate-800 text-slate-400">Quote Document Attachment</td>
              <td className="p-3 border-r border-slate-800"></td>
              {rfq.suppliers.map(sup => (
                <td key={sup.id} className="p-3 text-center border-r border-slate-800">
                  {sup.quoteFileName ? (
                    <span className="text-cyan-400 underline cursor-pointer text-[11px] inline-flex items-center gap-1">
                      <FileText size={12} /> {sup.quoteFileName}
                    </span>
                  ) : (
                    <span className="text-slate-500 italic">No File</span>
                  )}
                </td>
              ))}
            </tr>

            {/* Action Row */}
            <tr className="bg-slate-900 border-t border-slate-700">
              <td className="p-4 border-r border-slate-800 font-bold text-slate-200">Decision & Workflow Action</td>
              <td className="p-4 border-r border-slate-800"></td>
              {rfq.suppliers.map(sup => {
                const totalObj = supplierTotals.find(st => st.supplierId === sup.id);
                const hasPrices = totalObj && totalObj.grandTotal > 0;

                return (
                  <td key={sup.id} className="p-4 text-center border-r border-slate-800">
                    {sup.status === 'AWARDED' ? (
                      <span className="bg-emerald-900 text-emerald-300 font-semibold px-3 py-1 rounded-full text-xs inline-flex items-center gap-1">
                        <CheckCircle size={14} /> Winner Awarded
                      </span>
                    ) : (
                      <button
                        disabled={!hasPrices || rfq.status === 'AWARDED'}
                        onClick={() => onAwardQuote(rfq, sup)}
                        className={`w-full py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition ${
                          hasPrices && rfq.status !== 'AWARDED'
                            ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/30'
                            : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                        }`}
                      >
                        <Award size={14} /> Award Quote & Create STF
                      </button>
                    )}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};