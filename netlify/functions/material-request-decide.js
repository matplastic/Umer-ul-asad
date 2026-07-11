// Netlify Function — handles the manager's decision on a material request
// batch, tapped from the email or WhatsApp message. No login required
// (protected by a random per-batch token). Reads and writes Firestore
// directly using the Admin SDK, since there's no long-running Express
// server on a static Netlify deploy.
//
// PER-ITEM APPROVE/REJECT:
// A batch can contain many material lines (e.g. 32 items in one cart). The
// manager does NOT have to approve or reject the whole batch as one unit —
// the confirmation page lists every PENDING line with its own Approve/Reject
// choice (defaulted from whichever link he tapped, or "Approve" if he tapped
// the plain "Review Items" link), and he can flip individual lines before
// submitting. Only ONE Firestore write happens, on submit, covering every
// line's own decision.
//
// IMPORTANT — why this file has a "confirm" step:
// Corporate email security scanners (Trend Micro, Outlook Safe Links, etc.)
// and some WhatsApp/link-preview clients automatically visit ("prefetch")
// every link in an incoming message to check it's safe, BEFORE the human
// ever opens it. If the very first GET request to this URL performed the
// approve/reject action, the scanner itself would silently decide the
// request.
//
// The fix: a GET request (what a scanner prefetch and the initial email/
// WhatsApp tap both trigger) ONLY renders a confirmation page — it makes NO
// Firestore writes. The actual decision only happens when the manager
// clicks "Submit Decisions" on that page, which submits a POST request.
// Scanners prefetch links (GET) but do not fill in and submit HTML forms
// (POST), so this defeats the prefetch problem entirely.
//
// This function accepts either:
//   - batchId + token  → shows/decides every PENDING line in that batch
//   - id + token       → legacy single-line requests sent before batching existed
//
// Env vars needed (Netlify → Site settings → Environment variables), from a
// Firebase service account JSON (Firebase Console → Project Settings →
// Service Accounts → Generate new private key):
//   FIREBASE_PROJECT_ID
//   FIREBASE_CLIENT_EMAIL
//   FIREBASE_PRIVATE_KEY   (paste the full key; keep the \n escapes as-is)

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
    <body style="font-family:Arial,sans-serif; display:flex; align-items:center; justify-content:center; height:100vh; margin:0; background:#0f172a;">
      <div style="background:#fff; padding:40px; border-radius:12px; max-width:460px; text-align:center; box-shadow:0 20px 60px rgba(0,0,0,0.4);">
        <h2 style="color:${ok ? '#16a34a' : '#dc2626'}; margin-top:0;">${esc(title)}</h2>
        <div style="color:#475569; font-size:14px; text-align:left;">${message}</div>
      </div>
    </body></html>`;
}

// The confirmation/decision page shown on GET — no side effects, safe for
// email/WhatsApp link scanners to prefetch. Every still-PENDING line in the
// batch gets its own Approve/Reject radio pair (pre-selected from `preset`,
// defaulting to Approve). Already-decided lines are shown read-only.
// Nothing is written to Firestore until the manager clicks the button,
// which POSTs this same page.
function decisionPage(pendingItems, decidedItems, preset, id, batchId, token) {
  const presetAction = preset === 'reject' ? 'reject' : 'approve';
  const all = [...pendingItems, ...decidedItems];
  const first = all[0] || {};
  const multi = all.length > 1;

  const pendingRows = pendingItems.map((it) => `
    <tr>
      <td style="padding:8px 8px 8px 0; border-bottom:1px solid #e2e8f0;">
        <div style="font-weight:600; color:#0f172a;">${esc(it.materialName)}</div>
        <div style="color:#64748b; font-size:12px;">${esc(it.qtyRequested)} ${esc(it.unit)}</div>
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
        <div style="font-weight:600;">${esc(it.materialName)}</div>
        <div style="font-size:12px;">${esc(it.qtyRequested)} ${esc(it.unit)}</div>
      </td>
      <td style="padding:8px 0; border-bottom:1px solid #e2e8f0; text-align:right; color:${it.status === 'APPROVED' ? '#16a34a' : '#94a3b8'}; font-weight:600; font-size:12px; white-space:nowrap;">
        Already ${esc(it.status)}
      </td>
    </tr>`).join('');

  const bulkButtons = pendingItems.length > 1 ? `
    <div style="margin-bottom:12px; font-size:12px;">
      <a href="#" onclick="document.querySelectorAll('input[value=approve]').forEach(r=>r.checked=true); return false;" style="color:#16a34a; text-decoration:none; font-weight:700; margin-right:16px;">Approve all</a>
      <a href="#" onclick="document.querySelectorAll('input[value=reject]').forEach(r=>r.checked=true); return false;" style="color:#dc2626; text-decoration:none; font-weight:700;">Reject all</a>
    </div>` : '';

  return `<html><head><title>Material Request Decision</title></head>
    <body style="font-family:Arial,sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; background:#0f172a; padding:20px 0;">
      <div style="background:#fff; padding:36px; border-radius:12px; max-width:560px; width:100%; box-shadow:0 20px 60px rgba(0,0,0,0.4);">
        <h2 style="margin-top:0; color:#0f172a;">Material Request${multi ? ` — ${all.length} items` : ''}</h2>
        <p style="color:#475569; font-size:13px; margin-bottom:4px;">
          ${esc(first.projectName)}${first.poolType ? ' / ' + esc(first.poolType) : ''}<br/>
          Requested by ${esc(first.requestedByName)} (${esc(first.requestedByRole)})
          ${first.reason ? `<br/>Reason: ${esc(first.reason)}` : ''}
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
                <th style="text-align:left; padding:4px 8px 8px 0; border-bottom:2px solid #0f172a; color:#64748b; font-size:11px; text-transform:uppercase;">Material</th>
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
        <p style="color:#94a3b8; font-size:12px; margin-top:16px;">Every line in this request has already been decided.</p>`}
      </div>
    </body></html>`;
}

