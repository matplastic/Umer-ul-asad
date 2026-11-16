// Settings and pure helpers for "small files" storage (see the notes below).
// No Firebase imports on purpose: the service, the backup/restore code and the
// tests all share this one file, so they can never disagree about how a list is
// split. netlify/functions/lib/shardedState.cjs keeps a matching copy for the
// server (a test checks the two agree).

// ── SMALL FILES: lists that grow without limit are split across several small
// documents ("shards") so no single document can ever hit Firestore's 1 MiB cap.
//
//   materialRequests  16 shards  (~16 MiB of room, tens of thousands of lines)
//   consumptionLogs   16 shards
//   incomingMaterials  8 shards
//   materials          4 shards
//   stockAdjustments   4 shards
//
// HOW IT STAYS SAFE
//  * Placement is by a hash of each record's id, so a record always lives in the
//    same shard. Changing one record rewrites ONE small document, not all of them.
//  * The old single document (system_state/<name>) is folded in automatically
//    the first time anything is saved (inside one transaction), then emptied.
//    No migration script, nothing to run by hand; until then reads merge both.
//  * Every shard remembers how many shards exist (shardCount). A browser tab
//    running an OLDER version of the app refuses to write rather than guess,
//    so raising these numbers later can never lose data. Only ever INCREASE them.
//  * The same numbers and hash are used by netlify/functions/lib/shardedState.cjs
//    (a test checks they match).
export const SHARD_COUNTS: Record<string, number> = {
  materialRequests: 16,
  consumptionLogs: 16,
  incomingMaterials: 8,
  materials: 4,
  stockAdjustments: 4,
};
export const SHARD_BYTES_PER_DOC = 1048576;

export function shardCountFor(docName: string): number {
  return SHARD_COUNTS[docName] || 1;
}

// How much a list can hold before it can no longer be saved (shards x 1 MiB).
export function storageCapacityBytes(docName: string): number {
  return shardCountFor(docName) * SHARD_BYTES_PER_DOC;
}

export function shardDocNamesFor(docName: string): string[] {
  const n = shardCountFor(docName);
  if (n <= 1) return [docName];
  return Array.from({ length: n }, (_, i) => `${docName}__s${i}`);
}

// FNV-1a, 32-bit. Must stay identical to netlify/functions/lib/shardedState.cjs.
export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function shardIndexOf(item: any, index: number, n: number): number {
  const id = item && typeof item === 'object' ? item.id : undefined;
  return typeof id === 'string' && id ? fnv1a(id) % n : index % n;
}

// Split a full array into N shard arrays. Records with an id always land in the
// shard their id hashes to (stable across writes); the rare record without an id
// falls back to its position.
export function splitIntoShards(data: any[], n: number): any[][] {
  if (n <= 1) return [data];
  const shards: any[][] = Array.from({ length: n }, () => []);
  data.forEach((item, i) => shards[shardIndexOf(item, i, n)].push(item));
  return shards;
}

// Combine records still sitting in the old single document with those already
// in the shards. If both have the same id, the shard copy is the newer one.
export function mergeLegacy(legacy: any[], fromShards: any[]): any[] {
  if (legacy.length === 0) return fromShards;
  const byId = new Map<string, any>();
  const noId: any[] = [];
  for (const it of legacy) {
    if (it && typeof it.id === 'string' && it.id) byId.set(it.id, it); else noId.push(it);
  }
  for (const it of fromShards) {
    if (it && typeof it.id === 'string' && it.id) byId.set(it.id, it); else noId.push(it);
  }
  return [...byId.values(), ...noId];
}

