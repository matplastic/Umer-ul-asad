// ───────────────────────────────────────────────────────────
// MAT-ERP — HR document files (passport, ID, visa, photos…)
//
// Files are stored PERMANENTLY in Firebase Storage under hr/{employeeId}/…;
// the HR record only keeps a small link (HRFile). Nothing is ever embedded
// in a Firestore document, so the 1 MiB document limit cannot be hit.
//
// EVERY FILE IS CAPPED AT 1 MB:
//   • Photos / scans (JPG, PNG, WEBP) are shrunk automatically until they
//     are under the cap — readable, but small.
//   • PDFs cannot be shrunk in the browser, so a PDF over 1 MB is refused
//     with a clear message (compress it, or photograph the page instead).
// ───────────────────────────────────────────────────────────
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { app } from './googleDrive';
import type { HRFile } from './hrStore';
import { isHRSandbox } from './hrStore';

export const HR_FILE_ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp';
export const HR_MAX_FILE_BYTES = 1_000_000;   // 1 MB hard cap per file
export const HR_MAX_FILES_PER_RECORD = 5;
const OK_IMAGE = /^image\/(jpeg|png|webp)$/;
const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
const safeName = (n: string) => n.replace(/[^a-z0-9._-]+/gi, '_').slice(-80) || 'file';
export const fmtBytes = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`;

/** Returns an error message, or null when the file can be accepted. */
export function validateHRFile(file: File): string | null {
  if (!isPdf(file) && !OK_IMAGE.test(file.type)) return `"${file.name}" is not supported. Use a PDF, JPG, PNG or WEBP file.`;
  if (isPdf(file) && file.size > HR_MAX_FILE_BYTES) {
    return `"${file.name}" is ${fmtBytes(file.size)} — PDFs must be under 1 MB. Compress it first, or take a clear photo of the page instead.`;
  }
  if (!isPdf(file) && file.size > 40 * 1_000_000) return `"${file.name}" is too large to process.`;
  return null;
}

// Re-encode as JPEG, stepping the size and quality down until it fits the cap.
async function shrinkImageUnderCap(file: File): Promise<Blob> {
  if (file.size <= HR_MAX_FILE_BYTES && /^image\/(jpeg|webp)$/.test(file.type)) return file;
  const bitmap = await createImageBitmap(file);
  const longest = Math.max(bitmap.width, bitmap.height);
  const sides = [2200, 1800, 1500, 1200, 1000, 800, 640];
  const qualities = [0.82, 0.7, 0.6, 0.5];
  try {
    for (const side of sides) {
      const scale = Math.min(1, side / longest);
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) break;
      ctx.fillStyle = '#ffffff';            // flatten transparency (PNG scans)
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(bitmap, 0, 0, w, h);
      for (const q of qualities) {
        const blob: Blob | null = await new Promise(res => canvas.toBlob(res, 'image/jpeg', q));
        if (blob && blob.size <= HR_MAX_FILE_BYTES) return blob;
      }
    }
  } finally { bitmap.close?.(); }
  throw new Error(`"${file.name}" could not be made smaller than 1 MB. Try a clearer, simpler photo.`);
}

function friendly(e: any): Error {
  const code = String(e?.code || '');
  if (code === 'storage/unauthorized') return new Error('Storage refused the upload. The Firebase Storage rules need to allow signed-in users to write to the "hr/" folder (see the setup note).');
  if (code === 'storage/retry-limit-exceeded' || code === 'storage/network-request-failed') return new Error('The connection dropped during upload. Check the network and try again.');
  return e instanceof Error ? e : new Error('Upload failed.');
}

export async function uploadHRFile(file: File, employeeId: string, recordId: string, uploadedBy?: string): Promise<HRFile> {
  const bad = validateHRFile(file);
  if (bad) throw new Error(bad);
  if (isHRSandbox()) {
    // Demo screen: keep the file in the browser only — nothing is uploaded or stored.
    const id = `demo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    return { id, name: file.name, url: URL.createObjectURL(file), path: '', type: file.type || 'application/octet-stream', size: file.size, uploadedAt: new Date().toISOString(), uploadedBy };
  }
  if (!app.options.storageBucket) throw new Error('Firebase Storage is not set up (storage bucket is empty in the app settings).');
  try {
    const body = isPdf(file) ? file : await shrinkImageUnderCap(file);
    if (body.size > HR_MAX_FILE_BYTES) throw new Error(`"${file.name}" is over 1 MB.`);
    const contentType = isPdf(file) ? 'application/pdf' : (body === file ? file.type : 'image/jpeg');
    const id = `f_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const path = `hr/${employeeId}/${recordId}/${id}_${safeName(file.name)}`;
    const objRef = ref(getStorage(app), path);
    await uploadBytes(objRef, body, { contentType });
    const url = await getDownloadURL(objRef);
    return { id, name: file.name, url, path, type: contentType, size: body.size, uploadedAt: new Date().toISOString(), uploadedBy };
  } catch (e) { throw friendly(e); }
}

/** Best-effort: a missing / already-deleted object must never block removing the record. */
export async function deleteHRFile(f: Pick<HRFile, 'path'>): Promise<void> {
  try {
    if (isHRSandbox() || !f.path || !app.options.storageBucket) return;
    await deleteObject(ref(getStorage(app), f.path));
  } catch (e) { console.warn('[hr] could not delete stored file', f.path, e); }
}
