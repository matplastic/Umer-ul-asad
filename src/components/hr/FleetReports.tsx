import React, { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend } from 'recharts';
import { HRFuelLog, HRVehicle, HRVehicleFine, HRVehicleService, fmtD, fmtAED, todayStr } from '../../lib/hrStore';
import { buildReport, presetRange, GroupBy, ReportRow } from '../../lib/fleetReports';
import { exportToExcel, exportTablePdf } from '../../lib/exportUtils';
import { chartTokens, chartAxisDefaults } from '../../lib/chartTokens';
import { inputCls, btnGhost, StatCard, Empty, SectionCard, EmployeeSelect, hrToast } from './hrUi';
import type { Employee } from '../../types';

interface Props { employees: Employee[]; vehicles: HRVehicle[]; logs: HRFuelLog[]; services: HRVehicleService[]; fines: HRVehicleFine[] }

const GROUPS: { id: GroupBy; label: string; col: string }[] = [
  { id: 'vehicle', label: 'By car number', col: 'Vehicle' },
  { id: 'employee', label: 'By employee', col: 'Employee' },
  { id: 'day', label: 'By date', col: 'Date' },
  { id: 'week', label: 'By week', col: 'Week' },
  { id: 'month', label: 'By month', col: 'Month' },
];
const PRESETS: { id: 'today' | 'week' | 'month' | 'lastMonth' | 'year'; label: string }[] = [
  { id: 'today', label: 'Today' }, { id: 'week', label: 'This week' }, { id: 'month', label: 'This month' }, { id: 'lastMonth', label: 'Last month' }, { id: 'year', label: 'This year' },
];
const dash = (n: number | null, d = 2) => n == null ? '—' : n.toFixed(d);

