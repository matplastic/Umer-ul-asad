'use strict';
// HR expiry reminders — shared logic.
// Used by:
//   netlify/functions/hr-expiry-scheduled.cjs  (runs every morning, see netlify.toml)
//   netlify/functions/hr-expiry-run.cjs        (the HR screen's "Check now / Send test / Send now" buttons)
//
// WHAT IT WATCHES (each can be switched on/off in HR Executive → Expiry Reminders)
//   passports, visas, Emirates ID, labour cards, other documents (HR document tracker),
//   training certificates, PPE replacement dates, probation / contract end dates,
//   vehicle registration + insurance, vehicle service due dates.
//
// WHEN IT E-MAILS
//   Each item belongs to a "window": 60, 30, 14, 7, 0 days left (configurable) or "expired".
//   An e-mail goes out when an item ENTERS a new, more urgent window — so you get one
//   reminder per window, not one every morning. Expired items are repeated every N days
//   (default 7) until they are renewed. Renewing an item (new date) starts a fresh cycle.
//   What was already e-mailed is remembered in Firestore: system_alerts/hrExpiryState.
//
// Env vars (Netlify → Site settings → Environment variables):
//   RESEND_API_KEY                        (already used by the other functions)
//   HR_EMAIL_FROM                         optional; falls back to STORE_EMAIL_FROM
//   HR_EXPIRY_EMAIL (or HR_MANAGER_EMAIL) fallback recipients (comma separated) when none are set in the app
//   APP_BASE_URL                          optional link in the e-mail
//   FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY  (already set)

const CATEGORY_LABELS = {
  passport: 'Passports', visa: 'Visas', eid: 'Emirates ID', labour: 'Labour cards', document: 'Other documents',
  training: 'Training certificates', ppe: 'PPE replacement', probation: 'Probation ending', contract: 'Contracts ending',
  vehicle: 'Vehicle registration & insurance', service: 'Vehicle service due',
};
const DEFAULTS = {
  enabled: true, recipients: [], daysBefore: [60, 30, 14, 7, 0], reRemindExpiredEveryDays: 7,
  categories: Object.fromEntries(Object.keys(CATEGORY_LABELS).map((k) => [k, true])),
};

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());

