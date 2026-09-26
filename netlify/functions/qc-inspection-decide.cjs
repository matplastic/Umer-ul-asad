// Netlify Function — Quality Inspector "decide from email" page.
//
// Lets an inspector Pass or Reject a specific pool's stage directly from
// the notification email (see send-qc-inspection-email.cjs), with the same
// options as the app: Pass, Reject, Pass + Log Defect, Reject + Log Defect.
// No login required — protected by an HMAC token computed from the pool
// and stage, so a link can't be guessed or reused for a different pool.
//
// Same GET-renders-confirmation / POST-writes-decision split as the other
// decide functions in this codebase, to stay safe against corporate email
// link-scanners prefetching the URL and silently triggering a decision.
//
// This function mirrors App.tsx's handleApproveStage / handleRejectStage /
// handleLogDefect as closely as possible — see the inline comments at each
// step for exactly which client-side behavior is being replicated and why.
// It does NOT attempt to replicate every defensive edge case from those
// functions (e.g. the "originalWorkspecTeamId" stale-claim fallback) —
// where simplified, that's noted.
//
// Env vars needed:
//   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
//     — same Firebase Admin credentials the other decide functions use.
//   QC_EMAIL_SECRET — any random string you choose (like a password).
//     Used to sign/verify the email link's token so it can't be forged or
//     reused for a pool/stage it wasn't issued for. Pick something long
//     and keep it secret, e.g. a 32+ character random string.

const crypto = require('crypto');
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

function makeToken(poolId, stageId) {
  const secret = process.env.QC_EMAIL_SECRET || '';
  return crypto.createHmac('sha256', secret).update(`${poolId}:${stageId}`).digest('hex').slice(0, 24);
}

// ── Kept in sync by hand with src/data/mockData.ts — see that file for the
// canonical source. Only the fields this function actually needs. ──
const STAGES = [
  { id: 'steel_fabrication', name: 'Steel Fabrication' },
  { id: 'steel_primer', name: 'Steel Primer' },
  { id: 'plumbing', name: 'Plumbing' },
  { id: 'cladding', name: 'Cladding' },
  { id: 'skimmer_fitting', name: 'Skimmer Fitting' },
  { id: 'lamination', name: 'Lamination' },
  { id: 'mechanical_fitting', name: 'Mechanical Fitting' },
  { id: 'skimmer_test', name: 'Skimmer Test' },
  { id: 'door_cutting', name: 'Mosaic' },
  { id: 'mosaic', name: 'Grouting' },
  { id: 'grouting', name: 'Door Cutting' },
  { id: 'acrylic', name: 'Acrylic' },
];
const DUAL_STAGE_GROUPS = [
  ['skimmer_fitting', 'lamination'],
  ['mechanical_fitting', 'skimmer_test', 'door_cutting'],
];
const getDualGroupForStage = (stageId) => DUAL_STAGE_GROUPS.find((g) => g.includes(stageId)) || null;
const stageName = (id) => STAGES.find((s) => s.id === id)?.name || id;

function html(title, bodyHtml, ok = true, statusCode = 200) {
  return {
    statusCode,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: `<!DOCTYPE html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${esc(title)}</title></head>
      <body style="font-family:Arial,sans-serif; background:#f1f5f9; margin:0; padding:20px 0;">
        <div style="max-width:560px; margin:0 auto; background:#fff; border-radius:12px; box-shadow:0 1px 3px rgba(0,0,0,0.1); padding:28px 24px;">
          <h2 style="margin-top:0; color:${ok ? '#0f172a' : '#dc2626'};">${esc(title)}</h2>
          ${bodyHtml}
        </div>
      </body></html>`,
  };
}

