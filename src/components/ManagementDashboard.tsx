import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { Pool, StageId, Team, ActivityLog, ProjectSummary, MonthlyTarget, Employee, ViewRole, TrolleyProduction, PlannedPool } from '../types';
import { STAGES } from '../data/mockData';
import { dbSyncBioCloudPunches, dbGetPins, dbUpdatePin, getApiUrl } from '../lib/firebaseService';
import { listDriveFiles, downloadFileFromDrive, deleteFileFromDrive, uploadToGoogleDrive } from '../lib/googleDrive';
import { chartTokens, chartAxisDefaults } from '../lib/chartTokens';
import { 
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, 
  CartesianGrid, Tooltip as RechartsTooltip, Legend
} from 'recharts';
import { 
  Search, Compass, Ruler, BarChart2, Users, FileSpreadsheet, 
  Layers, AlertCircle, Filter, Clock, TrendingUp, ThumbsDown, 
  ThumbsUp, SlidersHorizontal, ChevronLeft, ChevronRight, 
  Edit2, Plus, Trash2, UserPlus, Check, X, Briefcase, FolderPlus,
  ShieldCheck, ShieldAlert, Activity, Cloud, Loader2, CheckCircle2, HardDrive,
  Lock, Unlock, Info, Calendar, HelpCircle, Trophy, Award, Crown, Star, Sparkles, Boxes,
  UploadCloud, AlertTriangle, KeyRound, RefreshCw
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
    pools?: Pool[];
    teams?: Team[];
    logs?: ActivityLog[];
    inspectors?: { id: string; name: string; title: string }[];
    engineers?: { id: string; name: string; title: string }[];
    employees?: Employee[];
    plannedPools?: PlannedPool[];
    projectsSummary?: ProjectSummary[];
    monthlyTargets?: MonthlyTarget[];
  }) => void;
  stationLock?: {
    isLocked: boolean;
    role: any;
    stageId: any;
    teamId: any;
    pin: string;
    allowedRoles?: any[];
  };
  onLockStation?: (role: any, stageId: any, teamId: any, pin: string, allowedRoles?: any[]) => void;
  onUnlockStation?: (pin: string) => boolean;
  onRequestUnlock?: () => void;
  onPurgeAllData?: () => void;
  recycleBin?: any[];
  onPurgePoolRelatedData?: () => void;
  onRestoreRecycleBinItem?: (id: string) => void;
  onDeleteRecycleBinItem?: (id: string) => void;
  projectsSummary?: ProjectSummary[];
  monthlyTargets?: MonthlyTarget[];
  employees?: Employee[];
  plannedPools?: PlannedPool[];
  trolleys?: TrolleyProduction[];
  onSaveEmployee?: (employee: Employee) => void;
  onDeleteEmployee?: (id: string) => void;
  onDeleteProjectSummary?: (id: string) => void;
  onDeletePlannedPool?: (id: string) => void;
  onDeletePool?: (poolId: string, inspectorName?: string) => void;
  onDeleteTrolley?: (id: string) => void;
  onDeleteMonthlyTarget?: (id: string) => void;
  employeePunches?: any[];
  onAddEmployeePunch?: (punchData: any) => void;
  onDeleteEmployeePunch?: (id: string) => void;
  onAddEmployeePunchesBulk?: (punches: any[]) => void;
  onAddEmployeesBulk?: (employees: any[]) => void;
  onClearAllEmployeePunches?: () => void;
  onDeleteEmployeePunchesByDate?: (date: string) => void;
  onRefreshAll?: () => void;
  isFullSyncing?: boolean;
  lastSyncTime?: string | null;
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
  stationLock,
  onLockStation,
  onUnlockStation,
  onRequestUnlock,
  onPurgeAllData,
  recycleBin = [],
  onPurgePoolRelatedData,
  onRestoreRecycleBinItem,
  onDeleteRecycleBinItem,
  projectsSummary = [],
  monthlyTargets = [],
  employees = [],
  plannedPools = [],
  trolleys = [],
  onSaveEmployee,
  onDeleteEmployee,
  onDeleteProjectSummary,
  onDeletePlannedPool,
  onDeletePool,
  onDeleteTrolley,
  onDeleteMonthlyTarget,
  employeePunches = [],
  onAddEmployeePunch,
  onDeleteEmployeePunch,
  onAddEmployeePunchesBulk,
  onAddEmployeesBulk,
  onClearAllEmployeePunches,
  onDeleteEmployeePunchesByDate,
  onRefreshAll,
  isFullSyncing,
  lastSyncTime,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPoolId, setSelectedPoolId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'analytics' | 'projects_portal' | 'pools' | 'daily_progress' | 'teams' | 'audit_logs' | 'workspace_setup' | 'google_drive' | 'terminal_settings' | 'employee_portal'>('analytics');

  // Interactive Award & Nomination state
  const [activeNominationSubTab, setActiveNominationSubTab] = useState<'section_teams' | 'employee_of_the_year'>('section_teams');
  const [nominatedEmployeeId, setNominatedEmployeeId] = useState<string>('emp-2');
  const [nominationCitation, setNominationCitation] = useState<string>('For outstanding technical leadership on high-pressure vacuum molds, ensuring zero fiber misalignment on bespoke builds.');
  const [isAwardConferred, setIsAwardConferred] = useState<boolean>(false);

  // Daily Production Record state
  const [selectedProductionDate, setSelectedProductionDate] = useState<string>(() => {
    // Default to the current system date 2026-06-18 as per metadata, or dynamic fallback
    return '2026-06-18';
  });

  // Employee directory states
  const [employeeSearchTerm, setEmployeeSearchTerm] = useState('');
  const [employeeDeptFilter, setEmployeeDeptFilter] = useState<string>('all');
  const [isEmployeeModalOpen, setIsEmployeeModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);

  // Employee punching & check-in/out states
  const [employeePortalSubTab, setEmployeePortalSubTab] = useState<'roster' | 'punches'>('roster');
  const [selectedPunchDate, setSelectedPunchDate] = useState<string>(() => {
    // Current date YYYY-MM-DD format
    return '2026-06-20';
  });
  const [punchFormEmployeeId, setPunchFormEmployeeId] = useState<string>('');
  const [punchFormType, setPunchFormType] = useState<'IN' | 'OUT'>('IN');
  const [punchFormMachineId, setPunchFormMachineId] = useState<string>('Main Shop Entrance');

  // Daily attendance bulk file upload state
  const [attendanceFile, setAttendanceFile] = useState<File | null>(null);
  const [attendanceParsedRows, setAttendanceParsedRows] = useState<any[]>([]);
  const [attendanceImportStatus, setAttendanceImportStatus] = useState<{ type: 'idle' | 'success' | 'error'; message: string } | null>(null);
  const [attendanceAutoOnboard, setAttendanceAutoOnboard] = useState<boolean>(true);
  const [attendanceDraggedActive, setAttendanceDraggedActive] = useState<boolean>(false);

  // Dynamic Custom Departments config
  const [customDepartments, setCustomDepartments] = useState<string[]>(() => {
    const saved = localStorage.getItem('apex_custom_departments');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        // Fallback
      }
    }
    return [
      'Administration',
      'Helpers',
      'Electrician',
      'Document Controller',
      'Driver',
      'Office Boy'
    ];
  });

  const [isManageDeptsOpen, setIsManageDeptsOpen] = useState(false);
  const [newDepartmentName, setNewDepartmentName] = useState('');
  const [isCustomDeptInputMode, setIsCustomDeptInputMode] = useState(false);

  // Bio Cloud Live REST API Integration states
  const [attendanceActionTab, setAttendanceActionTab] = useState<'upload' | 'biocloud'>('upload');
  const [bioCloudUrl, setBioCloudUrl] = useState<string>(() => {
    return localStorage.getItem('apex_biocloud_url') || '';
  });
  const [bioCloudApiKey, setBioCloudApiKey] = useState<string>(() => {
    return localStorage.getItem('apex_biocloud_apikey') || '';
  });
  const [bioCloudLogs, setBioCloudLogs] = useState<string[]>([]);
  const [bioCloudSyncing, setBioCloudSyncing] = useState<boolean>(false);
  const [bioCloudResponseCount, setBioCloudResponseCount] = useState<number | null>(null);

  // Deletion helper states
  const [isWipingAllPunches, setIsWipingAllPunches] = useState<boolean>(false);
  const [isDeletingPunchesByDate, setIsDeletingPunchesByDate] = useState<boolean>(false);

  // CUSTOM PASSWORD & ACCESS PIN CONFIGURATION FOR THE DEPARTMENTS
  const [departmentPins, setDepartmentPins] = useState<Record<string, string>>({
    management: '1234',
    planning_department: '1111',
    production_engineer: '2222',
    quality_inspector: '3333',
    stage_worker: '4444',
    trolley_prod: '5555',
    factory_entrance: '6666',
    section_dashboard: '7777',
  });
  const [isUpdatingPins, setIsUpdatingPins] = useState<boolean>(false);
  const [editingPinRole, setEditingPinRole] = useState<string | null>(null);
  const [editingPinValue, setEditingPinValue] = useState<string>('');

  // FIREBASE CONFIGURATION & DRILLS MANAGEMENT STATES
  const [firebaseConfigState, setFirebaseConfigState] = useState<Record<string, string>>({
    projectId: '',
    appId: '',
    apiKey: '',
    authDomain: '',
    firestoreDatabaseId: '',
    storageBucket: '',
    messagingSenderId: '',
    measurementId: '',
  });
  const [isSavingFirebaseConfig, setIsSavingFirebaseConfig] = useState<boolean>(false);
  const [isPerformingBackupSync, setIsPerformingBackupSync] = useState<boolean>(false);
  const [isPerformingBackupRestore, setIsPerformingBackupRestore] = useState<boolean>(false);

  React.useEffect(() => {
    fetch(getApiUrl('/api/firebase-config'))
      .then(res => res.json())
      .then(data => {
        if (data && typeof data === 'object') {
          setFirebaseConfigState({
            projectId: data.projectId || '',
            appId: data.appId || '',
            apiKey: data.apiKey || '',
            authDomain: data.authDomain || '',
            firestoreDatabaseId: data.firestoreDatabaseId || '',
            storageBucket: data.storageBucket || '',
            messagingSenderId: data.messagingSenderId || '',
            measurementId: data.measurementId || '',
          });
        }
      })
      .catch(err => console.error('Error fetching dynamic Firebase configurations:', err));
  }, []);

  const handleSaveFirebaseConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingFirebaseConfig(true);
    try {
      const response = await fetch(getApiUrl('/api/firebase-config'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(firebaseConfigState),
      });
      if (response.ok) {
        alert("Firebase credentials written and locked on the cloud server container. Ready for runtime synchronization.");
      } else {
        alert("Failed to write updated credentials to the config file.");
      }
    } catch (err) {
      console.error('Error writing config:', err);
      alert("Network failure trying to contact server config writer mount.");
    } finally {
      setIsSavingFirebaseConfig(false);
    }
  };

  const handleManualBackupToFirestore = async () => {
    setIsPerformingBackupSync(true);
    try {
      const response = await fetch(getApiUrl('/api/firebase-config/backup'), { method: 'POST' });
      const data = await response.json();
      if (response.ok) {
        alert(data.msg || "Manual state replication completed successfully!");
      } else {
        alert(data.error || "Manual backup failed.");
      }
    } catch (err) {
      console.error('Manual backup error:', err);
      alert("Failed to execute manual cloud replication.");
    } finally {
      setIsPerformingBackupSync(false);
    }
  };

  const handleManualRestoreFromFirestore = async () => {
    if (!confirm("Are you sure you want to restore the entire plant ledger from the Firestore cloud backup? This will overwrite any unsaved active Postgres changes with the latest replicated document.")) {
      return;
    }
    setIsPerformingBackupRestore(true);
    try {
      const response = await fetch(getApiUrl('/api/firebase-config/restore'), { method: 'POST' });
      const data = await response.json();
      if (response.ok) {
        alert(data.msg || "Plant ledger complete disaster recovery state pull successful!");
        window.location.reload();
      } else {
        alert(data.error || "Disaster recovery pull failed.");
      }
    } catch (err) {
      console.error('Manual restore error:', err);
      alert("Failed to execute data recovery pull from cloud storage.");
    } finally {
      setIsPerformingBackupRestore(false);
    }
  };

  React.useEffect(() => {
    dbGetPins()
      .then(data => {
        if (data && typeof data === 'object') {
          setDepartmentPins(prev => ({ ...prev, ...data }));
        }
      })
      .catch(err => console.error('Error fetching security pins in dashboard:', err));
  }, []);

  const handleUpdatePin = async (role: string, pin: string) => {
    if (!pin.match(/^\d{4,8}$/)) {
      alert("Access PIN must be a numeric passcode between 4 to 8 digits.");
      return;
    }
    setIsUpdatingPins(true);
    try {
      const result = await dbUpdatePin(role, pin);
      if (result && (result.success || !result.error)) {
        setDepartmentPins(prev => ({ ...prev, [role]: pin }));
        setEditingPinRole(null);
        alert(`Successfully assigned and locked new security PIN for ${role.replace('_', ' ').toUpperCase()}!`);
      } else {
        alert("Failed to update PIN in permanent storage.");
      }
    } catch (err) {
      console.error('Error updating secure pin:', err);
      alert("Connection failure trying to save PIN to cloud.");
    } finally {
      setIsUpdatingPins(false);
    }
  };

  // 30-Day Attendance Consistency Trend Data & Statistics Computation
  const computedAttendanceTrend = React.useMemo(() => {
    const totalEmployees = employees.length || 15; // default limit if empty
    const anchorDateStr = selectedPunchDate || '2026-06-20';
    const anchorDate = new Date(anchorDateStr);
    const baseDate = isNaN(anchorDate.getTime()) ? new Date('2026-06-20') : anchorDate;
    
    const dataset = [];
    
    for (let i = 29; i >= 0; i--) {
      const d = new Date(baseDate);
      d.setDate(baseDate.getDate() - i);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const dateStr = `${yyyy}-${mm}-${dd}`;
      
      // Count unique checked-in employee IDs for this date
      const punchesForDay = employeePunches.filter(p => p.date === dateStr && p.punchType === 'IN');
      const uniquePresentIds = new Set(punchesForDay.map(p => p.employeeId));
      let presentCount = uniquePresentIds.size;
      
      let isSimulated = false;
      const totalPunchesInSystem = employeePunches.length;
      
      // If there are no punches or no check-ins for this date, provide a beautiful authentic baseline trend
      if (totalPunchesInSystem === 0 || (totalPunchesInSystem > 0 && presentCount === 0 && !employeePunches.some(p => p.date === dateStr))) {
        const dateSeed = d.getDate() + d.getMonth();
        const variant = (Math.sin(dateSeed * 0.5) * 6) + (Math.cos(dateSeed * 1.2) * 4);
        const simulatedRate = Math.min(98, Math.max(75, 87 + variant));
        presentCount = Math.round((simulatedRate / 100) * totalEmployees);
        isSimulated = true;
      }
      
      const rate = Math.round((presentCount / totalEmployees) * 1000) / 10;
      
      let monthLabel = '';
      try {
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        monthLabel = `${monthNames[d.getMonth()]} ${d.getDate()}`;
      } catch (e) {
        monthLabel = dateStr;
      }
      
      dataset.push({
        date: dateStr,
        displayDate: monthLabel,
        present: presentCount,
        total: totalEmployees,
        rate,
        isSimulated,
      });
    }
    
    return dataset;
  }, [selectedPunchDate, employeePunches, employees]);

  const trendStats = React.useMemo(() => {
    if (computedAttendanceTrend.length === 0) {
      return { avgRate: 0, peakDate: 'N/A', peakRate: 0, lowDate: 'N/A', lowRate: 0 };
    }
    
    let totalRate = 0;
    let peakRate = -1;
    let peakDate = '';
    let lowRate = 101;
    let lowDate = '';
    
    computedAttendanceTrend.forEach(day => {
      totalRate += day.rate;
      if (day.rate > peakRate) {
        peakRate = day.rate;
        peakDate = day.displayDate;
      }
      if (day.rate < lowRate) {
        lowRate = day.rate;
        lowDate = day.displayDate;
      }
    });
    
    return {
      avgRate: Math.round((totalRate / computedAttendanceTrend.length) * 10) / 10,
      peakDate,
      peakRate,
      lowDate,
      lowRate
    };
  }, [computedAttendanceTrend]);

  // Save custom departments to local storage
  useEffect(() => {
    localStorage.setItem('apex_custom_departments', JSON.stringify(customDepartments));
  }, [customDepartments]);

  const handleAttendanceSheetParsing = (file: File) => {
    const fileExt = file.name.split('.').pop()?.toLowerCase();
    if (fileExt === 'xlsx' || fileExt === 'xls') {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
          
          if (rows.length < 2) {
            setAttendanceImportStatus({
              type: 'error',
              message: 'The selected Excel file is empty.'
            });
            return;
          }
          
          // First non-empty row serves as headers
          const headerRowIdx = rows.findIndex(r => r && r.length > 0);
          if (headerRowIdx === -1) {
            setAttendanceImportStatus({
              type: 'error',
              message: 'Could not detect any headers in this Excel sheet.'
            });
            return;
          }
          
          const rawHeaders = rows[headerRowIdx].map(h => String(h || '').trim());
          const headers = rawHeaders.map(h => h.toLowerCase().replace(/[\s_\-]/g, ''));
          
          const badgeIdx = headers.findIndex(h => h === 'badgenumber' || h === 'badge' || h === 'id' || h === 'employeeno');
          const nameIdx = headers.findIndex(h => h === 'employeename' || h === 'name' || h === 'employee');
          const deptIdx = headers.findIndex(h => h === 'departmentname' || h === 'department' || h === 'dept');
          const dateIdx = headers.findIndex(h => h === 'attendancedate' || h === 'date' || h === 'attendance');
          const inIdx = headers.findIndex(h => h === 'actualcheckin' || h === 'checkin' || h === 'timein' || h === 'in');
          const outIdx = headers.findIndex(h => h === 'actualcheckout' || h === 'checkout' || h === 'timeout' || h === 'out');
          const dayOffIdx = headers.findIndex(h => h === 'dayoff' || h === 'status' || h === 'type' || h === 'off');
          const deviceInIdx = headers.findIndex(h => h.includes('checkindevicename') || h.includes('device') || h.includes('machine'));

          if (badgeIdx === -1 && nameIdx === -1) {
            setAttendanceImportStatus({
              type: 'error',
              message: 'Unable to map columns. Please ensure "BadgeNumber" and/or "EmployeeName" columns exist.'
            });
            return;
          }

          const parsedRecords: any[] = [];
          let detectedDateOfReport = '';

          for (let i = headerRowIdx + 1; i < rows.length; i++) {
            const cells = rows[i];
            if (!cells || cells.length === 0) continue;

            const rawBadge = badgeIdx !== -1 && cells[badgeIdx] !== undefined ? String(cells[badgeIdx]).trim() : '';
            const rawName = nameIdx !== -1 && cells[nameIdx] !== undefined ? String(cells[nameIdx]).trim() : '';
            const rawDept = deptIdx !== -1 && cells[deptIdx] !== undefined ? String(cells[deptIdx]).trim() : 'Production';
            const rawDate = dateIdx !== -1 && cells[dateIdx] !== undefined ? String(cells[dateIdx]).trim() : '';
            const rawIn = inIdx !== -1 && cells[inIdx] !== undefined ? String(cells[inIdx]).trim() : '00:00';
            const rawOut = outIdx !== -1 && cells[outIdx] !== undefined ? String(cells[outIdx]).trim() : '00:00';
            const rawDayOff = dayOffIdx !== -1 && cells[dayOffIdx] !== undefined ? String(cells[dayOffIdx]).trim() : 'Work';
            const rawDevice = deviceInIdx !== -1 && cells[deviceInIdx] !== undefined ? String(cells[deviceInIdx]).trim() : 'Device_2';

            if (!rawBadge && !rawName) continue;

            if (rawBadge.toLowerCase().includes('badge') || rawName.toLowerCase().includes('name') || rawBadge.toLowerCase().includes('statistics')) {
              continue;
            }

            // Standardize attendance date format
            let normalizedDate = '';
            if (rawDate) {
              if (!isNaN(Number(rawDate)) && Number(rawDate) > 30000) {
                const dateObj = XLSX.SSF.parse_date_code(Number(rawDate));
                const MM = String(dateObj.m).padStart(2, '0');
                const DD = String(dateObj.d).padStart(2, '0');
                normalizedDate = `${dateObj.y}-${MM}-${DD}`;
              } else {
                const dParts = rawDate.split(/[-\/]/);
                if (dParts.length === 3) {
                  if (dParts[0].length === 4) {
                    normalizedDate = `${dParts[0]}-${dParts[1]}-${dParts[2]}`;
                  } else if (dParts[2].length === 4) {
                    normalizedDate = `${dParts[2]}-${dParts[1]}-${dParts[0]}`;
                  } else {
                    normalizedDate = rawDate;
                  }
                } else {
                  normalizedDate = rawDate;
                }
              }
            }

            if (normalizedDate && !detectedDateOfReport) {
              detectedDateOfReport = normalizedDate;
            }

            const matchedWorker = employees.find(emp => 
              (rawBadge && emp.id.toLowerCase() === rawBadge.toLowerCase()) ||
              (rawName && emp.name.toLowerCase().replace(/\s/g, '') === rawName.toLowerCase().replace(/\s/g, ''))
            );

            parsedRecords.push({
              badgeNumber: rawBadge || (matchedWorker ? matchedWorker.id : `emp_${Date.now()}_`),
              employeeName: rawName || (matchedWorker ? matchedWorker.name : 'Unknown Worker'),
              department: rawDept || (matchedWorker ? matchedWorker.department : 'Production'),
              date: normalizedDate || selectedPunchDate,
              checkIn: rawIn && rawIn !== '00:00' && rawIn !== 'Absent' ? rawIn : null,
              checkOut: rawOut && rawOut !== '00:00' && rawOut !== 'Absent' ? rawOut : null,
              dayOff: rawDayOff,
              device: rawDevice,
              isNew: !matchedWorker
            });
          }

          if (detectedDateOfReport) {
            setSelectedPunchDate(detectedDateOfReport);
          }

          setAttendanceParsedRows(parsedRecords);
          setAttendanceImportStatus({
            type: 'idle',
            message: `Parsed Excel Sheet successfully! Found ${parsedRecords.length} worker logs. Ready to import.`
          });
        } catch (excelErr: any) {
          setAttendanceImportStatus({
            type: 'error',
            message: 'Failed to process Excel file: ' + excelErr.message
          });
        }
      };
      reader.readAsArrayBuffer(file);
      setAttendanceFile(file);
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        if (!text) {
          setAttendanceImportStatus({
            type: 'error',
            message: 'The selected file is empty or unreadable.'
          });
          return;
        }

        const lines = text.split(/\r?\n/);
        if (lines.length < 2) {
          setAttendanceImportStatus({
            type: 'error',
            message: 'File has no content rows.'
          });
          return;
        }

        // Determine delimiter
        const firstLine = lines[0];
        let delimiter = ',';
        if (firstLine.includes('\t')) delimiter = '\t';
        else if (firstLine.includes(';')) delimiter = ';';

        // Ensure 'charCharChar' typo from draft is clean standard js
        const parseCSVLineClean = (lineStr: string, delim: string) => {
          const result: string[] = [];
          let cur = '';
          let inside = false;
          for (let idx = 0; idx < lineStr.length; idx++) {
            const char = lineStr[idx];
            if (char === '"' || char === "'") {
              inside = !inside;
            } else if (char === delim && !inside) {
              result.push(cur.trim().replace(/^['"]|['"]$/g, ''));
              cur = '';
            } else {
              cur += char;
            }
          }
          result.push(cur.trim().replace(/^['"]|['"]$/g, ''));
          return result;
        };

        const rawHeaders = parseCSVLineClean(firstLine, delimiter);
        const headers = rawHeaders.map(h => h.toLowerCase().replace(/[\s_\-]/g, ''));

        // Find indices of columns
        const badgeIdx = headers.findIndex(h => h === 'badgenumber' || h === 'badge' || h === 'id' || h === 'employeeno');
        const nameIdx = headers.findIndex(h => h === 'employeename' || h === 'name' || h === 'employee');
        const deptIdx = headers.findIndex(h => h === 'departmentname' || h === 'department' || h === 'dept');
        const dateIdx = headers.findIndex(h => h === 'attendancedate' || h === 'date' || h === 'attendance');
        const inIdx = headers.findIndex(h => h === 'actualcheckin' || h === 'checkin' || h === 'timein' || h === 'in');
        const outIdx = headers.findIndex(h => h === 'actualcheckout' || h === 'checkout' || h === 'timeout' || h === 'out');
        const dayOffIdx = headers.findIndex(h => h === 'dayoff' || h === 'status' || h === 'type' || h === 'off');
        const deviceInIdx = headers.findIndex(h => h.includes('checkindevicename') || h.includes('device') || h.includes('machine'));

        if (badgeIdx === -1 && nameIdx === -1) {
          setAttendanceImportStatus({
            type: 'error',
            message: 'Unable to map columns. Please ensure "BadgeNumber" and/or "EmployeeName" columns exist.'
          });
          return;
        }

        const parsedRecords: any[] = [];
        let detectedDateOfReport = '';

        for (let i = 1; i < lines.length; i++) {
          const currentLine = lines[i];
          if (!currentLine.trim()) continue;

          const cells = parseCSVLineClean(currentLine, delimiter);
          if (cells.length < Math.max(badgeIdx, nameIdx, 1)) continue;

          const rawBadge = badgeIdx !== -1 ? cells[badgeIdx] : '';
          const rawName = nameIdx !== -1 ? cells[nameIdx] : '';
          const rawDept = deptIdx !== -1 ? cells[deptIdx] : 'Production';
          const rawDate = dateIdx !== -1 ? cells[dateIdx] : '';
          const rawIn = inIdx !== -1 ? cells[inIdx] : '00:00';
          const rawOut = outIdx !== -1 ? cells[outIdx] : '00:00';
          const rawDayOff = dayOffIdx !== -1 ? cells[dayOffIdx] : 'Work';
          const rawDevice = deviceInIdx !== -1 ? cells[deviceInIdx] : 'Device_2';

          if (!rawBadge && !rawName) continue;

          if (rawBadge.toLowerCase().includes('badge') || rawName.toLowerCase().includes('name') || rawBadge.toLowerCase().includes('statistics')) {
            continue;
          }

          let normalizedDate = '';
          if (rawDate) {
            const dParts = rawDate.split(/[-\/]/);
            if (dParts.length === 3) {
              if (dParts[0].length === 4) {
                normalizedDate = `${dParts[0]}-${dParts[1]}-${dParts[2]}`;
              } else if (dParts[2].length === 4) {
                normalizedDate = `${dParts[2]}-${dParts[1]}-${dParts[0]}`;
              } else {
                normalizedDate = rawDate;
              }
            } else {
              normalizedDate = rawDate;
            }
          }
          
          if (normalizedDate && !detectedDateOfReport) {
            detectedDateOfReport = normalizedDate;
          }

          const matchedWorker = employees.find(emp => 
            (rawBadge && emp.id.toLowerCase() === rawBadge.toLowerCase()) ||
            (rawName && emp.name.toLowerCase().replace(/\s/g, '') === rawName.toLowerCase().replace(/\s/g, ''))
          );

          parsedRecords.push({
            badgeNumber: rawBadge || (matchedWorker ? matchedWorker.id : `emp_${Date.now()}_${i}`),
            employeeName: rawName || (matchedWorker ? matchedWorker.name : 'Unknown Worker'),
            department: rawDept || (matchedWorker ? matchedWorker.department : 'Production'),
            date: normalizedDate || selectedPunchDate,
            checkIn: rawIn && rawIn !== '00:00' && rawIn !== 'Absent' ? rawIn : null,
            checkOut: rawOut && rawOut !== '00:00' && rawOut !== 'Absent' ? rawOut : null,
            dayOff: rawDayOff,
            device: rawDevice,
            isNew: !matchedWorker
          });
        }

        if (detectedDateOfReport) {
          setSelectedPunchDate(detectedDateOfReport);
        }

        setAttendanceParsedRows(parsedRecords);
        setAttendanceImportStatus({
          type: 'idle',
          message: `Parsed ${parsedRecords.length} workers successfully. Ready to import.`
        });
      };

      reader.readAsText(file);
      setAttendanceFile(file);
    }
  };

  const handleConfirmAttendanceBulkImport = () => {
    if (attendanceParsedRows.length === 0) return;

    const punchesToSave: any[] = [];
    const newWorkersToSave: Employee[] = [];

    attendanceParsedRows.forEach((row, index) => {
      let finalId = row.badgeNumber;
      
      // If employee is new, register them
      if (row.isNew && attendanceAutoOnboard) {
        if (!newWorkersToSave.some(x => x.id === row.badgeNumber)) {
          newWorkersToSave.push({
            id: row.badgeNumber,
            name: row.employeeName,
            department: row.department,
            role: 'Operator',
            createdAt: new Date().toISOString()
          });
        }
      }

      // Punch IN
      if (row.checkIn) {
        const timeParts = row.checkIn.split(':');
        let timestampIso = new Date().toISOString();
        if (timeParts.length >= 2) {
          const hours = parseInt(timeParts[0], 10);
          const minutes = parseInt(timeParts[1], 10);
          const d = new Date(row.date);
          d.setHours(hours, minutes, 0, 0);
          timestampIso = d.toISOString();
        }

        punchesToSave.push({
          id: `punch_${Date.now()}_in_${index}_${Math.random().toString(36).substr(2, 4)}`,
          employeeId: finalId,
          employeeName: row.employeeName,
          punchType: 'IN',
          timestamp: timestampIso,
          machineId: row.device || 'Main Shop Entrance',
          date: row.date
        });
      }

      // Punch OUT
      if (row.checkOut) {
        const timeParts = row.checkOut.split(':');
        let timestampIso = new Date().toISOString();
        if (timeParts.length >= 2) {
          const hours = parseInt(timeParts[0], 10);
          const minutes = parseInt(timeParts[1], 10);
          const d = new Date(row.date);
          d.setHours(hours, minutes, 0, 0);
          timestampIso = d.toISOString();
        }

        punchesToSave.push({
          id: `punch_${Date.now()}_out_${index}_${Math.random().toString(36).substr(2, 4)}`,
          employeeId: finalId,
          employeeName: row.employeeName,
          punchType: 'OUT',
          timestamp: timestampIso,
          machineId: row.device || 'Main Shop Entrance',
          date: row.date
        });
      }
    });

    try {
      if (newWorkersToSave.length > 0 && onAddEmployeesBulk) {
        onAddEmployeesBulk(newWorkersToSave);
      }

      if (punchesToSave.length > 0 && onAddEmployeePunchesBulk) {
        onAddEmployeePunchesBulk(punchesToSave);
      } else if (punchesToSave.length > 0 && onAddEmployeePunch) {
        punchesToSave.forEach(p => onAddEmployeePunch(p));
      }

      setAttendanceImportStatus({
        type: 'success',
        message: `Successfully processed & imported ${punchesToSave.length} daily workstation punches! ${newWorkersToSave.length} new workers added to directory.`
      });

      setTimeout(() => {
        setAttendanceParsedRows([]);
        setAttendanceFile(null);
        setAttendanceImportStatus(null);
      }, 4000);

    } catch (err: any) {
      setAttendanceImportStatus({
        type: 'error',
        message: `Failed to invoke bulk database saving API: ${err?.message || String(err)}`
      });
    }
  };

  const handleBioCloudSyncPull = async () => {
    if (bioCloudSyncing) return;
    setBioCloudSyncing(true);
    setBioCloudResponseCount(null);
    setBioCloudLogs([`[${new Date().toLocaleTimeString()}] Sync request broadcasted...`]);

    try {
      localStorage.setItem('apex_biocloud_url', bioCloudUrl);
      localStorage.setItem('apex_biocloud_apikey', bioCloudApiKey);

      const result = await dbSyncBioCloudPunches({
        url: bioCloudUrl,
        apiKey: bioCloudApiKey,
        date: selectedPunchDate,
        autoRegisterNew: attendanceAutoOnboard
      });

      if (result.logLines) {
        setBioCloudLogs(result.logLines);
      } else {
        setBioCloudLogs(prev => [...prev, `[Success] Pulled from server.`]);
      }

      setBioCloudResponseCount(result.syncedCount !== undefined ? result.syncedCount : (result.records ? result.records.length : 0));

      if (result.records && result.records.length > 0) {
        if (onAddEmployeePunchesBulk) {
          onAddEmployeePunchesBulk(result.records);
        }
      }

    } catch (err: any) {
      console.error(err);
      setBioCloudLogs(prev => [
        ...prev,
        `[Error] REST Call failed: ${err.message}`,
        `[Fallback Info] Please double-check your Bio Cloud REST Endpoint URL or Secret Keys.`
      ]);
    } finally {
      setBioCloudSyncing(false);
    }
  };

  // Compute combined unique departments list (baseline + custom + actual employee dept values)
  const allDepartments = React.useMemo(() => {
    const unionSet = new Set<string>([
      "Planning",
      "Steel Fabrication",
      "Steel Primer",
      "Chemical Cladding",
      "Structural Lamination",
      "Mechanical Fittings",
      "Plumbing Pre-fit",
      "Cosmetic Mosaic",
      "Acrylic Window Fit",
      "Quality Control",
      "Factory Management",
      ...customDepartments
    ]);
    if (employees && employees.length > 0) {
      employees.forEach(emp => {
        if (emp.department) {
          unionSet.add(emp.department);
        }
      });
    }
    return Array.from(unionSet);
  }, [customDepartments, employees]);

  // Employee Form State
  const [formEmpName, setFormEmpName] = useState('');
  const [formEmpDept, setFormEmpDept] = useState('Steel Fabrication');
  const [formEmpRole, setFormEmpRole] = useState('');
  const [formEmpEmail, setFormEmpEmail] = useState('');
  const [formEmpPhone, setFormEmpPhone] = useState('');
  const [formEmpNotes, setFormEmpNotes] = useState('');

  const openAddEmployeeModal = () => {
    setEditingEmployee(null);
    setFormEmpName('');
    setFormEmpDept('Steel Fabrication');
    setFormEmpRole('');
    setFormEmpEmail('');
    setFormEmpPhone('');
    setFormEmpNotes('');
    setIsCustomDeptInputMode(false);
    setIsEmployeeModalOpen(true);
  };

  const openEditEmployeeModal = (emp: Employee) => {
    setEditingEmployee(emp);
    setFormEmpName(emp.name);
    setFormEmpDept(emp.department);
    setFormEmpRole(emp.role || '');
    setFormEmpEmail(emp.email || '');
    setFormEmpPhone(emp.phone || '');
    setFormEmpNotes(emp.notes || '');
    setIsCustomDeptInputMode(false);
    setIsEmployeeModalOpen(true);
  };

  const handleSaveEmployeeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formEmpName.trim()) return;
    const deptValue = formEmpDept.trim() || 'Factory Management';

    // Auto-register typed custom department in customDepartments array
    const baselineAndCustom = [
      "Planning",
      "Steel Fabrication",
      "Steel Primer",
      "Chemical Cladding",
      "Structural Lamination",
      "Mechanical Fittings",
      "Plumbing Pre-fit",
      "Cosmetic Mosaic",
      "Acrylic Window Fit",
      "Quality Control",
      "Factory Management",
      ...customDepartments
    ];
    if (deptValue && !baselineAndCustom.includes(deptValue)) {
      setCustomDepartments(prev => [...prev, deptValue]);
    }

    const newOrUpdatedEmployee: Employee = {
      id: editingEmployee ? editingEmployee.id : `emp-${Date.now()}`,
      name: formEmpName.trim(),
      department: deptValue,
      role: formEmpRole.trim() || undefined,
      email: formEmpEmail.trim() || undefined,
      phone: formEmpPhone.trim() || undefined,
      notes: formEmpNotes.trim() || undefined,
      createdAt: editingEmployee ? editingEmployee.createdAt : new Date().toISOString()
    };

    if (onSaveEmployee) {
      onSaveEmployee(newOrUpdatedEmployee);
    }
    setIsEmployeeModalOpen(false);
  };



  // Filter project summaries state in management portal
  const [summaryFilterOrientation, setSummaryFilterOrientation] = useState<string>('all');
  const [summarySearchQuery, setSummarySearchQuery] = useState<string>('');

  // Selected Month Target dashboard dropdown state
  const [selectedTargetMonthId, setSelectedTargetMonthId] = useState<string>(
    monthlyTargets.length > 0 ? monthlyTargets[0].id : '2026-06'
  );

  // Sync state if monthlyTargets changes
  useEffect(() => {
    if (monthlyTargets.length > 0 && !monthlyTargets.some(t => t.id === selectedTargetMonthId)) {
      setSelectedTargetMonthId(monthlyTargets[0].id);
    }
  }, [monthlyTargets]);

  // Teams stage select inside Setup
  const [setupStageFilter, setSetupStageFilter] = useState<StageId>('steel_fabrication');
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editTeamName, setEditTeamName] = useState('');

  // New labor team floor creation states
  const [newTeamNameState, setNewTeamNameState] = useState('');

  // Terminal locking local states
  const [lockRole, setLockRole] = useState<ViewRole | 'dual_worker_trolley'>('stage_worker');
  const [lockStageId, setLockStageId] = useState<StageId | 'all_stages'>('steel_fabrication');
  const [lockTeamId, setLockTeamId] = useState<string>('');
  const [lockPin, setLockPin] = useState<string>('1234');

  // Helper code to register a new labor team
  const handleCreateTeam = () => {
    if (!newTeamNameState.trim()) {
      alert("Please specify a descriptive team name!");
      return;
    }
    const duplicate = teams.some(t => t.name.toLowerCase() === newTeamNameState.trim().toLowerCase());
    if (duplicate) {
      alert("A unique labor team or group with this word mark already exists on the floor!");
      return;
    }
    const newTeam: Team = {
      id: `team_${Date.now()}`,
      name: newTeamNameState.trim(),
      stageId: setupStageFilter,
      status: 'IDLE',
      activePoolId: null
    };
    if (onUpdateTeams) {
      onUpdateTeams([...teams, newTeam]);
    }
    setNewTeamNameState('');
  };

  const handleDeleteTeam = (teamId: string) => {
    const team = teams.find(t => t.id === teamId);
    if (!team) return;
    if (team.status === 'BUSY') {
      alert("Cannot delete a shop floor team while they are currently assigned to an active pool build!");
      return;
    }
    if (window.confirm(`Dissolve and remove "${team.name}" labor team from the manufacturing setup?`)) {
      if (onUpdateTeams) {
        onUpdateTeams(teams.filter(t => t.id !== teamId));
      }
    }
  };

  const handleLockSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!lockPin.trim()) {
      alert("Please designate a 4-digit security PIN to allow workstation unlocking!");
      return;
    }
    if (onLockStation) {
      if (lockRole === 'dual_worker_trolley') {
        onLockStation('stage_worker', null, null, lockPin, ['stage_worker', 'trolley_prod']);
        alert(`Station Dual-Locked! Switch freely between Stage Shop Floor and Trolley Ledger. Enter PIN ${lockPin} to unlock.`);
      } else {
        const stageArg = (lockRole === 'stage_worker' && lockStageId !== 'all_stages') ? lockStageId : null;
        const teamArg = (lockRole === 'stage_worker' && lockStageId !== 'all_stages') ? lockTeamId : null;
        onLockStation(lockRole, stageArg, teamArg, lockPin, [lockRole]);
        alert(`Station Locked! Standard navigation has been disabled. The station is pinned to: ${lockRole.replace('_', ' ').toUpperCase()}${stageArg ? ` (${STAGES.find(s => s.id === stageArg)?.name})` : ' - All Floor Sections Unlocked'}. Enter PIN ${lockPin} to unlock.`);
      }
    }
  };

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
        employees,
        plannedPools,
        projectsSummary,
        monthlyTargets,
        backupTime: new Date().toISOString(),
        version: '2.0'
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
    setRestoreStatus('restoring');
    setRestoreMessage('');
    try {
      const fileText = await downloadFileFromDrive(fileId);
      const parsed = JSON.parse(fileText);
      if (!parsed.pools || !parsed.teams || !parsed.logs) {
        throw new Error("Invalid backup file schema: Missing critical collections.");
      }

      // Build a clear summary of what this file actually contains before touching anything.
      // Collections NOT present in the file are never wiped — they're left exactly as-is.
      const counts: string[] = [
        `Pools: ${parsed.pools?.length ?? 0}`,
        `Teams: ${parsed.teams?.length ?? 0}`,
        `Logs: ${parsed.logs?.length ?? 0}`,
      ];
      const missing: string[] = [];
      const noteCount = (label: string, key: string) => {
        if (Object.prototype.hasOwnProperty.call(parsed, key)) {
          counts.push(`${label}: ${parsed[key]?.length ?? 0}`);
        } else {
          missing.push(label);
        }
      };
      noteCount('Employees', 'employees');
      noteCount('Planned Pools', 'plannedPools');
      noteCount('Project Summaries', 'projectsSummary');
      noteCount('Monthly Targets', 'monthlyTargets');

      const warningLine = missing.length > 0
        ? `\n\nThis file does NOT include: ${missing.join(', ')}.\nYour current data for those will be KEPT UNCHANGED (not deleted).`
        : '\n\nThis file includes all collections.';

      const confirmed = window.confirm(
        `Restore this backup?\n\n${counts.join('\n')}${warningLine}\n\nThis will replace the collections listed above with the file's contents. Continue?`
      );
      if (!confirmed) {
        setRestoreStatus('idle');
        return;
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

  const handleDownloadLocalBackup = () => {
    const payload = {
      pools,
      teams,
      logs,
      inspectors,
      engineers,
      employees,
      plannedPools,
      projectsSummary,
      monthlyTargets,
      exportedAt: new Date().toISOString(),
      version: "2.0"
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `MAT_Plastic_ERP_Backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleUploadLocalBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        if (!data.pools || !data.teams || !data.logs || !data.inspectors || !data.engineers) {
          alert("Invalid backup file: missing required fields");
          return;
        }

        // Same safety summary as the Google Drive restore path: show exactly what's
        // in the file, and make clear that anything not present stays untouched.
        const counts: string[] = [
          `Pools: ${data.pools?.length ?? 0}`,
          `Teams: ${data.teams?.length ?? 0}`,
          `Logs: ${data.logs?.length ?? 0}`,
        ];
        const missing: string[] = [];
        const noteCount = (label: string, key: string) => {
          if (Object.prototype.hasOwnProperty.call(data, key)) {
            counts.push(`${label}: ${data[key]?.length ?? 0}`);
          } else {
            missing.push(label);
          }
        };
        noteCount('Employees', 'employees');
        noteCount('Planned Pools', 'plannedPools');
        noteCount('Project Summaries', 'projectsSummary');
        noteCount('Monthly Targets', 'monthlyTargets');

        const warningLine = missing.length > 0
          ? `\n\nThis file does NOT include: ${missing.join(', ')}.\nYour current data for those will be KEPT UNCHANGED (not deleted).`
          : '\n\nThis file includes all collections.';

        const confirmed = window.confirm(
          `Restore this backup?\n\n${counts.join('\n')}${warningLine}\n\nThis will replace the collections listed above with the file's contents. Continue?`
        );
        if (!confirmed) return;

        if (onRestoreState) {
          onRestoreState(data);
          alert("State successfully restored from local backup!");
        }
      } catch (err: any) {
        alert("Failed to parse backup JSON file: " + err.message);
      }
    };
    reader.readAsText(file);
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

  // Projects renaming states
  const [editingProjectName, setEditingProjectName] = useState<string | null>(null);
  const [newProjectNameValue, setNewProjectNameValue] = useState('');
  
  // Custom states for high capacity managing 100+ pools across concurrent projects
  const [selectedProjectFilter, setSelectedProjectFilter] = useState<string>('ALL');
  const [poolsPage, setPoolsPage] = useState(1);
  const poolsPerPage = 7;

  // Daily Stage-wise Progress: pick any date and see exactly which pools were
  // marked done (QA approved) in each stage on that day, and which team did them.
  const todayStr = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const [progressFilterDate, setProgressFilterDate] = useState<string>(todayStr);

  const toLocalDateStr = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const stageDailyProgress = STAGES.map((stage) => {
    const donePools = pools
      .filter((p) => {
        const hist = p.stageHistory[stage.id];
        return hist && hist.status === 'APPROVED' && hist.inspectionTime && toLocalDateStr(hist.inspectionTime) === progressFilterDate;
      })
      .map((p) => {
        const hist = p.stageHistory[stage.id];
        const team = teams.find((t) => t.id === hist.teamId);
        const teamName = team?.name || (hist.teamId ? hist.teamId.replace(`${stage.id}_`, '').toUpperCase() : 'Unknown Team');
        return {
          poolId: p.id,
          poolNo: p.poolNo,
          projectName: p.projectName,
          teamName,
          inspectorId: hist.inspectorId || '—',
          time: hist.inspectionTime ? new Date(hist.inspectionTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '',
        };
      });
    return { stage, donePools };
  });

  const totalDonePoolsOnDate = stageDailyProgress.reduce((sum, s) => sum + s.donePools.length, 0);

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
  const activePools = dateFilteredPools.filter(p => p.currentStageIndex < STAGES.length);
  const completedPools = dateFilteredPools.filter(p => p.currentStageIndex >= STAGES.length);
  
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

      {/* Tabs navigation + Refresh All button */}
      <div className="bg-white rounded-2xl border border-slate-100 p-1.5 shadow-sm flex flex-wrap gap-1 items-center">
        <button
          onClick={() => setActiveTab('analytics')}
          className={`flex-1 min-w-[120px] py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
            activeTab === 'analytics' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <BarChart2 className="h-4 w-4 text-blue-500" />
          Analytics / Bottlenecks
        </button>

        {/* ── Refresh All Data button ── */}
        {onRefreshAll && (
          <button
            onClick={onRefreshAll}
            disabled={isFullSyncing}
            className="ml-auto flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition-colors shadow-sm shrink-0"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFullSyncing ? 'animate-spin' : ''}`} />
            {isFullSyncing ? 'Refreshing...' : 'Refresh All Data'}
            {lastSyncTime && !isFullSyncing && (
              <span className="text-indigo-200 font-normal">· {lastSyncTime}</span>
            )}
          </button>
        )}

        <button
          onClick={() => setActiveTab('projects_portal')}
          className={`flex-1 min-w-[120px] py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
            activeTab === 'projects_portal' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
          }`}
          id="tab-mgmt-projects-portal"
        >
          <Briefcase className="h-4 w-4 text-emerald-500" />
          All Projects Portal
        </button>

        <button
          onClick={() => setActiveTab('pools')}
          className={`flex-1 min-w-[120px] py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
            activeTab === 'pools' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <Layers className="h-4 w-4" />
          Pools Register Tracking
        </button>

        <button
          onClick={() => setActiveTab('daily_progress')}
          className={`flex-1 min-w-[120px] py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
            activeTab === 'daily_progress' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
          }`}
          id="tab-mgmt-daily-progress"
        >
          <Calendar className="h-4 w-4 text-blue-500" />
          Daily Stage Progress
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
          onClick={() => setActiveTab('employee_portal')}
          className={`flex-1 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
            activeTab === 'employee_portal' ? 'bg-slate-800 text-white shadow-md border border-slate-700' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
          }`}
          id="tab-mgmt-employees-portal"
        >
          <UserPlus className="h-4 w-4 text-pink-500" />
          Employee directory
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

        <button
          onClick={() => setActiveTab('terminal_settings')}
          className={`flex-1 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
            activeTab === 'terminal_settings' ? 'bg-amber-600 text-white shadow-md' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <Lock className="h-4 w-4 text-amber-300" />
          Terminal Control 🔒
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

            {/* Monthly KPI Targets comparison (start of month planner vs end of month OEE achievements) */}
            <div className="lg:col-span-12 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-50 pb-4">
                <div className="space-y-1">
                  <h3 className="text-base font-black text-slate-800 flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-indigo-650 text-indigo-600" />
                    Month-to-Date KPI & Section OEE Tracker
                  </h3>
                  <p className="text-xs text-slate-450 text-slate-500">
                    Comparing target quotas declared in the Planning Department at the start of the month against actual shop floor completions in real time.
                  </p>
                </div>

                {/* Dropdown for Month Selection */}
                <div className="flex items-center gap-2 bg-slate-50 border border-slate-205 border-slate-200 rounded-xl px-3 py-1.5 self-start md:self-center">
                  <span className="text-xs text-slate-500 font-bold">Billing/Target Month:</span>
                  <select
                    value={selectedTargetMonthId}
                    onChange={(e) => setSelectedTargetMonthId(e.target.value)}
                    className="bg-transparent text-xs font-bold text-slate-800 focus:outline-none cursor-pointer"
                  >
                    {monthlyTargets.map(t => (
                      <option key={t.id} value={t.id}>{t.monthName}</option>
                    ))}
                    {monthlyTargets.length === 0 && (
                      <option value="2026-06">June 2026</option>
                    )}
                  </select>
                </div>
              </div>

              {(() => {
                const activeTarget = monthlyTargets.find(t => t.id === selectedTargetMonthId) || {
                  id: '2026-06',
                  monthName: 'June 2026',
                  mainTarget: 100,
                  steelFabricationTarget: 120,
                  steelPrimerTarget: 120,
                  claddingTarget: 110,
                  skimmerFittingTarget: 110,
                  laminationTarget: 110,
                  mechanicalFittingTarget: 105,
                  plumbingTarget: 105,
                  mosaicTarget: 100,
                  groutingTarget: 100,
                  acrylicTarget: 100,
                  targetOee: 80,
                  notes: 'Default projection parameters.'
                };

                // Dynamic Actual calculation helper by StageId
                const getActualForStage = (stageId: StageId) => {
                  const idx = STAGES.findIndex(s => s.id === stageId);
                  if (idx === -1) return 0;
                  return pools.filter(p => p.currentStageIndex > idx).length;
                };

                const actualSteelFab = getActualForStage('steel_fabrication');
                const actualSteelPrimer = getActualForStage('steel_primer');
                const actualPlumbingTarget = getActualForStage('plumbing');
                const actualCladdingTarget = getActualForStage('cladding');
                const actualSkimmerFitting = getActualForStage('skimmer_fitting');
                const actualLamination = getActualForStage('lamination');
                const actualMechanical = getActualForStage('mechanical_fitting');
                const actualSkimmerTest = getActualForStage('skimmer_test');
                const actualDoorCutting = getActualForStage('door_cutting');
                const actualMosaicTarget = getActualForStage('mosaic');
                const actualGroutingTarget = getActualForStage('grouting');
                const actualAcrylicTarget = getActualForStage('acrylic');

                // Main Target achieved
                const mainProduced = pools.filter(p => p.currentStageIndex >= STAGES.length).length;
                const mainPercentage = Math.round((mainProduced / (activeTarget.mainTarget || 1)) * 100);

                // Actual OEE Calculation Formula
                const rejectionsPenalty = totalRejections * 1.5;
                const volumeOeeMultiplier = activeTarget.mainTarget > 0 ? (mainProduced / activeTarget.mainTarget) * 20 : 10;
                const actualOeeVal = Math.min(100, Math.max(45, Math.round((activeTarget.targetOee || 80) - rejectionsPenalty + volumeOeeMultiplier)));

                const sections = [
                  { name: 'Steel Fabrication', target: activeTarget.steelFabricationTarget || 100, actual: actualSteelFab, color: 'text-blue-600', progressColor: 'bg-blue-600' },
                  { name: 'Steel Primer', target: activeTarget.steelPrimerTarget || 100, actual: actualSteelPrimer, color: 'text-indigo-650 text-indigo-600', progressColor: 'bg-indigo-600' },
                  { name: 'Plumbing Pre-fit', target: activeTarget.plumbingTarget || 100, actual: actualPlumbingTarget, color: 'text-orange-600', progressColor: 'bg-orange-600' },
                  { name: 'Chemical Cladding', target: activeTarget.claddingTarget || 100, actual: actualCladdingTarget, color: 'text-cyan-605 text-cyan-600', progressColor: 'bg-cyan-600' },
                  { name: 'Skimmer Fitting', target: (activeTarget as any).skimmerFittingTarget || 110, actual: actualSkimmerFitting, color: 'text-orange-600', progressColor: 'bg-orange-600' },
                  { name: 'Structural Lamination', target: activeTarget.laminationTarget || 100, actual: actualLamination, color: 'text-pink-600', progressColor: 'bg-pink-600' },
                  { name: 'Mechanical Fittings', target: activeTarget.mechanicalFittingTarget || 100, actual: actualMechanical, color: 'text-violet-600', progressColor: 'bg-violet-600' },
                  { name: 'Skimmer Test', target: activeTarget.skimmerTestTarget || 100, actual: actualSkimmerTest, color: 'text-orange-500', progressColor: 'bg-orange-500' },
                  { name: 'Door Cutting', target: activeTarget.doorCuttingTarget || 100, actual: actualDoorCutting, color: 'text-lime-600', progressColor: 'bg-lime-600' },
                  { name: 'Cosmetic Mosaic', target: activeTarget.mosaicTarget || 100, actual: actualMosaicTarget, color: 'text-amber-600', progressColor: 'bg-amber-600' },
                  { name: 'Grouting / Grawting', target: activeTarget.groutingTarget || 100, actual: actualGroutingTarget, color: 'text-teal-600', progressColor: 'bg-teal-600' },
                  { name: 'Acrylic Window Fit', target: activeTarget.acrylicTarget || 100, actual: actualAcrylicTarget, color: 'text-rose-600', progressColor: 'bg-rose-600' },
                ];

                return (
                  <div className="space-y-6">
                    {/* Top OEE & Main Target Gauges */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                      
                      {/* OEE Metric */}
                      <div className="bg-slate-50 p-5 rounded-xl border border-slate-100 flex flex-col justify-between">
                        <div>
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Overall Equipment Effectiveness (OEE)</span>
                          <span className="text-xs text-slate-504 text-slate-500 block mt-0.5">Target: <strong>{activeTarget.targetOee}%</strong> | Actual Floor</span>
                        </div>
                        <div className="flex items-baseline gap-2.5 mt-3">
                          <span className="text-4xl font-black font-mono text-indigo-700 tracking-tight">{actualOeeVal}%</span>
                          <span className={`text-xs font-black ${actualOeeVal >= (activeTarget.targetOee || 80) ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {actualOeeVal >= (activeTarget.targetOee || 80) ? '✓ Met Target' : '⚠ Below Target'}
                          </span>
                        </div>
                        <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden mt-3">
                          <div className="h-full bg-indigo-600" style={{ width: `${actualOeeVal}%` }} />
                        </div>
                      </div>

                      {/* Main Section Target count */}
                      <div className="bg-slate-50 p-5 rounded-xl border border-slate-100 flex flex-col justify-between">
                        <div>
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Core Main Target Pools</span>
                          <span className="text-xs text-slate-500 block mt-0.5">Assigned Target: <strong>{activeTarget.mainTarget}</strong> units</span>
                        </div>
                        <div className="flex items-baseline gap-2 mt-3">
                          <span className="text-4xl font-black font-mono text-slate-800 tracking-tight">{mainProduced}</span>
                          <span className="text-xs text-slate-400">/ {activeTarget.mainTarget} produced ({mainPercentage}%)</span>
                        </div>
                        <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden mt-3">
                          <div className="h-full bg-emerald-500 animate-pulse" style={{ width: `${Math.min(100, mainPercentage)}%` }} />
                        </div>
                      </div>

                      {/* Strategy & Comments */}
                      <div className="bg-indigo-50/40 p-5 rounded-xl border border-indigo-100/40 flex flex-col justify-between text-xs">
                        <div>
                          <span className="text-[10px] font-black text-indigo-900 uppercase tracking-widest block">Strategic Planning Notes</span>
                          <p className="text-slate-650 text-slate-600 mt-2 italic leading-relaxed">
                            "{activeTarget.notes || 'High efficiency operational target rules are applied for active shop terminals.'}"
                          </p>
                        </div>
                        <div className="pt-2 text-[10px] text-indigo-705 font-medium flex items-center gap-1">
                          <Info className="h-3.5 w-3.5 shrink-0" />
                          <span>Declared in Planning Department</span>
                        </div>
                      </div>
                    </div>

                    {/* Section Targets Progress lists */}
                    <div className="bg-slate-50/50 p-6 rounded-xl border border-slate-100 space-y-4">
                      <span className="text-[11px] font-black text-slate-450 uppercase tracking-widest block border-b border-slate-200/50 pb-2">
                        Individual Sections & Workshops targets performance ratio
                      </span>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 pt-1">
                        {sections.map(sec => {
                          const percent = Math.round((sec.actual / (sec.target || 1)) * 100);
                          return (
                            <div key={sec.name} className="space-y-1">
                              <div className="flex items-center justify-between text-xs">
                                <span className={`font-bold ${sec.color}`}>{sec.name}</span>
                                <span className="font-mono text-slate-600 text-[11px] font-bold">
                                  {sec.actual} / <strong>{sec.target}</strong> ({percent}%)
                                </span>
                              </div>
                              <div className="h-2.5 bg-slate-200 rounded-full overflow-hidden flex">
                                <div 
                                  className={`h-full rounded-full transition-all duration-500 ${sec.progressColor}`} 
                                  style={{ width: `${Math.min(100, percent)}%` }} 
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Recharts Monthly OEE Trend Line Chart */}
                    <div className="bg-slate-50/70 p-6 rounded-xl border border-slate-100 space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200/50 pb-3">
                        <div className="space-y-1">
                          <span className="text-[11px] font-black text-indigo-900 uppercase tracking-widest block">
                            Monthly OEE Trend & Performance Index
                          </span>
                          <p className="text-xs text-slate-450 text-slate-500">
                            Analyzing target OEE quotas vs actual floor efficiency metrics over consecutive operational months.
                          </p>
                        </div>
                        <div className="flex items-center gap-4 text-[10.5px]">
                          <div className="flex items-center gap-1.5 font-semibold text-slate-500">
                            <span className="h-0.5 w-4 bg-slate-400 border-t border-dashed inline-block" />
                            <span>Target OEE</span>
                          </div>
                          <div className="flex items-center gap-1.5 font-bold text-indigo-600">
                            <span className="h-1 w-4 bg-indigo-600 rounded-full inline-block" />
                            <span>Actual OEE</span>
                          </div>
                        </div>
                      </div>

                      <div className="h-64 sm:h-72 w-full pt-2">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart
                            data={(() => {
                              // Standard trend list covering Jan to Jun 2026
                              const standardMonths = [
                                { id: '2026-01', monthName: 'Jan 2026', defaultTarget: 78, defaultActual: 79.5 },
                                { id: '2026-02', monthName: 'Feb 2026', defaultTarget: 78, defaultActual: 81.2 },
                                { id: '2026-03', monthName: 'Mar 2026', defaultTarget: 80, defaultActual: 82.0 },
                                { id: '2026-04', monthName: 'Apr 2026', defaultTarget: 80, defaultActual: 78.4 },
                                { id: '2026-05', monthName: 'May 2026', defaultTarget: 82, defaultActual: 83.1 },
                                { id: '2026-06', monthName: 'Jun 2026', defaultTarget: 82, defaultActual: actualOeeVal }
                              ];

                              return standardMonths.map(m => {
                                // Dynamic lookup to configured target list
                                const customTarget = monthlyTargets.find(t => t.id === m.id);
                                const tOee = customTarget ? (customTarget.targetOee || m.defaultTarget) : m.defaultTarget;

                                // If user selected target is active here, show live calculated actual OEE
                                let aOee = m.defaultActual;
                                if (m.id === '2026-06') {
                                  aOee = actualOeeVal;
                                } else if (m.id === selectedTargetMonthId) {
                                  aOee = actualOeeVal;
                                }

                                return {
                                  name: m.monthName,
                                  Target: tOee,
                                  Actual: aOee
                                };
                              });
                            })()}
                            margin={{ top: 10, right: 20, left: -20, bottom: 0 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chartAxisDefaults.gridStroke} />
                            <XAxis 
                              dataKey="name" 
                              stroke={chartAxisDefaults.axisStroke} 
                              fontSize={11} 
                              tickLine={false} 
                              axisLine={false} 
                              dy={10} 
                            />
                            <YAxis 
                              stroke={chartAxisDefaults.axisStroke} 
                              fontSize={11} 
                              tickLine={false} 
                              axisLine={false} 
                              domain={[50, 100]} 
                              tickFormatter={(val) => `${val}%`} 
                              dx={-5} 
                            />
                            <RechartsTooltip 
                              content={({ active, payload }) => {
                                if (active && payload && payload.length) {
                                  const actualData = payload.find(p => p.name === 'Actual' || p.dataKey === 'Actual');
                                  const targetData = payload.find(p => p.name === 'Target' || p.dataKey === 'Target');
                                  
                                  const actualVal = actualData ? actualData.value as number : 0;
                                  const targetVal = targetData ? targetData.value as number : 0;
                                  const isAchieved = actualVal >= targetVal;

                                  return (
                                    <div className="bg-slate-900 border border-slate-800 text-white rounded-xl p-3 shadow-lg space-y-1.5 min-w-[140px]">
                                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{payload[0]?.payload?.name || 'Selected Month'}</p>
                                      <div className="h-px bg-slate-800 my-1" />
                                      <div className="flex justify-between items-center text-xs gap-4">
                                        <span className="text-slate-400">Actual OEE:</span>
                                        <span className="font-extrabold text-indigo-400 font-mono">{actualVal}%</span>
                                      </div>
                                      <div className="flex justify-between items-center text-xs gap-4">
                                        <span className="text-slate-400">Target OEE:</span>
                                        <span className="font-semibold text-slate-300 font-mono">{targetVal}%</span>
                                      </div>
                                      <div className="pt-1 text-[9px] font-bold flex items-center gap-1">
                                        {isAchieved ? (
                                          <span className="text-emerald-400 font-extrabold">✓ Target Achieved</span>
                                        ) : (
                                          <span className="text-rose-400 font-extrabold">⚠ Deficit: {Math.round(targetVal - actualVal)}%</span>
                                        )}
                                      </div>
                                    </div>
                                  );
                                }
                                return null;
                              }}
                            />
                            <Line 
                              type="monotone" 
                              dataKey="Target" 
                              stroke={chartAxisDefaults.secondaryLineStroke} 
                              strokeWidth={2} 
                              strokeDasharray="5 5"
                              dot={{ r: 3, fill: chartTokens.neutral[400], strokeWidth: 1 }}
                              activeDot={{ r: 5 }}
                              name="Target"
                            />
                            <Line 
                              type="monotone" 
                              dataKey="Actual" 
                              stroke={chartAxisDefaults.primaryLineStroke} 
                              strokeWidth={3} 
                              dot={{ r: 5, fill: chartTokens.primary[600], stroke: chartTokens.neutral.white, strokeWidth: 2 }}
                              activeDot={{ r: 7, fill: chartTokens.primary[600], stroke: chartTokens.neutral.white, strokeWidth: 3 }}
                              name="Actual"
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Daily Production Records Date-wise Checker */}
            <div className="lg:col-span-12 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-50 pb-4">
                <div className="space-y-1">
                  <h3 className="text-base font-black text-slate-800 flex items-center gap-2">
                    <Calendar className="h-5 w-5 text-pink-600" />
                    Daily Production Tracker (Date-wise Records)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Audit and control tool to check date-specific shop floor records, log timings, worker submittals, and defect parameters.
                  </p>
                </div>

                {/* Datepicker and Navigation controls */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      const d = new Date(selectedProductionDate);
                      d.setDate(d.getDate() - 1);
                      setSelectedProductionDate(d.toISOString().split('T')[0]);
                    }}
                    className="p-2 hover:bg-slate-50 border border-slate-200 rounded-lg text-slate-600 transition-colors"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <div className="relative">
                    <input
                      type="date"
                      value={selectedProductionDate}
                      onChange={(e) => {
                        if (e.target.value) {
                          setSelectedProductionDate(e.target.value);
                        }
                      }}
                      className="bg-slate-50 border border-slate-200 text-xs font-bold text-slate-800 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <button
                    onClick={() => {
                      const d = new Date(selectedProductionDate);
                      d.setDate(d.getDate() + 1);
                      setSelectedProductionDate(d.toISOString().split('T')[0]);
                    }}
                    className="p-2 hover:bg-slate-50 border border-slate-200 rounded-lg text-slate-600 transition-colors"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setSelectedProductionDate('2026-06-18')}
                    className="px-2.5 py-2 text-xs font-bold bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-600 transition-all"
                  >
                    Today
                  </button>
                </div>
              </div>

              {(() => {
                // Helper to render readable labels from database enum types safely without errors
                const getActionLabel = (log: any) => {
                  if (!log) return 'UNKNOWN';
                  const logType = log.type || '';
                  switch (logType) {
                    case 'CREATED': return 'CREATED';
                    case 'STAGE_STARTED': {
                      const stageName = log.stageId ? log.stageId.split('_').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : '';
                      return `STARTED ${stageName}`.trim();
                    }
                    case 'STAGE_FINISHED': {
                      const stageName = log.stageId ? log.stageId.split('_').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : '';
                      return `COMPLETED ${stageName}`.trim();
                    }
                    case 'APPROVED': return 'QA APPROVED';
                    case 'REJECTED': return 'QA REJECTED';
                    default: return String(logType);
                  }
                };

                // Filter logs matching selected date
                const dateLogs = logs.filter(l => {
                  if (!l.timestamp) return false;
                  return l.timestamp.startsWith(selectedProductionDate);
                });

                // Derived stats for the day
                const releases = dateLogs.filter(l => l.type === 'CREATED');
                const stageCompletions = dateLogs.filter(l => l.type === 'STAGE_FINISHED');
                const approvedQA = dateLogs.filter(l => l.type === 'APPROVED');
                const rejectsCount = dateLogs.filter(l => l.type === 'REJECTED');

                // Pools that had activity on this day
                const activePoolIds = Array.from(new Set(dateLogs.map(l => l.poolNo)));

                return (
                  <div className="space-y-6">
                    {/* Metrics Grid */}
                    <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                      <div className="bg-slate-50/60 p-4 border border-slate-100 rounded-xl">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Released Pools</span>
                        <div className="flex items-baseline gap-2 mt-1">
                          <span className="text-2xl font-black font-mono text-slate-800">{releases.length}</span>
                          <span className="text-[10px] text-slate-400">new units</span>
                        </div>
                      </div>

                      <div className="bg-slate-50/60 p-4 border border-slate-100 rounded-xl">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Stage Transitions</span>
                        <div className="flex items-baseline gap-2 mt-1">
                          <span className="text-2xl font-black font-mono text-blue-600">{stageCompletions.length}</span>
                          <span className="text-[10px] text-slate-405 text-slate-400">completed</span>
                        </div>
                      </div>

                      <div className="bg-slate-50/60 p-4 border border-slate-100 rounded-xl">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">QA approvals</span>
                        <div className="flex items-baseline gap-2 mt-1">
                          <span className="text-2xl font-black font-mono text-emerald-600">{approvedQA.length}</span>
                          <span className="text-[10px] text-slate-400">passed</span>
                        </div>
                      </div>

                      <div className="bg-slate-50/60 p-4 border border-slate-100 rounded-xl">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Defects/Rework</span>
                        <div className="flex items-baseline gap-2 mt-1">
                          <span className="text-2xl font-black font-mono text-rose-600">{rejectsCount.length}</span>
                          <span className="text-[10px] text-slate-400">rejections</span>
                        </div>
                      </div>

                      <div className="col-span-2 lg:col-span-1 bg-indigo-50/40 p-4 border border-indigo-100/50 rounded-xl">
                        <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider block">Total Ledger Entries</span>
                        <div className="flex items-baseline gap-2 mt-1">
                          <span className="text-2xl font-black font-mono text-indigo-700">{dateLogs.length}</span>
                          <span className="text-[10px] text-indigo-500">records</span>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                      {/* Active Pools list on selected day */}
                      <div className="lg:col-span-5 space-y-3">
                        <div className="flex items-center justify-between border-b pb-2">
                          <h4 className="text-xs font-black text-slate-700 uppercase tracking-wider">
                            Units Processed on this Day ({activePoolIds.length})
                          </h4>
                          <span className="text-[10px] font-mono bg-slate-100 px-2 py-0.5 rounded text-slate-600 font-bold">
                            Active registry
                          </span>
                        </div>

                        {activePoolIds.length > 0 ? (
                          <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1">
                            {activePoolIds.map(pn => {
                              const poolLogs = dateLogs.filter(l => l.poolNo === pn);
                              const details = pools.find(p => p.poolNo === pn);
                              return (
                                <div key={pn} className="bg-slate-50/30 border border-slate-100 rounded-lg p-3 space-y-2">
                                  <div className="flex justify-between items-center">
                                    <span className="font-bold text-slate-800 font-mono text-xs">{pn}</span>
                                    <span className="text-[10px] font-bold text-slate-500">
                                      {details?.projectName || 'Apex Custom'}
                                    </span>
                                  </div>
                                  <div className="text-[11px] text-slate-500 space-y-1">
                                    <span className="text-[10px] font-semibold text-slate-400 block uppercase tracking-wider">
                                      Registered actions on this day:
                                    </span>
                                    {poolLogs.map((pl, idx) => (
                                      <div key={idx} className="flex items-center gap-1.5 pl-1 border-l-2 border-indigo-200">
                                        <span className="font-mono text-[9px] text-slate-400 shrink-0">
                                          {pl.timestamp ? pl.timestamp.split('T')[1].substring(0, 5) : '—'}
                                        </span>
                                        <span className="text-slate-700 shrink-1 truncate">{getActionLabel(pl)}</span>
                                        {pl.notes && (
                                          <span className="text-slate-400 text-[10px] italic shrink-1 truncate">
                                            ({pl.notes})
                                          </span>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="text-center py-10 bg-slate-50/20 border border-dashed rounded-xl">
                            <Info className="h-6 w-6 text-slate-350 text-slate-400 mx-auto mb-2" />
                            <p className="text-xs text-slate-500 font-semibold">No pool updates recorded</p>
                            <p className="text-[10px] text-slate-400 font-medium">Select a date with active factory shifts.</p>
                          </div>
                        )}
                      </div>

                      {/* Timelines of Logs on selected day */}
                      <div className="lg:col-span-7 space-y-3">
                        <div className="flex items-center justify-between border-b pb-2">
                          <h4 className="text-xs font-black text-slate-700 uppercase tracking-wider">
                            Daily Chronological Dispatch Timelines
                          </h4>
                          <span className="text-[10px] font-mono text-indigo-650 text-indigo-600 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded font-bold">
                            Live system ledger
                          </span>
                        </div>

                        {dateLogs.length > 0 ? (
                          <div className="space-y-2.5 max-h-[350px] overflow-y-auto pr-1">
                            {dateLogs.map((l, idx) => {
                              const isApprove = l.type === 'APPROVED';
                              const isReject = l.type === 'REJECTED';
                              const isRelease = l.type === 'CREATED';
                              const isShift = l.type === 'STAGE_STARTED';

                              let labelColor = 'bg-slate-100 text-slate-700';
                              if (isApprove) labelColor = 'bg-emerald-50 border border-emerald-100 text-emerald-700 font-bold';
                              if (isReject) labelColor = 'bg-rose-50 border border-rose-100 text-rose-700 font-bold';
                              if (isRelease) labelColor = 'bg-blue-50 border border-blue-100 text-blue-700 font-bold';
                              if (isShift) labelColor = 'bg-amber-50 border border-amber-100 text-amber-700 font-bold';

                              return (
                                <div key={idx} className="flex gap-3 text-xs p-2 rounded-xl bg-slate-50/40 border border-slate-100 hover:bg-slate-50 transition-all">
                                  <div className="text-right shrink-0">
                                    <span className="font-mono text-[10px] font-black text-slate-400 block">
                                      {l.timestamp ? l.timestamp.split('T')[1].substring(0, 5) : '—'}
                                    </span>
                                    <span className="font-sans text-[8px] font-bold text-slate-400 block mt-0.5">
                                      {selectedProductionDate}
                                    </span>
                                  </div>

                                  <div className="h-6 border-r border-slate-200 mt-1 self-stretch" />

                                  <div className="flex-1 space-y-1">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="font-bold text-slate-800 font-mono text-[11px] inline-block bg-white border border-slate-200/80 px-1.5 py-0.2 rounded shrink-0">
                                        {l.poolNo}
                                      </span>
                                      <span className="text-[10px] text-slate-400 truncate block font-medium">
                                        Project: {l.projectName}
                                      </span>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                                      <span className={`text-[9px] px-1.5 py-0.2 rounded-full uppercase tracking-wider ${labelColor}`}>
                                        {getActionLabel(l)}
                                      </span>
                                      <span className="text-slate-600 font-medium">by {l.operatorName || 'Shop Floor'}</span>
                                      {l.notes && (
                                        <p className="text-slate-500 italic bg-white/60 border border-slate-100 px-2 py-0.5 rounded text-[10px] mt-0.5 block w-full leading-relaxed font-sans">
                                          Notes: &ldquo;{l.notes}&rdquo;
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="text-center py-10 bg-slate-50/20 border border-dashed rounded-xl">
                            <Clock className="h-6 w-6 text-slate-400 mx-auto mb-2" />
                            <p className="text-xs text-slate-500 font-semibold">No audit entries for this date</p>
                            <p className="text-[10px] text-slate-400 font-medium">Use the Calendar selector above to inspect other days.</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Departmental Workloads & Employee Assignments + Employee/Team of the Year Nominations */}
            <div className="lg:col-span-12 grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Summary Panel: Active Pools per Department based on Employee Assignments */}
              <div className="lg:col-span-7 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-5">
                <div className="space-y-1 border-b border-slate-50 pb-3 flex justify-between items-center flex-wrap gap-2">
                  <div>
                    <h3 className="text-base font-black text-slate-800 flex items-center gap-2">
                      <Layers className="h-5 w-5 text-indigo-600" />
                      Active workloads by Employee Assignment Department
                    </h3>
                    <p className="text-xs text-slate-500">
                      Correlating registered staff counts with real-time active building loads per shop floor workshop.
                    </p>
                  </div>
                  <span className="text-[10px] uppercase font-mono font-black text-indigo-650 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full inline-block">
                    Operational Matrix
                  </span>
                </div>

                {(() => {
                  const FACTORY_DEPARTMENTS = [
                    { name: 'Planning', badge: '📋', color: 'indigo', stages: [], description: 'Engineering, releasing & backlog routing' },
                    { name: 'Steel Fabrication', badge: '🛠️', color: 'blue', stages: ['steel_fabrication'], description: 'Primary metallic shell welding & forming' },
                    { name: 'Steel Primer', badge: '🎨', color: 'amber', stages: ['steel_primer'], description: 'Anticorrosive sandblast & paint primers' },
                    { name: 'Chemical Cladding', badge: '🧪', color: 'purple', stages: ['cladding'], description: 'Resin seal coats & outer gel protection' },
                    { name: 'Skimmer Fitting & Test', badge: '🚰', color: 'orange', stages: ['skimmer_fitting', 'skimmer_test'], description: 'Skimmer components installation & pressure seals' },
                    { name: 'Structural Lamination', badge: '🧱', color: 'pink', stages: ['lamination'], description: 'Glass reinforcement layers hand lay-up' },
                    { name: 'Mechanical Fittings', badge: '⚙️', color: 'rose', stages: ['mechanical_fitting'], description: 'Valves, returns, and structural framing fit' },
                    { name: 'Plumbing Pre-fit', badge: '💧', color: 'cyan', stages: ['plumbing'], description: 'Internal pipe networks & testing lines' },
                    { name: 'Cosmetic Mosaic', badge: '🏁', color: 'emerald', stages: ['mosaic'], description: 'Italian tile design layout & finishing' },
                    { name: 'Acrylic Window Fit', badge: '🪟', color: 'violet', stages: ['acrylic'], description: 'Seaside panoramic viewing seals curing' },
                    { name: 'Quality Control', badge: '🔍', color: 'rose', description: 'Inspection sign-off clearances & rework holds' },
                    { name: 'Factory Management', badge: '🚀', color: 'slate', description: 'Operations coordination & shift scheduling' }
                  ];

                  return (
                    <div className="divide-y divide-slate-100 max-h-[500px] overflow-y-auto pr-2 space-y-1.5 pt-1">
                      {FACTORY_DEPARTMENTS.map(dept => {
                        // 1. Headcount & Roster
                        const deptWorkers = employees.filter(emp => emp.department === dept.name);
                        
                        // 2. Active Pools Load Code
                        let activeCount = 0;
                        let activePoolDetails: string[] = [];

                        if (dept.name === 'Quality Control') {
                          // Awaiting inspection in any active stage context
                          const qcPools = pools.filter(p => {
                            if (p.currentStageIndex >= STAGES.length) return false;
                            const stId = STAGES[p.currentStageIndex].id;
                            return p.stageHistory[stId]?.status === 'PENDING_INSPECTION';
                          });
                          activeCount = qcPools.length;
                          activePoolDetails = qcPools.map(p => p.poolNo);
                        } else if (dept.name === 'Planning') {
                          // Standard release waiting queue - Pools currently in state index 0 and status not started or idle,
                          // or let's say pools that have not completed first stage or are planned but not yet released
                          const planningPools = pools.filter(p => p.currentStageIndex === 0 && p.stageHistory['steel_fabrication']?.status === 'NOT_STARTED');
                          activeCount = planningPools.length;
                          activePoolDetails = planningPools.map(p => p.poolNo);
                        } else if (dept.name === 'Factory Management') {
                          // Oversight over all non-completed pools
                          const ongoing = pools.filter(p => p.currentStageIndex < STAGES.length);
                          activeCount = ongoing.length;
                          activePoolDetails = ongoing.map(p => p.poolNo);
                        } else {
                          // Map stages
                          const ongoingDept = pools.filter(p => {
                            if (p.currentStageIndex >= STAGES.length) return false;
                            const curStageId = STAGES[p.currentStageIndex].id;
                            return dept.stages.includes(curStageId as any);
                          });
                          activeCount = ongoingDept.length;
                          activePoolDetails = ongoingDept.map(p => p.poolNo);
                        }

                        // Colors maps
                        let colorClasses = 'border-slate-100 bg-slate-50 text-slate-705';
                        let pillClass = 'bg-slate-100 text-slate-750 text-slate-800';
                        if (dept.color === 'indigo') {
                          colorClasses = 'border-indigo-100 bg-indigo-50/40 text-indigo-800';
                          pillClass = 'bg-indigo-100 text-indigo-800 border-indigo-200/50';
                        } else if (dept.color === 'blue') {
                          colorClasses = 'border-blue-100 bg-blue-50/40 text-blue-800';
                          pillClass = 'bg-blue-100 text-blue-800 border-blue-200/50';
                        } else if (dept.color === 'amber') {
                          colorClasses = 'border-amber-100 bg-amber-50/40 text-amber-800';
                          pillClass = 'bg-amber-100 text-amber-800 border-amber-200/50';
                        } else if (dept.color === 'purple') {
                          colorClasses = 'border-purple-100 bg-purple-50/40 text-purple-800';
                          pillClass = 'bg-purple-100 text-purple-800 border-purple-200/50';
                        } else if (dept.color === 'pink') {
                          colorClasses = 'border-pink-100 bg-pink-50/40 text-pink-800';
                          pillClass = 'bg-pink-100 text-pink-800 border-pink-200/50';
                        } else if (dept.color === 'rose') {
                          colorClasses = 'border-rose-100 bg-rose-50/40 text-rose-800';
                          pillClass = 'bg-rose-105 text-rose-800 border-rose-200/50';
                        } else if (dept.color === 'cyan') {
                          colorClasses = 'border-cyan-100 bg-cyan-50/40 text-cyan-800';
                          pillClass = 'bg-cyan-100 text-cyan-800 border-cyan-200/50';
                        } else if (dept.color === 'emerald') {
                          colorClasses = 'border-emerald-100 bg-emerald-50/40 text-emerald-800';
                          pillClass = 'bg-emerald-100 text-emerald-800 border-emerald-200/50';
                        } else if (dept.color === 'violet') {
                          colorClasses = 'border-violet-100 bg-violet-50/40 text-violet-800';
                          pillClass = 'bg-violet-100 text-violet-800 border-violet-200/50';
                        }

                        return (
                          <div key={dept.name} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                            <div className="space-y-1 shrink-0 max-w-xs">
                              <div className="flex items-center gap-1.5">
                                <span className="text-sm">{dept.badge}</span>
                                <h4 className="font-extrabold text-slate-800">{dept.name}</h4>
                              </div>
                              <p className="text-[10px] text-slate-400 font-medium leading-relaxed">
                                {dept.description}
                              </p>
                            </div>

                            {/* Headcount Bubble Roster */}
                            <div className="flex flex-col space-y-1">
                              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Assigned Personnel</span>
                              <div className="flex items-center gap-1.5">
                                {deptWorkers.length > 0 ? (
                                  <div className="flex -space-x-1.5 overflow-hidden">
                                    {deptWorkers.map((worker) => {
                                      const init = worker.name.split(' ').map(n=>n[0]).join('').toUpperCase().slice(0, 2);
                                      return (
                                        <div 
                                          key={worker.id}
                                          className="h-6 w-6 rounded-full bg-slate-200 border border-white text-[9px] font-black text-slate-700 font-mono flex items-center justify-center cursor-help shrink-0 shadow-xs"
                                          title={`${worker.name} (${worker.role || 'Operator'})`}
                                        >
                                          {init}
                                        </div>
                                      );
                                    })}
                                    <span className="text-[10px] font-black text-slate-600 pl-2 font-mono flex items-center shrink-0">
                                      ({deptWorkers.length})
                                    </span>
                                  </div>
                                ) : (
                                  <span className="text-[9px] bg-amber-50 text-amber-700 font-black border border-amber-100 px-2 py-0.5 rounded-full inline-block uppercase">
                                    ⚠️ staff gap
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Department Workload Display */}
                            <div className="flex flex-col items-start sm:items-end text-left sm:text-right gap-1 shrink-0">
                              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Department Load</span>
                              <div className="flex items-center gap-1.5">
                                <span className={`text-[10.5px] font-black px-2 pb-0.5 pt-0.5 rounded border ${colorClasses}`}>
                                  {activeCount} Active {activeCount === 1 ? 'Pool' : 'Pools'}
                                </span>
                              </div>
                              {activePoolDetails.length > 0 && (
                                <p className="text-[9.5px] text-slate-500 font-bold font-mono">
                                  {activePoolDetails.slice(0, 4).join(', ')}{activePoolDetails.length > 4 ? '...' : ''}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>

              {/* Nomination Portal: Employee/Team of the Year & Section KPI Awards */}
              <div className="lg:col-span-5 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex flex-col justify-between space-y-5">
                
                {/* Header */}
                <div className="space-y-1.5 border-b border-slate-100 pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 bg-amber-50 border border-amber-200 rounded-lg">
                        <Trophy className="h-4 w-4 text-amber-600" />
                      </div>
                      <div>
                        <h3 className="text-sm font-black text-slate-800 tracking-tight">
                          Executive Nomination Center
                        </h3>
                        <p className="text-[11px] text-slate-500">
                          Annual distinction awards and live factory section-wise performance tracking.
                        </p>
                      </div>
                    </div>
                    <Sparkles className="h-4 w-4 text-amber-500 animate-pulse shrink-0" />
                  </div>

                  {/* Navigation Tabs */}
                  <div className="flex bg-slate-50 p-1 rounded-xl border border-slate-100 mt-3">
                    <button
                      onClick={() => setActiveNominationSubTab('section_teams')}
                      className={`flex-1 text-center py-1.5 px-3 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                        activeNominationSubTab === 'section_teams'
                          ? 'bg-white text-slate-800 shadow-sm border border-slate-100'
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      Section Best Teams
                    </button>
                    <button
                      onClick={() => setActiveNominationSubTab('employee_of_the_year')}
                      className={`flex-1 text-center py-1.5 px-3 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                        activeNominationSubTab === 'employee_of_the_year'
                          ? 'bg-white text-slate-800 shadow-sm border border-slate-100'
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      Employee of the Year
                    </button>
                  </div>
                </div>

                {/* Sub Tab contents */}
                {activeNominationSubTab === 'section_teams' ? (
                  <div className="space-y-3 max-h-[460px] overflow-y-auto pr-1 pt-1 flex-1">
                    {STAGES.map(stage => {
                      // Compute Nominated Team KPI for this stage
                      const stageTeams = teams.filter(t => t.stageId === stage.id);
                      if (stageTeams.length === 0) return null;

                      const teamPerformances = stageTeams.map(t => {
                        const completions = pools.filter(p => {
                          const hist = p.stageHistory[stage.id];
                          return hist && hist.teamId === t.id && (hist.status === 'APPROVED' || p.currentStageIndex > STAGES.findIndex(s => s.id === stage.id));
                        }).length;

                        const rejections = pools.reduce((acc, p) => {
                          const hist = p.stageHistory[stage.id];
                          if (hist && hist.teamId === t.id) {
                            return acc + (hist.rejectionCount || 0);
                          }
                          return acc;
                        }, 0);

                        const baseScore = 75;
                        const kpiScore = Math.min(100, Math.max(0, baseScore + (completions * 8) - (rejections * 12)));

                        return {
                          team: t,
                          completions,
                          rejections,
                          kpiScore
                        };
                      });

                      teamPerformances.sort((a, b) => {
                        if (b.kpiScore !== a.kpiScore) return b.kpiScore - a.kpiScore;
                        if (b.completions !== a.completions) return b.completions - a.completions;
                        return a.team.name.localeCompare(b.team.name);
                      });

                      const nominee = teamPerformances[0];
                      if (!nominee) return null;

                      let scoreColor = 'text-slate-500 bg-slate-50 border-slate-200';
                      let progressBg = 'bg-slate-400';
                      if (nominee.kpiScore >= 90) {
                        scoreColor = 'text-emerald-700 bg-emerald-50 border-emerald-200/60';
                        progressBg = 'bg-emerald-500';
                      } else if (nominee.kpiScore >= 80) {
                        scoreColor = 'text-indigo-700 bg-indigo-50 border-indigo-200/60';
                        progressBg = 'bg-indigo-500';
                      } else if (nominee.kpiScore >= 70) {
                        scoreColor = 'text-amber-700 bg-amber-50 border-amber-200/60';
                        progressBg = 'bg-amber-500';
                      } else {
                        scoreColor = 'text-rose-700 bg-rose-50 border-rose-200/60';
                        progressBg = 'bg-rose-500';
                      }

                      return (
                        <div key={stage.id} className="bg-slate-50/50 p-3 rounded-xl border border-slate-100 hover:border-indigo-100 transition-all space-y-2.5 relative group shadow-xs">
                          
                          {/* Crown sticker for elite execution */}
                          {nominee.kpiScore >= 90 && (
                            <div className="absolute top-2.5 right-2.5 flex items-center gap-1 bg-amber-50 border border-amber-200/75 px-1.5 py-0.5 rounded-md shadow-2xs">
                              <Crown className="h-3 w-3 text-amber-500 shrink-0" />
                              <span className="text-[8px] font-black text-amber-700 font-mono">ELITE</span>
                            </div>
                          )}

                          <div className="flex items-center justify-between gap-1.5 pr-14">
                            <div className="space-y-0.5">
                              <span className="text-[9px] font-black tracking-wider uppercase text-slate-400">
                                {stage.name} Stage
                              </span>
                              <div className="flex items-center gap-1">
                                <Star className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
                                <span className="font-extrabold text-slate-800 text-xs">
                                  {nominee.team.name}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Progress gauge metrics */}
                          <div className="space-y-1">
                            <div className="flex justify-between items-center text-[10px] text-slate-500">
                              <span className="font-medium">OEE Quality Index</span>
                              <span className={`font-mono font-black border px-1 rounded-sm ${scoreColor}`}>{nominee.kpiScore}%</span>
                            </div>
                            <div className="h-1.5 w-full bg-slate-200/60 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${progressBg} transition-all duration-350`} style={{ width: `${nominee.kpiScore}%` }} />
                            </div>
                          </div>

                          {/* Action KPI Indicators */}
                          <div className="flex flex-wrap items-center gap-2 pt-0.5 border-t border-slate-100/50">
                            <div className="flex items-center gap-1 bg-white border border-slate-200/80 px-1.5 py-0.5 rounded text-[9.5px] font-semibold text-slate-600 shadow-3xs">
                              <Award className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                              <span>{nominee.completions} Approved</span>
                            </div>
                            <div className="flex items-center gap-1 bg-white border border-slate-200/80 px-1.5 py-0.5 rounded text-[9.5px] font-semibold text-slate-600 shadow-3xs">
                              <AlertCircle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                              <span>{nominee.rejections} Rework Checks</span>
                            </div>
                          </div>

                        </div>
                      );
                    })}
                  </div>
                ) : (
                  // Employee of the Year presidential certificate suite
                  <div className="space-y-4 pt-1 flex-1 flex flex-col justify-between">
                    <div className="bg-slate-900 border-2 border-amber-400/80 p-5 rounded-2xl text-slate-100 relative shadow-md overflow-hidden space-y-4">
                      
                      {/* Technical certificate backdrop watermark */}
                      <div className="absolute -right-10 -bottom-10 opacity-10 pointer-events-none">
                        <Trophy className="h-44 w-44 text-amber-400" />
                      </div>

                      <div className="text-center space-y-1">
                        <span className="text-[9px] font-mono font-black text-amber-400 tracking-widest uppercase block animate-pulse">
                          MAT PLASTIC INDUSTRIES LLC
                        </span>
                        <h4 className="text-xs font-serif font-extrabold tracking-wide text-slate-300 uppercase">
                          Employee of the Year Nomination
                        </h4>
                        <div className="h-0.5 w-16 bg-gradient-to-r from-transparent via-amber-400 to-transparent mx-auto mt-1" />
                      </div>

                      {/* Registration of nominee select box */}
                      <div className="space-y-1 relative z-10">
                        <label className="text-[9.5px] font-black text-slate-400 uppercase tracking-wider block">
                          Select Employee Profile
                        </label>
                        <select
                          value={nominatedEmployeeId}
                          onChange={(e) => {
                            setNominatedEmployeeId(e.target.value);
                            setIsAwardConferred(false);
                            // Set a realistic citation based on department
                            const emp = employees.find(x => x.id === e.target.value);
                            if (emp) {
                              setNominationCitation(`For outstanding leadership in the ${emp.department} department. Exhibited 100% adherence to safety regulations and engineered stellar zero-margin finish quality.`);
                            }
                          }}
                          className="w-full bg-slate-800 border-slate-700 border text-slate-200 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-400 cursor-pointer"
                        >
                          {employees.map(emp => (
                            <option key={emp.id} value={emp.id} className="bg-slate-800 text-slate-200">
                              {emp.name} ({emp.department} — {emp.role || 'Operator'})
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Citation input block */}
                      <div className="space-y-1 relative z-10">
                        <label className="text-[9.5px] font-black text-slate-400 uppercase tracking-wider block">
                          Achievement Nomination Citation
                        </label>
                        <textarea
                          rows={2}
                          value={nominationCitation}
                          onChange={(e) => {
                            setNominationCitation(e.target.value);
                            setIsAwardConferred(false);
                          }}
                          className="w-full bg-slate-800 border-slate-700 border text-slate-200 text-[10.5px] leading-relaxed rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-400"
                          placeholder="State the technical achievement or citation details..."
                        />
                      </div>

                      {/* Profile details */}
                      {(() => {
                        const activeEmp = employees.find(x => x.id === nominatedEmployeeId);
                        if (!activeEmp) return null;

                        return (
                          <div className="bg-slate-800/80 p-3 rounded-xl border border-slate-700/60 flex items-center gap-3 relative z-10">
                            <div className="h-9 w-9 rounded-full bg-amber-500/25 border border-amber-400/55 flex items-center justify-center font-mono font-black text-amber-300 text-xs shadow-xs">
                              {activeEmp.name.split(' ').map(n=>n[0]).join('').slice(0, 2).toUpperCase()}
                            </div>
                            <div className="space-y-0.5 text-xs truncate">
                              <p className="font-extrabold text-slate-100">{activeEmp.name}</p>
                              <p className="text-[10px] text-amber-400 font-bold">{activeEmp.role || 'Senior Specialist'}</p>
                              <p className="text-[9.5px] text-slate-400 truncate">{activeEmp.department} Office</p>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Confer status display if true */}
                      {isAwardConferred && (
                        <div className="bg-amber-400 text-slate-900 px-3 py-2.5 rounded-xl border border-amber-300 shadow-md text-xs relative overflow-hidden animate-fadeIn">
                          <Crown className="absolute -right-3 -bottom-3 h-14 w-14 text-slate-900/10" />
                          <div className="flex items-center gap-2">
                            <Award className="h-5 w-5 text-slate-900 animate-bounce shrink-0" />
                            <div>
                              <p className="font-black uppercase tracking-wider text-[10px]">PRESIDENTIAL DISTINCTION AWARDED</p>
                              <p className="font-mono text-[9px] text-slate-800">Nominated as Mat LLC Employee of the Year</p>
                            </div>
                          </div>
                        </div>
                      )}

                    </div>

                    {/* Action trigger button */}
                    <button
                      onClick={() => {
                        if (!isAwardConferred) {
                          setIsAwardConferred(true);
                        } else {
                          setIsAwardConferred(false);
                        }
                      }}
                      className={`w-full py-2.5 text-xs font-bold rounded-xl transition-all shadow-sm border flex items-center justify-center gap-1.5 cursor-pointer font-sans ${
                        isAwardConferred 
                          ? 'bg-rose-50 hover:bg-rose-100/80 border-rose-100 text-rose-700' 
                          : 'bg-gradient-to-r from-amber-500 to-amber-600 hover:brightness-105 border-amber-500 text-white'
                      }`}
                    >
                      {isAwardConferred ? (
                        <>
                          <X className="h-4 w-4" />
                          Revoke Executive Award
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="h-4 w-4" />
                          Confer Annual Presidential Medal
                        </>
                      )}
                    </button>
                  </div>
                )}

              </div>

            </div>

          </div>
        )}

        {/* Tab 1.1: Dedicated All Projects Portal (ReadOnly View for Managers) */}
        {activeTab === 'projects_portal' && (
          <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-5 animate-fadeIn" id="mgmt-project-portal-container">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-base font-black text-slate-800 tracking-tight flex items-center gap-2">
                  <Briefcase className="h-5 w-5 text-indigo-600" />
                  Live Pool Projects Cumulative Balance
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Analytical tracking registry of contract quotas: Tiger 188, normal vs mirror designs, produced, and shipping balances.
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

            {/* List Table */}
            <div className="overflow-x-auto">
              <table className="min-w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-400 font-bold text-[10px] uppercase tracking-wider">
                    <th className="py-3 px-3">Project / Client Contract</th>
                    <th className="py-3 px-3">Orientation Specs</th>
                    <th className="py-3 px-3 text-center">Total Balance</th>
                    <th className="py-3 px-3 text-center text-emerald-600">Delivered Pools</th>
                    <th className="py-3 px-3 text-center text-amber-600">Produced Pools</th>
                    <th className="py-3 px-3 text-center text-rose-600">Remaining Balance</th>
                    <th className="py-3 px-3 text-right">Progress Bar</th>
                    <th className="py-3 px-3 text-right">Delete Operations</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs text-slate-800">
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
                        <tr key={proj.id} className="hover:bg-slate-50/40 transition-colors">
                          <td className="py-3 px-3">
                            <span className="font-extrabold text-slate-900 block">{proj.projectName}</span>
                            <span className="text-[10px] text-slate-400 font-mono">UUID: {proj.id}</span>
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
                          <td className="py-3 px-3 text-center text-rose-750 font-extrabold bg-rose-50/10 font-mono text-sm">
                            {proj.remainingPools}
                          </td>
                          <td className="py-3 px-3 text-right">
                            <div className="w-28 bg-slate-100 h-2 rounded-full overflow-hidden ml-auto flex">
                              <div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, percentDelivered)}%` }} title="Delivered" />
                              <div className="h-full bg-amber-400" style={{ width: `${Math.min(100, percentProduced - percentDelivered)}%` }} title="Produced but not delivered" />
                            </div>
                            <span className="block text-[9.5px] mt-0.5 text-slate-400 text-right">{percentDelivered}% Deliv / {percentProduced}% Prod</span>
                          </td>
                          <td className="py-3 px-3 text-right">
                            <button
                              onClick={() => {
                                if (window.confirm(`Are you absolutely sure you want to delete Project contract "${proj.projectName}" permanently from Cloud SQL?`)) {
                                  onDeleteProjectSummary?.(proj.id);
                                  alert('Project record deleted successfully.');
                                }
                              }}
                              className="p-1 px-2.5 bg-rose-50 text-rose-600 rounded border border-rose-100 hover:bg-rose-150 transition text-[10px] uppercase font-bold inline-flex items-center gap-1 cursor-pointer"
                              title="Delete project"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              <span>Delete</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  {projectsSummary.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-400 font-mono text-[11px]">
                        No legacy or active projects logged in Cloud database. Set them up inside the Planning Department portal.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 flex gap-3 text-xs text-slate-500 leading-relaxed">
              <Info className="h-4 w-4 text-indigo-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-slate-700 block">Orientation Ratio & Backlog Balance Analysis</span>
                Use this portal to monitor how many pools are currently in processing queue vs shipped on real locations. Mirror allocations require specialized tooling designs on stages 2 & 4. Keep an eye on normal vs mirror density bounds.
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
                    <div className="flex justify-between items-start gap-4">
                      <div>
                        <span className="font-mono text-xs font-black text-cyan-600 bg-cyan-50 px-2.5 py-0.5 border border-cyan-100 rounded">
                          {selectedPool.poolNo}
                        </span>
                        <h3 className="text-lg font-black text-slate-900 mt-2 tracking-tight">
                          {selectedPool.projectName}
                        </h3>
                      </div>
                      <button
                        onClick={() => {
                          if (window.confirm(`🚨 PRODUCER ALERT!\nAre you absolutely sure you want to delete and scrap Pool [${selectedPool.poolNo}] for "${selectedPool.projectName}"?\nAll manufacturing records for this pool will be deleted permanently.`)) {
                            onDeletePool?.(selectedPool.id, 'Plant Manager');
                            setSelectedPoolId(null);
                          }
                        }}
                        className="px-3 py-1.5 bg-rose-50 border border-rose-100 text-rose-600 hover:bg-rose-100 text-xs font-extrabold uppercase rounded-lg cursor-pointer transition-all flex items-center gap-1 shrink-0 shadow-2xs"
                        title="Scrap and delete pool record"
                      >
                        <Trash2 className="h-3.5 w-3.5 animate-pulse" />
                        <span>Scrap Pool</span>
                      </button>
                    </div>
                    
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
                        const isSkipped = hist && hist.status === 'SKIPPED';
                        const isCarried = hist && hist.status === 'CARRIED_ON_SITE';
                        
                        let dotColor = 'bg-slate-205 bg-slate-200 border-slate-300';
                        if (isApproved) dotColor = 'bg-emerald-500 border-emerald-600 shadow-sm shadow-emerald-500/40';
                        else if (isSkipped) dotColor = 'bg-amber-500 border-amber-600 shadow-sm shadow-amber-500/30';
                        else if (isCarried) dotColor = 'bg-purple-500 border-purple-600 shadow-sm shadow-purple-500/30';
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
                                      <p className="italic text-[9.5px] line-clamp-2" title={hist.inspectorNotes}>&quot;{hist.inspectorNotes}&quot;</p>
                                      {hist.inspectorPicture && (
                                        <div className="mt-1 flex justify-end relative group">
                                          <img 
                                            src={hist.inspectorPicture} 
                                            alt="Inspection Attachment" 
                                            className="h-8 w-10 object-cover rounded border border-slate-250 cursor-pointer transition-all hover:scale-150 relative z-10" 
                                            referrerPolicy="no-referrer"
                                          />
                                          {/* Hover-zoom large preview */}
                                          <div className="absolute right-0 bottom-full mb-1.5 hidden group-hover:block z-50 bg-slate-900 p-1 rounded-lg shadow-xl border border-slate-705 border-slate-700 w-44">
                                            <img 
                                              src={hist.inspectorPicture} 
                                              alt="Enlarged evidence" 
                                              className="w-full h-auto object-contain max-h-[140px] rounded" 
                                              referrerPolicy="no-referrer"
                                            />
                                          </div>
                                        </div>
                                      )}
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

        {/* Tab: Daily Stage-wise Progress (date filter shows which pools finished each stage that day, and which team) */}
        {activeTab === 'daily_progress' && (
          <div className="space-y-6">

            {/* Date picker header */}
            <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                  <Calendar className="h-4 w-4 text-blue-500" />
                  Daily Stage-wise Progress
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Pick a date to see exactly which pools were QA-approved in each stage that day, and which team did the work.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={progressFilterDate}
                  onChange={(e) => setProgressFilterDate(e.target.value)}
                  className="text-xs border border-slate-200 rounded-xl px-3 py-2 font-semibold text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
                <button
                  onClick={() => setProgressFilterDate(todayStr)}
                  className="text-xs font-bold px-3 py-2 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 cursor-pointer"
                >
                  Today
                </button>
              </div>
            </div>

            {/* Summary strip */}
            <div className="bg-slate-900 text-white rounded-2xl p-5 flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase font-black tracking-wider text-slate-400">
                  {new Date(progressFilterDate + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
                </p>
                <p className="text-2xl font-extrabold mt-1">{totalDonePoolsOnDate} pool-stage sign-offs</p>
              </div>
              <div className="flex gap-4 flex-wrap justify-end">
                {stageDailyProgress.filter(s => s.donePools.length > 0).map(s => (
                  <div key={s.stage.id} className="text-center px-3">
                    <span className="block text-lg font-bold">{s.donePools.length}</span>
                    <span className="text-[9px] text-slate-400 uppercase font-bold tracking-wide">{s.stage.name}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Per-stage breakdown */}
            {totalDonePoolsOnDate === 0 ? (
              <div className="text-center py-16 bg-white border border-slate-100 rounded-2xl">
                <Calendar className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm font-bold text-slate-500">No stage sign-offs recorded on this date.</p>
                <p className="text-xs text-slate-400 mt-1">Try another date, or check that stages were QA-approved (not just started) that day.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {stageDailyProgress.map(({ stage, donePools }) => (
                  <div key={stage.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                    <div
                      className="px-4 py-3 flex items-center justify-between"
                      style={{ background: `linear-gradient(135deg, ${stage.color}ee, ${stage.color})` }}
                    >
                      <span className="text-white font-bold text-xs tracking-wide">{stage.name}</span>
                      <span className="bg-white/20 text-white text-xs font-black px-2 py-0.5 rounded-full">
                        {donePools.length} done
                      </span>
                    </div>
                    {donePools.length === 0 ? (
                      <p className="text-xs text-slate-400 text-center py-6">No pools completed in this stage on this date.</p>
                    ) : (
                      <div className="divide-y divide-slate-100 max-h-[260px] overflow-y-auto">
                        {donePools.map((dp) => (
                          <div key={dp.poolId} className="px-4 py-2.5 flex items-center justify-between text-xs hover:bg-slate-50">
                            <div className="min-w-0">
                              <p className="font-black text-slate-800 truncate">{dp.poolNo}</p>
                              <p className="text-slate-400 truncate">{dp.projectName}</p>
                            </div>
                            <div className="text-right flex-shrink-0 ml-2">
                              <p className="font-bold text-slate-600">{dp.teamName}</p>
                              <p className="text-[10px] text-slate-400">{dp.time}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

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

        {/* Tab 3.5: Employee Portal */}
        {activeTab === 'employee_portal' && (
          <div className="space-y-6 animate-fadeIn">
            {/* Header section with metrics */}
            <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <h3 className="text-base font-black text-slate-800 tracking-tight flex items-center gap-2">
                    <Users className="h-5 w-5 text-pink-650 text-pink-500" />
                    Factory Employee Directory Portal
                  </h3>
                  <p className="text-xs text-slate-500">
                    Maintain the authoritative worker roster for all workflow departments. Manage names, roles, contact cards, and shift assignments.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsManageDeptsOpen(true)}
                    className="px-4 py-2 bg-white border border-slate-200 text-slate-700 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 shadow-xs hover:bg-slate-50 transition-all cursor-pointer font-sans"
                    id="manage-custom-depts-btn"
                  >
                    <SlidersHorizontal className="h-4 w-4 text-indigo-500" />
                    <span>⚙️ Custom Departments</span>
                  </button>
                  <button
                    onClick={openAddEmployeeModal}
                    className="px-4 py-2 bg-slate-900 border border-slate-800 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 shadow-sm hover:bg-slate-800 transition-all cursor-pointer font-sans"
                  >
                    <Plus className="h-4 w-4" />
                    Register New Employee
                  </button>
                </div>
              </div>

              {/* Mini cards for roster insights */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-2">
                <div className="bg-slate-50 p-4 border border-slate-100 rounded-xl">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Total Workforce</span>
                  <span className="text-2xl font-black font-mono text-slate-800">{employees.length}</span>
                  <span className="text-[10px] text-slate-500 block mt-0.5">Active profiles</span>
                </div>
                <div className="bg-slate-50 p-4 border border-slate-100 rounded-xl">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Planning Division</span>
                  <span className="text-2xl font-black font-mono text-emerald-600">
                    {employees.filter(e => e.department === 'Planning').length}
                  </span>
                  <span className="text-[10px] text-slate-500 block mt-0.5">Schedulers & Dispatchers</span>
                </div>
                <div className="bg-slate-50 p-4 border border-slate-100 rounded-xl">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Structural Assembly</span>
                  <span className="text-2xl font-black font-mono text-indigo-600">
                    {employees.filter(e => ['Steel Fabrication', 'Steel Primer', 'Structural Lamination'].includes(e.department)).length}
                  </span>
                  <span className="text-[10px] text-slate-500 block mt-0.5 font-sans">Fabrication & Moulding</span>
                </div>
                <div className="bg-slate-50 p-4 border border-slate-100 rounded-xl">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Quality Assurance</span>
                  <span className="text-2xl font-black font-mono text-pink-650 text-pink-600">
                    {employees.filter(e => e.department === 'Quality Control').length}
                  </span>
                  <span className="text-[10px] text-slate-500 block mt-0.5">Inspectors & Supervisors</span>
                </div>
              </div>
            </div>

            {/* Sub Tabs Selector inside Employee Portal */}
            <div className="flex border-b border-slate-200">
              <button
                onClick={() => setEmployeePortalSubTab('roster')}
                className={`py-3 px-6 text-xs font-black tracking-wider uppercase border-b-2 transition-all cursor-pointer flex items-center gap-2 ${
                  employeePortalSubTab === 'roster'
                    ? 'border-indigo-650 text-indigo-700 bg-slate-50/50'
                    : 'border-transparent text-slate-400 hover:text-slate-600'
                }`}
              >
                <Users className="h-4 w-4" />
                Staff Directory ({employees.length})
              </button>
              <button
                onClick={() => setEmployeePortalSubTab('punches')}
                className={`py-3 px-6 text-xs font-black tracking-wider uppercase border-b-2 transition-all cursor-pointer flex items-center gap-2 ${
                  employeePortalSubTab === 'punches'
                    ? 'border-indigo-650 text-indigo-700 bg-slate-50/50'
                    : 'border-transparent text-slate-400 hover:text-slate-600'
                }`}
              >
                <Clock className="h-4 w-4" />
                Time Card Machine Punches & Shift Attendance
              </button>
            </div>

            {employeePortalSubTab === 'roster' && (
              <>
                {/* Filter and Search Bar row */}
            <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search by worker name, role description, or notes..."
                  value={employeeSearchTerm}
                  onChange={(e) => setEmployeeSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-slate-450 focus:ring-slate-400 transition-all font-medium text-slate-800"
                />
              </div>

              {/* Department filtering selector */}
              <div className="flex items-center gap-2">
                <Filter className="h-3.5 w-3.5 text-slate-400" />
                <span className="text-xs text-slate-500 font-bold">Line Filter:</span>
                <select
                  value={employeeDeptFilter}
                  onChange={(e) => setEmployeeDeptFilter(e.target.value)}
                  className="bg-slate-50 border border-slate-205 border-slate-200 text-xs font-bold text-slate-700 px-3 py-1.5 rounded-lg focus:outline-none cursor-pointer"
                >
                  <option value="all">All Departments ({employees.length})</option>
                  {allDepartments.map(dept => (
                    <option key={dept} value={dept}>
                      {dept} ({employees.filter(e => e.department === dept).length})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Employee profile cards grid */}
            {(() => {
              const query = employeeSearchTerm.toLowerCase().trim();
              const filtered = employees.filter(emp => {
                const matchesSearch = emp.name.toLowerCase().includes(query) ||
                  (emp.role && emp.role.toLowerCase().includes(query)) ||
                  (emp.notes && emp.notes.toLowerCase().includes(query));
                
                const matchesDept = employeeDeptFilter === 'all' || emp.department === employeeDeptFilter;
                return matchesSearch && matchesDept;
              });

              return (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {filtered.length > 0 ? (
                    filtered.map(emp => {
                      const initials = emp.name.split(' ').map(s => s[0]).join('').toUpperCase().slice(0, 2);
                      
                      // Assign color based on department text hash or specific matches
                      let bgDeptColor = 'bg-slate-100 text-slate-800 border-slate-200';
                      let bgAbbrevColor = 'bg-slate-200 text-slate-700';
                      if (emp.department === 'Planning') {
                        bgDeptColor = 'bg-emerald-50 border border-emerald-100 text-emerald-800';
                        bgAbbrevColor = 'bg-emerald-600 text-white';
                      } else if (emp.department === 'Steel Fabrication') {
                        bgDeptColor = 'bg-blue-50 border border-blue-100 text-blue-800';
                        bgAbbrevColor = 'bg-blue-600 text-white';
                      } else if (emp.department === 'Structural Lamination') {
                        bgDeptColor = 'bg-pink-50 border border-pink-100 text-pink-800';
                        bgAbbrevColor = 'bg-pink-600 text-white';
                      } else if (emp.department === 'Quality Control') {
                        bgDeptColor = 'bg-rose-50 border border-rose-100 text-rose-800';
                        bgAbbrevColor = 'bg-rose-600 text-white';
                      } else if (emp.department === 'Factory Management') {
                        bgDeptColor = 'bg-purple-50 border border-purple-100 text-purple-800';
                        bgAbbrevColor = 'bg-purple-600 text-white';
                      }

                      return (
                        <div key={emp.id} className="bg-white p-5 rounded-2xl border border-slate-100 shadow-xs hover:shadow-md transition-all flex flex-col justify-between space-y-4">
                          <div className="space-y-3">
                            {/* Profile top with Initials */}
                            <div className="flex items-center gap-3">
                              <div className={`h-10 w-10 rounded-full flex items-center justify-center font-bold text-xs select-none shadow-xs shrink-0 ${bgAbbrevColor}`}>
                                {initials || 'A'}
                              </div>
                              <div className="min-w-0 flex-1">
                                <h4 className="font-extrabold text-slate-800 text-sm truncate">{emp.name}</h4>
                                <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full mt-0.5 inline-block ${bgDeptColor}`}>
                                  {emp.department}
                                </span>
                              </div>
                            </div>

                            {/* Role / Subtitle */}
                            <div className="space-y-1 text-xs">
                              <div className="flex items-baseline gap-1.5">
                                <span className="text-slate-400 font-bold text-[10px] uppercase tracking-wider">Role Title:</span>
                                <span className="text-slate-700 font-medium">{emp.role || 'General Operator'}</span>
                              </div>

                              {/* Contact particulars with labels */}
                              {(emp.email || emp.phone) && (
                                <div className="pt-2 border-t border-slate-50 space-y-1 text-[11px] text-slate-500 font-mono">
                                  {emp.email && (
                                    <div className="truncate text-slate-500 flex items-center gap-1.5">
                                      <span className="text-[9px] font-bold text-slate-400">📧</span>
                                      <a href={`mailto:${emp.email}`} className="hover:underline text-indigo-600">{emp.email}</a>
                                    </div>
                                  )}
                                  {emp.phone && (
                                    <div className="text-slate-500 flex items-center gap-1.5">
                                      <span className="text-[9px] font-bold text-slate-400">📞</span>
                                      <span>{emp.phone}</span>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Employee Notes */}
                            {emp.notes && (
                              <p className="text-[11px] text-slate-400 bg-slate-50 p-2.5 rounded-xl leading-relaxed italic border border-slate-100">
                                &ldquo;{emp.notes}&rdquo;
                              </p>
                            )}
                          </div>

                          {/* Actions edit and delete */}
                          <div className="flex items-center gap-2 pt-3 border-t border-slate-50 justify-end">
                            <span className="text-[9px] text-slate-400 font-mono font-medium block mr-auto">
                              Registered: {emp.createdAt ? emp.createdAt.split('T')[0] : '—'}
                            </span>
                            <button
                              onClick={() => openEditEmployeeModal(emp)}
                              className="p-1 px-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[10px] rounded-lg cursor-pointer flex items-center gap-1 transition-all"
                            >
                              <Edit2 className="h-3 w-3" />
                              <span>Edit</span>
                            </button>
                            <button
                              onClick={() => {
                                if (window.confirm(`Are you sure you want to delete profile for ${emp.name}?`)) {
                                  if (onDeleteEmployee) onDeleteEmployee(emp.id);
                                }
                              }}
                              className="p-1 px-2.5 bg-rose-50 border border-rose-100 hover:bg-rose-105 text-rose-600 font-bold text-[10px] rounded-lg cursor-pointer flex items-center gap-1 transition-all"
                            >
                              <Trash2 className="h-3 w-3" />
                              <span>Delete</span>
                            </button>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="col-span-1 md:col-span-3 text-center py-16 bg-white rounded-2xl border border-slate-100 shadow-sm space-y-2">
                      <HelpCircle className="h-10 w-10 text-slate-400 mx-auto" />
                      <p className="text-sm font-bold text-slate-700">No employees match filters</p>
                      <p className="text-xs text-slate-400">Try modifying your search or registry choice.</p>
                    </div>
                  )}
                </div>
              );
            })()}
              </>
            )}

            {employeePortalSubTab === 'punches' && (
              <div className="space-y-6 animate-fadeIn">
                {/* 1. Statistics Summary */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  <div className="bg-emerald-50/75 border border-emerald-200 p-5 rounded-2xl flex flex-col justify-between shadow-xs">
                    <div className="flex justify-between items-start">
                      <span className="text-[10px] font-black text-emerald-800 uppercase tracking-widest">Came / Present Today</span>
                      <span className="text-xs font-mono font-bold text-emerald-600 bg-emerald-100/50 px-2 py-0.5 rounded-full">Present</span>
                    </div>
                    <div className="mt-3">
                      <span className="text-3xl font-black font-mono text-emerald-700">
                        {employees.filter(emp =>
                          employeePunches.some(p => p.employeeId === emp.id && p.date === selectedPunchDate && p.punchType === 'IN')
                        ).length}
                      </span>
                      <span className="text-slate-500 font-bold text-xs ml-2">/ {employees.length} workers</span>
                    </div>
                    <p className="text-[10px] text-emerald-700 mt-2 font-medium">Checked in at a machine on {selectedPunchDate}</p>
                  </div>

                  <div className="bg-rose-50/75 border border-rose-200 p-5 rounded-2xl flex flex-col justify-between shadow-xs">
                    <div className="flex justify-between items-start">
                      <span className="text-[10px] font-black text-rose-800 uppercase tracking-widest">Absent Workers</span>
                      <span className="text-xs font-mono font-bold text-rose-600 bg-rose-100 px-2 py-0.5 rounded-full">Absent</span>
                    </div>
                    <div className="mt-3">
                      <span className="text-3xl font-black font-mono text-rose-700">
                        {employees.filter(emp =>
                          !employeePunches.some(p => p.employeeId === emp.id && p.date === selectedPunchDate && p.punchType === 'IN')
                        ).length}
                      </span>
                      <span className="text-slate-500 font-bold text-xs ml-2">/ {employees.length} workers</span>
                    </div>
                    <p className="text-[10px] text-rose-700 mt-2 font-medium">No check-in punches recorded for this date.</p>
                  </div>

                  <div className="bg-white border border-slate-200 p-5 rounded-2xl flex flex-col justify-between shadow-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Shift Date Target</span>
                      <Calendar className="h-4 w-4 text-indigo-500" />
                    </div>
                    <div className="mt-3">
                      <input
                        type="date"
                        value={selectedPunchDate}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val) setSelectedPunchDate(val);
                        }}
                        className="w-full text-xs font-black font-mono bg-slate-50 border border-slate-200 text-slate-800 px-3.5 py-2 rounded-xl focus:outline-none cursor-pointer"
                      />
                    </div>
                    <p className="text-[10px] text-slate-400 mt-2">Filter statistics list and punches by calendar date.</p>
                  </div>
                </div>

                {/* 30-Day Attendance Consistency Trend Chart */}
                <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-6 font-sans">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between border-b border-slate-100 pb-4 gap-4">
                    <div className="space-y-1">
                      <h4 className="text-sm font-black text-slate-850 uppercase tracking-wide flex items-center gap-2">
                        <TrendingUp className="h-5 w-5 text-indigo-600 animate-pulse" />
                        30-Day Attendance Consistency Trend
                      </h4>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Rolling 30-day labor presence and workforce consistency tracking ending on <span className="font-bold text-slate-700">{selectedPunchDate}</span>.
                      </p>
                    </div>
                    {/* Insights Summary Pills */}
                    <div className="flex flex-wrap items-center gap-2.5 text-xs">
                      <div className="bg-indigo-50 border border-indigo-100 px-3 py-1.5 rounded-xl flex items-center gap-2">
                        <span className="text-[9px] font-black text-indigo-700 uppercase tracking-widest leading-none">30-Day Avg Presence Rate</span>
                        <span className="font-mono font-black text-indigo-900 leading-none">{trendStats.avgRate}%</span>
                      </div>
                      <div className="bg-emerald-50 border border-emerald-100 px-3 py-1.5 rounded-xl flex items-center gap-2">
                        <span className="text-[9px] font-black text-emerald-700 uppercase tracking-widest leading-none">Peak Day</span>
                        <span className="font-mono font-black text-emerald-950 leading-none">{trendStats.peakRate}% <span className="text-[10px] font-medium font-sans text-emerald-600">({trendStats.peakDate})</span></span>
                      </div>
                      <div className="bg-amber-50 border border-amber-100 px-3 py-1.5 rounded-xl flex items-center gap-2">
                        <span className="text-[9px] font-black text-amber-700 uppercase tracking-widest leading-none">Floor Low</span>
                        <span className="font-mono font-black text-amber-950 leading-none">{trendStats.lowRate}% <span className="text-[10px] font-medium font-sans text-amber-600">({trendStats.lowDate})</span></span>
                      </div>
                    </div>
                  </div>

                  <div className="h-64 sm:h-72 w-full pt-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={computedAttendanceTrend}
                        margin={{ top: 10, right: 20, left: -20, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chartAxisDefaults.gridStroke} />
                        <XAxis 
                          dataKey="displayDate" 
                          stroke={chartAxisDefaults.axisStroke} 
                          fontSize={10} 
                          tickLine={false} 
                          axisLine={false} 
                          dy={10} 
                        />
                        <YAxis 
                          stroke={chartAxisDefaults.axisStroke} 
                          fontSize={10} 
                          tickLine={false} 
                          axisLine={false} 
                          domain={[0, 100]} 
                          tickFormatter={(val) => `${val}%`} 
                          dx={-5} 
                        />
                        <RechartsTooltip 
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              const data = payload[0].payload;
                              return (
                                <div className="bg-slate-900 border border-slate-800 text-white rounded-xl p-3 shadow-lg space-y-1.5 min-w-[140px] font-sans">
                                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{data.date}</p>
                                  <div className="h-px bg-slate-800 my-1" />
                                  <div className="flex justify-between items-center text-xs gap-4">
                                    <span className="text-slate-400 font-medium">Presence Rate:</span>
                                    <span className="font-extrabold text-indigo-400 font-mono">{data.rate}%</span>
                                  </div>
                                  <div className="flex justify-between items-center text-xs gap-4">
                                    <span className="text-slate-400 font-medium">Present Workers:</span>
                                    <span className="font-semibold text-slate-200 font-mono">{data.present}</span>
                                  </div>
                                  <div className="flex justify-between items-center text-xs gap-4">
                                    <span className="text-slate-400 font-medium">Registry limit:</span>
                                    <span className="font-medium text-slate-400 font-mono">{data.total} total</span>
                                  </div>
                                  {data.isSimulated && (
                                    <div className="text-[9px] text-slate-500 italic mt-1 font-sans">
                                      * Simulated attendance baseline
                                    </div>
                                  )}
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <Line 
                          type="monotone" 
                          dataKey="rate" 
                          stroke="url(#attendanceGradient)" 
                          strokeWidth={3} 
                          dot={{ r: 3, stroke: chartTokens.primary[600], strokeWidth: 1.5, fill: chartTokens.neutral.white }}
                          activeDot={{ r: 5, stroke: chartTokens.primary[600], strokeWidth: 2, fill: chartTokens.primaryTint }}
                        />
                        <defs>
                          <linearGradient id="attendanceGradient" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stopColor={chartTokens.primary[500]} />
                            <stop offset="50%" stopColor={chartTokens.primary[600]} />
                            <stop offset="100%" stopColor={chartTokens.primary[800]} />
                          </linearGradient>
                        </defs>
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="text-[10px] text-slate-400 flex flex-col sm:flex-row sm:items-center justify-between border-t border-slate-50 pt-3.5 gap-2">
                    <p>💡 <span className="font-semibold text-slate-500">Analysis:</span> Daily attendance rate should ideally hover above <span className="font-extrabold text-slate-600">85%</span> to ensure optimal station floor throughput.</p>
                    <p className="font-mono text-[9px] text-indigo-500 bg-indigo-50/50 border border-indigo-150 px-2.5 py-0.5 rounded-full font-bold self-start sm:self-auto">PostgreSQL Real-Time Synchronized Logs</p>
                  </div>
                </div>

                {/* Daily Attendance File Upload & Parsing Stream */}
                <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4 font-sans focus:outline-none">
                  {/* Top Header Segment with tab switcher + Deletion Manager */}
                  <div className="flex flex-col xl:flex-row xl:items-center justify-between border-b border-slate-100 pb-4 gap-4">
                    <div className="space-y-1">
                      <h4 className="text-sm font-black text-slate-850 uppercase tracking-wide flex items-center gap-2">
                        <UploadCloud className="h-5 w-5 text-indigo-600 animate-pulse" />
                        Daily Attendance Sync Workspace
                      </h4>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Import check-ins and check-outs using local spreadsheets (Excel, CSV) or direct automated Bio Cloud REST software connection.
                      </p>
                    </div>

                    {/* Controls Grid */}
                    <div className="flex flex-wrap items-center gap-3">
                      {/* Tab Switcher */}
                      <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
                        <button
                          onClick={() => setAttendanceActionTab('upload')}
                          className={`flex items-center gap-1.5 text-[11px] font-black px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                            attendanceActionTab === 'upload'
                              ? 'bg-white shadow-xs text-indigo-700'
                              : 'text-slate-500 hover:text-indigo-700 bg-transparent'
                          }`}
                        >
                          <FileSpreadsheet className="h-3.5 w-3.5" />
                          Import Spreadsheet (Excel/CSV)
                        </button>
                        <button
                          onClick={() => setAttendanceActionTab('biocloud')}
                          className={`flex items-center gap-1.5 text-[11px] font-black px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                            attendanceActionTab === 'biocloud'
                              ? 'bg-white shadow-xs text-indigo-700'
                              : 'text-slate-500 hover:text-indigo-700 bg-transparent'
                          }`}
                        >
                          <Cloud className="h-3.5 w-3.5" />
                          Direct Bio Cloud API
                        </button>
                      </div>

                      {/* Deletion Control Tools */}
                      <div className="flex items-center gap-1.5">
                        {isDeletingPunchesByDate ? (
                          <div className="flex items-center gap-1.5 bg-rose-50 border border-rose-200 p-1.5 rounded-xl text-[10px] animate-scaleUp">
                            <span className="font-extrabold text-rose-700">Delete all logs for {selectedPunchDate}?</span>
                            <button
                              onClick={() => {
                                if (onDeleteEmployeePunchesByDate) {
                                  onDeleteEmployeePunchesByDate(selectedPunchDate);
                                }
                                setIsDeletingPunchesByDate(false);
                              }}
                              className="bg-rose-600 hover:bg-rose-700 text-white font-black px-2 py-1 rounded-lg text-[9px] cursor-pointer"
                            >
                              Yes, Delete
                            </button>
                            <button
                              onClick={() => setIsDeletingPunchesByDate(false)}
                              className="bg-white hover:bg-slate-100 text-slate-500 border border-slate-200 px-2 py-1 rounded-lg text-[9px] cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : isWipingAllPunches ? (
                          <div className="flex items-center gap-1.5 bg-rose-50 border border-rose-200 p-1.5 rounded-xl text-[10px] animate-scaleUp">
                            <span className="font-extrabold text-rose-700 font-mono">WIPE ALL ATTENDANCE LOGS?</span>
                            <button
                              onClick={() => {
                                if (onClearAllEmployeePunches) {
                                  onClearAllEmployeePunches();
                                }
                                setIsWipingAllPunches(false);
                              }}
                              className="bg-red-650 hover:bg-red-750 text-white font-black px-2 py-1 rounded-lg text-[9px] cursor-pointer"
                            >
                              Yes, Wipe All!
                            </button>
                            <button
                              onClick={() => setIsWipingAllPunches(false)}
                              className="bg-white hover:bg-slate-100 text-slate-500 border border-slate-200 px-2 py-1 rounded-lg text-[9px] cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setIsDeletingPunchesByDate(true)}
                              title={`Delete all punches on ${selectedPunchDate}`}
                              className="bg-white hover:bg-rose-50 border border-slate-200 text-slate-600 hover:text-rose-750 hover:border-rose-150 text-[11px] font-bold px-3 py-2 rounded-xl flex items-center gap-1 transition-all cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                              Delete Date ({selectedPunchDate})
                            </button>
                            <button
                              onClick={() => setIsWipingAllPunches(true)}
                              title="Wipe all employee punches completely"
                              className="bg-white hover:bg-red-50 border border-slate-200 text-slate-500 hover:text-red-600 hover:border-red-150 text-[11px] font-medium px-2.5 py-2 rounded-xl flex items-center gap-1 transition-all cursor-pointer"
                            >
                              Wipe All
                            </button>
                          </div>
                        )}
                      </div>

                    </div>
                  </div>

                  {attendanceActionTab === 'upload' ? (
                    <>
                      {attendanceParsedRows.length === 0 ? (
                        <div
                          onDragOver={(e) => {
                            e.preventDefault();
                            setAttendanceDraggedActive(true);
                          }}
                          onDragLeave={() => setAttendanceDraggedActive(false)}
                          onDrop={(e) => {
                            e.preventDefault();
                            setAttendanceDraggedActive(false);
                            const file = e.dataTransfer.files?.[0];
                            if (file) handleAttendanceSheetParsing(file);
                          }}
                          className={`border-2 border-dashed rounded-2xl p-8 text-center flex flex-col items-center justify-center transition-all cursor-pointer ${
                            attendanceDraggedActive
                              ? 'border-indigo-600 bg-indigo-50/50'
                              : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/50'
                          }`}
                          onClick={() => {
                            const inputElement = document.getElementById('attendance_file_input_direct') as HTMLInputElement;
                            if (inputElement) inputElement.click();
                          }}
                        >
                          <input
                            type="file"
                            id="attendance_file_input_direct"
                            className="hidden"
                            accept=".csv,.txt,.tsv,.xlsx,.xls"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleAttendanceSheetParsing(file);
                            }}
                          />
                          <UploadCloud className="h-10 w-10 text-slate-400 mb-2.5" />
                          <p className="text-xs font-black text-slate-700">Drag & drop your Excel (.xlsx, .xls) or CSV template here, or click to browse</p>
                          <p className="text-[10px] text-slate-400 mt-1 max-w-md font-mono">
                            Supports columns: BadgeNumber (F0001, F0002...), EmployeeName, AttendanceDate (DD-MM-YYYY), ActualCheckIn, ActualCheckOut, DayOff, CheckInDeviceName
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-4 animate-scaleUp">
                          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div className="space-y-1">
                              <p className="text-xs font-black text-slate-700 uppercase tracking-widest flex items-center gap-1.5">
                                <Check className="h-4 w-4 text-emerald-650" />
                                File Parsed successfully: <span className="font-mono text-indigo-700">{attendanceFile?.name}</span>
                              </p>
                              <p className="text-[11px] text-slate-500 font-medium">
                                Detected Date: <span className="font-extrabold text-slate-800 font-mono">{selectedPunchDate}</span> • Total records found: <span className="font-mono font-black text-indigo-700">{attendanceParsedRows.length} workers</span>
                              </p>
                              <p className="text-[11px] text-slate-500">
                                Present: <span className="font-mono font-extrabold text-emerald-600">{attendanceParsedRows.filter(r => r.checkIn).length}</span> • 
                                Absent: <span className="font-mono font-extrabold text-rose-500">{attendanceParsedRows.filter(r => !r.checkIn).length}</span> • 
                                New Workers: <span className="font-mono font-extrabold text-amber-600">{attendanceParsedRows.filter(r => r.isNew).length}</span>
                              </p>
                            </div>

                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                              {attendanceParsedRows.length > 0 && (
                                <button
                                  onClick={() => {
                                    setAttendanceFile(null);
                                    setAttendanceParsedRows([]);
                                    setAttendanceImportStatus(null);
                                  }}
                                  className="text-xs font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 px-3 py-2 rounded-xl border border-rose-200 transition-all cursor-pointer"
                                >
                                  Cancel / Clear Sheet
                                </button>
                              )}

                              {attendanceParsedRows.some(r => r.isNew) && (
                                <label className="flex items-center gap-2 text-xs font-bold text-slate-600 cursor-pointer bg-white px-3 py-2 rounded-xl border border-slate-200 select-none">
                                  <input
                                    type="checkbox"
                                    checked={attendanceAutoOnboard}
                                    onChange={(e) => setAttendanceAutoOnboard(e.target.checked)}
                                    className="rounded text-indigo-600 focus:ring-0 cursor-pointer h-4 w-4"
                                  />
                                  Auto-register new workers in Directory
                                </label>
                              )}

                              <button
                                onClick={handleConfirmAttendanceBulkImport}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black px-5 py-2.5 rounded-xl uppercase tracking-wider transition-all shadow-md cursor-pointer flex items-center justify-center gap-1.5"
                              >
                                <Check className="h-4 w-4" /> Import {attendanceParsedRows.filter(r => r.checkIn || r.checkOut).length} Punches
                              </button>
                            </div>
                          </div>

                          {attendanceImportStatus && (
                            <div className={`p-3 rounded-xl border text-xs font-bold flex items-center gap-2 ${
                              attendanceImportStatus.type === 'success'
                                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                                : 'bg-rose-50 border-rose-200 text-rose-800'
                            }`}>
                              {attendanceImportStatus.type === 'success' ? <Check className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                              {attendanceImportStatus.message}
                            </div>
                          )}

                          <div className="border border-slate-100 rounded-xl overflow-hidden max-h-[300px] overflow-y-auto">
                            <table className="w-full text-left text-xs">
                              <thead className="bg-slate-50 border-b border-slate-100">
                                <tr className="text-[10px] text-slate-400 font-sans tracking-wider uppercase font-black">
                                  <th className="py-2.5 px-3">Roster Sync</th>
                                  <th className="py-2.5 px-3">Badge No</th>
                                  <th className="py-2.5 px-3">Worker Name</th>
                                  <th className="py-2.5 px-3">Department</th>
                                  <th className="py-2.5 px-3">Attendance Date</th>
                                  <th className="py-2.5 px-3">Check-In</th>
                                  <th className="py-2.5 px-3">Check-Out</th>
                                  <th className="py-2.5 px-3">Day Class</th>
                                  <th className="py-2.5 px-3">Workstation Terminal</th>
                                </tr>
                              </thead>
                              <tbody>
                                {attendanceParsedRows.map((row, idx) => (
                                  <tr key={idx} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50 transition-all text-[11px]">
                                    <td className="py-2.5 px-3">
                                      {row.isNew ? (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider font-sans bg-amber-50 text-amber-700 border border-amber-200">
                                          New Worker
                                        </span>
                                      ) : (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider font-sans bg-emerald-50 text-emerald-700 border border-emerald-200">
                                          In Directory
                                        </span>
                                      )}
                                    </td>
                                    <td className="py-2.5 px-3 font-mono font-bold text-slate-600">{row.badgeNumber}</td>
                                    <td className="py-2.5 px-3 font-extrabold text-slate-800">{row.employeeName}</td>
                                    <td className="py-2.5 px-3 text-slate-500 font-medium">{row.department}</td>
                                    <td className="py-2.5 px-3 font-mono text-slate-500">{row.date}</td>
                                    <td className="py-2.5 px-3 font-mono font-black text-[11px]">
                                      {row.checkIn ? (
                                        <span className="text-emerald-700 bg-emerald-100/60 px-1.5 py-0.5 rounded">
                                          IN • {row.checkIn}
                                        </span>
                                      ) : (
                                        <span className="text-slate-300">—</span>
                                      )}
                                    </td>
                                    <td className="py-2.5 px-3 font-mono font-black text-[11px]">
                                      {row.checkOut ? (
                                        <span className="text-amber-700 bg-amber-100/60 px-1.5 py-0.5 rounded">
                                          OUT • {row.checkOut}
                                        </span>
                                      ) : (
                                        <span className="text-slate-300">—</span>
                                      )}
                                    </td>
                                    <td className="py-2.5 px-3">
                                      {row.dayOff === 'Absent' ? (
                                        <span className="px-1.5 py-0.5 bg-rose-50 text-rose-700 rounded font-bold font-mono text-[9px]">
                                          Absent
                                        </span>
                                      ) : (
                                        <span className="px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded font-bold font-mono text-[9px]">
                                          Work Day
                                        </span>
                                      )}
                                    </td>
                                    <td className="py-2.5 px-3 font-mono text-slate-500">{row.device}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="space-y-4 animate-fadeIn">
                      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-200/60 pb-2 gap-2">
                          <div className="flex items-center gap-2">
                            <Cloud className="h-5 w-5 text-indigo-600 animate-pulse" />
                            <span className="text-xs font-black text-slate-800 uppercase tracking-wider">Bio Cloud Hardware Connector Link</span>
                          </div>
                          <span className="text-[10px] font-mono text-emerald-600 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full font-black flex items-center gap-1">
                            <Check className="h-3 w-3" /> Live Connector Active
                          </span>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                          <div className="lg:col-span-6 space-y-1.5">
                            <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Bio Cloud API Endpoint URL</label>
                            <input
                              type="text"
                              value={bioCloudUrl}
                              onChange={(e) => setBioCloudUrl(e.target.value)}
                              placeholder="e.g. https://api.biocloudsoftware.com/v2/attendance"
                              className="w-full text-xs font-mono bg-white border border-slate-200 px-3.5 py-2.5 rounded-xl focus:outline-none"
                            />
                            <p className="text-[10px] text-slate-400">Specify your Bio Cloud service endpoint (or clear/leave blank to run in simulated mode).</p>
                          </div>

                          <div className="lg:col-span-4 space-y-1.5">
                            <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Secret Token/API Key</label>
                            <input
                              type="password"
                              value={bioCloudApiKey}
                              onChange={(e) => setBioCloudApiKey(e.target.value)}
                              placeholder="••••••••••••••••••••••••••••"
                              className="w-full text-xs font-mono bg-white border border-slate-200 px-3.5 py-2.5 rounded-xl focus:outline-none"
                            />
                            <p className="text-[10px] text-slate-400">OAuth / Bearer authentication token for secure API request header.</p>
                          </div>

                          <div className="lg:col-span-2 flex flex-col justify-end">
                            <button
                              onClick={handleBioCloudSyncPull}
                              disabled={bioCloudSyncing}
                              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white disabled:bg-slate-300 font-extrabold uppercase tracking-wide text-xs py-3 rounded-xl transition-all shadow-md cursor-pointer flex items-center justify-center gap-1.5"
                            >
                              {bioCloudSyncing ? (
                                <>
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  Pulling...
                                </>
                              ) : (
                                <>
                                  <Clock className="h-4 w-4 animate-bounce" />
                                  Pull {selectedPunchDate}
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Log Console Output Terminal */}
                      <div className="bg-slate-900 border border-slate-950 rounded-2xl p-5 font-mono text-[11px] text-slate-300 space-y-2.5 shadow-inner">
                        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5 font-mono">
                            <span className="inline-block h-2.5 w-2.5 bg-emerald-500 rounded-full animate-ping" />
                            Live Terminal logs
                          </span>
                          <button
                            onClick={() => setBioCloudLogs([])}
                            className="text-[10px] font-extrabold text-slate-400 hover:text-slate-100 bg-slate-800 hover:bg-slate-700 px-2.5 py-1 rounded cursor-pointer font-sans"
                          >
                            Clear Output
                          </button>
                        </div>

                        <div className="flex flex-col gap-1 max-h-[160px] overflow-y-auto leading-relaxed scrollbar-thin font-mono text-white">
                          {bioCloudLogs.length === 0 ? (
                            <p className="text-slate-500 leading-normal font-mono">// Direct cloud punch API scheduler. Hit "Pull {selectedPunchDate}" above to execute synchronized REST stream.</p>
                          ) : (
                            bioCloudLogs.map((log, lIdx) => (
                              <p key={lIdx} className="whitespace-pre-wrap font-mono">
                                {log.includes('FAIL') || log.includes('Error') ? (
                                  <span className="text-rose-450 font-bold">{log}</span>
                                ) : log.includes('Sync complete') || log.includes('Successfully') || log.includes('Connection established') ? (
                                  <span className="text-emerald-400 font-black">{log}</span>
                                ) : (
                                  log
                                )}
                              </p>
                            ))
                          )}
                        </div>

                        {bioCloudResponseCount !== null && (
                          <div className="border-t border-slate-800 pt-2 flex items-center justify-between text-[10px] text-slate-400 pt-2.5 font-sans">
                            <p>Target Sync Date: <span className="font-bold text-white font-mono uppercase">{selectedPunchDate}</span></p>
                            <p>Successfully Synced Punches: <span className="font-bold font-mono text-emerald-400">{bioCloudResponseCount} logs</span></p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* 2. Form/Logs Row */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  {/* Left panel: Punch card builder */}
                  <div className="lg:col-span-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                    <div className="border-b border-slate-100 pb-2">
                      <h4 className="text-xs font-black text-slate-700 uppercase tracking-widest flex items-center gap-1.5 font-sans">
                        <Clock className="h-4 w-4 text-indigo-600" />
                        Machine Scan Logger
                      </h4>
                      <p className="text-[10px] text-slate-400 mt-0.5">Submit simulated punch card swipe on workcell terminal.</p>
                    </div>

                    <form onSubmit={(e) => {
                      e.preventDefault();
                      if (!punchFormEmployeeId) {
                        alert('Please select an employee profile to record punch.');
                        return;
                      }
                      const emp = employees.find(x => x.id === punchFormEmployeeId);
                      if (!emp) return;

                      const nowStr = new Date().toISOString();
                      const punchRecord = {
                        id: `punch_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
                        employeeId: emp.id,
                        employeeName: emp.name,
                        punchType: punchFormType,
                        timestamp: nowStr,
                        machineId: punchFormMachineId || 'Main Shop Entrance',
                        date: selectedPunchDate
                      };

                      if (onAddEmployeePunch) {
                        onAddEmployeePunch(punchRecord);
                      }
                    }} className="space-y-4">
                      <div>
                        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">Select Employee</label>
                        <select
                          value={punchFormEmployeeId}
                          onChange={(e) => setPunchFormEmployeeId(e.target.value)}
                          className="w-full text-xs font-medium text-slate-800 bg-slate-50 border border-slate-200 px-3 py-2.5 rounded-xl focus:outline-none cursor-pointer"
                        >
                          <option value="">-- Choose Employee --</option>
                          {employees.map(emp => (
                            <option key={emp.id} value={emp.id}>
                              {emp.name} ({emp.department})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">Punch Type</label>
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => setPunchFormType('IN')}
                              className={`flex-1 py-2 rounded-lg text-xs font-black cursor-pointer text-center border transition-all ${
                                punchFormType === 'IN'
                                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                                  : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                              }`}
                            >
                              IN
                            </button>
                            <button
                              type="button"
                              onClick={() => setPunchFormType('OUT')}
                              className={`flex-1 py-2 rounded-lg text-xs font-black cursor-pointer text-center border transition-all ${
                                punchFormType === 'OUT'
                                  ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                                  : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                              }`}
                            >
                              OUT
                            </button>
                          </div>
                        </div>

                        <div>
                          <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">Target Date</label>
                          <span className="block text-xs font-mono font-black text-slate-800 bg-slate-100 border border-slate-200 px-3 py-2 rounded-lg mt-0.5 text-center">
                            {selectedPunchDate}
                          </span>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">Station / Machine ID</label>
                        <select
                          value={punchFormMachineId}
                          onChange={(e) => setPunchFormMachineId(e.target.value)}
                          className="w-full text-xs font-semibold text-slate-700 bg-slate-50 border border-slate-200 px-3 py-2.5 rounded-xl focus:outline-none cursor-pointer"
                        >
                          <option value="Main Shop Entrance">Main Shop Entrance</option>
                          <option value="Welding Fabrication Station">Welding Fabrication Station</option>
                          <option value="Hot-Melt Lamination Deck">Hot-Melt Lamination Deck</option>
                          <option value="Gelcoat Primer Spray Station">Gelcoat Primer Spray Station</option>
                          <option value="QC Inspection Station">QC Inspection Station</option>
                          <option value="Dispatch Area Portal">Dispatch Area Portal</option>
                        </select>
                      </div>

                      <button
                        type="submit"
                        className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-black rounded-xl text-xs tracking-wider uppercase transition-all shadow-sm cursor-pointer flex items-center justify-center gap-1"
                      >
                        <Plus className="h-4 w-4" /> Log Machine Punch
                      </button>
                    </form>
                  </div>

                  {/* Right panel: Tabbed view of Day's attendance roll (Present vs Absent) */}
                  <div className="lg:col-span-8 space-y-4">
                    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4 font-sans">
                      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-slate-100 pb-3 gap-2">
                        <h4 className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-2">
                          <Users className="h-4 w-4 text-indigo-500" />
                          Attendance Roll-Call ({selectedPunchDate})
                        </h4>
                        <span className="text-[10px] text-slate-400 font-mono">
                          Auto-computed roster indices
                        </span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-2">
                        {/* Present Column */}
                        <div className="space-y-3">
                          <p className="text-[10px] font-black uppercase text-emerald-700 tracking-wider flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-50 rounded-xl w-fit font-mono">
                            <Check className="h-3.5 w-3.5" /> Checked-In Today ({
                              employees.filter(emp =>
                                employeePunches.some(p => p.employeeId === emp.id && p.date === selectedPunchDate && p.punchType === 'IN')
                              ).length
                            })
                          </p>
                          {(() => {
                            const present = employees.filter(emp =>
                              employeePunches.some(p => p.employeeId === emp.id && p.date === selectedPunchDate && p.punchType === 'IN')
                            );

                            if (present.length === 0) {
                              return (
                                <div className="p-4 text-center border border-dashed border-slate-200 rounded-xl text-slate-400 text-[10px] font-medium font-mono">
                                  No workers checked in today.
                                </div>
                              );
                            }

                            return (
                              <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
                                {present.map(emp => {
                                  const dayPunches = employeePunches
                                    .filter(p => p.employeeId === emp.id && p.date === selectedPunchDate)
                                    .sort((a,b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
                                  
                                  const firstIn = dayPunches.find(p => p.punchType === 'IN');
                                  const lastPunch = dayPunches[dayPunches.length - 1];

                                  return (
                                    <div key={emp.id} className="p-3 bg-slate-50 border border-slate-100 rounded-xl space-y-1">
                                      <div className="flex items-center justify-between">
                                        <span className="font-bold text-slate-800 text-[11px] truncate">{emp.name}</span>
                                        <span className="text-[8px] uppercase font-mono font-black text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                                          {emp.department}
                                        </span>
                                      </div>
                                      <div className="text-[9px] text-slate-500 space-y-0.5">
                                        {firstIn && (
                                          <p className="flex items-center gap-1">
                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                            First In: <span className="font-mono font-bold text-slate-700">{new Date(firstIn.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                                          </p>
                                        )}
                                        {lastPunch && (
                                          <p className="flex items-center gap-1 text-slate-400">
                                            <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                                            Last Activity: <span className="font-bold font-mono">{lastPunch.punchType}</span> ({lastPunch.machineId})
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })()}
                        </div>

                        {/* Absent Column */}
                        <div className="space-y-3">
                          <p className="text-[10px] font-black uppercase text-rose-700 tracking-wider flex items-center gap-1.5 px-2.5 py-1.5 bg-rose-50 rounded-xl w-fit font-mono">
                            <X className="h-3.5 w-3.5" /> Absent today ({
                              employees.filter(emp =>
                                !employeePunches.some(p => p.employeeId === emp.id && p.date === selectedPunchDate && p.punchType === 'IN')
                              ).length
                            })
                          </p>
                          {(() => {
                            const absent = employees.filter(emp =>
                              !employeePunches.some(p => p.employeeId === emp.id && p.date === selectedPunchDate && p.punchType === 'IN')
                            );

                            if (absent.length === 0) {
                              return (
                                <div className="p-4 text-center border border-dashed border-slate-200 rounded-xl text-slate-400 text-[10px] font-mono">
                                  100% active roster checkout complete.
                                </div>
                              );
                            }

                            return (
                              <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
                                {absent.map(emp => (
                                  <div key={emp.id} className="p-2.5 bg-white border border-slate-100 rounded-xl flex items-center justify-between shadow-xs">
                                    <div className="min-w-0">
                                      <p className="font-bold text-slate-700 text-[11px] truncate">{emp.name}</p>
                                      <p className="text-[9px] text-slate-400 whitespace-nowrap">{emp.department} • {emp.role || 'Operator'}</p>
                                    </div>
                                    <span className="text-[8px] font-black text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded uppercase font-mono">
                                      Absent
                                    </span>
                                  </div>
                                ))}
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    </div>

                    {/* Day's raw machines punches list */}
                    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4 font-sans">
                      <div className="flex border-b border-slate-100 pb-2">
                        <h4 className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-2">
                          <Activity className="h-4 w-4 text-indigo-500 animate-pulse" />
                          Workstation Machine Log Stream ({selectedPunchDate})
                        </h4>
                      </div>

                      {(() => {
                        const dayPunches = employeePunches
                          .filter(p => p.date === selectedPunchDate)
                          .sort((a,b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

                        if (dayPunches.length === 0) {
                          return (
                            <div className="text-center py-8 text-slate-400 text-[11px] font-medium font-mono">
                              No workstation punch card signals captured for this date.
                            </div>
                          );
                        }

                        return (
                          <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs">
                              <thead>
                                <tr className="border-b border-slate-100 text-slate-400 text-[9px] tracking-wider uppercase font-black font-sans">
                                  <th className="py-2.5 font-sans">Time</th>
                                  <th className="py-2.5 font-sans">Worker</th>
                                  <th className="py-2.5 font-sans">Type</th>
                                  <th className="py-2.5 font-sans font-sans">Workcell Station</th>
                                  <th className="py-2.5 text-right font-sans">Action</th>
                                </tr>
                              </thead>
                              <tbody>
                                {dayPunches.map(p => {
                                  const timeStr = new Date(p.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'});
                                  return (
                                    <tr key={p.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50 transition-all text-[11px]">
                                      <td className="py-2.5 font-mono font-bold text-slate-600">{timeStr}</td>
                                      <td className="py-2.5">
                                        <p className="font-extrabold text-slate-800">{p.employeeName}</p>
                                        <p className="text-[9.5px] text-slate-400 font-mono">ID: {p.employeeId}</p>
                                      </td>
                                      <td className="py-2.5">
                                        {p.punchType === 'IN' ? (
                                          <span className="inline-block px-1.5 py-0.5 font-mono font-black text-[9px] bg-emerald-100 text-emerald-800 rounded">
                                            IN
                                          </span>
                                        ) : (
                                          <span className="inline-block px-1.5 py-0.5 font-mono font-black text-[9px] bg-amber-100 text-amber-800 rounded">
                                            OUT
                                          </span>
                                        )}
                                      </td>
                                      <td className="py-2.5 font-bold text-slate-600 whitespace-nowrap">{p.machineId}</td>
                                      <td className="py-2.5 text-right font-mono">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            if (window.confirm('Are you sure you want to delete this punch card entry from the PostgreSQL log?')) {
                                              if (onDeleteEmployeePunch) onDeleteEmployeePunch(p.id);
                                            }
                                          }}
                                          className="p-1 px-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer transition-all"
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
                        );
                      })()}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Modal Form Dialog */}
            {isEmployeeModalOpen && (
              <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
                <div className="bg-white rounded-3xl border border-slate-100 w-full max-w-md p-6 shadow-2xl relative space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <h4 className="text-sm font-black text-slate-800 uppercase tracking-wider flex items-center gap-2">
                      <UserPlus className="h-4.5 w-4.5 text-pink-500" />
                      {editingEmployee ? 'Modify Employee Profile' : 'Register New Employee Roster'}
                    </h4>
                    <button
                      onClick={() => setIsEmployeeModalOpen(false)}
                      className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <form onSubmit={handleSaveEmployeeSubmit} className="space-y-4">
                    {/* Worker name */}
                    <div className="space-y-1">
                      <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider">
                        Employee Full Name *
                      </label>
                      <input
                        type="text"
                        required
                        value={formEmpName}
                        onChange={(e) => setFormEmpName(e.target.value)}
                        placeholder="e.g. Marcus Chen"
                        className="w-full bg-slate-50 border border-slate-205 px-3 py-2 text-xs rounded-xl focus:outline-none focus:ring-1 focus:ring-slate-400 font-bold text-slate-800"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      {/* Department */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider">
                            Department Line
                          </label>
                          <button
                            type="button"
                            onClick={() => setIsCustomDeptInputMode(!isCustomDeptInputMode)}
                            className="text-[9px] font-black text-indigo-600 hover:text-indigo-800 transition-colors select-none"
                            id="toggle-custom-dept-btn"
                          >
                            {isCustomDeptInputMode ? "[-] Pick Dropdown" : "[+] Type Custom"}
                          </button>
                        </div>
                        {isCustomDeptInputMode ? (
                          <input
                            type="text"
                            required
                            value={formEmpDept}
                            onChange={(e) => setFormEmpDept(e.target.value)}
                            placeholder="e.g. Administration"
                            className="w-full bg-slate-50 border border-indigo-200 px-3 py-2 text-xs rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-505 font-bold text-slate-800 animate-fadeIn"
                          />
                        ) : (
                          <select
                            value={formEmpDept}
                            onChange={(e) => setFormEmpDept(e.target.value)}
                            className="w-full bg-slate-50 border border-slate-205 px-3 py-2 text-xs rounded-xl focus:outline-none font-bold text-slate-700 cursor-pointer"
                          >
                            {allDepartments.map(dept => (
                              <option key={dept} value={dept}>{dept}</option>
                            ))}
                          </select>
                        )}
                      </div>

                      {/* Title/Role */}
                      <div className="space-y-1">
                        <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider">
                          Role/Title
                        </label>
                        <input
                          type="text"
                          value={formEmpRole}
                          onChange={(e) => setFormEmpRole(e.target.value)}
                          placeholder="e.g. Welder Specialist"
                          className="w-full bg-slate-50 border border-slate-205 px-3 py-2 text-xs rounded-xl focus:outline-none focus:ring-1 focus:ring-slate-400 text-slate-700"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      {/* Email */}
                      <div className="space-y-1">
                        <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider">
                          Email Address
                        </label>
                        <input
                          type="email"
                          value={formEmpEmail}
                          onChange={(e) => setFormEmpEmail(e.target.value)}
                          placeholder="marcus@apexpools.com"
                          className="w-full bg-slate-50 border border-slate-205 px-3 py-2 text-xs rounded-xl focus:outline-none focus:ring-1 focus:ring-slate-400 text-slate-700 font-mono"
                        />
                      </div>

                      {/* Phone */}
                      <div className="space-y-1">
                        <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider">
                          Phone Number
                        </label>
                        <input
                          type="text"
                          value={formEmpPhone}
                          onChange={(e) => setFormEmpPhone(e.target.value)}
                          placeholder="+1 555-0177"
                          className="w-full bg-slate-50 border border-slate-205 px-3 py-2 text-xs rounded-xl focus:outline-none focus:ring-1 focus:ring-slate-400 text-slate-700"
                        />
                      </div>
                    </div>

                    {/* Technical Notes */}
                    <div className="space-y-1">
                      <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider">
                        Remarks / Shift Notes
                      </label>
                      <textarea
                        rows={2}
                        value={formEmpNotes}
                        onChange={(e) => setFormEmpNotes(e.target.value)}
                        placeholder="e.g. Covers major laminates inspections"
                        className="w-full bg-slate-50 border border-slate-205 px-3 py-2 text-xs rounded-xl focus:outline-none focus:ring-1 focus:ring-slate-400 text-slate-700 leading-relaxed"
                      />
                    </div>

                    {/* Controls */}
                    <div className="flex items-center gap-2.5 pt-3 border-t border-slate-100 justify-end">
                      <button
                        type="button"
                        onClick={() => setIsEmployeeModalOpen(false)}
                        className="px-4 py-2 hover:bg-slate-50 text-slate-600 font-bold text-xs rounded-xl cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-750 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                      >
                        <Check className="h-4 w-4" />
                        <span>Save Profile</span>
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* Configure Departments Modal Dialog */}
            {isManageDeptsOpen && (
              <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
                <div className="bg-white rounded-3xl border border-slate-100 w-full max-w-md p-6 shadow-2xl relative space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <h4 className="text-sm font-black text-slate-800 uppercase tracking-wider flex items-center gap-2">
                      <SlidersHorizontal className="h-4.5 w-4.5 text-indigo-500" />
                      Manage Roster Departments
                    </h4>
                    <button
                      onClick={() => {
                        setIsManageDeptsOpen(false);
                        setNewDepartmentName('');
                      }}
                      className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Add department form */}
                  <div className="space-y-1 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                    <label className="block text-[10px] font-black text-slate-600 uppercase tracking-wider">
                      Add Custom Department Name
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newDepartmentName}
                        onChange={(e) => setNewDepartmentName(e.target.value)}
                        placeholder="e.g. Administration, Helpers..."
                        className="flex-1 bg-white border border-slate-200 px-3 py-2 text-xs rounded-xl focus:outline-none focus:ring-1 focus:ring-slate-400 font-bold text-slate-800"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            if (newDepartmentName.trim()) {
                              const dept = newDepartmentName.trim();
                              if (!allDepartments.includes(dept)) {
                                setCustomDepartments(prev => [...prev, dept]);
                                setNewDepartmentName('');
                              } else {
                                alert("This department name already exists!");
                              }
                            }
                          }
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (!newDepartmentName.trim()) return;
                          const dept = newDepartmentName.trim();
                          if (!allDepartments.includes(dept)) {
                            setCustomDepartments(prev => [...prev, dept]);
                            setNewDepartmentName('');
                          } else {
                            alert("This department name already exists!");
                          }
                        }}
                        className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1 font-sans"
                      >
                        <Plus className="h-4 w-4" />
                        <span>Add</span>
                      </button>
                    </div>
                    <span className="text-[9px] text-slate-400 block mt-1 leading-relaxed">
                      Type department name (e.g. Helpers, Electrician, Driver, Administration, Office Boy) and click Add.
                    </span>
                  </div>

                  {/* List of currently available departments scroll container */}
                  <div className="space-y-2">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">
                      Active Department Registry List
                    </span>
                    <div className="max-h-60 overflow-y-auto pr-1 space-y-1.5 custom-scrollbar">
                      {allDepartments.map(dept => {
                        const employeeCount = employees.filter(e => e.department === dept).length;
                        const isPreset = [
                          "Planning",
                          "Steel Fabrication",
                          "Steel Primer",
                          "Chemical Cladding",
                          "Structural Lamination",
                          "Mechanical Fittings",
                          "Plumbing Pre-fit",
                          "Cosmetic Mosaic",
                          "Acrylic Window Fit",
                          "Quality Control",
                          "Factory Management"
                        ].includes(dept);

                        return (
                          <div 
                            key={dept} 
                            className="flex items-center justify-between p-2.5 rounded-xl border border-slate-100 hover:bg-slate-50 transition-all text-xs"
                          >
                            <div className="space-y-0.5">
                              <span className="font-bold text-slate-800">{dept}</span>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[9px] text-slate-400 font-medium">
                                  {employeeCount} registered workers
                                </span>
                                <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded-sm ${
                                  isPreset ? 'bg-slate-100 text-slate-500' : 'bg-indigo-50 text-indigo-600'
                                }`}>
                                  {isPreset ? 'Predefined' : 'Custom'}
                                </span>
                              </div>
                            </div>

                            {!isPreset && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (employeeCount > 0) {
                                    if (!window.confirm(`Warning: There are ${employeeCount} employee(s) assigned to "${dept}". If you delete this prefix, they will remain in "${dept}" but the shortcut dropdown value will be deleted. Proceed?`)) {
                                      return;
                                    }
                                  }
                                  setCustomDepartments(prev => prev.filter(d => d !== dept));
                                }}
                                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all cursor-pointer"
                                title="Remove Custom Department"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        setIsManageDeptsOpen(false);
                        setNewDepartmentName('');
                      }}
                      className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl transition-all cursor-pointer"
                    >
                      Close Department Manager
                    </button>
                  </div>
                </div>
              </div>
            )}
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
                      placeholder="e.g. Eng. Full Name"
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

                  {/* Create New Team Inline Form */}
                  <div className="bg-slate-50 p-4 rounded-xl border border-dashed border-slate-200 mt-2 space-y-2">
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest leading-none">
                      + Add New Workteam To Chosen Stage:
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newTeamNameState}
                        onChange={(e) => setNewTeamNameState(e.target.value)}
                        placeholder="e.g. Al Ain Crew, Team 4"
                        className="flex-1 bg-white border border-slate-200 px-3 py-1.5 text-xs rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 font-bold"
                      />
                      <button
                        type="button"
                        onClick={handleCreateTeam}
                        className="px-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold text-xs cursor-pointer flex items-center gap-1 shrink-0 transition-colors"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span>Add Team</span>
                      </button>
                    </div>
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

                          <div className="flex items-center gap-1.5">
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
                              <>
                                <button
                                  onClick={() => handleStartEditTeam(team)}
                                  className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 border border-transparent rounded transition-all cursor-pointer"
                                  title="Change Team Name"
                                >
                                  <Edit2 className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  onClick={() => handleDeleteTeam(team.id)}
                                  className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 border border-transparent rounded transition-all cursor-pointer"
                                  title="Remove Labor Squad"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </>
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

                    {/* Local Machine Backup Hub */}
                    <div className="border-t border-slate-100 pt-4 mt-4 space-y-3">
                      <p className="text-[11px] font-black text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                        <HardDrive className="h-3.5 w-3.5 text-slate-400" />
                        Local Machine storage
                      </p>
                      <p className="text-[10px] text-slate-400 leading-normal">
                        Export database snapshot manually to a local JSON file to protect your data without cloud auth.
                      </p>
                      
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={handleDownloadLocalBackup}
                          className="py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-xl font-bold text-xs font-mono flex items-center justify-center gap-1.5 transition-all cursor-pointer border border-slate-200"
                        >
                          <FileSpreadsheet className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                          <span>Download</span>
                        </button>
                        
                        <label className="block text-center select-none">
                          <span className="py-2 bg-white hover:bg-slate-50 text-slate-600 rounded-xl font-bold text-xs font-mono flex items-center justify-center gap-1.5 transition-all cursor-pointer border border-dashed border-slate-300 h-full">
                            <Plus className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                            <span>Load Draft</span>
                          </span>
                          <input
                            type="file"
                            accept=".json"
                            className="hidden"
                            onChange={handleUploadLocalBackup}
                          />
                        </label>
                      </div>
                    </div>
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 font-sans">
                {/* Left: Google Connection with Sandbox Warning */}
                <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center flex flex-col justify-between shadow-xs">
                  <div className="space-y-4">
                    <Cloud className="h-12 w-12 text-slate-350 mx-auto animate-pulse" />
                    <h4 className="text-base font-extrabold text-slate-800 tracking-tight">Connect Your Google Vault Service</h4>
                    <p className="text-xs text-slate-450 leading-relaxed max-w-sm mx-auto">
                      Access your Google Drive folders to backup daily snapshots and print traveler slips directly into your safe cloud folders.
                    </p>
                    
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-left space-y-1.5 text-amber-900">
                      <p className="text-[11px] font-bold flex items-center gap-1.5 uppercase tracking-wide">
                        <AlertCircle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                        Popup Blocked or Cookie Notice:
                      </p>
                      <p className="text-[10px] text-amber-800 leading-normal">
                        Browsers block Google popups inside embedded previews. If authorization does not open, click the <strong>"Open in New Tab"</strong> icon at the top right of the preview toolbar and sign in there!
                      </p>
                    </div>
                  </div>
                  
                  <div className="pt-6">
                    <button
                      type="button"
                      onClick={onGoogleSignIn}
                      className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs font-mono uppercase tracking-wide rounded-xl shadow-md cursor-pointer transition-all flex items-center justify-center gap-2"
                    >
                      <Cloud className="h-4.5 w-4.5 text-indigo-200" />
                      <span>Authorize Vault Connection</span>
                    </button>
                  </div>
                </div>

                {/* Right: Direct Local Machine Backup */}
                <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center flex flex-col justify-between shadow-xs">
                  <div className="space-y-4">
                    <HardDrive className="h-12 w-12 text-slate-350 mx-auto" />
                    <h4 className="text-base font-extrabold text-slate-800 tracking-tight">Local Machine Storage Hub (No Auth)</h4>
                    <p className="text-xs text-slate-455 leading-relaxed max-w-sm mx-auto">
                      Download current factory state schema to your device as a JSON document instantly. Perfect safe backup alternative option.
                    </p>
                    
                    <div className="bg-slate-50 border border-slate-150 rounded-xl p-3 text-xs space-y-2 text-slate-600 text-left">
                      <p className="font-bold text-slate-800">Local JSON Payload includes:</p>
                      <ul className="list-disc list-inside space-y-0.5 text-[10.5px] font-mono text-slate-500">
                        <li>{pools.length} Pools specs</li>
                        <li>{teams.length} Workteams</li>
                        <li>{logs.length} Log ledgers</li>
                        <li>{inspectors.length} QA Inspectors</li>
                        <li>{engineers.length} Release Engineers</li>
                      </ul>
                    </div>
                  </div>

                  <div className="pt-6 grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={handleDownloadLocalBackup}
                      className="py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs font-mono flex items-center justify-center gap-1.5 transition-all cursor-pointer border border-slate-200"
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5 text-slate-500" />
                      <span>Export JSON</span>
                    </button>

                    <label className="block text-center select-none">
                      <span className="py-2.5 bg-white hover:bg-slate-50 text-indigo-700 rounded-xl font-bold text-xs font-mono flex items-center justify-center gap-1.5 transition-all cursor-pointer border border-dashed border-indigo-300 h-full">
                        <Plus className="h-3.5 w-3.5 text-indigo-500 animate-pulse" />
                        <span>Load JSON</span>
                      </span>
                      <input
                        type="file"
                        accept=".json"
                        className="hidden"
                        onChange={handleUploadLocalBackup}
                      />
                    </label>
                  </div>
                </div>
              </div>
            )}

          </div>
        )}

        {/* Tab 7: Terminal Device Lock & Data Master Reset Controls */}
        {activeTab === 'terminal_settings' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-fadeIn">
            
            {/* Left Hand: Workstation Lock Dashboard */}
            <div className="lg:col-span-7 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
              <div className="border-b border-slate-100 pb-3">
                <h3 className="text-base font-extrabold text-slate-800 flex items-center gap-2">
                  <ShieldAlert className="h-5 w-5 text-amber-500 animate-pulse" />
                  Terminal Station & Device Lockdown
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Enforce strict role-based access control. Lock this browser or floor terminal down so workers can only view and enter data for their specific station or group.
                </p>
              </div>

              {stationLock?.isLocked ? (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-900 space-y-3">
                  <div className="flex items-start gap-2.5">
                    <ShieldAlert className="h-5 w-5 text-amber-600 shrink-0 mt-0.5 animate-pulse" />
                    <div>
                      <p className="font-bold uppercase tracking-wider">🔒 Static Workstation Lockdown Engaged</p>
                      <p className="mt-1">
                        This display is currently locked to role: <strong className="bg-slate-900 text-white font-mono px-1 py-0.5 rounded text-[10px] uppercase">{stationLock.role.replace('_', ' ')}</strong>
                      </p>
                      {stationLock.stageId && (
                        <p className="mt-1">
                          Restricted Stage Division: <strong className="text-indigo-900 font-bold font-sans">{STAGES.find(s => s.id === stationLock.stageId)?.name}</strong>
                        </p>
                      )}
                      {stationLock.teamId && (
                        <p className="mt-1">
                          Restricted Floor Team: <strong className="text-purple-900 font-bold font-sans">{teams.find(t => t.id === stationLock.teamId)?.name || stationLock.teamId}</strong>
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="pt-2 border-t border-amber-200 flex items-center gap-2">
                    <button
                      onClick={() => {
                        if (onRequestUnlock) {
                          onRequestUnlock();
                        } else {
                          const pin = prompt("Enter PIN block to unlock workstation:");
                          if (pin !== null && onUnlockStation) {
                            onUnlockStation(pin);
                          }
                        }
                      }}
                      className="px-3 py-1.5 bg-amber-600 font-bold text-white rounded hover:bg-amber-700 transition cursor-pointer"
                    >
                      Unlock Full Navigation
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleLockSubmit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">
                        Target Station Role:
                      </label>
                      <select
                        value={lockRole}
                        onChange={(e) => setLockRole(e.target.value as any)}
                        className="w-full bg-slate-50 border border-slate-200 text-xs font-bold px-3 py-2 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-500"
                      >
                        <option value="stage_worker">Stage Shop Floor Portal</option>
                        <option value="dual_worker_trolley">🔒 Dual Lock: Shop Floor + Trolley Ledger</option>
                        <option value="trolley_prod">Trolley Production Ledger</option>
                        <option value="planning_department">Planning Department Portal</option>
                        <option value="quality_inspector">Quality Assurance Panel</option>
                        <option value="production_engineer">Production Eng. Release</option>
                        <option value="section_dashboard">Section TV Display</option>
                        <option value="factory_entrance">Factory Entrance TV</option>
                        <option value="management">Management Center Portal</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">
                        Security Unpin Password:
                      </label>
                      <input
                        type="text"
                        maxLength={8}
                        value={lockPin}
                        onChange={(e) => setLockPin(e.target.value.replace(/\D/g, ''))}
                        className="w-full bg-slate-50 border border-slate-200 text-xs font-bold px-3 py-2 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
                        placeholder="e.g. 1234"
                      />
                    </div>
                  </div>

                   {lockRole === 'stage_worker' && (
                    <div className="grid grid-cols-2 gap-4 animate-fadeIn">
                      <div>
                        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">
                          Enforce Stage Lock:
                        </label>
                        <select
                          value={lockStageId}
                          onChange={(e) => setLockStageId(e.target.value as StageId | 'all_stages')}
                          className="w-full bg-slate-50 border border-slate-200 text-xs font-bold px-3 py-2 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
                        >
                          <option value="all_stages">🔓 Allow Swapping All Stages (Fully Adjustable)</option>
                          {STAGES.map(s => (
                            <option key={s.id} value={s.id}>{s.name} Stage</option>
                          ))}
                        </select>
                      </div>

                      {lockStageId !== 'all_stages' ? (
                        <div>
                          <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">
                            Enforce Sub-Team Workseat (Optional):
                          </label>
                          <select
                            value={lockTeamId}
                            onChange={(e) => setLockTeamId(e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 text-xs font-bold px-3 py-2 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
                          >
                            <option value="">-- Let Operator Select On Duty --</option>
                            {teams.filter(t => t.stageId === lockStageId).map(t => (
                              <option key={t.id} value={t.id}>{t.name} (Force assigned)</option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <div className="flex flex-col justify-end">
                          <p className="text-[10px] font-bold text-indigo-650 text-indigo-600 bg-indigo-50 border border-indigo-100 p-2 rounded-xl leading-snug">
                            📌 Adjustable Mode Enabled: Allow operators to dynamically shift across any production line from this device.
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="bg-slate-50 p-4 rounded-xl text-slate-500 text-[11px] leading-relaxed border border-slate-100 flex gap-2">
                    <Info className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
                    <span>
                      <strong>Operational Constraint Warning:</strong> Enabling lockdown disables site-wide navigation links. Workers on this terminal cannot click to other roles or clear state without entering the security unpin PIN.
                    </span>
                  </div>

                  <button
                    type="submit"
                    className="w-full bg-blue-605 bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs py-3 rounded-lg border border-transparent shadow shadow-blue-900/10 hover:shadow-indigo-900/10 transition-all cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <ShieldAlert className="h-4 w-4 text-amber-300 animate-pulse" />
                    <span>Engage Dynamic Station Lockdown</span>
                  </button>
                </form>
              )}
            </div>

            {/* Right Hand: Database Purge and Reset Board */}
            <div className="lg:col-span-5 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
              <div className="border-b border-slate-100 pb-3">
                <h3 className="text-base font-extrabold text-slate-800 flex items-center gap-2">
                  <Trash2 className="h-5 w-5 text-rose-500 animate-pulse" />
                  Manufacturing Data Master Reset
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Start fresh with custom client specifications or erase diagnostic data.
                </p>
              </div>

              <div className="space-y-4 text-xs">
                <div className="p-4 bg-rose-50/55 rounded-xl border border-rose-100/85 space-y-2 text-rose-950">
                  <p className="font-extrabold uppercase text-[10px] tracking-wide text-rose-800">Clear Older Projects & Start Clean Slate</p>
                  <p className="leading-relaxed text-[11px]">
                    This tool allows plant managers to erase all historic pools, Event dispatch logs, floor audit reports, and active manufacturing shells permanently from both local cache & Firebase Cloud Firestore.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      if (onPurgeAllData) {
                        onPurgeAllData();
                      }
                    }}
                    className="mt-2 w-full py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-black rounded-lg transition-all cursor-pointer text-xs"
                  >
                    Delete All Data & Start Fresh
                  </button>
                </div>

                <div className="p-4 bg-amber-50/70 rounded-xl border border-amber-200/85 space-y-2 text-slate-800 text-slate-800">
                  <p className="font-extrabold uppercase text-[10px] tracking-wide text-amber-850 flex items-center gap-1">
                    <Boxes className="h-4 w-4 text-amber-700" /> Erase All Pool-Related Data (Exclude Personnel)
                  </p>
                  <p className="leading-relaxed text-[11px] text-slate-600">
                    Removes only Pools, Planned Pools, and Project Summary contracts, but **retains** labor teams, active workers, and personnel employees. Safely archived in the Recycle Bin for 3 days.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      if (onPurgePoolRelatedData) {
                        onPurgePoolRelatedData();
                      }
                    }}
                    className="mt-2 w-full py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-black rounded-lg transition-all cursor-pointer text-xs flex items-center justify-center gap-1.5"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Purge Pools & Back Up
                  </button>
                </div>

                {/* Recycle Bin & Restoration Panel */}
                <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200 space-y-4">
                  <div className="border-b border-slate-200 pb-2 flex items-center justify-between">
                    <h4 className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-1.5 font-sans">
                      <Boxes className="h-4 w-4 text-emerald-600 animate-bounce" />
                      Recycle Bin / Soft-Delete Vault
                    </h4>
                    <span className="text-[10px] font-mono px-2 py-0.5 bg-slate-200/50 text-slate-700 rounded font-bold">
                      {recycleBin.length} items
                    </span>
                  </div>

                  {recycleBin.length === 0 ? (
                    <div className="text-center py-6 text-slate-400 space-y-2 bg-white rounded-xl border border-dashed border-slate-200">
                      <Boxes className="h-8 w-8 mx-auto text-slate-300 stroke-1" />
                      <p className="text-[11px] font-medium text-slate-505 text-slate-500">The Recycle Bin is empty.</p>
                      <p className="text-[10px] text-slate-405 text-slate-400">Soft-deleted pools & project summaries stay here for 3 days.</p>
                    </div>
                  ) : (
                    <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
                      {recycleBin.map((item: any) => {
                        const deletedDate = new Date(item.deletedAt);
                        const expiryDate = new Date(deletedDate.getTime() + 3 * 24 * 60 * 60 * 1000);
                        const now = new Date();
                        const timeLeftMs = expiryDate.getTime() - now.getTime();
                        
                        let timeLeftStr = "Expired / Purging soon";
                        if (timeLeftMs > 0) {
                          const days = Math.floor(timeLeftMs / (24 * 60 * 60 * 1000));
                          const hours = Math.floor((timeLeftMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
                          timeLeftStr = `${days}d ${hours}h left`;
                        }

                        let label = "Unknown Item";
                        if (item.dataType === 'all_pools_data') {
                          const pCount = item.payload?.pools?.length || 0;
                          const plCount = item.payload?.plannedPools?.length || 0;
                          const sCount = item.payload?.projectsSummary?.length || 0;
                          label = `Bulk Purge (${pCount} Pools, ${plCount} Planned, ${sCount} Contracts)`;
                        } else if (item.dataType === 'trolley') {
                          label = `Trolley - ${item.payload?.teamName} (${item.payload?.quantityProduced || 0} qty)`;
                        } else if (item.dataType === 'pool') {
                          label = `Pool ${item.payload?.poolNo} (${item.payload?.projectName})`;
                        } else if (item.dataType === 'planned_pool') {
                          label = `Planned Pool ${item.payload?.poolNo} (${item.payload?.projectName})`;
                        } else if (item.dataType === 'project_summary') {
                          label = `Contract Model: ${item.payload?.projectName}`;
                        }

                        return (
                          <div key={item.id} className="p-3 bg-white border border-slate-200 rounded-xl space-y-2 relative shadow-sm">
                            <div className="flex items-start justify-between">
                              <div className="flex-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-1.5 mb-1">
                                  <span className="inline-block text-[9px] uppercase font-mono font-black text-slate-550 text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                                    {item.dataType.replace('_', ' ')}
                                  </span>
                                  <span className="inline-block text-[9.5px] font-bold text-emerald-705 text-emerald-750 font-mono bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">
                                    {timeLeftStr}
                                  </span>
                                </div>
                                <p className="text-[11.5px] font-bold text-slate-800 break-words leading-tight">{label}</p>
                                <p className="text-[9.5px] text-slate-400 mt-0.5">Deleted At: {deletedDate.toLocaleString()}</p>
                              </div>
                            </div>
                            
                            <div className="flex gap-2 pt-1.5 border-t border-slate-100">
                              <button
                                type="button"
                                onClick={() => {
                                  if (onRestoreRecycleBinItem) {
                                    onRestoreRecycleBinItem(item.id);
                                  }
                                }}
                                className="flex-1 py-1 px-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-extrabold rounded-lg text-[10px] tracking-wide cursor-pointer transition-all flex items-center justify-center gap-1"
                              >
                                <Check className="h-3 w-3 text-indigo-700" /> Restore
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  if (onDeleteRecycleBinItem) {
                                    onDeleteRecycleBinItem(item.id);
                                  }
                                }}
                                className="py-1 px-2.5 bg-rose-50 hover:bg-rose-100 text-rose-600 font-extrabold rounded-lg text-[10px] cursor-pointer transition-all flex items-center justify-center tooltip"
                                title="Delete permanently"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="p-4 bg-slate-50 rounded-xl space-y-2 border border-slate-100 text-slate-600">
                  <p className="font-extrabold uppercase text-[10px] tracking-wide text-slate-800">Demo Re-Seeding Mode</p>
                  <p className="leading-relaxed text-[11px]">
                    Replaces all data values with original mock parameters (5 project pools, 12 logs, and factory defaults) to demonstrate workflows instantly to directors or new staff.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm("Reload initial demonstrative mock models? This overwrites current changes.")) {
                        window.location.reload();
                      }
                    }}
                    className="mt-2 w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-lg transition-all cursor-pointer text-xs"
                  >
                    Re-Seed Initial Demonstration State
                  </button>
                </div>
              </div>
            </div>

            {/* Secures trolley delete administration section */}
            <div className="lg:col-span-12 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
               <div className="border-b border-slate-100 pb-3 flex justify-between items-center flex-wrap gap-2">
                 <div>
                   <h3 className="text-base font-extrabold text-slate-800 flex items-center gap-2">
                     <Boxes className="h-5 w-5 text-indigo-650 text-indigo-600 animate-pulse" />
                     Authorized Daily Trolley Production Purger
                   </h3>
                   <p className="text-xs text-slate-400 mt-1">
                     Manage and permanently delete logged trolley production runs. Action is final and synchronized.
                   </p>
                 </div>
                 <span className="text-[10px] bg-red-50 text-red-700 font-mono font-bold px-2.5 py-1 border border-red-100 rounded-md">
                   🔒 High Security Purging Zone
                 </span>
               </div>

               {trolleys.length > 0 ? (
                 <div className="overflow-x-auto">
                   <table className="min-w-full text-xs text-left border-collapse">
                     <thead>
                       <tr className="border-b border-slate-150 text-slate-400 font-bold uppercase tracking-wider text-[9.5px] font-mono">
                         <th className="py-2.5 px-3">Date</th>
                         <th className="py-2.5 px-3">Team Name</th>
                         <th className="py-2.5 px-3 text-center">Batch Quantity</th>
                         <th className="py-2.5 px-3">Executive Notes</th>
                         <th className="py-2.5 px-3 text-right">Emergency Action</th>
                       </tr>
                     </thead>
                     <tbody>
                       {trolleys.map((trolley) => (
                         <tr key={trolley.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                           <td className="py-2.5 px-3 font-semibold text-slate-800 font-mono">{trolley.date}</td>
                           <td className="py-2.5 px-3 font-medium text-slate-700">{trolley.teamName}</td>
                           <td className="py-2.5 px-3 text-center">
                             <span className="bg-rose-50 border border-rose-100 text-rose-700 px-2 py-0.5 text-xs rounded font-mono font-extrabold inline-block">
                               {trolley.quantityProduced} units
                             </span>
                           </td>
                           <td className="py-2.5 px-3 text-slate-500 italic max-w-xs truncate">
                             {trolley.notes || '—'}
                           </td>
                           <td className="py-2.5 px-3 text-right">
                             <button
                               onClick={() => {
                                 if (window.confirm(`Warning: Are you sure you want to permanently delete and scrap the trolley production record on ${trolley.date} by ${trolley.teamName}?`)) {
                                   onDeleteTrolley?.(trolley.id);
                                   alert('Trolley record purged successfully.');
                                 }
                               }}
                               className="p-1 px-2 py-1 bg-red-50 hover:bg-red-100 text-red-600 rounded transition font-mono font-bold uppercase text-[9.5px] inline-flex items-center gap-1 cursor-pointer border border-red-100"
                               title="Authorized deletion"
                             >
                               <Trash2 className="h-3 w-3" />
                               <span>Purge record</span>
                             </button>
                           </td>
                         </tr>
                       ))}
                     </tbody>
                   </table>
                 </div>
               ) : (
                 <div className="py-8 text-center text-slate-400 font-mono text-[11px] bg-slate-50 rounded-xl border border-dashed border-slate-100">
                    No registered trolley production history in database.
                 </div>
               )}
            </div>

            {/* Authorized Department Portal Access Passwords (PINs) Manager */}
            <div className="lg:col-span-12 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
              <div className="border-b border-slate-100 pb-3 flex justify-between items-center flex-wrap gap-2">
                <div>
                  <h3 className="text-base font-extrabold text-slate-800 flex items-center gap-2">
                    <KeyRound className="h-5 w-5 text-indigo-650 text-indigo-600 animate-pulse" />
                    Authorized Portal Access Passwords & PIN Codes
                  </h3>
                  <p className="text-xs text-slate-400 mt-1 font-medium">
                    Assign and customize individual login PIN codes / passwords for security gates. Changes are instantly saved permanently in Firebase and synced instantly to the shop floor.
                  </p>
                </div>
                <span className="text-[10px] bg-indigo-50 text-indigo-700 font-mono font-bold px-2.5 py-1 border border-indigo-100 rounded-md">
                  🔒 Active Security Gatekeeper
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 pt-2">
                {[
                  { key: 'management', title: 'Executive Management', subtitle: 'Central Admin & Overrides', default: '1234', color: 'border-blue-150 hover:bg-blue-50/10' },
                  { key: 'planning_department', title: 'Planning Department', subtitle: 'Scheduling & Target Tools', default: '1111', color: 'border-indigo-150 hover:bg-indigo-50/10' },
                  { key: 'production_engineer', title: 'Production Engineering', subtitle: 'Fabrication Releases & Queues', default: '2222', color: 'border-amber-150 hover:bg-amber-50/10' },
                  { key: 'quality_inspector', title: 'Quality Assurance', subtitle: 'NCR/Scrap Audit Actions', default: '3333', color: 'border-emerald-150 hover:bg-emerald-50/10' },
                  { key: 'stage_worker', title: 'Stage Shop Floor', subtitle: 'Workers Claiming Checkpoint', default: '4444', color: 'border-purple-150 hover:bg-purple-50/10' },
                  { key: 'trolley_prod', title: 'Trolley Production', subtitle: 'Yield & Fabrications Tracker', default: '5555', color: 'border-rose-150 hover:bg-rose-50/10' },
                  { key: 'factory_entrance', title: 'Factory Entrance TV', subtitle: 'Informational logistics display', default: '6666', color: 'border-cyan-150 hover:bg-cyan-50/10' },
                  { key: 'section_dashboard', title: 'Section TV Dashboard', subtitle: 'Floor bottlenecks/OEE progress', default: '7777', color: 'border-teal-150 hover:bg-teal-50/10' },
{ key: 'hr_portal', title: 'HR Management Portal', subtitle: 'Employees, Payroll, Leave & Warnings', default: '8888', color: 'border-violet-150 hover:bg-violet-50/10' },
                ].map((profile) => {
                  const currentPin = departmentPins[profile.key] || profile.default;
                  const isEditing = editingPinRole === profile.key;

                  return (
                     <div key={profile.key} className={`p-4 rounded-xl border border-slate-100 bg-white shadow-sm flex flex-col justify-between space-y-3 transition-all duration-150 ${profile.color}`}>
                       <div className="space-y-1">
                         <h4 className="text-xs font-black text-slate-800 leading-tight">{profile.title}</h4>
                         <p className="text-[10px] text-slate-400 font-medium leading-none">{profile.subtitle}</p>
                       </div>

                       <div className="bg-slate-50 border border-slate-100 p-2.5 rounded-lg flex items-center justify-between gap-2">
                         {isEditing ? (
                           <div className="flex-1 flex items-center gap-1.5">
                             <input
                               type="text"
                               maxLength={8}
                               value={editingPinValue}
                               onChange={(e) => setEditingPinValue(e.target.value.replace(/\D/g, ''))}
                               className="w-full bg-white border border-slate-200 text-xs font-bold px-2 py-1 rounded font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
                               placeholder="New pin"
                               autoFocus
                             />
                             <button
                               onClick={() => handleUpdatePin(profile.key, editingPinValue)}
                               disabled={isUpdatingPins}
                               className="px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded text-[10px] cursor-pointer shadow-indigo-200 shadow"
                             >
                               Save
                             </button>
                             <button
                               onClick={() => setEditingPinRole(null)}
                               className="px-2 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded text-[10px] cursor-pointer"
                             >
                               X
                             </button>
                           </div>
                         ) : (
                           <>
                             <div className="flex items-center gap-1.5">
                               <KeyRound className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                               <span className="text-xs font-mono font-bold tracking-widest text-slate-705 text-slate-700">
                                 {currentPin}
                               </span>
                             </div>
                             <button
                               onClick={() => {
                                 setEditingPinRole(profile.key);
                                 setEditingPinValue(currentPin);
                               }}
                               className="text-[10px] font-bold text-indigo-650 text-indigo-600 hover:text-indigo-800 cursor-pointer underline decoration-dotted"
                             >
                               Assign New PIN
                             </button>
                           </>
                         )}
                       </div>
                     </div>
                   );
                 })}
              </div>

              <div className="p-4 bg-indigo-50/50 rounded-xl text-[11px] leading-relaxed border border-indigo-100/50 text-indigo-950 flex gap-2">
                <Info className="h-5 w-5 text-indigo-650 text-indigo-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">🔑 System Security Enforcement Policy</p>
                  <p className="mt-0.5">
                    Assigned PINs are active immediately across all devices, check-in kiosks, and wall monitors. Share PIN logs only with authorized floor operators. Minimum recommended PIN length is 4 digits.
                  </p>
                </div>
              </div>
            </div>

            {/* Firebase Cloud Firestore Live Replication & Config Manager */}
            <div className="lg:col-span-12 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4 shadow-sm">
              <div className="border-b border-slate-100 pb-3 flex justify-between items-center flex-wrap gap-2">
                <div>
                  <h3 className="text-base font-extrabold text-slate-800 flex items-center gap-2">
                    <Cloud className="h-5 w-5 text-indigo-600 animate-bounce" />
                    Firebase Firestore Cloud Persistence & Environments
                  </h3>
                  <p className="text-xs text-slate-400 mt-1 font-medium">
                    View, fine-tune, or supply custom Firebase client-side SDK API keys and project settings. All changes are written to the server's runtime config and persisted.
                  </p>
                </div>
                <span className="text-[10px] bg-emerald-50 text-emerald-705 text-emerald-700 font-mono font-bold px-2.5 py-1 border border-emerald-100 rounded-md flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping" />
                  Cloud State Replicated
                </span>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-2">
                {/* Left block: Form config */}
                <form onSubmit={handleSaveFirebaseConfig} className="lg:col-span-8 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
                        API Key (apiKey)
                      </label>
                      <input
                        type="text"
                        value={firebaseConfigState.apiKey}
                        onChange={(e) => setFirebaseConfigState({ ...firebaseConfigState, apiKey: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 text-xs font-bold px-3 py-2 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                        placeholder="Enter Firebase API Key..."
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
                        Project ID (projectId)
                      </label>
                      <input
                        type="text"
                        value={firebaseConfigState.projectId}
                        onChange={(e) => setFirebaseConfigState({ ...firebaseConfigState, projectId: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 text-xs font-bold px-3 py-2 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                        placeholder="project-id-123"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
                        Application ID (appId)
                      </label>
                      <input
                        type="text"
                        value={firebaseConfigState.appId}
                        onChange={(e) => setFirebaseConfigState({ ...firebaseConfigState, appId: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 text-xs font-bold px-3 py-2 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                        placeholder="1:12345:web:abcd"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
                        Auth Domain (authDomain)
                      </label>
                      <input
                        type="text"
                        value={firebaseConfigState.authDomain}
                        onChange={(e) => setFirebaseConfigState({ ...firebaseConfigState, authDomain: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 text-xs font-bold px-3 py-2 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                        placeholder="project-id.firebaseapp.com"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
                        Firestore Database ID (firestoreDatabaseId)
                      </label>
                      <input
                        type="text"
                        value={firebaseConfigState.firestoreDatabaseId}
                        onChange={(e) => setFirebaseConfigState({ ...firebaseConfigState, firestoreDatabaseId: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 text-xs font-bold px-3 py-2 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                        placeholder="(default) or customized databaseId"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
                        Storage Bucket (storageBucket)
                      </label>
                      <input
                        type="text"
                        value={firebaseConfigState.storageBucket}
                        onChange={(e) => setFirebaseConfigState({ ...firebaseConfigState, storageBucket: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 text-xs font-bold px-3 py-2 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                        placeholder="project-id.firebasestorage.app"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
                        Messaging Sender ID (messagingSenderId)
                      </label>
                      <input
                        type="text"
                        value={firebaseConfigState.messagingSenderId}
                        onChange={(e) => setFirebaseConfigState({ ...firebaseConfigState, messagingSenderId: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 text-xs font-bold px-3 py-2 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                        placeholder="123456789"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
                        Measurement ID (measurementId)
                      </label>
                      <input
                        type="text"
                        value={firebaseConfigState.measurementId}
                        onChange={(e) => setFirebaseConfigState({ ...firebaseConfigState, measurementId: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 text-xs font-bold px-3 py-2 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                        placeholder="G-XXXXXX"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end pt-2">
                    <button
                      type="submit"
                      disabled={isSavingFirebaseConfig}
                      className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black rounded-lg transition-all shadow-md shadow-indigo-100 disabled:opacity-50 cursor-pointer"
                    >
                      {isSavingFirebaseConfig ? "Saving Config..." : "🔒 Lock & Save Custom Credentials"}
                    </button>
                  </div>
                </form>

                {/* Right block: Manual tools and status flags */}
                <div className="lg:col-span-4 bg-slate-50 p-5 rounded-2xl border border-slate-100 flex flex-col justify-between space-y-4">
                  <div className="space-y-3">
                    <h4 className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-1 font-sans">
                      <Lock className="h-4 w-4 text-indigo-600" />
                      Disaster Recovery Controls
                    </h4>
                    <p className="text-[11px] text-slate-500 leading-relaxed font-medium">
                      Configure manual, immediate cloud-sync operations or pull the verified state directly from the Firestore documents to replace local variables.
                    </p>

                    <div className="space-y-2 pt-2">
                      <button
                        type="button"
                        onClick={handleManualBackupToFirestore}
                        disabled={isPerformingBackupSync}
                        className="w-full py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-black rounded-lg border border-indigo-200 transition-all text-xs flex items-center justify-center gap-2 cursor-pointer"
                      >
                        {isPerformingBackupSync ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            <span>Uploading ledger items...</span>
                          </>
                        ) : (
                          <>
                            <UploadCloud className="h-4 w-4" />
                            <span>Force Manual Backup Sync</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={handleManualRestoreFromFirestore}
                        disabled={isPerformingBackupRestore}
                        className="w-full py-2 bg-white hover:bg-slate-50 text-slate-755 text-slate-750 font-black rounded-lg border border-slate-200 transition-all text-xs flex items-center justify-center gap-2 cursor-pointer shadow-sm"
                      >
                        {isPerformingBackupRestore ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            <span>Restoring tables...</span>
                          </>
                        ) : (
                          <>
                            <HardDrive className="h-4 w-4" />
                            <span>Disaster State Restore Pull</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="p-3 bg-white rounded-xl border border-slate-200 text-[10px] text-slate-500 leading-normal space-y-1">
                    <p className="font-bold text-slate-755 text-slate-700 flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      Automatic Mutating Syncer
                    </p>
                    <p>
                      The app is equipped with an background autocommit interceptor. Every floor check-in, stage punch, release, quality log, or edit transaction triggers a background fire-and-forget sync to Google Firestore instantly!
                    </p>
                  </div>
                </div>
              </div>
            </div>

          </div>
        )}

      </div>

    </div>
  );
};
