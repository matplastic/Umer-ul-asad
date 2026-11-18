// ───────────────────────────────────────────────────────────
// HR Administration — DEMO screens.
// The Executive-only options (Payroll, Passports, Purchases, Reports,
// Accounts and the whole HR Suite) look and behave like the real thing in
// the HR Administration portal, but NOTHING is real: no real data is shown,
// nothing is saved anywhere, accounts created here do not exist, and every
// entry disappears when the screen is closed.
// ───────────────────────────────────────────────────────────
import React, { useEffect, useState } from 'react';
import { FlaskConical, Plus, Trash2, KeyRound, Copy, Eye, EyeOff } from 'lucide-react';
import { HRSandboxContext, setHRSandboxActive, clearHRSandbox, newId } from '../../lib/hrStore';
import { Modal, Field, inputCls, btnPrimary, btnGhost, Badge, Empty, SectionCard, StatCard, hrToast } from './hrUi';

/** Intentionally invisible: demo screens look exactly like the real ones. */
export const DemoBanner: React.FC<{ what?: string }> = () => null;

/** Wraps the real HR Suite screens so they run entirely in memory. */
export const HRSandboxProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  useEffect(() => {
    clearHRSandbox();
    setHRSandboxActive(true);
    return () => { setHRSandboxActive(false); clearHRSandbox(); };
  }, []);
  return (
    <HRSandboxContext.Provider value={true}>
      {children}
    </HRSandboxContext.Provider>
  );
};

// ─── Generic demo table with add / delete / status actions ───
type Row = Record<string, any> & { id: string };
interface Field_ { key: string; label: string; type?: 'text' | 'number' | 'date' | 'month' | 'select'; options?: string[]; default?: string }
interface DemoCfg {
  title: string;
  what: string;
  columns: { key: string; label: string; align?: 'right' }[];
  rows: Omit<Row, 'id'>[];
  fields: Field_[];
  addLabel: string;
  actions?: { label: string; key: string; value: string; when: (r: Row) => boolean }[];
  derive?: (vals: Record<string, any>) => Record<string, any>;
  stats?: (rows: Row[]) => { label: string; value: React.ReactNode }[];
}

const seed = (rows: Omit<Row, 'id'>[]): Row[] => rows.map((r, i) => ({ id: `demo_${i}`, ...r }));

const DemoModule: React.FC<{ cfg: DemoCfg }> = ({ cfg }) => {
  const [rows, setRows] = useState<Row[]>(() => seed(cfg.rows));
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState<Record<string, any>>({});
  const reset = () => setVals(Object.fromEntries(cfg.fields.map(f => [f.key, f.default ?? (f.type === 'select' ? f.options?.[0] ?? '' : '')])));
  const add = () => {
    const missing = cfg.fields.find(f => !String(vals[f.key] ?? '').trim());
    if (missing) { hrToast(`Fill in "${missing.label}"`, 'err'); return; }
    const extra = cfg.derive ? cfg.derive(vals) : {};
    setRows(p => [{ id: newId('demo'), ...vals, ...extra }, ...p]);
    setOpen(false);
    hrToast('Added');
  };
  const stats = cfg.stats?.(rows);
  return (
    <div className="space-y-4">
      {stats && <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{stats.map(s => <StatCard key={s.label} label={s.label} value={s.value} tone="violet" />)}</div>}
      <div className="flex items-center justify-between">
        <h3 className="font-black text-slate-800">{cfg.title}</h3>
        <button className={btnPrimary} onClick={() => { reset(); setOpen(true); }}><Plus className="h-4 w-4" />{cfg.addLabel}</button>
      </div>
      {rows.length === 0 ? <Empty text="No sample rows left." /> : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase text-slate-400 border-b border-slate-100">
              {cfg.columns.map(c => <th key={c.key} className={`px-4 py-2 ${c.align === 'right' ? 'text-right' : ''}`}>{c.label}</th>)}<th className="px-4 py-2" />
            </tr></thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-slate-50">
                  {cfg.columns.map(c => (
                    <td key={c.key} className={`px-4 py-2 ${c.align === 'right' ? 'text-right' : ''}`}>
                      {c.key === 'status' ? <Badge tone={r.status === 'Approved' || r.status === 'Paid' ? 'emerald' : r.status === 'Rejected' ? 'rose' : 'amber'}>{r.status}</Badge> : (r[c.key] ?? '—')}
                    </td>
                  ))}
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    {cfg.actions?.filter(a => a.when(r)).map(a => (
                      <button key={a.label} className={btnGhost + ' mr-2'} onClick={() => setRows(p => p.map(x => x.id === r.id ? { ...x, [a.key]: a.value } : x))}>{a.label}</button>
                    ))}
                    <button className="text-slate-300 hover:text-rose-600" aria-label="Delete" onClick={() => setRows(p => p.filter(x => x.id !== r.id))}><Trash2 className="h-4 w-4 inline" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && (
        <Modal title={cfg.addLabel} onClose={() => setOpen(false)} footer={<><button className={btnGhost} onClick={() => setOpen(false)}>Cancel</button><button className={btnPrimary} onClick={add}>Add</button></>}>
          {cfg.fields.map(f => (
            <Field key={f.key} label={f.label}>
              {f.type === 'select'
                ? <select className={inputCls} value={vals[f.key] ?? ''} onChange={e => setVals(p => ({ ...p, [f.key]: e.target.value }))}>{f.options?.map(o => <option key={o}>{o}</option>)}</select>
                : <input type={f.type || 'text'} className={inputCls} value={vals[f.key] ?? ''} onChange={e => setVals(p => ({ ...p, [f.key]: f.type === 'number' ? e.target.value : e.target.value }))} />}
            </Field>
          ))}
        </Modal>
      )}
    </div>
  );
};

