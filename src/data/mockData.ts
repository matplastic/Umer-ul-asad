import { StageDefinition, Pool, Team, ActivityLog, StageId, StageHistory, PlannedPool } from '../types';

export const STAGES: StageDefinition[] = [
  { id: 'steel_fabrication', name: 'Steel Fabrication', defaultTeamsCount: 5, color: '#3b82f6' }, // Blue
  { id: 'steel_primer', name: 'Steel Primer', defaultTeamsCount: 3, color: '#f59e0b' }, // Amber
  { id: 'plumbing', name: 'Plumbing', defaultTeamsCount: 7, color: '#06b6d4' }, // Cyan
  { id: 'cladding', name: 'Cladding', defaultTeamsCount: 4, color: '#8b5cf6' }, // Purple
  { id: 'skimmer_fitting', name: 'Skimmer Fitting', defaultTeamsCount: 4, color: '#f97316' }, // Orange
  { id: 'lamination', name: 'Lamination', defaultTeamsCount: 5, color: '#ec4899' }, // Pink
  { id: 'mechanical_fitting', name: 'Mechanical Fitting', defaultTeamsCount: 4, color: '#f43f5e' }, // Rose/Red
  { id: 'skimmer_test', name: 'Skimmer Test', defaultTeamsCount: 3, color: '#f97316' }, // Orange
  { id: 'door_cutting', name: 'Door Cutting', defaultTeamsCount: 3, color: '#84cc16' }, // Lime
  { id: 'mosaic', name: 'Mosaic', defaultTeamsCount: 6, color: '#10b981' }, // Emerald
  { id: 'grouting', name: 'Grouting', defaultTeamsCount: 4, color: '#14b8a6' }, // Teal
  { id: 'acrylic', name: 'Acrylic', defaultTeamsCount: 3, color: '#6366f1' }, // Indigo
];

// These two stages run in PARALLEL on the shop floor (skimmer boxes get set
// into the shell during the lamination layup, not after it). A pool sits at
// the shared "gate" (the Skimmer Fitting index in STAGES) and is visible on
// BOTH boards at once. Each stage is claimed, worked, and QC-signed off
// independently. The pool only advances to the next stage (Mechanical
// Fitting) once BOTH of these have been APPROVED by QC.
export const DUAL_STAGE_IDS: StageId[] = ['skimmer_fitting', 'lamination'];

// Generate teams based on STAGES
export const generateDefaultTeams = (): Team[] => {
  const teams: Team[] = [];
  STAGES.forEach((stage) => {
    for (let i = 1; i <= stage.defaultTeamsCount; i++) {
      teams.push({
        id: `${stage.id}_t${i}`,
        stageId: stage.id,
        name: `${stage.name} - Team ${i}`,
        status: 'IDLE',
        activePoolId: null,
      });
    }
  });
  return teams;
};

// Helper to create empty or pre-filled stage history for a pool
export const createEmptyHistory = (): { [key in StageId]: StageHistory } => {
  return {
    steel_fabrication: { stageId: 'steel_fabrication', status: 'NOT_STARTED', rejectionCount: 0 },
    steel_primer: { stageId: 'steel_primer', status: 'NOT_STARTED', rejectionCount: 0 },
    plumbing: { stageId: 'plumbing', status: 'NOT_STARTED', rejectionCount: 0 },
    cladding: { stageId: 'cladding', status: 'NOT_STARTED', rejectionCount: 0 },
    skimmer_fitting: { stageId: 'skimmer_fitting', status: 'NOT_STARTED', rejectionCount: 0 },
    lamination: { stageId: 'lamination', status: 'NOT_STARTED', rejectionCount: 0 },
    mechanical_fitting: { stageId: 'mechanical_fitting', status: 'NOT_STARTED', rejectionCount: 0 },
    skimmer_test: { stageId: 'skimmer_test', status: 'NOT_STARTED', rejectionCount: 0 },
    door_cutting: { stageId: 'door_cutting', status: 'NOT_STARTED', rejectionCount: 0 },
    mosaic: { stageId: 'mosaic', status: 'NOT_STARTED', rejectionCount: 0 },
    grouting: { stageId: 'grouting', status: 'NOT_STARTED', rejectionCount: 0 },
    acrylic: { stageId: 'acrylic', status: 'NOT_STARTED', rejectionCount: 0 },
  };
};

