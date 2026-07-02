import { pgTable, text, integer, jsonb } from 'drizzle-orm/pg-core';

// Define the 'pools' table (allocated live production pools)
export const pools = pgTable('pools', {
  id: text('id').primaryKey(),
  projectName: text('project_name').notNull(),
  poolNo: text('pool_no').notNull(),
  orientation: text('orientation').notNull(),
  dimensions: text('dimensions').notNull(),
  shape: text('shape').notNull(),
  poolType: text('pool_type'),
  drawingUrl: text('drawing_url'),
  notes: text('notes'),
  createdAt: text('created_at').notNull(),
  completedAt: text('completed_at'),
  currentStageIndex: integer('current_stage_index').notNull(),
  stageHistory: jsonb('stage_history').notNull(),
});

// Define the 'planned_pools' table (the planning ledger)
export const plannedPools = pgTable('planned_pools', {
  id: text('id').primaryKey(),
  projectName: text('project_name').notNull(),
  poolNo: text('pool_no').notNull(),
  orientation: text('orientation').notNull(),
  dimensions: text('dimensions').notNull(),
  shape: text('shape').notNull(),
  poolType: text('pool_type'),
  drawingUrl: text('drawing_url'),
  status: text('status').notNull(),
  releasedPoolId: text('released_pool_id'),
  notes: text('notes'),
  createdAt: text('created_at').notNull(),
});

// Define the 'teams' table
export const teams = pgTable('teams', {
  id: text('id').primaryKey(),
  stageId: text('stage_id').notNull(),
  name: text('name').notNull(),
  status: text('status').notNull(),
  activePoolId: text('active_pool_id'),
});

// Define the 'logs' table (production and QC history logbook)
export const logs = pgTable('logs', {
  id: text('id').primaryKey(),
  timestamp: text('timestamp').notNull(),
  poolId: text('pool_id').notNull(),
  poolNo: text('pool_no').notNull(),
  projectName: text('project_name').notNull(),
  stageId: text('stage_id').notNull(),
  type: text('type').notNull(),
  teamName: text('team_name'),
  notes: text('notes'),
  operatorName: text('operator_name').notNull(),
});

// Define the 'inspectors' table
export const inspectors = pgTable('inspectors', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  title: text('title').notNull(),
});

// Define the 'engineers' table
export const engineers = pgTable('engineers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  title: text('title').notNull(),
});

// Define the 'projects_summary' table (for ledger project data / old & new summaries)
export const projectsSummary = pgTable('projects_summary', {
  id: text('id').primaryKey(),
  projectName: text('project_name').notNull(),
  orientation: text('orientation').notNull(),
  poolType: text('pool_type').notNull(),
  totalPools: integer('total_pools').notNull(),
  deliveredPools: integer('delivered_pools').notNull(),
  producedPools: integer('produced_pools').notNull(),
  remainingPools: integer('remaining_pools').notNull(),
  notes: text('notes'),
  createdAt: text('created_at').notNull(),
});

// Define the 'monthly_targets' table (for planning portal target configuration and OEE estimation)
export const monthlyTargets = pgTable('monthly_targets', {
  id: text('id').primaryKey(), // e.g. "2026-06"
  monthName: text('month_name').notNull(),
  mainTarget: integer('main_target').notNull(),
  steelFabricationTarget: integer('steel_fabrication_target').notNull(),
  steelPrimerTarget: integer('steel_primer_target').notNull(),
  plumbingTarget: integer('plumbing_target').notNull(),
  claddingTarget: integer('cladding_target').notNull(),
  laminationTarget: integer('lamination_target').notNull(),
  mechanicalFittingTarget: integer('mechanical_fitting_target').notNull(),
  skimmerTestTarget: integer('skimmer_test_target').notNull().default(100),
  doorCuttingTarget: integer('door_cutting_target').notNull().default(100),
  mosaicTarget: integer('mosaic_target').notNull(),
  groutingTarget: integer('grouting_target').notNull().default(120),
  acrylicTarget: integer('acrylic_target').notNull(),
  targetOee: integer('target_oee').default(85), // Target overall Equipment Effectiveness %
  notes: text('notes'),
});