const money = (n: number) => `AED ${Math.round(n).toLocaleString('en-US')}`;

const PASSPORTS: DemoCfg = {
  title: 'Passport tracker', what: 'Passports', addLabel: 'Add passport',
  columns: [{ key: 'name', label: 'Employee' }, { key: 'no', label: 'Passport no.' }, { key: 'country', label: 'Nationality' }, { key: 'expiry', label: 'Expiry' }],
  rows: [
    { name: 'Sample Employee A', no: 'X1234567', country: 'Pakistan', expiry: '2028-03-14' },
    { name: 'Sample Employee B', no: 'P7654321', country: 'India', expiry: '2027-09-02' },
    { name: 'Sample Employee C', no: 'A5550123', country: 'Bangladesh', expiry: '2026-12-20' },
  ],
  fields: [{ key: 'name', label: 'Employee' }, { key: 'no', label: 'Passport number' }, { key: 'country', label: 'Nationality' }, { key: 'expiry', label: 'Expiry date', type: 'date' }],
};

const PAYROLL: DemoCfg = {
  title: 'Payroll (sample month)', what: 'Payroll', addLabel: 'Add payroll entry',
  columns: [{ key: 'name', label: 'Employee' }, { key: 'month', label: 'Month' }, { key: 'base', label: 'Base', align: 'right' }, { key: 'allow', label: 'Allowances', align: 'right' }, { key: 'ded', label: 'Deductions', align: 'right' }, { key: 'net', label: 'Net', align: 'right' }, { key: 'status', label: 'Status' }],
  rows: [
    { name: 'Sample Employee A', month: '2026-11', base: money(1500), allow: money(500), ded: money(0), net: money(2000), status: 'Pending' },
    { name: 'Sample Employee B', month: '2026-11', base: money(1200), allow: money(400), ded: money(100), net: money(1500), status: 'Paid' },
  ],
  fields: [{ key: 'name', label: 'Employee' }, { key: 'month', label: 'Month', type: 'month' }, { key: 'baseN', label: 'Base salary (AED)', type: 'number' }, { key: 'allowN', label: 'Allowances (AED)', type: 'number' }, { key: 'dedN', label: 'Deductions (AED)', type: 'number' }],
  derive: v => { const b = parseFloat(v.baseN) || 0, a = parseFloat(v.allowN) || 0, d = parseFloat(v.dedN) || 0; return { base: money(b), allow: money(a), ded: money(d), net: money(b + a - d), status: 'Pending' }; },
  actions: [{ label: 'Mark paid', key: 'status', value: 'Paid', when: r => r.status !== 'Paid' }],
  stats: rows => [{ label: 'Entries', value: rows.length }, { label: 'Paid', value: rows.filter(r => r.status === 'Paid').length }, { label: 'Pending', value: rows.filter(r => r.status !== 'Paid').length }],
};