// "Today" in the UAE (UTC+4, no daylight saving), as yyyy-mm-dd.
function uaeToday(now = new Date()) {
  return new Date(now.getTime() + 4 * 3600 * 1000).toISOString().slice(0, 10);
}
function daysBetween(a, b) { // whole days from a to b (b - a)
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}
function fmtDate(iso) {
  if (!isDate(iso)) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// ─── Which window an item is in ─────────────────────────────
const EXPIRED_SEVERITY = 2000;
function windowFor(daysLeft, thresholds) {
  if (daysLeft < 0) return { bucket: 'expired', severity: EXPIRED_SEVERITY };
  const sorted = [...thresholds].filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  const t = sorted.find((n) => daysLeft <= n);          // smallest window that still contains it
  if (t === undefined) return null;                     // farther away than the widest window
  return { bucket: `T${t}`, severity: 1000 - t };
}

// ─── Gather the things to watch ─────────────────────────────
const DOC_CAT = { passport: 'passport', visa: 'visa', emiratesid: 'eid', labourcard: 'labour' };
const canon = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

function computeItems(data, today, settings) {
  const cfg = { ...DEFAULTS, ...settings, categories: { ...DEFAULTS.categories, ...((settings && settings.categories) || {}) } };
  const employees = Array.isArray(data.employees) ? data.employees : [];
  const profiles = new Map((data.profiles || []).map((p) => [p.id, p]));
  const isActive = (id) => { const s = profiles.get(id) && profiles.get(id).status; return !s || s === 'Active'; };
  const nameOf = new Map(employees.map((e) => [e.id, e.name]));
  const items = [];
  const add = (category, ownerId, who, what, date, detail) => {
    if (!cfg.categories[category] || !isDate(date)) return;
    const daysLeft = daysBetween(today, date);
    items.push({ key: `${category}|${ownerId}|${canon(what)}|${date}`, category, categoryLabel: CATEGORY_LABELS[category], who, what, date, daysLeft, detail: detail || '' });
  };

  const docs = (data.documents || []).filter((d) => isActive(d.employeeId));
  const hasDoc = (empId, cat) => docs.some((d) => d.employeeId === empId && DOC_CAT[canon(d.docType)] === cat);

  for (const e of employees) {
    if (!isActive(e.id)) continue;
    const p = profiles.get(e.id) || {};
    if (!hasDoc(e.id, 'passport')) add('passport', e.id, e.name, 'Passport', e.passportExpiryDate, e.passportNumber ? `No. ${e.passportNumber}` : '');
    if (!hasDoc(e.id, 'visa')) add('visa', e.id, e.name, 'Visa', e.visaExpiryDate, '');
    if (!hasDoc(e.id, 'eid')) add('eid', e.id, e.name, 'Emirates ID', p.emiratesIdExpiry, p.emiratesId ? `No. ${p.emiratesId}` : '');
    if (!hasDoc(e.id, 'labour')) add('labour', e.id, e.name, 'Labour card', p.labourCardExpiry, p.labourCardNo ? `No. ${p.labourCardNo}` : '');
    add('probation', e.id, e.name, 'Probation ends', p.probationEndDate, 'Review due');
    add('contract', e.id, e.name, 'Contract ends', p.contractEndDate, '');
  }
  for (const d of docs) {
    const cat = DOC_CAT[canon(d.docType)] || 'document';
    add(cat, d.employeeId, d.employeeName || nameOf.get(d.employeeId) || 'Employee', d.docType, d.expiryDate, d.docNumber ? `No. ${d.docNumber}` : '');
  }
  // training: only the newest certificate of each course per person counts
  const newestTraining = new Map();
  for (const t of data.training || []) {
    if (!isActive(t.employeeId)) continue;
    const k = `${t.employeeId}|${canon(t.course)}`;
    const cur = newestTraining.get(k);
    if (!cur || String(t.completedDate) > String(cur.completedDate)) newestTraining.set(k, t);
  }
  for (const t of newestTraining.values()) add('training', t.employeeId, t.employeeName || nameOf.get(t.employeeId) || 'Employee', t.course, t.expiryDate, t.certificateNo ? `Cert. ${t.certificateNo}` : '');
  for (const p of data.ppe || []) {
    if (p.returnedDate || !isActive(p.employeeId)) continue;
    add('ppe', p.employeeId, p.employeeName || nameOf.get(p.employeeId) || 'Employee', `${p.item} replacement`, p.replaceDueDate, '');
  }
  for (const v of data.vehicles || []) {
    if (v.status === 'Sold') continue;
    add('vehicle', v.id, v.plate, 'Registration (Mulkiya)', v.registrationExpiry, `${v.make || ''} ${v.model || ''}`.trim());
    add('vehicle', v.id, v.plate, 'Insurance', v.insuranceExpiry, v.insuranceCompany || '');
  }
  const newestService = new Map();
  for (const s of data.services || []) {
    const k = `${s.vehicleId}|${canon(s.type)}`;
    const cur = newestService.get(k);
    if (!cur || String(s.date) > String(cur.date)) newestService.set(k, s);
  }
  for (const s of newestService.values()) add('service', s.vehicleId, s.plate, `${s.type} due`, s.nextDueDate, '');

  return items.sort((a, b) => a.daysLeft - b.daysLeft);
}

// ─── Decide what is new ─────────────────────────────────────
function decide(items, state, settings, today) {
  const cfg = { ...DEFAULTS, ...settings };
  const thresholds = cfg.daysBefore && cfg.daysBefore.length ? cfg.daysBefore : DEFAULTS.daysBefore;
  const reRemind = Math.max(1, Number(cfg.reRemindExpiredEveryDays) || 7);
  return items.map((it) => {
    const w = windowFor(it.daysLeft, thresholds);
    const prior = state[it.key];
    let willSend = false, why = '';
    if (!w) why = 'Not within the reminder window yet';
    else if (!prior) { willSend = true; why = 'First reminder'; }
    else if (w.severity > prior.severity) { willSend = true; why = 'Now more urgent'; }
    else if (w.bucket === 'expired' && isDate(prior.lastSentDate) && daysBetween(prior.lastSentDate, today) >= reRemind) { willSend = true; why = `Still expired — repeating every ${reRemind} days`; }
    else why = 'Already reminded';
    return { ...it, bucket: w ? w.bucket : null, severity: w ? w.severity : 0, willSend, why };
  });
}

// ─── The e-mail ─────────────────────────────────────────────
function buildEmail(items, { siteUrl, note } = {}) {
  const expired = items.filter((i) => i.daysLeft < 0).length;
  const soon = items.length - expired;
  const subject = `HR reminders — ${expired ? `${expired} expired` : ''}${expired && soon ? ', ' : ''}${soon ? `${soon} due soon` : ''}`.replace(/— $/, '— nothing due');
  const cats = [...new Set(items.map((i) => i.category))];
  const tone = (d) => (d < 0 ? '#dc2626' : d <= 7 ? '#ea580c' : d <= 30 ? '#ca8a04' : '#475569');
  const badge = (d) => (d < 0 ? `Expired ${-d} day${-d === 1 ? '' : 's'} ago` : d === 0 ? 'Expires today' : `${d} day${d === 1 ? '' : 's'} left`);
  const sections = cats.map((c) => {
    const rows = items.filter((i) => i.category === c).map((i) => `
      <tr>
        <td style="padding:7px 10px;border-bottom:1px solid #e2e8f0"><b>${esc(i.who)}</b>${i.detail ? `<br><span style="color:#94a3b8;font-size:12px">${esc(i.detail)}</span>` : ''}</td>
        <td style="padding:7px 10px;border-bottom:1px solid #e2e8f0">${esc(i.what)}</td>
        <td style="padding:7px 10px;border-bottom:1px solid #e2e8f0;white-space:nowrap">${fmtDate(i.date)}</td>
        <td style="padding:7px 10px;border-bottom:1px solid #e2e8f0;white-space:nowrap;color:${tone(i.daysLeft)};font-weight:700">${badge(i.daysLeft)}</td>
      </tr>`).join('');
    return `<h3 style="margin:22px 0 6px;font-size:14px;color:#334155">${esc(CATEGORY_LABELS[c] || c)} (${items.filter((i) => i.category === c).length})</h3>
      <table style="border-collapse:collapse;width:100%;font-size:13px;color:#0f172a">
        <thead><tr style="background:#f1f5f9;text-align:left;font-size:11px;text-transform:uppercase;color:#64748b"><th style="padding:6px 10px">Who / what</th><th style="padding:6px 10px">Item</th><th style="padding:6px 10px">Date</th><th style="padding:6px 10px">Status</th></tr></thead>
        <tbody>${rows}</tbody></table>`;
  }).join('');
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:720px;margin:auto;color:#0f172a">
    <div style="background:#0f766e;color:#fff;padding:14px 18px;border-radius:10px 10px 0 0"><div style="font-size:12px;opacity:.8">MAT Plastic Industries LLC · Human Resources</div><div style="font-size:18px;font-weight:700">Expiry reminders</div></div>
    <div style="border:1px solid #e2e8f0;border-top:0;padding:16px 18px;border-radius:0 0 10px 10px">
      ${note ? `<p style="background:#fefce8;border:1px solid #fde68a;padding:8px 12px;border-radius:8px;font-size:13px">${esc(note)}</p>` : ''}
      <p style="font-size:14px;margin:0 0 4px">${expired ? `<b style="color:#dc2626">${expired} expired</b>` : ''}${expired && soon ? ' · ' : ''}${soon ? `<b>${soon} coming up</b>` : ''}${!items.length ? 'Nothing is due right now.' : ''}</p>
      ${sections}
      <p style="margin-top:24px;font-size:12px;color:#94a3b8">Sent automatically every morning. Recipients, reminder days and categories can be changed in HR Executive → Expiry Reminders.${siteUrl ? ` <a href="${esc(siteUrl)}" style="color:#0f766e">Open MAT-ERP</a>` : ''}</p>
    </div></div>`;
  return { subject, html };
}

// ─── Plumbing (Firestore + Resend) ──────────────────────────
function getAdminDb() { return require('./dailyRequestUsage.cjs').getAdminDb(); }

async function readCollection(db, name) {
  const snap = await db.collection(name).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function loadData(db) {
  const { readArray } = require('./shardedState.cjs');
  const [employees, profiles, documents, training, ppe, vehicles, services] = await Promise.all([
    readArray(db, 'employees'), readCollection(db, 'hrProfiles'), readCollection(db, 'hrDocuments'), readCollection(db, 'hrTraining'),
    readCollection(db, 'hrPPE'), readCollection(db, 'hrVehicles'), readCollection(db, 'hrVehicleService'),
  ]);
  return { employees, profiles, documents, training, ppe, vehicles, services };
}

async function loadSettings(db) {
  const snap = await db.collection('system_state').doc('hrReminderSettings').get();
  const d = snap.exists ? snap.data() : {};
  return { ...DEFAULTS, ...d, categories: { ...DEFAULTS.categories, ...(d.categories || {}) }, recipients: Array.isArray(d.recipients) ? d.recipients : [], daysBefore: Array.isArray(d.daysBefore) && d.daysBefore.length ? d.daysBefore : DEFAULTS.daysBefore };
}

function recipientsFor(settings) {
  const fromApp = (settings.recipients || []).map((s) => String(s).trim()).filter(isEmail);
  if (fromApp.length) return fromApp;
  // No recipients saved in the app → fall back to Netlify settings (HR_EXPIRY_EMAIL, else the HR manager address already used by HR purchase requests)
  return String(process.env.HR_EXPIRY_EMAIL || process.env.HR_MANAGER_EMAIL || '').split(',').map((s) => s.trim()).filter(isEmail);
}

async function sendMail({ to, subject, html }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('E-mail is not set up: RESEND_API_KEY is missing in Netlify.');
  const from = process.env.HR_EMAIL_FROM || process.env.STORE_EMAIL_FROM || 'MAT HR <onboarding@resend.dev>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!res.ok) throw new Error(`E-mail service refused the message (${res.status}): ${(await res.text()).slice(0, 200)}`);
}

/**
 * mode: 'preview' (nothing sent) | 'test' (one test mail, no memory) | 'send' / 'scheduled' (real run)
 * force: with 'send', e-mail EVERYTHING currently inside a window, not only newly-crossed items.
 */
async function runHrExpiryCheck({ mode = 'scheduled', force = false, siteUrl = '', now = new Date() } = {}) {
  const db = getAdminDb();
  const today = uaeToday(now);
  const settings = await loadSettings(db);
  const status = { emailConfigured: !!process.env.RESEND_API_KEY, recipients: recipientsFor(settings).length, today };

  if (mode === 'scheduled' && !settings.enabled) return { ok: true, skipped: 'Reminders are switched off', ...status };

  const data = await loadData(db);
  const items = computeItems(data, today, settings);
  const stateSnap = await db.collection('system_alerts').doc('hrExpiryState').get();
  const state = (stateSnap.exists && stateSnap.data().sent) || {};
  const decided = decide(items, state, settings, today);
  const windowed = decided.filter((i) => i.bucket);
  const summary = { total: windowed.length, expired: windowed.filter((i) => i.daysLeft < 0).length, willSend: decided.filter((i) => i.willSend).length };

  if (mode === 'preview') return { ok: true, items: decided, summary, ...status };

  const to = recipientsFor(settings);
  if (mode === 'test') {
    if (!to.length) throw new Error('Add at least one recipient e-mail address first.');
    const sample = windowed.slice(0, 15);
    const { subject, html } = buildEmail(sample, { siteUrl, note: 'This is a TEST e-mail — nothing was recorded as reminded.' });
    await sendMail({ to, subject: `[TEST] ${subject}`, html });
    return { ok: true, sent: sample.length, to, summary, ...status };
  }

  const toSend = force ? windowed : decided.filter((i) => i.willSend);
  const stamp = async (sentCount, note) => {
    await db.collection('system_state').doc('hrReminderSettings').set({ lastRunAt: new Date().toISOString(), lastRunSent: sentCount, lastRunDue: summary.total, lastRunNote: note || '' }, { merge: true });
  };
  if (!toSend.length) { await stamp(0, 'Nothing new to remind'); return { ok: true, sent: 0, message: 'Nothing new to send.', summary, ...status }; }
  if (!to.length) { await stamp(0, 'No recipients set'); throw new Error('No recipient e-mail addresses are set (Expiry Reminders → Recipients).'); }

  const { subject, html } = buildEmail(toSend, { siteUrl, note: force ? 'Full summary of everything currently due.' : '' });
  await sendMail({ to, subject, html });

  const next = {};
  for (const it of decided) { if (state[it.key]) next[it.key] = state[it.key]; }       // forget items that were renewed / removed
  for (const it of toSend) next[it.key] = { bucket: it.bucket, severity: it.severity, lastSentDate: today };
  await db.collection('system_alerts').doc('hrExpiryState').set({ sent: next, updatedAt: new Date().toISOString() });
  await stamp(toSend.length, force ? 'Full summary sent' : 'Reminders sent');
  return { ok: true, sent: toSend.length, to, summary, ...status };
}

module.exports = { runHrExpiryCheck, computeItems, decide, windowFor, buildEmail, uaeToday, daysBetween, CATEGORY_LABELS, DEFAULTS };
