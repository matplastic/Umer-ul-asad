import React, { useMemo, useState } from 'react';
import { Plus, Printer, Trash2, UserCheck, Undo2, Pencil, ExternalLink, Car } from 'lucide-react';
import { Employee } from '../../types';
import {
  HRVehicle, VehicleAssignment, HRLetterLog, HRFile, HRCollection, HRFuelLog, HRVehicleService, VehicleStatus,
  newId, nextRef, todayStr, fmtD, latestOdometer, currentAssignment, expiryState, logAudit,
} from '../../lib/hrStore';
import { composeLetter, exportLetterPdf } from '../../lib/hrPdf';
import { uploadHRFile, deleteHRFile, fmtBytes, HR_MAX_FILES_PER_RECORD } from '../../lib/hrFiles';
import {
  Modal, Field, EmployeeSelect, inputCls, btnPrimary, btnGhost, btnDanger, Badge, ExpiryBadge, Empty, SearchBox, SectionCard,
  runSave, useConfirm, hrToast,
} from './hrUi';
import { FilePicker } from './DocumentsVault';
import { ImportButton } from './ExcelImport';

export interface FleetProps {
  employees: Employee[];
  user?: string;
  vehC: HRCollection<HRVehicle>;
  logC: HRCollection<HRFuelLog>;
  svcC: HRCollection<HRVehicleService>;
  lettersC: HRCollection<HRLetterLog>;
}

const EMIRATES = ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah'];
const statusTone = (s: VehicleStatus) => s === 'Active' ? 'emerald' : s === 'In Maintenance' ? 'amber' : s === 'Sold' ? 'slate' : 'rose';
const num = (s: string) => { const n = parseFloat(s); return isNaN(n) ? undefined : n; };

