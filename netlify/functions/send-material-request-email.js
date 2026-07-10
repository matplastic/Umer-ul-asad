// Netlify Function — sends the "new material request" email to the manager.
// Runs server-side, so the Resend API key never reaches the browser.
//
// Sends ONE email per batch (the supervisor's whole cart — 1 to many
// material lines), with a line-items table and ONE Approve/ONE Reject
// action for the whole batch — instead of one email per material.
//
// Env vars needed (set in Netlify → Site settings → Environment variables):
//   RESEND_API_KEY, STORE_EMAIL_FROM, STORE_MANAGER_EMAIL, APP_BASE_URL (optional)

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const payload = JSON.parse(event.body || '{}');
    const items = Array.isArray(payload.items) ? payload.items : [];
    if (items.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'no items' }) };
    }

    const apiKey = process.env.RESEND_API_KEY;
    const managerEmails = (process.env.STORE_MANAGER_EMAIL || 'hussein.khalil@matglobal.tech')
      .split(',').map((e) => e.trim()).filter(Boolean);

    if (!apiKey || managerEmails.length === 0) {
      console.warn('[send-material-request-email] RESEND_API_KEY or STORE_MANAGER_EMAIL not set — skipping.');
      return { statusCode: 200, body: JSON.stringify({ skipped: true }) };
    }

    const siteUrl = process.env.APP_BASE_URL || `https://${event.headers.host}`;
    const logoUrl = `${siteUrl}/logo.png`;
    const idOrBatchQuery = payload.batchId
      ? `batchId=${encodeURIComponent(payload.batchId)}`
      : `id=${encodeURIComponent(payload.id || '')}`;
    const approveUrl = `${siteUrl}/.netlify/functions/material-request-decide?${idOrBatchQuery}&token=${payload.approvalToken}&action=approve`;
    const rejectUrl = `${siteUrl}/.netlify/functions/material-request-decide?${idOrBatchQuery}&token=${payload.approvalToken}&action=reject`;
    const from = process.env.STORE_EMAIL_FROM || 'MAT Plastic Store <onboarding@resend.dev>';

    const rows = items.map((it) => `
      <tr>
        <td style="padding:6px 8px 6px 0; border-bottom:1px solid #e2e8f0;">${it.materialName || ''}</td>
        <td style="padding:6px 0; border-bottom:1px solid #e2e8f0; text-align:right; white-space:nowrap;">${it.qtyRequested ?? ''} ${it.unit || ''}</td>
      </tr>`).join('');

    const subject = items.length > 1
      ? `Material Request: ${items.length} items for ${payload.projectName || ''} / ${payload.poolType || ''}`
      : `Material Request: ${items[0].materialName} for ${payload.projectName || ''} / ${payload.poolType || ''}`;

    const html = `
      <div style="font-family:Arial,sans-serif; max-width:560px; margin:0 auto; color:#1e293b;">
        <div style="background:#0f172a; padding:20px 24px; border-radius:10px 10px 0 0; display:flex; align-items:center; gap:12px;">
          <img src="${logoUrl}" alt="MAT Plastic Industries LLC" style="height:34px; width:auto; display:inline-block; vertical-align:middle;" />
          <h2 style="color:#fff; margin:0; font-size:15px; text-transform:uppercase; display:inline-block; vertical-align:middle;">MAT Plastic Industries LLC — Store</h2>
        </div>
        <div style="border:1px solid #e2e8f0; border-top:none; padding:24px; border-radius:0 0 10px 10px;">
          <h3 style="margin-top:0;">New Material Request${items.length > 1 ? ` — ${items.length} items` : ''}</h3>
          <table style="width:100%; border-collapse:collapse; font-size:14px; margin-bottom:16px;">
            <tr><td style="padding:6px 0; color:#64748b; width:140px;">Project</td><td style="padding:6px 0; font-weight:600;">${payload.projectName || ''}</td></tr>
            <tr><td style="padding:6px 0; color:#64748b;">Pool Type</td><td style="padding:6px 0; font-weight:600;">${payload.poolType || ''}</td></tr>
            ${payload.poolNo ? `<tr><td style="padding:6px 0; color:#64748b;">Pool No.</td><td style="padding:6px 0; font-weight:600;">${payload.poolNo}</td></tr>` : ''}
            <tr><td style="padding:6px 0; color:#64748b;">Requested by</td><td style="padding:6px 0; font-weight:600;">${payload.requestedByName || ''} (${payload.requestedByRole || ''})</td></tr>
            ${payload.reason ? `<tr><td style="padding:6px 0; color:#64748b;">Reason</td><td style="padding:6px 0;">${payload.reason}</td></tr>` : ''}
          </table>
          <table style="width:100%; border-collapse:collapse; font-size:14px; margin-bottom:20px;">
            <thead>
              <tr>
                <th style="text-align:left; padding:6px 8px 6px 0; border-bottom:2px solid #0f172a; color:#64748b; font-size:11px; text-transform:uppercase;">Material</th>
                <th style="text-align:right; padding:6px 0; border-bottom:2px solid #0f172a; color:#64748b; font-size:11px; text-transform:uppercase;">Qty</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <div>
            <a href="${approveUrl}" style="background:#16a34a; color:#fff; text-decoration:none; padding:12px 22px; border-radius:8px; font-weight:700; font-size:14px; display:inline-block; margin-right:10px;">✓ Approve ${items.length > 1 ? 'All' : ''}</a>
            <a href="${rejectUrl}" style="background:#dc2626; color:#fff; text-decoration:none; padding:12px 22px; border-radius:8px; font-weight:700; font-size:14px; display:inline-block;">✗ Reject ${items.length > 1 ? 'All' : ''}</a>
          </div>
          <p style="color:#94a3b8; font-size:12px; margin-top:20px;">Tapping Approve/Reject opens a confirmation page — nothing happens until you tap the button on that page. ${payload.batchId ? `Batch: ${payload.batchId}` : `Request ID: ${payload.id}`}</p>
        </div>
      </div>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: managerEmails,
        subject,
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
