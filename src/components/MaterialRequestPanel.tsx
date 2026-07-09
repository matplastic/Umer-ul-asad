// Netlify Function — handles the Approve/Reject link tapped from the manager's
// email. No login required (protected by a random per-request token). Reads
// and writes Firestore directly using the Admin SDK, since there's no
// long-running Express server on a static Netlify deploy.
//
// IMPORTANT — why this file has a "confirm" step:
// Corporate email security scanners (Trend Micro, Outlook Safe Links, etc.)
// automatically visit ("prefetch") every link inside an incoming email to
// check it's safe, BEFORE the human ever opens the email. If the very first
// GET request to this URL performed the approve/reject action, the scanner
// itself would silently approve or reject the request — which is exactly
// what was happening before this fix.
//
// The fix: a GET request (what the scanner and the initial email click both
// trigger) ONLY renders a confirmation page — it makes no Firestore writes.
// The actual approve/reject action only happens when the manager clicks the
// "Confirm" button on that page, which submits a POST request. Scanners
// prefetch links (GET) but do not fill in and submit HTML forms (POST), so
// this defeats the prefetch problem.
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

// The confirmation page shown on GET — no side effects, safe for email
// scanners to prefetch. The manager must click the button to actually act.
function confirmPage(item, action, id, token) {
  const isApprove = action === 'approve';
  const color = isApprove ? '#16a34a' : '#dc2626';
  const label = isApprove ? 'Approve' : 'Reject';
  return `<html><head><title>Confirm ${label}</title></head>
    <body style="font-family:Arial,sans-serif; display:flex; align-items:center; justify-content:center; height:100vh; margin:0; background:#0f172a;">
      <div style="background:#fff; padding:40px; border-radius:12px; max-width:460px; text-align:center; box-shadow:0 20px 60px rgba(0,0,0,0.4);">
        <h2 style="margin-top:0; color:#0f172a;">Confirm ${label}</h2>
        <p style="color:#475569; font-size:14px;">
          ${item.materialName || ''} — ${item.qtyRequested ?? ''} ${item.unit || ''}<br/>
          ${item.projectName || ''}${item.poolType ? ' / ' + item.poolType : ''}<br/>
          Requested by ${item.requestedByName || ''} (${item.requestedByRole || ''})
        </p>
        <form method="POST">
          <input type="hidden" name="id" value="${id}" />
          <input type="hidden" name="token" value="${token}" />
          <input type="hidden" name="action" value="${action}" />
          <button type="submit" style="background:${color}; color:#fff; border:none; padding:14px 28px; border-radius:8px; font-weight:700; font-size:15px; cursor:pointer; margin-top:10px;">
            Confirm ${label}
          </button>
        </form>
        <p style="color:#94a3b8; font-size:12px; margin-top:20px;">Nothing happens until you click the button above.</p>
      </div>
    </body></html>`;
}

async function loadPendingItem(db, id, token) {
  const reqRef = db.collection('system_state').doc('materialRequests');
  const reqSnap = await reqRef.get();
  const arr = reqSnap.exists ? (reqSnap.data().data || []) : [];
  const idx = arr.findIndex((r) => r.id === id);
  if (idx === -1) return { error: 'notfound' };
  const item = arr[idx];
  if (item.approvalToken !== token) return { error: 'badtoken' };
  return { reqRef, arr, idx, item };
}

exports.handler = async (event) => {
  const html = (title, message, ok, status = 200) => ({ statusCode: status, headers: { 'Content-Type': 'text/html' }, body: page(title, message, ok) });

  try {
    // Params come from the query string on GET, and from the POSTed form
    // body on the confirm-button submission.
    let id, token, action;
    if (event.httpMethod === 'POST') {
      const body = new URLSearchParams(event.body || '');
      id = body.get('id'); token = body.get('token'); action = body.get('action');
    } else {
      ({ id, token, action } = event.queryStringParameters || {});
    }

    if (!id || !token || !action || !['approve', 'reject'].includes(action)) {
      return html('Invalid Link', 'Missing or invalid request details.', false, 400);
    }

    const db = getAdminDb();
    const result = await loadPendingItem(db, id, token);
    if (result.error === 'notfound') return html('Not Found', 'This material request no longer exists.', false, 404);
    if (result.error === 'badtoken') return html('Invalid Link', 'This approval link is not valid.', false, 403);

    const { reqRef, arr, idx, item } = result;

    if (item.status !== 'PENDING') {
      return html('Already Decided', `This request was already marked as ${item.status}.`, item.status === 'APPROVED');
    }

    // GET = just show the confirmation page. No writes happen here, so
    // email-scanner link prefetching is harmless.
    if (event.httpMethod !== 'POST') {
      return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: confirmPage(item, action, id, token) };
    }

    // POST = the manager actually clicked the Confirm button. Perform the action.
    const approve = action === 'approve';
    arr[idx] = { ...item, status: approve ? 'APPROVED' : 'REJECTED', decidedByName: 'Manager (email)', decidedAt: new Date().toISOString() };
    await reqRef.set({ data: arr });

    if (approve) {
      // 1) Leaves the Store
      const matRef = db.collection('system_state').doc('materials');
      const matSnap = await matRef.get();
      const matArr = matSnap.exists ? (matSnap.data().data || []) : [];
      const mIdx = matArr.findIndex((m) => m.id === item.materialId);
      if (mIdx !== -1) {
        matArr[mIdx] = { ...matArr[mIdx], currentStock: (matArr[mIdx].currentStock || 0) - Number(item.qtyRequested) };
        await matRef.set({ data: matArr });
      }

      // 2) Arrives on the requesting section's Floor Stock (issued, not yet
      // consumed). Mirrors adjustFloorStock() in src/lib/firebaseService.ts —
      // keep the two in sync if this logic ever changes.
      const sectionId = item.stageId || 'unassigned';
      const floorRef = db.collection('system_state').doc('floorStock');
      const floorSnap = await floorRef.get();
      const floorArr = floorSnap.exists ? (floorSnap.data().data || []) : [];
      const rowId = `${sectionId}__${item.materialId}`;
      const fIdx = floorArr.findIndex((f) => f.id === rowId);
      const qty = Number(item.qtyRequested);
      if (fIdx !== -1) {
        floorArr[fIdx] = { ...floorArr[fIdx], qty: (floorArr[fIdx].qty || 0) + qty, updatedAt: new Date().toISOString() };
      } else {
        floorArr.push({
          id: rowId, sectionId, sectionName: sectionId,
          materialId: item.materialId, materialName: item.materialName, unit: item.unit,
          qty, updatedAt: new Date().toISOString(),
        });
      }
      await floorRef.set({ data: floorArr });
    }

    return html(
      approve ? 'Request Approved ✓' : 'Request Rejected',
      approve ? 'The store has been notified and will print an issue slip.' : 'The section supervisor will be notified.',
      approve
    );
  } catch (err) {
    console.error('[material-request-decide] Error:', err);
    return html('Error', err.message || 'Something went wrong processing this decision.', false, 500);
  }
};