// Define the 'trolley_production' table for daily trolley tracking
export const trolleyProduction = pgTable('trolley_production', {
  id: text('id').primaryKey(),
  date: text('date').notNull(),
  teamName: text('team_name').notNull(),
  quantityProduced: integer('quantity_produced').notNull(),
  notes: text('notes'),
  createdAt: text('created_at').notNull(),
});

// Define the 'employees' table for personnel/department directory
export const employees = pgTable('employees', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  department: text('department').notNull(),
  role: text('role'),
  email: text('email'),
  phone: text('phone'),
  notes: text('notes'),
  createdAt: text('created_at').notNull(),
});

// Define 'recycle_bin' table to hold soft deleted pool-related data / trolley records for 3 days
export const recycleBin = pgTable('recycle_bin', {
  id: text('id').primaryKey(),
  dataType: text('data_type').notNull(), // 'all_pools_data' (pools + plannedPools + projectsSummary) or 'trolley'
  deletedAt: text('deleted_at').notNull(), // ISO string of when it was deleted
  payload: jsonb('payload').notNull(), // JSON containing all deleted items of that type
});

// Define 'employee_punches' table for machine card punching records (In/Out)
export const employeePunches = pgTable('employee_punches', {
  id: text('id').primaryKey(),
  employeeId: text('employee_id').notNull(),
  employeeName: text('employee_name').notNull(),
  punchType: text('punch_type').notNull(), // 'IN' or 'OUT'
  timestamp: text('timestamp').notNull(),
  machineId: text('machine_id').notNull(),
  date: text('date').notNull(),
});

// ----------------------------------------------------
// STORE / BOM MODULE
// ----------------------------------------------------

// Define 'materials' table (raw material master + live stock balance)
export const materials = pgTable('materials', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  category: text('category'), // e.g. 'Resin', 'Fiberglass', 'Gelcoat', 'Hardener'
  unit: text('unit').notNull(), // e.g. 'kg', 'ltr', 'pcs', 'roll'
  currentStock: integer('current_stock').notNull().default(0),
  reorderLevel: integer('reorder_level').default(0),
  notes: text('notes'),
  createdAt: text('created_at').notNull(),
});

// Define 'bom_items' table (Bill of Materials: qty of a material required per single
// pool of a given Project + Pool Type combination)
export const bomItems = pgTable('bom_items', {
  id: text('id').primaryKey(),
  projectName: text('project_name').notNull(),
  poolType: text('pool_type').notNull(),
  materialId: text('material_id').notNull(),
  materialName: text('material_name').notNull(),
  unit: text('unit').notNull(),
  qtyPerPool: text('qty_per_pool').notNull(), // text to safely carry decimals across drivers
  notes: text('notes'),
  createdAt: text('created_at').notNull(),
});

// Define 'material_requests' table (Section Supervisor requests -> Manager approval ->
// store issue slip). One row per material line requested for a given project/type/pool/batch.
export const materialRequests = pgTable('material_requests', {
  id: text('id').primaryKey(),
  projectName: text('project_name').notNull(),
  poolType: text('pool_type').notNull(),
  poolId: text('pool_id'),
  poolNo: text('pool_no'),
  stageId: text('stage_id'),
  materialId: text('material_id').notNull(),
  materialName: text('material_name').notNull(),
  unit: text('unit').notNull(),
  qtyRequested: text('qty_requested').notNull(),
  reason: text('reason'),
  requestedByName: text('requested_by_name').notNull(),
  requestedByRole: text('requested_by_role').notNull(),
  status: text('status').notNull().default('PENDING'), // PENDING | APPROVED | REJECTED | PRINTED
  approvalToken: text('approval_token').notNull(),
  decidedByName: text('decided_by_name'),
  decisionNotes: text('decision_notes'),
  decidedAt: text('decided_at'),
  printedAt: text('printed_at'),
  createdAt: text('created_at').notNull(),
});


