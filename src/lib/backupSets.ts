// ----------------------------------------------------
// BACKUP SETS — what the Store/HR/QC backup covers, and the pure helpers
// the restore dialog uses. No Firebase imports here on purpose: everything
// in this file is plain data logic that can be tested on its own.
// ----------------------------------------------------
//
// The older Drive backup already covers pools, teams, logs, inspectors,
// engineers, employees, planned pools, project summaries and monthly targets
// (and its restore is handled in App.tsx). The lists below are everything
// ELSE that used to be missing from it. Each is one Firestore document
// `system_state/<id>` holding `{ data: [ ...records ] }`.
//
// Not included on purpose:
//   recycleBin      deleted items — the bin itself is the safety net
//   employeePunches stored as weekly documents, far larger than a manual file

export type BackupGroup = 'store' | 'production' | 'hr';

export interface BackupDocDef {
  id: string;
  label: string;
  group: BackupGroup;
}

export const BACKUP_GROUP_LABELS: Record<BackupGroup, string> = {
  store: 'Store & inventory',
  production: 'Production & QC',
  hr: 'HR & purchasing',
};

export const BACKUP_DOCS: BackupDocDef[] = [
  // Store & inventory — the Inventory Ledger is calculated from these.
  { id: 'materials', label: 'Materials (inventory & stock levels)', group: 'store' },
  { id: 'bomItems', label: 'Bill of Materials', group: 'store' },
  { id: 'materialRequests', label: 'Material requests & Delivery Orders', group: 'store' },
  { id: 'incomingMaterials', label: 'Goods received (incoming)', group: 'store' },
  { id: 'consumptionLogs', label: 'Consumption logs', group: 'store' },
  { id: 'materialReturns', label: 'Material returns', group: 'store' },
  { id: 'stockAdjustments', label: 'Stock adjustments', group: 'store' },
  { id: 'inventoryDeletionLogs', label: 'Inventory deletion log', group: 'store' },
  { id: 'companyAssets', label: 'Company assets', group: 'store' },
  { id: 'siteDeliveries', label: 'Site deliveries', group: 'store' },
  { id: 'suppliers', label: 'Suppliers', group: 'store' },
  // Production & QC
  { id: 'productionLogs', label: 'Production logs', group: 'production' },
  { id: 'trolleys', label: 'Trolley production', group: 'production' },
  { id: 'qcDefects', label: 'QC defects', group: 'production' },
  { id: 'checklistTemplates', label: 'QC checklist templates', group: 'production' },
  // HR & purchasing
  { id: 'hrPayroll', label: 'HR payroll', group: 'hr' },
  { id: 'hrLeaves', label: 'HR leaves', group: 'hr' },
  { id: 'hrWarnings', label: 'HR warnings', group: 'hr' },
  { id: 'hrAccidents', label: 'HR accident reports', group: 'hr' },
  { id: 'hrMedicals', label: 'HR medical records', group: 'hr' },
  { id: 'hrSiteDeployed', label: 'HR site deployments', group: 'hr' },
  { id: 'hrPurchaseRequests', label: 'HR purchase requests', group: 'hr' },
  { id: 'supervisorPurchaseRequests', label: 'Supervisor purchase requests', group: 'hr' },
  { id: 'companies', label: 'Visa sponsor companies', group: 'hr' },
];

export const BACKUP_DOC_IDS: string[] = BACKUP_DOCS.map(d => d.id);

export const BACKUP_DOC_BY_ID: Record<string, BackupDocDef> = Object.fromEntries(BACKUP_DOCS.map(d => [d.id, d]));

// ---------- merge ----------

// Records are matched by their `id`. A few lists hold plain strings
// (e.g. companies) — those match by value.
export function itemKey(x: any): string {
  if (x !== null && typeof x === 'object') return x.id !== undefined && x.id !== null ? `id:${x.id}` : `json:${JSON.stringify(x)}`;
  return `val:${String(x)}`;
}

