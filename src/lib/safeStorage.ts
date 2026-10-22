// Makes localStorage writes resilient to "exceeded the quota" errors WITHOUT
// risking data loss.
//
// Background: the app mirrors cloud data (logs, pools, punches, defects ...)
// into localStorage as an offline cache. Browsers allow only ~5 MB, so on a
// busy device the cache fills up and any write (login, attendance upload,
// defect log) throws and blanks the screen.
//
// Rules this layer follows:
//  1. Anything that may exist ONLY on this device is never deleted: the login
//     session, the queue of Firestore writes that have not uploaded yet,
//     pending undo requests, station lock and settings.
//  2. Only pure cache copies of cloud data may be dropped to make room, largest
//     first, and never a cache whose collection still has an un-uploaded
//     (queued) write waiting.
//  3. If space still can't be found for a cache copy, the old copy is left
//     untouched and the app carries on (the cloud is the real copy).
//  4. If space can't be found for a protected key, the original error is
//     thrown as before, so nothing is silently dropped.

const PROTECTED = new Set([
  'apex_logged_in_user',
  'apex_pending_firestore_writes',
  'pending_undo_requests',
  'apex_station_lock',
  'mat_idle_timeout_min',
  'apex_gdrive_token',
  'apex_biocloud_url',
  'apex_biocloud_apikey',
  'apex_companies',
  'apex_custom_departments',
  'mat-erp-sidebar-collapsed',
]);

// Cache copies of data that lives in Firestore.
const CACHE_KEYS = [
  'apex_logs', 'apex_pools', 'apex_teams', 'apex_planned_pools',
  'apex_projects_summary', 'apex_employee_punches', 'apex_trolleys',
  'apex_qc_defects', 'apex_employees', 'apex_monthly_targets',
  'apex_inspectors', 'apex_engineers',
  'hr_warnings', 'hr_site_deployed', 'hr_purchase_requests', 'hr_payroll',
  'hr_medicals', 'hr_leaves', 'hr_accidents',
];

const norm = (s: string) =>
  s.toLowerCase().replace(/^apex_/, '').replace(/[_-]/g, '');

function install() {
  try {
    if (typeof Storage === 'undefined') return;
    const proto: any = Storage.prototype;
    if (proto.__matSafeSetItem) return;
    const original = proto.setItem;

    proto.setItem = function (key: string, value: string) {
      try {
        return original.call(this, key, value);
      } catch (err) {
        if (this !== window.localStorage) throw err;

        // Collections that still have an un-uploaded write waiting: keep their cache.
        const waiting = new Set<string>();
        try {
          const queue = JSON.parse(this.getItem('apex_pending_firestore_writes') || '[]');
          if (Array.isArray(queue)) queue.forEach((q: any) => q?.docName && waiting.add(norm(String(q.docName))));
        } catch { /* ignore */ }

        const candidates = CACHE_KEYS
          .filter(k => k !== key && !PROTECTED.has(k) && !waiting.has(norm(k)))
          .map(k => ({ k, size: (this.getItem(k) || '').length }))
          .filter(x => x.size > 0)
          .sort((a, b) => b.size - a.size);

        for (const c of candidates) {
          const backup = this.getItem(c.k);
          try { this.removeItem(c.k); } catch { continue; }
          try {
            original.call(this, key, value);
            console.warn(`[safeStorage] storage full — cleared cache "${c.k}" (${Math.round(c.size / 1024)} KB, re-downloads from cloud) to save "${key}"`);
            return;
          } catch {
            // Didn't free enough; keep going. (If we run out of candidates the
            // loop below restores nothing — caches are re-downloadable.)
            void backup;
          }
        }

        // No room found.
        if (PROTECTED.has(key) || key === 'apex_pending_firestore_writes') {
          // Never silently drop protected / un-uploaded data.
          throw err;
        }
        // Cache copy only: leave the previous copy in place and continue.
        console.warn(`[safeStorage] could not cache "${key}" locally; continuing (cloud copy is unaffected)`);
      }
    };
    proto.__matSafeSetItem = true;
  } catch { /* never block app start */ }
}

install();
