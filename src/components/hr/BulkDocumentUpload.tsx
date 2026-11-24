import React, { useMemo, useRef, useState } from 'react';
import { FolderUp, FilePlus2, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { Employee } from '../../types';
import { HRDocument, HRFile, HRCollection, DOC_TYPES, newId, logAudit } from '../../lib/hrStore';
import {
  uploadHRFile, deleteHRFile, validateHRFile, needsPdfShrink, fmtBytes, HR_FILE_ACCEPT, HR_MAX_FILES_PER_RECORD,
} from '../../lib/hrFiles';
import { Modal, EmployeeSelect, inputCls, btnPrimary, btnGhost, hrToast } from './hrUi';

// ───────────────────────────────────────────────────────────
// Bulk document upload.
//
// Pick a folder that contains one sub-folder per employee (or a single
// employee folder, or just a pile of files). Each file is:
//   • matched to an employee from its folder name
//   • given a document type from its file name (PASSPORT, EID, CONTRACT…)
// HR reviews the table, fixes anything wrong, and saves everything at once.
// ───────────────────────────────────────────────────────────

/** First matching rule wins. Order matters (e.g. "medical" before generic words). */
const TYPE_RULES: [RegExp, string][] = [
  [/passport/i, 'Passport'],
  [/emirates[\s_-]*id|(^|[^a-z])e[\s_-]?id([^a-z]|$)|\beid\b/i, 'Emirates ID'],
  [/labou?r[\s_-]*(card|permit)|work[\s_-]*permit|\bmol\b/i, 'Labour Card'],
  [/contract|offer[\s_-]*letter/i, 'Employment Contract'],
  [/insurance|\bdaman\b/i, 'Health Insurance'],
  [/driv(ing|er)[\s_-]*licen[sc]e|\blicen[sc]e\b/i, 'Driving License'],
  [/medical|fitness|\bemf\b|\bdahc\b|\bdha\b/i, 'Medical Fitness'],
  [/safety[\s_-]*card|\bhse\b/i, 'Safety Card'],
  [/certificate|diploma|degree|educat/i, 'Educational Certificate'],
  [/photo|picture|\bpic\b|\.jpe?g$|\.png$|\.webp$/i, 'Photo'],
  [/visa|entry[\s_-]*permit|change[\s_-]*status|residence|\bresidency\b|status[\s_-]*change/i, 'Visa'],
];

export function guessDocType(fileName: string): string {
  for (const [re, type] of TYPE_RULES) if (re.test(fileName)) return type;
  return 'Other';
}

// ── Employee matching by name ──
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\u0600-\u06ff\s]/g, ' ').replace(/\s+/g, ' ').trim();
const tokens = (s: string) => norm(s).split(' ').filter(Boolean);

function matchEmployee(folderName: string, employees: Employee[]): { id: string; sure: boolean } | null {
  const target = norm(folderName);
  if (!target) return null;
  const tt = new Set(tokens(folderName));
  let best: { id: string; score: number } | null = null;
  for (const e of employees) {
    const n = norm(e.name);
    if (n === target) return { id: e.id, sure: true };
    const et = new Set(tokens(e.name));
    let common = 0;
    tt.forEach(t => { if (et.has(t)) common++; });
    const score = common / Math.max(tt.size, et.size, 1);
    if (!best || score > best.score) best = { id: e.id, score };
  }
  // Same words in a different order, or one extra/missing word, still counts — but HR sees it flagged.
  return best && best.score >= 0.6 ? { id: best.id, sure: best.score === 1 } : null;
}

interface Row {
  key: string;
  file: File;
  folder: string;          // folder name the file came from ('' if none)
  employeeId: string;      // '' = not matched yet
  matchSure: boolean;
  docType: string;
  skip: boolean;
  status: 'ready' | 'uploading' | 'done' | 'error';
  error?: string;
}

const relPath = (f: File) => ((f as any).webkitRelativePath as string) || '';

function buildRows(files: File[], employees: Employee[]): Row[] {
  const cache = new Map<string, ReturnType<typeof matchEmployee>>();
  return files.map((file, i) => {
    const parts = relPath(file).split('/').filter(Boolean);
    // …/<employee folder>/<file>  → the folder is the parent of the file.
    const folder = parts.length >= 2 ? parts[parts.length - 2] : '';
    if (!cache.has(folder)) cache.set(folder, matchEmployee(folder, employees));
    const m = cache.get(folder) || null;
    const bad = validateHRFile(file);
    return {
      key: `${i}_${file.name}_${file.size}`, file, folder,
      employeeId: m?.id || '', matchSure: !!m?.sure,
      docType: guessDocType(file.name),
      skip: !!bad, status: bad ? 'error' : 'ready', error: bad || undefined,
    };
  });
}

