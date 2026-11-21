import React, { useMemo, useRef, useState } from 'react';
import { Plus, Trash2, Download, FileText, ShieldAlert, Paperclip, ExternalLink, Upload, X, HardDrive } from 'lucide-react';
import { Employee } from '../../types';
import {
  useHRCollection, HRDocument, HRFile, HRProfile, HRCollection, DOC_TYPES, newId, expiryState, daysUntil, fmtD, logAudit,
} from '../../lib/hrStore';
import { uploadHRFile, deleteHRFile, validateHRFile, fmtBytes, HR_FILE_ACCEPT, HR_MAX_FILES_PER_RECORD } from '../../lib/hrFiles';
import { exportToExcel, exportTablePdf } from '../../lib/exportUtils';
import { ImportButton } from './ExcelImport';
import {
  Modal, Field, EmployeeSelect, inputCls, btnPrimary, btnGhost, StatCard, Badge, ExpiryBadge, Empty,
  SearchBox, runSave, useConfirm, hrToast,
} from './hrUi';

export interface DocRow {
  key: string;
  employeeId: string;
  employeeName: string;
  docType: string;
  docNumber?: string;
  expiryDate?: string | null;
  source: 'Directory' | 'Profile' | 'Vault';
  vault?: HRDocument;
}

/** Shared by the vault tab and the Employee 360 screen. */
export function buildDocRows(employees: Employee[], profiles: HRProfile[], docs: HRDocument[], onlyEmployeeId?: string): DocRow[] {
  const rows: DocRow[] = [];
  const pmap = new Map(profiles.map(p => [p.id, p]));
  const hasVault = (empId: string, type: string) => docs.some(d => d.employeeId === empId && d.docType === type);
  for (const e of employees) {
    if (onlyEmployeeId && e.id !== onlyEmployeeId) continue;
    const p = pmap.get(e.id);
    if (p?.status && p.status !== 'Active') continue;
    // A vault record of the same type (with the scan attached) replaces the linked Directory/Profile line.
    if (e.visaExpiryDate && !hasVault(e.id, 'Visa')) rows.push({ key: `v_${e.id}`, employeeId: e.id, employeeName: e.name, docType: 'Visa', expiryDate: e.visaExpiryDate, source: 'Directory' });
    if ((e.passportNumber || e.passportExpiryDate) && !hasVault(e.id, 'Passport')) rows.push({ key: `p_${e.id}`, employeeId: e.id, employeeName: e.name, docType: 'Passport', docNumber: e.passportNumber || undefined, expiryDate: e.passportExpiryDate, source: 'Directory' });
    if ((p?.emiratesIdExpiry || p?.emiratesId) && !hasVault(e.id, 'Emirates ID')) rows.push({ key: `e_${e.id}`, employeeId: e.id, employeeName: e.name, docType: 'Emirates ID', docNumber: p?.emiratesId, expiryDate: p?.emiratesIdExpiry, source: 'Profile' });
    if ((p?.labourCardExpiry || p?.labourCardNo) && !hasVault(e.id, 'Labour Card')) rows.push({ key: `l_${e.id}`, employeeId: e.id, employeeName: e.name, docType: 'Labour Card', docNumber: p?.labourCardNo, expiryDate: p?.labourCardExpiry, source: 'Profile' });
  }
  const ids = new Set(employees.map(e => e.id));
  for (const d of docs) {
    if (onlyEmployeeId && d.employeeId !== onlyEmployeeId) continue;
    if (!ids.has(d.employeeId)) continue;
    rows.push({ key: d.id, employeeId: d.employeeId, employeeName: d.employeeName, docType: d.docType, docNumber: d.docNumber, expiryDate: d.expiryDate, source: 'Vault', vault: d });
  }
  return rows;
}

