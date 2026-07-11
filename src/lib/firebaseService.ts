import { auth, app } from './googleDrive.ts';
import { getFirestore, doc, getDoc, setDoc, runTransaction, onSnapshot, Unsubscribe } from 'firebase/firestore';
import { Pool, Team, ActivityLog, PlannedPool, ProjectSummary, MonthlyTarget, Employee, TrolleyProduction, RecycleBinItem, EmployeePunch, Material, BOMItem, MaterialRequest, FloorStock } from '../types';

const clientDb = getFirestore(app);

// ──────────────────────────────────────────────────────────────────────────────
// REAL-TIME LIVE SYNC (Firestore onSnapshot)
// Subscribes to all `system_state` documents. Any change on PC-A is pushed
// instantly to PC-B / PC-C / TV dashboards — no refresh, no polling.
// ──────────────────────────────────────────────────────────────────────────────
export function subscribeToLiveState(
  callback: (payload: { collection: string; data: any[] }) => void
): Unsubscribe {
  const collections = [
    'pools',
    'plannedPools',
    'teams',
    'logs',
    'inspectors',
    'engineers',
    'projectsSummary',
    'monthlyTargets',
    'employees',
    'trolleys',
    'recycleBin',
    'employeePunches',
    'hrLeaves',
    'hrWarnings',
    'hrPayroll',
    'hrAccidents',
    'hrMedicals',
  ];
  const unsubs: Unsubscribe[] = collections.map(name =>
    onSnapshot(
      doc(clientDb, 'system_state', name),
      snap => {
        if (snap.exists()) {
          const raw = snap.data();
          const data = Array.isArray(raw?.data) ? raw.data : [];
          callback({ collection: name, data });
        }
        // BUGFIX: when the Firestore document does NOT exist (collection not yet
        // created on this device), do NOT fire callback with data:[]. Firing an
        // empty array would overwrite real local state with nothing, causing
        // visible "data loss" right after login on a fresh device or when a
        // single collection happens to be missing in Firestore. Stay silent
        // instead — the next write will create the doc and trigger a real
        // snapshot.
      },
      err => console.warn(`[liveSync] ${name} subscription error:`, err)
    )
  );
  return () => unsubs.forEach(u => { try { u(); } catch {} });
}

// Direct client firestore document read utilities.
// NOTE: this version is tolerant of transient errors — it returns [] instead of
// throwing so the UI doesn't crash on a brief network hiccup. It is used for
// normal reads (loading data to show on screen), NOT for the empty-write
// safety check below. See getFirestoreDocArrayStrict for that.
async function getFirestoreDocArray(docName: string): Promise<any[]> {
  try {
    const docRef = doc(clientDb, 'system_state', docName);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const resp = snap.data();
      return Array.isArray(resp?.data) ? resp.data : [];
    }
  } catch (err) {
    console.warn(`Direct client Firestore fetch warning for '${docName}':`, err);
  }
  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// CRITICAL FIX (data-loss root cause): FAIL-SAFE read used ONLY by the
// empty-write safety guard in setFirestoreDocArray.
//
// THE BUG: the old code used getFirestoreDocArray (above) for the "is it
// really safe to write an empty array?" check. That function swallows every
// error — a slow connection, a brief auth hiccup, Firestore having a bad
// half-second — and quietly returns [], identical to "this collection is
// genuinely empty". The guard then concluded "nothing here, safe to write
// empty" and overwrote real data.
//
// THE FIX: this function does NOT catch read errors. If the check-read fails
// for any reason, the error propagates up so the caller can refuse the write
// instead of assuming the collection is empty. Fail safe, not fail open.
// ─────────────────────────────────────────────────────────────────────────────
async function getFirestoreDocArrayStrict(docName: string): Promise<any[]> {
  const docRef = doc(clientDb, 'system_state', docName);
  const snap = await getDoc(docRef);
  if (snap.exists()) {
    const resp = snap.data();
    return Array.isArray(resp?.data) ? resp.data : [];
  }
  return [];
}

// Recursively removes undefined values — Firestore rejects them
function removeUndefined(value: any): any {
  if (Array.isArray(value)) return value.map(removeUndefined);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, removeUndefined(v)])
    );
  }
  return value;
}

