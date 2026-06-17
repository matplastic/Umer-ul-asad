import { useState, useEffect } from 'react';
import { Pool, StageId, Team, ActivityLog, ViewRole, PoolOrientation } from './types';
import { STAGES, getInitialData, createEmptyHistory } from './data/mockData';
import { RoleSelector } from './components/RoleSelector';
import { ProductionEngineer } from './components/ProductionEngineer';
import { StageDashboard } from './components/StageDashboard';
import { QualityInspector } from './components/QualityInspector';
import { FactoryEntrance } from './components/FactoryEntrance';
import { ManagementDashboard } from './components/ManagementDashboard';
import { SectionDashboardTV } from './components/SectionDashboardTV';
import { Info, RotateCcw, AlertCircle, HelpCircle } from 'lucide-react';
import { initAuth, googleSignIn, googleSignOut } from './lib/googleDrive';

const DEFAULT_INSPECTORS = [
  { id: 'insp_1', name: 'Insp. Sarah Wells', title: 'Structural Quality Lead' },
  { id: 'insp_2', name: 'Insp. Mike Vance', title: 'Plumbing Specialist' },
  { id: 'insp_3', name: 'Insp. David Cole', title: 'Seals Quality Chief' },
];

const DEFAULT_ENGINEERS = [
  { id: 'eng_1', name: 'Eng. Karim R.', title: 'Lead Production Engineer' },
  { id: 'eng_2', name: 'Eng. Fatima S.', title: 'Process Layout Specialist' },
];

