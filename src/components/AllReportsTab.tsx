import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FileText, FileSpreadsheet, Printer, Download, RefreshCw, X,
  Boxes, Users, ShieldAlert, HeartPulse, ClipboardList, Truck,
  PackageCheck, PackageMinus, Undo2, Factory, LayoutList,
} from 'lucide-react';
import { exportToExcel, exportTablePdf } from '../lib/exportUtils';
import { DateRangeFilter, DateRange } from './DateRangeFilter';
import { EmployeeAttendanceReport } from './EmployeeAttendanceReport';
import {
  dbFetchHRLeaves, dbFetchHRWarnings, dbFetchHRAccidents, dbFetchHRMedicals,
  dbFetchHRPurchaseRequests, dbFetchMaterialRequests, dbFetchIncomingMaterials,
  dbFetchConsumptionLogs, dbFetchMaterialReturns, dbFetchProductionLogs,
  dbFetchHRSiteDeployed,
} from '../lib/firebaseService';
import { Pool, ActivityLog, Employee, EmployeePunch } from '../types';

interface AllReportsTabProps {
  pools: Pool[];
  logs: ActivityLog[];
  employees: Employee[];
  employeePunches: EmployeePunch[];
}

interface ReportColumn {
  header: string;
  dataKey: string;
  format?: (value: any, row: any) => string;
}

interface ReportDef {
  id: string;
  name: string;
  module: 'store' | 'hr' | 'production';
  icon: any;
  color: string;
  dateField: string;
  columns: ReportColumn[];
  getRows: () => any[];
}

const MODULE_LABELS: Record<string, string> = {
  store: 'Store / Inventory',
  hr: 'HR Portal',
  production: 'Production',
};

const COLOR_MAP: Record<string, string> = {
  indigo: 'bg-indigo-50 text-indigo-700',
  amber: 'bg-amber-50 text-amber-700',
  emerald: 'bg-emerald-50 text-emerald-700',
  violet: 'bg-violet-50 text-violet-700',
  rose: 'bg-rose-50 text-rose-700',
  cyan: 'bg-cyan-50 text-cyan-700',
  slate: 'bg-slate-100 text-slate-700',
};

function inRange(dateStr: string | undefined | null, start: string, end: string): boolean {
  if (!dateStr) return false;
  const d = dateStr.slice(0, 10);
  return d >= start && d <= end;
}

function fmtCell(v: any): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  return String(v);
}

function getDefaultRange(): DateRange {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  return { startDate: start.toISOString().slice(0, 10), endDate: today.toISOString().slice(0, 10) };
}

