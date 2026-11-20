import React, { useMemo, useState } from 'react';
import { Car, UserCheck, Fuel, Gauge, TriangleAlert, ShieldAlert, Wrench } from 'lucide-react';
import { Employee } from '../../types';
import {
  useHRCollection, HRVehicle, HRFuelLog, HRVehicleService, HRVehicleFine, HRLetterLog,
  currentAssignment, latestOdometer, expiryState, daysUntil, todayStr, fmtAED,
} from '../../lib/hrStore';
import { StatCard, SubTabs, SectionCard } from './hrUi';
import { VehiclesPanel, FleetProps } from './FleetVehicles';
import { DailyLogPanel, MaintenancePanel, FinesPanel } from './FleetLogs';
import { FleetReports } from './FleetReports';

interface Props { employees: Employee[]; user?: string }

export const Fleet: React.FC<Props> = ({ employees, user }) => {
  const vehC = useHRCollection<HRVehicle>('hrVehicles');
  const logC = useHRCollection<HRFuelLog>('hrFuelLogs');
  const svcC = useHRCollection<HRVehicleService>('hrVehicleService');
  const fineC = useHRCollection<HRVehicleFine>('hrVehicleFines');
  const lettersC = useHRCollection<HRLetterLog>('hrLetters');
  const [tab, setTab] = useState('overview');
  const shared: FleetProps = { employees, user, vehC, logC, svcC, lettersC };

  const o = useMemo(() => {
    const vs = vehC.items.filter(v => v.status !== 'Sold');
    const assigned = vs.filter(v => currentAssignment(v)).length;
    const monthStart = todayStr().slice(0, 8) + '01';
    const ml = logC.items.filter(l => l.date >= monthStart);
    const km = ml.reduce((s, l) => s + l.km, 0), lit = ml.reduce((s, l) => s + (l.liters || 0), 0), cost = ml.reduce((s, l) => s + (l.fuelCost || 0), 0);
    const alerts: { tone: 'rose' | 'amber'; text: string; tab: string }[] = [];
    vs.forEach(v => {
      const reg = expiryState(v.registrationExpiry, 30), ins = expiryState(v.insuranceExpiry, 30);
      if (reg === 'expired') alerts.push({ tone: 'rose', text: `${v.plate}: registration (Mulkiya) expired`, tab: 'vehicles' });
      else if (reg === 'soon') alerts.push({ tone: 'amber', text: `${v.plate}: registration expires in ${daysUntil(v.registrationExpiry)} day(s)`, tab: 'vehicles' });
      if (ins === 'expired') alerts.push({ tone: 'rose', text: `${v.plate}: insurance expired`, tab: 'vehicles' });
      else if (ins === 'soon') alerts.push({ tone: 'amber', text: `${v.plate}: insurance expires in ${daysUntil(v.insuranceExpiry)} day(s)`, tab: 'vehicles' });
      const odo = latestOdometer(v, logC.items, svcC.items);
      const seen = new Set<string>();
      svcC.items.filter(s => s.vehicleId === v.id).sort((a, b) => b.date.localeCompare(a.date)).forEach(s => {
        if (seen.has(s.type)) return; seen.add(s.type);
        const d = daysUntil(s.nextDueDate);
        if (d !== null && d <= 30) alerts.push({ tone: d < 0 ? 'rose' : 'amber', text: `${v.plate}: ${s.type} ${d < 0 ? `overdue by ${-d} day(s)` : `due in ${d} day(s)`}`, tab: 'service' });
        if (s.nextDueKm && odo && s.nextDueKm - odo <= 500) alerts.push({ tone: s.nextDueKm < odo ? 'rose' : 'amber', text: `${v.plate}: ${s.type} ${s.nextDueKm < odo ? 'overdue' : `due in ${(s.nextDueKm - odo).toLocaleString()} km`}`, tab: 'service' });
      });
    });
    const unpaid = fineC.items.filter(f => f.status === 'Unpaid');
    if (unpaid.length) alerts.push({ tone: 'amber', text: `${unpaid.length} unpaid fine(s) / Salik — ${fmtAED(unpaid.reduce((s, f) => s + f.amount, 0))}`, tab: 'fines' });
    // Active vehicles with no daily log in the last 7 days while assigned
    const weekAgo = todayStr(new Date(Date.now() - 7 * 86400000));
    vs.filter(v => currentAssignment(v) && v.status === 'Active').forEach(v => {
      if (!logC.items.some(l => l.vehicleId === v.id && l.date >= weekAgo)) alerts.push({ tone: 'amber', text: `${v.plate}: no daily log in the last 7 days`, tab: 'log' });
    });
    return { total: vs.length, assigned, km, lit, cost, alerts };
  }, [vehC.items, logC.items, svcC.items, fineC.items]);

  const toneCls = { rose: 'bg-rose-50 border-rose-200 text-rose-800', amber: 'bg-amber-50 border-amber-200 text-amber-800' };

  return (
    <div className="space-y-4">
      <SubTabs active={tab} onChange={setTab} tabs={[
        { id: 'overview', label: 'Overview' }, { id: 'vehicles', label: 'Vehicles' }, { id: 'log', label: 'Daily log (km & fuel)' },
        { id: 'service', label: 'Maintenance' }, { id: 'fines', label: 'Fines & Salik' }, { id: 'reports', label: 'Reports' },
      ]} />

      {tab === 'overview' && (<>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Vehicles" value={o.total} tone="violet" icon={<Car className="h-4 w-4" />} onClick={() => setTab('vehicles')} />
          <StatCard label="Assigned / available" value={`${o.assigned} / ${o.total - o.assigned}`} tone="slate" icon={<UserCheck className="h-4 w-4" />} onClick={() => setTab('vehicles')} />
          <StatCard label="Km this month" value={o.km.toLocaleString()} sub={o.lit > 0 && o.km > 0 ? `${(o.km / o.lit).toFixed(1)} km/L` : undefined} tone="emerald" icon={<Gauge className="h-4 w-4" />} onClick={() => setTab('reports')} />
          <StatCard label="Fuel this month" value={fmtAED(o.cost)} sub={`${Math.round(o.lit * 10) / 10} L`} tone="amber" icon={<Fuel className="h-4 w-4" />} onClick={() => setTab('log')} />
        </div>
        <SectionCard title={`Needs attention (${o.alerts.length})`}>
          {o.alerts.length === 0 ? <p className="text-sm text-emerald-600 font-semibold py-4 text-center">All vehicles are in order.</p> : (
            <div className="space-y-1.5 max-h-80 overflow-y-auto">
              {o.alerts.map((a, i) => (
                <button key={i} onClick={() => setTab(a.tab)} className={`w-full text-left flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg border ${toneCls[a.tone]} hover:brightness-95`}>
                  {a.text.includes('fine') ? <TriangleAlert className="h-3.5 w-3.5" /> : a.text.includes('due') || a.text.includes('overdue') ? <Wrench className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}{a.text}
                </button>
              ))}
            </div>
          )}
        </SectionCard>
      </>)}
      {tab === 'vehicles' && <VehiclesPanel {...shared} />}
      {tab === 'log' && <DailyLogPanel {...shared} />}
      {tab === 'service' && <MaintenancePanel {...shared} />}
      {tab === 'fines' && <FinesPanel {...shared} fineC={fineC} />}
      {tab === 'reports' && <FleetReports employees={employees} vehicles={vehC.items} logs={logC.items} services={svcC.items} fines={fineC.items} />}
    </div>
  );
};
