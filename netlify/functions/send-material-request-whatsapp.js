// Netlify Function — sends the "new material request" notification to the
// manager on WhatsApp via Twilio. Runs server-side so the Twilio Auth Token
// never reaches the browser. Mirrors send-material-request-email.js and is
// safe to call even before Twilio is configured (it just no-ops).
//
// Sends ONE WhatsApp message per batch (the supervisor's whole cart — 1 to
// many material lines).
//
// PER-ITEM APPROVE/REJECT: the message links to the same "Review & Decide"
// page as the email (see netlify/functions/material-request-decide.js),
// which lists every material line with its own Approve/Reject choice —
// so the manager can approve some and reject others in one submit instead
// of an all-or-nothing decision for the whole batch.
//
// Env vars needed (set in Netlify → Site settings → Environment variables):
//   TWILIO_ACCOUNT_SID       - starts with "AC..."
//   TWILIO_AUTH_TOKEN        - from the same Twilio Console page
//   TWILIO_WHATSAPP_FROM     - the Twilio WhatsApp sender, e.g. "whatsapp:+14155238886"
//                              (that's the shared Sandbox number - same for everyone
//                              until you register your own WhatsApp sender)
//   MANAGER_WHATSAPP_NUMBER  - e.g. "+971526209900" (defaults to this if unset)
//   TWILIO_CONTENT_SID       - optional. Once you submit and get approval for a
//                              WhatsApp message template in the Twilio Console,
//                              paste its Content SID ("HX...") here. Required for
//                              messaging the manager BEFORE he has messaged you
//                              first (WhatsApp's business-initiated-message rule).
//                              If left unset, this falls back to a plain-text
//                              message, which only works if the manager already
//                              has an open 24-hour session with your Sandbox
//                              number (i.e. he messaged it recently).
//   APP_BASE_URL             - optional, defaults to the deploy's own host

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

    const sid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';
    const toRaw = process.env.MANAGER_WHATSAPP_NUMBER || '+971526209900';
    const to = toRaw.startsWith('whatsapp:') ? toRaw : `whatsapp:${toRaw}`;
    const contentSid = process.env.TWILIO_CONTENT_SID;

    if (!sid || !authToken) {
      console.warn('[send-material-request-whatsapp] TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN not set — skipping.');
      return { statusCode: 200, body: JSON.stringify({ skipped: true }) };
    }

    const siteUrl = process.env.APP_BASE_URL || `https://${event.headers.host}`;
    const idOrBatchQuery = payload.batchId
      ? `batchId=${encodeURIComponent(payload.batchId)}`
      : `id=${encodeURIComponent(payload.id || '')}`;
    const reviewUrl = `${siteUrl}/.netlify/functions/material-request-decide?${idOrBatchQuery}&token=${payload.approvalToken}`;
    const quickApproveUrl = `${reviewUrl}&action=approve`;
    const quickRejectUrl = `${reviewUrl}&action=reject`;

    const itemsLines = items.map((it) => `• ${it.materialName || ''}: ${it.qtyRequested ?? ''} ${it.unit || ''}`).join('\n');

    const params = new URLSearchParams();
    params.append('From', from);
    params.append('To', to);

    if (contentSid) {
      // Business-initiated message using an approved template.
      // Adjust the {{1}}..{{5}} variable numbers to match however you laid
      // out your approved template in the Twilio Console.
      params.append('ContentSid', contentSid);
      params.append('ContentVariables', JSON.stringify({
        1: items.length > 1 ? `${items.length} items` : (items[0].materialName || ''),
        2: items.length > 1 ? itemsLines : `${items[0].qtyRequested ?? ''} ${items[0].unit || ''}`.trim(),
        3: payload.projectName || '',
        4: reviewUrl,
        5: items.length > 1 ? quickApproveUrl : quickRejectUrl,
      }));
    } else {
      // Plain-text fallback — only delivers if the manager already has an
      // open session with the Sandbox number (messaged it in the last 24h).
      params.append('Body',
        `MAT Plastic Store — New Material Request${items.length > 1 ? ` (${items.length} items)` : ''}\n\n` +
        `${itemsLines}\n\n` +
        `Project: ${payload.projectName || ''}${payload.poolType ? ' / ' + payload.poolType : ''}\n` +
        `Requested by: ${payload.requestedByName || ''} (${payload.requestedByRole || ''})\n\n` +
        `Review & decide (approve/reject each item): ${reviewUrl}\n` +
        (items.length > 1
          ? `Quick approve all: ${quickApproveUrl}\nQuick reject all: ${quickRejectUrl}`
          : '')
      );
    }

    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('[send-material-request-whatsapp] Twilio error:', res.status, detail);
      return { statusCode: 502, body: JSON.stringify({ error: 'Failed to send WhatsApp message', detail }) };
    }

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error('[send-material-request-whatsapp] Error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
