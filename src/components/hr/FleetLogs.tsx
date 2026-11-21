import React, { useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Fuel, Gauge, Wrench, TriangleAlert } from 'lucide-react';
import {
  HRFuelLog, HRVehicleService, HRVehicleFine, HRVehicle, SERVICE_TYPES, driverOn, latestOdometer, daysUntil,
  newId, todayStr, fmtD, fmtAED, logAudit,
} from '../../lib/hrStore';
import {
  Modal, Field, EmployeeSelect, inputCls, btnPrimary, btnGhost, StatCard, Badge, Empty, runSave, useConfirm, hrToast,
} from './hrUi';
import { FleetProps } from './FleetVehicles';
import { ImportButton } from './ExcelImport';

const num = (s: string) => { const n = parseFloat(s); return isNaN(n) ? undefined : n; };
const VehicleSelect: React.FC<{ vehicles: HRVehicle[]; value: string; onChange: (id: string) => void; all?: string }> = ({ vehicles, value, onChange, all }) => (
  <select className={inputCls} value={value} onChange={e => onChange(e.target.value)}>
    <option value="">{all || 'Select vehicle…'}</option>
    {[...vehicles].sort((a, b) => a.plate.localeCompare(b.plate)).map(v => <option key={v.id} value={v.id}>{v.plate} — {v.make} {v.model}</option>)}
  </select>
);

