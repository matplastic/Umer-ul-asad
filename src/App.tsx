import React, { useState, useEffect, useRef } from 'react';
import { Pool, StageId, Team, ActivityLog, ViewRole, PoolOrientation, PlannedPool, ProjectSummary, MonthlyTarget, Employee, TrolleyProduction, RecycleBinItem, EmployeePunch } from './types';
import StoreModule from './components/StoreModule';
import { ScrollButtons } from './components/ScrollButtons';
import SupervisorPortal from './components/SupervisorPortal';
import { STAGES, DUAL_STAGE_IDS, isAtDualStageGate, getInitialData, createEmptyHistory } from './data/mockData';
import { RoleSelector, RoleContextPanel, TopBar } from './components/RoleSelector';
import { LoginScreen } from './components/LoginScreen';
import { getStoredUser, logout as logoutUser, type AuthUser } from './lib/authClient';
import { ProductionEngineer } from './components/ProductionEngineer';
import { StageDashboard } from './components/StageDashboard';
import { QualityInspector } from './components/QualityInspector';
import { FactoryEntrance } from './components/FactoryEntrance';
import { ManagementDashboard } from './components/ManagementDashboard';
import { SectionDashboardTV } from './components/SectionDashboardTV';
import { PlanningDepartment } from './components/PlanningDepartment';
import { TrolleyProductionTracker } from './components/TrolleyProductionTracker';
import { HRPortal } from './components/HRPortal';
import { ReportsAndAnalytics } from './components/ReportsAndAnalytics';
import { QRScanner } from './components/QRCodeModule';
import { QCDefect } from './components/QCDefectPanel';
import { Info, RotateCcw, AlertCircle, HelpCircle, Wifi, WifiOff, RefreshCw, ShieldAlert, CheckCircle2, X, Camera } from 'lucide-react';
import { initAuth, googleSignIn, googleSignInRedirect, googleSignOut, checkRedirectResult } from './lib/googleDrive';
import { 
  getEntireStateFromFirestore, 
  saveEntireStateToFirestore,
  saveChangedCollectionsToFirestore,
  wipeAllCollectionsFromFirestore,
  getLiveStateFromFirestore,
  dbSaveProjectSummary,
  dbDeleteProjectSummary,
  dbSaveMonthlyTarget,
  dbDeleteMonthlyTarget,
  dbSaveEmployee,
  dbDeleteEmployee,
  dbSaveTrolley,
  dbDeleteTrolley,
  dbAddRecycleBin,
  dbDeleteRecycleBin,
  dbRestoreRecycleBin,
  dbPurgePoolRelatedData,
  dbDeletePool,
  dbSavePlannedPool,
  dbDeletePlannedPool,
  dbSaveEmployeePunch,
  dbDeleteEmployeePunch,
  dbSaveEmployeePunchesBulk,
  dbSaveEmployeesBulk,
  dbClearAllEmployeePunches,
  dbDeleteEmployeePunchesByDate,
  dbSyncBioCloudPunches,
  dbSaveInspector,
  dbSaveEngineer,
  dbDeleteInspector,
  dbDeleteEngineer,
  dbSaveTeam,
  dbSaveLog,
  dbSavePool,
  subscribeToLiveState,
  flushPendingCloudWrites
} from './lib/firebaseService';

// BUGFIX (v3 — data loss): previous build seeded 3 demo inspectors and 2 demo
// engineers on every fresh device. They kept reappearing as "ghost demo data".
// User reported losing real data because of this. Demo inspectors/engineers
// are now permanently disabled. Use the "Roles" tab in the Planning Portal
// to add real inspectors and engineers.
const DEFAULT_INSPECTORS: { id: string; name: string; title: string }[] = [];
const DEFAULT_ENGINEERS: { id: string; name: string; title: string }[] = [];

const DEFAULT_PROJECTS_SUMMARY: ProjectSummary[] = [];

const DEFAULT_MONTHLY_TARGETS: MonthlyTarget[] = [];

// BUGFIX: previously this list contained demo employees (John Doe, Alba Vance,
// Marcus Chen, Sarah Jenkins) that kept reappearing as "demo data" after the
// user wiped the database. Demo employees are now permanently disabled — the
// HR portal starts empty until real employees are added.
const DEFAULT_EMPLOYEES: Employee[] = [];

