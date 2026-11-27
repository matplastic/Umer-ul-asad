'use strict';
// Daily Store report e-mail: what was CONSUMED, what was RECEIVED (incoming material),
// and what the stock is NOW — one e-mail every morning, with an Excel attachment that has
// the full detail (every consumption line, every receipt, the whole stock list).
//
// Used by:
//   netlify/functions/daily-report-scheduled.cjs   (every morning, schedule is in netlify.toml)
//   netlify/functions/daily-report-run.cjs         (open a link to preview it / send it right now)
//
// WHICH DAY DOES IT COVER?
//   scheduled run (07:00 UAE)  -> YESTERDAY (a complete working day, UAE time)
//   manual run                 -> today by default, or ?day=YYYY-MM-DD
// "Current stock" is always the stock at the moment the report is made.
//
// WHAT COUNTS AS WHAT
//   Consumption = Consumption Logs dated that day. Entries that were later reversed by a
//                 Return-to-Store are left out of the totals (and the e-mail says how many).
//   Incoming    = Incoming Material receipts whose receive date is that day (any QC status).
//   Pending QC  = every receipt still waiting for / held at quality inspection, any date.
//
// Env vars (Netlify -> Site settings -> Environment variables):
//   RESEND_API_KEY, STORE_EMAIL_FROM   (already used by the other e-mails)
//   DAILY_REPORT_EMAIL                 comma-separated recipients (default: umerulasad@gmail.com)
//   DAILY_REPORT_KEY                   secret for the "send / preview now" link (optional)
//   APP_BASE_URL                       (optional) link target in the e-mail
//   FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY (already set)

const { readArray } = require('./shardedState.cjs');
const { getAdminDb, uaeDay } = require('./dailyRequestUsage.cjs');

const DEFAULT_RECIPIENTS = ['umerulasad@gmail.com'];

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
const norm = (s) => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');

// ── day helpers (UAE calendar day, no daylight saving) ───────────────────────
const addDays = (ymd, delta) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
};
const dayLabel = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
};
const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

// Same rule as src/lib/stockAlerts.ts and the stock-alert e-mails.
function stockStatus(m) {
  const stock = num(m.currentStock), urgent = num(m.urgentLevel), reorder = num(m.reorderLevel);
  if (urgent > 0 && stock <= urgent) return 'urgent';
  if (reorder > 0 && stock <= reorder) return 'reorder';
  return 'ok';
}

const QC_LABEL = { pending: 'Awaiting QC', partial: 'Part inspected', passed: 'Passed', failed: 'Rejected', hold: 'On hold', mixed: 'Passed / rejected' };

// ── the numbers ──────────────────────────────────────────────────────────────
function buildReport({ day, materials, logs, incoming, now = new Date() }) {
  const matById = new Map(materials.map((m) => [String(m.id), m]));

  // consumption of the day
  const dayLogs = logs.filter((l) => l && (isYmd(l.date) ? l.date : uaeDay(l.createdAt)) === day);
  const live = dayLogs.filter((l) => !l.reversed);
  const reversedCount = dayLogs.length - live.length;
  const byMat = new Map();
  for (const l of live) {
    const key = `${l.materialId || norm(l.materialName)}|${norm(l.unit)}`;
    const row = byMat.get(key) || { materialId: l.materialId, name: l.materialName, unit: l.unit, qty: 0, entries: 0, sections: new Map() };
    row.qty += num(l.qty); row.entries += 1;
    const sec = l.sectionName || 'Other';
    row.sections.set(sec, (row.sections.get(sec) || 0) + num(l.qty));
    byMat.set(key, row);
  }
  const consumption = Array.from(byMat.values()).map((r) => {
    const m = matById.get(String(r.materialId));
    return {
      ...r,
      sections: Array.from(r.sections.entries()).sort((a, b) => b[1] - a[1]).map(([name, qty]) => ({ name, qty })),
      stock: m ? num(m.currentStock) : null,
      status: m ? stockStatus(m) : 'ok',
    };
  }).sort((a, b) => String(a.name).localeCompare(String(b.name)));

  // incoming of the day + everything still waiting for QC
  const received = incoming.filter((r) => r && uaeDay(r.receivedAt) === day)
    .sort((a, b) => String(a.materialName).localeCompare(String(b.materialName)));
  const pendingQc = incoming.filter((r) => r && ['pending', 'partial', 'hold'].includes(r.qcStatus))
    .sort((a, b) => String(a.receivedAt || '').localeCompare(String(b.receivedAt || '')));

  // stock now
  const stockRows = materials.filter((m) => m && m.id).map((m) => ({ m, status: stockStatus(m) }))
    .sort((a, b) => String(a.m.name).localeCompare(String(b.m.name)));
  const low = stockRows.filter((r) => r.status !== 'ok')
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'urgent' ? -1 : 1) || String(a.m.name).localeCompare(String(b.m.name)));

  return {
    day, label: dayLabel(day), generatedAt: now.toISOString(),
    consumption, consumptionEntries: live.length, reversedCount, dayLogs: live,
    received, pendingQc, stockRows, low,
    urgentCount: low.filter((r) => r.status === 'urgent').length,
  };
}

