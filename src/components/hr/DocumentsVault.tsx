import React, { useMemo, useState } from 'react';
import { Plus, Trash2, Download, FileText, ShieldAlert } from 'lucide-react';
import { Employee } from '../../types';
import {
  useHRCollection, HRDocument, HRProfile, DOC_TYPES, newId, expiryState, daysUntil, fmtD, logAudit,
} from '../../lib/hrStore';
import { exportToExcel, exportTablePdf } from '../../lib/exportUtils';
import {
  Modal, Field, EmployeeSelect, inputCls, btnPrimary, btnGhost, StatCard, Badge, ExpiryBadge, Empty,
  SearchBox, runSave, useConfirm, hrToast,
} from './hrUi';

interface Row {
  key: string;
  employeeId: string;
  employeeName: string;
  docType: string;
  docNumber?: string;
  expiryDate?: string | null;
  source: 'Directory' | 'Profile' | 'Vault';
  vaultId?: string;
}

/** Shared by the vault tab and the Employee 360 screen. */
export function buildDocRows(employees: Employee[], profiles: HRProfile[], docs: HRDocument[], onlyEmployeeId?: string): Row[] {
  const rows: Row[] = [];
  const pmap = new Map(profiles.map(p => [p.id, p]));
  for (const e of employees) {
    if (onlyEmployeeId && e.id !== onlyEmployeeId) continue;
    const st = pmap.get(e.id)?.status;
    if (st && st !== 'Active') continue;
    if (e.visaExpiryDate) rows.push({ key: `v_${e.id}`, employeeId: e.id, employeeName: e.name, docType: 'Visa', expiryDate: e.visaExpiryDate, source: 'Directory' });
    if (e.passportNumber || e.passportExpiryDate) rows.push({ key: `p_${e.id}`, employeeId: e.id, employeeName: e.name, docType: 'Passport', docNumber: e.passportNumber || undefined, expiryDate: e.passportExpiryDate, source: 'Directory' });
    const p = pmap.get(e.id);
    if (p?.emiratesIdExpiry || p?.emiratesId) rows.push({ key: `e_${e.id}`, employeeId: e.id, employeeName: e.name, docType: 'Emirates ID', docNumber: p?.emiratesId, expiryDate: p?.emiratesIdExpiry, source: 'Profile' });
    if (p?.labourCardExpiry || p?.labourCardNo) rows.push({ key: `l_${e.id}`, employeeId: e.id, employeeName: e.name, docType: 'Labour Card', docNumber: p?.labourCardNo, expiryDate: p?.labourCardExpiry, source: 'Profile' });
  }
  const ids = new Set(employees.map(e => e.id));
  for (const d of docs) {
    if (onlyEmployeeId && d.employeeId !== onlyEmployeeId) continue;
    if (!ids.has(d.employeeId)) continue;
    rows.push({ key: d.id, employeeId: d.employeeId, employeeName: d.employeeName, docType: d.docType, docNumber: d.docNumber, expiryDate: d.expiryDate, source: 'Vault', vaultId: d.id });
  }
  return rows;
}

export const AddDocumentModal: React.FC<{
  employees: Employee[]; presetEmployeeId?: string; user?: string; onClose: () => void;
  save: (d: HRDocument) => Promise<void>;
}> = ({ employees, presetEmployeeId, user, onClose, save }) => {
  const [f, setF] = useState<Partial<HRDocument>>({ employeeId: presetEmployeeId || '', docType: 'Health Insurance' });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!f.employeeId || !f.docType) { hrToast('Choose an employee and document type', 'err'); return; }
    const emp = employees.find(e => e.id === f.employeeId);
    const rec: HRDocument = {
      id: newId('doc'), employeeId: f.employeeId, employeeName: emp?.name || '', docType: f.docType,
      docNumber: f.docNumber?.trim() || undefined, issueDate: f.issueDate || undefined, expiryDate: f.expiryDate || undefined,
      notes: f.notes?.trim() || undefined, createdAt: new Date().toISOString(), createdBy: user,
    };
    setBusy(true);
    const ok = await runSave(() => save(rec), 'Document added');
    setBusy(false);
    if (ok) { logAudit(user, 'Documents', `Added ${rec.docType}`, rec.employeeName); onClose(); }
  };
  return (
    <Modal title="Add document record" onClose={onClose}
      footer={<><button className={btnGhost} onClick={onClose}>Cancel</button><button className={btnPrimary} disabled={busy} onClick={submit}>Save</button></>}>
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
      <p className="text-[11px] text-slate-400">This tracks the document's details and expiry. The paper original stays in the physical file.</p>
    </Modal>
  );
};

