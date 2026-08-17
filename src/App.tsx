import { useState, useEffect, useRef } from 'react';
import { Pool, StageId, Team, ActivityLog, ViewRole, PoolOrientation, PlannedPool, ProjectSummary, MonthlyTarget, Employee, TrolleyProduction, RecycleBinItem, EmployeePunch, COMPANIES } from './types';
import StoreModule from './components/StoreModule';
import { ScrollButtons } from './components/ScrollButtons';
import SupervisorPortal from './components/SupervisorPortal';
import { STAGES, DUAL_STAGE_IDS, isAtDualStageGate, getInitialData, createEmptyHistory } from './data/mockData';
import { RoleSelector, RoleContextPanel, TopBar } from './components/RoleSelector';
import { AutoPrintMaterialSlip } from './components/AutoPrintMaterialSlip';
import { LoginScreen } from './components/LoginScreen';
import { getStoredUser, logout as logoutUser, findAccountByQuickCode, type AuthUser } from './lib/authClient';
import { startPresenceHeartbeat, stopPresenceHeartbeat } from './lib/presence';
import { useIdleTimeout } from './hooks/useIdleTimeout';
import { ProductionEngineer } from './components/ProductionEngineer';
import { StageDashboard } from './components/StageDashboard';
import { QualityInspector } from './components/QualityInspector';
import { FactoryEntrance } from './components/FactoryEntrance';
import { ManagementDashboard } from './components/ManagementDashboard';
import { SectionDashboardTV } from './components/SectionDashboardTV';
import { FactorySupervisorPortal } from './components/FactorySupervisorPortal';
import { PlanningDepartment } from './components/PlanningDepartment';
import { TrolleyProductionTracker } from './components/TrolleyProductionTracker';
import { HRPortal } from './components/HRPortal';
import { ReportsAndAnalytics } from './components/ReportsAndAnalytics';
import { QRScanner } from './components/QRCodeModule';
import { QCDefect } from './components/QCDefectPanel';
import { Info, RotateCcw, AlertCircle, HelpCircle, Wifi, WifiOff, RefreshCw, ShieldAlert, CheckCircle2, X, Camera, HardHat } from 'lucide-react';
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
  dbSaveCompanies,
  dbSyncTeams,
  reconcileTeamsForRestore,
  flushPendingWrites,
  getPendingWriteCount,
  dbSaveTrolley,
  dbDeleteTrolley,
  dbSaveQcDefect,
  dbAddRecycleBin,
  dbDeleteRecycleBin,
  dbRestoreRecycleBin,
  dbPurgePoolRelatedData,
  dbDeletePool,
  dbSavePlannedPool,
  dbDeletePlannedPool,
  dbBulkDeletePlannedPools,
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
  subscribeToLiveState
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
  const [pools, setPools] = useState<Pool[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [logs, setLogs] = useState<ActivityLog[]>([]);

  // RACE-CONDITION FIX: when several stage actions (claim/start/finish/
  // approve/reject/skip/undo) fire in very quick succession — e.g. several
  // workers on a shared kiosk processing multiple pools back-to-back, or one
  // person moving fast through a batch — React may not have re-rendered
  // between calls yet. Each handler used to read `pools`/`teams` from its own
  // stale render-time closure, so a later handler's computed array (built
  // from the OLD data) would silently overwrite an earlier handler's change
  // when both called setPools/setTeams. These refs are updated synchronously,
  // immediately after every write, so each subsequent handler in the same
  // rapid sequence always reads the true latest data instead of stale state.
  const poolsRef = useRef<Pool[]>(pools);
  const teamsRef = useRef<Team[]>(teams);
  useEffect(() => { poolsRef.current = pools; }, [pools]);
  useEffect(() => { teamsRef.current = teams; }, [teams]);

  const [inspectors, setInspectors] = useState<{ id: string; name: string; title: string }[]>([]);
  const [engineers, setEngineers] = useState<{ id: string; name: string; title: string }[]>([]);
  const [projectsSummary, setProjectsSummary] = useState<ProjectSummary[]>(() => {
    const raw = localStorage.getItem('apex_projects_summary');
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch (e) {}
    }
    return DEFAULT_PROJECTS_SUMMARY;
  });
  const [monthlyTargets, setMonthlyTargets] = useState<MonthlyTarget[]>(() => {
    const raw = localStorage.getItem('apex_monthly_targets');
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch (e) {}
    }
    return DEFAULT_MONTHLY_TARGETS;
  });
  const [plannedPools, setPlannedPools] = useState<PlannedPool[]>(() => {
    const raw = localStorage.getItem('apex_planned_pools');
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch (e) {}
    }
    return [];
  });
  const [employees, setEmployees] = useState<Employee[]>(() => {
    const raw = localStorage.getItem('apex_employees');
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch (e) {}
    }
    return DEFAULT_EMPLOYEES;
  });

  // Editable company/visa-sponsor list — starts from the built-in COMPANIES
  // list, but can be extended (or trimmed) from the Directory tab. Synced to
  // Firestore under 'companies' so every device sees the same list.
  const [companyList, setCompanyList] = useState<string[]>(() => {
    const raw = localStorage.getItem('apex_companies');
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch (e) {}
    }
    return [...COMPANIES];
  });

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

  // Shared shop-floor kiosk: a worker checks in by entering their team's code.
  // Session-only (not persisted) so the screen resets for the next person.
  const [workerCheckedIn, setWorkerCheckedIn] = useState(false);
  const [teamCodeInput, setTeamCodeInput] = useState('');
  const [teamCodeError, setTeamCodeError] = useState('');

  const handleTeamCodeSubmit = () => {
    const code = teamCodeInput.trim();
    if (!code) { setTeamCodeError('Enter your team code.'); return; }
    const match = teams.find(t => t.code && t.code === code);
    if (!match) { setTeamCodeError('Code not recognized. Ask your supervisor.'); return; }
    setWorkerTeamId(match.id);
    setSelectedStageId(match.stageId);
    setWorkerCheckedIn(true);
    setTeamCodeInput('');
    setTeamCodeError('');
  };

  const handleWorkerLogout = () => {
    setWorkerCheckedIn(false);
    setWorkerTeamId('');
    setTeamCodeInput('');
    setTeamCodeError('');
  };

  // ── Section Supervisor quick-code check-in ──────────────────────────────
  // Mirrors the team-code flow above: the shared shop-floor computer stays
  // signed in as a generic 'section_supervisor' account, and each individual
  // supervisor identifies themselves with their own short PIN (set by
  // Management in the Teams Allocation tab) instead of a full password.
  const [checkedInSupervisor, setCheckedInSupervisor] = useState<{ id: string; name: string } | null>(null);
  const [supervisorCodeInput, setSupervisorCodeInput] = useState('');
  const [supervisorCodeError, setSupervisorCodeError] = useState('');
  const [supervisorCodeChecking, setSupervisorCodeChecking] = useState(false);
  // Shows/hides the small floating "Supervisor Login" widget on the Stage
  // Floor screen, so a supervisor can jump into their own portal from the
  // same shared computer without logging out of the stage_worker account.
  const [showSupervisorCodeBox, setShowSupervisorCodeBox] = useState(false);

  const handleSupervisorCodeSubmit = async () => {
    const code = supervisorCodeInput.trim();
    if (!code) { setSupervisorCodeError('Enter your code.'); return; }
    setSupervisorCodeChecking(true);
    setSupervisorCodeError('');
    try {
      const match = await findAccountByQuickCode(code, 'section_supervisor');
      if (!match) {
        setSupervisorCodeError('Code not recognized. Ask Management to set your code in Teams Allocation.');
        return;
      }
      setCheckedInSupervisor({ id: match.id, name: match.displayName });
      setSupervisorCodeInput('');
      setShowSupervisorCodeBox(false);
    } catch (err: any) {
      setSupervisorCodeError(err?.message || 'Could not check the code. Try again.');
    } finally {
      setSupervisorCodeChecking(false);
    }
  };

  const handleSupervisorSwitchUser = () => {
    setCheckedInSupervisor(null);
    setSupervisorCodeInput('');
    setSupervisorCodeError('');
  };

  // True only when the current screen is a worker who checked in with a team
  // code (not a permanently PIN-locked station) — used to hide all nav/portal
  // switching and the team dropdown, and to show the red Exit button instead.
  const isCodeCheckedInWorker = currentRole === 'stage_worker' && workerCheckedIn && !(stationLock.isLocked && stationLock.teamId);

  // Role-Based Access Control State — backed by a real username/password
  // account (see src/lib/authClient.ts), not a shared department PIN.
  // Always require fresh login on every app open — never restore a saved session.
  const [loggedInUser, setLoggedInUser] = useState<AuthUser | null>(null);

  const handleLoginSuccess = (user: AuthUser) => {
    setLoggedInUser(user);
    setCurrentRole(user.role);
    if (user.role === 'stage_worker') {
      setSelectedStageId('steel_fabrication');
    }
    startPresenceHeartbeat(user);
  };

  const handleLogout = () => {
    setLoggedInUser(null);
    logoutUser();
    stopPresenceHeartbeat();
  };

  // Idle auto-logout: defaults to 3 minutes. HR portal can override this
  // by writing a number (in minutes) to localStorage key 'mat_idle_timeout_min'.
  // Shop Floor logins are exempt — shared stage tablets stay signed in all shift.
  const IDLE_TIMEOUT_MS = (() => {
    try {
      const saved = localStorage.getItem('mat_idle_timeout_min');
      const parsed = saved ? parseInt(saved, 10) : NaN;
      return (!isNaN(parsed) && parsed > 0) ? parsed * 60 * 1000 : 3 * 60 * 1000;
    } catch { return 3 * 60 * 1000; }
  })();
  const IDLE_EXEMPT_ROLES: ViewRole[] = ['stage_worker', 'section_supervisor'];
  const [idleLogoutNotice, setIdleLogoutNotice] = useState(false);
  const idleTimeoutEnabled = !!loggedInUser && !IDLE_EXEMPT_ROLES.includes(loggedInUser.role);
  useIdleTimeout(idleTimeoutEnabled, IDLE_TIMEOUT_MS, () => {
    setIdleLogoutNotice(true);
    handleLogout();
  });

  // Clear any saved session on every app open — users must always log in fresh.
  useEffect(() => {
    logoutUser();
    stopPresenceHeartbeat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  // DATA-LOSS FIX (v11): count of changes saved locally but not yet
  // confirmed in Firestore because the last write attempt failed (weak/lost
  // signal). Surfaced as a banner so a claim/release made on bad WiFi never
  // silently looks "done" when it's actually still sitting in the retry
  // queue on this device only.
  const [pendingWriteCount, setPendingWriteCount] = useState(0);
  // DATA-LOSS FIX: block ALL cloud writes until we have successfully loaded
  // the real cloud state at least once. Without this, an action performed
  // right after opening the app (or after a failed load that fell back to an
  // old localStorage copy) would push STALE data to Firestore and wipe
  // everything entered from other devices since this copy was cached.
  const cloudHydratedRef = useRef(false);

  // DATA-LOSS FIX (v12): teams specifically needs its OWN verified flag,
  // separate from cloudHydratedRef. cloudHydratedRef flips true the moment
  // ANY collection loads (cloud OR local fallback), which is too coarse for
  // teams: a device that has never cached apex_teams locally falls back to
  // getInitialData().teams — a hardcoded generic "Team 1 / Team 2" skeleton
  // — while every OTHER collection loads fine. cloudHydratedRef being true
  // then wrongly allows a team edit on that device to write the fake
  // skeleton to Firestore for real. teamsVerifiedRef is only set true when
  // `teams` holds either real cloud data or a genuine local cache — never
  // when it holds the generic fallback skeleton.
  const teamsVerifiedRef = useRef(false);

  // DATA-LOSS FIX (v11): drain the pending-write retry queue whenever the
  // browser reports it's back online, and also on a periodic timer as a
  // fallback (the 'online' event is unreliable on some tablets/kiosks —
  // it can report "online" while the WiFi is still too weak for Firestore,
  // so a timer keeps trying instead of waiting for one event that may
  // never accurately fire). Keeps pendingWriteCount in sync so the banner
  // clears the moment a queued team/pool/etc write actually lands.
  useEffect(() => {
    const attemptFlush = () => {
      flushPendingWrites()
        .then(({ remaining }) => setPendingWriteCount(remaining))
        .catch(() => {
          // still offline / still failing — leave the queue as-is, we'll
          // try again on the next tick or the next 'online' event
          setPendingWriteCount(getPendingWriteCount());
        });
    };

    setPendingWriteCount(getPendingWriteCount());
    window.addEventListener('online', attemptFlush);
    const intervalId = window.setInterval(attemptFlush, 20000);

    return () => {
      window.removeEventListener('online', attemptFlush);
      window.clearInterval(intervalId);
    };
  }, []);

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
          teamsVerifiedRef.current = true;
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
          teamsVerifiedRef.current = true; // genuinely empty DB — this IS the real state
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
            teamsVerifiedRef.current = true;
          } else {
            // Only reached if this device has NEVER cached real team data
            // before (true first-ever launch, or a cleared browser). This
            // seeds the structural skeleton for THIS DEVICE'S DISPLAY ONLY.
            // teamsVerifiedRef stays FALSE here — this is the fix: any
            // attempt to save teams while this flag is false is blocked
            // (see handleUpdateTeams / saveState below), so the fake
            // skeleton can never reach Firestore, no matter what else on
            // this device sets cloudHydratedRef true in the meantime.
            console.warn('[loadCloudData] No cached teams on this device and cloud unreachable — showing placeholder only. Team edits are blocked until real data loads.');
            teamsVerifiedRef.current = false;
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
      const safeUpdate = <T,>(setter: React.Dispatch<React.SetStateAction<T[]>>, incoming: T[]) => {
        setter(prev => {
          // Never replace real data with an empty array
          if (incoming.length === 0 && prev.length > 0) {
            console.warn(`[liveSync] Blocked empty snapshot for '${collection}' — keeping ${prev.length} existing records.`);
            return prev;
          }
          return incoming;
        });
      };

      switch (collection) {
        case 'pools':            safeUpdate(setPools, data as Pool[]); break;
        case 'plannedPools':     safeUpdate(setPlannedPools, data as PlannedPool[]); break;
        case 'teams':            safeUpdate(setTeams, data as Team[]); teamsVerifiedRef.current = true; break;
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
        case 'companies':        safeUpdate(setCompanyList, data as string[]); break;
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
    };
  }, []);

  // ONE-TIME BACKFILL: projects that were created before the projectsSummary
  // sync existed on handleCreatePool/handleCreatePoolBatch (e.g. Tiger,
  // Skyros, Miami) have pools in `pools`/`plannedPools` but no row in
  // `projectsSummary`, so they never showed up in the "All Projects Portal"
  // (that table reads exclusively from projectsSummary). This runs once
  // real data has loaded and adds any missing project rows.
  const projectsBackfillRef = useRef(false);
  useEffect(() => {
    if (projectsBackfillRef.current) return;
    if (!cloudHydratedRef.current) return;
    if (pools.length === 0 && plannedPools.length === 0) return;

    const allProjNames = Array.from(new Set([
      ...pools.map(p => p.projectName.toLowerCase()),
      ...plannedPools.map(p => p.projectName.toLowerCase())
    ]));
    const missingProjNames = allProjNames.filter(
      proj => !projectsSummary.some(s => s.projectName.toLowerCase() === proj)
    );

    if (missingProjNames.length === 0) {
      projectsBackfillRef.current = true;
      return;
    }

    const updatedProjects = [...projectsSummary];
    missingProjNames.forEach(proj => {
      const projectPools = pools.filter(p => p.projectName.toLowerCase() === proj);
      const totalPlanned = plannedPools.filter(p => p.projectName.toLowerCase() === proj).length;
      const producedCount = projectPools.filter(p => p.currentStageIndex >= STAGES.length).length;
      const deliveredCount = projectPools.filter(p => p.isDelivered).length;
      const totalCount = Math.max(1, projectPools.length + totalPlanned);
      const samplePool = projectPools[0] || plannedPools.find(p => p.projectName.toLowerCase() === proj);

      const newProjRec: ProjectSummary = {
        id: 'proj-' + Date.now() + '_' + Math.random().toString(36).substring(2, 5),
        projectName: samplePool?.projectName || proj,
        orientation: (samplePool as any)?.orientation || 'Normal',
        poolType: (samplePool as any)?.poolType || 'Type 3',
        totalPools: totalCount,
        producedPools: producedCount,
        deliveredPools: deliveredCount,
        remainingPools: Math.max(0, totalCount - deliveredCount),
        notes: `Backfilled into All Projects Portal registry`,
        createdAt: new Date().toISOString()
      };
      updatedProjects.push(newProjRec);
      dbSaveProjectSummary(newProjRec).catch(console.error);
    });

    projectsBackfillRef.current = true;
    setProjectsSummary(updatedProjects);
    saveState(pools, teams, logs, inspectors, engineers, plannedPools, updatedProjects);
  }, [pools, plannedPools, projectsSummary]);

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

  // Returns the ids of records that actually differ between the previous and
  // updated array (by shallow JSON comparison). Used so Firestore writes for
  // `teams`/`pools` only ever overwrite the specific record(s) this action
  // touched, instead of every id in the local array — see mergeByIdScoped in
  // firebaseService.ts for why that matters (prevents stale-device races).
  const findChangedIds = (prev: any[], updated: any[]): string[] => {
    if (prev === updated) return [];
    const prevById = new Map(prev.map((item) => [item?.id, item]));
    const ids: string[] = [];
    for (const item of updated) {
      const before = prevById.get(item?.id);
      if (!before || JSON.stringify(before) !== JSON.stringify(item)) {
        ids.push(item?.id);
      }
    }
    return ids;
  };

  const saveState = (
    updatedPools: Pool[], 
    updatedTeams: Team[], 
    updatedLogs: ActivityLog[],
    updatedInspectors = inspectors,
    updatedEngineers = engineers,
    updatedPlannedPools = plannedPools,
    updatedProjectsSummary = projectsSummary,
    updatedMonthlyTargets = monthlyTargets,
    updatedEmployees = employees
  ) => {
    // Safety: never wipe existing data with empty arrays from stale closures
    const safePools = updatedPools.length > 0 ? updatedPools : (pools.length > 0 ? pools : updatedPools);
    const safePlanned = updatedPlannedPools.length > 0 ? updatedPlannedPools : (plannedPools.length > 0 ? plannedPools : updatedPlannedPools);
    const safeEmployees = updatedEmployees.length > 0 ? updatedEmployees : (employees.length > 0 ? employees : updatedEmployees);
    const safeLogs = updatedLogs.length > 0 ? updatedLogs : (logs.length > 0 ? logs : updatedLogs);
    const safeInspectors = updatedInspectors.length > 0 ? updatedInspectors : (inspectors.length > 0 ? inspectors : updatedInspectors);
    const safeEngineers = updatedEngineers.length > 0 ? updatedEngineers : (engineers.length > 0 ? engineers : updatedEngineers);
    const safeProjects = updatedProjectsSummary.length > 0 ? updatedProjectsSummary : (projectsSummary.length > 0 ? projectsSummary : updatedProjectsSummary);
    const safeTargets = updatedMonthlyTargets.length > 0 ? updatedMonthlyTargets : (monthlyTargets.length > 0 ? monthlyTargets : updatedMonthlyTargets);
    const safeTeams = updatedTeams.length > 0 ? updatedTeams : (teams.length > 0 ? teams : updatedTeams);

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
    // DATA-LOSS FIX (v6): write ONLY the collections that actually changed.
    //
    // Previous behaviour wrote ALL 9 collections to Firestore on EVERY action.
    // A tab that had been open for hours (TV dashboard, idle PC) held stale
    // copies of the 8 collections it wasn't touching — one click on that tab
    // rewrote the entire database with old data → "all data deleted".
    //
    // We detect changed collections by reference: handlers always create a NEW
    // array for what they modified and pass the existing state reference for
    // everything else. Unchanged references are skipped entirely.
    // ─────────────────────────────────────────────────────────────────────────
    const changed: Record<string, any[]> = {};
    if (updatedPools !== pools) changed.pools = safePools;
    if (updatedTeams !== teams) changed.teams = safeTeams;
    if (updatedLogs !== logs) changed.logs = safeLogs;
    if (updatedInspectors !== inspectors) changed.inspectors = safeInspectors;
    if (updatedEngineers !== engineers) changed.engineers = safeEngineers;
    if (updatedPlannedPools !== plannedPools) changed.plannedPools = safePlanned;
    if (updatedProjectsSummary !== projectsSummary) changed.projectsSummary = safeProjects;
    if (updatedMonthlyTargets !== monthlyTargets) changed.monthlyTargets = safeTargets;
    if (updatedEmployees !== employees) changed.employees = safeEmployees;

    // DATA-LOSS FIX (v12): never let a teams write ride along in this batch
    // while teams is still showing the unverified placeholder skeleton —
    // strip it out but still save whatever else legitimately changed
    // (pools, logs, etc.) so shop-floor actions aren't blocked entirely.
    if (changed.teams && !teamsVerifiedRef.current) {
      console.warn('[saveState] Blocked teams write — real team data has not loaded yet on this device.');
      delete changed.teams;
    }

    if (Object.keys(changed).length === 0) return;

    if (!cloudHydratedRef.current) {
      console.warn('[saveState] Cloud state not hydrated yet — skipping Firestore write to protect cloud data from a stale local copy.');
      setFirebaseStatus('error');
      setFirebaseError('Change saved on this device only. Cloud sync is paused because the app could not load the latest cloud data — check your internet connection and reload the page.');
      return;
    }

    const changedIds: Record<string, string[]> = {};
    if (changed.teams) changedIds.teams = findChangedIds(teams, safeTeams);
    if (changed.pools) changedIds.pools = findChangedIds(pools, safePools);
    // BUGFIX: these were previously left out of changedIds, which made
    // mergeByIdScoped() silently fall back to the old broad mergeById() for
    // every write touching these collections — letting a stale tab's WHOLE
    // local copy win for every id it held, not just the record actually
    // changed. This is what caused actions like releasing a pool (which
    // saves plannedPools alongside pools) to appear to revert a few minutes
    // later on other devices.
    if (changed.plannedPools) changedIds.plannedPools = findChangedIds(plannedPools, safePlanned);
    if (changed.projectsSummary) changedIds.projectsSummary = findChangedIds(projectsSummary, safeProjects);
    if (changed.monthlyTargets) changedIds.monthlyTargets = findChangedIds(monthlyTargets, safeTargets);
    if (changed.employees) changedIds.employees = findChangedIds(employees, safeEmployees);
    if (changed.inspectors) changedIds.inspectors = findChangedIds(inspectors, safeInspectors);
    if (changed.engineers) changedIds.engineers = findChangedIds(engineers, safeEngineers);

    saveChangedCollectionsToFirestore(changed, changedIds)
      .then((result) => {
        if (result?.queued) {
          // One or more collections (e.g. this team update) couldn't reach
          // Firestore right now and were queued for automatic retry — this
          // is NOT a dead end like the old behaviour, but it's also not
          // "saved to the cloud" yet, so make that visible immediately
          // rather than waiting for the next periodic flush tick.
          setPendingWriteCount(getPendingWriteCount());
          setFirebaseStatus('error');
          setFirebaseError('Weak/lost connection — your last change is saved on this device and will sync automatically once the signal is back.');
        } else {
          setFirebaseStatus('connected');
          setFirebaseError(null);
        }
      })
      .catch((err: any) => {
        console.error('Cloud save error:', err);
        setFirebaseStatus('error');
        setFirebaseError(err?.message || String(err));
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
    saveState(pools, teams, logs, inspectors, engineers, plannedPools, projectsSummary, monthlyTargets, updated);
    dbSaveEmployee(employee).catch(console.error);
  };

  // Add/remove a company from the editable visa-sponsor company list.
  // Keeps existing employees' companyName untouched even if removed from
  // the list (their badge simply becomes a "legacy" value still shown).
  const handleSaveCompanies = (list: string[]) => {
    setCompanyList(list);
    try { localStorage.setItem('apex_companies', JSON.stringify(list)); } catch {}
    dbSaveCompanies(list).catch(console.error);
  };

  const handleDeleteEmployee = (id: string) => {
    const updated = employees.filter(e => e.id !== id);
    setEmployees(updated);
    saveState(pools, teams, logs, inspectors, engineers, plannedPools, projectsSummary, monthlyTargets, updated);
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
    saveState(pools, teams, logs, inspectors, engineers, plannedPools, projectsSummary, monthlyTargets, updated);
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
    dbSaveQcDefect(defect).catch(console.error);
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
      const updatedDefect = updated.find(d => d.id === defectId);
      if (updatedDefect) {
        dbSaveQcDefect(updatedDefect).catch(console.error);
      }
      return updated;
    });
  };

  const handleUpdateTeams = (updatedTeams: Team[]) => {
    // DATA-LOSS FIX (v12): refuse to sync teams to Firestore while this
    // device is still showing the unverified placeholder skeleton (see
    // teamsVerifiedRef above). Without this check, editing a team during
    // that brief window — e.g. right after opening the app on a weak
    // connection — would push the generic "Team 1 / Team 2" list to the
    // cloud for real, overwriting everyone's actual team roster.
    if (!teamsVerifiedRef.current) {
      console.warn('[handleUpdateTeams] Blocked: real team data has not loaded yet on this device. Please wait a moment and try again.');
      setFirebaseStatus('error');
      setFirebaseError('Team data is still loading. Please wait a few seconds and try again before editing teams.');
      return;
    }
    // DATA-LOSS FIX (v8): this used to call saveState() (a merge-by-id
    // Firestore transaction) AND dbDeleteTeam() (a separate delete
    // transaction) for every edit — two independent transactions racing
    // against the same Firestore document with no guaranteed ordering
    // between them. That race is how a rename or delete could silently
    // restore a just-deleted team, or drop teams that should have stayed.
    //
    // Now both the merge and the removals happen inside ONE atomic
    // transaction (dbSyncTeams), so there is nothing left to race.
    //
    // DATA-LOSS FIX (v9): also pass changedIds so dbSyncTeams only lets
    // this screen's copy win for the team(s) actually edited here — not
    // every team it happens to be holding in memory. See mergeByIdScoped
    // in firebaseService.ts for the full explanation.
    const updatedIds = new Set(updatedTeams.map(t => t.id));
    const removedIds = teams.filter(t => !updatedIds.has(t.id)).map(t => t.id);
    const changedIds = findChangedIds(teams, updatedTeams);
    setTeams(updatedTeams);
    localStorage.setItem('apex_teams', JSON.stringify(updatedTeams));
    dbSyncTeams(updatedTeams, removedIds, changedIds).catch((err) => {
      console.error('dbSyncTeams failed:', err);
      setFirebaseStatus('error');
      setFirebaseError(err?.message || String(err));
    });
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
      teams,
      updatedLogs,
      inspectors,
      engineers,
      plannedPools,
      updatedProjects,
      monthlyTargets,
      employees
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
      teams,
      updatedLogs,
      inspectors,
      engineers,
      updatedPlannedPools,
      updatedProjects,
      monthlyTargets,
      employees
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
    saveState(pools, teams, logs, inspectors, engineers, plannedPools, updated, monthlyTargets);
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
    saveState(pools, teams, logs, inspectors, engineers, plannedPools, updated, monthlyTargets);
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
    saveState(pools, teams, logs, inspectors, engineers, plannedPools, projectsSummary, updated);
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
    saveState(pools, teams, logs, inspectors, engineers, plannedPools, projectsSummary, updated);
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
    saveState(pools, teams, logs, updated, engineers, plannedPools, projectsSummary, monthlyTargets);
    dbSaveInspector(insp).catch(console.error);
  };

  const handleDeleteInspector = async (id: string) => {
    const insp = inspectors.find(i => i.id === id);
    if (!insp) return;
    if (!window.confirm(`Delete inspector "${insp.name}" permanently?`)) return;
    const updated = inspectors.filter(i => i.id !== id);
    setInspectors(updated);
    saveState(pools, teams, logs, updated, engineers, plannedPools, projectsSummary, monthlyTargets);
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
    saveState(pools, teams, logs, inspectors, updated, plannedPools, projectsSummary, monthlyTargets);
    dbSaveEngineer(eng).catch(console.error);
  };

  const handleDeleteEngineer = async (id: string) => {
    const eng = engineers.find(e => e.id === id);
    if (!eng) return;
    if (!window.confirm(`Delete engineer "${eng.name}" permanently?`)) return;
    const updated = engineers.filter(e => e.id !== id);
    setEngineers(updated);
    saveState(pools, teams, logs, inspectors, updated, plannedPools, projectsSummary, monthlyTargets);
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

    // DATA-LOSS FIX (v10): a Teams backup (full or "Teams Allocation only")
    // is a snapshot of who was assigned to what AT EXPORT TIME. Pools keep
    // moving through stages after that, so by the time this file gets
    // restored — especially an old file uploaded to recover from a wipe —
    // some team->pool assignments in it are stale: the pool may already
    // have passed that stage, been claimed by a different team since, or
    // been deleted. Restoring blindly is how an already-finished pool used
    // to jump back onto its old team, and how two teams could end up
    // sharing one kiosk login code (workers logged into the wrong/"random"
    // team). Reconcile against the pools we're keeping (the freshly
    // restored set if this file includes them, otherwise whatever pools
    // are already live) before any of it touches state or Firestore.
    let teamsToApply = recovered.teams;
    if (teamsToApply) {
      const poolsForReconciliation = recovered.pools || pools;
      const { teams: reconciled, releasedCount, strippedCodeCount } = reconcileTeamsForRestore(
        poolsForReconciliation,
        teamsToApply
      );
      teamsToApply = reconciled;
      if (releasedCount > 0 || strippedCodeCount > 0) {
        console.warn(
          `[handleRestoreState] Reconciled restored teams: released ${releasedCount} stale pool assignment(s), stripped ${strippedCodeCount} duplicate login code(s).`
        );
      }
    }

    if (recovered.pools) setPools(recovered.pools);
    if (teamsToApply) setTeams(teamsToApply);
    if (recovered.logs) setLogs(recovered.logs);
    if (recovered.inspectors) setInspectors(recovered.inspectors);
    if (recovered.engineers) setEngineers(recovered.engineers);
    if (recovered.employees) setEmployees(recovered.employees);
    if (recovered.plannedPools) setPlannedPools(recovered.plannedPools);
    if (recovered.projectsSummary) setProjectsSummary(recovered.projectsSummary);
    if (recovered.monthlyTargets) setMonthlyTargets(recovered.monthlyTargets);

    saveState(
      recovered.pools || pools,
      teamsToApply || teams,
      recovered.logs || logs,
      recovered.inspectors || inspectors,
      recovered.engineers || engineers,
      recovered.plannedPools || plannedPools,
      recovered.projectsSummary || projectsSummary,
      recovered.monthlyTargets || monthlyTargets,
      recovered.employees || employees
    );

    if (missing.length > 0) {
      alert(`Restore complete. Note: this backup file didn't include ${missing.join(', ')}, so your current data for those was kept unchanged (not overwritten).`);
    }
  };

  const handleUpdatePool = (poolId: string, updates: Partial<Pool>) => {
    const updatedPools = pools.map(p => p.id === poolId ? { ...p, ...updates } : p);
    setPools(updatedPools);
    saveState(updatedPools, teams, logs);
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

    // SCRAP FIX: scrapping a pool must also clear out any matching Planning
    // Inventory record (same poolNo + projectName). Otherwise the pool is gone
    // from production but still "reserved" in plannedPools, which (a) keeps it
    // showing in Planning Inventory forever, and (b) blocks re-entry of the
    // same pool number via the duplicate check in handleAddPlannedPool.
    const matchingPlannedPools = plannedPools.filter(
      p => p.poolNo === targetPool.poolNo && p.projectName === targetPool.projectName
    );
    const updatedPlannedPools = plannedPools.filter(
      p => !(p.poolNo === targetPool.poolNo && p.projectName === targetPool.projectName)
    );

    setPools(updatedPools);
    setTeams(updatedTeams);
    setLogs(updatedLogs);
    setPlannedPools(updatedPlannedPools);
    saveState(updatedPools, updatedTeams, updatedLogs, inspectors, engineers);
    await dbDeletePool(poolId).catch(console.error);

    // Remove any leftover planned-pool record(s) for this poolNo/project so
    // Planning Inventory stops showing it and the number is free to re-enter.
    for (const planned of matchingPlannedPools) {
      await dbDeletePlannedPool(planned.id).catch(console.error);
    }

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

    // Keep the "All Projects Portal" registry (projectsSummary) in sync.
    // Without this, pools created through the normal registration flow
    // (as opposed to the Direct Override admin tool) never show up in
    // that portal, since it reads exclusively from projectsSummary.
    const projectPools = updatedPools.filter(p => p.projectName.toLowerCase() === newPool.projectName.toLowerCase());
    const existingProjectIndex = projectsSummary.findIndex(p => p.projectName.toLowerCase() === newPool.projectName.toLowerCase());
    const updatedProjects = [...projectsSummary];
    const producedCount = projectPools.filter(p => p.currentStageIndex >= STAGES.length).length;
    const deliveredCount = projectPools.filter(p => p.isDelivered).length;

    if (existingProjectIndex >= 0) {
      const existingProject = projectsSummary[existingProjectIndex];
      const nextTotal = Math.max(projectPools.length, existingProject.totalPools);
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
        projectName: newPool.projectName,
        orientation: newPool.orientation,
        poolType: newPool.poolType || 'Type 3',
        totalPools: Math.max(1, projectPools.length),
        producedPools: producedCount,
        deliveredPools: deliveredCount,
        remainingPools: Math.max(0, Math.max(1, projectPools.length) - deliveredCount),
        notes: `Auto-created via pool registration`,
        createdAt: new Date().toISOString()
      };
      updatedProjects.push(newProjRec);
      dbSaveProjectSummary(newProjRec).catch(console.error);
    }

    setPools(updatedPools);
    setLogs(updatedLogs);
    setProjectsSummary(updatedProjects);
    saveState(updatedPools, teams, updatedLogs, inspectors, engineers, plannedPools, updatedProjects);
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

    // Keep the "All Projects Portal" registry (projectsSummary) in sync —
    // same reasoning as handleCreatePool above.
    const projectPools = updatedPools.filter(p => p.projectName.toLowerCase() === projectName.toLowerCase());
    const existingProjectIndex = projectsSummary.findIndex(p => p.projectName.toLowerCase() === projectName.toLowerCase());
    const updatedProjects = [...projectsSummary];
    const producedCount = projectPools.filter(p => p.currentStageIndex >= STAGES.length).length;
    const deliveredCount = projectPools.filter(p => p.isDelivered).length;

    if (existingProjectIndex >= 0) {
      const existingProject = projectsSummary[existingProjectIndex];
      const nextTotal = Math.max(projectPools.length, existingProject.totalPools);
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
        projectName,
        orientation,
        poolType: poolType || 'Type 3',
        totalPools: Math.max(1, projectPools.length),
        producedPools: producedCount,
        deliveredPools: deliveredCount,
        remainingPools: Math.max(0, Math.max(1, projectPools.length) - deliveredCount),
        notes: `Auto-created via batch pool registration`,
        createdAt: timestamp
      };
      updatedProjects.push(newProjRec);
      dbSaveProjectSummary(newProjRec).catch(console.error);
    }

    setPools(updatedPools);
    setLogs(updatedLogs);
    setProjectsSummary(updatedProjects);
    saveState(updatedPools, teams, updatedLogs, inspectors, engineers, plannedPools, updatedProjects);
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
      pools,
      teams,
      updatedLogs,
      inspectors,
      engineers,
      updated,
      projectsSummary,
      monthlyTargets,
      employees
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

    // RELEASED/COMPLETED planned pools are linked to a live pool on the shop
    // floor via releasedPoolId. Previously these were blocked from deletion
    // here entirely. Now we allow it, but deleting one also deletes the
    // linked live pool record (production/QC/team data) so nothing is left
    // orphaned in the shop-floor collections.
    const linkedLivePool = design.status !== 'PLANNED' && design.releasedPoolId
      ? pools.find(p => p.id === design.releasedPoolId)
      : undefined;

    const confirmMsg = linkedLivePool
      ? `Delete pool "${design.poolNo}" (${design.projectName}) permanently?\n\nThis pool has already been released to the shop floor (status: ${design.status}). Deleting it removes BOTH the planning record AND its live manufacturing/production data. A copy of each is kept in the Recycle Bin for 3 days.`
      : `Remove pre-planned pool ${design.poolNo} from the index?`;
    if (!window.confirm(confirmMsg)) return;

    if (linkedLivePool) {
      const poolTrashItem: RecycleBinItem = {
        id: `pool_trash_${linkedLivePool.id}_${Date.now()}`,
        dataType: 'pool',
        deletedAt: new Date().toISOString(),
        payload: linkedLivePool
      };
      await dbAddRecycleBin(poolTrashItem).catch(console.error);

      const updatedPools = pools.filter(p => p.id !== linkedLivePool.id);
      const updatedTeams = teams.map(t =>
        t.activePoolId === linkedLivePool.id ? { ...t, status: 'IDLE' as const, activePoolId: null } : t
      );
      setPools(updatedPools);
      setTeams(updatedTeams);
      await dbDeletePool(linkedLivePool.id).catch(console.error);
    }

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

  // Bulk variant used by the Inventory Registry "Delete Selected" flow.
  // Deliberately NOT a loop over handleDeletePlannedPool: that function (a)
  // shows a window.confirm per item, which would fire once per selected row,
  // and (b) computes `updated` from the `plannedPools` closure captured at
  // render time — calling it repeatedly in a tight loop means every call
  // filters the SAME original array and the final setPlannedPools() call
  // wins, silently discarding all but one deletion.
  //
  // It also does NOT fire off N parallel dbAddRecycleBin/dbDeletePlannedPool
  // calls — that was tried first and caused large bulk deletes (40+ items)
  // to hang for minutes, because every one of those calls opens its own
  // Firestore transaction against the SAME 'plannedPools'/'recycleBin'
  // document, so they all fight over the same doc and Firestore has to keep
  // retrying the losers. dbBulkDeletePlannedPools does the whole batch as a
  // single transaction instead.
  //
  // Confirmation and audit logging are handled by the caller (password modal
  // in PlanningDepartment.tsx) before this is invoked.
  const handleBulkDeletePlannedPools = async (planIds: string[]) => {
    const idsSet = new Set(planIds);
    const toDelete = plannedPools.filter(p => idsSet.has(p.id) && p.status === 'PLANNED');
    if (toDelete.length === 0) return;

    const trashItems: RecycleBinItem[] = toDelete.map(design => ({
      id: `planned_pool_trash_${design.id}_${Date.now()}`,
      dataType: 'planned_pool',
      deletedAt: new Date().toISOString(),
      payload: design
    }));

    // Update local state immediately so the UI feels instant.
    const deletedIds = new Set(toDelete.map(d => d.id));
    const updated = plannedPools.filter(p => !deletedIds.has(p.id));
    setPlannedPools(updated);
    localStorage.setItem('apex_planned_pools', JSON.stringify(updated));

    // One single transaction handles both the plannedPools removal and the
    // recycleBin insert for the whole batch.
    await dbBulkDeletePlannedPools(toDelete.map(d => d.id), trashItems).catch(console.error);

    // Refresh recycle bin state
    const cloudData2 = await getEntireStateFromFirestore().catch(() => null);
    if (cloudData2 && cloudData2.recycleBin) {
      setRecycleBin(cloudData2.recycleBin);
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
    saveState(updatedPools, teams, updatedLogs, inspectors, engineers, updatedPlans, projectsSummary, monthlyTargets, employees);
    // Also targeted-save the planned pool status update
    dbSavePlannedPool(updatedPlans[designIndex]).catch(console.error);
    return livePoolId;
  };

  // 2. Claim Pool (Stage worker claims available pool card)
  const handleClaimPool = (poolId: string, teamId: string, stageId: StageId) => {
    // Find the pool
    const poolIndex = poolsRef.current.findIndex(p => p.id === poolId);
    if (poolIndex === -1) return;

    // Verify the team's NORMAL work slot is free. We deliberately check
    // activePoolId here, not team.status — status stays 'BUSY' while a team
    // is working an auto-assigned rework pool too, but that shouldn't block
    // them from also claiming a fresh pool as their normal job.
    const team = teamsRef.current.find(t => t.id === teamId);
    if (!team || team.activePoolId) return;

    // QC HOLD GUARD: a pool placed on hold by Quality cannot be claimed by
    // any team/kiosk at any stage until QC explicitly releases it.
    const claimTargetPool = poolsRef.current[poolIndex];
    if (claimTargetPool.isOnHold) return;

    // Update pool: assign stage team details
    // SYNC FIX: clone both the pool AND its stageHistory bag before editing.
    // `updatedPools[poolIndex]` was the SAME object as `pools[poolIndex]` —
    // mutating `pool.stageHistory[stageId]` in place mutated the OLD state
    // too (same reference), so findChangedIds() saw before === after and
    // never marked this pool as changed. That meant the Firestore write
    // silently dropped this pool's update — it showed up on this device
    // (local state) but never synced to other devices.
    const updatedPools = [...poolsRef.current];
    const pool = { ...updatedPools[poolIndex], stageHistory: { ...updatedPools[poolIndex].stageHistory } };
    updatedPools[poolIndex] = pool;
    const stageHist = { ...pool.stageHistory[stageId] };
    stageHist.teamId = teamId;
    stageHist.teamName = team.name;
    pool.stageHistory[stageId] = stageHist;

    // Update team: link to pool
    const updatedTeams = teamsRef.current.map(t => {
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
    poolsRef.current = updatedPools; // keep ref in sync for any immediately-following action
    setTeams(updatedTeams);
    teamsRef.current = updatedTeams; // keep ref in sync for any immediately-following action
    setLogs(updatedLogs);
    saveState(updatedPools, updatedTeams, updatedLogs);
  };

  // 2b. Hold Pool (QC locks a pool at its current stage so no team can
  // claim it — used e.g. while a defect/rework decision is pending).
  const handleHoldPool = (poolId: string, inspectorName: string, reason?: string) => {
    const poolIndex = poolsRef.current.findIndex(p => p.id === poolId);
    if (poolIndex === -1) return;

    const updatedPools = [...poolsRef.current];
    const pool = { ...updatedPools[poolIndex] };
    const currentStage = STAGES[pool.currentStageIndex]?.id ?? 'unknown';
    pool.isOnHold = true;
    pool.holdInfo = {
      heldBy: inspectorName,
      heldAt: new Date().toISOString(),
      reason: reason || '',
      stageAtHold: currentStage,
    };
    updatedPools[poolIndex] = pool;

    const newLog: ActivityLog = {
      id: `log_${Date.now()}`,
      timestamp: new Date().toISOString(),
      poolId: pool.id,
      poolNo: pool.poolNo,
      projectName: pool.projectName,
      stageId: currentStage as StageId,
      type: 'STAGE_STARTED',
      teamName: inspectorName,
      operatorName: inspectorName,
      notes: `QC HOLD placed on pool at [${currentStage}]${reason ? ` — Reason: ${reason}` : ''}. Pool cannot be claimed until released.`,
    };
    const updatedLogs = [...logs, newLog];

    setPools(updatedPools);
    poolsRef.current = updatedPools;
    setLogs(updatedLogs);
    saveState(updatedPools, teams, updatedLogs);
  };

  // 2c. Release Hold (QC unlocks a pool so teams can claim it again).
  const handleReleaseHold = (poolId: string, inspectorName: string) => {
    const poolIndex = poolsRef.current.findIndex(p => p.id === poolId);
    if (poolIndex === -1) return;

    const updatedPools = [...poolsRef.current];
    const pool = { ...updatedPools[poolIndex] };
    const heldStage = pool.holdInfo?.stageAtHold || (STAGES[pool.currentStageIndex]?.id ?? 'unknown');
    pool.isOnHold = false;
    pool.holdInfo = null;
    updatedPools[poolIndex] = pool;

    const newLog: ActivityLog = {
      id: `log_${Date.now()}`,
      timestamp: new Date().toISOString(),
      poolId: pool.id,
      poolNo: pool.poolNo,
      projectName: pool.projectName,
      stageId: heldStage as StageId,
      type: 'STAGE_STARTED',
      teamName: inspectorName,
      operatorName: inspectorName,
      notes: `QC HOLD released. Pool is available to be claimed again.`,
    };
    const updatedLogs = [...logs, newLog];

    setPools(updatedPools);
    poolsRef.current = updatedPools;
    setLogs(updatedLogs);
    saveState(updatedPools, teams, updatedLogs);
  };

  // 3. Start Stage Timer
  const handleStartStage = (poolId: string, stageId: StageId, customDateTime?: string) => {
    const poolIndex = poolsRef.current.findIndex(p => p.id === poolId);
    if (poolIndex === -1) return;

    // SYNC FIX: see handleClaimPool above — clone stageHistory too, or the
    // mutation happens on the shared object and the change silently fails
    // to reach Firestore (findChangedIds sees no difference).
    const updatedPools = [...poolsRef.current];
    const pool = { ...updatedPools[poolIndex], stageHistory: { ...updatedPools[poolIndex].stageHistory } };
    updatedPools[poolIndex] = pool;
    const stageHist = { ...pool.stageHistory[stageId] };
    stageHist.status = 'IN_PROGRESS';
    stageHist.startTime = customDateTime || new Date().toISOString();
    pool.stageHistory[stageId] = stageHist;

    const team = teamsRef.current.find(t => t.id === stageHist.teamId);

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
    poolsRef.current = updatedPools; // keep ref in sync for any immediately-following action
    setLogs(updatedLogs);
    saveState(updatedPools, teams, updatedLogs);
  };

  // 4. Complete / Finish Stage (Promotes to QA validation)
  const handleFinishStage = (poolId: string, stageId: StageId, customDateTime?: string) => {
    const poolIndex = poolsRef.current.findIndex(p => p.id === poolId);
    if (poolIndex === -1) return;

    // SYNC FIX: see handleClaimPool above — without cloning stageHistory,
    // this pool getting sent to Quality never actually synced to Firestore
    // on other devices (it only ever looked correct on the device that did it).
    const updatedPools = [...poolsRef.current];
    const pool = { ...updatedPools[poolIndex], stageHistory: { ...updatedPools[poolIndex].stageHistory } };
    updatedPools[poolIndex] = pool;
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
    const team = teamsRef.current.find(t => t.id === stageHist.teamId);

    // If this was one of the team's auto-assigned rework pools, remove it
    // from the array now that it's back with QC — otherwise it stays
    // "held" forever and blocks that slot from ever clearing.
    const updatedTeams = team?.reworkPoolIds?.includes(poolId)
      ? teamsRef.current.map(t => t.id === team.id ? { ...t, reworkPoolIds: t.reworkPoolIds!.filter(id => id !== poolId) } : t)
      : teamsRef.current;

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
    poolsRef.current = updatedPools; // keep ref in sync for any immediately-following action
    if (updatedTeams !== teamsRef.current) {
      setTeams(updatedTeams);
      teamsRef.current = updatedTeams;
    }
    setLogs(updatedLogs);
    saveState(updatedPools, updatedTeams, updatedLogs);
  };

  // 4b. Quick Batch Complete — for "quickStage" stages (e.g. Skimmer Test)
  // where the real task takes seconds per pool. Ticks several pools at once
  // and sends all of them straight to QA in a single click, instead of
  // making the team Claim -> Start Timer -> Finish each pool individually.
  const handleQuickBatchComplete = (poolIds: string[], stageId: StageId, teamId: string) => {
    if (poolIds.length === 0) return;
    const team = teamsRef.current.find(t => t.id === teamId);
    if (!team) return;

    const nowStr = new Date().toISOString();
    const updatedPools = [...poolsRef.current];
    const newLogs: ActivityLog[] = [];

    poolIds.forEach((poolId) => {
      const poolIndex = updatedPools.findIndex(p => p.id === poolId);
      if (poolIndex === -1) return;

      // Clone pool + stageHistory (same SYNC FIX pattern as handleClaimPool
      // above — mutating the shared object in place would make this
      // update silently fail to reach Firestore).
      const pool = { ...updatedPools[poolIndex], stageHistory: { ...updatedPools[poolIndex].stageHistory } };
      updatedPools[poolIndex] = pool;
      const stageHist = { ...pool.stageHistory[stageId] };

      stageHist.teamId = teamId;
      stageHist.teamName = team.name;
      stageHist.status = 'PENDING_INSPECTION';
      stageHist.startTime = nowStr;
      stageHist.endTime = nowStr;
      stageHist.durationMinutes = 1; // Genuinely a seconds-long task; 1 min floor for reporting.
      pool.stageHistory[stageId] = stageHist;

      newLogs.push({
        id: `log_${Date.now()}_${poolId}`,
        timestamp: nowStr,
        poolId: pool.id,
        poolNo: pool.poolNo,
        projectName: pool.projectName,
        stageId,
        type: 'STAGE_FINISHED',
        teamName: team.name,
        operatorName: team.name,
        notes: `Quick tested and passed to Quality Inspection (batch checklist).`,
      });
    });

    const updatedLogs = [...logs, ...newLogs];
    setPools(updatedPools);
    poolsRef.current = updatedPools;
    setLogs(updatedLogs);
    saveState(updatedPools, teams, updatedLogs);
  };

  // 5. Approve Stage (By Quality Inspector)
  const handleApproveStage = (poolId: string, stageId: StageId, inspectorId: string, notes: string, inspectorPicture?: string) => {
    const poolIndex = poolsRef.current.findIndex(p => p.id === poolId);
    if (poolIndex === -1) return;

    // SYNC FIX: see handleClaimPool above.
    const updatedPools = [...poolsRef.current];
    const pool = { ...updatedPools[poolIndex], stageHistory: { ...updatedPools[poolIndex].stageHistory } };
    updatedPools[poolIndex] = pool;
    const stageHist = { ...pool.stageHistory[stageId] };

    // Set approved status
    stageHist.status = 'APPROVED';
    stageHist.inspectorId = inspectorId;
    stageHist.inspectorNotes = notes;
    stageHist.inspectionTime = new Date().toISOString();
    stageHist.inspectorPicture = inspectorPicture;
    pool.stageHistory[stageId] = stageHist;

    const originalWorkspecTeamId = stageHist.teamId;

    // Release the assigned team from BUSY state.
    // Defensive fallback: if stageHist.teamId is missing/stale (e.g. the claim
    // write never landed), also release any team whose activePoolId still
    // points at this pool, so a team can never get stuck BUSY forever.
    //
    // BUGFIX: the fallback must also check t.stageId === stageId. Without it,
    // approving one DUAL_STAGE_IDS sibling (e.g. Skimmer Fitting) would also
    // wrongly release the OTHER sibling's team (e.g. Lamination) whenever that
    // team's activePoolId still pointed at the same shared pool — even though
    // that team is still actively mid-task on their own parallel stage. This is
    // exactly what caused teams to show IDLE/free while actually still holding
    // a pool, and caused team-pool allocation data to get overwritten/lost when
    // that wrongly-freed team then claimed a new pool.
    const updatedTeams = teamsRef.current.map(t => {
      if (t.id === originalWorkspecTeamId || (t.activePoolId === poolId && t.stageId === stageId)) {
        return { ...t, status: 'IDLE' as const, activePoolId: null, reworkPoolIds: (t.reworkPoolIds || []).filter(id => id !== poolId) };
      }
      // Even if this team wasn't the one holding activePoolId on this pool,
      // it may still be holding it as a REWORK pool specifically — clear it
      // there too so an approved rework pool never keeps showing as active.
      if (t.reworkPoolIds?.includes(poolId)) {
        return { ...t, reworkPoolIds: t.reworkPoolIds.filter(id => id !== poolId) };
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
      teamId: originalWorkspecTeamId,
      teamName: teamsRef.current.find(t => t.id === originalWorkspecTeamId)?.name,
      operatorName: inspectorId,
      notes: `QC APPROVED: ${notes}.${advanced ? ` Unlocked stage: ${unlockedStageName}` : ' Stage signed off.'}${dualWaitingNote}`,
      inspectorPicture
    };

    const updatedLogs = [...logs, newLog];

    setPools(updatedPools);
    poolsRef.current = updatedPools; // keep ref in sync for any immediately-following action
    setTeams(updatedTeams);
    teamsRef.current = updatedTeams; // keep ref in sync for any immediately-following action
    setLogs(updatedLogs);
    saveState(updatedPools, updatedTeams, updatedLogs, inspectors, engineers, updatedPlans);
  };

  // 6. Reject Stage (Sends pool back for rework)
  const handleRejectStage = (poolId: string, stageId: StageId, inspectorId: string, notes: string, inspectorPicture?: string) => {
    const poolIndex = poolsRef.current.findIndex(p => p.id === poolId);
    if (poolIndex === -1) return;

    // SYNC FIX: see handleClaimPool above.
    const updatedPools = [...poolsRef.current];
    const pool = { ...updatedPools[poolIndex], stageHistory: { ...updatedPools[poolIndex].stageHistory } };
    updatedPools[poolIndex] = pool;
    const stageHist = { ...pool.stageHistory[stageId] };

    // AUTO-ASSIGN + AUTO-START REWORK: instead of leaving this REJECTED and
    // waiting for the team to click "Start", we start the timer immediately —
    // the team didn't have to claim or start anything, it's already running.
    stageHist.status = 'IN_PROGRESS';
    stageHist.inspectorId = inspectorId;
    stageHist.inspectorNotes = notes;
    stageHist.inspectionTime = new Date().toISOString();
    stageHist.rejectionCount = (stageHist.rejectionCount || 0) + 1;
    stageHist.inspectorPicture = inspectorPicture;
    stageHist.startTime = new Date().toISOString();
    stageHist.endTime = null;

    const originalWorkspecTeamId = stageHist.teamId;

    // teamId stays set (unchanged), which keeps this pool correctly excluded
    // from `availablePools` (see StageDashboard's `!hist.teamId` filter) so
    // it can't be double-claimed by another team.
    pool.stageHistory[stageId] = stageHist;

    // Add this pool to the team's `reworkPoolIds` list — an ARRAY, not a
    // single slot, so if a SECOND (or third) pool gets rejected on the same
    // team while the first rework is still running, it stacks alongside it
    // rather than overwriting it. None of this touches activePoolId/status,
    // so the team can still claim a brand-new pool as normal work too.
    const updatedTeams = teamsRef.current.map(t => {
      if (t.id === originalWorkspecTeamId) {
        const existing = t.reworkPoolIds || [];
        const nextRework = existing.includes(poolId) ? existing : [...existing, poolId];
        // This pool now lives EXCLUSIVELY in reworkPoolIds. If activePoolId
        // was also pointing at it (the team was doing it as "normal" work
        // when QC rejected it), clear activePoolId so it doesn't render as
        // both the normal card AND a rework card, and so the team is free
        // to claim a genuinely different pool as their next normal job.
        const clearedActivePoolId = t.activePoolId === poolId ? null : t.activePoolId;
        return { ...t, reworkPoolIds: nextRework, activePoolId: clearedActivePoolId };
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
      teamId: originalWorkspecTeamId,
      teamName: teamsRef.current.find(t => t.id === originalWorkspecTeamId)?.name,
      operatorName: inspectorId,
      notes: `QC REJECTED: ${notes}. Auto-assigned and auto-started rework on the same team.`,
      inspectorPicture
    };

    const updatedLogs = [...logs, newLog];

    setPools(updatedPools);
    poolsRef.current = updatedPools; // keep ref in sync for any immediately-following action
    setTeams(updatedTeams);
    teamsRef.current = updatedTeams; // keep ref in sync for any immediately-following action
    setLogs(updatedLogs);
    saveState(updatedPools, updatedTeams, updatedLogs);
  };

  // 6b. Undo Approval (Quality Inspector caught their own mistake AFTER
  // passing a stage — reverts the sign-off and sends the pool back to the
  // shop floor for rework, exactly like a normal rejection).
  //
  // Safety guard: if the pool has already been advanced past this stage AND
  // real work has started on the next stage (or the pool), undoing blindly
  // would silently yank a pool out from under a team that's mid-task on the
  // next step. In that case we block and point the inspector at the
  // Management Portal for a manual correction instead.
  const handleUndoApproval = (poolId: string, stageId: StageId, inspectorId: string, notes: string) => {
    const poolIndex = poolsRef.current.findIndex(p => p.id === poolId);
    if (poolIndex === -1) return;

    const pool = { ...pools[poolIndex], stageHistory: { ...pools[poolIndex].stageHistory } };
    const stageHist = { ...pool.stageHistory[stageId] };
    if (stageHist.status !== 'APPROVED') return; // safety: only ever undo a real approval

    const stageIndex = STAGES.findIndex(s => s.id === stageId);

    const stageHasDownstreamWork = (checkStageId: StageId | null) => {
      if (!checkStageId) return false;
      const st = pool.stageHistory[checkStageId]?.status;
      return !!st && st !== 'NOT_STARTED';
    };

    if (DUAL_STAGE_IDS.includes(stageId)) {
      const gateIdx = STAGES.findIndex(s => s.id === DUAL_STAGE_IDS[0]);
      const nextIndex = gateIdx + DUAL_STAGE_IDS.length;
      if (pool.currentStageIndex > gateIdx) {
        // The sibling approval already moved the pool past the dual gate.
        const nextStageId = nextIndex < STAGES.length ? STAGES[nextIndex].id : null;
        if (pool.completedAt || stageHasDownstreamWork(nextStageId)) {
          alert('Cannot undo — work has already started on the next stage (or the pool is fully completed). Use the Management Portal to make a manual correction instead.');
          return;
        }
        pool.currentStageIndex = gateIdx;
      }
    } else if (pool.currentStageIndex > stageIndex) {
      const nextStageId = stageIndex + 1 < STAGES.length ? STAGES[stageIndex + 1].id : null;
      if (pool.completedAt || stageHasDownstreamWork(nextStageId)) {
        alert('Cannot undo — work has already started on the next stage (or the pool is fully completed). Use the Management Portal to make a manual correction instead.');
        return;
      }
      pool.currentStageIndex = stageIndex;
    }

    const originalWorkspecTeamId = stageHist.teamId;

    // Revert the sign-off and send it back to rework, same end-state as a reject.
    stageHist.status = 'REJECTED';
    stageHist.inspectorId = inspectorId;
    stageHist.inspectorNotes = notes;
    stageHist.inspectionTime = new Date().toISOString();
    stageHist.rejectionCount = (stageHist.rejectionCount || 0) + 1;
    stageHist.startTime = null;
    stageHist.endTime = null;
    stageHist.teamId = undefined;
    pool.stageHistory[stageId] = stageHist;

    const updatedPools = [...poolsRef.current];
    updatedPools[poolIndex] = pool;

    // Defensive: only free up a team if it's STILL pointed at this exact
    // pool/stage right now. Matching on team ID alone was wrong — it would
    // reset a team to IDLE even if that team had since moved on to a
    // completely different pool, wiping their current assignment out from
    // under them mid-work.
    const updatedTeams = teamsRef.current.map(t => {
      if (t.activePoolId === poolId && t.stageId === stageId) {
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
      teamId: originalWorkspecTeamId,
      teamName: teamsRef.current.find(t => t.id === originalWorkspecTeamId)?.name,
      operatorName: inspectorId,
      notes: `QC UNDO: Previously certified approval was reverted by the inspector — ${notes}. Sent back to the shop floor for rework.`,
    };

    const updatedLogs = [...logs, newLog];

    setPools(updatedPools);
    poolsRef.current = updatedPools; // keep ref in sync for any immediately-following action
    setTeams(updatedTeams);
    teamsRef.current = updatedTeams; // keep ref in sync for any immediately-following action
    setLogs(updatedLogs);
    saveState(updatedPools, updatedTeams, updatedLogs);
  };

  // ── Request Undo Claim (from Shop Floor worker) ───────────────────────────────
  const handleRequestUndoClaim = (poolId: string, stageId: StageId, teamName: string, reason: string) => {
    const pool = poolsRef.current.find(p => p.id === poolId);
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
    alert(`✅ Request sent to QA! They will review and unclaim pool ${pool.poolNo} so you can re-pick it.`);
  };

  // ── QA Approves Undo (unclaims the pool stage so correct team can pick) ──────
  const handleApproveUndo = (requestId: string, poolId: string, stageId: StageId, inspectorName: string) => {
    const poolIndex = poolsRef.current.findIndex(p => p.id === poolId);
    if (poolIndex === -1) return;

    // SYNC FIX: cloning `pool` alone wasn't enough — pool.stageHistory was
    // still the SAME nested object as the original, so writing
    // pool.stageHistory[stageId] below still mutated the old state in
    // place, and findChangedIds never detected the change.
    const updatedPools = [...poolsRef.current];
    const pool = { ...updatedPools[poolIndex], stageHistory: { ...updatedPools[poolIndex].stageHistory } };
    const stageHist = { ...pool.stageHistory[stageId] };

    // Reset the stage so any team can claim it again
    stageHist.teamId = null as any;
    stageHist.status = 'NOT_STARTED';
    stageHist.startTime = null as any;
    stageHist.endTime = null as any;
    pool.stageHistory[stageId] = stageHist;

    // Also free the team that was assigned
    const updatedTeams = teamsRef.current.map(t =>
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
    poolsRef.current = updatedPools; // keep ref in sync for any immediately-following action
    setTeams(updatedTeams);
    teamsRef.current = updatedTeams; // keep ref in sync for any immediately-following action
    setLogs(updatedLogs);
    saveState(updatedPools, updatedTeams, updatedLogs, inspectors, engineers, plannedPools);

    // Remove from pending requests
    const updatedRequests = pendingUndoRequests.filter(r => r.id !== requestId);
    setPendingUndoRequests(updatedRequests);
    localStorage.setItem('pending_undo_requests', JSON.stringify(updatedRequests));
  };

  // ── QA Rejects Undo ───────────────────────────────────────────────────────────
  const handleRejectUndo = (requestId: string) => {
    const updatedRequests = pendingUndoRequests.filter(r => r.id !== requestId);
    setPendingUndoRequests(updatedRequests);
    localStorage.setItem('pending_undo_requests', JSON.stringify(updatedRequests));
  };

  const handleSkipOrCarryOnSite = (poolId: string, stageId: StageId, option: 'SKIPPED' | 'CARRIED_ON_SITE', operatorName: string) => {
    const poolIndex = poolsRef.current.findIndex(p => p.id === poolId);
    if (poolIndex === -1) return;

    // SYNC FIX: see handleClaimPool above.
    const updatedPools = [...poolsRef.current];
    const pool = { ...updatedPools[poolIndex], stageHistory: { ...updatedPools[poolIndex].stageHistory } };
    updatedPools[poolIndex] = pool;
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
    const updatedTeams = teamsRef.current.map(t => {
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
    poolsRef.current = updatedPools; // keep ref in sync for any immediately-following action
    setTeams(updatedTeams);
    teamsRef.current = updatedTeams; // keep ref in sync for any immediately-following action
    setLogs(updatedLogs);
    saveState(updatedPools, updatedTeams, updatedLogs, inspectors, engineers, updatedPlans);
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
    return <LoginScreen onLoginSuccess={(user) => { setIdleLogoutNotice(false); handleLoginSuccess(user); }} idleLoggedOut={idleLogoutNotice} />;
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans selection:bg-blue-250 antialiased">

      {/* Always-visible top bar: hamburger (mobile only) opens the portal
          drawer; logo + name centered on mobile, left-aligned on desktop */}
      <TopBar
        onMenuClick={() => setNavOpen(true)}
        showMenuButton={!isCodeCheckedInWorker}
        workerExit={isCodeCheckedInWorker ? { teamName: teams.find(t => t.id === workerTeamId)?.name || 'Team', onExit: handleWorkerLogout } : undefined}
        onExitPortal={!isCodeCheckedInWorker ? handleLogout : undefined}
      />

      {/* Below the top bar: sidebar + page content sit side by side on lg+
          screens (persistent Fiori-style nav rail), and stack as an overlay
          drawer + full-width content on smaller screens (unchanged mobile
          behavior). */}
      <div className="flex-1 flex min-h-0">

        {/* Portal navigation — overlay drawer on mobile, permanent
            collapsible sidebar on lg+ (see RoleSelector.tsx). Hidden entirely
            once a worker has checked in via their team code: they should
            only ever see their own stage screen until they hit Exit. */}
        {!isCodeCheckedInWorker && (
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
        )}
        {/* Global Page Up / Page Down floating buttons — visible on all portals */}
        <ScrollButtons />

        {/* Shop Floor kiosk auto-print agent: this tablet sits next to the
            store printer, so as soon as the Shop Floor portal is open here,
            it listens for manager approvals (from anywhere, any network)
            and prints the issue slip automatically — no manual click. */}
        {currentRole === 'stage_worker' && <AutoPrintMaterialSlip />}

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

            {/* DATA-LOSS FIX (v11): visible whenever ANY device-local change
                hasn't actually reached Firestore yet, independent of the
                badge above — so a weak-signal write that got queued for
                retry never silently looks identical to a fully-synced one. */}
            {pendingWriteCount > 0 && (
              <div
                className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-amber-950/60 border border-amber-700/80 font-mono text-[10px]"
                title="Saved on this device. Retrying automatically until the signal is strong enough to reach the cloud."
              >
                <RefreshCw className="h-3 w-3 text-amber-400 animate-spin" />
                <span className="text-amber-300 font-bold">
                  {pendingWriteCount} change{pendingWriteCount > 1 ? 's' : ''} syncing...
                </span>
              </div>
            )}

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
          stationLock={isCodeCheckedInWorker ? { isLocked: true, stageId: selectedStageId, teamId: workerTeamId } : stationLock}
        />
        {currentRole === 'planning_department' && (
          <PlanningDepartment
            plannedPools={plannedPools}
            pools={pools}
            onAddPlannedPool={handleAddPlannedPool}
            onAddPlannedPoolBatch={handleAddPlannedPoolBatch}
            onDeletePlannedPool={handleDeletePlannedPool}
            onBulkDeletePlannedPools={handleBulkDeletePlannedPools}
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

        {currentRole === 'stage_worker' && checkedInSupervisor && (
          <SupervisorPortal
            currentUserName={checkedInSupervisor.name}
            projectNames={Array.from(new Set([...pools, ...plannedPools].map(p => p.projectName).filter(Boolean)))}
            poolTypesByProject={[...pools, ...plannedPools].reduce((acc: Record<string, string[]>, p) => {
              if (!p.projectName || !p.poolType) return acc;
              if (!acc[p.projectName]) acc[p.projectName] = [];
              if (!acc[p.projectName].includes(p.poolType)) acc[p.projectName].push(p.poolType);
              return acc;
            }, {})}
            onSwitchUser={handleSupervisorSwitchUser}
          />
        )}

        {currentRole === 'stage_worker' && !checkedInSupervisor && (
          <>
            {/* Floating widget: lets a supervisor jump into their own portal
                from this same shared computer without logging out of the
                stage_worker account. */}
            <div className="fixed bottom-4 right-4 z-40">
              {showSupervisorCodeBox ? (
                <div className="bg-white border border-slate-200 rounded-2xl shadow-xl p-4 w-64">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-black text-slate-700 uppercase flex items-center gap-1.5">
                      <HardHat className="h-3.5 w-3.5 text-amber-500" />
                      Supervisor Code
                    </span>
                    <button
                      onClick={() => { setShowSupervisorCodeBox(false); setSupervisorCodeError(''); setSupervisorCodeInput(''); }}
                      className="text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <input
                    type="password"
                    inputMode="numeric"
                    value={supervisorCodeInput}
                    onChange={(e) => { setSupervisorCodeInput(e.target.value); setSupervisorCodeError(''); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSupervisorCodeSubmit(); }}
                    autoFocus
                    placeholder="Enter code"
                    className="w-full text-center text-base tracking-widest font-mono border border-slate-200 rounded-xl px-3 py-2 font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                  {supervisorCodeError && (
                    <p className="text-[10px] font-bold text-rose-500 mt-1.5">{supervisorCodeError}</p>
                  )}
                  <button
                    onClick={handleSupervisorCodeSubmit}
                    disabled={supervisorCodeChecking}
                    className="w-full mt-2.5 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-60 text-white font-bold text-xs rounded-xl cursor-pointer"
                  >
                    {supervisorCodeChecking ? 'Checking…' : 'Open Supervisor Portal'}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowSupervisorCodeBox(true)}
                  className="flex items-center gap-1.5 px-3.5 py-2.5 bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs rounded-full shadow-lg cursor-pointer"
                >
                  <HardHat className="h-3.5 w-3.5" />
                  Supervisor Login
                </button>
              )}
            </div>

            {(stationLock.isLocked && stationLock.teamId) || workerCheckedIn ? (
            <StageDashboard
              stage={currentStageInfo}
              pools={pools}
              teams={teams}
              selectedTeamId={workerTeamId}
              onClaimPool={handleClaimPool}
              onStartStage={handleStartStage}
              onFinishStage={handleFinishStage}
              onQuickBatchComplete={handleQuickBatchComplete}
              googleUser={googleUser}
              onGoogleSignIn={handleGoogleSignIn}
              onSkipOrCarryOnSite={handleSkipOrCarryOnSite}
              onRequestUndoClaim={handleRequestUndoClaim}
              onRefresh={refreshFromCloud}
              isSyncing={isSyncing}
              qcDefects={qcDefects}
              onWorkerLogout={(stationLock.isLocked && stationLock.teamId) ? undefined : handleWorkerLogout}
            />
          ) : (
            <div className="min-h-[70vh] flex items-center justify-center px-4">
              <div className="w-full max-w-sm bg-white rounded-2xl border border-slate-100 shadow-sm p-6 text-center">
                <div className="h-12 w-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center mx-auto mb-3 font-black text-lg">
                  #
                </div>
                <h3 className="text-sm font-black text-slate-800">Enter Your Team Code</h3>
                <p className="text-xs text-slate-400 mt-1 mb-5">
                  Ask your supervisor for your team's login code. You'll only see your own section and your own pool.
                </p>
                <input
                  type="password"
                  inputMode="numeric"
                  value={teamCodeInput}
                  onChange={(e) => { setTeamCodeInput(e.target.value); setTeamCodeError(''); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleTeamCodeSubmit(); }}
                  autoFocus
                  placeholder="Team code"
                  className="w-full text-center text-lg tracking-widest font-mono border border-slate-200 rounded-xl px-3 py-3 font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400"
                />
                {teamCodeError && (
                  <p className="text-xs font-bold text-rose-500 mt-2">{teamCodeError}</p>
                )}
                <button
                  onClick={handleTeamCodeSubmit}
                  className="w-full mt-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl cursor-pointer"
                >
                  Check In
                </button>
              </div>
            </div>
          )}
          </>
        )}

        {currentRole === 'quality_inspector' && (
          <QualityInspector
            pools={pools}
            allTeams={teams}
            onApproveStage={handleApproveStage}
            onRejectStage={handleRejectStage}
            onUndoApproval={handleUndoApproval}
            inspectors={inspectors}
            currentUserName={loggedInUser?.displayName}
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
            logs={logs}
            onHoldPool={handleHoldPool}
            onReleaseHold={handleReleaseHold}
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
            onBulkDeletePlannedPools={handleBulkDeletePlannedPools}
            onDeletePool={handleDeletePool}
            onUpdatePool={handleUpdatePool}
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
            onClaimPool={handleClaimPool}
            onStartStage={handleStartStage}
            onFinishStage={handleFinishStage}
            onQuickBatchComplete={handleQuickBatchComplete}
            onSkipOrCarryOnSite={handleSkipOrCarryOnSite}
            onRequestUndoClaim={handleRequestUndoClaim}
            onRefresh={refreshFromCloud}
            isSyncing={isSyncing}
            qcDefects={qcDefects}
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
            companyList={companyList}
            onSaveCompanies={handleSaveCompanies}
            onAddEmployeePunchesBulk={handleSaveEmployeePunchesBulk}
            onAddEmployeesBulk={handleSaveEmployeesBulk}
            onDeleteEmployeePunchesByDate={handleDeleteEmployeePunchesByDate}
            currentUserName={loggedInUser?.displayName}
            onIdleTimeoutChange={(minutes: number) => {
              localStorage.setItem('mat_idle_timeout_min', String(minutes));
            }}
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
          checkedInSupervisor ? (
            <SupervisorPortal
              currentUserName={checkedInSupervisor.name}
              projectNames={Array.from(new Set([...pools, ...plannedPools].map(p => p.projectName).filter(Boolean)))}
              poolTypesByProject={[...pools, ...plannedPools].reduce((acc: Record<string, string[]>, p) => {
                if (!p.projectName || !p.poolType) return acc;
                if (!acc[p.projectName]) acc[p.projectName] = [];
                if (!acc[p.projectName].includes(p.poolType)) acc[p.projectName].push(p.poolType);
                return acc;
              }, {})}
              onSwitchUser={handleSupervisorSwitchUser}
            />
          ) : (
            <div className="min-h-[70vh] flex items-center justify-center px-4">
              <div className="w-full max-w-sm bg-white rounded-2xl border border-slate-100 shadow-sm p-6 text-center">
                <div className="h-12 w-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center mx-auto mb-3 font-black text-lg">
                  #
                </div>
                <h3 className="text-sm font-black text-slate-800">Enter Your Code</h3>
                <p className="text-xs text-slate-400 mt-1 mb-5">
                  Enter your personal supervisor code. Ask Management if you don't have one yet.
                </p>
                <input
                  type="password"
                  inputMode="numeric"
                  value={supervisorCodeInput}
                  onChange={(e) => { setSupervisorCodeInput(e.target.value); setSupervisorCodeError(''); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSupervisorCodeSubmit(); }}
                  autoFocus
                  placeholder="Supervisor code"
                  className="w-full text-center text-lg tracking-widest font-mono border border-slate-200 rounded-xl px-3 py-3 font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400"
                />
                {supervisorCodeError && (
                  <p className="text-xs font-bold text-rose-500 mt-2">{supervisorCodeError}</p>
                )}
                <button
                  onClick={handleSupervisorCodeSubmit}
                  disabled={supervisorCodeChecking}
                  className="w-full mt-4 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white font-bold text-xs rounded-xl cursor-pointer"
                >
                  {supervisorCodeChecking ? 'Checking…' : 'Continue'}
                </button>
              </div>
            </div>
          )
        )}

        {currentRole === 'factory_supervisor' && (
          <FactorySupervisorPortal
            currentUserName={loggedInUser?.displayName || 'Factory Supervisor'}
            pools={pools}
            teams={teams}
            logs={logs}
            plannedPools={plannedPools}
            googleUser={googleUser}
            onGoogleSignIn={handleGoogleSignIn}
            onClaimPool={handleClaimPool}
            onStartStage={handleStartStage}
            onFinishStage={handleFinishStage}
            onQuickBatchComplete={handleQuickBatchComplete}
            onSkipOrCarryOnSite={handleSkipOrCarryOnSite}
            onRequestUndoClaim={handleRequestUndoClaim}
            onRefresh={refreshFromCloud}
            isSyncing={isSyncing}
            qcDefects={qcDefects}
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
            employeePunches={employeePunches}
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
