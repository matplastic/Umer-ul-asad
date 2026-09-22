// Netlify Function — handles the manager's decision on a Factory Supervisor
// request batch, tapped from the email. No login required (protected by a
// random per-batch token). Mirrors netlify/functions/material-request-decide.js
// but simpler: no stock/floor-stock side effects — just a per-item status
// flip on the system_state/supervisorPurchaseRequests doc.
//
// PER-ITEM APPROVE/REJECT: a batch can contain many items (a supervisor "cart" —
// office supplies, accommodation items, etc.). The manager does not have to
// approve/reject the whole batch as one unit — the confirmation page lists
// every PENDING line with its own Approve/Reject choice, and only ONE
// Firestore write happens, on submit, covering every line's own decision.
//
// Same GET-renders-confirmation / POST-writes-decision split as the Store
// version, to stay safe against corporate email link-scanner prefetching.
//
// Accepts either:
//   - batchId + token → shows/decides every PENDING line in that batch
//   - id + token      → a single-item request (legacy / one-off)
//
// Env vars needed (Netlify → Site settings → Environment variables), from a
// Firebase service account JSON:
//   FIREBASE_PROJECT_ID
//   FIREBASE_CLIENT_EMAIL
//   FIREBASE_PRIVATE_KEY
//
// Also, to auto-email the approved Purchase Order to Store staff (added
// per request — see emailPoToStore below):
//   RESEND_API_KEY, SUPERVISOR_EMAIL_FROM (optional)
//   PO_STORE_EMAILS — comma-separated list of Store staff addresses, e.g.
//     "store1@matglobal.tech,store2@matglobal.tech"
//   (or STORE_STAFF_EMAIL_1 + STORE_STAFF_EMAIL_2 as two separate vars —
//   either works, PO_STORE_EMAILS wins if both are set)

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

function getAdminDb() {
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

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Builds the same PO layout the Supervisor Portal prints (item / ERP No /
// category / approved qty / cost / purpose / requested by), and emails it
// straight to Store's staff the moment a batch is (at least partially)
// approved — so Store doesn't have to wait for the supervisor to print and
// hand it over.
//
// Env var: PO_STORE_EMAILS — comma-separated (e.g.
// "store1@matglobal.tech,store2@matglobal.tech"). Falls back to
// STORE_STAFF_EMAIL_1 + STORE_STAFF_EMAIL_2 if that's what's configured.
async function emailPoToStore({ event, batchId, id, approvedItems, requestedByName, sectionName }) {
  const apiKey = process.env.RESEND_API_KEY;
  const combined = (process.env.PO_STORE_EMAILS || '').split(',').map((e) => e.trim()).filter(Boolean);
  const pair = [process.env.STORE_STAFF_EMAIL_1, process.env.STORE_STAFF_EMAIL_2].filter(Boolean);
  const storeEmails = combined.length > 0 ? combined : pair;

  if (!apiKey || storeEmails.length === 0) {
    console.warn('[supervisor-purchase-request-decide] RESEND_API_KEY or PO_STORE_EMAILS/STORE_STAFF_EMAIL_1/2 not set — PO email to Store skipped.');
    return;
  }

  const siteUrl = process.env.APP_BASE_URL || `https://${event.headers.host}`;
  const logoUrl = `${siteUrl}/logo.png`;
  const from = process.env.SUPERVISOR_EMAIL_FROM || 'MAT Plastic Factory <onboarding@resend.dev>';
  const generatedAt = new Date().toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const rows = approvedItems.map((it) => `
    <tr>
      <td style="padding:8px 8px 8px 0; border-bottom:1px solid #e2e8f0; font-weight:600;">${esc(it.itemName)}</td>
      <td style="padding:8px 0; border-bottom:1px solid #e2e8f0; color:#475569; font-size:12px;">${it.erpCode ? esc(it.erpCode) : '—'}</td>
      <td style="padding:8px 0; border-bottom:1px solid #e2e8f0;">${esc(it.category)}</td>
      <td style="padding:8px 0; border-bottom:1px solid #e2e8f0; text-align:right; white-space:nowrap;">${esc(it.qtyApproved != null ? it.qtyApproved : it.qty)} ${esc(it.unit)}</td>
    </tr>`).join('');

  const html = `
    <div style="font-family:Arial,sans-serif; max-width:600px; margin:0 auto; color:#1e293b;">
      <div style="background:#0f172a; padding:20px 24px; border-radius:10px 10px 0 0; display:flex; align-items:center; gap:12px;">
        <img src="${logoUrl}" alt="MAT Plastic Industries LLC" style="height:34px; width:auto; display:inline-block; vertical-align:middle;" />
        <h2 style="color:#fff; margin:0; font-size:15px; text-transform:uppercase; display:inline-block; vertical-align:middle;">MAT Plastic Industries LLC — Factory Supervisor Portal</h2>
      </div>
      <div style="border:1px solid #e2e8f0; border-top:none; padding:24px; border-radius:0 0 10px 10px;">
        <h3 style="margin-top:0;">Purchase Order</h3>
        <p style="color:#64748b; font-size:12px; margin:0 0 16px;">
          Request ID: ${esc(batchId || id)} • Approved ${esc(generatedAt)} by Manager (email)
          ${sectionName ? ` • ${esc(sectionName)}` : ''}
          ${requestedByName ? `<br/>Requested by ${esc(requestedByName)}` : ''}
        </p>
        <table style="width:100%; border-collapse:collapse; font-size:14px;">
          <thead>
            <tr>
              <th style="text-align:left; padding:6px 8px 6px 0; border-bottom:2px solid #0f172a; color:#64748b; font-size:11px; text-transform:uppercase;">Item</th>
              <th style="text-align:left; padding:6px 0; border-bottom:2px solid #0f172a; color:#64748b; font-size:11px; text-transform:uppercase;">ERP No.</th>
              <th style="text-align:left; padding:6px 0; border-bottom:2px solid #0f172a; color:#64748b; font-size:11px; text-transform:uppercase;">Category</th>
              <th style="text-align:right; padding:6px 0; border-bottom:2px solid #0f172a; color:#64748b; font-size:11px; text-transform:uppercase;">Approved Qty</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <p style="color:#94a3b8; font-size:12px; margin-top:20px;">This is the approved Purchase Order for the item${approvedItems.length > 1 ? 's' : ''} above. Please proceed with purchasing.</p>
      </div>
    </div>`;

  const subject = approvedItems.length > 1
    ? `Approved PO: ${approvedItems.length} items`
    : `Approved PO: ${approvedItems[0].itemName}`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: storeEmails, subject, html }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('[supervisor-purchase-request-decide] Resend error sending PO to Store:', res.status, detail);
    }
  } catch (err) {
    console.error('[supervisor-purchase-request-decide] Failed to send PO to Store:', err);
  }
}

