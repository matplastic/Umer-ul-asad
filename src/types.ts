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
  | 'store'
  | 'section_supervisor'
  | 'reports_analytics';

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

export interface RecycleBinItem {
  id: string;
  dataType: string; // 'all_pools_data' | 'trolley' | 'pool' | 'planned_pool' | 'project_summary'
  deletedAt: string; // ISO string of when it was deleted
  payload: any;
}

// ----------------------------------------------------
// STORE / BOM MODULE
// ----------------------------------------------------

export interface Material {
  id: string;
  name: string;
  category?: string | null; // 'Resin' | 'Fiberglass' | 'Gelcoat' | 'Hardener' | ...
  section?: string | null; // section/stage id: 'steel_fabrication', 'lamination', etc.
  unit: string; // 'kg' | 'ltr' | 'pcs' | 'roll' | ...
  currentStock: number;
  reorderLevel?: number | null;
  notes?: string | null;
  erpCode?: string | null;
  supplierName?: string | null;
  brand?: string | null;
  location?: string | null; // storage bin/rack, e.g. "Rack A-3"
  hsCode?: string | null; // customs HS code
  isCritical?: boolean | null; // manual override to force-include/exclude from the Key Materials dashboard
  createdAt: string;
}

// One line of the Bill of Materials for a Project + Pool Type combination
export interface BOMItem {
  id: string;
  projectName: string;
  poolType: string;
  materialId: string;
  materialName: string;
  unit: string;
  qtyPerPool: number;
  notes?: string | null;
  createdAt: string;
}

export type MaterialRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'PRINTED';

export interface MaterialRequest {
  id: string;
  // Requests submitted together from the Supervisor's "cart" (10, 40, however
  // many material lines at once) share one batchId + one approvalToken, so
  // the manager gets ONE email with ONE Approve/Reject action for the whole
  // batch, and Store gets ONE issue slip listing every line — instead of a
  // separate email/slip per material. Requests submitted before this feature
  // existed have batchId === null/undefined and are simply treated as a
  // "batch of one" everywhere batchId is used for grouping.
  batchId?: string | null;
  projectName: string;
  poolType: string;
  poolId?: string | null;
  poolNo?: string | null;
  stageId?: StageId | null;
  materialId: string;
  materialName: string;
  unit: string;
  qtyRequested: number;
  reason?: string | null;
  requestedByName: string;
  requestedByRole: string;
  status: MaterialRequestStatus;
  approvalToken: string;
  decidedByName?: string | null;
  decisionNotes?: string | null;
  decidedAt?: string | null;
  printedAt?: string | null;
  createdAt: string;
}

export interface IncomingMaterial {
  id: string;
  materialId: string;
  materialName: string;
  unit: string;
  qty: number;
  supplier?: string | null;
  invoiceNo?: string | null;
  notes?: string | null;
  receivedByName: string;
  receivedAt: string;
  createdAt: string;
}

export interface ConsumptionLog {
  id: string;
  date: string; // YYYY-MM-DD
  sectionId: string;
  sectionName: string;
  materialId: string;
  materialName: string;
  unit: string;
  qty: number;
  notes?: string | null;
  loggedByName: string;
  createdAt: string;
}

export interface ProductionLog {
  id: string;
  date: string;
  sectionId: string;
  sectionName: string;
  projectName: string;
  poolType: string;
  poolId?: string | null;
  poolNo?: string | null;
  quantity: number;
  notes?: string | null;
  loggedByName: string;
  createdAt: string;
}

// Material that has been APPROVED + ISSUED out of the Store to a working
// section, but not yet consumed. One row per (section, material) pair —
// id is `${sectionId}__${materialId}`. This is what makes the flow
// Store → Floor → Consumed instead of double-counting a single stock number:
//   1) Supervisor requests material
//   2) Manager approves (email/WhatsApp) → Store's currentStock goes DOWN,
//      this FloorStock row goes UP by the same qty (material has physically
//      left the store and is now sitting on the shop floor)
//   3) Supervisor logs consumption against the floor stock → this row goes
//      DOWN by the qty consumed. Store's currentStock is untouched at this
//      step (it already left the store at approval time).
export interface FloorStock {
  id: string; // `${sectionId}__${materialId}`
  sectionId: string;
  sectionName: string;
  materialId: string;
  materialName: string;
  unit: string;
  qty: number; // currently on the floor, issued but not yet consumed
  updatedAt: string;
}

// Section list used by the Supervisor Portal. Shared here (rather than kept
// local to SupervisorPortal.tsx) so Store's Floor Stock view and any other
// screen can label sections consistently.
export const SUPERVISOR_SECTIONS: SectionDefinition[] = [
  { id: 'mep_material', name: 'MEP Material' },
  { id: 'civil_material', name: 'Civil Material' },
];

export interface SectionDefinition {
  id: StageId | string;
  name: string;
}

export const SECTION_DEFINITIONS: SectionDefinition[] = [
  { id: 'steel_fabrication', name: 'Steel Fabrication' },
  { id: 'steel_primer', name: 'Steel Primer' },
  { id: 'plumbing', name: 'Plumbing' },
  { id: 'cladding', name: 'Cladding' },
  { id: 'skimmer_fitting', name: 'Skimmer Fitting' },
  { id: 'lamination', name: 'Lamination' },
  { id: 'mechanical_fitting', name: 'Mechanical Fitting' },
  { id: 'skimmer_test', name: 'Skimmer Test' },
  { id: 'door_cutting', name: 'Door Cutting' },
  { id: 'mosaic', name: 'Mosaic' },
  { id: 'grouting', name: 'Grouting' },
  { id: 'acrylic', name: 'Acrylic' },
];


