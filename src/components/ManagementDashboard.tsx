import React, { useState, useEffect } from 'react';
import { Pool, StageId, Team, ActivityLog } from '../types';
import { STAGES } from '../data/mockData';
import { listDriveFiles, downloadFileFromDrive, deleteFileFromDrive, uploadToGoogleDrive } from '../lib/googleDrive';
import { 
  Search, Compass, Ruler, BarChart2, Users, FileSpreadsheet, 
  Layers, AlertCircle, Filter, Clock, TrendingUp, ThumbsDown, 
  ThumbsUp, SlidersHorizontal, ChevronLeft, ChevronRight, 
  Edit2, Plus, Trash2, UserPlus, Check, X, Briefcase, FolderPlus,
  ShieldCheck, ShieldAlert, Activity, Cloud, Loader2, CheckCircle2, HardDrive
} from 'lucide-react';

interface ManagementDashboardProps {
  pools: Pool[];
  teams: Team[];
  logs: ActivityLog[];
  onOverridePoolStage?: (poolId: string, deltaIndex: number) => void;
  inspectors?: { id: string; name: string; title: string }[];
  engineers?: { id: string; name: string; title: string }[];
  onUpdateTeams?: (updatedTeams: Team[]) => void;
  onUpdateInspectors?: (updatedInspectors: { id: string; name: string; title: string }[]) => void;
  onUpdateEngineers?: (updatedEngineers: { id: string; name: string; title: string }[]) => void;
  onRenameProject?: (oldName: string, newName: string) => void;
  googleUser?: any;
  onGoogleSignIn?: () => void;
  onGoogleSignOut?: () => void;
  onRestoreState?: (recovered: {
    pools: Pool[];
    teams: Team[];
    logs: ActivityLog[];
    inspectors?: { id: string; name: string; title: string }[];
    engineers?: { id: string; name: string; title: string }[];
  }) => void;
}