const PURCHASES: DemoCfg = {
  title: 'Purchase requests', what: 'Purchases', addLabel: 'New request',
  columns: [{ key: 'item', label: 'Item' }, { key: 'by', label: 'Requested by' }, { key: 'qty', label: 'Qty', align: 'right' }, { key: 'cost', label: 'Est. cost', align: 'right' }, { key: 'status', label: 'Status' }],
  rows: [
    { item: 'Safety shoes (size 42)', by: 'Sample Supervisor', qty: 10, cost: money(900), status: 'Pending' },
    { item: 'Office printer paper', by: 'Sample Clerk', qty: 20, cost: money(240), status: 'Approved' },
  ],
  fields: [{ key: 'item', label: 'Item' }, { key: 'by', label: 'Requested by' }, { key: 'qty', label: 'Quantity', type: 'number' }, { key: 'costN', label: 'Estimated cost (AED)', type: 'number' }],
  derive: v => ({ cost: money(parseFloat(v.costN) || 0), status: 'Pending' }),
  actions: [
    { label: 'Approve', key: 'status', value: 'Approved', when: r => r.status === 'Pending' },
    { label: 'Reject', key: 'status', value: 'Rejected', when: r => r.status === 'Pending' },
  ],
};

const REPORTS: DemoCfg = {
  title: 'HR reports (sample)', what: 'Reports', addLabel: 'Generate sample report',
  columns: [{ key: 'name', label: 'Report' }, { key: 'period', label: 'Period' }, { key: 'rows', label: 'Rows', align: 'right' }, { key: 'status', label: 'Status' }],
  rows: [
    { name: 'Monthly attendance summary', period: '2026-10', rows: 412, status: 'Approved' },
    { name: 'Overtime by department', period: '2026-10', rows: 38, status: 'Approved' },
    { name: 'Leave balance report', period: '2026', rows: 51, status: 'Approved' },
  ],
  fields: [{ key: 'name', label: 'Report', type: 'select', options: ['Monthly attendance summary', 'Overtime by department', 'Leave balance report', 'Headcount by department'] }, { key: 'period', label: 'Period', type: 'month' }],
  derive: () => ({ rows: Math.floor(Math.random() * 400) + 20, status: 'Approved' }),
};

const CONFIGS = { passports: PASSPORTS, payroll: PAYROLL, purchases: PURCHASES, reports: REPORTS } as const;

