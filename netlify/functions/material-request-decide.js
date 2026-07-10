// Netlify Function — handles the Approve/Reject link tapped from the manager's
// email or WhatsApp message. No login required (protected by a random
// per-batch token). Reads and writes Firestore directly using the Admin SDK,
// since there's no long-running Express server on a static Netlify deploy.
//
// IMPORTANT — why this file has a "confirm" step (BUG FIX):
// Corporate email security scanners (Trend Micro, Outlook Safe Links, etc.)
// and some WhatsApp/link-preview clients automatically visit ("prefetch")
// every link in an incoming message to check it's safe, BEFORE the human
// ever opens it. The previous version of this function performed the
// approve/reject action on the very first GET request — so the scanner
// itself silently decided the request. In practice the "Approve" link is
// listed first in the email, so scanners tended to hit it first: the
// request became APPROVED before the manager had even opened the email.
// Clicking "Reject" afterwards then landed on the "already decided" page
// still showing APPROVED — which is exactly the "reject always shows
// approved" bug this fixes.
//
// THE FIX: a GET request (what a scanner prefetch and the initial email/
// WhatsApp tap both trigger) ONLY renders a confirmation page — it makes
// NO Firestore writes. The actual approve/reject action only happens when
// the manager clicks the "Confirm" button on that page, which submits a
// POST request. Scanners prefetch links (GET) but do not fill in and submit
// HTML forms (POST), so this defeats the prefetch problem entirely.
//
// BATCH SUPPORT: a supervisor's whole cart (1 to many material lines) is
// submitted together and shares one batchId + one approvalToken (see
// dbSubmitMaterialRequestBatch in src/lib/firebaseService.ts). This function
// accepts either:
//   - batchId + token  → decides every PENDING line in that batch at once
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

function page(title, message, ok) {
  return `<html><head><title>${title}</title></head>
    <body style="font-family:Arial,sans-serif; display:flex; align-items:center; justify-content:center; height:100vh; margin:0; background:#0f172a;">
      <div style="background:#fff; padding:40px; border-radius:12px; max-width:420px; text-align:center; box-shadow:0 20px 60px rgba(0,0,0,0.4);">
        <h2 style="color:${ok ? '#16a34a' : '#dc2626'}; margin-top:0;">${title}</h2>
        <p style="color:#475569;">${message}</p>
      </div>
    </body></html>`;
}

// The confirmation page shown on GET — no side effects, safe for email/
// WhatsApp link scanners to prefetch. The manager must click the button to
// actually act. Lists every material line in the batch (or the one line, for
// a legacy single request).
function confirmPage(items, action, id, batchId, token) {
  const isApprove = action === 'approve';
  const color = isApprove ? '#16a34a' : '#dc2626';
  const label = isApprove ? 'Approve' : 'Reject';
  const first = items[0];
  const rows = items.map((it) => `
    <tr>
      <td style="padding:4px 8px 4px 0; text-align:left;">${it.materialName || ''}</td>
      <td style="padding:4px 0; text-align:right; white-space:nowrap;">${it.qtyRequested ?? ''} ${it.unit || ''}</td>
    </tr>`).join('');
  return `<html><head><title>Confirm ${label}</title></head>
    <body style="font-family:Arial,sans-serif; display:flex; align-items:center; justify-content:center; height:100vh; margin:0; background:#0f172a;">
      <div style="background:#fff; padding:40px; border-radius:12px; max-width:480px; width:100%; text-align:center; box-shadow:0 20px 60px rgba(0,0,0,0.4);">
        <h2 style="margin-top:0; color:#0f172a;">Confirm ${label}${items.length > 1 ? ` (${items.length} items)` : ''}</h2>
        <p style="color:#475569; font-size:14px; margin-bottom:4px;">
          ${first.projectName || ''}${first.poolType ? ' / ' + first.poolType : ''}<br/>
          Requested by ${first.requestedByName || ''} (${first.requestedByRole || ''})
        </p>
        <table style="width:100%; font-size:13px; color:#1e293b; border-top:1px solid #e2e8f0; border-bottom:1px solid #e2e8f0; margin:14px 0;">
          ${rows}
        </table>
        <form method="POST">
          <input type="hidden" name="id" value="${id || ''}" />
          <input type="hidden" name="batchId" value="${batchId || ''}" />
          <input type="hidden" name="token" value="${token}" />
          <input type="hidden" name="action" value="${action}" />
          <button type="submit" style="background:${color}; color:#fff; border:none; padding:14px 28px; border-radius:8px; font-weight:700; font-size:15px; cursor:pointer; margin-top:6px;">
            Confirm ${label}
          </button>
        </form>
        <p style="color:#94a3b8; font-size:12px; margin-top:20px;">Nothing happens until you click the button above.</p>
      </div>
    </body></html>`;
}