export const ManagementDashboard: React.FC<ManagementDashboardProps> = ({
  pools,
  teams,
  logs,
  inspectors = [],
  engineers = [],
  onUpdateTeams,
  onUpdateInspectors,
  onUpdateEngineers,
  onRenameProject,
  googleUser,
  onGoogleSignIn,
  onGoogleSignOut,
  onRestoreState,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPoolId, setSelectedPoolId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'analytics' | 'pools' | 'teams' | 'audit_logs' | 'workspace_setup' | 'google_drive'>('analytics');

  // Google Drive backup explorer states
  const [googleFiles, setGoogleFiles] = useState<any[]>([]);
  const [driveLoading, setDriveLoading] = useState(false);
  const [localBackupStatus, setLocalBackupStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [localBackupError, setLocalBackupError] = useState('');
  const [restoreStatus, setRestoreStatus] = useState<'idle' | 'restoring' | 'success' | 'error'>('idle');
  const [restoreMessage, setRestoreMessage] = useState('');

  const fetchGoogleDriveFiles = async () => {
    if (!googleUser) return;
    setDriveLoading(true);
    try {
      const files = await listDriveFiles();
      setGoogleFiles(files);
    } catch (err) {
      console.error('Error loading Google Drive files:', err);
    } finally {
      setDriveLoading(false);
    }
  };

  const handleCreateBackup = async () => {
    setLocalBackupStatus('saving');
    setLocalBackupError('');
    try {
      const payload = {
        pools,
        teams,
        logs,
        inspectors,
        engineers,
        backupTime: new Date().toISOString()
      };
      const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '_');
      const filename = `MAT_ERP_Backup_${timestamp}.json`;
      await uploadToGoogleDrive(filename, JSON.stringify(payload, null, 2), 'application/json');
      setLocalBackupStatus('success');
      fetchGoogleDriveFiles();
      setTimeout(() => setLocalBackupStatus('idle'), 3000);
    } catch (err: any) {
      console.error(err);
      setLocalBackupStatus('error');
      setLocalBackupError(err.message || 'Unknown network error');
    }
  };

  const handleRestoreBackup = async (fileId: string) => {
    if (!window.confirm("WARNING: Restoring database state will replace all current in-memory pools, logs, and team configurations. Do you want to continue?")) {
      return;
    }
    setRestoreStatus('restoring');
    setRestoreMessage('');
    try {
      const fileText = await downloadFileFromDrive(fileId);
      const parsed = JSON.parse(fileText);
      if (!parsed.pools || !parsed.teams || !parsed.logs) {
        throw new Error("Invalid backup file schema: Missing critical collections.");
      }
      if (onRestoreState) {
        onRestoreState(parsed);
      }
      setRestoreStatus('success');
      setRestoreMessage("Database state successfully synchronized!");
      setTimeout(() => {
        setRestoreStatus('idle');
        setRestoreMessage('');
      }, 4000);
    } catch (err: any) {
      console.error(err);
      setRestoreStatus('error');
      setRestoreMessage(err.message || 'Failed to parse JSON backup payload.');
    }
  };

  const handleDeleteBackup = async (fileId: string, fileName: string) => {
    if (!window.confirm(`Are you absolutely sure you want to delete "${fileName}" permanently from your Google Drive folder?`)) {
      return;
    }
    try {
      await deleteFileFromDrive(fileId);
      fetchGoogleDriveFiles();
    } catch (err: any) {
      alert("Failed to delete backup: " + err.message);
    }
  };

  useEffect(() => {
    if (activeTab === 'google_drive' && googleUser) {
      fetchGoogleDriveFiles();
    }
  }, [activeTab, googleUser]);
  
  // Date selection filter states
  const [startDateStr, setStartDateStr] = useState('');
  const [endDateStr, setEndDateStr] = useState('');

  // Setup directory states
  const [newInspectorName, setNewInspectorName] = useState('');
  const [newInspectorTitle, setNewInspectorTitle] = useState('');
  const [editingInspectorId, setEditingInspectorId] = useState<string | null>(null);
  const [editInspectorName, setEditInspectorName] = useState('');
  const [editInspectorTitle, setEditInspectorTitle] = useState('');

  const [newEngineerName, setNewEngineerName] = useState('');
  const [newEngineerTitle, setNewEngineerTitle] = useState('');
  const [editingEngineerId, setEditingEngineerId] = useState<string | null>(null);
  const [editEngineerName, setEditEngineerName] = useState('');
  const [editEngineerTitle, setEditEngineerTitle] = useState('');

  // Teams stage select inside Setup
  const [setupStageFilter, setSetupStageFilter] = useState<StageId>('steel_fabrication');
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editTeamName, setEditTeamName] = useState('');

  // Projects renaming states
  const [editingProjectName, setEditingProjectName] = useState<string | null>(null);
  const [newProjectNameValue, setNewProjectNameValue] = useState('');
  
  // Custom states for high capacity managing 100+ pools across concurrent projects
  const [selectedProjectFilter, setSelectedProjectFilter] = useState<string>('ALL');
  const [poolsPage, setPoolsPage] = useState(1);
  const poolsPerPage = 7;

  // Filter pools by date range before calculating statistics and other listings
  const dateFilteredPools = pools.filter((p) => {
    if (startDateStr) {
      const start = new Date(startDateStr);
      start.setHours(0, 0, 0, 0);
      if (new Date(p.createdAt) < start) {
        return false;
      }
    }
    if (endDateStr) {
      const end = new Date(endDateStr);
      end.setHours(23, 59, 59, 999);
      if (new Date(p.createdAt) > end) {
        return false;
      }
    }
    return true;
  });
  
  // High-level statistics
  const totalPools = dateFilteredPools.length;
  const activePools = dateFilteredPools.filter(p => p.currentStageIndex < 7);
  const completedPools = dateFilteredPools.filter(p => p.currentStageIndex >= 7);
  
  // Total rejections
  const totalRejections = dateFilteredPools.reduce((acc, pool) => {
    return acc + (Object.values(pool.stageHistory) as any[]).reduce((sum, h) => sum + (h.rejectionCount || 0), 0);
  }, 0);

  // Action Handlers for Setup Directory
  const handleAddNewInspector = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newInspectorName.trim()) return;
    const newInsp = {
      id: `insp_${Date.now()}`,
      name: newInspectorName.trim(),
      title: newInspectorTitle.trim() || 'Quality Inspector',
    };
    onUpdateInspectors?.([...inspectors, newInsp]);
    setNewInspectorName('');
    setNewInspectorTitle('');
  };

  const handleStartEditInspector = (insp: { id: string; name: string; title: string }) => {
    setEditingInspectorId(insp.id);
    setEditInspectorName(insp.name);
    setEditInspectorTitle(insp.title);
  };

  const handleSaveInspector = (id: string) => {
    if (!editInspectorName.trim()) return;
    const updated = inspectors.map(i => i.id === id ? { ...i, name: editInspectorName.trim(), title: editInspectorTitle.trim() } : i);
    onUpdateInspectors?.(updated);
    setEditingInspectorId(null);
  };

  const handleDeleteInspector = (id: string) => {
    if (inspectors.length <= 1) {
      alert('Cannot delete the last remaining inspector. The system needs at least one inspector.');
      return;
    }
    const filtered = inspectors.filter(i => i.id !== id);
    onUpdateInspectors?.(filtered);
  };

  const handleAddNewEngineer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEngineerName.trim()) return;
    const newEng = {
      id: `eng_${Date.now()}`,
      name: newEngineerName.trim(),
      title: newEngineerTitle.trim() || 'Production Engineer',
    };
    onUpdateEngineers?.([...engineers, newEng]);
    setNewEngineerName('');
    setNewEngineerTitle('');
  };

  const handleStartEditEngineer = (eng: { id: string; name: string; title: string }) => {
    setEditingEngineerId(eng.id);
    setEditEngineerName(eng.name);
    setEditEngineerTitle(eng.title);
  };

  const handleSaveEngineer = (id: string) => {
    if (!editEngineerName.trim()) return;
    const updated = engineers.map(e => e.id === id ? { ...e, name: editEngineerName.trim(), title: editEngineerTitle.trim() } : e);
    onUpdateEngineers?.(updated);
    setEditingEngineerId(null);
  };

  const handleDeleteEngineer = (id: string) => {
    if (engineers.length <= 1) {
      alert('Cannot delete the last remaining engineer. The system needs at least one engineer.');
      return;
    }
    const filtered = engineers.filter(e => e.id !== id);
    onUpdateEngineers?.(filtered);
  };

  const handleStartEditTeam = (team: Team) => {
    setEditingTeamId(team.id);
    setEditTeamName(team.name);
  };

  const handleSaveTeamName = (id: string) => {
    if (!editTeamName.trim()) return;
    const updated = teams.map(t => t.id === id ? { ...t, name: editTeamName.trim() } : t);
    onUpdateTeams?.(updated);
    setEditingTeamId(null);
  };

  const handleRenameProjectSubmit = (oldName: string) => {
    if (!newProjectNameValue.trim() || oldName === newProjectNameValue) {
      setEditingProjectName(null);
      return;
    }
    onRenameProject?.(oldName, newProjectNameValue.trim());
    setEditingProjectName(null);
    setNewProjectNameValue('');
  };

  // Get all unique projects currently registered
  const uniqueProjectsList = Array.from(new Set(dateFilteredPools.map(p => p.projectName))).filter(Boolean) as string[];

  // Filtered pools by project selection and text query
  const filteredPools = dateFilteredPools.filter((p) => {
    const matchesProject = selectedProjectFilter === 'ALL' || p.projectName === selectedProjectFilter;
    const matchesSearch = 
      p.projectName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.poolNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.shape.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesProject && matchesSearch;
  });

  const totalPoolsPages = Math.ceil(filteredPools.length / poolsPerPage) || 1;
  const paginatedPools = filteredPools.slice(
    (poolsPage - 1) * poolsPerPage,
    poolsPage * poolsPerPage
  );

  const selectedPool = dateFilteredPools.find(p => p.id === selectedPoolId) || filteredPools[0] || dateFilteredPools[0];

  // Calculate workloads for each stage
  const stageStats = STAGES.map((stage) => {
    const stagePools = dateFilteredPools.filter(p => {
      const hist = p.stageHistory[stage.id];
      return hist && hist.status !== 'NOT_STARTED';
    });

    const rejectCount = dateFilteredPools.reduce((acc, p) => {
      return acc + (p.stageHistory[stage.id]?.rejectionCount || 0);
    }, 0);

    const totalDuration = stagePools.reduce((acc, p) => {
      const dur = p.stageHistory[stage.id]?.durationMinutes || 0;
      return acc + dur;
    }, 0);

    const avgDuration = stagePools.filter(p => p.stageHistory[stage.id]?.status === 'APPROVED').length > 0
      ? Math.round(totalDuration / stagePools.filter(p => p.stageHistory[stage.id]?.status === 'APPROVED').length)
      : 0;

    return {
      stage,
      activeCount: dateFilteredPools.filter(p => p.currentStageIndex === STAGES.findIndex(s => s.id === stage.id)).length,
      rejections: rejectCount,
      avgDuration,
    };
  });

  return (
    <div className="space-y-6">
      
      {/* Date Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-50 text-indigo-600 p-2.5 rounded-lg border border-indigo-100">
            <Clock className="h-5 w-5" />
          </div>
          <div>
            <span className="text-xs font-black text-slate-800 uppercase tracking-wider block">Shop Floor Date Range</span>
            <span className="text-[10.5px] text-slate-400 font-medium font-sans">Filters statistics & pool listings by production release date</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-550 font-semibold text-slate-600">From:</span>
            <input
              type="date"
              value={startDateStr}
              onChange={(e) => {
                setStartDateStr(e.target.value);
                setPoolsPage(1); // reset pagination
              }}
              className="bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-lg px-2.5 py-1.5 font-sans font-semibold text-slate-800 focus:outline-hidden focus:ring-1 focus:ring-indigo-500 cursor-pointer text-xs"
            />
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-550 font-semibold text-slate-600">To:</span>
            <input
              type="date"
              value={endDateStr}
              onChange={(e) => {
                setEndDateStr(e.target.value);
                setPoolsPage(1); // reset pagination
              }}
              className="bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-lg px-2.5 py-1.5 font-sans font-semibold text-slate-800 focus:outline-hidden focus:ring-1 focus:ring-indigo-500 cursor-pointer text-xs"
            />
          </div>

          {(startDateStr || endDateStr) && (
            <button
              type="button"
              onClick={() => {
                setStartDateStr('');
                setEndDateStr('');
                setPoolsPage(1);
              }}
              className="bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold text-[10px] uppercase tracking-wide border border-rose-100 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* KPI Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4">
          <div className="bg-blue-50 p-3.5 rounded-xl border border-blue-105 text-blue-600">
            <Layers className="h-5 w-5" />
          </div>
          <div>
            <span className="block text-2xl font-black text-slate-800 font-mono">{activePools.length}</span>
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wide">Active In Fabrication</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4">
          <div className="bg-emerald-50 p-3.5 rounded-xl border border-emerald-100 text-emerald-600">
            <TrendingUp className="h-5 w-5" />
          </div>
          <div>
            <span className="block text-2xl font-black text-slate-800 font-mono">{completedPools.length}</span>
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wide">Despatched & Clear</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4">
          <div className="bg-rose-50 p-3.5 rounded-xl border border-rose-100 text-rose-600">
            <ThumbsDown className="h-5 w-5" />
          </div>
          <div>
            <span className="block text-2xl font-black text-slate-800 font-mono">{totalRejections}</span>
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wide">Total Rework holds</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4">
          <div className="bg-purple-50 p-3.5 rounded-xl border border-purple-105 text-purple-600">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <span className="block text-2xl font-black text-slate-800 font-mono">
              {teams.filter(t => t.status === 'BUSY').length} / {teams.length}
            </span>
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wide">Assigned Teams Rate</span>
          </div>
        </div>

      </div>

      {/* Live Operations & Quality Summary section */}
      <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200/60 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-indigo-600 animate-pulse" />
            <span className="text-sm font-black text-slate-800 uppercase tracking-wider">Real-Time Factory Summary & Bottleneck KPIs</span>
          </div>
          <span className="text-[10px] font-mono text-slate-400 bg-white border border-slate-200/50 px-2 py-0.5 rounded uppercase font-bold shadow-xs">Live Status Feed</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 font-sans">
          
          {/* Card 1: Total Active Pools */}
          <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-xs flex flex-col justify-between space-y-3.5">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Operational Workload</span>
                <span className="text-xl font-black text-slate-800 font-mono tracking-tight">{activePools.length} Active Pools</span>
              </div>
              <div className="bg-indigo-50 text-indigo-600 p-2.5 rounded-lg border border-indigo-100">
                <Layers className="h-4.5 w-4.5" />
              </div>
            </div>

            <div className="space-y-2">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Stage Distribution:</span>
              <div className="space-y-1.5 max-h-[120px] overflow-y-auto pr-1">
                {stageStats.map(s => {
                  const stageIndex = STAGES.findIndex(st => st.id === s.stage.id);
                  const activeCount = pools.filter(p => p.currentStageIndex === stageIndex).length;
                  return (
                    <div key={s.stage.id} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="h-2 w-2 rounded-full inline-block shrink-0" style={{ backgroundColor: s.stage.color }} />
                        <span className="font-medium text-slate-600 truncate">{s.stage.name}</span>
                      </div>
                      <span className="font-mono font-bold text-slate-800 bg-slate-50 border border-slate-100 px-1.5 py-0.2 rounded shrink-0">
                        {activeCount} {activeCount === 1 ? 'pool' : 'pools'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Card 2: Average Stage Cycle Time */}
          <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-xs flex flex-col justify-between space-y-3.5">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Line Velocity</span>
                <span className="text-xl font-black text-slate-800 font-mono tracking-tight">Cycle Times Per Stage</span>
              </div>
              <div className="bg-blue-50 text-blue-600 p-2.5 rounded-lg border border-blue-100">
                <Clock className="h-4.5 w-4.5" />
              </div>
            </div>

            <div className="space-y-2">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">Average Duration Track:</span>
              <div className="space-y-1.5 max-h-[120px] overflow-y-auto pr-1">
                {stageStats.map(s => (
                  <div key={s.stage.id} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 truncate">
                      <span className="h-2 w-2 rounded-full inline-block shrink-0" style={{ backgroundColor: s.stage.color }} />
                      <span className="font-medium text-slate-600 truncate">{s.stage.name}</span>
                    </div>
                    {s.avgDuration > 0 ? (
                      <span className="font-mono font-bold text-emerald-600 bg-emerald-50 border border-emerald-100 px-1.5 py-0.2 rounded shrink-0">
                        {s.avgDuration}m
                      </span>
                    ) : (
                      <span className="font-mono text-[10px] text-slate-400 italic shrink-0">
                        no data
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Card 3: Pending Inspections Gate */}
          <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-xs flex flex-col justify-between space-y-3.5">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Quality Sign-Offs</span>
                <span className="text-xl font-black text-amber-700 font-mono tracking-tight">
                  {pools.filter(p => {
                    if (p.currentStageIndex >= STAGES.length) return false;
                    const currentStageId = STAGES[p.currentStageIndex].id;
                    return p.stageHistory[currentStageId]?.status === 'PENDING_INSPECTION';
                  }).length} Pending QA
                </span>
              </div>
              <div className="bg-amber-50 text-amber-600 p-2.5 rounded-lg border border-amber-100">
                <ShieldAlert className="h-4.5 w-4.5" />
              </div>
            </div>

            <div className="space-y-2">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Active Quality Backlog:</span>
              <div className="space-y-1.5 max-h-[120px] overflow-y-auto pr-1">
                {pools.filter(p => {
                  if (p.currentStageIndex >= STAGES.length) return false;
                  const currentStageId = STAGES[p.currentStageIndex].id;
                  return p.stageHistory[currentStageId]?.status === 'PENDING_INSPECTION';
                }).length > 0 ? (
                  pools.filter(p => {
                    if (p.currentStageIndex >= STAGES.length) return false;
                    const currentStageId = STAGES[p.currentStageIndex].id;
                    return p.stageHistory[currentStageId]?.status === 'PENDING_INSPECTION';
                  }).map(p => {
                    const currentStageName = STAGES[p.currentStageIndex]?.name || 'Unknown';
                    const currentStageColor = STAGES[p.currentStageIndex]?.color || '#cbd5e1';
                    return (
                      <div key={p.id} className="text-xs p-1.5 bg-amber-50/40 border border-amber-100/50 rounded-lg flex flex-col space-y-0.5">
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-slate-700 font-mono text-[10px] bg-white border px-1 rounded">
                            {p.poolNo}
                          </span>
                          <span className="text-[9px] font-bold px-1.5 py-0.2 rounded text-white" style={{ backgroundColor: currentStageColor }}>
                            {currentStageName}
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-500 truncate block font-medium">
                          {p.projectName}
                        </span>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-center py-5 my-auto">
                    <ShieldCheck className="h-7 w-7 text-emerald-400 mx-auto mb-1" />
                    <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wide block">All Sign-offs Clear</span>
                    <span className="text-[9px] text-slate-400 font-medium font-sans">No pools are currently jammed in QA checks.</span>
                  </div>
                )}
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Tabs navigation */}
      <div className="bg-white rounded-2xl border border-slate-100 p-1.5 shadow-sm flex gap-1">
        <button
          onClick={() => setActiveTab('analytics')}
          className={`flex-1 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
            activeTab === 'analytics' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <BarChart2 className="h-4 w-4" />
          Analytics / Bottlenecks
        </button>

        <button
          onClick={() => setActiveTab('pools')}
          className={`flex-1 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
            activeTab === 'pools' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <Layers className="h-4 w-4" />
          Pools Register Tracking
        </button>

        <button
          onClick={() => setActiveTab('teams')}
          className={`flex-1 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
            activeTab === 'teams' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <Users className="h-4 w-4" />
          Teams Allocation
        </button>

        <button
          onClick={() => setActiveTab('audit_logs')}
          className={`flex-1 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
            activeTab === 'audit_logs' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <FileSpreadsheet className="h-4 w-4" />
          Audit Dispatch Ledger
        </button>

        <button
          onClick={() => setActiveTab('workspace_setup')}
          className={`flex-1 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
            activeTab === 'workspace_setup' ? 'bg-indigo-900 text-white shadow-md' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <SlidersHorizontal className="h-4 w-4 text-indigo-400" />
          Workspace Setup & Names
        </button>

        <button
          onClick={() => setActiveTab('google_drive')}
          className={`flex-1 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
            activeTab === 'google_drive' ? 'bg-cyan-900 text-cyan-200 shadow-md' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <Cloud className="h-4 w-4 text-cyan-500" />
          Google Drive Backups
        </button>
      </div>

      {/* Panels viewport */}
      <div className="grid grid-cols-1 gap-6">

        {/* Tab 1: Analytics/Summary Dashboard */}
        {activeTab === 'analytics' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* Custom stage statistics bento card bar charts */}
            <div className="lg:col-span-8 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
              <h3 className="text-sm font-black text-slate-500 uppercase tracking-widest border-b border-slate-50 pb-2 flex items-center gap-1.5">
                <BarChart2 className="h-4.5 w-4.5 text-blue-500" />
                Line Section Throughput & Efficiency
              </h3>

              <div className="space-y-4 pt-2">
                {stageStats.map(({ stage, activeCount, rejections, avgDuration }) => (
                  <div key={stage.id} className="space-y-1.5">
                    <div className="flex justify-between items-center text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-full inline-block" style={{ backgroundColor: stage.color }} />
                        <span className="font-bold text-slate-800">{stage.name}</span>
                      </div>
                      <div className="text-slate-550 text-slate-500 flex gap-4">
                        <span>Current Active: <strong className="text-slate-800">{activeCount}</strong></span>
                        <span>Avg (Min): <strong className="text-slate-800">{avgDuration || '—'}</strong></span>
                        <span>Rejections: <strong className="text-rose-600">{rejections}</strong></span>
                      </div>
                    </div>
                    
                    {/* Visual Bar */}
                    <div className="h-3 bg-slate-100 rounded-full overflow-hidden flex">
                      <div 
                        className="h-full rounded-l"
                        style={{ 
                          backgroundColor: stage.color, 
                          width: `${totalPools > 0 ? (activeCount / totalPools) * 100 : 0}%`,
                          minWidth: activeCount > 0 ? '4px' : '0px'
                        }}
                      />
                      {rejections > 0 && (
                        <div 
                          className="h-full bg-rose-400"
                          style={{ 
                            width: `${totalPools > 0 ? (rejections / totalPools) * 15 : 0}%`,
                            minWidth: '4px'
                          }}
                          title={`Fail Rate Area: ${rejections} total rework flags`}
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Side summary panel */}
            <div className="lg:col-span-4 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
              <h3 className="text-sm font-black text-slate-500 uppercase tracking-widest border-b border-slate-50 pb-2">
                Factory Health Index
              </h3>

              <div className="space-y-4 divide-y divide-slate-50 pt-2">
                
                <div className="pb-3 flex justify-between items-center">
                  <div className="space-y-0.5">
                    <span className="text-xs font-bold text-slate-800">Quality Inspection Rate</span>
                    <span className="text-[10px] text-slate-400 block">Ratio of passes vs rework holds</span>
                  </div>
                  <div className="text-right">
                    <span className="text-xl font-black text-emerald-600 font-mono">
                      {totalRejections === 0 ? '100%' : `${Math.round(((totalPools + 2) / (totalPools + totalRejections + 2)) * 100)}%`}
                    </span>
                  </div>
                </div>

                <div className="py-3 flex justify-between items-center">
                  <div className="space-y-0.5">
                    <span className="text-xs font-bold text-slate-800">Backlog Rate</span>
                    <span className="text-[10px] text-slate-400 block">Pools in early structural stages</span>
                  </div>
                  <div className="text-right">
                    <span className="text-xl font-black text-amber-600 font-mono">
                      {pools.length > 0 ? `${Math.round((pools.filter(p => p.currentStageIndex <= 2).length / pools.length) * 100)}%` : '0%'}
                    </span>
                  </div>
                </div>

                <div className="py-3 flex justify-between items-center">
                  <div className="space-y-0.5">
                    <span className="text-xs font-bold text-slate-800">Critical Stage Blockages</span>
                    <span className="text-[10px] text-slate-450 block text-slate-400">Stages with over 2 rejections</span>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-black text-rose-500 font-mono tracking-wider bg-rose-50 px-2.5 py-1 rounded border border-rose-100 uppercase">
                      {stageStats.some(s => s.rejections > 1) ? 'PLUMBING' : 'HEALTHY'}
                    </span>
                  </div>
                </div>

              </div>
            </div>

          </div>
        )}

        {/* Tab 2: Pools Registry Tracker */}
        {activeTab === 'pools' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* Left selector col */}
            <div className="lg:col-span-12 xl:col-span-5 bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col h-[600px] justify-between">
              <div>
                
                {/* Search & Project Filter cluster */}
                <div className="space-y-2 mb-4">
                  
                  {/* Search bar */}
                  <div className="relative">
                    <Search className="absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Search project name or pool ID..."
                      value={searchTerm}
                      onChange={(e) => {
                        setSearchTerm(e.target.value);
                        setPoolsPage(1);
                        if (filteredPools.length > 0) {
                          setSelectedPoolId(filteredPools[0].id);
                        }
                      }}
                      className="w-full pl-9 pr-4 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                  </div>

                  {/* Project Selector filter */}
                  <div className="flex items-center gap-2">
                    <SlidersHorizontal className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                    <select
                      value={selectedProjectFilter}
                      onChange={(e) => {
                        setSelectedProjectFilter(e.target.value);
                        setPoolsPage(1);
                        const matched = pools.filter(p => e.target.value === 'ALL' || p.projectName === e.target.value);
                        if (matched.length > 0) {
                          setSelectedPoolId(matched[0].id);
                        }
                      }}
                      className="w-full text-xs bg-slate-50 border border-slate-200 text-slate-700 px-2 py-1.5 rounded-lg font-semibold outline-none focus:border-slate-300"
                    >
                      <option value="ALL">All Active Projects ({uniqueProjectsList.length})</option>
                      {uniqueProjectsList.map(proj => (
                        <option key={proj} value={proj}>{proj}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Paginated list */}
                <div className="space-y-1.5 max-h-[380px] overflow-y-auto">
                  {paginatedPools.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-10">No matching pool registrations.</p>
                  ) : (
                    paginatedPools.map((pool) => {
                      const isSelected = pool.id === selectedPoolId || (!selectedPoolId && pool.id === pools[0]?.id);
                      const currentStage = STAGES[pool.currentStageIndex];

                      return (
                        <button
                          key={pool.id}
                          onClick={() => setSelectedPoolId(pool.id)}
                          className={`w-full text-left p-3 rounded-xl border cursor-pointer block transition-all ${
                            isSelected
                              ? 'border-slate-900 bg-slate-900 text-white shadow-md'
                              : 'border-slate-100 hover:border-slate-205 hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex justify-between items-center text-[11px]">
                            <span className={`font-mono font-black text-[10px] px-1.5 py-0.5 rounded ${
                              isSelected ? 'bg-slate-800 text-teal-400' : 'bg-slate-100 text-slate-500'
                            }`}>
                              {pool.poolNo}
                            </span>
                            <span className={`text-[9.5px] font-bold ${
                              isSelected ? 'text-slate-300' : 'text-slate-500'
                            }`}>
                              {currentStage ? currentStage.name : 'Completed & Dispatched'}
                            </span>
                          </div>
                          <h4 className="text-xs font-extrabold mt-1.5 tracking-tight truncate">{pool.projectName}</h4>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Simple Pagination controls for heavy-load project tracking */}
              {totalPoolsPages > 1 && (
                <div className="flex items-center justify-between border-t border-slate-150 pt-3 text-xs">
                  <span className="text-slate-400 font-medium">
                    Showing {paginatedPools.length} of {filteredPools.length} shells
                  </span>
                  <div className="flex gap-1">
                    <button
                      disabled={poolsPage === 1}
                      onClick={() => setPoolsPage(prev => Math.max(1, prev - 1))}
                      className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    <span className="px-2 py-1 bg-slate-100 font-bold rounded text-[11px] text-slate-700 min-w-[30px] text-center font-mono">
                      {poolsPage}/{totalPoolsPages}
                    </span>
                    <button
                      disabled={poolsPage === totalPoolsPages}
                      onClick={() => setPoolsPage(prev => Math.min(totalPoolsPages, prev + 1))}
                      className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Right details panel (Detailed breakdown of selected pool) */}
            <div className="lg:col-span-7 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm min-h-[600px]">
              {selectedPool ? (
                <div className="space-y-6">
                  
                  {/* Title metadata block */}
                  <div className="border-b border-slate-100 pb-4">
                    <span className="font-mono text-xs font-black text-cyan-600 bg-cyan-50 px-2.5 py-0.5 border border-cyan-100 rounded">
                      {selectedPool.poolNo}
                    </span>
                    <h3 className="text-lg font-black text-slate-900 mt-2 tracking-tight">
                      {selectedPool.projectName}
                    </h3>
                    
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-4 text-xs">
                      <div>
                        <span className="text-slate-400 block font-bold">Orientation</span>
                        <strong className="text-slate-700 flex items-center gap-1 mt-0.5">
                          <Compass className="h-4 w-4 text-amber-500" />
                          {selectedPool.orientation}
                        </strong>
                      </div>
                      <div>
                        <span className="text-slate-400 block font-bold">Base Dimensions</span>
                        <strong className="text-slate-700 flex items-center gap-1 mt-0.5">
                          <Ruler className="h-4 w-4 text-blue-500" />
                          {selectedPool.dimensions}
                        </strong>
                      </div>
                      <div>
                        <span className="text-slate-400 block font-bold">Curvature Shape</span>
                        <strong className="text-slate-700 mt-0.5 block truncate">
                          {selectedPool.shape}
                        </strong>
                      </div>
                      <div>
                        <span className="text-slate-400 block font-bold">Release Timestamp</span>
                        <strong className="text-slate-500 mt-0.5 block truncate font-mono text-[10px]">
                          {new Date(selectedPool.createdAt).toLocaleDateString()}
                        </strong>
                      </div>
                    </div>
                  </div>

                  {/* Complete Historical Trace Steps logs */}
                  <div className="space-y-4">
                    <h4 className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-1">
                      <Layers className="h-4 w-4" />
                      Stage Clearance Progress Ledger
                    </h4>

                    <div className="space-y-5 relative pl-4 before:absolute before:inset-y-1 before:left-1.5 before:w-[1px] before:bg-slate-100">
                      {STAGES.map((stage, idx) => {
                        const hist = selectedPool.stageHistory[stage.id];
                        const isActive = selectedPool.currentStageIndex === idx;
                        const isApproved = hist && hist.status === 'APPROVED';
                        const isRework = hist && hist.status === 'REJECTED';
                        
                        let dotColor = 'bg-slate-205 bg-slate-200 border-slate-300';
                        if (isApproved) dotColor = 'bg-emerald-500 border-emerald-600 shadow-sm shadow-emerald-500/40';
                        else if (isActive) dotColor = 'bg-blue-500 border-blue-600 animate-pulse shadow-sm shadow-blue-500/40';
                        else if (isRework) dotColor = 'bg-rose-500 border-rose-600';

                        return (
                          <div key={stage.id} className="relative flex flex-col md:flex-row md:items-start justify-between gap-2 text-xs">
                            <span className={`absolute -left-4.5 mt-1 h-3 w-3 rounded-full border-2 ${dotColor}`} />
                            
                            <div className="space-y-1 md:max-w-xs">
                              <h5 className="font-bold text-slate-900 flex items-center gap-1.5">
                                {stage.name}
                                {isActive && <span className="bg-blue-100 text-blue-800 text-[9px] font-bold px-1.5 py-0.2 rounded font-mono animate-pulse">Floor Active</span>}
                              </h5>
                              <p className="text-[11px] text-slate-505 text-slate-500 font-medium">
                                status: <strong className="text-slate-700">{hist ? hist.status : 'NOT_STARTED'}</strong>
                                {hist?.rejectionCount > 0 && <span className="text-rose-600 font-bold ml-2">({hist.rejectionCount} rework loops)</span>}
                              </p>
                              {hist?.startTime && (
                                <p className="text-[10px] text-slate-400 font-mono">
                                  Time frame: {new Date(hist.startTime).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 
                                  {hist.endTime ? ` → ${new Date(hist.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ' (Ongoing)'}
                                </p>
                              )}
                            </div>

                            <div className="text-right text-[11px] bg-slate-50 border border-slate-100 p-2 rounded-lg md:min-w-[180px]">
                              {hist && hist.status !== 'NOT_STARTED' ? (
                                <div className="space-y-1">
                                  <p className="font-semibold text-slate-700">Team: {teams.find(t => t.id === hist.teamId)?.name || hist.teamId}</p>
                                  {hist.durationMinutes && (
                                    <p className="text-[10px] text-slate-400 font-mono">Duration: {hist.durationMinutes} minutes</p>
                                  )}
                                  {hist.inspectorId && (
                                    <div className="border-t border-slate-200/50 pt-1 mt-1 font-sans text-slate-500 text-[10.5px]">
                                      <p className="font-bold text-emerald-700">QC signed: {hist.inspectorId}</p>
                                      <p className="italic text-[9.5px] line-clamp-2">&quot;{hist.inspectorNotes}&quot;</p>
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span className="text-slate-400 italic">No activity logged</span>
                              )}
                            </div>

                          </div>
                        );
                      })}
                    </div>
                  </div>

                </div>
              ) : (
                <div className="py-24 text-center">
                  <span className="text-xs text-slate-400">Select a pool to inspect historical details</span>
                </div>
              )}
            </div>

          </div>
        )}

        {/* Tab 3: Teams Status Allocation */}
        {activeTab === 'teams' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {STAGES.map((stage) => {
              const stageTeams = teams.filter(t => t.stageId === stage.id);
              return (
                <div key={stage.id} className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col justify-between">
                  <div>
                    <div className="pb-2 border-b border-slate-51 border-slate-100 mb-3 flex items-center justify-between">
                      <h4 className="text-xs font-black text-slate-800 flex items-center gap-1.5 uppercase">
                        <span className="h-2 w-2 rounded-full inline-block" style={{ backgroundColor: stage.color }} />
                        {stage.name}
                      </h4>
                      <span className="text-[10px] font-bold text-slate-400 font-mono">
                        {stageTeams.length} Teams
                      </span>
                    </div>

                    <div className="space-y-2">
                      {stageTeams.map((team) => {
                        const busyPool = team.activePoolId ? pools.find(p => p.id === team.activePoolId) : null;
                        return (
                          <div key={team.id} className="p-2 border border-slate-50 hover:bg-slate-50/55 rounded-lg text-xs">
                            <div className="flex justify-between items-center font-bold">
                              <span className="text-slate-800">{team.name}</span>
                              <span className={`text-[9px] px-1.5 rounded-full font-black ${
                                team.status === 'IDLE' ? 'bg-emerald-50 border border-emerald-100 text-emerald-700' : 'bg-amber-50 border border-amber-100 text-amber-750 text-amber-700'
                              }`}>
                                {team.status}
                              </span>
                            </div>
                            {busyPool && (
                              <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-400 font-mono">
                                <span className="truncate max-w-[100px]">Pool: {busyPool.projectName}</span>
                                <span>No: {busyPool.poolNo}</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Tab 4: Dispatch Logs ledger */}
        {activeTab === 'workspace_setup' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-fadeIn">
            
            {/* Left Hand: Inspectors & Engineers */}
            <div className="lg:col-span-6 space-y-6">
              
              {/* Quality Inspectors Control Panel */}
              <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4">
                <div className="border-b border-slate-100 pb-2 flex items-center justify-between">
                  <h3 className="text-sm font-black text-slate-700 tracking-wider flex items-center gap-2 uppercase">
                    <ShieldCheck className="h-5 w-5 text-indigo-500" />
                    Quality Control Inspectors
                  </h3>
                  <span className="text-[10px] uppercase font-mono px-2 py-0.5 bg-slate-50 text-slate-500 rounded font-black">
                    {inspectors.length} active
                  </span>
                </div>
                
                {/* List of current inspectors */}
                <div className="space-y-3 max-h-[220px] overflow-y-auto pr-1">
                  {inspectors.map((insp) => (
                    <div key={insp.id} className="flex items-center justify-between p-3 bg-slate-50 border border-slate-100 rounded-xl text-xs">
                      {editingInspectorId === insp.id ? (
                        <div className="flex-1 grid grid-cols-2 gap-2 mr-2">
                          <input
                            type="text"
                            value={editInspectorName}
                            onChange={(e) => setEditInspectorName(e.target.value)}
                            className="bg-white border border-slate-200 px-2 py-1 rounded"
                            placeholder="Name"
                          />
                          <input
                            type="text"
                            value={editInspectorTitle}
                            onChange={(e) => setEditInspectorTitle(e.target.value)}
                            className="bg-white border border-slate-200 px-2 py-1 rounded"
                            placeholder="Title/Dept"
                          />
                        </div>
                      ) : (
                        <div>
                          <p className="font-bold text-slate-805 text-slate-800">{insp.name}</p>
                          <p className="text-[10px] text-slate-400 font-medium">{insp.title}</p>
                        </div>
                      )}
                      
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {editingInspectorId === insp.id ? (
                          <>
                            <button
                              onClick={() => handleSaveInspector(insp.id)}
                              className="p-1 px-2.5 bg-emerald-600 text-white rounded font-bold hover:bg-emerald-700 text-[10px] cursor-pointer"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingInspectorId(null)}
                              className="p-1 px-2.5 bg-slate-200 text-slate-700 rounded font-bold hover:bg-slate-300 text-[10px] cursor-pointer"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => handleStartEditInspector(insp)}
                              className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-200/50 rounded transition-colors cursor-pointer"
                              title="Edit Credentials"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteInspector(insp.id)}
                              className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-55 hover:bg-rose-50 border border-transparent rounded transition-colors cursor-pointer"
                              title="Delete Inspector"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Inline form to append inspector */}
                <form onSubmit={handleAddNewInspector} className="pt-3 border-t border-slate-100 space-y-2.5">
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Register New Quality Inspector</p>
                  <div className="grid grid-cols-2 gap-2.5">
                    <input
                      type="text"
                      required
                      placeholder="e.g. Insp. Kevin S."
                      value={newInspectorName}
                      onChange={(e) => setNewInspectorName(e.target.value)}
                      className="w-full bg-white border border-slate-200 text-xs px-3 py-2 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <input
                      type="text"
                      placeholder="e.g. Mosaic QA Specialist"
                      value={newInspectorTitle}
                      onChange={(e) => setNewInspectorTitle(e.target.value)}
                      className="w-full bg-white border border-slate-200 text-xs px-3 py-2 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full bg-slate-950 text-white font-bold text-xs py-2 px-4 rounded-xl flex items-center justify-center gap-1.5 hover:bg-slate-900 transition-colors uppercase tracking-wider cursor-pointer font-sans"
                  >
                    <UserPlus className="h-3.5 w-3.5 text-indigo-400" />
                    Add Inspector to Registry
                  </button>
                </form>
              </div>

              {/* Production Engineers Control Panel */}
              <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4">
                <div className="border-b border-slate-100 pb-2 flex items-center justify-between">
                  <h3 className="text-sm font-black text-slate-700 tracking-wider flex items-center gap-2 uppercase">
                    <Briefcase className="h-5 w-5 text-indigo-500" />
                    Production Engineers (Pool Builders)
                  </h3>
                  <span className="text-[10px] uppercase font-mono px-2 py-0.5 bg-slate-50 text-slate-500 rounded font-black">
                    {engineers.length} active
                  </span>
                </div>
                
                {/* List of current engineers */}
                <div className="space-y-3 max-h-[220px] overflow-y-auto pr-1">
                  {engineers.map((eng) => (
                    <div key={eng.id} className="flex items-center justify-between p-3 bg-slate-50 border border-slate-100 rounded-xl text-xs">
                      {editingEngineerId === eng.id ? (
                        <div className="flex-1 grid grid-cols-2 gap-2 mr-2">
                          <input
                            type="text"
                            value={editEngineerName}
                            onChange={(e) => setEditEngineerName(e.target.value)}
                            className="bg-white border border-slate-200 px-2 py-1 rounded"
                            placeholder="Name"
                          />
                          <input
                            type="text"
                            value={editEngineerTitle}
                            onChange={(e) => setEditEngineerTitle(e.target.value)}
                            className="bg-white border border-slate-200 px-2 py-1 rounded"
                            placeholder="Title/Dept"
                          />
                        </div>
                      ) : (
                        <div>
                          <p className="font-bold text-slate-805 text-slate-800">{eng.name}</p>
                          <p className="text-[10px] text-slate-400 font-medium">{eng.title}</p>
                        </div>
                      )}
                      
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {editingEngineerId === eng.id ? (
                          <>
                            <button
                              onClick={() => handleSaveEngineer(eng.id)}
                              className="p-1 px-2.5 bg-emerald-600 text-white rounded font-bold hover:bg-emerald-700 text-[10px] cursor-pointer"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingEngineerId(null)}
                              className="p-1 px-2.5 bg-slate-200 text-slate-700 rounded font-bold hover:bg-slate-300 text-[10px] cursor-pointer"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => handleStartEditEngineer(eng)}
                              className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-200/50 rounded transition-colors cursor-pointer"
                              title="Edit Credentials"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteEngineer(eng.id)}
                              className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-55 hover:bg-rose-50 border border-transparent rounded transition-colors cursor-pointer"
                              title="Delete Engineer"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Inline form to append engineer */}
                <form onSubmit={handleAddNewEngineer} className="pt-3 border-t border-slate-100 space-y-2.5">
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Register New Production Engineer</p>
                  <div className="grid grid-cols-2 gap-2.5">
                    <input
                      type="text"
                      required
                      placeholder="e.g. Eng. Fatima S."
                      value={newEngineerName}
                      onChange={(e) => setNewEngineerName(e.target.value)}
                      className="w-full bg-white border border-slate-200 text-xs px-3 py-2 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <input
                      type="text"
                      placeholder="e.g. Process Layout Specialist"
                      value={newEngineerTitle}
                      onChange={(e) => setNewEngineerTitle(e.target.value)}
                      className="w-full bg-white border border-slate-200 text-xs px-3 py-2 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full bg-slate-950 text-white font-bold text-xs py-2 px-4 rounded-xl flex items-center justify-center gap-1.5 hover:bg-slate-900 transition-colors uppercase tracking-wider cursor-pointer font-sans"
                  >
                    <UserPlus className="h-3.5 w-3.5 text-indigo-400" />
                    Add Engineer to Registry
                  </button>
                </form>
              </div>

            </div>

            {/* Right Hand: Shop Floor Teams & Active Project Names */}
            <div className="lg:col-span-6 space-y-6">

              {/* Shop Floor Team Renegotiation Section */}
              <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4">
                <div className="border-b border-slate-100 pb-2">
                  <h3 className="text-sm font-black text-slate-700 tracking-wider flex items-center gap-2 uppercase">
                    <Users className="h-5 w-5 text-indigo-500" />
                    Rename Workshop Teams
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Select a manufacturing stage and rename any of its active labor squads dynamically.
                  </p>
                </div>

                {/* Stage selector tab */}
                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
                      Choose Department Line:
                    </label>
                    <select
                      value={setupStageFilter}
                      onChange={(e) => {
                        setSetupStageFilter(e.target.value as StageId);
                        setEditingTeamId(null);
                      }}
                      className="w-full bg-slate-50 border border-slate-200 text-xs font-bold px-3 py-2 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      {STAGES.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} Section ({teams.filter((t) => t.stageId === s.id).length} teams)
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* List of teams within the chosen stage */}
                  <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1 pt-1">
                    {teams
                      .filter((t) => t.stageId === setupStageFilter)
                      .map((team) => (
                        <div key={team.id} className="p-3 bg-slate-50 border border-slate-105 rounded-xl flex items-center justify-between text-xs">
                          {editingTeamId === team.id ? (
                            <div className="flex-1 mr-2">
                              <input
                                type="text"
                                value={editTeamName}
                                onChange={(e) => setEditTeamName(e.target.value)}
                                className="w-full bg-white border border-slate-200 px-3 py-1.5 text-xs rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 font-bold"
                              />
                            </div>
                          ) : (
                            <div>
                              <p className="font-extrabold text-slate-800">{team.name}</p>
                              <p className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded mt-0.5 inline-block text-slate-500 border border-slate-200 font-bold bg-white">
                                Status: <strong className={team.status === 'BUSY' ? 'text-amber-600' : 'text-emerald-700'}>{team.status}</strong>
                              </p>
                            </div>
                          )}

                          <div className="flex items-center gap-1">
                            {editingTeamId === team.id ? (
                              <>
                                <button
                                  onClick={() => handleSaveTeamName(team.id)}
                                  className="p-1 px-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-bold text-[10px] cursor-pointer"
                                >
                                  Save
                                </button>
                                <button
                                  onClick={() => setEditingTeamId(null)}
                                  className="p-1 px-2.5 bg-slate-200 text-slate-700 hover:bg-slate-300 rounded font-bold text-[10px] cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => handleStartEditTeam(team)}
                                className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 border border-transparent rounded transition-all cursor-pointer"
                                title="Change Team Name"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                  </div>

                </div>
              </div>

              {/* Projects renaming manager */}
              <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4">
                <div className="border-b border-slate-100 pb-2">
                  <h3 className="text-sm font-black text-slate-700 tracking-wider flex items-center gap-2 uppercase">
                    <FolderPlus className="h-5 w-5 text-indigo-500" />
                    Rename Global Projects
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Directly updates the project title across all active pool records, histories, and audit ledgers.
                  </p>
                </div>

                <div className="space-y-3 max-h-[220px] overflow-y-auto pr-1">
                  {uniqueProjectsList.length === 0 ? (
                    <p className="text-xs text-slate-400 py-4 text-center whitespace-nowrap">No projects registered yet! Go to Production Eng. to release a pool.</p>
                  ) : (
                    uniqueProjectsList.map((project) => (
                      <div key={project} className="p-3 bg-slate-50 border border-slate-105 rounded-xl text-xs flex items-center justify-between">
                        {editingProjectName === project ? (
                          <div className="flex-1 mr-2 flex gap-1.5">
                            <input
                              type="text"
                              value={newProjectNameValue}
                              onChange={(e) => setNewProjectNameValue(e.target.value)}
                              className="flex-1 bg-white border border-slate-200 px-3 py-1 text-xs rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 font-bold"
                              placeholder="New project name"
                            />
                            <button
                              onClick={() => handleRenameProjectSubmit(project)}
                              className="px-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-bold text-[10px] cursor-pointer"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingProjectName(null)}
                              className="px-2.5 bg-slate-200 text-slate-700 hover:bg-slate-300 rounded font-bold text-[10px] cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <>
                            <div>
                              <p className="font-extrabold text-slate-800">{project}</p>
                              <p className="text-[10px] text-slate-400 font-semibold">
                                {pools.filter(p => p.projectName === project).length} active hulls in manufacturing pipeline
                              </p>
                            </div>
                            <button
                              onClick={() => {
                                setEditingProjectName(project);
                                setNewProjectNameValue(project);
                              }}
                              className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 border border-transparent rounded transition-all cursor-pointer"
                              title="Rename Project"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>

          </div>
        )}

        {/* Tab 5: Dispatch Logs Ledger */}
        {activeTab === 'audit_logs' && (
          <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
            <h3 className="text-sm font-black text-slate-500 uppercase tracking-widest border-b border-slate-100 pb-2 mb-4">
              Shop Floor Activity Ledger (Real time)
            </h3>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-10 border-slate-100 text-slate-400 font-bold">
                    <th className="py-3 px-2 font-mono uppercase tracking-widest text-[10px]">TIME</th>
                    <th className="py-3 px-2 font-mono uppercase tracking-widest text-[10px]">POOL</th>
                    <th className="py-3 px-2 font-mono uppercase tracking-widest text-[10px]">LINE STEP</th>
                    <th className="py-3 px-2 font-mono uppercase tracking-widest text-[10px]">DISPATCH EVENT</th>
                    <th className="py-3 px-2 font-mono uppercase tracking-widest text-[10px]">OPERATOR</th>
                    <th className="py-3 px-2 font-mono uppercase tracking-widest text-[10px]">NOTES</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-105 divide-slate-50">
                  {logs.slice().reverse().map((log) => {
                    let typeBadge = (
                      <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-slate-100 text-slate-705 text-slate-700 border">
                        Created
                      </span>
                    );
                    if (log.type === 'STAGE_STARTED') {
                      typeBadge = (
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-100">
                          START TIMERS
                        </span>
                      );
                    } else if (log.type === 'STAGE_FINISHED') {
                      typeBadge = (
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-orange-50 text-orange-705 text-orange-700 border border-orange-100">
                          SENT FOR QA
                        </span>
                      );
                    } else if (log.type === 'APPROVED') {
                      typeBadge = (
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-100">
                          QA CLEAR PASS
                        </span>
                      );
                    } else if (log.type === 'REJECTED') {
                      typeBadge = (
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-rose-50 text-rose-700 border border-rose-100">
                          QA REWORK FLAG
                        </span>
                      );
                    }

                    return (
                      <tr key={log.id} className="hover:bg-slate-50/55 transition-colors text-[11px]">
                        <td className="py-3 px-2 font-mono text-[10px] text-slate-400 whitespace-nowrap">
                          {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </td>
                        <td className="py-3 px-2 font-bold text-slate-800">
                          {log.projectName} <span className="font-mono text-slate-400 font-bold ml-1">({log.poolNo})</span>
                        </td>
                        <td className="py-3 px-2">
                          <span className="font-semibold">{STAGES.find(s => s.id === log.stageId)?.name || log.stageId}</span>
                        </td>
                        <td className="py-3 px-2">
                          {typeBadge}
                        </td>
                        <td className="py-3 px-2 font-medium text-slate-600">
                          {log.operatorName}
                        </td>
                        <td className="py-3 px-2 text-slate-400 font-medium whitespace-pre-wrap max-w-xs italic line-clamp-1" title={log.notes}>
                          {log.notes || '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 6: Google Drive Cloud Vault */}
        {activeTab === 'google_drive' && (
          <div className="space-y-6">
            
            {/* Sync Hub Header Card */}
            <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-950 p-6 rounded-2xl border border-indigo-500/20 text-white shadow-xl relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                <Cloud className="h-64 w-64 text-indigo-505 text-indigo-500" />
              </div>

              <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="space-y-2">
                  <span className="text-[10px] font-black uppercase tracking-wider bg-indigo-500/20 px-2.5 py-1 rounded-full text-indigo-300">
                    Google Workspace Cloud Integration
                  </span>
                  <h3 className="text-xl font-extrabold tracking-tight">Enterprise ERP Backups & Travelers Hub</h3>
                  <p className="text-xs text-slate-300 max-w-xl leading-relaxed">
                    Synchronize real-time manufacturing states, pool registrations, and workforce records directly to your Google Drive account. Backups are stored securely in a dedicated <code className="bg-slate-800 px-1 py-0.5 rounded text-indigo-300 font-mono text-[10px]">MAT_Plastic_Travelers</code> folder.
                  </p>
                </div>

                <div className="shrink-0 flex flex-wrap gap-3">
                  {googleUser ? (
                    <div className="flex items-center gap-3 bg-white/5 border border-white/10 p-3 rounded-xl backdrop-blur-md">
                      {googleUser.photoURL ? (
                        <img 
                          src={googleUser.photoURL} 
                          alt="avatar" 
                          className="h-10 w-10 rounded-full border border-indigo-400"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded-full bg-indigo-600 flex items-center justify-center font-bold text-sm">
                          {googleUser.displayName?.[0] || 'G'}
                        </div>
                      )}
                      <div>
                        <p className="text-xs font-bold leading-none text-white">{googleUser.displayName || 'Authorized User'}</p>
                        <p className="text-[10px] text-slate-400 mt-1 leading-none">{googleUser.email}</p>
                        <span className="inline-flex items-center gap-1 text-[9px] text-emerald-400 font-bold mt-1.5 font-mono">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping" />
                          Vault Synchronized
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center p-3 bg-slate-800/40 border border-slate-700/50 rounded-xl">
                      <span className="text-xs font-bold text-slate-400 block mb-1">Backup Vault Offline</span>
                      <span className="text-[10px] text-slate-500 block">Sign-in needed to activate sync features</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Main Action Workspace Split */}
            {googleUser ? (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                
                {/* Save New Backup Panel (Left) */}
                <div className="lg:col-span-4 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex flex-col justify-between">
                  <div className="space-y-4">
                    <h4 className="text-sm font-black text-slate-500 uppercase tracking-wider border-b border-slate-100 pb-2 flex items-center gap-2">
                      <HardDrive className="h-4 w-4 text-slate-400" />
                      Take Cloud Snapshot
                    </h4>

                    <div className="bg-slate-50 border border-slate-150 rounded-xl p-4 text-xs space-y-2.5 text-slate-600">
                      <p className="font-bold text-slate-800">ERP State Elements Included:</p>
                      <ul className="list-disc list-inside space-y-1 font-mono text-[10.5px]">
                        <li>{pools.length} Pools Specifications</li>
                        <li>{teams.length} Factory Workforce Teams</li>
                        <li>{logs.length} Dispatch Activity Logs</li>
                        <li>{inspectors.length} QA Inspectors</li>
                        <li>{engineers.length} Release Engineers</li>
                      </ul>
                      <p className="border-t border-slate-200/50 pt-2 text-[10.5px] italic text-slate-400">
                        Generates a robust, single-file schema payload. Highly available for state rollback matching compliance.
                      </p>
                    </div>
                  </div>

                  <div className="pt-6 space-y-3">
                    <button
                      onClick={handleCreateBackup}
                      disabled={localBackupStatus === 'saving'}
                      className={`w-full py-2.5 rounded-xl font-bold text-xs font-mono flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm ${
                        localBackupStatus === 'saving'
                          ? 'bg-slate-100 text-slate-400 border border-slate-205 cursor-not-allowed'
                          : localBackupStatus === 'success'
                          ? 'bg-emerald-600 text-white shadow-emerald-100'
                          : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-100'
                      }`}
                    >
                      {localBackupStatus === 'saving' ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span>Mailing metadata payload</span>
                        </>
                      ) : localBackupStatus === 'success' ? (
                        <>
                          <CheckCircle2 className="h-4.5 w-4.5" />
                          <span>Snapshot Stored Safely!</span>
                        </>
                      ) : (
                        <>
                          <Cloud className="h-4.5 w-4.5" />
                          <span>Push ERP Sync Snapshot</span>
                        </>
                      )}
                    </button>

                    {localBackupStatus === 'error' && (
                      <p className="p-2.5 bg-rose-50 border border-rose-100 text-[10.5px] rounded text-rose-800 text-center font-medium">
                        Failed: {localBackupError}
                      </p>
                    )}
                  </div>
                </div>

                {/* Cloud Vault Files List (Right) */}
                <div className="lg:col-span-8 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
                  
                  <div className="flex items-center justify-between border-b border-slate-50 pb-2">
                    <h4 className="text-sm font-black text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                      <Cloud className="h-4.5 w-4.5 text-cyan-500" />
                      Backup Vault Storage Explorer
                    </h4>
                    <button
                      type="button"
                      disabled={driveLoading}
                      onClick={fetchGoogleDriveFiles}
                      className="px-2.5 py-1 text-[10px] uppercase font-bold border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer text-slate-500 font-mono"
                    >
                      {driveLoading ? "Syncing..." : "Scan Directory"}
                    </button>
                  </div>

                  {restoreStatus !== 'idle' && (
                    <div className={`p-4 rounded-xl border text-xs flex items-center justify-between shadow-xs ${
                      restoreStatus === 'restoring'
                        ? 'bg-blue-50 border-blue-200 text-blue-800 animate-pulse'
                        : restoreStatus === 'success'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : 'bg-rose-50 border-rose-250 text-rose-800'
                    }`}>
                      <div className="flex items-center gap-2">
                        {restoreStatus === 'restoring' && <Loader2 className="h-4 w-4 animate-spin" />}
                        {restoreStatus === 'success' && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                        <span className="font-semibold">{restoreMessage || "Reading backup snapshot payload..."}</span>
                      </div>
                      <span className="font-mono text-[9px] font-bold bg-white/50 px-1.5 py-0.5 rounded">
                        RESTORE ENGINE
                      </span>
                    </div>
                  )}

                  {driveLoading ? (
                    <div className="text-center py-20">
                      <Loader2 className="h-8 w-8 animate-spin text-cyan-500 mx-auto mb-2" />
                      <p className="text-xs font-bold text-slate-500 font-mono">Syncing securely with Google Workspace...</p>
                      <p className="text-[10px] text-slate-400 mt-1">Retrieving file manifests and parent index</p>
                    </div>
                  ) : googleFiles.length === 0 ? (
                    <div className="text-center py-16 border-2 border-slate-100 border-dashed rounded-xl bg-slate-50/50">
                      <Cloud className="h-10 w-10 text-slate-300 mx-auto mb-2" />
                      <p className="text-xs font-extrabold text-slate-500">Your Google Drive Vault is empty</p>
                      <p className="text-[10px] text-slate-400 mt-1.5 max-w-sm mx-auto leading-relaxed">
                        To see backups appear here, push a new "ERP Sync Snapshot" card or print shop traveler slips and push them directly to your drive.
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto min-h-[300px]">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-slate-100 text-slate-400 font-bold">
                            <th className="py-2.5 px-2 font-mono uppercase tracking-widest text-[9.5px]">File Spec & Type</th>
                            <th className="py-2.5 px-2 font-mono uppercase tracking-widest text-[9.5px]">Uploaded Stamp</th>
                            <th className="py-2.5 px-2 font-mono uppercase tracking-widest text-[9.5px]">Size</th>
                            <th className="py-2.5 px-2 text-right font-mono uppercase tracking-widest text-[9.5px]">Vault Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {googleFiles.map((file) => {
                            const isJson = file.name.endsWith('.json');
                            return (
                              <tr key={file.id} className="hover:bg-slate-50/70 transition-colors text-[11px]">
                                <td className="py-3 px-2">
                                  <div className="flex items-center gap-2 max-w-[280px]">
                                    {isJson ? (
                                      <span className="px-1.5 py-0.5 rounded text-[8.5px] font-black uppercase tracking-wide bg-blue-50 text-blue-700 border border-blue-150 shrink-0">
                                        ERP JSON SNAPSHOT
                                      </span>
                                    ) : (
                                      <span className="px-1.5 py-0.5 rounded text-[8.5px] font-black uppercase tracking-wide bg-teal-50 text-teal-700 border border-teal-150 shrink-0">
                                        TRAVELER TEXT
                                      </span>
                                    )}
                                    <span className="font-bold text-slate-800 truncate" title={file.name}>
                                      {file.name}
                                    </span>
                                  </div>
                                </td>
                                <td className="py-3 px-2 font-mono text-[10px] text-slate-400">
                                  {new Date(file.createdTime).toLocaleString()}
                                </td>
                                <td className="py-3 px-2 font-mono text-slate-500 font-medium">
                                  {file.size ? `${(parseInt(file.size) / 1024).toFixed(1)} KB` : '—'}
                                </td>
                                <td className="py-3 px-2 text-right space-x-1.5">
                                  {isJson && (
                                    <button
                                      type="button"
                                      onClick={() => handleRestoreBackup(file.id)}
                                      className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-mono font-bold text-[9px] uppercase border border-emerald-205 rounded-lg transition-colors cursor-pointer inline-block"
                                      title="Load this data backup to restore ERP states"
                                    >
                                      Load State
                                    </button>
                                  )}
                                  <a 
                                    href={file.webViewLink} 
                                    target="_blank" 
                                    rel="noreferrer"
                                    className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-mono font-bold text-[9px] uppercase border border-slate-250 rounded-lg transition-colors inline-block"
                                  >
                                    View File
                                  </a>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteBackup(file.id, file.name)}
                                    className="p-1 text-rose-500 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-105 rounded transition-all inline-flex cursor-pointer text-center"
                                    title="Delete from safe cloud explorer"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                </div>

              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center shadow-xs">
                <Cloud className="h-16 w-16 text-slate-300 mx-auto mb-3 animate-bounce" />
                <h4 className="text-base font-extrabold text-slate-800 tracking-tight">Connect Your Google Vault Service</h4>
                <p className="text-xs text-slate-400 mt-2 max-w-md mx-auto leading-relaxed">
                  Backups, factory floor log ledgers, and Traveler sign-offs are protected under dual-credential TLS tokens. Securely authorize write permissions on your private Google Drive space.
                </p>
                <div className="mt-6">
                  <button
                    type="button"
                    onClick={onGoogleSignIn}
                    className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs font-mono uppercase tracking-wide rounded-xl shadow-md cursor-pointer transition-all flex items-center justify-center gap-2 mx-auto"
                  >
                    <Cloud className="h-4.5 w-4.5 text-indigo-200" />
                    <span>Authorize Vault Connection</span>
                  </button>
                </div>
              </div>
            )}

          </div>
        )}

      </div>

    </div>
  );
};