// ─── File picker with live validation ───
export const FilePicker: React.FC<{ files: File[]; setFiles: (f: File[]) => void; max: number }> = ({ files, setFiles, max }) => {
  const input = useRef<HTMLInputElement>(null);
  const add = (list: FileList | null) => {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      if (next.length >= max) { hrToast(`Maximum ${max} files per record`, 'err'); break; }
      const bad = validateHRFile(f);
      if (bad) { hrToast(bad, 'err'); continue; }
      next.push(f);
    }
    setFiles(next);
    if (input.current) input.current.value = '';
  };
  return (
    <div className="space-y-2">
      <input ref={input} type="file" multiple accept={HR_FILE_ACCEPT} className="hidden" onChange={e => add(e.target.files)} />
      <button type="button" className={btnGhost} onClick={() => input.current?.click()}><Upload className="h-3.5 w-3.5" />Choose PDF / photo</button>
      {files.map((f, i) => (
        <div key={i} className="flex items-center justify-between text-xs bg-slate-50 rounded-lg px-3 py-1.5">
          <span className="truncate">{f.name} <span className="text-slate-400">· {fmtBytes(f.size)}{!/pdf/i.test(f.type) && ' (photos are auto-reduced under 1 MB)'}</span></span>
          <button type="button" aria-label="Remove" onClick={() => setFiles(files.filter((_, k) => k !== i))}><X className="h-3.5 w-3.5 text-slate-400" /></button>
        </div>
      ))}
      <p className="text-[11px] text-slate-400">PDF, JPG, PNG or WEBP · every file is kept permanently and limited to 1 MB.</p>
    </div>
  );
};

export const AddDocumentModal: React.FC<{
  employees: Employee[]; presetEmployeeId?: string; presetType?: string; presetNumber?: string; presetExpiry?: string | null;
  user?: string; onClose: () => void; save: (d: HRDocument) => Promise<void>;
}> = ({ employees, presetEmployeeId, presetType, presetNumber, presetExpiry, user, onClose, save }) => {
  const [f, setF] = useState<Partial<HRDocument>>({
    employeeId: presetEmployeeId || '', docType: presetType || 'Passport', docNumber: presetNumber || '', expiryDate: presetExpiry || '',
  });
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!f.employeeId || !f.docType) { hrToast('Choose an employee and document type', 'err'); return; }
    const emp = employees.find(e => e.id === f.employeeId);
    const id = newId('doc');
    setBusy(true);
    const uploaded: HRFile[] = [];
    try {
      for (const file of files) uploaded.push(await uploadHRFile(file, f.employeeId, id, user));
    } catch (e: any) {
      await Promise.all(uploaded.map(deleteHRFile));
      hrToast(e?.message || 'Upload failed', 'err');
      setBusy(false);
      return;
    }
    const rec: HRDocument = {
      id, employeeId: f.employeeId, employeeName: emp?.name || '', docType: f.docType,
      docNumber: f.docNumber?.trim() || undefined, issueDate: f.issueDate || undefined, expiryDate: f.expiryDate || undefined,
      notes: f.notes?.trim() || undefined, files: uploaded.length ? uploaded : undefined, createdAt: new Date().toISOString(), createdBy: user,
    };
    const ok = await runSave(() => save(rec), uploaded.length ? `Saved with ${uploaded.length} file(s)` : 'Document added');
    setBusy(false);
    if (ok) { logAudit(user, 'Documents', `Added ${rec.docType}${uploaded.length ? ` (+${uploaded.length} file)` : ''}`, rec.employeeName); onClose(); }
    else await Promise.all(uploaded.map(deleteHRFile));
  };

  return (
    <Modal title="Add document" onClose={onClose}
      footer={<><button className={btnGhost} onClick={onClose} disabled={busy}>Cancel</button><button className={btnPrimary} disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <Field label="Employee *"><EmployeeSelect employees={employees} value={f.employeeId || ''} onChange={id => setF(p => ({ ...p, employeeId: id }))} /></Field>
      <Field label="Document type *">
        <select className={inputCls} value={f.docType} onChange={e => setF(p => ({ ...p, docType: e.target.value }))}>
          {DOC_TYPES.map(t => <option key={t}>{t}</option>)}
        </select>
      </Field>
      <Field label="Document number"><input className={inputCls} value={f.docNumber || ''} onChange={e => setF(p => ({ ...p, docNumber: e.target.value }))} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Issue date"><input type="date" className={inputCls} value={f.issueDate || ''} onChange={e => setF(p => ({ ...p, issueDate: e.target.value }))} /></Field>
        <Field label="Expiry date"><input type="date" className={inputCls} value={f.expiryDate || ''} onChange={e => setF(p => ({ ...p, expiryDate: e.target.value }))} /></Field>
      </div>
      <Field label="Notes"><textarea rows={2} className={inputCls + ' resize-none'} value={f.notes || ''} onChange={e => setF(p => ({ ...p, notes: e.target.value }))} /></Field>
      <Field label="Scan / photo (optional)"><FilePicker files={files} setFiles={setFiles} max={HR_MAX_FILES_PER_RECORD} /></Field>
    </Modal>
  );
};

