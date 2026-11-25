import React, { useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import { RfqMaster, RfqItem } from '../types';
import { MASTER_SUPPLIERS } from '../data/suppliersList';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSave: (rfq: RfqMaster) => void;
  existingCount: number;
}

export const CreateRfqModal: React.FC<Props> = ({ isOpen, onClose, onSave, existingCount }) => {
  const [requestNumber, setRequestNumber] = useState(`RFQ-2026-${String(existingCount + 1).padStart(4, '0')}`);
  const [title, setTitle] = useState('');
  const [department, setDepartment] = useState('Procurement & QA');
  const [selectedSuppliers, setSelectedSuppliers] = useState<string[]>([]);
  const [customSupplier, setCustomSupplier] = useState('');
  const [items, setItems] = useState<RfqItem[]>([
    { id: '1', materialName: '', quantity: 1, unit: 'Pcs', description: '' }
  ]);

  if (!isOpen) return null;

  const handleAddSupplier = (name: string) => {
    if (!name.trim()) return;
    if (!selectedSuppliers.includes(name.trim())) {
      setSelectedSuppliers([...selectedSuppliers, name.trim()]);
    }
    setCustomSupplier('');
  };

  const handleRemoveSupplier = (name: string) => {
    setSelectedSuppliers(selectedSuppliers.filter(s => s !== name));
  };

  const handleAddItem = () => {
    setItems([
      ...items,
      { id: String(Date.now()), materialName: '', quantity: 1, unit: 'Pcs', description: '' }
    ]);
  };

  const handleRemoveItem = (id: string) => {
    if (items.length > 1) {
      setItems(items.filter(i => i.id !== id));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!requestNumber.trim() || !title.trim()) {
      alert('Please enter Request Number and Title');
      return;
    }
    if (selectedSuppliers.length === 0) {
      alert('Please add at least one supplier to request quotations from.');
      return;
    }

    const newRfq: RfqMaster = {
      id: `rfq-${Date.now()}`,
      requestNumber: requestNumber.trim(),
      title: title.trim(),
      department,
      createdAt: new Date().toISOString().split('T')[0],
      createdBy: 'Syed Umer',
      status: 'SENT',
      items: items.filter(i => i.materialName.trim() !== ''),
      suppliers: selectedSuppliers.map((sup, index) => ({
        id: `quote-${Date.now()}-${index}`,
        supplierName: sup,
        quoteReferenceNo: '',
        currency: 'AED',
        unitPrices: {},
        leadTimeDays: 0,
        paymentTerms: '',
        freightCost: 0,
        vatPercent: 5,
        status: 'PENDING',
        submittedAt: ''
      }))
    };

    onSave(newRfq);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto p-6 text-slate-100 shadow-2xl">
        <div className="flex justify-between items-center border-b border-slate-700 pb-4 mb-4">
          <h2 className="text-xl font-bold text-emerald-400">Create New RFQ Request</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={24} /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase mb-1">Request Number</label>
              <input
                type="text"
                value={requestNumber}
                onChange={e => setRequestNumber(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase mb-1">Title / Project</label>
              <input
                type="text"
                placeholder="e.g. Polypropylene Tank Fittings"
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase mb-1">Department</label>
              <input
                type="text"
                value={department}
                onChange={e => setDepartment(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white"
              />
            </div>
          </div>

          {/* Supplier Selection */}
          <div className="border border-slate-700/60 bg-slate-900/50 p-4 rounded-lg">
            <h3 className="text-sm font-semibold text-amber-400 mb-2">Assign Suppliers (Multi-Supplier Request)</h3>
            <div className="flex flex-wrap gap-2 mb-3">
              {selectedSuppliers.map(sup => (
                <span key={sup} className="bg-slate-700 text-emerald-300 text-xs px-3 py-1.5 rounded-full flex items-center gap-2 border border-slate-600">
                  {sup}
                  <button type="button" onClick={() => handleRemoveSupplier(sup)} className="text-slate-400 hover:text-red-400"><X size={14} /></button>
                </span>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Choose from Supplier List:</label>
                <select
                  onChange={e => {
                    if (e.target.value) handleAddSupplier(e.target.value);
                    e.target.value = '';
                  }}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200"
                >
                  <option value="">-- Select Master Supplier --</option>
                  {MASTER_SUPPLIERS.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Or Type Custom Supplier Name:</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Enter vendor name..."
                    value={customSupplier}
                    onChange={e => setCustomSupplier(e.target.value)}
                    className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                  />
                  <button
                    type="button"
                    onClick={() => handleAddSupplier(customSupplier)}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-1"
                  >
                    <Plus size={16} /> Add
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Line Items */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-sm font-semibold text-cyan-400">Items Needed for Quotation</h3>
              <button
                type="button"
                onClick={handleAddItem}
                className="text-xs bg-slate-700 hover:bg-slate-600 text-cyan-300 px-3 py-1.5 rounded flex items-center gap-1 border border-slate-600"
              >
                <Plus size={14} /> Add Line Item
              </button>
            </div>

            <div className="space-y-2">
              {items.map((item, index) => (
                <div key={item.id} className="flex gap-2 items-center bg-slate-900 p-2 rounded-lg border border-slate-800">
                  <span className="text-xs text-slate-500 font-mono w-6">{index + 1}.</span>
                  <input
                    type="text"
                    placeholder="Material Name / Spec"
                    value={item.materialName}
                    onChange={e => {
                      const updated = [...items];
                      updated[index].materialName = e.target.value;
                      setItems(updated);
                    }}
                    className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-white"
                    required
                  />
                  <input
                    type="number"
                    min="1"
                    placeholder="Qty"
                    value={item.quantity}
                    onChange={e => {
                      const updated = [...items];
                      updated[index].quantity = parseFloat(e.target.value) || 1;
                      setItems(updated);
                    }}
                    className="w-20 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-white text-center"
                    required
                  />
                  <input
                    type="text"
                    placeholder="Unit (Pcs, Mtr)"
                    value={item.unit}
                    onChange={e => {
                      const updated = [...items];
                      updated[index].unit = e.target.value;
                      setItems(updated);
                    }}
                    className="w-24 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-white"
                  />
                  {items.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveItem(item.id)}
                      className="text-slate-500 hover:text-red-400 p-1"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-700">
            <button type="button" onClick={onClose} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm">Cancel</button>
            <button type="submit" className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-semibold">Dispatch RFQ</button>
          </div>
        </form>
      </div>
    </div>
  );
};