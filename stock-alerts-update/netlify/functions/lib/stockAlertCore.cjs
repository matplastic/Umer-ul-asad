// Shared logic for the stock-alert e-mails (Reorder Level / Urgent Level).
// Used by:
//   - netlify/functions/stock-alert-check.cjs      (called by the app right after stock changes)
//   - netlify/functions/stock-alert-scheduled.cjs  (safety net, every 15 minutes)
//
// HOW IT DECIDES WHEN TO E-MAIL
// For every material that is being "followed" (alertsEnabled !== false) we work
// out its status — same rule as src/lib/stockAlerts.ts:
//     stock <= urgentLevel  (and urgentLevel  > 0)  -> urgent
//     stock <= reorderLevel (and reorderLevel > 0)  -> reorder
//     otherwise                                     -> ok
// The last status we e-mailed about is remembered in Firestore
// (system_alerts/stockAlertState). We only send an e-mail when a material has
// become WORSE than what we last told you (ok -> reorder, ok -> urgent,
// reorder -> urgent). So you get ONE e-mail per crossing, not one every time
// the check runs. When stock is replenished (or following is switched off) the
// remembered status is cleared, so the next drop e-mails again.
//
// Env vars (Netlify -> Site settings -> Environment variables):
//   RESEND_API_KEY, STORE_EMAIL_FROM          (already used by the other functions)
//   STOCK_ALERT_EMAIL   comma-separated recipients for stock alerts; if not set,
//                       STORE_MANAGER_EMAIL is used
//   APP_BASE_URL        (optional) link target in the e-mail
//   FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY  (already set)

