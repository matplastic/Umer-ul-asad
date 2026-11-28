// Date helpers for the goods-receiving forms (Store → Incoming and Receive against a PO).
// The date picked on the form is the day the material ARRIVED. It is saved as `receivedAt`,
// which the Ledger, the PO and the Incoming reports all show. `createdAt` keeps the real
// time the record was typed in.

const pad = (n: number) => String(n).padStart(2, '0');

/** Today as YYYY-MM-DD in the device's local time (what <input type="date"> uses). */
export const todayLocal = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** True when the picked day is after today. */
export const isFutureDay = (picked?: string | null): boolean => !!picked && picked > todayLocal();

/**
 * ISO timestamp to store as `receivedAt` for the picked day.
 * Today (or nothing picked) keeps the real clock time; an earlier day is stored at local noon
 * so it can never slip onto a neighbouring day in any timezone.
 */
export const receivedAtFromDate = (picked?: string | null): string => {
  const day = (picked || '').trim();
  if (!day || day === todayLocal()) return new Date().toISOString();
  return new Date(`${day}T12:00:00`).toISOString();
};
