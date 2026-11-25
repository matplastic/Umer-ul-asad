'use strict';
// "Already today" information for the manager's material-request approval.
//
// For one requested line, answers: has this SAME material already been
// requested / approved today by anybody — how many times, and how much did the
// manager already approve? "Today" is the UAE calendar day (Asia/Dubai, UTC+4,
// no daylight saving), so everything resets at 00:00 UAE time — not UTC and not
// the manager's phone time.
//
//   requested today : requests CREATED today (any status)
//   approved today  : requests APPROVED today (decision time), qty = approved
//                     qty (partial approvals count only what was approved)
//
// The batch the manager is looking at right now is left out, so the numbers
// mean "before this request".

const TZ = 'Asia/Dubai';
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const labelFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: 'short' });

const APPROVED = new Set(['APPROVED', 'PRINTED', 'DELIVERED']);

// Every request type is turned into the same small shape first, so one piece of
// logic serves Store material requests AND the Supervisor / HR purchase
// requests (office items such as pens, tools, stationery…).
const normStatus = (s) => String(s == null ? '' : s).toUpperCase();
const fromMaterial = (r) => ({
  id: r.id, batchId: r.batchId || null, keyId: r.materialId || '', name: r.materialName, unit: r.unit,
  qtyRequested: r.qtyRequested, qtyApproved: r.qtyApproved, status: normStatus(r.status),
  by: r.requestedByName || '', source: '', createdAt: r.createdAt, decidedAt: r.decidedAt,
});
const fromPurchase = (r, source) => ({
  id: r.id, batchId: r.batchId || null, keyId: r.erpCode || '', name: r.itemName, unit: r.unit,
  qtyRequested: r.qty, qtyApproved: r.qtyApproved, status: normStatus(r.status),
  by: r.requestedByName || '', source, createdAt: r.requestedAt || r.createdAt, decidedAt: r.decidedAt,
});

const toDate = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};
const uaeDay = (iso) => { const d = toDate(iso); return d ? dayFmt.format(d) : ''; };
const uaeTime = (iso) => { const d = toDate(iso); return d ? timeFmt.format(d) : ''; };
const norm = (s) => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
const approvedQtyOf = (r) => Number(r.qtyApproved != null ? r.qtyApproved : r.qtyRequested) || 0;
const fmtQty = (n) => String(Math.round((Number(n) || 0) * 1000) / 1000);

// Same item = same code (material id / ERP code) or the same name.
function sameItem(a, b) {
  if (a.keyId && b.keyId && a.keyId === b.keyId) return true;
  return norm(a.name) !== '' && norm(a.name) === norm(b.name);
}

// Core: `all` and `item` are already normalised.
function usageFor(all, item, now = new Date()) {
  const today = uaeDay(now.toISOString());
  const others = (all || []).filter((r) =>
    r.id !== item.id &&
    !(item.batchId && r.batchId === item.batchId) &&
    sameItem(r, item));

  const requestedToday = others.filter((r) => uaeDay(r.createdAt) === today);
  const approvedToday = others.filter((r) => APPROVED.has(r.status) && uaeDay(r.decidedAt || r.createdAt) === today);

  const seen = new Set();
  const lines = [];
  for (const r of [...requestedToday, ...approvedToday]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const askedToday = uaeDay(r.createdAt) === today;
    lines.push({
      at: askedToday ? r.createdAt : (r.decidedAt || r.createdAt),
      earlierDay: !askedToday,
      by: `${r.by || ''}${r.source ? ` (${r.source})` : ''}`.trim(),
      qtyRequested: Number(r.qtyRequested) || 0,
      status: r.status,
      qtyApproved: APPROVED.has(r.status) ? approvedQtyOf(r) : null,
    });
  }
  lines.sort((x, y) => (x.at < y.at ? -1 : 1));

  return {
    unit: item.unit || '',
    dayLabel: labelFmt.format(now),
    requestCount: requestedToday.length,
    approvedCount: approvedToday.length,
    approvedQty: approvedToday.reduce((t, r) => t + approvedQtyOf(r), 0),
    pendingCount: requestedToday.filter((r) => r.status === 'PENDING').length,
    rejectedCount: requestedToday.filter((r) => r.status === 'REJECTED').length,
    lines,
  };
}

// Store material requests (one list).
function usageToday(allRaw, itemRaw, now = new Date()) {
  return usageFor((allRaw || []).map(fromMaterial), fromMaterial(itemRaw), now);
}

// Supervisor + HR purchase requests: an item (e.g. "pen") can come from either
// portal, so both lists are checked together and each earlier line says which.
function purchaseUsage(supervisorRows, hrRows, itemRaw, now = new Date()) {
  const all = [
    ...(supervisorRows || []).map((r) => fromPurchase(r, 'Supervisor')),
    ...(hrRows || []).map((r) => fromPurchase(r, 'HR')),
  ];
  return usageFor(all, fromPurchase(itemRaw, ''), now);
}

const hasUsage = (u) => !!u && (u.requestCount > 0 || u.approvedCount > 0);

// Inline-styled HTML (works in the decision page and in e-mail clients).
function usageHtml(u, esc) {
  if (!hasUsage(u)) return '';
  const unit = esc(u.unit);
  const bits = [];
  if (u.requestCount > 0) bits.push(`requested <strong>${u.requestCount}×</strong>`);
  if (u.approvedCount > 0) bits.push(`<strong>${esc(fmtQty(u.approvedQty))} ${unit}</strong> already approved`);
  else if (u.requestCount > 0) bits.push('nothing approved yet');
  const rows = u.lines.map((l) => {
    const state = APPROVED.has(l.status)
      ? `<span style="color:#16a34a; font-weight:600;">approved ${esc(fmtQty(l.qtyApproved))} ${unit}</span>`
      : l.status === 'REJECTED'
        ? '<span style="color:#dc2626; font-weight:600;">rejected</span>'
        : '<span style="color:#b45309; font-weight:600;">pending</span>';
    const when = l.earlierDay ? `${esc(uaeTime(l.at))} (asked earlier)` : esc(uaeTime(l.at));
    return `<div style="font-size:11px; color:#78350f; margin-top:2px;">${when} · ${esc(l.by || '—')} · asked ${esc(fmtQty(l.qtyRequested))} ${unit} → ${state}</div>`;
  }).join('');
  return `<div style="margin-top:6px; padding:6px 8px; background:#fffbeb; border:1px solid #fcd34d; border-radius:6px; font-size:12px; color:#92400e;">
    ⚠ Already today (${esc(u.dayLabel)}, UAE time): ${bits.join(' · ')}${rows}
  </div>`;
}

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  if (!getApps().length) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
    if (!projectId || !clientEmail || !privateKey) {
      throw new Error('Firebase Admin credentials are not configured.');
    }
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  }
  return getFirestore();
}

// The two purchase-request lists live as plain documents in system_state.
async function readPurchaseLists(db) {
  const read = async (name) => {
    const snap = await db.collection('system_state').doc(name).get();
    return snap.exists && Array.isArray(snap.data().data) ? snap.data().data : [];
  };
  const [supervisor, hr] = await Promise.all([read('supervisorPurchaseRequests'), read('hrPurchaseRequests')]);
  return { supervisor, hr };
}

module.exports = { usageToday, purchaseUsage, readPurchaseLists, usageHtml, hasUsage, uaeDay, getAdminDb };
