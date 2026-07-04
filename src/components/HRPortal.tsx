import React, { useState, useMemo } from 'react';
import { Employee, EmployeePunch } from '../types';
import {
  Users, Clock, DollarSign, CalendarOff, AlertTriangle, BarChart2,
  Plus, Search, Trash2, Edit2, CheckCircle, XCircle, KeyRound,
  Filter, X, Save, FileText, ShieldAlert, Stethoscope
} from 'lucide-react';
import { ViewRole } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  leaveType: 'Annual' | 'Sick' | 'Unpaid' | 'Emergency';
  fromDate: string;
  toDate: string;
  days: number;
  reason: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  createdAt: string;
}

interface Warning {
  id: string;
  employeeId: string;
  employeeName: string;
  type: 'Verbal' | 'Written' | 'Final';
  reason: string;
  issuedAt: string;
  issuedBy: string;
}

interface PayrollRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  month: string; // YYYY-MM
  baseSalary: number;
  overtimeHours: number;
  overtimeRate: number;
  deductions: number;
  netSalary: number;
  status: 'Draft' | 'Paid';
  paidAt?: string;
}

interface AccidentReport {
  id: string;
  date: string;
  employeeId: string;
  employeeName: string;
  department: string;
  description: string;
  actionTaken: string;
  status: 'Open' | 'Under Investigation' | 'Closed';
  createdAt: string;
}

interface MedicalRecord {
  id: string;
  date: string;
  employeeId: string;
  employeeName: string;
  disease: string;
  notes: string;
  approvedBy: string;
  createdAt: string;
}

