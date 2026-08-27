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
  // Marks stages where the actual hands-on work takes seconds per pool
  // (e.g. filling water into a skimmer), so the normal one-pool-at-a-time
  // Claim -> Start Timer -> Finish flow is overkill. These stages get a
  // checklist UI instead: tick several pools, send them all to QA at once.
  quickStage?: boolean;
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
  // Snapshot of the team's name at the moment it claimed this stage. Team
  // records can later be renamed, recreated (e.g. under a new kiosk team
  // code), or deleted — teamId alone then no longer resolves to anything
  // and the UI falls back to "Unknown Team" even though a real team did the
  // work. Storing the name here means display never depends on that team
  // record still existing.
  teamName?: string;
  startTime?: string | null;
  endTime?: string | null;
  durationMinutes?: number | null;
  inspectorId?: string;
  inspectorNotes?: string;
  inspectionTime?: string;
  rejectionCount: number;
  inspectorPicture?: string;
  // Structured inspection result from a ChecklistTemplate, alongside the
  // free-text fields above (nothing above is removed or replaced). Optional
  // so pools/stages inspected before this feature shipped remain valid.
  checklistResult?: ChecklistResult;
}

// One checkpoint item inside a ChecklistTemplate.
export interface ChecklistItemDefinition {
  id: string; // short stable id, e.g. "res_thickness"
  label: string; // e.g. "Resin thickness within tolerance"
  required: boolean; // if true, must pass (or be overridden) to approve the stage
  // If set, this item also captures a numeric measurement (e.g. resin
  // thickness in mm) alongside its pass/fail result, feeding SPC control
  // charts. Left undefined for plain pass/fail items — nothing about
  // existing templates needs to change.
  measurement?: {
    unit: string; // e.g. "mm", "sec"
    targetValue: number;
    tolerance: number; // +/- range around targetValue considered in-spec
  };
}

// Editable, per-stage inspection template. QC can add/remove/reorder items
// without a redeploy — these live in Firestore, not hardcoded in the UI.
export interface ChecklistTemplate {
  id: string;
  stageId: StageId;
  name: string; // e.g. "Lamination Final Check v2"
  items: ChecklistItemDefinition[];
  active: boolean; // only one active template per stageId is used by the UI
  createdAt: string;
  updatedAt: string;
}

// Per-item outcome recorded when an inspector completes a checklist.
export interface ChecklistItemResult {
  itemId: string;
  passed: boolean;
  photoUrl?: string; // optional — kept off by default to avoid storage bloat
  note?: string;
  // Recorded value when the item's template definition has a `measurement`
  // config. Feeds SPC control charts. Optional — plain pass/fail items never
  // set this.
  measuredValue?: number;
}

// The full result of running a template against one pool/stage visit.
export interface ChecklistResult {
  templateId: string;
  templateName: string; // snapshot, same reasoning as StageHistory.teamName
  items: ChecklistItemResult[];
  // True if the inspector approved despite one or more required items
  // failing. overrideReason is mandatory whenever this is true.
  overridden: boolean;
  overrideReason?: string;
  completedAt: string;
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
  // QC HOLD: when true, no team/kiosk may claim this pool at its current
  // stage until QC releases it. The pool stays visible on stage boards
  // (grayed out with a hold badge) — it is never hidden from the list.
  isOnHold?: boolean;
  holdInfo?: {
    heldBy: string;
    heldAt: string;
    reason?: string;
    stageAtHold: string;
  } | null;
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
  // Auto-assigned + auto-STARTED when QC rejects a pool this team was
  // working. This is an ARRAY (not a single slot) because a second, third,
  // etc. rejection can land on the same team while earlier rework pools are
  // still in progress — none of them block the team from also claiming a
  // brand-new pool as normal work via activePoolId.
  reworkPoolIds?: string[];
  code?: string; // Login PIN so a worker can check in as this team on a shared kiosk screen
}

