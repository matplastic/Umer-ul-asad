import React, { useState, useMemo } from 'react';
import { Employee, EmployeeSkill, EmployeeCertification, SkillProficiency } from '../types';
import { Wrench, Award, Plus, Trash2, AlertTriangle, X } from 'lucide-react';

interface SkillsMatrixTabProps {
  employees: Employee[];
  onSaveEmployee: (emp: Employee) => void;
}

const CERT_ALERT_DAYS = 61; // same threshold as the existing visa/passport alerts, for consistency

const PROFICIENCY_STYLES: Record<SkillProficiency, string> = {
  beginner: 'bg-slate-50 text-slate-500 border-slate-200',
  intermediate: 'bg-blue-50 text-blue-600 border-blue-200',
  advanced: 'bg-indigo-50 text-indigo-600 border-indigo-200',
  expert: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

function certStatus(dateStr?: string | null): { label: string; cls: string; daysLeft: number } | null {
  if (!dateStr) return null; // no expiry set — doesn't expire, no alert
  const expiry = new Date(dateStr);
  if (isNaN(expiry.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysLeft = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (daysLeft < 0) return { label: 'Expired', cls: 'bg-rose-50 text-rose-700 border-rose-200', daysLeft };
  if (daysLeft < CERT_ALERT_DAYS) return { label: `${daysLeft}d left`, cls: 'bg-amber-50 text-amber-700 border-amber-200', daysLeft };
  return { label: 'Valid', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', daysLeft };
}

const uid = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

export const SkillsMatrixTab: React.FC<SkillsMatrixTabProps> = ({ employees, onSaveEmployee }) => {
  const [selectedEmpId, setSelectedEmpId] = useState<string>(employees[0]?.id || '');
  const [search, setSearch] = useState('');

  const selectedEmp = employees.find(e => e.id === selectedEmpId) || null;

  const filteredEmployees = useMemo(() => {
    if (!search.trim()) return employees;
    const q = search.toLowerCase();
    return employees.filter(e => e.name.toLowerCase().includes(q) || (e.department || '').toLowerCase().includes(q));
  }, [employees, search]);

  // Certification expiry alerts across the whole staff list, not just the
  // selected employee — mirrors the visa/passport alert pattern already
  // used elsewhere in HR Portal.
  const certAlerts = useMemo(() => {
    const results: { emp: Employee; cert: EmployeeCertification; status: { label: string; cls: string; daysLeft: number } }[] = [];
    employees.forEach(emp => {
      (emp.certifications || []).forEach(cert => {
        const status = certStatus(cert.expiryDate);
        if (status && status.daysLeft < CERT_ALERT_DAYS) {
          results.push({ emp, cert, status });
        }
      });
    });
    return results.sort((a, b) => a.status.daysLeft - b.status.daysLeft);
  }, [employees]);

  // ── Skill form ──
  const [skillDraft, setSkillDraft] = useState<{ skillName: string; proficiency: SkillProficiency; notes: string }>({
    skillName: '', proficiency: 'beginner', notes: '',
  });

  const addSkill = () => {
    if (!selectedEmp || !skillDraft.skillName.trim()) return;
    const newSkill: EmployeeSkill = {
      id: uid('skill'), skillName: skillDraft.skillName.trim(), proficiency: skillDraft.proficiency,
      notes: skillDraft.notes.trim() || null, updatedAt: new Date().toISOString(),
    };
    onSaveEmployee({ ...selectedEmp, skills: [...(selectedEmp.skills || []), newSkill] });
    setSkillDraft({ skillName: '', proficiency: 'beginner', notes: '' });
  };

  const removeSkill = (skillId: string) => {
    if (!selectedEmp) return;
    onSaveEmployee({ ...selectedEmp, skills: (selectedEmp.skills || []).filter(s => s.id !== skillId) });
  };

  // ── Certification form ──
  const [certDraft, setCertDraft] = useState<{ certName: string; issuedDate: string; expiryDate: string; notes: string }>({
    certName: '', issuedDate: '', expiryDate: '', notes: '',
  });

  const addCert = () => {
    if (!selectedEmp || !certDraft.certName.trim()) return;
    const newCert: EmployeeCertification = {
      id: uid('cert'), certName: certDraft.certName.trim(),
      issuedDate: certDraft.issuedDate || null, expiryDate: certDraft.expiryDate || null,
      notes: certDraft.notes.trim() || null,
    };
    onSaveEmployee({ ...selectedEmp, certifications: [...(selectedEmp.certifications || []), newCert] });
    setCertDraft({ certName: '', issuedDate: '', expiryDate: '', notes: '' });
  };

  const removeCert = (certId: string) => {
    if (!selectedEmp) return;
    onSaveEmployee({ ...selectedEmp, certifications: (selectedEmp.certifications || []).filter(c => c.id !== certId) });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
      {/* Employee list */}
      <div className="lg:col-span-3 bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search employee..."
          className="w-full mb-3 border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-slate-400"
        />
        <div className="space-y-1 max-h-[600px] overflow-y-auto">
          {filteredEmployees.map(emp => (
            <button
              key={emp.id}
              onClick={() => setSelectedEmpId(emp.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                selectedEmpId === emp.id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {emp.name}
              <span className={`block text-[10px] font-normal ${selectedEmpId === emp.id ? 'text-slate-300' : 'text-slate-400'}`}>{emp.department}</span>
            </button>
          ))}
          {filteredEmployees.length === 0 && <p className="text-xs text-slate-400 text-center py-6">No employees found.</p>}
        </div>
      </div>

      {/* Selected employee's skills + certs */}
      <div className="lg:col-span-6 space-y-4">
        {!selectedEmp ? (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8 text-center text-xs text-slate-400">
            Select an employee to view or edit their skills and certifications.
          </div>
        ) : (
          <>
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
              <h3 className="text-sm font-black text-slate-800 mb-1">{selectedEmp.name}</h3>
              <p className="text-xs text-slate-400 mb-4">{selectedEmp.department}{selectedEmp.role ? ` · ${selectedEmp.role}` : ''}</p>

              <h4 className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5 mb-2">
                <Wrench className="h-3.5 w-3.5 text-indigo-500" /> Skills
              </h4>
              <div className="space-y-1.5 mb-3">
                {(selectedEmp.skills || []).length === 0 && <p className="text-xs text-slate-400">No skills recorded yet.</p>}
                {(selectedEmp.skills || []).map(s => (
                  <div key={s.id} className="flex items-center justify-between gap-2 border border-slate-100 rounded-lg px-3 py-1.5">
                    <div className="min-w-0">
                      <span className="text-xs font-bold text-slate-700">{s.skillName}</span>
                      {s.notes && <span className="text-[11px] text-slate-400 ml-2">{s.notes}</span>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border capitalize ${PROFICIENCY_STYLES[s.proficiency]}`}>{s.proficiency}</span>
                      <button onClick={() => removeSkill(s.id)} className="text-slate-300 hover:text-rose-500 cursor-pointer"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 items-end border-t border-slate-100 pt-3">
                <input
                  value={skillDraft.skillName}
                  onChange={e => setSkillDraft(d => ({ ...d, skillName: e.target.value }))}
                  placeholder="Skill name"
                  className="flex-1 min-w-[120px] border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-slate-400"
                />
                <select
                  value={skillDraft.proficiency}
                  onChange={e => setSkillDraft(d => ({ ...d, proficiency: e.target.value as SkillProficiency }))}
                  className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs capitalize"
                >
                  {(['beginner', 'intermediate', 'advanced', 'expert'] as const).map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                <button onClick={addSkill} disabled={!skillDraft.skillName.trim()} className="px-3 py-1.5 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-40 text-white text-xs font-bold rounded-lg cursor-pointer flex items-center gap-1"><Plus className="h-3.5 w-3.5" /> Add</button>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
              <h4 className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5 mb-2">
                <Award className="h-3.5 w-3.5 text-amber-500" /> Certifications
              </h4>
              <div className="space-y-1.5 mb-3">
                {(selectedEmp.certifications || []).length === 0 && <p className="text-xs text-slate-400">No certifications recorded yet.</p>}
                {(selectedEmp.certifications || []).map(c => {
                  const status = certStatus(c.expiryDate);
                  return (
                    <div key={c.id} className="flex items-center justify-between gap-2 border border-slate-100 rounded-lg px-3 py-1.5">
                      <div className="min-w-0">
                        <span className="text-xs font-bold text-slate-700">{c.certName}</span>
                        {c.expiryDate && <span className="text-[11px] text-slate-400 ml-2">expires {c.expiryDate}</span>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {status && <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${status.cls}`}>{status.label}</span>}
                        {!c.expiryDate && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-slate-50 text-slate-400 border-slate-200">No expiry</span>}
                        <button onClick={() => removeCert(c.id)} className="text-slate-300 hover:text-rose-500 cursor-pointer"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-2 items-end border-t border-slate-100 pt-3">
                <input
                  value={certDraft.certName}
                  onChange={e => setCertDraft(d => ({ ...d, certName: e.target.value }))}
                  placeholder="Certification name"
                  className="flex-1 min-w-[140px] border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-slate-400"
                />
                <input type="date" value={certDraft.issuedDate} onChange={e => setCertDraft(d => ({ ...d, issuedDate: e.target.value }))} title="Issued date" className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs" />
                <input type="date" value={certDraft.expiryDate} onChange={e => setCertDraft(d => ({ ...d, expiryDate: e.target.value }))} title="Expiry date (leave blank if it doesn't expire)" className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs" />
                <button onClick={addCert} disabled={!certDraft.certName.trim()} className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white text-xs font-bold rounded-lg cursor-pointer flex items-center gap-1"><Plus className="h-3.5 w-3.5" /> Add</button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Certification expiry alerts across all staff */}
      <div className="lg:col-span-3">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
          <h4 className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5 mb-3">
            <AlertTriangle className="h-3.5 w-3.5 text-rose-500" /> Cert Expiry Alerts
          </h4>
          <div className="space-y-2 max-h-[560px] overflow-y-auto">
            {certAlerts.length === 0 && <p className="text-xs text-slate-400 text-center py-6">No certifications expiring soon.</p>}
            {certAlerts.map(({ emp, cert, status }) => (
              <button
                key={cert.id}
                onClick={() => setSelectedEmpId(emp.id)}
                className="w-full text-left border border-slate-100 rounded-lg px-3 py-2 hover:border-slate-300 cursor-pointer"
              >
                <p className="text-xs font-bold text-slate-700">{emp.name}</p>
                <p className="text-[11px] text-slate-400">{cert.certName}</p>
                <span className={`inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${status.cls}`}>{status.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
