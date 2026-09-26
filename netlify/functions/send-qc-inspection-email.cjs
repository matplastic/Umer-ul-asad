// Netlify Function — sends a "pool ready for inspection" email to QC
// inspectors, with a link that opens qc-inspection-decide.cjs's Pass/Reject
// page (same options as the app: Pass, Reject, Pass + Log Defect,
// Reject + Log Defect).
//
// Called (fire-and-forget) from App.tsx whenever a stage's status becomes
// PENDING_INSPECTION — see handleFinishStage / handleQuickBatchComplete.
//
// Env vars needed:
//   RESEND_API_KEY, SUPERVISOR_EMAIL_FROM (optional, reused from the other
//     email functions)
//   QC_INSPECTOR_EMAILS — comma-separated list of inspector addresses, e.g.
//     "inspector1@matglobal.tech,inspector2@matglobal.tech"
//   QC_EMAIL_SECRET — same secret qc-inspection-decide.cjs uses, needed
//     here to generate the token the link is signed with.
//   APP_BASE_URL (optional — falls back to the request's own host)

const crypto = require('crypto');

function makeToken(poolId, stageId) {
  const secret = process.env.QC_EMAIL_SECRET || '';
  return crypto.createHmac('sha256', secret).update(`${poolId}:${stageId}`).digest('hex').slice(0, 24);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const apiKey = process.env.RESEND_API_KEY;
  const secret = process.env.QC_EMAIL_SECRET;
  const inspectorEmails = (process.env.QC_INSPECTOR_EMAILS || '').split(',').map((e) => e.trim()).filter(Boolean);

  if (!apiKey || !secret || inspectorEmails.length === 0) {
    console.warn('[send-qc-inspection-email] RESEND_API_KEY, QC_EMAIL_SECRET, or QC_INSPECTOR_EMAILS not set — skipping.');
    return { statusCode: 200, body: JSON.stringify({ skipped: true }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'Invalid JSON body' };
  }

  const { poolId, poolNo, projectName, stageId, stageName, teamName } = payload;
  if (!poolId || !poolNo || !stageId) {
    return { statusCode: 400, body: 'poolId, poolNo, and stageId are required' };
  }

  const siteUrl = process.env.APP_BASE_URL || `https://${event.headers.host}`;
  const logoUrl = `${siteUrl}/logo.png`;
  const from = process.env.SUPERVISOR_EMAIL_FROM || 'MAT Plastic Factory <onboarding@resend.dev>';
  const token = makeToken(poolId, stageId);
  const decideUrl = `${siteUrl}/.netlify/functions/qc-inspection-decide?poolId=${encodeURIComponent(poolId)}&stageId=${encodeURIComponent(stageId)}&token=${token}`;

  const html = `
    <div style="font-family:Arial,sans-serif; max-width:560px; margin:0 auto; color:#1e293b;">
      <div style="background:#0f172a; padding:20px 24px; border-radius:10px 10px 0 0; display:flex; align-items:center; gap:12px;">
        <img src="${logoUrl}" alt="MAT Plastic Industries LLC" style="height:34px; width:auto;" />
        <h2 style="color:#fff; margin:0; font-size:15px; text-transform:uppercase;">Quality Inspection Needed</h2>
      </div>
      <div style="border:1px solid #e2e8f0; border-top:none; padding:24px; border-radius:0 0 10px 10px;">
        <h3 style="margin-top:0;">${esc(poolNo)} — ${esc(stageName || stageId)}</h3>
        <p style="color:#64748b; font-size:13px;">
          ${esc(projectName || '')}${teamName ? ` • Submitted by ${esc(teamName)}` : ''}
        </p>
        <a href="${decideUrl}" style="display:inline-block; background:#0f172a; color:#fff; text-decoration:none; padding:12px 22px; border-radius:8px; font-weight:700; font-size:14px; margin-top:12px;">Inspect This Pool</a>
        <p style="color:#94a3b8; font-size:12px; margin-top:20px;">Opens a page where you can Pass, Reject, and optionally log a defect — same as in the app.</p>
      </div>
    </div>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: inspectorEmails,
        subject: `Inspect ${poolNo} — ${stageName || stageId}`,
        html,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('[send-qc-inspection-email] Resend error:', res.status, detail);
      return { statusCode: 502, body: JSON.stringify({ error: 'Resend failed', detail }) };
    }
  } catch (err) {
    console.error('[send-qc-inspection-email] Failed:', err);
    return { statusCode: 502, body: JSON.stringify({ error: String(err) }) };
  }

  return { statusCode: 200, body: JSON.stringify({ sent: true }) };
};
