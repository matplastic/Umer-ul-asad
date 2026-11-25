import React, { useState } from 'react';
import { X, Upload, FileText } from 'lucide-react';
import { RfqMaster, SupplierQuote } from '../types';

interface Props {
  isOpen: boolean;
  rfq: RfqMaster | null;
  quote: SupplierQuote | null;
  onClose: () => void;
  onSaveQuote: (rfqId: string, updatedQuote: SupplierQuote) => void;
}

export const EnterQuoteModal: React.FC<Props> = ({ isOpen, rfq, quote, onClose, onSaveQuote }) => {
  if (!isOpen || !rfq || !quote) return null;

  const [quoteRef, setQuoteRef] = useState(quote.quoteReferenceNo || '');
  const [paymentTerms, setPaymentTerms] = useState(quote.paymentTerms || '30 Days Credit');
  const [leadTime, setLeadTime] = useState(quote.leadTimeDays || 7);
  const [freightCost, setFreightCost] = useState(quote.freightCost || 0);
  const [vatPercent, setVatPercent] = useState(quote.vatPercent || 5);
  const [unitPrices, setUnitPrices] = useState<Record<string, number>>(quote.unitPrices || {});
  const [fileName, setFileName] = useState(quote.quoteFileName || '');
  const [fileUrl, setFileUrl] = useState(quote.quoteDocumentUrl || '');

  const handlePriceChange = (itemId: string, price: number) => {
    setUnitPrices({ ...unitPrices, [itemId]: price });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFileName(file.name);
      setFileUrl(URL.createObjectURL(file));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const updatedQuote: SupplierQuote = {
      ...quote,
      quoteReferenceNo: quoteRef.trim() || `QT-${Date.now().toString().slice(-4)}`,
      paymentTerms,
      leadTimeDays: leadTime,
      freightCost,
      vatPercent,
      unitPrices,
      quoteFileName: fileName || 'Uploaded_Quotation.pdf',
      quoteDocumentUrl: fileUrl,
      status: 'PENDING',
      submittedAt: new Date().toISOString().split('T')[0]
    };

    onSaveQuote(rfq.id, updatedQuote);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-3xl p-6 text-slate-100 shadow-2xl">
        <div className="flex justify-between items-center border-b border-slate-700 pb-4 mb-4">
          <div>
            <h2 className="text-lg font-bold text-cyan-400">Enter Supplier Quotation Data</h2>
            <p className="text-xs text-slate-400">Request: <span className="font-mono text-emerald-300">{rfq.requestNumber}</span> | Vendor: <span className="text-amber-300 font-semibold">{quote.supplierName}</span></p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={20} /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Quote Reference No.</label>
              <input
                type="text"
                placeholder="e.g. FLC-QT-2026-99"
                value={quoteRef}
                onChange={e => setQuoteRef(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-sm text-white"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Payment Terms</label>
              <input
                type="text"
                value={paymentTerms}
                onChange={e => setPaymentTerms(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-sm text-white"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Lead Time (Days)</label>
              <input
                type="number"
                min="0"
                value={leadTime}
                onChange={e => setLeadTime(parseInt(e.target.value) || 0)}
                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-sm text-white"
                required
              />
            </div>
          </div>

          {/* Line Item Prices */}
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-3">
            <h3 className="text-xs font-semibold text-slate-300 uppercase mb-3">Item Quoted Unit Rates (AED)</h3>
            <div className="space-y-2">
              {rfq.items.map(item => (
                <div key={item.id} className="flex items-center justify-between gap-4 bg-slate-800/80 p-2 rounded border border-slate-700">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-slate-200">{item.materialName}</p>
                    <p className="text-xs text-slate-400">Qty: {item.quantity} {item.unit}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">Unit Price:</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={unitPrices[item.id] || ''}
                      onChange={e => handlePriceChange(item.id, parseFloat(e.target.value) || 0)}
                      className="w-28 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm text-emerald-400 font-mono text-right"
                      required
                    />
                    <span className="text-xs text-slate-400">AED</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Freight / Delivery Cost (AED)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={freightCost}
                onChange={e => setFreightCost(parseFloat(e.target.value) || 0)}
                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-sm text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">VAT Percentage (%)</label>
              <input
                type="number"
                value={vatPercent}
                onChange={e => setVatPercent(parseFloat(e.target.value) || 0)}
                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-sm text-white"
              />
            </div>
          </div>

          {/* Quotation Document Upload */}
          <div className="border border-dashed border-slate-600 rounded-lg p-4 bg-slate-900/40 text-center">
            <label className="cursor-pointer flex flex-col items-center gap-2">
              <Upload className="text-cyan-400" size={24} />
              <span className="text-xs text-slate-300 font-medium">
                {fileName ? `File Attached: ${fileName}` : 'Click to Upload Supplier Quotation PDF / Scan'}
              </span>
              <input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={handleFileUpload} className="hidden" />
            </label>
          </div>

          <div className="flex justify-end gap-3 pt-3 border-t border-slate-700">
            <button type="button" onClick={onClose} className="px-4 py-1.5 bg-slate-700 text-slate-300 rounded text-sm">Cancel</button>
            <button type="submit" className="px-5 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-sm font-semibold">Save Quote Data</button>
          </div>
        </form>
      </div>
    </div>
  );
};