// ── the e-mail ───────────────────────────────────────────────────────────────
const TH = 'text-align:left; padding:6px 8px; border-bottom:2px solid #0f172a; color:#64748b; font-size:10px; text-transform:uppercase;';
const THR = TH.replace('text-align:left', 'text-align:right');
const TD = 'padding:6px 8px; border-bottom:1px solid #e2e8f0; vertical-align:top;';
const TDR = `${TD} text-align:right; white-space:nowrap;`;
const sectionTitle = (t, n) => `<h4 style="margin:26px 0 6px; color:#0f172a; font-size:13px; text-transform:uppercase; letter-spacing:0.04em;">${esc(t)}${n != null ? ` <span style="color:#94a3b8; font-weight:400;">(${n})</span>` : ''}</h4>`;
const empty = (t) => `<p style="color:#94a3b8; font-size:13px; margin:6px 0 0;">${esc(t)}</p>`;
const tag = (text, bg, fg) => `<span style="background:${bg}; color:${fg}; font-size:10px; font-weight:700; padding:2px 6px; border-radius:6px; white-space:nowrap;">${esc(text)}</span>`;
const stockTag = (s) => (s === 'urgent' ? tag('URGENT', '#fee2e2', '#b91c1c') : s === 'reorder' ? tag('REORDER', '#fef3c7', '#b45309') : '');

