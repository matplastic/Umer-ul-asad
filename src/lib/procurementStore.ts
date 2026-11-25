import { RfqMaster, StfRecord, PurchaseOrder, SupplierQuote } from '../types';

const INITIAL_RFQS: RfqMaster[] = [
  {
    id: 'rfq-1',
    requestNumber: 'RFQ-2026-0088',
    title: 'Plunge Pool Steel Frame & Extrusion Piping',
    department: 'QA/QC & Structural',
    createdAt: '2026-11-20',
    createdBy: 'Syed Umer',
    status: 'QUOTED',
    items: [
      { id: 'item-1', materialName: 'Heavy Duty Steel Beam 100x50mm', quantity: 50, unit: 'Pcs' },
      { id: 'item-2', materialName: 'Polypropylene Extrusion Pipe 2"', quantity: 120, unit: 'Mtr' },
      { id: 'item-3', materialName: 'Stainless Steel Flange 4" Grade 316', quantity: 25, unit: 'Pcs' }
    ],
    suppliers: [
      {
        id: 'q-1',
        supplierName: 'Falcon Steel Manufacturing LLC',
        quoteReferenceNo: 'FLC-QT-2026-991',
        currency: 'AED',
        unitPrices: { 'item-1': 140, 'item-2': 28, 'item-3': 110 },
        leadTimeDays: 5,
        paymentTerms: '30 Days PDC',
        freightCost: 150,
        vatPercent: 5,
        quoteFileName: 'Falcon_Quote_RFQ0088.pdf',
        status: 'PENDING',
        submittedAt: '2026-11-21'
      },
      {
        id: 'q-2',
        supplierName: 'Emirates Metal & Industrial Supplies',
        quoteReferenceNo: 'EM-RFQ-8810',
        currency: 'AED',
        unitPrices: { 'item-1': 125, 'item-2': 32, 'item-3': 95 },
        leadTimeDays: 3,
        paymentTerms: 'Cash on Delivery',
        freightCost: 0,
        vatPercent: 5,
        quoteFileName: 'EmiratesMetal_Signed_Offer.pdf',
        status: 'PENDING',
        submittedAt: '2026-11-22'
      }
    ]
  }
];

const LOCAL_STORAGE_KEY_RFQS = 'mat_erp_rfqs';
const LOCAL_STORAGE_KEY_STFS = 'mat_erp_stfs';
const LOCAL_STORAGE_KEY_POS = 'mat_erp_pos';

export function getRfqs(): RfqMaster[] {
  const data = localStorage.getItem(LOCAL_STORAGE_KEY_RFQS);
  return data ? JSON.parse(data) : INITIAL_RFQS;
}

export function saveRfqs(rfqs: RfqMaster[]) {
  localStorage.setItem(LOCAL_STORAGE_KEY_RFQS, JSON.stringify(rfqs));
}

export function getStfs(): StfRecord[] {
  const data = localStorage.getItem(LOCAL_STORAGE_KEY_STFS);
  return data ? JSON.parse(data) : [];
}

export function saveStfs(stfs: StfRecord[]) {
  localStorage.setItem(LOCAL_STORAGE_KEY_STFS, JSON.stringify(stfs));
}

export function getPos(): PurchaseOrder[] {
  const data = localStorage.getItem(LOCAL_STORAGE_KEY_POS);
  return data ? JSON.parse(data) : [];
}

export function savePos(pos: PurchaseOrder[]) {
  localStorage.setItem(LOCAL_STORAGE_KEY_POS, JSON.stringify(pos));
}

export function convertQuoteToStf(rfq: RfqMaster, winningQuote: SupplierQuote): StfRecord {
  const currentStfs = getStfs();
  const stfNumber = `STF-2026-${String(currentStfs.length + 101).padStart(4, '0')}`;

  const stfItems = rfq.items.map(item => ({
    materialName: item.materialName,
    quantity: item.quantity,
    unit: item.unit,
    unitPrice: winningQuote.unitPrices[item.id] || 0
  }));

  const subtotal = stfItems.reduce((acc, i) => acc + (i.quantity * i.unitPrice), 0);
  const vat = subtotal * (winningQuote.vatPercent / 100);
  const totalAmount = subtotal + vat + winningQuote.freightCost;

  const newStf: StfRecord = {
    id: `stf-${Date.now()}`,
    stfNumber,
    rfqNumber: rfq.requestNumber,
    quoteId: winningQuote.id,
    quoteReferenceNo: winningQuote.quoteReferenceNo,
    supplierName: winningQuote.supplierName,
    items: stfItems,
    totalAmount,
    paymentTerms: winningQuote.paymentTerms,
    leadTimeDays: winningQuote.leadTimeDays,
    quoteDocumentUrl: winningQuote.quoteDocumentUrl,
    quoteFileName: winningQuote.quoteFileName,
    status: 'APPROVED',
    createdAt: new Date().toISOString().split('T')[0]
  };

  currentStfs.unshift(newStf);
  saveStfs(currentStfs);

  // Update RFQ status and quote award status
  const rfqs = getRfqs();
  const targetRfq = rfqs.find(r => r.id === rfq.id);
  if (targetRfq) {
    targetRfq.status = 'AWARDED';
    targetRfq.suppliers = targetRfq.suppliers.map(s => ({
      ...s,
      status: s.id === winningQuote.id ? 'AWARDED' : 'REJECTED'
    }));
    saveRfqs(rfqs);
  }

  return newStf;
}

export function convertStfToPo(stf: StfRecord): PurchaseOrder {
  const currentPos = getPos();
  const poNumber = `PO-2026-${String(currentPos.length + 501).padStart(4, '0')}`;

  const subtotal = stf.items.reduce((acc, i) => acc + (i.quantity * i.unitPrice), 0);
  const vatAmount = subtotal * 0.05;
  const freightCost = 0; // included in STF total

  const newPo: PurchaseOrder = {
    id: `po-${Date.now()}`,
    poNumber,
    stfNumber: stf.stfNumber,
    rfqNumber: stf.rfqNumber,
    quoteId: stf.quoteId,
    quoteReferenceNo: stf.quoteReferenceNo,
    supplierName: stf.supplierName,
    items: stf.items,
    subtotal,
    vatAmount,
    freightCost,
    totalAmount: stf.totalAmount,
    paymentTerms: stf.paymentTerms,
    leadTimeDays: stf.leadTimeDays,
    quoteDocumentUrl: stf.quoteDocumentUrl,
    quoteFileName: stf.quoteFileName,
    status: 'ISSUED',
    createdAt: new Date().toISOString().split('T')[0]
  };

  currentPos.unshift(newPo);
  savePos(currentPos);

  // Mark STF as converted
  const stfs = getStfs();
  const targetStf = stfs.find(s => s.id === stf.id);
  if (targetStf) {
    targetStf.status = 'CONVERTED_TO_PO';
    targetStf.poNumber = poNumber;
    saveStfs(stfs);
  }

  return newPo;
}