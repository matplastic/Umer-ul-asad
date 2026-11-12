import { GoogleGenAI } from '@google/genai';

// Netlify Function — Management Portal "Ask AI" command parser.
//
// Same advisory-only architecture as ai-command-qc.mjs: this function only
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
// Credentials are injected by Netlify AI Gateway in the modern runtime.

function json(statusCode, body) {
  return Response.json(body, { status: statusCode });
}

export default async (req) => {
  if (req.method !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  let body;
  try {
    body = JSON.parse((await req.text()) || '{}');
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
- intent "stats": manager is asking a question about overall system state rather than acting on one pool — counts, breakdowns, how many pools are where, how many are on hold, attendance, delivery progress, etc. (e.g. "how many pools are pending lamination", "how many pools are on hold", "how many active pools do we have", "who is absent today", "how many pools delivered for Samana Portafino"). Extract "metric" as ONE of:
  - "pools_by_stage" (breakdown of active pools per stage)
  - "pools_on_hold" (list/count of held pools)
  - "pools_total" (total active pool count)
  - "pools_delivered_by_project" (how many pools have been delivered — extract the project name they mentioned into "projectName"; if they didn't name a project, set "projectName" to null and it'll cover all projects)
  - "employees_absent_today" (who/how many staff are absent today — this always means TODAY, there is no date parameter)
  - or null if the question doesn't match any of these — in that case use intent "chat" instead and explain what stats are available.
- intent "chat": anything else — greetings, unclear requests, a request for an action this assistant doesn't support (e.g. deleting data, purging records, editing employees — say plainly that's not available here and must be done manually in the relevant tab), or a pool/reason you can't confidently match. Use "reply" to ask a clarifying question or explain.
- If the manager's message doesn't clearly match any pool in the list, use intent "chat" and say so — do NOT guess a pool number that isn't listed.
- "reply" is always a short (1-2 sentence) natural-language message to show the manager, in plain factory-floor English.

Respond ONLY with JSON matching this exact shape, nothing else:
{"intent":"hold_pool"|"release_hold"|"skip_stage"|"find_pool"|"stats"|"chat","poolNo":string|null,"reason":string|null,"skipOption":"SKIPPED"|"CARRIED_ON_SITE"|null,"metric":"pools_by_stage"|"pools_on_hold"|"pools_total"|"pools_delivered_by_project"|"employees_absent_today"|null,"projectName":string|null,"reply":string}`;

  try {
    const ai = new GoogleGenAI({});
    const modelChain = ['gemini-flash-latest', 'gemini-3.6-flash', 'gemini-flash-lite-latest'];
    let result;
    for (const [index, model] of modelChain.entries()) {
      try {
        result = await ai.models.generateContent({
          model,
          contents: [{ role: 'user', parts: [{ text: message }] }],
          config: { systemInstruction, responseMimeType: 'application/json', temperature: 0.2 },
        });
        break;
      } catch (error) {
        const status = Number(error.status);
        if ([404, 429, 503].includes(status) && index < modelChain.length - 1) {
          continue;
        }
        const reply = status === 429 || status === 503
          ? 'The AI service is busy right now — please try again in a few seconds.'
          : 'Something went wrong reaching the AI service — please try again.';
        return json(200, { intent: 'chat', reply });
      }
    }
    const text = result?.text || '';

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      console.error('[ai-command-management] Non-JSON response from Gemini');
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
      metric: ['pools_by_stage', 'pools_on_hold', 'pools_total', 'pools_delivered_by_project', 'employees_absent_today'].includes(parsed.metric) ? parsed.metric : null,
      projectName: parsed.projectName || null,
      reply: parsed.reply || '',
    });
  } catch (err) {
    console.error('[ai-command-management] AI request failed');
    return json(200, { intent: 'chat', reply: "Something went wrong reaching the AI service — please try again." });
  }
};
