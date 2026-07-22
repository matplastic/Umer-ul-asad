// Netlify Function — handles the manager's decision on an HR purchase
// request batch, tapped from the email. No login required (protected by a
// random per-batch token). Mirrors netlify/functions/material-request-decide.js
// but simpler: no stock/floor-stock side effects — just a per-item status
// flip on the system_state/hrPurchaseRequests doc.
//
// PER-ITEM APPROVE/REJECT: a batch can contain many items (an HR "cart" —
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
        <div style="color:#64748b; font-size:12px;">${esc(it.qty)} ${esc(it.unit)}${it.estimatedCost ? ` • AED ${esc(it.estimatedCost)}` : ''}</div>
      </td>
      <td style="padding:8px 0; border-bottom:1px solid #e2e8f0; text-align:right; white-space:nowrap;">
        <label style="margin-right:14px; color:#16a34a; font-weight:600; font-size:13px; cursor:pointer;">
          <input type="radio" name="decision_${esc(it.id)}" value="approve" ${presetAction === 'approve' ? 'checked' : ''} style="vertical-align:middle; margin-right:4px;" /> Approve
        </label>
        <label style="color:#dc2626; font-weight:600; font-size:13px; cursor:pointer;">
          <input type="radio" name="decision_${esc(it.id)}" value="reject" ${presetAction === 'reject' ? 'checked' : ''} style="vertical-align:middle; margin-right:4px;" /> Reject
        </label>
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

  return `<html><head><title>HR Purchase Request Decision</title></head>
    <body style="font-family:Arial,sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; background:#0f172a; padding:20px 0;">
      <div style="background:#fff; padding:36px; border-radius:12px; max-width:560px; width:100%; box-shadow:0 20px 60px rgba(0,0,0,0.4);">
        <h2 style="margin-top:0; color:#0f172a;">HR Purchase Request${multi ? ` — ${all.length} items` : ''}</h2>
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
          <p style="color:#94a3b8; font-size:12px; margin-top:16px; text-align:center;">Nothing happens until you click the button above. Each item can be approved or rejected on its own.</p>
        </form>` : `
        <table style="width:100%; border-collapse:collapse; font-size:14px; margin-top:16px;">
          <tbody>${decidedRows}</tbody>
        </table>
        <p style="color:#94a3b8; font-size:12px; margin-top:16px;">Every item in this request has already been decided.</p>`}
      </div>
    </body></html>`;
}

async function loadTargets(db, id, batchId, token) {
  const ref = db.collection('system_state').doc('hrPurchaseRequests');
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
      const choice = body.get(`decision_${item.id}`) === 'reject' ? 'reject' : 'approve';
      const decided = {
        ...item,
        status: choice === 'approve' ? 'Approved' : 'Rejected',
        decidedByName: 'Manager (email)',
        decidedAt,
      };
      arr[i] = decided;
      if (choice === 'approve') approvedItems.push(decided); else rejectedItems.push(decided);
    }

    await ref.set({ data: arr });

    const summary = [
      approvedItems.length > 0
        ? `<p style="margin:6px 0;"><strong style="color:#16a34a;">✓ Approved (${approvedItems.length}):</strong> ${approvedItems.map((it) => esc(it.itemName)).join(', ')}</p>`
        : '',
      rejectedItems.length > 0
        ? `<p style="margin:6px 0;"><strong style="color:#dc2626;">✗ Rejected (${rejectedItems.length}):</strong> ${rejectedItems.map((it) => esc(it.itemName)).join(', ')}</p>`
        : '',
      approvedItems.length > 0
        ? `<p style="margin:14px 0 0; color:#64748b; font-size:13px;">HR can now print the purchase order${approvedItems.length > 1 ? 's' : ''} and proceed with buying.</p>`
        : '',
    ].join('');

    return html('Decision Recorded', summary, approvedItems.length >= rejectedItems.length);
  } catch (err) {
    console.error('[hr-purchase-request-decide] Error:', err);
    return html('Error', esc(err.message || 'Something went wrong processing this decision.'), false, 500);
  }
};