function buildEmail(rep, { siteUrl = '', hasAttachment = false } = {}) {
  const MAX_PENDING = 25, MAX_LOW = 40;

  const consRows = rep.consumption.map((r) => `
      <tr>
        <td style="${TD}"><strong>${esc(r.name)}</strong>${r.sections.length ? `<div style="color:#94a3b8; font-size:11px;">${r.sections.map((s) => `${esc(s.name)} ${esc(fmt(s.qty))}`).join(' · ')}</div>` : ''}</td>
        <td style="${TDR} font-weight:700;">${esc(fmt(r.qty))} ${esc(r.unit || '')}</td>
        <td style="${TDR} color:#475569;">${r.stock == null ? '—' : `${esc(fmt(r.stock))} ${esc(r.unit || '')}`} ${stockTag(r.status)}</td>
      </tr>`).join('');
  const consumptionHtml = rep.consumption.length
    ? `<table style="width:100%; border-collapse:collapse; font-size:13px;"><thead><tr><th style="${TH}">Material</th><th style="${THR}">Consumed</th><th style="${THR}">In stock now</th></tr></thead><tbody>${consRows}</tbody></table>`
    : empty('No consumption was logged for this day.');

  const inRows = rep.received.map((r) => `
      <tr>
        <td style="${TD}"><strong>${esc(r.materialName)}</strong><div style="color:#94a3b8; font-size:11px;">${[r.supplier, r.doNo && `DO ${r.doNo}`, r.invoiceNo && `Inv ${r.invoiceNo}`, r.poNo && `PO ${r.poNo}`].filter(Boolean).map(esc).join(' · ')}</div></td>
        <td style="${TDR} font-weight:700;">${esc(fmt(num(r.qty)))} ${esc(r.unit || '')}</td>
        <td style="${TDR}">${esc(QC_LABEL[r.qcStatus] || r.qcStatus || '')}</td>
      </tr>`).join('');
  const incomingHtml = rep.received.length
    ? `<table style="width:100%; border-collapse:collapse; font-size:13px;"><thead><tr><th style="${TH}">Material / supplier</th><th style="${THR}">Received</th><th style="${THR}">Quality check</th></tr></thead><tbody>${inRows}</tbody></table>`
    : empty('No material was received on this day.');

  const pendRows = rep.pendingQc.slice(0, MAX_PENDING).map((r) => `
      <tr>
        <td style="${TD}"><strong>${esc(r.materialName)}</strong><div style="color:#94a3b8; font-size:11px;">${esc(r.supplier || '')}</div></td>
        <td style="${TDR}">${esc(fmt(num(r.qty)))} ${esc(r.unit || '')}</td>
        <td style="${TDR}">${esc(QC_LABEL[r.qcStatus] || r.qcStatus)}</td>
        <td style="${TDR} color:#64748b;">${esc(uaeDay(r.receivedAt))}</td>
      </tr>`).join('');
  const pendingHtml = rep.pendingQc.length
    ? `<table style="width:100%; border-collapse:collapse; font-size:13px;"><thead><tr><th style="${TH}">Material</th><th style="${THR}">Qty</th><th style="${THR}">Status</th><th style="${THR}">Received</th></tr></thead><tbody>${pendRows}</tbody></table>${rep.pendingQc.length > MAX_PENDING ? `<p style="color:#94a3b8; font-size:12px;">+ ${rep.pendingQc.length - MAX_PENDING} more${hasAttachment ? ' — see the Excel attachment' : ''}.</p>` : ''}`
    : empty('Nothing is waiting for quality inspection.');

  const lowRows = rep.low.slice(0, MAX_LOW).map(({ m, status }) => `
      <tr>
        <td style="${TD}"><strong>${esc(m.name)}</strong>${m.supplierName ? `<div style="color:#94a3b8; font-size:11px;">${esc(m.supplierName)}</div>` : ''}</td>
        <td style="${TDR} font-weight:700; color:${status === 'urgent' ? '#dc2626' : '#d97706'};">${esc(fmt(num(m.currentStock)))} ${esc(m.unit || '')}</td>
        <td style="${TDR} color:#64748b;">${num(m.reorderLevel) > 0 ? esc(fmt(num(m.reorderLevel))) : '—'} / ${num(m.urgentLevel) > 0 ? esc(fmt(num(m.urgentLevel))) : '—'}</td>
      </tr>`).join('');
  const lowHtml = rep.low.length
    ? `<table style="width:100%; border-collapse:collapse; font-size:13px;"><thead><tr><th style="${TH}">Material</th><th style="${THR}">In stock</th><th style="${THR}">Reorder / Urgent at</th></tr></thead><tbody>${lowRows}</tbody></table>${rep.low.length > MAX_LOW ? `<p style="color:#94a3b8; font-size:12px;">+ ${rep.low.length - MAX_LOW} more${hasAttachment ? ' — see the Excel attachment' : ''}.</p>` : ''}`
    : empty('Every followed material is above its reorder level.');

  const stat = (label, value, color = '#0f172a') => `<td style="padding:10px 12px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; text-align:center;"><div style="font-size:10px; text-transform:uppercase; color:#64748b;">${esc(label)}</div><div style="font-size:20px; font-weight:800; color:${color};">${esc(value)}</div></td>`;

  const html = `
    <div style="font-family:Arial,sans-serif; max-width:680px; margin:0 auto; color:#1e293b;">
      <div style="background:#0f172a; padding:20px 24px; border-radius:10px 10px 0 0;">
        <h2 style="color:#fff; margin:0; font-size:15px; text-transform:uppercase;">MAT Plastic Industries LLC — Daily Store Report</h2>
        <div style="color:#94a3b8; font-size:12px; margin-top:4px;">${esc(rep.label)}</div>
      </div>
      <div style="border:1px solid #e2e8f0; border-top:none; padding:24px; border-radius:0 0 10px 10px;">
        <table style="width:100%; border-collapse:separate; border-spacing:8px 0; margin:0 -8px;"><tr>
          ${stat('Materials consumed', rep.consumption.length)}
          ${stat('Receipts', rep.received.length)}
          ${stat('Waiting for QC', rep.pendingQc.length, rep.pendingQc.length ? '#b45309' : '#0f172a')}
          ${stat('Low / urgent stock', rep.low.length, rep.urgentCount ? '#dc2626' : rep.low.length ? '#b45309' : '#0f172a')}
        </tr></table>

        ${sectionTitle('Consumption', rep.consumption.length)}
        ${consumptionHtml}
        ${rep.reversedCount ? `<p style="color:#94a3b8; font-size:12px;">${rep.reversedCount} consumption entr${rep.reversedCount === 1 ? 'y was' : 'ies were'} returned to store and left out of these totals.</p>` : ''}

        ${sectionTitle('Incoming material received', rep.received.length)}
        ${incomingHtml}

        ${sectionTitle('Still waiting for quality inspection', rep.pendingQc.length)}
        ${pendingHtml}

        ${sectionTitle('Current stock — needs reordering', rep.low.length)}
        ${lowHtml}
        <p style="color:#64748b; font-size:12px; margin-top:10px;">Total materials in the store list: ${rep.stockRows.length}.${hasAttachment ? ' The attached Excel file has the full stock list, every consumption line and every receipt.' : ''}</p>

        ${siteUrl ? `<div style="margin-top:22px;"><a href="${esc(siteUrl)}" style="background:#0f172a; color:#fff; text-decoration:none; padding:11px 20px; border-radius:8px; font-weight:700; font-size:13px; display:inline-block;">Open ERP</a></div>` : ''}
        <p style="color:#94a3b8; font-size:12px; margin-top:20px;">Sent automatically every morning. Stock figures are as of ${esc(new Date(rep.generatedAt).toLocaleString('en-GB', { timeZone: 'Asia/Dubai', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }))} (UAE time).</p>
      </div>
    </div>`;

  const flags = [rep.urgentCount ? `${rep.urgentCount} urgent` : '', rep.low.length - rep.urgentCount > 0 ? `${rep.low.length - rep.urgentCount} reorder` : ''].filter(Boolean).join(', ');
  const subject = `Daily Store Report — ${rep.label}${flags ? ` · ${flags}` : ''}`;
  return { subject, html };
}