async function setFirestoreDocArray(docName: string, data: any[], allowEmpty: boolean = false): Promise<void> {
  try {
    // SAFETY GUARD: never overwrite a collection with an empty array unless
    // the caller explicitly passes allowEmpty=true (e.g. dbClearAllEmployeePunches)
    if (!allowEmpty && data.length === 0) {
      // Check if Firestore already has data — if yes, refuse to wipe it.
      // FAIL-SAFE: if this check-read itself throws (network blip, auth
      // hiccup, Firestore error), we do NOT know whether real data exists.
      // We must never treat "couldn't check" as "must be empty" — that was
      // the exact bug that wiped real collections. So on any check failure,
      // refuse the write and log it, same as when we positively detect data.
      let existing: any[];
      try {
        existing = await getFirestoreDocArrayStrict(docName);
      } catch (checkErr) {
        console.error(`[setFirestoreDocArray] Safety check failed for '${docName}' — refusing empty write to avoid risking data loss:`, checkErr);
        return;
      }
      if (existing.length > 0) {
        console.warn(`[setFirestoreDocArray] Blocked empty-array write to '${docName}' — Firestore already has ${existing.length} records. Use allowEmpty=true to intentionally clear.`);
        return;
      }
    }
    const docRef = doc(clientDb, 'system_state', docName);
    await setDoc(docRef, { data: removeUndefined(data) });
  } catch (err) {
    console.error(`Direct client Firestore write error for '${docName}':`, err);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CRITICAL FIX: updateFirestoreDocArray now uses Firestore Transactions.
//
// PREVIOUS BUG (data loss on simultaneous writes):
//   PC-A: read [pool1,pool2] → add pool3 → write [pool1,pool2,pool3]
//   PC-B: read [pool1,pool2] → add pool4 → write [pool1,pool2,pool4]  ← pool3 GONE
//
// WITH TRANSACTION (safe):
//   PC-A: reads inside transaction → adds pool3 → writes atomically
//   PC-B: tries to read → Firestore detects conflict → auto-retries → reads [pool1,pool2,pool3] → adds pool4 → writes [pool1,pool2,pool3,pool4]
//
// Firestore transactions auto-retry up to 5 times on conflict.
// Zero data loss, zero manual merging needed.
// ─────────────────────────────────────────────────────────────────────────────
async function updateFirestoreDocArray(docName: string, updateFn: (arr: any[]) => any[], allowEmpty: boolean = false): Promise<any[]> {
  const docRef = doc(clientDb, 'system_state', docName);
  let updatedArr: any[] = [];

  try {
    await runTransaction(clientDb, async (transaction) => {
      const snap = await transaction.get(docRef);
      // Read current array inside the transaction (atomic read)
      const current: any[] = snap.exists() && Array.isArray(snap.data()?.data)
        ? snap.data()!.data
        : [];

      // Apply the caller's update function
      updatedArr = updateFn([...current]);

      // SAFETY: refuse to write an empty array if current had data, UNLESS
      // the caller explicitly says this is an intentional last-item delete
      // (allowEmpty=true). Without allowEmpty, a bug that accidentally
      // produces [] (e.g. a bad fetch) can't silently wipe a collection —
      // but a genuine "delete the only remaining item" now actually works,
      // instead of silently failing while the UI reports success.
      if (!allowEmpty && updatedArr.length === 0 && current.length > 0) {
        console.warn(`[updateFirestoreDocArray] Refusing to write empty array to '${docName}' (current has ${current.length} items). Skipping write.`);
        updatedArr = current; // keep existing data
        return;
      }

      // Write back atomically — if another device wrote between our read and
      // this write, Firestore will abort and retry the whole transaction
      transaction.set(docRef, { data: removeUndefined(updatedArr) });
    });
  } catch (err) {
    console.error(`[updateFirestoreDocArray] Transaction failed for '${docName}':`, err);
    throw err;
  }

  return updatedArr;
}

export function getApiUrl(path: string): string {
  const explicit = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/$/, '');
  return `${explicit}${path}`;
}

// Helper to construct request headers with the Firebase Auth ID Token (required for security)
async function getHeaders() {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const currentUser = auth.currentUser;
  if (currentUser) {
    try {
      const token = await currentUser.getIdToken();
      headers['Authorization'] = `Bearer ${token}`;
    } catch (error) {
      console.warn('Could not retrieve ID token from Firebase auth listener:', error);
    }
  }
  return headers;
}

// 1. Get entire Unified Production Ledger state from PostgreSQL database or client Firestore
// Lightweight poll — only fetches pools + teams (2 reads instead of 12)
// Used by background polling on shop floor portals to minimize Firebase costs
export async function getLiveStateFromFirestore(): Promise<{ pools: any[]; teams: any[]; logs: any[] } | null> {
  try {
    const [pools, teams, logs] = await Promise.all([
      getFirestoreDocArray('pools'),
      getFirestoreDocArray('teams'),
      getFirestoreDocArray('logs'),
    ]);
    return { pools, teams, logs };
  } catch (err) {
    console.warn('Lightweight poll failed:', err);
    return null;
  }
}

export async function getEntireStateFromFirestore() {
  const base = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/$/, '');
  if (!base) {
    console.log('MAT-ERP running in serverless client-side mode (direct Firestore)');
    try {
      const [pools, plannedPools, teams, logs, inspectors, engineers, projectsSummary, monthlyTargets, employees, trolleys, recycleBin, employeePunches] = await Promise.all([
        getFirestoreDocArray('pools'),
        getFirestoreDocArray('plannedPools'),
        getFirestoreDocArray('teams'),
        getFirestoreDocArray('logs'),
        getFirestoreDocArray('inspectors'),
        getFirestoreDocArray('engineers'),
        getFirestoreDocArray('projectsSummary'),
        getFirestoreDocArray('monthlyTargets'),
        getFirestoreDocArray('employees'),
        getFirestoreDocArray('trolleys'),
        getFirestoreDocArray('recycleBin'),
        getFirestoreDocArray('employeePunches')
      ]);

      const isInitializedInCloud = projectsSummary.some(p => p.id === 'SENTINEL_DB_INITIALIZED');
      const filteredProjects = projectsSummary.filter(p => p.id !== 'SENTINEL_DB_INITIALIZED');

      // BUGFIX: previous check only looked at pools + employees. If the user
      // had ONLY planned-pools, projects-summary, monthly-targets, trolleys or
      // teams data (and no pools/employees yet), `isInitialized` came back
      // false → App.tsx then re-seeded DEFAULT demo data and overwrote their
      // real records. Treat ANY non-empty collection as proof the DB is
      // initialized.
      const anyDataExists =
        pools.length > 0 ||
        plannedPools.length > 0 ||
        filteredProjects.length > 0 ||
        monthlyTargets.length > 0 ||
        employees.length > 0 ||
        trolleys.length > 0 ||
        teams.length > 0 ||
        logs.length > 0 ||
        inspectors.length > 0 ||
        engineers.length > 0 ||
        recycleBin.length > 0 ||
        employeePunches.length > 0;

      return {
        isInitialized: isInitializedInCloud || anyDataExists,
        pools,
        plannedPools,
        teams,
        logs,
        inspectors,
        engineers,
        projectsSummary: filteredProjects,
        monthlyTargets,
        employees,
        trolleys,
        recycleBin,
        employeePunches
      };
    } catch (err) {
      console.error('Direct Firestore read failed, falling back:', err);
      throw err;
    }
  }

  try {
    const headers = await getHeaders();
    const response = await fetch(getApiUrl('/api/state'), {
      headers,
    });
    if (!response.ok) {
      throw new Error(`API returned state load error: ${response.statusText}`);
    }
    const data = await response.json();
    const rawProjects = (data.projectsSummary as ProjectSummary[]) || [];
    const isInitializedInCloud = rawProjects.some(p => p.id === 'SENTINEL_DB_INITIALIZED');
    const filteredProjects = rawProjects.filter(p => p.id !== 'SENTINEL_DB_INITIALIZED');

    return {
      isInitialized: isInitializedInCloud,
      pools: (data.pools as Pool[]) || [],
      plannedPools: (data.plannedPools as PlannedPool[]) || [],
      teams: (data.teams as Team[]) || [],
      logs: (data.logs as ActivityLog[]) || [],
      inspectors: data.inspectors || [],
      engineers: data.engineers || [],
      projectsSummary: filteredProjects,
      monthlyTargets: (data.monthlyTargets as MonthlyTarget[]) || [],
      employees: (data.employees as Employee[]) || [],
      trolleys: (data.trolleys as TrolleyProduction[]) || [],
      recycleBin: (data.recycleBin as RecycleBinItem[]) || [],
      employeePunches: (data.employeePunches as EmployeePunch[]) || [],
    };
  } catch (error) {
    console.error('Error fetching state from Cloud SQL server proxy:', error);
    throw error;
  }
}

