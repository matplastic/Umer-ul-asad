import React, { useEffect, useRef, useState } from 'react';
import { Printer } from 'lucide-react';
import { MaterialRequest } from '../types';
import { subscribeToMaterialRequests, dbMarkMaterialRequestBatchPrinted } from '../lib/firebaseService';

/**
 * AutoPrintMaterialSlip
 * ─────────────────────
 * Mounted once on the Shop Floor kiosk screen (the tablet/PC physically
 * sitting in the store next to the printer). It listens to Firestore in
 * real time, and the moment a manager approves a material request batch
 * — from his phone, at home, on a totally different WiFi — this component:
 *
 *   1. Notices the batch flip to APPROVED
 *   2. Renders a printable issue slip into the hidden #auto-print-area
 *   3. Fires window.print() automatically (no click needed)
 *   4. Marks the batch PRINTED so it never re-prints
 *
 * Requires the kiosk browser to be set up for silent/no-dialog printing to
 * the default printer (e.g. Chrome with --kiosk-printing), otherwise the
 * OS print dialog will pop up on the kiosk screen — which is still fine,
 * just not fully hands-off.
 */
export const AutoPrintMaterialSlip: React.FC = () => {
  const [queue, setQueue] = useState<MaterialRequest[][]>([]);
  const [printing, setPrinting] = useState<MaterialRequest[] | null>(null);
  const seenBatchIds = useRef<Set<string>>(new Set());
  const processingRef = useRef(false);

  // Listen for approved-but-not-yet-printed batches.
  useEffect(() => {
    const unsub = subscribeToMaterialRequests((items) => {
      const approved = items.filter(it => it.status === 'APPROVED');
      const groups = new Map<string, MaterialRequest[]>();
      approved.forEach(it => {
        const key = it.batchId || it.id;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(it);
      });

      const fresh: MaterialRequest[][] = [];
      groups.forEach((group, key) => {
        if (!seenBatchIds.current.has(key)) {
          seenBatchIds.current.add(key);
          fresh.push(group);
        }
      });

      if (fresh.length > 0) {
        setQueue(prev => [...prev, ...fresh]);
      }
    });
    return () => unsub();
  }, []);

  // Process one batch at a time so slips don't overlap on the printer.
  useEffect(() => {
    if (processingRef.current || printing || queue.length === 0) return;
    processingRef.current = true;
    const [next, ...rest] = queue;
    setQueue(rest);
    setPrinting(next);
  }, [queue, printing]);

  useEffect(() => {
    if (!printing) return;
    const afterPrint = async () => {
      try {
        await dbMarkMaterialRequestBatchPrinted(printing.map(it => it.id));
      } catch (err) {
        console.warn('[AutoPrintMaterialSlip] failed to mark printed:', err);
      }
      setPrinting(null);
      processingRef.current = false;
    };

    window.addEventListener('afterprint', afterPrint, { once: true });
    const t = setTimeout(() => window.print(), 250);

    return () => {
      clearTimeout(t);
      window.removeEventListener('afterprint', afterPrint);
    };
  }, [printing]);

  if (!printing || printing.length === 0) return null;

  const first = printing[0];

  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #auto-print-area, #auto-print-area * { visibility: visible; }
          #auto-print-area {
            position: absolute; top: 0; left: 0;
            width: 210mm; min-height: 297mm; padding: 15mm;
            font-size: 12pt;
          }
          @page { size: A4; margin: 15mm; }
        }
        #auto-print-area { display: none; }
        @media print { #auto-print-area { display: block; } }
      `}</style>

      {/* Small on-screen indicator so store staff can see it's working,
          without needing to click anything. */}
      <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 bg-indigo-600 text-white text-xs font-bold px-3 py-2 rounded-lg shadow-lg animate-pulse print:hidden">
        <Printer className="h-3.5 w-3.5" />
        Auto-printing approved request…
      </div>

      <div id="auto-print-area">
        <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '2px solid #000', paddingBottom: 8, marginBottom: 12 }}>
          <div style={{ fontWeight: 900, fontSize: 16 }}>MAT PLASTIC INDUSTRIES LLC</div>
          <div style={{ fontWeight: 700 }}>Material Issue Slip{printing.length > 1 ? ` — ${printing.length} items` : ''}</div>
        </div>

        <table style={{ width: '100%', fontSize: 12, marginBottom: 12 }}>
          <tbody>
            <tr><td style={{ color: '#555', width: 160 }}>Slip No.</td><td style={{ fontWeight: 700 }}>MIS-{(first.batchId || first.id).slice(-8).toUpperCase()}</td></tr>
            <tr><td style={{ color: '#555' }}>Project</td><td style={{ fontWeight: 700 }}>{first.projectName}</td></tr>
            <tr><td style={{ color: '#555' }}>Pool Type</td><td style={{ fontWeight: 700 }}>{first.poolType}</td></tr>
            {first.poolNo && <tr><td style={{ color: '#555' }}>Pool No.</td><td style={{ fontWeight: 700 }}>{first.poolNo}</td></tr>}
            <tr><td style={{ color: '#555' }}>Requested By</td><td>{first.requestedByName} ({first.requestedByRole})</td></tr>
            <tr><td style={{ color: '#555' }}>Approved By</td><td>{first.decidedByName || '—'}{first.decidedAt ? ` · ${new Date(first.decidedAt).toLocaleString()}` : ''}</td></tr>
            {first.reason && <tr><td style={{ color: '#555' }}>Reason / Note</td><td style={{ fontStyle: 'italic' }}>{first.reason}</td></tr>}
          </tbody>
        </table>

        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #000' }}>
              <th style={{ textAlign: 'left', padding: '4px 0' }}>#</th>
              <th style={{ textAlign: 'left' }}>Material</th>
              <th style={{ textAlign: 'right' }}>Qty</th>
              <th style={{ textAlign: 'left' }}>Unit</th>
            </tr>
          </thead>
          <tbody>
            {printing.map((it, idx) => (
              <tr key={it.id} style={{ borderBottom: '1px solid #ddd' }}>
                <td style={{ padding: '4px 0' }}>{idx + 1}</td>
                <td>{it.materialName}</td>
                <td style={{ textAlign: 'right' }}>{it.qtyRequested}</td>
                <td>{it.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ marginTop: 40, display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
          <div>Store Keeper: ______________________</div>
          <div>Manager Signature: ______________________</div>
        </div>
      </div>
    </>
  );
};
