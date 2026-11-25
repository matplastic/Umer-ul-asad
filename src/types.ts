export interface RfqItem {
  id: string;
  materialName: string;
  description?: string;
  quantity: number;
  unit: string;
}

export interface SupplierQuote {
  id: string;
  supplierId?: string;
  supplierName: string;
  quoteReferenceNo: string;
  currency: string;
  unitPrices: Record<string, number>; // item.id -> price
  leadTimeDays: number;
  paymentTerms: string;
  freightCost: number;
  vatPercent: number;
  quoteDocumentUrl?: string;
  quoteFileName?: string;
  status: 'PENDING' | 'AWARDED' | 'REJECTED';
  submittedAt: string;
}

export interface RfqMaster {
  id: string;
  requestNumber: string; // e.g. "RFQ-2026-001"
  title: string;
  department: string;
  createdAt: string;
  createdBy: string;
  items: RfqItem[];
  suppliers: SupplierQuote[];
  status: 'DRAFT' | 'SENT' | 'QUOTED' | 'AWARDED';
}

export interface StfRecord {
  id: string;
  stfNumber: string; // e.g. "STF-2026-0101"
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

export interface PurchaseOrder {
  id: string;
  poNumber: string; // e.g. "PO-2026-0501"
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