// ─── Demo Accounts: looks like the real tab, creates NOTHING real ───
const ROLES = ['HR Administration Portal', 'HR Executive Portal', 'Management', 'Quality Control', 'Store & Inventory', 'Section Supervisor', 'Planning Department'];
const genPass = () => { const c = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'; return Array.from({ length: 10 }, () => c[Math.floor(Math.random() * c.length)]).join(''); };

interface DemoAcc { id: string; name: string; username: string; role: string; active: boolean }

const DemoAccounts: React.FC = () => {
  const [accs, setAccs] = useState<DemoAcc[]>([
    { id: 'd1', name: 'Sample Administrator', username: 'sample.admin', role: 'HR Administration Portal', active: true },
    { id: 'd2', name: 'Sample Supervisor', username: 'sample.super', role: 'Section Supervisor', active: true },
  ]);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', username: '', role: ROLES[0], mode: 'auto' as 'auto' | 'manual', pw: '', pw2: '' });
  const [reveal, setReveal] = useState<{ username: string; password: string } | null>(null);
  const [show, setShow] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const create = () => {
    if (!f.name.trim() || !f.username.trim()) { setErr('Username and full name are required.'); return; }
    if (f.mode === 'manual' && (f.pw.length < 8 || f.pw !== f.pw2)) { setErr(f.pw.length < 8 ? 'Password must be at least 8 characters long.' : 'Passwords do not match.'); return; }
    const pw = f.mode === 'manual' ? f.pw : genPass();
    setAccs(p => [...p, { id: newId('da'), name: f.name.trim(), username: f.username.trim().toLowerCase(), role: f.role, active: true }]);
    setReveal({ username: f.username.trim().toLowerCase(), password: pw });
    setShow(true); setOpen(false); setErr(null);
    setF({ name: '', username: '', role: ROLES[0], mode: 'auto', pw: '', pw2: '' });
  };

  return (
    <div className="space-y-4">

      {reveal && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-2">
          <div className="text-sm font-black text-emerald-900">Account created</div>
          <div className="text-xs font-mono text-emerald-900">Username: {reveal.username}</div>
          <div className="text-xs font-mono text-emerald-900 flex items-center gap-2">Password: {show ? reveal.password : '••••••••••'}
            <button onClick={() => setShow(s => !s)} aria-label="Toggle">{show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</button>
            <button onClick={() => { navigator.clipboard?.writeText(`Username: ${reveal.username}\nPassword: ${reveal.password}`); hrToast('Copied'); }} aria-label="Copy"><Copy className="h-3.5 w-3.5" /></button>
          </div>
          <button className={btnGhost} onClick={() => setReveal(null)}>Dismiss</button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h3 className="font-black text-slate-800">Accounts ({accs.length})</h3>
        <button className={btnPrimary} onClick={() => { setErr(null); setOpen(true); }}><Plus className="h-4 w-4" />Create Account</button>
      </div>

      <SectionCard>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[11px] uppercase text-slate-400 border-b border-slate-100"><th className="px-3 py-2">Name</th><th className="px-3 py-2">Username</th><th className="px-3 py-2">Role / Portal</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Actions</th></tr></thead>
          <tbody className="divide-y divide-slate-50">
            {accs.map(a => (
              <tr key={a.id} className={a.active ? '' : 'opacity-50'}>
                <td className="px-3 py-2 font-bold text-slate-800">{a.name}</td>
                <td className="px-3 py-2 font-mono text-slate-500">{a.username}</td>
                <td className="px-3 py-2">{a.role}</td>
                <td className="px-3 py-2"><Badge tone={a.active ? 'emerald' : 'slate'}>{a.active ? 'Active' : 'Disabled'}</Badge></td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button className={btnGhost + ' mr-2'} onClick={() => { setReveal({ username: a.username, password: genPass() }); setShow(true); }}><KeyRound className="h-3.5 w-3.5" />Reset password</button>
                  <button className={btnGhost + ' mr-2'} onClick={() => setAccs(p => p.map(x => x.id === a.id ? { ...x, active: !x.active } : x))}>{a.active ? 'Disable' : 'Enable'}</button>
                  <button className="text-slate-300 hover:text-rose-600" aria-label="Delete" onClick={() => setAccs(p => p.filter(x => x.id !== a.id))}><Trash2 className="h-4 w-4 inline" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>

      {open && (
        <Modal title="Create account" onClose={() => setOpen(false)} footer={<><button className={btnGhost} onClick={() => setOpen(false)}>Cancel</button><button className={btnPrimary} onClick={create}>Create Account</button></>}>
          {err && <p className="text-xs text-rose-600 font-semibold">{err}</p>}
          <Field label="Full name *"><input className={inputCls} value={f.name} onChange={e => setF(p => ({ ...p, name: e.target.value }))} /></Field>
          <Field label="Username *"><input className={inputCls} value={f.username} onChange={e => setF(p => ({ ...p, username: e.target.value }))} /></Field>
          <Field label="Role / Portal"><select className={inputCls} value={f.role} onChange={e => setF(p => ({ ...p, role: e.target.value }))}>{ROLES.map(r => <option key={r}>{r}</option>)}</select></Field>
          <Field label="Password">
            <div className="flex gap-2 mb-2">
              {(['auto', 'manual'] as const).map(m => (
                <button key={m} type="button" onClick={() => setF(p => ({ ...p, mode: m }))} className={`text-xs font-bold px-3 py-1.5 rounded-lg border ${f.mode === m ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-500 border-slate-200'}`}>{m === 'auto' ? 'Auto-generate' : 'Set manually'}</button>
              ))}
            </div>
            {f.mode === 'manual' && (<div className="space-y-2">
              <input type="password" className={inputCls} placeholder="At least 8 characters" value={f.pw} onChange={e => setF(p => ({ ...p, pw: e.target.value }))} />
              <input type="password" className={inputCls} placeholder="Confirm password" value={f.pw2} onChange={e => setF(p => ({ ...p, pw2: e.target.value }))} />
            </div>)}
          </Field>
        </Modal>
      )}
    </div>
  );
};

/** The five Records tabs that are demos in HR Administration. */
export const DemoRecords: React.FC<{ kind: 'passports' | 'payroll' | 'purchases' | 'reports' | 'accounts' }> = ({ kind }) =>
  kind === 'accounts' ? <DemoAccounts /> : <DemoModule key={kind} cfg={CONFIGS[kind]} />;
