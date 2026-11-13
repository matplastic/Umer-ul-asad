// Automatic database backup — shared by:
//   netlify/functions/daily-backup-background.cjs  (does the work; up to 15 minutes allowed)
//   netlify/functions/daily-backup-scheduled.cjs   (runs every night and starts the one above)
//
// WHAT IT SAVES
// A complete copy of the app's data, once a night (and on demand from
// Management -> Google Drive Backups -> "Back up now"):
//   * every document in system_state (materials, requests, ledgers, HR, QC …)
//     except the app's own safety copies and the recycle bin
//   * the pools, teams and plannedPools collections
//
// WHERE IT GOES
// Firestore collection `system_backups`:
//   system_backups/<backupId>                  small summary (status, time, sizes)
//   system_backups/<backupId>/chunks/<part>    the data, split into pieces under
//                                              Firestore's 1 MiB-per-document limit
//
// SAFETY RULES
//  * A backup only becomes "complete" after EVERY list was read and EVERY piece
//    was written. If anything fails it is marked "failed" and never offered.
//  * It refuses to save a backup when no data is found (wrong project / outage)
//    rather than saving an empty one that could push out real ones.
//  * It never overwrites an existing backup — each run is a new snapshot.
//  * Retention: newest snapshot of each of the last 14 days, plus the first
//    snapshot of each of the last 6 months. Older ones are deleted.

const BACKUP_COLLECTION = 'system_backups';
const COLLECTIONS = ['pools', 'teams', 'plannedPools'];          // stored one record per document
const EXCLUDED_PREFIXES = ['stageMergeBackup_', 'preRestore_'];  // the app's own safety copies
const EXCLUDED_IDS = new Set(['recycleBin']);
const CHUNK_CHARS = 300000;      // x up to 3 bytes (UTF-8) stays under 1 MiB
const WRITE_CONCURRENCY = 4;
const RECENT_GUARD_MS = 15 * 60 * 1000;
const STALE_RUNNING_MS = 3 * 60 * 60 * 1000;
const DAILY_KEEP = 14;
const MONTHLY_KEEP = 6;

function shouldExclude(id) {
  return EXCLUDED_IDS.has(id) || EXCLUDED_PREFIXES.some((p) => id.startsWith(p));
}

// Split text into pieces of at most `size` characters without cutting a
// two-part (surrogate pair) character in half — a lone half can't be stored.
function splitJson(json, size = CHUNK_CHARS) {
  const parts = [];
  let i = 0;
  while (i < json.length) {
    let end = Math.min(i + size, json.length);
    if (end < json.length) {
      const c = json.charCodeAt(end - 1);
      if (c >= 0xd800 && c <= 0xdbff) end -= 1;
      // Always move forward: if the piece would be empty, take the whole pair.
      if (end <= i) end = Math.min(i + 2, json.length);
    }
    parts.push(json.slice(i, end));
    i = end;
  }
  return parts.length ? parts : [''];
}

function chunkDocId(name, index) {
  return `${name.replace(/\//g, '_')}__${String(index).padStart(3, '0')}`;
}

// Decides which snapshots survive. `metas` = [{ id, date, status, startedAt, finishedAt }].
function selectKeep(metas, nowMs) {
  const complete = metas
    .filter((m) => m.status === 'complete')
    .sort((a, b) => String(b.finishedAt || '').localeCompare(String(a.finishedAt || '')));
  const keep = new Set();
  if (complete.length === 0) {                 // nothing trustworthy yet: delete nothing
    metas.forEach((m) => keep.add(m.id));
    return keep;
  }
  const perDate = new Map();                   // newest complete snapshot of each date
  for (const m of complete) if (!perDate.has(m.date)) perDate.set(m.date, m);
  const dates = [...perDate.keys()].sort().reverse();
  dates.slice(0, DAILY_KEEP).forEach((d) => keep.add(perDate.get(d).id));

  const byMonth = new Map();                   // first snapshot of each of the last N months
  for (const d of dates) {
    const mo = d.slice(0, 7);
    if (!byMonth.has(mo)) byMonth.set(mo, []);
    byMonth.get(mo).push(d);
  }
  [...byMonth.keys()].sort().reverse().slice(0, MONTHLY_KEEP).forEach((mo) => {
    const first = byMonth.get(mo).sort()[0];
    keep.add(perDate.get(first).id);
  });

  for (const m of metas) {                     // a backup that is still running right now
    if (m.status === 'running' && nowMs - Date.parse(m.startedAt || 0) < STALE_RUNNING_MS) keep.add(m.id);
  }
  return keep;
}

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  if (!getApps().length) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
    if (!projectId || !clientEmail || !privateKey) {
      throw new Error('Firebase Admin credentials are not configured (FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY).');
    }
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  }
  return getFirestore();
}

