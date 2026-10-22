// Makes localStorage writes resilient to "exceeded the quota" errors.
//
// The app mirrors a lot of cloud data (logs, pools, punches, defects ...) into
// localStorage as an offline cache. Browsers allow only ~5 MB, so on a busy
// device the cache fills up and ANY write (login, attendance upload, defect
// log) throws and blanks the screen. Firestore is the real source of truth, so
// when the quota is hit we free space by dropping the largest cache entries
// (they are re-downloaded automatically) and retry. Login/session and any
// queued offline writes are never touched.

const EVICTABLE = [
  'apex_logs', 'apex_pools', 'apex_teams', 'apex_planned_pools',
  'apex_projects_summary', 'apex_employee_punches', 'apex_trolleys',
  'apex_qc_defects', 'apex_employees', 'apex_monthly_targets',
  'apex_inspectors', 'apex_engineers',
  'hr_warnings', 'hr_site_deployed', 'hr_purchase_requests', 'hr_payroll',
  'hr_medicals', 'hr_leaves', 'hr_accidents',
];

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
        // Only handle real storage-full errors, and only for localStorage.
        if (this !== window.localStorage) throw err;

        // Evict the largest cache entries first, retrying after each one.
        const candidates = EVICTABLE
          .filter(k => k !== key)
          .map(k => ({ k, size: (this.getItem(k) || '').length }))
          .filter(x => x.size > 0)
          .sort((a, b) => b.size - a.size);

        for (const c of candidates) {
          try { this.removeItem(c.k); } catch { /* ignore */ }
          try {
            original.call(this, key, value);
            console.warn(`[safeStorage] quota full — cleared cache "${c.k}" (${Math.round(c.size / 1024)} KB) to save "${key}"`);
            return;
          } catch { /* still full, keep evicting */ }
        }

        // Still no room (this one value is bigger than the whole quota).
        // Drop the stale copy so old data is not read back, and carry on —
        // the cloud copy is the real one.
        try { this.removeItem(key); } catch { /* ignore */ }
        console.warn(`[safeStorage] could not cache "${key}" locally; continuing without local copy`);
      }
    };
    proto.__matSafeSetItem = true;
  } catch { /* never block app start */ }
}

install();
