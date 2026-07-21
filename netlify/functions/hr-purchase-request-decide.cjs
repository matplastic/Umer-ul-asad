// Netlify Function — handles the manager's decision on an HR purchase
// request, tapped from the email. No login required (protected by a random
// per-request token). Mirrors netlify/functions/material-request-decide.js
// but simpler: one item per request, no stock/floor-stock side effects —
// just a status flip on the system_state/hrPurchaseRequests doc.
//
// Same GET-renders-confirmation / POST-writes-decision split as the Store
// version, to stay safe against corporate email link-scanner prefetching.
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

function decisionPage(item, preset, token) {
  const presetAction = preset === 'reject' ? 'reject' : 'approve';
  return `<html><head><title>HR Purchase Request Decision</title></head>
    <body style="font-family:Arial,sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; background:#0f172a; padding:20px 0;">
      <div style="background:#fff; padding:36px; border-radius:12px; max-width:520px; width:100%; box-shadow:0 20px 60px rgba(0,0,0,0.4);">
        <h2 style="margin-top:0; color:#0f172a;">HR Purchase Request</h2>
        <table style="width:100%; border-collapse:collapse; font-size:14px; margin:12px 0 22px;">
          <tr><td style="padding:5px 0; color:#64748b; width:120px;">Item</td><td style="padding:5px 0; font-weight:600;">${esc(item.itemName)}</td></tr>
          <tr><td style="padding:5px 0; color:#64748b;">Category</td><td style="padding:5px 0; font-weight:600;">${esc(item.category)}</td></tr>
          <tr><td style="padding:5px 0; color:#64748b;">Quantity</td><td style="padding:5px 0; font-weight:600;">${esc(item.qty)} ${esc(item.unit)}</td></tr>
          ${item.estimatedCost ? `<tr><td style="padding:5px 0; color:#64748b;">Est. Cost</td><td style="padding:5px 0; font-weight:600;">AED ${esc(item.estimatedCost)}</td></tr>` : ''}
          <tr><td style="padding:5px 0; color:#64748b;">Requested by</td><td style="padding:5px 0; font-weight:600;">${esc(item.requestedByName)}</td></tr>
          ${item.purpose ? `<tr><td style="padding:5px 0; color:#64748b; vertical-align:top;">Purpose</td><td style="padding:5px 0;">${esc(item.purpose)}</td></tr>` : ''}
        </table>
        <form method="POST">
          <input type="hidden" name="id" value="${esc(item.id)}" />
          <input type="hidden" name="token" value="${esc(token)}" />
          <div style="margin-bottom:18px;">
            <label style="margin-right:18px; color:#16a34a; font-weight:700; font-size:14px; cursor:pointer;">
              <input type="radio" name="decision" value="approve" ${presetAction === 'approve' ? 'checked' : ''} style="vertical-align:middle; margin-right:6px;" /> Approve
            </label>
            <label style="color:#dc2626; font-weight:700; font-size:14px; cursor:pointer;">
              <input type="radio" name="decision" value="reject" ${presetAction === 'reject' ? 'checked' : ''} style="vertical-align:middle; margin-right:6px;" /> Reject
            </label>
          </div>
          <button type="submit" style="background:#0f172a; color:#fff; border:none; padding:14px 28px; border-radius:8px; font-weight:700; font-size:15px; cursor:pointer; width:100%;">
            Submit Decision
          </button>
          <p style="color:#94a3b8; font-size:12px; margin-top:16px; text-align:center;">Nothing happens until you click the button above.</p>
        </form>
      </div>
    </body></html>`;
}

exports.handler = async (event) => {
  const html = (title, message, ok, status = 200) => ({ statusCode: status, headers: { 'Content-Type': 'text/html' }, body: page(title, message, ok) });

  try {
    let id, token, action;
    let body = null;
    if (event.httpMethod === 'POST') {
      body = new URLSearchParams(event.body || '');
      id = body.get('id');
      token = body.get('token');
    } else {
      ({ id, token, action } = event.queryStringParameters || {});
    }

    if (!id || !token) {
      return html('Invalid Link', 'Missing or invalid request details.', false, 400);
    }

    const db = getAdminDb();
    const ref = db.collection('system_state').doc('hrPurchaseRequests');
    const snap = await ref.get();
    const arr = snap.exists ? (snap.data().data || []) : [];
    const idx = arr.findIndex((r) => r.id === id);

    if (idx === -1) return html('Not Found', 'This purchase request no longer exists.', false, 404);
    if (arr[idx].approvalToken !== token) return html('Invalid Link', 'This approval link is not valid.', false, 403);

    if (event.httpMethod !== 'POST') {
      if (arr[idx].status !== 'Pending') {
        return html('Already Decided', `This request was already <strong>${esc(arr[idx].status)}</strong>.`, arr[idx].status === 'Approved');
      }
      return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: decisionPage(arr[idx], action, token) };
    }

    if (arr[idx].status !== 'Pending') {
      return html('Already Decided', `This request was already <strong>${esc(arr[idx].status)}</strong>.`, arr[idx].status === 'Approved');
    }

    const choice = body.get('decision') === 'reject' ? 'Rejected' : 'Approved';
    arr[idx] = { ...arr[idx], status: choice, decidedByName: 'Manager (email)', decidedAt: new Date().toISOString() };
    await ref.set({ data: arr });

    const msg = choice === 'Approved'
      ? `<p style="margin:6px 0;"><strong style="color:#16a34a;">✓ Approved:</strong> ${esc(arr[idx].itemName)}</p><p style="margin:14px 0 0; color:#64748b; font-size:13px;">HR can now print the purchase order and proceed with buying.</p>`
      : `<p style="margin:6px 0;"><strong style="color:#dc2626;">✗ Rejected:</strong> ${esc(arr[idx].itemName)}</p>`;

    return html('Decision Recorded', msg, choice === 'Approved');
  } catch (err) {
    console.error('[hr-purchase-request-decide] Error:', err);
    return html('Error', esc(err.message || 'Something went wrong processing this decision.'), false, 500);
  }
};
