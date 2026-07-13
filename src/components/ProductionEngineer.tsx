import React, { useState } from 'react';
import { Pool, PoolOrientation, PlannedPool } from '../types';
import { 
  PlusCircle, 
  Search, 
  Compass, 
  Ruler, 
  Layout, 
  FileText, 
  ClipboardList, 
  FolderPlus, 
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  Info,
  Tag,
  BarChart3
} from 'lucide-react';

interface ProductionEngineerProps {
  pools: Pool[];
  onCreatePool: (newPool: {
    projectName: string;
    poolNo: string;
    orientation: PoolOrientation;
    dimensions: string;
    shape: string;
    poolType: string;
    notes: string;
    operatorName: string;
    createdAt?: string;
  }) => void;
  onCreatePoolBatch: (
    projectName: string,
    prefix: string,
    startRange: number,
    count: number,
    orientation: PoolOrientation,
    dimensions: string,
    shape: string,
    poolType: string,
    notes: string,
    operatorName: string
  ) => void;
  engineers?: { id: string; name: string; title: string }[];
  plannedPools?: PlannedPool[];
  onReleasePlannedPool?: (planId: string, operatorName: string) => string | null;
}

export const ProductionEngineer: React.FC<ProductionEngineerProps> = ({ 
  pools, 
  onCreatePool, 
  onCreatePoolBatch,
  engineers = [],
  plannedPools = [],
  onReleasePlannedPool
}) => {
  // Navigation for Form Tab
  const [formMode, setFormMode] = useState<'single' | 'batch'>('single');

  // Selected engineer who is publishing
  const [selectedEngineer, setSelectedEngineer] = useState(engineers[0]?.name || '');

  // Pre-planned import dropdown selection state
  const [selectedPlanId, setSelectedPlanId] = useState('');

  // Single form states
  const [projectName, setProjectName] = useState('');
  const [poolNo, setPoolNo] = useState('');
  const [orientation, setOrientation] = useState<PoolOrientation>('Normal');
  const [dimensions, setDimensions] = useState('12m x 5m x 1.4m');
  const [shape, setShape] = useState('Rectangular');
  const [poolType, setPoolType] = useState('');
  const [notes, setNotes] = useState('');

  // Entry date for backdating (defaults to today)
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));

  // Batch form states
  const [batchProjectName, setBatchProjectName] = useState('');
  const [batchPrefix, setBatchPrefix] = useState('P-');
  const [batchStartRange, setBatchStartRange] = useState<number>(101);
  const [batchCount, setBatchCount] = useState<number>(50);
  const [batchOrientation, setBatchOrientation] = useState<PoolOrientation>('Normal');
  const [batchDimensions, setBatchDimensions] = useState('12m x 5m x 1.4m');
  const [batchShape, setBatchShape] = useState('Rectangular');
  const [batchPoolType, setBatchPoolType] = useState('');
  const [batchNotes, setBatchNotes] = useState('');

  // Sync selectedEngineer if list changes on the fly
  React.useEffect(() => {
    if (engineers.length > 0 && !engineers.some(e => e.name === selectedEngineer)) {
      setSelectedEngineer(engineers[0].name);
    }
  }, [engineers]);

  // Feedback states
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Queue search & pagination states
  const [qSearch, setQSearch] = useState('');
  const [qProject, setQProject] = useState('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;

  // Total statistics
  const firstStagePools = pools.filter(p => p.currentStageIndex === 0);

  // Unique projects list for filtering (queue-only, used by the queue panel)
  const uniqueProjects = Array.from(new Set(firstStagePools.map(p => p.projectName))).filter(Boolean);

  // ---- Pool Count Explorer state (searches across ALL pools, any stage) ----
  const [countProject, setCountProject] = useState('ALL');
  const [countPoolType, setCountPoolType] = useState('ALL');
  const [countOrientation, setCountOrientation] = useState('ALL');
  const [countPoolNo, setCountPoolNo] = useState('');

  const allUniqueProjects = Array.from(new Set(pools.map(p => p.projectName))).filter(Boolean).sort();
  const allUniquePoolTypes = Array.from(new Set(pools.map(p => p.poolType).filter(Boolean))) as string[];
  const allUniqueOrientations = Array.from(new Set(pools.map(p => p.orientation))).filter(Boolean);

  const countFilteredPools = pools.filter(p => {
    const matchesProject = countProject === 'ALL' || p.projectName === countProject;
    const matchesType = countPoolType === 'ALL' || (p.poolType || 'Unspecified') === countPoolType;
    const matchesOrientation = countOrientation === 'ALL' || p.orientation === countOrientation;
    const matchesPoolNo = !countPoolNo.trim() || p.poolNo.toLowerCase().includes(countPoolNo.trim().toLowerCase());
    return matchesProject && matchesType && matchesOrientation && matchesPoolNo;
  });

  // Breakdown of the filtered set, grouped by Pool Type
  const countByType = countFilteredPools.reduce((acc: Record<string, number>, p) => {
    const key = p.poolType || 'Unspecified';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  // Filtering of current list
  const filteredFirstStage = firstStagePools.filter(p => {
    const matchesProject = qProject === 'ALL' || p.projectName === qProject;
    const matchesSearch = p.projectName.toLowerCase().includes(qSearch.toLowerCase()) || p.poolNo.toLowerCase().includes(qSearch.toLowerCase());
    return matchesProject && matchesSearch;
  });

  // Pagination calculations
  const totalPages = Math.ceil(filteredFirstStage.length / itemsPerPage) || 1;
  const paginatedFirstStage = filteredFirstStage.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const handleSingleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMsg('');
    setErrorMsg('');

    if (!projectName.trim()) {
      setErrorMsg('Project Name is required.');
      return;
    }
    if (!poolNo.trim()) {
      setErrorMsg('Pool Number/ID is required.');
      return;
    }

    if (selectedPlanId && onReleasePlannedPool) {
      // Same project-scoped duplicate check applies to pre-planned releases too
      const preplannedDuplicate = pools.some(p =>
        p.poolNo.toLowerCase() === poolNo.toLowerCase().trim() &&
        p.projectName.toLowerCase() === projectName.toLowerCase().trim()
      );
      if (preplannedDuplicate) {
        setErrorMsg(`Pool ID "${poolNo}" is already registered under project "${projectName}". This pre-planned pool may have already been released.`);
        return;
      }

      const releaseResultId = onReleasePlannedPool(selectedPlanId, selectedEngineer);
      if (releaseResultId) {
        setSuccessMsg(`Pre-planned Pool ${poolNo.toUpperCase()} ("${projectName}") successfully launched onto Steel Fabrication stage!`);
        setSelectedPlanId('');
        setProjectName('');
        setPoolNo('');
        setNotes('');
        setDimensions('12m x 5m x 1.4m');
        setShape('Rectangular');
        setPoolType('');
        setCurrentPage(1);
      } else {
        setErrorMsg('Failed to release the selected pre-planned pool design.');
      }
      return;
    }

    // Check duplicate poolNo within the SAME project only (same pool no. is allowed across different projects)
    const exists = pools.some(p =>
      p.poolNo.toLowerCase() === poolNo.toLowerCase().trim() &&
      p.projectName.toLowerCase() === projectName.toLowerCase().trim()
    );
    if (exists) {
      setErrorMsg(`Pool ID "${poolNo}" is already registered under project "${projectName}". IDs must be unique within a project.`);
      return;
    }

    onCreatePool({
      projectName: projectName.trim(),
      poolNo: poolNo.trim().toUpperCase(),
      orientation,
      dimensions: dimensions.trim(),
      shape: shape.trim(),
      poolType: poolType.trim(),
      notes: notes.trim(),
      operatorName: selectedEngineer,
      createdAt: entryDate ? new Date(entryDate + 'T08:00:00').toISOString() : new Date().toISOString()
    });

    setSuccessMsg(`Pool ${poolNo.toUpperCase()} ("${projectName}") successfully registered and released to Steel Fabrication!`);
    
    // Clear Form
    setProjectName('');
    setPoolNo('');
    setNotes('');
    setDimensions('12m x 5m x 1.4m');
    setShape('Rectangular');
    setPoolType('');
    setCurrentPage(1);
  };

  const handleBatchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMsg('');
    setErrorMsg('');

    if (!batchProjectName.trim()) {
      setErrorMsg('Project Name is required.');
      return;
    }
    if (!batchPrefix.trim()) {
      setErrorMsg('Pool ID Prefix is required.');
      return;
    }
    if (batchCount <= 0 || batchCount > 200) {
      setErrorMsg('Generation limit is between 1 and 200 pools per batch for performance.');
      return;
    }

    // Check duplicate prefix conflicts before submitting
    let duplicatesFound = false;
    for (let i = 0; i < batchCount; i++) {
      const targetNo = `${batchPrefix.trim().toUpperCase()}${batchStartRange + i}`;
      const exists = pools.some(p =>
        p.poolNo.toLowerCase() === targetNo.toLowerCase() &&
        p.projectName.toLowerCase() === batchProjectName.toLowerCase().trim()
      );
      if (exists) {
        duplicatesFound = true;
        setErrorMsg(`Conflict: Pool ID "${targetNo}" is already registered under project "${batchProjectName}". Change the start index or suffix prefix.`);
        return;
      }
    }

    onCreatePoolBatch(
      batchProjectName.trim(),
      batchPrefix.trim().toUpperCase(),
      batchStartRange,
      batchCount,
      batchOrientation,
      batchDimensions.trim(),
      batchShape.trim(),
      batchPoolType.trim(),
      batchNotes.trim(),
      selectedEngineer
    );

    setSuccessMsg(`Project Spawner completed: Successfully generated ${batchCount} pools (${batchPrefix}${batchStartRange} to ${batchPrefix}${batchStartRange + batchCount - 1}) for "${batchProjectName}"! All dispatched to Steel Fabrication.`);
    
    // Reset batch form somewhat
    setBatchNotes('');
    setBatchStartRange(prev => prev + batchCount); // advance counter for ease of next batch
    setCurrentPage(1);
  };

  return (
    <div className="space-y-6">
      
      {/* Title block */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between bg-white p-6 rounded-2xl border border-slate-100 shadow-sm gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800 tracking-tight flex items-center gap-2">
            <ClipboardList className="h-5.5 w-5.5 text-amber-500" />
            Production Engineer Workflow
          </h2>
          <p className="text-sm text-slate-500">
            Define custom engineering parameters, initialize production slots, and bulk generate high-volume project shells.
          </p>
        </div>
        <div className="flex gap-4">
          <div className="bg-amber-50 p-4 rounded-xl border border-amber-100/80 text-center min-w-[125px]">
            <span className="block text-2xl font-black text-amber-600 font-mono">{pools.length}</span>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Global Shells</span>
          </div>
          <div className="bg-blue-50 p-4 rounded-xl border border-blue-100/80 text-center min-w-[125px]">
            <span className="block text-2xl font-black text-blue-600 font-mono">{firstStagePools.length}</span>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">In fabrication</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Release Form (Left) */}
        <div className="lg:col-span-5 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm h-fit">
          
          {/* Form Tabs */}
          <div className="flex border-b border-slate-100 mb-5 text-sm font-semibold">
            <button
              onClick={() => { setFormMode('single'); setSuccessMsg(''); setErrorMsg(''); }}
              className={`flex-1 pb-3 text-center transition-all border-b-2 cursor-pointer ${
                formMode === 'single' 
                  ? 'border-blue-600 text-blue-600 font-bold' 
                  : 'border-transparent text-slate-400 hover:text-slate-600'
              }`}
            >
              Single Custom Shell
            </button>
            <button
              onClick={() => { setFormMode('batch'); setSuccessMsg(''); setErrorMsg(''); }}
              className={`flex-1 pb-3 text-center transition-all border-b-2 cursor-pointer flex items-center justify-center gap-1.5 ${
                formMode === 'batch' 
                  ? 'border-blue-600 text-blue-600 font-bold' 
                  : 'border-transparent text-slate-400 hover:text-slate-600'
              }`}
            >
              <FolderPlus className="h-4 w-4" />
              Project Batch Spawner (100+)
            </button>
          </div>

          {/* Active Releasing Engineer Select */}
          <div className="bg-slate-50 border border-slate-100 p-3.5 rounded-xl mb-4 text-xs">
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
              Active Authorizing Engineer:
            </label>
            <select
              value={selectedEngineer}
              onChange={(e) => setSelectedEngineer(e.target.value)}
              className="w-full bg-white border border-slate-250 border-slate-200 text-slate-700 font-bold px-3 py-1.5 rounded-lg focus:outline-none"
            >
              {engineers.length > 0 ? (
                engineers.map((eng) => (
                  <option key={eng.id || eng.name} value={eng.name}>
                    {eng.name} — {eng.title}
                  </option>
                ))
              ) : (
                <option value="" disabled>— No engineers registered yet (add via Planning ▸ Roles) —</option>
              )}
            </select>
          </div>

          {/* Success / Error Feedback */}
          {successMsg && (
            <div className="p-3.5 bg-emerald-50 border border-emerald-100 text-emerald-800 rounded-xl text-xs font-medium mb-4 leading-relaxed">
              {successMsg}
            </div>
          )}

          {errorMsg && (
            <div className="p-3.5 bg-rose-50 border border-rose-100 text-rose-800 rounded-xl text-xs font-medium mb-4">
              {errorMsg}
            </div>
          )}

          {/* Mode 1: Single Submit */}
          {formMode === 'single' && (
            <form onSubmit={handleSingleSubmit} className="space-y-4">
              
              {/* Optional Planning Department Import */}
              {plannedPools && plannedPools.length > 0 && (
                <div className="bg-indigo-50/70 border border-indigo-100 p-3 rounded-xl text-xs space-y-1.5">
                  <div className="flex items-center justify-between font-bold text-indigo-700 uppercase tracking-widest text-[9.5px]">
                    <span>Import Pre-Planned Allocation:</span>
                    {selectedPlanId && (
                      <button 
                        type="button" 
                        onClick={() => {
                          setSelectedPlanId('');
                          setProjectName('');
                          setPoolNo('');
                          setNotes('');
                          setDimensions('12m x 5m x 1.4m');
                          setShape('Rectangular');
                          setPoolType('');
                        }} 
                        className="text-red-650 hover:underline font-extrabold"
                      >
                        Reset / Enter Custom
                      </button>
                    )}
                  </div>
                  <select
                    value={selectedPlanId}
                    onChange={(e) => {
                      const planId = e.target.value;
                      setSelectedPlanId(planId);
                      if (!planId) {
                        setProjectName('');
                        setPoolNo('');
                        setNotes('');
                        setDimensions('12m x 5m x 1.4m');
                        setShape('Rectangular');
                        setPoolType('');
                      } else {
                        const matched = plannedPools.find(ap => ap.id === planId);
                        if (matched) {
                          setProjectName(matched.projectName);
                          setPoolNo(matched.poolNo);
                          setOrientation(matched.orientation);
                          setDimensions(matched.dimensions);
                          setShape(matched.shape);
                          setPoolType(matched.poolType || '');
                          setNotes(matched.notes || '');
                        }
                      }
                    }}
                    className="w-full bg-white border border-indigo-200 text-slate-800 font-bold px-2.5 py-1.5 rounded-lg focus:outline-none text-xs"
                  >
                    <option value="">-- Select Registered Number --</option>
                    {plannedPools.filter(ap => ap.status === 'PLANNED').map((ap) => (
                      <option key={ap.id} value={ap.id}>
                        {ap.poolNo} — {ap.projectName} ({ap.orientation})
                      </option>
                    ))}
                  </select>
                  <p className="text-[9.5px] text-indigo-455 text-indigo-500 leading-tight">
                    {selectedPlanId ? 'Locked to planning department specifications.' : 'Or fill custom details in the coordinates fields below.'}
                  </p>
                </div>
              )}

              <div>
                <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wide mb-1.5">
                  Pool ID / Shell Reference <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400 font-mono text-sm font-bold">#</span>
                  <input
                    type="text"
                    required
                    disabled={!!selectedPlanId}
                    placeholder="e.g. P-1050"
                    value={poolNo}
                    onChange={(e) => setPoolNo(e.target.value)}
                    className="w-full pl-8 pr-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-mono font-bold disabled:bg-slate-100 disabled:text-slate-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wide mb-1.5">
                  Project Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  disabled={!!selectedPlanId}
                  placeholder="e.g. Oasis Resort Villa Group"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-medium text-slate-800 disabled:bg-slate-100 disabled:text-slate-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wide mb-1.5">
                    Orientation
                  </label>
                  <div className="relative">
                    <Compass className="absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
                    <select
                      value={orientation}
                      disabled={!!selectedPlanId}
                      onChange={(e) => setOrientation(e.target.value as PoolOrientation)}
                      className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-bold disabled:bg-slate-100 disabled:text-slate-500"
                    >
                      <option value="Normal">Normal</option>
                      <option value="Mirror">Mirror</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wide mb-1.5">
                    Pool Shape
                  </label>
                  <div className="relative">
                    <Layout className="absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
                    <input
                      type="text"
                      required
                      disabled={!!selectedPlanId}
                      placeholder="e.g. Curved Infinity"
                      value={shape}
                      onChange={(e) => setShape(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-medium disabled:bg-slate-100 disabled:text-slate-500"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wide mb-1.5">
                  Pool Type
                </label>
                <div className="relative">
                  <Tag className="absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    disabled={!!selectedPlanId}
                    list="pool-type-suggestions"
                    placeholder="e.g. Skimmer, Overflow, Plunge, Lap"
                    value={poolType}
                    onChange={(e) => setPoolType(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-medium disabled:bg-slate-100 disabled:text-slate-500"
                  />
                  <datalist id="pool-type-suggestions">
                    {allUniquePoolTypes.map(pt => <option key={pt} value={pt} />)}
                  </datalist>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wide mb-1.5">
                  Shell Dimensions
                </label>
                <div className="relative">
                  <Ruler className="absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    required
                    disabled={!!selectedPlanId}
                    placeholder="e.g. 12m x 5m x 1.4m"
                    value={dimensions}
                    onChange={(e) => setDimensions(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-mono font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wide mb-1.5">
                  Technical Specifications & Notes
                </label>
                <div className="relative">
                  <FileText className="absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
                  <textarea
                    placeholder="E.g., custom skimmer placement, load reinforcement..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-xl text-xs h-20 min-h-[80px] focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wide mb-1.5">
                  Entry Date <span className="text-slate-400 font-normal normal-case">(backdate if needed)</span>
                </label>
                <input
                  type="date"
                  value={entryDate}
                  onChange={(e) => setEntryDate(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-mono"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl cursor-pointer transition-all shadow-md shadow-blue-105 flex items-center justify-center gap-2 mt-4"
              >
                <PlusCircle className="h-4.5 w-4.5" />
                <span>Publish Shell to Steel Fabrication</span>
              </button>
            </form>
          )}

          {/* Mode 2: Bulk Spawner (Supports generating hundreds of pools instantly!) */}
          {formMode === 'batch' && (
            <form onSubmit={handleBatchSubmit} className="space-y-4">
              
              <div className="bg-blue-50/50 p-3 rounded-xl border border-blue-100 text-[11px] text-blue-900 leading-relaxed font-medium">
                <div className="flex gap-2">
                  <Info className="h-4.5 w-4.5 text-blue-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold block uppercase text-[10px] tracking-wider mb-0.5">High-Volume Spawner</span>
                    Instantly generate and schedule up to 200 serialized pools matching a master template configuration. This simulates high-density development phases.
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wide mb-1.5">
                  Target Project Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Dubai Marina Cluster C"
                  value={batchProjectName}
                  onChange={(e) => setBatchProjectName(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-bold"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-1">
                  <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wide mb-1.5" title="Pool ID prefix">
                    ID Prefix <span className="text-rose-50">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. P-"
                    value={batchPrefix}
                    onChange={(e) => setBatchPrefix(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-mono font-bold text-center"
                  />
                </div>

                <div className="col-span-1">
                  <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wide mb-1.5">
                    Start ID #
                  </label>
                  <input
                    type="number"
                    required
                    min="1"
                    value={batchStartRange}
                    onChange={(e) => setBatchStartRange(parseInt(e.target.value) || 1)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-mono font-bold text-center"
                  />
                </div>

                <div className="col-span-1">
                  <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wide mb-1.5" title="Number of pools to generate">
                    Quantity <span className="text-rose-50">*</span>
                  </label>
                  <input
                    type="number"
                    required
                    min="1"
                    max="200"
                    value={batchCount}
                    onChange={(e) => setBatchCount(parseInt(e.target.value) || 1)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs bg-slate-50 font-bold text-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-505 text-center"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wide mb-1.5">
                    Template Orientation
                  </label>
                  <div className="relative">
                    <Compass className="absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
                    <select
                      value={batchOrientation}
                      onChange={(e) => setBatchOrientation(e.target.value as PoolOrientation)}
                      className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-xs bg-white focus:outline-none font-bold"
                    >
                      <option value="Normal">Normal</option>
                      <option value="Mirror">Mirror</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wide mb-1.5">
                    Template Shape
                  </label>
                  <div className="relative">
                    <Layout className="absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
                    <input
                      type="text"
                      required
                      value={batchShape}
                      onChange={(e) => setBatchShape(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wide mb-1.5">
                  Template Pool Type
                </label>
                <div className="relative">
                  <Tag className="absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    list="pool-type-suggestions"
                    placeholder="e.g. Skimmer, Overflow, Plunge, Lap"
                    value={batchPoolType}
                    onChange={(e) => setBatchPoolType(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wide mb-1.5">
                  Template Dimensions
                </label>
                <div className="relative">
                  <Ruler className="absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    required
                    value={batchDimensions}
                    onChange={(e) => setBatchDimensions(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 font-mono font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wide mb-1.5">
                  Shared Technical Notes for Batch
                </label>
                <textarea
                  placeholder="Shared batch specifications, quality indicators..."
                  value={batchNotes}
                  onChange={(e) => setBatchNotes(e.target.value)}
                  className="w-full p-2.5 border border-slate-200 rounded-xl text-xs h-16 min-h-[50px] focus:outline-none focus:ring-2"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm rounded-xl cursor-pointer transition-all shadow-md shadow-indigo-200 flex items-center justify-center gap-2 mt-2"
              >
                <FolderPlus className="h-4.5 w-4.5" />
                <span>Generate & Publish {batchCount} Active Shells</span>
              </button>
            </form>
          )}

        </div>

        {/* List of pools in Stage 0 (Steel Fabrication) with High Capacity design */}
        <div className="lg:col-span-7 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex flex-col justify-between min-h-[500px]">
          
          <div className="space-y-4">
            
            {/* Queue header with project filter */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-800 tracking-tight flex items-center gap-2">
                  <ClipboardList className="h-5 w-5 text-amber-500" />
                  First Stage Queue (Steel Fabrication)
                </h3>
                <p className="text-xs text-slate-400">Showing {filteredFirstStage.length} queued shells</p>
              </div>

              {/* Select Project */}
              <div className="flex items-center gap-1.5">
                <SlidersHorizontal className="h-3.5 w-3.5 text-slate-400" />
                <select
                  value={qProject}
                  onChange={(e) => { setQProject(e.target.value); setCurrentPage(1); }}
                  className="bg-slate-50 border border-slate-200 text-xs text-slate-600 px-2.5 py-1.5 rounded-lg font-medium outline-none"
                >
                  <option value="ALL">All Projects ({uniqueProjects.length})</option>
                  {uniqueProjects.map(proj => (
                    <option key={proj} value={proj}>{proj}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Quick search */}
            <div className="relative">
              <Search className="absolute top-2 left-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Quick lookup by Pool ID or Project details..."
                value={qSearch}
                onChange={(e) => { setQSearch(e.target.value); setCurrentPage(1); }}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50/50 border border-slate-150 rounded-xl focus:outline-none focus:border-slate-300 transition-colors"
              />
            </div>

            {filteredFirstStage.length === 0 ? (
              <div className="text-center py-16 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                <Compass className="h-10 w-10 text-slate-300 mx-auto mb-2 animate-pulse text-slate-400" />
                <p className="text-sm font-bold text-slate-600">No matching shells in fabrication queue</p>
                <p className="text-xs text-slate-405 px-6 mt-1 text-slate-400">Launch a new custom pool spec or triggers the batch spawner on the left sidebar.</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {paginatedFirstStage.map((pool) => {
                  const hist = pool.stageHistory.steel_fabrication;
                  return (
                    <div key={pool.id} className="p-3.5 border border-slate-100 rounded-xl hover:border-slate-200 shadow-sm hover:shadow-xs transition-all bg-slate-50/30 flex justify-between items-center text-xs">
                      <div className="space-y-1 pr-4">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11px] font-black text-slate-705 bg-slate-150/80 px-1.5 py-0.5 rounded font-bold border border-slate-200/50">
                            {pool.poolNo}
                          </span>
                          <h4 className="font-bold text-slate-800 line-clamp-1">{pool.projectName}</h4>
                        </div>
                        
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-450 text-slate-400 font-medium">
                          <span>Orient: <strong className="text-slate-600">{pool.orientation}</strong></span>
                          <span>•</span>
                          <span>Dim: <strong className="text-slate-600">{pool.dimensions}</strong></span>
                          <span>•</span>
                          <span>Shape: <strong className="text-slate-600">{pool.shape}</strong></span>
                          {pool.poolType && (
                            <>
                              <span>•</span>
                              <span>Type: <strong className="text-slate-600">{pool.poolType}</strong></span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="text-right flex-shrink-0 flex items-center gap-3">
                        <div className="hidden sm:block">
                          <span className="text-[9px] text-slate-400 block font-light">Created Time</span>
                          <span className="text-[10px] text-slate-500 font-mono">
                            {new Date(pool.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          </span>
                        </div>
                        
                        <div>
                          {hist.status === 'NOT_STARTED' && (
                            <span className="inline-flex items-center px-2 py-1 rounded bg-slate-100 text-slate-600 border border-slate-200 text-[10px] font-bold font-mono">
                              QUEUED
                            </span>
                          )}
                          {hist.status === 'IN_PROGRESS' && (
                            <span className="inline-flex items-center px-2 py-1 rounded bg-blue-50 text-blue-700 border border-blue-100 text-[10px] font-bold animate-pulse">
                              FABRICATING
                            </span>
                          )}
                          {hist.status === 'PENDING_INSPECTION' && (
                            <span className="inline-flex items-center px-2 py-1 rounded bg-amber-50 text-amber-700 border border-amber-100 text-[10px] font-bold">
                              QA REVIEW
                            </span>
                          )}
                          {hist.status === 'REJECTED' && (
                            <span className="inline-flex items-center px-2 py-1 rounded bg-rose-55 font-bold bg-rose-50 text-rose-700 border border-rose-100 text-[10px]">
                              REWORK ({hist.rejectionCount})
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Simple Pagination Controls for High Capacity load */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-100 pt-4 mt-4">
              <span className="text-xs text-slate-400 font-medium">
                Showing page <strong className="text-slate-700">{currentPage}</strong> of <strong className="text-slate-700">{totalPages}</strong>
              </span>
              
              <div className="flex gap-1">
                <button
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-transparent cursor-pointer transition-colors"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-transparent cursor-pointer transition-colors"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

        </div>

      </div>

      {/* Pool Count Explorer — search/filter across ALL pools by type, project, orientation, pool number */}
      <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-100 pb-3 mb-4">
          <div>
            <h3 className="text-base font-bold text-slate-800 tracking-tight flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-indigo-500" />
              Pool Count Explorer
            </h3>
            <p className="text-xs text-slate-400">
              Check how many pools exist across the whole plant — filter by pool type, project, orientation, or a specific pool number.
            </p>
          </div>
          <div className="bg-indigo-50 px-4 py-2.5 rounded-xl border border-indigo-100/80 text-center min-w-[110px]">
            <span className="block text-xl font-black text-indigo-600 font-mono">{countFilteredPools.length}</span>
            <span className="text-[9.5px] font-bold text-slate-400 uppercase tracking-widest">Matching Pools</span>
          </div>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Project</label>
            <select
              value={countProject}
              onChange={(e) => setCountProject(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 text-xs text-slate-600 px-2.5 py-2 rounded-lg font-medium outline-none"
            >
              <option value="ALL">All Projects ({allUniqueProjects.length})</option>
              {allUniqueProjects.map(proj => (
                <option key={proj} value={proj}>{proj}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Pool Type</label>
            <select
              value={countPoolType}
              onChange={(e) => setCountPoolType(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 text-xs text-slate-600 px-2.5 py-2 rounded-lg font-medium outline-none"
            >
              <option value="ALL">All Types</option>
              {allUniquePoolTypes.map(pt => (
                <option key={pt} value={pt}>{pt}</option>
              ))}
              {pools.some(p => !p.poolType) && (
                <option value="Unspecified">Unspecified</option>
              )}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Orientation</label>
            <select
              value={countOrientation}
              onChange={(e) => setCountOrientation(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 text-xs text-slate-600 px-2.5 py-2 rounded-lg font-medium outline-none"
            >
              <option value="ALL">All Orientations</option>
              {allUniqueOrientations.map(o => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Pool Number</label>
            <div className="relative">
              <Search className="absolute top-2.5 left-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="e.g. P-1050"
                value={countPoolNo}
                onChange={(e) => setCountPoolNo(e.target.value)}
                className="w-full pl-8 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none font-mono"
              />
            </div>
          </div>
        </div>

        {/* Breakdown by Pool Type for the current filtered set */}
        {countFilteredPools.length === 0 ? (
          <div className="text-center py-10 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
            <Tag className="h-8 w-8 text-slate-300 mx-auto mb-2" />
            <p className="text-sm font-bold text-slate-600">No pools match these filters</p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2.5">
            {Object.entries(countByType)
              .sort((a, b) => b[1] - a[1])
              .map(([type, count]) => (
                <div
                  key={type}
                  className="flex items-center gap-2 px-3.5 py-2 bg-slate-50 border border-slate-150 rounded-xl text-xs"
                >
                  <Tag className="h-3.5 w-3.5 text-indigo-400" />
                  <span className="font-bold text-slate-700">{type}</span>
                  <span className="font-mono font-black text-indigo-600">{count}</span>
                </div>
              ))}
          </div>
        )}

        {/* Pool number match highlight — show the specific pool(s) when searching a Pool Number */}
        {countPoolNo.trim() && countFilteredPools.length > 0 && countFilteredPools.length <= 20 && (
          <div className="mt-4 space-y-2">
            {countFilteredPools.map(p => (
              <div key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3 border border-slate-100 rounded-xl bg-slate-50/40 text-xs">
                <span className="font-mono font-black text-slate-700 bg-white px-2 py-0.5 rounded border border-slate-200">{p.poolNo}</span>
                <span className="font-bold text-slate-700">{p.projectName}</span>
                <span className="text-slate-400">Type: <strong className="text-slate-600">{p.poolType || 'Unspecified'}</strong></span>
                <span className="text-slate-400">Orient: <strong className="text-slate-600">{p.orientation}</strong></span>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
};