/** Open, add and delete the stored files of one document record. */
export const DocFilesModal: React.FC<{ doc: HRDocument; user?: string; onClose: () => void; docsC: HRCollection<HRDocument> }> = ({ doc, user, onClose, docsC }) => {
  const live = docsC.items.find(d => d.id === doc.id) || doc;
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const { ask, node } = useConfirm();
  const stored = live.files || [];

  const upload = async () => {
    if (!files.length) return;
    if (stored.length + files.length > HR_MAX_FILES_PER_RECORD) { hrToast(`Maximum ${HR_MAX_FILES_PER_RECORD} files per record`, 'err'); return; }
    setBusy(true);
    const uploaded: HRFile[] = [];
    try {
      for (const f of files) uploaded.push(await uploadHRFile(f, live.employeeId, live.id, user));
    } catch (e: any) {
      await Promise.all(uploaded.map(deleteHRFile));
      hrToast(e?.message || 'Upload failed', 'err'); setBusy(false); return;
    }
    const ok = await runSave(() => docsC.patch(live.id, cur => ({ ...cur, files: [...(cur.files || []), ...uploaded] })), `${uploaded.length} file(s) added`);
    setBusy(false);
    if (ok) { setFiles([]); logAudit(user, 'Documents', `Attached ${uploaded.length} file(s) to ${live.docType}`, live.employeeName); }
    else await Promise.all(uploaded.map(deleteHRFile));
  };

  const del = async (f: HRFile) => {
    if (!(await ask(`Delete the file "${f.name}" permanently?`))) return;
    const ok = await runSave(() => docsC.patch(live.id, cur => ({ ...cur, files: (cur.files || []).filter(x => x.id !== f.id) })), 'File deleted');
    if (ok) { await deleteHRFile(f); logAudit(user, 'Documents', `Deleted file from ${live.docType}`, live.employeeName); }
  };

  return (
    <Modal title={`${live.docType} — ${live.employeeName}`} onClose={onClose}>
      {node}
      {stored.length === 0 ? <p className="text-sm text-slate-400">No files attached yet.</p> : (
        <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl">
          {stored.map(f => (
            <div key={f.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-800 truncate">{f.name}</div>
                <div className="text-[11px] text-slate-400">{fmtBytes(f.size)} · {fmtD(f.uploadedAt)}{f.uploadedBy ? ` · ${f.uploadedBy}` : ''}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <a href={f.url} target="_blank" rel="noreferrer" className={btnGhost}><ExternalLink className="h-3.5 w-3.5" />Open</a>
                <button className="text-slate-300 hover:text-rose-600" aria-label="Delete file" onClick={() => del(f)}><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
      {stored.length < HR_MAX_FILES_PER_RECORD && (
        <div className="space-y-2 pt-2">
          <FilePicker files={files} setFiles={setFiles} max={HR_MAX_FILES_PER_RECORD - stored.length} />
          {files.length > 0 && <button className={btnPrimary} disabled={busy} onClick={upload}>{busy ? 'Uploading…' : `Upload ${files.length} file(s)`}</button>}
        </div>
      )}
    </Modal>
  );
};

/** One document row's action buttons — shared by the vault and Employee 360. */
export const DocRowActions: React.FC<{
  row: DocRow; docsC: HRCollection<HRDocument>; user?: string;
  onAttach: (row: DocRow) => void; onFiles: (d: HRDocument) => void;
}> = ({ row, docsC, user, onAttach, onFiles }) => {
  const { ask, node } = useConfirm();
  if (!row.vault) {
    return <button className={btnGhost} onClick={() => onAttach(row)}><Paperclip className="h-3.5 w-3.5" />Attach scan</button>;
  }
  const d = row.vault;
  const n = d.files?.length || 0;
  return (
    <span className="inline-flex items-center gap-2">
      {node}
      <button className={btnGhost} onClick={() => onFiles(d)}><Paperclip className="h-3.5 w-3.5" />{n ? `Files (${n})` : 'Add file'}</button>
      <button className="text-slate-300 hover:text-rose-600" aria-label="Delete" onClick={async () => {
        if (!(await ask(`Delete this ${d.docType} record${n ? ` and its ${n} stored file(s)` : ''}?`))) return;
        const ok = await runSave(() => docsC.remove(d.id), 'Record deleted');
        if (ok) { await Promise.all((d.files || []).map(deleteHRFile)); logAudit(user, 'Documents', `Deleted ${d.docType}`, d.employeeName); }
      }}><Trash2 className="h-4 w-4" /></button>
    </span>
  );
};

interface Props { employees: Employee[]; user?: string; saveEmployees?: (list: Employee[]) => void | Promise<void> }

export const DocumentsVault: React.FC<Props> = ({ employees, user, saveEmployees }) => {
  const docsC = useHRCollection<HRDocument>('hrDocuments');
  const profC = useHRCollection<HRProfile>('hrProfiles');
  const [q, setQ] = useState('');
  const [typeF, setTypeF] = useState('All');
  const [stateF, setStateF] = useState<'all' | 'expired' | 'soon' | 'ok'>('all');
  const [add, setAdd] = useState<null | { type?: string; number?: string; expiry?: string | null; empId?: string }>(null);
  const [filesDoc, setFilesDoc] = useState<HRDocument | null>(null);

  const rows = useMemo(() => buildDocRows(employees, profC.items, docsC.items), [employees, profC.items, docsC.items]);
  const types = useMemo(() => ['All', ...Array.from(new Set(rows.map(r => r.docType))).sort()], [rows]);

  const counts = useMemo(() => {
    const c = { expired: 0, d30: 0, d60: 0, total: rows.length };
    rows.forEach(r => {
      const d = daysUntil(r.expiryDate);
      if (d === null) return;
      if (d < 0) c.expired++; else if (d <= 30) c.d30++; else if (d <= 60) c.d60++;
    });
    return c;
  }, [rows]);

  const storage = useMemo(() => {
    let n = 0, bytes = 0;
    docsC.items.forEach(d => (d.files || []).forEach(f => { n++; bytes += f.size || 0; }));
    return { n, bytes };
  }, [docsC.items]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows
      .filter(r => (typeF === 'All' || r.docType === typeF))
      .filter(r => stateF === 'all' || expiryState(r.expiryDate) === stateF)
      .filter(r => !s || r.employeeName.toLowerCase().includes(s) || (r.docNumber || '').toLowerCase().includes(s))
      .sort((a, b) => (daysUntil(a.expiryDate) ?? 99999) - (daysUntil(b.expiryDate) ?? 99999));
  }, [rows, q, typeF, stateF]);

  const exportRows = () => filtered.map(r => ({
    Employee: r.employeeName, Document: r.docType, Number: r.docNumber || '', Expiry: r.expiryDate || '',
    'Days left': daysUntil(r.expiryDate) ?? '', Files: r.vault?.files?.length || 0, Source: r.source,
  }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Expired" value={counts.expired} tone={counts.expired ? 'rose' : 'slate'} onClick={() => setStateF('expired')} icon={<ShieldAlert className="h-4 w-4" />} />
        <StatCard label="Expiring ≤ 30 days" value={counts.d30} tone={counts.d30 ? 'amber' : 'slate'} onClick={() => setStateF('soon')} />
        <StatCard label="Expiring 31–60 days" value={counts.d60} tone={counts.d60 ? 'amber' : 'slate'} onClick={() => setStateF('soon')} />
        <StatCard label="Documents tracked" value={counts.total} tone="violet" onClick={() => setStateF('all')} icon={<FileText className="h-4 w-4" />} />
        <StatCard label="Stored files" value={storage.n} sub={`${fmtBytes(storage.bytes)} · max 1 MB each`} tone="slate" icon={<HardDrive className="h-4 w-4" />} />
      </div>

      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex flex-wrap gap-2 items-center">
          <SearchBox value={q} onChange={setQ} placeholder="Employee or number…" />
          <select className={inputCls + ' !w-auto'} value={typeF} onChange={e => setTypeF(e.target.value)}>{types.map(t => <option key={t}>{t}</option>)}</select>
          <select className={inputCls + ' !w-auto'} value={stateF} onChange={e => setStateF(e.target.value as any)}>
            <option value="all">All statuses</option><option value="expired">Expired</option>
            <option value="soon">Expiring soon</option><option value="ok">Valid</option>
          </select>
        </div>
        <div className="flex gap-2">
          <button className={btnGhost} onClick={() => filtered.length ? exportToExcel(exportRows(), 'HR_Documents', 'Documents') : hrToast('Nothing to export', 'err')}><Download className="h-3.5 w-3.5" />Excel</button>
          <button className={btnGhost} onClick={() => filtered.length ? exportTablePdf({
            title: 'Document Expiry Report', subtitle: `${filtered.length} documents`, deptLine: 'Human Resources Department',
            columns: [{ header: 'Employee', dataKey: 'Employee' }, { header: 'Document', dataKey: 'Document' }, { header: 'Number', dataKey: 'Number' }, { header: 'Expiry', dataKey: 'Expiry' }, { header: 'Days left', dataKey: 'Days left' }],
            rows: exportRows(), filename: 'HR_Documents', orientation: 'portrait',
          }) : hrToast('Nothing to export', 'err')}><Download className="h-3.5 w-3.5" />PDF</button>
          <ImportButton employees={employees} user={user} saveEmployees={saveEmployees} types={['passport', 'documents', 'profile']} initialType="passport" />
          <button className={btnPrimary} onClick={() => setAdd({})}><Plus className="h-4 w-4" />Add document</button>
        </div>
      </div>

      {filtered.length === 0 ? <Empty text="No documents match. Visa and passport come from the Directory; Emirates ID and labour card from the Employee 360 profile." /> : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase text-slate-400 border-b border-slate-100">
              <th className="px-4 py-2">Employee</th><th className="px-4 py-2">Document</th><th className="px-4 py-2">Number</th>
              <th className="px-4 py-2">Expiry</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Source</th><th className="px-4 py-2" />
            </tr></thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map(r => (
                <tr key={r.key} className="hover:bg-slate-50">
                  <td className="px-4 py-2 font-semibold text-slate-800">{r.employeeName}</td>
                  <td className="px-4 py-2">{r.docType}</td>
                  <td className="px-4 py-2 text-slate-500">{r.docNumber || '—'}</td>
                  <td className="px-4 py-2">{fmtD(r.expiryDate)}</td>
                  <td className="px-4 py-2"><ExpiryBadge date={r.expiryDate} /></td>
                  <td className="px-4 py-2"><Badge tone={r.source === 'Vault' ? 'violet' : 'slate'}>{r.source}</Badge></td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <DocRowActions row={r} docsC={docsC} user={user} onFiles={setFilesDoc}
                      onAttach={row => setAdd({ type: row.docType, number: row.docNumber, expiry: row.expiryDate, empId: row.employeeId })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {add && <AddDocumentModal employees={employees} user={user} presetEmployeeId={add.empId} presetType={add.type} presetNumber={add.number} presetExpiry={add.expiry} onClose={() => setAdd(null)} save={docsC.save} />}
      {filesDoc && <DocFilesModal doc={filesDoc} user={user} docsC={docsC} onClose={() => setFilesDoc(null)} />}
    </div>
  );
};