interface Props {
  employees: Employee[];
  docsC: HRCollection<HRDocument>;
  user?: string;
  onClose: () => void;
}

export const BulkDocumentUpload: React.FC<Props> = ({ employees, docsC, user, onClose }) => {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [shrink, setShrink] = useState(true);
  const folderInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const addFiles = (list: FileList | null) => {
    if (!list || !list.length) return;
    // Hidden/system files (Thumbs.db, desktop.ini, .DS_Store) are ignored.
    const files = Array.from(list).filter(f => !/^(thumbs\.db|desktop\.ini|\.ds_store)$/i.test(f.name));
    setRows(prev => [...prev, ...buildRows(files, employees)]);
    if (folderInput.current) folderInput.current.value = '';
    if (fileInput.current) fileInput.current.value = '';
  };

  const patch = (key: string, p: Partial<Row>) => setRows(rs => rs.map(r => (r.key === key ? { ...r, ...p } : r)));

  // Choosing an employee for one folder applies to every file from that folder.
  const setFolderEmployee = (folder: string, key: string, employeeId: string) =>
    setRows(rs => rs.map(r => ((folder ? r.folder === folder : r.key === key) ? { ...r, employeeId, matchSure: true } : r)));

  const todo = rows.filter(r => !r.skip && r.status !== 'done');
  const missingEmp = todo.filter(r => !r.employeeId).length;
  const doneCount = rows.filter(r => r.status === 'done').length;

  const summary = useMemo(() => {
    const folders = new Set(rows.map(r => r.folder || r.key));
    return `${rows.length} file(s) from ${folders.size} folder(s)`;
  }, [rows]);

  const saveAll = async () => {
    if (missingEmp) { hrToast(`${missingEmp} file(s) have no employee yet`, 'err'); return; }
    setBusy(true);
    const empById = new Map<string, Employee>(employees.map(e => [e.id, e] as [string, Employee]));
    let saved = 0;

    // Group: one Vault record per employee + document type (up to 5 files each).
    const groups = new Map<string, Row[]>();
    for (const r of todo) {
      const k = `${r.employeeId}||${r.docType}`;
      groups.set(k, [...(groups.get(k) || []), r]);
    }

    for (const [k, list] of Array.from(groups.entries())) {
      const [employeeId, docType] = k.split('||');
      const emp = empById.get(employeeId);
      // Add to an existing record of this type if it still has room, else make a new one.
      for (let i = 0; i < list.length; i += HR_MAX_FILES_PER_RECORD) {
        const chunk = list.slice(i, i + HR_MAX_FILES_PER_RECORD);
        const existing = i === 0
          ? docsC.items.find(d => d.employeeId === employeeId && d.docType === docType && (d.files?.length || 0) + chunk.length <= HR_MAX_FILES_PER_RECORD)
          : undefined;
        const recId = existing?.id || newId('doc');
        const uploaded: HRFile[] = [];
        chunk.forEach(r => patch(r.key, { status: 'uploading' }));
        try {
          for (const r of chunk) {
            // Skip a file that is already stored (same name + size) so re-running never duplicates.
            const dup = existing?.files?.some(f => f.name === r.file.name && Math.abs(f.size - r.file.size) < 2048);
            if (dup) { patch(r.key, { status: 'done' }); continue; }
            uploaded.push(await uploadHRFile(r.file, employeeId, recId, user, shrink));
          }
          if (uploaded.length) {
            const rec: HRDocument = existing
              ? { ...existing, files: [...(existing.files || []), ...uploaded] }
              : {
                  id: recId, employeeId, employeeName: emp?.name || '', docType,
                  files: uploaded, createdAt: new Date().toISOString(), createdBy: user,
                };
            await docsC.save(rec);
            saved += uploaded.length;
            logAudit(user, 'Documents', `Bulk upload: ${docType} (+${uploaded.length} file)`, emp?.name);
          }
          chunk.forEach(r => patch(r.key, { status: 'done' }));
        } catch (e: any) {
          await Promise.all(uploaded.map(deleteHRFile));
          chunk.forEach(r => patch(r.key, { status: 'error', error: e?.message || 'Upload failed' }));
        }
      }
    }
    setBusy(false);
    hrToast(saved ? `${saved} file(s) uploaded` : 'Nothing new to upload', saved ? 'ok' : 'err');
  };

  return (
    <Modal title="Bulk upload documents" onClose={busy ? () => {} : onClose}
      footer={<>
        <button className={btnGhost} onClick={onClose} disabled={busy}>{doneCount && !todo.length ? 'Close' : 'Cancel'}</button>
        <button className={btnPrimary} disabled={busy || !todo.length} onClick={saveAll}>
          {busy ? 'Uploading…' : `Upload ${todo.length} file(s)`}
        </button>
      </>}>
      <input ref={folderInput} type="file" multiple className="hidden"
        webkitdirectory="" directory=""
        onChange={e => addFiles(e.target.files)} />
      <input ref={fileInput} type="file" multiple accept={HR_FILE_ACCEPT} className="hidden" onChange={e => addFiles(e.target.files)} />

      <div className="flex flex-wrap gap-2 mb-3">
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => folderInput.current?.click()}>
          <FolderUp className="h-4 w-4" />Choose folder(s)
        </button>
        <button type="button" className={btnGhost} disabled={busy} onClick={() => fileInput.current?.click()}>
          <FilePlus2 className="h-3.5 w-3.5" />Choose files
        </button>
      </div>
      <p className="text-[11px] text-slate-500 mb-3">
        Pick the main folder that has one folder per employee (for example “3 TXM Employees”). The folder name is matched to the employee
        and the file name decides the document type. You can correct anything below before uploading.
      </p>

      <label className="flex items-center gap-2 text-xs text-slate-600 mb-3 cursor-pointer">
        <input type="checkbox" checked={shrink} disabled={busy} onChange={e => setShrink(e.target.checked)} />
        Compress PDFs over 1 MB automatically <span className="text-slate-400">(pages become images — text can’t be selected)</span>
      </label>

      {rows.length > 0 && (
        <>
          <p className="text-xs font-semibold text-slate-600 mb-2">
            {summary}{missingEmp > 0 && <span className="text-amber-600"> · {missingEmp} need an employee</span>}
          </p>
          <div className="max-h-[50vh] overflow-auto border border-slate-200 rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 sticky top-0">
                <tr className="text-left text-slate-500">
                  <th className="p-2">File</th><th className="p-2 min-w-[200px]">Employee</th><th className="p-2">Type</th><th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.key} className={`border-t border-slate-100 ${r.skip ? 'opacity-50' : ''}`}>
                    <td className="p-2 max-w-[220px]">
                      <div className="truncate font-medium text-slate-700" title={r.file.name}>{r.file.name}</div>
                      <div className="text-[10px] text-slate-400">{fmtBytes(r.file.size)}{r.folder && ` · ${r.folder}`}{shrink && needsPdfShrink(r.file) && r.status === 'ready' && <span className="text-sky-600"> · will be compressed</span>}</div>
                      {r.error && <div className="text-[10px] text-red-600">{r.error}</div>}
                    </td>
                    <td className="p-2">
                      <EmployeeSelect employees={employees} value={r.employeeId}
                        onChange={id => setFolderEmployee(r.folder, r.key, id)} />
                      {r.employeeId && !r.matchSure && <div className="text-[10px] text-amber-600 mt-0.5">Name matched approximately — please check</div>}
                    </td>
                    <td className="p-2">
                      <select className={inputCls} value={r.docType} disabled={busy || r.status === 'done'}
                        onChange={e => patch(r.key, { docType: e.target.value })}>
                        {DOC_TYPES.map(t => <option key={t}>{t}</option>)}
                      </select>
                    </td>
                    <td className="p-2 text-center w-16">
                      {r.status === 'done' ? <CheckCircle2 className="h-4 w-4 text-emerald-600 inline" />
                        : r.status === 'uploading' ? <Loader2 className="h-4 w-4 animate-spin text-slate-500 inline" />
                        : r.status === 'error' ? <AlertTriangle className="h-4 w-4 text-red-500 inline" />
                        : <label className="inline-flex items-center gap-1 text-[10px] text-slate-500 cursor-pointer">
                            <input type="checkbox" checked={r.skip} disabled={busy} onChange={e => patch(r.key, { skip: e.target.checked })} />skip
                          </label>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
};
