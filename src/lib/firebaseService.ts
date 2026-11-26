import { auth, app, clientDb } from './googleDrive.ts';
import { doc, getDoc, setDoc, runTransaction, onSnapshot, Unsubscribe } from 'firebase/firestore';
import { applySupplierSave, applySupplierBulk, type BulkSupplierItem } from './suppliers';
import { APPROVAL_THRESHOLD, nextDocNo, poTotals } from './procurement';
import { addDays, tfAmounts, tfPosition } from './tradeFinance';
import { QUEUE_BOARD, QUEUE_FINISHED, defaultProcurementSettings, normalizeRoute, routeNext, sameName, stfPermissions } from './stf';
import type { PurchaseOrder, PoLine, Rfq, RfqQuote, SupplierInvoice, SupplierPayment, TradeFinance, TfRepayment, ProcAttachment, Stf, StfLine, StfStatus, ProcurementSettings } from '../types';
import { shardCountFor, shardDocNamesFor, splitIntoShards, mergeLegacy } from './shardConfig';
import { BACKUP_DOC_IDS, runRestore, chunkByBytes, RestoreMode, RestoreReportRow } from './backupSets';
import { Pool, Team, ActivityLog, PlannedPool, ProjectSummary, MonthlyTarget, Employee, TrolleyProduction, RecycleBinItem, EmployeePunch, Material, BOMItem, MaterialRequest, FloorStock, StockAdjustment, Supplier, SECTION_DEFINITIONS, SUPERVISOR_SECTIONS, MaterialReturn, CompanyAsset, InventoryDeletionLog, ChecklistTemplate } from '../types';
import { scheduleStockAlertCheck } from './stockAlerts';
// NOTE: clientDb now comes from googleDrive.ts, which is the ONLY place
// Firestore is initialized (via initializeFirestore with long-polling
// forced on). Do NOT call getFirestore(app) here — see googleDrive.ts.

// ─────────────────────────────────────────────────────────────────────────────
// COLLECTION-BACKED DATA (proper fix for both the 1 MiB size limit AND
// cross-device race conditions / data loss)
//
// THE OLD PROBLEM: every collection (pools, teams, logs, employees, ...) was
// stored as ONE Firestore document — system_state/{name} — holding the
// entire array as a single JSON blob. Two consequences:
//   1. Firestore hard-caps a document at 1 MiB. 'pools' grew past that, so
//      EVERY write to it started failing outright — which is why sync
//      looked broken (nothing could be written anymore).
//   2. Editing ONE pool required reading and rewriting the ENTIRE array.
//      If two floor PCs saved within the same moment, one write could
//      silently overwrite the other's changes — the actual cause of the
//      race conditions and data loss.
//
// A document-sharding fix (splitting one big doc into 8 smaller docs) was
// applied first and it solved the size-limit crash, but it did NOT solve
// the race condition — two edits landing in the same shard could still
// collide, and a single pool edit still meant rewriting a chunk of ~48
// other unrelated pools.
//
// THE REAL FIX (this section): collections listed in COLLECTION_BACKED are
// no longer stored as array-documents (sharded or not) at all. Instead
// each item becomes its OWN small document in a real top-level Firestore
// collection — e.g. pools/{poolId}, one document per pool. This means:
//   - Editing pool #204 writes exactly ONE document. No other pool's data
//     is read or touched, so no size limit is realistically reachable.
//   - Editing pool #12 on one PC and pool #340 on another PC touch
//     completely different documents — they cannot collide, ever.
//   - Two people editing the SAME pool at nearly the same time still get
//     Firestore's normal last-write-wins on that one small document,
//     which is the expected/correct behavior for a single record.
//
// Every read, write, transaction, and live listener below is aware of
// which collections are collection-backed vs. still using the legacy
// system_state/{name} single-array-document pattern — callers elsewhere
// in the app (App.tsx, dbSavePool, etc.) don't know or care; they still
// just get/set one logical array per collection name, exactly as before.
//
// To move another collection (e.g. 'teams') onto this same pattern later,
// add its name to COLLECTION_BACKED below — nothing else needs to change
// in App.tsx or anywhere else that calls these functions.
// ─────────────────────────────────────────────────────────────────────────────
import {
  collection,
  getDocs,
  writeBatch,
  deleteDoc,
} from 'firebase/firestore';

// ─────────────────────────────────────────────────────────────────────────────
// DATE-BOUNDED COLLECTIONS (for collections that grow forever, like daily
// attendance punches). Loading and live-listening to the ENTIRE history of a
// collection like this gets slower and more expensive (in Firestore read
// costs) every single day, forever — even though each document itself is
// tiny and will never hit the 1 MiB limit. So for these specific collections
// we only load/listen to a recent rolling window by default, and provide a
// separate on-demand function for reports that genuinely need older data.
//
// Every punch record has a `date` field ("YYYY-MM-DD"), so we can filter with
// a native Firestore query instead of reading everything and filtering in
// JS — the query itself only reads the matching documents.
// ─────────────────────────────────────────────────────────────────────────────
const RECENT_WINDOW_DAYS: Record<string, number> = {
  employeePunches: 30,
};

function isoDateNDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

// Fetch only the last N days of a week-bucketed collection, by reading just
// the bucket documents that cover that window (typically ~5 for 30 days),
// instead of a collection-wide query.
async function collectionGetRecent(name: string, days: number): Promise<any[]> {
  const cutoff = isoDateNDaysAgo(days);
  const today = new Date().toISOString().slice(0, 10);
  const all = await readWeekBucketsInRange(name, cutoff, today);
  return all.filter((item: any) => item?.date >= cutoff);
}

// On-demand fetch for a specific date range — for reports/payroll that need
// older data than the default rolling window covers. Both bounds inclusive,
// "YYYY-MM-DD" format, matching the `date` field already stored on each
// punch record.
export async function dbGetEmployeePunchesInRange(startDate: string, endDate: string): Promise<EmployeePunch[]> {
  const all = await readWeekBucketsInRange('employeePunches', startDate, endDate);
  // Buckets can include a few extra days at the week's edges beyond the
  // exact requested range — filter down to the exact range requested.
  return (all as EmployeePunch[]).filter(p => p.date >= startDate && p.date <= endDate);
}

const COLLECTION_BACKED: Record<string, boolean> = {
  pools: true,
  teams: true,
  // Added after 226 pools released for one project (Samana Portafino) hit
  // this exact 1 MiB single-document limit: the plannedPools status update
  // (PLANNED → RELEASED) silently failed to save while the new live pool
  // (collection-backed, safe) still got created — so the pool showed up
  // BOTH still in the Planning queue AND live on the shop floor at once.
  // Run migration script migrate-planned-pools.js BEFORE this deploys, or
  // existing planned-pool records will appear to vanish (the app will start
  // reading from the new empty `plannedPools` collection instead of the old
  // system_state/plannedPools document).
  plannedPools: true,
  // HR Suite: every record is its own document so no HR list can ever reach
  // the 1 MiB single-document limit. Registering the names here makes the
  // existing backup / restore read and write them as collections. The HR
  // portal copies any data from the old single-document lists automatically
  // the first time it opens (see migrateHRSuiteIfNeeded in hrStore.ts).
  hrProfiles: true,
  hrDocuments: true,
  hrLifecycle: true,
  hrCases: true,
  hrRequests: true,
  hrTraining: true,
  hrPPE: true,
  hrAccidentCases: true,
  hrReviews: true,
  hrLetters: true,
  hrAudit: true,
  hrVacancies: true,
  hrCandidates: true,
  hrSettlements: true,
  hrNotices: true,
  hrGrievances: true,
  hrVehicles: true,
  hrFuelLogs: true,
  hrVehicleService: true,
  hrVehicleFines: true,
  hrHolidays: true,
  hrLeavePolicy: true,
  hrLeaveAdjust: true,
  hrPayrollSettings: true,
  hrExpenses: true,
  hrPettyCash: true,
  hrExpenseBudgets: true,
};

// ─────────────────────────────────────────────────────────────────────────────
// WEEK-BUCKETED COLLECTIONS (the right trade-off for high-VOLUME, bulk-synced
// data like daily attendance punches)
//
// THE PROBLEM WITH ONE-DOCUMENT-PER-RECORD FOR PUNCHES: Firestore bills per
// document WRITE, not per "logical save". The old single-array-document
// design was accidentally cheap on writes — uploading 500 backlogged punches
// from a kiosk was ONE billed write (one big document overwrite), even
// though it was dangerous (1 MiB limit, race conditions across the whole
// history). Making every punch its own document (like pools/teams) fixed
// the danger but made that same 500-punch kiosk sync cost 500 billed writes
// instead of 1 — which is what blew through the daily write quota.
//
// THE FIX: bucket punches into one document PER CALENDAR WEEK instead of one
// document per punch (or one document forever). A week's worth of punches
// easily stays well under the 1 MiB limit, and:
//   - A bulk sync of many punches that all fall in the same week now costs
//     ONE write again, exactly like the old design — quota-cheap.
//   - Two devices editing punches from DIFFERENT weeks never collide.
//   - Even two devices editing the SAME week collide far less often than
//     the old "entire all-time history in one document" design did, and
//     the blast radius of a collision is capped at one week's data instead
//     of every punch ever recorded.
// ─────────────────────────────────────────────────────────────────────────────
const WEEK_BUCKETED: Record<string, boolean> = {
  employeePunches: true,
};

function isWeekBucketed(docName: string): boolean {
  return !!WEEK_BUCKETED[docName];
}