async function loadTargets(db, id, batchId, token) {
  const reqRef = db.collection('system_state').doc('materialRequests');
  const reqSnap = await reqRef.get();
  const arr = reqSnap.exists ? (reqSnap.data().data || []) : [];

  let indices;
  if (batchId) {
    indices = arr.map((r, idx) => ({ r, idx })).filter(({ r }) => r.batchId === batchId && r.approvalToken === token).map(({ idx }) => idx);
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
    // body on the confirm-button submission.
    let id, batchId, token, action;
    if (event.httpMethod === 'POST') {
      const body = new URLSearchParams(event.body || '');
      id = body.get('id') || null; batchId = body.get('batchId') || null; token = body.get('token'); action = body.get('action');
    } else {
      ({ id, batchId, token, action } = event.queryStringParameters || {});
    }

    if (!token || !action || !['approve', 'reject'].includes(action) || (!id && !batchId)) {
      return html('Invalid Link', 'Missing or invalid request details.', false, 400);
    }

    const db = getAdminDb();
    const result = await loadTargets(db, id, batchId, token);
    if (result.error === 'notfound') return html('Not Found', 'This material request no longer exists.', false, 404);
    if (result.error === 'badtoken') return html('Invalid Link', 'This approval link is not valid.', false, 403);

    const { reqRef, arr, indices } = result;
    const targetItems = indices.map((i) => arr[i]);
    const pendingIndices = indices.filter((i) => arr[i].status === 'PENDING');

    if (pendingIndices.length === 0) {
      const first = targetItems[0];
      return html('Already Decided', `This request was already marked as ${first.status}.`, first.status === 'APPROVED');
    }

    // GET = just show the confirmation page. No writes happen here, so
    // email/WhatsApp link prefetching is harmless.
    if (event.httpMethod !== 'POST') {
      const pendingItems = pendingIndices.map((i) => arr[i]);
      return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: confirmPage(pendingItems, action, id, batchId, token) };
    }

    // POST = the manager actually clicked the Confirm button. Perform the action.
    const approve = action === 'approve';
    const decidedAt = new Date().toISOString();
    const decidedItems = [];
    for (const i of pendingIndices) {
      arr[i] = { ...arr[i], status: approve ? 'APPROVED' : 'REJECTED', decidedByName: 'Manager (email)', decidedAt };
      decidedItems.push(arr[i]);
    }
    await reqRef.set({ data: arr });

    if (approve) {
      // 1) Leaves the Store — aggregate per material first, so two lines of
      // the same material in one batch only touch currentStock once.
      const stockDeltas = {};
      for (const item of decidedItems) {
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
      for (const item of decidedItems) {
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

    const count = decidedItems.length;
    return html(
      approve ? 'Request Approved ✓' : 'Request Rejected',
      approve
        ? `The store has been notified and will print ${count > 1 ? 'one issue slip for all items' : 'an issue slip'}.`
        : 'The section supervisor will be notified.',
      approve
    );
  } catch (err) {
    console.error('[material-request-decide] Error:', err);
    return html('Error', err.message || 'Something went wrong processing this decision.', false, 500);
  }
};