// ── the Excel attachment (full detail) ───────────────────────────────────────
function buildWorkbookBase64(rep, XLSX) {
  const wb = XLSX.utils.book_new();
  const add = (name, rows, header) => {
    const ws = rows.length ? XLSX.utils.json_to_sheet(rows) : XLSX.utils.aoa_to_sheet([header]);
    XLSX.utils.book_append_sheet(wb, ws, name);
  };
  add('Consumption', rep.dayLogs.map((l) => ({
    Date: l.date, Section: l.sectionName || '', Material: l.materialName, Qty: num(l.qty), Unit: l.unit || '',
    'Logged by': l.loggedByName || '', Notes: l.notes || '',
  })), ['Date', 'Section', 'Material', 'Qty', 'Unit', 'Logged by', 'Notes']);
  add('Incoming received', rep.received.map((r) => ({
    Material: r.materialName, Qty: num(r.qty), Unit: r.unit || '', Supplier: r.supplier || '', 'DO no': r.doNo || '',
    'Invoice no': r.invoiceNo || '', 'PO no': r.poNo || '', 'QC status': QC_LABEL[r.qcStatus] || r.qcStatus || '',
    'Received by': r.receivedByName || '',
  })), ['Material', 'Qty', 'Unit', 'Supplier', 'DO no', 'Invoice no', 'PO no', 'QC status', 'Received by']);
  add('Waiting for QC', rep.pendingQc.map((r) => ({
    Material: r.materialName, Qty: num(r.qty), Unit: r.unit || '', Supplier: r.supplier || '', Received: uaeDay(r.receivedAt),
    Status: QC_LABEL[r.qcStatus] || r.qcStatus || '',
  })), ['Material', 'Qty', 'Unit', 'Supplier', 'Received', 'Status']);
  add('Current stock', rep.stockRows.map(({ m, status }) => ({
    Material: m.name, 'ERP code': m.erpCode || '', Category: m.category || '', Unit: m.unit || '', 'In stock': num(m.currentStock),
    'Reorder level': m.reorderLevel == null ? '' : num(m.reorderLevel), 'Urgent level': m.urgentLevel == null ? '' : num(m.urgentLevel),
    Status: status === 'urgent' ? 'URGENT' : status === 'reorder' ? 'Reorder' : 'OK', Supplier: m.supplierName || '', Location: m.location || '',
  })), ['Material', 'ERP code', 'Category', 'Unit', 'In stock', 'Reorder level', 'Urgent level', 'Status', 'Supplier', 'Location']);
  return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
}