export const FleetReports: React.FC<Props> = ({ employees, vehicles, logs, services, fines }) => {
  const [groupBy, setGroupBy] = useState<GroupBy>('vehicle');
  const [vehicleId, setVehicleId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const init = presetRange('month');
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [costs, setCosts] = useState(true);

  const { rows, totals } = useMemo(
    () => buildReport(logs, services, fines, vehicles, groupBy, { vehicleId: vehicleId || undefined, employeeId: employeeId || undefined, from, to }),
    [logs, services, fines, vehicles, groupBy, vehicleId, employeeId, from, to]);

  const detail = useMemo(() => logs.filter(l => l.date >= from && l.date <= to && (!vehicleId || l.vehicleId === vehicleId) && (!employeeId || l.employeeId === employeeId))
    .sort((a, b) => b.date.localeCompare(a.date)), [logs, from, to, vehicleId, employeeId]);

  const gcol = GROUPS.find(g => g.id === groupBy)!.col;
  const showCosts = costs && !(groupBy === 'employee');   // maintenance can't be tied to a driver
  const chartData = [...rows].slice(0, 24).reverse().map(r => ({ name: r.label.replace('Week of ', ''), km: r.km, fuel: r.fuelCost }));
  const title = `Fleet report — ${GROUPS.find(g => g.id === groupBy)!.label.toLowerCase()}`;
  const subtitle = `${fmtD(from)} to ${fmtD(to)}${vehicleId ? ` · ${vehicles.find(v => v.id === vehicleId)?.plate}` : ''}${employeeId ? ` · ${employees.find(e => e.id === employeeId)?.name}` : ''}`;

  const toObj = (r: ReportRow) => {
    const o: Record<string, any> = { [gcol]: r.label, 'Days logged': r.days, 'Km driven': r.km, 'Fuel (L)': r.liters, 'Fuel cost (AED)': r.fuelCost, 'km/L': r.kmPerL ?? '', 'Fuel cost per km': r.costPerKm ?? '', 'Avg km/day': r.kmPerDay ?? '' };
    if (showCosts) { o['Maintenance (AED)'] = r.serviceCost; o['Fines & Salik (AED)'] = r.fines; o['Total cost (AED)'] = r.totalCost; }
    return o;
  };
  const exportRows = () => [...rows, totals].map(toObj);
  const doExcel = () => rows.length ? exportToExcel(exportRows(), `Fleet_report_${groupBy}_${from}_${to}`, 'Fleet') : hrToast('Nothing to export', 'err');
  const doPdf = () => {
    if (!rows.length) { hrToast('Nothing to export', 'err'); return; }
    const keys = Object.keys(toObj(totals));
    exportTablePdf({ title, subtitle, deptLine: 'Human Resources Department — Fleet', columns: keys.map(k => ({ header: k, dataKey: k })), rows: exportRows(), filename: `Fleet_report_${groupBy}_${from}_${to}`, orientation: 'landscape' });
  };

  return (
    <div className="space-y-4">
      <SectionCard>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {GROUPS.map(g => (
            <button key={g.id} onClick={() => setGroupBy(g.id)} className={`px-3 py-1.5 rounded-full text-xs font-bold border ${groupBy === g.id ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>{g.label}</button>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
          <div><label className="text-xs font-semibold text-slate-500 block mb-1">Car number</label>
            <select className={inputCls} value={vehicleId} onChange={e => setVehicleId(e.target.value)}><option value="">All vehicles</option>{[...vehicles].sort((a, b) => a.plate.localeCompare(b.plate)).map(v => <option key={v.id} value={v.id}>{v.plate} — {v.make} {v.model}</option>)}</select></div>
          <div><label className="text-xs font-semibold text-slate-500 block mb-1">Employee</label>
            <EmployeeSelect employees={employees} value={employeeId} onChange={setEmployeeId} placeholder="All employees" /></div>
          <div><label className="text-xs font-semibold text-slate-500 block mb-1">From</label><input type="date" className={inputCls} value={from} onChange={e => setFrom(e.target.value)} /></div>
          <div><label className="text-xs font-semibold text-slate-500 block mb-1">To</label><input type="date" className={inputCls} value={to} max={todayStr()} onChange={e => setTo(e.target.value)} /></div>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          {PRESETS.map(p => <button key={p.id} className={btnGhost} onClick={() => { const r = presetRange(p.id); setFrom(r.from); setTo(r.to); }}>{p.label}</button>)}
          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 ml-2"><input type="checkbox" className="accent-violet-600" checked={costs} onChange={e => setCosts(e.target.checked)} />Include maintenance & fines</label>
          <span className="ml-auto flex gap-2"><button className={btnGhost} onClick={doExcel}><Download className="h-3.5 w-3.5" />Excel</button><button className={btnGhost} onClick={doPdf}><Download className="h-3.5 w-3.5" />PDF</button></span>
        </div>
      </SectionCard>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Km driven" value={totals.km.toLocaleString()} sub={totals.kmPerDay ? `${totals.kmPerDay} km / day` : undefined} tone="violet" />
        <StatCard label="Fuel" value={`${totals.liters} L`} sub={totals.kmPerL ? `${totals.kmPerL} km/L` : undefined} tone="amber" />
        <StatCard label="Fuel cost" value={fmtAED(totals.fuelCost)} sub={totals.costPerKm ? `${fmtAED(totals.costPerKm)} per km` : undefined} tone="slate" />
        <StatCard label="Maintenance + fines" value={fmtAED(totals.serviceCost + totals.fines)} tone="slate" />
        <StatCard label="Total running cost" value={fmtAED(totals.totalCost)} tone="emerald" />
      </div>

      {rows.length === 0 ? <Empty text="No data for these filters. Add daily logs, or widen the date range." /> : (<>
        <SectionCard title="Km and fuel cost">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ left: -8, right: 8 }}>
                <CartesianGrid stroke={chartAxisDefaults.gridStroke} />
                <XAxis dataKey="name" stroke={chartAxisDefaults.axisStroke} fontSize={10} interval={0} angle={chartData.length > 8 ? -30 : 0} textAnchor={chartData.length > 8 ? 'end' : 'middle'} height={chartData.length > 8 ? 56 : 30} />
                <YAxis yAxisId="l" stroke={chartAxisDefaults.axisStroke} fontSize={11} />
                <YAxis yAxisId="r" orientation="right" stroke={chartAxisDefaults.axisStroke} fontSize={11} />
                <RTooltip /><Legend />
                <Bar yAxisId="l" dataKey="km" name="Km" fill={chartTokens.primary[500]} radius={[4, 4, 0, 0]} />
                <Bar yAxisId="r" dataKey="fuel" name="Fuel cost (AED)" fill={chartTokens.primary[200]} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase text-slate-400 border-b border-slate-100">
              <th className="px-3 py-2">{gcol}</th><th className="px-3 py-2 text-right">Days</th><th className="px-3 py-2 text-right">Km</th><th className="px-3 py-2 text-right">Liters</th>
              <th className="px-3 py-2 text-right">Fuel cost</th><th className="px-3 py-2 text-right">km/L</th><th className="px-3 py-2 text-right">Cost/km</th><th className="px-3 py-2 text-right">Km/day</th>
              {showCosts && <><th className="px-3 py-2 text-right">Maintenance</th><th className="px-3 py-2 text-right">Fines</th><th className="px-3 py-2 text-right">Total</th></>}
            </tr></thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map(r => (
                <tr key={r.key} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-semibold text-slate-800 whitespace-nowrap">{r.label}</td><td className="px-3 py-2 text-right">{r.days}</td><td className="px-3 py-2 text-right">{r.km.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">{r.liters}</td><td className="px-3 py-2 text-right">{fmtAED(r.fuelCost)}</td><td className="px-3 py-2 text-right">{dash(r.kmPerL, 1)}</td>
                  <td className="px-3 py-2 text-right">{dash(r.costPerKm)}</td><td className="px-3 py-2 text-right">{dash(r.kmPerDay, 0)}</td>
                  {showCosts && <><td className="px-3 py-2 text-right">{fmtAED(r.serviceCost)}</td><td className="px-3 py-2 text-right">{fmtAED(r.fines)}</td><td className="px-3 py-2 text-right font-bold">{fmtAED(r.totalCost)}</td></>}
                </tr>
              ))}
              <tr className="bg-violet-50 font-black text-slate-800">
                <td className="px-3 py-2">Total</td><td className="px-3 py-2 text-right">{totals.days}</td><td className="px-3 py-2 text-right">{totals.km.toLocaleString()}</td><td className="px-3 py-2 text-right">{totals.liters}</td>
                <td className="px-3 py-2 text-right">{fmtAED(totals.fuelCost)}</td><td className="px-3 py-2 text-right">{dash(totals.kmPerL, 1)}</td><td className="px-3 py-2 text-right">{dash(totals.costPerKm)}</td><td className="px-3 py-2 text-right">{dash(totals.kmPerDay, 0)}</td>
                {showCosts && <><td className="px-3 py-2 text-right">{fmtAED(totals.serviceCost)}</td><td className="px-3 py-2 text-right">{fmtAED(totals.fines)}</td><td className="px-3 py-2 text-right">{fmtAED(totals.totalCost)}</td></>}
              </tr>
            </tbody>
          </table>
        </div>

        <details className="bg-white border border-slate-200 rounded-xl">
          <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-slate-700">Daily entries in this report ({detail.length})</summary>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase text-slate-400 border-y border-slate-100"><th className="px-3 py-2">Date</th><th className="px-3 py-2">Vehicle</th><th className="px-3 py-2">Driver</th><th className="px-3 py-2 text-right">Km</th><th className="px-3 py-2 text-right">Liters</th><th className="px-3 py-2 text-right">Fuel cost</th></tr></thead>
              <tbody className="divide-y divide-slate-50">
                {detail.slice(0, 500).map(l => <tr key={l.id}><td className="px-3 py-1.5">{fmtD(l.date)}</td><td className="px-3 py-1.5 font-bold text-slate-800">{l.plate}</td><td className="px-3 py-1.5">{l.employeeName || '—'}</td><td className="px-3 py-1.5 text-right">{l.km.toLocaleString()}</td><td className="px-3 py-1.5 text-right">{l.liters ?? '—'}</td><td className="px-3 py-1.5 text-right">{l.fuelCost != null ? fmtAED(l.fuelCost) : '—'}</td></tr>)}
              </tbody>
            </table>
            {detail.length > 500 && <p className="text-[11px] text-slate-400 px-4 py-2">Showing the latest 500. Export to Excel for everything.</p>}
          </div>
        </details>
      </>)}
      {groupBy === 'employee' && costs && <p className="text-[11px] text-slate-400">Maintenance can't be linked to a driver, so the employee view shows fuel and fines only.</p>}
    </div>
  );
};
