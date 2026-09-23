// Netlify Function — Management Portal "Ask AI" command parser.
//
// Same advisory-only architecture as ai-command-qc.cjs: this function only
// ever proposes ONE structured action from a manager's natural-language
// message (or transcribed voice command). It never touches Firestore
// itself. The actual write happens client-side, through the exact same
// onHoldPool / onReleaseHold / onSkipOrCarryOnSite handlers the manual
// buttons already use, only after the manager clicks Confirm.
//
// SCOPE — deliberately NOT "do anything to the system":
// This intentionally covers read-only stats/lookups plus a small set of
// REVERSIBLE pool actions (hold, release hold, skip/carry-on-site). It does
// NOT wire up delete pool, delete employee, purge data, or restore state —
// those are irreversible or bulk-destructive, and a single misheard word
// or model slip turning into "delete everything" is a real risk not worth
// taking for a free-text command box, confirmation dialog or not. If you
// want a specific destructive action added later, it should get its own
// narrow intent with an extra typed-confirmation step (e.g. re-type the
// pool number), not be folded into general "manage everything" freedom.
//
// Env var needed: GEMINI_API_KEY (same one ai-command-qc.cjs uses).

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return json(200, {
      intent: 'chat',
      reply: "AI assistant isn't set up yet — ask your admin to add a GEMINI_API_KEY to the site's environment variables.",
    });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  const message = String(body.message || '').trim();
  const pools = Array.isArray(body.pools) ? body.pools : [];
  if (!message) return json(400, { error: 'message is required' });

  // Keep the pool list small and unambiguous — poolNo, project, current
  // stage, and hold status, enough to match "P-102" or "hold portafino 14".
  const poolList = pools.slice(0, 400)
    .map((p) => `${p.poolNo} | ${p.projectName} | stage: ${p.stageName || p.stageId || 'unknown'} | ${p.isOnHold ? 'ON HOLD' : 'active'}`)
    .join('\n');

  const systemInstruction = `You are a command parser for the management console of a fiberglass pool factory ERP. A manager will type or speak a short instruction. Your ONLY job is to extract a structured action from it — you never perform the action yourself, you only describe it.

Pools currently in the system (the only pools you may target):
${poolList || '(no active pools)'}

Rules:
- intent "hold_pool": manager wants to put a specific pool on hold (e.g. "hold P-102", "put pool 14 on hold, waiting on customer approval"). Requires poolNo from the list above (exact match — never invent one). Extract a short reason into "reason" if given, else null.
- intent "release_hold": manager wants to release/unhold a specific pool that is ON HOLD (e.g. "release hold on P-102", "unhold pool 14"). Requires poolNo from the list above, and it should currently be marked "ON HOLD" — if it isn't on hold, still return this intent with the poolNo and let the client explain, do not silently switch intents.
- intent "skip_stage": manager wants to mark a specific pool's CURRENT stage as skipped or carried out on-site (e.g. "skip lamination for P-102", "mark P-102 as carried on site"). Requires poolNo from the list above, and "skipOption" as either "SKIPPED" or "CARRIED_ON_SITE" (default "SKIPPED" if the manager didn't specify which).
- intent "find_pool": manager is asking about a specific pool's status/details. Extract poolNo if named (must match the list above), else null.
- intent "stats": manager is asking a question about overall system state rather than acting on one pool — counts, breakdowns, how many pools are where, how many are on hold, etc. (e.g. "how many pools are pending lamination", "how many pools are on hold", "how many active pools do we have"). Extract "metric" as ONE of: "pools_by_stage" (breakdown of active pools per stage), "pools_on_hold" (list/count of held pools), "pools_total" (total active pool count), or null if the question doesn't match any of these — in that case use intent "chat" instead and explain what stats are available.
- intent "chat": anything else — greetings, unclear requests, a request for an action this assistant doesn't support (e.g. deleting data, purging records, editing employees — say plainly that's not available here and must be done manually in the relevant tab), or a pool/reason you can't confidently match. Use "reply" to ask a clarifying question or explain.
- If the manager's message doesn't clearly match any pool in the list, use intent "chat" and say so — do NOT guess a pool number that isn't listed.
- "reply" is always a short (1-2 sentence) natural-language message to show the manager, in plain factory-floor English.

Respond ONLY with JSON matching this exact shape, nothing else:
{"intent":"hold_pool"|"release_hold"|"skip_stage"|"find_pool"|"stats"|"chat","poolNo":string|null,"reason":string|null,"skipOption":"SKIPPED"|"CARRIED_ON_SITE"|null,"metric":"pools_by_stage"|"pools_on_hold"|"pools_total"|null,"reply":string}`;

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: 'user', parts: [{ text: message }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.2,
        },
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('[ai-command-management] Gemini API error:', res.status, detail);
      return json(200, { intent: 'chat', reply: "Couldn't reach the AI service just now — please try again in a moment." });
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      console.error('[ai-command-management] Non-JSON response from Gemini:', text);
      return json(200, { intent: 'chat', reply: "Didn't quite understand that — could you rephrase, naming the pool number?" });
    }

    // Validate the proposed pool actually exists in the list we sent, so a
    // hallucinated pool number can never reach the confirmation UI.
    if (parsed.poolNo) {
      const match = pools.find((p) => String(p.poolNo).toLowerCase() === String(parsed.poolNo).toLowerCase());
      if (!match) {
        return json(200, { intent: 'chat', reply: `I couldn't find a pool matching "${parsed.poolNo}" — check the pool number and try again.` });
      }
    }

    return json(200, {
      intent: ['hold_pool', 'release_hold', 'skip_stage', 'find_pool', 'stats', 'chat'].includes(parsed.intent) ? parsed.intent : 'chat',
      poolNo: parsed.poolNo || null,
      reason: parsed.reason || null,
      skipOption: ['SKIPPED', 'CARRIED_ON_SITE'].includes(parsed.skipOption) ? parsed.skipOption : 'SKIPPED',
      metric: ['pools_by_stage', 'pools_on_hold', 'pools_total'].includes(parsed.metric) ? parsed.metric : null,
      reply: parsed.reply || '',
    });
  } catch (err) {
    console.error('[ai-command-management] Failed:', err);
    return json(200, { intent: 'chat', reply: "Something went wrong reaching the AI service — please try again." });
  }
};