// ISO 8601 week key, e.g. "2026-W34". Punches are grouped by the ISO week
// their `date` field falls in.
function isoWeekKey(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  // Move to the Thursday of this week (ISO weeks are defined by their Thursday)
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const weekNum = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function weekBucketDocName(docName: string, dateStr: string): string {
  return `${docName}__${isoWeekKey(dateStr)}`;
}

// Every ISO week key that a [startDate, endDate] range touches, inclusive.
function weekKeysInRange(startDate: string, endDate: string): string[] {
  const keys = new Set<string>();
  const cur = new Date(startDate + 'T00:00:00Z');
  const end = new Date(endDate + 'T00:00:00Z');
  while (cur <= end) {
    keys.add(isoWeekKey(cur.toISOString().slice(0, 10)));
    cur.setUTCDate(cur.getUTCDate() + 7); // step by week is enough since we only need distinct week keys
  }
  keys.add(isoWeekKey(endDate)); // make sure the final week is always included
  return Array.from(keys);
}

// Read one week bucket's array (empty array if the bucket doesn't exist yet).
async function readWeekBucket(docName: string, weekKey: string): Promise<any[]> {
  const snap = await getDoc(doc(clientDb, 'system_state', `${docName}__${weekKey}`));
  if (!snap.exists()) return [];
  const raw = snap.data();
  return Array.isArray(raw?.data) ? raw.data : [];
}

// Read and merge every week bucket touching [startDate, endDate].
async function readWeekBucketsInRange(docName: string, startDate: string, endDate: string): Promise<any[]> {
  const weekKeys = weekKeysInRange(startDate, endDate);
  const arrays = await Promise.all(weekKeys.map(wk => readWeekBucket(docName, wk)));
  return arrays.flat();
}

function isCollectionBacked(docName: string): boolean {
  return !!COLLECTION_BACKED[docName];
}

// Firestore write batches are capped at 500 operations — chunk larger diffs
// into multiple batches so this keeps working even on very large collections.
async function commitInChunks(ops: Array<(batch: ReturnType<typeof writeBatch>) => void>) {
  const CHUNK = 450; // safety margin under Firestore's 500-op batch limit
  for (let i = 0; i < ops.length; i += CHUNK) {
    const batch = writeBatch(clientDb);
    ops.slice(i, i + CHUNK).forEach(op => op(batch));
    await batch.commit();
  }
}

// Read every document in a collection-backed collection and return it as a
// plain array — mirrors what getFirestoreDocArray returned for the old
// array-document pattern, so callers see no difference.
async function collectionGetAll(name: string): Promise<any[]> {
  const snap = await getDocs(collection(clientDb, name));
  // Records whose body has no `id` field used to load with id === undefined,
  // which made them match every other id-less record (and `t.id === undefined`
  // lookups). Fall back to the Firestore document id so each record is unique
  // and can be found/deleted.
  return snap.docs.map(d => {
    const data = d.data();
    return data && data.id ? data : { ...data, id: d.id };
  });
}

// Write a full array into a collection-backed collection, but ONLY touch
// documents that actually changed — this is what keeps per-edit write cost
// down to ~1 document instead of rewriting everything, and is what removes
// the race condition (unrelated documents are never read or rewritten).
async function collectionDiffWrite(name: string, newArray: any[]): Promise<void> {
  const current = await collectionGetAll(name);
  const currentById = new Map(current.map(item => [item.id, item]));
  const newById = new Map(newArray.map(item => [item.id, item]));

  const ops: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];

  // Set (create or update) any item that's new or actually changed.
  newById.forEach((item, id) => {
    const existing = currentById.get(id);
    if (!existing || JSON.stringify(existing) !== JSON.stringify(item)) {
      const cleaned = removeUndefined(item);
      ops.push(batch => batch.set(doc(clientDb, name, String(id)), cleaned));
    }
  });

  // Delete any item that existed before but isn't in the new array.
  currentById.forEach((_item, id) => {
    if (!newById.has(id)) {
      ops.push(batch => batch.delete(doc(clientDb, name, String(id))));
    }
  });

  if (ops.length > 0) {
    await commitInChunks(ops);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LEGACY DOCUMENT SHARDING (still used for any collection NOT listed in
// COLLECTION_BACKED above). See the block above for why COLLECTION_BACKED is
// now the preferred approach for high-churn / large collections.
// ─────────────────────────────────────────────────────────────────────────────
// Small-files storage settings live in ./shardConfig (shared with backups).
export { storageCapacityBytes, fnv1a, SHARD_BYTES_PER_DOC } from './shardConfig';

export class StaleClientError extends Error {
  constructor() {
    super('This page is out of date (the app was updated). Please refresh your browser (Ctrl+F5) and try again — nothing was lost.');
    this.name = 'StaleClientError';
  }
}

interface ShardRead {
  n: number;
  legacyRef: any;
  shardRefs: any[];
  shardData: any[][];
  shardMeta: Array<{ exists: boolean; shardCount?: number }>;
  legacyData: any[];
  current: any[];
}

// Reads the old single document plus every shard through `get` (a plain getDoc,
// or transaction.get when called inside a transaction).
async function readShards(docName: string, get: (ref: any) => Promise<any>, enforceGuard: boolean): Promise<ShardRead> {
  const n = shardCountFor(docName);
  const legacyRef = doc(clientDb, 'system_state', docName);
  const shardRefs = shardDocNamesFor(docName).map((sn) => doc(clientDb, 'system_state', sn));
  const snaps = await Promise.all([legacyRef, ...shardRefs].map((r) => get(r)));
  const [legacySnap, ...shardSnaps] = snaps;
  const arrOf = (snap: any) => (snap.exists() && Array.isArray(snap.data()?.data) ? snap.data().data : []);
  const legacyData: any[] = arrOf(legacySnap);
  const shardData: any[][] = shardSnaps.map(arrOf);
  const shardMeta = shardSnaps.map((sn: any) => ({ exists: sn.exists(), shardCount: sn.exists() ? sn.data()?.shardCount : undefined }));
  if (enforceGuard && shardMeta.some((m) => typeof m.shardCount === 'number' && m.shardCount > n)) throw new StaleClientError();
  return { n, legacyRef, shardRefs, shardData, shardMeta, legacyData, current: mergeLegacy(legacyData, shardData.flat()) };
}

// Which documents must be written to turn `rd.current` into `updated`.
// Only shards whose contents really changed are written; if the old single
// document still holds data, every shard is written and the old one is emptied
// in the same transaction (the automatic migration).
function planShardWrites(rd: ShardRead, updated: any[]): Array<{ ref: any; data: any }> {
  const shards = splitIntoShards(removeUndefined(updated), rd.n);
  const migrating = rd.legacyData.length > 0;
  const writes: Array<{ ref: any; data: any }> = [];
  shards.forEach((data, i) => {
    const meta = rd.shardMeta[i];
    const unchanged = !migrating && meta.exists && meta.shardCount === rd.n && JSON.stringify(rd.shardData[i]) === JSON.stringify(data);
    if (!unchanged) writes.push({ ref: rd.shardRefs[i], data: { data, shardCount: rd.n } });
  });
  if (migrating) writes.push({ ref: rd.legacyRef, data: { data: [], migratedToShards: rd.n, migratedAt: new Date().toISOString() } });
  return writes;
}

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
    'hrSiteDeployed',
    'hrPurchaseRequests',
    'supervisorPurchaseRequests',
    'qcDefects',
    'companies',
  ];

  const unsubs: Unsubscribe[] = [];

  collections.forEach(name => {
    if (isWeekBucketed(name)) {
      // Week-bucketed: listen to the handful of bucket documents covering
      // the recent window (e.g. ~5 weekly docs for a 30-day window) instead
      // of a whole collection or a collection-wide query. Merges just like
      // the old document-sharding approach did, but the bucket boundaries
      // are meaningful (calendar weeks) instead of an arbitrary index % N.
      const windowDays = RECENT_WINDOW_DAYS[name] || 30;
      const cutoff = isoDateNDaysAgo(windowDays);
      const today = new Date().toISOString().slice(0, 10);
      const weekKeys = weekKeysInRange(cutoff, today);
      const bucketDocNames = weekKeys.map(wk => `${name}__${wk}`);

      const bucketCache: any[][] = bucketDocNames.map(() => []);
      const bucketSeen: boolean[] = bucketDocNames.map(() => false);

      bucketDocNames.forEach((bucketDocName, i) => {
        unsubs.push(
          onSnapshot(
            doc(clientDb, 'system_state', bucketDocName),
            snap => {
              if (snap.exists()) {
                const raw = snap.data();
                bucketCache[i] = Array.isArray(raw?.data) ? raw.data : [];
              } else {
                bucketCache[i] = [];
              }
              bucketSeen[i] = true;
              if (bucketSeen.every(Boolean)) {
                const merged = bucketCache.flat().filter((item: any) => item?.date >= cutoff);
                callback({ collection: name, data: merged });
              }
            },
            err => console.warn(`[liveSync] ${bucketDocName} (week bucket of '${name}') subscription error:`, err)
          )
        );
      });
      return;
    }

    if (isCollectionBacked(name)) {
      // Real collection: Firestore streams us exactly which documents
      // changed. We still hand the callback a full merged array (App.tsx
      // expects that shape), but the network traffic and the write cost
      // that produced this update were both scoped to just the documents
      // that actually changed — not the whole collection.
      unsubs.push(
        onSnapshot(
          collection(clientDb, name),
          snap => {
            callback({ collection: name, data: snap.docs.map(d => { const data = d.data(); return data && data.id ? data : { ...data, id: d.id }; }) });
          },
          err => console.warn(`[liveSync] ${name} (collection) subscription error:`, err)
        )
      );
      return;
    }

    const shardNames = shardDocNamesFor(name);

    if (shardNames.length === 1) {
      // Unsharded path — identical behavior to before.
      unsubs.push(
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
      return;
    }

    // Sharded path — listen to every shard doc independently, keep the last
    // known contents of each shard in memory, and fire the callback with the
    // MERGED array whenever any single shard changes. This is what lets a
    // sharded collection still look like one live array to the rest of the
    // app, exactly like the unsharded path above.
    const shardCache: any[][] = shardNames.map(() => []);
    const shardSeen: boolean[] = shardNames.map(() => false);

    shardNames.forEach((shardDocName, i) => {
      unsubs.push(
        onSnapshot(
          doc(clientDb, 'system_state', shardDocName),
          snap => {
            if (snap.exists()) {
              const raw = snap.data();
              shardCache[i] = Array.isArray(raw?.data) ? raw.data : [];
            } else {
              shardCache[i] = [];
            }
            shardSeen[i] = true;
            // Wait until every shard has reported at least once before the
            // first callback, so we never fire a partial/incomplete merge
            // (e.g. only 2 of 8 shards loaded) that looks like data loss.
            if (shardSeen.every(Boolean)) {
              callback({ collection: name, data: shardCache.flat() });
            }
          },
          err => console.warn(`[liveSync] ${shardDocName} (shard of '${name}') subscription error:`, err)
        )
      );
    });
  });

  return () => unsubs.forEach(u => { try { u(); } catch {} });
}

// ─────────────────────────────────────────────────────────────────────────────
// PERMANENT ACTIVITY LOG ARCHIVE
//
// The 'logs' document under system_state is a ROLLING CACHE, deliberately
// trimmed to the most recent 200 entries on every save (see dbSaveLog,
// saveEntireStateToFirestore, saveChangedCollectionsToFirestore below) so
// that single document never exceeds Firestore's 1MB document size limit.
// That trimming means anything older than the last 200 QC actions was being
// permanently discarded — old data was NOT being kept.
//
// This archive fixes that WITHOUT touching Firestore rules and WITHOUT a new
// top-level collection: it reuses the exact same system_state/{docName}
// array-document pattern that 'logs', 'pools', 'teams', etc. already use and
// are already permitted to write under today's rules. The only difference is
// the archive is split into one document PER MONTH (e.g. "logsArchive_2026-08")
// instead of everything in one document, so no single document ever grows
// past a few hundred KB no matter how much history piles up — and nothing
// inside a month's document is ever trimmed or removed, only appended to.
// ─────────────────────────────────────────────────────────────────────────────
// SHARD SIZE FIX: one document per MONTH turned out to be too big at real
// factory volume — September 2026 alone reached ~1.1 MB and every archive
// write after that point failed (Firestore's hard limit is 1 MiB per
// document), silently leaving the rest of the month un-archived. Shards are
// now one document per ~7-day block of the month (days 1-7 = w1, 8-14 = w2,
// 15-21 = w3, 22-28 = w4, 29-31 = w5), i.e. roughly a quarter of the size
// of a month, with a wide safety margin. Older monthly documents
// ("logsArchive_2026-08" etc.) are left untouched and are still read by
// dbFetchActivityLogsInRange, so no history is lost.
function archiveShardName(timestampISO: string): string {
  // '2026-09-24T09:15:00.000Z' -> 'logsArchive_2026-09-w4'
  const month = timestampISO.slice(0, 7);
  const day = parseInt(timestampISO.slice(8, 10), 10) || 1;
  const week = Math.min(5, Math.floor((day - 1) / 7) + 1);
  return `logsArchive_${month}-w${week}`;
}

// Best-effort archive write. Never throws — if it fails (e.g. brief network
// hiccup), the primary log save (rolling 200-entry cache) still succeeds and
// this entry just isn't archived yet; the actual QC action is unaffected.
// Safe to call repeatedly with overlapping logs — dedupes by log.id so
// nothing is ever double-counted.
export async function dbArchiveActivityLogs(logsToArchive: ActivityLog[]): Promise<void> {
  const valid = logsToArchive.filter(l => !!l.id && !!l.timestamp);
  if (!valid.length) return;

  // Group by month so each month is exactly one transaction, regardless of
  // how many logs are being archived in this call.
  const byMonth = new Map<string, ActivityLog[]>();
  for (const log of valid) {
    const shard = archiveShardName(log.timestamp);
    if (!byMonth.has(shard)) byMonth.set(shard, []);
    byMonth.get(shard)!.push(log);
  }

  for (const [shardName, monthLogs] of byMonth) {
    try {
      await updateFirestoreDocArray(shardName, (current: any[]) => {
        const existingIds = new Set(current.map((l: any) => l.id));
        const toAdd = monthLogs.filter(l => !existingIds.has(l.id));
        if (toAdd.length === 0) return current; // already archived, nothing new to add
        return [...current, ...toAdd]; // append-only — never trimmed, never removed
      });
    } catch (err) {
      console.warn(`[dbArchiveActivityLogs] failed to archive to '${shardName}' (primary log save is unaffected):`, err);
    }
  }
}

// Fetches the FULL, permanent history for a date range — not limited to the
// last 200 entries. start/end are local date strings 'YYYY-MM-DD', inclusive.
export async function dbFetchActivityLogsInRange(startDate: string, endDate: string): Promise<ActivityLog[]> {
  try {
    const months: string[] = [];
    const [sy, sm] = startDate.slice(0, 7).split('-').map(Number);
    const [ey, em] = endDate.slice(0, 7).split('-').map(Number);
    let y = sy, m = sm;
    while (y < ey || (y === ey && m <= em)) {
      months.push(`${y}-${String(m).padStart(2, '0')}`);
      m++;
      if (m > 12) { m = 1; y++; }
    }

    // Each month can live in the legacy single monthly document AND/OR the
    // newer weekly shards (see archiveShardName) — read all of them.
    const shardNames = months.flatMap(month => [
      `logsArchive_${month}`,
      ...[1, 2, 3, 4, 5].map(w => `logsArchive_${month}-w${w}`),
    ]);
    const results = await Promise.all(shardNames.map(name => getFirestoreDocArray(name)));
    const all = results.flat() as ActivityLog[];
    // De-dupe by id: the same log can legitimately appear in both the old
    // monthly document and a new weekly shard (the archive re-sends
    // overlapping recent logs on each save).
    const seen = new Set<string>();
    return all.filter(l => {
      if (!l || !l.id || !l.timestamp || seen.has(l.id)) return false;
      seen.add(l.id);
      const d = l.timestamp.slice(0, 10);
      return d >= startDate && d <= endDate;
    });
  } catch (err) {
    console.warn('[dbFetchActivityLogsInRange] archive read failed:', err);
    return [];
  }
}

// Direct client firestore document read utilities.
// NOTE: this version is tolerant of transient errors — it returns [] instead of
// throwing so the UI doesn't crash on a brief network hiccup. It is used for
// normal reads (loading data to show on screen), NOT for the empty-write
// safety check below. See getFirestoreDocArrayStrict for that.
async function getFirestoreDocArray(docName: string): Promise<any[]> {
  try {
    if (isWeekBucketed(docName)) {
      // Default load is bounded to the recent window — callers that need
      // older data (reports/payroll) should call dbGetEmployeePunchesInRange
      // explicitly instead of relying on this generic function.
      const days = RECENT_WINDOW_DAYS[docName] || 30;
      return await collectionGetRecent(docName, days);
    }
    if (isCollectionBacked(docName)) {
      return await collectionGetAll(docName);
    }
    if (shardCountFor(docName) > 1) {
      // Reading never needs the stale-app guard (it can't corrupt anything).
      return (await readShards(docName, (ref) => getDoc(ref), false)).current;
    }
    const docRef = doc(clientDb, 'system_state', docName);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const resp = snap.data();
      return Array.isArray(resp?.data) ? resp.data : [];
    }
    return [];
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
  if (isCollectionBacked(docName)) {
    // Collection-backed reads already don't swallow errors (getDocs throws
    // naturally on failure), so this is just a direct pass-through.
    return await collectionGetAll(docName);
  }
  if (shardCountFor(docName) > 1) {
    // Sharded strict read: deliberately does NOT catch errors (see the note
    // above): if any shard read fails, the error must propagate so callers
    // refuse to treat a failed check as "empty".
    return (await readShards(docName, (ref) => getDoc(ref), false)).current;
  }
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
    if (isCollectionBacked(docName)) {
      await collectionDiffWrite(docName, data);
      return;
    }
    const shardNames = shardDocNamesFor(docName);
    if (shardNames.length === 1) {
      const docRef = doc(clientDb, 'system_state', docName);
      await setDoc(docRef, { data: removeUndefined(data) });
      return;
    }
    // Sharded write: split the array across N docs so no single document
    // can hit Firestore's 1 MiB limit, and empty the old single document so
    // its stale copy can never be merged back in.
    const cleaned = removeUndefined(data);
    const shards = splitIntoShards(cleaned, shardNames.length);
    await Promise.all([
      ...shardNames.map((sn, i) => setDoc(doc(clientDb, 'system_state', sn), { data: shards[i], shardCount: shardNames.length })),
      setDoc(doc(clientDb, 'system_state', docName), { data: [], migratedToShards: shardNames.length, migratedAt: new Date().toISOString() }),
    ]);
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
// ─────────────────────────────────────────────────────────────────────────────
// Atomic multi-document version of updateFirestoreDocArray above. Each
// "collection" here is really one JSON-array document under system_state/*,
// so a single Firestore transaction touching several of those documents at
// once IS a real multi-collection transaction — all reads happen first, all
// writes commit together or none do, and Firestore auto-retries on conflict
// exactly like the single-doc version.
//
// This replaces call sites that used to do two or three separate
// updateFirestoreDocArray calls in a row for one logical action (e.g.
// "approve a request" = touch materials AND floorStock AND materialRequests).
// Doing those as separate calls left a real gap: if the app crashed or lost
// connection between call 1 and call 2, the data would end up half-updated
// (e.g. stock left the shelf but never arrived on the floor) with no way to
// tell from the data alone that anything was wrong. One transaction makes
// that gap impossible — either the whole action happened, or none of it did.
async function updateFirestoreDocArrays(
  updates: Record<string, (arr: any[]) => any[]>,
  allowEmpty: Record<string, boolean> = {},
): Promise<Record<string, any[]>> {
  const results = await updateFirestoreDocArraysCore(updates, allowEmpty);
  if ('materials' in updates) scheduleStockAlertCheck();
  return results;
}

async function updateFirestoreDocArraysCore(
  updates: Record<string, (arr: any[]) => any[]>,
  allowEmpty: Record<string, boolean> = {},
): Promise<Record<string, any[]>> {
  const docNames = Object.keys(updates);
  const collectionBackedNames = docNames.filter(isCollectionBacked);
  const legacyNames = docNames.filter(n => !isCollectionBacked(n));
  const results: Record<string, any[]> = {};

  // Collection-backed collections can't join the legacy runTransaction below
  // (they don't map to a fixed, known set of document refs ahead of time).
  // Handle them first, individually — see the note in updateFirestoreDocArray
  // above for why per-document writes don't need cross-collection atomicity
  // the same way the old whole-array pattern did.
  for (const name of collectionBackedNames) {
    const current = await collectionGetAll(name);
    const updated = updates[name]([...current]);
    if (!allowEmpty[name] && updated.length === 0 && current.length > 0) {
      console.warn(`[updateFirestoreDocArrays] Refusing to write empty array to '${name}' (current has ${current.length} items). Skipping this doc's write.`);
      results[name] = current;
      continue;
    }
    await collectionDiffWrite(name, updated);
    results[name] = updated;
  }

  if (legacyNames.length === 0) {
    return results;
  }

  await runTransaction(clientDb, async (transaction) => {
    // All reads first (Firestore transaction rule: reads before writes).
    // A "sharded" name reads its old single document plus every shard; a
    // plain name reads just its own document.
    const plainReads: Record<string, { refs: any[]; current: any[] }> = {};
    const shardReads: Record<string, ShardRead> = {};
    const currents: Record<string, any[]> = {};
    for (const name of legacyNames) {
      if (shardCountFor(name) > 1) {
        shardReads[name] = await readShards(name, (ref) => transaction.get(ref), true);
        currents[name] = shardReads[name].current;
      } else {
        const refs = shardDocNamesFor(name).map((sn) => doc(clientDb, 'system_state', sn));
        const snaps = await Promise.all(refs.map((ref) => transaction.get(ref)));
        const current = snaps.flatMap((snap) => (snap.exists() && Array.isArray(snap.data()?.data) ? snap.data()!.data : []));
        plainReads[name] = { refs, current };
        currents[name] = current;
      }
    }
    // Then apply every update function (in the order given) and write.
    for (const name of legacyNames) {
      const current = currents[name];
      const updated = updates[name]([...current]);
      if (!allowEmpty[name] && updated.length === 0 && current.length > 0) {
        console.warn(`[updateFirestoreDocArrays] Refusing to write empty array to '${name}' (current has ${current.length} items). Skipping this doc's write.`);
        results[name] = current;
        continue;
      }
      results[name] = updated;
      if (shardReads[name]) {
        for (const w of planShardWrites(shardReads[name], updated)) transaction.set(w.ref, w.data);
      } else {
        const { refs } = plainReads[name];
        const shards = splitIntoShards(removeUndefined(updated), refs.length);
        refs.forEach((ref, j) => transaction.set(ref, { data: shards[j] }));
      }
    }
  });

  return results;
}

// Every write to the materials list asks the server to re-check stock levels
// (debounced) so Reorder / Urgent e-mails go out within seconds of a drop, no
// matter which screen or device changed the quantity.
async function updateFirestoreDocArray(docName: string, updateFn: (arr: any[]) => any[], allowEmpty: boolean = false): Promise<any[]> {
  const result = await updateFirestoreDocArrayCore(docName, updateFn, allowEmpty);
  if (docName === 'materials') scheduleStockAlertCheck();
  return result;
}

async function updateFirestoreDocArrayCore(docName: string, updateFn: (arr: any[]) => any[], allowEmpty: boolean = false): Promise<any[]> {
  if (isCollectionBacked(docName)) {
    // Collection-backed path: no single "transaction" spans an unknown,
    // variable set of documents the way the legacy array-transaction did —
    // and it doesn't need to. Since each item is its own document, the only
    // way two writes can ever collide is if they touch the SAME item at the
    // same instant, and Firestore's normal per-document write ordering
    // already handles that correctly. Editing pool #12 and pool #340 at the
    // same moment now literally cannot conflict, because they're different
    // documents — that's the whole point of this restructure.
    const current = await collectionGetAll(docName);
    const updatedArr = updateFn([...current]);
    if (!allowEmpty && updatedArr.length === 0 && current.length > 0) {
      console.warn(`[updateFirestoreDocArray] Refusing to write empty array to '${docName}' (current has ${current.length} items). Skipping write.`);
      return current;
    }
    await collectionDiffWrite(docName, updatedArr);
    return updatedArr;
  }

  if (shardCountFor(docName) > 1) {
    let shardedResult: any[] = [];
    try {
      await runTransaction(clientDb, async (transaction) => {
        const rd = await readShards(docName, (ref) => transaction.get(ref), true);
        shardedResult = updateFn([...rd.current]);
        if (!allowEmpty && shardedResult.length === 0 && rd.current.length > 0) {
          console.warn(`[updateFirestoreDocArray] Refusing to write empty array to '${docName}' (current has ${rd.current.length} items). Skipping write.`);
          shardedResult = rd.current;
          return;
        }
        for (const w of planShardWrites(rd, shardedResult)) transaction.set(w.ref, w.data);
      });
    } catch (err) {
      console.error(`[updateFirestoreDocArray] Transaction failed for '${docName}':`, err);
      throw err;
    }
    return shardedResult;
  }

  const shardNames = shardDocNamesFor(docName);
  const docRefs = shardNames.map(sn => doc(clientDb, 'system_state', sn));
  let updatedArr: any[] = [];

  try {
    await runTransaction(clientDb, async (transaction) => {
      // Read every shard first (Firestore transaction rule: all reads before
      // any write). For an unsharded collection this is just the one doc,
      // identical to the old behavior.
      const snaps = await Promise.all(docRefs.map(ref => transaction.get(ref)));
      const current: any[] = snaps.flatMap(snap =>
        snap.exists() && Array.isArray(snap.data()?.data) ? snap.data()!.data : []
      );

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
      // this write, Firestore will abort and retry the whole transaction.
      // For sharded collections, re-split the FULL updated array across all
      // shard docs every time — this is what keeps every shard comfortably
      // under the 1 MiB limit no matter how the array grows or shrinks.
      const cleaned = removeUndefined(updatedArr);
      const shards = splitIntoShards(cleaned, docRefs.length);
      docRefs.forEach((ref, i) => transaction.set(ref, { data: shards[i] }));
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
    //
    // 'teams' is DELIBERATELY not written here anymore. It's collection-backed
    // now and already has its own dedicated, skeleton-guard-protected save
    // path (dbSyncTeams) — that guard is what stops a stray generic/empty
    // team list from ever overwriting real customized teams. This bulk
    // function has no such guard, and a false-positive "empty database"
    // detection elsewhere in the app once used it to silently write ~51
    // generic placeholder teams alongside real ones. Route ALL team saves
    // through dbSyncTeams instead — never through this function.
    dbArchiveActivityLogs(logsList); // permanent archive, never trimmed — fire-and-forget
    await Promise.all([
      setFirestoreDocArray('pools', poolsList),
      setFirestoreDocArray('plannedPools', plannedPoolsList),
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
// DATA-LOSS FIX (v6): partial, transactional state save.
// Only the collections the user actually CHANGED are written — the other 8
// collections are never touched, so a stale tab can no longer overwrite the
// whole database with old data. Each write goes through a Firestore
// TRANSACTION (updateFirestoreDocArray) which:
//   • serializes concurrent writes from multiple PCs (no last-write-wins wipe)
//   • FAILS when the device is offline instead of silently queueing a stale
//     full-document overwrite that would flush hours later on reconnect
//
// DATA-LOSS FIX (v7): MERGE instead of blind overwrite.
// THE BUG: this function used to call `updateFirestoreDocArray(name, () => data)`.
// That threw away whatever the transaction just read from the live server and
// wrote the caller's local array verbatim. A browser tab open for a while (a
// kiosk screen, an idle PC, a phone that never refreshed) could have a
// teams/employees/etc array missing records another device added or edited
// since this tab loaded. The instant that tab changed ANYTHING in that
// collection (e.g. setting one team's login code), it silently deleted every
// record it didn't know about — this is exactly how "all Teams Allocation
// data disappeared" happens with zero errors shown.
//
// THE FIX: merge by `id` against the array the transaction just read live
// from Firestore ("current"), instead of replacing it:
//   • records in `current` but missing from the local array are KEPT
//     (added/edited elsewhere after this tab last synced)
//   • records present in the local array win for matching ids (this tab's
//     edit is respected)
//   • records only in the local array (new adds) are appended
// True deletes still work correctly because delete flows (dbDeleteEmployee,
// dbSaveTeam-style handlers, etc.) go through their own targeted
// `updateFirestoreDocArray(name, arr => arr.filter(...))` calls that operate
// directly on the live server array — they never pass through this merge.
// ─────────────────────────────────────────────────────────────────────────────
function mergeById(current: any[], local: any[]): any[] {
  if (!Array.isArray(current) || current.length === 0) return local;
  if (!Array.isArray(local)) return current;
  const localIds = new Set(local.map((item) => item?.id));
  const restored = current.filter((item) => !localIds.has(item?.id));
  if (restored.length > 0) {
    console.warn(`[saveChangedCollectionsToFirestore] Restored ${restored.length} record(s) missing from local copy (added/edited elsewhere) instead of deleting them.`);
  }
  return [...local, ...restored];
}

// ─────────────────────────────────────────────────────────────────────────────
// DATA-LOSS FIX (v8): SCOPED merge — only let this tab's copy win for the
// specific record id(s) it actually changed.
//
// THE BUG: mergeById() (above) let the caller's ENTIRE local array win,
// record-by-record, for every id present in it. But "local" here is this
// tab's full in-memory copy of pools/teams — which is stale for every record
// this tab didn't just touch. Any save from a tab with an older screenful of
// data (a TV dashboard, a tablet that's been open a while, a second device)
// would silently overwrite a DIFFERENT record that another device had just
// updated seconds earlier — e.g. Worker B marks a pool finished, then Device
// A's next unrelated save (approving a different pool, starting a timer)
// wipes that finish back to its old state, because Device A's stale copy of
// that pool "won" the merge even though Device A never touched it.
//
// THE FIX: only apply the local version for ids the caller explicitly says
// it changed (`changedIds`). Every other record comes straight from
// `current` — the value the transaction just read live from the server —
// so an untouched record can never be rewound by a stale tab.
// ─────────────────────────────────────────────────────────────────────────────
function mergeByIdScoped(current: any[], local: any[], changedIds?: string[]): any[] {
  if (!Array.isArray(current) || current.length === 0) return local;
  if (!Array.isArray(local)) return current;
  // No explicit list of changed ids for this collection — fall back to the
  // old (broad) merge behaviour rather than silently dropping the write.
  if (!changedIds) return mergeById(current, local);

  const changedSet = new Set(changedIds);
  const localById = new Map(local.map((item) => [item?.id, item]));

  // Start from the server's live copy and only swap in local's version for
  // ids that were actually changed by this action.
  const result = current.map((item) =>
    changedSet.has(item?.id) && localById.has(item?.id) ? localById.get(item?.id) : item
  );

  // Brand-new records: changed ids that don't exist in `current` yet.
  const currentIds = new Set(current.map((item) => item?.id));
  for (const id of changedSet) {
    if (!currentIds.has(id) && localById.has(id)) {
      result.push(localById.get(id));
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// DATA-LOSS FIX (v11): weak/lost signal was silently dropping writes.
//
// ROOT CAUSE: every write in this file goes through a Firestore
// `runTransaction`. Transactions are NOT like normal Firestore writes — a
// normal `setDoc`/`updateDoc` gets queued in the SDK's own offline cache
// and sent automatically once the connection returns, even if the device
// was fully offline when you made the change. A transaction cannot do
// this: `transaction.get()` requires a live round-trip to the server, so
// on a weak or dropped connection it just fails outright (after Firestore's
// internal retry/timeout), and `updateFirestoreDocArray` rethrows.
//
// `saveChangedCollectionsToFirestore` used to fire pools/teams/logs/etc as
// independent promises in one `Promise.all`. On a flaky kiosk connection
// it's common for ONE of those (often teams, since a stage claim writes
// pools+teams together and one of the two can win the network race while
// the other times out) to fail while its siblings succeed — which matches
// exactly what was reported: pool progress looks fine, but the team
// allocation for that same action is gone. The local device's own state/
// localStorage already showed the change as done, so nothing on-screen
// indicated the cloud write had actually failed and been discarded.
//
// THE FIX: any collection write that fails here is no longer dropped — it's
// persisted into `apex_pending_firestore_writes` in localStorage, and
// retried automatically (see flushPendingWrites, wired up in App.tsx to
// run on the browser's 'online' event and on a periodic timer) until it
// actually lands in Firestore. If the same collection fails twice before
// it's retried, the newer attempt supersedes the older one in the queue
// instead of stacking duplicate writes.
// ─────────────────────────────────────────────────────────────────────────────
const PENDING_WRITES_KEY = 'apex_pending_firestore_writes';

interface PendingWrite {
  docName: string;
  data: any[];
  ids?: string[];
  queuedAt: number;
}

function loadPendingWrites(): PendingWrite[] {
  try {
    return JSON.parse(localStorage.getItem(PENDING_WRITES_KEY) || '[]');
  } catch {
    return [];
  }
}

function savePendingWrites(queue: PendingWrite[]) {
  localStorage.setItem(PENDING_WRITES_KEY, JSON.stringify(queue));
}

function queuePendingWrite(docName: string, data: any[], ids?: string[]) {
  // Collapse to one pending entry per collection — the newest attempt
  // already contains everything the older queued one was trying to save.
  const queue = loadPendingWrites().filter((pw) => pw.docName !== docName);
  queue.push({ docName, data, ids, queuedAt: Date.now() });
  savePendingWrites(queue);
}

export function getPendingWriteCount(): number {
  return loadPendingWrites().length;
}

// Retries every queued write. Safe to call repeatedly (e.g. on a timer or
// on the 'online' event) — entries that still fail simply stay queued for
// the next attempt, entries that succeed are removed.
export async function flushPendingWrites(): Promise<{ flushed: number; remaining: number }> {
  const queue = loadPendingWrites();
  if (queue.length === 0) return { flushed: 0, remaining: 0 };

  const stillPending: PendingWrite[] = [];
  let flushed = 0;

  for (const pw of queue) {
    try {
      if (pw.docName === 'logs') {
        await updateFirestoreDocArray('logs', () => pw.data);
      } else {
        await updateFirestoreDocArray(pw.docName, (current) => mergeByIdScoped(current, pw.data, pw.ids));
      }
      flushed++;
    } catch {
      stillPending.push(pw);
    }
  }

  savePendingWrites(stillPending);
  return { flushed, remaining: stillPending.length };
}

export async function saveChangedCollectionsToFirestore(
  changed: Record<string, any[]>,
  changedIds: Record<string, string[]> = {}
) {
  const entries = Object.entries(changed);
  if (entries.length === 0) return { success: true };

  const results = await Promise.allSettled(entries.map(([name, arr]) => {
    let data = arr;
    if (name === 'projectsSummary' && !arr.some((p: any) => p.id === 'SENTINEL_DB_INITIALIZED')) {
      data = [...arr, makeSentinel()];
    }
    // logs are an append/trim timeline, not id-keyed records — merging them
    // by id doesn't apply, so keep the direct trimmed write for logs.
    if (name === 'logs') {
      dbArchiveActivityLogs(data); // permanent archive, never trimmed — fire-and-forget
      const trimmed = data.slice(-200);
      return updateFirestoreDocArray(name, () => trimmed);
    }
    const ids = changedIds[name];
    return updateFirestoreDocArray(name, (current) => mergeByIdScoped(current, data, ids));
  }));

  let anyQueued = false;
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      const [name, arr] = entries[i];
      let data = arr;
      if (name === 'projectsSummary' && !arr.some((p: any) => p.id === 'SENTINEL_DB_INITIALIZED')) {
        data = [...arr, makeSentinel()];
      }
      const dataToQueue = name === 'logs' ? data.slice(-200) : data;
      console.warn(`[saveChangedCollectionsToFirestore] '${name}' failed to save (likely weak/lost connection) — queued for automatic retry instead of being dropped.`, result.reason);
      queuePendingWrite(name, dataToQueue, changedIds[name]);
      anyQueued = true;
    }
  });

  if (anyQueued) {
    return { success: false, queued: true };
  }
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

// 2.1b Company list (visa sponsor companies) — a simple string array stored
// as its own Firestore doc so it stays in sync across every device and can
// be edited from the Directory tab without ever touching code.
export async function dbSaveCompanies(list: string[]) {
  await setFirestoreDocArray('companies', list as any[], true);
  return { success: true, companies: list };
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
//
// DATA-LOSS FIX (v7 follow-up): team deletion used to only ever go through
// the generic saveState -> saveChangedCollectionsToFirestore path (there was
// no dedicated delete function for teams, unlike employees/pools/etc). Now
// that saveChangedCollectionsToFirestore MERGES by id instead of blindly
// overwriting (see mergeById above), a team removed only from the local
// array would be treated as "missing due to a stale tab" and restored — the
// delete button would silently stop working. This dedicated transactional
// delete removes the team directly from the live Firestore array, exactly
// like dbDeleteEmployee/dbDeletePool/etc, so the delete is real and permanent
// regardless of what any other tab's local array looks like.
export async function dbDeleteTeam(teamId: string) {
  // STALE-PATH FIX: this always wrote to the legacy system_state/teams
  // array document, even after 'teams' moved to the collection-backed
  // teams/{teamId} path dbSyncTeams actually uses. Nothing currently calls
  // this function (deletes go through handleUpdateTeams -> dbSyncTeams),
  // but it was a live trap for the day something did call it directly —
  // it would report success while leaving the real, live team document
  // completely untouched. Route it the same way dbSyncTeams does.
  if (isCollectionBacked('teams')) {
    await deleteDoc(doc(clientDb, 'teams', String(teamId)));
    return { success: true };
  }
  const base = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/$/, '');
  if (!base) {
    await updateFirestoreDocArray('teams', (arr) => arr.filter(item => item.id !== teamId), true);
    return { success: true };
  }

  try {
    const headers = await getHeaders();
    const response = await fetch(getApiUrl(`/api/teams/${teamId}`), {
      method: 'DELETE',
      headers,
    });
    if (!response.ok) throw new Error('Failed to delete Team from SQL.');
    return await response.json();
  } catch (error) {
    console.error('dbDeleteTeam failed:', error);
    throw error;
  }
}

// DATA-LOSS FIX (v8): dbDeleteTeam above and the generic saveState() path
// used to fire as TWO SEPARATE, uncoordinated Firestore transactions on
// every team edit — one that merges the local array by id (saveState ->
// saveChangedCollectionsToFirestore -> mergeById), and one that deletes
// removed ids (dbDeleteTeam). Each transaction reads the live doc, decides
// what to write, and commits independently. Firestore's transaction retry
// only protects a transaction from itself; it does NOT guarantee any
// ordering between two separately-fired transactions targeting the same
// document. When several team edits happened close together (multiple
// kiosks open, or a quick rename immediately after a delete), these two
// writes could interleave and a delete could be silently undone by the
// merge's "restore records missing from local" logic, or vice versa —
// this is how Teams Allocation data could vanish or come back wrong with
// no error shown.
//
// THE FIX: do the merge AND the removal inside ONE atomic transaction.
// Call this instead of (saveState's teams write + dbDeleteTeam per id).
// DATA-LOSS FIX (v9): SCOPED merge for teams, matching mergeByIdScoped above.
//
// THE BUG: this function let localTeams (the caller's ENTIRE in-memory team
// list) win for every id it contained — not just the id(s) actually edited.
// The Team Allocation screen (or any screen holding team state) could be
// carrying a stale copy of a team that the shop floor had just updated
// (assigned a pool, started a timer) seconds earlier. Saving ANY unrelated
// team edit — a rename, adding a team — would silently overwrite that
// just-updated team with the stale copy, because it "won" the merge even
// though this screen never touched it. This is why only team-allocation
// data kept reverting: this was the one save path in the app that still did
// a full-array overwrite after the general fix (mergeByIdScoped) was added.
//
// THE FIX: only let local win for ids the caller says it actually changed
// (`changedIds`). Everything else — and any explicit removal — is decided
// from `current` (the live server value read inside this transaction), so
// an untouched team can never be rewound by a stale screen.
export async function dbSyncTeams(localTeams: Team[], removedIds: string[] = [], changedIds?: string[]): Promise<Team[]> {
  const isGenericSkeletonTeam = (t: any) =>
    typeof t?.id === 'string' && typeof t?.name === 'string' &&
    /^[a-z_]+_t\d+$/.test(t.id) && / - Team \d+$/.test(t.name);
  const isGenericSkeletonArray = (arr: any[]) => arr.length > 0 && arr.every(isGenericSkeletonTeam);

  if (isCollectionBacked('teams')) {
    // ───────────────────────────────────────────────────────────────────────
    // COLLECTION-BACKED PATH: 'teams' moved from one array-document to a real
    // collection (teams/{teamId}), exactly like 'pools' and 'employeePunches'
    // did. This is what STRUCTURALLY removes the race described in the long
    // comment block above (v7–v13): two devices editing DIFFERENT teams at
    // the same moment now write to different documents and cannot interleave
    // at all — there's no shared array-document for their writes to collide
    // on anymore.
    //
    // The skeleton-guard safety net from all those earlier fixes is kept
    // as-is below (still genuinely useful — it protects against a stale
    // client re-seeding default teams over real customized data), it's just
    // now checked against a fresh full read of the collection instead of one
    // document. Teams collections are small (dozens, not thousands), so this
    // one full read per sync call is cheap — nothing like the punches/pools
    // situation.
    // ───────────────────────────────────────────────────────────────────────
    const current = await collectionGetAll('teams');

    if (isGenericSkeletonArray(localTeams) && current.length > 0 && !isGenericSkeletonArray(current)) {
      console.error(
        '[dbSyncTeams] BLOCKED: incoming team list looks like the auto-generated ' +
        'generic skeleton, but Firestore already holds real, customized team data. ' +
        'Refusing to overwrite — this write did not happen. If this fires, please ' +
        'reload the page fully before editing teams again.'
      );
      return current;
    }

    // ID GUARD: a team without an id would be written to a document literally
    // named "undefined" and collide with every other id-less team.
    const idless = localTeams.filter((t) => !t?.id);
    if (idless.length > 0) {
      throw new Error(
        `Refusing to save: ${idless.length} team record(s) have no ID (${idless.map((t) => t?.name || '?').join(', ')}). ` +
        `Remove or re-create them in Teams Allocation first.`
      );
    }

    const removedSet = new Set(removedIds);
    const localById = new Map(localTeams.map((t) => [t?.id, t]));
    let updatedArr: any[];
    let idsToWrite: Set<string>;

    if (!changedIds) {
      // No explicit changed-id list supplied — fall back to the old
      // (broad) behaviour: treat every id in localTeams as "changed".
      const localIds = new Set(localTeams.map((t) => t?.id));
      const restored = current.filter((item) => !localIds.has(item?.id) && !removedSet.has(item?.id));
      updatedArr = [...localTeams, ...restored];
      idsToWrite = new Set(localTeams.map((t) => t?.id));
    } else {
      const changedSet = new Set(changedIds);
      updatedArr = current
        .filter((item) => !removedSet.has(item?.id))
        .map((item) => (changedSet.has(item?.id) && localById.has(item?.id) ? localById.get(item?.id) : item));

      const currentIds = new Set(current.map((item) => item?.id));
      for (const id of changedSet) {
        if (!currentIds.has(id) && !removedSet.has(id) && localById.has(id)) {
          updatedArr.push(localById.get(id));
        }
      }
      idsToWrite = changedSet;
    }

    // DUPLICATE-LOGIN-CODE GUARD: a login code must be unique — it's how a
    // worker checks in on a shared kiosk (see handleTeamCodeSubmit in
    // App.tsx, which just does teams.find(t => t.code === code) — first
    // match wins). Two team docs sharing a code is how "Sonu Yadav" ended up
    // with a stale BUSY record and a new IDLE one both claiming code 6388:
    // checking in could silently resolve to the WRONG (old, stuck) record,
    // which looks exactly like being unable to claim new pools. Reject the
    // write here rather than only checking in the UI, since that catch can
    // be bypassed by stale local state (see the long comment above this
    // function) — this is the one place nothing gets persisted without
    // passing through.
    const codeCounts = new Map<string, number>();
    updatedArr.forEach((t) => {
      const code = (t?.code || '').trim();
      if (code) codeCounts.set(code, (codeCounts.get(code) || 0) + 1);
    });
    // Only block when the write itself CREATES or CHANGES a team involved in
    // the clash. Pre-existing duplicates the caller isn't touching must not
    // block unrelated saves — and above all must not block DELETING the
    // duplicates (removing one of three same-code records still leaves two).
    const dupeCode = [...codeCounts.entries()].find(([code, count]) =>
      count > 1 &&
      updatedArr.some((t) => (t?.code || '').trim() === code && idsToWrite.has(t?.id) && !removedSet.has(t?.id))
    );
    if (dupeCode) {
      const clashing = updatedArr.filter((t) => (t?.code || '').trim() === dupeCode[0]).map((t) => `${t.name} (${t.id})`);
      throw new Error(
        `Refusing to save: login code "${dupeCode[0]}" would be shared by more than one team — ${clashing.join(' and ')}. ` +
        `Give each team a different code (this is very likely the cause of a worker being unable to claim pools — ` +
        `their check-in may be resolving to the wrong, stuck team record).`
      );
    }

    // The actual fix: only write documents for ids that were genuinely
    // changed, plus deletes for removed ids — nothing else is read or
    // rewritten. An edit to Team A can never collide with an edit to Team B.
    const ops: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];
    idsToWrite.forEach((id) => {
      if (removedSet.has(id)) return;
      const item = localById.get(id);
      if (item) ops.push((batch) => batch.set(doc(clientDb, 'teams', String(id)), removeUndefined(item)));
    });
    removedSet.forEach((id) => {
      ops.push((batch) => batch.delete(doc(clientDb, 'teams', String(id))));
    });
    if (ops.length > 0) {
      await commitInChunks(ops);
    }

    return updatedArr;
  }

  // ───────────────────────────────────────────────────────────────────────
  // LEGACY PATH (kept as a fallback — should be unreachable now that 'teams'
  // is in COLLECTION_BACKED above, but left intact rather than deleted in
  // case COLLECTION_BACKED is ever toggled off for debugging).
  // ───────────────────────────────────────────────────────────────────────
  const docRef = doc(clientDb, 'system_state', 'teams');
  let updatedArr: any[] = [];

  // DATA-LOSS FIX (v13): content-based last-resort guard, independent of
  // teamsVerifiedRef / timing.
  //
  // Every previous fix (v7–v12, see comments above) closed a specific TIMING
  // race that let the hardcoded generic skeleton ("Steel Fabrication - Team
  // 1", "Team 2", ...) reach Firestore while real team data was still
  // loading on some device. Each one was a real, valid fix — but each was
  // also scoped to the exact race it was written for. If any future code
  // path (or a caller we haven't audited) ever calls dbSyncTeams with that
  // same generic skeleton again, none of the timing fixes would catch it,
  // because they all live upstream of this function.
  //
  // This check instead looks at CONTENT, right where the write actually
  // happens: generateDefaultTeams() produces a very distinctive, exact shape
  // — every id is "<stageId>_t<n>" and every name is "<Stage Name> - Team
  // <n>". A real, in-use team roster (renamed teams, custom codes, teams
  // added/removed over time) essentially never matches that shape for every
  // single entry. So: if what we're about to write is a full generic
  // skeleton, AND the server's current live copy already holds real data
  // that ISN'T a generic skeleton, refuse the write and keep the server
  // copy — no matter which code path or which earlier guard failed to catch
  // it. (isGenericSkeletonTeam / isGenericSkeletonArray are defined once,
  // above, and reused here in the legacy fallback path too.)

  await runTransaction(clientDb, async (transaction) => {
    const snap = await transaction.get(docRef);
    const current: any[] = snap.exists() && Array.isArray(snap.data()?.data)
      ? snap.data()!.data
      : [];

    if (isGenericSkeletonArray(localTeams) && current.length > 0 && !isGenericSkeletonArray(current)) {
      console.error(
        '[dbSyncTeams] BLOCKED: incoming team list looks like the auto-generated ' +
        'generic skeleton, but Firestore already holds real, customized team data. ' +
        'Refusing to overwrite — this write did not happen. If this fires, please ' +
        'reload the page fully before editing teams again.'
      );
      updatedArr = current;
      return;
    }

    const removedSet = new Set(removedIds);
    const localById = new Map(localTeams.map((t) => [t?.id, t]));

    if (!changedIds) {
      // No explicit changed-id list supplied — fall back to the old
      // (broad) behaviour rather than silently dropping the write.
      const localIds = new Set(localTeams.map((t) => t?.id));
      const restored = current.filter((item) => !localIds.has(item?.id) && !removedSet.has(item?.id));
      updatedArr = [...localTeams, ...restored];
    } else {
      const changedSet = new Set(changedIds);
      // Start from the server's live copy, drop explicit removals, and only
      // swap in local's version for ids that were actually changed.
      updatedArr = current
        .filter((item) => !removedSet.has(item?.id))
        .map((item) => (changedSet.has(item?.id) && localById.has(item?.id) ? localById.get(item?.id) : item));

      // Brand-new teams: changed ids that don't exist in `current` yet.
      const currentIds = new Set(current.map((item) => item?.id));
      for (const id of changedSet) {
        if (!currentIds.has(id) && !removedSet.has(id) && localById.has(id)) {
          updatedArr.push(localById.get(id));
        }
      }
    }

    transaction.set(docRef, { data: removeUndefined(updatedArr) });
  });

  return updatedArr;
}

// ─────────────────────────────────────────────────────────────────────────────
// DATA-LOSS FIX (v10): reconcile a restored Teams snapshot against live pool
// data before it's ever written back to Firestore.
//
// THE BUG: "Teams Allocation" backups (and full-database backups) capture
// Team.activePoolId as a plain snapshot at export time. Restoring that file
// later — after pools it references have since PASSED that stage, been
// re-claimed by a different team, or been deleted — used to go straight
// through handleRestoreState -> saveState -> saveChangedCollectionsToFirestore.
// Because the restored array differs from the live one for almost every
// team, `findChangedIds` marked nearly all of them "changed", so
// mergeByIdScoped let the STALE backup value win for every one of those
// teams. That silently re-attached an already-finished pool back onto the
// team that used to hold it — the exact "pool comes back to the same team
// after I upload a backup" symptom — and could reintroduce a duplicate
// `code` (kiosk login PIN) shared with a currently-active team, which is
// what caused workers to be logged into the wrong ("random") team.
//
// THE FIX: before a restored teams array is ever applied, cross-check every
// team.activePoolId against the CURRENT pool data (the pool must still
// exist, the stage the team claims to be working must still show that
// exact team as IN_PROGRESS on that pool's stageHistory). Anything that no
// longer matches is released back to IDLE rather than trusted from the
// backup. Duplicate login codes are also detected and stripped from every
// but the first occurrence so two teams can never collide on the same PIN.
// ─────────────────────────────────────────────────────────────────────────────
export function reconcileTeamsForRestore(
  livePools: any[],
  restoredTeams: Team[]
): { teams: Team[]; releasedCount: number; strippedCodeCount: number } {
  const poolsById = new Map((livePools || []).map((p) => [p?.id, p]));
  let releasedCount = 0;
  let strippedCodeCount = 0;

  // A pool id is still genuinely active for this team if it still exists,
  // is still IN_PROGRESS at this team's stage, and still lists this team.
  const isGenuinelyActive = (team: Team, poolId: string): boolean => {
    const pool = poolsById.get(poolId);
    const hist = pool?.stageHistory?.[team.stageId];
    return !!pool && !!hist && hist.status === 'IN_PROGRESS' && hist.teamId === team.id;
  };

  const releasedTeams = restoredTeams.map((team) => {
    // Mosaic-style stages allow up to 3 concurrent claims, so check
    // activePoolId AND every extraPoolIds entry — not just the first slot.
    const staleExtras = (team?.extraPoolIds || []).filter((id) => !isGenuinelyActive(team, id));
    const activeStale = !!team?.activePoolId && !isGenuinelyActive(team, team.activePoolId);

    if (!activeStale && staleExtras.length === 0) return team;

    releasedCount += 1;
    const survivingExtras = (team.extraPoolIds || []).filter((id) => !staleExtras.includes(id));
    if (activeStale) {
      // Primary slot is stale — promote a surviving extra into it, if any.
      const [promoted, ...rest] = survivingExtras;
      const stillClaimed = !!promoted;
      return { ...team, status: stillClaimed ? team.status : 'IDLE' as const, activePoolId: promoted || null, extraPoolIds: rest };
    }
    return { ...team, extraPoolIds: survivingExtras };
  });

  const seenCodes = new Set<string>();
  const dedupedTeams = releasedTeams.map((team) => {
    if (!team.code) return team;
    if (seenCodes.has(team.code)) {
      strippedCodeCount += 1;
      const { code, ...rest } = team;
      return rest as Team;
    }
    seenCodes.add(team.code);
    return team;
  });

  return { teams: dedupedTeams, releasedCount, strippedCodeCount };
}

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

// ── Mosaic + Grouting merge (one-time upgrade) ─────────────────────────────
// Reads pools + teams straight from Firestore (not from the app's in-memory
// copy, which may be a stale device cache) so the upgrade always starts from
// the real current data.
export async function dbFetchRawPoolsAndTeams(): Promise<{ pools: any[]; teams: any[] }> {
  const [pools, teams] = await Promise.all([collectionGetAll('pools'), collectionGetAll('teams')]);
  return { pools, teams };
}

// Saves the converted pools/teams. Each is written as a complete document
// (set, not merge) so the removed legacy `mosaic` entries really disappear.
// Also tries to keep a copy of the ORIGINAL pool records inside Firestore
// (system_state/stageMergeBackup_*). That copy is best-effort: the
// downloadable backup file the upgrade screen creates is the main safety net.
export async function dbApplyStageMerge(
  changedPools: any[],
  changedTeams: any[],
  originalPools: any[]
): Promise<{ firestoreBackup: boolean }> {
  let firestoreBackup = false;
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const originals = new Map(originalPools.map(p => [p.id, p]));
    const toBackup = changedPools.map(p => originals.get(p.id)).filter(Boolean);
    const CHUNK = 40;
    for (let i = 0; i < toBackup.length; i += CHUNK) {
      await setDoc(
        doc(clientDb, 'system_state', `stageMergeBackup_${stamp}_${String(i / CHUNK + 1).padStart(2, '0')}`),
        { data: removeUndefined(toBackup.slice(i, i + CHUNK)), createdAt: new Date().toISOString(), note: 'Pools exactly as they were BEFORE the Mosaic + Grouting merge' }
      );
    }
    firestoreBackup = true;
  } catch (e) {
    console.warn('[stage merge] Firestore-side backup skipped:', e);
  }

  const ops: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];
  changedPools.forEach(p => ops.push(b => b.set(doc(clientDb, 'pools', String(p.id)), removeUndefined(p))));
  changedTeams.forEach(t => ops.push(b => b.set(doc(clientDb, 'teams', String(t.id)), removeUndefined(t))));
  if (ops.length > 0) await commitInChunks(ops);
  return { firestoreBackup };
}

// 6. Fine-grained operations: Audit Activity logs
export async function dbSaveLog(log: ActivityLog) {
  // Permanent archive write — never trimmed, never overwritten. Fire-and-forget
  // so a slow/failed archive write never blocks or breaks the actual QC action.
  dbArchiveActivityLogs([log]);

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

// 6b. Fine-grained operations: Planning Inventory Registry deletion audit trail
// Written once per confirmed bulk-delete action (password re-verified at the
// point of deletion), never edited or removed by the app afterward.
export async function dbSaveInventoryDeletionLog(entry: InventoryDeletionLog) {
  const base = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/$/, '');
  if (!base) {
    await updateFirestoreDocArray('inventoryDeletionLogs', (arr) => {
      arr.push(entry);
      return arr.slice(-500);
    }, true);
    return { success: true, entry };
  }

  try {
    const headers = await getHeaders();
    const response = await fetch(getApiUrl('/api/inventory-deletion-logs'), {
      method: 'POST',
      headers,
      body: JSON.stringify(entry),
    });
    if (!response.ok) throw new Error('Failed to save inventory deletion audit log.');
    return await response.json();
  } catch (error) {
    console.error('dbSaveInventoryDeletionLog failed:', error);
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
export async function dbSaveQcDefect(defect: any) {
  await updateFirestoreDocArray('qcDefects', (arr) => {
    const idx = arr.findIndex(item => item.id === defect.id);
    if (idx !== -1) arr[idx] = defect;
    else arr.push(defect);
    return arr;
  });
  return { success: true, defect };
}

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

// 9b. Bulk planned-pool deletion (Inventory Registry "Delete Selected").
// IMPORTANT: this does the plannedPools removal AND the recycleBin insert
// in a single Firestore transaction, not N separate calls. Calling
// dbDeletePlannedPool / dbAddRecycleBin once per item in a Promise.all
// creates N concurrent transactions all fighting over the same two
// documents ('plannedPools', 'recycleBin') — Firestore then has to retry
// the losing transactions over and over, which is what caused bulk deletes
// of 40+ items to hang for minutes. One transaction touching both docs
// avoids that entirely.
export async function dbBulkDeletePlannedPools(ids: string[], trashItems: RecycleBinItem[]) {
  const base = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/$/, '');
  const idSet = new Set(ids);

  if (!base) {
    await updateFirestoreDocArrays({
      plannedPools: (arr) => arr.filter(item => !idSet.has(item.id)),
      recycleBin: (arr) => [...arr, ...trashItems],
    }, { plannedPools: true, recycleBin: true });
    return { success: true, deletedCount: ids.length };
  }

  try {
    const headers = await getHeaders();
    const response = await fetch(getApiUrl('/api/planned-pools/bulk-delete'), {
      method: 'POST',
      headers,
      body: JSON.stringify({ ids, trashItems }),
    });
    if (!response.ok) throw new Error('Failed to bulk delete Planned Pools.');
    return await response.json();
  } catch (error) {
    console.error('dbBulkDeletePlannedPools failed:', error);
    throw error;
  }
}

// Releases MANY pre-planned pool designs onto the shop floor in one go (e.g.
// a Production Engineer ticking 23 pools from a project and publishing them
// with a single click). Both affected collections are written in ONE call to
// updateFirestoreDocArrays so this can't fall into the classic stale-closure
// bug of calling the single-release path in a for-loop: `pools` is
// collection-backed (each new pool becomes its own doc, safe to add all at
// once) and `plannedPools` is updated as one array read-modify-write inside
// the same transaction, so N releases cost the same one round-trip a single
// release would, instead of N separate races over the same plannedPools doc.
export async function dbBulkReleasePlannedPools(releases: { planId: string; newPool: Pool }[]) {
  const base = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/$/, '');
  const releasedPoolIdByPlanId = new Map(releases.map(r => [r.planId, r.newPool.id]));
  const newPools = releases.map(r => r.newPool);

  if (!base) {
    await updateFirestoreDocArrays({
      pools: (arr) => [...arr, ...newPools],
      plannedPools: (arr) => arr.map(item =>
        releasedPoolIdByPlanId.has(item.id)
          ? { ...item, status: 'RELEASED', releasedPoolId: releasedPoolIdByPlanId.get(item.id) }
          : item
      ),
    }, { pools: true, plannedPools: true });
    return { success: true, releasedCount: releases.length };
  }

  try {
    const headers = await getHeaders();
    const response = await fetch(getApiUrl('/api/planned-pools/bulk-release'), {
      method: 'POST',
      headers,
      body: JSON.stringify({ releases }),
    });
    if (!response.ok) throw new Error('Failed to bulk release Planned Pools.');
    return await response.json();
  } catch (error) {
    console.error('dbBulkReleasePlannedPools failed:', error);
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
      // BUG FIX: this previously read matched.originalTable / matched.serializedData,
      // fields that don't exist on RecycleBinItem (the real fields are dataType /
      // payload). That meant NOTHING was ever restored — the item was just silently
      // removed from the Recycle Bin list, permanently losing the data.
      const payload = matched.payload;
      if (matched.dataType === 'pool') {
        // A scrapped production pool goes back into the Planning queue (not
        // straight back into active production) so it can be re-dispatched
        // through Planning like any other planned pool.
        const restoredPlanned: PlannedPool = {
          id: `plan_${payload.id || Date.now()}_restored`,
          projectName: payload.projectName,
          poolNo: payload.poolNo,
          orientation: payload.orientation,
          dimensions: payload.dimensions,
          shape: payload.shape,
          poolType: payload.poolType,
          drawingUrl: payload.drawingUrl,
          status: 'PLANNED',
          releasedPoolId: null,
          notes: payload.notes,
          createdAt: new Date().toISOString(),
        };
        await dbSavePlannedPool(restoredPlanned);
      } else if (matched.dataType === 'planned_pool') {
        await dbSavePlannedPool(payload);
      } else if (matched.dataType === 'trolley') {
        await dbSaveTrolley(payload);
      }
      await setFirestoreDocArray('recycleBin', list.filter(item => item.id !== id));
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
async function notifyManagerOfMaterialRequestBatch(items: MaterialRequest[]): Promise<boolean> {
  if (items.length === 0) return false;
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
  // emailSent is true only when Resend really accepted the message. The
  // function answers 200 + {skipped:true} when RESEND_API_KEY / the manager
  // address isn't configured, which must NOT count as sent.
  let emailSent = false;
  try {
    const res = await fetch('/.netlify/functions/send-material-request-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('[notifyManagerOfMaterialRequestBatch] Email function returned an error — Resend never received/logged this send:', res.status, detail);
    } else {
      const json = await res.json().catch(() => null);
      emailSent = !!json?.success;
    }
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
  return emailSent;
}

// Re-sends the manager's approval email for the lines of a request that are
// still PENDING (used by the Store portal's "Resend to manager" button).
export async function dbResendMaterialRequestEmail(ids: string[]): Promise<boolean> {
  const all = await dbFetchMaterialRequests();
  const pending = all.filter((r) => ids.includes(r.id) && r.status === 'PENDING');
  return notifyManagerOfMaterialRequestBatch(pending);
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

// --- QC Inspection Checklist Templates ---
// One template per stage (editable by QC, not hardcoded in the UI). This is
// a small, low-churn set (roughly one doc per StageId) so it follows the
// same array-document pattern as Materials rather than needing a
// collection-backed or week-bucketed strategy.
export async function dbFetchChecklistTemplates(): Promise<ChecklistTemplate[]> {
  if (!apiBase()) return getFirestoreDocArray('checklistTemplates');
  const res = await fetch(getApiUrl('/api/checklist-templates'));
  return res.ok ? res.json() : [];
}

export async function dbSaveChecklistTemplate(template: ChecklistTemplate) {
  if (!apiBase()) {
    await updateFirestoreDocArray('checklistTemplates', (arr) => {
      const idx = arr.findIndex((t) => t.id === template.id);
      if (idx !== -1) arr[idx] = template; else arr.push(template);
      return arr;
    });
    return { success: true, template };
  }
  const headers = await getHeaders();
  const res = await fetch(getApiUrl('/api/checklist-templates'), { method: 'POST', headers, body: JSON.stringify(template) });
  return res.json();
}

export async function dbDeleteChecklistTemplate(id: string) {
  if (!apiBase()) {
    await updateFirestoreDocArray('checklistTemplates', (arr) => arr.filter((t) => t.id !== id), true);
    return { success: true };
  }
  const headers = await getHeaders();
  const res = await fetch(getApiUrl(`/api/checklist-templates/${id}`), { method: 'DELETE', headers });
  return res.json();
}

// --- Company Assets ---
// A separate register from Materials: no stock/consumption, just what it
// is, its tag number, who has it, and its value.
export async function dbFetchCompanyAssets(): Promise<CompanyAsset[]> {
  if (!apiBase()) return getFirestoreDocArray('companyAssets');
  const res = await fetch(getApiUrl('/api/company-assets'));
  return res.ok ? res.json() : [];
}

export async function dbSaveCompanyAsset(asset: CompanyAsset) {
  if (!apiBase()) {
    await updateFirestoreDocArray('companyAssets', (arr) => {
      const idx = arr.findIndex((a) => a.id === asset.id);
      if (idx !== -1) arr[idx] = asset; else arr.push(asset);
      return arr;
    });
    return { success: true, asset };
  }
  const headers = await getHeaders();
  const res = await fetch(getApiUrl('/api/company-assets'), { method: 'POST', headers, body: JSON.stringify(asset) });
  return res.json();
}

export async function dbDeleteCompanyAsset(id: string) {
  if (!apiBase()) {
    await updateFirestoreDocArray('companyAssets', (arr) => arr.filter((a) => a.id !== id), true);
    return { success: true };
  }
  const headers = await getHeaders();
  const res = await fetch(getApiUrl(`/api/company-assets/${id}`), { method: 'DELETE', headers });
  return res.json();
}

// ---------------------------------------------------------------------------
// BACKUP / RESTORE of the Store, production, QC and HR lists (see
// src/lib/backupSets.ts for the list and the safety rules).
// ---------------------------------------------------------------------------

// Reads the current contents of the backup lists. STRICT: if any read fails the
// whole call fails, so a backup file can never silently contain an empty list
// that really just failed to load.
export async function dbExportBackupDocs(names: string[] = BACKUP_DOC_IDS): Promise<Record<string, any[]>> {
  const out: Record<string, any[]> = {};
  await Promise.all(names.map(async (name) => {
    try {
      out[name] = await getFirestoreDocArrayStrict(name);
    } catch (err: any) {
      throw new Error(`Could not read "${name}" (${err?.message || err}). Nothing was backed up.`);
    }
  }));
  return out;
}

// Restores the chosen lists from a backup. Safety rules are in runRestore.
export async function dbRestoreBackupDocs(args: {
  docs: Record<string, any[]>;
  names: string[];
  mode: RestoreMode;
  label: string;
}): Promise<RestoreReportRow[]> {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return runRestore({
    ...args,
    io: {
      readCurrent: (id) => getFirestoreDocArrayStrict(id),
      saveSafetyCopy: async (id, current, meta) => {
        const baseName = `preRestore_${stamp}__${id}`;
        const header = { savedAt: new Date().toISOString(), restoredFrom: meta.restoredFrom, mode: meta.mode, source: id };
        const pieces = chunkByBytes(removeUndefined(current), 700000);
        if (pieces.length <= 1) {
          // Small list: one document, exactly as before.
          await setDoc(doc(clientDb, 'system_state', baseName), { data: pieces[0] || [], ...header });
          return;
        }
        // Big list (lists can now be larger than one 1 MiB document): save it in
        // numbered pieces, then the header LAST, so a header only ever exists
        // for a complete copy. To recover, join <name>__p0, __p1, ... in order.
        await Promise.all(pieces.map((piece, i) =>
          setDoc(doc(clientDb, 'system_state', `${baseName}__p${i}`), { data: piece, part: i, parts: pieces.length, ...header })));
        await setDoc(doc(clientDb, 'system_state', baseName), { data: [], parts: pieces.length, note: `Full copy is in ${baseName}__p0 ... __p${pieces.length - 1}`, ...header });
      },
      apply: (id, update, allowEmpty) => updateFirestoreDocArray(id, update, allowEmpty),
    },
  });
}

// Patch only the given fields of one material. Unlike dbSaveMaterial (which
// replaces the whole record with whatever the screen had loaded), this never
// writes back a stale currentStock — important for reorder/follow settings,
// because supervisors' approvals can change stock while a modal is open.
export async function dbUpdateMaterialFields(id: string, patch: Partial<Material>) {
  if (!apiBase()) {
    const updated = await updateFirestoreDocArray('materials', (arr) =>
      arr.map((m) => (m.id === id ? { ...m, ...patch } : m))
    );
    return { success: true, materials: updated };
  }
  const current = (await dbFetchMaterials()).find((m) => m.id === id);
  if (!current) return { success: false };
  return dbSaveMaterial({ ...current, ...patch });
}

export async function dbAdjustMaterialStock(id: string, delta: number, byName?: string, note?: string) {
  if (!apiBase()) {
    // Logged as its own record so the Stock Ledger can show it as a movement.
    const results = await updateFirestoreDocArrays({
      materials: (arr) => arr.map((m) => {
        if (m.id !== id) return m;
        const cur = Number(m.currentStock || 0);
        if (cur + delta < -1e-9) {
          throw new NotInStockError(`Stock can't go below 0: ${m.name} has ${fmtQty(cur)} ${m.unit} in store, so it can't be reduced by ${fmtQty(-delta)}.`,
            [{ materialId: m.id, name: m.name, unit: m.unit, available: Math.max(0, cur), needed: -delta }]);
        }
        return { ...m, currentStock: cur + delta };
      }),
      stockAdjustments: (arr) => {
        if (delta !== 0) arr.push({ id: newId('adj'), materialId: id, delta, byName: byName || null, note: note || null, at: new Date().toISOString() });
        return arr;
      },
    }, { stockAdjustments: true });
    return { success: true, materials: results.materials };
  }
  const headers = await getHeaders();
  const res = await fetch(getApiUrl(`/api/materials/${id}/adjust-stock`), { method: 'POST', headers, body: JSON.stringify({ delta }) });
  return res.json();
}

// Removes ONE wrong "Adjust" row from a material's Stock Ledger.
//   reverseStock = true  (default): also takes that adjustment back out of the material's
//                        current stock, so stock ends up exactly as if the mistake was never made.
//   reverseStock = false: removes the ledger record only; current stock is left as it is.
// Only manual adjustments can be removed this way — receipts (IN) and delivery orders (OUT)
// are real documents and are never deleted from the ledger.
// Every deletion is kept in 'stockAdjustmentDeletions' (who, when, what) as an audit trail.
export async function dbDeleteStockAdjustment(adjustmentId: string, byName?: string, reverseStock = true): Promise<{ success: boolean; error?: string }> {
  if (apiBase()) return { success: false, error: 'Deleting ledger entries is not available on this server.' };
  try {
    const adjustments: any[] = await getFirestoreDocArray('stockAdjustments');
    const adj = adjustments.find((a) => a.id === adjustmentId);
    if (!adj) return { success: true }; // someone else already removed it
    const delta = Number(adj.delta) || 0;
    const materialsNow: any[] = await getFirestoreDocArray('materials');
    const mat = materialsNow.find((m) => m.id === adj.materialId);

    const updates: Record<string, (arr: any[]) => any[]> = {
      stockAdjustments: (arr) => arr.filter((a) => a.id !== adjustmentId),
    };
    if (reverseStock && mat && delta !== 0) {
      updates.materials = (arr) => arr.map((m) => {
        if (m.id !== adj.materialId) return m;
        const cur = Number(m.currentStock || 0);
        if (cur - delta < -1e-9) {
          throw new NotInStockError(
            `Can't undo this adjustment: ${m.name} has ${fmtQty(cur)} ${m.unit} now, and taking back ${delta > 0 ? '+' : '−'}${fmtQty(Math.abs(delta))} would leave it below 0. Delete the newer wrong entries first, or untick "Also undo it in the stock quantity" to remove the record only.`,
            [{ materialId: m.id, name: m.name, unit: m.unit, available: Math.max(0, cur), needed: delta }],
          );
        }
        return { ...m, currentStock: cur - delta };
      });
    }
    await updateFirestoreDocArrays(updates, { stockAdjustments: true });

    try {
      await updateFirestoreDocArray('stockAdjustmentDeletions', (arr) => {
        arr.push({
          id: newId('adjdel'), deletedAt: new Date().toISOString(), deletedByName: byName || null,
          adjustmentId, materialId: adj.materialId, materialName: mat?.name || null, unit: mat?.unit || null,
          delta, originalAt: adj.at, originalByName: adj.byName || null, originalNote: adj.note || null,
          stockReversed: !!(reverseStock && mat && delta !== 0),
        });
        return arr.slice(-500);
      }, true);
    } catch (e) {
      console.warn('[dbDeleteStockAdjustment] audit entry not saved', e);
    }
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e?.message || 'Could not delete this ledger entry.' };
  }
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

// --- Material Requests ---
export async function dbFetchMaterialRequests(): Promise<MaterialRequest[]> {
  if (!apiBase()) return getFirestoreDocArray('materialRequests');
  const res = await fetch(getApiUrl('/api/material-requests'));
  return res.ok ? res.json() : [];
}

// Real-time listener used by the Shop Floor kiosk auto-print agent. The
// kiosk tablet sits physically next to the store printer, so it's the
// device that should react the instant a manager approves a request from
// anywhere else (phone, laptop, different WiFi) — Firestore is the only
// thing connecting the two.
export function subscribeToMaterialRequests(
  callback: (items: MaterialRequest[]) => void
): Unsubscribe {
  // Listens to the old single document and every shard, and hands the app the
  // merged list whenever any of them changes (same trick as subscribeToLiveState).
  const names = ['materialRequests', ...shardDocNamesFor('materialRequests')];
  const cache: any[][] = names.map(() => []);
  const seen: boolean[] = names.map(() => false);
  let anyExists = false;
  const unsubs = names.map((nm, i) =>
    onSnapshot(
      doc(clientDb, 'system_state', nm),
      snap => {
        if (snap.exists()) anyExists = true;
        const raw = snap.exists() ? snap.data() : null;
        cache[i] = Array.isArray(raw?.data) ? raw.data : [];
        seen[i] = true;
        // Wait until every document has reported once so we never fire a
        // partial list; stay silent if nothing exists yet (see the BUGFIX
        // note in subscribeToLiveState about empty-array callbacks).
        if (seen.every(Boolean) && anyExists) callback(mergeLegacy(cache[0], cache.slice(1).flat()) as MaterialRequest[]);
      },
      err => console.warn('[subscribeToMaterialRequests] subscription error:', err)
    )
  );
  return () => unsubs.forEach((u) => u());
}

// Section Supervisor submits their whole cart (1 to however-many material
// lines) in one go. Every line shares one batchId + one approvalToken, so
// the manager's email/WhatsApp has ONE Approve/Reject action for the whole
// batch, and Store prints ONE issue slip for it — instead of one
// email/slip per material line.
export async function dbSubmitMaterialRequestBatch(
  lines: Array<Omit<MaterialRequest, 'id' | 'status' | 'approvalToken' | 'createdAt' | 'batchId'>>
): Promise<{ success: boolean; items: MaterialRequest[]; emailSent?: boolean }> {
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
    const emailSent = await notifyManagerOfMaterialRequestBatch(items);
    return { success: true, items, emailSent };
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

    if (action === 'approve') {
      // Approval ONLY changes the request status now. Store stock and Floor
      // Stock move later, when the Store Manager confirms the actual delivered
      // quantity (dbConfirmMaterialDeliveryBatch). awaitingDelivery marks
      // "stock has not been deducted yet" so that step knows to deduct.
      await updateFirestoreDocArray('materialRequests', (arr) => arr.map((r) => {
        if (!ids.includes(r.id) || r.status !== 'PENDING') return r;
        const decided: MaterialRequest = {
          ...r,
          status: 'APPROVED',
          awaitingDelivery: true,
          decidedByName,
          decisionNotes: decisionNotes || null,
          decidedAt: new Date().toISOString(),
        };
        decidedItems.push(decided);
        return decided;
      }));
      return { success: true, items: decidedItems };
    }

    // Reject: only the request status changes — nothing to keep atomic with.
    await updateFirestoreDocArray('materialRequests', (arr) =>
      arr.map((r) => {
        if (!ids.includes(r.id) || r.status !== 'PENDING') return r;
        const decided: MaterialRequest = {
          ...r,
          status: 'REJECTED',
          decidedByName,
          decisionNotes: decisionNotes || null,
          decidedAt: new Date().toISOString(),
        };
        decidedItems.push(decided);
        return decided;
      })
    );
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
        // Only approved/printed lines can be (re)printed — never touch a line
        // that is already DELIVERED, rejected or still pending.
        if (!ids.includes(r.id) || (r.status !== 'APPROVED' && r.status !== 'PRINTED')) return r;
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

// Raised whenever an action would take stock below zero. Stock never goes
// negative: the whole action is refused and NOTHING is saved.
export interface StockShortage { materialId: string; name: string; unit: string; available: number; needed: number; }
const fmtQty = (n: number) => String(Math.round(n * 1000) / 1000);
export function shortageText(sh: StockShortage): string {
  return sh.available <= 0
    ? `${sh.name}: Not in stock.`
    : `${sh.name}: Not in stock — only ${fmtQty(sh.available)} ${sh.unit} available, ${fmtQty(sh.needed)} ${sh.unit} needed.`;
}
export class NotInStockError extends Error {
  shortages: StockShortage[];
  constructor(message: string, shortages: StockShortage[] = []) { super(message); this.name = 'NotInStockError'; this.shortages = shortages; }
}

export class DeliveryConfirmationError extends Error {
  constructor(message: string) { super(message); this.name = 'DeliveryConfirmationError'; }
}

// Store Manager confirms what was ACTUALLY handed over for approved lines.
// One atomic transaction does everything:
//   - request line  -> status DELIVERED, qtyDelivered, deliveredAt/By
//   - Store stock   -> currentStock goes DOWN by qtyDelivered
//   - Consumption   -> one consumption log per line, so it shows up in
//                      Consumption immediately (no Floor Stock step)
// Rules:
//   - only lines still APPROVED or PRINTED can be confirmed (blocks double
//     confirmation, so stock can never be deducted twice)
//   - qtyDelivered must be 0..approved qty (0 = nothing delivered)
//   - lines approved under the OLD flow (no awaitingDelivery flag) already had
//     stock deducted at approval (and were already on Floor Stock), so they are
//     only marked DELIVERED — no second deduction, no consumption row.
export async function dbConfirmMaterialDeliveryBatch(
  lines: Array<{ id: string; qtyDelivered: number }>,
  deliveredByName: string,
  deliveryNotes?: string,
): Promise<{ success: boolean; items: MaterialRequest[]; doNumber: string }> {
  if (lines.length === 0) return { success: true, items: [], doNumber: '' };
  if (apiBase()) throw new DeliveryConfirmationError('Delivery confirmation is only available on the Firebase deployment.');

  const qtyById = new Map(lines.map((l) => [l.id, Number(l.qtyDelivered)]));
  const now = new Date().toISOString();
  const confirmed: MaterialRequest[] = [];
  let failure: DeliveryConfirmationError | null = null;
  let doNumber = '';

  await updateFirestoreDocArrays({
    materialRequests: (arr) => {
      // A transaction can be retried — start from a clean slate every attempt
      // so lines are never counted twice.
      confirmed.length = 0;
      failure = null;
      doNumber = '';
      // Validate EVERY line first; write nothing unless all lines pass, so the
      // request rows and the stock rows can never disagree.
      for (const r of arr) {
        if (!qtyById.has(r.id)) continue;
        const qty = qtyById.get(r.id)!;
        const approved = Number(r.qtyApproved ?? r.qtyRequested);
        if (r.status !== 'APPROVED' && r.status !== 'PRINTED') {
          failure = new DeliveryConfirmationError(`${r.materialName} was already delivered or is not approved.`);
        } else if (!Number.isFinite(qty) || qty < 0 || qty > approved) {
          failure = new DeliveryConfirmationError(`${r.materialName}: delivered qty must be between 0 and ${approved} ${r.unit}.`);
        }
        if (failure) return arr;
      }
      // Next Delivery Order number: DO-<year>-<0001...>. Computed from the
      // numbers already on file INSIDE this transaction, so two store keepers
      // confirming at the same time can never be given the same DO.
      const prefix = `DO-${new Date(now).getFullYear()}-`;
      let maxSeq = 0;
      for (const r of arr) {
        const dn = typeof r.doNumber === 'string' ? r.doNumber : '';
        if (!dn.startsWith(prefix)) continue;
        const n = parseInt(dn.slice(prefix.length), 10);
        if (Number.isFinite(n) && n > maxSeq) maxSeq = n;
      }
      doNumber = `${prefix}${String(maxSeq + 1).padStart(4, '0')}`;
      return arr.map((r) => {
        if (!qtyById.has(r.id)) return r;
        const done: MaterialRequest = {
          ...r, status: 'DELIVERED', qtyDelivered: qtyById.get(r.id)!, doNumber,
          deliveredAt: now, deliveredByName, deliveryNotes: deliveryNotes || null,
        };
        confirmed.push(done);
        return done;
      });
    },
    materials: (arr) => {
      if (failure) return arr;
      const deltas: Record<string, number> = {};
      for (const d of confirmed) if (d.awaitingDelivery && Number(d.qtyDelivered) > 0) deltas[d.materialId] = (deltas[d.materialId] || 0) + Number(d.qtyDelivered);
      // Stock must cover EVERYTHING being handed over. Checked here, inside the
      // transaction, so two keepers can't both take the last items. Throwing
      // aborts the whole transaction: no DO, no request update, no consumption.
      const shortages: StockShortage[] = [];
      for (const [materialId, needed] of Object.entries(deltas)) {
        const m = arr.find((x) => x.id === materialId);
        const available = m ? Number(m.currentStock || 0) : 0;
        if (available - needed < -1e-9) {
          const line = confirmed.find((c) => c.materialId === materialId);
          shortages.push({ materialId, name: m?.name || line?.materialName || 'Material', unit: m?.unit || line?.unit || '', available: Math.max(0, available), needed });
        }
      }
      if (shortages.length > 0) throw new NotInStockError(shortages.map(shortageText).join('\n'), shortages);
      return arr.map((m) => (deltas[m.id] ? { ...m, currentStock: Number(m.currentStock || 0) - deltas[m.id] } : m));
    },
    // Delivered material is consumption from this moment — there is no
    // separate "on the floor" balance any more. One log row per delivered line,
    // dated today and attributed to the receiving section.
    consumptionLogs: (arr) => {
      if (failure) return arr;
      const day = now.slice(0, 10);
      for (const d of confirmed) {
        const qty = Number(d.qtyDelivered);
        if (!d.awaitingDelivery || qty <= 0) continue;
        const sectionId = (d.stageId as string) || 'unassigned';
        const sectionName = SUPERVISOR_SECTIONS.find((x) => x.id === sectionId)?.name
          || SECTION_DEFINITIONS.find((x) => x.id === sectionId)?.name || sectionId;
        arr.push({
          id: newId('cons'),
          date: day,
          sectionId,
          sectionName,
          materialId: d.materialId,
          materialName: d.materialName,
          unit: d.unit,
          qty,
          notes: deliveryNotes ? `Delivered by Store — ${deliveryNotes}` : 'Delivered by Store',
          loggedByName: deliveredByName,
          createdAt: now,
          requestId: d.id,
          doNumber,
          source: 'delivery',
        } as ConsumptionLog);
      }
      return arr;
    },
  }, { consumptionLogs: true });

  if (failure) throw failure;
  return { success: true, items: confirmed, doNumber };
}

export async function dbSaveEmployeePunch(punch: EmployeePunch) {
  const base = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/$/, '');
  if (!base) {
    // Week-bucketed: only reads/writes the ONE bucket document covering this
    // punch's date (e.g. "employeePunches__2026-W34") — 1 billed write, and
    // it never touches any other week's data.
    const bucketName = weekBucketDocName('employeePunches', punch.date);
    const bucketRef = doc(clientDb, 'system_state', bucketName);
    await runTransaction(clientDb, async (transaction) => {
      const snap = await transaction.get(bucketRef);
      const current: any[] = snap.exists() && Array.isArray(snap.data()?.data) ? snap.data()!.data : [];
      const idx = current.findIndex(item => item.id === punch.id);
      if (idx !== -1) current[idx] = punch; else current.push(punch);
      transaction.set(bucketRef, { data: removeUndefined(current) });
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

// `date` (the punch's own date field, "YYYY-MM-DD") is required so we know
// which week bucket to look in — without it we'd have to scan every bucket
// ever created to find one punch, which defeats the entire point of
// bucketing. Callers already have the punch object in local state before
// deleting (see handleDeleteEmployeePunch in App.tsx), so this is free.
export async function dbDeleteEmployeePunch(id: string, date: string) {
  const base = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/$/, '');
  if (!base) {
    const bucketName = weekBucketDocName('employeePunches', date);
    const bucketRef = doc(clientDb, 'system_state', bucketName);
    await runTransaction(clientDb, async (transaction) => {
      const snap = await transaction.get(bucketRef);
      const current: any[] = snap.exists() && Array.isArray(snap.data()?.data) ? snap.data()!.data : [];
      const filtered = current.filter(item => item.id !== id);
      if (filtered.length !== current.length) {
        transaction.set(bucketRef, { data: removeUndefined(filtered) });
      }
    });
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
    // THIS is the fix for the write-quota spike: group the incoming punches
    // by which week bucket they belong to, then do ONE read+write PER WEEK
    // TOUCHED — not one write per punch. A kiosk uploading a 500-punch
    // backlog that all falls within the current week now costs exactly 1
    // write, matching the old (safe-on-quota) design, while still keeping
    // documents small and race conditions scoped to a single week at worst.
    const byWeek = new Map<string, EmployeePunch[]>();
    for (const p of punches) {
      const wk = isoWeekKey(p.date);
      if (!byWeek.has(wk)) byWeek.set(wk, []);
      byWeek.get(wk)!.push(p);
    }

    const weekKeys = Array.from(byWeek.keys());
    await Promise.all(weekKeys.map(async (wk) => {
      const bucketRef = doc(clientDb, 'system_state', `employeePunches__${wk}`);
      const incoming = byWeek.get(wk)!;
      await runTransaction(clientDb, async (transaction) => {
        const snap = await transaction.get(bucketRef);
        const current: any[] = snap.exists() && Array.isArray(snap.data()?.data) ? snap.data()!.data : [];
        const currentById = new Map(current.map(item => [item.id, item]));
        incoming.forEach(p => currentById.set(p.id, p));
        transaction.set(bucketRef, { data: removeUndefined(Array.from(currentById.values())) });
      });
    }));

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
    // Enumerate every bucket document that exists (system_state holds one
    // document per collection-name/bucket-name, so we list it and filter to
    // just the employeePunches__* buckets) and delete each. This is a rare,
    // deliberate admin action — an occasional full-collection read here is
    // fine, unlike doing it on every single punch write.
    const snap = await getDocs(collection(clientDb, 'system_state'));
    const bucketRefs = snap.docs.filter(d => d.id.startsWith('employeePunches__')).map(d => d.ref);
    if (bucketRefs.length > 0) {
      const ops = bucketRefs.map(ref => (batch: ReturnType<typeof writeBatch>) => batch.delete(ref));
      await commitInChunks(ops);
    }
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
    // CRITICAL FIX (kept from the earlier fix): this used to filter on
    // `p.punchTime`, a field that doesn't exist on EmployeePunch records
    // (they have `date` and `timestamp`), so it silently deleted nothing.
    // Now it correctly targets the one week bucket containing `date` and
    // removes just that day's entries from it — one read, one write.
    const bucketName = weekBucketDocName('employeePunches', date);
    const bucketRef = doc(clientDb, 'system_state', bucketName);
    let deletedCount = 0;
    await runTransaction(clientDb, async (transaction) => {
      const snap = await transaction.get(bucketRef);
      const current: any[] = snap.exists() && Array.isArray(snap.data()?.data) ? snap.data()!.data : [];
      const filtered = current.filter(p => p.date !== date);
      deletedCount = current.length - filtered.length;
      if (deletedCount > 0) {
        transaction.set(bucketRef, { data: removeUndefined(filtered) });
      }
    });
    return { success: true, deleted: deletedCount };
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

import type { IncomingMaterial, GrnAttachment, ConsumptionLog, ProductionLog } from '../types';

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

// Logs material at the gate as a QC-pending receipt. Stock is intentionally
// NOT touched here — it only moves into Material.currentStock once an
// inspector passes it via dbDecideIncomingQc below.
export async function dbCreateIncomingMaterial(payload: Omit<IncomingMaterial, 'id' | 'createdAt' | 'qcStatus'>) {
  const full: IncomingMaterial = { ...payload, id: newId('inc'), createdAt: new Date().toISOString(), qcStatus: 'pending' } as IncomingMaterial;
  if (!apiBase()) {
    const mat = (await getFirestoreDocArray('materials')).find((m) => m.id === payload.materialId);
    full.materialName = mat?.name || payload.materialName || '';
    full.unit = mat?.unit || payload.unit || '';
    await updateFirestoreDocArray('incomingMaterials', (arr) => { arr.push(full); return arr; });
    return { success: true, item: full };
  }
  const headers = await getHeaders();
  const res = await fetch(getApiUrl('/api/incoming-materials'), {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...payload, qcStatus: 'pending' }),
  });
  return res.json();
}

// Edit the paperwork on an existing goods receipt: supplier DO / invoice
// numbers and the scanned files. Attachments are merged INSIDE the update
// (add / remove by id against the latest stored record) so two people adding
// files to the same receipt at the same moment cannot overwrite each other.
// Never touches qty, QC state or stock.
export async function dbUpdateIncomingMaterialDocs(
  id: string,
  patch: {
    doNo?: string | null;
    invoiceNo?: string | null;
    addAttachments?: GrnAttachment[];
    removeAttachmentIds?: string[];
  },
) {
  if (apiBase()) {
    throw new Error('Editing receipt documents is only supported in direct-Firestore mode (VITE_API_URL is set).');
  }
  let result: IncomingMaterial | null = null;
  await updateFirestoreDocArray('incomingMaterials', (arr) =>
    arr.map((i) => {
      if (i.id !== id) return i;
      const drop = new Set(patch.removeAttachmentIds || []);
      const kept = (i.attachments || []).filter((a: GrnAttachment) => !drop.has(a.id));
      const next: IncomingMaterial = {
        ...i,
        ...(patch.doNo !== undefined ? { doNo: patch.doNo } : {}),
        ...(patch.invoiceNo !== undefined ? { invoiceNo: patch.invoiceNo } : {}),
        attachments: [...kept, ...(patch.addAttachments || [])],
      };
      result = next;
      return next;
    })
  );
  return { success: !!result, item: result as IncomingMaterial | null };
}

// Inspector decision on a pending GRN, for a specific quantity out of the
// total received — supports splitting one receipt across multiple outcomes
// (e.g. 300 received, pass 180 now, reject 120). Only the passed portion of
// *this* decision is added into Material.currentStock; failed/hold portions
// never touch stock. qty defaults to the entire remaining (undecided)
// portion, so callers that don't care about splitting can omit it and get
// the old all-or-nothing behavior.
//
// sourceBucket lets an inspector come back later and resolve material that
// was previously held: 'pending' (default) decides fresh, never-looked-at
// qty; 'hold' moves qty OUT of the hold pool into passed/failed (re-holding
// held qty is a no-op, so only 'passed'/'failed' make sense with 'hold').
export async function dbDecideIncomingQc(
  id: string,
  decision: 'passed' | 'failed' | 'hold',
  qcByName: string,
  qcNotes?: string | null,
  qty?: number,
  sourceBucket: 'pending' | 'hold' = 'pending'
) {
  if (!apiBase()) {
    let materialId: string | null = null;
    let passedQtyThisDecision = 0;
    let resultRecord: IncomingMaterial | null = null;
    await updateFirestoreDocArray('incomingMaterials', (arr) =>
      arr.map((i) => {
        if (i.id !== id) return i;
        const totalQty = Number(i.qty || 0);
        let passed = Number(i.qtyPassed || 0);
        let failed = Number(i.qtyFailed || 0);
        let hold = Number(i.qtyHold || 0);
        const qtyPending = Math.max(0, totalQty - passed - failed - hold);

        const availableInSource = sourceBucket === 'hold' ? hold : qtyPending;
        const decideQty = Math.max(0, Math.min(qty != null ? Number(qty) : availableInSource, availableInSource));

        materialId = i.materialId;
        if (decision === 'passed') passedQtyThisDecision = decideQty;

        if (sourceBucket === 'hold') hold -= decideQty; // resolving previously-held qty out of the hold pool
        if (decision === 'passed') passed += decideQty;
        else if (decision === 'failed') failed += decideQty;
        else if (decision === 'hold') hold += decideQty; // parking fresh pending qty for a re-check later

        const nextPending = Math.max(0, totalQty - passed - failed - hold);

        // Derive the overall bucket so existing pending/passed/failed/hold
        // filters elsewhere in the app keep working unmodified for the
        // common all-or-nothing cases, with 'partial'/'mixed' covering
        // everything genuinely split.
        let nextStatus: IncomingMaterial['qcStatus'];
        if (nextPending === totalQty) nextStatus = 'pending';
        else if (passed === totalQty) nextStatus = 'passed';
        else if (failed === totalQty) nextStatus = 'failed';
        else if (hold === totalQty) nextStatus = 'hold';
        else if (nextPending > 0 || hold > 0) nextStatus = 'partial';
        else nextStatus = 'mixed';

        const decisions = [...(i.qcDecisions || [])];
        if (decideQty > 0) {
          decisions.push({ qty: decideQty, decision, byName: qcByName, at: new Date().toISOString(), notes: qcNotes || null });
        }

        resultRecord = {
          ...i,
          qcStatus: nextStatus,
          qtyPassed: passed,
          qtyFailed: failed,
          qtyHold: hold,
          qcByName,
          qcAt: new Date().toISOString(),
          qcNotes: qcNotes || null,
          qcDecisions: decisions,
        };
        return resultRecord;
      })
    );
    if (passedQtyThisDecision > 0 && materialId) {
      await updateFirestoreDocArray('materials', (arr) =>
        arr.map((m) => (m.id === materialId ? { ...m, currentStock: (m.currentStock || 0) + passedQtyThisDecision } : m))
      );
    }
    return { success: true, item: resultRecord };
  }
  const headers = await getHeaders();
  const res = await fetch(getApiUrl(`/api/incoming-materials/${id}/qc-decide`), {
    method: 'POST',
    headers,
    body: JSON.stringify({ decision, qcByName, qcNotes, qty, sourceBucket }),
  });
  return res.json();
}

export async function dbDeleteIncomingMaterial(id: string) {
  if (!apiBase()) {
    // Deleting a receipt reverses the stock it added. Both changes happen in ONE
    // transaction (before, they were two separate saves), and if some of that
    // stock has already been used the delete is refused instead of going negative.
    const ctx = { materialId: null as string | null, qty: 0 };
    await updateFirestoreDocArrays({
      incomingMaterials: (arr) => {
        ctx.materialId = null; ctx.qty = 0;   // clean slate if the transaction is retried
        const rec = arr.find((i) => i.id === id);
        if (rec) {
          ctx.materialId = rec.materialId;
          // Only reverse the portion that actually reached inventory. Legacy
          // fully-passed records have no qtyPassed field, so fall back to the
          // full qty for those; partial/mixed records reverse just qtyPassed.
          ctx.qty = rec.qtyPassed != null ? Number(rec.qtyPassed) : (rec.qcStatus === 'passed' ? Number(rec.qty || 0) : 0);
        }
        return arr.filter((i) => i.id !== id);
      },
      materials: (arr) => {
        if (!ctx.materialId || ctx.qty <= 0) return arr;
        return arr.map((m) => {
          if (m.id !== ctx.materialId) return m;
          const cur = Number(m.currentStock || 0);
          if (cur - ctx.qty < -1e-9) {
            throw new NotInStockError(`Can't delete this receipt: ${fmtQty(ctx.qty)} ${m.unit} of ${m.name} came in on it, but only ${fmtQty(cur)} ${m.unit} is in store now (the rest was already used).`,
              [{ materialId: m.id, name: m.name, unit: m.unit, available: Math.max(0, cur), needed: ctx.qty }]);
          }
          return { ...m, currentStock: cur - ctx.qty };
        });
      },
    }, { incomingMaterials: true });
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

// Plain consumption entry. Floor Stock no longer exists: material becomes
// consumption when Store confirms delivery (dbConfirmMaterialDeliveryBatch).
export async function dbCreateConsumptionLog(payload: Omit<ConsumptionLog, 'id' | 'createdAt'>) {
  const full: ConsumptionLog = { ...payload, id: newId('cons'), createdAt: new Date().toISOString() } as ConsumptionLog;
  if (!apiBase()) {
    await updateFirestoreDocArray('consumptionLogs', (arr) => { arr.push(full); return arr; });
    return { success: true, item: full };
  }
  const headers = await getHeaders();
  const res = await fetch(getApiUrl('/api/consumption-logs'), {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to log consumption.');
  }
  return res.json();
}

// Deleting a consumption log. A log created by a delivery confirmation
// (it carries requestId) puts its qty back into Store stock, so the number
// can't vanish; a plain manual log just disappears.
export async function dbDeleteConsumptionLog(id: string) {
  if (!apiBase()) {
    let removed: ConsumptionLog | undefined;
    await updateFirestoreDocArray('consumptionLogs', (arr) => {
      removed = arr.find((c) => c.id === id);
      return arr.filter((c) => c.id !== id);
    }, true);
    const r = removed as ConsumptionLog | undefined;
    if (r && r.requestId) {
      await updateFirestoreDocArray('materials', (arr) =>
        arr.map((m) => (m.id === r.materialId ? { ...m, currentStock: Number(m.currentStock || 0) + Number(r.qty || 0) } : m))
      );
    }
    return { success: true };
  }
  const headers = await getHeaders();
  const res = await fetch(getApiUrl(`/api/consumption-logs/${id}`), { method: 'DELETE', headers });
  return res.json();
}

// Material returns are kept only as a read of historical records (reports);
// the Floor -> Store return flow went away with Floor Stock.
export async function dbFetchMaterialReturns(): Promise<MaterialReturn[]> {
  if (!apiBase()) return getFirestoreDocArray('materialReturns');
  return [];
}

export async function dbFetchStockAdjustments(): Promise<StockAdjustment[]> {
  if (!apiBase()) return getFirestoreDocArray('stockAdjustments');
  return [];
}

// ── Suppliers (Store → Suppliers) ───────────────────────────────────────────
export async function dbFetchSuppliers(): Promise<Supplier[]> {
  if (!apiBase()) return getFirestoreDocArray('suppliers');
  return [];
}

export class SupplierError extends Error {
  constructor(message: string) { super(message); this.name = 'SupplierError'; }
}

// Create or update a supplier. The code (SUP-0001…) is generated INSIDE the
// write, from the codes already on file, so two people adding suppliers at the
// same time can't collide. Names must be unique (ignoring case/spacing)
// because receipts and materials link to a supplier by name.
export async function dbSaveSupplier(input: Partial<Supplier> & { name: string }, byName: string): Promise<Supplier> {
  if (apiBase()) throw new SupplierError('Suppliers are only available on the Firebase deployment.');
  let saved: Supplier | undefined;
  let error: string | undefined;
  await updateFirestoreDocArray('suppliers', (arr) => {
    // May run more than once if the write is retried — always start clean.
    const result = applySupplierSave(arr, input, byName, () => newId('sup'), new Date().toISOString());
    saved = result.saved; error = result.error;
    return result.arr;
  }, true);
  if (error || !saved) throw new SupplierError(error || 'Could not save the supplier.');
  return saved;
}

export async function dbDeleteSupplier(id: string): Promise<void> {
  if (apiBase()) throw new SupplierError('Suppliers are only available on the Firebase deployment.');
  await updateFirestoreDocArray('suppliers', (arr) => arr.filter((s) => s.id !== id), true);
}

// Excel upload: create / update many suppliers in ONE write. Codes (SUP-0001…) are
// issued inside the write, in file order, so they stay unique and gap-free.
export async function dbBulkSaveSuppliers(
  items: BulkSupplierItem[], byName: string,
): Promise<{ created: number; updated: number; failed: { name: string; error: string }[] }> {
  if (apiBase()) throw new SupplierError('Suppliers are only available on the Firebase deployment.');
  let out = { created: 0, updated: 0, failed: [] as { name: string; error: string }[] };
  await updateFirestoreDocArray('suppliers', (arr) => {
    // May run more than once if the write is retried — always start clean.
    const r = applySupplierBulk(arr, items, byName, () => newId('sup'), new Date().toISOString());
    out = { created: r.created.length, updated: r.updated.length, failed: r.failed };
    return r.arr;
  }, true);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// PROCUREMENT — purchase orders, quotations (RFQs), STF purchase forms, trade finance, supplier invoices, payments.
// Finance records are never hard-deleted: they are VOIDED with a reason, so the
// audit trail stays complete. Numbers (MAT-PO-2026-0001…) are issued INSIDE the
// write, so two people saving at the same moment can never get the same number.
// ─────────────────────────────────────────────────────────────────────────────
export class ProcurementError extends Error {
  constructor(message: string) { super(message); this.name = 'ProcurementError'; }
}
const procurementOnly = () => {
  if (apiBase()) throw new ProcurementError('Procurement is only available on the Firebase deployment.');
};

export async function dbFetchPurchaseOrders(): Promise<PurchaseOrder[]> { return getFirestoreDocArray('purchaseOrders'); }
export async function dbFetchRfqs(): Promise<Rfq[]> { return getFirestoreDocArray('procurementRfqs'); }
export async function dbFetchSupplierInvoices(): Promise<SupplierInvoice[]> { return getFirestoreDocArray('supplierInvoices'); }
export async function dbFetchSupplierPayments(): Promise<SupplierPayment[]> { return getFirestoreDocArray('supplierPayments'); }

function checkPoLines(lines: PoLine[] | undefined): string | null {
  if (!lines || lines.length === 0) return 'Add at least one item to the PO.';
  for (const l of lines) {
    if (!l.materialId) return `"${l.itemName || 'An item'}" is not linked to a Store item.`;
    if (!(Number(l.qty) > 0)) return `Enter a quantity for ${l.itemName}.`;
    if (!(Number(l.unitPrice) >= 0) || l.unitPrice === (null as any)) return `Enter a price for ${l.itemName}.`;
  }
  return null;
}

const PO_EDITABLE = ['supplierId', 'supplierName', 'supplierCode', 'supplierTaxNo', 'currency', 'fxRate', 'orderDate', 'expectedDate',
  'deliveryLocation', 'paymentTerms', 'notes', 'discount', 'vatRate', 'lines', 'rfqId', 'rfqNo', 'quoteId', 'stfId', 'stfNo', 'projectType', 'projectName'] as const;

// Create (no id) or edit (id) a DRAFT purchase order.
export async function dbSavePurchaseOrder(input: Partial<PurchaseOrder> & { supplierName: string; lines: PoLine[] }, byName: string): Promise<PurchaseOrder> {
  procurementOnly();
  // Every new PO is issued from an APPROVED STF — no STF, no PO. One STF feeds one PO.
  if (!input.id && !input.stfId) throw new ProcurementError('A PO can only be issued from an approved STF. Create the STF and get it approved first.');
  if (!input.id && input.stfId) {
    const stf = ((await getFirestoreDocArray('procurementStfs')) as Stf[]).find((x) => x.id === input.stfId);
    if (!stf) throw new ProcurementError('The STF for this PO no longer exists.');
    if (stf.status !== 'approved') throw new ProcurementError(`${stf.stfNo} is not approved yet (it is ${stf.status}), so a PO can’t be issued from it.`);
    const pos0: PurchaseOrder[] = await getFirestoreDocArray('purchaseOrders');
    const dup = pos0.find((p) => p.stfId === stf.id && p.status !== 'cancelled');
    if (dup) throw new ProcurementError(`${stf.stfNo} already has ${dup.poNo}.`);
  }
  const settings = await dbFetchProcurementSettings();
  const customNo = (input as any).poNo?.trim?.() as string | undefined;
  let saved: PurchaseOrder | undefined;
  let error: string | undefined;
  await updateFirestoreDocArray('purchaseOrders', (arr) => {
    saved = undefined; error = undefined;   // may run again on a retried write
    if (!input.supplierName?.trim()) { error = 'Choose a supplier.'; return arr; }
    const bad = checkPoLines(input.lines);
    if (bad) { error = bad; return arr; }
    const now = new Date().toISOString();
    if (input.id) {
      const cur = arr.find((p: PurchaseOrder) => p.id === input.id);
      if (!cur) { error = 'This PO no longer exists.'; return arr; }
      if (cur.status !== 'draft') { error = 'Only a draft PO can be edited. Cancel it and raise a new one, or ask management to send it back.'; return arr; }
      const patch: any = {};
      for (const k of PO_EDITABLE) if ((input as any)[k] !== undefined) patch[k] = (input as any)[k];
      saved = { ...cur, ...patch, updatedAt: now };
      return arr.map((p: PurchaseOrder) => (p.id === input.id ? saved! : p));
    }
    if (customNo && arr.some((p: PurchaseOrder) => p.poNo.trim().toLowerCase() === customNo.toLowerCase())) { error = `PO number ${customNo} is already used.`; return arr; }
    const po: PurchaseOrder = {
      id: newId('po'),
      poNo: customNo || nextDocNo(arr.map((p: PurchaseOrder) => p.poNo), 'PO', new Date(), { seq: settings.lastPoSeq, year: settings.seqYear }),
      rfqId: input.rfqId ?? null, rfqNo: input.rfqNo ?? null, quoteId: input.quoteId ?? null,
      stfId: input.stfId ?? null, stfNo: input.stfNo ?? null, projectType: input.projectType ?? null, projectName: input.projectName ?? null, fxRate: input.fxRate ?? 1,
      supplierId: input.supplierId ?? null, supplierName: input.supplierName.trim(),
      supplierCode: input.supplierCode ?? null, supplierTaxNo: input.supplierTaxNo ?? null,
      currency: input.currency || 'AED',
      orderDate: input.orderDate || now, expectedDate: input.expectedDate ?? null,
      deliveryLocation: input.deliveryLocation ?? null, paymentTerms: input.paymentTerms ?? null,
      notes: input.notes ?? null, discount: Number(input.discount) || 0, vatRate: input.vatRate ?? 5,
      lines: input.lines, status: 'draft', createdByName: byName, createdAt: now,
    };
    saved = po;
    return [...arr, po];
  });
  if (error || !saved) throw new ProcurementError(error || 'Could not save the PO.');
  return saved;
}

export type PoAction = 'submit' | 'approve' | 'reject' | 'cancel' | 'close';

// Moves a PO through its life. submit → (auto-approved when the total is within the approval limit)
export async function dbPoAction(
  poId: string, action: PoAction, byName: string,
  opts: { notes?: string | null; closedReason?: 'completed' | 'short_closed' } = {},
): Promise<PurchaseOrder> {
  procurementOnly();
  // Cancelling something already received or paid would orphan real records, so check first.
  if (action === 'cancel') {
    const [inc, pay] = await Promise.all([getFirestoreDocArray('incomingMaterials'), getFirestoreDocArray('supplierPayments')]);
    if ((inc as any[]).some((i) => i.poId === poId)) throw new ProcurementError('Goods have already been received on this PO, so it can’t be cancelled. Use “Close short” instead.');
    if ((pay as any[]).some((p) => p.poId === poId && !p.voided)) throw new ProcurementError('A payment is recorded on this PO. Void the payment first.');
  }
  // A PO issued from an approved STF is already approved — the STF was the approval.
  let stfApproval: string | null = null;
  if (action === 'submit') {
    const po0 = ((await getFirestoreDocArray('purchaseOrders')) as PurchaseOrder[]).find((p) => p.id === poId);
    if (po0?.stfId) {
      const stf = ((await getFirestoreDocArray('procurementStfs')) as Stf[]).find((x) => x.id === po0.stfId);
      if (stf && stf.status === 'approved') {
        const last = [...stf.history].reverse().find((h) => h.action === 'approved' || h.action === 'board_approved');
        stfApproval = `${stf.stfNo}${last ? ` — approved by ${last.byName}` : ''}`;
      }
    }
  }
  let saved: PurchaseOrder | undefined;
  let error: string | undefined;
  await updateFirestoreDocArray('purchaseOrders', (arr) => {
    saved = undefined; error = undefined;
    const cur = arr.find((p: PurchaseOrder) => p.id === poId);
    if (!cur) { error = 'This PO no longer exists.'; return arr; }
    const now = new Date().toISOString();
    let next: PurchaseOrder | null = null;
    switch (action) {
      case 'submit': {
        if (cur.status !== 'draft') { error = 'Only a draft can be submitted.'; break; }
        const bad = checkPoLines(cur.lines);
        if (bad) { error = bad; break; }
        const auto = !!stfApproval || poTotals(cur).total * (Number(cur.fxRate) || 1) <= APPROVAL_THRESHOLD;
        next = { ...cur, status: auto ? 'approved' : 'pending_approval', submittedAt: now, rejectedNote: null,
          ...(auto ? { approvedByName: stfApproval ? `STF ${stfApproval}` : 'Auto — within approval limit', approvedAt: now } : {}) };
        break;
      }
      case 'approve':
        if (cur.status !== 'pending_approval') { error = 'This PO is not waiting for approval.'; break; }
        next = { ...cur, status: 'approved', approvedByName: byName, approvedAt: now, approvalNotes: opts.notes || null };
        break;
      case 'reject':
        if (cur.status !== 'pending_approval') { error = 'This PO is not waiting for approval.'; break; }
        if (!opts.notes?.trim()) { error = 'Say why it is being sent back.'; break; }
        next = { ...cur, status: 'draft', rejectedNote: `${byName}: ${opts.notes.trim()}` };
        break;
      case 'cancel':
        if (cur.status === 'closed' || cur.status === 'cancelled') { error = 'This PO is already finished.'; break; }
        if (!opts.notes?.trim()) { error = 'Give a reason for cancelling.'; break; }
        next = { ...cur, status: 'cancelled', cancelledByName: byName, cancelledAt: now, cancelReason: opts.notes.trim() };
        break;
      case 'close':
        if (cur.status !== 'approved') { error = 'Only an approved PO can be closed.'; break; }
        if (opts.closedReason === 'short_closed' && !opts.notes?.trim()) { error = 'Say why the PO is being closed short.'; break; }
        next = { ...cur, status: 'closed', closedByName: byName, closedAt: now, closedReason: opts.closedReason || 'completed', closeNotes: opts.notes?.trim() || null };
        break;
    }
    if (!next || error) return arr;
    saved = { ...next, updatedAt: now };
    return arr.map((p: PurchaseOrder) => (p.id === poId ? saved! : p));
  });
  if (error || !saved) throw new ProcurementError(error || 'Could not update the PO.');
  return saved;
}

// Quotation sheet (RFQ) — create (no id) or update.
// The number is generated (MAT-QTN-2026-0001) unless the buyer types their own (`rfqNo`, checked for duplicates).
export async function dbSaveRfq(input: Partial<Rfq> & { title: string }, byName: string): Promise<Rfq> {
  procurementOnly();
  let saved: Rfq | undefined;
  let error: string | undefined;
  const customNo = (input.rfqNo || '').trim();
  if (customNo && /\s/.test(customNo)) throw new ProcurementError('The RFQ number can’t contain spaces.');
  await updateFirestoreDocArray('procurementRfqs', (arr) => {
    saved = undefined; error = undefined;
    if (!input.title?.trim()) { error = 'Give the quotation sheet a title.'; return arr; }
    const now = new Date().toISOString();
    if (input.id) {
      const cur = arr.find((x: Rfq) => x.id === input.id);
      if (!cur) { error = 'This quotation sheet no longer exists.'; return arr; }
      saved = { ...cur, ...input, id: cur.id, rfqNo: cur.rfqNo, createdAt: cur.createdAt, createdByName: cur.createdByName, updatedAt: now } as Rfq;
      return arr.map((x: Rfq) => (x.id === input.id ? saved! : x));
    }
    if (customNo && arr.some((x: Rfq) => (x.rfqNo || '').trim().toLowerCase() === customNo.toLowerCase())) { error = `RFQ number ${customNo} is already used.`; return arr; }
    const rfq: Rfq = {
      id: newId('rfq'), rfqNo: customNo || nextDocNo(arr.map((x: Rfq) => x.rfqNo), 'QTN'),
      title: input.title.trim(), rfqDate: input.rfqDate || now.slice(0, 10), neededBy: input.neededBy ?? null, projectName: input.projectName ?? null, notes: input.notes ?? null,
      lines: input.lines || [], quotes: input.quotes || [], status: 'draft', createdByName: byName, createdAt: now,
    };
    saved = rfq;
    return [...arr, rfq];
  });
  if (error || !saved) throw new ProcurementError(error || 'Could not save the quotation sheet.');
  return saved;
}

// Award a quotation and raise the STF from it in one step.
//   1. the RFQ must be a draft, the winner must have priced every item, and a winner that is not the cheapest needs a reason
//   2. the STF is created PENDING (it still goes through the approval queue) carrying rfqNo + winningQuoteId, the winner's
//      prices, currency, payment terms and the supplier's quotation PDF(s)
//   3. the RFQ is marked awarded and stores stfId / stfNo
// STF number: typed by the buyer, otherwise generated in the company format (STF.P + yyyymm + running number).
export async function dbAwardRfq(
  rfqId: string,
  winningQuoteId: string,
  opts: { awardNotes?: string | null; stfNo?: string | null; stfDate?: string | null; approvalRoute?: string[]; projectType?: string | null; projectName?: string | null },
  byName: string,
): Promise<{ rfq: Rfq; stf: Stf }> {
  procurementOnly();
  const rfqs = (await getFirestoreDocArray('procurementRfqs')) as Rfq[];
  const rfq = rfqs.find((x) => x.id === rfqId);
  if (!rfq) throw new ProcurementError('This quotation sheet no longer exists.');
  if (rfq.status !== 'draft') throw new ProcurementError(`${rfq.rfqNo} has already been awarded${rfq.stfNo ? ` (${rfq.stfNo})` : ''}.`);
  const q = rfq.quotes.find((x) => x.id === winningQuoteId);
  if (!q) throw new ProcurementError('Pick the winning supplier.');
  if (q.declined) throw new ProcurementError(`${q.supplierName} declined to quote.`);
  const missing = rfq.lines.filter((l) => q.unitPrices[l.id] == null || Number.isNaN(Number(q.unitPrices[l.id])));
  if (missing.length) throw new ProcurementError(`${q.supplierName} has not quoted: ${missing.map((l) => l.itemName).join(', ')}.`);
  const landed = (qq: RfqQuote) => {
    let t = 0;
    for (const l of rfq.lines) { const p = qq.unitPrices[l.id]; if (p == null || Number.isNaN(Number(p))) return null; t += l.qty * Number(p); }
    const fx = qq.currency && qq.currency.toUpperCase() !== 'AED' && Number(qq.fxRate) > 0 ? Number(qq.fxRate) : 1;
    return (t + (Number(qq.deliveryCost) || 0)) * fx;
  };
  const lows = rfq.quotes.filter((x) => !x.declined).map(landed).filter((x): x is number => x != null);
  const mine = landed(q) as number;
  const notCheapest = lows.length > 1 && mine > Math.min(...lows) + 0.005;
  if (notCheapest && !opts.awardNotes?.trim()) throw new ProcurementError('The winner is not the lowest landed cost — write why (quality, lead time, terms…).');
  // never raise a second live STF for the same sheet (a retry after a half-finished award)
  const stfs0 = (await getFirestoreDocArray('procurementStfs')) as Stf[];
  const dup = stfs0.find((x) => x.rfqId === rfq.id && x.status !== 'cancelled' && x.status !== 'rejected');
  const cur = q.currency && q.currency.toUpperCase() !== 'AED' ? q.currency.toUpperCase() : 'AED';
  const fx = cur === 'AED' ? 1 : Number(q.fxRate) || 0;
  if (cur !== 'AED' && !(fx > 0)) throw new ProcurementError(`Enter the AED exchange rate for ${q.supplierName}’s ${cur} quotation.`);
  const stfLines: StfLine[] = rfq.lines.map((l) => ({
    id: newId('sl'), materialId: l.materialId, itemName: l.itemName, erpCode: l.erpCode ?? null, unit: l.unit, qty: l.qty,
    unitPrice: Number(q.unitPrices[l.id]), sourceRequestId: l.sourceRequestId ?? null, sourceKind: l.sourceKind ?? null,
  }));
  const deliveryNote = Number(q.deliveryCost) > 0 ? `Supplier delivery charge ${Number(q.deliveryCost).toLocaleString('en-AE', { minimumFractionDigits: 2 })} ${cur} is NOT in the item lines — add it to the invoice check.` : null;
  const notes = [rfq.notes, q.notes, deliveryNote, q.leadTimeDays != null ? `Lead time ${q.leadTimeDays} days` : null, q.quoteRef ? `Supplier quotation ${q.quoteRef}` : null].filter(Boolean).join(' · ') || null;
  const typedNo = opts.stfNo?.trim() || '';
  let stf: Stf;
  if (dup) {
    stf = dup;   // finish the half-done award instead of duplicating
  } else {
    stf = await dbSaveStf({
      stfNo: typedNo || undefined, autoNumber: !typedNo, date: opts.stfDate || new Date().toISOString().slice(0, 10), description: rfq.title, approvalRoute: opts.approvalRoute,
      supplierId: q.supplierId ?? null, supplierName: q.supplierName,
      projectType: opts.projectType || 'SALES', projectName: (opts.projectName ?? rfq.projectName ?? '').trim(),
      currency: cur, fxRate: fx || 1, paymentTerms: q.paymentTerms ?? null, lines: stfLines,
      attachments: (q.attachments || []).map((a) => ({ ...a, kind: 'quotation', shared: true })),
      rfqId: rfq.id, rfqNo: rfq.rfqNo, winningQuoteId: q.id, notes,
    } as any, byName);
  }
  let savedRfq: Rfq | undefined;
  await updateFirestoreDocArray('procurementRfqs', (arr) => {
    savedRfq = undefined;
    const now = new Date().toISOString();
    const c = arr.find((x: Rfq) => x.id === rfqId);
    if (!c) return arr;
    savedRfq = { ...c, status: 'po_created', awardedQuoteId: q.id, awardNotes: opts.awardNotes?.trim() || null, awardedByName: byName, awardedAt: now, stfId: stf.id, stfNo: stf.stfNo, updatedAt: now } as Rfq;
    return arr.map((x: Rfq) => (x.id === rfqId ? savedRfq! : x));
  });
  if (!savedRfq) throw new ProcurementError('The STF was created, but the quotation sheet could not be marked as awarded. Open it and award again.');
  return { rfq: savedRfq, stf };
}

// Supplier invoice against a PO. The 3-way match is worked out by the portal from the receipts and passed in.
export async function dbAddSupplierInvoice(
  input: Omit<SupplierInvoice, 'id' | 'createdAt' | 'createdByName'>, byName: string,
): Promise<SupplierInvoice> {
  procurementOnly();
  let saved: SupplierInvoice | undefined;
  let error: string | undefined;
  await updateFirestoreDocArray('supplierInvoices', (arr) => {
    saved = undefined; error = undefined;
    const dup = arr.find((i: SupplierInvoice) => !i.voided && i.supplierName.trim().toLowerCase() === input.supplierName.trim().toLowerCase()
      && i.invoiceNo.trim().toLowerCase() === input.invoiceNo.trim().toLowerCase());
    if (dup) { error = `Invoice ${input.invoiceNo} from ${input.supplierName} is already recorded (on ${dup.poNo}).`; return arr; }
    if (!(input.amount > 0)) { error = 'Enter the invoice amount.'; return arr; }
    saved = { ...input, id: newId('sinv'), createdByName: byName, createdAt: new Date().toISOString() };
    return [...arr, saved];
  });
  if (error || !saved) throw new ProcurementError(error || 'Could not save the invoice.');
  return saved;
}

export async function dbVoidSupplierInvoice(id: string, byName: string, reason: string): Promise<void> {
  procurementOnly();
  if (!reason.trim()) throw new ProcurementError('Give a reason for voiding the invoice.');
  const pay: any[] = await getFirestoreDocArray('supplierPayments');
  if (pay.some((p) => p.invoiceId === id && !p.voided)) throw new ProcurementError('Payments are recorded against this invoice. Void them first.');
  await updateFirestoreDocArray('supplierInvoices', (arr) => arr.map((i: SupplierInvoice) =>
    i.id === id ? { ...i, voided: true, voidedByName: byName, voidedAt: new Date().toISOString(), voidReason: reason.trim() } : i));
}

// Record a payment. `maxTotal` is the most this PO may be paid in total; it is re-checked here against
// the freshest payments so two people can't overpay at the same time.
export async function dbRecordPayment(
  input: Omit<SupplierPayment, 'id' | 'createdAt' | 'byName'>, byName: string, maxTotal: number,
): Promise<SupplierPayment> {
  procurementOnly();
  let saved: SupplierPayment | undefined;
  let error: string | undefined;
  await updateFirestoreDocArray('supplierPayments', (arr) => {
    saved = undefined; error = undefined;
    if (!(input.amount > 0)) { error = 'Enter the amount paid.'; return arr; }
    if (input.method === 'pdc' && !input.chequeDate) { error = 'Enter the cheque date of the post-dated cheque.'; return arr; }
    const already = arr.filter((p: SupplierPayment) => p.poId === input.poId && !p.voided && p.clearStatus !== 'bounced').reduce((t: number, p: SupplierPayment) => t + p.amount, 0);
    if (already + input.amount > maxTotal + 0.005) {
      error = `That would pay AED ${(already + input.amount).toFixed(2)} in total, more than the AED ${maxTotal.toFixed(2)} allowed on this PO (already paid ${already.toFixed(2)}).`;
      return arr;
    }
    saved = { ...input, id: newId('spay'), byName, createdAt: new Date().toISOString(), clearStatus: input.method === 'pdc' ? 'issued' : null };
    return [...arr, saved];
  });
  if (error || !saved) throw new ProcurementError(error || 'Could not save the payment.');
  return saved;
}

// A post-dated cheque is only PAID once the bank clears it. A bounced cheque stops counting at all.
export async function dbSetPaymentClearing(id: string, status: 'cleared' | 'bounced', byName: string, date?: string): Promise<void> {
  procurementOnly();
  let error: string | undefined;
  await updateFirestoreDocArray('supplierPayments', (arr) => {
    error = undefined;
    const cur = arr.find((p: SupplierPayment) => p.id === id);
    if (!cur) { error = 'This payment no longer exists.'; return arr; }
    if (cur.method !== 'pdc' || cur.clearStatus !== 'issued') { error = 'Only an issued post-dated cheque can be marked cleared or bounced.'; return arr; }
    return arr.map((p: SupplierPayment) => (p.id === id ? { ...p, clearStatus: status, clearedAt: status === 'cleared' ? (date || new Date().toISOString().slice(0, 10)) : null,
      notes: status === 'bounced' ? `${p.notes ? p.notes + ' · ' : ''}Bounced — marked by ${byName}` : p.notes } : p));
  });
  if (error) throw new ProcurementError(error);
}

export async function dbVoidPayment(id: string, byName: string, reason: string): Promise<void> {
  procurementOnly();
  if (!reason.trim()) throw new ProcurementError('Give a reason for voiding the payment.');
  await updateFirestoreDocArray('supplierPayments', (arr) => arr.map((p: SupplierPayment) =>
    p.id === id ? { ...p, voided: true, voidedByName: byName, voidedAt: new Date().toISOString(), voidReason: reason.trim() } : p));
}

// ── Procurement settings (approvers, budget tier, numbering) ──────────────────
export async function dbFetchProcurementSettings(): Promise<ProcurementSettings> {
  if (apiBase()) return defaultProcurementSettings();
  const arr: ProcurementSettings[] = await getFirestoreDocArray('procurementSettings');
  return arr[0] ? { ...defaultProcurementSettings(), ...arr[0] } : defaultProcurementSettings();
}
export async function dbSaveProcurementSettings(next: ProcurementSettings): Promise<void> {
  procurementOnly();
  const names = next.approvers.map((a) => a.name.trim()).filter(Boolean);
  if (names.length === 0) throw new ProcurementError('Add at least one approver.');
  if (!(next.tierEur > 0) || !(next.eurToAed > 0)) throw new ProcurementError('The budget tier and the EUR rate must be above zero.');
  const clean: ProcurementSettings = { ...next, id: 'settings', approvers: next.approvers.filter((a) => a.name.trim()).map((a) => ({ name: a.name.trim(), finalForAbove: !!a.finalForAbove })) };
  await updateFirestoreDocArray('procurementSettings', () => [clean]);
}

// ── STF — purchase approval form ─────────────────────────────────────────────
// Only real STF forms (they carry a history). An earlier release used the same collection name for something else.
export async function dbFetchStfs(): Promise<Stf[]> {
  const arr: any[] = await getFirestoreDocArray('procurementStfs');
  return arr.filter((x) => x && Array.isArray(x.history) && x.projectType !== undefined);
}

function checkStfLines(lines: StfLine[] | undefined): string | null {
  if (!lines || lines.length === 0) return 'Add at least one item.';
  for (const l of lines) {
    if (!l.materialId) return `"${l.itemName || 'An item'}" is not linked to a Store item.`;
    if (!(Number(l.qty) > 0)) return `Enter a quantity for ${l.itemName}.`;
    if (l.unitPrice == null || !(Number(l.unitPrice) >= 0)) return `Enter a price for ${l.itemName}.`;
  }
  return null;
}

const STF_EDITABLE = ['date', 'description', 'supplierId', 'supplierName', 'projectType', 'projectName', 'currency', 'fxRate', 'vatRate',
  'paymentTerms', 'lines', 'rfqId', 'rfqNo', 'winningQuoteId', 'attachments', 'notes', 'approvalRoute'] as const;

// Create (no id) or edit (id, while still PENDING) an STF.
export async function dbSaveStf(input: Partial<Stf> & { description: string; supplierName: string; lines: StfLine[]; autoNumber?: boolean }, byName: string): Promise<Stf> {
  procurementOnly();
  if (!input.description?.trim()) throw new ProcurementError('Describe what is being bought.');
  if (!input.supplierName?.trim()) throw new ProcurementError('Choose the supplier.');
  const bad = checkStfLines(input.lines);
  if (bad) throw new ProcurementError(bad);
  const settings = await dbFetchProcurementSettings();
  const customNo = input.stfNo?.trim();
  // The STF number is typed by the user (it comes from the company's own numbering). The only exception is an STF
  // raised automatically from an awarded quotation (`autoNumber`), which takes the next number in the company format.
  if (!input.id && !customNo && !input.autoNumber) throw new ProcurementError('Type the STF number.');
  if (customNo && /\s/.test(customNo)) throw new ProcurementError('The STF number can’t contain spaces.');
  let saved: Stf | undefined;
  let error: string | undefined;
  // approvers picked on the form → checked against Settings; above the budget tier the route must end with a final approver
  const routeIn = (input as any).approvalRoute as string[] | undefined;
  const route = routeIn !== undefined ? normalizeRoute(routeIn, settings, { lines: input.lines as any, vatRate: (input.vatRate ?? 5) as number, fxRate: (Number(input.fxRate) || 1) as number }) : undefined;
  await updateFirestoreDocArray('procurementStfs', (arr) => {
    saved = undefined; error = undefined;
    const now = new Date().toISOString();
    const patch: any = {};
    for (const k of STF_EDITABLE) if ((input as any)[k] !== undefined) patch[k] = (input as any)[k];
    if (route !== undefined) patch.approvalRoute = route;
    if (input.id) {
      const cur = arr.find((x: Stf) => x.id === input.id);
      if (!cur) { error = 'This STF no longer exists.'; return arr; }
      if (cur.status !== 'pending') { error = 'Only a pending STF can be edited.'; return arr; }
      const keepQueue = route && route.length && !route.some((n) => sameName(n, cur.queue)) ? route[0] : cur.queue;   // the old holder is no longer on the route
      saved = { ...cur, ...patch, queue: keepQueue, updatedAt: now };
      return arr.map((x: Stf) => (x.id === input.id ? saved! : x));
    }
    if (customNo && arr.some((x: Stf) => x.stfNo.trim().toLowerCase() === customNo.toLowerCase())) { error = `STF number ${customNo} is already used.`; return arr; }
    const queue = route && route.length ? route[0] : input.queue && settings.approvers.some((a) => sameName(a.name, input.queue)) ? input.queue : settings.approvers[0].name;
    const stf: Stf = {
      id: newId('stf'),
      stfNo: customNo || nextDocNo(arr.map((x: Stf) => x.stfNo), 'STF', new Date(), { seq: settings.lastStfSeq, year: settings.seqYear }),
      date: patch.date || now.slice(0, 10), description: String(patch.description).trim(),
      supplierId: patch.supplierId ?? null, supplierName: String(patch.supplierName).trim(),
      projectType: patch.projectType || 'SALES', projectName: patch.projectName || '',
      currency: patch.currency || 'AED', fxRate: Number(patch.fxRate) || 1, vatRate: patch.vatRate ?? 5, paymentTerms: patch.paymentTerms ?? null,
      lines: patch.lines, status: 'pending', queue, approvalRoute: route || [], statusDate: now.slice(0, 10),
      rfqId: patch.rfqId ?? null, rfqNo: patch.rfqNo ?? null, winningQuoteId: patch.winningQuoteId ?? null, attachments: patch.attachments || [], poId: null, poNo: null,
      history: [{ at: now, byName, action: 'created', toQueue: queue }], notes: patch.notes ?? null, createdByName: byName, createdAt: now,
    };
    saved = stf;
    return [...arr, stf];
  });
  if (error || !saved) throw new ProcurementError(error || 'Could not save the STF.');
  return saved;
}

// Attachments / notes can change at any stage (late approvals, extra quotations).
export async function dbPatchStf(id: string, patch: { attachments?: ProcAttachment[]; notes?: string | null }): Promise<void> {
  procurementOnly();
  await updateFirestoreDocArray('procurementStfs', (arr) => arr.map((x: Stf) => (x.id === id ? { ...x, ...patch, updatedAt: new Date().toISOString() } : x)));
}

export type StfAction = 'forward' | 'approve' | 'to_board' | 'board_approve' | 'reject' | 'cancel' | 'reopen';

// Moves an STF through the approval queue. `manager` = a management account (may act for anyone).
export async function dbStfAction(id: string, action: StfAction, byName: string, manager: boolean, opts: { toQueue?: string | null; notes?: string | null } = {}): Promise<Stf> {
  procurementOnly();
  const settings = await dbFetchProcurementSettings();
  let saved: Stf | undefined;
  let error: string | undefined;
  await updateFirestoreDocArray('procurementStfs', (arr) => {
    saved = undefined; error = undefined;
    const cur = arr.find((x: Stf) => x.id === id);
    if (!cur) { error = 'This STF no longer exists.'; return arr; }
    const perm = stfPermissions(cur, settings, { name: byName, manager });
    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    const note = opts.notes?.trim() || null;
    const move = (status: StfStatus, queue: string, h: Stf['history'][number]['action'], extra: Partial<Stf> = {}): Stf =>
      ({ ...cur, status, queue, statusDate: today, updatedAt: now, history: [...cur.history, { at: now, byName, action: h, toQueue: queue, notes: note }], ...extra });
    let next: Stf | null = null;
    switch (action) {
      case 'forward':
        if (!perm.canForward) { error = 'You can’t forward this STF.'; break; }
        if (!opts.toQueue || !settings.approvers.some((a) => sameName(a.name, opts.toQueue))) { error = 'Choose who to send it to.'; break; }
        next = move('pending', settings.approvers.find((a) => sameName(a.name, opts.toQueue))!.name, 'forwarded');
        break;
      case 'approve': {
        if (!perm.canApprove) { error = perm.approveBlockedReason || 'You can’t approve this STF.'; break; }
        // approval route: the current approver passes it to the next person on the route; the last one (or a management
        // account acting for someone else) gives the final approval
        const nextName = routeNext(cur);
        if (nextName && sameName(cur.queue, byName)) next = move('pending', nextName, 'step_approved');
        else next = move('approved', QUEUE_FINISHED, 'approved');
        break;
      }
      case 'to_board':
        if (!perm.canToBoard) { error = 'You can’t send this STF to the board.'; break; }
        next = move('board', QUEUE_BOARD, 'to_board');
        break;
      case 'board_approve':
        if (!perm.canBoardDecide) { error = 'Only management can record the board’s decision.'; break; }
        next = move('approved', QUEUE_FINISHED, 'board_approved');
        break;
      case 'reject':
        if (!perm.canReject) { error = 'You can’t reject this STF.'; break; }
        if (!note) { error = 'Say why it is rejected.'; break; }
        next = move('rejected', QUEUE_FINISHED, 'rejected');
        break;
      case 'cancel':
        if (!perm.canCancel) { error = cur.poId ? `A PO (${cur.poNo}) was already issued from this STF — cancel the PO first.` : 'You can’t cancel this STF.'; break; }
        if (!note) { error = 'Give a reason for cancelling.'; break; }
        next = move('cancelled', QUEUE_FINISHED, 'cancelled');
        break;
      case 'reopen': {
        if (!perm.canReopen) { error = 'Only management can reopen an STF.'; break; }
        const q = opts.toQueue && settings.approvers.some((a) => sameName(a.name, opts.toQueue)) ? opts.toQueue : settings.approvers[0].name;
        next = move('pending', q, 'reopened');
        break;
      }
    }
    if (!next || error) return arr;
    saved = next;
    return arr.map((x: Stf) => (x.id === id ? next! : x));
  });
  if (error || !saved) throw new ProcurementError(error || 'Could not update the STF.');
  return saved;
}

// The PO that was issued from this STF
export async function dbLinkStfPo(stfId: string, po: { id: string; poNo: string }, byName: string): Promise<void> {
  procurementOnly();
  let rfqId: string | null = null;
  await updateFirestoreDocArray('procurementStfs', (arr) => arr.map((x: Stf) => {
    if (x.id !== stfId) return x;
    rfqId = x.rfqId ?? null;
    return { ...x, poId: po.id, poNo: po.poNo, updatedAt: new Date().toISOString(), history: [...x.history, { at: new Date().toISOString(), byName, action: 'po_issued' as const, notes: po.poNo }] };
  }));
  // traceability: the quotation sheet also remembers the PO that came out of it
  if (rfqId) {
    try {
      await updateFirestoreDocArray('procurementRfqs', (arr) => arr.map((x: Rfq) => (x.id === rfqId ? { ...x, poId: po.id, poNo: po.poNo, updatedAt: new Date().toISOString() } : x)));
    } catch { /* the PO and STF are linked; the RFQ link is only a convenience */ }
  }
}

// ── Structured Trade Finance (bank facilities) ────────────────────────────────────────────
// Facilities saved by the first release called their number `stfNo`; it is `tfNo` now. Read both.
export async function dbFetchTradeFinances(): Promise<TradeFinance[]> {
  const arr: any[] = await getFirestoreDocArray('tradeFinances');
  return arr.map((x) => ({ ...x, tfNo: x.tfNo ?? x.stfNo ?? '' }));
}

const TF_TERMS = ['type', 'bankName', 'facilityRef', 'currency', 'fxRate', 'invoiceAmount', 'marginPct', 'tenorDays', 'interestRate',
  'commissionPct', 'otherFees', 'expectedDrawDate', 'notes'] as const;

function checkTfTerms(t: Partial<TradeFinance>): string | null {
  if (!t.bankName?.trim()) return 'Enter the bank.';
  if (!(Number(t.invoiceAmount) > 0)) return 'Enter the amount being financed.';
  if (!(Number(t.fxRate) > 0)) return 'Enter the exchange rate to AED.';
  if (!(Number(t.tenorDays) > 0)) return 'Enter the tenor in days.';
  if (!(Number(t.interestRate) >= 0)) return 'Enter the interest / profit rate (0 if none).';
  const margin = Number(t.marginPct ?? 0);                 // empty = no cash margin
  if (!(margin >= 0 && margin < 100)) return 'Cash margin must be between 0 and 99%.';
  return null;
}

// Create (no id) or edit (id) a trade finance facility. Terms can be changed until the bank has paid the supplier.
export async function dbSaveTradeFinance(input: Partial<TradeFinance> & { poId: string }, byName: string): Promise<TradeFinance> {
  procurementOnly();
  const bad = checkTfTerms(input);
  if (bad) throw new ProcurementError(bad);
  const pos: PurchaseOrder[] = await getFirestoreDocArray('purchaseOrders');
  const po = pos.find((p) => p.id === input.poId);
  if (!po) throw new ProcurementError('Choose the purchase order this finance is for.');
  if (po.status !== 'approved') throw new ProcurementError(`${po.poNo} is not an issued PO, so it can't be financed.`);
  let saved: TradeFinance | undefined;
  let error: string | undefined;
  await updateFirestoreDocArray('tradeFinances', (arr) => {
    saved = undefined; error = undefined;
    const now = new Date().toISOString();
    const patch: any = {};
    for (const k of TF_TERMS) if ((input as any)[k] !== undefined) patch[k] = (input as any)[k];
    if (input.id) {
      const cur = arr.find((x: TradeFinance) => x.id === input.id);
      if (!cur) { error = 'This trade-finance record no longer exists.'; return arr; }
      if (cur.status === 'drawn' || cur.status === 'settled' || cur.status === 'cancelled') { error = 'The terms can’t be changed once the bank has paid the supplier.'; return arr; }
      saved = { ...cur, ...patch, updatedAt: now };
      return arr.map((x: TradeFinance) => (x.id === input.id ? saved! : x));
    }
    const tf: TradeFinance = {
      id: newId('tf'), tfNo: nextDocNo(arr.map((x: TradeFinance) => x.tfNo), 'TF'),
      poId: po.id, poNo: po.poNo, supplierName: po.supplierName,
      type: patch.type || 'usance_lc', bankName: String(patch.bankName).trim(), facilityRef: patch.facilityRef || null,
      currency: patch.currency || 'AED', fxRate: Number(patch.fxRate), invoiceAmount: Number(patch.invoiceAmount),
      marginPct: Number(patch.marginPct) || 0, tenorDays: Number(patch.tenorDays), interestRate: Number(patch.interestRate) || 0,
      commissionPct: Number(patch.commissionPct) || 0, otherFees: Number(patch.otherFees) || 0,
      expectedDrawDate: patch.expectedDrawDate || null, notes: patch.notes || null,
      status: 'draft', repayments: [], attachments: [], createdByName: byName, createdAt: now,
    };
    saved = tf;
    return [...arr, tf];
  });
  if (error || !saved) throw new ProcurementError(error || 'Could not save the trade finance record.');
  return saved;
}

// Documents / notes can be added at any stage.
export async function dbPatchTradeFinance(id: string, patch: { attachments?: ProcAttachment[]; notes?: string | null; facilityRef?: string | null }): Promise<void> {
  procurementOnly();
  await updateFirestoreDocArray('tradeFinances', (arr) => arr.map((x: TradeFinance) => (x.id === id ? { ...x, ...patch, updatedAt: new Date().toISOString() } : x)));
}

export type TfAction = 'apply' | 'approve' | 'cancel';
export async function dbTradeFinanceAction(id: string, action: TfAction, byName: string, opts: { notes?: string | null; approvedRef?: string | null; facilityRef?: string | null; date?: string | null } = {}): Promise<TradeFinance> {
  procurementOnly();
  let saved: TradeFinance | undefined;
  let error: string | undefined;
  await updateFirestoreDocArray('tradeFinances', (arr) => {
    saved = undefined; error = undefined;
    const cur = arr.find((x: TradeFinance) => x.id === id);
    if (!cur) { error = 'This trade-finance record no longer exists.'; return arr; }
    const now = new Date().toISOString();
    let next: TradeFinance | null = null;
    if (action === 'apply') {
      if (cur.status !== 'draft') error = 'Only a draft can be marked as applied.';
      else next = { ...cur, status: 'applied', appliedAt: opts.date || now };
    } else if (action === 'approve') {
      if (cur.status !== 'applied') error = 'Only an application that is with the bank can be approved.';
      else next = { ...cur, status: 'approved', approvedAt: opts.date || now, approvedRef: opts.approvedRef?.trim() || null, facilityRef: opts.facilityRef?.trim() || cur.facilityRef || null };
    } else if (action === 'cancel') {
      if (!['draft', 'applied', 'approved'].includes(cur.status)) error = 'Once the bank has paid the supplier it can’t be cancelled — settle it instead.';
      else if (!opts.notes?.trim()) error = 'Give a reason for cancelling.';
      else next = { ...cur, status: 'cancelled', cancelReason: opts.notes.trim(), cancelledByName: byName, cancelledAt: now };
    }
    if (!next || error) return arr;
    saved = { ...next, updatedAt: now };
    return arr.map((x: TradeFinance) => (x.id === id ? saved! : x));
  });
  if (error || !saved) throw new ProcurementError(error || 'Could not update the trade finance record.');
  return saved;
}

// Drawdown = the bank pays the supplier. Starts the repayment clock (maturity = drawdown date + tenor) and,
// in the SAME transaction, records that payment on the PO — so the PO and the facility can never disagree.
export async function dbDrawTradeFinance(
  id: string,
  opts: { date: string; payment?: { invoiceId?: string | null; amount: number } | null },
  byName: string,
  maxPoPayable: number,
): Promise<TradeFinance> {
  procurementOnly();
  if (!opts.date) throw new ProcurementError('Enter the date the bank paid the supplier.');
  let saved: TradeFinance | undefined;
  await updateFirestoreDocArrays({
    tradeFinances: (arr) => {
      const cur = arr.find((x: TradeFinance) => x.id === id);
      if (!cur) throw new ProcurementError('This trade-finance record no longer exists.');
      if (cur.status !== 'approved') throw new ProcurementError('Only an approved facility can be drawn.');
      const payId = opts.payment ? newId('spay') : null;
      saved = { ...cur, status: 'drawn', drawDate: opts.date, maturityDate: addDays(opts.date, cur.tenorDays), supplierPaymentId: payId, updatedAt: new Date().toISOString() };
      return arr.map((x: TradeFinance) => (x.id === id ? saved! : x));
    },
    ...(opts.payment ? {
      supplierPayments: (arr: any[]) => {
        const tf = saved!;
        const amt = Number(opts.payment!.amount) || 0;
        if (!(amt > 0)) throw new ProcurementError('Enter the amount the bank paid the supplier.');
        const already = arr.filter((p: SupplierPayment) => p.poId === tf.poId && !p.voided).reduce((t: number, p: SupplierPayment) => t + p.amount, 0);
        if (already + amt > maxPoPayable + 0.005) {
          throw new ProcurementError(`The bank’s payment of AED ${amt.toFixed(2)} would take payments on ${tf.poNo} to AED ${(already + amt).toFixed(2)}, above the AED ${maxPoPayable.toFixed(2)} allowed. Lower the amount or untick “record on the PO”.`);
        }
        const pay: SupplierPayment = {
          id: tf.supplierPaymentId as string, poId: tf.poId, poNo: tf.poNo, supplierName: tf.supplierName,
          invoiceId: opts.payment!.invoiceId || null, kind: opts.payment!.invoiceId ? 'invoice' : 'advance', amount: amt,
          paidAt: opts.date, method: 'trade_finance', reference: `${tf.tfNo}${tf.facilityRef ? ` · ${tf.facilityRef}` : ''} · ${tf.bankName}`,
          notes: 'Paid to the supplier by the bank under Structured Trade Finance', byName, createdAt: new Date().toISOString(),
        };
        return [...arr, pay];
      },
    } : {}),
  } as any);
  return saved!;
}

// Repayment to the bank. Settles the facility automatically when nothing is left to pay.
export async function dbAddTfRepayment(id: string, input: { amount: number; paidAt: string; reference?: string | null; notes?: string | null }, byName: string): Promise<TradeFinance> {
  procurementOnly();
  let saved: TradeFinance | undefined;
  let error: string | undefined;
  await updateFirestoreDocArray('tradeFinances', (arr) => {
    saved = undefined; error = undefined;
    const cur = arr.find((x: TradeFinance) => x.id === id);
    if (!cur) { error = 'This trade-finance record no longer exists.'; return arr; }
    if (cur.status !== 'drawn') { error = 'Repayments can only be recorded after the bank has paid the supplier.'; return arr; }
    if (!(input.amount > 0)) { error = 'Enter the amount paid to the bank.'; return arr; }
    const pos = tfPosition(cur);
    if (input.amount > pos.outstanding + 0.005) { error = `That is more than the AED ${pos.outstanding.toFixed(2)} still owed to the bank.`; return arr; }
    const rep: TfRepayment = { id: newId('tfr'), amount: input.amount, paidAt: input.paidAt, reference: input.reference || null, notes: input.notes || null, byName, createdAt: new Date().toISOString() };
    const next: TradeFinance = { ...cur, repayments: [...cur.repayments, rep], updatedAt: rep.createdAt };
    if (tfPosition(next).outstanding <= 0.005) next.status = 'settled';
    saved = next;
    return arr.map((x: TradeFinance) => (x.id === id ? next : x));
  });
  if (error || !saved) throw new ProcurementError(error || 'Could not save the repayment.');
  return saved;
}

export async function dbVoidTfRepayment(id: string, repaymentId: string, byName: string, reason: string): Promise<void> {
  procurementOnly();
  if (!reason.trim()) throw new ProcurementError('Give a reason for voiding the repayment.');
  await updateFirestoreDocArray('tradeFinances', (arr) => arr.map((x: TradeFinance) => {
    if (x.id !== id) return x;
    const repayments = x.repayments.map((r) => (r.id === repaymentId ? { ...r, voided: true, voidedByName: byName, voidedAt: new Date().toISOString(), voidReason: reason.trim() } : r));
    const next = { ...x, repayments };
    if (x.status === 'settled' && tfPosition(next).outstanding > 0.005) next.status = 'drawn';
    return next;
  }));
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

// --- HR: Site/Factory Deployed Staff ---
// Employees temporarily sent to a site/factory job are placed on this list.
// While an employee's badge is on this list, Attendance treats them as
// deployed instead of absent (they are removed from the absent count/report
// entirely). Removing them from this list returns them to normal
// present/absent tracking on the next uploaded sheet.
export async function dbFetchHRSiteDeployed(): Promise<any[]> {
  return getFirestoreDocArray('hrSiteDeployed');
}
export async function dbSaveHRSiteDeployed(deployed: any[]): Promise<void> {
  await setFirestoreDocArray('hrSiteDeployed', deployed, true);
}

// --- HR: Purchase Requests (office / accommodation items) ---
// A lightweight approval flow separate from Store's Material Requests:
// HR requests an item (office supplies, accommodation furniture, etc.), the
// manager gets an email with Approve/Reject, and once approved HR can print
// a purchase order for the purchaser and later attach the bill/invoice.
export async function dbFetchHRPurchaseRequests(): Promise<any[]> {
  return getFirestoreDocArray('hrPurchaseRequests');
}
export async function dbSaveHRPurchaseRequests(requests: any[]): Promise<void> {
  await setFirestoreDocArray('hrPurchaseRequests', requests, true);
}

// Fire-and-forget call to the Netlify Function that emails the manager
// about a batch of HR purchase requests (one email, per-item approve/reject
// on the manager's side). Safe to call even when email isn't configured —
// it just no-ops server-side.
export async function dbSendHRPurchaseRequestEmail(batch: {
  batchId?: string; id?: string; approvalToken: string; requestedByName: string; purpose?: string | null;
  items: { id: string; itemName: string; category: string; qty: number; unit: string; estimatedCost?: number | null }[];
}): Promise<void> {
  try {
    await fetch('/.netlify/functions/send-hr-purchase-request-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
    });
  } catch (err) {
    console.warn('[dbSendHRPurchaseRequestEmail] Could not reach the email function (this is fine in local dev without `netlify dev`):', err);
  }
}

// --- Factory Supervisor: Purchase Requests (tools / equipment / site items) ---
// Same lightweight approval flow as HR's Purchase Requests, scoped to the
// Factory Supervisor Portal: a supervisor requests an item, the manager gets
// an email with Approve/Reject, and once approved the supervisor can print a
// purchase order for the purchaser and later attach the bill/invoice.
export async function dbFetchSupervisorPurchaseRequests(): Promise<any[]> {
  return getFirestoreDocArray('supervisorPurchaseRequests');
}
export async function dbSaveSupervisorPurchaseRequests(requests: any[]): Promise<void> {
  await setFirestoreDocArray('supervisorPurchaseRequests', requests, true);
}

// Fire-and-forget call to the Netlify Function that emails the manager about
// a batch of Factory Supervisor purchase requests (one email, per-item
// approve/reject on the manager's side). Safe to call even when email isn't
// configured — it just no-ops server-side.
export async function dbSendSupervisorPurchaseRequestEmail(batch: {
  batchId?: string; id?: string; approvalToken: string; requestedByName: string; purpose?: string | null;
  sectionName?: string | null;
  items: { id: string; itemName: string; category: string; qty: number; unit: string; estimatedCost?: number | null }[];
}): Promise<void> {
  try {
    const res = await fetch('/.netlify/functions/send-supervisor-purchase-request-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('[dbSendSupervisorPurchaseRequestEmail] Email function returned an error — Resend never received/logged this send:', res.status, detail);
    }
  } catch (err) {
    console.warn('[dbSendSupervisorPurchaseRequestEmail] Could not reach the email function (this is fine in local dev without `netlify dev`):', err);
  }
}

// --- QC Inspection email notification (pool ready for QC) ---
// Fired whenever a stage's status flips to PENDING_INSPECTION — see
// handleFinishStage / handleQuickBatchComplete in App.tsx. Same
// fire-and-forget pattern as the other email dispatchers above: a failure
// here should never block the stage-completion write that already
// succeeded locally/in Firestore.
export async function dbSendQcInspectionEmail(payload: {
  poolId: string; poolNo: string; projectName: string; stageId: string; stageName?: string; teamName?: string;
}): Promise<void> {
  try {
    const res = await fetch('/.netlify/functions/send-qc-inspection-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('[dbSendQcInspectionEmail] Email function returned an error:', res.status, detail);
    }
  } catch (err) {
    console.warn('[dbSendQcInspectionEmail] Could not reach the email function (this is fine in local dev without `netlify dev`):', err);
  }
}

// --- Site Deliveries (Management dispatches → Site Team confirms receipt) ---
// Low-volume, occasional-write data (a handful of deliveries a day at most),
// so this uses the same simple whole-array system_state/{name} pattern as
// hrPurchaseRequests / supervisorPurchaseRequests above rather than the
// collection-backed or week-bucketed strategies reserved for high-churn
// collections like pools/teams/employeePunches.
export async function dbFetchSiteDeliveries(): Promise<any[]> {
  return getFirestoreDocArray('siteDeliveries');
}
export async function dbSaveSiteDeliveries(deliveries: any[]): Promise<void> {
  await setFirestoreDocArray('siteDeliveries', deliveries, true);
}