export const AllReportsTab: React.FC<AllReportsTabProps> = ({ pools, logs, employees, employeePunches }) => {
  const [dateRange, setDateRange] = useState<DateRange>(getDefaultRange());
  const [activeModule, setActiveModule] = useState<string>('all');
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ name: string; columns: ReportColumn[]; rows: any[] } | null>(null);

  // ── Data pulled fresh from Firestore (HR + Store modules aren't held in App.tsx state)
  const [loadingAll, setLoadingAll] = useState(true);
  const [hrLeaves, setHrLeaves] = useState<any[]>([]);
  const [hrWarnings, setHrWarnings] = useState<any[]>([]);
  const [hrAccidents, setHrAccidents] = useState<any[]>([]);
  const [hrMedicals, setHrMedicals] = useState<any[]>([]);
  const [hrPurchaseRequests, setHrPurchaseRequests] = useState<any[]>([]);
  const [materialRequests, setMaterialRequests] = useState<any[]>([]);
  const [incomingMaterials, setIncomingMaterials] = useState<any[]>([]);
  const [consumptionLogs, setConsumptionLogs] = useState<any[]>([]);
  const [materialReturns, setMaterialReturns] = useState<any[]>([]);
  const [productionLogs, setProductionLogs] = useState<any[]>([]);
  const [siteDeployed, setSiteDeployed] = useState<any[]>([]);

  const loadAll = useCallback(async () => {
    setLoadingAll(true);
    try {
      const [
        leaves, warnings, accidents, medicals, purchaseReqs,
        matReqs, incoming, consumption, returns, prodLogs, deployed,
      ] = await Promise.all([
        dbFetchHRLeaves(), dbFetchHRWarnings(), dbFetchHRAccidents(), dbFetchHRMedicals(),
        dbFetchHRPurchaseRequests(), dbFetchMaterialRequests(), dbFetchIncomingMaterials(),
        dbFetchConsumptionLogs(), dbFetchMaterialReturns(), dbFetchProductionLogs(),
        dbFetchHRSiteDeployed(),
      ]);
      setHrLeaves(leaves || []);
      setHrWarnings(warnings || []);
      setHrAccidents(accidents || []);
      setHrMedicals(medicals || []);
      setHrPurchaseRequests(purchaseReqs || []);
      setMaterialRequests(matReqs || []);
      setIncomingMaterials(incoming || []);
      setConsumptionLogs(consumption || []);
      setMaterialReturns(returns || []);
      setProductionLogs(prodLogs || []);
      setSiteDeployed(deployed || []);
    } catch (err) {
      console.error('[AllReportsTab] Failed to load report data:', err);
    } finally {
      setLoadingAll(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const { startDate, endDate } = dateRange;

  const reports: ReportDef[] = useMemo(() => [
    // ---------- STORE ----------
    {
      id: 'material_requests', name: 'Material Requests', module: 'store',
      icon: ClipboardList, color: 'indigo', dateField: 'createdAt',
      columns: [
        { header: 'Request', dataKey: 'id' },
        { header: 'Project', dataKey: 'projectName' },
        { header: 'Pool No', dataKey: 'poolNo' },
        { header: 'Material', dataKey: 'materialName' },
        { header: 'Qty', dataKey: 'qtyRequested' },
        { header: 'Requested By', dataKey: 'requestedByName' },
        { header: 'Status', dataKey: 'status' },
        { header: 'Date', dataKey: 'createdAt' },
      ],
      getRows: () => materialRequests.filter(r => inRange(r.createdAt, startDate, endDate)),
    },
    {
      id: 'incoming_materials', name: 'Incoming Materials (GRN)', module: 'store',
      icon: PackageCheck, color: 'emerald', dateField: 'receivedAt',
      columns: [
        { header: 'Material', dataKey: 'materialName' },
        { header: 'Qty', dataKey: 'qty' },
        { header: 'Supplier', dataKey: 'supplier' },
        { header: 'Invoice No', dataKey: 'invoiceNo' },
        { header: 'QC Status', dataKey: 'qcStatus' },
        { header: 'Received By', dataKey: 'receivedByName' },
        { header: 'Date', dataKey: 'receivedAt' },
      ],
      getRows: () => incomingMaterials.filter(r => inRange(r.receivedAt, startDate, endDate)),
    },
    {
      id: 'consumption_logs', name: 'Consumption Log', module: 'store',
      icon: PackageMinus, color: 'amber', dateField: 'date',
      columns: [
        { header: 'Date', dataKey: 'date' },
        { header: 'Section', dataKey: 'sectionName' },
        { header: 'Material', dataKey: 'materialName' },
        { header: 'Qty', dataKey: 'qty' },
        { header: 'Logged By', dataKey: 'loggedByName' },
        { header: 'Notes', dataKey: 'notes' },
      ],
      getRows: () => consumptionLogs.filter(r => inRange(r.date, startDate, endDate)),
    },
    {
      id: 'material_returns', name: 'Return to Store Log', module: 'store',
      icon: Undo2, color: 'cyan', dateField: 'date',
      columns: [
        { header: 'Date', dataKey: 'date' },
        { header: 'Section', dataKey: 'sectionName' },
        { header: 'Material', dataKey: 'materialName' },
        { header: 'Qty', dataKey: 'qty' },
        { header: 'Reason', dataKey: 'reason' },
        { header: 'Returned By', dataKey: 'returnedByName' },
      ],
      getRows: () => materialReturns.filter(r => inRange(r.date, startDate, endDate)),
    },
    {
      id: 'production_logs', name: 'Daily Production Logs', module: 'store',
      icon: Truck, color: 'violet', dateField: 'date',
      columns: [
        { header: 'Date', dataKey: 'date' },
        { header: 'Section', dataKey: 'sectionName' },
        { header: 'Project', dataKey: 'projectName' },
        { header: 'Pool No', dataKey: 'poolNo' },
        { header: 'Qty', dataKey: 'quantity' },
        { header: 'Logged By', dataKey: 'loggedByName' },
      ],
      getRows: () => productionLogs.filter(r => inRange(r.date, startDate, endDate)),
    },

    // ---------- HR ----------
    {
      id: 'hr_leaves', name: 'Leave Requests', module: 'hr',
      icon: Users, color: 'indigo', dateField: 'fromDate',
      columns: [
        { header: 'Employee', dataKey: 'employeeName' },
        { header: 'Type', dataKey: 'leaveType' },
        { header: 'From', dataKey: 'fromDate' },
        { header: 'To', dataKey: 'toDate' },
        { header: 'Days', dataKey: 'days' },
        { header: 'Status', dataKey: 'status' },
        { header: 'Reason', dataKey: 'reason' },
      ],
      getRows: () => hrLeaves.filter(r => inRange(r.fromDate || r.createdAt, startDate, endDate)),
    },
    {
      id: 'hr_warnings', name: 'Warning Letters', module: 'hr',
      icon: ShieldAlert, color: 'rose', dateField: 'issuedAt',
      columns: [
        { header: 'Employee', dataKey: 'employeeName' },
        { header: 'Type', dataKey: 'type' },
        { header: 'Reason', dataKey: 'reason' },
        { header: 'Issued By', dataKey: 'issuedBy' },
        { header: 'Date', dataKey: 'issuedAt' },
      ],
      getRows: () => hrWarnings.filter(r => inRange(r.issuedAt, startDate, endDate)),
    },
    {
      id: 'hr_accidents', name: 'Accident Reports', module: 'hr',
      icon: ShieldAlert, color: 'rose', dateField: 'date',
      columns: [
        { header: 'Date', dataKey: 'date' },
        { header: 'Employee', dataKey: 'employeeName' },
        { header: 'Department', dataKey: 'department' },
        { header: 'Description', dataKey: 'description' },
        { header: 'Action Taken', dataKey: 'actionTaken' },
        { header: 'Status', dataKey: 'status' },
      ],
      getRows: () => hrAccidents.filter(r => inRange(r.date, startDate, endDate)),
    },
    {
      id: 'hr_medicals', name: 'Medical Records', module: 'hr',
      icon: HeartPulse, color: 'cyan', dateField: 'date',
      columns: [
        { header: 'Date', dataKey: 'date' },
        { header: 'Employee', dataKey: 'employeeName' },
        { header: 'Disease/Condition', dataKey: 'disease' },
        { header: 'Notes', dataKey: 'notes' },
        { header: 'Approved By', dataKey: 'approvedBy' },
      ],
      getRows: () => hrMedicals.filter(r => inRange(r.date, startDate, endDate)),
    },
    {
      id: 'hr_purchase_requests', name: 'HR Purchase Requests', module: 'hr',
      icon: ClipboardList, color: 'amber', dateField: 'requestedAt',
      columns: [
        { header: 'Item', dataKey: 'itemName' },
        { header: 'Category', dataKey: 'category' },
        { header: 'Qty', dataKey: 'qty' },
        { header: 'Est. Cost', dataKey: 'estimatedCost' },
        { header: 'Actual Cost', dataKey: 'actualCost' },
        { header: 'Requested By', dataKey: 'requestedByName' },
        { header: 'Status', dataKey: 'status' },
        { header: 'Date', dataKey: 'requestedAt' },
      ],
      getRows: () => hrPurchaseRequests.filter(r => inRange(r.requestedAt, startDate, endDate)),
    },
    {
      id: 'employee_punches', name: 'Attendance (Machine Punches)', module: 'hr',
      icon: Users, color: 'slate', dateField: 'date',
      columns: [
        { header: 'Date', dataKey: 'date' },
        { header: 'Employee', dataKey: 'employeeName' },
        { header: 'Punch', dataKey: 'punchType' },
        { header: 'Time', dataKey: 'timestamp' },
        { header: 'Machine', dataKey: 'machineId' },
      ],
      getRows: () => employeePunches.filter(r => inRange(r.date, startDate, endDate)),
    },

    // ---------- PRODUCTION ----------
    {
      id: 'pools_created', name: 'Pools Created / Completed', module: 'production',
      icon: Factory, color: 'violet', dateField: 'createdAt',
      columns: [
        { header: 'Pool No', dataKey: 'poolNo' },
        { header: 'Project', dataKey: 'projectName' },
        { header: 'Orientation', dataKey: 'orientation' },
        { header: 'Created', dataKey: 'createdAt' },
        { header: 'Completed', dataKey: 'completedAt' },
        { header: 'Status', dataKey: 'status' },
      ],
      getRows: () => pools
        .filter(p => inRange(p.createdAt, startDate, endDate))
        .map(p => ({ ...p, status: p.isDelivered ? 'Delivered' : p.completedAt ? 'Completed' : 'In Production' })),
    },
    {
      id: 'activity_logs', name: 'Activity Log (All Events)', module: 'production',
      icon: LayoutList, color: 'indigo', dateField: 'timestamp',
      columns: [
        { header: 'Time', dataKey: 'timestamp' },
        { header: 'Project', dataKey: 'projectName' },
        { header: 'Pool', dataKey: 'poolNo' },
        { header: 'Type', dataKey: 'type' },
        { header: 'Operator', dataKey: 'operatorName' },
        { header: 'Notes', dataKey: 'notes' },
      ],
      getRows: () => logs.filter(l => inRange(l.timestamp, startDate, endDate)),
    },
  ], [
    startDate, endDate, pools, logs, employeePunches,
    hrLeaves, hrWarnings, hrAccidents, hrMedicals, hrPurchaseRequests,
    materialRequests, incomingMaterials, consumptionLogs, materialReturns, productionLogs,
  ]);

  const modules = ['all', 'store', 'hr', 'production'];
  const visibleReports = activeModule === 'all' ? reports : reports.filter(r => r.module === activeModule);

  const runReport = (report: ReportDef, action: 'pdf' | 'excel' | 'preview') => {
    setLoadingId(report.id);
    try {
      const rows = report.getRows();
      if (rows.length === 0) {
        alert(`No records found for "${report.name}" in ${startDate} to ${endDate}.`);
        return;
      }
      if (action === 'preview') {
        setPreview({ name: report.name, columns: report.columns, rows });
        return;
      }
      const exportRows = rows.map(r => {
        const obj: Record<string, any> = {};
        report.columns.forEach(c => { obj[c.header] = fmtCell(r[c.dataKey]); });
        return obj;
      });
      if (action === 'excel') {
        exportToExcel(exportRows, report.name.replace(/\s+/g, '_'), report.name.slice(0, 31));
      } else {
        exportTablePdf({
          title: report.name,
          subtitle: `Period: ${startDate} to ${endDate}  •  ${rows.length} record(s)`,
          columns: report.columns.map(c => ({ header: c.header, dataKey: c.dataKey })),
          rows,
          filename: report.name.replace(/\s+/g, '_'),
          orientation: report.columns.length > 6 ? 'landscape' : 'portrait',
          deptLine: `${MODULE_LABELS[report.module]} — ERP System`,
        });
      }
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className="space-y-5 animate-fadeIn">
      <div className="flex flex-col md:flex-row md:items-center gap-3 justify-between">
        <DateRangeFilter value={dateRange} onChange={setDateRange} />
        <button
          onClick={loadAll}
          disabled={loadingAll}
          data-testid="all-reports-refresh"
          className="shrink-0 flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs px-3 py-2 rounded-xl transition-all disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loadingAll ? 'animate-spin' : ''}`} />
          {loadingAll ? 'Loading...' : 'Refresh Data'}
        </button>
      </div>

      <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
        <h3 className="font-extrabold text-slate-800 text-sm mb-1 flex items-center gap-2">
          <Users className="h-4 w-4 text-violet-600" />
          Employee Attendance Report
        </h3>
        <p className="text-xs text-slate-400 mb-4">
          Pick any employee and a weekly, monthly, or yearly period to see exactly which days they were present, absent, on leave, on medical, or deployed.
        </p>
        <EmployeeAttendanceReport
          employees={employees}
          employeePunches={employeePunches}
          leaves={hrLeaves}
          medicals={hrMedicals}
          siteDeployed={siteDeployed}
        />
      </div>

      <div className="flex gap-2 flex-wrap border-b border-slate-100 pb-3">
        {modules.map(m => (
          <button
            key={m}
            onClick={() => setActiveModule(m)}
            data-testid={`all-reports-module-${m}`}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
              activeModule === m ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {m === 'all' ? 'All Modules' : MODULE_LABELS[m]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {visibleReports.map(report => {
          const rowCount = report.getRows().length;
          return (
            <div key={report.id} className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all">
              <div className="flex items-start justify-between mb-2">
                <div className={`${COLOR_MAP[report.color]} rounded-xl p-2.5`}>
                  <report.icon className="h-4 w-4" />
                </div>
                <span className="text-[10px] font-mono bg-slate-100 text-slate-600 px-2 py-1 rounded">
                  {rowCount.toLocaleString()} rows
                </span>
              </div>
              <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">{MODULE_LABELS[report.module]}</div>
              <h3 className="font-extrabold text-slate-800 text-sm mt-0.5">{report.name}</h3>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => runReport(report, 'preview')}
                  disabled={loadingId === report.id}
                  data-testid={`all-report-preview-${report.id}`}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2 rounded-xl text-xs cursor-pointer transition-all disabled:opacity-50"
                >
                  Preview
                </button>
                <button
                  onClick={() => runReport(report, 'pdf')}
                  disabled={loadingId === report.id}
                  data-testid={`all-report-pdf-${report.id}`}
                  className="flex-1 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold py-2 rounded-xl text-xs cursor-pointer transition-all flex items-center justify-center gap-1 disabled:opacity-50"
                >
                  <Printer className="h-3 w-3" /> PDF
                </button>
                <button
                  onClick={() => runReport(report, 'excel')}
                  disabled={loadingId === report.id}
                  data-testid={`all-report-excel-${report.id}`}
                  className="flex-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold py-2 rounded-xl text-xs cursor-pointer transition-all flex items-center justify-center gap-1 disabled:opacity-50"
                >
                  <Download className="h-3 w-3" /> Excel
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Preview modal */}
      {preview && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-5xl w-full max-h-[80vh] overflow-auto">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center sticky top-0 bg-white rounded-t-2xl">
              <h3 className="font-extrabold text-slate-800 text-sm">{preview.name}</h3>
              <button onClick={() => setPreview(null)} className="text-slate-400 hover:text-slate-700 cursor-pointer">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-4 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100">
                    {preview.columns.map(col => (
                      <th key={col.dataKey} className="text-left p-2 text-slate-500 font-bold uppercase tracking-wider whitespace-nowrap">{col.header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, i) => (
                    <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                      {preview.columns.map(col => (
                        <td key={col.dataKey} className="p-2 text-slate-700 whitespace-nowrap">{fmtCell(row[col.dataKey])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AllReportsTab;
