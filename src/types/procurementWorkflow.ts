export interface WorkflowRfqItem {
  id: string;
  materialName: string;
  description?: string;
  quantity: number;
  unit: string;
}

export interface WorkflowSupplierQuote {
  id: string;
  supplierId?: string;
  supplierName: string;
  quoteReferenceNo: string;
  currency: string;
  unitPrices: Record<string, number>;
  leadTimeDays: number;
  paymentTerms: string;
  freightCost: number;
  vatPercent: number;
  quoteDocumentUrl?: string;
  quoteFileName?: string;
  status: 'PENDING' | 'AWARDED' | 'REJECTED';
  submittedAt: string;
}

export interface WorkflowRfqMaster {
  id: string;
  requestNumber: string;
  title: string;
  department: string;
  createdAt: string;
  createdBy: string;
  items: WorkflowRfqItem[];
  suppliers: WorkflowSupplierQuote[];
  status: 'DRAFT' | 'SENT' | 'QUOTED' | 'AWARDED';
}

export interface WorkflowStfRecord {
  id: string;
  stfNumber: string;
  rfqNumber: string;
  quoteId: string;
  quoteReferenceNo: string;
  supplierName: string;
  items: Array<{
    materialName: string;
    quantity: number;
    unit: string;
    unitPrice: number;
  }>;
  totalAmount: number;
  paymentTerms: string;
  leadTimeDays: number;
  quoteDocumentUrl?: string;
  quoteFileName?: string;
  status: 'APPROVED' | 'CONVERTED_TO_PO';
  poNumber?: string;
  createdAt: string;
}

export interface WorkflowPurchaseOrder {
  id: string;
  poNumber: string;
  stfNumber: string;
  rfqNumber: string;
  quoteId: string;
  quoteReferenceNo: string;
  supplierName: string;
  items: Array<{
    materialName: string;
    quantity: number;
    unit: string;
    unitPrice: number;
  }>;
  subtotal: number;
  vatAmount: number;
  freightCost: number;
  totalAmount: number;
  paymentTerms: string;
  leadTimeDays: number;
  quoteDocumentUrl?: string;
  quoteFileName?: string;
  status: 'ISSUED' | 'RECEIVED' | 'CLOSED';
  createdAt: string;
}