// Audit trail entry for bulk deletions from the Planning Department
// Inventory Registry. One entry is written per confirmed bulk-delete action
// (not per item), with a snapshot of every item removed, so we always know
// who deleted what and when even after the records themselves are gone.
export interface InventoryDeletionLog {
  id: string;
  timestamp: string;
  performedByUsername: string;
  performedByDisplayName: string;
  performedByUserId: string;
  module: 'Planning Inventory Registry';
  deletedCount: number;
  deletedItems: {
    id: string;
    poolNo: string;
    projectName: string;
    status: string;
  }[];
}

export interface ActivityLog {
  id: string;
  timestamp: string;
  poolId: string;
  poolNo: string;
  projectName: string;
  stageId: StageId;
  type: 'CREATED' | 'STAGE_STARTED' | 'STAGE_FINISHED' | 'APPROVED' | 'REJECTED';
  teamId?: string;
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
  | 'factory_supervisor'
  | 'reports_analytics'
  | 'site_team';

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
  // Manual/non-biometric staff (e.g. drivers, office staff without a badge
  // machine). Always excluded from the absent list/report regardless of
  // whether an attendance sheet shows a punch for them.
  nonPunching?: boolean | null;
  // Visa sponsor company. We run 5+ group companies and some staff are
  // sponsored under a different company than the one they physically work
  // for, so this is tracked separately from `department`.
  companyName?: string | null;
  // Visa expiry date (ISO string, e.g. "2026-04-30"). Used to flag
  // employees whose visa is expiring soon / already expired.
  visaExpiryDate?: string | null;
  // ── Passport details ──
  passportNumber?: string | null;
  passportCountry?: string | null; // nationality / issuing country
  passportIssueDate?: string | null;
  passportExpiryDate?: string | null;
  // ── Skills matrix ──
  // Job-relevant skills/proficiencies (lamination, spray, QC, forklift,
  // etc.), separate from certifications below — a skill has a proficiency
  // level and no expiry; a certification has an expiry and no proficiency.
  skills?: EmployeeSkill[];
  certifications?: EmployeeCertification[];
}

export type SkillProficiency = 'beginner' | 'intermediate' | 'advanced' | 'expert';

export interface EmployeeSkill {
  id: string;
  skillName: string; // e.g. "Lamination", "Forklift Operation", "QC Inspection"
  proficiency: SkillProficiency;
  notes?: string | null;
  updatedAt: string;
}

export interface EmployeeCertification {
  id: string;
  certName: string; // e.g. "HSE Safety", "ISO 9001:2015 Awareness"
  issuedDate?: string | null;
  expiryDate?: string | null; // null = does not expire
  certificateFileUrl?: string | null; // optional scan/photo of the cert, base64 — kept optional like other photo fields in this app
  notes?: string | null;
}

// Keep this list in sync with the group's actual company names. Centralized
// here so the Directory form dropdown and the Directory filter dropdown
// always show the same set of companies.
export const COMPANIES = [
  'MAT Plastic Industries LLC',
  'Company 2',
  'Company 3',
  'Company 4',
  'Company 5',
] as const;

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
  // Which Store inventory portal this material lives under: MEP, Civil, or
  // Other. Independent of `section` (a production stage) — this is purely
  // for splitting Store's Inventory/Consumption views into three portals.
  // Materials saved before this field existed have no value and are treated
  // as 'other'.
  inventoryGroup?: 'mep' | 'civil' | 'other' | null;
  createdAt: string;
}

// A fixed/durable Company Asset (tools, equipment, machinery, furniture,
// vehicles, etc.) tracked in the Store portal alongside consumable
// Materials. Unlike Material, an Asset is NOT consumed against stock —
// there's no unit, currentStock, or consumption log for it. It's simply a
// register: what it is, its tag/serial number, who currently has it, and
// what it's worth.
export interface CompanyAsset {
  id: string;
  name: string; // Asset name, e.g. "Angle Grinder"
  assetNumber: string; // Asset tag / serial number, e.g. "MAT-AST-0042"
  erpNo?: string | null; // ERP number for this asset (same convention as Material.erpCode)
  issuedTo?: string | null; // Person, section, or department currently holding it. Empty/null = in store.
  value?: number | null; // Purchase/book value (AED)
  notes?: string | null;
  createdAt: string;
}