function page(title, message, ok) {
  return `<html><head><title>${esc(title)}</title></head>
    <body style="font-family:Arial,sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; background:#0f172a; padding:20px 0;">
      <div style="background:#fff; padding:40px; border-radius:12px; max-width:460px; text-align:center; box-shadow:0 20px 60px rgba(0,0,0,0.4);">
        <h2 style="color:${ok ? '#16a34a' : '#dc2626'}; margin-top:0;">${esc(title)}</h2>
        <div style="color:#475569; font-size:14px; text-align:left;">${message}</div>
      </div>
    </body></html>`;
}

// Confirmation/decision page shown on GET — no side effects, safe for email
// link scanners to prefetch. Every still-PENDING line gets its own
// Approve/Reject radio pair (pre-selected from `preset`, defaulting to
// Approve). Already-decided lines are shown read-only. Nothing is written
// until the manager clicks the button, which POSTs this same page.
function decisionPage(pendingItems, decidedItems, preset, id, batchId, token) {
  const presetAction = preset === 'reject' ? 'reject' : 'approve';
  const all = [...pendingItems, ...decidedItems];
  const first = all[0] || {};
  const multi = all.length > 1;

  const pendingRows = pendingItems.map((it) => `
    <tr>
      <td style="padding:8px 8px 8px 0; border-bottom:1px solid #e2e8f0;">
        <div style="font-weight:600; color:#0f172a;">${esc(it.itemName)}</div>
        <div style="color:#64748b; font-size:12px;">Requested: ${esc(it.qty)} ${esc(it.unit)}${it.erpCode ? ` • ERP #${esc(it.erpCode)}` : ''}${it.estimatedCost ? ` • AED ${esc(it.estimatedCost)}` : ''}</div>
      </td>
      <td style="padding:8px 0; border-bottom:1px solid #e2e8f0; text-align:right; white-space:nowrap;">
        <div style="margin-bottom:6px;">
          <label style="margin-right:14px; color:#16a34a; font-weight:600; font-size:13px; cursor:pointer;">
            <input type="radio" name="decision_${esc(it.id)}" value="approve" ${presetAction === 'approve' ? 'checked' : ''} style="vertical-align:middle; margin-right:4px;" /> Approve
          </label>
          <label style="color:#dc2626; font-weight:600; font-size:13px; cursor:pointer;">
            <input type="radio" name="decision_${esc(it.id)}" value="reject" ${presetAction === 'reject' ? 'checked' : ''} style="vertical-align:middle; margin-right:4px;" /> Reject
          </label>
        </div>
        <div style="font-size:12px; color:#64748b;">
          Approve qty:
          <input type="number" name="qty_${esc(it.id)}" value="${esc(it.qty)}" min="0" max="${esc(it.qty)}" step="any"
            style="width:80px; padding:4px 6px; border:1px solid #cbd5e1; border-radius:6px; font-size:13px; text-align:right;" /> ${esc(it.unit)}
        </div>
      </td>
    </tr>`).join('');

  const decidedRows = decidedItems.map((it) => `
    <tr>
      <td style="padding:8px 8px 8px 0; border-bottom:1px solid #e2e8f0; color:#94a3b8;">
        <div style="font-weight:600;">${esc(it.itemName)}</div>
        <div style="font-size:12px;">${esc(it.qty)} ${esc(it.unit)}</div>
      </td>
      <td style="padding:8px 0; border-bottom:1px solid #e2e8f0; text-align:right; color:${it.status === 'Approved' ? '#16a34a' : '#94a3b8'}; font-weight:600; font-size:12px; white-space:nowrap;">
        Already ${esc(it.status)}
      </td>
    </tr>`).join('');

  const bulkButtons = pendingItems.length > 1 ? `
    <div style="margin-bottom:12px; font-size:12px;">
      <a href="#" onclick="document.querySelectorAll('input[value=approve]').forEach(r=>r.checked=true); return false;" style="color:#16a34a; text-decoration:none; font-weight:700; margin-right:16px;">Approve all</a>
      <a href="#" onclick="document.querySelectorAll('input[value=reject]').forEach(r=>r.checked=true); return false;" style="color:#dc2626; text-decoration:none; font-weight:700;">Reject all</a>
    </div>` : '';

  return `<html><head><title>Factory Purchase Request Decision</title></head>
    <body style="font-family:Arial,sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; background:#0f172a; padding:20px 0;">
      <div style="background:#fff; padding:36px; border-radius:12px; max-width:560px; width:100%; box-shadow:0 20px 60px rgba(0,0,0,0.4);">
        <h2 style="margin-top:0; color:#0f172a;">Factory Purchase Request${multi ? ` — ${all.length} items` : ''}</h2>
        <p style="color:#475569; font-size:13px; margin-bottom:4px;">
          Requested by ${esc(first.requestedByName)}
          ${first.purpose ? `<br/>Purpose: ${esc(first.purpose)}` : ''}
        </p>
        ${pendingItems.length > 0 ? `
        <form method="POST" style="margin-top:16px;">
          <input type="hidden" name="id" value="${esc(id || '')}" />
          <input type="hidden" name="batchId" value="${esc(batchId || '')}" />
          <input type="hidden" name="token" value="${esc(token)}" />
          ${bulkButtons}
          <table style="width:100%; border-collapse:collapse; font-size:14px; margin-bottom:18px;">
            <thead>
              <tr>
                <th style="text-align:left; padding:4px 8px 8px 0; border-bottom:2px solid #0f172a; color:#64748b; font-size:11px; text-transform:uppercase;">Item</th>
                <th style="text-align:right; padding:4px 0 8px; border-bottom:2px solid #0f172a; color:#64748b; font-size:11px; text-transform:uppercase;">Decision</th>
              </tr>
            </thead>
            <tbody>${pendingRows}${decidedRows}</tbody>
          </table>
          <button type="submit" style="background:#0f172a; color:#fff; border:none; padding:14px 28px; border-radius:8px; font-weight:700; font-size:15px; cursor:pointer; width:100%;">
            Submit Decision${pendingItems.length > 1 ? 's' : ''}
          </button>
          <p style="color:#94a3b8; font-size:12px; margin-top:16px; text-align:center;">Nothing happens until you click the button above. Each item can be approved or rejected on its own, and you can lower the "Approve qty" box below the requested amount to approve less — the remainder is automatically marked Rejected.</p>
        </form>` : `
        <table style="width:100%; border-collapse:collapse; font-size:14px; margin-top:16px;">
          <tbody>${decidedRows}</tbody>
        </table>
        <p style="color:#94a3b8; font-size:12px; margin-top:16px;">Every item in this request has already been decided.</p>`}
      </div>
    </body></html>`;
}

async function loadTargets(db, id, batchId, token) {
  const ref = db.collection('system_state').doc('supervisorPurchaseRequests');
  const snap = await ref.get();
  const arr = snap.exists ? (snap.data().data || []) : [];

  let indices;
  if (batchId) {
    indices = arr
      .map((r, idx) => ({ r, idx }))
      .filter(({ r }) => r.batchId === batchId && r.approvalToken === token)
      .map(({ idx }) => idx);
    if (indices.length === 0) return { error: 'notfound' };
  } else {
    const idx = arr.findIndex((r) => r.id === id);
    if (idx === -1) return { error: 'notfound' };
    if (arr[idx].approvalToken !== token) return { error: 'badtoken' };
    indices = [idx];
  }
  return { ref, arr, indices };
}

exports.handler = async (event) => {
  const html = (title, message, ok, status = 200) => ({ statusCode: status, headers: { 'Content-Type': 'text/html' }, body: page(title, message, ok) });

  try {
    let id, batchId, token, action;
    let body = null;
    if (event.httpMethod === 'POST') {
      body = new URLSearchParams(event.body || '');
      id = body.get('id') || null;
      batchId = body.get('batchId') || null;
      token = body.get('token');
    } else {
      ({ id, batchId, token, action } = event.queryStringParameters || {});
    }

    if (!token || (!id && !batchId)) {
      return html('Invalid Link', 'Missing or invalid request details.', false, 400);
    }

    const db = getAdminDb();
    const result = await loadTargets(db, id, batchId, token);
    if (result.error === 'notfound') return html('Not Found', 'This purchase request no longer exists.', false, 404);
    if (result.error === 'badtoken') return html('Invalid Link', 'This approval link is not valid.', false, 403);

    const { ref, arr, indices } = result;
    const pendingIndices = indices.filter((i) => arr[i].status === 'Pending');
    const decidedAlreadyIndices = indices.filter((i) => arr[i].status !== 'Pending');

    if (event.httpMethod !== 'POST') {
      const pendingItems = pendingIndices.map((i) => arr[i]);
      const decidedItems = decidedAlreadyIndices.map((i) => arr[i]);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/html' },
        body: decisionPage(pendingItems, decidedItems, action, id, batchId, token),
      };
    }

    if (pendingIndices.length === 0) {
      return html('Already Decided', 'Every item in this request was already decided.', true);
    }

    const decidedAt = new Date().toISOString();
    const approvedItems = [];
    const rejectedItems = [];

    for (const i of pendingIndices) {
      const item = arr[i];
      const requestedQty = Number(item.qty);
      let choice = body.get(`decision_${item.id}`) === 'reject' ? 'reject' : 'approve';

      let approveQty = requestedQty;
      if (choice === 'approve') {
        const raw = Number(body.get(`qty_${item.id}`));
        approveQty = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), requestedQty) : requestedQty;
        if (approveQty <= 0) choice = 'reject';
      }

      const partial = choice === 'approve' && approveQty < requestedQty;
      const decided = {
        ...item,
        status: choice === 'approve' ? 'Approved' : 'Rejected',
        qtyApproved: choice === 'approve' ? approveQty : null,
        decidedByName: 'Manager (email)',
        decisionNotes: partial ? `Partially approved: ${approveQty} of ${requestedQty} ${item.unit}` : (item.decisionNotes || null),
        decidedAt,
      };
      arr[i] = decided;
      if (choice === 'approve') approvedItems.push(decided); else rejectedItems.push(decided);
    }

    await ref.set({ data: arr });

    if (approvedItems.length > 0) {
      // Fire-and-forget-ish, but awaited so Netlify doesn't freeze the
      // function before the Resend call completes; errors are caught and
      // logged inside emailPoToStore so a Store-email failure never blocks
      // the manager's decision from being recorded (already saved above).
      await emailPoToStore({
        event,
        batchId,
        id,
        approvedItems,
        requestedByName: arr.find((r) => (batchId ? r.batchId === batchId : r.id === id))?.requestedByName,
        sectionName: arr.find((r) => (batchId ? r.batchId === batchId : r.id === id))?.sectionName,
      });
    }

    const summary = [
      approvedItems.length > 0
        ? `<p style="margin:6px 0;"><strong style="color:#16a34a;">✓ Approved (${approvedItems.length}):</strong> ${approvedItems.map((it) => esc(it.qtyApproved < it.qty ? `${it.itemName} (${it.qtyApproved} of ${it.qty} ${it.unit})` : it.itemName)).join(', ')}</p>`
        : '',
      rejectedItems.length > 0
        ? `<p style="margin:6px 0;"><strong style="color:#dc2626;">✗ Rejected (${rejectedItems.length}):</strong> ${rejectedItems.map((it) => esc(it.itemName)).join(', ')}</p>`
        : '',
      approvedItems.length > 0
        ? `<p style="margin:14px 0 0; color:#64748b; font-size:13px;">The Purchase Order${approvedItems.length > 1 ? 's have' : ' has'} been emailed to Store directly — the supervisor can also print it${approvedItems.length > 1 ? 's' : ''} as a backup.</p>`
        : '',
    ].join('');

    return html('Decision Recorded', summary, approvedItems.length >= rejectedItems.length);
  } catch (err) {
    console.error('[hr-purchase-request-decide] Error:', err);
    return html('Error', esc(err.message || 'Something went wrong processing this decision.'), false, 500);
  }
};