const SEVERITY = { ok: 0, reorder: 1, urgent: 2 };

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function statusOf(m) {
  const stock = num(m.currentStock);
  const urgent = num(m.urgentLevel);
  const reorder = num(m.reorderLevel);
  if (urgent > 0 && stock <= urgent) return 'urgent';
  if (reorder > 0 && stock <= reorder) return 'reorder';
  return 'ok';
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmt(n) {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
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

async function readMaterials(db) {
  // Materials live in ONE document: system_state/materials -> { data: [ ... ] }
  const snap = await db.collection('system_state').doc('materials').get();
  const data = snap.exists ? snap.data() : null;
  return Array.isArray(data && data.data) ? data.data : [];
}

function buildEmail(alerts, siteUrl) {
  const urgent = alerts.filter((a) => a.status === 'urgent');
  const reorder = alerts.filter((a) => a.status === 'reorder');

  const section = (title, color, list) => {
    if (list.length === 0) return '';
    const rows = list.map(({ m }) => `
      <tr>
        <td style="padding:7px 8px 7px 0; border-bottom:1px solid #e2e8f0;">
          <strong>${esc(m.name)}</strong>${m.erpCode ? `<div style="color:#94a3b8; font-size:11px;">${esc(m.erpCode)}</div>` : ''}
          ${m.supplierName ? `<div style="color:#94a3b8; font-size:11px;">Supplier: ${esc(m.supplierName)}</div>` : ''}
        </td>
        <td style="padding:7px 8px; border-bottom:1px solid #e2e8f0; text-align:right; white-space:nowrap; color:${color}; font-weight:700;">${esc(fmt(num(m.currentStock)))} ${esc(m.unit || '')}</td>
        <td style="padding:7px 0 7px 8px; border-bottom:1px solid #e2e8f0; text-align:right; white-space:nowrap; color:#64748b;">${num(m.reorderLevel) > 0 ? esc(fmt(num(m.reorderLevel))) : '—'} / ${num(m.urgentLevel) > 0 ? esc(fmt(num(m.urgentLevel))) : '—'}</td>
      </tr>`).join('');
    return `
      <h4 style="margin:22px 0 6px; color:${color}; font-size:14px; text-transform:uppercase; letter-spacing:0.04em;">${title} (${list.length})</h4>
      <table style="width:100%; border-collapse:collapse; font-size:13px;">
        <thead>
          <tr>
            <th style="text-align:left; padding:6px 8px 6px 0; border-bottom:2px solid ${color}; color:#64748b; font-size:10px; text-transform:uppercase;">Material</th>
            <th style="text-align:right; padding:6px 8px; border-bottom:2px solid ${color}; color:#64748b; font-size:10px; text-transform:uppercase;">In stock</th>
            <th style="text-align:right; padding:6px 0 6px 8px; border-bottom:2px solid ${color}; color:#64748b; font-size:10px; text-transform:uppercase;">Reorder / Urgent at</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  };

  const headline = urgent.length > 0
    ? `${urgent.length} material${urgent.length > 1 ? 's' : ''} at URGENT level${reorder.length ? `, ${reorder.length} below reorder level` : ''}`
    : `${reorder.length} material${reorder.length > 1 ? 's' : ''} below reorder level`;

  const subject = urgent.length > 0
    ? `URGENT stock alert: ${headline}`
    : `Stock alert: ${headline}`;

  const html = `
    <div style="font-family:Arial,sans-serif; max-width:600px; margin:0 auto; color:#1e293b;">
      <div style="background:#0f172a; padding:20px 24px; border-radius:10px 10px 0 0;">
        <h2 style="color:#fff; margin:0; font-size:15px; text-transform:uppercase;">MAT Plastic Industries LLC — Store</h2>
      </div>
      <div style="border:1px solid #e2e8f0; border-top:none; padding:24px; border-radius:0 0 10px 10px;">
        <h3 style="margin-top:0; color:${urgent.length ? '#dc2626' : '#b45309'};">${esc(headline)}</h3>
        <p style="color:#64748b; font-size:13px; margin:0;">These materials just dropped to or below their level. Please reorder.</p>
        ${section('Urgent reorder', '#dc2626', urgent)}
        ${section('Below reorder level', '#d97706', reorder)}
        ${siteUrl ? `<div style="margin-top:24px;"><a href="${esc(siteUrl)}" style="background:#0f172a; color:#fff; text-decoration:none; padding:11px 20px; border-radius:8px; font-weight:700; font-size:13px; display:inline-block;">Open ERP → Store → Reorder tab</a></div>` : ''}
        <p style="color:#94a3b8; font-size:12px; margin-top:20px;">You get one e-mail each time a material newly crosses a level. Switch off "following" on a material (bell icon in Store → Inventory) to stop its alerts.</p>
      </div>
    </div>`;

  return { subject, html };
}

async function sendViaResend({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || to.length === 0) {
    console.warn('[stock-alert] RESEND_API_KEY or recipient (STOCK_ALERT_EMAIL / STORE_MANAGER_EMAIL) not set — alert NOT sent; it will be retried on the next check.');
    return { skipped: true };
  }
  const from = process.env.STORE_EMAIL_FROM || 'MAT Plastic Store <onboarding@resend.dev>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Resend error ${res.status}: ${detail}`);
  }
  return { sent: true };
}

function recipients() {
  return (process.env.STOCK_ALERT_EMAIL || process.env.STORE_MANAGER_EMAIL || '')
    .split(',').map((e) => e.trim()).filter(Boolean);
}

// `deps` exists so the logic can be tested without Firestore / Resend.
async function runStockAlertCheck({ siteUrl = '', deps = {} } = {}) {
  const db = deps.db || getAdminDb();
  const send = deps.send || sendViaResend;

  const materials = await readMaterials(db);
  // An empty/missing list is far more likely a read problem than "no
  // materials" — don't touch the remembered state in that case.
  if (materials.length === 0) return { checked: 0, alerted: 0, skipped: 'no materials' };

  // Currently-low materials that are being followed.
  const low = new Map();
  for (const m of materials) {
    if (!m || !m.id) continue;
    if (m.alertsEnabled === false) continue;
    const status = statusOf(m);
    if (status !== 'ok') low.set(String(m.id), { m, status });
  }

  const stateRef = db.collection('system_alerts').doc('stockAlertState');
  let alerts = [];
  let prevItems = {};

  // Claim the crossings inside a transaction first, so two overlapping runs
  // (app trigger + scheduled run, or two devices) can't both e-mail the same one.
  await db.runTransaction(async (tx) => {
    alerts = [];
    const snap = await tx.get(stateRef);
    prevItems = (snap.exists && snap.data() && snap.data().items) || {};
    const next = {};
    for (const [id, { m, status }] of low) {
      next[id] = status;
      if ((SEVERITY[status] || 0) > (SEVERITY[prevItems[id]] || 0)) {
        alerts.push({ id, m, status });
      }
    }
    tx.set(stateRef, { items: next, updatedAt: new Date().toISOString() });
  });

  if (alerts.length === 0) return { checked: materials.length, alerted: 0 };

  // Urgent first, then by name.
  alerts.sort((a, b) => (SEVERITY[b.status] - SEVERITY[a.status]) || String(a.m.name).localeCompare(String(b.m.name)));

  const { subject, html } = buildEmail(alerts, siteUrl);
  let result;
  try {
    result = await send({ to: recipients(), subject, html });
  } catch (err) {
    await rollback(db, stateRef, alerts, prevItems);
    throw err;
  }
  if (result && result.skipped) {
    await rollback(db, stateRef, alerts, prevItems);
    return { checked: materials.length, alerted: 0, skipped: 'e-mail not configured' };
  }

  return { checked: materials.length, alerted: alerts.length, urgent: alerts.filter((a) => a.status === 'urgent').length };
}

// Put the remembered status of the materials we failed to e-mail about back
// to what it was, so the next check tries again.
async function rollback(db, stateRef, alerts, prevItems) {
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(stateRef);
      const items = { ...((snap.exists && snap.data() && snap.data().items) || {}) };
      for (const { id } of alerts) {
        if (prevItems[id]) items[id] = prevItems[id]; else delete items[id];
      }
      tx.set(stateRef, { items, updatedAt: new Date().toISOString() });
    });
  } catch (e) {
    console.error('[stock-alert] rollback failed:', e);
  }
}

module.exports = { runStockAlertCheck, statusOf, buildEmail };
