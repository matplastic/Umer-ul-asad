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

const toDate = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};
const uaeDay = (iso) => { const d = toDate(iso); return d ? dayFmt.format(d) : ''; };
const uaeTime = (iso) => { const d = toDate(iso); return d ? timeFmt.format(d) : ''; };
const norm = (s) => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
const approvedQtyOf = (r) => Number(r.qtyApproved != null ? r.qtyApproved : r.qtyRequested) || 0;
const fmtQty = (n) => String(Math.round((Number(n) || 0) * 1000) / 1000);

function sameMaterial(a, b) {
  if (a.materialId && b.materialId) return a.materialId === b.materialId;
  return norm(a.materialName) !== '' && norm(a.materialName) === norm(b.materialName);
}

// All requests (array already read from Firestore) + the line being decided.
function usageToday(all, item, now = new Date()) {
  const today = uaeDay(now.toISOString());
  const others = (all || []).filter((r) =>
    r.id !== item.id &&
    !(item.batchId && r.batchId === item.batchId) &&
    sameMaterial(r, item));

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
      by: r.requestedByName || '',
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

module.exports = { usageToday, usageHtml, hasUsage, uaeDay, getAdminDb };
