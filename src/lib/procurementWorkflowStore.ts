import {
  WorkflowRfqMaster,
  WorkflowStfRecord,
  WorkflowPurchaseOrder,
  WorkflowSupplierQuote,
} from '../types/procurementWorkflow';

const INITIAL_WORKFLOW_RFQS: WorkflowRfqMaster[] = [
  {
    id: 'wf-rfq-1',
    requestNumber: 'RFQ-2026-0088',
    title: 'Plunge Pool Steel Frame & Extrusion Piping',
    department: 'QA/QC & Structural',
    createdAt: '2026-11-20',
    createdBy: 'Syed Umer',
    status: 'QUOTED',
    items: [
      { id: 'wf-item-1', materialName: 'Heavy Duty Steel Beam 100x50mm', quantity: 50, unit: 'Pcs' },
      { id: 'wf-item-2', materialName: 'Polypropylene Extrusion Pipe 2"', quantity: 120, unit: 'Mtr' },
      { id: 'wf-item-3', materialName: 'Stainless Steel Flange 4" Grade 316', quantity: 25, unit: 'Pcs' },
    ],
    suppliers: [
      {
        id: 'wf-q-1',
        supplierName: 'Falcon Steel Manufacturing LLC',
        quoteReferenceNo: 'FLC-QT-2026-991',
        currency: 'AED',
        unitPrices: { 'wf-item-1': 140, 'wf-item-2': 28, 'wf-item-3': 110 },
        leadTimeDays: 5,
        paymentTerms: '30 Days PDC',
        freightCost: 150,
        vatPercent: 5,
        quoteFileName: 'Falcon_Quote_RFQ0088.pdf',
        status: 'PENDING',
        submittedAt: '2026-11-21',
      },
      {
        id: 'wf-q-2',
        supplierName: 'Emirates Metal & Industrial Supplies',
        quoteReferenceNo: 'EM-RFQ-8810',
        currency: 'AED',
        unitPrices: { 'wf-item-1': 125, 'wf-item-2': 32, 'wf-item-3': 95 },
        leadTimeDays: 3,
        paymentTerms: 'Cash on Delivery',
        freightCost: 0,
        vatPercent: 5,
        quoteFileName: 'EmiratesMetal_Signed_Offer.pdf',
        status: 'PENDING',
        submittedAt: '2026-11-22',
      },
    ],
  },
];

const KEY_RFQS = 'mat_erp_wf_rfqs_v1';
const KEY_STFS = 'mat_erp_wf_stfs_v1';
const KEY_POS = 'mat_erp_wf_pos_v1';

export function getWorkflowRfqs(): WorkflowRfqMaster[] {
  try {
    const raw = localStorage.getItem(KEY_RFQS);
    return raw ? JSON.parse(raw) : INITIAL_WORKFLOW_RFQS;
  } catch {
    return INITIAL_WORKFLOW_RFQS;
  }
}

export function saveWorkflowRfqs(rfqs: WorkflowRfqMaster[]): void {
  localStorage.setItem(KEY_RFQS, JSON.stringify(rfqs));
}

export function getWorkflowStfs(): WorkflowStfRecord[] {
  try {
    const raw = localStorage.getItem(KEY_STFS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveWorkflowStfs(stfs: WorkflowStfRecord[]): void {
  localStorage.setItem(KEY_STFS, JSON.stringify(stfs));
}

export function getWorkflowPos(): WorkflowPurchaseOrder[] {
  try {
    const raw = localStorage.getItem(KEY_POS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveWorkflowPos(pos: WorkflowPurchaseOrder[]): void {
  localStorage.setItem(KEY_POS, JSON.stringify(pos));
}

export function convertWorkflowQuoteToStf(
  rfq: WorkflowRfqMaster,
  winningQuote: WorkflowSupplierQuote
): WorkflowStfRecord {
  const currentStfs = getWorkflowStfs();
  const stfNumber = `STF-2026-${String(currentStfs.length + 101).padStart(4, '0')}`;

  const stfItems = rfq.items.map((item) => ({
    materialName: item.materialName,
    quantity: item.quantity,
    unit: item.unit,
    unitPrice: winningQuote.unitPrices[item.id] || 0,
  }));

  const subtotal = stfItems.reduce((acc, i) => acc + i.quantity * i.unitPrice, 0);
  const vat = subtotal * (winningQuote.vatPercent / 100);
  const totalAmount = subtotal + vat + winningQuote.freightCost;

  const newStf: WorkflowStfRecord = {
    id: `wf-stf-${Date.now()}`,
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
    createdAt: new Date().toISOString().split('T')[0],
  };

  currentStfs.unshift(newStf);
  saveWorkflowStfs(currentStfs);

  const rfqs = getWorkflowRfqs();
  const targetRfq = rfqs.find((r) => r.id === rfq.id);
  if (targetRfq) {
    targetRfq.status = 'AWARDED';
    targetRfq.suppliers = targetRfq.suppliers.map((s) => ({
      ...s,
      status: s.id === winningQuote.id ? 'AWARDED' : 'REJECTED',
    }));
    saveWorkflowRfqs(rfqs);
  }

  return newStf;
}

export function convertWorkflowStfToPo(stf: WorkflowStfRecord): WorkflowPurchaseOrder {
  const currentPos = getWorkflowPos();
  const poNumber = `PO-2026-${String(currentPos.length + 501).padStart(4, '0')}`;

  const subtotal = stf.items.reduce((acc, i) => acc + i.quantity * i.unitPrice, 0);
  const vatAmount = subtotal * 0.05;

  const newPo: WorkflowPurchaseOrder = {
    id: `wf-po-${Date.now()}`,
    poNumber,
    stfNumber: stf.stfNumber,
    rfqNumber: stf.rfqNumber,
    quoteId: stf.quoteId,
    quoteReferenceNo: stf.quoteReferenceNo,
    supplierName: stf.supplierName,
    items: stf.items,
    subtotal,
    vatAmount,
    freightCost: 0,
    totalAmount: stf.totalAmount,
    paymentTerms: stf.paymentTerms,
    leadTimeDays: stf.leadTimeDays,
    quoteDocumentUrl: stf.quoteDocumentUrl,
    quoteFileName: stf.quoteFileName,
    status: 'ISSUED',
    createdAt: new Date().toISOString().split('T')[0],
  };

  currentPos.unshift(newPo);
  saveWorkflowPos(currentPos);

  const stfs = getWorkflowStfs();
  const targetStf = stfs.find((s) => s.id === stf.id);
  if (targetStf) {
    targetStf.status = 'CONVERTED_TO_PO';
    targetStf.poNumber = poNumber;
    saveWorkflowStfs(stfs);
  }

  return newPo;
}
