// Supplier DO / invoice files for goods receipts (GRN).
//
// Files go to Firebase Storage under grn/{incomingId}/…; only the small
// GrnAttachment metadata record is saved on the receipt in Firestore. Never
// embed the file itself in the receipt: incomingMaterials is one Firestore
// document and the 1 MiB limit would be hit after a handful of scans.
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { app } from './googleDrive';
import type { GrnAttachment } from '../types';

export type GrnDocKind = GrnAttachment['kind'];

export const GRN_ACCEPT = 'application/pdf,image/*';
const MAX_BYTES = 10 * 1024 * 1024;          // per file, after image compression
const IMAGE_MAX_SIDE = 2200;                 // px — still readable for invoices
const IMAGE_QUALITY = 0.8;
const OK_IMAGE = /^image\/(jpeg|png|webp)$/;

export const KIND_LABEL: Record<GrnDocKind, string> = { do: 'DO', invoice: 'Invoice', other: 'Other' };

// Returns an error message, or null when the file is acceptable.
export function validateGrnFile(file: File): string | null {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!isPdf && !OK_IMAGE.test(file.type)) {
    return `"${file.name}" is not supported. Use a PDF, JPG, PNG or WEBP file.`;
  }
  // Images are shrunk before upload, so only judge raw size for PDFs.
  if (isPdf && file.size > MAX_BYTES) {
    return `"${file.name}" is ${(file.size / 1048576).toFixed(1)} MB — PDFs must be under 10 MB.`;
  }
  if (!isPdf && file.size > 40 * 1048576) {
    return `"${file.name}" is too large to process.`;
  }
  return null;
}

// Phone photos are 3–8 MB. Downscale + re-encode as JPEG so uploads are quick
// on factory Wi-Fi/mobile data. Falls back to the original if anything fails
// or the "compressed" copy would be bigger.
async function shrinkImage(file: File): Promise<Blob> {
  if (!OK_IMAGE.test(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.fillStyle = '#ffffff';               // flatten transparency (PNG scans)
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', IMAGE_QUALITY));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

const safeName = (n: string) => n.replace(/[^a-z0-9._-]+/gi, '_').slice(-80) || 'file';

export async function uploadGrnFile(
  file: File,
  incomingId: string,
  kind: GrnDocKind,
  uploadedByName: string,
): Promise<GrnAttachment> {
  const bad = validateGrnFile(file);
  if (bad) throw new Error(bad);
  if (!app.options.storageBucket) {
    throw new Error('Firebase Storage is not set up: VITE_FIREBASE_STORAGE_BUCKET is empty.');
  }
  const body = await shrinkImage(file);
  if (body.size > MAX_BYTES) throw new Error(`"${file.name}" is still over 10 MB after compression.`);

  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const contentType = isPdf ? 'application/pdf' : (body === file ? file.type : 'image/jpeg');
  const id = `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const path = `grn/${incomingId}/${kind}_${id}_${safeName(file.name)}`;
  const objRef = ref(getStorage(app), path);
  await uploadBytes(objRef, body, { contentType });
  const url = await getDownloadURL(objRef);
  return {
    id, kind, name: file.name, url, path, type: contentType, size: body.size,
    uploadedAt: new Date().toISOString(), uploadedByName,
  };
}

// Best-effort: a missing/already-deleted object must not block removing the
// attachment record from the receipt.
export async function deleteGrnFile(att: Pick<GrnAttachment, 'path'>): Promise<void> {
  try {
    if (!att.path || !app.options.storageBucket) return;
    await deleteObject(ref(getStorage(app), att.path));
  } catch (e) {
    console.warn('[grn] could not delete stored file', att.path, e);
  }
}