export default function App() {
  const [pools, setPoolsRaw] = useState<Pool[]>([]);
  const [teams, setTeamsRaw] = useState<Team[]>([]);
  const [logs, setLogsRaw] = useState<ActivityLog[]>([]);
  const [inspectors, setInspectorsRaw] = useState<{ id: string; name: string; title: string }[]>([]);
  const [engineers, setEngineersRaw] = useState<{ id: string; name: string; title: string }[]>([]);
  const [projectsSummary, setProjectsSummaryRaw] = useState<ProjectSummary[]>(() => {
    const raw = localStorage.getItem('apex_projects_summary');
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch (e) {}
    }
    return DEFAULT_PROJECTS_SUMMARY;
  });
  const [monthlyTargets, setMonthlyTargetsRaw] = useState<MonthlyTarget[]>(() => {
    const raw = localStorage.getItem('apex_monthly_targets');
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch (e) {}
    }
    return DEFAULT_MONTHLY_TARGETS;
  });
  const [plannedPools, setPlannedPoolsRaw] = useState<PlannedPool[]>(() => {
    const raw = localStorage.getItem('apex_planned_pools');
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch (e) {}
    }
    return [];
  });
  const [employees, setEmployeesRaw] = useState<Employee[]>(() => {
    const raw = localStorage.getItem('apex_employees');
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch (e) {}
    }
    return DEFAULT_EMPLOYEES;
  });

  // ─────────────────────────────────────────────────────────────────────────
  // RACE-FIX (v9): stale-closure protection for rapid back-to-back actions.
  //
  // THE BUG: every handler below builds its update like:
  //   const updatedPools = [...pools]; ...mutate...; setPools(updatedPools);
  // `pools` here is a plain variable captured by THIS render's closure. If a
  // second action (e.g. clearing pool 33 right after clearing pool 22) fires
  // before React has finished re-rendering from the first action — very
  // possible on a heavy screen (StageDashboard/ManagementDashboard are huge)
  // or a slower factory PC — the second handler is still bound to the OLD
  // closure, so its `pools` does NOT yet contain the first action's change.
  // Its `setPools(...)` call then overwrites the first change entirely
  // (last setState wins), which is exactly the "approve pool 22, approve
  // pool 33, pool 22 reverts / needs re-clearing" symptom.
  //
  // THE FIX: keep a ref that is updated SYNCHRONOUSLY the instant any change
  // happens (not waiting on a re-render), and wrap each setter so every
  // existing `setPools(x)` call site keeps working unchanged while also
  // updating the ref. Handlers then read `poolsRef.current` (via a one-line
  // shadow at the top of each handler) instead of the render-closure `pools`,
  // so the very next click — even mid-render — always sees the latest data.
  // ─────────────────────────────────────────────────────────────────────────
  const poolsRef = useRef<Pool[]>(pools);
  const teamsRef = useRef<Team[]>(teams);
  const logsRef = useRef<ActivityLog[]>(logs);
  const inspectorsRef = useRef<{ id: string; name: string; title: string }[]>(inspectors);
  const engineersRef = useRef<{ id: string; name: string; title: string }[]>(engineers);
  const projectsSummaryRef = useRef<ProjectSummary[]>(projectsSummary);
  const monthlyTargetsRef = useRef<MonthlyTarget[]>(monthlyTargets);
  const plannedPoolsRef = useRef<PlannedPool[]>(plannedPools);
  const employeesRef = useRef<Employee[]>(employees);

  function makeRaceSafeSetter<T>(
    ref: React.MutableRefObject<T[]>,
    rawSetter: React.Dispatch<React.SetStateAction<T[]>>
  ) {
    return (updater: T[] | ((prev: T[]) => T[])) => {
      // IMPORTANT: compute off ref.current (always the latest value) and
      // write ref.current SYNCHRONOUSLY, right here — not inside React's
      // setState updater callback, which only runs later during React's
      // render phase and would reopen the exact race this is meant to close.
      const next = typeof updater === 'function' ? (updater as (p: T[]) => T[])(ref.current) : updater;
      ref.current = next;
      rawSetter(next);
    };
  }

  const setPools = makeRaceSafeSetter(poolsRef, setPoolsRaw);
  const setTeams = makeRaceSafeSetter(teamsRef, setTeamsRaw);
  const setLogs = makeRaceSafeSetter(logsRef, setLogsRaw);
  const setInspectors = makeRaceSafeSetter(inspectorsRef, setInspectorsRaw);
  const setEngineers = makeRaceSafeSetter(engineersRef, setEngineersRaw);
  const setProjectsSummary = makeRaceSafeSetter(projectsSummaryRef, setProjectsSummaryRaw);
  const setMonthlyTargets = makeRaceSafeSetter(monthlyTargetsRef, setMonthlyTargetsRaw);
  const setPlannedPools = makeRaceSafeSetter(plannedPoolsRef, setPlannedPoolsRaw);
  const setEmployees = makeRaceSafeSetter(employeesRef, setEmployeesRaw);

  const [trolleys, setTrolleys] = useState<TrolleyProduction[]>(() => {
    const raw = localStorage.getItem('apex_trolleys');
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch (e) {}
    }
    return [];
  });

  const [recycleBin, setRecycleBin] = useState<RecycleBinItem[]>([]);

  // ── QC Defects — logged per stage per pool by Quality Inspectors ──────────
  const [qcDefects, setQcDefects] = useState<QCDefect[]>(() => {
    try { return JSON.parse(localStorage.getItem('apex_qc_defects') || '[]'); } catch { return []; }
  });

  // Undo claim requests from shop floor workers
  const [pendingUndoRequests, setPendingUndoRequests] = useState<{
    id: string;
    poolId: string;
    poolNo: string;
    projectName: string;
    stageId: string;
    stageName: string;
    teamName: string;
    reason: string;
    requestedAt: string;
  }[]>(() => {
    try { return JSON.parse(localStorage.getItem('pending_undo_requests') || '[]'); } catch { return []; }
  });

  // Employee machine punch records storage
  const [employeePunches, setEmployeePunches] = useState<EmployeePunch[]>(() => {
    const raw = localStorage.getItem('apex_employee_punches');
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch (e) {}
    }
    return [];
  });

  // Google Drive integration states
  const [googleUser, setGoogleUser] = useState<any>(null);
  const [authNotification, setAuthNotification] = useState<{ title: string; message: string; type: 'info' | 'error' | 'success'; isAuthError?: boolean } | null>(null);

  // Station terminal lock state
  const [stationLock, setStationLock] = useState<{
    isLocked: boolean;
    role: ViewRole;
    stageId: StageId | null;
    teamId: string | null;
    pin: string;
    allowedRoles?: ViewRole[];
  }>(() => {
    const raw = localStorage.getItem('apex_station_lock');
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch (e) {
        // ignore
      }
    }
    return {
      isLocked: false,
      role: 'management',
      stageId: null,
      teamId: null,
      pin: '1234',
      allowedRoles: []
    };
  });

  // Simulation controls
  // Portal drawer visibility — the hamburger button in TopBar toggles this.
  // Closed by default so the current portal has the full screen; opening it
  // shows the RoleSelector as a slide-in drawer instead of a permanent sidebar.
  const [navOpen, setNavOpen] = useState(false);
  const [currentRole, setCurrentRole] = useState<ViewRole>(() => {
    // First: check if station is locked — that takes priority
    const lockRaw = localStorage.getItem('apex_station_lock');
    if (lockRaw) {
      try {
        const parsed = JSON.parse(lockRaw);
        if (parsed.isLocked) return parsed.role;
      } catch (e) {}
    }
    // Second: restore the role from the logged-in user session (fixes refresh bug)
    const userRaw = localStorage.getItem('apex_logged_in_user');
    if (userRaw) {
      try {
        const parsed = JSON.parse(userRaw);
        if (parsed?.role) return parsed.role;
      } catch (e) {}
    }
    return 'management';
  });
  const [selectedStageId, setSelectedStageId] = useState<StageId>(() => {
    const raw = localStorage.getItem('apex_station_lock');
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed.isLocked && parsed.stageId) return parsed.stageId;
      } catch (e) {}
    }
    return 'steel_fabrication';
  });
  const [workerTeamId, setWorkerTeamId] = useState<string>(() => {
    const raw = localStorage.getItem('apex_station_lock');
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed.isLocked && parsed.teamId) return parsed.teamId;
      } catch (e) {}
    }
    return '';
  });

  // Custom non-blocking iframe-safe unlock modal states
  const [isUnlockModalOpen, setIsUnlockModalOpen] = useState(false);
  const [unlockPinInput, setUnlockPinInput] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);

  // QR scanner overlay state (mobile shop-floor quick lookup)
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scannedPoolId, setScannedPoolId] = useState<string | null>(null);

  // Role-Based Access Control State — backed by a real username/password
  // account (see src/lib/authClient.ts), not a shared department PIN.
  const [loggedInUser, setLoggedInUser] = useState<AuthUser | null>(() => getStoredUser());

  const handleLoginSuccess = (user: AuthUser) => {
    setLoggedInUser(user);
    setCurrentRole(user.role);
    if (user.role === 'stage_worker') {
      setSelectedStageId('steel_fabrication');
    }
  };

  const handleLogout = () => {
    setLoggedInUser(null);
    logoutUser();
  };

  // ── Manual cloud refresh (used by Stage Floor & QA portals) ─────────────────
  const [isSyncing, setIsSyncing] = useState(false);
  const refreshFromCloud = async () => {
    setIsSyncing(true);
    try {
      const freshData = await getLiveStateFromFirestore();
      if (freshData) {
        if (freshData.pools) setPools(freshData.pools);
        if (freshData.teams) setTeams(freshData.teams);
        if (freshData.logs) setLogs(freshData.logs);
      }
    } catch (e) {
      console.error('Manual refresh failed:', e);
    } finally {
      setIsSyncing(false);
    }
  };

  // ── Full refresh for Management — pulls ALL data fresh from Firestore ────────
  const [isFullSyncing, setIsFullSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const refreshAllFromCloud = async () => {
    setIsFullSyncing(true);
    try {
      const freshData = await getEntireStateFromFirestore();
      if (freshData) {
        if (freshData.pools) setPools(freshData.pools);
        if (freshData.teams) setTeams(freshData.teams);
        if (freshData.logs) setLogs(freshData.logs);
        if (freshData.inspectors) setInspectors(freshData.inspectors);
        if (freshData.engineers) setEngineers(freshData.engineers);
        if (freshData.plannedPools) setPlannedPools(freshData.plannedPools);
        if (freshData.projectsSummary) setProjectsSummary(freshData.projectsSummary);
        if (freshData.monthlyTargets) setMonthlyTargets(freshData.monthlyTargets);
        if (freshData.employees) setEmployees(freshData.employees);
        if ((freshData as any).trolleys) setTrolleys((freshData as any).trolleys);
        if ((freshData as any).employeePunches) setEmployeePunches((freshData as any).employeePunches);
        if ((freshData as any).recycleBin) setRecycleBin((freshData as any).recycleBin);
        setLastSyncTime(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      }
    } catch (e) {
      console.error('Full refresh failed:', e);
    } finally {
      setIsFullSyncing(false);
    }
  };
  useEffect(() => {
    if (stationLock.isLocked) {
      if (stationLock.allowedRoles && stationLock.allowedRoles.length > 0) {
        if (!stationLock.allowedRoles.includes(currentRole)) {
          setCurrentRole(stationLock.allowedRoles[0]);
        }
      } else {
        setCurrentRole(stationLock.role);
      }
      if (stationLock.stageId) {
        setSelectedStageId(stationLock.stageId);
      }
      if (stationLock.teamId) {
        setWorkerTeamId(stationLock.teamId);
      }
    }
  }, [stationLock]);

  const handleLockStation = (role: ViewRole, stageId: StageId | null, teamId: string | null, pin: string, allowedRoles?: ViewRole[]) => {
    const lockConfig = {
      isLocked: true,
      role,
      stageId,
      teamId,
      pin: pin.trim() || '1234',
      allowedRoles: allowedRoles || [role]
    };
    setStationLock(lockConfig);
    localStorage.setItem('apex_station_lock', JSON.stringify(lockConfig));
    setCurrentRole(role);
    if (stageId) setSelectedStageId(stageId);
    if (teamId) setWorkerTeamId(teamId);
  };

  const handleUnlockStation = (enteredPin: string) => {
    if (enteredPin === stationLock.pin) {
      const unlocked = {
        isLocked: false,
        role: stationLock.role,
        stageId: stationLock.stageId,
        teamId: stationLock.teamId,
        pin: stationLock.pin
      };
      setStationLock(unlocked);
      localStorage.setItem('apex_station_lock', JSON.stringify(unlocked));
      setIsUnlockModalOpen(false);
      setUnlockPinInput('');
      setUnlockError(null);
      return true;
    } else {
      setUnlockError("Incorrect 4-Digit Access PIN. Please try again or use Emergency Bypass.");
      return false;
    }
  };

  const handleEmergencyUnlock = () => {
    const unlocked = {
      isLocked: false,
      role: 'management' as ViewRole,
      stageId: 'steel_fabrication' as StageId,
      teamId: null,
      pin: '1234'
    };
    setStationLock(unlocked);
    localStorage.setItem('apex_station_lock', JSON.stringify(unlocked));
    setCurrentRole('management');
    setSelectedStageId('steel_fabrication');
    setWorkerTeamId('');
    setIsUnlockModalOpen(false);
    setUnlockPinInput('');
    setUnlockError(null);
  };

  // Firebase Integration states
  const [firebaseStatus, setFirebaseStatus] = useState<'idle' | 'linking' | 'connected' | 'error'>('idle');
  const [firebaseError, setFirebaseError] = useState<string | null>(null);
  // DATA-LOSS FIX: block ALL cloud writes until we have successfully loaded
  // the real cloud state at least once. Without this, an action performed
  // right after opening the app (or after a failed load that fell back to an
  // old localStorage copy) would push STALE data to Firestore and wipe
  // everything entered from other devices since this copy was cached.
  const cloudHydratedRef = useRef(false);

  // ─────────────────────────────────────────────────────────────────────────
  // MERGE-SAFETY FIX (v8): "last known good from server" snapshots.
  //
  // WHY THIS EXISTS: several handlers in this file mutate a pool/team object
  // IN PLACE (e.g. `pool.stageHistory[stageId] = ...`) rather than creating a
  // new object. Because `[...pools]` only copies the ARRAY, not the objects
  // inside it, that mutation also changes the object referenced by the
  // OLD `pools` state variable — the same object, aliased. That made it
  // impossible to reliably tell "what did this device actually just change"
  // by comparing the old state to the new state (they're often the same
  // object by the time we look). The v7 fix used the full local array as the
  // "changes to apply" set, which silently reapplied every OTHER pool/team
  // this device happened to have a stale copy of — causing the "approved
  // pool reverts / duplicates / vanishes" regression.
  //
  // THE FIX: keep a separate, deep-cloned snapshot of each collection that is
  // ONLY ever updated when data actually arrives FROM the server (initial
  // load or a live onSnapshot update). Local mutations never touch these
  // refs. Diffing the live state against this untouched snapshot correctly
  // identifies exactly which items this device actually changed, so saves
  // only ever push real changes — never a stale reapply of everything else.
  // ─────────────────────────────────────────────────────────────────────────
  const poolsBaselineRef = useRef<Pool[]>([]);
  const teamsBaselineRef = useRef<Team[]>([]);
  const logsBaselineRef = useRef<ActivityLog[]>([]);
  const inspectorsBaselineRef = useRef<any[]>([]);
  const engineersBaselineRef = useRef<any[]>([]);
  const plannedPoolsBaselineRef = useRef<PlannedPool[]>([]);
  const projectsSummaryBaselineRef = useRef<ProjectSummary[]>([]);
  const monthlyTargetsBaselineRef = useRef<MonthlyTarget[]>([]);
  const employeesBaselineRef = useRef<Employee[]>([]);

  const deepClone = <T,>(arr: T[]): T[] => (arr.length ? JSON.parse(JSON.stringify(arr)) : []);

  // Load state from Firestore & register Auth listener on mount
  useEffect(() => {
    const unsubscribe = initAuth(
      (user, token) => {
        setGoogleUser(user);
      },
      () => {
        setGoogleUser(null);
      }
    );

    // Check if user has just returned from a Google OAuth sign-in redirect flow
    const handleRedirectResult = async () => {
      try {
        const result = await checkRedirectResult();
        if (result) {
          setGoogleUser(result.user);
          setAuthNotification({
            title: "Connection Successful",
            message: "Successfully connected to Google Drive via secure redirect!",
            type: "success"
          });
        }
      } catch (err: any) {
        console.error('Redirect result processing failed:', err);
      }
    };
    handleRedirectResult();

    const loadCloudData = async () => {
      setFirebaseStatus('linking');
      try {
        const cloudData = await getEntireStateFromFirestore();
        // BUGFIX: previous check (`cloudData.pools.length > 0`) caused real
        // data wipe — if the user had employees/plannedPools/projects but
        // pools happened to be empty, the `else` branch ran and overwrote
        // Firestore with DEFAULT demo data. Now we trust the firebaseService
        // `isInitialized` flag (which inspects every collection) and we also
        // double-check here against every collection so demo seeding only
        // ever happens on a completely empty database.
        const anyCloudData =
          (cloudData.pools && cloudData.pools.length > 0) ||
          (cloudData.plannedPools && cloudData.plannedPools.length > 0) ||
          (cloudData.projectsSummary && cloudData.projectsSummary.length > 0) ||
          (cloudData.monthlyTargets && cloudData.monthlyTargets.length > 0) ||
          (cloudData.employees && cloudData.employees.length > 0) ||
          (cloudData.teams && cloudData.teams.length > 0) ||
          (cloudData.logs && cloudData.logs.length > 0) ||
          ((cloudData as any).trolleys && (cloudData as any).trolleys.length > 0) ||
          ((cloudData as any).employeePunches && (cloudData as any).employeePunches.length > 0) ||
          ((cloudData as any).recycleBin && (cloudData as any).recycleBin.length > 0) ||
          (cloudData.inspectors && cloudData.inspectors.length > 0) ||
          (cloudData.engineers && cloudData.engineers.length > 0);

        if ((cloudData as any).isInitialized || anyCloudData) {
          // Cloud has records. Load them!
          setPools(cloudData.pools);
          setTeams(cloudData.teams);
          setLogs(cloudData.logs);
          setInspectors(cloudData.inspectors);
          setEngineers(cloudData.engineers);
          setPlannedPools(cloudData.plannedPools);
          setProjectsSummary(cloudData.projectsSummary);
          setMonthlyTargets(cloudData.monthlyTargets);
          setEmployees(cloudData.employees);
          if ((cloudData as any).trolleys) {
            setTrolleys((cloudData as any).trolleys);
            localStorage.setItem('apex_trolleys', JSON.stringify((cloudData as any).trolleys));
          }
          if ((cloudData as any).recycleBin) {
            setRecycleBin((cloudData as any).recycleBin);
          }
          if ((cloudData as any).employeePunches) {
            setEmployeePunches((cloudData as any).employeePunches);
            localStorage.setItem('apex_employee_punches', JSON.stringify((cloudData as any).employeePunches));
          }

          // Update local backup
          localStorage.setItem('apex_pools', JSON.stringify(cloudData.pools));
          localStorage.setItem('apex_teams', JSON.stringify(cloudData.teams));
          localStorage.setItem('apex_logs', JSON.stringify(cloudData.logs));
          localStorage.setItem('apex_inspectors', JSON.stringify(cloudData.inspectors));
          localStorage.setItem('apex_engineers', JSON.stringify(cloudData.engineers));
          localStorage.setItem('apex_planned_pools', JSON.stringify(cloudData.plannedPools));
          localStorage.setItem('apex_projects_summary', JSON.stringify(cloudData.projectsSummary));
          localStorage.setItem('apex_monthly_targets', JSON.stringify(cloudData.monthlyTargets));
          localStorage.setItem('apex_employees', JSON.stringify(cloudData.employees));

          // Seed the "last known good from server" baselines used for
          // merge-safe diffing (see the v8 fix note above cloudHydratedRef).
          poolsBaselineRef.current = deepClone(cloudData.pools);
          teamsBaselineRef.current = deepClone(cloudData.teams);
          logsBaselineRef.current = deepClone(cloudData.logs);
          inspectorsBaselineRef.current = deepClone(cloudData.inspectors);
          engineersBaselineRef.current = deepClone(cloudData.engineers);
          plannedPoolsBaselineRef.current = deepClone(cloudData.plannedPools);
          projectsSummaryBaselineRef.current = deepClone(cloudData.projectsSummary);
          monthlyTargetsBaselineRef.current = deepClone(cloudData.monthlyTargets);
          employeesBaselineRef.current = deepClone(cloudData.employees);

          cloudHydratedRef.current = true;
          setFirebaseStatus('connected');
        } else {
          // BUGFIX: truly empty database. We now seed ONLY the structural
          // defaults (empty teams skeleton + inspectors/engineers lookup
          // lists) and write the SENTINEL_DB_INITIALIZED marker so that
          // future loads always know the DB is initialized — even when every
          // user-data collection is empty. We DO NOT seed any demo pools,
          // employees, projects, planned-pools or monthly-targets anymore.
          const defaultData = getInitialData(); // returns empty pools/logs + teams skeleton
          await saveEntireStateToFirestore(
            defaultData.pools,        // []
            defaultData.teams,        // teams skeleton (structural, not demo)
            defaultData.logs,         // []
            DEFAULT_INSPECTORS,
            DEFAULT_ENGINEERS,
            defaultData.plannedPools, // []
            DEFAULT_PROJECTS_SUMMARY, // [] — sentinel auto-appended by service
            DEFAULT_MONTHLY_TARGETS,  // []
            DEFAULT_EMPLOYEES         // []
          );
          setPools(defaultData.pools);
          setTeams(defaultData.teams);
          setLogs(defaultData.logs);
          setInspectors(DEFAULT_INSPECTORS);
          setEngineers(DEFAULT_ENGINEERS);
          setPlannedPools(defaultData.plannedPools);
          setProjectsSummary(DEFAULT_PROJECTS_SUMMARY);
          setMonthlyTargets(DEFAULT_MONTHLY_TARGETS);
          setEmployees(DEFAULT_EMPLOYEES);
          localStorage.setItem('apex_planned_pools', JSON.stringify(defaultData.plannedPools));
          localStorage.setItem('apex_projects_summary', JSON.stringify(DEFAULT_PROJECTS_SUMMARY));
          localStorage.setItem('apex_monthly_targets', JSON.stringify(DEFAULT_MONTHLY_TARGETS));
          localStorage.setItem('apex_employees', JSON.stringify(DEFAULT_EMPLOYEES));
          cloudHydratedRef.current = true;
          setFirebaseStatus('connected');
        }
      } catch (err: any) {
        console.error('Firestore connection or permission delay. Falling back to local copy:', err);
        setFirebaseStatus('error');
        setFirebaseError(err?.message || String(err));

        // ─────────────────────────────────────────────────────────────────
        // DATA-LOSS FIX: TEAM DATA WIPE ROOT CAUSE
        //
        // THE OLD BUG: this fallback required pools AND teams AND logs to
        // ALL be cached on THIS device before restoring any of them. If
        // even one was missing (e.g. a PC that hadn't cached apex_teams
        // yet), it fell into the `else` branch below and called
        // setTeams(getInitialData().teams) — which is NOT "keep what you
        // had", it's generateDefaultTeams(): a hardcoded generic list
        // ("Steel Fabrication - Team 1", "Team 2", ...). That silently
        // replaced your real, customized team roster in memory.
        //
        // Normally the live Firestore listener (subscribeToLiveState)
        // would correct this within about a second by pushing the real
        // teams back in. But that listener flips cloudHydratedRef.current
        // to true as soon as ANY collection arrives — not specifically
        // teams. If pools or logs happened to arrive first, saving became
        // "allowed" for a brief window before the real teams data landed.
        // Anything that saved teams during that window (e.g. an open
        // Management tab editing teams) pushed the fake generic list to
        // Firestore for real — permanently, on every device. And because
        // the existing safety guard for teams only checks array LENGTH
        // (not content), the 51-entry generic list sailed right past it
        // as if it were valid data.
        //
        // THE FIX: restore every collection independently from its own
        // cache, exactly like employees/plannedPools/projectsSummary
        // already do below. A missing cache for ONE collection no longer
        // resets ALL of them, and teams is never replaced by a hardcoded
        // generic list on this device — only ever by real cached data.
        // ─────────────────────────────────────────────────────────────────
        const storedPools = localStorage.getItem('apex_pools');
        const storedTeams = localStorage.getItem('apex_teams');
        const storedLogs = localStorage.getItem('apex_logs');
        const storedInspectors = localStorage.getItem('apex_inspectors');
        const storedEngineers = localStorage.getItem('apex_engineers');
        const storedPlannedPools = localStorage.getItem('apex_planned_pools');
        const storedProjectsSummary = localStorage.getItem('apex_projects_summary');
        const storedMonthlyTargets = localStorage.getItem('apex_monthly_targets');

        try {
          if (storedPools) {
            setPools(JSON.parse(storedPools));
          } else {
            setPools([]);
          }
        } catch (e) { console.error('Failed to parse cached pools:', e); }

        try {
          if (storedTeams) {
            setTeams(JSON.parse(storedTeams));
          } else {
            // Only reached if this device has NEVER cached real team data
            // before (true first-ever launch). This seeds the structural
            // skeleton for THIS DEVICE'S DISPLAY ONLY — it is not written
            // to Firestore here, so it can never silently overwrite real
            // cloud team data.
            console.warn('[loadCloudData] No cached teams found on this device — showing structural default skeleton locally only, NOT saved to cloud.');
            setTeams(getInitialData().teams);
          }
        } catch (e) { console.error('Failed to parse cached teams:', e); }

        try {
          if (storedLogs) {
            setLogs(JSON.parse(storedLogs));
          } else {
            setLogs([]);
          }
        } catch (e) { console.error('Failed to parse cached logs:', e); }

        try {
          setInspectors(storedInspectors ? JSON.parse(storedInspectors) : DEFAULT_INSPECTORS);
        } catch (e) { console.error('Failed to parse cached inspectors:', e); }

        try {
          setEngineers(storedEngineers ? JSON.parse(storedEngineers) : DEFAULT_ENGINEERS);
        } catch (e) { console.error('Failed to parse cached engineers:', e); }

        try {
          if (storedPlannedPools) {
            setPlannedPools(JSON.parse(storedPlannedPools));
          } else {
            setPlannedPools(getInitialData().plannedPools);
          }
        } catch (e) { console.error('Failed to parse cached plannedPools:', e); }

        try {
          if (storedProjectsSummary) {
            setProjectsSummary(JSON.parse(storedProjectsSummary));
          } else {
            setProjectsSummary(DEFAULT_PROJECTS_SUMMARY);
          }
        } catch (e) { console.error('Failed to parse cached projectsSummary:', e); }

        try {
          if (storedMonthlyTargets) {
            setMonthlyTargets(JSON.parse(storedMonthlyTargets));
          } else {
            setMonthlyTargets(DEFAULT_MONTHLY_TARGETS);
          }
        } catch (e) { console.error('Failed to parse cached monthlyTargets:', e); }
      }
    };

    loadCloudData();

    // ─────────────────────────────────────────────────────────────────────────
    // LOW-NETWORK RESILIENCE: any changes made while offline/on a flaky
    // connection are queued (see firebaseService.ts) instead of being lost or
    // forced through as a stale overwrite. Flush that queue now (in case the
    // app was reloaded after losing connection) and again the moment the
    // browser reports the connection is back.
    // ─────────────────────────────────────────────────────────────────────────
    flushPendingCloudWrites().catch(() => {});
    const handleOnline = () => { flushPendingCloudWrites().catch(() => {}); };
    window.addEventListener('online', handleOnline);

    // ─────────────────────────────────────────────────────────────────────────
    // 🔴 LIVE SYNC — Firestore onSnapshot (BUGFIX v5)
    // ─────────────────────────────────────────────────────────────────────────
    // Previously this used 3-minute setInterval polling that only updated
    // pools / teams / logs, and ONLY for 5 specific roles. That meant data
    // entered on PC-A would not appear on PC-B for up to 3 minutes, and would
    // NEVER appear for plannedPools / projectsSummary / monthlyTargets /
    // employees / inspectors / engineers / trolleys / recycleBin.
    //
    // Replaced with `subscribeToLiveState` which uses Firestore onSnapshot —
    // changes on any device propagate to all other devices in < 1 second,
    // for ALL collections, regardless of which role the user is in.
    // ─────────────────────────────────────────────────────────────────────────
    const liveUnsub = subscribeToLiveState(({ collection, data }) => {
      // ─────────────────────────────────────────────────────────────────────
      // STALE CLOSURE FIX:
      // The old code used `shouldUpdate(pools)` etc. but `pools` here is
      // captured from the moment this useEffect ran — it never updates as the
      // user adds data. This meant the guard was comparing against a stale
      // snapshot and could skip valid updates OR allow empty overwrites.
      //
      // FIX: use the functional setState form `setPools(prev => ...)`.
      // Inside the updater, `prev` is always the CURRENT live React state —
      // no stale closure, no missed updates, no accidental empty overwrites.
      // ─────────────────────────────────────────────────────────────────────
      const baselineRefFor = (name: string) => {
        switch (name) {
          case 'pools': return poolsBaselineRef;
          case 'teams': return teamsBaselineRef;
          case 'logs': return logsBaselineRef;
          case 'inspectors': return inspectorsBaselineRef;
          case 'engineers': return engineersBaselineRef;
          case 'plannedPools': return plannedPoolsBaselineRef;
          case 'projectsSummary': return projectsSummaryBaselineRef;
          case 'monthlyTargets': return monthlyTargetsBaselineRef;
          case 'employees': return employeesBaselineRef;
          default: return null;
        }
      };

      const safeUpdate = <T,>(setter: React.Dispatch<React.SetStateAction<T[]>>, incoming: T[]) => {
        setter(prev => {
          // Never replace real data with an empty array
          if (incoming.length === 0 && prev.length > 0) {
            console.warn(`[liveSync] Blocked empty snapshot for '${collection}' — keeping ${prev.length} existing records.`);
            return prev;
          }
          // This data genuinely came from the server, so it's a trustworthy
          // "last known good" baseline for future merge-diffing.
          const ref = baselineRefFor(collection);
          if (ref) ref.current = deepClone(incoming as any[]);
          return incoming;
        });
      };

      switch (collection) {
        case 'pools':            safeUpdate(setPools, data as Pool[]); break;
        case 'plannedPools':     safeUpdate(setPlannedPools, data as PlannedPool[]); break;
        case 'teams':            safeUpdate(setTeams, data as Team[]); break;
        case 'logs':             safeUpdate(setLogs, data as ActivityLog[]); break;
        case 'inspectors':       safeUpdate(setInspectors, data); break;
        case 'engineers':        safeUpdate(setEngineers, data); break;
        case 'projectsSummary':  safeUpdate(setProjectsSummary, data as ProjectSummary[]); break;
        case 'monthlyTargets':   safeUpdate(setMonthlyTargets, data as MonthlyTarget[]); break;
        case 'employees':        safeUpdate(setEmployees, data as Employee[]); break;
        case 'trolleys':         safeUpdate(setTrolleys, data as TrolleyProduction[]); break;
        case 'recycleBin':       safeUpdate(setRecycleBin, data as RecycleBinItem[]); break;
        case 'employeePunches':  safeUpdate(setEmployeePunches, data as EmployeePunch[]); break;
        case 'qcDefects':        safeUpdate(setQcDefects, data as QCDefect[]); break;
        case 'undoRequests':     safeUpdate(setPendingUndoRequests as any, data); break;
      }
      // Keep localStorage hot-cache in sync so offline reload starts with fresh data
      const lsKey = 'apex_' + collection.replace(/[A-Z]/g, m => '_' + m.toLowerCase());
      try { localStorage.setItem(lsKey, JSON.stringify(data)); } catch {}
      cloudHydratedRef.current = true;
      setFirebaseStatus('connected');
      setFirebaseError(null);
    });

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
      if (typeof liveUnsub === 'function') {
        liveUnsub();
      }
      window.removeEventListener('online', handleOnline);
    };
  }, []);
  const handleGoogleSignIn = async () => {
    try {
      setAuthNotification(null);
      const result = await googleSignIn();
      if (result) {
        setGoogleUser(result.user);
        setAuthNotification({
          title: "Connection Successful",
          message: "Successfully connected to Google Drive and activated state-sync snapshots!",
          type: "success"
        });
      }
    } catch (err: any) {
      console.error('Sign-in failed:', err);
      const errorMsg = err?.message || String(err);
      
      let guidance = "Browsers often restrict authorization popups inside embedded iframe previews. If the login popup didn't show or closed instantly, click 'Open in New Tab' at the top-right of your screen and sign in there.";
      
      if (errorMsg.includes('popup-blocked')) {
        guidance = "Your browser has blocked the authorization popup. Please disable your popup blocker for this site or open the application in a new tab.";
      } else if (errorMsg.includes('storage-unsupported') || errorMsg.includes('iframe') || errorMsg.includes('cookies')) {
        guidance = "Third-party cookies/storage are restricted in this preview framework. Please open the application in a new tab (button at the top-right corner of the screen) to sign in safely.";
      } else if (errorMsg.includes('popup-closed-by-user')) {
        guidance = "The sign-in popup was closed before completion. If this keeps happening automatically, please open this application in a new tab (top-right button on your screen) to authorize outside the iframe sandboxes.";
      }
      
      setAuthNotification({
        title: "Connection Notice",
        message: `${guidance} (Details: ${err?.code || err?.message || 'closed'})`,
        type: "error",
        isAuthError: true
      });
    }
  };

  const handleGoogleSignInRedirect = async () => {
    try {
      setAuthNotification({
        title: "Redirecting...",
        message: "Redirecting you to Google login page. Your current session state is preserved.",
        type: "info"
      });
      await googleSignInRedirect();
    } catch (err: any) {
      console.error('Sign-in redirect failed:', err);
      setAuthNotification({
        title: "Redirect Failed",
        message: `Failed to initiate redirect sign-in: ${err?.code || err?.message || String(err)}`,
        type: "error",
        isAuthError: true
      });
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
    // BUGFIX: this fallback used to call saveState(...) which writes to
    // Firestore — meaning a transient network blip on first load could
    // overwrite the real cloud DB with demo defaults. We now only populate
    // local React state so the UI stays functional. No demo data is ever
    // written to the cloud here. When the user comes back online with valid
    // data, loadCloudData() will hydrate from Firestore on the next reload.
    const data = getInitialData();
    setPools(data.pools);
    setTeams(data.teams);
    setLogs(data.logs);
    setInspectors(DEFAULT_INSPECTORS);
    setEngineers(DEFAULT_ENGINEERS);
    setPlannedPools(data.plannedPools);
    setProjectsSummary(DEFAULT_PROJECTS_SUMMARY);
    setMonthlyTargets(DEFAULT_MONTHLY_TARGETS);
    setTrolleys([]);
    localStorage.removeItem('apex_trolleys');

    // Auto-select first team in fabrication stage
    const fabTeams = data.teams.filter(t => t.stageId === 'steel_fabrication');
    if (fabTeams.length > 0) {
      setWorkerTeamId(fabTeams[0].id);
    }

    // NOTE: intentionally NOT calling saveState() here — see comment above.
  };

  const saveState = (
    updatedPools: Pool[], 
    updatedTeams: Team[], 
    updatedLogs: ActivityLog[],
    updatedInspectors = inspectorsRef.current,
    updatedEngineers = engineersRef.current,
    updatedPlannedPools = plannedPoolsRef.current,
    updatedProjectsSummary = projectsSummaryRef.current,
    updatedMonthlyTargets = monthlyTargetsRef.current,
    updatedEmployees = employeesRef.current
  ) => {
    // Safety: never wipe existing data with empty arrays from stale closures.
    // RACE-FIX (v9): fall back to the live refs (always current), not the
    // render-closure state variables, which may be a beat behind.
    const safePools = updatedPools.length > 0 ? updatedPools : (poolsRef.current.length > 0 ? poolsRef.current : updatedPools);
    const safePlanned = updatedPlannedPools.length > 0 ? updatedPlannedPools : (plannedPoolsRef.current.length > 0 ? plannedPoolsRef.current : updatedPlannedPools);
    const safeEmployees = updatedEmployees.length > 0 ? updatedEmployees : (employeesRef.current.length > 0 ? employeesRef.current : updatedEmployees);
    const safeLogs = updatedLogs.length > 0 ? updatedLogs : (logsRef.current.length > 0 ? logsRef.current : updatedLogs);
    const safeInspectors = updatedInspectors.length > 0 ? updatedInspectors : (inspectorsRef.current.length > 0 ? inspectorsRef.current : updatedInspectors);
    const safeEngineers = updatedEngineers.length > 0 ? updatedEngineers : (engineersRef.current.length > 0 ? engineersRef.current : updatedEngineers);
    const safeProjects = updatedProjectsSummary.length > 0 ? updatedProjectsSummary : (projectsSummaryRef.current.length > 0 ? projectsSummaryRef.current : updatedProjectsSummary);
    const safeTargets = updatedMonthlyTargets.length > 0 ? updatedMonthlyTargets : (monthlyTargetsRef.current.length > 0 ? monthlyTargetsRef.current : updatedMonthlyTargets);
    const safeTeams = updatedTeams.length > 0 ? updatedTeams : (teamsRef.current.length > 0 ? teamsRef.current : updatedTeams);

    localStorage.setItem('apex_pools', JSON.stringify(safePools));
    localStorage.setItem('apex_teams', JSON.stringify(safeTeams));
    localStorage.setItem('apex_logs', JSON.stringify(safeLogs));
    localStorage.setItem('apex_inspectors', JSON.stringify(safeInspectors));
    localStorage.setItem('apex_engineers', JSON.stringify(safeEngineers));
    localStorage.setItem('apex_planned_pools', JSON.stringify(safePlanned));
    localStorage.setItem('apex_projects_summary', JSON.stringify(safeProjects));
    localStorage.setItem('apex_monthly_targets', JSON.stringify(safeTargets));
    localStorage.setItem('apex_employees', JSON.stringify(safeEmployees));

    // ─────────────────────────────────────────────────────────────────────────
    // DATA-LOSS FIX (v8): write ONLY the items that actually changed, diffed
    // against the last KNOWN-GOOD SERVER snapshot (poolsBaselineRef etc.),
    // NOT against the live React state and NOT as a full-array replace.
    //
    // Why not the live state (`pools`, `teams`, ...)? Several handlers mutate
    // a pool/team object in place, so by the time we get here the "before"
    // and "after" can literally be the same object — comparing them can't
    // tell us what changed. The baseline refs are deep-cloned snapshots that
    // are ONLY updated when data actually arrives from the server, so they
    // stay a true, untouched "before" no matter what local mutations happen.
    //
    // Why not a full-array replace? Because a device can be several actions
    // ahead of its last server sync — pushing its ENTIRE current array would
    // re-apply items it hasn't touched (possibly stale) on top of newer
    // versions other devices already wrote. Diffing to a per-item changeset
    // means we only ever touch the specific pool/team/etc. this action
    // actually modified.
    // ─────────────────────────────────────────────────────────────────────────
    const diffCollection = (baseline: any[], local: any[]) => {
      const baselineMap = new Map(baseline.map(item => [item.id, item]));
      const localIds = new Set(local.map(item => item.id));
      const upserts: any[] = [];
      for (const item of local) {
        const before = baselineMap.get(item.id);
        // New item, or content differs from the last known server version -> real change
        if (!before || JSON.stringify(before) !== JSON.stringify(item)) {
          upserts.push(item);
        }
      }
      const deletedIds: string[] = [];
      for (const item of baseline) {
        if (!localIds.has(item.id)) deletedIds.push(item.id);
      }
      return { upserts, deletedIds };
    };

    const changed: Record<string, { upserts: any[]; deletedIds: string[] }> = {};
    const addIfChanged = (name: string, refArr: any[] | null, safe: any[]) => {
      const baseline = refArr ?? [];
      const { upserts, deletedIds } = diffCollection(baseline, safe);
      if (upserts.length > 0 || deletedIds.length > 0) {
        changed[name] = { upserts, deletedIds };
      }
    };
    // RACE-FIX (v9.1): the old `if (updatedX !== xRef.current)` shortcut here
    // was meant purely as a skip-if-unchanged optimization, but every caller
    // does `setPools(updatedPools); saveState(updatedPools, ...)` — and since
    // setPools now updates poolsRef.current SYNCHRONOUSLY (that's the whole
    // point of the v9 fix), poolsRef.current already equals updatedPools by
    // the time this line runs. The comparison was therefore always false,
    // addIfChanged never ran, and NOTHING reached Firestore — changes stayed
    // local to that one device and never synced to any other PC.
    //
    // diffCollection() is already safe to call unconditionally: it only
    // produces upserts/deletedIds when content actually differs from the
    // last known-good SERVER baseline, and addIfChanged only adds to
    // `changed` when that diff is non-empty. So there's no need for (and no
    // safe way to do) a reference-equality pre-check here — just always run
    // the diff.
    addIfChanged('pools', poolsBaselineRef.current, safePools);
    addIfChanged('teams', teamsBaselineRef.current, safeTeams);
    addIfChanged('logs', logsBaselineRef.current, safeLogs);
    addIfChanged('inspectors', inspectorsBaselineRef.current, safeInspectors);
    addIfChanged('engineers', engineersBaselineRef.current, safeEngineers);
    addIfChanged('plannedPools', plannedPoolsBaselineRef.current, safePlanned);
    addIfChanged('projectsSummary', projectsSummaryBaselineRef.current, safeProjects);
    addIfChanged('monthlyTargets', monthlyTargetsBaselineRef.current, safeTargets);
    addIfChanged('employees', employeesBaselineRef.current, safeEmployees);

    if (Object.keys(changed).length === 0) return;

    if (!cloudHydratedRef.current) {
      console.warn('[saveState] Cloud state not hydrated yet — skipping Firestore write to protect cloud data from a stale local copy.');
      setFirebaseStatus('error');
      setFirebaseError('Change saved on this device only. Cloud sync is paused because the app could not load the latest cloud data — check your internet connection and reload the page.');
      return;
    }

    saveChangedCollectionsToFirestore(changed)
      .then((result) => {
        if (result.success) {
          setFirebaseStatus('connected');
          setFirebaseError(null);
        } else {
          // Some collections couldn't reach the cloud (e.g. low/no network).
          // Nothing is lost — the change is safe in local state/localStorage
          // and has been queued to auto-retry as soon as the connection
          // recovers (see flushPendingCloudWrites).
          setFirebaseStatus('error');
          setFirebaseError(
            `Saved on this device. Still syncing to cloud: ${result.failedCollections?.join(', ')} (will retry automatically when the connection improves).`
          );
        }
      })
      .catch((err: any) => {
        console.error('Cloud save error:', err);
        setFirebaseStatus('error');
        setFirebaseError('Saved on this device. Waiting for a stable connection to sync to the cloud — it will retry automatically.');
      });
  };

  const handleSaveEmployee = (employee: Employee) => {
    const existingIndex = employees.findIndex(e => e.id === employee.id);
    let updated: Employee[];
    if (existingIndex >= 0) {
      updated = [...employees];
      updated[existingIndex] = employee;
    } else {
      updated = [employee, ...employees];
    }
    setEmployees(updated);
    saveState(poolsRef.current, teamsRef.current, logsRef.current, inspectorsRef.current, engineersRef.current, plannedPoolsRef.current, projectsSummaryRef.current, monthlyTargetsRef.current, updated);
    dbSaveEmployee(employee).catch(console.error);
  };

  const handleDeleteEmployee = (id: string) => {
    const updated = employees.filter(e => e.id !== id);
    setEmployees(updated);
    saveState(poolsRef.current, teamsRef.current, logsRef.current, inspectorsRef.current, engineersRef.current, plannedPoolsRef.current, projectsSummaryRef.current, monthlyTargetsRef.current, updated);
    dbDeleteEmployee(id).catch(console.error);
  };

  const handleSaveEmployeePunch = (punch: EmployeePunch) => {
    const updated = [punch, ...employeePunches];
    setEmployeePunches(updated);
    localStorage.setItem('apex_employee_punches', JSON.stringify(updated));
    dbSaveEmployeePunch(punch).catch(console.error);
  };

  const handleDeleteEmployeePunch = (id: string) => {
    const updated = employeePunches.filter(p => p.id !== id);
    setEmployeePunches(updated);
    localStorage.setItem('apex_employee_punches', JSON.stringify(updated));
    dbDeleteEmployeePunch(id).catch(console.error);
  };

  const handleSaveEmployeePunchesBulk = (newPunches: EmployeePunch[]) => {
    // filter duplicates
    const existingIds = new Set(employeePunches.map(p => p.id));
    const uniqueNew = newPunches.filter(p => !existingIds.has(p.id));
    const updated = [...uniqueNew, ...employeePunches];
    setEmployeePunches(updated);
    localStorage.setItem('apex_employee_punches', JSON.stringify(updated));
    dbSaveEmployeePunchesBulk(newPunches).catch(console.error);
  };

  const handleClearAllEmployeePunches = () => {
    setEmployeePunches([]);
    localStorage.setItem('apex_employee_punches', JSON.stringify([]));
    dbClearAllEmployeePunches().catch(console.error);
  };

  const handleDeleteEmployeePunchesByDate = (date: string) => {
    const updated = employeePunches.filter(p => p.date !== date);
    setEmployeePunches(updated);
    localStorage.setItem('apex_employee_punches', JSON.stringify(updated));
    dbDeleteEmployeePunchesByDate(date).catch(console.error);
  };

  const handleSaveEmployeesBulk = (newStaffList: Employee[]) => {
    const updated = [...employees];
    newStaffList.forEach(emp => {
      const idx = updated.findIndex(e => e.id === emp.id);
      if (idx >= 0) {
        updated[idx] = emp;
      } else {
        updated.unshift(emp);
      }
    });
    setEmployees(updated);
    saveState(poolsRef.current, teamsRef.current, logsRef.current, inspectorsRef.current, engineersRef.current, plannedPoolsRef.current, projectsSummaryRef.current, monthlyTargetsRef.current, updated);
    dbSaveEmployeesBulk(newStaffList).catch(console.error);
  };

  const handleSaveTrolley = (trolley: TrolleyProduction) => {
    const existingIndex = trolleys.findIndex(t => t.id === trolley.id);
    let updated: TrolleyProduction[];
    if (existingIndex >= 0) {
      updated = [...trolleys];
      updated[existingIndex] = trolley;
    } else {
      updated = [trolley, ...trolleys];
    }
    setTrolleys(updated);
    localStorage.setItem('apex_trolleys', JSON.stringify(updated));
    dbSaveTrolley(trolley).catch(console.error);
  };

  const handleDeleteTrolley = async (id: string) => {
    const trolleyToTrash = trolleys.find(t => t.id === id);
    if (trolleyToTrash) {
      const trashItem: RecycleBinItem = {
        id: `trolley_trash_${id}_${Date.now()}`,
        dataType: 'trolley',
        deletedAt: new Date().toISOString(),
        payload: trolleyToTrash
      };
      await dbAddRecycleBin(trashItem).catch(console.error);
    }
    const updated = trolleys.filter(t => t.id !== id);
    setTrolleys(updated);
    localStorage.setItem('apex_trolleys', JSON.stringify(updated));
    await dbDeleteTrolley(id).catch(console.error);

    // Refresh recycle bin state
    const cloudData = await getEntireStateFromFirestore().catch(() => null);
    if (cloudData && cloudData.recycleBin) {
      setRecycleBin(cloudData.recycleBin);
    }
  };


  // State update dispatchers for dynamically changing names
  // ── QC Defect handlers ────────────────────────────────────────────────────
  const handleLogDefect = (defect: QCDefect) => {
    const updated = [defect, ...qcDefects];
    setQcDefects(updated);
    localStorage.setItem('apex_qc_defects', JSON.stringify(updated));
    // Write to Firestore so all portals get it in real-time via subscribeToLiveState
    try {
      const { doc, setDoc, collection } = require('firebase/firestore');
      const { db } = require('./lib/firebase');
      setDoc(doc(collection(db, 'qcDefects'), defect.id), defect).catch(console.error);
    } catch (e) {
      console.warn('[QCDefect] Firestore write skipped — module unavailable:', e);
    }
  };

  const handleUpdateDefectStatus = (defectId: string, newStatus: QCDefect['status'], operatorName: string) => {
    setQcDefects(prev => {
      const updated = prev.map(d => {
        if (d.id !== defectId) return d;
        return {
          ...d,
          status: newStatus,
          ...(newStatus === 'released' ? { releasedBy: operatorName, releasedAt: new Date().toISOString() } : {}),
        };
      });
      localStorage.setItem('apex_qc_defects', JSON.stringify(updated));
      // Persist update to Firestore
      const updatedDefect = updated.find(d => d.id === defectId);
      if (updatedDefect) {
        try {
          const { doc, setDoc, collection } = require('firebase/firestore');
          const { db } = require('./lib/firebase');
          setDoc(doc(collection(db, 'qcDefects'), defectId), updatedDefect).catch(console.error);
        } catch (e) {
          console.warn('[QCDefect] Firestore update skipped:', e);
        }
      }
      return updated;
    });
  };

  const handleUpdateTeams = (updatedTeams: Team[]) => {
    setTeams(updatedTeams);
    saveState(poolsRef.current, updatedTeams, logsRef.current, inspectorsRef.current, engineersRef.current);
  };

  const handleUpdateInspectors = (updatedInspectors: { id: string; name: string; title: string }[]) => {
    setInspectors(updatedInspectors);
    saveState(poolsRef.current, teamsRef.current, logsRef.current, updatedInspectors, engineersRef.current);
  };

  const handleUpdateEngineers = (updatedEngineers: { id: string; name: string; title: string }[]) => {
    setEngineers(updatedEngineers);
    saveState(poolsRef.current, teamsRef.current, logsRef.current, inspectorsRef.current, updatedEngineers);
  };

  const handleRenameProject = (oldName: string, newName: string) => {
    if (!newName.trim() || oldName === newName) return;
    
    const updatedPools = pools.map(p => p.projectName === oldName ? { ...p, projectName: newName.trim() } : p);
    const updatedLogs = logs.map(l => l.projectName === oldName ? { ...l, projectName: newName.trim() } : l);
    
    setPools(updatedPools);
    setLogs(updatedLogs);
    saveState(updatedPools, teamsRef.current, updatedLogs, inspectorsRef.current, engineersRef.current);
  };

  const handleDirectOverridePool = (
    poolSpec: {
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
      createdAt?: string;
    },
    operatorName: string
  ) => {
    const existingPoolIndex = pools.findIndex(p => 
      p.id === poolSpec.id || 
      (p.projectName.toLowerCase() === poolSpec.projectName.toLowerCase() && p.poolNo.toLowerCase() === poolSpec.poolNo.toLowerCase())
    );

    let updatedPools = [...pools];
    let pool: Pool;
    let isNew = false;

    if (existingPoolIndex >= 0) {
      pool = { ...updatedPools[existingPoolIndex] };
    } else {
      isNew = true;
      pool = {
        id: poolSpec.id || 'pool-' + Date.now(),
        projectName: poolSpec.projectName,
        poolNo: poolSpec.poolNo,
        orientation: poolSpec.orientation,
        dimensions: poolSpec.dimensions || '12m x 5m',
        shape: poolSpec.shape || 'Rectangular',
        poolType: poolSpec.poolType || 'Type 3',
        notes: poolSpec.notes || '',
        createdAt: poolSpec.createdAt || new Date().toISOString(),
        currentStageIndex: 0,
        stageHistory: createEmptyHistory()
      };
    }

    // Update fields
    pool.orientation = poolSpec.orientation;
    pool.dimensions = poolSpec.dimensions;
    pool.shape = poolSpec.shape;
    pool.poolType = poolSpec.poolType;
    if (poolSpec.notes !== undefined) pool.notes = poolSpec.notes;
    pool.currentStageIndex = poolSpec.currentStageIndex;

    if (poolSpec.isDelivered) {
      pool.isDelivered = true;
      pool.deliveredAt = new Date().toISOString();
      if (!pool.completedAt) pool.completedAt = new Date().toISOString();
    } else {
      pool.isDelivered = false;
      pool.deliveredAt = null;
      if (pool.currentStageIndex >= STAGES.length) {
        if (!pool.completedAt) pool.completedAt = new Date().toISOString();
      } else {
        pool.completedAt = null;
      }
    }

    // Direct stage history consistency mapping
    const updatedStageHistory = { ...pool.stageHistory };
    STAGES.forEach((stage, idx) => {
      if (idx < poolSpec.currentStageIndex) {
        if (updatedStageHistory[stage.id].status !== 'APPROVED') {
          updatedStageHistory[stage.id] = {
            ...updatedStageHistory[stage.id],
            status: 'APPROVED',
            startTime: updatedStageHistory[stage.id].startTime || new Date().toISOString(),
            endTime: updatedStageHistory[stage.id].endTime || new Date().toISOString(),
            inspectorNotes: updatedStageHistory[stage.id].inspectorNotes || 'Directly approved via override portal'
          };
        }
      } else if (idx === poolSpec.currentStageIndex && poolSpec.currentStageIndex < STAGES.length) {
        updatedStageHistory[stage.id] = {
          ...updatedStageHistory[stage.id],
          status: 'NOT_STARTED',
          startTime: null,
          endTime: null,
          teamId: undefined
        };
      } else {
        updatedStageHistory[stage.id] = {
          ...updatedStageHistory[stage.id],
          status: 'NOT_STARTED',
          startTime: null,
          endTime: null
        };
      }
    });
    pool.stageHistory = updatedStageHistory;

    if (existingPoolIndex >= 0) {
      updatedPools[existingPoolIndex] = pool;
    } else {
      updatedPools.push(pool);
    }

    // Generate descriptive log
    const stageNameStatus = poolSpec.isDelivered 
      ? 'Delivered' 
      : (poolSpec.currentStageIndex >= STAGES.length 
          ? 'Fully Produced / Ready' 
          : STAGES[poolSpec.currentStageIndex]?.name || 'Pre-Production');

    const logEntry: ActivityLog = {
      id: 'log-' + Date.now(),
      timestamp: new Date().toISOString(),
      poolId: pool.id,
      poolNo: pool.poolNo,
      projectName: pool.projectName,
      stageId: poolSpec.currentStageIndex < STAGES.length ? STAGES[poolSpec.currentStageIndex]?.id : 'acrylic',
      type: poolSpec.isDelivered ? 'APPROVED' : (isNew ? 'CREATED' : 'STAGE_FINISHED'),
      notes: `Direct portal override. Set to: ${stageNameStatus}. Notes: ${poolSpec.notes || 'None'}`,
      operatorName: operatorName || 'Planning Department Manager'
    };

    const updatedLogs = [logEntry, ...logs];

    // Keep project summaries in dynamic recalculation sync!
    const projectPools = updatedPools.filter(p => p.projectName.toLowerCase() === pool.projectName.toLowerCase());
    const existingProjectIndex = projectsSummary.findIndex(p => p.projectName.toLowerCase() === pool.projectName.toLowerCase());
    const updatedProjects = [...projectsSummary];

    const totalCount = existingProjectIndex >= 0 
      ? Math.max(projectPools.length, projectsSummary[existingProjectIndex].totalPools) 
      : projectPools.length;
    const producedCount = projectPools.filter(p => p.currentStageIndex >= STAGES.length).length;
    const deliveredCount = projectPools.filter(p => p.isDelivered).length;

    if (existingProjectIndex >= 0) {
      const existingProject = projectsSummary[existingProjectIndex];
      const nextTotal = Math.max(totalCount, existingProject.totalPools);
      
      const updatedProjRec: ProjectSummary = {
        ...existingProject,
        totalPools: nextTotal,
        producedPools: producedCount,
        deliveredPools: deliveredCount,
        remainingPools: Math.max(0, nextTotal - deliveredCount)
      };
      updatedProjects[existingProjectIndex] = updatedProjRec;
      dbSaveProjectSummary(updatedProjRec).catch(console.error);
    } else {
      const newProjRec: ProjectSummary = {
        id: 'proj-' + Date.now(),
        projectName: pool.projectName,
        orientation: pool.orientation,
        poolType: pool.poolType || 'Type 3',
        totalPools: Math.max(1, totalCount),
        producedPools: producedCount,
        deliveredPools: deliveredCount,
        remainingPools: Math.max(0, Math.max(1, totalCount) - deliveredCount),
        notes: `Auto-created via Direct Update overrides`,
        createdAt: new Date().toISOString()
      };
      updatedProjects.push(newProjRec);
      dbSaveProjectSummary(newProjRec).catch(console.error);
    }

    setPools(updatedPools);
    setLogs(updatedLogs);
    setProjectsSummary(updatedProjects);

    saveState(
      updatedPools,
      teamsRef.current,
      updatedLogs,
      inspectorsRef.current,
      engineersRef.current,
      plannedPoolsRef.current,
      updatedProjects,
      monthlyTargetsRef.current,
      employeesRef.current
    );
  };

  const handleDirectOverridePoolsBatch = (
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
  ): boolean => {
    let updatedPools = [...pools];
    let updatedPlannedPools = [...plannedPools];
    let updatedLogs = [...logs];
    let updatedProjects = [...projectsSummary];
    const nowStr = new Date().toISOString();

    specs.forEach((spec, index) => {
      const computedPoolNo = spec.poolNo.trim().toUpperCase();
      const cleanProjName = spec.projectName.trim() || 'Excel Sync';

      if (spec.isPlanned) {
        // Move to or update in plannedPools
        // FIX: only remove the pool matching BOTH poolNo AND projectName — never touch same poolNo in a different project
        updatedPools = updatedPools.filter(p => !(
          p.poolNo.toUpperCase() === computedPoolNo &&
          p.projectName.toLowerCase() === cleanProjName.toLowerCase()
        ));

        // FIX: match by BOTH poolNo AND projectName
        const planIdx = updatedPlannedPools.findIndex(p =>
          p.poolNo.toUpperCase() === computedPoolNo &&
          p.projectName.toLowerCase() === cleanProjName.toLowerCase()
        );
        if (planIdx >= 0) {
          updatedPlannedPools[planIdx] = {
            ...updatedPlannedPools[planIdx],
            projectName: cleanProjName,
            orientation: spec.orientation,
            dimensions: spec.dimensions || '12m x 5m',
            shape: spec.shape || 'Rectangular',
            poolType: spec.poolType || 'Type 1',
            notes: spec.notes || 'Updated via Direct Stage Excel Sync'
          };
        } else {
          updatedPlannedPools.push({
            id: `plan_${Date.now()}_sync_${index}_${Math.random().toString(36).substring(2, 5)}`,
            projectName: cleanProjName,
            poolNo: computedPoolNo,
            orientation: spec.orientation,
            dimensions: spec.dimensions || '12m x 5m',
            shape: spec.shape || 'Rectangular',
            poolType: spec.poolType || 'Type 1',
            status: 'PLANNED',
            notes: spec.notes || 'Created via Direct Stage Excel Sync',
            createdAt: nowStr
          });
        }
      } else {
        // Move/Update in pools (floor)
        // FIX: only remove from plannedPools if BOTH poolNo AND projectName match
        updatedPlannedPools = updatedPlannedPools.filter(p => !(
          p.poolNo.toUpperCase() === computedPoolNo &&
          p.projectName.toLowerCase() === cleanProjName.toLowerCase()
        ));

        // FIX: match by BOTH poolNo AND projectName — pool 222 in Tiger must never overwrite pool 222 in Skyros
        const existingPoolIndex = updatedPools.findIndex(p =>
          p.poolNo.toUpperCase() === computedPoolNo &&
          p.projectName.toLowerCase() === cleanProjName.toLowerCase()
        );
        let pool: Pool;
        let isNew = false;

        if (existingPoolIndex >= 0) {
          pool = { ...updatedPools[existingPoolIndex] };
        } else {
          isNew = true;
          pool = {
            id: `pool_${Date.now()}_sync_${index}_${Math.random().toString(36).substring(2, 5)}`,
            projectName: cleanProjName,
            poolNo: computedPoolNo,
            orientation: spec.orientation,
            dimensions: spec.dimensions || '12m x 5m',
            shape: spec.shape || 'Rectangular',
            poolType: spec.poolType || 'Type 3',
            notes: spec.notes || '',
            createdAt: nowStr,
            currentStageIndex: 0,
            stageHistory: createEmptyHistory()
          };
        }

        // Update properties
        pool.projectName = cleanProjName;
        pool.orientation = spec.orientation;
        pool.dimensions = spec.dimensions || pool.dimensions;
        pool.shape = spec.shape || pool.shape;
        pool.poolType = spec.poolType || pool.poolType;
        if (spec.notes !== undefined) pool.notes = spec.notes;
        pool.currentStageIndex = spec.currentStageIndex;

        if (spec.isDelivered) {
          pool.isDelivered = true;
          pool.deliveredAt = nowStr;
          if (!pool.completedAt) pool.completedAt = nowStr;
        } else {
          pool.isDelivered = false;
          pool.deliveredAt = null;
          if (pool.currentStageIndex >= STAGES.length) {
            if (!pool.completedAt) pool.completedAt = nowStr;
          } else {
            pool.completedAt = null;
          }
        }

        // Validate complete stage history consistency
        const updatedStageHistory = { ...pool.stageHistory };
        STAGES.forEach((stage, sIdx) => {
          if (sIdx < spec.currentStageIndex) {
            if (!updatedStageHistory[stage.id] || updatedStageHistory[stage.id].status !== 'APPROVED') {
              updatedStageHistory[stage.id] = {
                stageId: stage.id,
                status: 'APPROVED',
                startTime: updatedStageHistory[stage.id]?.startTime || nowStr,
                endTime: updatedStageHistory[stage.id]?.endTime || nowStr,
                inspectorNotes: updatedStageHistory[stage.id]?.inspectorNotes || 'Approved via direct Excel sync overrides',
                rejectionCount: updatedStageHistory[stage.id]?.rejectionCount || 0
              };
            }
          } else if (sIdx === spec.currentStageIndex && spec.currentStageIndex < STAGES.length) {
            updatedStageHistory[stage.id] = {
              stageId: stage.id,
              status: 'NOT_STARTED',
              startTime: null,
              endTime: null,
              teamId: undefined,
              rejectionCount: updatedStageHistory[stage.id]?.rejectionCount || 0
            };
          } else {
            updatedStageHistory[stage.id] = {
              stageId: stage.id,
              status: 'NOT_STARTED',
              startTime: null,
              endTime: null,
              rejectionCount: updatedStageHistory[stage.id]?.rejectionCount || 0
            };
          }
        });
        pool.stageHistory = updatedStageHistory;

        if (existingPoolIndex >= 0) {
          updatedPools[existingPoolIndex] = pool;
        } else {
          updatedPools.push(pool);
        }

        // Log entry
        const stageNameStatus = spec.isDelivered 
          ? 'Delivered' 
          : (spec.currentStageIndex >= STAGES.length 
              ? 'Fully Produced / Ready' 
              : STAGES[spec.currentStageIndex]?.name || 'Pre-Production');

        updatedLogs.unshift({
          id: `log_batch_${Date.now()}_${index}_${Math.random().toString(36).substring(2, 5)}`,
          timestamp: nowStr,
          poolId: pool.id,
          poolNo: pool.poolNo,
          projectName: pool.projectName,
          type: spec.isDelivered ? 'APPROVED' : (isNew ? 'CREATED' : 'STAGE_FINISHED'),
          stageId: spec.currentStageIndex < STAGES.length ? STAGES[spec.currentStageIndex]?.id : 'acrylic',
          notes: `Batch Excel overriding. Synchronized state status: ${stageNameStatus}.`,
          operatorName: operatorName || 'Planning Department Manager'
        });
      }
    });

    // Recompute projectsSummary
    const allProjNames = Array.from(new Set([
      ...updatedPools.map(p => p.projectName.toLowerCase()),
      ...updatedPlannedPools.map(p => p.projectName.toLowerCase())
    ]));

    allProjNames.forEach(proj => {
      const projectPools = updatedPools.filter(p => p.projectName.toLowerCase() === proj);
      const totalPlanned = updatedPlannedPools.filter(p => p.projectName.toLowerCase() === proj).length;
      const producedCount = projectPools.filter(p => p.currentStageIndex >= STAGES.length).length;
      const deliveredCount = projectPools.filter(p => p.isDelivered).length;

      const totalCount = projectPools.length + totalPlanned;
      const existingProjectIndex = updatedProjects.findIndex(p => p.projectName.toLowerCase() === proj);

      if (existingProjectIndex >= 0) {
        const existingProject = updatedProjects[existingProjectIndex];
        const updatedProjRec: ProjectSummary = {
          ...existingProject,
          totalPools: Math.max(existingProject.totalPools, totalCount),
          producedPools: producedCount,
          deliveredPools: deliveredCount,
          remainingPools: Math.max(0, Math.max(existingProject.totalPools, totalCount) - deliveredCount)
        };
        updatedProjects[existingProjectIndex] = updatedProjRec;
        dbSaveProjectSummary(updatedProjRec).catch(console.error);
      } else {
        const samplePool = updatedPools.find(p => p.projectName.toLowerCase() === proj) || updatedPlannedPools.find(p => p.projectName.toLowerCase() === proj);
        const newProjRec: ProjectSummary = {
          id: 'proj-' + Date.now() + '_' + Math.random().toString(36).substring(2, 5),
          projectName: samplePool?.projectName || proj,
          orientation: samplePool?.orientation || 'Normal',
          poolType: samplePool?.poolType || 'Type 3',
          totalPools: totalCount,
          producedPools: producedCount,
          deliveredPools: deliveredCount,
          remainingPools: Math.max(0, totalCount - deliveredCount),
          notes: `Created via batch Excel synchronization`,
          createdAt: nowStr
        };
        updatedProjects.push(newProjRec);
        dbSaveProjectSummary(newProjRec).catch(console.error);
      }
    });

    setPools(updatedPools);
    setPlannedPools(updatedPlannedPools);
    setLogs(updatedLogs);
    setProjectsSummary(updatedProjects);

    saveState(
      updatedPools,
      teamsRef.current,
      updatedLogs,
      inspectorsRef.current,
      engineersRef.current,
      updatedPlannedPools,
      updatedProjects,
      monthlyTargetsRef.current,
      employeesRef.current
    );

    return true;
  };

  const handleSaveProjectSummary = (summary: ProjectSummary) => {
    const existingIndex = projectsSummary.findIndex(p => p.id === summary.id);
    let updated: ProjectSummary[];
    if (existingIndex >= 0) {
      updated = [...projectsSummary];
      updated[existingIndex] = summary;
    } else {
      updated = [summary, ...projectsSummary];
    }
    setProjectsSummary(updated);
    saveState(poolsRef.current, teamsRef.current, logsRef.current, inspectorsRef.current, engineersRef.current, plannedPoolsRef.current, updated, monthlyTargetsRef.current);
    dbSaveProjectSummary(summary).catch(console.error);
  };

  const handleDeleteProjectSummary = async (id: string) => {
    const targetProj = projectsSummary.find(p => p.id === id);
    if (targetProj) {
      const trashItem: RecycleBinItem = {
        id: `project_trash_${id}_${Date.now()}`,
        dataType: 'project_summary',
        deletedAt: new Date().toISOString(),
        payload: targetProj
      };
      await dbAddRecycleBin(trashItem).catch(console.error);
    }
    const updated = projectsSummary.filter(p => p.id !== id);
    setProjectsSummary(updated);
    saveState(poolsRef.current, teamsRef.current, logsRef.current, inspectorsRef.current, engineersRef.current, plannedPoolsRef.current, updated, monthlyTargetsRef.current);
    await dbDeleteProjectSummary(id).catch(console.error);

    // Refresh recycle bin state
    const cloudData = await getEntireStateFromFirestore().catch(() => null);
    if (cloudData && cloudData.recycleBin) {
      setRecycleBin(cloudData.recycleBin);
    }
  };

  const handleSaveMonthlyTarget = (target: MonthlyTarget) => {
    const existingIndex = monthlyTargets.findIndex(t => t.id === target.id);
    let updated: MonthlyTarget[];
    if (existingIndex >= 0) {
      updated = [...monthlyTargets];
      updated[existingIndex] = target;
    } else {
      updated = [target, ...monthlyTargets];
    }
    setMonthlyTargets(updated);
    saveState(poolsRef.current, teamsRef.current, logsRef.current, inspectorsRef.current, engineersRef.current, plannedPoolsRef.current, projectsSummaryRef.current, updated);
    dbSaveMonthlyTarget(target).catch(console.error);
  };

  const handleDeleteMonthlyTarget = async (id: string) => {
    const target = monthlyTargets.find(t => t.id === id);
    if (!target) return;
    if (!window.confirm(`Delete monthly target "${target.monthName}" permanently?\n\nThis removes it from Firestore and all connected devices in real time.`)) {
      return;
    }
    const updated = monthlyTargets.filter(t => t.id !== id);
    setMonthlyTargets(updated);
    saveState(poolsRef.current, teamsRef.current, logsRef.current, inspectorsRef.current, engineersRef.current, plannedPoolsRef.current, projectsSummaryRef.current, updated);
    await dbDeleteMonthlyTarget(id).catch(console.error);
  };

  // Inspectors & Engineers — manual management from Planning Portal
  const handleSaveInspector = (insp: { id: string; name: string; title: string }) => {
    const existingIndex = inspectors.findIndex(i => i.id === insp.id);
    let updated;
    if (existingIndex >= 0) {
      updated = [...inspectors];
      updated[existingIndex] = insp;
    } else {
      updated = [...inspectors, insp];
    }
    setInspectors(updated);
    saveState(poolsRef.current, teamsRef.current, logsRef.current, updated, engineersRef.current, plannedPoolsRef.current, projectsSummaryRef.current, monthlyTargetsRef.current);
    dbSaveInspector(insp).catch(console.error);
  };

  const handleDeleteInspector = async (id: string) => {
    const insp = inspectors.find(i => i.id === id);
    if (!insp) return;
    if (!window.confirm(`Delete inspector "${insp.name}" permanently?`)) return;
    const updated = inspectors.filter(i => i.id !== id);
    setInspectors(updated);
    saveState(poolsRef.current, teamsRef.current, logsRef.current, updated, engineersRef.current, plannedPoolsRef.current, projectsSummaryRef.current, monthlyTargetsRef.current);
    await dbDeleteInspector(id).catch(console.error);
  };

  const handleSaveEngineer = (eng: { id: string; name: string; title: string }) => {
    const existingIndex = engineers.findIndex(e => e.id === eng.id);
    let updated;
    if (existingIndex >= 0) {
      updated = [...engineers];
      updated[existingIndex] = eng;
    } else {
      updated = [...engineers, eng];
    }
    setEngineers(updated);
    saveState(poolsRef.current, teamsRef.current, logsRef.current, inspectorsRef.current, updated, plannedPoolsRef.current, projectsSummaryRef.current, monthlyTargetsRef.current);
    dbSaveEngineer(eng).catch(console.error);
  };

  const handleDeleteEngineer = async (id: string) => {
    const eng = engineers.find(e => e.id === id);
    if (!eng) return;
    if (!window.confirm(`Delete engineer "${eng.name}" permanently?`)) return;
    const updated = engineers.filter(e => e.id !== id);
    setEngineers(updated);
    saveState(poolsRef.current, teamsRef.current, logsRef.current, inspectorsRef.current, updated, plannedPoolsRef.current, projectsSummaryRef.current, monthlyTargetsRef.current);
    await dbDeleteEngineer(id).catch(console.error);
  };

  const handleRestoreState = (recovered: {
    pools?: Pool[];
    teams?: Team[];
    logs?: ActivityLog[];
    inspectors?: { id: string; name: string; title: string }[];
    engineers?: { id: string; name: string; title: string }[];
    employees?: Employee[];
    plannedPools?: PlannedPool[];
    projectsSummary?: ProjectSummary[];
    monthlyTargets?: MonthlyTarget[];
  }) => {
    // SAFETY: a backup file that doesn't mention a collection at all must NEVER
    // be treated as "this collection is now empty". Only overwrite a collection
    // when the key is explicitly present in the uploaded file — otherwise keep
    // whatever's currently loaded, untouched. This is what previously let an
    // older/partial backup silently wipe employees (and would have done the same
    // to plannedPools/projectsSummary/monthlyTargets).
    const missing: string[] = [];
    const has = (key: string) => Object.prototype.hasOwnProperty.call(recovered, key);
    if (!has('employees')) missing.push('employees');
    if (!has('plannedPools')) missing.push('plannedPools');
    if (!has('projectsSummary')) missing.push('projectsSummary');
    if (!has('monthlyTargets')) missing.push('monthlyTargets');
    if (missing.length > 0) {
      console.warn(`[handleRestoreState] Backup file did not include: ${missing.join(', ')}. Keeping current data for these — nothing was wiped.`);
    }

    if (recovered.pools) setPools(recovered.pools);
    if (recovered.teams) setTeams(recovered.teams);
    if (recovered.logs) setLogs(recovered.logs);
    if (recovered.inspectors) setInspectors(recovered.inspectors);
    if (recovered.engineers) setEngineers(recovered.engineers);
    if (recovered.employees) setEmployees(recovered.employees);
    if (recovered.plannedPools) setPlannedPools(recovered.plannedPools);
    if (recovered.projectsSummary) setProjectsSummary(recovered.projectsSummary);
    if (recovered.monthlyTargets) setMonthlyTargets(recovered.monthlyTargets);

    saveState(
      recovered.pools || poolsRef.current,
      recovered.teams || teamsRef.current,
      recovered.logs || logsRef.current,
      recovered.inspectors || inspectorsRef.current,
      recovered.engineers || engineersRef.current,
      recovered.plannedPools || plannedPoolsRef.current,
      recovered.projectsSummary || projectsSummaryRef.current,
      recovered.monthlyTargets || monthlyTargetsRef.current,
      recovered.employees || employeesRef.current
    );

    if (missing.length > 0) {
      alert(`Restore complete. Note: this backup file didn't include ${missing.join(', ')}, so your current data for those was kept unchanged (not overwritten).`);
    }
  };

  const handleDeletePool = async (poolId: string, operatorName: string) => {
    const targetPool = pools.find(p => p.id === poolId);
    if (!targetPool) return;

    if (!window.confirm(`Are you absolutely sure you want to delete and scrap Pool [${targetPool.poolNo}] for "${targetPool.projectName}"? All manufacturing records for this pool will be deleted permanently.`)) {
      return;
    }

    // Save to Recycle Bin
    const trashItem: RecycleBinItem = {
      id: `pool_trash_${poolId}_${Date.now()}`,
      dataType: 'pool',
      deletedAt: new Date().toISOString(),
      payload: targetPool
    };
    await dbAddRecycleBin(trashItem).catch(console.error);

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
      notes: `Pool/Shell card scrapped and moved to Recycle Bin.`
    };

    const updatedLogs = [...logs, newLog];

    setPools(updatedPools);
    setTeams(updatedTeams);
    setLogs(updatedLogs);
    saveState(updatedPools, updatedTeams, updatedLogs, inspectorsRef.current, engineersRef.current);
    await dbDeletePool(poolId).catch(console.error);

    // Refresh recycle bin state
    const cloudData = await getEntireStateFromFirestore().catch(() => null);
    if (cloudData && cloudData.recycleBin) {
      setRecycleBin(cloudData.recycleBin);
    }
  };

  // Reset local state
  const handleResetData = () => {
    if (window.confirm('Reset local in-browser cache only?\n\nThis clears this device\'s local copy of pools / teams / logs and re-syncs from Firestore on next page load.\n\nNo demo data will be loaded. No cloud data will be deleted.')) {
      // Clear local cache only — no cloud writes, no demo data injection.
      localStorage.removeItem('apex_pools');
      localStorage.removeItem('apex_teams');
      localStorage.removeItem('apex_logs');
      // Reload to pull a fresh copy from Firestore
      window.location.reload();
    }
  };

  // Complete database purge (start entirely from a fresh layout)
  const handlePurgeAllData = async () => {
    if (window.confirm('🚨 CRITICAL ACTION!\nAre you absolutely sure you want to delete ALL active pools, older projects, floor labor teams, planned pools, monthly targets, employees, and manufacturing history records permanently?\n\nThis will instantly clear both your browser cache AND your cloud database allowing you to start completely from scratch.')) {
      // DATA-LOSS FIX: require explicit typed confirmation — a stray click on
      // two confirm dialogs can no longer wipe the whole factory database.
      const typed = window.prompt('FINAL CONFIRMATION\n\nType DELETE (in capital letters) to permanently erase ALL cloud data:');
      if (typed !== 'DELETE') {
        alert('Purge cancelled. No data was deleted.');
        return;
      }
      setPools([]);
      setTeams([]);
      setLogs([]);
      setInspectors([]);
      setEngineers([]);
      setPlannedPools([]);
      setProjectsSummary([]);
      setMonthlyTargets([]);
      setEmployees([]);
      setTrolleys([]);

      localStorage.removeItem('apex_pools');
      localStorage.removeItem('apex_teams');
      localStorage.removeItem('apex_logs');
      localStorage.removeItem('apex_inspectors');
      localStorage.removeItem('apex_engineers');
      localStorage.removeItem('apex_planned_pools');
      localStorage.removeItem('apex_projects_summary');
      localStorage.removeItem('apex_monthly_targets');
      localStorage.removeItem('apex_employees');
      localStorage.removeItem('apex_trolleys');

      try {
        await wipeAllCollectionsFromFirestore();
        setFirebaseStatus('connected');
        setFirebaseError(null);
        alert('Database cleared successfully! You now have a 100% clean worksheet canvas. Start by adding your own staff or releasing new projects.');
      } catch (err: any) {
        console.error('Core purge Cloud SQL sync failure:', err);
        setFirebaseStatus('error');
        setFirebaseError(err?.message || String(err));
        alert('Data cleared locally, but Cloud SQL sync failed. Please check your cloud connection.');
      }
    }
  };

  // Option in management portal to delete all pool related data but not team and other employees data and save to recycle bin
  const handlePurgePoolRelatedData = async () => {
    if (!window.confirm('🚨 DANGER ZONE - PURGE ALL CONTRACTS & BUILDS!\nAre you absolutely sure you want to delete ALL active pools, older planned pools, and contract summary indexes from the application?\n\n- This will NOT affect shop floor teams or employees.\n- Deleted records will stay in the Recycle Bin for 3 days and can be recovered/restored.')) {
      return;
    }
    try {
      const backupId = `purge_pools_${Date.now()}`;
      await dbPurgePoolRelatedData(backupId);

      // Instantly clear client states
      setPools([]);
      setPlannedPools([]);
      setProjectsSummary([]);

      localStorage.setItem('apex_pools', JSON.stringify([]));
      localStorage.setItem('apex_planned_pools', JSON.stringify([]));
      localStorage.setItem('apex_projects_summary', JSON.stringify([]));

      // Fetch fresh cloud state to update recycle bin
      const cloudData = await getEntireStateFromFirestore().catch(() => null);
      if (cloudData) {
        if (cloudData.recycleBin) setRecycleBin(cloudData.recycleBin);
      }

      alert('All pool related logs, pools, and summary cards deleted successfully! A backup has been saved in the Recycle Bin available for 3 days.');
    } catch (err: any) {
      console.error('Core pool-only purge failure:', err);
      alert('Failed to purge pool data: ' + err.message);
    }
  };

  const handleRestoreRecycleBinItem = async (id: string) => {
    try {
      await dbRestoreRecycleBin(id);
      
      // Reload entire state from Cloud SQL to populate all restored rows
      const cloudData = await getEntireStateFromFirestore();
      setPools(cloudData.pools);
      setPlannedPools(cloudData.plannedPools);
      setProjectsSummary(cloudData.projectsSummary);
      setTrolleys(cloudData.trolleys);
      setRecycleBin(cloudData.recycleBin);

      localStorage.setItem('apex_pools', JSON.stringify(cloudData.pools));
      localStorage.setItem('apex_planned_pools', JSON.stringify(cloudData.plannedPools));
      localStorage.setItem('apex_projects_summary', JSON.stringify(cloudData.projectsSummary));
      localStorage.setItem('apex_trolleys', JSON.stringify(cloudData.trolleys));

      alert('Item restored successfully from Recycle Bin!');
    } catch (err: any) {
      console.error('Restore recycle item failure:', err);
      alert('Failed to restore item: ' + err.message);
    }
  };

  const handleDeleteRecycleBinItem = async (id: string) => {
    if (!window.confirm('Are you sure you want to permanently empty this item from the Recycle Bin? This action is irreversible.')) {
      return;
    }
    try {
      await dbDeleteRecycleBin(id);
      
      // Update local state
      const updated = recycleBin.filter(item => item.id !== id);
      setRecycleBin(updated);
      alert('Item permanently deleted from trash.');
    } catch (err: any) {
      console.error('Delete recycle item failure:', err);
      alert('Failed to delete item: ' + err.message);
    }
  };

  // 1. Create Pool (Production Engineer)
  const handleCreatePool = (spec: {
    projectName: string;
    poolNo: string;
    orientation: PoolOrientation;
    dimensions: string;
    shape: string;
    poolType?: string;
    notes: string;
    operatorName: string;
    createdAt?: string;
  }) => {
    const newPool: Pool = {
      id: `pool_${Date.now()}`,
      projectName: spec.projectName,
      poolNo: spec.poolNo,
      orientation: spec.orientation,
      dimensions: spec.dimensions,
      shape: spec.shape,
      poolType: spec.poolType || undefined,
      notes: spec.notes,
      createdAt: spec.createdAt || new Date().toISOString(),
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
      operatorName: spec.operatorName || 'Engineer',
      notes: `Pool created & released. Specs: Orientation - ${spec.orientation}, Dims - ${spec.dimensions}, Shape - ${spec.shape}${spec.poolType ? `, Type - ${spec.poolType}` : ''}.`
    };

    const updatedPools = [...pools, newPool];
    const updatedLogs = [...logs, newLog];

    setPools(updatedPools);
    setLogs(updatedLogs);
    saveState(updatedPools, teamsRef.current, updatedLogs, inspectorsRef.current, engineersRef.current);
  };

  const handleCreatePoolBatch = (
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
        poolType: poolType || undefined,
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
      operatorName: operatorName || 'Engineer',
      notes: `Batch spawner released ${count} serialized hulls [${prefix}${startRange} to ${prefix}${startRange + count - 1}] for Project "${projectName}"${poolType ? ` (Type: ${poolType})` : ''} into fabrication queue.`
    };

    const updatedPools = [...pools, ...newPools];
    const updatedLogs = [...logs, newLog];

    setPools(updatedPools);
    setLogs(updatedLogs);
    saveState(updatedPools, teamsRef.current, updatedLogs);
  };

  // ==========================================
  // PLANNED POOL OPERATIONS (Planning Portal)
  // ==========================================
  const handleAddPlannedPool = (plannedSpec: {
    projectName: string;
    poolNo: string;
    orientation: PoolOrientation;
    dimensions: string;
    shape: string;
    poolType?: string;
    drawingUrl?: string;
    notes?: string;
    createdAt?: string;
  }) => {
    // FIX: duplicate check uses BOTH poolNo AND projectName — same number in different project is allowed
    if (plannedPools.some(p => p.poolNo.trim().toUpperCase() === plannedSpec.poolNo.trim().toUpperCase() && p.projectName.toLowerCase() === plannedSpec.projectName.toLowerCase())) {
      alert(`Pool code "${plannedSpec.poolNo}" already exists in project "${plannedSpec.projectName}" (planned queue).`);
      return false;
    }
    if (pools.some(p => p.poolNo.trim().toUpperCase() === plannedSpec.poolNo.trim().toUpperCase() && p.projectName.toLowerCase() === plannedSpec.projectName.toLowerCase())) {
      alert(`Pool code "${plannedSpec.poolNo}" already exists in project "${plannedSpec.projectName}" (active production).`);
      return false;
    }

    const newPlan: PlannedPool = {
      id: `plan_${Date.now()}`,
      projectName: plannedSpec.projectName,
      poolNo: plannedSpec.poolNo.trim().toUpperCase(),
      orientation: plannedSpec.orientation,
      dimensions: plannedSpec.dimensions || '12m x 5m',
      shape: plannedSpec.shape || 'Rectangular',
      poolType: plannedSpec.poolType || 'Type 1',
      drawingUrl: plannedSpec.drawingUrl,
      status: 'PLANNED',
      notes: plannedSpec.notes || '',
      createdAt: plannedSpec.createdAt || new Date().toISOString()
    };

    const updated = [newPlan, ...plannedPools];
    setPlannedPools(updated);
    // Use targeted save — avoids stale-closure overwrite of other collections
    localStorage.setItem('apex_planned_pools', JSON.stringify(updated));
    dbSavePlannedPool(newPlan).catch(console.error);
    return true;
  };

  const handleAddPlannedPoolBatch = (batchSpec: {
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
  }) => {
    const newPlans: PlannedPool[] = [];
    let duplicatesCount = 0;

    for (let i = 0; i < batchSpec.count; i++) {
      const numVal = batchSpec.startRange + i;
      const computedPoolNo = `${batchSpec.prefix}${numVal}`.toUpperCase();

      // FIX: duplicate check uses BOTH poolNo AND projectName
      const isDupPlanned = plannedPools.some(p => p.poolNo === computedPoolNo && p.projectName.toLowerCase() === batchSpec.projectName.toLowerCase()) || newPlans.some(p => p.poolNo === computedPoolNo);
      const isDupLive = pools.some(p => p.poolNo === computedPoolNo && p.projectName.toLowerCase() === batchSpec.projectName.toLowerCase());

      if (isDupPlanned || isDupLive) {
        duplicatesCount++;
        continue;
      }

      newPlans.push({
        id: `plan_${Date.now()}_b${i}_${Math.random().toString(36).substring(2, 6)}`,
        projectName: batchSpec.projectName,
        poolNo: computedPoolNo,
        orientation: batchSpec.orientation,
        dimensions: batchSpec.dimensions || '12m x 5m',
        shape: batchSpec.shape || 'Rectangular',
        poolType: batchSpec.poolType || 'Type 1',
        drawingUrl: batchSpec.drawingUrl,
        status: 'PLANNED',
        notes: batchSpec.notes ? `${batchSpec.notes} (Pre-planned Batch)` : 'Pre-planned Batch',
        createdAt: new Date().toISOString()
      });
    }

    if (newPlans.length === 0) {
      alert("All pool numbers in this range already exist. No new pools were generated.");
      return;
    }

    const updated = [...newPlans, ...plannedPools];
    setPlannedPools(updated);

    // Also add an activity log to trace this planning bulk entry!
    const planningLog: ActivityLog = {
      id: `log_plan_${Date.now()}`,
      timestamp: new Date().toISOString(),
      poolId: 'bulk_planning',
      poolNo: 'PLANNING',
      projectName: batchSpec.projectName,
      stageId: 'steel_fabrication',
      type: 'CREATED',
      operatorName: 'Planning Office',
      notes: `Pre-registered batch of ${newPlans.length} pools under "${batchSpec.projectName}" in planning portal. (Skipped ${duplicatesCount} duplicates)`
    };
    const updatedLogs = [planningLog, ...logs];
    setLogs(updatedLogs);
    // Use targeted saves — avoids stale-closure overwrite of other collections
    localStorage.setItem('apex_planned_pools', JSON.stringify(updated));
    localStorage.setItem('apex_logs', JSON.stringify(updatedLogs));
    newPlans.forEach(plan => dbSavePlannedPool(plan).catch(console.error));

    alert(`Successfully generated and registered ${newPlans.length} pools for project "${batchSpec.projectName}".${duplicatesCount > 0 ? ` (Skipped ${duplicatesCount} duplicates.)` : ''}`);
  };

  const handleImportPlannedPools = (importedList: {
    projectName: string;
    poolNo: string;
    orientation: PoolOrientation;
    dimensions: string;
    shape: string;
    poolType?: string;
    drawingUrl?: string;
    notes?: string;
    createdAt?: string;
  }[]) => {
    const newPlans: PlannedPool[] = [];
    let dupsCount = 0;
    const nowStr = new Date().toISOString();

    importedList.forEach((item, index) => {
      const computedPoolNo = item.poolNo.trim().toUpperCase();
      // FIX: duplicate check uses BOTH poolNo AND projectName
      const isDupPlanned = plannedPools.some(p => p.poolNo === computedPoolNo && p.projectName.toLowerCase() === item.projectName.toLowerCase()) || newPlans.some(p => p.poolNo === computedPoolNo);
      const isDupLive = pools.some(p => p.poolNo === computedPoolNo && p.projectName.toLowerCase() === item.projectName.toLowerCase());

      if (isDupPlanned || isDupLive) {
        dupsCount++;
        return;
      }

      newPlans.push({
        id: `plan_${Date.now()}_import_${index}_${Math.random().toString(36).substring(2, 6)}`,
        projectName: item.projectName || 'Excel Import',
        poolNo: computedPoolNo,
        orientation: item.orientation || 'Normal',
        dimensions: item.dimensions || '12m x 5m',
        shape: item.shape || 'Rectangular',
        poolType: item.poolType || 'Type 1',
        drawingUrl: item.drawingUrl || '',
        status: 'PLANNED',
        notes: item.notes || 'Imported from Excel',
        createdAt: item.createdAt || nowStr
      });
    });

    if (newPlans.length === 0) {
      alert(`All parsed pools in the spreadsheet already exist in register or active production.`);
      return false;
    }

    const updated = [...newPlans, ...plannedPools];
    setPlannedPools(updated);

    // Also trace it in activity logs!
    const importLog: ActivityLog = {
      id: `log_import_${Date.now()}`,
      timestamp: nowStr,
      poolId: 'bulk_import',
      poolNo: 'IMPORT',
      projectName: 'Bulk Projects',
      type: 'CREATED',
      stageId: 'steel_fabrication',
      notes: `Imported ${newPlans.length} pool designs from Excel file. Filtered out ${dupsCount} duplicates.`,
      operatorName: 'Planning Office Staff'
    };
    const updatedLogs = [importLog, ...logs];
    setLogs(updatedLogs);

    // Save full state to Firestore — this triggers snapshot on all devices
    saveState(
      poolsRef.current,
      teamsRef.current,
      updatedLogs,
      inspectorsRef.current,
      engineersRef.current,
      updated,
      projectsSummaryRef.current,
      monthlyTargetsRef.current,
      employeesRef.current
    );

    alert(`Success! Imported ${newPlans.length} pools from Excel successfully.${dupsCount > 0 ? ` Filtered out ${dupsCount} duplicate codes.` : ''}`);
    return true;
  };

  const handleUpdatePlannedPool = (planId: string, updatedFields: { projectName?: string }) => {
    const idx = plannedPools.findIndex(p => p.id === planId);
    if (idx === -1) return;
    const updated = [...plannedPools];
    updated[idx] = { ...updated[idx], ...updatedFields };
    setPlannedPools(updated);
    localStorage.setItem('apex_planned_pools', JSON.stringify(updated));
    dbSavePlannedPool(updated[idx]).catch(console.error);
  };

  const handleDeletePlannedPool = async (planId: string) => {
    const design = plannedPools.find(p => p.id === planId);
    if (!design) return;
    if (design.status !== 'PLANNED') {
      alert("Cannot delete a released or completed pool from the planning list.");
      return;
    }
    if (!window.confirm(`Remove pre-planned pool ${design.poolNo} from the index?`)) return;

    // Save to Recycle Bin
    const trashItem: RecycleBinItem = {
      id: `planned_pool_trash_${planId}_${Date.now()}`,
      dataType: 'planned_pool',
      deletedAt: new Date().toISOString(),
      payload: design
    };
    await dbAddRecycleBin(trashItem).catch(console.error);

    const updated = plannedPools.filter(p => p.id !== planId);
    setPlannedPools(updated);
    // Use targeted save — avoids stale-closure overwrite of other collections
    localStorage.setItem('apex_planned_pools', JSON.stringify(updated));

    // Call Delete API endpoint direct if it has database reference
    await dbDeletePlannedPool(planId).catch(console.error);

    // Refresh recycle bin state
    const cloudData = await getEntireStateFromFirestore().catch(() => null);
    if (cloudData && cloudData.recycleBin) {
      setRecycleBin(cloudData.recycleBin);
    }
  };

  const handleReleasePlannedPool = (planId: string, operatorName: string) => {
    const designIndex = plannedPools.findIndex(p => p.id === planId);
    if (designIndex === -1) return null;
    const design = plannedPools[designIndex];
    if (design.status !== 'PLANNED') {
      alert("This pool shell is already released or completed.");
      return null;
    }

    // Now spawn the LIVE pool card
    const livePoolId = `pool_${Date.now()}`;
    const newPool: Pool = {
      id: livePoolId,
      projectName: design.projectName,
      poolNo: design.poolNo,
      orientation: design.orientation,
      dimensions: design.dimensions,
      shape: design.shape,
      poolType: design.poolType || 'Type 1',
      drawingUrl: design.drawingUrl,
      notes: design.notes ? `${design.notes} (Source: Planning Portal)` : 'Source: Planning Portal',
      createdAt: new Date().toISOString(),
      completedAt: null,
      currentStageIndex: 0, // Starts at Steel Fabrication
      stageHistory: createEmptyHistory()
    };

    // Update plannedPool status
    const updatedPlans = [...plannedPools];
    updatedPlans[designIndex] = {
      ...design,
      status: 'RELEASED',
      releasedPoolId: livePoolId
    };

    // Audit log
    const newLog: ActivityLog = {
      id: `log_release_${Date.now()}`,
      timestamp: new Date().toISOString(),
      poolId: livePoolId,
      poolNo: design.poolNo,
      projectName: design.projectName,
      stageId: 'steel_fabrication',
      type: 'CREATED',
      operatorName: operatorName || 'Planning Office',
      notes: `Released Pre-Planned Pool [${design.poolNo}] into active fabrication. Current stage: Steel Fabrication.`
    };

    const updatedPools = [...pools, newPool];
    const updatedLogs = [newLog, ...logs];

    setPools(updatedPools);
    setPlannedPools(updatedPlans);
    setLogs(updatedLogs);
    saveState(updatedPools, teamsRef.current, updatedLogs, inspectorsRef.current, engineersRef.current, updatedPlans, projectsSummaryRef.current, monthlyTargetsRef.current, employeesRef.current);
    // Also targeted-save the planned pool status update
    dbSavePlannedPool(updatedPlans[designIndex]).catch(console.error);
    return livePoolId;
  };

  // 2. Claim Pool (Stage worker claims available pool card)
  const handleClaimPool = (poolId: string, teamId: string, stageId: StageId) => {
    // RACE-FIX (v9): read from the always-fresh refs, not this render's
    // closure, so a rapid follow-up action never overwrites this one.
    const pools = poolsRef.current;
    const teams = teamsRef.current;
    const logs = logsRef.current;
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
  const handleStartStage = (poolId: string, stageId: StageId, customDateTime?: string) => {
    const pools = poolsRef.current;
    const teams = teamsRef.current;
    const logs = logsRef.current;
    const poolIndex = pools.findIndex(p => p.id === poolId);
    if (poolIndex === -1) return;

    const updatedPools = [...pools];
    const pool = updatedPools[poolIndex];
    const stageHist = { ...pool.stageHistory[stageId] };
    stageHist.status = 'IN_PROGRESS';
    stageHist.startTime = customDateTime || new Date().toISOString();
    pool.stageHistory[stageId] = stageHist;

    const team = teams.find(t => t.id === stageHist.teamId);

    const newLog: ActivityLog = {
      id: `log_${Date.now()}`,
      timestamp: customDateTime || new Date().toISOString(),
      poolId: pool.id,
      poolNo: pool.poolNo,
      projectName: pool.projectName,
      stageId,
      type: 'STAGE_STARTED',
      teamName: team?.name,
      operatorName: team?.name || 'Shop Floor Team',
      notes: `Started stage fabrication timer on the floor.${customDateTime ? ' (Backdated entry)' : ''}`
    };

    const updatedLogs = [...logs, newLog];
    setPools(updatedPools);
    setLogs(updatedLogs);
    saveState(updatedPools, teamsRef.current, updatedLogs);
  };

  // 4. Complete / Finish Stage (Promotes to QA validation)
  const handleFinishStage = (poolId: string, stageId: StageId, customDateTime?: string) => {
    const pools = poolsRef.current;
    const teams = teamsRef.current;
    const logs = logsRef.current;
    const poolIndex = pools.findIndex(p => p.id === poolId);
    if (poolIndex === -1) return;

    const updatedPools = [...pools];
    const pool = updatedPools[poolIndex];
    const stageHist = { ...pool.stageHistory[stageId] };
    
    stageHist.status = 'PENDING_INSPECTION';
    const nowStr = customDateTime || new Date().toISOString();
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
      notes: `Stage fabrication completed in ${stageHist.durationMinutes} mins. Sent to Quality Inspection Queue.${customDateTime ? ' (Backdated entry)' : ''}`
    };

    const updatedLogs = [...logs, newLog];
    setPools(updatedPools);
    setLogs(updatedLogs);
    saveState(updatedPools, teamsRef.current, updatedLogs);
  };

  // 5. Approve Stage (By Quality Inspector)
  const handleApproveStage = (poolId: string, stageId: StageId, inspectorId: string, notes: string, inspectorPicture?: string) => {
    const pools = poolsRef.current;
    const teams = teamsRef.current;
    const logs = logsRef.current;
    const plannedPools = plannedPoolsRef.current;
    const inspectors = inspectorsRef.current;
    const engineers = engineersRef.current;
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
    stageHist.inspectorPicture = inspectorPicture;
    pool.stageHistory[stageId] = stageHist;

    const originalWorkspecTeamId = stageHist.teamId;

    // Release the assigned team from BUSY state
    const updatedTeams = teams.map(t => {
      if (t.id === originalWorkspecTeamId) {
        return { ...t, status: 'IDLE' as const, activePoolId: null };
      }
      return t;
    });

    const stageIndex = STAGES.findIndex(s => s.id === stageId);
    let updatedPlans = [...plannedPools];
    let unlockedStageName = 'Final Completion Shipment';
    let advanced = false;

    if (DUAL_STAGE_IDS.includes(stageId)) {
      // Skimmer Fitting & Lamination run in parallel off the same gate index.
      // Only move the pool forward once BOTH siblings are QC-approved.
      const gateIdx = STAGES.findIndex(s => s.id === DUAL_STAGE_IDS[0]);
      if (isAtDualStageGate(pool.currentStageIndex)) {
        const siblingId = DUAL_STAGE_IDS.find(id => id !== stageId)!;
        const siblingApproved = pool.stageHistory[siblingId]?.status === 'APPROVED';
        if (siblingApproved) {
          const nextIndex = gateIdx + DUAL_STAGE_IDS.length; // past both dual stages
          pool.currentStageIndex = nextIndex;
          advanced = true;
          unlockedStageName = nextIndex < STAGES.length ? STAGES[nextIndex].name : 'Final Completion Shipment';
          if (nextIndex >= STAGES.length) {
            pool.completedAt = new Date().toISOString();
            updatedPlans = plannedPools.map(pp =>
              pp.releasedPoolId === pool.id ? { ...pp, status: 'COMPLETED' as const } : pp
            );
            setPlannedPools(updatedPlans);
          }
        }
      }
    } else {
      const nextIndex = stageIndex + 1;
      if (stageIndex === pool.currentStageIndex) {
        // Advance pool to the next stage index
        pool.currentStageIndex = nextIndex;
        advanced = true;
        unlockedStageName = nextIndex < STAGES.length ? STAGES[nextIndex].name : 'Final Completion Shipment';

        // If advanced past all stages, stamp completedAt and update corresponding PlannedPool
        if (nextIndex >= STAGES.length) {
          pool.completedAt = new Date().toISOString();
          updatedPlans = plannedPools.map(pp => 
            pp.releasedPoolId === pool.id ? { ...pp, status: 'COMPLETED' as const } : pp
          );
          setPlannedPools(updatedPlans);
        }
      }
    }

    const dualWaitingNote = DUAL_STAGE_IDS.includes(stageId) && !advanced
      ? ` Waiting on parallel stage "${STAGES.find(s => s.id === DUAL_STAGE_IDS.find(id => id !== stageId))?.name}" before advancing.`
      : '';

    const newLog: ActivityLog = {
      id: `log_${Date.now()}`,
      timestamp: new Date().toISOString(),
      poolId: pool.id,
      poolNo: pool.poolNo,
      projectName: pool.projectName,
      stageId,
      type: 'APPROVED',
      operatorName: inspectorId,
      notes: `QC APPROVED: ${notes}.${advanced ? ` Unlocked stage: ${unlockedStageName}` : ' Stage signed off.'}${dualWaitingNote}`,
      inspectorPicture
    };

    const updatedLogs = [...logs, newLog];

    setPools(updatedPools);
    setTeams(updatedTeams);
    setLogs(updatedLogs);
    saveState(updatedPools, updatedTeams, updatedLogs, inspectorsRef.current, engineersRef.current, updatedPlans);
  };

  // 6. Reject Stage (Sends pool back for rework)
  const handleRejectStage = (poolId: string, stageId: StageId, inspectorId: string, notes: string, inspectorPicture?: string) => {
    const pools = poolsRef.current;
    const teams = teamsRef.current;
    const logs = logsRef.current;
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
    stageHist.inspectorPicture = inspectorPicture;
    
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
      notes: `QC REJECTED: ${notes}. Returned to Available stage queue for re-finishing.`,
      inspectorPicture
    };

    const updatedLogs = [...logs, newLog];

    setPools(updatedPools);
    setTeams(updatedTeams);
    setLogs(updatedLogs);
    saveState(updatedPools, updatedTeams, updatedLogs);
  };

  // ── Request Undo Claim (from Shop Floor worker) ───────────────────────────────
  const handleRequestUndoClaim = (poolId: string, stageId: StageId, teamName: string, reason: string) => {
    const pools = poolsRef.current;
    const pool = pools.find(p => p.id === poolId);
    if (!pool) return;
    const stage = STAGES.find(s => s.id === stageId);
    const newRequest = {
      id: `undo_${Date.now()}`,
      poolId,
      poolNo: pool.poolNo,
      projectName: pool.projectName,
      stageId,
      stageName: stage?.name || stageId,
      teamName,
      reason,
      requestedAt: new Date().toISOString(),
    };
    const updated = [newRequest, ...pendingUndoRequests];
    setPendingUndoRequests(updated);
    localStorage.setItem('pending_undo_requests', JSON.stringify(updated));
    // BUGFIX: this used to be localStorage-only, so an undo request made on
    // PC-1 never showed up on PC-2/PC-3 (the QA portal on another device had
    // no way to know about it). Now pushed to Firestore like every other
    // collection so it shows up live everywhere.
    saveChangedCollectionsToFirestore({ undoRequests: { upserts: [newRequest], deletedIds: [] } })
      .catch(err => console.error('Failed to sync undo request to cloud:', err));
    alert(`✅ Request sent to QA! They will review and unclaim pool ${pool.poolNo} so you can re-pick it.`);
  };

  // ── QA Approves Undo (unclaims the pool stage so correct team can pick) ──────
  const handleApproveUndo = (requestId: string, poolId: string, stageId: StageId, inspectorName: string) => {
    const pools = poolsRef.current;
    const teams = teamsRef.current;
    const logs = logsRef.current;
    const inspectors = inspectorsRef.current;
    const engineers = engineersRef.current;
    const plannedPools = plannedPoolsRef.current;
    const poolIndex = pools.findIndex(p => p.id === poolId);
    if (poolIndex === -1) return;

    const updatedPools = [...pools];
    const pool = { ...updatedPools[poolIndex] };
    const stageHist = { ...pool.stageHistory[stageId] };

    // Reset the stage so any team can claim it again
    stageHist.teamId = null as any;
    stageHist.status = 'NOT_STARTED';
    stageHist.startTime = null as any;
    stageHist.endTime = null as any;
    pool.stageHistory[stageId] = stageHist;

    // Also free the team that was assigned
    const updatedTeams = teams.map(t =>
      t.activePoolId === poolId && t.stageId === stageId
        ? { ...t, status: 'IDLE' as const, activePoolId: null }
        : t
    );

    updatedPools[poolIndex] = pool;

    const newLog: any = {
      id: `log_${Date.now()}`,
      timestamp: new Date().toISOString(),
      poolId: pool.id,
      poolNo: pool.poolNo,
      projectName: pool.projectName,
      stageId,
      type: 'QA_UNDO_CLAIM',
      operatorName: inspectorName,
      notes: `QA approved undo claim. Pool unclaimed and reset for re-assignment.`
    };

    const updatedLogs = [...logs, newLog];
    setPools(updatedPools);
    setTeams(updatedTeams);
    setLogs(updatedLogs);
    saveState(updatedPools, updatedTeams, updatedLogs, inspectorsRef.current, engineersRef.current, plannedPoolsRef.current);

    // Remove from pending requests
    const updatedRequests = pendingUndoRequests.filter(r => r.id !== requestId);
    setPendingUndoRequests(updatedRequests);
    localStorage.setItem('pending_undo_requests', JSON.stringify(updatedRequests));
    saveChangedCollectionsToFirestore({ undoRequests: { upserts: [], deletedIds: [requestId] } })
      .catch(err => console.error('Failed to sync undo approval to cloud:', err));
  };

  // ── QA Rejects Undo ───────────────────────────────────────────────────────────
  const handleRejectUndo = (requestId: string) => {
    const updatedRequests = pendingUndoRequests.filter(r => r.id !== requestId);
    setPendingUndoRequests(updatedRequests);
    localStorage.setItem('pending_undo_requests', JSON.stringify(updatedRequests));
    saveChangedCollectionsToFirestore({ undoRequests: { upserts: [], deletedIds: [requestId] } })
      .catch(err => console.error('Failed to sync undo rejection to cloud:', err));
  };

  const handleSkipOrCarryOnSite = (poolId: string, stageId: StageId, option: 'SKIPPED' | 'CARRIED_ON_SITE', operatorName: string) => {
    const pools = poolsRef.current;
    const teams = teamsRef.current;
    const logs = logsRef.current;
    const plannedPools = plannedPoolsRef.current;
    const inspectors = inspectorsRef.current;
    const engineers = engineersRef.current;
    const poolIndex = pools.findIndex(p => p.id === poolId);
    if (poolIndex === -1) return;

    const updatedPools = [...pools];
    const pool = updatedPools[poolIndex];
    const stageHist = { ...pool.stageHistory[stageId] };

    // Record skipped / custom carry status
    stageHist.status = option;
    stageHist.endTime = new Date().toISOString();
    stageHist.inspectorId = operatorName;
    stageHist.inspectorNotes = option === 'SKIPPED' ? 'Skipped this section for now' : 'Will be carry on site';
    stageHist.inspectionTime = new Date().toISOString();
    pool.stageHistory[stageId] = stageHist;

    const originalWorkspecTeamId = stageHist.teamId;

    // Release team if assigned to BUSY status
    const updatedTeams = teams.map(t => {
      if (t.id === originalWorkspecTeamId) {
        return { ...t, status: 'IDLE' as const, activePoolId: null };
      }
      return t;
    });

    // Advance pool to the next stage index
    const stageIndex = STAGES.findIndex(s => s.id === stageId);
    let updatedPlans = [...plannedPools];
    const nextIndex = stageIndex + 1;
    if (stageIndex === pool.currentStageIndex) {
      pool.currentStageIndex = nextIndex;

      if (nextIndex >= STAGES.length) {
        pool.completedAt = new Date().toISOString();
        updatedPlans = plannedPools.map(pp => 
          pp.releasedPoolId === pool.id ? { ...pp, status: 'COMPLETED' as const } : pp
        );
        setPlannedPools(updatedPlans);
      }
    }

    const labelStr = option === 'SKIPPED' ? 'SKIPPED FOR NOW' : 'WILL BE CARRY ON SITE';
    const newLog: ActivityLog = {
      id: `log_${Date.now()}`,
      timestamp: new Date().toISOString(),
      poolId: pool.id,
      poolNo: pool.poolNo,
      projectName: pool.projectName,
      stageId,
      type: 'APPROVED',
      operatorName,
      notes: `STAGE DISPATCH ACTION: Marked as ${labelStr}. Advanced and unlocked next stage: ${nextIndex < STAGES.length ? STAGES[nextIndex].name : 'Finished Shipment'}`
    };

    const updatedLogs = [...logs, newLog];

    setPools(updatedPools);
    setTeams(updatedTeams);
    setLogs(updatedLogs);
    saveState(updatedPools, updatedTeams, updatedLogs, inspectorsRef.current, engineersRef.current, updatedPlans);
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

  if (!loggedInUser) {
    return <LoginScreen onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans selection:bg-blue-250 antialiased">

      {/* Always-visible top bar: hamburger opens the portal drawer, logo + name centered */}
      <TopBar onMenuClick={() => setNavOpen(true)} />

      {/* Portal drawer — hidden until the hamburger is tapped, then overlays
          the screen. This replaces the old permanent left sidebar, so every
          portal now gets the full screen by default. */}
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
        stationLock={stationLock}
        loggedInUser={loggedInUser}
        onLogout={handleLogout}
        isOpen={navOpen}
        onClose={() => setNavOpen(false)}
      />

      {/* Global Page Up / Page Down floating buttons — visible on all portals */}
      <ScrollButtons />

      <div className="flex-1 min-w-0 flex flex-col justify-between">

      {/* Station Lock Overlay Banner */}
      {stationLock.isLocked && (
        <div className="bg-amber-500 border-b border-amber-600/30 text-slate-950 px-4 py-2 text-xs font-black flex items-center justify-between shadow-md">
          <div className="flex items-center gap-2">
            <span className="inline-block p-1 bg-amber-600 text-amber-50 rounded-md animate-pulse">
              <ShieldAlert className="h-4 w-4" />
            </span>
            <span className="uppercase tracking-wider font-mono">
              🔒 Section Workstation Locked Mode: {
                (stationLock.allowedRoles && stationLock.allowedRoles.length > 1) ? (
                  `Dedicated Multi-Portal (${stationLock.allowedRoles.map(r => 
                    r === 'stage_worker' ? 'Stage Shop Floor' : 
                    r === 'trolley_prod' ? 'Trolley Ledger' : r
                  ).join(' + ')})`
                ) : (
                  stationLock.role === 'management' ? 'Management Center Only' :
                  stationLock.role === 'trolley_prod' ? 'Trolley Production Ledger' :
                  stationLock.role === 'planning_department' ? 'Planning Dept. Portal' :
                  stationLock.role === 'quality_inspector' ? 'Quality Assurance Panel' :
                  stationLock.role === 'production_engineer' ? 'Production Eng. Release' :
                  stationLock.role === 'section_dashboard' ? 'Section TV Display' :
                  stationLock.role === 'factory_entrance' ? 'Factory Entrance TV' :
                  `${STAGES.find(s => s.id === stationLock.stageId)?.name || 'Stage Floor'} Terminal`
                )
              }
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] bg-slate-950 text-amber-400 font-mono px-2 py-0.5 rounded uppercase font-black">
              Authorized Device Input
            </span>
            <button
              onClick={() => {
                setUnlockError(null);
                setUnlockPinInput('');
                setIsUnlockModalOpen(true);
              }}
              className="bg-slate-950 hover:bg-slate-800 text-white hover:text-cyan-300 font-bold px-3 py-1 text-[11px] rounded-lg cursor-pointer transition-colors"
            >
              Unlock Terminal
            </button>
          </div>
        </div>
      )}

      {/* Simulation Helper banner */}
      <div className="bg-slate-900 border-b border-slate-800 py-2.5 px-4 text-[11px] text-slate-350">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="px-2 py-0.5 bg-cyan-900/30 text-cyan-400 border border-cyan-800 rounded font-bold font-mono text-[10px]">
              ROLEPLAY SIMULATOR MODE
            </span>
            
            {/* Cloud SQL/Firestore Sync Status Badge */}
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-800/60 border border-slate-700/80 font-mono text-[10px]">
              {firebaseStatus === 'linking' && (
                <>
                  <RefreshCw className="h-3 w-3 text-amber-400 animate-spin" />
                  <span className="text-amber-300">
                    {((import.meta as any).env?.VITE_API_URL) ? 'Cloud SQL Connecting...' : 'Firestore Connecting...'}
                  </span>
                </>
              )}
              {firebaseStatus === 'connected' && (
                <>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  <span className="text-emerald-400 font-bold">
                    {((import.meta as any).env?.VITE_API_URL) ? 'Cloud SQL Synced' : 'Firestore Live Connection'}
                  </span>
                </>
              )}
              {firebaseStatus === 'error' && (
                <>
                  <WifiOff className="h-3 w-3 text-rose-400 shrink-0" />
                  <span className="text-rose-400 font-bold" title={firebaseError || 'Cloud SQL limited access mode'}>
                    Local Mode (Backup Only)
                  </span>
                </>
              )}
            </div>

            <span className="text-slate-400 hidden xl:inline">
              | Switch roles using the portal buttons to test the cross-functional pipeline in real-time.
            </span>
          </div>

        </div>
      </div>

      {/* Central View Dashboard Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <RoleContextPanel
          currentRole={currentRole}
          selectedStageId={selectedStageId}
          onChangeStage={handleStageChange}
          workerTeamId={workerTeamId}
          onChangeWorkerTeam={setWorkerTeamId}
          allTeams={teams}
          stationLock={stationLock}
        />
        {currentRole === 'planning_department' && (
          <PlanningDepartment
            plannedPools={plannedPools}
            pools={pools}
            onAddPlannedPool={handleAddPlannedPool}
            onAddPlannedPoolBatch={handleAddPlannedPoolBatch}
            onDeletePlannedPool={handleDeletePlannedPool}
            onUpdatePlannedPool={handleUpdatePlannedPool}
            onReleasePlannedPool={handleReleasePlannedPool}
            engineers={engineers}
            inspectors={inspectors}
            onSaveInspector={handleSaveInspector}
            onDeleteInspector={handleDeleteInspector}
            onSaveEngineer={handleSaveEngineer}
            onDeleteEngineer={handleDeleteEngineer}
            projectsSummary={projectsSummary}
            onSaveProjectSummary={handleSaveProjectSummary}
            onDeleteProjectSummary={handleDeleteProjectSummary}
            monthlyTargets={monthlyTargets}
            onSaveMonthlyTarget={handleSaveMonthlyTarget}
            onDeleteMonthlyTarget={handleDeleteMonthlyTarget}
            onDirectOverridePool={handleDirectOverridePool}
            onDeletePool={handleDeletePool}
            onAddPlannedPoolsList={handleImportPlannedPools}
            onDirectOverridePoolsBatch={handleDirectOverridePoolsBatch}
          />
        )}

        {currentRole === 'production_engineer' && (
          <ProductionEngineer
            pools={pools}
            onCreatePool={handleCreatePool}
            onCreatePoolBatch={handleCreatePoolBatch}
            engineers={engineers}
            plannedPools={plannedPools}
            onReleasePlannedPool={handleReleasePlannedPool}
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
            onSkipOrCarryOnSite={handleSkipOrCarryOnSite}
            onRequestUndoClaim={handleRequestUndoClaim}
            onRefresh={refreshFromCloud}
            isSyncing={isSyncing}
            qcDefects={qcDefects}
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
            onSkipOrCarryOnSite={handleSkipOrCarryOnSite}
            pendingUndoRequests={pendingUndoRequests}
            onApproveUndo={handleApproveUndo}
            onRejectUndo={handleRejectUndo}
            onRefresh={refreshFromCloud}
            isSyncing={isSyncing}
            qcDefects={qcDefects}
            onLogDefect={handleLogDefect}
            onUpdateDefectStatus={handleUpdateDefectStatus}
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
            stationLock={stationLock}
            onLockStation={handleLockStation}
            onUnlockStation={handleUnlockStation}
            onRequestUnlock={() => setIsUnlockModalOpen(true)}
            onPurgeAllData={handlePurgeAllData}
            recycleBin={recycleBin}
            onPurgePoolRelatedData={handlePurgePoolRelatedData}
            onRestoreRecycleBinItem={handleRestoreRecycleBinItem}
            onDeleteRecycleBinItem={handleDeleteRecycleBinItem}
            projectsSummary={projectsSummary}
            monthlyTargets={monthlyTargets}
            employees={employees}
            plannedPools={plannedPools}
            trolleys={trolleys}
            onSaveEmployee={handleSaveEmployee}
            onDeleteEmployee={handleDeleteEmployee}
            onDeleteProjectSummary={handleDeleteProjectSummary}
            onDeletePlannedPool={handleDeletePlannedPool}
            onDeletePool={handleDeletePool}
            onDeleteTrolley={handleDeleteTrolley}
            employeePunches={employeePunches}
            onAddEmployeePunch={handleSaveEmployeePunch}
            onDeleteEmployeePunch={handleDeleteEmployeePunch}
            onAddEmployeePunchesBulk={handleSaveEmployeePunchesBulk}
            onAddEmployeesBulk={handleSaveEmployeesBulk}
            onClearAllEmployeePunches={handleClearAllEmployeePunches}
            onDeleteEmployeePunchesByDate={handleDeleteEmployeePunchesByDate}
            onRefreshAll={refreshAllFromCloud}
            isFullSyncing={isFullSyncing}
            lastSyncTime={lastSyncTime}
          />
        )}

        {currentRole === 'section_dashboard' && (
          <SectionDashboardTV
            pools={pools}
            teams={teams}
            logs={logs}
          />
        )}

        {currentRole === 'trolley_prod' && (
          <TrolleyProductionTracker
            trolleys={trolleys}
            onSaveTrolley={handleSaveTrolley}
            onDeleteTrolley={handleDeleteTrolley}
          />
        )}

        {/* ← PASTE THIS NEW BLOCK HERE (line 2330) */}
        {currentRole === 'hr_portal' && (
          <HRPortal
            employees={employees}
            employeePunches={employeePunches}
            onSaveEmployee={handleSaveEmployee}
            onDeleteEmployee={handleDeleteEmployee}
            currentUserName={loggedInUser?.displayName}
          />
        )}

        {currentRole === 'store' && (
          <StoreModule
            currentUserName={loggedInUser?.displayName || 'Manager'}
            projectNames={Array.from(new Set([...pools, ...plannedPools].map(p => p.projectName).filter(Boolean)))}
            poolTypesByProject={[...pools, ...plannedPools].reduce((acc: Record<string, string[]>, p) => {
              if (!p.projectName || !p.poolType) return acc;
              if (!acc[p.projectName]) acc[p.projectName] = [];
              if (!acc[p.projectName].includes(p.poolType)) acc[p.projectName].push(p.poolType);
              return acc;
            }, {})}
          />
        )}

        {currentRole === 'section_supervisor' && (
          <SupervisorPortal
            currentUserName={loggedInUser?.displayName || 'Supervisor'}
            projectNames={Array.from(new Set([...pools, ...plannedPools].map(p => p.projectName).filter(Boolean)))}
            poolTypesByProject={[...pools, ...plannedPools].reduce((acc: Record<string, string[]>, p) => {
              if (!p.projectName || !p.poolType) return acc;
              if (!acc[p.projectName]) acc[p.projectName] = [];
              if (!acc[p.projectName].includes(p.poolType)) acc[p.projectName].push(p.poolType);
              return acc;
            }, {})}
          />
        )}

        {currentRole === 'reports_analytics' && (
          <ReportsAndAnalytics
            pools={pools}
            plannedPools={plannedPools}
            projectsSummary={projectsSummary}
            monthlyTargets={monthlyTargets}
            employees={employees}
            logs={logs}
            teams={teams}
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

      {/* Floating QR Scanner trigger — handy for shop floor quick lookup */}
      {loggedInUser && (
        <button
          onClick={() => setIsScannerOpen(true)}
          data-testid="qr-scanner-fab"
          className="fixed bottom-6 right-6 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full p-4 shadow-2xl shadow-indigo-900/30 transition-all hover:scale-110 cursor-pointer z-40"
          title="Scan Pool QR Code"
        >
          <Camera className="h-5 w-5" />
        </button>
      )}

      {/* QR Scanner overlay */}
      {isScannerOpen && (
        <QRScanner
          pools={pools}
          onPoolDetected={(pool) => {
            setScannedPoolId(pool.id);
            setIsScannerOpen(false);
            // If user is QA or stage worker, switch to their view; otherwise show alert
            alert(`Scanned: Pool ${pool.poolNo} (${pool.projectName})\nCurrent stage: ${STAGES[pool.currentStageIndex]?.name || 'Done'}`);
          }}
          onClose={() => setIsScannerOpen(false)}
        />
      )}

      {/* Dynamic Iframe-Safe Custom Unlock PIN Modal Overlay */}
      {isUnlockModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-xs p-4 animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 text-slate-100 w-full max-w-sm rounded-2xl shadow-2xl p-6 relative overflow-hidden">
            {/* Header decor bar */}
            <div className="absolute top-0 left-0 right-0 h-1.5 bg-amber-500" />
            
            <div className="text-center space-y-2 mb-6">
              <div className="inline-flex p-3 bg-amber-500/10 border border-amber-500/20 text-amber-500 rounded-full mb-1">
                <ShieldAlert className="h-6 w-6 animate-pulse" />
              </div>
              <h3 className="text-lg font-black tracking-tight text-white uppercase">
                Authorize Terminal Unlock
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                To exit workstation-locked mode and restore full site-wide management permissions, input your Security PIN block.
              </p>
            </div>

            <form onSubmit={(e) => {
              e.preventDefault();
              handleUnlockStation(unlockPinInput);
            }} className="space-y-4">
              
              <div className="space-y-2">
                <input
                  type="password"
                  maxLength={8}
                  autoFocus
                  placeholder="PIN"
                  value={unlockPinInput}
                  onChange={(e) => {
                    setUnlockError(null);
                    setUnlockPinInput(e.target.value.replace(/\D/g, ''));
                  }}
                  className="w-full text-center bg-slate-950 border border-slate-800 text-2xl font-black font-mono tracking-[0.5em] text-cyan-400 placeholder:text-slate-700 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                />
                
                {unlockError && (
                  <p className="text-xs text-rose-400 font-bold text-center bg-rose-950/20 py-1.5 px-2 rounded-lg border border-rose-900/40 animate-pulse">
                    ⚠️ {unlockError}
                  </p>
                )}
              </div>

              {/* Numerical Quick Touchpad key block */}
              <div className="grid grid-cols-3 gap-2">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => {
                      setUnlockError(null);
                      if (unlockPinInput.length < 8) {
                        setUnlockPinInput(prev => prev + num);
                      }
                    }}
                    className="py-2.5 bg-slate-800/60 hover:bg-slate-800 border border-slate-700/40 text-sm font-black rounded-lg cursor-pointer transition-all active:scale-95"
                  >
                    {num}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setUnlockError(null);
                    setUnlockPinInput('');
                  }}
                  className="py-2.5 bg-slate-800/20 hover:bg-slate-800/45 text-xs text-slate-400 font-bold rounded-lg cursor-pointer transition-all"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUnlockError(null);
                    if (unlockPinInput.length < 8) {
                      setUnlockPinInput(prev => prev + '0');
                    }
                  }}
                  className="py-2.5 bg-slate-800/60 hover:bg-slate-800 border border-slate-700/40 text-sm font-black rounded-lg cursor-pointer transition-all active:scale-95"
                >
                  0
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUnlockError(null);
                    setUnlockPinInput(prev => prev.slice(0, -1));
                  }}
                  className="py-2.5 bg-slate-800/20 hover:bg-slate-800/45 text-xs text-slate-400 font-bold rounded-lg cursor-pointer transition-all"
                >
                  Delete
                </button>
              </div>

              <div className="pt-2 flex flex-col gap-2">
                <button
                  type="submit"
                  disabled={!unlockPinInput}
                  className="w-full bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-black text-xs py-3 rounded-lg uppercase tracking-wider cursor-pointer transition-all"
                >
                  Submit PIN Code
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsUnlockModalOpen(false);
                    setUnlockPinInput('');
                    setUnlockError(null);
                  }}
                  className="w-full bg-slate-800/40 hover:bg-slate-800 text-slate-300 font-bold text-xs py-2 rounded-lg cursor-pointer transition-all"
                >
                  Cancel
                </button>
              </div>

              {/* Non-brick Safety Emergency Bypass Section */}
              <div className="pt-3 border-t border-slate-800 text-center space-y-1.5">
                <p className="text-[10px] text-slate-500">
                  Forgot PIN? Default setup code is <span className="text-slate-300 font-mono font-bold">1234</span>
                </p>
                <button
                  type="button"
                  onClick={() => {
                    handleEmergencyUnlock();
                  }}
                  className="text-[10px] text-amber-500/80 hover:text-amber-400 underline cursor-pointer font-bold transition-all block mx-auto"
                >
                  Emergency Bypass (Forced Unlock)
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* Google Auth Global Status Overlay / Toast */}
      {authNotification && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-md w-full shadow-2xl relative text-slate-100 space-y-4">
            <button 
              onClick={() => setAuthNotification(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-100 cursor-pointer p-1 rounded-full hover:bg-slate-800 transition-all"
            >
              <X className="h-4 w-4" />
            </button>
            
            <div className="flex items-start gap-4">
              {authNotification.type === 'success' ? (
                <div className="p-2.5 bg-emerald-500/10 rounded-xl text-emerald-400 shrink-0">
                  <CheckCircle2 className="h-6 w-6" />
                </div>
              ) : authNotification.type === 'error' ? (
                <div className="p-2.5 bg-amber-500/10 rounded-xl text-amber-400 shrink-0">
                  <AlertCircle className="h-6 w-6" />
                </div>
              ) : (
                <div className="p-2.5 bg-blue-500/10 rounded-xl text-blue-400 shrink-0">
                  <Info className="h-6 w-6" />
                </div>
              )}
              
              <div className="space-y-1 flex-1">
                <h3 className="text-sm font-black text-white tracking-tight uppercase">
                  {authNotification.title}
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed font-sans font-medium">
                  {authNotification.message}
                </p>
              </div>
            </div>
            
            {authNotification.isAuthError ? (
              <div className="pt-3 border-t border-slate-800 space-y-2">
                <button
                  onClick={() => {
                    setAuthNotification(null);
                    handleGoogleSignInRedirect();
                  }}
                  className="w-full bg-indigo-650 hover:bg-indigo-700 bg-indigo-600 text-white font-bold text-xs py-2.5 rounded-xl cursor-pointer transition-all uppercase tracking-wider font-mono shadow-sm flex items-center justify-center gap-1.5"
                >
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Use Redirect Sign-In
                </button>
                <button
                  onClick={() => {
                    window.open(window.location.href, '_blank');
                  }}
                  className="w-full bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs py-2.5 rounded-xl cursor-pointer transition-all uppercase tracking-wider font-mono shadow-sm flex items-center justify-center gap-1.5"
                >
                  <Info className="h-3.5 w-3.5" /> Open App in New Tab (Prevents Blocks)
                </button>
                <button
                  onClick={() => {
                    setAuthNotification(null);
                    handleGoogleSignIn();
                  }}
                  className="w-full bg-slate-800/50 hover:bg-slate-800 text-slate-300 font-bold text-xs py-2 rounded-xl cursor-pointer transition-all uppercase tracking-normal"
                >
                  Retry Original popup
                </button>
                <button
                  onClick={() => setAuthNotification(null)}
                  className="w-full text-slate-500 hover:text-slate-400 font-bold text-[11px] pt-1"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="pt-2">
                <button
                  onClick={() => setAuthNotification(null)}
                  className="w-full bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs py-2.5 rounded-xl cursor-pointer transition-all uppercase tracking-wider font-mono shadow-sm"
                >
                  Acknowledge
                </button>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