// ─────────────── Daily km & fuel log ───────────────
export const DailyLogPanel: React.FC<FleetProps> = ({ employees, user, vehC, logC, svcC }) => {
  const [vehF, setVehF] = useState('');
  const [empF, setEmpF] = useState('');
  const [from, setFrom] = useState(todayStr(new Date(Date.now() - 30 * 86400000)));
  const [to, setTo] = useState(todayStr());
  const [form, setForm] = useState<HRFuelLog | 'new' | null>(null);
  const { ask, node } = useConfirm();

  const shown = useMemo(() => logC.items
    .filter(l => (!vehF || l.vehicleId === vehF) && (!empF || l.employeeId === empF) && l.date >= from && l.date <= to)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)), [logC.items, vehF, empF, from, to]);
  const tot = shown.reduce((s, l) => ({ km: s.km + (l.km || 0), l: s.l + (l.liters || 0), c: s.c + (l.fuelCost || 0) }), { km: 0, l: 0, c: 0 });

  return (
    <div className="space-y-4">
      {node}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Entries" value={shown.length} tone="slate" />
        <StatCard label="Km driven" value={tot.km.toLocaleString()} tone="violet" icon={<Gauge className="h-4 w-4" />} />
        <StatCard label="Fuel" value={`${Math.round(tot.l * 10) / 10} L`} sub={fmtAED(tot.c)} tone="amber" icon={<Fuel className="h-4 w-4" />} />
        <StatCard label="Average" value={tot.l > 0 && tot.km > 0 ? `${(tot.km / tot.l).toFixed(1)} km/L` : '—'} tone="emerald" />
      </div>
      <div className="flex flex-wrap items-end gap-2 justify-between">
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-48"><VehicleSelect vehicles={vehC.items} value={vehF} onChange={setVehF} all="All vehicles" /></div>
          <div className="w-48"><EmployeeSelect employees={employees} value={empF} onChange={setEmpF} placeholder="All employees" /></div>
          <input type="date" className={inputCls + ' !w-auto'} value={from} onChange={e => setFrom(e.target.value)} />
          <input type="date" className={inputCls + ' !w-auto'} value={to} onChange={e => setTo(e.target.value)} />
        </div>
        <div className="flex gap-2"><ImportButton employees={employees} user={user} types={['fuel', 'vehicles']} initialType="fuel" /><button className={btnPrimary} onClick={() => setForm('new')}><Plus className="h-4 w-4" />Add daily log</button></div>
      </div>

      {shown.length === 0 ? <Empty text="No daily logs in this range." /> : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase text-slate-400 border-b border-slate-100">
              <th className="px-3 py-2">Date</th><th className="px-3 py-2">Vehicle</th><th className="px-3 py-2">Driver</th><th className="px-3 py-2 text-right">Start → End</th>
              <th className="px-3 py-2 text-right">Km</th><th className="px-3 py-2 text-right">Liters</th><th className="px-3 py-2 text-right">Fuel cost</th><th className="px-3 py-2 text-right">km/L</th><th className="px-3 py-2" />
            </tr></thead>
            <tbody className="divide-y divide-slate-50">
              {shown.map(l => (
                <tr key={l.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 whitespace-nowrap">{fmtD(l.date)}</td>
                  <td className="px-3 py-2 font-bold text-slate-800 whitespace-nowrap">{l.plate}</td>
                  <td className="px-3 py-2">{l.employeeName || <span className="text-slate-300">—</span>}</td>
                  <td className="px-3 py-2 text-right text-slate-500 whitespace-nowrap">{l.startKm != null && l.endKm != null ? `${l.startKm.toLocaleString()} → ${l.endKm.toLocaleString()}` : '—'}</td>
                  <td className="px-3 py-2 text-right font-semibold">{l.km.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">{l.liters ?? '—'}</td>
                  <td className="px-3 py-2 text-right">{l.fuelCost != null ? fmtAED(l.fuelCost) : '—'}</td>
                  <td className="px-3 py-2 text-right text-slate-500">{l.liters && l.km ? (l.km / l.liters).toFixed(1) : '—'}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button className="text-slate-400 hover:text-violet-600 mr-2" aria-label="Edit" onClick={() => setForm(l)}><Pencil className="h-4 w-4 inline" /></button>
                    <button className="text-slate-300 hover:text-rose-600" aria-label="Delete" onClick={async () => { if (!(await ask(`Delete the ${fmtD(l.date)} log for ${l.plate}?`))) return; const ok = await runSave(() => logC.remove(l.id), 'Log deleted'); if (ok) logAudit(user, 'Fleet', `Deleted daily log ${l.date}`, l.plate); }}><Trash2 className="h-4 w-4 inline" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {form && <LogForm existing={form === 'new' ? undefined : form} vehicles={vehC.items.filter(v => v.status === 'Active' || (form !== 'new' && v.id === form.vehicleId))}
        employees={employees} user={user} logs={logC.items} services={svcC.items} onClose={() => setForm(null)}
        save={async l => { const ok = await runSave(() => logC.save(l), 'Daily log saved'); if (ok) { logAudit(user, 'Fleet', `${form === 'new' ? 'Logged' : 'Edited'} ${l.km} km${l.liters ? ` / ${l.liters} L` : ''} on ${l.date}`, l.plate); setForm(null); } }} />}
    </div>
  );
};

const LogForm: React.FC<{
  existing?: HRFuelLog; vehicles: HRVehicle[]; employees: FleetProps['employees']; user?: string; logs: HRFuelLog[]; services: HRVehicleService[];
  onClose: () => void; save: (l: HRFuelLog) => void;
}> = ({ existing, vehicles, employees, user, logs, services, onClose, save }) => {
  const { ask, node } = useConfirm();
  const [f, setF] = useState({
    vehicleId: existing?.vehicleId || '', date: existing?.date || todayStr(), employeeId: existing?.employeeId || '',
    direct: existing ? (existing.startKm == null || existing.endKm == null) : false,
    startKm: existing?.startKm != null ? String(existing.startKm) : '', endKm: existing?.endKm != null ? String(existing.endKm) : '',
    km: existing ? String(existing.km) : '', liters: existing?.liters != null ? String(existing.liters) : '', fuelCost: existing?.fuelCost != null ? String(existing.fuelCost) : '',
    station: existing?.station || '', notes: existing?.notes || '',
  });
  const veh = vehicles.find(v => v.id === f.vehicleId);
  const odo = veh ? latestOdometer(veh, logs.filter(l => l.id !== existing?.id), services) : 0;

  const pickVehicle = (id: string) => {
    const v = vehicles.find(x => x.id === id);
    const drv = v ? driverOn(v, f.date) : undefined;
    const o = v ? latestOdometer(v, logs.filter(l => l.id !== existing?.id), services) : 0;
    setF(p => ({ ...p, vehicleId: id, employeeId: drv?.employeeId || p.employeeId, startKm: !p.direct && !existing && o ? String(o) : p.startKm }));
  };
  const km = f.direct ? (num(f.km) ?? 0) : Math.max(0, (num(f.endKm) ?? 0) - (num(f.startKm) ?? 0));
  const liters = num(f.liters), cost = num(f.fuelCost);

  const submit = async () => {
    if (!veh) { hrToast('Choose the vehicle', 'err'); return; }
    if (!f.direct) {
      const s = num(f.startKm), e = num(f.endKm);
      if (s == null || e == null) { hrToast('Enter the start and end odometer, or tick "Enter km directly"', 'err'); return; }
      if (e < s) { hrToast('End km is lower than start km', 'err'); return; }
      if (odo && s < odo && !(await ask(`Start km (${s.toLocaleString()}) is lower than the last recorded odometer (${odo.toLocaleString()} km). Save anyway?`))) return;
    }
    if (km <= 0 && !(liters && liters > 0)) { hrToast('Enter the km driven or the fuel filled', 'err'); return; }
    if (km > 1500 && !(await ask(`${km.toLocaleString()} km in one day is unusually high. Is that correct?`))) return;
    if (liters != null && liters > 200 && !(await ask(`${liters} liters is unusually high for one fill. Is that correct?`))) return;
    const emp = employees.find(e => e.id === f.employeeId);
    save({
      id: existing?.id || newId('fl'), vehicleId: veh.id, plate: veh.plate, date: f.date, employeeId: emp?.id, employeeName: emp?.name,
      startKm: f.direct ? undefined : num(f.startKm), endKm: f.direct ? undefined : num(f.endKm), km,
      liters, fuelCost: cost, station: f.station.trim() || undefined, notes: f.notes.trim() || undefined,
      createdBy: existing?.createdBy || user, createdAt: existing?.createdAt || new Date().toISOString(),
    });
  };
  return (
    <Modal title={existing ? 'Edit daily log' : 'Add daily log'} onClose={onClose} footer={<><button className={btnGhost} onClick={onClose}>Cancel</button><button className={btnPrimary} onClick={submit}>Save</button></>}>
      {node}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Vehicle *"><VehicleSelect vehicles={vehicles} value={f.vehicleId} onChange={pickVehicle} /></Field>
        <Field label="Date"><input type="date" className={inputCls} value={f.date} onChange={e => setF(p => ({ ...p, date: e.target.value }))} /></Field>
      </div>
      <Field label="Driver"><EmployeeSelect employees={employees} value={f.employeeId} onChange={id => setF(p => ({ ...p, employeeId: id }))} placeholder="Select driver…" /></Field>
      <label className="flex items-center gap-2 text-xs font-semibold text-slate-600"><input type="checkbox" className="accent-violet-600" checked={f.direct} onChange={e => setF(p => ({ ...p, direct: e.target.checked }))} />Enter km directly (no odometer reading)</label>
      {f.direct ? (
        <Field label="Km driven today"><input type="number" min={0} className={inputCls} value={f.km} onChange={e => setF(p => ({ ...p, km: e.target.value }))} /></Field>
      ) : (
        <div className="grid grid-cols-3 gap-3 items-end">
          <Field label="Start odometer"><input type="number" className={inputCls} value={f.startKm} onChange={e => setF(p => ({ ...p, startKm: e.target.value }))} /></Field>
          <Field label="End odometer"><input type="number" className={inputCls} value={f.endKm} onChange={e => setF(p => ({ ...p, endKm: e.target.value }))} /></Field>
          <div className="text-sm font-black text-violet-700 pb-2">{km.toLocaleString()} km</div>
        </div>
      )}
      {veh && odo > 0 && !f.direct && <p className="text-[11px] text-slate-400">Last recorded odometer for {veh.plate}: {odo.toLocaleString()} km</p>}
      <div className="grid grid-cols-3 gap-3">
        <Field label="Fuel (liters)"><input type="number" min={0} step="0.01" className={inputCls} value={f.liters} onChange={e => setF(p => ({ ...p, liters: e.target.value }))} /></Field>
        <Field label="Fuel cost (AED)"><input type="number" min={0} step="0.01" className={inputCls} value={f.fuelCost} onChange={e => setF(p => ({ ...p, fuelCost: e.target.value }))} /></Field>
        <Field label="Station"><input className={inputCls} value={f.station} onChange={e => setF(p => ({ ...p, station: e.target.value }))} placeholder="ADNOC, ENOC…" /></Field>
      </div>
      {liters && cost && <p className="text-[11px] text-slate-400">≈ {fmtAED(cost / liters)} per liter{km > 0 ? ` · ${(km / liters).toFixed(1)} km/L · ${fmtAED(cost / km)} per km` : ''}</p>}
      <Field label="Notes"><input className={inputCls} value={f.notes} onChange={e => setF(p => ({ ...p, notes: e.target.value }))} /></Field>
    </Modal>
  );
};

// ─────────────── Maintenance ───────────────
export const MaintenancePanel: React.FC<FleetProps> = ({ user, vehC, logC, svcC }) => {
  const [vehF, setVehF] = useState('');
  const [form, setForm] = useState<HRVehicleService | 'new' | null>(null);
  const { ask, node } = useConfirm();

  // Latest service per vehicle that carries a next-due date or km → due / overdue
  const due = useMemo(() => {
    const out: { v: HRVehicle; type: string; why: string; overdue: boolean }[] = [];
    vehC.items.filter(v => v.status !== 'Sold').forEach(v => {
      const recs = svcC.items.filter(s => s.vehicleId === v.id).sort((a, b) => b.date.localeCompare(a.date));
      const odo = latestOdometer(v, logC.items, svcC.items);
      const seen = new Set<string>();
      recs.forEach(s => {
        if (seen.has(s.type)) return; seen.add(s.type);   // newest record of each type
        const d = daysUntil(s.nextDueDate);
        if (d !== null && d <= 30) out.push({ v, type: s.type, why: d < 0 ? `overdue by ${-d} day(s)` : `due in ${d} day(s)`, overdue: d < 0 });
        if (s.nextDueKm && odo && s.nextDueKm - odo <= 500) out.push({ v, type: s.type, why: s.nextDueKm - odo < 0 ? `overdue by ${(odo - s.nextDueKm).toLocaleString()} km` : `due in ${(s.nextDueKm - odo).toLocaleString()} km`, overdue: s.nextDueKm - odo < 0 });
      });
    });
    return out;
  }, [vehC.items, svcC.items, logC.items]);

  const shown = svcC.items.filter(s => !vehF || s.vehicleId === vehF).sort((a, b) => b.date.localeCompare(a.date));
  const yearStart = `${new Date().getFullYear()}-01-01`;
  const costYear = svcC.items.filter(s => s.date >= yearStart).reduce((t, s) => t + (s.cost || 0), 0);

  return (
    <div className="space-y-4">
      {node}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard label="Service records" value={svcC.items.length} tone="slate" icon={<Wrench className="h-4 w-4" />} />
        <StatCard label="Due / overdue" value={due.length} tone={due.some(d => d.overdue) ? 'rose' : due.length ? 'amber' : 'slate'} />
        <StatCard label="Maintenance cost this year" value={fmtAED(costYear)} tone="violet" />
      </div>
      {due.length > 0 && (
        <div className="space-y-1.5">
          {due.map((d, i) => (
            <div key={i} className={`flex items-center justify-between text-xs font-semibold px-3 py-2 rounded-lg border ${d.overdue ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
              <span>{d.v.plate} — {d.type} {d.why}</span>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="w-56"><VehicleSelect vehicles={vehC.items} value={vehF} onChange={setVehF} all="All vehicles" /></div>
        <button className={btnPrimary} onClick={() => setForm('new')}><Plus className="h-4 w-4" />Add service record</button>
      </div>
      {shown.length === 0 ? <Empty text="No maintenance records yet." /> : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase text-slate-400 border-b border-slate-100"><th className="px-3 py-2">Date</th><th className="px-3 py-2">Vehicle</th><th className="px-3 py-2">Type</th><th className="px-3 py-2 text-right">Odometer</th><th className="px-3 py-2 text-right">Cost</th><th className="px-3 py-2">Vendor</th><th className="px-3 py-2">Next due</th><th className="px-3 py-2" /></tr></thead>
            <tbody className="divide-y divide-slate-50">
              {shown.map(s => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 whitespace-nowrap">{fmtD(s.date)}</td><td className="px-3 py-2 font-bold text-slate-800">{s.plate}</td><td className="px-3 py-2">{s.type}</td>
                  <td className="px-3 py-2 text-right">{s.odometer ? `${s.odometer.toLocaleString()} km` : '—'}</td><td className="px-3 py-2 text-right">{s.cost != null ? fmtAED(s.cost) : '—'}</td>
                  <td className="px-3 py-2 text-slate-500">{s.vendor || '—'}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{s.nextDueDate ? fmtD(s.nextDueDate) : ''}{s.nextDueDate && s.nextDueKm ? ' · ' : ''}{s.nextDueKm ? `${s.nextDueKm.toLocaleString()} km` : ''}{!s.nextDueDate && !s.nextDueKm ? '—' : ''}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button className="text-slate-400 hover:text-violet-600 mr-2" aria-label="Edit" onClick={() => setForm(s)}><Pencil className="h-4 w-4 inline" /></button>
                    <button className="text-slate-300 hover:text-rose-600" aria-label="Delete" onClick={async () => { if (!(await ask(`Delete this ${s.type} record for ${s.plate}?`))) return; const ok = await runSave(() => svcC.remove(s.id), 'Record deleted'); if (ok) logAudit(user, 'Fleet', `Deleted ${s.type} record`, s.plate); }}><Trash2 className="h-4 w-4 inline" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {form && <ServiceForm existing={form === 'new' ? undefined : form} vehicles={vehC.items} onClose={() => setForm(null)}
        save={async r => { const ok = await runSave(() => svcC.save(r), 'Service record saved'); if (ok) { logAudit(user, 'Fleet', `${form === 'new' ? 'Added' : 'Edited'} ${r.type}`, r.plate); setForm(null); } }} />}
    </div>
  );
};

const ServiceForm: React.FC<{ existing?: HRVehicleService; vehicles: HRVehicle[]; onClose: () => void; save: (r: HRVehicleService) => void }> = ({ existing, vehicles, onClose, save }) => {
  const [f, setF] = useState({ vehicleId: existing?.vehicleId || '', date: existing?.date || todayStr(), type: existing?.type || SERVICE_TYPES[0], odometer: existing?.odometer != null ? String(existing.odometer) : '', cost: existing?.cost != null ? String(existing.cost) : '', vendor: existing?.vendor || '', nextDueDate: existing?.nextDueDate || '', nextDueKm: existing?.nextDueKm != null ? String(existing.nextDueKm) : '', notes: existing?.notes || '' });
  return (
    <Modal title={existing ? 'Edit service record' : 'Add service record'} onClose={onClose} footer={<><button className={btnGhost} onClick={onClose}>Cancel</button><button className={btnPrimary} onClick={() => {
      const v = vehicles.find(x => x.id === f.vehicleId);
      if (!v) { hrToast('Choose the vehicle', 'err'); return; }
      save({ id: existing?.id || newId('sv'), vehicleId: v.id, plate: v.plate, date: f.date, type: f.type, odometer: num(f.odometer), cost: num(f.cost), vendor: f.vendor.trim() || undefined, nextDueDate: f.nextDueDate || undefined, nextDueKm: num(f.nextDueKm), notes: f.notes.trim() || undefined, createdAt: existing?.createdAt || new Date().toISOString() });
    }}>Save</button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Vehicle *"><VehicleSelect vehicles={vehicles} value={f.vehicleId} onChange={id => setF(p => ({ ...p, vehicleId: id }))} /></Field>
        <Field label="Date"><input type="date" className={inputCls} value={f.date} onChange={e => setF(p => ({ ...p, date: e.target.value }))} /></Field>
        <Field label="Type"><select className={inputCls} value={f.type} onChange={e => setF(p => ({ ...p, type: e.target.value }))}>{SERVICE_TYPES.map(t => <option key={t}>{t}</option>)}</select></Field>
        <Field label="Odometer (km)"><input type="number" className={inputCls} value={f.odometer} onChange={e => setF(p => ({ ...p, odometer: e.target.value }))} /></Field>
        <Field label="Cost (AED)"><input type="number" step="0.01" className={inputCls} value={f.cost} onChange={e => setF(p => ({ ...p, cost: e.target.value }))} /></Field>
        <Field label="Workshop / vendor"><input className={inputCls} value={f.vendor} onChange={e => setF(p => ({ ...p, vendor: e.target.value }))} /></Field>
        <Field label="Next due date"><input type="date" className={inputCls} value={f.nextDueDate} onChange={e => setF(p => ({ ...p, nextDueDate: e.target.value }))} /></Field>
        <Field label="Next due at (km)"><input type="number" className={inputCls} value={f.nextDueKm} onChange={e => setF(p => ({ ...p, nextDueKm: e.target.value }))} /></Field>
      </div>
      <Field label="Notes"><input className={inputCls} value={f.notes} onChange={e => setF(p => ({ ...p, notes: e.target.value }))} /></Field>
    </Modal>
  );
};

// ─────────────── Fines & Salik ───────────────
export const FinesPanel: React.FC<FleetProps & { fineC: import('../../lib/hrStore').HRCollection<HRVehicleFine> }> = ({ employees, user, vehC, fineC }) => {
  const [vehF, setVehF] = useState('');
  const [empF, setEmpF] = useState('');
  const [statusF, setStatusF] = useState<'All' | HRVehicleFine['status']>('All');
  const [form, setForm] = useState<HRVehicleFine | 'new' | null>(null);
  const { ask, node } = useConfirm();

  const shown = fineC.items.filter(f => (!vehF || f.vehicleId === vehF) && (!empF || f.employeeId === empF) && (statusF === 'All' || f.status === statusF)).sort((a, b) => b.date.localeCompare(a.date));
  const unpaid = fineC.items.filter(f => f.status === 'Unpaid');
  const unpaidTotal = unpaid.reduce((s, f) => s + f.amount, 0);
  const monthStart = todayStr().slice(0, 8) + '01';
  const monthTotal = fineC.items.filter(f => f.date >= monthStart).reduce((s, f) => s + f.amount, 0);

  return (
    <div className="space-y-4">
      {node}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Unpaid fines" value={unpaid.length} sub={fmtAED(unpaidTotal)} tone={unpaid.length ? 'rose' : 'slate'} icon={<TriangleAlert className="h-4 w-4" />} onClick={() => setStatusF('Unpaid')} />
        <StatCard label="This month" value={fmtAED(monthTotal)} tone="amber" />
        <StatCard label="Salik this month" value={fmtAED(fineC.items.filter(f => f.kind === 'Salik' && f.date >= monthStart).reduce((s, f) => s + f.amount, 0))} tone="slate" />
        <StatCard label="All records" value={fineC.items.length} tone="slate" />
      </div>
      <div className="flex flex-wrap items-end gap-2 justify-between">
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-48"><VehicleSelect vehicles={vehC.items} value={vehF} onChange={setVehF} all="All vehicles" /></div>
          <div className="w-48"><EmployeeSelect employees={employees} value={empF} onChange={setEmpF} placeholder="All employees" /></div>
          <select className={inputCls + ' !w-auto'} value={statusF} onChange={e => setStatusF(e.target.value as any)}><option>All</option><option>Unpaid</option><option>Paid</option><option>Deducted from salary</option></select>
        </div>
        <button className={btnPrimary} onClick={() => setForm('new')}><Plus className="h-4 w-4" />Add fine / Salik</button>
      </div>
      {shown.length === 0 ? <Empty text="No fines recorded." /> : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase text-slate-400 border-b border-slate-100"><th className="px-3 py-2">Date</th><th className="px-3 py-2">Vehicle</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Responsible</th><th className="px-3 py-2">Reference</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2">Status</th><th className="px-3 py-2" /></tr></thead>
            <tbody className="divide-y divide-slate-50">
              {shown.map(f => (
                <tr key={f.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 whitespace-nowrap">{fmtD(f.date)}</td><td className="px-3 py-2 font-bold text-slate-800">{f.plate}</td><td className="px-3 py-2">{f.kind}</td>
                  <td className="px-3 py-2">{f.employeeName || '—'}</td><td className="px-3 py-2 text-slate-500">{f.reference || '—'}</td><td className="px-3 py-2 text-right font-semibold">{fmtAED(f.amount)}</td>
                  <td className="px-3 py-2"><select className="text-xs border border-slate-200 rounded px-1.5 py-1 bg-white" value={f.status} onChange={async e => { const ok = await runSave(() => fineC.save({ ...f, status: e.target.value as any }), 'Status updated'); if (ok) logAudit(user, 'Fleet', `${f.kind} → ${e.target.value}`, `${f.plate} / ${f.employeeName || ''}`); }}><option>Unpaid</option><option>Paid</option><option>Deducted from salary</option></select></td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button className="text-slate-400 hover:text-violet-600 mr-2" aria-label="Edit" onClick={() => setForm(f)}><Pencil className="h-4 w-4 inline" /></button>
                    <button className="text-slate-300 hover:text-rose-600" aria-label="Delete" onClick={async () => { if (!(await ask(`Delete this ${f.kind} (${fmtAED(f.amount)}) for ${f.plate}?`))) return; const ok = await runSave(() => fineC.remove(f.id), 'Record deleted'); if (ok) logAudit(user, 'Fleet', `Deleted ${f.kind}`, f.plate); }}><Trash2 className="h-4 w-4 inline" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {form && <FineForm existing={form === 'new' ? undefined : form} vehicles={vehC.items} employees={employees} onClose={() => setForm(null)}
        save={async r => { const ok = await runSave(() => fineC.save(r), 'Saved'); if (ok) { logAudit(user, 'Fleet', `${form === 'new' ? 'Added' : 'Edited'} ${r.kind} ${fmtAED(r.amount)}`, `${r.plate} / ${r.employeeName || ''}`); setForm(null); } }} />}
    </div>
  );
};

const FineForm: React.FC<{ existing?: HRVehicleFine; vehicles: HRVehicle[]; employees: FleetProps['employees']; onClose: () => void; save: (r: HRVehicleFine) => void }> = ({ existing, vehicles, employees, onClose, save }) => {
  const [f, setF] = useState({ vehicleId: existing?.vehicleId || '', date: existing?.date || todayStr(), kind: existing?.kind || 'Traffic fine' as HRVehicleFine['kind'], amount: existing ? String(existing.amount) : '', employeeId: existing?.employeeId || '', reference: existing?.reference || '', status: existing?.status || 'Unpaid' as HRVehicleFine['status'], notes: existing?.notes || '' });
  const autoDriver = (vehicleId: string, date: string) => { const v = vehicles.find(x => x.id === vehicleId); return v ? driverOn(v, date)?.employeeId || '' : ''; };
  return (
    <Modal title={existing ? 'Edit fine / Salik' : 'Add fine / Salik'} onClose={onClose} footer={<><button className={btnGhost} onClick={onClose}>Cancel</button><button className={btnPrimary} onClick={() => {
      const v = vehicles.find(x => x.id === f.vehicleId); const amt = num(f.amount);
      if (!v) { hrToast('Choose the vehicle', 'err'); return; }
      if (!(amt && amt > 0)) { hrToast('Enter the amount', 'err'); return; }
      const emp = employees.find(e => e.id === f.employeeId);
      save({ id: existing?.id || newId('fn'), vehicleId: v.id, plate: v.plate, date: f.date, kind: f.kind, amount: amt, employeeId: emp?.id, employeeName: emp?.name, reference: f.reference.trim() || undefined, status: f.status, notes: f.notes.trim() || undefined, createdAt: existing?.createdAt || new Date().toISOString() });
    }}>Save</button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Vehicle *"><VehicleSelect vehicles={vehicles} value={f.vehicleId} onChange={id => setF(p => ({ ...p, vehicleId: id, employeeId: autoDriver(id, p.date) || p.employeeId }))} /></Field>
        <Field label="Date"><input type="date" className={inputCls} value={f.date} onChange={e => setF(p => ({ ...p, date: e.target.value, employeeId: autoDriver(p.vehicleId, e.target.value) || p.employeeId }))} /></Field>
        <Field label="Type"><select className={inputCls} value={f.kind} onChange={e => setF(p => ({ ...p, kind: e.target.value as any }))}><option>Traffic fine</option><option>Salik</option><option>Parking</option><option>Other</option></select></Field>
        <Field label="Amount (AED) *"><input type="number" step="0.01" className={inputCls} value={f.amount} onChange={e => setF(p => ({ ...p, amount: e.target.value }))} /></Field>
      </div>
      <Field label="Responsible employee (auto-filled from who had the vehicle that day)"><EmployeeSelect employees={employees} value={f.employeeId} onChange={id => setF(p => ({ ...p, employeeId: id }))} placeholder="Select…" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Fine / reference no."><input className={inputCls} value={f.reference} onChange={e => setF(p => ({ ...p, reference: e.target.value }))} /></Field>
        <Field label="Status"><select className={inputCls} value={f.status} onChange={e => setF(p => ({ ...p, status: e.target.value as any }))}><option>Unpaid</option><option>Paid</option><option>Deducted from salary</option></select></Field>
      </div>
      <Field label="Notes"><input className={inputCls} value={f.notes} onChange={e => setF(p => ({ ...p, notes: e.target.value }))} /></Field>
    </Modal>
  );
};