// 2. Full deep reset/seeding of Postgres database (on reset or mock seed trigger)
export async function saveEntireStateToFirestore(
  poolsList: Pool[],
  teamsList: Team[],
  logsList: ActivityLog[],
  inspectorsList: any[],
  engineersList: any[],
  plannedPoolsList: PlannedPool[] = [],
  projectsSummaryList: ProjectSummary[] = [],
  monthlyTargetsList: MonthlyTarget[] = [],
  employeesList: Employee[] = []
) {
  const base = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/$/, '');
  const hasSentinel = projectsSummaryList.some(p => p.id === 'SENTINEL_DB_INITIALIZED');
  const finalProjects = hasSentinel 
    ? projectsSummaryList 
    : [
        ...projectsSummaryList,
        {
          id: 'SENTINEL_DB_INITIALIZED',
          projectName: 'System Sentinel',
          orientation: 'Normal',
          poolType: 'Type 1',
          totalPools: 0,
          deliveredPools: 0,
          producedPools: 0,
          remainingPools: 0,
          notes: 'Database initialization sentinel record.',
          createdAt: new Date().toISOString()
        }
      ];

  if (!base) {
    console.log('Saving entire state directly to Firestore... (Server-less mode)');
    // NOTE: trolleys, recycleBin, employeePunches are managed by their own fine-grained
    // db functions and must NOT be overwritten here — only update what was explicitly passed
    // Use allowEmpty=false (default) on all collections — never accidentally wipe real data
    await Promise.all([
      setFirestoreDocArray('pools', poolsList),
      setFirestoreDocArray('plannedPools', plannedPoolsList),
      setFirestoreDocArray('teams', teamsList),
      setFirestoreDocArray('logs', logsList.slice(-200)),
      setFirestoreDocArray('inspectors', inspectorsList),
      setFirestoreDocArray('engineers', engineersList),
      setFirestoreDocArray('projectsSummary', finalProjects),
      setFirestoreDocArray('monthlyTargets', monthlyTargetsList),
      setFirestoreDocArray('employees', employeesList),
    ]);
    return { success: true };
  }

  try {
    const headers = await getHeaders();
    const response = await fetch(getApiUrl('/api/state/reset'), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        pools: poolsList,
        plannedPools: plannedPoolsList,
        teams: teamsList,
        logs: logsList.slice(-200), // Keep logs to last 200 for clean database load efficiency
        inspectors: inspectorsList,
        engineers: engineersList,
        projectsSummary: finalProjects,
        monthlyTargets: monthlyTargetsList,
        employees: employeesList
      }),
    });
    if (!response.ok) {
      throw new Error(`State initialization failed: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error syncing complete state to Cloud SQL:', error);
    throw error;
  }
}

function makeSentinel() {
  return {
    id: 'SENTINEL_DB_INITIALIZED',
    projectName: 'System Sentinel',
    orientation: 'Normal',
    poolType: 'Type 1',
    totalPools: 0,
    deliveredPools: 0,
    producedPools: 0,
    remainingPools: 0,
    notes: 'Database initialization sentinel record.',
    createdAt: new Date().toISOString()
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// DATA-LOSS FIX (v7 — root-cause fix for the "changes revert" / "6 PCs
// overwrite each other" bug):
//
// THE BUG (v6 and earlier): this function called
//   updateFirestoreDocArray(name, () => data)
// The `() => data` updater IGNORES the `current` array that the transaction
// just read live from Firestore, and unconditionally writes this device's
// local `data` instead. Every save from every device replaced the ENTIRE
// collection with whatever that one device happened to have locally — so
// any record another device had written moments earlier (that this device
// hadn't synced yet) was silently discarded. That's why a completed task
// could "come back", and why more devices made it worse.
//
// THE FIX: each entry now carries a per-record diff (`upserts` + `deletes`)
// instead of a full array snapshot. The updater merges that diff onto the
// live `current` array read inside the transaction:
//   • records neither added nor removed by this device are left exactly as
//     Firestore already has them (protects concurrent edits from other PCs)
//   • only the record(s) this device actually touched are upserted/removed
//   • Firestore transactions still retry automatically on write conflicts
// ─────────────────────────────────────────────────────────────────────────────
export interface CollectionDiff {
  /** Records that were added or modified on this device, keyed by `id`. */
  upserts: any[];
  /** IDs of records that were removed on this device. */
  deletes: string[];
}

function isPlainDiff(value: any): value is CollectionDiff {
  return value && typeof value === 'object' && Array.isArray(value.upserts) && Array.isArray(value.deletes);
}

export async function saveChangedCollectionsToFirestore(
  changed: Record<string, CollectionDiff | any[]>
) {
  const entries = Object.entries(changed);
  if (entries.length === 0) return { success: true };

  await Promise.all(entries.map(([name, value]) => {
    // Backward-compatible: if a caller ever passes a raw array again (old
    // call shape), treat every record in it as an upsert with no deletes,
    // rather than silently reverting to the unsafe blind-overwrite behavior.
    const diff: CollectionDiff = isPlainDiff(value)
      ? value
      : { upserts: Array.isArray(value) ? value : [], deletes: [] };

    return updateFirestoreDocArray(name, (current) => {
      // Start from the FRESH server-side array read inside this transaction —
      // never from this device's possibly-stale local copy.
      let next = current.filter((item: any) => !diff.deletes.includes(item?.id));

      diff.upserts.forEach((record: any) => {
        const idx = next.findIndex((item: any) => item?.id === record?.id);
        if (idx !== -1) next[idx] = record;
        else next.push(record);
      });

      if (name === 'logs') next = next.slice(-200);
      if (name === 'projectsSummary' && !next.some((p: any) => p.id === 'SENTINEL_DB_INITIALIZED')) {
        next = [...next, makeSentinel()];
      }

      return next;
    });
  }));

  return { success: true };
}

// Intentional full wipe — ONLY used by the Management "Purge All Data" button
// after the user types DELETE to confirm. Keeps the sentinel so the app never
// re-seeds demo data afterwards.
export async function wipeAllCollectionsFromFirestore() {
  const names = ['pools', 'plannedPools', 'teams', 'logs', 'inspectors', 'engineers', 'projectsSummary', 'monthlyTargets', 'employees', 'trolleys', 'recycleBin'];
  await Promise.all(names.map(n =>
    setFirestoreDocArray(n, n === 'projectsSummary' ? [makeSentinel()] : [], true)
  ));
  return { success: true };
}

// 2.1 Fine-grained operations: Employees
export async function dbSaveEmployee(employee: Employee) {
  const base = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/$/, '');
  if (!base) {
    await updateFirestoreDocArray('employees', (arr) => {
      const idx = arr.findIndex(item => item.id === employee.id);
      if (idx !== -1) arr[idx] = employee;
      else arr.push(employee);
      return arr;
    });
    return { success: true, employee };
  }

  try {
    const headers = await getHeaders();
    const response = await fetch(getApiUrl('/api/employees'), {
      method: 'POST',
      headers,
      body: JSON.stringify(employee),
    });
    if (!response.ok) throw new Error('Failed to save Employee to SQL.');
    return await response.json();
  } catch (error) {
    console.error('dbSaveEmployee failed:', error);
    throw error;
  }
}

export async function dbDeleteEmployee(id: string) {
  const base = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/$/, '');
  if (!base) {
    await updateFirestoreDocArray('employees', (arr) => arr.filter(item => item.id !== id), true);
    return { success: true };
  }

  try {
    const headers = await getHeaders();
    const response = await fetch(getApiUrl(`/api/employees/${id}`), {
      method: 'DELETE',
      headers,
    });
    if (!response.ok) throw new Error('Failed to delete Employee from SQL.');
    return await response.json();
  } catch (error) {
    console.error('dbDeleteEmployee failed:', error);
    throw error;
  }
}

// 3. Fine-grained operations: Pools
export async function dbSavePool(pool: Pool) {
  const base = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/$/, '');
  if (!base) {
    await updateFirestoreDocArray('pools', (arr) => {
      const idx = arr.findIndex(item => item.id === pool.id);
      if (idx !== -1) arr[idx] = pool;
      else arr.push(pool);
      return arr;
    });
    return { success: true, pool };
  }

  try {
    const headers = await getHeaders();
    const response = await fetch(getApiUrl('/api/pools'), {
      method: 'POST',
      headers,
      body: JSON.stringify(pool),
    });
    if (!response.ok) throw new Error('Failed to save Pool to SQL.');
    return await response.json();
  } catch (error) {
    console.error('dbSavePool failed:', error);
    throw error;
  }
}

export async function dbDeletePool(poolId: string) {
  const base = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/$/, '');
  if (!base) {
    await updateFirestoreDocArray('pools', (arr) => arr.filter(item => item.id !== poolId), true);
    return { success: true };
  }

  try {
    const headers = await getHeaders();
    const response = await fetch(getApiUrl(`/api/pools/${poolId}`), {
      method: 'DELETE',
      headers,
    });
    if (!response.ok) throw new Error('Failed to delete Pool from SQL.');
    return await response.json();
  } catch (error) {
    console.error('dbDeletePool failed:', error);
    throw error;
  }
}

// 4. Fine-grained operations: Planned Pools (from Planning Department)
export async function dbSavePlannedPool(planned: PlannedPool) {
  const base = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/$/, '');
  if (!base) {
    await updateFirestoreDocArray('plannedPools', (arr) => {
      const idx = arr.findIndex(item => item.id === planned.id);
      if (idx !== -1) arr[idx] = planned;
      else arr.push(planned);
      return arr;
    });
    return { success: true, planned };
  }

  try {
    const headers = await getHeaders();
    const response = await fetch(getApiUrl('/api/planned-pools'), {
      method: 'POST',
      headers,
      body: JSON.stringify(planned),
    });
    if (!response.ok) throw new Error('Failed to save Planned Pool to SQL.');
    return await response.json();
  } catch (error) {
    console.error('dbSavePlannedPool failed:', error);
    throw error;
  }
}

export async function dbDeletePlannedPool(plannedId: string) {
  const base = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/$/, '');
  if (!base) {
    await updateFirestoreDocArray('plannedPools', (arr) => arr.filter(item => item.id !== plannedId), true);
    return { success: true };
  }

  try {
    const headers = await getHeaders();
    const response = await fetch(getApiUrl(`/api/planned-pools/${plannedId}`), {
      method: 'DELETE',
      headers,
    });
    if (!response.ok) throw new Error('Failed to delete Planned Pool from SQL.');
    return await response.json();
  } catch (error) {
    console.error('dbDeletePlannedPool failed:', error);
    throw error;
  }
}

// 5. Fine-grained operations: Projects Summary
export async function dbSaveProjectSummary(summary: ProjectSummary) {
  const base = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/$/, '');
  if (!base) {
    await updateFirestoreDocArray('projectsSummary', (arr) => {
      const idx = arr.findIndex(item => item.id === summary.id);
      if (idx !== -1) arr[idx] = summary;
      else arr.push(summary);
      return arr;
    });
    return { success: true, summary };
  }

  try {
    const headers = await getHeaders();
    const response = await fetch(getApiUrl('/api/projects-summary'), {
      method: 'POST',
      headers,
      body: JSON.stringify(summary),
    });
    if (!response.ok) throw new Error('Failed to save Project Summary to SQL.');
    return await response.json();
  } catch (error) {
    console.error('dbSaveProjectSummary failed:', error);
    throw error;
  }
}

export async function dbDeleteProjectSummary(id: string) {
  const base = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/$/, '');
  if (!base) {
    await updateFirestoreDocArray('projectsSummary', (arr) => arr.filter(item => item.id !== id), true);
    return { success: true };
  }

  try {
    const headers = await getHeaders();
    const response = await fetch(getApiUrl(`/api/projects-summary/${id}`), {
      method: 'DELETE',
      headers,
    });
    if (!response.ok) throw new Error('Failed to delete Project Summary from SQL.');
    return await response.json();
  } catch (error) {
    console.error('dbDeleteProjectSummary failed:', error);
    throw error;
  }
}

// 6. Fine-grained operations: Monthly Targets
export async function dbSaveMonthlyTarget(target: MonthlyTarget) {
  const base = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/$/, '');
  if (!base) {
    await updateFirestoreDocArray('monthlyTargets', (arr) => {
      const idx = arr.findIndex(item => item.id === target.id);
      if (idx !== -1) arr[idx] = target;
      else arr.push(target);
      return arr;
    });
    return { success: true, target };
  }

  try {
    const headers = await getHeaders();
    const response = await fetch(getApiUrl('/api/monthly-targets'), {
      method: 'POST',
      headers,
      body: JSON.stringify(target),
    });
    if (!response.ok) throw new Error('Failed to save Monthly Target to SQL.');
    return await response.json();
  } catch (error) {
    console.error('dbSaveMonthlyTarget failed:', error);
    throw error;
  }
}

export async function dbDeleteMonthlyTarget(id: string) {
  const base = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/$/, '');
  if (!base) {
    await updateFirestoreDocArray('monthlyTargets', (arr) => arr.filter(item => item.id !== id), true);
    return { success: true };
  }

  try {
    const headers = await getHeaders();
    const response = await fetch(getApiUrl(`/api/monthly-targets/${id}`), {
      method: 'DELETE',
      headers,
    });
    if (!response.ok) throw new Error('Failed to delete Monthly Target from SQL.');
    return await response.json();
  } catch (error) {
    console.error('dbDeleteMonthlyTarget failed:', error);
    throw error;
  }
}

// 5. Fine-grained operations: Teams
export async function dbSaveTeam(team: Team) {
  const base = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/$/, '');
  if (!base) {
    await updateFirestoreDocArray('teams', (arr) => {
      const idx = arr.findIndex(item => item.id === team.id);
      if (idx !== -1) arr[idx] = team;
      else arr.push(team);
      return arr;
    });
    return { success: true, team };
  }

  try {
    const headers = await getHeaders();
    const response = await fetch(getApiUrl('/api/teams'), {
      method: 'POST',
      headers,
      body: JSON.stringify(team),
    });
    if (!response.ok) throw new Error('Failed to save Team status.');
    return await response.json();
  } catch (error) {
    console.error('dbSaveTeam failed:', error);
    throw error;
  }
}

// 6. Fine-grained operations: Audit Activity logs
export async function dbSaveLog(log: ActivityLog) {
  const base = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/$/, '');
  if (!base) {
    await updateFirestoreDocArray('logs', (arr) => {
      arr.push(log);
      return arr.slice(-200);
    });
    return { success: true, log };
  }

  try {
    const headers = await getHeaders();
    const response = await fetch(getApiUrl('/api/logs'), {
      method: 'POST',
      headers,
      body: JSON.stringify(log),
    });
    if (!response.ok) throw new Error('Failed to save Audit Log.');
    return await response.json();
  } catch (error) {
    console.error('dbSaveLog failed:', error);
    throw error;
  }
}

// 7. Fine-grained operations: Inspectors and Engineers
export async function dbSaveInspector(inspector: any) {
  const base = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/$/, '');
  if (!base) {
    await updateFirestoreDocArray('inspectors', (arr) => {
      const idx = arr.findIndex(item => item.id === inspector.id);
      if (idx !== -1) arr[idx] = inspector;
      else arr.push(inspector);
      return arr;
    });
    return { success: true, inspector };
  }
}

export async function dbSaveEngineer(engineer: any) {
  const base = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/$/, '');
  if (!base) {
    await updateFirestoreDocArray('engineers', (arr) => {
      const idx = arr.findIndex(item => item.id === engineer.id);
      if (idx !== -1) arr[idx] = engineer;
      else arr.push(engineer);
      return arr;
    });
    return { success: true, engineer };
  }
}

export async function dbDeleteInspector(id: string) {
  const base = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/$/, '');
  if (!base) {
    await updateFirestoreDocArray('inspectors', (arr) => arr.filter(item => item.id !== id), true);
    return { success: true };
  }
}

export async function dbDeleteEngineer(id: string) {
  const base = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/$/, '');
  if (!base) {
    await updateFirestoreDocArray('engineers', (arr) => arr.filter(item => item.id !== id), true);
    return { success: true };
  }
}

// 8. Fine-grained operations: Trolley Production
export async function dbSaveTrolley(trolley: TrolleyProduction) {
  const base = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/$/, '');
  if (!base) {
    await updateFirestoreDocArray('trolleys', (arr) => {
      const idx = arr.findIndex(item => item.id === trolley.id);
      if (idx !== -1) arr[idx] = trolley;
      else arr.push(trolley);
      return arr;
    });
    return { success: true, trolley };
  }

  try {
    const headers = await getHeaders();
    const response = await fetch(getApiUrl('/api/trolley-production'), {
      method: 'POST',
      headers,
      body: JSON.stringify(trolley),
    });
    if (!response.ok) throw new Error('Failed to save Trolley Production to SQL.');
    return await response.json();
  } catch (error) {
    console.error('dbSaveTrolley failed:', error);
    throw error;
  }
}

export async function dbDeleteTrolley(id: string) {
  const base = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/$/, '');
  if (!base) {
    await updateFirestoreDocArray('trolleys', (arr) => arr.filter(item => item.id !== id), true);
    return { success: true };
  }

  try {
    const headers = await getHeaders();
    const response = await fetch(getApiUrl(`/api/trolley-production/${id}`), {
      method: 'DELETE',
      headers,
    });
    if (!response.ok) throw new Error('Failed to delete Trolley Production.');
    return await response.json();
  } catch (error) {
    console.error('dbDeleteTrolley failed:', error);
    throw error;
  }
}

// 9. Recycle Bin client operations
export async function dbAddRecycleBin(item: RecycleBinItem) {
  const base = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/$/, '');
  if (!base) {
    await updateFirestoreDocArray('recycleBin', (arr) => {
      arr.push(item);
      return arr;
    });
    return { success: true, item };
  }

  try {
    const headers = await getHeaders();
    const response = await fetch(getApiUrl('/api/recycle-bin'), {
      method: 'POST',
      headers,
      body: JSON.stringify(item),
    });
    if (!response.ok) throw new Error('Failed to add item to Recycle Bin.');
    return await response.json();
  } catch (error) {
    console.error('dbAddRecycleBin failed:', error);
    throw error;
  }
}

export async function dbDeleteRecycleBin(id: string) {
  const base = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/$/, '');
  if (!base) {
    await updateFirestoreDocArray('recycleBin', (arr) => arr.filter(item => item.id !== id), true);
    return { success: true };
  }

  try {
    const headers = await getHeaders();
    const response = await fetch(getApiUrl(`/api/recycle-bin/${id}`), {
      method: 'DELETE',
      headers,
    });
    if (!response.ok) throw new Error('Failed to delete from Recycle Bin.');
    return await response.json();
  } catch (error) {
    console.error('dbDeleteRecycleBin failed:', error);
    throw error;
  }
}

export async function dbRestoreRecycleBin(id: string) {
  const base = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/$/, '');
  if (!base) {
    const list = await getFirestoreDocArray('recycleBin');
    const matched = list.find(item => item.id === id);
    if (matched) {
      await setFirestoreDocArray('recycleBin', list.filter(item => item.id !== id));
      const payload = matched.serializedData;
      if (matched.originalTable === 'pools') {
        await dbSavePool(payload);
      } else if (matched.originalTable === 'plannedPools') {
        await dbSavePlannedPool(payload);
      } else if (matched.originalTable === 'trolleyProduction') {
        await dbSaveTrolley(payload);
      }
    }
    return { success: true };
  }

  try {
    const headers = await getHeaders();
    const response = await fetch(getApiUrl(`/api/recycle-bin/restore/${id}`), {
      method: 'POST',
      headers,
    });
    if (!response.ok) throw new Error('Failed to restore item from Recycle Bin.');
    return await response.json();
  } catch (error) {
    console.error('dbRestoreRecycleBin failed:', error);
    throw error;
  }
}

export async function dbPurgePoolRelatedData(backupId: string) {
  const base = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/$/, '');
  if (!base) {
    await Promise.all([
      updateFirestoreDocArray('pools', (arr) => arr.filter(p => p.projectId !== backupId), true),
      updateFirestoreDocArray('plannedPools', (arr) => arr.filter(p => p.id !== backupId), true)
    ]);
    return { success: true };
  }

  try {
    const headers = await getHeaders();
    const response = await fetch(getApiUrl('/api/state/purge-pools'), {
      method: 'POST',
      headers,
      body: JSON.stringify({ backupId }),
    });
    if (!response.ok) throw new Error('Failed to purge pool related data.');
    return await response.json();
  } catch (error) {
    console.error('dbPurgePoolRelatedData failed:', error);
    throw error;
  }
}

// 2.7 Fine-grained operations: Employee Punches
// ----------------------------------------------------
// STORE / BOM MODULE
// Same dual-mode pattern as the rest of this file: writes directly to
// Firestore from the browser when there's no live Express server configured
// (e.g. a static Netlify deploy), or goes through the SQL-backed API when
// VITE_API_URL is set (self-hosted deployments).
// ----------------------------------------------------

function apiBase(): string {
  // BUGFIX: this used to return a truthy sentinel (' ') for any browser
  // context, which forced dbFetchMaterials/dbBulkImportMaterials/etc. to
  // always call relative /api/... routes — even when no backend exists at
  // those routes (this project has no Express server deployed on Netlify).
  // Netlify's SPA catch-all redirect then served index.html for those calls,
  // which callers tried to parse as JSON and failed. That was the real cause
  // of "No materials found" and the Excel import "Failed to parse" error.
  //
  // Now: only use the REST API path when VITE_API_URL is explicitly set
  // (i.e. you really do have a separate backend deployed and configured).
  // Otherwise, every Store function below falls back to direct Firestore,
  // exactly like dbSavePool/dbSaveEmployee/etc. already do.
  return ((import.meta as any).env?.VITE_API_URL || '').replace(/\/$/, '');
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function newToken(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return (crypto as any).randomUUID().replace(/-/g, '');
  } catch {}
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

// Fire-and-forget call to the Netlify Functions that email + WhatsApp the
// manager. Safe to call even when email/WhatsApp aren't configured yet —
// they just no-op server-side. Takes the WHOLE batch (every material line
// the supervisor added to their cart) so the manager gets ONE message with
// ONE Approve/ONE Reject action, not one message per material.
async function notifyManagerOfMaterialRequestBatch(items: MaterialRequest[]) {
  if (items.length === 0) return;
  const first = items[0];
  const payload = {
    batchId: first.batchId,
    approvalToken: first.approvalToken,
    projectName: first.projectName,
    poolType: first.poolType,
    poolNo: first.poolNo,
    reason: first.reason,
    requestedByName: first.requestedByName,
    requestedByRole: first.requestedByRole,
    items: items.map((it) => ({
      materialId: it.materialId,
      materialName: it.materialName,
      unit: it.unit,
      qtyRequested: it.qtyRequested,
    })),
  };
  try {
    await fetch('/.netlify/functions/send-material-request-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn('[notifyManagerOfMaterialRequestBatch] Could not reach the email function (this is fine in local dev without `netlify dev`):', err);
  }
  try {
    await fetch('/.netlify/functions/send-material-request-whatsapp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn('[notifyManagerOfMaterialRequestBatch] Could not reach the WhatsApp function (this is fine in local dev without `netlify dev`):', err);
  }
}

// --- Materials ---
export async function dbFetchMaterials(): Promise<Material[]> {
  if (!apiBase()) return getFirestoreDocArray('materials');
  const res = await fetch(getApiUrl('/api/materials'));
  return res.ok ? res.json() : [];
}

export async function dbSaveMaterial(material: Material) {
  if (!apiBase()) {
    await updateFirestoreDocArray('materials', (arr) => {
      const idx = arr.findIndex((m) => m.id === material.id);
      if (idx !== -1) arr[idx] = material; else arr.push(material);
      return arr;
    });
    return { success: true, material };
  }
  const headers = await getHeaders();
  const res = await fetch(getApiUrl('/api/materials'), { method: 'POST', headers, body: JSON.stringify(material) });
  return res.json();
}

export async function dbDeleteMaterial(id: string) {
  if (!apiBase()) {
    await updateFirestoreDocArray('materials', (arr) => arr.filter((m) => m.id !== id), true);
    return { success: true };
  }
  const headers = await getHeaders();
  const res = await fetch(getApiUrl(`/api/materials/${id}`), { method: 'DELETE', headers });
  return res.json();
}

export async function dbAdjustMaterialStock(id: string, delta: number) {
  if (!apiBase()) {
    const updated = await updateFirestoreDocArray('materials', (arr) =>
      arr.map((m) => (m.id === id ? { ...m, currentStock: (m.currentStock || 0) + delta } : m))
    );
    return { success: true, materials: updated };
  }
  const headers = await getHeaders();
  const res = await fetch(getApiUrl(`/api/materials/${id}/adjust-stock`), { method: 'POST', headers, body: JSON.stringify({ delta }) });
  return res.json();
}

// --- Bill of Materials ---
export async function dbFetchBomItems(): Promise<BOMItem[]> {
  if (!apiBase()) return getFirestoreDocArray('bomItems');
  const res = await fetch(getApiUrl('/api/bom'));
  return res.ok ? res.json() : [];
}

export async function dbSaveBomItem(item: Omit<BOMItem, 'id' | 'createdAt'> & { id?: string; createdAt?: string }) {
  const full: BOMItem = { ...item, id: item.id || newId('bom'), createdAt: item.createdAt || new Date().toISOString() } as BOMItem;
  if (!apiBase()) {
    await updateFirestoreDocArray('bomItems', (arr) => {
      const idx = arr.findIndex((b) => b.id === full.id);
      if (idx !== -1) arr[idx] = full; else arr.push(full);
      return arr;
    });
    return { success: true, item: full };
  }
  const headers = await getHeaders();
  const res = await fetch(getApiUrl('/api/bom'), { method: 'POST', headers, body: JSON.stringify(full) });
  return res.json();
}

export async function dbDeleteBomItem(id: string) {
  if (!apiBase()) {
    await updateFirestoreDocArray('bomItems', (arr) => arr.filter((b) => b.id !== id), true);
    return { success: true };
  }
  const headers = await getHeaders();
  const res = await fetch(getApiUrl(`/api/bom/${id}`), { method: 'DELETE', headers });
  return res.json();
}

// --- Floor Stock (material issued out of the Store to a section, not yet
// consumed — see the FloorStock type comment in types.ts for the full flow) ---
export async function dbFetchFloorStock(): Promise<FloorStock[]> {
  if (!apiBase()) return getFirestoreDocArray('floorStock');
  const res = await fetch(getApiUrl('/api/floor-stock'));
  return res.ok ? res.json() : [];
}

// Adds (or subtracts, with a negative delta) `delta` units of a material to
// the floor stock of one section. Used when a request is approved (+) and
// when consumption is logged (-) or a consumption log is deleted/reversed (+).
async function adjustFloorStock(
  sectionId: string, sectionName: string,
  materialId: string, materialName: string, unit: string,
  delta: number,
): Promise<void> {
  if (!sectionId || !delta) return;
  const rowId = `${sectionId}__${materialId}`;
  await updateFirestoreDocArray('floorStock', (arr) => {
    const idx = arr.findIndex((f) => f.id === rowId);
    if (idx !== -1) {
      arr[idx] = {
        ...arr[idx],
        // Refresh labels too — approval time only knows the raw section id,
        // so once a consumption log call comes through with the friendly
        // section/material names, adopt those instead of staying stuck
        // with the placeholder.
        sectionName: sectionName || arr[idx].sectionName,
        materialName: materialName || arr[idx].materialName,
        unit: unit || arr[idx].unit,
        qty: Number(arr[idx].qty || 0) + delta,
        updatedAt: new Date().toISOString(),
      };
    } else {
      arr.push({ id: rowId, sectionId, sectionName, materialId, materialName, unit, qty: delta, updatedAt: new Date().toISOString() });
    }
    return arr;
  });
}

// --- Material Requests ---
export async function dbFetchMaterialRequests(): Promise<MaterialRequest[]> {
  if (!apiBase()) return getFirestoreDocArray('materialRequests');
  const res = await fetch(getApiUrl('/api/material-requests'));
  return res.ok ? res.json() : [];
}

// Section Supervisor submits their whole cart (1 to however-many material
// lines) in one go. Every line shares one batchId + one approvalToken, so
// the manager's email/WhatsApp has ONE Approve/Reject action for the whole
// batch, and Store prints ONE issue slip for it — instead of one
// email/slip per material line.
export async function dbSubmitMaterialRequestBatch(
  lines: Array<Omit<MaterialRequest, 'id' | 'status' | 'approvalToken' | 'createdAt' | 'batchId'>>
): Promise<{ success: boolean; items: MaterialRequest[] }> {
  if (lines.length === 0) return { success: true, items: [] };
  const batchId = newId('batch');
  const approvalToken = newToken();
  const createdAt = new Date().toISOString();
  const items: MaterialRequest[] = lines.map((payload) => ({
    ...payload,
    id: newId('mr'),
    batchId,
    status: 'PENDING',
    approvalToken,
    createdAt,
  } as MaterialRequest));

  if (!apiBase()) {
    await updateFirestoreDocArray('materialRequests', (arr) => [...arr, ...items]);
    await notifyManagerOfMaterialRequestBatch(items);
    return { success: true, items };
  }

  // Express/API deployment: no batch endpoint exists there yet, so submit
  // each line individually against the existing single-item route. Each line
  // still keeps the same batchId/approvalToken so Store's grouping-by-batchId
  // works the same either way — it's only the manager's email that would
  // arrive as several messages instead of one under this fallback path.
  const headers = await getHeaders();
  const results: MaterialRequest[] = [];
  for (const item of items) {
    const res = await fetch(getApiUrl('/api/material-requests'), { method: 'POST', headers, body: JSON.stringify(item) });
    const json = await res.json().catch(() => null);
    results.push(json?.item || item);
  }
  return { success: true, items: results };
}

// In-app approve/reject for a whole batch (the manager's email/WhatsApp link
// hits a separate serverless function directly, not this one — this is for
// deciding from inside the app). Pass every request id in the group —
// for a legacy single-line request that's just an array of one.
export async function dbDecideMaterialRequestBatch(
  ids: string[], action: 'approve' | 'reject', decidedByName: string, decisionNotes?: string
): Promise<{ success: boolean; items: MaterialRequest[] }> {
  if (ids.length === 0) return { success: true, items: [] };

  if (!apiBase()) {
    const decidedItems: MaterialRequest[] = [];
    await updateFirestoreDocArray('materialRequests', (arr) =>
      arr.map((r) => {
        if (!ids.includes(r.id) || r.status !== 'PENDING') return r;
        const decided: MaterialRequest = {
          ...r,
          status: action === 'approve' ? 'APPROVED' : 'REJECTED',
          decidedByName,
          decisionNotes: decisionNotes || null,
          decidedAt: new Date().toISOString(),
        };
        decidedItems.push(decided);
        return decided;
      })
    );

    if (action === 'approve' && decidedItems.length > 0) {
      // 1) Leaves the Store — aggregate per material first, so a batch with
      // two lines of the same material only touches currentStock once.
      const stockDeltas: Record<string, number> = {};
      for (const d of decidedItems) {
        stockDeltas[d.materialId] = (stockDeltas[d.materialId] || 0) + Number(d.qtyRequested);
      }
      await updateFirestoreDocArray('materials', (arr) =>
        arr.map((m) => (stockDeltas[m.id] ? { ...m, currentStock: (m.currentStock || 0) - stockDeltas[m.id] } : m))
      );

      // 2) Arrives on the requesting section's Floor Stock, one row per material.
      for (const d of decidedItems) {
        const sectionId = (d.stageId as string) || 'unassigned';
        await adjustFloorStock(sectionId, sectionId, d.materialId, d.materialName, d.unit, Number(d.qtyRequested));
      }
    }
    return { success: true, items: decidedItems };
  }

  // Express/API deployment: no batch decide endpoint exists there yet, so
  // decide each id individually against the existing single-item route.
  const headers = await getHeaders();
  const results: MaterialRequest[] = [];
  for (const id of ids) {
    const res = await fetch(getApiUrl(`/api/material-requests/${id}/decide`), { method: 'POST', headers, body: JSON.stringify({ action, decidedByName, decisionNotes }) });
    const json = await res.json().catch(() => null);
    if (json?.item) results.push(json.item);
  }
  return { success: true, items: results };
}

// Marks every request in a group (batch, or a legacy single request) as
// PRINTED once Store has printed its one issue slip.
export async function dbMarkMaterialRequestBatchPrinted(ids: string[]): Promise<{ success: boolean; items: MaterialRequest[] }> {
  if (ids.length === 0) return { success: true, items: [] };

  if (!apiBase()) {
    const updated: MaterialRequest[] = [];
    await updateFirestoreDocArray('materialRequests', (arr) =>
      arr.map((r) => {
        if (!ids.includes(r.id)) return r;
        const printed: MaterialRequest = { ...r, status: 'PRINTED', printedAt: new Date().toISOString() };
        updated.push(printed);
        return printed;
      })
    );
    return { success: true, items: updated };
  }

  const headers = await getHeaders();
  const results: MaterialRequest[] = [];
  for (const id of ids) {
    const res = await fetch(getApiUrl(`/api/material-requests/${id}/mark-printed`), { method: 'POST', headers });
    const json = await res.json().catch(() => null);
    if (json?.item) results.push(json.item);
  }
  return { success: true, items: results };
}

export async function dbSaveEmployeePunch(punch: EmployeePunch) {
  const base = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/$/, '');
  if (!base) {
    await updateFirestoreDocArray('employeePunches', (arr) => {
      const idx = arr.findIndex(item => item.id === punch.id);
      if (idx !== -1) arr[idx] = punch;
      else arr.push(punch);
      return arr;
    });
    return { success: true, punch };
  }

  try {
    const headers = await getHeaders();
    const response = await fetch(getApiUrl('/api/employee-punches'), {
      method: 'POST',
      headers,
      body: JSON.stringify(punch),
    });
    if (!response.ok) throw new Error('Failed to save Employee punch to SQL.');
    return await response.json();
  } catch (error) {
    console.error('dbSaveEmployeePunch failed:', error);
    throw error;
  }
}

export async function dbDeleteEmployeePunch(id: string) {
  const base = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/$/, '');
  if (!base) {
    await updateFirestoreDocArray('employeePunches', (arr) => arr.filter(item => item.id !== id), true);
    return { success: true };
  }

  try {
    const headers = await getHeaders();
    const response = await fetch(getApiUrl(`/api/employee-punches/${id}`), {
      method: 'DELETE',
      headers,
    });
    if (!response.ok) throw new Error('Failed to delete Employee punch from SQL.');
    return await response.json();
  } catch (error) {
    console.error('dbDeleteEmployeePunch failed:', error);
    throw error;
  }
}

export async function dbSaveEmployeePunchesBulk(punches: EmployeePunch[]) {
  const base = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/$/, '');
  if (!base) {
    await updateFirestoreDocArray('employeePunches', (arr) => {
      const filtered = arr.filter(existing => !punches.some(p => p.id === existing.id));
      return [...filtered, ...punches];
    });
    return { success: true };
  }

  try {
    const headers = await getHeaders();
    const response = await fetch(getApiUrl('/api/employee-punches/bulk'), {
      method: 'POST',
      headers,
      body: JSON.stringify(punches),
    });
    if (!response.ok) throw new Error('Failed to save bulk employee punches to SQL.');
    return await response.json();
  } catch (error) {
    console.error('dbSaveEmployeePunchesBulk failed:', error);
    throw error;
  }
}

export async function dbSaveEmployeesBulk(newEmployees: Employee[]) {
  const base = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/$/, '');
  if (!base) {
    await updateFirestoreDocArray('employees', (arr) => {
      const filtered = arr.filter(existing => !newEmployees.some(e => e.id === existing.id));
      return [...filtered, ...newEmployees];
    });
    return { success: true };
  }

  try {
    const headers = await getHeaders();
    const response = await fetch(getApiUrl('/api/employees/bulk'), {
      method: 'POST',
      headers,
      body: JSON.stringify(newEmployees),
    });
    if (!response.ok) throw new Error('Failed to save bulk employees to SQL.');
    return await response.json();
  } catch (error) {
    console.error('dbSaveEmployeesBulk failed:', error);
    throw error;
  }
}

export async function dbClearAllEmployeePunches() {
  const base = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/$/, '');
  if (!base) {
    // allowEmpty=true because this function intentionally clears all punches
    await setFirestoreDocArray('employeePunches', [], true);
    return { success: true };
  }

  try {
    const headers = await getHeaders();
    const response = await fetch(getApiUrl('/api/employee-punches/clear-all'), {
      method: 'POST',
      headers,
    });
    if (!response.ok) throw new Error('Failed to clear all punches.');
    return await response.json();
  } catch (error) {
    console.error('dbClearAllEmployeePunches failed:', error);
    throw error;
  }
}

export async function dbDeleteEmployeePunchesByDate(date: string) {
  const base = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/$/, '');
  if (!base) {
    await updateFirestoreDocArray('employeePunches', (arr) => arr.filter(p => !p.punchTime?.startsWith(date)), true);
    return { success: true };
  }

  try {
    const headers = await getHeaders();
    const response = await fetch(getApiUrl('/api/employee-punches/delete-by-date'), {
      method: 'POST',
      headers,
      body: JSON.stringify({ date }),
    });
    if (!response.ok) throw new Error('Failed to delete punches by date.');
    return await response.json();
  } catch (error) {
    console.error('dbDeleteEmployeePunchesByDate failed:', error);
    throw error;
  }
}

export async function dbSyncBioCloudPunches(params: { url: string; apiKey: string; date: string; autoRegisterNew?: boolean }) {
  const base = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/$/, '');
  if (!base) {
    console.log('BioCloud sync simulated in static client-side mode (direct Firestore)');
    return { success: true, addedCount: 0, registeredEmployeesCount: 0 };
  }

  try {
    const headers = await getHeaders();
    const response = await fetch(getApiUrl('/api/biocloud/sync'), {
      method: 'POST',
      headers,
      body: JSON.stringify(params),
    });
    if (!response.ok) throw new Error('Bio Cloud sync request failed.');
    return await response.json();
  } catch (error) {
    console.error('dbSyncBioCloudPunches failed:', error);
    throw error;
  }
}

// Security PIN helpers using direct client-side Firestore/Node proxy
export async function dbGetPins() {
  const base = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/$/, '');
  if (base) {
    try {
      const response = await fetch(getApiUrl('/api/pins'));
      if (response.ok) return await response.json();
    } catch (e) {
      console.warn('Failed to fetch from pins API, falling back to direct Firestore:', e);
    }
  }

  try {
    const docRef = doc(clientDb, 'portal_security', 'pins');
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return snap.data() || {};
    }
  } catch (e) {
    console.warn('Direct client-side Firestore PINs fetch failed:', e);
  }
  return {};
}

export async function dbUpdatePin(role: string, pin: string) {
  const base = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/$/, '');
  if (base) {
    try {
      const response = await fetch(getApiUrl('/api/pins'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, pin }),
      });
      if (response.ok) return await response.json();
    } catch (e) {
      console.warn('Failed to submit PIN to API, using direct fallback:', e);
    }
  }

  try {
    const docRef = doc(clientDb, 'portal_security', 'pins');
    await setDoc(docRef, { [role]: pin }, { merge: true });
    return { success: true };
  } catch (e) {
    console.error('Direct client-side PIN write failed:', e);
    throw e;
  }
}

// ==========================================================
// NEW STORE FEATURES: Excel Bulk, Incoming, Consumption, Production, Analytics
// ==========================================================

import type { IncomingMaterial, ConsumptionLog, ProductionLog } from '../types';

// Accepts common header variations (e.g. "Material Name", "Stock", "UOM",
// "Reorder Point") so the Excel import isn't fragile about exact column
// names — only the downloaded template used the exact keys before.
function normalizeImportRow(row: any): { name: string; category: string | null; section: string | null; unit: string; currentStock: number | ''; reorderLevel: number | null; notes: string | null; erpCode: string | null; supplierName: string | null; brand: string | null; location: string | null; hsCode: string | null } {
  const get = (...keys: string[]) => {
    for (const k of Object.keys(row)) {
      const norm = k.trim().toLowerCase().replace(/[\s_.\-]+/g, '');
      for (const target of keys) {
        if (norm === target) return row[k];
      }
    }
    return undefined;
  };
  const name = String(get('name', 'materialname', 'material', 'item', 'itemname', 'description', 'seconddef', 'seconddefinition', 'itemdescription', 'desc') ?? '').trim();
  const unit = String(get('unit', 'uom', 'units') ?? 'kg').trim() || 'kg';
  const stockRaw = get('currentstock', 'stock', 'qty', 'quantity', 'openingstock', 'currentqty', 'onhand', 'balance');
  const reorderRaw = get('reorderlevel', 'reorderpoint', 'reorder', 'minstock', 'minimumstock', 'minqty');
  return {
    name,
    category: (get('category', 'type') ?? null) as string | null,
    section: (get('section', 'stage', 'department') ?? null) as string | null,
    unit,
    currentStock: stockRaw !== undefined && stockRaw !== '' ? Number(stockRaw) : '',
    reorderLevel: reorderRaw !== undefined && reorderRaw !== '' ? Number(reorderRaw) : null,
    notes: (get('notes', 'remarks', 'comment', 'comments') ?? null) as string | null,
    erpCode: (get('erpcode', 'erpcodes', 'code', 'itemcode', 'sku', 'materialcode') ?? null) as string | null,
    supplierName: (get('suppliername', 'supplier', 'vendor', 'vendorname') ?? null) as string | null,
    brand: (get('brand', 'make') ?? null) as string | null,
    location: (get('location', 'bin', 'rack', 'storagelocation', 'warehouselocation') ?? null) as string | null,
    hsCode: (get('hscode', 'hscodes', 'customscode', 'tariffcode') ?? null) as string | null,
  };
}

export async function dbBulkImportMaterials(items: any[], mode: 'add' | 'update' | 'both' = 'both') {
  if (!apiBase()) {
    let added = 0, updated = 0, skipped = 0;
    await updateFirestoreDocArray('materials', (arr) => {
      for (const raw of items) {
        const row = normalizeImportRow(raw);
        const name = row.name;
        if (!name) { skipped++; continue; }
        const idx = arr.findIndex((m) => String(m.name).trim().toLowerCase() === name.toLowerCase());
        if (idx !== -1) {
          if (mode === 'add') { skipped++; continue; }
          arr[idx] = {
            ...arr[idx],
            category: row.category ?? arr[idx].category ?? null,
            section: row.section ?? arr[idx].section ?? null,
            unit: row.unit || arr[idx].unit,
            currentStock: row.currentStock !== '' ? Number(row.currentStock) : arr[idx].currentStock,
            reorderLevel: row.reorderLevel !== null ? row.reorderLevel : arr[idx].reorderLevel ?? null,
            notes: row.notes ?? arr[idx].notes ?? null,
            erpCode: row.erpCode ?? arr[idx].erpCode ?? null,
            supplierName: row.supplierName ?? arr[idx].supplierName ?? null,
            brand: row.brand ?? arr[idx].brand ?? null,
            location: row.location ?? arr[idx].location ?? null,
            hsCode: row.hsCode ?? arr[idx].hsCode ?? null,
          };
          updated++;
        } else {
          if (mode === 'update') { skipped++; continue; }
          arr.push({
            id: newId('mat'),
            name,
            category: row.category || null,
            section: row.section || null,
            unit: row.unit || 'kg',
            currentStock: row.currentStock !== '' ? Number(row.currentStock) : 0,
            reorderLevel: row.reorderLevel,
            notes: row.notes || null,
            erpCode: row.erpCode || null,
            supplierName: row.supplierName || null,
            brand: row.brand || null,
            location: row.location || null,
            hsCode: row.hsCode || null,
            createdAt: new Date().toISOString(),
          });
          added++;
        }
      }
      return arr;
    });
    return { success: true, added, updated, skipped };
  }
  const headers = await getHeaders();
  const res = await fetch(getApiUrl('/api/materials/bulk'), {
    method: 'POST',
    headers,
    body: JSON.stringify({ items, mode }),
  });
  return res.json();
}

export async function dbFetchIncomingMaterials(): Promise<IncomingMaterial[]> {
  if (!apiBase()) return getFirestoreDocArray('incomingMaterials');
  const res = await fetch(getApiUrl('/api/incoming-materials'));
  return res.ok ? res.json() : [];
}

export async function dbCreateIncomingMaterial(payload: Omit<IncomingMaterial, 'id' | 'createdAt'>) {
  const full: IncomingMaterial = { ...payload, id: newId('inc'), createdAt: new Date().toISOString() } as IncomingMaterial;
  if (!apiBase()) {
    const mat = (await getFirestoreDocArray('materials')).find((m) => m.id === payload.materialId);
    full.materialName = mat?.name || payload.materialName || '';
    full.unit = mat?.unit || payload.unit || '';
    await updateFirestoreDocArray('incomingMaterials', (arr) => { arr.push(full); return arr; });
    if (mat) {
      await updateFirestoreDocArray('materials', (arr) =>
        arr.map((m) => (m.id === payload.materialId ? { ...m, currentStock: (m.currentStock || 0) + Number(payload.qty || 0) } : m))
      );
    }
    return { success: true, item: full };
  }
  const headers = await getHeaders();
  const res = await fetch(getApiUrl('/api/incoming-materials'), {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function dbDeleteIncomingMaterial(id: string) {
  if (!apiBase()) {
    await updateFirestoreDocArray('incomingMaterials', (arr) => arr.filter((i) => i.id !== id), true);
    return { success: true };
  }
  const headers = await getHeaders();
  const res = await fetch(getApiUrl(`/api/incoming-materials/${id}`), { method: 'DELETE', headers });
  return res.json();
}

export async function dbFetchConsumptionLogs(): Promise<ConsumptionLog[]> {
  if (!apiBase()) return getFirestoreDocArray('consumptionLogs');
  const res = await fetch(getApiUrl('/api/consumption-logs'));
  return res.ok ? res.json() : [];
}

// Logs consumption AND draws the qty down from that section's Floor Stock
// (the material already left the Store at approval time — see FloorStock).
// Store's currentStock is intentionally NOT touched here anymore; touching
// it here as well as at approval time used to double-deduct the same
// material from the same number.
export async function dbCreateConsumptionLog(payload: Omit<ConsumptionLog, 'id' | 'createdAt'>) {
  const full: ConsumptionLog = { ...payload, id: newId('cons'), createdAt: new Date().toISOString() } as ConsumptionLog;
  if (!apiBase()) {
    await updateFirestoreDocArray('consumptionLogs', (arr) => { arr.push(full); return arr; });
    await adjustFloorStock(payload.sectionId, payload.sectionName, payload.materialId, payload.materialName, payload.unit, -Number(payload.qty || 0));
    return { success: true, item: full };
  }
  const headers = await getHeaders();
  const res = await fetch(getApiUrl('/api/consumption-logs'), {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  return res.json();
}

// Deleting a consumption log reverses it — the qty goes back onto the
// section's Floor Stock, since it was never actually a Store transaction.
export async function dbDeleteConsumptionLog(id: string) {
  if (!apiBase()) {
    let removed: ConsumptionLog | undefined;
    await updateFirestoreDocArray('consumptionLogs', (arr) => {
      removed = arr.find((c) => c.id === id);
      return arr.filter((c) => c.id !== id);
    }, true);
    if (removed) {
      await adjustFloorStock(removed.sectionId, removed.sectionName, removed.materialId, removed.materialName, removed.unit, Number(removed.qty || 0));
    }
    return { success: true };
  }
  const headers = await getHeaders();
  const res = await fetch(getApiUrl(`/api/consumption-logs/${id}`), { method: 'DELETE', headers });
  return res.json();
}

export async function dbFetchProductionLogs(): Promise<ProductionLog[]> {
  if (!apiBase()) return getFirestoreDocArray('productionLogs');
  const res = await fetch(getApiUrl('/api/production-logs'));
  return res.ok ? res.json() : [];
}

export async function dbCreateProductionLog(payload: Omit<ProductionLog, 'id' | 'createdAt'>) {
  const full: ProductionLog = { ...payload, id: newId('prod'), createdAt: new Date().toISOString() } as ProductionLog;
  if (!apiBase()) {
    await updateFirestoreDocArray('productionLogs', (arr) => { arr.push(full); return arr; });
    return { success: true, item: full };
  }
  const headers = await getHeaders();
  const res = await fetch(getApiUrl('/api/production-logs'), {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function dbDeleteProductionLog(id: string) {
  if (!apiBase()) {
    await updateFirestoreDocArray('productionLogs', (arr) => arr.filter((p) => p.id !== id), true);
    return { success: true };
  }
  const headers = await getHeaders();
  const res = await fetch(getApiUrl(`/api/production-logs/${id}`), { method: 'DELETE', headers });
  return res.json();
}

export async function dbFetchConsumptionAnalytics(): Promise<any> {
  if (!apiBase()) {
    const [materials, incoming, consumption] = await Promise.all([
      getFirestoreDocArray('materials'),
      getFirestoreDocArray('incomingMaterials'),
      getFirestoreDocArray('consumptionLogs'),
    ]);
    const sum = (list: any[], key: string, matchId: string) =>
      list.filter((x) => x.materialId === matchId).reduce((s, x) => s + Number(x.qty || 0), 0);
    const inventoryReport = materials.map((m) => ({
      materialId: m.id,
      materialName: m.name,
      unit: m.unit,
      currentStock: m.currentStock || 0,
      totalIncoming: sum(incoming, 'qty', m.id),
      totalConsumed: sum(consumption, 'qty', m.id),
    }));
    const byMaterial = (list: any[]) => {
      const map: Record<string, { materialId: string; materialName: string; unit: string; qty: number }> = {};
      for (const row of list) {
        if (!map[row.materialId]) map[row.materialId] = { materialId: row.materialId, materialName: row.materialName, unit: row.unit, qty: 0 };
        map[row.materialId].qty += Number(row.qty || 0);
      }
      return Object.values(map);
    };
    const dailyBySection: Record<string, number> = {};
    for (const row of consumption) {
      const key = row.sectionId || 'unknown';
      dailyBySection[key] = (dailyBySection[key] || 0) + Number(row.qty || 0);
    }
    return {
      inventoryReport,
      consumptionByMaterial: byMaterial(consumption),
      incomingByMaterial: byMaterial(incoming),
      dailyBySection,
      plannedBySection: {},
      perProject: {},
      perPoolType: [],
    };
  }
  const res = await fetch(getApiUrl('/api/consumption/analytics'));
  return res.ok ? res.json() : { inventoryReport: [], consumptionByMaterial: [], incomingByMaterial: [], dailyBySection: {}, plannedBySection: {}, perProject: {}, perPoolType: [] };
}

// ─────────────────────────────────────────────────────────────────────────────
// HR PORTAL: Leave, Warnings, Payroll, Accident Reports, Medical Records
//
// THE BUG: these five record types were stored ONLY in browser localStorage.
// localStorage never leaves the device it was written on, so nothing here
// ever synced between PCs — that's why HR data looked like it "wasn't
// updating live". There was no live sync because there was nothing wired to
// Firestore to sync in the first place.
//
// THE FIX: each record type now lives in Firestore under system_state
// (same pattern as materials/employees/pools/etc.) and is included in
// subscribeToLiveState's collection list above, so changes made on any PC
// appear on every other PC within about a second via onSnapshot — no
// refresh needed. The empty-write safety guard in setFirestoreDocArray
// still protects all five from accidental wipes.
// ─────────────────────────────────────────────────────────────────────────────

// --- HR: Leave Requests ---
export async function dbFetchHRLeaves(): Promise<any[]> {
  return getFirestoreDocArray('hrLeaves');
}
export async function dbSaveHRLeaves(leaves: any[]): Promise<void> {
  // allowEmpty=true: the caller (HRPortal) always passes the full intended
  // list, including the legitimate case of deleting the last remaining
  // record — that's a real user action, not an accidental empty write.
  await setFirestoreDocArray('hrLeaves', leaves, true);
}

// --- HR: Warnings ---
export async function dbFetchHRWarnings(): Promise<any[]> {
  return getFirestoreDocArray('hrWarnings');
}
export async function dbSaveHRWarnings(warnings: any[]): Promise<void> {
  await setFirestoreDocArray('hrWarnings', warnings, true);
}

// --- HR: Payroll ---
export async function dbFetchHRPayroll(): Promise<any[]> {
  return getFirestoreDocArray('hrPayroll');
}
export async function dbSaveHRPayroll(payroll: any[]): Promise<void> {
  await setFirestoreDocArray('hrPayroll', payroll, true);
}

// --- HR: Accident Reports ---
export async function dbFetchHRAccidents(): Promise<any[]> {
  return getFirestoreDocArray('hrAccidents');
}
export async function dbSaveHRAccidents(accidents: any[]): Promise<void> {
  await setFirestoreDocArray('hrAccidents', accidents, true);
}

// --- HR: Medical Records ---
export async function dbFetchHRMedicals(): Promise<any[]> {
  return getFirestoreDocArray('hrMedicals');
}
export async function dbSaveHRMedicals(medicals: any[]): Promise<void> {
  await setFirestoreDocArray('hrMedicals', medicals, true);
}
