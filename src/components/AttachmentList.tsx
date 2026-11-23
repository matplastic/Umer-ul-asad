import React, { useRef, useState } from 'react';
import { FileText, Image as ImageIcon, Loader2, Paperclip, Trash2, AlertTriangle } from 'lucide-react';
import type { ProcAttachment } from '../types';
import { PROC_ACCEPT, deleteProcFile, fileSize, uploadProcFile } from '../lib/procurementFiles';

// Upload + list of files (PDF / photo) kept in Firebase Storage. Used for supplier quotations and for
// bank / LC documents. Opening a file shows it in a new tab.

interface Props {
  attachments: ProcAttachment[];
  onChange: (next: ProcAttachment[]) => void;
  ownerKey: string;                              // storage folder: grn/proc_{ownerKey}/…
  uploadedByName: string;
  kinds?: { id: string; label: string }[];       // more than one → a type picker is shown
  readOnly?: boolean;
  compact?: boolean;
  // When given, removing a file only tells the parent (it deletes the stored file after saving).
  // Without it the stored file is deleted straight away.
  onRemove?: (att: ProcAttachment) => void;
  testId?: string;
}

export const AttachmentList: React.FC<Props> = ({ attachments, onChange, ownerKey, uploadedByName, kinds, readOnly, compact, onRemove, testId = 'attachments' }) => {
  const [kind, setKind] = useState(kinds?.[0]?.id || 'quotation');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const kindLabel = (k: string) => kinds?.find(x => x.id === k)?.label;

  const pick = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true); setError(null);
    const added: ProcAttachment[] = [];
    try {
      for (const f of Array.from(files)) added.push(await uploadProcFile(f, ownerKey, kind, uploadedByName));
    } catch (e: any) {
      setError(e?.message || 'Upload failed.');
    } finally {
      if (added.length) onChange([...attachments, ...added]);
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const remove = async (a: ProcAttachment) => {
    if (!window.confirm(`Remove “${a.name}”?`)) return;
    if (onRemove) onRemove(a); else await deleteProcFile(a);
    onChange(attachments.filter(x => x.id !== a.id));
  };

  return (
    <div className="space-y-1.5" data-testid={testId}>
      {attachments.map(a => (
        <div key={a.id} className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1">
          {a.type === 'application/pdf' ? <FileText className="h-3.5 w-3.5 text-rose-600 shrink-0" /> : <ImageIcon className="h-3.5 w-3.5 text-sky-600 shrink-0" />}
          <a href={a.url} target="_blank" rel="noopener noreferrer" className={`min-w-0 flex-1 truncate font-semibold text-primary-700 hover:underline ${compact ? 'text-[11px]' : 'text-xs'}`} title={a.name}>{a.name}</a>
          {kinds && kinds.length > 1 && <span className="text-[10px] text-slate-500 shrink-0">{kindLabel(a.kind)}</span>}
          <span className="text-[10px] text-slate-400 shrink-0">{fileSize(a.size)}</span>
          {!readOnly && <button type="button" onClick={() => remove(a)} className="text-slate-400 hover:text-rose-600 cursor-pointer shrink-0" title="Remove"><Trash2 className="h-3 w-3" /></button>}
        </div>
      ))}
      {attachments.length === 0 && readOnly && <div className="text-[11px] text-slate-400">No file attached</div>}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-1.5">
          {kinds && kinds.length > 1 && (
            <select value={kind} onChange={e => setKind(e.target.value)} className="bg-slate-100 border border-slate-300 rounded-lg px-1.5 py-1 text-[11px] text-slate-900">
              {kinds.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
            </select>
          )}
          <input ref={input} type="file" accept={PROC_ACCEPT} multiple className="hidden" onChange={e => pick(e.target.files)} data-testid={`${testId}-input`} />
          <button type="button" onClick={() => input.current?.click()} disabled={busy}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-60 text-slate-700 text-[11px] font-bold cursor-pointer">
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />} {busy ? 'Uploading…' : attachments.length ? 'Add file' : 'Upload PDF'}
          </button>
        </div>
      )}
      {error && <div className="text-[11px] text-rose-700 flex items-start gap-1"><AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />{error}</div>}
    </div>
  );
};