interface Props { employees: Employee[]; user?: string }

export const DocumentsVault: React.FC<Props> = ({ employees, user }) => {
  const docsC = useHRCollection<HRDocument>('hrDocuments');
  const profC = useHRCollection<HRProfile>('hrProfiles');
  const [q, setQ] = useState('');
  const [typeF, setTypeF] = useState('All');
  const [stateF, setStateF] = useState<'all' | 'expired' | 'soon' | 'ok'>('all');
  const [showAdd, setShowAdd] = useState(false);
  const { ask, node } = useConfirm();

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

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows
      .filter(r => (typeF === 'All' || r.docType === typeF))
      .filter(r => stateF === 'all' || expiryState(r.expiryDate) === stateF)
      .filter(r => !s || r.employeeName.toLowerCase().includes(s) || (r.docNumber || '').toLowerCase().includes(s))
      .sort((a, b) => (daysUntil(a.expiryDate) ?? 99999) - (daysUntil(b.expiryDate) ?? 99999));
  }, [rows, q, typeF, stateF]);

  const del = async (r: Row) => {
    if (!r.vaultId) return;
    if (!(await ask(`Delete this ${r.docType} record for ${r.employeeName}?`))) return;
    const ok = await runSave(() => docsC.remove(r.vaultId!), 'Record deleted');
    if (ok) logAudit(user, 'Documents', `Deleted ${r.docType}`, r.employeeName);
  };

  const exportRows = () => filtered.map(r => ({
    Employee: r.employeeName, Document: r.docType, Number: r.docNumber || '', Expiry: r.expiryDate || '',
    'Days left': daysUntil(r.expiryDate) ?? '', Source: r.source,
  }));

  return (
    <div className="space-y-4">
      {node}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Expired" value={counts.expired} tone={counts.expired ? 'rose' : 'slate'} onClick={() => setStateF('expired')} icon={<ShieldAlert className="h-4 w-4" />} />
        <StatCard label="Expiring ≤ 30 days" value={counts.d30} tone={counts.d30 ? 'amber' : 'slate'} onClick={() => setStateF('soon')} />
        <StatCard label="Expiring 31–60 days" value={counts.d60} tone={counts.d60 ? 'amber' : 'slate'} onClick={() => setStateF('soon')} />
        <StatCard label="Documents tracked" value={counts.total} tone="violet" onClick={() => setStateF('all')} icon={<FileText className="h-4 w-4" />} />
      </div>

      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex flex-wrap gap-2 items-center">
          <SearchBox value={q} onChange={setQ} placeholder="Employee or number…" />
          <select className={inputCls + ' !w-auto'} value={typeF} onChange={e => setTypeF(e.target.value)}>
            {types.map(t => <option key={t}>{t}</option>)}
          </select>
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
          <button className={btnPrimary} onClick={() => setShowAdd(true)}><Plus className="h-4 w-4" />Add document</button>
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
                  <td className="px-4 py-2 text-right">
                    {r.vaultId && <button onClick={() => del(r)} className="text-slate-300 hover:text-rose-600" aria-label="Delete"><Trash2 className="h-4 w-4" /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showAdd && <AddDocumentModal employees={employees} user={user} onClose={() => setShowAdd(false)} save={docsC.save} />}
    </div>
  );
};