async function loadTargets(db, id, batchId, token) {
  const reqRef = db.collection('system_state').doc('materialRequests');
  const reqSnap = await reqRef.get();
  const arr = reqSnap.exists ? (reqSnap.data().data || []) : [];

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
  return { reqRef, arr, indices };
}

exports.handler = async (event) => {
  const html = (title, message, ok, status = 200) => ({ statusCode: status, headers: { 'Content-Type': 'text/html' }, body: page(title, message, ok) });

  try {
    // Params come from the query string on GET, and from the POSTed form
    // body on the final "Submit Decisions" click.
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
    if (result.error === 'notfound') return html('Not Found', 'This material request no longer exists.', false, 404);
    if (result.error === 'badtoken') return html('Invalid Link', 'This approval link is not valid.', false, 403);

    const { reqRef, arr, indices } = result;
    const pendingIndices = indices.filter((i) => arr[i].status === 'PENDING');
    const decidedAlreadyIndices = indices.filter((i) => arr[i].status !== 'PENDING');

    // GET = just show the decision page. No writes happen here, so
    // email/WhatsApp link prefetching is harmless.
    if (event.httpMethod !== 'POST') {
      const pendingItems = pendingIndices.map((i) => arr[i]);
      const decidedItems = decidedAlreadyIndices.map((i) => arr[i]);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/html' },
        body: decisionPage(pendingItems, decidedItems, action, id, batchId, token),
      };
    }

    // POST = the manager clicked "Submit Decisions". Apply each line's own
    // choice — a per-item radio named decision_<itemId>, "approve" or
    // "reject". Missing/unrecognized values default to "approve" only as a
    // safety net (the page always renders both radios pre-selected), so this
    // never silently rejects something the manager didn't touch.
    if (pendingIndices.length === 0) {
      return html('Already Decided', 'Every line in this request was already decided.', true);
    }

    const decidedAt = new Date().toISOString();
    const approvedItems = [];
    const rejectedItems = [];

    for (const i of pendingIndices) {
      const item = arr[i];
      const choice = body.get(`decision_${item.id}`) === 'reject' ? 'reject' : 'approve';
      const decided = {
        ...item,
        status: choice === 'approve' ? 'APPROVED' : 'REJECTED',
        decidedByName: 'Manager (email)',
        decidedAt,
      };
      arr[i] = decided;
      if (choice === 'approve') approvedItems.push(decided); else rejectedItems.push(decided);
    }

    await reqRef.set({ data: arr });

    if (approvedItems.length > 0) {
      // 1) Leaves the Store — aggregate per material first, so two approved
      // lines of the same material only touch currentStock once.
      const stockDeltas = {};
      for (const item of approvedItems) {
        stockDeltas[item.materialId] = (stockDeltas[item.materialId] || 0) + Number(item.qtyRequested);
      }
      const matRef = db.collection('system_state').doc('materials');
      const matSnap = await matRef.get();
      const matArr = matSnap.exists ? (matSnap.data().data || []) : [];
      for (const m of matArr) {
        if (stockDeltas[m.id]) m.currentStock = (m.currentStock || 0) - stockDeltas[m.id];
      }
      await matRef.set({ data: matArr });

      // 2) Arrives on the requesting section's Floor Stock (issued, not yet
      // consumed), one row per (section, material) pair. Mirrors
      // adjustFloorStock() in src/lib/firebaseService.ts — keep in sync.
      const floorRef = db.collection('system_state').doc('floorStock');
      const floorSnap = await floorRef.get();
      const floorArr = floorSnap.exists ? (floorSnap.data().data || []) : [];
      for (const item of approvedItems) {
        const sectionId = item.stageId || 'unassigned';
        const rowId = `${sectionId}__${item.materialId}`;
        const qty = Number(item.qtyRequested);
        const fIdx = floorArr.findIndex((f) => f.id === rowId);
        if (fIdx !== -1) {
          floorArr[fIdx] = { ...floorArr[fIdx], qty: (floorArr[fIdx].qty || 0) + qty, updatedAt: decidedAt };
        } else {
          floorArr.push({
            id: rowId, sectionId, sectionName: sectionId,
            materialId: item.materialId, materialName: item.materialName, unit: item.unit,
            qty, updatedAt: decidedAt,
          });
        }
      }
      await floorRef.set({ data: floorArr });
    }

    const summary = [
      approvedItems.length > 0
        ? `<p style="margin:6px 0;"><strong style="color:#16a34a;">✓ Approved (${approvedItems.length}):</strong> ${approvedItems.map((it) => esc(it.materialName)).join(', ')}</p>`
        : '',
      rejectedItems.length > 0
        ? `<p style="margin:6px 0;"><strong style="color:#dc2626;">✗ Rejected (${rejectedItems.length}):</strong> ${rejectedItems.map((it) => esc(it.materialName)).join(', ')}</p>`
        : '',
      approvedItems.length > 0
        ? `<p style="margin:14px 0 0; color:#64748b; font-size:13px;">The store has been notified and will print an issue slip for the approved item${approvedItems.length > 1 ? 's' : ''}.</p>`
        : '',
      rejectedItems.length > 0
        ? `<p style="margin:6px 0 0; color:#64748b; font-size:13px;">The section supervisor will be notified about the rejected item${rejectedItems.length > 1 ? 's' : ''}.</p>`
        : '',
    ].join('');

    return html('Decision Recorded', summary, approvedItems.length >= rejectedItems.length);
  } catch (err) {
    console.error('[material-request-decide] Error:', err);
    return html('Error', esc(err.message || 'Something went wrong processing this decision.'), false, 500);
  }
};
