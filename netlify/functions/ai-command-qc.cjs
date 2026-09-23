// Netlify Function — Quality Inspector "Ask AI" command parser.
//
// Takes a natural-language message from a QC inspector (e.g. "reject pool
// P-102 skimmer test, crack in the shell", "pass P-102", or "pass all
// pending lamination") plus a list of pools currently awaiting inspection,
// and asks Gemini to turn that into ONE structured proposed action —
// including, for "pass_bulk", a stage name to match against every pool
// currently pending at that stage. This function NEVER touches Firestore
// and never executes anything — it only returns a proposal. The matching
// against real pending pools/stages, and the actual reject/pass/defect
// writes, all happen client-side through the exact same onRejectStage /
// onApproveStage / onLogDefect handlers the manual buttons already use,
// only after the inspector clicks Confirm in the UI. This keeps the AI
// layer strictly advisory: a misheard pool number, stage, or reason can
// never silently reject/pass the wrong thing.
//
// Env var needed: GEMINI_API_KEY (from https://aistudio.google.com/apikey —
// separate from RESEND_API_KEY / Firebase vars, free tier is enough for this).

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

  // Keep the pool list the model sees small and unambiguous — just enough
  // to match "P-102" or "portafino pool 14" against a real pool.
  const poolList = pools.slice(0, 300).map((p) => `${p.poolNo} | ${p.projectName} | stage: ${p.stageName || p.stageId || 'unknown'}`).join('\n');

  const systemInstruction = `You are a command parser for a fiberglass pool factory's Quality Control app. A QC inspector will type a short instruction. Your ONLY job is to extract a structured action from it — you never perform the action yourself, you only describe it.

Pools currently awaiting QC inspection (the only pools you may target):
${poolList || '(none currently pending)'}

Rules:
- intent "reject": inspector wants to reject a specific pool at its current pending stage. Requires you to identify poolNo from the list above (exact match to the Pool No column — never invent a pool number that isn't in the list) and extract the rejection reason in the inspector's own words. Also produce a short defectType (3-6 words describing the defect, e.g. "Crack in shell surface") and a severity guess ("minor", "major", or "critical" — default "major" if unclear).
- intent "pass": inspector wants to approve/pass ONE specific pool at its current pending stage (e.g. "pass P-102", "P-102 looks good, approve it", "approve pool 14"). Requires poolNo from the list above (exact match — never invent one). Optionally extract short approval notes into "reason" (e.g. "Looks good, no issues") — use null if the inspector gave none.
- intent "pass_bulk": inspector wants to pass/approve ALL pools currently pending at a particular stage (e.g. "pass all pending lamination", "approve everything waiting for skimmer fitting", "clear all skimmer fitting"). Extract "stageQuery" as the exact stage name copied verbatim from after "stage:" in the list above for the stage they mean — do not paraphrase it. Use null for stageQuery if you can't confidently match a stage name that appears in the list.
- intent "details": inspector is asking about a specific pool's status/history/details. Extract poolNo if they named one (must match the list above), else null.
- intent "chat": anything else — greetings, unclear requests, or a pool/reason/stage you can't confidently match. Use "reply" to ask a clarifying question or explain what you need.
- If the inspector's message doesn't clearly match any pool or stage in the list, use intent "chat" and say so — do NOT guess a pool number or stage that isn't listed.
- "reply" is always a short (1-2 sentence) natural-language message to show the inspector, in plain factory-floor English.

Respond ONLY with JSON matching this exact shape, nothing else:
{"intent":"reject"|"pass"|"pass_bulk"|"details"|"chat","poolNo":string|null,"stageQuery":string|null,"reason":string|null,"defectType":string|null,"severity":"minor"|"major"|"critical"|null,"reply":string}`;

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
      console.error('[ai-command-qc] Gemini API error:', res.status, detail);
      return json(200, { intent: 'chat', reply: "Couldn't reach the AI service just now — please try again in a moment." });
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      console.error('[ai-command-qc] Non-JSON response from Gemini:', text);
      return json(200, { intent: 'chat', reply: "Didn't quite understand that — could you rephrase, naming the pool number?" });
    }

    // Validate the proposed pool actually exists in the list we sent, so a
    // hallucinated pool number can never reach the confirmation UI.
    if (parsed.poolNo) {
      const match = pools.find((p) => String(p.poolNo).toLowerCase() === String(parsed.poolNo).toLowerCase());
      if (!match) {
        return json(200, { intent: 'chat', reply: `I couldn't find a pending pool matching "${parsed.poolNo}" — check the pool number and try again.` });
      }
    }

    return json(200, {
      intent: ['reject', 'pass', 'pass_bulk', 'details', 'chat'].includes(parsed.intent) ? parsed.intent : 'chat',
      poolNo: parsed.poolNo || null,
      stageQuery: parsed.stageQuery || null,
      reason: parsed.reason || null,
      defectType: parsed.defectType || null,
      severity: ['minor', 'major', 'critical'].includes(parsed.severity) ? parsed.severity : 'major',
      reply: parsed.reply || '',
    });
  } catch (err) {
    console.error('[ai-command-qc] Failed:', err);
    return json(200, { intent: 'chat', reply: "Something went wrong reaching the AI service — please try again." });
  }
};
