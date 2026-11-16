'use strict';
// Reads/writes the lists that the app stores as several SMALL documents
// ("shards") instead of one big one, so they can never hit Firestore's 1 MiB
// per-document limit.
//
// MUST stay in step with src/lib/firebaseService.ts (same shard counts, same
// hash, same document names, same "old single document is folded in" rule).
// A test compares the two, so changing one without the other fails loudly.
//
// Layout in Firestore (collection "system_state"):
//   <name>            old single document { data: [...] }   (emptied after migration)
//   <name>__s0 ...    shard documents      { data: [...], shardCount: N }

const SHARD_COUNTS = {
  materialRequests: 16,
  consumptionLogs: 16,
  incomingMaterials: 8,
  materials: 4,
  stockAdjustments: 4,
};

function shardCountFor(name) {
  return SHARD_COUNTS[name] || 1;
}

function shardDocNamesFor(name) {
  const n = shardCountFor(name);
  if (n <= 1) return [name];
  return Array.from({ length: n }, (_, i) => `${name}__s${i}`);
}

// FNV-1a, 32-bit.
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function shardIndexOf(item, index, n) {
  const id = item && typeof item === 'object' ? item.id : undefined;
  return typeof id === 'string' && id ? fnv1a(id) % n : index % n;
}

function splitIntoShards(data, n) {
  if (n <= 1) return [data];
  const shards = Array.from({ length: n }, () => []);
  data.forEach((item, i) => shards[shardIndexOf(item, i, n)].push(item));
  return shards;
}

function mergeLegacy(legacy, fromShards) {
  if (legacy.length === 0) return fromShards;
  const byId = new Map();
  const noId = [];
  for (const it of legacy) {
    if (it && typeof it.id === 'string' && it.id) byId.set(it.id, it); else noId.push(it);
  }
  for (const it of fromShards) {
    if (it && typeof it.id === 'string' && it.id) byId.set(it.id, it); else noId.push(it);
  }
  return [...byId.values(), ...noId];
}

function removeUndefined(v) {
  if (Array.isArray(v)) return v.map(removeUndefined);
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, removeUndefined(x)]));
  }
  return v;
}

const arrOf = (snap) => (snap.exists && snap.data() && Array.isArray(snap.data().data) ? snap.data().data : []);

function refsFor(db, name) {
  const col = db.collection('system_state');
  return { legacyRef: col.doc(name), shardRefs: shardDocNamesFor(name).map((sn) => col.doc(sn)) };
}

function buildRead(name, legacySnap, shardSnaps) {
  const n = shardCountFor(name);
  const legacyData = arrOf(legacySnap);
  const shardData = shardSnaps.map(arrOf);
  const shardMeta = shardSnaps.map((sn) => ({ exists: !!sn.exists, shardCount: sn.exists ? (sn.data() || {}).shardCount : undefined }));
  if (shardMeta.some((m) => typeof m.shardCount === 'number' && m.shardCount > n)) {
    throw new Error('Stored data uses more shards than this function knows about. Redeploy the functions (they are out of date).');
  }
  return { name, n, legacyData, shardData, shardMeta, current: mergeLegacy(legacyData, shardData.flat()) };
}

// Plain (non-transaction) read of the whole logical list.
async function readArray(db, name) {
  const { legacyRef, shardRefs } = refsFor(db, name);
  const [legacySnap, ...shardSnaps] = await Promise.all([legacyRef.get(), ...shardRefs.map((r) => r.get())]);
  return buildRead(name, legacySnap, shardSnaps).current;
}

// Same, but inside a Firestore transaction (tx.get), so the caller can write
// the result back safely. Returns a handle for planWrites().
async function readArrayTx(db, tx, name) {
  const { legacyRef, shardRefs } = refsFor(db, name);
  const [legacySnap, ...shardSnaps] = await Promise.all([tx.get(legacyRef), ...shardRefs.map((r) => tx.get(r))]);
  const rd = buildRead(name, legacySnap, shardSnaps);
  rd.legacyRef = legacyRef;
  rd.shardRefs = shardRefs;
  return rd;
}

// Documents to write to turn rd.current into `updated`: only shards that really
// changed, plus (once) emptying the old single document after migration.
function planWrites(rd, updated) {
  const shards = splitIntoShards(removeUndefined(updated), rd.n);
  const migrating = rd.legacyData.length > 0;
  const writes = [];
  shards.forEach((data, i) => {
    const meta = rd.shardMeta[i];
    const unchanged = !migrating && meta.exists && meta.shardCount === rd.n && JSON.stringify(rd.shardData[i]) === JSON.stringify(data);
    if (!unchanged) writes.push({ ref: rd.shardRefs[i], data: { data, shardCount: rd.n } });
  });
  if (migrating) writes.push({ ref: rd.legacyRef, data: { data: [], migratedToShards: rd.n, migratedAt: new Date().toISOString() } });
  return writes;
}

module.exports = {
  SHARD_COUNTS, shardCountFor, shardDocNamesFor, fnv1a, shardIndexOf, splitIntoShards, mergeLegacy,
  readArray, readArrayTx, planWrites,
};