const dateMinusHours = (hours: number): string => {
  const d = new Date();
  d.setHours(d.getHours() - hours);
  return d.toISOString();
};

export const getInitialData = () => {
  // Demo data permanently disabled — return an empty operational dataset so
  // first-time devices do NOT seed phantom pools/projects into Firestore.
  return {
    pools: [] as Pool[],
    teams: generateDefaultTeams(),
    logs: [] as ActivityLog[],
    plannedPools: [] as PlannedPool[],
  };
};

// Original mock data kept below for reference only (never executed).
const _UNUSED_getInitialData_LEGACY = () => {
  const defaultTeams = generateDefaultTeams();
  
  // Set up mock pools with realistic state
  const mockPools: any[] = [
    {
      id: 'pool_1',
      projectName: 'Oasis Resort Main Pool',
      poolNo: 'P-1042',
      orientation: 'Normal',
      dimensions: '25m x 10m',
      shape: 'Olympic Rectangular',
      notes: 'Heavy plumbing requirements. Includes shallow lounging ledge.',
      createdAt: dateMinusHours(48),
      currentStageIndex: 3, // Cladding
      stageHistory: {
        steel_fabrication: {
          stageId: 'steel_fabrication',
          status: 'APPROVED',
          teamId: 'steel_fabrication_t2',
          startTime: dateMinusHours(48),
          endTime: dateMinusHours(42),
          durationMinutes: 360,
          inspectorId: 'Insp. Sarah',
          inspectorNotes: 'Welds inspect pristine. Structural integrity approved.',
          inspectionTime: dateMinusHours(41),
          rejectionCount: 0,
        },
        steel_primer: {
          stageId: 'steel_primer',
          status: 'APPROVED',
          teamId: 'steel_primer_t1',
          startTime: dateMinusHours(41),
          endTime: dateMinusHours(37),
          durationMinutes: 240,
          inspectorId: 'Insp. Sarah',
          inspectorNotes: 'Even primer thickness across all panels. High-quality coat.',
          inspectionTime: dateMinusHours(36),
          rejectionCount: 0,
        },
        plumbing: {
          stageId: 'plumbing',
          status: 'APPROVED',
          teamId: 'plumbing_t4',
          startTime: dateMinusHours(36),
          endTime: dateMinusHours(22),
          durationMinutes: 840,
          inspectorId: 'Insp. Sarah',
          inspectorNotes: 'Pressure testing passed at 30 PSI. No leaks detected.',
          inspectionTime: dateMinusHours(21),
          rejectionCount: 0,
        },
        cladding: {
          stageId: 'cladding',
          status: 'IN_PROGRESS',
          teamId: 'cladding_t1',
          startTime: dateMinusHours(20),
          endTime: null,
          rejectionCount: 0,
        },
        skimmer_fitting: { stageId: 'skimmer_fitting', status: 'NOT_STARTED', rejectionCount: 0 },
        lamination: { stageId: 'lamination', status: 'NOT_STARTED', rejectionCount: 0 },
        mechanical_fitting: { stageId: 'mechanical_fitting', status: 'NOT_STARTED', rejectionCount: 0 },
        mosaic: { stageId: 'mosaic', status: 'NOT_STARTED', rejectionCount: 0 },
        grouting: { stageId: 'grouting', status: 'NOT_STARTED', rejectionCount: 0 },
        acrylic: { stageId: 'acrylic', status: 'NOT_STARTED', rejectionCount: 0 },
      }
    },
    {
      id: 'pool_2',
      projectName: 'Villa Sapphire Infinity',
      poolNo: 'P-1043',
      orientation: 'Mirror',
      dimensions: '12m x 6m',
      shape: 'Infinity Curve',
      notes: 'Vanishing edge wall requires exact leveling during steel fabrication.',
      createdAt: dateMinusHours(12),
      currentStageIndex: 0, // Steel Fabrication
      stageHistory: {
        steel_fabrication: {
          stageId: 'steel_fabrication',
          status: 'IN_PROGRESS',
          teamId: 'steel_fabrication_t3',
          startTime: dateMinusHours(10),
          endTime: null,
          rejectionCount: 0,
        },
        steel_primer: { stageId: 'steel_primer', status: 'NOT_STARTED', rejectionCount: 0 },
        plumbing: { stageId: 'plumbing', status: 'NOT_STARTED', rejectionCount: 0 },
        cladding: { stageId: 'cladding', status: 'NOT_STARTED', rejectionCount: 0 },
        skimmer_fitting: { stageId: 'skimmer_fitting', status: 'NOT_STARTED', rejectionCount: 0 },
        lamination: { stageId: 'lamination', status: 'NOT_STARTED', rejectionCount: 0 },
        mechanical_fitting: { stageId: 'mechanical_fitting', status: 'NOT_STARTED', rejectionCount: 0 },
        mosaic: { stageId: 'mosaic', status: 'NOT_STARTED', rejectionCount: 0 },
        grouting: { stageId: 'grouting', status: 'NOT_STARTED', rejectionCount: 0 },
        acrylic: { stageId: 'acrylic', status: 'NOT_STARTED', rejectionCount: 0 },
      }
    },
    {
      id: 'pool_3',
      projectName: 'Lagoon Leisure Lap Pool',
      poolNo: 'P-1044',
      orientation: 'Normal',
      dimensions: '15m x 3.5m',
      shape: 'Linear Lap Pool',
      notes: 'In-floor cleaning system plumbing. Verify nozzles placement.',
      createdAt: dateMinusHours(24),
      currentStageIndex: 2, // Plumbing
      stageHistory: {
        steel_fabrication: {
          stageId: 'steel_fabrication',
          status: 'APPROVED',
          teamId: 'steel_fabrication_t5',
          startTime: dateMinusHours(24),
          endTime: dateMinusHours(18),
          durationMinutes: 360,
          inspectorId: 'Insp. Mike',
          inspectorNotes: 'Passed dimensions check.',
          inspectionTime: dateMinusHours(17.5),
          rejectionCount: 0,
        },
        steel_primer: {
          stageId: 'steel_primer',
          status: 'APPROVED',
          teamId: 'steel_primer_t3',
          startTime: dateMinusHours(17.5),
          endTime: dateMinusHours(13),
          durationMinutes: 270,
          inspectorId: 'Insp. Mike',
          inspectorNotes: 'Priming finished.',
          inspectionTime: dateMinusHours(12.5),
          rejectionCount: 0,
        },
        plumbing: {
          stageId: 'plumbing',
          status: 'PENDING_INSPECTION',
          teamId: 'plumbing_t2',
          startTime: dateMinusHours(12.5),
          endTime: dateMinusHours(2),
          durationMinutes: 630,
          rejectionCount: 0,
        },
        cladding: { stageId: 'cladding', status: 'NOT_STARTED', rejectionCount: 0 },
        skimmer_fitting: { stageId: 'skimmer_fitting', status: 'NOT_STARTED', rejectionCount: 0 },
        lamination: { stageId: 'lamination', status: 'NOT_STARTED', rejectionCount: 0 },
        mechanical_fitting: { stageId: 'mechanical_fitting', status: 'NOT_STARTED', rejectionCount: 0 },
        mosaic: { stageId: 'mosaic', status: 'NOT_STARTED', rejectionCount: 0 },
        grouting: { stageId: 'grouting', status: 'NOT_STARTED', rejectionCount: 0 },
        acrylic: { stageId: 'acrylic', status: 'NOT_STARTED', rejectionCount: 0 },
      }
    },
    {
      id: 'pool_4',
      projectName: 'Skyline Penthouse Acrylic Plunge',
      poolNo: 'P-1045',
      orientation: 'Normal',
      dimensions: '6m x 3m',
      shape: 'Bespoke Raised Plunge',
      notes: 'Double transparent side windows. Requires premium structural acrylic installation.',
      createdAt: dateMinusHours(120),
      currentStageIndex: 9, // Completed!
      stageHistory: {
        steel_fabrication: {
          stageId: 'steel_fabrication',
          status: 'APPROVED',
          teamId: 'steel_fabrication_t1',
          startTime: dateMinusHours(120),
          endTime: dateMinusHours(114),
          durationMinutes: 360,
          inspectorId: 'Insp. David',
          inspectorNotes: 'Custom structural frame verified. Passed standard load criteria.',
          inspectionTime: dateMinusHours(113),
          rejectionCount: 0,
        },
        steel_primer: {
          stageId: 'steel_primer',
          status: 'APPROVED',
          teamId: 'steel_primer_t2',
          startTime: dateMinusHours(113),
          endTime: dateMinusHours(109),
          durationMinutes: 240,
          inspectorId: 'Insp. David',
          inspectorNotes: 'Standard 2-layer coat verified.',
          inspectionTime: dateMinusHours(108),
          rejectionCount: 0,
        },
        plumbing: {
          stageId: 'plumbing',
          status: 'APPROVED',
          teamId: 'plumbing_t1',
          startTime: dateMinusHours(108),
          endTime: dateMinusHours(96),
          durationMinutes: 720,
          inspectorId: 'Insp. Mike',
          inspectorNotes: 'Plumbing schematics matched.',
          inspectionTime: dateMinusHours(95),
          rejectionCount: 0,
        },
        cladding: {
          stageId: 'cladding',
          status: 'APPROVED',
          teamId: 'cladding_t3',
          startTime: dateMinusHours(95),
          endTime: dateMinusHours(84),
          durationMinutes: 660,
          inspectorId: 'Insp. Mike',
          inspectorNotes: 'Outer steel plate cladding installed perfect.',
          inspectionTime: dateMinusHours(83),
          rejectionCount: 0,
        },
        skimmer_fitting: {
          stageId: 'skimmer_fitting',
          status: 'APPROVED',
          teamId: 'skimmer_fitting_t1',
          startTime: dateMinusHours(84),
          endTime: dateMinusHours(83),
          durationMinutes: 60,
          inspectorId: 'Insp. Mike',
          inspectorNotes: 'Skimmers fitted perfectly.',
          inspectionTime: dateMinusHours(83),
          rejectionCount: 0,
        },
        lamination: {
          stageId: 'lamination',
          status: 'APPROVED',
          teamId: 'lamination_t2',
          startTime: dateMinusHours(83),
          endTime: dateMinusHours(70),
          durationMinutes: 780,
          inspectorId: 'Insp. David',
          inspectorNotes: 'Fiberglass coating thickness matches and sealed correct.',
          inspectionTime: dateMinusHours(69),
          rejectionCount: 0,
        },
        mechanical_fitting: {
          stageId: 'mechanical_fitting',
          status: 'APPROVED',
          teamId: 'mechanical_fitting_t1',
          startTime: dateMinusHours(70),
          endTime: dateMinusHours(69),
          durationMinutes: 60,
          inspectorId: 'Insp. David',
          inspectorNotes: 'Hydraulic and circulation equipment fitted perfectly inside mechanical bay.',
          inspectionTime: dateMinusHours(69),
          rejectionCount: 0,
        },
        mosaic: {
          stageId: 'mosaic',
          status: 'APPROVED',
          teamId: 'mosaic_t5',
          startTime: dateMinusHours(69),
          endTime: dateMinusHours(45),
          durationMinutes: 1440,
          inspectorId: 'Insp. David',
          inspectorNotes: 'Italian glass mosaic tiling installed beautifully. Grouting flawless.',
          inspectionTime: dateMinusHours(44),
          rejectionCount: 0,
        },
        grouting: {
          stageId: 'grouting',
          status: 'APPROVED',
          teamId: 'grouting_t1',
          startTime: dateMinusHours(44),
          endTime: dateMinusHours(35),
          durationMinutes: 540,
          inspectorId: 'Insp. David',
          inspectorNotes: 'Flawless grouting finish on tiles.',
          inspectionTime: dateMinusHours(34),
          rejectionCount: 0,
        },
        acrylic: {
          stageId: 'acrylic',
          status: 'APPROVED',
          teamId: 'acrylic_t1',
          startTime: dateMinusHours(44),
          endTime: dateMinusHours(30),
          durationMinutes: 840,
          inspectorId: 'Insp. Mike',
          inspectorNotes: 'Acrylic windows aligned, structural seals cured fully.',
          inspectionTime: dateMinusHours(29),
          rejectionCount: 0,
        },
      },
      completedAt: dateMinusHours(29)
    },
    {
      id: 'pool_5',
      projectName: 'Sunset Cove Family Pool',
      poolNo: 'P-1046',
      orientation: 'Mirror',
      dimensions: '18m x 8m',
      shape: 'Freeform Lagoon with Spa',
      notes: 'Integrated jacuzzi spa nozzle loops. Steel primer rejected once for uneven thickness.',
      createdAt: dateMinusHours(36),
      currentStageIndex: 1, // Steel Primer
      stageHistory: {
        steel_fabrication: {
          stageId: 'steel_fabrication',
          status: 'APPROVED',
          teamId: 'steel_fabrication_t4',
          startTime: dateMinusHours(35),
          endTime: dateMinusHours(29),
          durationMinutes: 360,
          inspectorId: 'Insp. David',
          inspectorNotes: 'Base metal thickness and reinforcement bars are fully certified.',
          inspectionTime: dateMinusHours(28),
          rejectionCount: 0,
        },
        steel_primer: {
          stageId: 'steel_primer',
          status: 'REJECTED',
          teamId: 'steel_primer_t2',
          startTime: dateMinusHours(27),
          endTime: dateMinusHours(23),
          durationMinutes: 240,
          inspectorId: 'Insp. David',
          inspectorNotes: 'Drips and uneven layers detected on the pool deep-end corners. Needs sand re-blast + re-primer.',
          inspectionTime: dateMinusHours(22),
          rejectionCount: 1,
        },
        plumbing: { stageId: 'plumbing', status: 'NOT_STARTED', rejectionCount: 0 },
        cladding: { stageId: 'cladding', status: 'NOT_STARTED', rejectionCount: 0 },
        skimmer_fitting: { stageId: 'skimmer_fitting', status: 'NOT_STARTED', rejectionCount: 0 },
        lamination: { stageId: 'lamination', status: 'NOT_STARTED', rejectionCount: 0 },
        mechanical_fitting: { stageId: 'mechanical_fitting', status: 'NOT_STARTED', rejectionCount: 0 },
        mosaic: { stageId: 'mosaic', status: 'NOT_STARTED', rejectionCount: 0 },
        grouting: { stageId: 'grouting', status: 'NOT_STARTED', rejectionCount: 0 },
        acrylic: { stageId: 'acrylic', status: 'NOT_STARTED', rejectionCount: 0 },
      }
    }
  ];

  // Map initially busy teams
  mockPools.forEach(pool => {
    if (pool.currentStageIndex < STAGES.length) {
      const activeStageId = STAGES[pool.currentStageIndex].id;
      const stageHist = pool.stageHistory[activeStageId];
      if (stageHist && (stageHist.status === 'IN_PROGRESS' || stageHist.status === 'PENDING_INSPECTION' || stageHist.status === 'REJECTED')) {
        const teamId = stageHist.teamId;
        if (teamId) {
          const team = defaultTeams.find(t => t.id === teamId);
          if (team) {
            team.status = 'BUSY';
            team.activePoolId = pool.id;
          }
        }
      }
    }
  });

  const mockLogs: ActivityLog[] = [
    {
      id: 'log_1',
      timestamp: dateMinusHours(48),
      poolId: 'pool_1',
      poolNo: 'P-1042',
      projectName: 'Oasis Resort Main Pool',
      stageId: 'steel_fabrication',
      type: 'CREATED',
      operatorName: 'Eng. Karim R.',
      notes: 'Pool registered by Production Engineer. Frame type: Heavy duty. Orientation: Normal.'
    },
    {
      id: 'log_2',
      timestamp: dateMinusHours(48),
      poolId: 'pool_1',
      poolNo: 'P-1042',
      projectName: 'Oasis Resort Main Pool',
      stageId: 'steel_fabrication',
      type: 'STAGE_STARTED',
      teamName: 'Steel Fabrication - Team 2',
      operatorName: 'Steel Fabrication - Team 2',
      notes: 'Steel Fabrication stage started.'
    },
    {
      id: 'log_3',
      timestamp: dateMinusHours(42),
      poolId: 'pool_1',
      poolNo: 'P-1042',
      projectName: 'Oasis Resort Main Pool',
      stageId: 'steel_fabrication',
      type: 'STAGE_FINISHED',
      teamName: 'Steel Fabrication - Team 2',
      operatorName: 'Steel Fabrication - Team 2',
      notes: 'Completed structural framing. Ready for quality review.'
    },
    {
      id: 'log_4',
      timestamp: dateMinusHours(41),
      poolId: 'pool_1',
      poolNo: 'P-1042',
      projectName: 'Oasis Resort Main Pool',
      stageId: 'steel_fabrication',
      type: 'APPROVED',
      operatorName: 'Insp. Sarah',
      notes: 'Structural welds inspected and approved. Passing to Next Stage.'
    },
    {
      id: 'log_5',
      timestamp: dateMinusHours(27),
      poolId: 'pool_5',
      poolNo: 'P-1046',
      projectName: 'Sunset Cove Family Pool',
      stageId: 'steel_primer',
      type: 'STAGE_STARTED',
      teamName: 'Steel Primer - Team 2',
      operatorName: 'Steel Primer - Team 2',
      notes: 'Anti-corrosive primary coat spraying sequence initiated.'
    },
    {
      id: 'log_6',
      timestamp: dateMinusHours(22),
      poolId: 'pool_5',
      poolNo: 'P-1046',
      projectName: 'Sunset Cove Family Pool',
      stageId: 'steel_primer',
      type: 'REJECTED',
      operatorName: 'Insp. David',
      notes: 'REJECTED: Drips and uneven layers detected on corners. Action required: Sandblast and prime again.'
    }
  ];

  const initialPlannedPools: PlannedPool[] = [
    {
      id: 'plan_1',
      projectName: 'Villa Sapphire Infinity',
      poolNo: 'PL-2091',
      orientation: 'Mirror',
      dimensions: '14m x 6m',
      shape: 'Classic Rectangle',
      status: 'PLANNED',
      createdAt: dateMinusHours(72)
    },
    {
      id: 'plan_2',
      projectName: 'Lagoon Leisure Lap Pool',
      poolNo: 'PL-3512',
      orientation: 'Normal',
      dimensions: '16m x 4m',
      shape: 'Linear Lap Pool',
      status: 'RELEASED',
      releasedPoolId: 'pool_3',
      createdAt: dateMinusHours(24)
    },
    {
      id: 'plan_3',
      projectName: 'Oasis Resort Main Pool',
      poolNo: 'PL-4041',
      orientation: 'Normal',
      dimensions: '30m x 15m',
      shape: 'Lagoon Lounge',
      status: 'RELEASED',
      releasedPoolId: 'pool_1',
      createdAt: dateMinusHours(48)
    },
    {
      id: 'plan_4',
      projectName: 'Oceanic Horizon Estates',
      poolNo: 'PL-8812',
      orientation: 'Mirror',
      dimensions: '12m x 5m',
      shape: 'Infinity Curve',
      status: 'PLANNED',
      createdAt: dateMinusHours(12)
    },
    {
      id: 'plan_5',
      projectName: 'Oceanic Horizon Estates',
      poolNo: 'PL-8813',
      orientation: 'Normal',
      dimensions: '10m x 4.5m',
      shape: 'Classic Rectangle',
      status: 'PLANNED',
      createdAt: dateMinusHours(10)
    },
    {
      id: 'plan_6',
      projectName: 'Villa Jewel High-Rise',
      poolNo: 'PL-9214',
      orientation: 'Normal',
      dimensions: '8m x 3.5m',
      shape: 'Bespoke Plunge',
      status: 'PLANNED',
      createdAt: dateMinusHours(6)
    }
  ];

  const fixedPools: Pool[] = mockPools.map(pool => {
    const stageHistory = { ...pool.stageHistory } as any;
    STAGES.forEach(s => {
      if (!stageHistory[s.id]) {
        stageHistory[s.id] = { stageId: s.id, status: 'NOT_STARTED', rejectionCount: 0 };
      }
    });
    return { ...pool, stageHistory } as Pool;
  });

  return { pools: fixedPools, teams: defaultTeams, logs: mockLogs, plannedPools: initialPlannedPools };
};