export const VehiclesPanel: React.FC<FleetProps> = (p) => {
  const { employees, vehC, logC, svcC } = p;
  const [q, setQ] = useState('');
  const [statusF, setStatusF] = useState<'All' | VehicleStatus>('All');
  const [edit, setEdit] = useState<HRVehicle | 'new' | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return vehC.items.filter(v => statusF === 'All' || v.status === statusF)
      .filter(v => !s || [v.plate, v.make, v.model, v.engineNo, v.chassisNo, currentAssignment(v)?.employeeName].some(x => (x || '').toLowerCase().includes(s)))
      .sort((a, b) => a.plate.localeCompare(b.plate));
  }, [vehC.items, q, statusF]);
  const open = vehC.items.find(v => v.id === openId) || null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox value={q} onChange={setQ} placeholder="Plate, model, chassis or driver…" />
          <select className={inputCls + ' !w-auto'} value={statusF} onChange={e => setStatusF(e.target.value as any)}>
            <option>All</option><option>Active</option><option>In Maintenance</option><option>Out of Service</option><option>Sold</option>
          </select>
        </div>
        <div className="flex gap-2"><ImportButton employees={employees} user={p.user} types={['vehicles', 'fuel']} initialType="vehicles" /><button className={btnPrimary} onClick={() => setEdit('new')}><Plus className="h-4 w-4" />Add vehicle</button></div>
      </div>

      {list.length === 0 ? <Empty text="No vehicles yet. Add the first company vehicle." /> : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase text-slate-400 border-b border-slate-100">
              <th className="px-4 py-2">Plate</th><th className="px-4 py-2">Vehicle</th><th className="px-4 py-2">Assigned to</th><th className="px-4 py-2">Since</th>
              <th className="px-4 py-2 text-right">Odometer</th><th className="px-4 py-2">Registration</th><th className="px-4 py-2">Insurance</th><th className="px-4 py-2">Status</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-50">
              {list.map(v => {
                const a = currentAssignment(v);
                const odo = latestOdometer(v, logC.items, svcC.items);
                return (
                  <tr key={v.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setOpenId(v.id)}>
                    <td className="px-4 py-2 font-black text-slate-800 whitespace-nowrap">{v.plate}{v.plateEmirate && <div className="text-[10px] font-semibold text-slate-400">{v.plateEmirate}</div>}</td>
                    <td className="px-4 py-2">{v.make} {v.model}{v.year ? ` · ${v.year}` : ''}</td>
                    <td className="px-4 py-2">{a ? <span className="font-semibold text-slate-800">{a.employeeName}</span> : <Badge tone="slate">Available</Badge>}</td>
                    <td className="px-4 py-2 text-slate-500">{a ? fmtD(a.from) : '—'}</td>
                    <td className="px-4 py-2 text-right">{odo ? `${odo.toLocaleString()} km` : '—'}</td>
                    <td className="px-4 py-2"><ExpiryBadge date={v.registrationExpiry} warnDays={30} /></td>
                    <td className="px-4 py-2"><ExpiryBadge date={v.insuranceExpiry} warnDays={30} /></td>
                    <td className="px-4 py-2"><Badge tone={statusTone(v.status)}>{v.status}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {edit && <VehicleForm existing={edit === 'new' ? undefined : edit} all={vehC.items} user={p.user} onClose={() => setEdit(null)}
        save={async v => { const ok = await runSave(() => vehC.save(v), 'Vehicle saved'); if (ok) { logAudit(p.user, 'Fleet', edit === 'new' ? 'Added vehicle' : 'Updated vehicle', v.plate); setEdit(null); } }} />}
      {open && <VehicleDetail v={open} {...p} onClose={() => setOpenId(null)} onEdit={() => { setEdit(open); }} />}
    </div>
  );
};

// ─── Add / edit vehicle ───
const VehicleForm: React.FC<{ existing?: HRVehicle; all: HRVehicle[]; user?: string; onClose: () => void; save: (v: HRVehicle) => void }> = ({ existing, all, onClose, save }) => {
  const [f, setF] = useState<HRVehicle>(existing || { id: newId('veh'), plate: '', make: '', model: '', fuelType: 'Petrol', status: 'Active', assignments: [], createdAt: new Date().toISOString(), plateEmirate: 'Dubai' });
  const set = (k: keyof HRVehicle, v: any) => setF(p => ({ ...p, [k]: v === '' ? undefined : v }));
  const txt = (k: keyof HRVehicle, label: string, type = 'text', cls = '') => (
    <Field label={label} className={cls}><input type={type} className={inputCls} value={(f[k] as any) ?? ''} onChange={e => set(k, type === 'number' ? (e.target.value === '' ? '' : parseFloat(e.target.value)) : e.target.value)} /></Field>
  );
  const submit = () => {
    const plate = f.plate.trim().toUpperCase();
    if (!plate || !f.make.trim() || !f.model.trim()) { hrToast('Plate number, make and model are required', 'err'); return; }
    if (all.some(v => v.id !== f.id && v.plate.toUpperCase() === plate && (v.plateEmirate || '') === (f.plateEmirate || ''))) { hrToast('A vehicle with this plate number already exists', 'err'); return; }
    if (f.chassisNo && f.chassisNo.trim().length > 0 && f.chassisNo.trim().length !== 17) hrToast('Note: a chassis (VIN) number is normally 17 characters — please double-check it');
    save({ ...f, plate, make: f.make.trim(), model: f.model.trim(), engineNo: f.engineNo?.trim().toUpperCase(), chassisNo: f.chassisNo?.trim().toUpperCase() });
  };
  return (
    <Modal wide title={existing ? `Edit ${existing.plate}` : 'Add vehicle'} onClose={onClose} footer={<><button className={btnGhost} onClick={onClose}>Cancel</button><button className={btnPrimary} onClick={submit}>Save vehicle</button></>}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {txt('plate', 'Plate number *')}
        <Field label="Plate emirate"><select className={inputCls} value={f.plateEmirate || ''} onChange={e => set('plateEmirate', e.target.value)}>{EMIRATES.map(e => <option key={e}>{e}</option>)}</select></Field>
        <Field label="Status"><select className={inputCls} value={f.status} onChange={e => set('status', e.target.value)}><option>Active</option><option>In Maintenance</option><option>Out of Service</option><option>Sold</option></select></Field>
        {txt('make', 'Make * (e.g. Toyota)')}{txt('model', 'Model * (e.g. Hilux)')}{txt('year', 'Year', 'number')}
        {txt('color', 'Colour')}
        <Field label="Type"><select className={inputCls} value={f.vehicleType || ''} onChange={e => set('vehicleType', e.target.value)}><option value="">—</option>{['Car', 'Pickup', 'Van', 'Truck', 'Bus', 'Other'].map(t => <option key={t}>{t}</option>)}</select></Field>
        <Field label="Fuel type"><select className={inputCls} value={f.fuelType} onChange={e => set('fuelType', e.target.value)}>{['Petrol', 'Diesel', 'Hybrid', 'Electric'].map(t => <option key={t}>{t}</option>)}</select></Field>
        {txt('engineNo', 'Engine number', 'text', 'sm:col-span-1')}{txt('chassisNo', 'Chassis (VIN) number', 'text', 'sm:col-span-2')}
        {txt('registrationExpiry', 'Registration (Mulkiya) expiry', 'date')}{txt('insuranceCompany', 'Insurance company')}{txt('policyNo', 'Policy number')}
        {txt('insuranceExpiry', 'Insurance expiry', 'date')}{txt('purchaseDate', 'Purchase date', 'date')}
      </div>
      <Field label="Notes"><textarea rows={2} className={inputCls + ' resize-none'} value={f.notes || ''} onChange={e => set('notes', e.target.value)} /></Field>
    </Modal>
  );
};

// ─── Vehicle detail: assign / return / history / documents ───
const VehicleDetail: React.FC<FleetProps & { v: HRVehicle; onClose: () => void; onEdit: () => void }> = ({ v, employees, user, vehC, logC, svcC, lettersC, onClose, onEdit }) => {
  const { ask, node } = useConfirm();
  const [mode, setMode] = useState<null | 'assign' | 'return'>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const cur = currentAssignment(v);
  const odo = latestOdometer(v, logC.items, svcC.items);

  const persist = async (next: HRVehicle, msg: string, audit: string) => {
    const ok = await runSave(() => vehC.save(next), msg);
    if (ok) logAudit(user, 'Fleet', audit, v.plate);
    return ok;
  };

  const handoverPdf = async (a: VehicleAssignment, kind: 'handover' | 'return') => {
    const emp = employees.find(e => e.id === a.employeeId);
    const vehicleLine = `${v.make} ${v.model}${v.year ? ` ${v.year}` : ''}${v.color ? `, ${v.color}` : ''}`;
    const lines = [
      `Vehicle: ${vehicleLine}`, `Plate number: ${v.plate}${v.plateEmirate ? ` (${v.plateEmirate})` : ''}`,
      `Engine number: ${v.engineNo || '—'}`, `Chassis number: ${v.chassisNo || '—'}`,
      kind === 'handover' ? `Odometer at handover: ${a.startKm != null ? `${a.startKm.toLocaleString()} km` : '—'}` : `Odometer at return: ${a.endKm != null ? `${a.endKm.toLocaleString()} km` : '—'}`,
      kind === 'handover' ? `Condition at handover: ${a.conditionOut || 'Good, no visible damage'}` : `Condition at return: ${a.conditionIn || 'Good, no visible damage'}`,
    ];
    const person = { name: a.employeeName, department: emp?.department };
    const base = composeLetter({ kind: 'Custom Letter', person, subject: kind === 'handover' ? 'Vehicle Handover Receipt' : 'Vehicle Return Receipt', addressedTo: `To: ${a.employeeName}${emp?.department ? ` — ${emp.department}` : ''}`, body: '' });
    const paragraphs = kind === 'handover' ? [
      `This confirms that the company vehicle described below was handed over to ${a.employeeName} on ${fmtD(a.from)}${a.purpose ? ` for ${a.purpose}` : ''}.`,
      lines.join('\n'),
      'The employee is responsible for the vehicle while it is assigned. This includes traffic fines, Salik and parking charges incurred during the assignment, which may be deducted from salary. The vehicle must be used for official purposes only, kept clean and fuelled as per company policy, and any accident or damage must be reported to HR immediately.',
      'The vehicle, its keys and its documents must be returned on request or when employment ends.',
    ] : [
      `This confirms that ${a.employeeName} returned the company vehicle described below on ${fmtD(a.to)}.`,
      lines.join('\n'),
    ];
    const refNo = nextRef('MAT/HR', lettersC.items.map(l => l.refNo));
    // letter text keeps line breaks per detail line
    await exportLetterPdf({ refNo, date: kind === 'handover' ? a.from : (a.to || todayStr()), addressedTo: base.addressedTo, subject: kind === 'handover' ? 'Vehicle Handover Receipt' : 'Vehicle Return Receipt', paragraphs, acknowledgment: true, filename: `Vehicle_${kind}_${v.plate.replace(/\s+/g, '_')}_${a.employeeName.replace(/\s+/g, '_')}` });
    await lettersC.save({ id: newId('lt'), refNo, type: kind === 'handover' ? 'Vehicle Handover' : 'Vehicle Return', employeeId: a.employeeId, employeeName: a.employeeName, issuedBy: user || 'HR', issuedAt: new Date().toISOString() });
    logAudit(user, 'Fleet', `Printed ${kind} receipt`, `${v.plate} / ${a.employeeName}`);
  };

  const uploadFiles = async () => {
    if (!files.length) return;
    if ((v.files?.length || 0) + files.length > HR_MAX_FILES_PER_RECORD) { hrToast(`Maximum ${HR_MAX_FILES_PER_RECORD} files per vehicle`, 'err'); return; }
    setBusy(true);
    const done: HRFile[] = [];
    try { for (const f of files) done.push(await uploadHRFile(f, 'vehicles', v.id, user)); }
    catch (e: any) { await Promise.all(done.map(deleteHRFile)); hrToast(e?.message || 'Upload failed', 'err'); setBusy(false); return; }
    const ok = await runSave(() => vehC.patch(v.id, c => ({ ...c, files: [...(c.files || []), ...done] })), `${done.length} file(s) added`);
    setBusy(false);
    if (ok) { setFiles([]); logAudit(user, 'Fleet', `Attached ${done.length} file(s)`, v.plate); } else await Promise.all(done.map(deleteHRFile));
  };

  return (
    <Modal wide title={`${v.plate} — ${v.make} ${v.model}`} onClose={onClose}>
      {node}
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={statusTone(v.status)}>{v.status}</Badge>
        {cur ? <Badge tone="violet">With {cur.employeeName} since {fmtD(cur.from)}</Badge> : <Badge>Available</Badge>}
        {odo > 0 && <Badge tone="sky">{odo.toLocaleString()} km</Badge>}
      </div>
      <div className="flex flex-wrap gap-2">
        {!cur && v.status === 'Active' && <button className={btnPrimary} onClick={() => setMode('assign')}><UserCheck className="h-4 w-4" />Assign to employee</button>}
        {cur && <button className={btnPrimary} onClick={() => setMode('return')}><Undo2 className="h-4 w-4" />Return vehicle</button>}
        {cur && <button className={btnGhost} onClick={() => handoverPdf(cur, 'handover')}><Printer className="h-3.5 w-3.5" />Handover form</button>}
        <button className={btnGhost} onClick={onEdit}><Pencil className="h-3.5 w-3.5" />Edit details</button>
        <button className="ml-auto text-xs text-rose-500 hover:text-rose-700 font-bold inline-flex items-center gap-1" onClick={async () => {
          if (cur) { hrToast('Return the vehicle first', 'err'); return; }
          if (!(await ask(`Delete ${v.plate}? Its daily logs, maintenance and fines stay in the records.`))) return;
          const ok = await runSave(() => vehC.remove(v.id), 'Vehicle deleted');
          if (ok) { await Promise.all((v.files || []).map(deleteHRFile)); logAudit(user, 'Fleet', 'Deleted vehicle', v.plate); onClose(); }
        }}><Trash2 className="h-3.5 w-3.5" />Delete</button>
      </div>

      <div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-600 grid grid-cols-2 gap-x-4 gap-y-1">
        <div>Engine no.: <b className="text-slate-800">{v.engineNo || '—'}</b></div><div>Chassis no.: <b className="text-slate-800">{v.chassisNo || '—'}</b></div>
        <div>Colour: {v.color || '—'} · {v.vehicleType || '—'} · {v.fuelType}</div><div>Purchased: {fmtD(v.purchaseDate)}</div>
        <div>Registration expiry: {fmtD(v.registrationExpiry)}</div><div>Insurance: {v.insuranceCompany || '—'} {v.policyNo ? `· ${v.policyNo}` : ''} · {fmtD(v.insuranceExpiry)}</div>
        {v.notes && <div className="col-span-2">Notes: {v.notes}</div>}
      </div>

      <SectionCard title={`Assignment history (${v.assignments.length})`}>
        {v.assignments.length === 0 ? <p className="text-xs text-slate-400">Never assigned.</p> : (
          <div className="divide-y divide-slate-100">
            {[...v.assignments].sort((a, b) => b.from.localeCompare(a.from)).map(a => (
              <div key={a.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-slate-800">{a.employeeName} {!a.to && <Badge tone="violet">Current</Badge>}</div>
                  <div className="text-[11px] text-slate-400">{fmtD(a.from)} → {a.to ? fmtD(a.to) : 'present'}{a.startKm != null ? ` · out ${a.startKm.toLocaleString()} km` : ''}{a.endKm != null ? ` · in ${a.endKm.toLocaleString()} km` : ''}{a.endKm != null && a.startKm != null ? ` · ${(a.endKm - a.startKm).toLocaleString()} km driven` : ''}</div>
                  {(a.conditionOut || a.conditionIn) && <div className="text-[11px] text-slate-500">{a.conditionOut && `Out: ${a.conditionOut}. `}{a.conditionIn && `In: ${a.conditionIn}`}</div>}
                </div>
                <div className="flex gap-1.5">
                  <button className={btnGhost} onClick={() => handoverPdf(a, 'handover')}><Printer className="h-3.5 w-3.5" />Handover</button>
                  {a.to && <button className={btnGhost} onClick={() => handoverPdf(a, 'return')}><Printer className="h-3.5 w-3.5" />Return</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Documents (Mulkiya, insurance…)">
        {(v.files || []).length === 0 ? <p className="text-xs text-slate-400 mb-2">No files attached.</p> : (
          <div className="divide-y divide-slate-100 mb-2">
            {(v.files || []).map(f => (
              <div key={f.id} className="py-1.5 flex items-center justify-between gap-2">
                <div className="min-w-0"><div className="text-sm font-semibold text-slate-800 truncate">{f.name}</div><div className="text-[11px] text-slate-400">{fmtBytes(f.size)} · {fmtD(f.uploadedAt)}</div></div>
                <div className="flex items-center gap-2"><a href={f.url} target="_blank" rel="noreferrer" className={btnGhost}><ExternalLink className="h-3.5 w-3.5" />Open</a>
                  <button className="text-slate-300 hover:text-rose-600" aria-label="Delete file" onClick={async () => {
                    if (!(await ask(`Delete "${f.name}" permanently?`))) return;
                    const ok = await runSave(() => vehC.patch(v.id, c => ({ ...c, files: (c.files || []).filter(x => x.id !== f.id) })), 'File deleted');
                    if (ok) await deleteHRFile(f);
                  }}><Trash2 className="h-4 w-4" /></button></div>
              </div>
            ))}
          </div>
        )}
        {(v.files?.length || 0) < HR_MAX_FILES_PER_RECORD && (<div className="space-y-2"><FilePicker files={files} setFiles={setFiles} max={HR_MAX_FILES_PER_RECORD - (v.files?.length || 0)} />
          {files.length > 0 && <button className={btnPrimary} disabled={busy} onClick={uploadFiles}>{busy ? 'Uploading…' : `Upload ${files.length} file(s)`}</button>}</div>)}
      </SectionCard>

      {mode === 'assign' && <AssignModal v={v} employees={employees} odo={odo} onClose={() => setMode(null)}
        save={async a => { const ok = await persist({ ...v, assignments: [...v.assignments, a] }, 'Vehicle assigned', `Assigned to ${a.employeeName}`); if (ok) { setMode(null); } }} />}
      {mode === 'return' && cur && <ReturnModal a={cur} odo={odo} onClose={() => setMode(null)}
        save={async a => { const ok = await persist({ ...v, assignments: v.assignments.map(x => x.id === a.id ? a : x) }, 'Vehicle returned', `Returned by ${a.employeeName}`); if (ok) setMode(null); }} />}
    </Modal>
  );
};

const AssignModal: React.FC<{ v: HRVehicle; employees: Employee[]; odo: number; onClose: () => void; save: (a: VehicleAssignment) => void }> = ({ v, employees, odo, onClose, save }) => {
  const [f, setF] = useState({ employeeId: '', from: todayStr(), startKm: odo ? String(odo) : '', purpose: '', conditionOut: '' });
  return (
    <Modal title={`Assign ${v.plate}`} onClose={onClose} footer={<><button className={btnGhost} onClick={onClose}>Cancel</button><button className={btnPrimary} onClick={() => {
      const emp = employees.find(e => e.id === f.employeeId);
      if (!emp) { hrToast('Choose the employee', 'err'); return; }
      const sk = num(f.startKm);
      if (sk != null && odo && sk < odo) { hrToast(`Start km can't be lower than the last recorded ${odo.toLocaleString()} km`, 'err'); return; }
      save({ id: newId('as'), employeeId: emp.id, employeeName: emp.name, from: f.from, startKm: sk, purpose: f.purpose.trim() || undefined, conditionOut: f.conditionOut.trim() || undefined });
    }}>Assign</button></>}>
      <Field label="Employee *"><EmployeeSelect employees={employees} value={f.employeeId} onChange={id => setF(p => ({ ...p, employeeId: id }))} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date given"><input type="date" className={inputCls} value={f.from} onChange={e => setF(p => ({ ...p, from: e.target.value }))} /></Field>
        <Field label="Odometer at handover (km)"><input type="number" className={inputCls} value={f.startKm} onChange={e => setF(p => ({ ...p, startKm: e.target.value }))} /></Field>
      </div>
      <Field label="Purpose (optional)"><input className={inputCls} value={f.purpose} onChange={e => setF(p => ({ ...p, purpose: e.target.value }))} placeholder="Site visits, deliveries…" /></Field>
      <Field label="Condition at handover"><textarea rows={2} className={inputCls + ' resize-none'} value={f.conditionOut} onChange={e => setF(p => ({ ...p, conditionOut: e.target.value }))} placeholder="Scratches, dents, fuel level, tyres, spare wheel, tools…" /></Field>
    </Modal>
  );
};

const ReturnModal: React.FC<{ a: VehicleAssignment; odo: number; onClose: () => void; save: (a: VehicleAssignment) => void }> = ({ a, odo, onClose, save }) => {
  const [f, setF] = useState({ to: todayStr(), endKm: odo ? String(odo) : '', conditionIn: '' });
  return (
    <Modal title={`Return — ${a.employeeName}`} onClose={onClose} footer={<><button className={btnGhost} onClick={onClose}>Cancel</button><button className={btnDanger} onClick={() => {
      const ek = num(f.endKm);
      if (f.to < a.from) { hrToast('Return date is before the handover date', 'err'); return; }
      if (ek != null && a.startKm != null && ek < a.startKm) { hrToast('Return km is lower than the handover km', 'err'); return; }
      save({ ...a, to: f.to, endKm: ek, conditionIn: f.conditionIn.trim() || undefined });
    }}>Confirm return</button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Return date"><input type="date" className={inputCls} value={f.to} onChange={e => setF(p => ({ ...p, to: e.target.value }))} /></Field>
        <Field label="Odometer at return (km)"><input type="number" className={inputCls} value={f.endKm} onChange={e => setF(p => ({ ...p, endKm: e.target.value }))} /></Field>
      </div>
      <Field label="Condition at return"><textarea rows={2} className={inputCls + ' resize-none'} value={f.conditionIn} onChange={e => setF(p => ({ ...p, conditionIn: e.target.value }))} placeholder="New damage, fuel level, keys & documents returned…" /></Field>
    </Modal>
  );
};

export const FleetIcon = Car;