async function pool(items, limit, worker) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await worker(items[i]);
    }
  });
  await Promise.all(runners);
}

async function listMetas(db) {
  const snap = await db.collection(BACKUP_COLLECTION).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function applyRetention(db, nowMs) {
  const metas = await listMetas(db);
  const keep = selectKeep(metas, nowMs);
  const doomed = metas.filter((m) => !keep.has(m.id));
  for (const m of doomed) {
    await db.recursiveDelete(db.collection(BACKUP_COLLECTION).doc(m.id));
  }
  return doomed.length;
}

// `deps` lets tests supply a fake database.
async function runBackup({ trigger = 'scheduled', now = new Date(), deps = {} } = {}) {
  const db = deps.db || getAdminDb();
  const log = deps.log || console.log;
  const nowMs = now.getTime();

  // Don't pile up runs (e.g. someone pressing "Back up now" repeatedly).
  const existing = await listMetas(db);
  const recent = existing.find((m) => (m.status === 'running' || m.status === 'complete')
    && nowMs - Date.parse(m.startedAt || 0) < RECENT_GUARD_MS);
  if (recent) return { skipped: 'A backup was started in the last 15 minutes.', backupId: recent.id };

  const iso = now.toISOString();
  const backupId = 'bk_' + iso.replace(/[-:]/g, '').replace(/\.\d+/, '');   // bk_20261112T200003Z
  const metaRef = db.collection(BACKUP_COLLECTION).doc(backupId);
  await metaRef.set({ status: 'running', trigger, date: iso.slice(0, 10), startedAt: iso });

  try {
    // ---- 1. read everything first (nothing is written until all reads worked)
    const sources = [];     // { name, kind, json, count }
    const stateSnap = await db.collection('system_state').get();
    for (const d of stateSnap.docs) {
      if (shouldExclude(d.id)) continue;
      const payload = d.data();
      sources.push({ name: d.id, kind: 'doc', json: JSON.stringify(payload), count: Array.isArray(payload && payload.data) ? payload.data.length : null });
    }
    if (sources.length === 0) throw new Error('No data found in system_state — refusing to save an empty backup.');
    for (const col of COLLECTIONS) {
      const snap = await db.collection(col).get();
      const rows = snap.docs.map((d) => ({ __id: d.id, ...d.data() }));
      sources.push({ name: `col__${col}`, kind: 'collection', json: JSON.stringify(rows), count: rows.length });
    }

    // ---- 2. write the pieces
    const jobs = [];
    const summary = {};
    let totalBytes = 0;
    for (const s of sources) {
      const parts = splitJson(s.json);
      summary[s.name] = { kind: s.kind, chunks: parts.length, bytes: Buffer.byteLength(s.json, 'utf8'), count: s.count };
      totalBytes += summary[s.name].bytes;
      parts.forEach((json, index) => jobs.push({ name: s.name, kind: s.kind, index, total: parts.length, json }));
    }
    await pool(jobs, WRITE_CONCURRENCY, (j) =>
      metaRef.collection('chunks').doc(chunkDocId(j.name, j.index)).set({ name: j.name, kind: j.kind, index: j.index, total: j.total, json: j.json }));

    // ---- 3. only now is it a real backup
    await metaRef.update({
      status: 'complete', finishedAt: new Date().toISOString(),
      sources: summary, sourceCount: sources.length, chunkCount: jobs.length, totalBytes,
    });
    let removed = 0;
    try { removed = await applyRetention(db, nowMs); } catch (e) { log('[backup] retention step failed (backup itself is fine):', e && e.message); }
    log(`[backup] ${backupId} complete: ${sources.length} lists, ${jobs.length} parts, ${(totalBytes / 1048576).toFixed(2)} MB; old snapshots removed: ${removed}`);
    return { backupId, sources: sources.length, chunks: jobs.length, totalBytes, removed };
  } catch (err) {
    try { await metaRef.update({ status: 'failed', finishedAt: new Date().toISOString(), error: String((err && err.message) || err).slice(0, 500) }); } catch (_) { /* ignore */ }
    throw err;
  }
}

module.exports = { runBackup, selectKeep, splitJson, shouldExclude, chunkDocId, BACKUP_COLLECTION };
