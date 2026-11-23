// Quotation PDFs and bank / LC documents for the Procurement portal.
//
// Files go to Firebase Storage; only the small ProcAttachment record is saved in Firestore (never the
// file itself — each list is one Firestore document with a 1 MiB limit).
//
// The storage path deliberately uses the same top-level folder (grn/) and depth as the Store's DO /
// invoice scans, so it is covered by the Storage rules you already have: grn/proc_{owner}/{file}.
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { app } from './googleDrive';
import { shrinkImage, validateGrnFile, deleteGrnFile } from './grnAttachments';
import type { ProcAttachment } from '../types';

export const PROC_ACCEPT = 'application/pdf,image/*';
const MAX_BYTES = 10 * 1024 * 1024;
const safeName = (n: string) => n.replace(/[^a-z0-9._-]+/gi, '_').slice(-80) || 'file';

export async function uploadProcFile(file: File, ownerKey: string, kind: string, uploadedByName: string): Promise<ProcAttachment> {
  const bad = validateGrnFile(file);                      // PDF / JPG / PNG / WEBP, PDFs under 10 MB
  if (bad) throw new Error(bad);
  if (!app.options.storageBucket) throw new Error('Firebase Storage is not set up: VITE_FIREBASE_STORAGE_BUCKET is empty.');
  const body = await shrinkImage(file);                   // phone photos are shrunk, PDFs untouched
  if (body.size > MAX_BYTES) throw new Error(`"${file.name}" is still over 10 MB after compression.`);
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const contentType = isPdf ? 'application/pdf' : (body === file ? file.type : 'image/jpeg');
  const id = `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const path = `grn/proc_${ownerKey}/${kind}_${id}_${safeName(file.name)}`;
  const objRef = ref(getStorage(app), path);
  await uploadBytes(objRef, body, { contentType });
  const url = await getDownloadURL(objRef);
  return { id, kind, name: file.name, url, path, type: contentType, size: body.size, uploadedAt: new Date().toISOString(), uploadedByName };
}

export const deleteProcFile = (att: Pick<ProcAttachment, 'path'>) => deleteGrnFile(att);

export const fileSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
