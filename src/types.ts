export type PoolOrientation = 'Normal' | 'Mirror';

export type StageId = 
  | 'steel_fabrication' 
  | 'steel_primer' 
  | 'plumbing' 
  | 'cladding' 
  | 'lamination' 
  | 'mosaic' 
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
  | 'REJECTED';

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
}

export interface Pool {
  id: string;
  projectName: string;
  poolNo: string;
  orientation: PoolOrientation;
  dimensions: string; // e.g. "12m x 5m"
  shape: string; // e.g. "Rectangular"
  notes?: string;
  createdAt: string;
  completedAt?: string | null;
  currentStageIndex: number; // 0 to 6. 7 means fully completed.
  stageHistory: { [key in StageId]: StageHistory };
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
}

export type ViewRole = 
  | 'production_engineer'
  | 'stage_worker'
  | 'quality_inspector'
  | 'factory_entrance'
  | 'management'
  | 'section_dashboard';