exports.handler = async (event) => {
  const params = event.httpMethod === 'GET' ? (event.queryStringParameters || {}) : Object.fromEntries(new URLSearchParams(event.body || ''));
  const poolId = params.poolId;
  const stageId = params.stageId;
  const token = params.token;

  if (!poolId || !stageId || !token) {
    return html('Invalid Link', '<p>Missing pool, stage, or security token.</p>', false, 400);
  }
  if (token !== makeToken(poolId, stageId)) {
    return html('Invalid or Expired Link', '<p>This link is not valid for this pool/stage.</p>', false, 400);
  }
  if (!STAGES.find((s) => s.id === stageId)) {
    return html('Invalid Link', '<p>Unknown stage.</p>', false, 400);
  }

  let db;
  try {
    db = getAdminDb();
  } catch (err) {
    console.error('[qc-inspection-decide] Firebase Admin init failed:', err);
    return html('Server Error', '<p>Server configuration issue — please contact your admin.</p>', false, 500);
  }

  const poolRef = db.collection('pools').doc(poolId);
  const poolSnap = await poolRef.get();
  if (!poolSnap.exists) {
    return html('Pool Not Found', '<p>This pool no longer exists.</p>', false, 404);
  }
  const pool = poolSnap.data();
  const stageHist = pool.stageHistory?.[stageId];

  if (event.httpMethod === 'GET') {
    if (!stageHist || stageHist.status !== 'PENDING_INSPECTION') {
      return html(
        'Already Handled',
        `<p>${esc(pool.poolNo)} at ${esc(stageName(stageId))} is no longer awaiting inspection — current status: <strong>${esc(stageHist?.status || 'unknown')}</strong>. No action needed.</p>`
      );
    }
    return html(`Inspect ${pool.poolNo}`, `
      <p style="color:#64748b; font-size:13px;">${esc(pool.projectName)} • ${esc(stageName(stageId))}${stageHist.teamName ? ` • Submitted by ${esc(stageHist.teamName)}` : ''}</p>
      <form method="POST">
        <input type="hidden" name="poolId" value="${esc(poolId)}" />
        <input type="hidden" name="stageId" value="${esc(stageId)}" />
        <input type="hidden" name="token" value="${esc(token)}" />

        <div style="margin:20px 0;">
          <label style="display:block; margin-bottom:8px; cursor:pointer;">
            <input type="radio" name="decision" value="pass" checked style="vertical-align:middle; margin-right:8px;" />
            <span style="color:#16a34a; font-weight:700;">Pass</span>
          </label>
          <label style="display:block; cursor:pointer;">
            <input type="radio" name="decision" value="reject" style="vertical-align:middle; margin-right:8px;" />
            <span style="color:#dc2626; font-weight:700;">Reject</span>
          </label>
        </div>

        <div style="margin:16px 0;">
          <label style="display:block; font-size:12px; font-weight:600; color:#475569; margin-bottom:4px;">Notes (required for reject)</label>
          <textarea name="notes" rows="3" style="width:100%; box-sizing:border-box; padding:8px; border:1px solid #cbd5e1; border-radius:8px; font-size:13px;" placeholder="Inspection notes / rejection reason"></textarea>
        </div>

        <div style="margin:16px 0; padding:14px; background:#f8fafc; border:1px dashed #cbd5e1; border-radius:8px;">
          <label style="display:block; font-weight:600; font-size:13px; cursor:pointer; margin-bottom:8px;">
            <input type="checkbox" name="logDefect" value="yes" onclick="document.getElementById('defectFields').style.display=this.checked?'block':'none'" style="vertical-align:middle; margin-right:8px;" />
            Also log a defect
          </label>
          <div id="defectFields" style="display:none;">
            <label style="display:block; font-size:12px; font-weight:600; color:#475569; margin-bottom:4px;">Defect type</label>
            <input type="text" name="defectType" style="width:100%; box-sizing:border-box; padding:8px; border:1px solid #cbd5e1; border-radius:8px; font-size:13px; margin-bottom:10px;" placeholder="e.g. Crack in shell surface" />
            <label style="display:block; font-size:12px; font-weight:600; color:#475569; margin-bottom:4px;">Severity</label>
            <select name="severity" style="width:100%; box-sizing:border-box; padding:8px; border:1px solid #cbd5e1; border-radius:8px; font-size:13px;">
              <option value="minor">Minor</option>
              <option value="major" selected>Major</option>
              <option value="critical">Critical</option>
            </select>
          </div>
        </div>

        <button type="submit" style="width:100%; padding:12px; background:#0f172a; color:#fff; border:none; border-radius:8px; font-weight:700; font-size:14px; cursor:pointer;">Submit Decision</button>
      </form>
      <p style="color:#94a3b8; font-size:12px; margin-top:16px; text-align:center;">Nothing happens until you click the button above.</p>
    `);
  }

  // ── POST: execute the decision ──────────────────────────────────────
  if (!stageHist || stageHist.status !== 'PENDING_INSPECTION') {
    return html('Already Handled', `<p>This stage is no longer awaiting inspection (current status: <strong>${esc(stageHist?.status || 'unknown')}</strong>). No action taken.</p>`);
  }

  const decision = params.decision === 'reject' ? 'reject' : 'pass';
  const notes = String(params.notes || '').trim();
  const wantsDefect = params.logDefect === 'yes';
  const defectType = String(params.defectType || '').trim();
  const severity = ['minor', 'major', 'critical'].includes(params.severity) ? params.severity : 'major';

  if (decision === 'reject' && !notes) {
    return html('Notes Required', '<p>A reason is required to reject a stage. Please go back and fill in the notes field.</p>', false, 400);
  }

  const nowIso = new Date().toISOString();
  const inspectorLabel = 'QC (email)';
  const newStageHist = { ...stageHist };
  const teamsToUpdate = new Map(); // teamId -> team doc data (mutated in place)

  const getTeam = async (teamId) => {
    if (!teamId) return null;
    if (teamsToUpdate.has(teamId)) return teamsToUpdate.get(teamId);
    const snap = await db.collection('teams').doc(teamId).get();
    if (!snap.exists) return null;
    const data = { id: teamId, ...snap.data() };
    teamsToUpdate.set(teamId, data);
    return data;
  };

  let unlockedStageName = null;
  let advanced = false;
  let dualWaitingNote = '';

  if (decision === 'pass') {
    // Mirrors handleApproveStage in App.tsx.
    newStageHist.status = 'APPROVED';
    newStageHist.inspectorId = inspectorLabel;
    newStageHist.inspectorNotes = notes;
    newStageHist.inspectionTime = nowIso;

    const originalTeamId = stageHist.teamId;
    const team = await getTeam(originalTeamId);
    if (team) {
      // Simplified version of handleApproveStage's team-release sweep: just
      // clear this pool from wherever it's held on its assigned team, and
      // set IDLE only if that leaves the team holding nothing else. The
      // app's extra defensive fallback (releasing a team that's holding
      // this pool under a stale/missing teamId) isn't replicated here —
      // that's a rare edge case and the app's own logic will still catch
      // it correctly the next time anyone interacts with that team there.
      const nextActive = team.activePoolId === poolId ? null : team.activePoolId;
      const nextExtra = (team.extraPoolIds || []).filter((id) => id !== poolId);
      const nextRework = (team.reworkPoolIds || []).filter((id) => id !== poolId);
      const stillHoldingSomething = !!nextActive || nextExtra.length > 0;
      teamsToUpdate.set(originalTeamId, {
        ...team,
        activePoolId: nextActive,
        extraPoolIds: nextExtra,
        reworkPoolIds: nextRework,
        status: stillHoldingSomething ? team.status : 'IDLE',
      });
    }

    const dualGroup = getDualGroupForStage(stageId);
    const currentStageIndex = pool.currentStageIndex;
    const isAtGate = dualGroup ? STAGES.findIndex((s) => s.id === dualGroup[0]) === currentStageIndex : false;

    if (dualGroup) {
      if (isAtGate) {
        const otherIds = dualGroup.filter((id) => id !== stageId);
        const allSiblingsApproved = otherIds.every((id) => pool.stageHistory[id]?.status === 'APPROVED');
        if (allSiblingsApproved) {
          const gateIdx = STAGES.findIndex((s) => s.id === dualGroup[0]);
          const nextIndex = gateIdx + dualGroup.length;
          pool.currentStageIndex = nextIndex;
          advanced = true;
          unlockedStageName = nextIndex < STAGES.length ? STAGES[nextIndex].name : 'Final Completion Shipment';
        } else {
          const pendingNames = otherIds.filter((id) => pool.stageHistory[id]?.status !== 'APPROVED').map(stageName);
          if (pendingNames.length) dualWaitingNote = ` Waiting on parallel stage${pendingNames.length > 1 ? 's' : ''} ${pendingNames.join(', ')} before advancing.`;
        }
      }
    } else {
      const stageIndex = STAGES.findIndex((s) => s.id === stageId);
      if (stageIndex === currentStageIndex) {
        const nextIndex = stageIndex + 1;
        pool.currentStageIndex = nextIndex;
        advanced = true;
        unlockedStageName = nextIndex < STAGES.length ? STAGES[nextIndex].name : 'Final Completion Shipment';
      }
    }

    pool.stageHistory[stageId] = newStageHist;

    if (advanced && pool.currentStageIndex >= STAGES.length) {
      pool.completedAt = nowIso;
      // Mark the matching PlannedPool COMPLETED, same as handleApproveStage.
      const plannedSnap = await db.collection('plannedPools').where('releasedPoolId', '==', poolId).limit(1).get();
      if (!plannedSnap.empty) {
        await plannedSnap.docs[0].ref.update({ status: 'COMPLETED' });
      }
    }
  } else {
    // Mirrors handleRejectStage in App.tsx — auto-assign + auto-start rework.
    newStageHist.status = 'IN_PROGRESS';
    newStageHist.inspectorId = inspectorLabel;
    newStageHist.inspectorNotes = notes;
    newStageHist.inspectionTime = nowIso;
    newStageHist.rejectionCount = (stageHist.rejectionCount || 0) + 1;
    newStageHist.startTime = nowIso;
    newStageHist.endTime = null;

    pool.stageHistory[stageId] = newStageHist;

    const teamId = stageHist.teamId;
    const team = await getTeam(teamId);
    if (team) {
      const existing = team.reworkPoolIds || [];
      const nextRework = existing.includes(poolId) ? existing : [...existing, poolId];
      const heldNormally = team.activePoolId === poolId || (team.extraPoolIds || []).includes(poolId);
      teamsToUpdate.set(teamId, {
        ...team,
        reworkPoolIds: nextRework,
        activePoolId: heldNormally && team.activePoolId === poolId ? null : team.activePoolId,
        extraPoolIds: heldNormally ? (team.extraPoolIds || []).filter((id) => id !== poolId) : (team.extraPoolIds || []),
      });
    }
  }

  // ── Commit: pool doc, any touched team docs, and an optional defect ──
  const writes = [poolRef.set(pool)];
  for (const [teamId, teamData] of teamsToUpdate) {
    const { id, ...rest } = teamData;
    writes.push(db.collection('teams').doc(teamId).set(rest));
  }

  let defectId = null;
  if (wantsDefect && defectType) {
    defectId = `defect_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const defect = {
      id: defectId,
      stageId,
      stageName: stageName(stageId),
      poolId,
      poolNo: pool.poolNo,
      projectName: pool.projectName,
      defectType,
      severity,
      status: 'open',
      loggedBy: inspectorLabel,
      loggedAt: nowIso,
      notes,
    };
    // qcDefects is a plain array document (system_state/qcDefects), same
    // pattern the Purchase Request / Material Request decide functions use
    // for their own array docs — read, push, write back.
    const defectsRef = db.collection('system_state').doc('qcDefects');
    writes.push(defectsRef.get().then((snap) => {
      const arr = Array.isArray(snap.data()?.data) ? snap.data().data : [];
      arr.unshift(defect);
      return defectsRef.set({ data: arr });
    }));
  }

  try {
    await Promise.all(writes);
  } catch (err) {
    console.error('[qc-inspection-decide] Write failed:', err);
    return html('Save Failed', '<p>Something went wrong saving this decision. Please try again, or handle it directly in the app.</p>', false, 500);
  }

  const resultTitle = decision === 'pass' ? `✓ Passed ${pool.poolNo}` : `↩ Rejected ${pool.poolNo}`;
  const resultBody = decision === 'pass'
    ? `<p>${esc(stageName(stageId))} signed off.${advanced ? ` Pool advanced to <strong>${esc(unlockedStageName)}</strong>.` : dualWaitingNote}</p>${defectId ? '<p style="color:#b45309;">Defect logged.</p>' : ''}`
    : `<p>Sent back to the team for rework at ${esc(stageName(stageId))}.</p>${defectId ? '<p style="color:#b45309;">Defect logged.</p>' : ''}`;

  return html(resultTitle, resultBody, decision === 'pass');
};
