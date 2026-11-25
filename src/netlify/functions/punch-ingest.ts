// netlify/functions/punch-ingest.ts
// Receives punches from zk_sync.py and saves them in Firestore collection "punches".
// Sending the same punch twice is safe (same document id).
//
// Netlify environment variables needed:
//   PUNCH_API_KEY            - secret you create yourself
//   FIREBASE_SERVICE_ACCOUNT - Firebase service account JSON (plain JSON or base64 of it)

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createHash, timingSafeEqual } from "crypto";

type HandlerEvent = {
  httpMethod: string;
  headers: Record<string, string | undefined>;
  body: string | null;
};

function loadServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || "";
  try { return JSON.parse(raw); }
  catch { return JSON.parse(Buffer.from(raw, "base64").toString("utf8")); }
}

if (!getApps().length) initializeApp({ credential: cert(loadServiceAccount()) });
const db = getFirestore();

type IncomingPunch = { employeeCode: string; timestamp: string; deviceId?: string; type?: "IN" | "OUT" };

// Times without an offset are treated as UAE time (+04:00)
const withUaeOffset = (ts: string) => (/[zZ]|[+-]\d{2}:?\d{2}$/.test(ts) ? ts : `${ts}+04:00`);

function keyOk(given: string | undefined): boolean {
  const expected = process.env.PUNCH_API_KEY || "";
  if (!given || !expected || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

export const handler = async (event: HandlerEvent) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "POST only" };
  if (!keyOk(event.headers["x-api-key"])) return { statusCode: 401, body: "Unauthorized" };

  let punches: IncomingPunch[];
  try {
    const body = JSON.parse(event.body || "{}");
    punches = Array.isArray(body) ? body : body.punches;
  } catch { return { statusCode: 400, body: "Invalid JSON" }; }
  if (!Array.isArray(punches) || punches.length === 0) return { statusCode: 400, body: "No punches" };

  let saved = 0, skipped = 0;
  for (let i = 0; i < punches.length; i += 400) {          // Firestore batch limit is 500
    const batch = db.batch();
    for (const p of punches.slice(i, i + 400)) {
      const d = new Date(withUaeOffset(String(p.timestamp)));
      if (!p.employeeCode || isNaN(d.getTime())) { skipped++; continue; }
      const id = createHash("sha1").update(`${p.employeeCode}|${d.toISOString()}|${p.deviceId ?? ""}`).digest("hex");
      batch.set(db.collection("punches").doc(id), {
        employeeCode: String(p.employeeCode),
        punchedAt: d,
        deviceId: p.deviceId ?? null,
        type: p.type ?? null,
        source: "zk-device",
        receivedAt: new Date(),
      }, { merge: true });
      saved++;
    }
    await batch.commit();
  }

  await db.collection("settings").doc("attendanceIntegration").set(
    { lastSyncAt: new Date(), lastSyncCount: saved }, { merge: true });

  return { statusCode: 200, body: JSON.stringify({ saved, skipped }) };
};
