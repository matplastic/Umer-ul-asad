import React, { useState, useMemo, useEffect } from 'react';
import { Employee, EmployeePunch, ViewRole } from '../types';
import {
  Users, Clock, DollarSign, CalendarOff, AlertTriangle, BarChart2,
  Plus, Search, Trash2, Edit2, CheckCircle, XCircle,
  Filter, X, Save, FileText, ShieldAlert, Stethoscope,
  KeyRound, Copy, RefreshCw, UserCog, EyeOff, Eye
} from 'lucide-react';
import {
  listUserAccounts, createUserAccount, updateUserAccount,
  resetUserPassword, deactivateUserAccount, type AuthUser
} from '../lib/authClient';

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
  currentUserName?: string;
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
  currentUserName,
}) => {
  const [activeTab, setActiveTab] = useState<'directory' | 'attendance' | 'payroll' | 'leave' | 'warnings' | 'accidents' | 'medical' | 'reports' | 'accounts'>('directory');

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

    const departments = useMemo(() => ['All', ...Array.from(new Set(employees.map(e => e.department)))], []);

    const filtered = useMemo(() => employees.filter(e => {
      const matchSearch = e.name.toLowerCase().includes(search.toLowerCase()) ||
        (e.role || '').toLowerCase().includes(search.toLowerCase());
      const matchDept = deptFilter === 'All' || e.department === deptFilter;
      return matchSearch && matchDept;
    }), [search, deptFilter]);

    const handleSave = () => {
      if (!editEmp?.name || !editEmp?.department) return;
      onSaveEmployee({
        id: editEmp.id || uid(),
        name: editEmp.name,
        department: editEmp.department,
        role: editEmp.role || null,
        email: editEmp.email || null,
        phone: editEmp.phone || null,
        notes: editEmp.notes || null,
        createdAt: editEmp.createdAt || new Date().toISOString(),
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
            onClick={() => { setEditEmp({}); setShowForm(true); }}
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

  // ─────────────────────────────────────────────────────────────────────────────
  // ATTENDANCE TAB
  // ─────────────────────────────────────────────────────────────────────────────
  const AttendanceTab = () => {
    const [dateFilter, setDateFilter] = useState(new Date().toISOString().slice(0, 10));
    const [empFilter, setEmpFilter] = useState('All');

    const empNames = useMemo(() => ['All', ...Array.from(new Set(employeePunches.map(p => p.employeeName)))], []);

    const dayPunches = useMemo(() => employeePunches.filter(p => {
      const matchDate = p.date === dateFilter;
      const matchEmp = empFilter === 'All' || p.employeeName === empFilter;
      return matchDate && matchEmp;
    }).sort((a, b) => a.timestamp.localeCompare(b.timestamp)), [dateFilter, empFilter]);

    // Compute attendance summary per employee for this day
    const summary = useMemo(() => {
      const map: Record<string, { name: string; inTime?: string; outTime?: string; status: string }> = {};
      dayPunches.forEach(p => {
        if (!map[p.employeeId]) map[p.employeeId] = { name: p.employeeName, status: 'Absent' };
        if (p.punchType === 'IN') { map[p.employeeId].inTime = p.timestamp; map[p.employeeId].status = 'Present'; }
        if (p.punchType === 'OUT') { map[p.employeeId].outTime = p.timestamp; }
      });
      return Object.values(map);
    }, [dayPunches]);

    const totalPresent = summary.filter(s => s.status === 'Present').length;
    const totalAbsent = employees.length - totalPresent;

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-3 items-center">
          <input
            type="date"
            value={dateFilter}
            onChange={e => setDateFilter(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
          <select
            value={empFilter}
            onChange={e => setEmpFilter(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white"
          >
            {empNames.map(n => <option key={n}>{n}</option>)}
          </select>
          <div className="flex gap-3 ml-auto">
            <span className="bg-emerald-50 text-emerald-700 text-xs font-bold px-3 py-1.5 rounded-full border border-emerald-200">
              ✓ Present: {totalPresent}
            </span>
            <span className="bg-rose-50 text-rose-700 text-xs font-bold px-3 py-1.5 rounded-full border border-rose-200">
              ✗ Absent: {totalAbsent}
            </span>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {['Employee', 'Time In', 'Time Out', 'Hours', 'Status'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {summary.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-12 text-slate-400 text-sm">No punch records for this date</td></tr>
              ) : summary.map((s, i) => {
                const hours = s.inTime && s.outTime
                  ? ((new Date(s.outTime).getTime() - new Date(s.inTime).getTime()) / 3600000).toFixed(1)
                  : '—';
                return (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-semibold text-slate-800">{s.name}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {s.inTime ? new Date(s.inTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {s.outTime ? new Date(s.outTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{hours !== '—' ? `${hours}h` : '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                        s.status === 'Present' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
                      }`}>{s.status}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // PAYROLL TAB
  // ─────────────────────────────────────────────────────────────────────────────
  const PayrollTab = () => {
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState<Partial<PayrollRecord>>({});
    const [monthFilter, setMonthFilter] = useState(new Date().toISOString().slice(0, 7));

    const filtered = payroll.filter(p => p.month === monthFilter);
    const totalNet = filtered.reduce((s, p) => s + p.netSalary, 0);
    const paidCount = filtered.filter(p => p.status === 'Paid').length;

    const handleSave = () => {
      if (!form.employeeId || !form.baseSalary) return;
      const emp = employees.find(e => e.id === form.employeeId);
      const overtime = (form.overtimeHours || 0) * (form.overtimeRate || 0);
      const net = (form.baseSalary || 0) + overtime - (form.deductions || 0);
      const record: PayrollRecord = {
        id: form.id || uid(),
        employeeId: form.employeeId,
        employeeName: emp?.name || '',
        month: monthFilter,
        baseSalary: form.baseSalary || 0,
        overtimeHours: form.overtimeHours || 0,
        overtimeRate: form.overtimeRate || 0,
        deductions: form.deductions || 0,
        netSalary: net,
        status: 'Draft',
      };
      const existing = payroll.findIndex(p => p.id === record.id);
      const updated = existing >= 0
        ? payroll.map((p, i) => i === existing ? record : p)
        : [record, ...payroll];
      savePayroll(updated);
      setShowForm(false);
      setForm({});
    };

    const markPaid = (id: string) => {
      savePayroll(payroll.map(p => p.id === id ? { ...p, status: 'Paid', paidAt: new Date().toISOString() } : p));
    };

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-3 items-center justify-between">
          <div className="flex gap-2 items-center">
            <input
              type="month"
              value={monthFilter}
              onChange={e => setMonthFilter(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            <div className="flex gap-2">
              <span className="bg-slate-100 text-slate-700 text-xs font-bold px-3 py-1.5 rounded-full">Total: {fmtCurrency(totalNet)}</span>
              <span className="bg-emerald-50 text-emerald-700 text-xs font-bold px-3 py-1.5 rounded-full border border-emerald-200">Paid: {paidCount}/{filtered.length}</span>
            </div>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold px-4 py-2 rounded-lg"
          >
            <Plus className="h-4 w-4" /> Add Payroll Entry
          </button>
        </div>

        {showForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-black text-slate-800">Payroll Entry</h3>
                <button onClick={() => { setShowForm(false); setForm({}); }}><X className="h-5 w-5 text-slate-400" /></button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold text-slate-500 block mb-1">Employee *</label>
                  <select
                    value={form.employeeId || ''}
                    onChange={e => setForm(p => ({ ...p, employeeId: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white"
                  >
                    <option value="">Select employee...</option>
                    {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </div>
                {[
                  { label: 'Base Salary (AED) *', key: 'baseSalary' },
                  { label: 'Overtime Hours', key: 'overtimeHours' },
                  { label: 'Overtime Rate (AED/hr)', key: 'overtimeRate' },
                  { label: 'Deductions (AED)', key: 'deductions' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="text-xs font-semibold text-slate-500 block mb-1">{f.label}</label>
                    <input
                      type="number"
                      value={(form as any)[f.key] || ''}
                      onChange={e => setForm(p => ({ ...p, [f.key]: parseFloat(e.target.value) || 0 }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                    />
                  </div>
                ))}
                <div className="bg-violet-50 rounded-lg p-3 text-sm font-bold text-violet-800">
                  Net Salary: {fmtCurrency(
                    (form.baseSalary || 0) +
                    (form.overtimeHours || 0) * (form.overtimeRate || 0) -
                    (form.deductions || 0)
                  )}
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={handleSave} className="flex-1 bg-violet-600 hover:bg-violet-700 text-white font-bold py-2 rounded-lg text-sm flex items-center justify-center gap-2">
                  <Save className="h-4 w-4" /> Save
                </button>
                <button onClick={() => { setShowForm(false); setForm({}); }} className="px-4 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {['Employee', 'Base Salary', 'Overtime', 'Deductions', 'Net Salary', 'Status', 'Action'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-slate-400 text-sm">No payroll entries for this month</td></tr>
              ) : filtered.map(p => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-semibold text-slate-800">{p.employeeName}</td>
                  <td className="px-4 py-3 text-slate-600">{fmtCurrency(p.baseSalary)}</td>
                  <td className="px-4 py-3 text-slate-600">{p.overtimeHours}h × {fmtCurrency(p.overtimeRate)}</td>
                  <td className="px-4 py-3 text-rose-600">−{fmtCurrency(p.deductions)}</td>
                  <td className="px-4 py-3 font-bold text-slate-800">{fmtCurrency(p.netSalary)}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                      p.status === 'Paid' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'
                    }`}>{p.status}</span>
                  </td>
                  <td className="px-4 py-3">
                    {p.status === 'Draft' && (
                      <button
                        onClick={() => markPaid(p.id)}
                        className="text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-1 rounded-lg flex items-center gap-1 transition-colors"
                      >
                        <CheckCircle className="h-3 w-3" /> Mark Paid
                      </button>
                    )}
                    {p.status === 'Paid' && <span className="text-xs text-slate-400">{p.paidAt ? fmtDate(p.paidAt) : ''}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // LEAVE TAB
  // ─────────────────────────────────────────────────────────────────────────────
  const LeaveTab = () => {
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState<Partial<LeaveRequest>>({ leaveType: 'Annual' });
    const [statusFilter, setStatusFilter] = useState<'All' | 'Pending' | 'Approved' | 'Rejected'>('All');

    const filtered = leaves.filter(l => statusFilter === 'All' || l.status === statusFilter);

    const handleSubmit = () => {
      if (!form.employeeId || !form.fromDate || !form.toDate) return;
      const emp = employees.find(e => e.id === form.employeeId);
      const record: LeaveRequest = {
        id: uid(),
        employeeId: form.employeeId,
        employeeName: emp?.name || '',
        leaveType: form.leaveType as LeaveRequest['leaveType'] || 'Annual',
        fromDate: form.fromDate,
        toDate: form.toDate,
        days: daysBetween(form.fromDate, form.toDate),
        reason: form.reason || '',
        status: 'Pending',
        createdAt: new Date().toISOString(),
      };
      saveLeaves([record, ...leaves]);
      setShowForm(false);
      setForm({ leaveType: 'Annual' });
    };

    const updateStatus = (id: string, status: 'Approved' | 'Rejected') => {
      saveLeaves(leaves.map(l => l.id === id ? { ...l, status } : l));
    };

    const pending = leaves.filter(l => l.status === 'Pending').length;
    const approved = leaves.filter(l => l.status === 'Approved').length;

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-3 items-center justify-between">
          <div className="flex gap-2">
            {(['All', 'Pending', 'Approved', 'Rejected'] as const).map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`text-xs font-bold px-3 py-1.5 rounded-full border transition-colors ${
                  statusFilter === s ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-600 border-slate-200 hover:border-violet-400'
                }`}
              >{s} {s === 'Pending' && pending > 0 ? `(${pending})` : ''}</button>
            ))}
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold px-4 py-2 rounded-lg"
          >
            <Plus className="h-4 w-4" /> New Leave Request
          </button>
        </div>

        {showForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-black text-slate-800">New Leave Request</h3>
                <button onClick={() => setShowForm(false)}><X className="h-5 w-5 text-slate-400" /></button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold text-slate-500 block mb-1">Employee *</label>
                  <select
                    value={form.employeeId || ''}
                    onChange={e => setForm(p => ({ ...p, employeeId: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white"
                  >
                    <option value="">Select employee...</option>
                    {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 block mb-1">Leave Type</label>
                  <select
                    value={form.leaveType}
                    onChange={e => setForm(p => ({ ...p, leaveType: e.target.value as LeaveRequest['leaveType'] }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white"
                  >
                    {['Annual', 'Sick', 'Unpaid', 'Emergency'].map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-500 block mb-1">From Date *</label>
                    <input type="date" value={form.fromDate || ''} onChange={e => setForm(p => ({ ...p, fromDate: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-500 block mb-1">To Date *</label>
                    <input type="date" value={form.toDate || ''} onChange={e => setForm(p => ({ ...p, toDate: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
                  </div>
                </div>
                {form.fromDate && form.toDate && (
                  <div className="bg-violet-50 rounded-lg px-3 py-2 text-sm font-bold text-violet-700">
                    Duration: {daysBetween(form.fromDate, form.toDate)} day(s)
                  </div>
                )}
                <div>
                  <label className="text-xs font-semibold text-slate-500 block mb-1">Reason</label>
                  <textarea rows={2} value={form.reason || ''} onChange={e => setForm(p => ({ ...p, reason: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none" />
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={handleSubmit} className="flex-1 bg-violet-600 hover:bg-violet-700 text-white font-bold py-2 rounded-lg text-sm flex items-center justify-center gap-2">
                  <Save className="h-4 w-4" /> Submit
                </button>
                <button onClick={() => setShowForm(false)} className="px-4 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {['Employee', 'Type', 'Period', 'Days', 'Reason', 'Status', 'Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-slate-400 text-sm">No leave requests found</td></tr>
              ) : filtered.map(l => (
                <tr key={l.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-semibold text-slate-800">{l.employeeName}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                      l.leaveType === 'Annual' ? 'bg-blue-50 text-blue-700' :
                      l.leaveType === 'Sick' ? 'bg-orange-50 text-orange-700' :
                      l.leaveType === 'Emergency' ? 'bg-red-50 text-red-700' :
                      'bg-slate-100 text-slate-600'
                    }`}>{l.leaveType}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-600 text-xs">{fmtDate(l.fromDate)} – {fmtDate(l.toDate)}</td>
                  <td className="px-4 py-3 font-bold text-slate-700">{l.days}d</td>
                  <td className="px-4 py-3 text-slate-500 max-w-[160px] truncate">{l.reason || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                      l.status === 'Approved' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                      l.status === 'Rejected' ? 'bg-rose-50 text-rose-700 border border-rose-200' :
                      'bg-amber-50 text-amber-700 border border-amber-200'
                    }`}>{l.status}</span>
                  </td>
                  <td className="px-4 py-3">
                    {l.status === 'Pending' && (
                      <div className="flex gap-1">
                        <button onClick={() => updateStatus(l.id, 'Approved')}
                          className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors" title="Approve">
                          <CheckCircle className="h-4 w-4" />
                        </button>
                        <button onClick={() => updateStatus(l.id, 'Rejected')}
                          className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors" title="Reject">
                          <XCircle className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // WARNINGS TAB
  // ─────────────────────────────────────────────────────────────────────────────
  const WarningsTab = () => {
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState<Partial<Warning>>({ type: 'Verbal' });

    const handleSave = () => {
      if (!form.employeeId || !form.reason || !form.issuedBy) return;
      const emp = employees.find(e => e.id === form.employeeId);
      const record: Warning = {
        id: uid(),
        employeeId: form.employeeId,
        employeeName: emp?.name || '',
        type: form.type as Warning['type'] || 'Verbal',
        reason: form.reason,
        issuedAt: new Date().toISOString(),
        issuedBy: form.issuedBy,
      };
      saveWarnings([record, ...warnings]);
      setShowForm(false);
      setForm({ type: 'Verbal' });
    };

    const byType = (t: Warning['type']) => warnings.filter(w => w.type === t).length;

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-3 items-center justify-between">
          <div className="flex gap-2">
            {(['Verbal', 'Written', 'Final'] as const).map(t => (
              <span key={t} className={`text-xs font-bold px-3 py-1.5 rounded-full border ${
                t === 'Final' ? 'bg-rose-50 text-rose-700 border-rose-200' :
                t === 'Written' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                'bg-slate-100 text-slate-700 border-slate-200'
              }`}>{t}: {byType(t)}</span>
            ))}
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold px-4 py-2 rounded-lg"
          >
            <AlertTriangle className="h-4 w-4" /> Issue Warning
          </button>
        </div>

        {showForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-black text-slate-800">Issue Warning</h3>
                <button onClick={() => setShowForm(false)}><X className="h-5 w-5 text-slate-400" /></button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold text-slate-500 block mb-1">Employee *</label>
                  <select
                    value={form.employeeId || ''}
                    onChange={e => setForm(p => ({ ...p, employeeId: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500 bg-white"
                  >
                    <option value="">Select employee...</option>
                    {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 block mb-1">Warning Type</label>
                  <select
                    value={form.type}
                    onChange={e => setForm(p => ({ ...p, type: e.target.value as Warning['type'] }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500 bg-white"
                  >
                    {['Verbal', 'Written', 'Final'].map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 block mb-1">Reason *</label>
                  <textarea rows={3} value={form.reason || ''} onChange={e => setForm(p => ({ ...p, reason: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500 resize-none" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 block mb-1">Issued By *</label>
                  <input type="text" value={form.issuedBy || ''} onChange={e => setForm(p => ({ ...p, issuedBy: e.target.value }))}
                    placeholder="HR Manager / Supervisor name"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500" />
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={handleSave} className="flex-1 bg-rose-600 hover:bg-rose-700 text-white font-bold py-2 rounded-lg text-sm flex items-center justify-center gap-2">
                  <AlertTriangle className="h-4 w-4" /> Issue Warning
                </button>
                <button onClick={() => setShowForm(false)} className="px-4 py-2 border border-slate-200 rounded-lg text-sm text-slate-600">Cancel</button>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {['Employee', 'Type', 'Reason', 'Issued By', 'Date', 'Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {warnings.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-12 text-slate-400 text-sm">No warnings issued</td></tr>
              ) : warnings.map(w => (
                <tr key={w.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-semibold text-slate-800">{w.employeeName}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                      w.type === 'Final' ? 'bg-rose-50 text-rose-700 border border-rose-200' :
                      w.type === 'Written' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                      'bg-slate-100 text-slate-600'
                    }`}>{w.type}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 max-w-[200px] truncate">{w.reason}</td>
                  <td className="px-4 py-3 text-slate-600">{w.issuedBy}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{fmtDate(w.issuedAt)}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => { if (window.confirm('Delete this warning?')) saveWarnings(warnings.filter(x => x.id !== w.id)); }}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg"
                    ><Trash2 className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // REPORTS TAB
  // ─────────────────────────────────────────────────────────────────────────────
  const ReportsTab = () => {
    const deptCounts = useMemo(() => {
      const map: Record<string, number> = {};
      employees.forEach(e => { map[e.department] = (map[e.department] || 0) + 1; });
      return Object.entries(map).sort((a, b) => b[1] - a[1]);
    }, []);

    const todayStr = new Date().toISOString().slice(0, 10);
    const todayPunches = employeePunches.filter(p => p.date === todayStr);
    const todayPresent = new Set(todayPunches.filter(p => p.punchType === 'IN').map(p => p.employeeId)).size;

    const pendingLeaves = leaves.filter(l => l.status === 'Pending').length;
    const approvedLeaves = leaves.filter(l => l.status === 'Approved').length;

    const currentMonth = new Date().toISOString().slice(0, 7);
    const monthPayroll = payroll.filter(p => p.month === currentMonth);
    const totalPayroll = monthPayroll.reduce((s, p) => s + p.netSalary, 0);

    const empWarnings: Record<string, number> = {};
    warnings.forEach(w => { empWarnings[w.employeeName] = (empWarnings[w.employeeName] || 0) + 1; });
    const topWarned = Object.entries(empWarnings).sort((a, b) => b[1] - a[1]).slice(0, 5);

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon={<Users className="h-5 w-5 text-violet-600" />} label="Total Staff" value={employees.length} color="bg-violet-50" />
          <StatCard icon={<Clock className="h-5 w-5 text-emerald-600" />} label="Present Today" value={todayPresent} sub={`${employees.length - todayPresent} absent`} color="bg-emerald-50" />
          <StatCard icon={<CalendarOff className="h-5 w-5 text-amber-600" />} label="Pending Leaves" value={pendingLeaves} sub={`${approvedLeaves} approved`} color="bg-amber-50" />
          <StatCard icon={<DollarSign className="h-5 w-5 text-blue-600" />} label="Monthly Payroll" value={fmtCurrency(totalPayroll)} sub={`${monthPayroll.length} entries`} color="bg-blue-50" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Dept breakdown */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <h3 className="font-black text-slate-700 text-sm uppercase tracking-wider mb-4">Headcount by Department</h3>
            <div className="space-y-3">
              {deptCounts.map(([dept, count]) => (
                <div key={dept}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium text-slate-700">{dept}</span>
                    <span className="font-bold text-slate-600">{count}</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-violet-500 rounded-full"
                      style={{ width: `${(count / employees.length) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Warnings summary */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <h3 className="font-black text-slate-700 text-sm uppercase tracking-wider mb-4">Warning Summary</h3>
            {topWarned.length === 0 ? (
              <p className="text-slate-400 text-sm py-6 text-center">No warnings issued yet</p>
            ) : (
              <div className="space-y-3">
                {topWarned.map(([name, count]) => (
                  <div key={name} className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700">{name}</span>
                    <div className="flex gap-1">
                      {Array.from({ length: count }).map((_, i) => (
                        <AlertTriangle key={i} className="h-4 w-4 text-amber-500" />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-3 gap-2 text-center">
              {(['Verbal', 'Written', 'Final'] as const).map(t => (
                <div key={t} className={`rounded-lg py-2 ${
                  t === 'Final' ? 'bg-rose-50' : t === 'Written' ? 'bg-amber-50' : 'bg-slate-50'
                }`}>
                  <p className="text-lg font-black text-slate-800">{warnings.filter(w => w.type === t).length}</p>
                  <p className="text-[10px] text-slate-500 font-semibold uppercase">{t}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────────────────
  // ACCIDENTS TAB
  // ─────────────────────────────────────────────────────────────────────────────
  const AccidentsTab = () => {
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState<Partial<AccidentReport>>({ status: 'Open', date: new Date().toISOString().slice(0, 10) });
    const [statusFilter, setStatusFilter] = useState<'All' | 'Open' | 'Under Investigation' | 'Closed'>('All');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');

    const filtered = accidents.filter(a => {
      const matchStatus = statusFilter === 'All' || a.status === statusFilter;
      const matchFrom = !dateFrom || a.date >= dateFrom;
      const matchTo = !dateTo || a.date <= dateTo;
      return matchStatus && matchFrom && matchTo;
    }).sort((a, b) => b.date.localeCompare(a.date));

    const handleSave = () => {
      if (!form.employeeId || !form.description || !form.date) return;
      const emp = employees.find(e => e.id === form.employeeId);
      const record: AccidentReport = {
        id: uid(),
        date: form.date,
        employeeId: form.employeeId,
        employeeName: emp?.name || '',
        department: emp?.department || form.department || '',
        description: form.description,
        actionTaken: form.actionTaken || '',
        status: form.status as AccidentReport['status'] || 'Open',
        createdAt: new Date().toISOString(),
      };
      saveAccidents([record, ...accidents]);
      setShowForm(false);
      setForm({ status: 'Open', date: new Date().toISOString().slice(0, 10) });
    };

    const updateStatus = (id: string, status: AccidentReport['status']) => {
      saveAccidents(accidents.map(a => a.id === id ? { ...a, status } : a));
    };

    const openCount = accidents.filter(a => a.status === 'Open').length;

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-3 items-center justify-between">
          <div className="flex flex-wrap gap-2 items-center">
            {(['All', 'Open', 'Under Investigation', 'Closed'] as const).map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`text-xs font-bold px-3 py-1.5 rounded-full border transition-colors ${
                  statusFilter === s ? 'bg-rose-600 text-white border-rose-600' : 'bg-white text-slate-600 border-slate-200 hover:border-rose-400'
                }`}>
                {s} {s === 'Open' && openCount > 0 ? `(${openCount})` : ''}
              </button>
            ))}
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-rose-400" placeholder="From" />
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-rose-400" placeholder="To" />
          </div>
          <button onClick={() => setShowForm(true)}
            className="flex items-center gap-2 bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold px-4 py-2 rounded-lg transition-colors">
            <Plus className="h-4 w-4" /> Report Accident
          </button>
        </div>

        {showForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-black text-slate-800 flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-rose-600" /> Accident Report</h3>
                <button onClick={() => setShowForm(false)}><X className="h-5 w-5 text-slate-400" /></button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-500 block mb-1">Incident Date *</label>
                  <input type="date" value={form.date || ''} onChange={e => setForm(p => ({ ...p, date: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 block mb-1">Employee *</label>
                  <select value={form.employeeId || ''} onChange={e => setForm(p => ({ ...p, employeeId: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500 bg-white">
                    <option value="">Select...</option>
                    {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-semibold text-slate-500 block mb-1">Accident Description *</label>
                  <textarea rows={3} value={form.description || ''} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                    placeholder="Describe what happened, where, and how..."
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500 resize-none" />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-semibold text-slate-500 block mb-1">Action Taken</label>
                  <textarea rows={2} value={form.actionTaken || ''} onChange={e => setForm(p => ({ ...p, actionTaken: e.target.value }))}
                    placeholder="First aid, hospital visit, investigation started..."
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500 resize-none" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 block mb-1">Status</label>
                  <select value={form.status || 'Open'} onChange={e => setForm(p => ({ ...p, status: e.target.value as AccidentReport['status'] }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500 bg-white">
                    {['Open', 'Under Investigation', 'Closed'].map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={handleSave} className="flex-1 bg-rose-600 hover:bg-rose-700 text-white font-bold py-2 rounded-lg text-sm flex items-center justify-center gap-2">
                  <Save className="h-4 w-4" /> Submit Report
                </button>
                <button onClick={() => setShowForm(false)} className="px-4 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {['Date', 'Employee', 'Department', 'Description', 'Action Taken', 'Status', 'Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-slate-400 text-sm">No accident reports found</td></tr>
              ) : filtered.map(a => (
                <tr key={a.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-600 text-xs font-mono whitespace-nowrap">{fmtDate(a.date)}</td>
                  <td className="px-4 py-3 font-semibold text-slate-800">{a.employeeName}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{a.department}</td>
                  <td className="px-4 py-3 text-slate-600 max-w-[180px] truncate text-xs">{a.description}</td>
                  <td className="px-4 py-3 text-slate-500 max-w-[140px] truncate text-xs">{a.actionTaken || '—'}</td>
                  <td className="px-4 py-3">
                    <select value={a.status} onChange={e => updateStatus(a.id, e.target.value as AccidentReport['status'])}
                      className={`text-xs font-bold px-2 py-0.5 rounded-full border bg-white focus:outline-none ${
                        a.status === 'Closed' ? 'text-emerald-700 border-emerald-200' :
                        a.status === 'Under Investigation' ? 'text-amber-700 border-amber-200' :
                        'text-rose-700 border-rose-200'
                      }`}>
                      {['Open', 'Under Investigation', 'Closed'].map(s => <option key={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => { if (window.confirm('Delete this report?')) saveAccidents(accidents.filter(x => x.id !== a.id)); }}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // MEDICAL FORMS TAB
  // ─────────────────────────────────────────────────────────────────────────────
  const MedicalTab = () => {
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState<Partial<MedicalRecord>>({ date: new Date().toISOString().slice(0, 10) });
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [search, setSearch] = useState('');

    const filtered = medicals.filter(m => {
      const matchSearch = m.employeeName.toLowerCase().includes(search.toLowerCase()) ||
        m.disease.toLowerCase().includes(search.toLowerCase());
      const matchFrom = !dateFrom || m.date >= dateFrom;
      const matchTo = !dateTo || m.date <= dateTo;
      return matchSearch && matchFrom && matchTo;
    }).sort((a, b) => b.date.localeCompare(a.date));

    const handleSave = () => {
      if (!form.employeeId || !form.disease) return;
      const emp = employees.find(e => e.id === form.employeeId);
      const record: MedicalRecord = {
        id: uid(),
        date: form.date || new Date().toISOString().slice(0, 10),
        employeeId: form.employeeId,
        employeeName: emp?.name || '',
        disease: form.disease,
        notes: form.notes || '',
        approvedBy: form.approvedBy || '',
        createdAt: new Date().toISOString(),
      };
      saveMedicals([record, ...medicals]);
      setShowForm(false);
      setForm({ date: new Date().toISOString().slice(0, 10) });
    };

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-3 items-center justify-between">
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or disease..."
                className="pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-teal-400 w-44" />
            </div>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-teal-400" />
            <span className="text-xs text-slate-400">to</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-teal-400" />
          </div>
          <button onClick={() => setShowForm(true)}
            className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-bold px-4 py-2 rounded-lg transition-colors">
            <Plus className="h-4 w-4" /> Add Medical Form
          </button>
        </div>

        {showForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-black text-slate-800 flex items-center gap-2"><Stethoscope className="h-5 w-5 text-teal-600" /> Medical Form</h3>
                <button onClick={() => setShowForm(false)}><X className="h-5 w-5 text-slate-400" /></button>
              </div>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-500 block mb-1">Date</label>
                    <input type="date" value={form.date || ''} onChange={e => setForm(p => ({ ...p, date: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-500 block mb-1">Employee *</label>
                    <select value={form.employeeId || ''} onChange={e => setForm(p => ({ ...p, employeeId: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white">
                      <option value="">Select...</option>
                      {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 block mb-1">Disease / Medical Condition *</label>
                  <input type="text" value={form.disease || ''} onChange={e => setForm(p => ({ ...p, disease: e.target.value }))}
                    placeholder="e.g. Fever, Back Pain, Diabetes..."
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 block mb-1">Notes / Doctor Advice</label>
                  <textarea rows={3} value={form.notes || ''} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                    placeholder="Rest period, medication, follow-up required..."
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 block mb-1">Approved By (HR/Manager)</label>
                  <input type="text" value={form.approvedBy || ''} onChange={e => setForm(p => ({ ...p, approvedBy: e.target.value }))}
                    placeholder="HR Manager or Supervisor name"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={handleSave} className="flex-1 bg-teal-600 hover:bg-teal-700 text-white font-bold py-2 rounded-lg text-sm flex items-center justify-center gap-2">
                  <Save className="h-4 w-4" /> Save Medical Form
                </button>
                <button onClick={() => setShowForm(false)} className="px-4 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {['Date', 'Employee', 'Disease / Condition', 'Notes', 'Approved By', 'Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-12 text-slate-400 text-sm">No medical forms found</td></tr>
              ) : filtered.map(m => (
                <tr key={m.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-600 text-xs font-mono whitespace-nowrap">{fmtDate(m.date)}</td>
                  <td className="px-4 py-3 font-semibold text-slate-800">{m.employeeName}</td>
                  <td className="px-4 py-3">
                    <span className="bg-teal-50 text-teal-700 text-xs font-bold px-2 py-0.5 rounded-full">{m.disease}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs max-w-[180px] truncate">{m.notes || '—'}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{m.approvedBy || '—'}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => { if (window.confirm('Delete this record?')) saveMedicals(medicals.filter(x => x.id !== m.id)); }}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // ACCOUNTS TAB — create & manage every person's login (username + password)
  // ─────────────────────────────────────────────────────────────────────────────
  const ROLE_OPTIONS: { value: ViewRole; label: string }[] = [
    { value: 'management', label: 'Executive Management' },
    { value: 'planning_department', label: 'Planning Department' },
    { value: 'production_engineer', label: 'Production Engineering' },
    { value: 'quality_inspector', label: 'Quality Assurance' },
    { value: 'stage_worker', label: 'Stage Shop Floor' },
    { value: 'trolley_prod', label: 'Trolley Production Supervisor' },
    { value: 'factory_entrance', label: 'Factory Entrance TV Monitor' },
    { value: 'section_dashboard', label: 'Section TV Dashboard' },
    { value: 'hr_portal', label: 'HR Management Portal' },
    { value: 'store', label: 'Store & Inventory' },
    { value: 'section_supervisor', label: 'Section Supervisor' },
    { value: 'reports_analytics', label: 'Reports & Analytics' },
  ];

  const AccountsTab = () => {
    const [accounts, setAccounts] = useState<AuthUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [showForm, setShowForm] = useState(false);
    const [search, setSearch] = useState('');

    // New-account form
    const [newUsername, setNewUsername] = useState('');
    const [newDisplayName, setNewDisplayName] = useState('');
    const [newRole, setNewRole] = useState<ViewRole>('section_supervisor');
    const [newEmployeeId, setNewEmployeeId] = useState<string>('');
    const [newPasswordMode, setNewPasswordMode] = useState<'auto' | 'manual'>('auto');
    const [newPassword, setNewPassword] = useState('');
    const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    // One-time reveal of a freshly issued password (auto-generated or admin-set)
    const [revealedPassword, setRevealedPassword] = useState<{ username: string; password: string; isCustom: boolean } | null>(null);
    const [showRevealed, setShowRevealed] = useState(true);
    const [copiedFlag, setCopiedFlag] = useState(false);

    // Reset-password modal (choose auto-generate vs assign a specific password)
    const [resetTarget, setResetTarget] = useState<AuthUser | null>(null);
    const [resetMode, setResetMode] = useState<'auto' | 'manual'>('auto');
    const [resetPassword, setResetPassword] = useState('');
    const [resetPasswordConfirm, setResetPasswordConfirm] = useState('');
    const [showResetPassword, setShowResetPassword] = useState(false);
    const [resetError, setResetError] = useState<string | null>(null);
    const [resetSaving, setResetSaving] = useState(false);

    const loadAccounts = () => {
      setLoading(true);
      setLoadError(null);
      listUserAccounts()
        .then(setAccounts)
        .catch((err) => setLoadError(err?.message || 'Failed to load accounts. Are you signed in as HR or Management?'))
        .finally(() => setLoading(false));
    };

    useEffect(() => { loadAccounts(); }, []);

    const filtered = useMemo(() => accounts.filter(a =>
      (a.username || '').toLowerCase().includes(search.toLowerCase()) ||
      (a.displayName || '').toLowerCase().includes(search.toLowerCase())
    ), [accounts, search]);

    const resetForm = () => {
      setNewUsername('');
      setNewDisplayName('');
      setNewRole('section_supervisor');
      setNewEmployeeId('');
      setNewPasswordMode('auto');
      setNewPassword('');
      setNewPasswordConfirm('');
      setShowNewPassword(false);
      setFormError(null);
    };

    const handleCreate = async () => {
      if (!newUsername.trim() || !newDisplayName.trim()) {
        setFormError('Username and full name are required.');
        return;
      }
      if (newPasswordMode === 'manual') {
        if (newPassword.length < 8) {
          setFormError('Password must be at least 8 characters long.');
          return;
        }
        if (newPassword !== newPasswordConfirm) {
          setFormError('Passwords do not match.');
          return;
        }
      }
      setSaving(true);
      setFormError(null);
      try {
        const { user, tempPassword, isCustomPassword } = await createUserAccount({
          username: newUsername.trim(),
          displayName: newDisplayName.trim(),
          role: newRole,
          employeeId: newEmployeeId || null,
          password: newPasswordMode === 'manual' ? newPassword : null,
        });
        setAccounts(prev => [...prev, user]);
        setRevealedPassword({ username: user.username, password: tempPassword, isCustom: isCustomPassword });
        setShowRevealed(true);
        setShowForm(false);
        resetForm();
      } catch (err: any) {
        setFormError(err?.message || 'Failed to create account.');
      } finally {
        setSaving(false);
      }
    };

    const handleToggleActive = async (acc: AuthUser) => {
      try {
        if (acc.active) {
          await deactivateUserAccount(acc.id);
          setAccounts(prev => prev.map(a => a.id === acc.id ? { ...a, active: 0 } : a));
        } else {
          const updated = await updateUserAccount(acc.id, { active: 1 as any });
          setAccounts(prev => prev.map(a => a.id === acc.id ? updated : a));
        }
      } catch (err: any) {
        alert(err?.message || 'Failed to update account status.');
      }
    };

    const handleRoleChange = async (acc: AuthUser, role: ViewRole) => {
      try {
        const updated = await updateUserAccount(acc.id, { role });
        setAccounts(prev => prev.map(a => a.id === acc.id ? updated : a));
      } catch (err: any) {
        alert(err?.message || 'Failed to update role.');
      }
    };

    const openResetModal = (acc: AuthUser) => {
      setResetTarget(acc);
      setResetMode('auto');
      setResetPassword('');
      setResetPasswordConfirm('');
      setShowResetPassword(false);
      setResetError(null);
    };

    const closeResetModal = () => {
      setResetTarget(null);
      setResetSaving(false);
    };

    const handleConfirmReset = async () => {
      if (!resetTarget) return;
      if (resetMode === 'manual') {
        if (resetPassword.length < 8) {
          setResetError('Password must be at least 8 characters long.');
          return;
        }
        if (resetPassword !== resetPasswordConfirm) {
          setResetError('Passwords do not match.');
          return;
        }
      }
      setResetSaving(true);
      setResetError(null);
      try {
        const { tempPassword, isCustomPassword } = await resetUserPassword(
          resetTarget.id,
          resetMode === 'manual' ? resetPassword : null
        );
        setRevealedPassword({ username: resetTarget.username, password: tempPassword, isCustom: isCustomPassword });
        setShowRevealed(true);
        closeResetModal();
      } catch (err: any) {
        setResetError(err?.message || 'Failed to reset password.');
        setResetSaving(false);
      }
    };

    const copyRevealed = () => {
      if (!revealedPassword) return;
      const text = `Username: ${revealedPassword.username}\nPassword: ${revealedPassword.password}`;
      navigator.clipboard?.writeText(text).then(() => {
        setCopiedFlag(true);
        setTimeout(() => setCopiedFlag(false), 2000);
      });
    };

    return (
      <div className="space-y-5">
        {/* Freshly-issued credential banner */}
        {revealedPassword && (
          <div className="bg-emerald-50 border border-emerald-300 rounded-2xl p-5 flex items-start gap-4">
            <div className="p-2.5 bg-emerald-100 rounded-xl shrink-0">
              <KeyRound className="h-5 w-5 text-emerald-700" />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-black text-emerald-900">Credentials ready — share these once, they won't be shown again</h4>
              <p className="text-xs text-emerald-800 mt-1">
                Give these to <span className="font-bold">{revealedPassword.username}</span> directly.{' '}
                {revealedPassword.isCustom
                  ? 'This is the exact password you set — it will not be shown again.'
                  : "They'll be asked to set their own password on first login."}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3 bg-white border border-emerald-200 rounded-xl px-4 py-3">
                <div className="text-xs">
                  <span className="text-slate-400">Username: </span>
                  <span className="font-mono font-bold text-slate-800">{revealedPassword.username}</span>
                </div>
                <div className="text-xs">
                  <span className="text-slate-400">Password: </span>
                  <span className="font-mono font-bold text-slate-800">
                    {showRevealed ? revealedPassword.password : '••••••••••'}
                  </span>
                </div>
                <button onClick={() => setShowRevealed(v => !v)} className="text-slate-400 hover:text-slate-600">
                  {showRevealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
                <button
                  onClick={copyRevealed}
                  className="ml-auto flex items-center gap-1.5 text-xs font-bold text-emerald-700 hover:text-emerald-900"
                >
                  <Copy className="h-3.5 w-3.5" /> {copiedFlag ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
            <button onClick={() => setRevealedPassword(null)} className="text-emerald-400 hover:text-emerald-700 shrink-0">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Header row */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or username…"
              className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadAccounts}
              className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-500 hover:bg-slate-50"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </button>
            <button
              onClick={() => { setShowForm(true); setFormError(null); }}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-violet-600 text-white text-xs font-bold hover:bg-violet-700"
            >
              <Plus className="h-3.5 w-3.5" /> Create Account
            </button>
          </div>
        </div>

        {/* Create account panel */}
        {showForm && (
          <div className="bg-white border border-violet-200 rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-black text-slate-800 flex items-center gap-2">
                <UserCog className="h-4 w-4 text-violet-600" /> New Login Account
              </h4>
              <button onClick={() => { setShowForm(false); resetForm(); }} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-[11px] font-bold uppercase text-slate-500">Full Name</label>
                <input
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                  placeholder="e.g. Ahmed Khan"
                  className="w-full mt-1 px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold uppercase text-slate-500">Username</label>
                <input
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="e.g. a.khan"
                  className="w-full mt-1 px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold uppercase text-slate-500">Portal / Role</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as ViewRole)}
                  className="w-full mt-1 px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
                >
                  {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-bold uppercase text-slate-500">Link to Employee (optional)</label>
                <select
                  value={newEmployeeId}
                  onChange={(e) => setNewEmployeeId(e.target.value)}
                  className="w-full mt-1 px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
                >
                  <option value="">— None —</option>
                  {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name} · {emp.department}</option>)}
                </select>
              </div>
            </div>

            <p className="text-[11px] text-slate-400">
              A temporary password will be generated automatically and shown once after you create the account.
            </p>

            <div className="border border-slate-200 rounded-xl p-3.5 space-y-3 bg-slate-50/60">
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1.5 text-xs font-bold text-slate-700 cursor-pointer">
                  <input
                    type="radio"
                    checked={newPasswordMode === 'auto'}
                    onChange={() => { setNewPasswordMode('auto'); setFormError(null); }}
                  />
                  Auto-generate password
                </label>
                <label className="flex items-center gap-1.5 text-xs font-bold text-slate-700 cursor-pointer">
                  <input
                    type="radio"
                    checked={newPasswordMode === 'manual'}
                    onChange={() => { setNewPasswordMode('manual'); setFormError(null); }}
                  />
                  Set password myself
                </label>
              </div>

              {newPasswordMode === 'auto' ? (
                <p className="text-[11px] text-slate-400">
                  A temporary password will be generated automatically and shown once after you create the account. The person will be asked to set their own password on first login.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-bold uppercase text-slate-500">Password</label>
                    <div className="flex items-center gap-2 mt-1 px-3 py-2.5 rounded-xl border border-slate-200 bg-white focus-within:ring-2 focus-within:ring-violet-200">
                      <input
                        type={showNewPassword ? 'text' : 'password'}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="At least 8 characters"
                        className="w-full text-sm outline-none"
                      />
                      <button type="button" onClick={() => setShowNewPassword(v => !v)} className="text-slate-400 hover:text-slate-600 shrink-0">
                        {showNewPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="text-[11px] font-bold uppercase text-slate-500">Confirm Password</label>
                    <input
                      type={showNewPassword ? 'text' : 'password'}
                      value={newPasswordConfirm}
                      onChange={(e) => setNewPasswordConfirm(e.target.value)}
                      placeholder="Re-enter password"
                      className="w-full mt-1 px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
                    />
                  </div>
                  <p className="text-[11px] text-slate-400 sm:col-span-2">
                    This exact password will be set on the account. The person won't be forced to change it on first login.
                  </p>
                </div>
              )}
            </div>

            {formError && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">{formError}</div>
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowForm(false); resetForm(); }}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 text-white text-xs font-bold hover:bg-violet-700 disabled:opacity-60"
              >
                <Save className="h-3.5 w-3.5" /> {saving ? 'Creating…' : 'Create Account'}
              </button>
            </div>
          </div>
        )}

        {/* Accounts table */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {loading ? (
            <p className="p-6 text-sm text-slate-400">Loading accounts…</p>
          ) : loadError ? (
            <p className="p-6 text-sm text-red-600">{loadError}</p>
          ) : filtered.length === 0 ? (
            <p className="p-6 text-sm text-slate-400">No accounts yet. Click "Create Account" to add the first one.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-[11px] uppercase text-slate-500 font-bold">
                  <tr>
                    <td className="px-4 py-3">Name</td>
                    <td className="px-4 py-3">Username</td>
                    <td className="px-4 py-3">Role / Portal</td>
                    <td className="px-4 py-3">Status</td>
                    <td className="px-4 py-3">Last Login</td>
                    <td className="px-4 py-3 text-right">Actions</td>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map(acc => (
                    <tr key={acc.id} className={!acc.active ? 'opacity-50' : ''}>
                      <td className="px-4 py-3 font-bold text-slate-800">{acc.displayName || '—'}</td>
                      <td className="px-4 py-3 font-mono text-slate-500">{acc.username || '—'}</td>
                      <td className="px-4 py-3">
                        <select
                          value={acc.role}
                          onChange={(e) => handleRoleChange(acc, e.target.value as ViewRole)}
                          className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-200"
                        >
                          {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        {acc.active ? (
                          <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-full">Active</span>
                        ) : (
                          <span className="text-[11px] font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded-full">Disabled</span>
                        )}
                        {!!acc.mustChangePassword && acc.active && (
                          <span className="ml-1.5 text-[11px] font-bold text-amber-700 bg-amber-50 px-2 py-1 rounded-full">Temp password</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs">
                        {acc.lastLoginAt ? fmtDate(acc.lastLoginAt) : 'Never'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => openResetModal(acc)}
                            title="Reset password"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-violet-700 hover:bg-violet-50"
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handleToggleActive(acc)}
                            title={acc.active ? 'Disable account' : 'Re-enable account'}
                            className={`p-1.5 rounded-lg hover:bg-slate-50 ${acc.active ? 'text-slate-400 hover:text-red-600' : 'text-slate-400 hover:text-emerald-600'}`}
                          >
                            {acc.active ? <XCircle className="h-3.5 w-3.5" /> : <CheckCircle className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Reset-password modal */}
        {resetTarget && (
          <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4" onClick={closeResetModal}>
            <div
              className="bg-white rounded-2xl p-5 shadow-2xl w-full max-w-md space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-black text-slate-800 flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-violet-600" /> Reset Password
                </h4>
                <button onClick={closeResetModal} className="text-slate-400 hover:text-slate-600">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <p className="text-xs text-slate-500">
                For <span className="font-bold text-slate-700">{resetTarget.displayName}</span> ({resetTarget.username}). Their current password will stop working immediately.
              </p>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1.5 text-xs font-bold text-slate-700 cursor-pointer">
                  <input
                    type="radio"
                    checked={resetMode === 'auto'}
                    onChange={() => { setResetMode('auto'); setResetError(null); }}
                  />
                  Auto-generate password
                </label>
                <label className="flex items-center gap-1.5 text-xs font-bold text-slate-700 cursor-pointer">
                  <input
                    type="radio"
                    checked={resetMode === 'manual'}
                    onChange={() => { setResetMode('manual'); setResetError(null); }}
                  />
                  Set password myself
                </label>
              </div>

              {resetMode === 'manual' && (
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <label className="text-[11px] font-bold uppercase text-slate-500">New Password</label>
                    <div className="flex items-center gap-2 mt-1 px-3 py-2.5 rounded-xl border border-slate-200 focus-within:ring-2 focus-within:ring-violet-200">
                      <input
                        type={showResetPassword ? 'text' : 'password'}
                        value={resetPassword}
                        onChange={(e) => setResetPassword(e.target.value)}
                        placeholder="At least 8 characters"
                        className="w-full text-sm outline-none"
                      />
                      <button type="button" onClick={() => setShowResetPassword(v => !v)} className="text-slate-400 hover:text-slate-600 shrink-0">
                        {showResetPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="text-[11px] font-bold uppercase text-slate-500">Confirm New Password</label>
                    <input
                      type={showResetPassword ? 'text' : 'password'}
                      value={resetPasswordConfirm}
                      onChange={(e) => setResetPasswordConfirm(e.target.value)}
                      placeholder="Re-enter password"
                      className="w-full mt-1 px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
                    />
                  </div>
                </div>
              )}

              {resetError && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">{resetError}</div>
              )}

              <div className="flex justify-end gap-2">
                <button
                  onClick={closeResetModal}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmReset}
                  disabled={resetSaving}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 text-white text-xs font-bold hover:bg-violet-700 disabled:opacity-60"
                >
                  <Save className="h-3.5 w-3.5" /> {resetSaving ? 'Saving…' : 'Reset Password'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // TABS CONFIG
  // ─────────────────────────────────────────────────────────────────────────────

  const tabs = [
    { id: 'directory', label: 'Directory', icon: <Users className="h-4 w-4" /> },
    { id: 'attendance', label: 'Attendance', icon: <Clock className="h-4 w-4" /> },
    { id: 'payroll', label: 'Payroll', icon: <DollarSign className="h-4 w-4" /> },
    { id: 'leave', label: 'Leave', icon: <CalendarOff className="h-4 w-4" /> },
    { id: 'warnings', label: 'Warnings', icon: <AlertTriangle className="h-4 w-4" /> },
    { id: 'accidents', label: 'Accidents', icon: <ShieldAlert className="h-4 w-4" /> },
    { id: 'medical', label: 'Medical', icon: <Stethoscope className="h-4 w-4" /> },
    { id: 'reports', label: 'Reports', icon: <BarChart2 className="h-4 w-4" /> },
    { id: 'accounts', label: 'Accounts', icon: <KeyRound className="h-4 w-4" /> },
  ] as const;

  const pendingLeaveCount = leaves.filter(l => l.status === 'Pending').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-violet-100 rounded-xl">
            <Users className="h-7 w-7 text-violet-700" />
          </div>
          <div>
            <h2 className="text-xl font-black text-slate-800">HR Management Portal</h2>
            <p className="text-sm text-slate-500">Employee directory, attendance, payroll, leave management & HR reports</p>
          </div>
          <div className="ml-auto flex gap-2">
            <span className="bg-violet-50 text-violet-700 text-xs font-bold px-3 py-1.5 rounded-full border border-violet-200">
              {employees.length} Employees
            </span>
            {pendingLeaveCount > 0 && (
              <span className="bg-amber-50 text-amber-700 text-xs font-bold px-3 py-1.5 rounded-full border border-amber-200 animate-pulse">
                {pendingLeaveCount} Leave Pending
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit flex-wrap">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all ${
              activeTab === tab.id
                ? 'bg-white text-violet-700 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.icon}
            {tab.label}
            {tab.id === 'leave' && pendingLeaveCount > 0 && (
              <span className="bg-amber-500 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full">{pendingLeaveCount}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'directory' && <DirectoryTab />}
      {activeTab === 'attendance' && <AttendanceTab />}
      {activeTab === 'payroll' && <PayrollTab />}
      {activeTab === 'leave' && <LeaveTab />}
      {activeTab === 'warnings' && <WarningsTab />}
      {activeTab === 'accidents' && <AccidentsTab />}
      {activeTab === 'medical' && <MedicalTab />}
      {activeTab === 'reports' && <ReportsTab />}
      {activeTab === 'accounts' && <AccountsTab />}
    </div>
  );
};
