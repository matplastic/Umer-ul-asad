// Netlify Function — emails the manager about a new HR purchase request
// (office supplies, accommodation items, etc.) with an Approve/Reject link.
// Mirrors netlify/functions/send-material-request-email.js but for a single
// HR item at a time instead of a Store material cart.
//
// Env vars needed (Netlify → Site settings → Environment variables):
//   RESEND_API_KEY, HR_EMAIL_FROM (optional), HR_MANAGER_EMAIL (falls back
//   to STORE_MANAGER_EMAIL if not set), APP_BASE_URL (optional)

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const payload = JSON.parse(event.body || '{}');
    if (!payload.id || !payload.approvalToken) {
      return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'missing id/token' }) };
    }

    const apiKey = process.env.RESEND_API_KEY;
    const managerEmails = (process.env.HR_MANAGER_EMAIL || process.env.STORE_MANAGER_EMAIL || 'hussein.khalil@matglobal.tech')
      .split(',').map((e) => e.trim()).filter(Boolean);

    if (!apiKey || managerEmails.length === 0) {
      console.warn('[send-hr-purchase-request-email] RESEND_API_KEY or HR_MANAGER_EMAIL not set — skipping.');
      return { statusCode: 200, body: JSON.stringify({ skipped: true }) };
    }

    const siteUrl = process.env.APP_BASE_URL || `https://${event.headers.host}`;
    const logoUrl = `${siteUrl}/logo.png`;
    const reviewUrl = `${siteUrl}/.netlify/functions/hr-purchase-request-decide?id=${encodeURIComponent(payload.id)}&token=${payload.approvalToken}`;
    const quickApproveUrl = `${reviewUrl}&action=approve`;
    const quickRejectUrl = `${reviewUrl}&action=reject`;
    const from = process.env.HR_EMAIL_FROM || 'MAT Plastic HR <onboarding@resend.dev>';

    const subject = `HR Purchase Request: ${payload.itemName || 'Item'} (${payload.category || 'Office'})`;

    const html = `
      <div style="font-family:Arial,sans-serif; max-width:560px; margin:0 auto; color:#1e293b;">
        <div style="background:#0f172a; padding:20px 24px; border-radius:10px 10px 0 0; display:flex; align-items:center; gap:12px;">
          <img src="${logoUrl}" alt="MAT Plastic Industries LLC" style="height:34px; width:auto; display:inline-block; vertical-align:middle;" />
          <h2 style="color:#fff; margin:0; font-size:15px; text-transform:uppercase; display:inline-block; vertical-align:middle;">MAT Plastic Industries LLC — HR</h2>
        </div>
        <div style="border:1px solid #e2e8f0; border-top:none; padding:24px; border-radius:0 0 10px 10px;">
          <h3 style="margin-top:0;">New Purchase Request</h3>
          <table style="width:100%; border-collapse:collapse; font-size:14px; margin-bottom:20px;">
            <tr><td style="padding:6px 0; color:#64748b; width:140px;">Item</td><td style="padding:6px 0; font-weight:600;">${payload.itemName || ''}</td></tr>
            <tr><td style="padding:6px 0; color:#64748b;">Category</td><td style="padding:6px 0; font-weight:600;">${payload.category || ''}</td></tr>
            <tr><td style="padding:6px 0; color:#64748b;">Quantity</td><td style="padding:6px 0; font-weight:600;">${payload.qty ?? ''} ${payload.unit || ''}</td></tr>
            ${payload.estimatedCost ? `<tr><td style="padding:6px 0; color:#64748b;">Est. Cost</td><td style="padding:6px 0; font-weight:600;">AED ${payload.estimatedCost}</td></tr>` : ''}
            <tr><td style="padding:6px 0; color:#64748b;">Requested by</td><td style="padding:6px 0; font-weight:600;">${payload.requestedByName || ''}</td></tr>
            ${payload.purpose ? `<tr><td style="padding:6px 0; color:#64748b; vertical-align:top;">Purpose</td><td style="padding:6px 0;">${payload.purpose}</td></tr>` : ''}
          </table>
          <div>
            <a href="${reviewUrl}" style="background:#0f172a; color:#fff; text-decoration:none; padding:12px 22px; border-radius:8px; font-weight:700; font-size:14px; display:inline-block; margin-right:10px; margin-bottom:8px;">📋 Review &amp; Decide</a>
          </div>
          <div style="margin-top:4px;">
            <a href="${quickApproveUrl}" style="color:#16a34a; text-decoration:none; font-weight:700; font-size:13px; margin-right:18px;">✓ Quick Approve</a>
            <a href="${quickRejectUrl}" style="color:#dc2626; text-decoration:none; font-weight:700; font-size:13px;">✗ Quick Reject</a>
          </div>
          <p style="color:#94a3b8; font-size:12px; margin-top:20px;">Opens a confirmation page — nothing happens until you submit on that page. Request ID: ${payload.id}</p>
        </div>
      </div>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: managerEmails, subject, html }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('[send-hr-purchase-request-email] Resend error:', res.status, detail);
      return { statusCode: 502, body: JSON.stringify({ error: 'Failed to send email', detail }) };
    }

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error('[send-hr-purchase-request-email] Error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
