// Netlify Function — sends the "new material request" email to the manager.
// Runs server-side, so the Resend API key never reaches the browser.
// Env vars needed (set in Netlify → Site settings → Environment variables):
//   RESEND_API_KEY, STORE_EMAIL_FROM, STORE_MANAGER_EMAIL, APP_BASE_URL (optional)

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const item = JSON.parse(event.body || '{}');
    const apiKey = process.env.RESEND_API_KEY;
    const managerEmails = (process.env.STORE_MANAGER_EMAIL || 'hussein.khalil@matglobal.tech')
      .split(',').map((e) => e.trim()).filter(Boolean);

    if (!apiKey || managerEmails.length === 0) {
      console.warn('[send-material-request-email] RESEND_API_KEY or STORE_MANAGER_EMAIL not set — skipping.');
      return { statusCode: 200, body: JSON.stringify({ skipped: true }) };
    }

    const siteUrl = process.env.APP_BASE_URL || `https://${event.headers.host}`;
    const approveUrl = `${siteUrl}/.netlify/functions/material-request-decide?id=${item.id}&token=${item.approvalToken}&action=approve`;
    const rejectUrl = `${siteUrl}/.netlify/functions/material-request-decide?id=${item.id}&token=${item.approvalToken}&action=reject`;
    const from = process.env.STORE_EMAIL_FROM || 'MAT Plastic Store <onboarding@resend.dev>';

    const html = `
      <div style="font-family:Arial,sans-serif; max-width:560px; margin:0 auto; color:#1e293b;">
        <div style="background:#0f172a; padding:20px 24px; border-radius:10px 10px 0 0;">
          <h2 style="color:#fff; margin:0; font-size:16px; text-transform:uppercase;">MAT Plastic Industries LLC — Store</h2>
        </div>
        <div style="border:1px solid #e2e8f0; border-top:none; padding:24px; border-radius:0 0 10px 10px;">
          <h3 style="margin-top:0;">New Material Request</h3>
          <table style="width:100%; border-collapse:collapse; font-size:14px; margin-bottom:20px;">
            <tr><td style="padding:6px 0; color:#64748b;">Project</td><td style="padding:6px 0; font-weight:600;">${item.projectName || ''}</td></tr>
            <tr><td style="padding:6px 0; color:#64748b;">Pool Type</td><td style="padding:6px 0; font-weight:600;">${item.poolType || ''}</td></tr>
            ${item.poolNo ? `<tr><td style="padding:6px 0; color:#64748b;">Pool No.</td><td style="padding:6px 0; font-weight:600;">${item.poolNo}</td></tr>` : ''}
            <tr><td style="padding:6px 0; color:#64748b;">Material</td><td style="padding:6px 0; font-weight:600;">${item.materialName || ''}</td></tr>
            <tr><td style="padding:6px 0; color:#64748b;">Quantity</td><td style="padding:6px 0; font-weight:600;">${item.qtyRequested} ${item.unit || ''}</td></tr>
            <tr><td style="padding:6px 0; color:#64748b;">Requested by</td><td style="padding:6px 0; font-weight:600;">${item.requestedByName || ''} (${item.requestedByRole || ''})</td></tr>
            ${item.reason ? `<tr><td style="padding:6px 0; color:#64748b;">Reason</td><td style="padding:6px 0;">${item.reason}</td></tr>` : ''}
          </table>
          <div>
            <a href="${approveUrl}" style="background:#16a34a; color:#fff; text-decoration:none; padding:12px 22px; border-radius:8px; font-weight:700; font-size:14px; display:inline-block; margin-right:10px;">✓ Approve</a>
            <a href="${rejectUrl}" style="background:#dc2626; color:#fff; text-decoration:none; padding:12px 22px; border-radius:8px; font-weight:700; font-size:14px; display:inline-block;">✗ Reject</a>
          </div>
          <p style="color:#94a3b8; font-size:12px; margin-top:20px;">Tapping Approve/Reject works instantly, no login needed. Request ID: ${item.id}</p>
        </div>
      </div>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: managerEmails,
        subject: `Material Request: ${item.materialName} for ${item.projectName} / ${item.poolType}`,
        html,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('[send-material-request-email] Resend error:', res.status, detail);
      return { statusCode: 502, body: JSON.stringify({ error: 'Failed to send email', detail }) };
    }

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error('[send-material-request-email] Error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
