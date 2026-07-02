// ----------------------------------------------------
// EMAIL SERVICE (Resend) — material request approval notifications
// ----------------------------------------------------
// Why Resend: no SMTP setup, generous free tier (100 emails/day, 3,000/month),
// a single API key, and a plain REST endpoint (no extra SDK dependency needed).
// Sign up at https://resend.com, verify your sending domain (or use their
// shared onboarding domain for testing), then set these in your .env:
//
//   RESEND_API_KEY=re_xxxxxxxxxxxx
//   STORE_EMAIL_FROM="MAT Plastic Store <store@yourdomain.com>"
//   STORE_MANAGER_EMAIL=manager@yourdomain.com   (can be a comma-separated list)
//   APP_BASE_URL=https://your-deployed-app-url.com

interface MaterialRequestEmailPayload {
  requestId: string;
  projectName: string;
  poolType: string;
  poolNo?: string | null;
  materialName: string;
  unit: string;
  qtyRequested: number;
  reason?: string | null;
  requestedByName: string;
  requestedByRole: string;
  approveUrl: string;
  rejectUrl: string;
}

function baseTemplate(title: string, bodyHtml: string) {
  return `
  <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1e293b;">
    <div style="background:#0f172a; padding:20px 24px; border-radius:10px 10px 0 0;">
      <h2 style="color:#fff; margin:0; font-size:16px; letter-spacing:0.05em; text-transform:uppercase;">MAT Plastic Industries LLC — Store</h2>
    </div>
    <div style="border:1px solid #e2e8f0; border-top:none; padding:24px; border-radius:0 0 10px 10px;">
      <h3 style="margin-top:0;">${title}</h3>
      ${bodyHtml}
    </div>
  </div>`;
}

async function sendEmail(to: string[], subject: string, html: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.STORE_EMAIL_FROM || 'MAT Plastic Store <onboarding@resend.dev>';

  if (!apiKey) {
    console.warn('[emailService] RESEND_API_KEY not set — skipping email send. Set it in .env to enable manager approval emails.');
    return { skipped: true };
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, html }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('[emailService] Resend API error:', res.status, text);
    throw new Error(`Failed to send email: ${res.status}`);
  }

  return res.json();
}

// Sent to the manager when a Section Supervisor submits a material request
export async function sendMaterialRequestApprovalEmail(payload: MaterialRequestEmailPayload) {
  const managerEmails = (process.env.STORE_MANAGER_EMAIL || '')
    .split(',')
    .map(e => e.trim())
    .filter(Boolean);

  if (managerEmails.length === 0) {
    console.warn('[emailService] STORE_MANAGER_EMAIL not set — no manager to notify.');
    return { skipped: true };
  }

  const html = baseTemplate('New Material Request', `
    <table style="width:100%; border-collapse:collapse; font-size:14px; margin-bottom:20px;">
      <tr><td style="padding:6px 0; color:#64748b;">Project</td><td style="padding:6px 0; font-weight:600;">${payload.projectName}</td></tr>
      <tr><td style="padding:6px 0; color:#64748b;">Pool Type</td><td style="padding:6px 0; font-weight:600;">${payload.poolType}</td></tr>
      ${payload.poolNo ? `<tr><td style="padding:6px 0; color:#64748b;">Pool No.</td><td style="padding:6px 0; font-weight:600;">${payload.poolNo}</td></tr>` : ''}
      <tr><td style="padding:6px 0; color:#64748b;">Material</td><td style="padding:6px 0; font-weight:600;">${payload.materialName}</td></tr>
      <tr><td style="padding:6px 0; color:#64748b;">Quantity</td><td style="padding:6px 0; font-weight:600;">${payload.qtyRequested} ${payload.unit}</td></tr>
      <tr><td style="padding:6px 0; color:#64748b;">Requested by</td><td style="padding:6px 0; font-weight:600;">${payload.requestedByName} (${payload.requestedByRole})</td></tr>
      ${payload.reason ? `<tr><td style="padding:6px 0; color:#64748b;">Reason</td><td style="padding:6px 0;">${payload.reason}</td></tr>` : ''}
    </table>
    <div style="display:flex; gap:12px;">
      <a href="${payload.approveUrl}" style="background:#16a34a; color:#fff; text-decoration:none; padding:12px 22px; border-radius:8px; font-weight:700; font-size:14px; display:inline-block; margin-right:10px;">✓ Approve</a>
      <a href="${payload.rejectUrl}" style="background:#dc2626; color:#fff; text-decoration:none; padding:12px 22px; border-radius:8px; font-weight:700; font-size:14px; display:inline-block;">✗ Reject</a>
    </div>
    <p style="color:#94a3b8; font-size:12px; margin-top:20px;">Tapping Approve will confirm instantly — no login needed. Request ID: ${payload.requestId}</p>
  `);

  return sendEmail(managerEmails, `Material Request: ${payload.materialName} for ${payload.projectName} / ${payload.poolType}`, html);
}

// Optional: confirm back to the requester once the manager has decided
export async function sendMaterialRequestDecisionEmail(opts: {
  toEmail?: string | null;
  requestedByName: string;
  materialName: string;
  qtyRequested: number;
  unit: string;
  status: 'APPROVED' | 'REJECTED';
  decidedByName?: string | null;
  decisionNotes?: string | null;
}) {
  if (!opts.toEmail) return { skipped: true };

  const approved = opts.status === 'APPROVED';
  const html = baseTemplate(
    approved ? 'Your Material Request was Approved' : 'Your Material Request was Rejected',
    `<p>${opts.materialName} — ${opts.qtyRequested} ${opts.unit}</p>
     ${opts.decidedByName ? `<p style="color:#64748b;">Decided by: ${opts.decidedByName}</p>` : ''}
     ${opts.decisionNotes ? `<p style="color:#64748b;">Note: ${opts.decisionNotes}</p>` : ''}
     ${approved ? '<p>The store has been notified to prepare and print an issue slip.</p>' : ''}`
  );

  return sendEmail([opts.toEmail], approved ? 'Material Request Approved' : 'Material Request Rejected', html);
}
