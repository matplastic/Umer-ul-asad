export type PoolOrientation = 'Normal' | 'Mirror';

export type StageId = 
  | 'steel_fabrication' 
  | 'steel_primer' 
  | 'plumbing' 
  | 'cladding' 
  | 'skimmer_fitting'
  | 'lamination'
  | 'mechanical_fitting'
  | 'skimmer_test'
  | 'door_cutting'
  | 'mosaic' 
  | 'grouting'
  | 'acrylic';

export interface StageDefinition {
  id: StageId;
  name: string;
  defaultTeamsCount: number;
  color: string;
}

export type StageStatus = 
  | 'NOT_STARTED' 
  | 'IN_PROGRESS' 
  | 'PENDING_INSPECTION' 
  | 'APPROVED' 
  | 'REJECTED'
  | 'SKIPPED'
  | 'CARRIED_ON_SITE';

export interface StageHistory {
  stageId: StageId;
  status: StageStatus;
  teamId?: string;
  startTime?: string | null;
  endTime?: string | null;
  durationMinutes?: number | null;
  inspectorId?: string;
  inspectorNotes?: string;
  inspectionTime?: string;
  rejectionCount: number;
  inspectorPicture?: string;
}

export interface Pool {
  id: string;
  projectName: string;
  poolNo: string;
  orientation: PoolOrientation;
  dimensions: string; // e.g. "12m x 5m"
  shape: string; // e.g. "Rectangular"
  poolType?: string; // e.g. "Type 3" or "Type 1"
  drawingUrl?: string; // B64 drawing or image reference
  notes?: string;
  createdAt: string;
  completedAt?: string | null;
  currentStageIndex: number; // 0 to 7. 8 means fully completed.
  stageHistory: { [key in StageId]: StageHistory };
  isDelivered?: boolean;
  deliveredAt?: string | null;
}

export interface PlannedPool {
  id: string;
  projectName: string;
  poolNo: string;
  orientation: PoolOrientation;
  dimensions: string;
  shape: string;
  poolType?: string;
  drawingUrl?: string;
  status: 'PLANNED' | 'RELEASED' | 'COMPLETED';
  releasedPoolId?: string | null;
  notes?: string;
  createdAt: string;
}

export interface Team {
  id: string;
  stageId: StageId;
  name: string;
  status: 'IDLE' | 'BUSY';
  activePoolId?: string | null;
}

export interface ActivityLog {
  id: string;
  timestamp: string;
  poolId: string;
  poolNo: string;
  projectName: string;
  stageId: StageId;
  type: 'CREATED' | 'STAGE_STARTED' | 'STAGE_FINISHED' | 'APPROVED' | 'REJECTED';
  teamName?: string;
  notes?: string;
  operatorName: string;
  inspectorPicture?: string;
}

export type ViewRole = 
  | 'planning_department'
  | 'production_engineer'
  | 'stage_worker'
  | 'quality_inspector'
  | 'factory_entrance'
  | 'management'
  | 'section_dashboard'
  | 'trolley_prod'
  | 'hr_portal'
  | 'store';

export interface ProjectSummary {
  id: string;
  projectName: string;
  orientation: string;
  poolType: string;
  totalPools: number;
  deliveredPools: number;
  producedPools: number;
  remainingPools: number;
  notes?: string | null;
  createdAt: string;
}

export interface MonthlyTarget {
  id: string; // "YYYY-MM"
  monthName: string;
  mainTarget: number;
  steelFabricationTarget: number;
  steelPrimerTarget: number;
  plumbingTarget: number;
  claddingTarget: number;
  skimmerFittingTarget: number;
  laminationTarget: number;
  mechanicalFittingTarget: number;
  skimmerTestTarget: number;
  doorCuttingTarget: number;
  mosaicTarget: number;
  groutingTarget: number;
  acrylicTarget: number;
  targetOee?: number | null;
  notes?: string | null;
}

export interface TrolleyProduction {
  id: string;
  date: string;
  teamName: string;
  quantityProduced: number;
  notes?: string | null;
  createdAt: string;
}

export interface Employee {
  id: string;
  name: string;
  department: string;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  createdAt: string;
  viewRole: ViewRole;
  pin: string;
}

export interface EmployeePunch {
  id: string;
  employeeId: string;
  employeeName: string;
  punchType: 'IN' | 'OUT';
  timestamp: string;
  machineId: string;
  date: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// STORE & INVENTORY MODULE TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface Material {
  id: string; // e.g., 'mat_resin_poly_001'
  name: string; // e.g., 'Polyester Resin'
  category: string; // e.g., 'Resins', 'Fiberglass', 'Gelcoat', 'Hardware'
  unit: 'kg' | 'm' | 'sqm' | 'pcs' | 'ltr'; // Unit of measurement
  stock: number; // Current quantity in stock
  minStock: number; // Minimum stock level to trigger reorder
  supplier?: string;
  notes?: string;
}

export interface BOMItem {
  materialId: string;
  quantity: number;
}

export interface BillOfMaterials {
  id: string; // e.g., 'bom_type3_normal'
  projectName: string;
  poolType: string; // e.g., 'Type 3'
  items: BOMItem[];
}

export interface MaterialRequest {
  id: string;
  section: string; // e.g., 'Lamination Area'
  requestedBy: string;
  requestedAt: string;
  items: {
    materialId: string;
    quantity: number;
  }[];
  status: 'pending' | 'approved' | 'rejected' | 'fulfilled';
  notes?: string;
}

export interface IncomingMaterial {
  id: string;
  materialId: string;
  quantity: number;
  supplier: string;
  receivedAt: string;
  receivedBy: string;
  invoice?: string;
}

export interface ConsumptionLog {
  id: string;
  materialId: string;
  quantity: number;
  consumedBy: string; // Section or Project ID
  consumedAt: string;
  notes?: string;
}

export interface SectionDefinition {
  id: string;
  name: string;
  description?: string;
}

export const SECTION_DEFINITIONS: SectionDefinition[] = [
  { id: 'steel_workshop', name: 'Steel Workshop', description: 'Primary steel frame and shell fabrication.' },
  { id: 'cladding_dept', name: 'Cladding Department', description: 'Application of chemical cladding and protective coats.' },
  { id: 'lamination_area', name: 'Lamination Area', description: 'Fiberglass and resin structural lamination.' },
  { id: 'assembly_floor', name: 'Assembly Floor', description: 'Mechanical and plumbing fitting assembly.' },
  { id: 'finishing_bay', name: 'Finishing Bay', description: 'Mosaic, grouting, and final cosmetic touches.' },
  { id: 'warehouse', name: 'Main Warehouse', description: 'General storage and material dispatch.' },
];

export interface RecycleBinItem {
  id: string;
  dataType: string; // 'all_pools_data' | 'trolley' | 'pool' | 'planned_pool' | 'project_summary'
  deletedAt: string; // ISO string of when it was deleted
  payload: any;
}
