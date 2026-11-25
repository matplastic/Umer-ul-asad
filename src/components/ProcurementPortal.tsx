import React, { useState, useEffect } from 'react';
import { Plus, Search, Layers, FileCheck, ShoppingCart, ArrowRight, Eye, ShieldCheck, FileText } from 'lucide-react';
import { RfqMaster, StfRecord, PurchaseOrder, SupplierQuote } from '../types';
import { getRfqs, saveRfqs, getStfs, getPos, convertQuoteToStf, convertStfToPo } from '../lib/procurementStore';
import { CreateRfqModal } from './CreateRfqModal';
import { EnterQuoteModal } from './EnterQuoteModal';
import { RfqComparisonMatrix } from './RfqComparisonMatrix';

export const ProcurementPortal: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'rfqs' | 'stfs' | 'pos'>('rfqs');
  const [rfqs, setRfqs] = useState<RfqMaster[]>([]);
  const [stfs, setStfs] = useState<StfRecord[]>([]);
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Modals state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedRfqForMatrix, setSelectedRfqForMatrix] = useState<RfqMaster | null>(null);
  const [quoteEditTarget, setQuoteEditTarget] = useState<{ rfq: RfqMaster; quote: SupplierQuote } | null>(null);

  useEffect(() => {
    setRfqs(getRfqs());
    setStfs(getStfs());
    setPos(getPos());
  }, []);

  const refreshData = () => {
    setRfqs(getRfqs());
    setStfs(getStfs());
    setPos(getPos());
  };

  const handleSaveNewRfq = (newRfq: RfqMaster) => {
    const updated = [newRfq, ...rfqs];
    setRfqs(updated);
    saveRfqs(updated);
  };

  const handleSaveQuoteData = (rfqId: string, updatedQuote: SupplierQuote) => {
    const updatedRfqs = rfqs.map(r => {
      if (r.id === rfqId) {
        const suppliers = r.suppliers.map(s => s.id === updatedQuote.id ? updatedQuote : s);
        return { ...r, suppliers, status: 'QUOTED' as const };
      }
      return r;
    });
    setRfqs(updatedRfqs);
    saveRfqs(updatedRfqs);
    if (selectedRfqForMatrix?.id === rfqId) {
      const refreshed = updatedRfqs.find(r => r.id === rfqId) || null;
      setSelectedRfqForMatrix(refreshed);
    }
  };

  const handleAwardQuote = (rfq: RfqMaster, quote: SupplierQuote) => {
    if (confirm(`Confirm awarding quote from "${quote.supplierName}"? This will auto-create an STF record.`)) {
      convertQuoteToStf(rfq, quote);
      refreshData();
      setSelectedRfqForMatrix(null);
      setActiveTab('stfs');
    }
  };

  const handleConvertStfToPo = (stf: StfRecord) => {
    if (confirm(`Convert STF "${stf.stfNumber}" to Purchase Order?`)) {
      convertStfToPo(stf);
      refreshData();
      setActiveTab('pos');
    }
  };

  // Cross-reference search across chain
  const filteredRfqs = rfqs.filter(r =>
    r.requestNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
    r.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    r.suppliers.some(s => s.supplierName.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const filteredStfs = stfs.filter(s =>
    s.stfNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.rfqNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.supplierName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredPos = pos.filter(p =>
    p.poNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.stfNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.rfqNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.supplierName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Module Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-slate-800/80 p-5 rounded-2xl border border-slate-700/80 shadow-xl">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
            <span className="text-emerald-400">MAT PLASTIC</span> Procurement & Chain Workflow
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            End-to-End Traceability: <span className="text-amber-400 font-semibold">RFQ Request</span> → <span className="text-cyan-400 font-semibold">Quotation Matrix</span> → <span className="text-purple-400 font-semibold">STF</span> → <span className="text-emerald-400 font-semibold">Purchase Order</span>
          </p>
        </div>

        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-2.5 rounded-xl shadow-lg shadow-emerald-900/40 flex items-center gap-2 text-sm transition"
        >
          <Plus size={18} /> Create RFQ Request
        </button>
      </div>

      {/* Global Search & Chain Filter */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Navigation Tabs */}
        <div className="flex bg-slate-800/90 p-1 rounded-xl border border-slate-700/80">
          <button
            onClick={() => { setActiveTab('rfqs'); setSelectedRfqForMatrix(null); }}
            className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition ${
              activeTab === 'rfqs' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Layers size={14} /> RFQ Requests ({rfqs.length})
          </button>
          <button
            onClick={() => { setActiveTab('stfs'); setSelectedRfqForMatrix(null); }}
            className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition ${
              activeTab === 'stfs' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <FileCheck size={14} /> STF Requests ({stfs.length})
          </button>
          <button
            onClick={() => { setActiveTab('pos'); setSelectedRfqForMatrix(null); }}
            className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition ${
              activeTab === 'pos' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <ShoppingCart size={14} /> Purchase Orders ({pos.length})
          </button>
        </div>

        {/* Search Input */}
        <div className="relative w-full md:w-80">
          <Search size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search by PO #, STF #, RFQ #, or Vendor..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
          />
        </div>
      </div>

      {/* View Matrix Screen or Main Dashboard Tabs */}
      {selectedRfqForMatrix ? (
        <RfqComparisonMatrix
          rfq={selectedRfqForMatrix}
          onBack={() => setSelectedRfqForMatrix(null)}
          onAwardQuote={handleAwardQuote}
          onEnterQuoteData={(quote) => setQuoteEditTarget({ rfq: selectedRfqForMatrix, quote })}
        />
      ) : (
        <>
          {/* TAB 1: RFQ REQUESTS */}
          {activeTab === 'rfqs' && (
            <div className="grid grid-cols-1 gap-4">
              {filteredRfqs.map(rfq => (
                <div key={rfq.id} className="bg-slate-800 border border-slate-700/80 rounded-xl p-5 hover:border-slate-600 transition shadow-lg">
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                      <div className="flex items-center gap-3">
                        <span className="font-mono bg-emerald-950 text-emerald-400 border border-emerald-800 text-xs px-2.5 py-1 rounded-md font-bold">
                          {rfq.requestNumber}
                        </span>
                        <h3 className="text-lg font-bold text-white">{rfq.title}</h3>
                        <span className="text-[10px] bg-slate-700 text-slate-300 px-2 py-0.5 rounded uppercase font-semibold">
                          {rfq.status}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1">Created: {rfq.createdAt} | Items Count: {rfq.items.length}</p>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="bg-amber-950/60 text-amber-300 border border-amber-800 text-xs px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5">
                        <Layers size={14} /> {rfq.suppliers.length} Suppliers Requested
                      </span>
                      <button
                        onClick={() => setSelectedRfqForMatrix(rfq)}
                        className="bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold px-4 py-2 rounded-lg flex items-center gap-1.5 shadow-md"
                      >
                        <Eye size={14} /> Compare Quotes
                      </button>
                    </div>
                  </div>

                  {/* Supplier Summary Chips */}
                  <div className="mt-4 pt-3 border-t border-slate-700/60 flex flex-wrap gap-2">
                    {rfq.suppliers.map(sup => (
                      <div key={sup.id} className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs flex items-center gap-2">
                        <span className="text-slate-200 font-medium">{sup.supplierName}</span>
                        {sup.quoteReferenceNo ? (
                          <span className="text-emerald-400 font-mono text-[10px] bg-emerald-950/50 px-1.5 py-0.5 rounded">
                            {sup.quoteReferenceNo}
                          </span>
                        ) : (
                          <span className="text-slate-500 text-[10px] italic">Pending</span>
                        )}
                        <button
                          onClick={() => setQuoteEditTarget({ rfq, quote: sup })}
                          className="text-cyan-400 hover:underline text-[10px]"
                        >
                          {sup.quoteReferenceNo ? 'Edit' : 'Enter Rate'}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* TAB 2: STF RECORDS */}
          {activeTab === 'stfs' && (
            <div className="grid grid-cols-1 gap-4">
              {filteredStfs.length === 0 ? (
                <div className="bg-slate-800 p-8 rounded-xl border border-slate-700 text-center text-slate-400 text-sm">
                  No Store Transfer / Supply Request (STF) records found. Award an RFQ quotation to generate an STF.
                </div>
              ) : (
                filteredStfs.map(stf => (
                  <div key={stf.id} className="bg-slate-800 border border-slate-700/80 rounded-xl p-5 shadow-lg">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                      <div>
                        <div className="flex items-center gap-3">
                          <span className="font-mono bg-purple-950 text-purple-300 border border-purple-800 text-xs px-2.5 py-1 rounded-md font-bold">
                            {stf.stfNumber}
                          </span>
                          <span className="text-xs text-slate-400">Linked RFQ: <span className="font-mono text-emerald-400 font-bold">{stf.rfqNumber}</span></span>
                          <span className="text-[10px] bg-slate-700 text-slate-300 px-2 py-0.5 rounded uppercase font-semibold">
                            {stf.status}
                          </span>
                        </div>
                        <p className="text-sm font-semibold text-slate-200 mt-2">Vendor: {stf.supplierName}</p>
                        <p className="text-xs text-slate-400">Quote Ref: {stf.quoteReferenceNo} | Payment: {stf.paymentTerms}</p>
                      </div>

                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="text-xs text-slate-400">Total Value</p>
                          <p className="text-lg font-mono font-bold text-emerald-400">AED {stf.totalAmount.toFixed(2)}</p>
                        </div>
                        {stf.status === 'APPROVED' ? (
                          <button
                            onClick={() => handleConvertStfToPo(stf)}
                            className="bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold px-4 py-2.5 rounded-lg flex items-center gap-1.5 shadow-lg"
                          >
                            <ArrowRight size={14} /> Convert STF to PO
                          </button>
                        ) : (
                          <span className="text-xs text-cyan-400 font-mono bg-cyan-950 px-3 py-1 rounded border border-cyan-800 font-semibold">
                            PO Issued: {stf.poNumber}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* TAB 3: PURCHASE ORDERS (PO) */}
          {activeTab === 'pos' && (
            <div className="grid grid-cols-1 gap-4">
              {filteredPos.length === 0 ? (
                <div className="bg-slate-800 p-8 rounded-xl border border-slate-700 text-center text-slate-400 text-sm">
                  No Purchase Orders issued yet. Convert an STF record to issue a PO.
                </div>
              ) : (
                filteredPos.map(po => (
                  <div key={po.id} className="bg-slate-800 border border-slate-700/80 rounded-xl p-5 shadow-lg space-y-4">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                      <div>
                        <div className="flex items-center gap-3">
                          <span className="font-mono bg-cyan-950 text-cyan-300 border border-cyan-800 text-sm px-3 py-1 rounded-md font-extrabold">
                            {po.poNumber}
                          </span>
                          <span className="bg-emerald-900 text-emerald-300 text-xs px-2.5 py-0.5 rounded-full font-semibold">
                            {po.status}
                          </span>
                        </div>
                        <h3 className="text-base font-bold text-white mt-1.5">Supplier: {po.supplierName}</h3>
                        <p className="text-xs text-slate-400">Issued Date: {po.createdAt} | Lead Time: {po.leadTimeDays} Days</p>
                      </div>

                      <div className="text-right">
                        <p className="text-xs text-slate-400">Grand Total Amount</p>
                        <p className="text-xl font-mono font-black text-emerald-400">AED {po.totalAmount.toFixed(2)}</p>
                      </div>
                    </div>

                    {/* Full Traceability Metadata Banner */}
                    <div className="bg-slate-900/90 border border-slate-700/70 p-3 rounded-lg grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
                      <div>
                        <span className="text-slate-500 block">RFQ Request #</span>
                        <span className="font-mono text-emerald-400 font-bold">{po.rfqNumber}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Linked STF #</span>
                        <span className="font-mono text-purple-400 font-bold">{po.stfNumber}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Supplier Quote Ref</span>
                        <span className="font-mono text-amber-300 font-semibold">{po.quoteReferenceNo}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Quote PDF Attachment</span>
                        {po.quoteFileName ? (
                          <span className="text-cyan-400 underline cursor-pointer inline-flex items-center gap-1 font-medium">
                            <FileText size={12} /> {po.quoteFileName}
                          </span>
                        ) : (
                          <span className="text-slate-500 italic">No File</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </>
      )}

      {/* MODALS */}
      <CreateRfqModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSave={handleSaveNewRfq}
        existingCount={rfqs.length}
      />

      {quoteEditTarget && (
        <EnterQuoteModal
          isOpen={!!quoteEditTarget}
          rfq={quoteEditTarget.rfq}
          quote={quoteEditTarget.quote}
          onClose={() => setQuoteEditTarget(null)}
          onSaveQuote={handleSaveQuoteData}
        />
      )}
    </div>
  );
};