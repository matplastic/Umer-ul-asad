// Browser side of the AUTOMATIC backups (the server side is
// netlify/functions/lib/backupCore.cjs). Snapshots live in Firestore:
//   system_backups/<id>                 summary
//   system_backups/<id>/chunks/<part>   the data in pieces
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { clientDb } from './googleDrive';
import { getApiUrl } from './firebaseService';
import { AutoBackupMeta, BackupChunk, extractBackupDocs, reassembleChunks } from './backupSets';

export type { AutoBackupMeta };

export async function listAutoBackups(): Promise<AutoBackupMeta[]> {
  const snap = await getDocs(query(collection(clientDb, 'system_backups'), orderBy('startedAt', 'desc'), limit(60)));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
}

// Downloads and reassembles one snapshot, returning the restorable lists.
export async function loadAutoBackupDocs(id: string): Promise<Record<string, any[]>> {
  const snap = await getDocs(collection(clientDb, 'system_backups', id, 'chunks'));
  if (snap.empty) throw new Error('This backup has no data parts.');
  return extractBackupDocs(reassembleChunks(snap.docs.map((d) => d.data() as BackupChunk)));
}

// Asks the server to take a backup now. It runs in the background (up to
// 15 minutes), so this returns as soon as the request is accepted — the panel
// then watches for the new snapshot to appear.
export async function requestBackupNow(): Promise<void> {
  const res = await fetch(getApiUrl('/.netlify/functions/daily-backup-background'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trigger: 'manual' }),
  });
  if (!res.ok && res.status !== 202) throw new Error(`The server did not accept the backup request (HTTP ${res.status}).`);
}