// "Add missing only": everything currently in the database is kept EXACTLY as
// it is; records that exist only in the backup are appended. Nothing is
// overwritten or removed, so it's safe to run at any time.
export function mergeById(current: any[], incoming: any[]): { merged: any[]; added: number } {
  const have = new Set(current.map(itemKey));
  const extra = incoming.filter(x => !have.has(itemKey(x)));
  // De-duplicate within the backup itself too.
  const seen = new Set<string>();
  const uniqueExtra = extra.filter(x => { const k = itemKey(x); if (seen.has(k)) return false; seen.add(k); return true; });
  return { merged: [...current, ...uniqueExtra], added: uniqueExtra.length };
}

// ---------- preview ----------

export type RestoreMode = 'merge' | 'replace';

export interface RestorePreviewRow {
  id: string;
  label: string;
  group: BackupGroup;
  inBackup: boolean;          // the backup contains this list
  backupCount: number;
  currentCount: number;
  onlyInBackup: number;       // records the backup has that the database doesn't
  onlyInCurrent: number;      // records the database has that the backup doesn't
  differs: boolean;           // merge would add something / replace would change something
}

export function planRestore(current: Record<string, any[]>, backup: Record<string, any[]>): RestorePreviewRow[] {
  return BACKUP_DOCS.map(def => {
    const b = Array.isArray(backup[def.id]) ? backup[def.id] : null;
    const c = Array.isArray(current[def.id]) ? current[def.id] : [];
    if (!b) {
      return { id: def.id, label: def.label, group: def.group, inBackup: false, backupCount: 0, currentCount: c.length, onlyInBackup: 0, onlyInCurrent: 0, differs: false };
    }
    const cKeys = new Set(c.map(itemKey));
    const bKeys = new Set(b.map(itemKey));
    const onlyInBackup = [...bKeys].filter(k => !cKeys.has(k)).length;
    const onlyInCurrent = [...cKeys].filter(k => !bKeys.has(k)).length;
    // Same ids can still hold different values (e.g. a stock level changed), so
    // for "differs" compare content too when the id sets match.
    let differs = onlyInBackup > 0 || onlyInCurrent > 0;
    if (!differs && c.length === b.length) differs = JSON.stringify(c) !== JSON.stringify(b);
    return { id: def.id, label: def.label, group: def.group, inBackup: true, backupCount: b.length, currentCount: c.length, onlyInBackup, onlyInCurrent, differs };
  });
}

// ---------- automatic-backup snapshots (chunk format) ----------
//
// The server (netlify/functions/lib/backupCore.cjs) stores each database list
// as one or more "chunk" documents so no single Firestore document goes over
// its 1 MiB limit:
//   { name, kind: 'doc' | 'collection', index, total, json }
// `json` is a slice of JSON.stringify(<the list's content>). Joining the
// slices in order gives the original text back.

export interface BackupChunk {
  name: string;
  kind?: 'doc' | 'collection';
  index: number;
  total: number;
  json: string;
}

export function reassembleChunks(chunks: BackupChunk[]): Record<string, any> {
  const byName = new Map<string, BackupChunk[]>();
  for (const c of chunks) {
    const list = byName.get(c.name) || [];
    list.push(c);
    byName.set(c.name, list);
  }
  const out: Record<string, any> = {};
  for (const [name, list] of byName) {
    list.sort((a, b) => a.index - b.index);
    const total = list[0].total;
    if (list.length !== total || list.some((c, i) => c.index !== i || c.total !== total)) {
      throw new Error(`Backup is incomplete: "${name}" has ${list.length} of ${total} parts.`);
    }
    try {
      out[name] = JSON.parse(list.map(c => c.json).join(''));
    } catch {
      throw new Error(`Backup part "${name}" is damaged and could not be read.`);
    }
  }
  return out;
}

// Pull the restorable lists out of a reassembled snapshot. A list's content is
// the Firestore document `{ data: [...] }`.
export function extractBackupDocs(parsed: Record<string, any>): Record<string, any[]> {
  const docs: Record<string, any[]> = {};
  for (const id of BACKUP_DOC_IDS) {
    const payload = parsed[id];
    if (payload && Array.isArray(payload.data)) docs[id] = payload.data;
  }
  return docs;
}