// One line item within a Site Delivery (a pool, trolley, bag of acrylic, etc.)
export interface SiteDeliveryItem {
  id: string;
  description: string; // free text — "Acrylic Sheet", "Pool #204", "Trolley - Steel", etc.
  category?: string | null; // optional grouping for filters/reports, e.g. "Acrylic", "Pool", "Trolley", "Fiberglass"
  qty: number;
  unit: string; // 'pcs' | 'kg' | 'roll' | 'set' | ...
  notes?: string | null;
}

// A single delivery dispatched from the factory to a project/site. Created by
// Management (or Store/Supervisor with delivery access); confirmed on the
// other end by the Site Team portal once the truck actually arrives.
export interface SiteDelivery {
  id: string;
  deliveryNo: string; // human-friendly reference, e.g. "DEL-2026-0042", shown on the printed challan
  siteName: string; // destination project/site name
  items: SiteDeliveryItem[];
  truckNumber?: string | null;
  driverName?: string | null;
  driverPhone?: string | null;
  dispatchDate: string; // "YYYY-MM-DD" — date it left the factory
  dispatchTime?: string | null; // "HH:MM"
  dispatchedByName: string; // who entered/sent this delivery
  notes?: string | null;
  status: 'DISPATCHED' | 'RECEIVED' | 'PARTIAL' | 'DISPUTED';
  // Filled in by the Site Team once the delivery physically arrives.
  receivedAt?: string | null; // ISO timestamp
  receivedByName?: string | null;
  receivedNotes?: string | null;
  shortageNotes?: string | null; // anything missing/damaged, noted by the site team
  // Optional, lightweight proof-of-delivery — kept off by default (not
  // required to confirm receipt) due to Firestore storage limits. Stored
  // the same way as checklist photos: base64 data URL, no separate upload
  // infrastructure.
  podPhotoUrl?: string | null;
  podSignatureUrl?: string | null;
  // Structured delay tracking, separate from free-text shortageNotes so it
  // can actually be aggregated into an on-time % / avg delay KPI.
  delayHours?: number | null;
  delayReason?: string | null;
  createdAt: string; // ISO timestamp
  updatedAt?: string | null; // ISO timestamp
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

// Office / site / equipment item requests raised by a Factory Supervisor —
// separate from Material Requests (stock consumables from Store). Goes to
// the manager for email approval, then the supervisor can print a purchase
// order for the purchaser and later attach the bill/invoice once bought.
// Mirrors HRPurchaseRequest in HRPortal.tsx.
export interface SupervisorPurchaseRequest {
  id: string;
  // Items submitted together from one supervisor "cart" share a batchId +
  // one approvalToken, so the manager gets ONE email with per-item Approve/
  // Reject for the whole batch instead of a separate email per item.
  batchId?: string | null;
  itemName: string;
  category: 'Tools' | 'Equipment' | 'Site' | 'Other';
  qty: number;
  unit: string;
  estimatedCost?: number | null;
  // Actual amount paid, entered alongside the bill once bought — spending
  // totals use this over estimatedCost whenever it's been filled in.
  actualCost?: number | null;
  purpose?: string | null;
  sectionId?: string | null;
  sectionName?: string | null;
  requestedByName: string;
  requestedAt: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  approvalToken: string;
  decidedByName?: string | null;
  decisionNotes?: string | null;
  decidedAt?: string | null;
  billFileName?: string | null;
  billDataUrl?: string | null;
  billUploadedAt?: string | null;
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
  // Lot/batch tracking — each receipt is its own batch. qtyRemaining is
  // drawn down FIFO as approvals issue material out to the floor, so you
  // can tell which batch(es) actually left the shelf. Older records (before
  // this field existed) have no batchNo and are treated as one big
  // undifferentiated pool for FIFO purposes.
  batchNo?: string | null;
  qtyRemaining?: number | null;
  // Quality inspection gate — material sits here as 'pending' the moment
  // it's logged at the gate, and does NOT touch Material.currentStock yet.
  // An inspector then passes it (→ stock is added) or fails/holds it
  // (→ stock stays untouched, Store Manager sees it flagged for action).
  //
  // Partial-quantity QC: a single GRN line can be split across multiple
  // decisions (e.g. 300 received, 180 passed, 120 rejected). qcStatus
  // reflects the *overall* bucket so existing pending/passed/failed/hold
  // filters keep working on legacy (all-or-nothing) records:
  //   'pending' — nothing decided yet (qtyPending === qty)
  //   'partial' — some decided, some still awaiting inspection
  //   'passed'/'failed'/'hold' — fully decided, one outcome for all of it
  //   'mixed'   — fully decided, but split across 2+ outcomes
  qcStatus: 'pending' | 'passed' | 'failed' | 'hold' | 'partial' | 'mixed';
  qcByName?: string | null;
  qcAt?: string | null;
  qcNotes?: string | null;
  // Running totals of qty already decided, by outcome. Undefined on
  // legacy (pre-partial-QC) records — treated as 0, so qtyPending still
  // computes correctly (qty - qtyPassed - qtyFailed - qtyHold).
  qtyPassed?: number | null;
  qtyFailed?: number | null;
  qtyHold?: number | null;
  // Full audit trail — one entry per partial decision, so you can always
  // see who decided what portion, when, and why, even after the GRN as a
  // whole is fully resolved.
  qcDecisions?: {
    qty: number;
    decision: 'passed' | 'failed' | 'hold';
    byName: string;
    at: string;
    notes?: string | null;
  }[];
}

// One line of a FIFO batch draw — which incoming-material receipt(s) an
// approval/issue pulled from, and how much. Lets you trace a consumption
// entry all the way back to the actual delivery it came from.
export interface BatchDraw {
  incomingId: string;
  batchNo: string | null;
  qty: number;
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
  // Document trail: which Floor Stock issue this consumption is drawing
  // down. Not a hard foreign key (Floor Stock is a running balance, not
  // per-batch), but lets you jump from a log entry to "what section/request
  // put this material on the floor in the first place."
  sectionRequestIds?: string[] | null;
  // True once a Return-to-Store has been logged against this entry
  // (see MaterialReturn) — kept so the log itself shows it was reversed
  // instead of just silently having a matching return elsewhere.
  reversed?: boolean | null;
}

// Reversal of material sitting on the floor, back into Store — the other
// half of the Store ↔ Floor loop that was missing before. Undoes exactly
// what an approval did: Floor Stock goes DOWN, Store's currentStock goes
// back UP by the same qty. Consumption already logged is untouched — this
// is only for floor stock that was issued but never used.
export interface MaterialReturn {
  id: string;
  date: string;
  sectionId: string;
  sectionName: string;
  materialId: string;
  materialName: string;
  unit: string;
  qty: number;
  reason?: string | null;
  returnedByName: string;
  // Which original approval(s) this traces back to, for the document trail
  // — filled in automatically inside dbCreateMaterialReturn from Floor
  // Stock's own trail, so callers don't need to supply it.
  sourceRequestIds?: string[];
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
  // Document trail: every approved MaterialRequest.id that has ever fed
  // this row. Lets a consumption entry (or a return) be traced back to the
  // request(s)/approval(s) that actually put the material on the floor.
  sourceRequestIds?: string[] | null;
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
  { id: 'door_cutting', name: 'Mosaic' },
  { id: 'mosaic', name: 'Grouting' },
  { id: 'grouting', name: 'Door Cutting' },
  { id: 'acrylic', name: 'Acrylic' },
];