export default function App() {
  const [pools, setPools] = useState<Pool[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [inspectors, setInspectors] = useState<{ id: string; name: string; title: string }[]>([]);
  const [engineers, setEngineers] = useState<{ id: string; name: string; title: string }[]>([]);

  // Google Drive integration states
  const [googleUser, setGoogleUser] = useState<any>(null);

  // Simulation controls
  const [currentRole, setCurrentRole] = useState<ViewRole>('management');
  const [selectedStageId, setSelectedStageId] = useState<StageId>('steel_fabrication');
  const [workerTeamId, setWorkerTeamId] = useState<string>('');
  
  // Guide helper box toggle
  const [showGuide, setShowGuide] = useState(true);

  // Load state from localStorage & register Auth listener on mount
  useEffect(() => {
    const unsubscribe = initAuth(
      (user, token) => {
        setGoogleUser(user);
      },
      () => {
        setGoogleUser(null);
      }
    );

    const storedPools = localStorage.getItem('apex_pools');
    const storedTeams = localStorage.getItem('apex_teams');
    const storedLogs = localStorage.getItem('apex_logs');
    const storedInspectors = localStorage.getItem('apex_inspectors');
    const storedEngineers = localStorage.getItem('apex_engineers');

    if (storedPools && storedTeams && storedLogs) {
      try {
        setPools(JSON.parse(storedPools));
        setTeams(JSON.parse(storedTeams));
        setLogs(JSON.parse(storedLogs));
        setInspectors(storedInspectors ? JSON.parse(storedInspectors) : DEFAULT_INSPECTORS);
        setEngineers(storedEngineers ? JSON.parse(storedEngineers) : DEFAULT_ENGINEERS);
      } catch (e) {
        console.error('Error parsing stored pool data:', e);
        loadDefaultMockData();
      }
    } else {
      loadDefaultMockData();
    }

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, []);

  const handleGoogleSignIn = async () => {
    try {
      const result = await googleSignIn();
      if (result) {
        setGoogleUser(result.user);
      }
    } catch (err: any) {
      console.error('Sign-in failed:', err);
    }
  };

  const handleGoogleSignOut = async () => {
    try {
      await googleSignOut();
      setGoogleUser(null);
    } catch (err) {
      console.error('Sign-out failed:', err);
    }
  };

  const loadDefaultMockData = () => {
    const data = getInitialData();
    setPools(data.pools);
    setTeams(data.teams);
    setLogs(data.logs);
    setInspectors(DEFAULT_INSPECTORS);
    setEngineers(DEFAULT_ENGINEERS);
    
    // Auto-select first team in fabrication stage
    const fabTeams = data.teams.filter(t => t.stageId === 'steel_fabrication');
    if (fabTeams.length > 0) {
      setWorkerTeamId(fabTeams[0].id);
    }

    saveState(data.pools, data.teams, data.logs, DEFAULT_INSPECTORS, DEFAULT_ENGINEERS);
  };

  const saveState = (
    updatedPools: Pool[], 
    updatedTeams: Team[], 
    updatedLogs: ActivityLog[],
    updatedInspectors = inspectors,
    updatedEngineers = engineers
  ) => {
    localStorage.setItem('apex_pools', JSON.stringify(updatedPools));
    localStorage.setItem('apex_teams', JSON.stringify(updatedTeams));
    localStorage.setItem('apex_logs', JSON.stringify(updatedLogs));
    localStorage.setItem('apex_inspectors', JSON.stringify(updatedInspectors));
    localStorage.setItem('apex_engineers', JSON.stringify(updatedEngineers));
  };

  // State update dispatchers for dynamically changing names
  const handleUpdateTeams = (updatedTeams: Team[]) => {
    setTeams(updatedTeams);
    saveState(pools, updatedTeams, logs, inspectors, engineers);
  };

  const handleUpdateInspectors = (updatedInspectors: { id: string; name: string; title: string }[]) => {
    setInspectors(updatedInspectors);
    saveState(pools, teams, logs, updatedInspectors, engineers);
  };

  const handleUpdateEngineers = (updatedEngineers: { id: string; name: string; title: string }[]) => {
    setEngineers(updatedEngineers);
    saveState(pools, teams, logs, inspectors, updatedEngineers);
  };

  const handleRenameProject = (oldName: string, newName: string) => {
    if (!newName.trim() || oldName === newName) return;
    
    const updatedPools = pools.map(p => p.projectName === oldName ? { ...p, projectName: newName.trim() } : p);
    const updatedLogs = logs.map(l => l.projectName === oldName ? { ...l, projectName: newName.trim() } : l);
    
    setPools(updatedPools);
    setLogs(updatedLogs);
    saveState(updatedPools, teams, updatedLogs, inspectors, engineers);
  };

  const handleRestoreState = (recovered: {
    pools: Pool[];
    teams: Team[];
    logs: ActivityLog[];
    inspectors?: { id: string; name: string; title: string }[];
    engineers?: { id: string; name: string; title: string }[];
  }) => {
    if (recovered.pools) setPools(recovered.pools);
    if (recovered.teams) setTeams(recovered.teams);
    if (recovered.logs) setLogs(recovered.logs);
    if (recovered.inspectors) setInspectors(recovered.inspectors);
    if (recovered.engineers) setEngineers(recovered.engineers);
    
    saveState(
      recovered.pools || pools,
      recovered.teams || teams,
      recovered.logs || logs,
      recovered.inspectors || inspectors,
      recovered.engineers || engineers
    );
  };

  const handleDeletePool = (poolId: string, operatorName: string) => {
    const targetPool = pools.find(p => p.id === poolId);
    if (!targetPool) return;

    if (!window.confirm(`Are you absolutely sure you want to delete and scrap Pool [${targetPool.poolNo}] for "${targetPool.projectName}"? All manufacturing records for this pool will be deleted permanently.`)) {
      return;
    }

    const updatedPools = pools.filter(p => p.id !== poolId);
    
    // Auto-release any team currently assigned
    const updatedTeams = teams.map(t => {
      if (t.activePoolId === poolId) {
        return { ...t, status: 'IDLE' as const, activePoolId: null };
      }
      return t;
    });

    const newLog: ActivityLog = {
      id: `log_${Date.now()}`,
      timestamp: new Date().toISOString(),
      poolId: 'scrapped',
      poolNo: targetPool.poolNo,
      projectName: targetPool.projectName,
      stageId: 'steel_fabrication',
      type: 'REJECTED',
      operatorName: operatorName || 'Quality Engineer',
      notes: `Pool/Shell card scrapped and deleted. All ongoing build steps set to terminated.`
    };

    const updatedLogs = [...logs, newLog];

    setPools(updatedPools);
    setTeams(updatedTeams);
    setLogs(updatedLogs);
    saveState(updatedPools, updatedTeams, updatedLogs, inspectors, engineers);
  };

  // Reset local state
  const handleResetData = () => {
    if (window.confirm('Are you sure you want to reset all manufacturing logs, pools status records, and team assignments to original demonstration state?')) {
      loadDefaultMockData();
    }
  };

  // 1. Create Pool (Production Engineer)
  const handleCreatePool = (spec: {
    projectName: string;
    poolNo: string;
    orientation: PoolOrientation;
    dimensions: string;
    shape: string;
    notes: string;
    operatorName: string;
  }) => {
    const newPool: Pool = {
      id: `pool_${Date.now()}`,
      projectName: spec.projectName,
      poolNo: spec.poolNo,
      orientation: spec.orientation,
      dimensions: spec.dimensions,
      shape: spec.shape,
      notes: spec.notes,
      createdAt: new Date().toISOString(),
      completedAt: null,
      currentStageIndex: 0, // Starts at Steel Fabrication (Stage index 0)
      stageHistory: createEmptyHistory()
    };

    const newLog: ActivityLog = {
      id: `log_${Date.now()}`,
      timestamp: new Date().toISOString(),
      poolId: newPool.id,
      poolNo: newPool.poolNo,
      projectName: newPool.projectName,
      stageId: 'steel_fabrication',
      type: 'CREATED',
      operatorName: spec.operatorName || 'Eng. Karim R.',
      notes: `Pool created & released. Specs: Orientation - ${spec.orientation}, Dims - ${spec.dimensions}, Shape - ${spec.shape}.`
    };

    const updatedPools = [...pools, newPool];
    const updatedLogs = [...logs, newLog];

    setPools(updatedPools);
    setLogs(updatedLogs);
    saveState(updatedPools, teams, updatedLogs, inspectors, engineers);
  };

  const handleCreatePoolBatch = (
    projectName: string,
    prefix: string,
    startRange: number,
    count: number,
    orientation: PoolOrientation,
    dimensions: string,
    shape: string,
    notes: string,
    operatorName: string
  ) => {
    const newPools: Pool[] = [];
    const timestamp = new Date().toISOString();

    for (let i = 0; i < count; i++) {
      const serial = startRange + i;
      const targetPoolNo = `${prefix}${serial}`;

      const newPool: Pool = {
        id: `pool_${Date.now()}_b${i}_${Math.random().toString(36).substring(2, 7)}`,
        projectName,
        poolNo: targetPoolNo,
        orientation,
        dimensions,
        shape,
        notes: notes ? `${notes} (Batch #${i + 1})` : `Batch #${i + 1}`,
        createdAt: timestamp,
        completedAt: null,
        currentStageIndex: 0,
        stageHistory: createEmptyHistory()
      };
      newPools.push(newPool);
    }

    const newLog: ActivityLog = {
      id: `log_${Date.now()}`,
      timestamp,
      poolId: 'batch',
      poolNo: 'BATCH',
      projectName,
      stageId: 'steel_fabrication',
      type: 'CREATED',
      operatorName: 'Eng. Karim R.',
      notes: `Batch spawner released ${count} serialized hulls [${prefix}${startRange} to ${prefix}${startRange + count - 1}] for Project "${projectName}" into fabrication queue.`
    };

    const updatedPools = [...pools, ...newPools];
    const updatedLogs = [...logs, newLog];

    setPools(updatedPools);
    setLogs(updatedLogs);
    saveState(updatedPools, teams, updatedLogs);
  };

  // 2. Claim Pool (Stage worker claims available pool card)
  const handleClaimPool = (poolId: string, teamId: string, stageId: StageId) => {
    // Find the pool
    const poolIndex = pools.findIndex(p => p.id === poolId);
    if (poolIndex === -1) return;

    // Verify team is free
    const team = teams.find(t => t.id === teamId);
    if (!team || team.status === 'BUSY') return;

    // Update pool: assign stage team details
    const updatedPools = [...pools];
    const pool = updatedPools[poolIndex];
    const stageHist = { ...pool.stageHistory[stageId] };
    stageHist.teamId = teamId;
    pool.stageHistory[stageId] = stageHist;

    // Update team: link to pool
    const updatedTeams = teams.map(t => {
      if (t.id === teamId) {
        return { ...t, status: 'BUSY' as const, activePoolId: poolId };
      }
      return t;
    });

    const newLog: ActivityLog = {
      id: `log_${Date.now()}`,
      timestamp: new Date().toISOString(),
      poolId: pool.id,
      poolNo: pool.poolNo,
      projectName: pool.projectName,
      stageId,
      type: 'STAGE_STARTED',
      teamName: team.name,
      operatorName: team.name,
      notes: `Claimed available shell card. Commencing workstation setup.`
    };

    const updatedLogs = [...logs, newLog];

    setPools(updatedPools);
    setTeams(updatedTeams);
    setLogs(updatedLogs);
    saveState(updatedPools, updatedTeams, updatedLogs);
  };

  // 3. Start Stage Timer
  const handleStartStage = (poolId: string, stageId: StageId) => {
    const poolIndex = pools.findIndex(p => p.id === poolId);
    if (poolIndex === -1) return;

    const updatedPools = [...pools];
    const pool = updatedPools[poolIndex];
    const stageHist = { ...pool.stageHistory[stageId] };
    stageHist.status = 'IN_PROGRESS';
    stageHist.startTime = new Date().toISOString();
    pool.stageHistory[stageId] = stageHist;

    const team = teams.find(t => t.id === stageHist.teamId);

    const newLog: ActivityLog = {
      id: `log_${Date.now()}`,
      timestamp: new Date().toISOString(),
      poolId: pool.id,
      poolNo: pool.poolNo,
      projectName: pool.projectName,
      stageId,
      type: 'STAGE_STARTED',
      teamName: team?.name,
      operatorName: team?.name || 'Shop Floor Team',
      notes: `Started stage fabrication timer on the floor.`
    };

    const updatedLogs = [...logs, newLog];
    setPools(updatedPools);
    setLogs(updatedLogs);
    saveState(updatedPools, teams, updatedLogs);
  };

  // 4. Complete / Finish Stage (Promotes to QA validation)
  const handleFinishStage = (poolId: string, stageId: StageId) => {
    const poolIndex = pools.findIndex(p => p.id === poolId);
    if (poolIndex === -1) return;

    const updatedPools = [...pools];
    const pool = updatedPools[poolIndex];
    const stageHist = { ...pool.stageHistory[stageId] };
    
    stageHist.status = 'PENDING_INSPECTION';
    const nowStr = new Date().toISOString();
    stageHist.endTime = nowStr;

    // Calculate duration
    if (stageHist.startTime) {
      const msDiff = new Date(nowStr).getTime() - new Date(stageHist.startTime).getTime();
      const minutes = Math.max(1, Math.round(msDiff / 60000));
      stageHist.durationMinutes = minutes;
    } else {
      stageHist.durationMinutes = 45; // Default safe mock duration if no timer start was toggled
    }

    pool.stageHistory[stageId] = stageHist;
    const team = teams.find(t => t.id === stageHist.teamId);

    const newLog: ActivityLog = {
      id: `log_${Date.now()}`,
      timestamp: nowStr,
      poolId: pool.id,
      poolNo: pool.poolNo,
      projectName: pool.projectName,
      stageId,
      type: 'STAGE_FINISHED',
      teamName: team?.name,
      operatorName: team?.name || 'Shop Floor Team',
      notes: `Stage fabrication completed in ${stageHist.durationMinutes} mins. Sent to Quality Inspection Queue.`
    };

    const updatedLogs = [...logs, newLog];
    setPools(updatedPools);
    setLogs(updatedLogs);
    saveState(updatedPools, teams, updatedLogs);
  };

  // 5. Approve Stage (By Quality Inspector)
  const handleApproveStage = (poolId: string, stageId: StageId, inspectorId: string, notes: string) => {
    const poolIndex = pools.findIndex(p => p.id === poolId);
    if (poolIndex === -1) return;

    const updatedPools = [...pools];
    const pool = updatedPools[poolIndex];
    const stageHist = { ...pool.stageHistory[stageId] };

    // Set approved status
    stageHist.status = 'APPROVED';
    stageHist.inspectorId = inspectorId;
    stageHist.inspectorNotes = notes;
    stageHist.inspectionTime = new Date().toISOString();
    pool.stageHistory[stageId] = stageHist;

    const originalWorkspecTeamId = stageHist.teamId;

    // Release the assigned team from BUSY state
    const updatedTeams = teams.map(t => {
      if (t.id === originalWorkspecTeamId) {
        return { ...t, status: 'IDLE' as const, activePoolId: null };
      }
      return t;
    });

    // Advance pool to the next stage index
    const nextIndex = pool.currentStageIndex + 1;
    pool.currentStageIndex = nextIndex;

    // If advanced past 7 (all stages complete), stamp completedAt
    if (nextIndex >= STAGES.length) {
      pool.completedAt = new Date().toISOString();
    }

    const newLog: ActivityLog = {
      id: `log_${Date.now()}`,
      timestamp: new Date().toISOString(),
      poolId: pool.id,
      poolNo: pool.poolNo,
      projectName: pool.projectName,
      stageId,
      type: 'APPROVED',
      operatorName: inspectorId,
      notes: `QC APPROVED: ${notes}. Unlocked stage: ${nextIndex < STAGES.length ? STAGES[nextIndex].name : 'Final Completion Shipment'}`
    };

    const updatedLogs = [...logs, newLog];

    setPools(updatedPools);
    setTeams(updatedTeams);
    setLogs(updatedLogs);
    saveState(updatedPools, updatedTeams, updatedLogs);
  };

  // 6. Reject Stage (Sends pool back for rework)
  const handleRejectStage = (poolId: string, stageId: StageId, inspectorId: string, notes: string) => {
    const poolIndex = pools.findIndex(p => p.id === poolId);
    if (poolIndex === -1) return;

    const updatedPools = [...pools];
    const pool = updatedPools[poolIndex];
    const stageHist = { ...pool.stageHistory[stageId] };

    // Set rejected status & increment loop
    stageHist.status = 'REJECTED';
    stageHist.inspectorId = inspectorId;
    stageHist.inspectorNotes = notes;
    stageHist.inspectionTime = new Date().toISOString();
    stageHist.rejectionCount = (stageHist.rejectionCount || 0) + 1;
    
    // Reset startTime and endTime for clean rework tracking
    stageHist.startTime = null;
    stageHist.endTime = null;

    const originalWorkspecTeamId = stageHist.teamId;
    
    // Clear assigned team so either they or a different team reclaim and rework
    stageHist.teamId = undefined; 
    pool.stageHistory[stageId] = stageHist;

    // Release the worker team to IDLE so they are not locked
    const updatedTeams = teams.map(t => {
      if (t.id === originalWorkspecTeamId) {
        return { ...t, status: 'IDLE' as const, activePoolId: null };
      }
      return t;
    });

    const newLog: ActivityLog = {
      id: `log_${Date.now()}`,
      timestamp: new Date().toISOString(),
      poolId: pool.id,
      poolNo: pool.poolNo,
      projectName: pool.projectName,
      stageId,
      type: 'REJECTED',
      operatorName: inspectorId,
      notes: `QC REJECTED: ${notes}. Returned to Available stage queue for re-finishing.`
    };

    const updatedLogs = [...logs, newLog];

    setPools(updatedPools);
    setTeams(updatedTeams);
    setLogs(updatedLogs);
    saveState(updatedPools, updatedTeams, updatedLogs);
  };

  const handleStageChange = (stageId: StageId) => {
    setSelectedStageId(stageId);
    const stageTeams = teams.filter(t => t.stageId === stageId);
    if (stageTeams.length > 0) {
      setWorkerTeamId(stageTeams[0].id);
    } else {
      setWorkerTeamId('');
    }
  };

  const currentStageInfo = STAGES.find(s => s.id === selectedStageId) || STAGES[0];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between font-sans selection:bg-blue-250 antialiased">
      
      {/* Simulation Helper banner */}
      <div className="bg-slate-900 border-b border-slate-800 py-2.5 px-4 text-[11px] text-slate-350">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-1.5">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 bg-cyan-900/30 text-cyan-400 border border-cyan-805 rounded font-bold font-mono">
              ROLEPLAY SIMULATOR MODE
            </span>
            <span className="text-slate-450 text-slate-400">
              Switch roles using the portal buttons to test the cross-functional pipeline in real-time.
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button 
              onClick={() => setShowGuide(!showGuide)}
              className="text-slate-300 hover:text-white font-semibold flex items-center gap-1 cursor-pointer"
            >
              <HelpCircle className="h-3.5 w-3.5 text-blue-400" />
              <span>{showGuide ? 'Hide Instructions' : 'View Core Walkthrough'}</span>
            </button>
            <span className="text-slate-700">|</span>
            <button 
              onClick={handleResetData}
              className="text-slate-300 hover:text-rose-400 font-semibold flex items-center gap-1 cursor-pointer transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Reset State</span>
            </button>
          </div>
        </div>
      </div>

      {/* Guide walkthrough toggle display */}
      {showGuide && (
        <div className="bg-blue-50 border-b border-blue-105 p-4 text-[11px] text-blue-900 font-medium">
          <div className="max-w-7xl mx-auto flex gap-3.5">
            <Info className="h-5.5 w-5.5 text-blue-500 flex-shrink-0" />
            <div className="space-y-1">
              <p className="font-bold text-blue-955 text-blue-950 uppercase tracking-wide">Rapid Test Drive Walkthrough:</p>
              <ol className="list-decimal pl-4 space-y-1.5 mt-1 text-blue-800">
                <li>
                  Go to <strong className="text-slate-900">Production Eng.</strong> to release a new pool (e.g., P-1050 Sunset Villa) with specific orientation details.
                </li>
                <li>
                  Go to <strong className="text-slate-900">Stage Shop Floor</strong>, assign yourself to a team (e.g., Team 1), click <strong className="text-slate-900">Claim Task</strong> on your new pool, and click <strong className="text-slate-900">Start Stage Timer</strong>.
                </li>
                <li>
                  Click <strong className="text-slate-900">Complete & Request QA Signoff</strong> to pass the pool to Quality Assurance.
                </li>
                <li>
                  Switch to <strong className="text-slate-900">Quality Assurance</strong>, check the checklists, write feedback notes, and click <strong className="text-slate-900">Certify & Approve Stage</strong> to promote the pool to Stage 2 (Steel Primer).
                </li>
                <li>
                  Monitor the global matrix at the <strong className="text-slate-900">Factory Entrance TV</strong> or analyze performance trends on the <strong className="text-slate-900">Management Portal</strong>!
                </li>
              </ol>
            </div>
          </div>
        </div>
      )}

      {/* Primary navigation selector */}
      <RoleSelector
        currentRole={currentRole}
        selectedStageId={selectedStageId}
        onChangeRole={setCurrentRole}
        onChangeStage={handleStageChange}
        workerTeamId={workerTeamId}
        onChangeWorkerTeam={setWorkerTeamId}
        allTeams={teams}
        googleUser={googleUser}
        onGoogleSignIn={handleGoogleSignIn}
        onGoogleSignOut={handleGoogleSignOut}
      />

      {/* Central View Dashboard Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {currentRole === 'production_engineer' && (
          <ProductionEngineer
            pools={pools}
            onCreatePool={handleCreatePool}
            onCreatePoolBatch={handleCreatePoolBatch}
            engineers={engineers}
          />
        )}

        {currentRole === 'stage_worker' && (
          <StageDashboard
            stage={currentStageInfo}
            pools={pools}
            teams={teams}
            selectedTeamId={workerTeamId}
            onClaimPool={handleClaimPool}
            onStartStage={handleStartStage}
            onFinishStage={handleFinishStage}
            googleUser={googleUser}
            onGoogleSignIn={handleGoogleSignIn}
          />
        )}

        {currentRole === 'quality_inspector' && (
          <QualityInspector
            pools={pools}
            allTeams={teams}
            onApproveStage={handleApproveStage}
            onRejectStage={handleRejectStage}
            inspectors={inspectors}
            onDeletePool={handleDeletePool}
          />
        )}

        {currentRole === 'factory_entrance' && (
          <FactoryEntrance
            pools={pools}
          />
        )}

        {currentRole === 'management' && (
          <ManagementDashboard
            pools={pools}
            teams={teams}
            logs={logs}
            inspectors={inspectors}
            engineers={engineers}
            onUpdateTeams={handleUpdateTeams}
            onUpdateInspectors={handleUpdateInspectors}
            onUpdateEngineers={handleUpdateEngineers}
            onRenameProject={handleRenameProject}
            googleUser={googleUser}
            onGoogleSignIn={handleGoogleSignIn}
            onGoogleSignOut={handleGoogleSignOut}
            onRestoreState={handleRestoreState}
          />
        )}

        {currentRole === 'section_dashboard' && (
          <SectionDashboardTV
            pools={pools}
            teams={teams}
            logs={logs}
          />
        )}
      </main>

      {/* Simple Footer */}
      <footer className="bg-white border-t border-slate-100 py-6 text-center text-xs text-slate-400">
        <div className="max-w-7xl mx-auto px-4">
          <p>© 2026 MAT PLASTIC INDUSTRIES LLC. All Rights Reserved. • Powered by Flow Scheduling Engine</p>
        </div>
      </footer>

    </div>
  );
}