// ── sending ──────────────────────────────────────────────────────────────────
function recipients() {
  const fromEnv = (process.env.DAILY_REPORT_EMAIL || '').split(',').map((e) => e.trim()).filter(Boolean);
  return fromEnv.length ? fromEnv : DEFAULT_RECIPIENTS;
}

async function sendViaResend({ to, subject, html, attachments }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || to.length === 0) {
    console.warn('[daily-report] RESEND_API_KEY or recipient not set — report NOT sent.');
    return { skipped: true };
  }
  const from = process.env.STORE_EMAIL_FROM || 'MAT Plastic Store <onboarding@resend.dev>';
  const body = { from, to, subject, html };
  if (attachments && attachments.length) body.attachments = attachments;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Resend error ${res.status}: ${detail}`);
  }
  return { sent: true };
}

function loadXlsx() { try { return require('xlsx'); } catch (e) { console.error('[daily-report] xlsx not available — sending without attachment:', e.message); return null; } }

// mode: 'scheduled' (yesterday, once per day) | 'manual' (today or ?day, sends every time) | 'preview' (returns html, sends nothing)
async function runDailyReport({ mode = 'scheduled', day: dayIn = '', siteUrl = '', deps = {} } = {}) {
  const db = deps.db || getAdminDb();
  const send = deps.send || sendViaResend;
  const now = deps.now || new Date();
  const today = uaeDay(now.toISOString());
  const day = isYmd(dayIn) ? dayIn : (mode === 'scheduled' ? addDays(today, -1) : today);

  const [materials, logs, incoming] = await Promise.all([
    readArray(db, 'materials'), readArray(db, 'consumptionLogs'), readArray(db, 'incomingMaterials'),
  ]);
  // An empty materials list is far more likely a read problem than "no materials".
  if (materials.length === 0) return { ok: false, skipped: 'no materials found — nothing sent' };

  const rep = buildReport({ day, materials, logs, incoming, now });

  let attachments = [];
  const XLSX = deps.XLSX || loadXlsx();
  if (XLSX) {
    try {
      attachments = [{ filename: `Store_Report_${day}.xlsx`, content: buildWorkbookBase64(rep, XLSX) }];
    } catch (e) { console.error('[daily-report] could not build the Excel attachment:', e); }
  }
  const { subject, html } = buildEmail(rep, { siteUrl, hasAttachment: attachments.length > 0 });
  const summary = { day, consumed: rep.consumption.length, received: rep.received.length, pendingQc: rep.pendingQc.length, low: rep.low.length, urgent: rep.urgentCount };

  if (mode === 'preview') return { ok: true, preview: true, subject, html, ...summary };

  // Scheduled runs: send at most once per day (Netlify can retry / run twice).
  let stateRef = null, prevLast;
  if (mode === 'scheduled') {
    stateRef = db.collection('system_alerts').doc('dailyReportState');
    let already = false;
    await db.runTransaction(async (tx) => {
      already = false;
      const snap = await tx.get(stateRef);
      prevLast = snap.exists && snap.data() ? snap.data().lastDay : undefined;
      if (prevLast === day) { already = true; return; }
      tx.set(stateRef, { lastDay: day, updatedAt: new Date().toISOString() });
    });
    if (already) return { ok: true, skipped: `report for ${day} was already sent`, ...summary };
  }

  let result;
  try {
    result = await send({ to: recipients(), subject, html, attachments });
  } catch (err) {
    if (stateRef) await restoreState(db, stateRef, prevLast);
    throw err;
  }
  if (result && result.skipped) {
    if (stateRef) await restoreState(db, stateRef, prevLast);
    return { ok: false, skipped: 'e-mail not configured (RESEND_API_KEY)', ...summary };
  }
  return { ok: true, sent: true, to: recipients(), attachment: attachments.length > 0, ...summary };
}

async function restoreState(db, stateRef, prevLast) {
  try {
    await db.runTransaction(async (tx) => { tx.set(stateRef, { lastDay: prevLast === undefined ? null : prevLast, updatedAt: new Date().toISOString() }); });
  } catch (e) { console.error('[daily-report] could not reset state:', e); }
}

module.exports = { runDailyReport, buildReport, buildEmail, buildWorkbookBase64, addDays, stockStatus };
