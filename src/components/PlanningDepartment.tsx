import React, { useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { PlannedPool, Pool, PoolOrientation, ViewRole, ProjectSummary, MonthlyTarget } from '../types';
import { STAGES } from '../data/mockData';
import { 
  Plus, 
  Search, 
  Trash2, 
  Zap, 
  CheckCircle, 
  Play, 
  BarChart3, 
  Info, 
  Activity, 
  FileSpreadsheet,
  Layers,
  HelpCircle,
  TrendingUp,
  Sliders,
  Calendar,
  Filter,
  Upload,
  Download,
  Check,
  AlertTriangle
} from 'lucide-react';

interface PlanningDepartmentProps {
  plannedPools: PlannedPool[];
  pools: Pool[];
  onAddPlannedPool: (spec: {
    projectName: string;
    poolNo: string;
    orientation: PoolOrientation;
    dimensions: string;
    shape: string;
    poolType?: string;
    drawingUrl?: string;
    notes?: string;
    createdAt?: string;
  }) => boolean;
  onAddPlannedPoolBatch: (spec: {
    projectName: string;
    prefix: string;
    startRange: number;
    count: number;
    orientation: PoolOrientation;
    dimensions: string;
    shape: string;
    poolType?: string;
    drawingUrl?: string;
    notes?: string;
  }) => void;
  onDeletePlannedPool: (planId: string) => void;
  onReleasePlannedPool: (planId: string, operatorName: string) => string | null;
  engineers: { id: string; name: string }[];
  projectsSummary?: ProjectSummary[];
  onSaveProjectSummary?: (summary: ProjectSummary) => void;
  onDeleteProjectSummary?: (id: string) => void;
  monthlyTargets?: MonthlyTarget[];
  onSaveMonthlyTarget?: (target: MonthlyTarget) => void;
  onDirectOverridePool?: (
    spec: {
      id?: string;
      projectName: string;
      poolNo: string;
      orientation: PoolOrientation;
      dimensions: string;
      shape: string;
      poolType: string;
      notes?: string;
      isDelivered?: boolean;
      currentStageIndex: number;
    },
    operatorName: string
  ) => void;
  onAddPlannedPoolsList?: (importedList: {
    projectName: string;
    poolNo: string;
    orientation: PoolOrientation;
    dimensions: string;
    shape: string;
    poolType?: string;
    drawingUrl?: string;
    notes?: string;
  }[]) => boolean;
  onDirectOverridePoolsBatch?: (
    specs: {
      projectName: string;
      poolNo: string;
      orientation: PoolOrientation;
      dimensions: string;
      shape: string;
      poolType: string;
      notes?: string;
      isDelivered?: boolean;
      currentStageIndex: number;
      isPlanned: boolean;
    }[],
    operatorName: string
  ) => boolean;
}

export const PlanningDepartment: React.FC<PlanningDepartmentProps> = ({
  plannedPools,
  pools,
  onAddPlannedPool,
  onAddPlannedPoolBatch,
  onDeletePlannedPool,
  onReleasePlannedPool,
  engineers,
  projectsSummary = [],
  onSaveProjectSummary,
  onDeleteProjectSummary,
  monthlyTargets = [],
  onSaveMonthlyTarget,
  onDirectOverridePool,
  onAddPlannedPoolsList,
  onDirectOverridePoolsBatch
}) => {
  // Navigation tabs within Planning Portal
  const [activeTab, setActiveTab] = useState<'dashboard' | 'registry' | 'all_projects_portal' | 'monthly_targets' | 'quick_launch' | 'direct_stage_portal'>('dashboard');

  // New Project Form State
  const [newProjName, setNewProjName] = useState('');
  const [newProjOrientation, setNewProjOrientation] = useState<PoolOrientation>('Normal');
  const [newProjType, setNewProjType] = useState('Type 3');
  const [newProjTotal, setNewProjTotal] = useState<number>(100);
  const [newProjDelivered, setNewProjDelivered] = useState<number>(0);
  const [newProjProduced, setNewProjProduced] = useState<number>(0);
  const [newProjNotes, setNewProjNotes] = useState('');

  // Selected Monthly Target state for planner form
  const [targetMonthId, setTargetMonthId] = useState('2026-06');
  const [targetMonthName, setTargetMonthName] = useState('June 2026');
  const [targetMainPoolCount, setTargetMainPoolCount] = useState<number>(120);
  const [targetSteelFab, setTargetSteelFab] = useState<number>(140);
  const [targetSteelPrimer, setTargetSteelPrimer] = useState<number>(140);
  const [targetPlumbing, setTargetPlumbing] = useState<number>(130);
  const [targetCladding, setTargetCladding] = useState<number>(130);
  const [targetSkimmerFitting, setTargetSkimmerFitting] = useState<number>(125);
  const [targetLamination, setTargetLamination] = useState<number>(125);
  const [targetMechFitting, setTargetMechFitting] = useState<number>(125);
  const [targetMosaic, setTargetMosaic] = useState<number>(120);
  const [targetGrouting, setTargetGrouting] = useState<number>(120);
  const [targetAcrylic, setTargetAcrylic] = useState<number>(120);
  const [targetOee, setTargetOee] = useState<number>(82);
  const [targetNotes, setTargetNotes] = useState('');

  // Filter project summaries state
  const [summaryFilterOrientation, setSummaryFilterOrientation] = useState<string>('all');
  const [summarySearchQuery, setSummarySearchQuery] = useState<string>('');

  // Expanded projects dictionary for Dashboard breakdown
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});

  // New Single Pool state
  const [singleProject, setSingleProject] = useState('Villa Sapphire Infinity');
  const [customProject, setCustomProject] = useState('');
  const [useCustomProject, setUseCustomProject] = useState(false);
  const [poolNo, setPoolNo] = useState('');
  const [orientation, setOrientation] = useState<PoolOrientation>('Normal');
  const [dimensions, setDimensions] = useState('12m x 5m');
  const [shape, setShape] = useState('Classic Rectangle');
  const [poolType, setPoolType] = useState('Type 3');
  const [planningDate, setPlanningDate] = useState(new Date().toISOString().slice(0, 10));
  const [drawingUrl, setDrawingUrl] = useState<string>('');
  const [notes, setNotes] = useState('');

  // Bulk Pool state
  const [bulkProject, setBulkProject] = useState('Villa Sapphire Infinity');
  const [customBulkProject, setCustomBulkProject] = useState('');
  const [useCustomBulkProject, setUseCustomBulkProject] = useState(false);
  const [prefix, setPrefix] = useState('PL-');
  const [startRange, setStartRange] = useState(1001);
  const [count, setCount] = useState(24);
  const [bulkOrientation, setBulkOrientation] = useState<PoolOrientation>('Normal');
  const [bulkDimensions, setBulkDimensions] = useState('14m x 6m');
  const [bulkShape, setBulkShape] = useState('Infinity Curve');
  const [bulkPoolType, setBulkPoolType] = useState('Type 3');
  const [bulkDrawingUrl, setBulkDrawingUrl] = useState<string>('');
  const [bulkNotes, setBulkNotes] = useState('');

  // Direct override / create portal state variables
  const [directProjectName, setDirectProjectName] = useState('Tiger');
  const [useCustomDirectProject, setUseCustomDirectProject] = useState(false);
  const [customDirectProjectName, setCustomDirectProjectName] = useState('');
  const [selectedPoolIdOrNew, setSelectedPoolIdOrNew] = useState('NEW_POOL');
  const [directPoolNo, setDirectPoolNo] = useState('');
  const [directOrientation, setDirectOrientation] = useState<PoolOrientation>('Normal');
  const [directDimensions, setDirectDimensions] = useState('12m x 5m');
  const [directShape, setDirectShape] = useState('Classic Rectangle');
  const [directPoolType, setDirectPoolType] = useState('Type 3');
  const [directNotes, setDirectNotes] = useState('');
  const [directStageSelect, setDirectStageSelect] = useState('0'); // '0' to STAGES.length - 1, STAGES.length for Completed, 'delivered' for Delivered
  const [directEntryDate, setDirectEntryDate] = useState(new Date().toISOString().slice(0, 10)); // backdate support
  const [overrideOperatorName, setOverrideOperatorName] = useState('Planning Admin');
  const [directSuccessMessage, setDirectSuccessMessage] = useState<string | null>(null);

  // === DIRECT STAGE EXCEL OVERRIDES STATE ===
  const [directExcelFileName, setDirectExcelFileName] = useState<string>('');
  const [directExcelRawHeaders, setDirectExcelRawHeaders] = useState<string[]>([]);
  const [directExcelRawRows, setDirectExcelRawRows] = useState<any[]>([]);
  const [directExcelMapping, setDirectExcelMapping] = useState<Record<string, string>>({
    projectName: '',
    poolNo: '',
    orientation: '',
    dimensions: '',
    shape: '',
    poolType: '',
    status: '',
    notes: ''
  });
  const [isDirectExcelDragActive, setIsDirectExcelDragActive] = useState<boolean>(false);

  // ==========================================
  // EXCEL IMPORTER & EXPORTER INFRASTRUCTURE
  // ==========================================
  const [excelFileName, setExcelFileName] = useState<string>('');
  const [excelRawHeaders, setExcelRawHeaders] = useState<string[]>([]);
  const [excelRawRows, setExcelRawRows] = useState<any[]>([]);
  const [excelImportDate, setExcelImportDate] = useState(new Date().toISOString().slice(0, 10));
  const [excelMapping, setExcelMapping] = useState<Record<string, string>>({
    projectName: '',
    poolNo: '',
    orientation: '',
    dimensions: '',
    shape: '',
    poolType: '',
    notes: ''
  });
  const [isExcelDragActive, setIsExcelDragActive] = useState<boolean>(false);

  const handleExcelUpload = (file: File) => {
    if (!file) return;
    setExcelFileName(file.name);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        if (!data) return;

        const workbook = XLSX.read(data, { type: 'binary' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Convert worksheet to JSON raw rows
        const rawJson: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
        
        if (rawJson.length === 0) {
          alert("The uploaded Excel sheet has no records inside.");
          setExcelFileName('');
          return;
        }

        // Extract raw headers from keys
        const headers = Object.keys(rawJson[0]);
        setExcelRawHeaders(headers);
        setExcelRawRows(rawJson);

        // Smart Automapping: fuzzy match Excel columns with database records
        const detectMapping: Record<string, string> = {
          projectName: '',
          poolNo: '',
          orientation: '',
          dimensions: '',
          shape: '',
          poolType: '',
          notes: ''
        };

        headers.forEach(h => {
          const lower = h.trim().toLowerCase();
          
          if (lower.includes('project') || lower.includes('proj') || lower === 'name' || lower.includes('assoc')) {
            if (!detectMapping.projectName) detectMapping.projectName = h;
          }
          if (lower.includes('pool no') || lower.includes('pool_no') || lower.includes('poolno') || lower.includes('code') || lower.includes('number') || lower.includes('serial') || lower === 'id') {
            if (!detectMapping.poolNo) detectMapping.poolNo = h;
          }
          if (lower.includes('orient') || lower.includes('side') || lower.includes('mirror') || lower.includes('normal')) {
            if (!detectMapping.orientation) detectMapping.orientation = h;
          }
          if (lower.includes('dim') || lower.includes('size') || lower.includes('width') || lower.includes('length') || lower.includes('dimension')) {
            if (!detectMapping.dimensions) detectMapping.dimensions = h;
          }
          if (lower.includes('shape') || lower.includes('form') || lower.includes('mould') || lower.includes('mold')) {
            if (!detectMapping.shape) detectMapping.shape = h;
          }
          if (lower.includes('type') || lower.includes('model')) {
            if (!detectMapping.poolType) detectMapping.poolType = h;
          }
          if (lower.includes('note') || lower.includes('remark') || lower.includes('desc') || lower.includes('comment') || lower.includes('additional')) {
            if (!detectMapping.notes) detectMapping.notes = h;
          }
        });

        // Safe Fallback defaults
        if (!detectMapping.projectName) detectMapping.projectName = headers.find(h => h.toLowerCase().includes('name')) || '';
        if (!detectMapping.poolNo) detectMapping.poolNo = headers.find(h => h.toLowerCase().includes('no') || h.toLowerCase().includes('num') || h.toLowerCase().includes('code')) || '';
        
        setExcelMapping(detectMapping);
      } catch (err) {
        console.error("Error reading spreadsheet: ", err);
        alert("Failed to parse file. Make sure it is a valid .xlsx or .xls file.");
        setExcelFileName('');
      }
    };
    reader.readAsBinaryString(file);
  };

  const previewsImportPools = useMemo(() => {
    if (excelRawRows.length === 0) return [];
    
    return excelRawRows.map((row, idx) => {
      const rawProj = excelMapping.projectName ? row[excelMapping.projectName] : '';
      const rawNo = excelMapping.poolNo ? row[excelMapping.poolNo] : '';
      const rawOrient = excelMapping.orientation ? row[excelMapping.orientation] : '';
      const rawDims = excelMapping.dimensions ? row[excelMapping.dimensions] : '';
      const rawShape = excelMapping.shape ? row[excelMapping.shape] : '';
      const rawType = excelMapping.poolType ? row[excelMapping.poolType] : '';
      const rawNotes = excelMapping.notes ? row[excelMapping.notes] : '';

      const projectName = String(rawProj || '').trim() || 'Excel Import';
      const poolNo = String(rawNo || '').trim().toUpperCase();
      
      let orientation: PoolOrientation = 'Normal';
      const orientLower = String(rawOrient || '').trim().toLowerCase();
      if (
        orientLower.includes('mir') || 
        orientLower === 'm'
      ) {
        orientation = 'Mirror';
      } else {
        orientation = 'Normal';
      }

      const dimensions = String(rawDims || '').trim() || '12m x 5m';
      const shape = String(rawShape || '').trim() || 'Classic Rectangle';
      const poolType = String(rawType || '').trim() || 'Type 3';
      const notes = String(rawNotes || '').trim();

      const isDuplicateInRegister = plannedPools.some(pp => pp.poolNo === poolNo);
      const isDuplicateInFloor = pools.some(p => p.poolNo === poolNo);
      const isInvalid = !poolNo;

      return {
        projectName,
        poolNo,
        orientation,
        dimensions,
        shape,
        poolType,
        notes,
        isDuplicate: isDuplicateInRegister || isDuplicateInFloor,
        isInvalid,
        rawIndex: idx
      };
    });
  }, [excelRawRows, excelMapping, plannedPools, pools]);

  const handlePerformExcelImport = () => {
    if (previewsImportPools.length === 0) return;

    const validImportItems = previewsImportPools.filter(p => !p.isInvalid && !p.isDuplicate);

    if (validImportItems.length === 0) {
      alert("No valid pool designs parsed. All records are either empty on pool codes or exist already on the database.");
      return;
    }

    if (onAddPlannedPoolsList) {
      const success = onAddPlannedPoolsList(validImportItems.map(p => ({
        projectName: p.projectName,
        poolNo: p.poolNo,
        orientation: p.orientation,
        dimensions: p.dimensions,
        shape: p.shape,
        poolType: p.poolType,
        notes: p.notes ? `${p.notes} (Imported)` : 'Imported from Excel spreadsheet',
        createdAt: excelImportDate ? new Date(excelImportDate + 'T08:00:00').toISOString() : new Date().toISOString()
      })));

      if (success) {
        setExcelFileName('');
        setExcelRawHeaders([]);
        setExcelRawRows([]);
      }
    } else {
      alert("Error: Batch import prop callback is missing in this configuration.");
    }
  };

  // === DIRECT STAGE EXCEL OVERRIDES HANDLERS ===
  const handleDirectExcelUpload = (file: File) => {
    if (!file) return;
    setDirectExcelFileName(file.name);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        if (!data) return;

        const workbook = XLSX.read(data, { type: 'binary' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        const rawJson: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
        
        if (rawJson.length === 0) {
          alert("The uploaded Excel sheet has no records inside.");
          setDirectExcelFileName('');
          return;
        }

        const headers = Object.keys(rawJson[0]);
        setDirectExcelRawHeaders(headers);
        setDirectExcelRawRows(rawJson);

        // Smart Automapping for overrides
        const detectMapping: Record<string, string> = {
          projectName: '',
          poolNo: '',
          orientation: '',
          dimensions: '',
          shape: '',
          poolType: '',
          status: '',
          notes: ''
        };

        headers.forEach(h => {
          const lower = h.trim().toLowerCase();
          
          if (lower.includes('project') || lower.includes('proj') || lower === 'name' || lower.includes('assoc')) {
            if (!detectMapping.projectName) detectMapping.projectName = h;
          }
          if (lower.includes('pool no') || lower.includes('pool_no') || lower.includes('poolno') || lower.includes('code') || lower.includes('number') || lower.includes('serial') || lower === 'id') {
            if (!detectMapping.poolNo) detectMapping.poolNo = h;
          }
          if (lower.includes('orient') || lower.includes('side') || lower.includes('mirror') || lower.includes('normal')) {
            if (!detectMapping.orientation) detectMapping.orientation = h;
          }
          if (lower.includes('dim') || lower.includes('size') || lower.includes('width') || lower.includes('length') || lower.includes('dimension')) {
            if (!detectMapping.dimensions) detectMapping.dimensions = h;
          }
          if (lower.includes('shape') || lower.includes('form') || lower.includes('mould') || lower.includes('mold')) {
            if (!detectMapping.shape) detectMapping.shape = h;
          }
          if (lower.includes('type') || lower.includes('model')) {
            if (!detectMapping.poolType) detectMapping.poolType = h;
          }
          if (lower.includes('status') || lower.includes('stage') || lower.includes('state') || lower.includes('progress') || lower.includes('phase')) {
            if (!detectMapping.status) detectMapping.status = h;
          }
          if (lower.includes('note') || lower.includes('remark') || lower.includes('desc') || lower.includes('comment') || lower.includes('additional')) {
            if (!detectMapping.notes) detectMapping.notes = h;
          }
        });

        // Safe Fallback defaults
        if (!detectMapping.projectName) detectMapping.projectName = headers.find(h => h.toLowerCase().includes('name')) || '';
        if (!detectMapping.poolNo) detectMapping.poolNo = headers.find(h => h.toLowerCase().includes('no') || h.toLowerCase().includes('num') || h.toLowerCase().includes('code')) || '';
        if (!detectMapping.status) detectMapping.status = headers.find(h => h.toLowerCase().includes('stat') || h.toLowerCase().includes('stage') || h.toLowerCase().includes('state')) || '';
        
        setDirectExcelMapping(detectMapping);
      } catch (err) {
        console.error("Error reading override spreadsheet: ", err);
        alert("Failed to parse file. Make sure it is a valid .xlsx or .xls file.");
        setDirectExcelFileName('');
      }
    };
    reader.readAsBinaryString(file);
  };

  const resolveStatus = (rawStatus: string) => {
    const s = String(rawStatus || '').trim().toLowerCase();
    
    if (s.includes('plan') || s.includes('not start') || s.includes('not_started') || s.includes('queue') || s.includes('schedule') || s.includes('pre-production') || s.includes('pre_production') || s === '0') {
      return { isPlanned: true, currentStageIndex: 0, isDelivered: false, resolvedName: 'Planned (Pre-Production)' };
    }
    
    if (s.includes('deliver') || s.includes('ship') || s.includes('site') || s.includes('out-of-factory') || s.includes('out of factory') || s.includes('transit')) {
      return { isPlanned: false, currentStageIndex: STAGES.length, isDelivered: true, resolvedName: '🚚 Delivered' };
    }

    // Is there any specific stage keyword matched?
    let matchedStageIndex: number | null = null;
    let matchedStageName = '';

    // Loop through current STAGES
    for (let idx = 0; idx < STAGES.length; idx++) {
      const stage = STAGES[idx];
      const id = stage.id.toLowerCase();
      const idNormalized = id.replace(/_/g, ' ');
      const nameNormalized = stage.name.toLowerCase();
      const label = String(idx + 1);

      if (
        s === label ||
        s === id ||
        s === nameNormalized ||
        s.includes(idNormalized) ||
        s.includes(nameNormalized)
      ) {
        matchedStageIndex = idx;
        matchedStageName = stage.name;
        break;
      }
    }

    // If still no direct match, check hand-crafted fuzzy matches
    if (matchedStageIndex === null) {
      if (s.includes('steel') || s.includes('fab') || s.includes('fabrication')) {
        const foundIdx = STAGES.findIndex(st => st.id === 'steel_fabrication');
        if (foundIdx !== -1) { matchedStageIndex = foundIdx; matchedStageName = STAGES[foundIdx].name; }
      } else if (s.includes('primer') || s.includes('paint') || s.includes('undercoat')) {
        const foundIdx = STAGES.findIndex(st => st.id === 'steel_primer');
        if (foundIdx !== -1) { matchedStageIndex = foundIdx; matchedStageName = STAGES[foundIdx].name; }
      } else if (s.includes('plumb') || s.includes('pipe') || s.includes('water fitting')) {
        const foundIdx = STAGES.findIndex(st => st.id === 'plumbing');
        if (foundIdx !== -1) { matchedStageIndex = foundIdx; matchedStageName = STAGES[foundIdx].name; }
      } else if (s.includes('clad') || s.includes('cladding') || s.includes('chem') || s.includes('chemical')) {
        const foundIdx = STAGES.findIndex(st => st.id === 'cladding');
        if (foundIdx !== -1) { matchedStageIndex = foundIdx; matchedStageName = STAGES[foundIdx].name; }
      } else if (s.includes('skimmer fit') || s.includes('skimer fit') || s.includes('skimeer fit')) {
        const foundIdx = STAGES.findIndex(st => st.id === 'skimmer_fitting');
        if (foundIdx !== -1) { matchedStageIndex = foundIdx; matchedStageName = STAGES[foundIdx].name; }
      } else if (s.includes('lamin') || s.includes('lamination') || s.includes('resin') || s.includes('glass')) {
        const foundIdx = STAGES.findIndex(st => st.id === 'lamination');
        if (foundIdx !== -1) { matchedStageIndex = foundIdx; matchedStageName = STAGES[foundIdx].name; }
      } else if (s.includes('mech') || s.includes('mechanical') || s.includes('out-fitting') || s.includes('outfitting')) {
        const foundIdx = STAGES.findIndex(st => st.id === 'mechanical_fitting');
        if (foundIdx !== -1) { matchedStageIndex = foundIdx; matchedStageName = STAGES[foundIdx].name; }
      } else if (s.includes('skimmer') || s.includes('skim') || s.includes('skimer')) {
        // Fall back to skimmer_test if it contains test/skim, otherwise skimmer_fitting
        const fitIdx = STAGES.findIndex(st => st.id === 'skimmer_fitting');
        const testIdx = STAGES.findIndex(st => st.id === 'skimmer_test');
        if (s.includes('fit') && fitIdx !== -1) {
          matchedStageIndex = fitIdx; matchedStageName = STAGES[fitIdx].name;
        } else if (testIdx !== -1) {
          matchedStageIndex = testIdx; matchedStageName = STAGES[testIdx].name;
        } else if (fitIdx !== -1) {
          matchedStageIndex = fitIdx; matchedStageName = STAGES[fitIdx].name;
        }
      } else if (s.includes('door') || s.includes('cutting') || s.includes('door cut')) {
        const foundIdx = STAGES.findIndex(st => st.id === 'door_cutting');
        if (foundIdx !== -1) { matchedStageIndex = foundIdx; matchedStageName = STAGES[foundIdx].name; }
      } else if (s.includes('mosaic') || s.includes('tile') || s.includes('cosmetic')) {
        const foundIdx = STAGES.findIndex(st => st.id === 'mosaic');
        if (foundIdx !== -1) { matchedStageIndex = foundIdx; matchedStageName = STAGES[foundIdx].name; }
      } else if (s.includes('grout') || s.includes('grawt')) {
        const foundIdx = STAGES.findIndex(st => st.id === 'grouting');
        if (foundIdx !== -1) { matchedStageIndex = foundIdx; matchedStageName = STAGES[foundIdx].name; }
      } else if (s.includes('acrylic') || s.includes('glass window') || s.includes('window fit')) {
        const foundIdx = STAGES.findIndex(st => st.id === 'acrylic');
        if (foundIdx !== -1) { matchedStageIndex = foundIdx; matchedStageName = STAGES[foundIdx].name; }
      }
    }

    // If we have found a matched stage:
    if (matchedStageIndex !== null) {
      const hasCompletionWord = s.includes('done') || s.includes('complete') || s.includes('finish') || s.includes('passed') || s.includes('approve') || s.includes('ok') || s.includes('success');
      
      if (hasCompletionWord) {
        const nextIndex = matchedStageIndex + 1;
        if (nextIndex >= STAGES.length) {
          return { isPlanned: false, currentStageIndex: STAGES.length, isDelivered: false, resolvedName: '🏁 Assembly Done / In Stock' };
        } else {
          return { isPlanned: false, currentStageIndex: nextIndex, isDelivered: false, resolvedName: `Stage ${nextIndex + 1}: ${STAGES[nextIndex].name}` };
        }
      } else {
        return { isPlanned: false, currentStageIndex: matchedStageIndex, isDelivered: false, resolvedName: `Stage ${matchedStageIndex + 1}: ${matchedStageName}` };
      }
    }

    // Generic defaults if no specific stage name matches
    if (s.includes('complete') || s.includes('produce') || s.includes('finish') || s.includes('passed') || s.includes('done') || s.includes('stock') || s === String(STAGES.length) || s.includes('assembly done') || s.includes('produced')) {
      return { isPlanned: false, currentStageIndex: STAGES.length, isDelivered: false, resolvedName: '🏁 Assembly Done / In Stock' };
    }
    
    if (s) {
      return { isPlanned: false, currentStageIndex: 0, isDelivered: false, resolvedName: `Stage 1: ${STAGES[0].name} (Unrecognized/Fuzzy)` };
    }

    return { isPlanned: true, currentStageIndex: 0, isDelivered: false, resolvedName: 'Planned (Default)' };
  };

  const previewsDirectImportPools = useMemo(() => {
    if (directExcelRawRows.length === 0) return [];
    
    return directExcelRawRows.map((row, idx) => {
      const rawProj = directExcelMapping.projectName ? row[directExcelMapping.projectName] : '';
      const rawNo = directExcelMapping.poolNo ? row[directExcelMapping.poolNo] : '';
      const rawOrient = directExcelMapping.orientation ? row[directExcelMapping.orientation] : '';
      const rawDims = directExcelMapping.dimensions ? row[directExcelMapping.dimensions] : '';
      const rawShape = directExcelMapping.shape ? row[directExcelMapping.shape] : '';
      const rawType = directExcelMapping.poolType ? row[directExcelMapping.poolType] : '';
      const rawStatus = directExcelMapping.status ? row[directExcelMapping.status] : '';
      const rawNotes = directExcelMapping.notes ? row[directExcelMapping.notes] : '';

      const projectName = String(rawProj || '').trim() || 'Excel Direct Override';
      const poolNo = String(rawNo || '').trim().toUpperCase();
      
      let orientation: PoolOrientation = 'Normal';
      const orientLower = String(rawOrient || '').trim().toLowerCase();
      if (
        orientLower.includes('mir') || 
        orientLower === 'm'
      ) {
        orientation = 'Mirror';
      } else {
        orientation = 'Normal';
      }

      const dimensions = String(rawDims || '').trim() || '12m x 5m';
      const shape = String(rawShape || '').trim() || 'Classic Rectangle';
      const poolType = String(rawType || '').trim() || 'Type 3';
      const notes = String(rawNotes || '').trim();

      const { isPlanned, currentStageIndex, isDelivered, resolvedName } = resolveStatus(rawStatus);
      const isInvalid = !poolNo;

      return {
        projectName,
        poolNo,
        orientation,
        dimensions,
        shape,
        poolType,
        notes,
        isPlanned,
        currentStageIndex,
        isDelivered,
        resolvedName,
        isInvalid,
        rawIndex: idx
      };
    });
  }, [directExcelRawRows, directExcelMapping]);

  const handlePerformDirectExcelImport = () => {
    if (previewsDirectImportPools.length === 0) return;

    const validItems = previewsDirectImportPools.filter(p => !p.isInvalid);

    if (validItems.length === 0) {
      alert("No valid pool codes parsed to override. Please ensure your Excel file contains valid pool serial numbers.");
      return;
    }

    if (onDirectOverridePoolsBatch) {
      const success = onDirectOverridePoolsBatch(
        validItems.map(p => ({
          projectName: p.projectName,
          poolNo: p.poolNo,
          orientation: p.orientation,
          dimensions: p.dimensions,
          shape: p.shape,
          poolType: p.poolType,
          notes: p.notes ? `${p.notes} (Excel Sync Overrides)` : 'Synchronized via Direct Override Excel Sheet',
          isDelivered: p.isDelivered,
          currentStageIndex: p.currentStageIndex,
          isPlanned: p.isPlanned
        })),
        overrideOperatorName || 'Direct Stage Planner Office'
      );

      if (success) {
        setDirectSuccessMessage(`Batch sync completed! Overwrote/Instantiated status overrides for ${validItems.length} pool units successfully.`);
        setTimeout(() => setDirectSuccessMessage(null), 5000);
        
        setDirectExcelFileName('');
        setDirectExcelRawHeaders([]);
        setDirectExcelRawRows([]);
      }
    } else {
      alert("Error: Batch Direct Override callback is missing in this configuration.");
    }
  };

  const downloadExcelProgressReport = () => {
    try {
      // 1. Overall Lifecycle Summary
      const totalPlanned = plannedPools.filter(p => p.status === 'PLANNED').length;
      const underProcess = pools.filter(p => !p.completedAt).length;
      const completedInStock = pools.filter(p => p.completedAt && !p.isDelivered).length;
      const delivered = pools.filter(p => p.isDelivered).length;
      const grandTotal = plannedPools.length + pools.filter(p => !plannedPools.some(pp => pp.poolNo === p.poolNo)).length;

      const executiveSummaryData = [
        { "Key Performance Metric": "Total Combined Pool Database Size", "Pools Count": grandTotal, "Percentage": "100.0%", "Operational Status / Note": "Includes all planned register blocks and active/completed floor pools" },
        { "Key Performance Metric": "Pre-Planned In Scheduler Queue", "Pools Count": totalPlanned, "Percentage": grandTotal > 0 ? `${((totalPlanned / grandTotal) * 100).toFixed(1)}%` : "0.0%", "Operational Status / Note": "Pre-registered specs. Awaiting release dispatcher to click dispatch" },
        { "Key Performance Metric": "Active Under Process on Shop Floor", "Pools Count": underProcess, "Percentage": grandTotal > 0 ? `${((underProcess / grandTotal) * 100).toFixed(1)}%` : "0.0%", "Operational Status / Note": "Actively traversing production line stages" },
        { "Key Performance Metric": "Completed (Passed QC, In Stock)", "Pools Count": completedInStock, "Percentage": grandTotal > 0 ? `${((completedInStock / grandTotal) * 100).toFixed(1)}%` : "0.0%", "Operational Status / Note": "Passed final QC check. Awaiting delivery shipping" },
        { "Key Performance Metric": "Fully Shipped & Delivered to Client Site", "Pools Count": delivered, "Percentage": grandTotal > 0 ? `${((delivered / grandTotal) * 100).toFixed(1)}%` : "0.0%", "Operational Status / Note": "Client delivered, pipeline flow terminated" }
      ];

      // 2. Stage-Wise pending active counts
      const stageBacklogs = STAGES.map((stage, idx) => {
        const count = pools.filter(p => !p.completedAt && p.currentStageIndex === idx).length;
        return {
          "Stage Sequence ID": `Stage ${idx + 1}`,
          "Production Division": stage.name,
          "Pending / Active Load (Pools)": count,
          "Section Percent of Floor Workload": underProcess > 0 ? `${((count / underProcess) * 100).toFixed(1)}%` : "0.0%",
          "Target Backlog Critical Code": count > 5 ? "HIGH" : count > 2 ? "WARN" : "NORMAL"
        };
      });

      // 3. Monthly Metrics compiler
      const monthlySummary: Record<string, { spawned: number; completed: number; delivered: number }> = {};
      const parseMonth = (isoString?: string | null) => {
        if (!isoString) return null;
        try {
          const d = new Date(isoString);
          if (isNaN(d.getTime())) return null;
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          return `${y}-${m}`;
        } catch (_) {
          return null;
        }
      };

      // Populate planned pools monthly release
      plannedPools.forEach(p => {
        const m = parseMonth(p.createdAt);
        if (m) {
          if (!monthlySummary[m]) monthlySummary[m] = { spawned: 0, completed: 0, delivered: 0 };
          monthlySummary[m].spawned++;
        }
      });

      pools.forEach(p => {
        if (!plannedPools.some(pp => pp.poolNo === p.poolNo)) {
          const m = parseMonth(p.createdAt);
          if (m) {
            if (!monthlySummary[m]) monthlySummary[m] = { spawned: 0, completed: 0, delivered: 0 };
            monthlySummary[m].spawned++;
          }
        }
        if (p.completedAt) {
          const mComp = parseMonth(p.completedAt);
          if (mComp) {
            if (!monthlySummary[mComp]) monthlySummary[mComp] = { spawned: 0, completed: 0, delivered: 0 };
            monthlySummary[mComp].completed++;
          }
        }
        if (p.deliveredAt || (p.isDelivered && p.completedAt)) {
          const mDel = parseMonth(p.deliveredAt || p.completedAt);
          if (mDel) {
            if (!monthlySummary[mDel]) monthlySummary[mDel] = { spawned: 0, completed: 0, delivered: 0 };
            monthlySummary[mDel].delivered++;
          }
        }
      });

      const monthlyReportData = Object.entries(monthlySummary)
        .sort((a,b) => b[0].localeCompare(a[0]))
        .map(([mId, counts]) => {
          const [y, mStr] = mId.split('-');
          const monthsNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
          const mName = monthsNames[parseInt(mStr) - 1] || mStr;
          return {
            "Month Calendar Year": `${mName} ${y}`,
            "New Pools Registered": counts.spawned,
            "Pools Fully Completed": counts.completed,
            "Pools Delivered to Cleared Sites": counts.delivered,
            "Active Conversion Ratio": counts.spawned > 0 ? `${((counts.completed / counts.spawned) * 100).toFixed(1)}%` : "N/A"
          };
        });

      // 4. Combined detailed backup list of records
      const detailedPoolsList = [
        ...pools.map(p => {
          const isCompleted = !!p.completedAt;
          const statusStr = p.isDelivered ? "Delivered" : isCompleted ? "Completed (In Stock)" : "In Production";
          const currentStageName = isCompleted ? "Completed" : (STAGES[p.currentStageIndex]?.name || "Pre-Production");
          return {
            "Pool Code (Number)": p.poolNo,
            "Project Association": p.projectName,
            "Pool Type": p.poolType || "Type 3",
            "Mould Shape": p.shape,
            "Dimensions Size": p.dimensions,
            "Orientation Layout": p.orientation,
            "Current Shop Stage": currentStageName,
            "Overall Status": statusStr,
            "Creation Date (Stamp)": p.createdAt ? p.createdAt.split('T')[0] : '',
            "Completion Date": p.completedAt ? p.completedAt.split('T')[0] : 'N/A',
            "Delivery Date": p.deliveredAt ? p.deliveredAt.split('T')[0] : (p.isDelivered && p.completedAt ? p.completedAt.split('T')[0] : 'N/A'),
            "Operator Remarks": p.notes || ''
          };
        }),
        ...plannedPools.filter(p => p.status === 'PLANNED').map(p => ({
          "Pool Code (Number)": p.poolNo,
          "Project Association": p.projectName,
          "Pool Type": p.poolType || "Type 1",
          "Mould Shape": p.shape,
          "Dimensions Size": p.dimensions,
          "Orientation Layout": p.orientation,
          "Current Shop Stage": "Planning Queue (Pre-Planned)",
          "Overall Status": "Planned",
          "Creation Date (Stamp)": p.createdAt ? p.createdAt.split('T')[0] : '',
          "Completion Date": 'N/A',
          "Delivery Date": 'N/A',
          "Operator Remarks": p.notes || ''
        }))
      ];

      // Build workbooks and worksheets
      const wb = XLSX.utils.book_new();

      const wsExec = XLSX.utils.json_to_sheet(executiveSummaryData);
      XLSX.utils.book_append_sheet(wb, wsExec, "Executive KPI Summary");

      const wsStages = XLSX.utils.json_to_sheet(stageBacklogs);
      XLSX.utils.book_append_sheet(wb, wsStages, "Stage Backlogs Analysis");

      const wsMonthly = XLSX.utils.json_to_sheet(monthlyReportData);
      XLSX.utils.book_append_sheet(wb, wsMonthly, "Monthly Performance Target");

      const wsDetailed = XLSX.utils.json_to_sheet(detailedPoolsList);
      XLSX.utils.book_append_sheet(wb, wsDetailed, "Global Records Database");

      // Save spreadsheet
      XLSX.writeFile(wb, `ApexPools_Overall_Progress_Report_2026.xlsx`);
    } catch (e) {
      console.error(e);
      alert("Error compilation spreadsheet report failed!");
    }
  };

  // Compute list of unique projects from projectsSummary, pools, and plannedPools
  const allUniqueProjects = useMemo(() => {
    const setOfProjects = new Set<string>();
    if (projectsSummary) {
      projectsSummary.forEach(p => { if (p.projectName) setOfProjects.add(p.projectName); });
    }
    if (pools) {
      pools.forEach(p => { if (p.projectName) setOfProjects.add(p.projectName); });
    }
    if (plannedPools) {
      plannedPools.forEach(p => { if (p.projectName) setOfProjects.add(p.projectName); });
    }
    if (setOfProjects.size === 0) {
      setOfProjects.add('Tiger');
      setOfProjects.add('Panther Elite');
    }
    return Array.from(setOfProjects);
  }, [projectsSummary, pools, plannedPools]);

  // Compute active lists of pools for selected project name
  const effectiveProjectName = useCustomDirectProject ? customDirectProjectName : directProjectName;
  const projectSpecificPools = useMemo(() => {
    return pools.filter(p => p.projectName.toLowerCase() === effectiveProjectName.toLowerCase());
  }, [pools, effectiveProjectName]);

  // Handle auto-population of pool details on select
  React.useEffect(() => {
    if (selectedPoolIdOrNew !== 'NEW_POOL') {
      const selectedPool = projectSpecificPools.find(p => p.id === selectedPoolIdOrNew);
      if (selectedPool) {
        setDirectPoolNo(selectedPool.poolNo);
        setDirectOrientation(selectedPool.orientation);
        setDirectDimensions(selectedPool.dimensions);
        setDirectShape(selectedPool.shape);
        setDirectPoolType(selectedPool.poolType || 'Type 3');
        setDirectNotes(selectedPool.notes || '');
        if (selectedPool.isDelivered) {
          setDirectStageSelect('delivered');
        } else {
          setDirectStageSelect(String(selectedPool.currentStageIndex));
        }
      }
    } else {
      setDirectPoolNo('');
      setDirectOrientation('Normal');
      setDirectDimensions('12m x 5m');
      setDirectShape('Classic Rectangle');
      setDirectPoolType('Type 3');
      setDirectNotes('');
      setDirectStageSelect('0');
    }
  }, [selectedPoolIdOrNew, projectSpecificPools]);

  // Blueprint SVG CAD mock generator
  const generateBlueprintSVG = (mouldShape: string, designOrientation: string, typeName: string) => {
    return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="100%" height="100%">
      <rect width="100%" height="100%" fill="%231e3a8a"/>
      <defs>
        <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="%233b82f6" stroke-width="0.5" stroke-opacity="0.3"/>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(%23grid)"/>
      <rect x="20" y="20" width="360" height="260" fill="none" stroke="%2360a5fa" stroke-width="2" stroke-dasharray="5,5"/>
      <rect x="250" y="210" width="120" height="60" fill="%23172554" stroke="%2360a5fa" stroke-width="1.5"/>
      <text x="260" y="225" fill="%2393c5fd" font-family="monospace" font-size="8" font-weight="bold">SCALE: 1:50</text>
      <text x="260" y="240" fill="%2393c5fd" font-family="monospace" font-size="8" font-weight="bold">TYPE: ${typeName}</text>
      <text x="260" y="255" fill="%2393c5fd" font-family="monospace" font-size="8" font-weight="bold">DESIGN: ${designOrientation}</text>
      <text x="260" y="265" fill="%2393c5fd" font-family="sans-serif" font-size="5">AUTOMATIC BLUEPRINT v1.0</text>
      
      <g transform="translate(150, 120)">
        ${
          mouldShape.toLowerCase().includes('rectangle') || mouldShape.toLowerCase().includes('lap')
            ? `%3Crect x="-80" y="-45" width="160" height="90" rx="4" fill="%232563eb" fill-opacity="0.6" stroke="%2393c5fd" stroke-width="2.5"/%3E
               %3Crect x="-70" y="-35" width="140" height="70" rx="2" fill="none" stroke="%2360a5fa" stroke-width="1" stroke-dasharray="2,2"/%3E
               %3Cpath d="M -80 -45 L -50 -45 L -50 -15 L -80 -15 Z" fill="none" stroke="%2393c5fd" stroke-width="1.5"/%3E`
            : mouldShape.toLowerCase().includes('curve') || mouldShape.toLowerCase().includes('infinity')
            ? `%3Cpath d="M -80 -30 C -40 -60 40 -60 80 -30 C 90 0 90 40 80 50 C 40 30 -40 30 -80 50 Z" fill="%232563eb" fill-opacity="0.6" stroke="%2393c5fd" stroke-width="2.5"/%3E`
            : `%3Cpath d="M -60 -40 A 50 50 0 0 1 60 -40 C 70 0 30 50 0 50 C -30 50 -70 0 -60 -40 Z" fill="%232563eb" fill-opacity="0.6" stroke="%2393c5fd" stroke-width="2.5"/%3E`
        }
        <line x1="-110" y1="0" x2="110" y2="0" stroke="%2360a5fa" stroke-width="1" stroke-dasharray="8,8" stroke-opacity="0.5"/>
        <line x1="0" y1="-75" x2="0" y2="75" stroke="%2360a5fa" stroke-width="1" stroke-dasharray="8,8" stroke-opacity="0.5"/>
        <text x="-40" y="70" fill="%2393c5fd" font-family="monospace" font-size="8" font-weight="bold">${mouldShape}</text>
      </g>
      <text x="25" y="45" fill="%2393c5fd" font-family="sans-serif" font-size="11" font-weight="extrabold">TECHNICAL SPECIFICATION SHEET</text>
      <line x1="25" y1="52" x2="230" y2="52" stroke="%2360a5fa" stroke-width="1.5"/>
    </svg>`;
  };

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilterProject, setSelectedFilterProject] = useState<string>('all');
  const [selectedFilterOrientation, setSelectedFilterOrientation] = useState<string>('all');
  const [selectedFilterStatus, setSelectedFilterStatus] = useState<string>('all');

  // Release dialog state
  const [releasingPlanId, setReleasingPlanId] = useState<string | null>(null);
  const [selectedEngineerId, setSelectedEngineerId] = useState(engineers[0]?.id || '');

  // Calculate unique projects list from all pre-planned pools
  const knownProjects = useMemo(() => {
    const list = new Set<string>();
    plannedPools.forEach(p => list.add(p.projectName));
    // Seed some defaults if initially empty
    if (list.size === 0) {
      list.add('Villa Sapphire Infinity');
      list.add('Lagoon Leisure Lap Pool');
      list.add('Oasis Resort Main Pool');
      list.add('Oceanic Horizon Estates');
    }
    return Array.from(list);
  }, [plannedPools]);

  // Handle single pool submission
  const onSubmitSingle = (e: React.FormEvent) => {
    e.preventDefault();
    if (!poolNo.trim()) {
      alert('Please specify a valid Pool Serial Number.');
      return;
    }

    const finalProject = useCustomProject ? customProject.trim() : singleProject;
    if (!finalProject) {
      alert('Please select or specify a project name.');
      return;
    }

    // Fallback blueprint dynamically generated if no file was uploaded
    const assignedDrawing = drawingUrl || generateBlueprintSVG(shape, orientation, poolType || 'Type 3');

    const success = onAddPlannedPool({
      projectName: finalProject,
      poolNo: poolNo.trim(),
      orientation,
      dimensions,
      shape,
      poolType: poolType.trim() || 'Type 3',
      drawingUrl: assignedDrawing,
      notes: notes.trim(),
      createdAt: planningDate ? new Date(planningDate + 'T08:00:00').toISOString() : new Date().toISOString()
    });

    if (success) {
      setPoolNo('');
      setNotes('');
      setDrawingUrl('');
      if (useCustomProject) {
        setCustomProject('');
        setUseCustomProject(false);
      }
      setActiveTab('registry');
    }
  };

  // Handle bulk submission
  const onSubmitBulk = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prefix.trim()) {
      alert('Please specify a serial designation prefix (e.g., PL-).');
      return;
    }
    if (count <= 0) {
      alert('Generation count must be greater than zero.');
      return;
    }
    if (count > 500) {
      alert('For performance, maximum batch size is 500 pools per click.');
      return;
    }

    const finalProject = useCustomBulkProject ? customBulkProject.trim() : bulkProject;
    if (!finalProject) {
      alert('Please select or specify a project name.');
      return;
    }

    // Fallback blueprint dynamically generated if no file was uploaded
    const assignedDrawing = bulkDrawingUrl || generateBlueprintSVG(bulkShape, bulkOrientation, bulkPoolType || 'Type 3');

    onAddPlannedPoolBatch({
      projectName: finalProject,
      prefix: prefix.trim().toUpperCase(),
      startRange,
      count,
      orientation: bulkOrientation,
      dimensions: bulkDimensions,
      shape: bulkShape,
      poolType: bulkPoolType.trim() || 'Type 3',
      drawingUrl: assignedDrawing,
      notes: bulkNotes.trim()
    });

    setStartRange(prev => prev + count);
    setBulkDrawingUrl('');
    if (useCustomBulkProject) {
      setCustomBulkProject('');
      setUseCustomBulkProject(false);
    }
    setActiveTab('registry');
  };

  // Quick launch release flow
  const handleOpenReleaseDialog = (planId: string) => {
    setReleasingPlanId(planId);
  };

  const handleConfirmRelease = () => {
    if (!releasingPlanId) return;
    const staff = engineers.find(e => e.id === selectedEngineerId);
    const successId = onReleasePlannedPool(releasingPlanId, staff?.name || 'Planning Office');
    
    if (successId) {
      setReleasingPlanId(null);
    }
  };

  // Live progress checks: locate matched live pool cards
  // and resolve their active stage name & color metrics
  const poolLiveProgressMap = useMemo(() => {
    const map: Record<string, { currentStageName: string; progressPercent: number; isCompleted: boolean }> = {};
    
    plannedPools.forEach(plan => {
      if (plan.status === 'RELEASED' && plan.releasedPoolId) {
        const livePool = pools.find(p => p.id === plan.releasedPoolId);
        if (livePool) {
          const isDone = livePool.completedAt !== null || livePool.currentStageIndex >= STAGES.length;
          let stageName = 'Dispatched';
          let progress = 0;
          
          if (isDone) {
            stageName = 'Assembly Complete';
            progress = 100;
          } else {
            const curStage = STAGES[livePool.currentStageIndex];
            if (curStage) {
              stageName = curStage.name;
              progress = Math.round((livePool.currentStageIndex / STAGES.length) * 100);
            }
          }

          map[plan.id] = {
            currentStageName: stageName,
            progressPercent: progress,
            isCompleted: isDone
          };
        } else {
          map[plan.id] = {
            currentStageName: 'Assembly Queue',
            progressPercent: 5,
            isCompleted: false
          };
        }
      } else if (plan.status === 'COMPLETED') {
        map[plan.id] = {
          currentStageName: 'Finished / Shipped',
          progressPercent: 100,
          isCompleted: true
        };
      }
    });

    return map;
  }, [plannedPools, pools]);

  // Dashboard Aggregator Data
  const dashboardStats = useMemo(() => {
    const total = plannedPools.length;
    let mirrorCount = 0;
    let normalCount = 0;
    let countPlanned = 0;
    let countReleased = 0;
    let countCompleted = 0;

    const projectStats: Record<string, {
      total: number;
      mirror: number;
      normal: number;
      planned: number;
      released: number;
      completed: number;
      types: Record<string, { total: number; normal: number; mirror: number }>;
    }> = {};

    plannedPools.forEach(p => {
      // General orientation stats
      if (p.orientation === 'Mirror') mirrorCount++;
      else normalCount++;

      // General lifecycle status
      if (p.status === 'PLANNED') countPlanned++;
      else if (p.status === 'RELEASED') {
        const liveAssoc = pools.find(lp => lp.id === p.releasedPoolId);
        if (liveAssoc && liveAssoc.completedAt) {
          countCompleted++;
        } else {
          countReleased++;
        }
      } else if (p.status === 'COMPLETED') {
        countCompleted++;
      }

      // Project level breakdown
      if (!projectStats[p.projectName]) {
        projectStats[p.projectName] = { 
          total: 0, 
          mirror: 0, 
          normal: 0, 
          planned: 0, 
          released: 0, 
          completed: 0,
          types: {}
        };
      }
      const pStat = projectStats[p.projectName];
      pStat.total++;
      if (p.orientation === 'Mirror') pStat.mirror++;
      else pStat.normal++;

      const typeKey = p.poolType || 'Type 1';
      if (!pStat.types[typeKey]) {
        pStat.types[typeKey] = { total: 0, normal: 0, mirror: 0 };
      }
      pStat.types[typeKey].total++;
      if (p.orientation === 'Mirror') pStat.types[typeKey].mirror++;
      else pStat.types[typeKey].normal++;

      if (p.status === 'PLANNED') pStat.planned++;
      else if (p.status === 'RELEASED') {
        const liveAssoc = pools.find(lp => lp.id === p.releasedPoolId);
        if (liveAssoc && liveAssoc.completedAt) {
          pStat.completed++;
        } else {
          pStat.released++;
        }
      } else if (p.status === 'COMPLETED') {
        pStat.completed++;
      }
    });

    return {
      total,
      mirrorCount,
      normalCount,
      countPlanned,
      countReleased,
      countCompleted,
      projectStats
    };
  }, [plannedPools, pools]);

  // Filter and search calculations
  const filteredPlannedPools = useMemo(() => {
    return plannedPools.filter(p => {
      // 1. Search Query Match
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const numMatch = p.poolNo.toLowerCase().includes(q);
        const shapeMatch = p.shape.toLowerCase().includes(q);
        const prjMatch = p.projectName.toLowerCase().includes(q);
        if (!numMatch && !shapeMatch && !prjMatch) return false;
      }

      // 2. Project Filter Match
      if (selectedFilterProject !== 'all' && p.projectName !== selectedFilterProject) {
        return false;
      }

      // 3. Orientation Filter Match
      if (selectedFilterOrientation !== 'all' && p.orientation !== selectedFilterOrientation) {
        return false;
      }

      // 4. Status Filter Match
      if (selectedFilterStatus !== 'all') {
        if (selectedFilterStatus === 'PLANNED' && p.status !== 'PLANNED') return false;
        if (selectedFilterStatus === 'RELEASED' && p.status !== 'RELEASED') return false;
        if (selectedFilterStatus === 'COMPLETED' && p.status !== 'COMPLETED') return false;
      }

      return true;
    });
  }, [plannedPools, searchQuery, selectedFilterProject, selectedFilterOrientation, selectedFilterStatus]);

  return (
    <div id="planning-department-section" className="space-y-6">
      
      {/* Upper Title Area */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-100 shadow-xs">
        <div>
          <h2 className="text-2xl font-black text-slate-800 tracking-tight font-sans flex items-center gap-2">
            <Layers className="h-6 w-6 text-indigo-650 text-indigo-600" />
            Planning Department Control Portal
          </h2>
          <p className="text-sm text-slate-500 max-w-2xl mt-1">
            Build layout plans, pre-register project requirements in bulk, audit mirror/normal design ratios, and push scheduled targets down onto the factory active production lanes.
          </p>
        </div>

        {/* Action Quick Links tabs */}
        <div className="flex bg-slate-100 p-1 rounded-xl shrink-0 self-start md:self-center">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`px-4 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
              activeTab === 'dashboard'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-805 hover:bg-slate-200'
            }`}
          >
            Dashboard Analytics
          </button>
          <button
            onClick={() => setActiveTab('all_projects_portal')}
            className={`px-3 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
              activeTab === 'all_projects_portal'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-805 hover:bg-slate-200'
            }`}
            id="tab-all-projects-portal"
          >
            All Projects Portal
          </button>
          <button
            onClick={() => setActiveTab('monthly_targets')}
            className={`px-3 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
              activeTab === 'monthly_targets'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-805 hover:bg-slate-200'
            }`}
            id="tab-kpi-targets-scheduler"
          >
            KPI Targets Scheduler
          </button>
          <button
            onClick={() => setActiveTab('registry')}
            className={`px-3 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
              activeTab === 'registry'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-810 hover:bg-slate-200'
            }`}
          >
            Inventory Registry ({plannedPools.length})
          </button>
          <button
            onClick={() => setActiveTab('quick_launch')}
            className={`px-3 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
              activeTab === 'quick_launch'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-805 hover:bg-slate-200'
            }`}
          >
            + Create / Batch Spawner
          </button>
          <button
            onClick={() => setActiveTab('direct_stage_portal')}
            className={`px-3 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'direct_stage_portal'
                ? 'bg-indigo-650 text-white shadow-xs bg-indigo-600'
                : 'text-slate-600 hover:text-slate-805 hover:bg-slate-200'
            }`}
            id="tab-direct-stage-portal"
          >
            🕹️ Direct Stage & Status Updater
          </button>
        </div>
      </div>

      {/* RENDER ACTIVE TAB */}

      {/* ====== TAB 1: DASHBOARD ====== */}
      {activeTab === 'dashboard' && (
        <div className="space-y-6 animate-fadeIn">
          
          {/* Bento Grid Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
            
            <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-inner flex items-center gap-4">
              <div className="bg-indigo-50 p-3 rounded-xl text-indigo-600">
                <Layers className="h-6 w-6" />
              </div>
              <div>
                <span className="text-xs font-bold text-slate-400 block uppercase tracking-wider mb-0.5">Total Planned</span>
                <span className="text-3xl font-black text-slate-800 leading-none">{dashboardStats.total}</span>
                <span className="text-[10px] text-slate-400 block mt-1">Hulls pre-registered</span>
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-inner flex items-center gap-4">
              <div className="bg-cyan-50 p-3 rounded-xl text-cyan-600">
                <Activity className="h-6 w-6" />
              </div>
              <div>
                <span className="text-xs font-bold text-slate-400 block uppercase tracking-wider mb-0.5">In Production</span>
                <span className="text-3xl font-black text-slate-800 leading-none">{dashboardStats.countReleased}</span>
                <span className="text-[10px] text-emerald-600 block mt-1 font-bold">
                  {dashboardStats.total > 0 ? Math.round((dashboardStats.countReleased / dashboardStats.total) * 100) : 0}% active load
                </span>
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-inner flex items-center gap-4">
              <div className="bg-violet-50 p-3 rounded-xl text-violet-600">
                <BarChart3 className="h-6 w-6" />
              </div>
              <div>
                <span className="text-xs font-bold text-slate-400 block uppercase tracking-wider mb-0.5">Ratio Ratios</span>
                <div className="text-lg font-black text-slate-800 leading-tight">
                  <span className="text-indigo-600">{dashboardStats.mirrorCount} Mirror</span>
                  <span className="text-slate-350 mx-1">/</span>
                  <span className="text-slate-500">{dashboardStats.normalCount} Norm</span>
                </div>
                <span className="text-[10px] text-slate-400 block mt-1">
                  {dashboardStats.total > 0 ? Math.round((dashboardStats.mirrorCount / dashboardStats.total) * 100) : 0}% Mirror design orientation
                </span>
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-inner flex items-center gap-4">
              <div className="bg-emerald-50 p-3 rounded-xl text-emerald-600">
                <CheckCircle className="h-6 w-6" />
              </div>
              <div>
                <span className="text-xs font-bold text-slate-400 block uppercase tracking-wider mb-0.5">Fully Completed</span>
                <span className="text-3xl font-black text-slate-805 text-slate-800 leading-none">{dashboardStats.countCompleted}</span>
                <span className="text-[10px] text-emerald-605 text-emerald-600 block mt-1 font-bold">
                  {dashboardStats.total > 0 ? Math.round((dashboardStats.countCompleted / dashboardStats.total) * 100) : 0}% completion yields
                </span>
              </div>
            </div>

          </div>

          {/* Project Wise Details Table */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-xs overflow-hidden">
            <div className="bg-slate-50 py-4 px-6 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <h3 className="font-black text-slate-80 w text-slate-800 text-sm font-sans tracking-wide">
                  Project Portfolio Design Auditing
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">Aggregates and filters design specifications by connected development project groups</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={downloadExcelProgressReport}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold px-3.5 py-1.5 rounded-xl text-xs flex items-center gap-1.5 duration-150 shadow-xs cursor-pointer"
                  title="Download overall progress and stats report as Excel (.xlsx)"
                >
                  <FileSpreadsheet className="h-4.5 w-4.5" />
                  <span>Download Excel Progress Report</span>
                </button>
                <span className="bg-indigo-100 text-indigo-700 font-bold px-2.5 py-1.5 text-xs rounded-xl uppercase tracking-wider block">
                  {Object.keys(dashboardStats.projectStats).length} Connected Projects
                </span>
              </div>
            </div>

            {Object.keys(dashboardStats.projectStats).length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs">
                No project planning summaries are loaded. Navigate to "Create / Batch Spawner" to register pools.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-650">
                  <thead className="bg-slate-100/30 text-slate-500 uppercase tracking-wider leading-none border-b border-slate-100 text-[10px] font-bold">
                    <tr>
                      <th className="py-3 px-6">Project Title & Scope</th>
                      <th className="py-3 px-4">Register Pools</th>
                      <th className="py-3 px-4">Mirror Orientation</th>
                      <th className="py-3 px-4">Normal Orientation</th>
                      <th className="py-3 px-4">Planned/Queue</th>
                      <th className="py-3 px-4">Active Production</th>
                      <th className="py-3 px-4">Fitted / Complete</th>
                      <th className="py-3 px-6 text-right">Fitted Yield Ratio</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {Object.entries(dashboardStats.projectStats).map(([projName, val]) => {
                      const stats = val as {
                        total: number;
                        mirror: number;
                        normal: number;
                        planned: number;
                        released: number;
                        completed: number;
                        types: Record<string, { total: number; normal: number; mirror: number }>;
                      };
                      const yieldPercent = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;
                      const isExpanded = !!expandedProjects[projName];
                      const totalTypes = Object.keys(stats.types).length;

                      return (
                        <React.Fragment key={projName}>
                          <tr 
                            onClick={() => setExpandedProjects(prev => ({ ...prev, [projName]: !prev[projName] }))}
                            className="hover:bg-slate-50/75 transition-colors cursor-pointer"
                          >
                            <td className="py-4 px-6 font-bold text-slate-800 text-[13px] flex items-center gap-2">
                              <span className="text-slate-400 font-bold font-mono">
                                {isExpanded ? '▼' : '►'}
                              </span>
                              <div>
                                <span className="hover:underline text-indigo-700">{projName}</span>
                                <span className="block text-[10px] text-slate-400 font-bold uppercase mt-0.5 font-mono">
                                  {totalTypes} Design Type{totalTypes !== 1 ? 's' : ''} Listed
                                </span>
                              </div>
                            </td>
                            <td className="py-4 px-4 font-mono font-medium">{stats.total}</td>
                            <td className="py-4 px-4">
                              <span className="bg-indigo-50 text-indigo-700 font-bold px-2 py-0.5 rounded font-mono">
                                {stats.mirror} ({stats.total > 0 ? Math.round((stats.mirror / stats.total) * 100) : 0}%)
                              </span>
                            </td>
                            <td className="py-4 px-4 font-mono text-slate-505">
                              {stats.normal} ({stats.total > 0 ? Math.round((stats.normal / stats.total) * 100) : 0}%)
                            </td>
                            <td className="py-4 px-4 text-slate-400 font-mono">{stats.planned}</td>
                            <td className="py-4 px-4 font-mono text-cyan-600 font-bold">{stats.released}</td>
                            <td className="py-4 px-4 font-mono text-emerald-600 font-bold">{stats.completed}</td>
                            <td className="py-4 px-6 text-right font-bold">
                              <div className="flex items-center justify-end gap-2.5">
                                <span className="text-slate-700">{yieldPercent}%</span>
                                <div className="w-16 bg-slate-100 h-2.5 rounded-full overflow-hidden inline-block hidden md:inline-block">
                                  <div 
                                    className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                                    style={{ width: `${yieldPercent}%` }}
                                  />
                                </div>
                              </div>
                            </td>
                          </tr>

                          {isExpanded && (
                            <tr className="bg-slate-50/60">
                              <td colSpan={8} className="py-3 px-8 border-t border-b border-slate-105/90 text-left">
                                <div className="space-y-2.5">
                                  <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                                      Configuration breakdown by pool type in {projName}
                                    </span>
                                    <span className="text-[9.5px] font-bold text-slate-400">
                                      Total Types: {totalTypes}
                                    </span>
                                  </div>
                                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 pt-1">
                                    {Object.entries(stats.types).map(([typeName, tStat]) => (
                                      <div key={typeName} className="bg-white p-3 rounded-xl border border-slate-200/60 shadow-xs flex flex-col justify-between">
                                        <div>
                                          <span className="bg-indigo-50 text-indigo-700 font-black text-[9.5px] px-1.5 py-0.5 rounded uppercase tracking-wider block w-fit">
                                            {typeName}
                                          </span>
                                          <div className="text-[14px] font-extrabold text-slate-800 mt-1.5">
                                            {tStat.total} <span className="text-[10px] text-slate-400 font-medium font-sans">Moulds</span>
                                          </div>
                                        </div>
                                        <div className="space-y-1 mt-2 pt-1.5 border-t border-slate-50 text-[10px]">
                                          <div className="flex justify-between font-bold text-indigo-600">
                                            <span>Mirror (R):</span>
                                            <span>{tStat.mirror}</span>
                                          </div>
                                          <div className="flex justify-between font-medium text-slate-500">
                                            <span>Normal (L):</span>
                                            <span>{tStat.normal}</span>
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Quick Informational Notice block */}
          <div className="bg-indigo-50 border border-indigo-100/60 p-5 rounded-2xl flex items-start gap-4 text-xs text-indigo-800">
            <Info className="h-5 w-5 text-indigo-500 shrink-0 mt-0.5" />
            <div className="space-y-1 leading-relaxed">
              <strong className="text-[13px] text-indigo-955 block font-sans">Did you know? (Production Line Direct Pulling)</strong>
              <p>
                Pre-planning pools here eliminates manual data entry on the shop floor! When a <strong>Production Engineer</strong> wants to release a new pool to the floor, they can select and claim any pre-planned pool code registered here. The system instantiates a matched real-time tracking card on the assembly floor queue automatically, syncing state from then on.
              </p>
            </div>
          </div>

        </div>
      )}

      {/* ====== TAB 2: INVENTORY REGISTRY ====== */}
      {activeTab === 'registry' && (
        <div className="space-y-6 animate-fadeIn">
          
          {/* Search, Filter & Quick Stats Toolbar */}
          <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            
            {/* Search Box inputs */}
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search register pool codes, shape or project scopes..."
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 py-2.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            {/* Dropdown Filters group */}
            <div className="flex flex-wrap items-center gap-3">
              
              <div className="space-y-1 select-none">
                <select
                  value={selectedFilterProject}
                  onChange={(e) => setSelectedFilterProject(e.target.value)}
                  className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-700 cursor-pointer focus:outline-none"
                >
                  <option value="all">All Projects</option>
                  {knownProjects.map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <select
                  value={selectedFilterOrientation}
                  onChange={(e) => setSelectedFilterOrientation(e.target.value)}
                  className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-700 cursor-pointer focus:outline-none"
                >
                  <option value="all">Orientation: All</option>
                  <option value="Normal">Normal Orientation</option>
                  <option value="Mirror">Mirror Orientation</option>
                </select>
              </div>

              <div className="space-y-1">
                <select
                  value={selectedFilterStatus}
                  onChange={(e) => setSelectedFilterStatus(e.target.value)}
                  className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-700 cursor-pointer focus:outline-none"
                >
                  <option value="all">Lifecycle: All</option>
                  <option value="PLANNED">Planned (Queue)</option>
                  <option value="RELEASED">Released (Production)</option>
                  <option value="COMPLETED">Fitted / Complete</option>
                </select>
              </div>

            </div>

          </div>

          {/* Master Table */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-xs overflow-hidden">
            
            <div className="bg-slate-50/50 p-4 border-b border-slate-100 flex items-center justify-between text-xs">
              <span className="text-slate-500 font-medium">
                Showing {filteredPlannedPools.length} of {plannedPools.length} pre-planned items
              </span>
              {filteredPlannedPools.length === 0 && (
                <button 
                  onClick={() => {
                    setSearchQuery('');
                    setSelectedFilterProject('all');
                    setSelectedFilterOrientation('all');
                    setSelectedFilterStatus('all');
                  }}
                  className="text-indigo-600 font-bold hover:underline"
                >
                  Reset filters
                </button>
              )}
            </div>

            {filteredPlannedPools.length === 0 ? (
              <div className="p-16 text-center text-slate-400 text-xs flex flex-col items-center justify-center gap-2">
                <FileSpreadsheet className="h-8 w-8 text-slate-300" />
                <span>No matching planned pool configurations found in system index.</span>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-650">
                  <thead className="bg-slate-100/50 text-slate-600 uppercase tracking-wider text-[10px] font-bold border-b border-slate-100 leading-none">
                    <tr>
                      <th className="py-3 px-6">Pool Serial</th>
                      <th className="py-3 px-4">Project Association Name</th>
                      <th className="py-3 px-4">Design specs</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Execution Floor Progress / Stage</th>
                      <th className="py-3 px-6 text-right">Admin Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredPlannedPools.map(plan => {
                      const progressInfo = poolLiveProgressMap[plan.id];
                      
                      return (
                        <tr key={plan.id} className="hover:bg-slate-50/40 transition-colors">
                          
                          {/* Pool No */}
                          <td className="py-4.5 px-6 font-bold text-slate-900 font-mono text-[13px]">
                            {plan.poolNo}
                          </td>

                          {/* Project Source */}
                          <td className="py-4.5 px-4 font-bold text-slate-700">
                            {plan.projectName}
                          </td>

                          {/* Dimensions & shape */}
                          <td className="py-4.5 px-4">
                            <div className="text-slate-800 font-medium mb-0.5">{plan.dimensions}</div>
                            <div className="text-[10px] text-slate-400 font-mono flex items-center gap-1.5 leading-none">
                              <span className={`h-1.5 w-1.5 rounded-full ${plan.orientation === 'Mirror' ? 'bg-indigo-550 bg-indigo-500' : 'bg-slate-400'}`}></span>
                              <span>{plan.orientation} Orientation • {plan.shape}</span>
                            </div>
                          </td>

                          {/* State tag */}
                          <td className="py-4.5 px-4">
                            {plan.status === 'PLANNED' && (
                              <span className="bg-slate-100 hover:bg-slate-200 font-semibold px-2.5 py-1 text-[10px] text-slate-600 rounded-full inline-flex items-center gap-1">
                                <span className="h-1.5 w-1.5 rounded-full bg-slate-400"></span>
                                PLANNED
                              </span>
                            )}
                            {plan.status === 'RELEASED' && (
                              <span className="bg-amber-50 font-bold px-2.5 py-1 text-[10px] text-amber-750/90 text-amber-805 rounded-full inline-flex items-center gap-1">
                                <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                                ACTIVE BUILD
                              </span>
                            )}
                            {plan.status === 'COMPLETED' && (
                              <span className="bg-emerald-50 font-bold px-2.5 py-1 text-[10px] text-emerald-800 rounded-full inline-flex items-center gap-1">
                                <CheckCircle className="h-3.5 w-3.5 text-emerald-500 text-emerald-600" />
                                COMPLETED
                              </span>
                            )}
                          </td>

                          {/* Integration floor checks */}
                          <td className="py-4.5 px-4">
                            {plan.status === 'PLANNED' ? (
                              <span className="text-slate-400 italic text-[11px]">Not yet started on floor</span>
                            ) : (
                              <div className="space-y-1.5 max-w-[200px]">
                                <div className="flex items-center justify-between text-[11px] font-semibold text-slate-700 leading-none">
                                  <span>{progressInfo?.currentStageName}</span>
                                  <span className="font-mono">{progressInfo?.progressPercent}%</span>
                                </div>
                                <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                                  <div 
                                    className={`h-full rounded-full transition-all ${progressInfo?.isCompleted ? 'bg-emerald-500' : 'bg-cyan-500'}`}
                                    style={{ width: `${progressInfo?.progressPercent}%` }}
                                  />
                                </div>
                              </div>
                            )}
                          </td>

                          {/* Actions */}
                          <td className="py-4.5 px-6 text-right">
                            {plan.status === 'PLANNED' ? (
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  onClick={() => handleOpenReleaseDialog(plan.id)}
                                  className="bg-indigo-650 hover:bg-indigo-750 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-1.5 px-3 rounded-xl text-[11px] inline-flex items-center gap-1 shadow-xs cursor-pointer"
                                >
                                  <Play className="h-3 w-3 shrink-0" />
                                  <span>Dispatch Floor</span>
                                </button>
                              </div>
                            ) : (
                              <span className="text-slate-400 text-[11px] italic">Released ledger locked</span>
                            )}
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
      )}

      {/* ====== TAB 3: CREATE / BATCH SPAWNER ====== */}
      {activeTab === 'quick_launch' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-fadeIn">
          
          {/* Bento Column 1: Individual Quick Planning Form */}
          <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-5">
            <div>
              <h3 className="text-sm font-black text-slate-80 w text-slate-800 flex items-center gap-1.5">
                <Plus className="h-4 w-4 text-indigo-500" />
                Pre-Register Single Pool Design
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">Define layout orientations individually to plan your production schedules in advance.</p>
            </div>

            <form onSubmit={onSubmitSingle} className="space-y-4">
              
              {/* Project Title Selection */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-bold text-slate-500">
                  <label>Project Association Name</label>
                  <label className="flex items-center gap-1 cursor-pointer font-bold text-indigo-600 select-none">
                    <input
                      type="checkbox"
                      checked={useCustomProject}
                      onChange={(e) => setUseCustomProject(e.target.checked)}
                      className="rounded text-indigo-600 focus:ring-1 focus:ring-indigo-500"
                    />
                    <span>Custom Name</span>
                  </label>
                </div>
                {useCustomProject ? (
                  <input
                    type="text"
                    required
                    value={customProject}
                    onChange={(e) => setCustomProject(e.target.value)}
                    placeholder="Enter brand new project name..."
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                ) : (
                  <select
                    value={singleProject}
                    onChange={(e) => setSingleProject(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-705 cursor-pointer focus:outline-none"
                  >
                    {knownProjects.map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* Pool No Serial */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 block">Pool Number designation</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. PL-5051"
                  value={poolNo}
                  onChange={(e) => setPoolNo(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              {/* Planning Date */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 block">Planning Date <span className="text-slate-400 font-normal normal-case">(pick any date — past or future)</span></label>
                <input
                  type="date"
                  value={planningDate}
                  onChange={(e) => setPlanningDate(e.target.value)}
                  className="w-full bg-slate-50 border border-indigo-200 rounded-xl px-3.5 py-2 text-xs text-slate-800 font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Orientation Selector */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-505 block text-slate-500">Design Orientation</label>
                  <select
                    value={orientation}
                    onChange={(e) => setOrientation(e.target.value as PoolOrientation)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-700 cursor-pointer focus:outline-none"
                  >
                    <option value="Normal">Normal Design</option>
                    <option value="Mirror">Mirror Design</option>
                  </select>
                </div>

                {/* Dimensions */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 block">Mold Dimensions</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 12m x 5m"
                    value={dimensions}
                    onChange={(e) => setDimensions(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-800 focus:outline-none"
                  />
                </div>
              </div>

              {/* Shape Selection */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 block">Standard Pool Shape Mould</label>
                <select
                  value={shape}
                  onChange={(e) => setShape(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-700 cursor-pointer"
                >
                  <option value="Classic Rectangle">Classic Rectangle</option>
                  <option value="Linear Lap Pool">Linear Lap Pool</option>
                  <option value="Infinity Curve">Infinity Curve</option>
                  <option value="Lagoon Lounge">Lagoon Lounge</option>
                  <option value="Bespoke Plunge">Bespoke Plunge</option>
                </select>
              </div>

              {/* Pool Type and Blueprint configuration */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 block">Pool Type / Model Code</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Type 3 or Model A"
                    value={poolType}
                    onChange={(e) => setPoolType(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-800 placeholder-slate-400 focus:outline-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 block">Upload Drawing Layout</label>
                  <div className="flex gap-2">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = (event) => {
                            if (event.target?.result) {
                              setDrawingUrl(event.target.result as string);
                            }
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                      className="hidden"
                      id="single-drawing-upload"
                    />
                    <label
                      htmlFor="single-drawing-upload"
                      className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-755 text-slate-600 font-bold py-2 px-3 rounded-xl text-[10.5px] text-center cursor-pointer border border-slate-200 truncate"
                    >
                      {drawingUrl ? '✓ Drawing Loaded' : 'Upload Image File'}
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        const blueprint = generateBlueprintSVG(shape, orientation, poolType);
                        setDrawingUrl(blueprint);
                      }}
                      className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-extrabold px-2.5 py-2 rounded-xl text-[10.2px] border border-indigo-100 shrink-0 cursor-pointer"
                      title="Generate dynamic technical Blueprint schematic"
                    >
                      CAD Blueprint
                    </button>
                  </div>
                </div>
              </div>

              {drawingUrl && (
                <div className="border border-indigo-100 bg-indigo-50/20 p-2.5 rounded-xl space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black text-indigo-700 uppercase">Drawing Layout Blueprint Preview:</span>
                    <button
                      type="button"
                      onClick={() => setDrawingUrl('')}
                      className="text-[9.5px] text-rose-600 hover:underline font-bold"
                    >
                      Clear specification
                    </button>
                  </div>
                  <div className="h-28 w-full bg-slate-900 rounded-lg overflow-hidden flex items-center justify-center border border-slate-800">
                    <img src={drawingUrl} referrerPolicy="no-referrer" alt="Blueprint design" className="h-full object-contain" />
                  </div>
                </div>
              )}

              {/* Specs notes */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-505 block text-slate-500">Additional Build Directives (Optional)</label>
                <textarea
                  placeholder="e.g. Corner stairs reinforcement needed, fiberglass double coatings requested..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-800 placeholder-slate-400 focus:outline-none"
                />
              </div>

              {/* Action */}
              <button
                type="submit"
                className="w-full bg-indigo-650 hover:bg-indigo-750 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 px-4 rounded-xl text-xs inline-flex items-center justify-center gap-1.5 shadow-sm transition-all duration-150 cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                <span>Append Pre-Planned Pool Card</span>
              </button>

            </form>
          </div>

          {/* Bento Column 2: Bulk Fast Spawner Generator (INDUSTRIAL POWER COMPONENT) */}
          <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-5">
            <div>
              <h3 className="text-sm font-black text-slate-850 text-slate-800 flex items-center gap-1.5">
                <Zap className="h-4.5 w-4.5 text-amber-550 text-amber-500 shrink-0" />
                High-Volume Serial Generator
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">Perfect for generating up to 400+ serialized pools consecutively in milliseconds to populate project portfolios.</p>
            </div>

            <form onSubmit={onSubmitBulk} className="space-y-4">
              
              {/* Project Title Selection */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-bold text-slate-505 text-slate-500">
                  <label>Bulk Target Project Designation</label>
                  <label className="flex items-center gap-1 cursor-pointer font-bold text-indigo-600 select-none">
                    <input
                      type="checkbox"
                      checked={useCustomBulkProject}
                      onChange={(e) => setUseCustomBulkProject(e.target.checked)}
                      className="rounded text-indigo-600 focus:ring-1 focus:ring-indigo-500"
                    />
                    <span>Custom Name</span>
                  </label>
                </div>
                {useCustomBulkProject ? (
                  <input
                    type="text"
                    required
                    value={customBulkProject}
                    onChange={(e) => setCustomBulkProject(e.target.value)}
                    placeholder="Enter brand new project name..."
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-800 placeholder-slate-400 focus:outline-none"
                  />
                ) : (
                  <select
                    value={bulkProject}
                    onChange={(e) => setBulkProject(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-700 cursor-pointer focus:outline-none"
                  >
                    {knownProjects.map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* Serial Prefix & start serial */}
              <div className="grid grid-cols-3 gap-4">
                
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 block">Prefix Mark</label>
                  <input
                    type="text"
                    required
                    value={prefix}
                    onChange={(e) => setPrefix(e.target.value)}
                    placeholder="e.g. SL-"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-800 focus:outline-none text-center font-mono font-bold"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-505 block text-slate-505 text-slate-500">Start Serial</label>
                  <input
                    type="number"
                    required
                    value={startRange}
                    onChange={(e) => setStartRange(parseInt(e.target.value) || 0)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-800 focus:outline-none text-center font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 block">Total Qty (up to 400+)</label>
                  <input
                    type="number"
                    required
                    min={1}
                    max={500}
                    value={count}
                    onChange={(e) => setCount(parseInt(e.target.value) || 0)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-805 text-slate-800 font-bold focus:outline-none text-center font-mono"
                  />
                </div>

              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Orientation Selector */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 block">Orientation Mode</label>
                  <select
                    value={bulkOrientation}
                    onChange={(e) => setBulkOrientation(e.target.value as PoolOrientation)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-705 cursor-pointer"
                  >
                    <option value="Normal">Normal Orientation</option>
                    <option value="Mirror">Mirror Orientation</option>
                  </select>
                </div>

                {/* Dimensions */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-505 block text-slate-550 text-slate-500">Dimensions</label>
                  <input
                    type="text"
                    required
                    value={bulkDimensions}
                    onChange={(e) => setBulkDimensions(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-800 focus:outline-none"
                  />
                </div>
              </div>

              {/* Shape Selection */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 block">Standard Pool Shape Mould</label>
                <select
                  value={bulkShape}
                  onChange={(e) => setBulkShape(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-700 cursor-pointer"
                >
                  <option value="Classic Rectangle">Classic Rectangle</option>
                  <option value="Linear Lap Pool">Linear Lap Pool</option>
                  <option value="Infinity Curve">Infinity Curve</option>
                  <option value="Lagoon Lounge">Lagoon Lounge</option>
                  <option value="Bespoke Plunge">Bespoke Plunge</option>
                </select>
              </div>

              {/* Bulk Pool Type and Blueprint configuration */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 block">Bulk Batch Pool Type</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Type 3 or Model A"
                    value={bulkPoolType}
                    onChange={(e) => setBulkPoolType(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-800 placeholder-slate-400 focus:outline-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 block">Batch Layout Design</label>
                  <div className="flex gap-2">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = (event) => {
                            if (event.target?.result) {
                              setBulkDrawingUrl(event.target.result as string);
                            }
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                      className="hidden"
                      id="bulk-drawing-upload"
                    />
                    <label
                      htmlFor="bulk-drawing-upload"
                      className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-755 text-slate-600 font-bold py-2 px-3 rounded-xl text-[10.5px] text-center cursor-pointer border border-slate-200 truncate"
                    >
                      {bulkDrawingUrl ? '✓ Set on Batch' : 'Assign File'}
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        const blueprint = generateBlueprintSVG(bulkShape, bulkOrientation, bulkPoolType);
                        setBulkDrawingUrl(blueprint);
                      }}
                      className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-extrabold px-2.5 py-2 rounded-xl text-[10.2px] border border-indigo-100 shrink-0 cursor-pointer"
                      title="Generate dynamic technical Blueprint schematic"
                    >
                      CAD Blueprint
                    </button>
                  </div>
                </div>
              </div>

              {bulkDrawingUrl && (
                <div className="border border-indigo-100 bg-indigo-50/20 p-2.5 rounded-xl space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black text-indigo-700 uppercase">Batch Blueprint Design:</span>
                    <button
                      type="button"
                      onClick={() => setBulkDrawingUrl('')}
                      className="text-[9.5px] text-rose-600 hover:underline font-bold"
                    >
                      Remove design
                    </button>
                  </div>
                  <div className="h-28 w-full bg-slate-900 rounded-lg overflow-hidden flex items-center justify-center border border-slate-800">
                    <img src={bulkDrawingUrl} referrerPolicy="no-referrer" alt="Blueprint design" className="h-full object-contain" />
                  </div>
                </div>
              )}

              {/* Specs notes */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 block">Additional Batch Labels (Optional)</label>
                <textarea
                  placeholder="Appended remarks..."
                  value={bulkNotes}
                  onChange={(e) => setBulkNotes(e.target.value)}
                  rows={2}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-800 placeholder-slate-400 focus:outline-none animate-none"
                />
              </div>

              {/* Action */}
              <button
                type="submit"
                className="w-full bg-amber-500 hover:bg-amber-600 text-slate-900 font-extrabold py-2.5 px-4 rounded-xl text-xs inline-flex items-center justify-center gap-1.5 mt-1 transition-all shadow-xs cursor-pointer"
              >
                <Zap className="h-4 w-4" />
                <span>Instantiate Batch Records Serial Pool</span>
              </button>

            </form>
          </div>

          {/* Bento Block 3: Excel Sheet Spawner */}
          <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-6 col-span-1 lg:col-span-2">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-sm font-black text-slate-800 flex items-center gap-1.5 font-sans uppercase tracking-wide">
                  <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
                  Excel Smart Sheets Project Spawner
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Pre-register entire seasonal project logs by importing any planning team Excel file directly.
                </p>
              </div>
              
              {excelFileName && (
                <button
                  type="button"
                  onClick={() => {
                    setExcelFileName('');
                    setExcelRawHeaders([]);
                    setExcelRawRows([]);
                  }}
                  className="bg-slate-105 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-1.5 px-3 rounded-lg text-xs duration-150 flex items-center gap-1 cursor-pointer"
                >
                  Clear & Reset Uploader
                </button>
              )}
            </div>

            {/* Dropzone Container */}
            {!excelFileName ? (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsExcelDragActive(true);
                }}
                onDragLeave={() => setIsExcelDragActive(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsExcelDragActive(false);
                  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                    handleExcelUpload(e.dataTransfer.files[0]);
                  }
                }}
                className={`border-2 border-dashed rounded-2xl p-8 text-center transition-all duration-150 cursor-pointer ${
                  isExcelDragActive
                    ? 'border-emerald-500 bg-emerald-50/40'
                    : 'border-slate-200 hover:border-emerald-400 bg-slate-50/50 hover:bg-slate-50'
                }`}
                onClick={() => {
                  document.getElementById('excel-file-hidden-input')?.click();
                }}
              >
                <input
                  id="excel-file-hidden-input"
                  type="file"
                  accept=".xlsx, .xls"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleExcelUpload(e.target.files[0]);
                    }
                  }}
                />
                <div className="mx-auto h-12 w-12 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600 mb-3">
                  <Upload className="h-6 w-6" />
                </div>
                <div className="text-xs font-bold text-slate-700">
                  Click to select or drag and drop your project Excel sheet
                </div>
                <p className="text-[10px] text-slate-400 mt-1">
                  Processes columns: Project Name, Pool Number, Sizing Dimensions, Orientation, Shape Model, Remarks (Supports .XLSX, .XLS)
                </p>
              </div>
            ) : (
              <div className="bg-emerald-50/20 border border-emerald-100 p-4 rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 bg-emerald-105 bg-emerald-100 rounded-lg flex items-center justify-center text-emerald-700">
                    <FileSpreadsheet className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-extrabold text-slate-800">{excelFileName}</h4>
                    <span className="text-[10px] text-emerald-700 font-bold block bg-emerald-100/50 px-1.5 py-0.5 rounded w-fit mt-0.5">
                      {excelRawRows.length} rows loaded successfully
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[10px] font-bold text-emerald-700 uppercase">Ready for column validation</span>
                </div>
              </div>
            )}

            {/* Column Spec Mapping Controls */}
            {excelFileName && (
              <div className="space-y-4">
                <div className="border-t border-slate-100 pt-4">
                  <h4 className="text-xs font-black text-indigo-900 flex items-center gap-1">
                    <Sliders className="h-4 w-4 text-indigo-500" />
                    Fuzzy Column Matching Configurator
                  </h4>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Map each pool specification parameter below to its corresponding column header detected inside your Excel sheet.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
                  {/* Field 1: Project Name */}
                  <div className="space-y-1">
                    <label className="text-[11px] font-black text-slate-500 flex items-center gap-1">
                      <span className="text-red-500">*</span> Project Name
                    </label>
                    <select
                      value={excelMapping.projectName}
                      onChange={(e) => setExcelMapping(prev => ({ ...prev, projectName: e.target.value }))}
                      className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none"
                    >
                      <option value="">-- Click to select column --</option>
                      {excelRawHeaders.map(h => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>

                  {/* Field 2: Pool No */}
                  <div className="space-y-1">
                    <label className="text-[11px] font-black text-slate-500 flex items-center gap-1">
                      <span className="text-red-500">*</span> Pool Code / Serial No
                    </label>
                    <select
                      value={excelMapping.poolNo}
                      onChange={(e) => setExcelMapping(prev => ({ ...prev, poolNo: e.target.value }))}
                      className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none"
                    >
                      <option value="">-- Click to select column --</option>
                      {excelRawHeaders.map(h => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>

                  {/* Field 3: Dimensions */}
                  <div className="space-y-1">
                    <label className="text-[11px] font-black text-slate-500">Pool Dimensions (Sizing)</label>
                    <select
                      value={excelMapping.dimensions}
                      onChange={(e) => setExcelMapping(prev => ({ ...prev, dimensions: e.target.value }))}
                      className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none"
                    >
                      <option value="">-- Optional (Constant 12m x 5m if unmapped) --</option>
                      {excelRawHeaders.map(h => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>

                  {/* Field 4: Orientation */}
                  <div className="space-y-1">
                    <label className="text-[11px] font-black text-slate-500">Mould Design Orientation</label>
                    <select
                      value={excelMapping.orientation}
                      onChange={(e) => setExcelMapping(prev => ({ ...prev, orientation: e.target.value }))}
                      className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none"
                    >
                      <option value="">-- Optional (Constant Normal if unmapped) --</option>
                      {excelRawHeaders.map(h => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>

                  {/* Field 5: Shape */}
                  <div className="space-y-1">
                    <label className="text-[11px] font-black text-slate-500">Fiberglass Shape Modellings</label>
                    <select
                      value={excelMapping.shape}
                      onChange={(e) => setExcelMapping(prev => ({ ...prev, shape: e.target.value }))}
                      className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none"
                    >
                      <option value="">-- Optional (Constant Rectangle if unmapped) --</option>
                      {excelRawHeaders.map(h => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>

                  {/* Field 6: Pool Type */}
                  <div className="space-y-1">
                    <label className="text-[11px] font-black text-slate-500">Pool Model Classification</label>
                    <select
                      value={excelMapping.poolType}
                      onChange={(e) => setExcelMapping(prev => ({ ...prev, poolType: e.target.value }))}
                      className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none"
                    >
                      <option value="">-- Optional (Constant Type 3 if unmapped) --</option>
                      {excelRawHeaders.map(h => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Parsed Spec Preview Table */}
                <div className="space-y-2 pt-2 border-t border-slate-150">
                  <div className="flex items-center justify-between">
                    <h5 className="text-[11px] font-black text-slate-700 flex items-center gap-1">
                      <Layers className="h-3.5 w-3.5 text-indigo-500" />
                      Parsed Recordset Validation Audit Ledger
                    </h5>
                    <div className="text-[10px] text-slate-400 font-bold">
                      Loaded rows: <span className="text-indigo-600 font-black">{excelRawRows.length}</span> | 
                      Ignored duplicates: <span className="text-amber-600 font-black">{previewsImportPools.filter(p => p.isDuplicate).length}</span> | 
                      Ready to Spawn: <span className="text-emerald-600 font-black">{previewsImportPools.filter(p => !p.isDuplicate && !p.isInvalid).length}</span>
                    </div>
                  </div>

                  <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200 text-xs shadow-inner">
                    <table className="w-full text-left bg-white leading-tight">
                      <thead className="bg-slate-100 text-[10px] uppercase font-bold text-slate-500 sticky top-0 leading-none">
                        <tr>
                          <th className="py-2.5 px-3 w-10">Row</th>
                          <th className="py-2.5 px-3">Project</th>
                          <th className="py-2.5 px-3">Pool Code</th>
                          <th className="py-2.5 px-2">Type</th>
                          <th className="py-2.5 px-2">Dimensions</th>
                          <th className="py-2.5 px-2">Orientation</th>
                          <th className="py-2.5 px-2">Shape</th>
                          <th className="py-2.5 px-3 text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-[11px]">
                        {previewsImportPools.map((pool, idx) => (
                          <tr
                            key={idx}
                            className={
                              pool.isInvalid
                                ? 'bg-rose-50/20 text-rose-700'
                                : pool.isDuplicate
                                ? 'bg-amber-50/10 text-slate-500'
                                : 'hover:bg-slate-50/50'
                            }
                          >
                            <td className="py-2 px-3 font-mono text-[9px] text-slate-400">#{idx + 1}</td>
                            <td className="py-2 px-3 font-bold truncate max-w-[120px]" title={pool.projectName}>{pool.projectName}</td>
                            <td className="py-2 px-3 font-mono font-black tracking-wide text-indigo-900">{pool.poolNo || '(Empty)'}</td>
                            <td className="py-2 px-2 text-[10px]">{pool.poolType}</td>
                            <td className="py-2 px-2 text-slate-500 text-[10px]">{pool.dimensions}</td>
                            <td className="py-2 px-2">
                              <span className={`px-1.5 py-0.5 font-bold rounded text-[9.5px] uppercase ${
                                pool.orientation === 'Mirror' ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-700'
                              }`}>
                                {pool.orientation}
                              </span>
                            </td>
                            <td className="py-2 px-2 text-slate-400 text-[10.5px] truncate max-w-[100px]">{pool.shape}</td>
                            <td className="py-2 px-3 text-right">
                              {pool.isInvalid ? (
                                <span className="inline-flex items-center gap-0.5 text-rose-600 font-extrabold text-[9px] bg-rose-50 py-0.5 px-1.5 rounded uppercase">
                                  <AlertTriangle className="h-2.5 w-2.5" /> Empty Code
                                </span>
                              ) : pool.isDuplicate ? (
                                <span className="inline-flex items-center gap-0.5 text-amber-600 font-bold text-[9px] bg-amber-50 px-1.5 py-0.5 rounded uppercase">
                                  Duplicate (Skip)
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-0.5 text-emerald-700 font-bold text-[9px] bg-emerald-50 px-1.5 py-0.5 rounded uppercase">
                                  Ready
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Execute block import action panel */}
                  <div className="bg-indigo-50/50 p-4 rounded-xl border border-indigo-100/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-3">
                    <div className="text-[11px] leading-relaxed text-indigo-900">
                      <span className="block font-black">Spawning Ready Block:</span>
                      <span>
                        The system will instantiate <strong className="text-indigo-950 text-[12px]">{previewsImportPools.filter(p => !p.isDuplicate && !p.isInvalid).length}</strong> new planned pools.
                        Duplicates and empty keys ({previewsImportPools.filter(p => p.isDuplicate || p.isInvalid).length}) will be filtered out to protect system indexes safely.
                      </span>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-indigo-800 uppercase tracking-wider block">Import Date <span className="font-normal normal-case text-indigo-600">(pick month/date for this batch)</span></label>
                      <input
                        type="date"
                        value={excelImportDate}
                        onChange={e => setExcelImportDate(e.target.value)}
                        className="border border-indigo-200 rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={handlePerformExcelImport}
                      disabled={previewsImportPools.filter(p => !p.isDuplicate && !p.isInvalid).length === 0}
                      className={`font-black py-2.5 px-5 rounded-xl text-xs flex items-center justify-center gap-1.5 duration-150 shrink-0 select-none shadow-xs cursor-pointer ${
                        previewsImportPools.filter(p => !p.isDuplicate && !p.isInvalid).length === 0
                          ? 'bg-slate-200 text-slate-400 border border-slate-300 cursor-not-allowed'
                          : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                      }`}
                    >
                      <Check className="h-4 w-4" />
                      <span>Execute Excel Block Import</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

        </div>
      )}

      {/* ====== TAB 4: ALL PROJECTS PORTAL ====== */}
      {activeTab === 'all_projects_portal' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fadeIn" id="all-projects-portal-container">
          
          {/* Left Form Panel */}
          <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-5">
            <div className="border-b border-slate-100 pb-3">
              <h3 className="text-base font-extrabold text-slate-800 tracking-tight flex items-center gap-2">
                <Plus className="h-5 w-5 text-indigo-600" />
                Add/Update Project Summary
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Feed bulk statistics for old or newly completed projects directly into the live Cloud database.
              </p>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 block">Project Name</label>
                <input
                  type="text"
                  placeholder="e.g. Tiger, Lion Elite, Villa"
                  value={newProjName}
                  onChange={(e) => setNewProjName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-205 border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-800 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 block">Design Orientation</label>
                  <select
                    value={newProjOrientation}
                    onChange={(e) => setNewProjOrientation(e.target.value as PoolOrientation)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-805 text-slate-800 focus:outline-none"
                  >
                    <option value="Normal">Normal</option>
                    <option value="Mirror">Mirror</option>
                    <option value="Both">Both Orientations</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 block">Structural Pool Type</label>
                  <select
                    value={newProjType}
                    onChange={(e) => setNewProjType(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-805 text-slate-800 focus:outline-none"
                  >
                    <option value="Type 1">Type 1</option>
                    <option value="Type 2">Type 2</option>
                    <option value="Type 3">Type 3</option>
                    <option value="Custom">Custom Mold</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 block">Total Pools</label>
                  <input
                    type="number"
                    min={0}
                    value={newProjTotal}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 0;
                      setNewProjTotal(val);
                    }}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-2 text-xs text-slate-800 focus:outline-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 block">Produced</label>
                  <input
                    type="number"
                    min={0}
                    value={newProjProduced}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 0;
                      setNewProjProduced(val);
                    }}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-2 text-xs text-slate-800 focus:outline-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 block">Delivered</label>
                  <input
                    type="number"
                    min={0}
                    value={newProjDelivered}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 0;
                      setNewProjDelivered(val);
                    }}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-2 text-xs text-slate-800 focus:outline-none"
                  />
                </div>
              </div>

              <div className="bg-amber-50 border border-amber-100 p-3 rounded-xl flex justify-between items-center text-xs">
                <span className="font-bold text-amber-800">Remaining Balance:</span>
                <span className="font-mono font-extrabold text-amber-950 text-sm bg-white px-2.5 py-1 rounded-md border border-amber-200">
                  {Math.max(0, newProjTotal - newProjDelivered)} Pools
                </span>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 block">Project Description Notes</label>
                <textarea
                  placeholder="Insert general contract notes or production specs..."
                  rows={3}
                  value={newProjNotes}
                  onChange={(e) => setNewProjNotes(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-800 focus:outline-none"
                />
              </div>

              <button
                type="button"
                onClick={() => {
                  if (!newProjName.trim()) {
                    alert('Please enter a valid project name.');
                    return;
                  }
                  const summaryId = projectsSummary.find(p => p.projectName.toLowerCase() === newProjName.trim().toLowerCase())?.id || 'prj-' + Date.now();
                  const remaining = Math.max(0, newProjTotal - newProjDelivered);
                  
                  if (onSaveProjectSummary) {
                    onSaveProjectSummary({
                      id: summaryId,
                      projectName: newProjName.trim(),
                      orientation: newProjOrientation,
                      poolType: newProjType,
                      totalPools: newProjTotal,
                      deliveredPools: newProjDelivered,
                      producedPools: newProjProduced,
                      remainingPools: remaining,
                      notes: newProjNotes.trim() || undefined,
                      createdAt: new Date().toISOString()
                    });
                    
                    // Reset
                    setNewProjName('');
                    setNewProjTotal(100);
                    setNewProjDelivered(0);
                    setNewProjProduced(0);
                    setNewProjNotes('');
                    alert('Project summary record saved to Cloud Database!');
                  }
                }}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-black py-3 rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer"
              >
                <CheckCircle className="h-4 w-4" />
                <span>Save Project Record to Cloud SQL</span>
              </button>
            </div>
          </div>

          {/* Right Live Table Panel */}
          <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-5">
            
            {/* Header & Filter Row */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-base font-extrabold text-slate-800 tracking-tight">
                  Global Project Allocations Portal
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Audit orientation ratios, production balances, and shipping pipelines.
                </p>
              </div>

              {/* Filters */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search project..."
                    value={summarySearchQuery}
                    onChange={(e) => setSummarySearchQuery(e.target.value)}
                    className="bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-700 w-44 focus:outline-none"
                  />
                </div>

                <div className="flex items-center gap-1 bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200">
                  <Filter className="h-3 w-3 text-slate-500" />
                  <select
                    value={summaryFilterOrientation}
                    onChange={(e) => setSummaryFilterOrientation(e.target.value)}
                    className="bg-transparent text-xs text-slate-705 text-slate-700 focus:outline-none cursor-pointer"
                  >
                    <option value="all">All Orientations</option>
                    <option value="Normal">Normal Only</option>
                    <option value="Mirror">Mirror Only</option>
                    <option value="Both">Both Only</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Project List / Grid */}
            <div className="overflow-x-auto">
              <table className="min-w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-400 font-bold text-[10px] uppercase tracking-wider">
                    <th className="py-3 px-3">Project / Client ID</th>
                    <th className="py-3 px-3">Specs</th>
                    <th className="py-3 px-3 text-center">Total</th>
                    <th className="py-3 px-3 text-center text-emerald-600">Delivered</th>
                    <th className="py-3 px-3 text-center text-amber-600">Produced</th>
                    <th className="py-3 px-3 text-center text-rose-600">Remaining</th>
                    <th className="py-3 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {projectsSummary
                    .filter(proj => {
                      if (summaryFilterOrientation !== 'all' && proj.orientation !== summaryFilterOrientation) {
                        return false;
                      }
                      if (summarySearchQuery.trim()) {
                        return proj.projectName.toLowerCase().includes(summarySearchQuery.toLowerCase());
                      }
                      return true;
                    })
                    .map((proj) => {
                      const percentDelivered = Math.round((proj.deliveredPools / (proj.totalPools || 1)) * 100);
                      const percentProduced = Math.round((proj.producedPools / (proj.totalPools || 1)) * 100);
                      return (
                        <tr key={proj.id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="py-3 px-3 font-sans">
                            <span className="font-extrabold text-slate-900 block">{proj.projectName}</span>
                            <span className="text-[10px] text-slate-400 font-mono">ID: {proj.id}</span>
                          </td>
                          <td className="py-3 px-3 font-mono text-[10px]">
                            <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-md font-bold uppercase shrink-0 mr-1.5">{proj.poolType || 'Type 3'}</span>
                            <span className={`px-2 py-0.5 rounded-md font-bold uppercase shrink-0 ${proj.orientation === 'Mirror' ? 'bg-purple-50 text-purple-700' : 'bg-blue-50 text-blue-700'}`}>{proj.orientation}</span>
                          </td>
                          <td className="py-3 px-3 text-center font-bold text-slate-800">{proj.totalPools}</td>
                          <td className="py-3 px-3 text-center text-emerald-700 font-semibold bg-emerald-50/10">
                            {proj.deliveredPools}
                            <span className="block text-[9px] text-slate-400 font-normal">{percentDelivered}%</span>
                          </td>
                          <td className="py-3 px-3 text-center text-amber-700 font-semibold bg-amber-50/10">
                            {proj.producedPools}
                            <span className="block text-[9px] text-slate-400 font-normal">{percentProduced}%</span>
                          </td>
                          <td className="py-3 px-3 text-center text-rose-700 font-extrabold bg-rose-50/10 font-mono">
                            {proj.remainingPools}
                          </td>
                          <td className="py-3 px-3 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => {
                                  setNewProjName(proj.projectName);
                                  setNewProjOrientation(proj.orientation as PoolOrientation);
                                  setNewProjType(proj.poolType || 'Type 3');
                                  setNewProjTotal(proj.totalPools);
                                  setNewProjDelivered(proj.deliveredPools);
                                  setNewProjProduced(proj.producedPools);
                                  setNewProjNotes(proj.notes || '');
                                }}
                                className="p-1 text-slate-400 hover:text-indigo-650 hover:bg-slate-100 rounded-md transition-colors cursor-pointer"
                                title="Edit Project specs"
                              >
                                <Sliders className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  {projectsSummary.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-400 font-mono text-[11px]">
                        No external completed projects logged in PostgreSQL database. Fill out the left panel to insert records.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Info Section Box */}
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 flex gap-3 text-xs text-slate-500 leading-relaxed">
              <Info className="h-4 w-4 text-indigo-650 shrink-0 text-indigo-600 mt-0.5" />
              <div>
                <span className="font-bold text-slate-700 block">Persistence Information</span>
                All project allocations here write directly to PostgreSQL Cloud store. This allows you to log legacy contracts completed prior to system orchestration commissioning alongside newly launched active templates.
              </div>
            </div>

          </div>
        </div>
      )}

      {/* ====== TAB 5: MONTHLY TARGETS PLANNING ====== */}
      {activeTab === 'monthly_targets' && (
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm animate-fadeIn" id="monthly-targets-planner-container">
          <div className="border-b border-slate-100 pb-4 mb-6">
            <h3 className="text-base font-extrabold text-slate-800 tracking-tight flex items-center gap-2">
              <Calendar className="h-5 w-5 text-indigo-600" />
              Department Monthly Operational Targets Scheduler
            </h3>
            <p className="text-xs text-slate-450 text-slate-500 mt-1">
              Planning department should define operational target quotas for each workshop terminal section at the start of the month.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left planner form column */}
            <div className="space-y-5 lg:border-r lg:border-slate-100 lg:pr-8">
              <div className="bg-indigo-50/50 p-4 rounded-xl border border-indigo-100/30 space-y-4">
                <span className="text-xs font-black text-indigo-805 uppercase tracking-wide flex items-center gap-1.5 text-indigo-900">
                  <Sliders className="h-4 w-4" />
                  Select Active target Month
                </span>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase">Month Year Code</label>
                    <input
                      type="text"
                      placeholder="e.g. 2026-06"
                      value={targetMonthId}
                      onChange={(e) => setTargetMonthId(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 font-mono text-center focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase">Human Label Name</label>
                    <input
                      type="text"
                      placeholder="e.g. June 2026"
                      value={targetMonthName}
                      onChange={(e) => setTargetMonthName(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-850 text-slate-800 text-center focus:outline-none"
                    />
                  </div>
                </div>

                <div className="border-t border-slate-200/50 pt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const found = monthlyTargets.find(t => t.id === targetMonthId);
                      if (found) {
                        setTargetMonthName(found.monthName);
                        setTargetMainPoolCount(found.mainTarget);
                        setTargetSteelFab(found.steelFabricationTarget || 0);
                        setTargetSteelPrimer(found.steelPrimerTarget || 0);
                        setTargetPlumbing(found.plumbingTarget || 0);
                        setTargetCladding(found.claddingTarget || 0);
                        setTargetSkimmerFitting(found.skimmerFittingTarget || found.claddingTarget || 0);
                        setTargetLamination(found.laminationTarget || 0);
                        setTargetMechFitting(found.mechanicalFittingTarget || 0);
                        setTargetMosaic(found.mosaicTarget || 0);
                        setTargetAcrylic(found.acrylicTarget || 0);
                        setTargetOee(found.targetOee || 80);
                        setTargetNotes(found.notes || '');
                        alert(`Loaded previously saved target stats for ${found.monthName}!`);
                      } else {
                        alert('No exist record found for this month ID in local index.');
                      }
                    }}
                    className="flex-1 bg-white hover:bg-slate-50 text-indigo-600 font-bold py-1 px-3 text-[10.5px] rounded-lg border border-slate-200 block text-center cursor-pointer"
                  >
                    Load Month Code
                  </button>
                </div>
              </div>

              {/* Main monthly focus and OEE */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-650 text-slate-700 block">Main Pool target</label>
                  <input
                    type="number"
                    min={0}
                    value={targetMainPoolCount}
                    onChange={(e) => setTargetMainPoolCount(parseInt(e.target.value) || 0)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-810 text-slate-800 font-bold focus:outline-none"
                  />
                </div>

                <div className="space-y-1.5 font-sans">
                  <label className="text-xs font-bold text-slate-650 text-slate-700 block">Target OEE Quota (%)</label>
                  <input
                    type="number"
                    min={50}
                    max={100}
                    value={targetOee}
                    onChange={(e) => setTargetOee(parseInt(e.target.value) || 0)}
                    className="w-full bg-slate-50 border border-slate-205 border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-815 text-slate-800 font-bold focus:outline-none"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 block">Planning Strategy Notes</label>
                <textarea
                  placeholder="Explain high-level focus parameters..."
                  rows={2}
                  value={targetNotes}
                  onChange={(e) => setTargetNotes(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-800 focus:outline-none"
                />
              </div>
            </div>

            {/* Middle and Right workshop section inputs */}
            <div className="lg:col-span-2 space-y-5">
              <span className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-1">
                Configure Specific workshop Section Targets
              </span>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-slate-50/50 p-4 rounded-xl border border-slate-105 border-slate-100/60 space-y-1">
                  <span className="text-[10px] uppercase font-black text-blue-600 tracking-wider">01. Steel Fabrication</span>
                  <input
                    type="number"
                    value={targetSteelFab}
                    onChange={(e) => setTargetSteelFab(parseInt(e.target.value) || 0)}
                    className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-800 focus:outline-none"
                  />
                </div>

                <div className="bg-slate-50/50 p-4 rounded-xl border border-slate-100/60 space-y-1">
                  <span className="text-[10px] uppercase font-black text-indigo-600 tracking-wider">02. Steel Primer</span>
                  <input
                    type="number"
                    value={targetSteelPrimer}
                    onChange={(e) => setTargetSteelPrimer(parseInt(e.target.value) || 0)}
                    className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-800 focus:outline-none"
                  />
                </div>

                <div className="bg-slate-50/50 p-4 rounded-xl border border-slate-100/60 space-y-1">
                  <span className="text-[10px] uppercase font-black text-cyan-600 tracking-wider">03. Chemical Cladding</span>
                  <input
                    type="number"
                    value={targetCladding}
                    onChange={(e) => setTargetCladding(parseInt(e.target.value) || 0)}
                    className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-800 focus:outline-none"
                  />
                </div>

                <div className="bg-slate-50/50 p-4 rounded-xl border border-slate-100/60 space-y-1">
                  <span className="text-[10px] uppercase font-black text-orange-600 tracking-wider">04. Skimmer Fitting</span>
                  <input
                    type="number"
                    value={targetSkimmerFitting}
                    onChange={(e) => setTargetSkimmerFitting(parseInt(e.target.value) || 0)}
                    className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-800 focus:outline-none"
                  />
                </div>

                <div className="bg-slate-50/50 p-4 rounded-xl border border-slate-100/60 space-y-1">
                  <span className="text-[10px] uppercase font-black text-pink-600 tracking-wider">05. Structural Lamination</span>
                  <input
                    type="number"
                    value={targetLamination}
                    onChange={(e) => setTargetLamination(parseInt(e.target.value) || 0)}
                    className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-800 focus:outline-none"
                  />
                </div>

                <div className="bg-slate-50/50 p-4 rounded-xl border border-slate-100/60 space-y-1">
                  <span className="text-[10px] uppercase font-black text-violet-600 tracking-wider">06. Mechanical Fittings</span>
                  <input
                    type="number"
                    value={targetMechFitting}
                    onChange={(e) => setTargetMechFitting(parseInt(e.target.value) || 0)}
                    className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-800 focus:outline-none"
                  />
                </div>

                <div className="bg-slate-50/50 p-4 rounded-xl border border-slate-100/60 space-y-1">
                  <span className="text-[10px] uppercase font-black text-sky-600 tracking-wider">07. Plumbing Fittings</span>
                  <input
                    type="number"
                    value={targetPlumbing}
                    onChange={(e) => setTargetPlumbing(parseInt(e.target.value) || 0)}
                    className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-800 focus:outline-none"
                  />
                </div>

                <div className="bg-slate-50/50 p-4 rounded-xl border border-slate-100/60 space-y-1">
                  <span className="text-[10px] uppercase font-black text-amber-600 tracking-wider">08. Cosmetic Mosaic</span>
                  <input
                    type="number"
                    value={targetMosaic}
                    onChange={(e) => setTargetMosaic(parseInt(e.target.value) || 0)}
                    className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-800 focus:outline-none"
                  />
                </div>

                <div className="bg-slate-50/50 p-4 rounded-xl border border-slate-100/60 space-y-1">
                  <span className="text-[10px] uppercase font-black text-teal-600 tracking-wider">09. Grouting / Grawting</span>
                  <input
                    type="number"
                    value={targetGrouting}
                    onChange={(e) => setTargetGrouting(parseInt(e.target.value) || 0)}
                    className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-800 focus:outline-none"
                  />
                </div>

                <div className="bg-slate-50/50 p-4 rounded-xl border border-slate-100/60 space-y-1">
                  <span className="text-[10px] uppercase font-black text-rose-600 tracking-wider">10. Acrylic Window Fitting</span>
                  <input
                    type="number"
                    value={targetAcrylic}
                    onChange={(e) => setTargetAcrylic(parseInt(e.target.value) || 0)}
                    className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-800 focus:outline-none"
                  />
                </div>

                <div className="bg-indigo-650 text-white p-4 rounded-xl flex flex-col justify-end gap-1 block bg-indigo-600">
                  <span className="text-[10px] uppercase font-black tracking-wider text-indigo-200">System Broadcast</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (onSaveMonthlyTarget) {
                        onSaveMonthlyTarget({
                          id: targetMonthId.trim(),
                          monthName: targetMonthName.trim() || targetMonthId.trim(),
                          mainTarget: targetMainPoolCount,
                          steelFabricationTarget: targetSteelFab,
                          steelPrimerTarget: targetSteelPrimer,
                          plumbingTarget: targetPlumbing,
                          claddingTarget: targetCladding,
                          skimmerFittingTarget: targetSkimmerFitting,
                          laminationTarget: targetLamination,
                          mechanicalFittingTarget: targetMechFitting,
                          mosaicTarget: targetMosaic,
                          groutingTarget: targetGrouting,
                          acrylicTarget: targetAcrylic,
                          targetOee: targetOee,
                          notes: targetNotes.trim() || undefined
                        });
                        alert(`KPI Targets Scheduler broadcasted successfully for ${targetMonthName}!`);
                      }
                    }}
                    className="bg-white hover:bg-slate-100 text-indigo-900 font-extrabold py-2 px-3 text-xs rounded-lg shadow-sm font-sans transition-all cursor-pointer"
                  >
                    Broadcast Targets
                  </button>
                </div>
              </div>

              {/* Targets directory status table */}
              <div className="border border-slate-150 p-4 rounded-xl space-y-2">
                <span className="text-[10px] uppercase font-black text-slate-400 block tracking-widest">Logged Monthly Target Indexes ({monthlyTargets.length})</span>
                <div className="flex flex-wrap gap-2">
                  {monthlyTargets.map(t => (
                    <span
                      key={t.id}
                      onClick={() => {
                        setTargetMonthId(t.id);
                        setTargetMonthName(t.monthName);
                        setTargetMainPoolCount(t.mainTarget);
                        setTargetSteelFab(t.steelFabricationTarget || 0);
                        setTargetSteelPrimer(t.steelPrimerTarget || 0);
                        setTargetPlumbing(t.plumbingTarget || 0);
                        setTargetCladding(t.claddingTarget || 0);
                        setTargetSkimmerFitting(t.skimmerFittingTarget || t.claddingTarget || 0);
                        setTargetLamination(t.laminationTarget || 0);
                        setTargetMechFitting(t.mechanicalFittingTarget || 0);
                        setTargetMosaic(t.mosaicTarget || 0);
                        setTargetGrouting(t.groutingTarget || 0);
                        setTargetAcrylic(t.acrylicTarget || 0);
                        setTargetOee(t.targetOee || 80);
                        setTargetNotes(t.notes || '');
                      }}
                      className="px-3 py-1 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-705 text-xs font-semibold rounded-lg shrink-0 cursor-pointer flex items-center gap-1.5"
                    >
                      <Calendar className="h-3.5 w-3.5 text-indigo-600" />
                      {t.monthName} (Target: {t.mainTarget})
                    </span>
                  ))}
                </div>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* ====== TAB 6: DIRECT STAGE & STATUS OVERRIDE PORTAL ====== */}
      {activeTab === 'direct_stage_portal' && (
        <div id="direct-stage-portal-content" className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-6 animate-fadeIn">
          <div>
            <h3 className="text-sm font-black text-slate-800 flex items-center gap-1.5 uppercase tracking-wide">
              🕹️ Direct Stage & Status Override Control Panel
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Force-assign any factory pool to a specific manufacturing stage, update design parameters, or record instantaneous field delivery without advancing steps manually.
            </p>
          </div>

          {directSuccessMessage && (
            <div className="bg-emerald-50 text-emerald-800 text-xs p-3.5 rounded-xl border border-emerald-100 flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-emerald-600 shrink-0" />
              <span>{directSuccessMessage}</span>
            </div>
          )}

          <form onSubmit={(e) => {
            e.preventDefault();
            const finalPrj = useCustomDirectProject ? customDirectProjectName.trim() : directProjectName;
            if (!finalPrj) {
              alert('Please specify a valid Project Association Name.');
              return;
            }
            if (!directPoolNo.trim()) {
              alert('Please specify a valid Pool Number.');
              return;
            }

            if (onDirectOverridePool) {
              const parseStageNum = directStageSelect === 'delivered' ? STAGES.length : parseInt(directStageSelect, 10);
              const isDeliv = directStageSelect === 'delivered';
              
              onDirectOverridePool({
                id: selectedPoolIdOrNew === 'NEW_POOL' ? undefined : selectedPoolIdOrNew,
                projectName: finalPrj,
                poolNo: directPoolNo.trim(),
                orientation: directOrientation,
                dimensions: directDimensions,
                shape: directShape,
                poolType: directPoolType,
                notes: directNotes,
                isDelivered: isDeliv,
                currentStageIndex: parseStageNum,
                createdAt: directEntryDate ? new Date(directEntryDate + 'T08:00:00').toISOString() : undefined
              }, overrideOperatorName.trim() || 'Planning Admin');

              setDirectSuccessMessage(`Pool "${directPoolNo.trim()}" in project "${finalPrj}" successfully updated to: ${isDeliv ? 'Delivered' : STAGES[parseStageNum]?.name || 'Completed'}!`);
              setTimeout(() => setDirectSuccessMessage(null), 5000);

              // Reset ID select to allow further additions
              setSelectedPoolIdOrNew('NEW_POOL');
            }
          }}
          className="grid grid-cols-1 md:grid-cols-2 gap-6"
          >
            {/* Left Column: Association & Identity */}
            <div className="space-y-4">
              <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider">01. Project & Pool Selectors</h4>
              
              {/* Project select */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-bold text-slate-500">
                  <label>Associated Project</label>
                  <label className="flex items-center gap-1 cursor-pointer font-bold text-indigo-600 select-none">
                    <input
                      type="checkbox"
                      checked={useCustomDirectProject}
                      onChange={(e) => {
                        setUseCustomDirectProject(e.target.checked);
                        setSelectedPoolIdOrNew('NEW_POOL');
                      }}
                      className="rounded text-indigo-600 focus:ring-1 focus:ring-indigo-500"
                    />
                    <span>New Project Name</span>
                  </label>
                </div>
                {useCustomDirectProject ? (
                  <input
                    type="text"
                    required
                    value={customDirectProjectName}
                    onChange={(e) => setCustomDirectProjectName(e.target.value)}
                    placeholder="Enter brand new project name..."
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                ) : (
                  <select
                    value={directProjectName}
                    onChange={(e) => {
                      setDirectProjectName(e.target.value);
                      setSelectedPoolIdOrNew('NEW_POOL');
                    }}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-705 cursor-pointer focus:outline-none"
                  >
                    {allUniqueProjects.map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* Pool selection */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 block">Select Target Pool to Edit / Override</label>
                <select
                  value={selectedPoolIdOrNew}
                  onChange={(e) => setSelectedPoolIdOrNew(e.target.value)}
                  className="w-full bg-indigo-50 border border-indigo-200 rounded-xl px-3.5 py-2 text-xs text-indigo-900 cursor-pointer font-bold focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="NEW_POOL">+ [CREATE NEW POOL DIRECTLY IN ACTIVE MANUFACTURING STATE]</option>
                  {projectSpecificPools.map(p => (
                    <option key={p.id} value={p.id}>
                      Pool {p.poolNo} ({p.isDelivered ? 'Delivered' : STAGES[p.currentStageIndex]?.name || 'Assembly Done'})
                    </option>
                  ))}
                </select>
              </div>

              {/* Pool No Designation */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 block">Pool Number designation</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. T-05"
                  value={directPoolNo}
                  onChange={(e) => setDirectPoolNo(e.target.value)}
                  disabled={selectedPoolIdOrNew !== 'NEW_POOL'}
                  className={`w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-800 focus:outline-none ${selectedPoolIdOrNew !== 'NEW_POOL' ? 'opacity-65 cursor-not-allowed font-semibold' : ''}`}
                />
              </div>

              {/* Specifications Sub-fields */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 block">Orientation</label>
                  <select
                    value={directOrientation}
                    onChange={(e) => setDirectOrientation(e.target.value as PoolOrientation)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-705 cursor-pointer"
                  >
                    <option value="Normal">Normal Orientation</option>
                    <option value="Mirror">Mirror Orientation</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 block">Dimensions</label>
                  <input
                    type="text"
                    required
                    value={directDimensions}
                    onChange={(e) => setDirectDimensions(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-800 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 block">Shape</label>
                  <input
                    type="text"
                    required
                    value={directShape}
                    onChange={(e) => setDirectShape(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-800 focus:outline-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 block">Pool Type Category</label>
                  <input
                    type="text"
                    required
                    value={directPoolType}
                    onChange={(e) => setDirectPoolType(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-800 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Right Column: Destined Stage & Metadata */}
            <div className="space-y-4 flex flex-col justify-between">
              <div className="space-y-4">
                <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider">02. State, Stage & Authorisation Override</h4>
                
                {/* Stage selector dropdown */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 block">Durable Target State / Stage</label>
                  <select
                    value={directStageSelect}
                    onChange={(e) => setDirectStageSelect(e.target.value)}
                    className="w-full bg-indigo-650 border border-indigo-200 rounded-xl px-3.5 py-2 text-xs text-white bg-indigo-600 font-extrabold cursor-pointer focus:outline-none"
                  >
                    {STAGES.map((s, idx) => (
                      <option key={s.id} value={String(idx)} className="bg-white text-slate-800 font-normal">
                        Active Stage {idx + 1}: {s.name}
                      </option>
                    ))}
                    <option value={String(STAGES.length)} className="bg-white text-slate-800 font-normal">
                      ✅ Fully Produced Pools (Assembly Done)
                    </option>
                    <option value="delivered" className="bg-white text-emerald-800 font-bold">
                      🚚 MARK AS DELIVERED / COMPLETED OUT-OF-FACTORY
                    </option>
                  </select>
                </div>

                {/* Entry Date — backdate support */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 block">Entry Date <span className="text-slate-400 font-normal normal-case">(backdate if needed)</span></label>
                  <input
                    type="date"
                    value={directEntryDate}
                    onChange={(e) => setDirectEntryDate(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-800 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>

                {/* Operator Sign-off Name */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 block">Override Sign-off Operator / planner</label>
                  <input
                    type="text"
                    required
                    value={overrideOperatorName}
                    onChange={(e) => setOverrideOperatorName(e.target.value)}
                    placeholder="E.g. Planning Director"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-800 focus:outline-none"
                  />
                </div>

                {/* Override Notes */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 block">Override Reason / Audit Notes</label>
                  <textarea
                    rows={2}
                    value={directNotes}
                    onChange={(e) => setDirectNotes(e.target.value)}
                    placeholder="Indicate instructions or reason for direct manufacturing state sync..."
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-800 focus:outline-none resize-none"
                  />
                </div>
              </div>

              {/* Submit Trigger */}
              <div className="pt-2">
                <button
                  type="submit"
                  className="w-full bg-indigo-650 hover:bg-indigo-750 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold py-3 px-4 rounded-xl text-xs text-center duration-150 shadow-md cursor-pointer flex items-center justify-center gap-2 border-0"
                >
                  <Zap className="h-4 w-4" />
                  Override & Push State to Active Shop Floor
                </button>
              </div>
            </div>
          </form>

          {/* Bento Block: Excel Direct Stage Override Sync */}
          <div className="bg-white p-6 rounded-2xl border border-slate-150 shadow-sm space-y-6 mt-6 border-t-4 border-t-indigo-500">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-sm font-black text-slate-800 flex items-center gap-1.5 font-sans uppercase tracking-wide">
                  <FileSpreadsheet className="h-5 w-5 text-indigo-600" />
                  Excel Direct Stage Sync Overrides
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Synchronize multiple pools at once (including different production stages, completed inventory, or delivered records) from an Excel workbook.
                </p>
              </div>
              
              {directExcelFileName && (
                <button
                  type="button"
                  onClick={() => {
                    setDirectExcelFileName('');
                    setDirectExcelRawHeaders([]);
                    setDirectExcelRawRows([]);
                  }}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-1.5 px-3 rounded-lg text-xs duration-150 flex items-center gap-1 cursor-pointer"
                >
                  Clear & Reset Uploader
                </button>
              )}
            </div>

            {/* Dropzone Container */}
            {!directExcelFileName ? (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDirectExcelDragActive(true);
                }}
                onDragLeave={() => setIsDirectExcelDragActive(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDirectExcelDragActive(false);
                  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                    handleDirectExcelUpload(e.dataTransfer.files[0]);
                  }
                }}
                className={`border-2 border-dashed rounded-2xl p-8 text-center transition-all duration-150 cursor-pointer ${
                  isDirectExcelDragActive
                    ? 'border-indigo-500 bg-indigo-50/40'
                    : 'border-slate-200 hover:border-indigo-400 bg-slate-50/50 hover:bg-slate-50'
                }`}
                onClick={() => {
                  document.getElementById('direct-excel-file-hidden-input')?.click();
                }}
              >
                <input
                  id="direct-excel-file-hidden-input"
                  type="file"
                  accept=".xlsx, .xls"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleDirectExcelUpload(e.target.files[0]);
                    }
                  }}
                />
                <div className="mx-auto h-12 w-12 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600 mb-3">
                  <Upload className="h-6 w-6" />
                </div>
                <div className="text-xs font-bold text-slate-700">
                  Select or drag and drop status override Excel sheet
                </div>
                <p className="text-[10px] text-slate-400 mt-1">
                  Processes columns: Project Name, Pool Number, Sizing Dimensions, Orientation, Shape, Status / Stage, Remarks (Supports .XLSX, .XLS)
                </p>
              </div>
            ) : (
              <div className="bg-indigo-50/20 border border-indigo-100 p-4 rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 bg-indigo-100 rounded-lg flex items-center justify-center text-indigo-700">
                    <FileSpreadsheet className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-extrabold text-slate-800">{directExcelFileName}</h4>
                    <span className="text-[10px] text-indigo-700 font-bold block bg-indigo-100/50 px-1.5 py-0.5 rounded w-fit mt-0.5">
                      {directExcelRawRows.length} override records loaded
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-indigo-500 animate-pulse" />
                  <span className="text-[10px] font-bold text-indigo-700 uppercase">Ready to configure column mapper</span>
                </div>
              </div>
            )}

            {/* Column mapping controls */}
            {directExcelFileName && (
              <div className="space-y-4">
                <div className="border-t border-slate-100 pt-4">
                  <h4 className="text-xs font-black text-indigo-900 flex items-center gap-1">
                    <Sliders className="h-4 w-4 text-indigo-500" />
                    Fuzzy Column Matching Configurator
                  </h4>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Map each parameter from the Excel sheet below to tell the system how to read projects, pool serials, and their corresponding manufacturing stage status.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
                  {/* Field 1: Project Name */}
                  <div className="space-y-1">
                    <label className="text-[11px] font-black text-slate-500 flex items-center gap-1">
                      <span className="text-red-500">*</span> Project Association
                    </label>
                    <select
                      value={directExcelMapping.projectName}
                      onChange={(e) => setDirectExcelMapping(prev => ({ ...prev, projectName: e.target.value }))}
                      className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none"
                    >
                      <option value="">-- Click to select column --</option>
                      {directExcelRawHeaders.map(h => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>

                  {/* Field 2: Pool No */}
                  <div className="space-y-1">
                    <label className="text-[11px] font-black text-slate-500 flex items-center gap-1">
                      <span className="text-red-500">*</span> Pool Serial / Code
                    </label>
                    <select
                      value={directExcelMapping.poolNo}
                      onChange={(e) => setDirectExcelMapping(prev => ({ ...prev, poolNo: e.target.value }))}
                      className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none"
                    >
                      <option value="">-- Click to select column --</option>
                      {directExcelRawHeaders.map(h => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>

                  {/* Field 3: Status / Stage Mapping */}
                  <div className="space-y-1">
                    <label className="text-[11px] font-black text-indigo-600 flex items-center gap-1">
                      <span className="text-red-500">*</span> Status / Stage Column
                    </label>
                    <select
                      value={directExcelMapping.status}
                      onChange={(e) => setDirectExcelMapping(prev => ({ ...prev, status: e.target.value }))}
                      className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                    >
                      <option value="">-- Click to select column --</option>
                      {directExcelRawHeaders.map(h => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>

                  {/* Field 4: Sizing / Dimensions */}
                  <div className="space-y-1">
                    <label className="text-[11px] font-black text-slate-500">Dimensions</label>
                    <select
                      value={directExcelMapping.dimensions}
                      onChange={(e) => setDirectExcelMapping(prev => ({ ...prev, dimensions: e.target.value }))}
                      className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none"
                    >
                      <option value="">-- Optional (Constant 12m x 5m if unmapped) --</option>
                      {directExcelRawHeaders.map(h => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>

                  {/* Field 5: Shape */}
                  <div className="space-y-1">
                    <label className="text-[11px] font-black text-slate-500">Mould Shape</label>
                    <select
                      value={directExcelMapping.shape}
                      onChange={(e) => setDirectExcelMapping(prev => ({ ...prev, shape: e.target.value }))}
                      className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none"
                    >
                      <option value="">-- Optional (Rectangle if unmapped) --</option>
                      {directExcelRawHeaders.map(h => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>

                  {/* Field 6: Orientation */}
                  <div className="space-y-1">
                    <label className="text-[11px] font-black text-slate-500">Orientation</label>
                    <select
                      value={directExcelMapping.orientation}
                      onChange={(e) => setDirectExcelMapping(prev => ({ ...prev, orientation: e.target.value }))}
                      className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none"
                    >
                      <option value="">-- Optional (Normal if unmapped) --</option>
                      {directExcelRawHeaders.map(h => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>

                  {/* Field 7: Model Code */}
                  <div className="space-y-1">
                    <label className="text-[11px] font-black text-slate-500">Model Class / Type</label>
                    <select
                      value={directExcelMapping.poolType}
                      onChange={(e) => setDirectExcelMapping(prev => ({ ...prev, poolType: e.target.value }))}
                      className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none"
                    >
                      <option value="">-- Optional (Type 3 if unmapped) --</option>
                      {directExcelRawHeaders.map(h => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>

                  {/* Field 8: Notes */}
                  <div className="space-y-1">
                    <label className="text-[11px] font-black text-slate-500">Remarks / Audit Notes</label>
                    <select
                      value={directExcelMapping.notes}
                      onChange={(e) => setDirectExcelMapping(prev => ({ ...prev, notes: e.target.value }))}
                      className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none"
                    >
                      <option value="">-- Optional (Auto-remarks if unmapped) --</option>
                      {directExcelRawHeaders.map(h => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Parsed override preview table ledger */}
                <div className="space-y-2 pt-2 border-t border-slate-150">
                  <div className="flex items-center justify-between">
                    <h5 className="text-[11px] font-black text-slate-700 flex items-center gap-1">
                      <Layers className="h-3.5 w-3.5 text-indigo-500" />
                      Parsed Overrides Validation Ledger
                    </h5>
                    <div className="text-[10px] text-slate-400 font-bold">
                      Planned: <span className="text-amber-600 font-black">{previewsDirectImportPools.filter(p => !p.isInvalid && p.isPlanned).length}</span> | 
                      In Factory Production: <span className="text-indigo-650 font-black">{previewsDirectImportPools.filter(p => !p.isInvalid && !p.isPlanned && p.currentStageIndex < STAGES.length).length}</span> | 
                      Completed Stock: <span className="text-blue-600 font-black">{previewsDirectImportPools.filter(p => !p.isInvalid && !p.isPlanned && p.currentStageIndex === STAGES.length && !p.isDelivered).length}</span> | 
                      Delivered: <span className="text-emerald-600 font-black">{previewsDirectImportPools.filter(p => !p.isInvalid && p.isDelivered).length}</span>
                    </div>
                  </div>

                  <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200 text-xs shadow-inner">
                    <table className="w-full text-left bg-white leading-tight">
                      <thead className="bg-slate-100 text-[10px] uppercase font-bold text-slate-500 sticky top-0 leading-none">
                        <tr>
                          <th className="py-2.5 px-3 w-10">Row</th>
                          <th className="py-2.5 px-3">Project</th>
                          <th className="py-2.5 px-3">Pool Serial</th>
                          <th className="py-2.5 px-2">Sizing / Details</th>
                          <th className="py-2.5 px-2">Fuzzy Resolved Status (Target Stage)</th>
                          <th className="py-2.5 px-3 text-right">Mapping Verdict</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-[11px]">
                        {previewsDirectImportPools.map((p, idx) => (
                          <tr
                            key={idx}
                            className={
                              p.isInvalid
                                ? 'bg-rose-50/20 text-rose-700'
                                : p.isDelivered
                                ? 'bg-emerald-55/10 hover:bg-emerald-50/40 text-emerald-950 font-semibold'
                                : p.isPlanned
                                ? 'bg-amber-55/10 hover:bg-amber-50/30'
                                : 'hover:bg-slate-50/50'
                            }
                          >
                            <td className="py-2 px-3 font-mono text-[9px] text-slate-400">#{idx + 1}</td>
                            <td className="py-2 px-3 font-bold truncate max-w-[120px]" title={p.projectName}>{p.projectName}</td>
                            <td className="py-2 px-3 font-mono font-black tracking-wide text-indigo-950">{p.poolNo || '(Empty Code)'}</td>
                            <td className="py-2 px-2 text-[10px] text-slate-500">
                              {p.dimensions} | {p.shape} | {p.orientation} ({p.poolType})
                            </td>
                            <td className="py-2 px-2">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold ${
                                p.isDelivered 
                                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-250' 
                                  : p.isPlanned
                                  ? 'bg-amber-100 text-amber-800'
                                  : p.currentStageIndex >= STAGES.length
                                  ? 'bg-purple-100 text-purple-800 border border-purple-200'
                                  : 'bg-indigo-50 text-indigo-700 border border-indigo-150'
                              }`}>
                                {p.resolvedName}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-right">
                              {p.isInvalid ? (
                                <span className="inline-flex items-center gap-0.5 text-rose-600 font-extrabold text-[9px] bg-rose-50 py-0.5 px-1.5 rounded uppercase">
                                  <AlertTriangle className="h-2.5 w-2.5" /> Missing Code
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-0.5 text-indigo-700 font-black text-[9px] bg-indigo-50 px-1.5 py-0.5 rounded uppercase">
                                  READY TO SYNC
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Operational sign-off panel for execute */}
                  <div className="bg-indigo-50/40 p-4 rounded-xl border border-indigo-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 mt-3">
                    <div className="text-[11px] leading-relaxed text-indigo-900 max-w-xl">
                      <span className="block font-black flex items-center gap-1">
                        <Zap className="h-3.5 w-3.5 text-amber-500 animate-bounce" /> Save Warning / Synchronizer Preview:
                      </span>
                      <span>
                        This bulk operation will instantly override states for <strong>{previewsDirectImportPools.filter(p => !p.isInvalid).length}</strong> pool records. Any pools experiencing design stage changes will have their respective digital trail instantly shifted, complete with automatic activity tracking logs.
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handlePerformDirectExcelImport}
                        disabled={previewsDirectImportPools.filter(p => !p.isInvalid).length === 0}
                        className={`font-black py-2.5 px-5 rounded-xl text-xs flex items-center justify-center gap-1.5 duration-150 shrink-0 select-none shadow-sm cursor-pointer ${
                          previewsDirectImportPools.filter(p => !p.isInvalid).length === 0
                            ? 'bg-slate-200 text-slate-400 border border-slate-300 cursor-not-allowed'
                            : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                        }`}
                      >
                        <Check className="h-4 w-4" />
                        <span>Execute Excel Status Override Sync</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
          {/* End of Bento Block: Excel Direct Stage Override Sync */}

          {/* Visual stage progress list */}
          <div className="bg-slate-50 p-4 border border-slate-100 rounded-xl space-y-3">
            <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider font-mono">
              Override Progression Visual Path Check:
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {STAGES.map((s, idx) => {
                const targetInt = directStageSelect === 'delivered' ? STAGES.length : parseInt(directStageSelect, 10);
                const isPassed = targetInt > idx;
                const isCurrent = targetInt === idx;
                return (
                  <React.Fragment key={s.id}>
                    <div className={`px-2 py-1 text-[9px] font-bold rounded-md flex items-center gap-1 border transition-all ${
                      isCurrent 
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs' 
                        : isPassed 
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                        : 'bg-slate-100 text-slate-400 border-slate-150'
                    }`}>
                      {isPassed && <CheckCircle className="h-2.5 w-2.5" />}
                      {s.name}
                    </div>
                    {idx < STAGES.length - 1 && <span className="text-slate-300 text-xs font-sans">&rarr;</span>}
                  </React.Fragment>
                );
              })}
              <span className="text-slate-300 text-xs font-sans">&rarr;</span>
              <div className={`px-2 py-1 text-[9px] font-bold rounded-md flex items-center gap-1 border transition-all ${
                directStageSelect === String(STAGES.length)
                  ? 'bg-indigo-600 text-white border-indigo-650 shadow-xs'
                  : directStageSelect === 'delivered'
                  ? 'bg-emerald-600 text-white border-emerald-605'
                  : 'bg-slate-100 text-slate-400 border-slate-150'
              }`}>
                {directStageSelect === 'delivered' && <CheckCircle className="h-2.5 w-2.5" />}
                {directStageSelect === 'delivered' ? '🚚 Delivered' : '🏁 Produced'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DISPATCH/RELEASE POOL DIALOG CONFIRMATION MODAL OVERLAY */}
      {releasingPlanId !== null && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-2xl max-w-md w-full p-6 space-y-5 animate-scaleUp">
            
            <div className="flex items-start gap-4">
              <div className="bg-indigo-50 p-3 rounded-full text-indigo-600 shrink-0">
                <Zap className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-base font-black text-slate-800 font-sans tracking-wide">
                  Confirm Shop Floor Dispatch Release
                </h3>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  Releasing this pool allocation immediately spawns a live manufacturing shell card inside <strong>Steel Fabrication (Stage 1)</strong> on the active factory floor.
                </p>
              </div>
            </div>

            <div className="bg-slate-50 p-3.5 rounded-xl text-xs font-mono space-y-1 text-slate-705 border border-slate-150">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Pool Serial:</span>
                <span className="font-extrabold text-slate-900 text-sm">
                  {plannedPools.find(p => p.id === releasingPlanId)?.poolNo}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Target Project:</span>
                <span className="font-bold text-slate-800">
                  {plannedPools.find(p => p.id === releasingPlanId)?.projectName}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Orientation/Mold:</span>
                <span className="text-indigo-600 font-bold">
                  {plannedPools.find(p => p.id === releasingPlanId)?.orientation} ({plannedPools.find(p => p.id === releasingPlanId)?.shape})
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-505 text-slate-550 block text-slate-500">Assign Sign-off Coordinator Officer</label>
              <select
                value={selectedEngineerId}
                onChange={(e) => setSelectedEngineerId(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-700 focus:outline-none"
              >
                {engineers.map(eng => (
                  <option key={eng.id} value={eng.id}>{eng.name}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-3.5 pt-2">
              <button
                onClick={() => setReleasingPlanId(null)}
                className="flex-1 bg-slate-50 hover:bg-slate-100 border border-slate-205 text-slate-600 font-bold py-2 px-4 rounded-xl text-xs text-center duration-150 cursor-pointer"
              >
                Abort Release
              </button>
              <button
                onClick={handleConfirmRelease}
                className="flex-1 bg-indigo-650 hover:bg-indigo-750 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold py-2 px-4 rounded-xl text-xs text-center duration-150 shadow-xs cursor-pointer"
              >
                Confirm Dispatch
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};