// ---------- restore engine ----------
//
// All the SAFETY RULES live here, with the database access passed in (`io`),
// so they can be tested without Firebase. firebaseService.dbRestoreBackupDocs
// supplies the real `io`.
//
//  1. Reads the current list strictly first — if that read fails, nothing is
//     changed (a failed read must never be mistaken for "empty").
//  2. Saves a copy of the current list (system_state/preRestore_<time>__<list>)
//     BEFORE changing anything. If that copy can't be saved, the list is left
//     untouched.
//  3. "replace" with an EMPTY backup list over a non-empty current list is
//     refused — that would just erase data.
//  4. Each list is applied on its own, atomically; one failing list doesn't
//     stop or undo the others, and the report says exactly what happened.

export interface RestoreReportRow {
  id: string;
  status: 'restored' | 'unchanged' | 'skipped' | 'failed';
  before: number;
  after: number;
  added: number;       // merge: records added
  reason?: string;
}

export interface RestoreIO {
  readCurrent: (id: string) => Promise<any[]>;
  saveSafetyCopy: (id: string, current: any[], meta: { restoredFrom: string; mode: RestoreMode }) => Promise<void>;
  apply: (id: string, update: (current: any[]) => any[], allowEmpty: boolean) => Promise<any[]>;
}

export async function runRestore(args: {
  docs: Record<string, any[]>;
  names: string[];
  mode: RestoreMode;
  label: string;
  io: RestoreIO;
}): Promise<RestoreReportRow[]> {
  const { docs, names, mode, label, io } = args;
  const report: RestoreReportRow[] = [];
  const row = (r: Partial<RestoreReportRow> & { id: string; status: RestoreReportRow['status'] }): RestoreReportRow =>
    ({ before: 0, after: 0, added: 0, ...r });

  for (const id of names) {
    if (!BACKUP_DOC_IDS.includes(id)) { report.push(row({ id, status: 'skipped', reason: 'Not a restorable list.' })); continue; }
    const incoming = docs[id];
    if (!Array.isArray(incoming)) { report.push(row({ id, status: 'skipped', reason: 'This backup does not contain this list.' })); continue; }

    let current: any[];
    try {
      current = await io.readCurrent(id);
    } catch (err: any) {
      report.push(row({ id, status: 'failed', reason: `Could not read the current data, so nothing was changed. (${err?.message || err})` }));
      continue;
    }

    if (mode === 'replace' && incoming.length === 0 && current.length > 0) {
      report.push(row({ id, status: 'skipped', before: current.length, after: current.length, reason: 'The backup copy of this list is empty — refusing to erase the current records.' }));
      continue;
    }

    if (current.length > 0) {
      try {
        await io.saveSafetyCopy(id, current, { restoredFrom: label, mode });
      } catch (err: any) {
        report.push(row({ id, status: 'failed', before: current.length, after: current.length, reason: `Could not save a safety copy of the current data first, so nothing was changed. (${err?.message || err})` }));
        continue;
      }
    }

    try {
      let added = 0;
      const after = await io.apply(id, (cur) => {
        if (mode === 'merge') {
          const r = mergeById(cur, incoming);
          added = r.added;
          return r.merged;
        }
        added = 0;
        return incoming;
      }, mode === 'replace' && incoming.length === 0);
      const changed = mode === 'merge' ? added > 0 : JSON.stringify(after) !== JSON.stringify(current);
      report.push(row({ id, status: changed ? 'restored' : 'unchanged', before: current.length, after: after.length, added }));
    } catch (err: any) {
      report.push(row({ id, status: 'failed', before: current.length, after: current.length, reason: `Restore failed; the current data was left as it was. (${err?.message || err})` }));
    }
  }
  return report;
}

// ---------- automatic-backup list entries & error text (no Firebase needed) ----------

export interface AutoBackupMeta {
  id: string;
  status: 'running' | 'complete' | 'failed';
  trigger?: 'scheduled' | 'manual';
  date?: string;
  startedAt: string;
  finishedAt?: string;
  totalBytes?: number;
  sourceCount?: number;
  chunkCount?: number;
  error?: string;
  sources?: Record<string, { kind: string; chunks: number; bytes: number; count: number | null }>;
}

export function friendlyBackupError(err: any): string {
  const msg = String(err?.message || err || '');
  if (/permission|insufficient|denied/i.test(msg)) {
    return 'The app is not allowed to read the backups collection (system_backups) with the current database rules. The backups are still being saved safely on the server; the list just cannot be shown here.';
  }
  return msg || 'Unknown error.';
}
