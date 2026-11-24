// ───────────────────────────────────────────────────────────
// Shrink a PDF in the browser.
//
// Each page is drawn to an image, saved as JPEG and put back into a new PDF.
// Resolution and quality are lowered step by step until the file fits.
// Good for scanned passports, IDs, contracts. Text in the new PDF is no longer
// selectable (it becomes a picture of the page) — that is the trade-off.
// ───────────────────────────────────────────────────────────
import { jsPDF } from 'jspdf';

const MAX_PAGES = 40;
// [render scale, jpeg quality] — from best to smallest.
const STEPS: [number, number][] = [
  [1.6, 0.75], [1.4, 0.6], [1.2, 0.55], [1.0, 0.5], [0.85, 0.45], [0.7, 0.4], [0.55, 0.35],
];

let workerReady = false;
async function loadPdfJs() {
  const pdfjs: any = await import('pdfjs-dist');
  if (!workerReady) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
    workerReady = true;
  }
  return pdfjs;
}

const toJpeg = (c: HTMLCanvasElement, q: number) =>
  new Promise<string>(res => res(c.toDataURL('image/jpeg', q)));

export async function shrinkPdfUnderCap(file: File, cap: number): Promise<Blob> {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    if (doc.numPages > MAX_PAGES) throw new Error(`"${file.name}" has ${doc.numPages} pages — too many to compress here (max ${MAX_PAGES}).`);

    let lastScale = -1;
    let canvases: HTMLCanvasElement[] = [];
    let sizes: [number, number][] = [];   // page size in PDF points

    for (const [scale, quality] of STEPS) {
      if (scale !== lastScale) {            // render once per scale, reuse for other qualities
        canvases = []; sizes = [];
        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const vp = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
          const ctx = canvas.getContext('2d')!;
          ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
          canvases.push(canvas); sizes.push([base.width, base.height]);
          page.cleanup();
        }
        lastScale = scale;
      }
      const out = new jsPDF({ unit: 'pt', format: [sizes[0][0], sizes[0][1]], compress: true });
      for (let i = 0; i < canvases.length; i++) {
        const [w, h] = sizes[i];
        if (i > 0) out.addPage([w, h], w > h ? 'l' : 'p');
        out.addImage(await toJpeg(canvases[i], quality), 'JPEG', 0, 0, w, h, undefined, 'FAST');
      }
      const blob = out.output('blob');
      if (blob.size <= cap) return blob;
    }
    throw new Error(`"${file.name}" could not be made smaller than ${Math.round(cap / 1000)} KB. Split it into fewer pages or scan at lower quality.`);
  } finally { doc.destroy?.(); }
}