interface HRPortalProps {
  employees: Employee[];
  employeePunches: EmployeePunch[];
  onSaveEmployee: (emp: Employee) => void;
  onDeleteEmployee: (id: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const uid = () => `hr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

const daysBetween = (a: string, b: string) => {
  const diff = new Date(b).getTime() - new Date(a).getTime();
  return Math.max(1, Math.ceil(diff / 86400000) + 1);
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

const fmtCurrency = (n: number) =>
  new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', maximumFractionDigits: 0 }).format(n);

// ─── Sub-components ───────────────────────────────────────────────────────────

// Stat card
const StatCard = ({ icon, label, value, sub, color }: {
  icon: React.ReactNode; label: string; value: string | number; sub?: string; color: string;
}) => (
  <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-4 shadow-sm">
    <div className={`p-3 rounded-xl ${color}`}>{icon}</div>
    <div>
      <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-black text-slate-800">{value}</p>
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
    </div>
  </div>
);

// ─── Main Component ───────────────────────────────────────────────────────────

export const HRPortal: React.FC<HRPortalProps> = ({
  employees,
  employeePunches,
  onSaveEmployee,
  onDeleteEmployee,
}) => {
  const [activeTab, setActiveTab] = useState<'directory' | 'attendance' | 'payroll' | 'leave' | 'warnings' | 'accidents' | 'medical' | 'reports'>('directory');

  // ── Leave state (localStorage-backed) ──
  const [leaves, setLeaves] = useState<LeaveRequest[]>(() => {
    try { return JSON.parse(localStorage.getItem('hr_leaves') || '[]'); } catch { return []; }
  });
  const saveLeaves = (l: LeaveRequest[]) => { setLeaves(l); localStorage.setItem('hr_leaves', JSON.stringify(l)); };

  // ── Warnings state ──
  const [warnings, setWarnings] = useState<Warning[]>(() => {
    try { return JSON.parse(localStorage.getItem('hr_warnings') || '[]'); } catch { return []; }
  });
  const saveWarnings = (w: Warning[]) => { setWarnings(w); localStorage.setItem('hr_warnings', JSON.stringify(w)); };

  // ── Payroll state ──
  const [payroll, setPayroll] = useState<PayrollRecord[]>(() => {
    try { return JSON.parse(localStorage.getItem('hr_payroll') || '[]'); } catch { return []; }
  });
  const savePayroll = (p: PayrollRecord[]) => { setPayroll(p); localStorage.setItem('hr_payroll', JSON.stringify(p)); };

  // ── Accident state ──
  const [accidents, setAccidents] = useState<AccidentReport[]>(() => {
    try { return JSON.parse(localStorage.getItem('hr_accidents') || '[]'); } catch { return []; }
  });
  const saveAccidents = (a: AccidentReport[]) => { setAccidents(a); localStorage.setItem('hr_accidents', JSON.stringify(a)); };

  // ── Medical state ──
  const [medicals, setMedicals] = useState<MedicalRecord[]>(() => {
    try { return JSON.parse(localStorage.getItem('hr_medicals') || '[]'); } catch { return []; }
  });
  const saveMedicals = (m: MedicalRecord[]) => { setMedicals(m); localStorage.setItem('hr_medicals', JSON.stringify(m)); };

  // ─────────────────────────────────────────────────────────────────────────────
  // DIRECTORY TAB
  // ─────────────────────────────────────────────────────────────────────────────
  const DirectoryTab = () => {
    const [search, setSearch] = useState('');
    const [deptFilter, setDeptFilter] = useState('All');
    const [editEmp, setEditEmp] = useState<Partial<Employee> | null>(null);
    const [showForm, setShowForm] = useState(false);

    const departments = useMemo(() => ['All', ...Array.from(new Set(employees.map(e => e.department)))], [employees]);

    const filtered = useMemo(() => employees.filter(e => {
      const matchSearch = e.name.toLowerCase().includes(search.toLowerCase()) ||
        (e.role || '').toLowerCase().includes(search.toLowerCase());
      const matchDept = deptFilter === 'All' || e.department === deptFilter;
      return matchSearch && matchDept;
    }), [employees, search, deptFilter]);

    const handleSave = () => {
      if (!editEmp?.name || !editEmp?.department) return;
      if (!editEmp.pin || !/^\d{4}$/.test(editEmp.pin)) {
        alert('Please enter a 4-digit numeric PIN for the employee.');
        return;
      }

      onSaveEmployee({
        id: editEmp.id || uid(),
        name: editEmp.name,
        department: editEmp.department,
        role: editEmp.role || null,
        email: editEmp.email || null,
        phone: editEmp.phone || null,
        notes: editEmp.notes || null,
        createdAt: editEmp.createdAt || new Date().toISOString(),
        viewRole: editEmp.viewRole || 'stage_worker',
        pin: editEmp.pin,
      });
      setShowForm(false);
      setEditEmp(null);
    };

    return (
      <div className="space-y-4">
        {/* Toolbar */}
        <div className="flex flex-wrap gap-3 items-center justify-between">
          <div className="flex gap-2 flex-1 min-w-0">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                placeholder="Search name or role..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <select
              value={deptFilter}
              onChange={e => setDeptFilter(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white"
            >
              {departments.map(d => <option key={d}>{d}</option>)}
            </select>
          </div>
          <button
            onClick={() => { setEditEmp({ viewRole: 'stage_worker', pin: '' }); setShowForm(true); }}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold px-4 py-2 rounded-lg transition-colors"
          >
            <Plus className="h-4 w-4" /> Add Employee
          </button>
        </div>

        {/* Employee Form Modal */}
        {showForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-black text-slate-800">{editEmp?.id ? 'Edit Employee' : 'Register Employee'}</h3>
                <button onClick={() => { setShowForm(false); setEditEmp(null); }}>
                  <X className="h-5 w-5 text-slate-400 hover:text-slate-600" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Full Name *', key: 'name', type: 'text' },
                  { label: 'Department *', key: 'department', type: 'text' },
                  { label: 'Job Role', key: 'role', type: 'text' },
                  { label: 'Email', key: 'email', type: 'email' },
                  { label: 'Phone', key: 'phone', type: 'tel' },
                ].map(f => (
                  <div key={f.key} className={f.key === 'name' ? 'col-span-2' : ''}>
                    <label className="text-xs font-semibold text-slate-500 block mb-1">{f.label}</label>
                    <input
                      type={f.type}
                      value={(editEmp as any)?.[f.key] || ''}
                      onChange={e => setEditEmp(prev => ({ ...prev, [f.key]: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                    />
                  </div>
                ))}
                <div className="col-span-2 grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-500 block mb-1">Portal Access Role *</label>
                    <select
                      value={editEmp?.viewRole || 'stage_worker'}
                      onChange={e => setEditEmp(prev => ({ ...prev, viewRole: e.target.value as ViewRole }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white"
                    >
                      <option value="stage_worker">Stage Worker</option>
                      <option value="quality_inspector">Quality Inspector</option>
                      <option value="production_engineer">Production Engineer</option>
                      <option value="planning_department">Planning Department</option>
                      <option value="hr_portal">HR Portal</option>
                      <option value="trolley_prod">Trolley Production</option>
                      <option value="store">Store & Inventory</option>
                      <option value="management">Management</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-500 block mb-1">4-Digit PIN *</label>
                    <div className="relative">
                      <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                      <input
                        type="text"
                        required
                        value={editEmp?.pin || ''}
                        onChange={e => setEditEmp(prev => ({ ...prev, pin: e.target.value.replace(/\D/g, '') }))}
                        placeholder="e.g., 1234"
                        maxLength={4}
                        className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 font-mono"
                      />
                    </div>
                  </div>
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-semibold text-slate-500 block mb-1">Notes</label>
                  <textarea
                    rows={2}
                    value={editEmp?.notes || ''}
                    onChange={e => setEditEmp(prev => ({ ...prev, notes: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
                  />
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleSave}
                  className="flex-1 bg-violet-600 hover:bg-violet-700 text-white font-bold py-2 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
                >
                  <Save className="h-4 w-4" /> Save
                </button>
                <button
                  onClick={() => { setShowForm(false); setEditEmp(null); }}
                  className="px-4 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {['Name', 'Department', 'Role', 'Contact', 'Joined', 'Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-12 text-slate-400 text-sm">No employees found</td></tr>
              ) : filtered.map(emp => (
                <tr key={emp.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-full bg-violet-100 text-violet-700 font-black text-xs flex items-center justify-center shrink-0">
                        {emp.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-semibold text-slate-800">{emp.name}</p>
                        {emp.notes && <p className="text-xs text-slate-400 truncate max-w-[140px]">{emp.notes}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="bg-violet-50 text-violet-700 text-xs font-bold px-2 py-0.5 rounded-full">{emp.department}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{emp.role || '—'}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    <div>{emp.email || '—'}</div>
                    <div>{emp.phone || '—'}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{fmtDate(emp.createdAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <button
                        onClick={() => { setEditEmp(emp); setShowForm(true); }}
                        className="p-1.5 text-slate-400 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-colors"
                      ><Edit2 className="h-4 w-4" /></button>
                      <button
                        onClick={() => { if (window.confirm(`Delete ${emp.name}?`)) onDeleteEmployee(emp.id); }}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                      ><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-400">{filtered.length} of {employees.length} employees</p>
      </div>
    );
  };

  // ... (The rest of the component remains the same)
