// ScrapManagement.tsx
// MAT Plastic Industries ERP — Production > Scrap Management
//
// Self-contained module. Uses its own Firestore collections so it cannot
// interfere with the main ERP state sync (no data-revert risk):
//   scrapMaterials  – material master (name, cost per kg)
//   scrapEntries    – daily scrap weights (cost/kg is frozen at time of entry)
//   scrapSales      – scrap sales (buyer, lines with rate per kg)
//
// Stock in bin per material = total entries (kg) − total sold (kg)

import React, { useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  Boxes,
  CalendarDays,
  Download,
  Plus,
  Recycle,
  Settings2,
  Trash2,
  TrendingDown,
  TrendingUp,
  Wallet,
  ClipboardList,
  HandCoins,
} from 'lucide-react';
import { clientDb as db } from '../lib/googleDrive';

/* ───────────────────────── Types ───────────────────────── */

interface ScrapMaterial {
  id: string;
  name: string;
  costPerKg: number; // what 1 kg of this material cost us (value wasted)
  active: boolean;
}

interface ScrapEntry {
  id: string;
  date: string; // YYYY-MM-DD
  materialId: string;
  materialName: string;
  weightKg: number;
  costPerKg: number; // frozen at time of entry
  value: number; // weightKg * costPerKg
  note?: string;
  enteredBy?: string;
  createdAt: number;
}

interface ScrapSaleLine {
  materialId: string;
  materialName: string;
  weightKg: number;
  ratePerKg: number;
  amount: number;
}

interface ScrapSale {
  id: string;
  date: string;
  buyer: string;
  lines: ScrapSaleLine[];
  total: number;
  note?: string;
  createdBy?: string;
  createdAt: number;
}

interface Props {
  currentUserName?: string;
  canManage?: boolean; // can edit materials / delete records (manager roles)
}

type Tab = 'overview' | 'entry' | 'history' | 'sales' | 'materials';
type Preset = 'today' | 'week' | 'month' | 'lastMonth' | 'all' | 'custom';
type Group = 'day' | 'week' | 'month';

const DEFAULT_MATERIALS = ['Steel', 'PVC Waste', 'GRP Cladding', 'Fibre Mat', 'Mosaic'];

/* ───────────────────────── Helpers ───────────────────────── */

const pad = (n: number) => String(n).padStart(2, '0');
const toISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const todayISO = () => toISO(new Date());
const weekStart = (s: string) => {
  const d = parseISO(s);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  return toISO(d);
};
const monthKey = (s: string) => s.slice(0, 7);
const num = (v: string | number) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;
const kg = (n: number) =>
  `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`;
const aed = (n: number) =>
  `AED ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (s: string) =>
  parseISO(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

function presetRange(p: Preset, customFrom: string, customTo: string): [string, string] {
  const now = new Date();
  const t = toISO(now);
  switch (p) {
    case 'today':
      return [t, t];
    case 'week':
      return [weekStart(t), t];
    case 'month':
      return [`${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`, t];
    case 'lastMonth': {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      return [toISO(first), toISO(last)];
    }
    case 'custom':
      return [customFrom || '0000-01-01', customTo || '9999-12-31'];
    default:
      return ['0000-01-01', '9999-12-31'];
  }
}

function groupKey(date: string, g: Group) {
  if (g === 'week') return weekStart(date);
  if (g === 'month') return monthKey(date);
  return date;
}
function groupLabel(key: string, g: Group) {
  if (g === 'month') {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  }
  if (g === 'week') {
    const end = parseISO(key);
    end.setDate(end.getDate() + 6);
    return `Week ${fmtDate(key)} – ${fmtDate(toISO(end))}`;
  }
  return fmtDate(key);
}

function downloadCSV(filename: string, rows: (string | number)[][]) {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = rows.map((r) => r.map(esc).join(',')).join('\r\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ───────────────────────── Component ───────────────────────── */

export default function ScrapManagement({ currentUserName = '', canManage = true }: Props) {
  const [tab, setTab] = useState<Tab>('overview');
  const [materials, setMaterials] = useState<ScrapMaterial[]>([]);
  const [entries, setEntries] = useState<ScrapEntry[]>([]);
  const [sales, setSales] = useState<ScrapSale[]>([]);
  const [loaded, setLoaded] = useState({ m: false, e: false, s: false });
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  // shared period filter
  const [preset, setPreset] = useState<Preset>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [from, to] = presetRange(preset, customFrom, customTo);

  /* live subscriptions */
  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'scrapMaterials'), (snap) => {
      setMaterials(snap.docs.map((d) => ({ ...(d.data() as Omit<ScrapMaterial, 'id'>), id: d.id })));
      setLoaded((l) => ({ ...l, m: true }));
    });
    const u2 = onSnapshot(query(collection(db, 'scrapEntries'), orderBy('date', 'desc')), (snap) => {
      setEntries(snap.docs.map((d) => ({ ...(d.data() as Omit<ScrapEntry, 'id'>), id: d.id })));
      setLoaded((l) => ({ ...l, e: true }));
    });
    const u3 = onSnapshot(query(collection(db, 'scrapSales'), orderBy('date', 'desc')), (snap) => {
      setSales(snap.docs.map((d) => ({ ...(d.data() as Omit<ScrapSale, 'id'>), id: d.id })));
      setLoaded((l) => ({ ...l, s: true }));
    });
    return () => {
      u1();
      u2();
      u3();
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const ok = (msg: string) => setToast({ type: 'ok', msg });
  const err = (msg: string) => setToast({ type: 'err', msg });

  const sortedMaterials = useMemo(
    () => [...materials].sort((a, b) => a.name.localeCompare(b.name)),
    [materials]
  );
  const activeMaterials = sortedMaterials.filter((m) => m.active);

  /* ── Stock per material (all time) ── */
  const stock = useMemo(() => {
    const map: Record<string, { produced: number; sold: number }> = {};
    for (const e of entries) {
      map[e.materialId] ??= { produced: 0, sold: 0 };
      map[e.materialId].produced += e.weightKg;
    }
    for (const s of sales)
      for (const l of s.lines) {
        map[l.materialId] ??= { produced: 0, sold: 0 };
        map[l.materialId].sold += l.weightKg;
      }
    return map;
  }, [entries, sales]);
  const inStock = (id: string) => r2((stock[id]?.produced ?? 0) - (stock[id]?.sold ?? 0));

  /* ── Period-filtered data ── */
  const pEntries = useMemo(() => entries.filter((e) => e.date >= from && e.date <= to), [entries, from, to]);
  const pSales = useMemo(() => sales.filter((s) => s.date >= from && s.date <= to), [sales, from, to]);

  const periodSummary = useMemo(() => {
    const perMat: Record<
      string,
      { name: string; kg: number; wasted: number; soldKg: number; revenue: number }
    > = {};
    const touch = (id: string, name: string) => (perMat[id] ??= { name, kg: 0, wasted: 0, soldKg: 0, revenue: 0 });
    for (const e of pEntries) {
      const m = touch(e.materialId, e.materialName);
      m.kg += e.weightKg;
      m.wasted += e.value;
    }
    for (const s of pSales)
      for (const l of s.lines) {
        const m = touch(l.materialId, l.materialName);
        m.soldKg += l.weightKg;
        m.revenue += l.amount;
      }
    const rows = Object.entries(perMat)
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const totals = rows.reduce(
      (t, r) => ({
        kg: t.kg + r.kg,
        wasted: t.wasted + r.wasted,
        soldKg: t.soldKg + r.soldKg,
        revenue: t.revenue + r.revenue,
      }),
      { kg: 0, wasted: 0, soldKg: 0, revenue: 0 }
    );
    return { rows, totals };
  }, [pEntries, pSales]);

  /* ───────────── Actions ───────────── */

  const seedMaterials = async () => {
    try {
      for (const name of DEFAULT_MATERIALS) {
        const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        await setDoc(doc(db, 'scrapMaterials', id), { name, costPerKg: 0, active: true });
      }
      ok('Default materials created. Please set the cost per kg for each.');
      setTab('materials');
    } catch (e) {
      err('Could not create materials.');
      console.error(e);
    }
  };

  /* ───────────── Render ───────────── */

  const loading = !(loaded.m && loaded.e && loaded.s);

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'overview', label: 'Overview', icon: <Boxes size={16} /> },
    { id: 'entry', label: 'Daily Entry', icon: <Plus size={16} /> },
    { id: 'history', label: 'Date-wise Report', icon: <CalendarDays size={16} /> },
    { id: 'sales', label: 'Scrap Sales', icon: <HandCoins size={16} /> },
    ...(canManage ? [{ id: 'materials' as Tab, label: 'Materials & Cost', icon: <Settings2 size={16} /> }] : []),
  ];

  return (
    <div className="sm-root">
      <style>{CSS}</style>

      <header className="sm-header">
        <div className="sm-title">
          <Recycle size={22} />
          <div>
            <h2>Scrap Management</h2>
            <p>Production · daily scrap, stock in bin, value wasted and scrap sales</p>
          </div>
        </div>
      </header>

      <nav className="sm-tabs">
        {tabs.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      {toast && <div className={`sm-toast ${toast.type}`}>{toast.msg}</div>}

      {loading ? (
        <div className="sm-empty">Loading scrap data…</div>
      ) : materials.length === 0 ? (
        <div className="sm-card sm-empty">
          <Recycle size={36} />
          <h3>Set up scrap materials</h3>
          <p>No materials exist yet. Create the standard list: {DEFAULT_MATERIALS.join(', ')}.</p>
          {canManage ? (
            <button className="sm-btn primary" onClick={seedMaterials}>
              Create default materials
            </button>
          ) : (
            <p>Ask a manager to set up materials.</p>
          )}
        </div>
      ) : (
        <>
          {(tab === 'overview' || tab === 'history' || tab === 'sales') && (
            <PeriodBar
              preset={preset}
              setPreset={setPreset}
              customFrom={customFrom}
              customTo={customTo}
              setCustomFrom={setCustomFrom}
              setCustomTo={setCustomTo}
              from={from}
              to={to}
            />
          )}

          {tab === 'overview' && (
            <Overview
              materials={sortedMaterials}
              inStock={inStock}
              summary={periodSummary}
              stock={stock}
            />
          )}
          {tab === 'entry' && (
            <DailyEntry
              materials={activeMaterials}
              entries={entries}
              inStock={inStock}
              userName={currentUserName}
              canManage={canManage}
              ok={ok}
              err={err}
            />
          )}
          {tab === 'history' && (
            <History
              materials={sortedMaterials}
              entries={pEntries}
              from={from}
              to={to}
              canManage={canManage}
              inStock={inStock}
              ok={ok}
              err={err}
            />
          )}
          {tab === 'sales' && (
            <Sales
              materials={activeMaterials}
              sales={pSales}
              inStock={inStock}
              userName={currentUserName}
              canManage={canManage}
              from={from}
              to={to}
              ok={ok}
              err={err}
            />
          )}
          {tab === 'materials' && canManage && (
            <Materials materials={sortedMaterials} ok={ok} err={err} />
          )}
        </>
      )}
    </div>
  );
}

/* ───────────────────────── Period bar ───────────────────────── */

function PeriodBar(p: {
  preset: Preset;
  setPreset: (v: Preset) => void;
  customFrom: string;
  customTo: string;
  setCustomFrom: (v: string) => void;
  setCustomTo: (v: string) => void;
  from: string;
  to: string;
}) {
  const presets: [Preset, string][] = [
    ['today', 'Today'],
    ['week', 'This Week'],
    ['month', 'This Month'],
    ['lastMonth', 'Last Month'],
    ['all', 'All Time'],
    ['custom', 'Custom'],
  ];
  return (
    <div className="sm-card sm-period">
      <div className="sm-chips">
        {presets.map(([id, label]) => (
          <button key={id} className={p.preset === id ? 'chip active' : 'chip'} onClick={() => p.setPreset(id)}>
            {label}
          </button>
        ))}
      </div>
      {p.preset === 'custom' && (
        <div className="sm-row">
          <label>
            From
            <input type="date" value={p.customFrom} onChange={(e) => p.setCustomFrom(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={p.customTo} onChange={(e) => p.setCustomTo(e.target.value)} />
          </label>
        </div>
      )}
      <div className="sm-muted">
        {p.preset === 'all' ? 'Showing all records' : `Period: ${fmtDate(p.from)} → ${fmtDate(p.to)}`}
      </div>
    </div>
  );
}

/* ───────────────────────── Overview ───────────────────────── */

function Overview({
  materials,
  inStock,
  summary,
  stock,
}: {
  materials: ScrapMaterial[];
  inStock: (id: string) => number;
  summary: {
    rows: { id: string; name: string; kg: number; wasted: number; soldKg: number; revenue: number }[];
    totals: { kg: number; wasted: number; soldKg: number; revenue: number };
  };
  stock: Record<string, { produced: number; sold: number }>;
}) {
  const totalInBin = materials.reduce((s, m) => s + Math.max(0, inStock(m.id)), 0);
  const binValueAtCost = materials.reduce((s, m) => s + Math.max(0, inStock(m.id)) * m.costPerKg, 0);
  const net = summary.totals.wasted - summary.totals.revenue;

  return (
    <>
      <section className="sm-kpis">
        <Kpi icon={<Boxes size={18} />} label="Scrap in bin now" value={kg(totalInBin)} sub={`≈ ${aed(binValueAtCost)} at cost`} />
        <Kpi icon={<Recycle size={18} />} label="Scrap generated (period)" value={kg(summary.totals.kg)} />
        <Kpi icon={<TrendingDown size={18} />} label="Value wasted (period)" value={aed(summary.totals.wasted)} tone="bad" />
        <Kpi icon={<Wallet size={18} />} label="Received from sales (period)" value={aed(summary.totals.revenue)} tone="good" sub={`${kg(summary.totals.soldKg)} sold`} />
        <Kpi
          icon={net > 0 ? <TrendingDown size={18} /> : <TrendingUp size={18} />}
          label="Net loss after recovery"
          value={aed(net)}
          tone={net > 0 ? 'bad' : 'good'}
          sub="Wasted − received"
        />
      </section>

      <section className="sm-card">
        <h3>Current stock in bin (all time)</h3>
        <div className="sm-table-wrap">
          <table className="sm-table">
            <thead>
              <tr>
                <th>Material</th>
                <th className="r">Total scrapped</th>
                <th className="r">Total sold</th>
                <th className="r">In bin now</th>
                <th className="r">Cost / kg</th>
                <th className="r">Bin value (cost)</th>
              </tr>
            </thead>
            <tbody>
              {materials.map((m) => {
                const s = stock[m.id] ?? { produced: 0, sold: 0 };
                const bin = inStock(m.id);
                return (
                  <tr key={m.id} className={!m.active ? 'dim' : ''}>
                    <td>
                      <strong>{m.name}</strong>
                      {!m.active && <span className="badge">inactive</span>}
                    </td>
                    <td className="r">{kg(s.produced)}</td>
                    <td className="r">{kg(s.sold)}</td>
                    <td className="r strong">{kg(bin)}</td>
                    <td className="r">{aed(m.costPerKg)}</td>
                    <td className="r">{aed(Math.max(0, bin) * m.costPerKg)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td className="r">{kg(materials.reduce((a, m) => a + (stock[m.id]?.produced ?? 0), 0))}</td>
                <td className="r">{kg(materials.reduce((a, m) => a + (stock[m.id]?.sold ?? 0), 0))}</td>
                <td className="r">{kg(totalInBin)}</td>
                <td />
                <td className="r">{aed(binValueAtCost)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="sm-card">
        <h3>Period summary by material</h3>
        {summary.rows.length === 0 ? (
          <div className="sm-muted">No scrap recorded in this period.</div>
        ) : (
          <div className="sm-table-wrap">
            <table className="sm-table">
              <thead>
                <tr>
                  <th>Material</th>
                  <th className="r">Scrapped</th>
                  <th className="r">Value wasted</th>
                  <th className="r">Sold</th>
                  <th className="r">Received</th>
                  <th className="r">Avg rate / kg</th>
                  <th className="r">Net loss</th>
                </tr>
              </thead>
              <tbody>
                {summary.rows.map((r) => (
                  <tr key={r.id}>
                    <td><strong>{r.name}</strong></td>
                    <td className="r">{kg(r.kg)}</td>
                    <td className="r bad">{aed(r.wasted)}</td>
                    <td className="r">{kg(r.soldKg)}</td>
                    <td className="r good">{aed(r.revenue)}</td>
                    <td className="r">{r.soldKg > 0 ? aed(r.revenue / r.soldKg) : '—'}</td>
                    <td className="r strong">{aed(r.wasted - r.revenue)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td className="r">{kg(summary.totals.kg)}</td>
                  <td className="r">{aed(summary.totals.wasted)}</td>
                  <td className="r">{kg(summary.totals.soldKg)}</td>
                  <td className="r">{aed(summary.totals.revenue)}</td>
                  <td />
                  <td className="r">{aed(summary.totals.wasted - summary.totals.revenue)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function Kpi({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: 'good' | 'bad';
}) {
  return (
    <div className={`sm-kpi ${tone ?? ''}`}>
      <div className="sm-kpi-label">
        {icon}
        {label}
      </div>
      <div className="sm-kpi-value">{value}</div>
      {sub && <div className="sm-kpi-sub">{sub}</div>}
    </div>
  );
}

/* ───────────────────────── Daily entry ───────────────────────── */

function DailyEntry({
  materials,
  entries,
  inStock,
  userName,
  canManage,
  ok,
  err,
}: {
  materials: ScrapMaterial[];
  entries: ScrapEntry[];
  inStock: (id: string) => number;
  userName: string;
  canManage: boolean;
  ok: (m: string) => void;
  err: (m: string) => void;
}) {
  const [date, setDate] = useState(todayISO());
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const lines = materials
    .map((m) => ({ m, w: num(weights[m.id] ?? '') }))
    .filter((l) => l.w > 0);
  const totalKg = lines.reduce((s, l) => s + l.w, 0);
  const totalValue = lines.reduce((s, l) => s + l.w * l.m.costPerKg, 0);

  const todays = entries.filter((e) => e.date === date);

  const save = async () => {
    if (lines.length === 0) return err('Enter weight for at least one material.');
    setSaving(true);
    try {
      for (const { m, w } of lines) {
        const weightKg = r2(w);
        const entry: Omit<ScrapEntry, 'id'> = {
          date,
          materialId: m.id,
          materialName: m.name,
          weightKg,
          costPerKg: m.costPerKg,
          value: r2(weightKg * m.costPerKg),
          note: (notes[m.id] ?? '').trim(),
          enteredBy: userName,
          createdAt: Date.now(),
        };
        await addDoc(collection(db, 'scrapEntries'), entry);
      }
      setWeights({});
      setNotes({});
      ok(`Scrap saved for ${fmtDate(date)} — ${kg(totalKg)}.`);
    } catch (e) {
      console.error(e);
      err('Save failed. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (e: ScrapEntry) => {
    if (inStock(e.materialId) - e.weightKg < -0.001) {
      return err('Cannot delete: part of this scrap has already been sold. Delete the related sale first.');
    }
    if (!window.confirm(`Delete ${kg(e.weightKg)} of ${e.materialName} on ${fmtDate(e.date)}?`)) return;
    try {
      await deleteDoc(doc(db, 'scrapEntries', e.id));
      ok('Entry deleted.');
    } catch (x) {
      console.error(x);
      err('Delete failed.');
    }
  };

  return (
    <>
      <section className="sm-card">
        <div className="sm-card-head">
          <h3>Enter daily scrap weight</h3>
          <label className="sm-inline">
            Date
            <input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value || todayISO())} />
          </label>
        </div>
        <div className="sm-table-wrap">
          <table className="sm-table">
            <thead>
              <tr>
                <th>Material</th>
                <th className="r">In bin now</th>
                <th className="r">Cost / kg</th>
                <th style={{ width: 160 }}>Weight (kg)</th>
                <th className="r">Value</th>
                <th>Note (optional)</th>
              </tr>
            </thead>
            <tbody>
              {materials.map((m) => {
                const w = num(weights[m.id] ?? '');
                return (
                  <tr key={m.id}>
                    <td><strong>{m.name}</strong></td>
                    <td className="r">{kg(inStock(m.id))}</td>
                    <td className="r">{aed(m.costPerKg)}</td>
                    <td>
                      <input
                        className="sm-input"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={weights[m.id] ?? ''}
                        onChange={(e) => setWeights({ ...weights, [m.id]: e.target.value })}
                      />
                    </td>
                    <td className="r">{w > 0 ? aed(w * m.costPerKg) : '—'}</td>
                    <td>
                      <input
                        className="sm-input"
                        type="text"
                        placeholder="e.g. Pool P-123 trimming"
                        value={notes[m.id] ?? ''}
                        onChange={(e) => setNotes({ ...notes, [m.id]: e.target.value })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Total</td>
                <td>{kg(totalKg)}</td>
                <td className="r">{aed(totalValue)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="sm-actions">
          <button className="sm-btn ghost" onClick={() => { setWeights({}); setNotes({}); }}>
            Clear
          </button>
          <button className="sm-btn primary" disabled={saving || lines.length === 0} onClick={save}>
            {saving ? 'Saving…' : 'Save scrap entry'}
          </button>
        </div>
      </section>

      <section className="sm-card">
        <h3>Entries recorded on {fmtDate(date)}</h3>
        {todays.length === 0 ? (
          <div className="sm-muted">Nothing recorded for this date yet.</div>
        ) : (
          <div className="sm-table-wrap">
            <table className="sm-table">
              <thead>
                <tr>
                  <th>Material</th>
                  <th className="r">Weight</th>
                  <th className="r">Cost / kg</th>
                  <th className="r">Value</th>
                  <th>Note</th>
                  <th>By</th>
                  {canManage && <th />}
                </tr>
              </thead>
              <tbody>
                {todays.map((e) => (
                  <tr key={e.id}>
                    <td><strong>{e.materialName}</strong></td>
                    <td className="r">{kg(e.weightKg)}</td>
                    <td className="r">{aed(e.costPerKg)}</td>
                    <td className="r">{aed(e.value)}</td>
                    <td>{e.note || '—'}</td>
                    <td>{e.enteredBy || '—'}</td>
                    {canManage && (
                      <td className="r">
                        <button className="sm-icon-btn" title="Delete" onClick={() => remove(e)}>
                          <Trash2 size={15} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

/* ───────────────────────── History / date-wise report ───────────────────────── */

function History({
  materials,
  entries,
  from,
  to,
  canManage,
  inStock,
  ok,
  err,
}: {
  materials: ScrapMaterial[];
  entries: ScrapEntry[];
  from: string;
  to: string;
  canManage: boolean;
  inStock: (id: string) => number;
  ok: (m: string) => void;
  err: (m: string) => void;
}) {
  const [group, setGroup] = useState<Group>('day');
  const [view, setView] = useState<'matrix' | 'log'>('matrix');
  const [matFilter, setMatFilter] = useState('all');

  const filtered = useMemo(
    () => (matFilter === 'all' ? entries : entries.filter((e) => e.materialId === matFilter)),
    [entries, matFilter]
  );
  const shownMaterials = matFilter === 'all' ? materials : materials.filter((m) => m.id === matFilter);

  const matrix = useMemo(() => {
    const map: Record<string, Record<string, { kg: number; value: number }>> = {};
    for (const e of filtered) {
      const k = groupKey(e.date, group);
      map[k] ??= {};
      map[k][e.materialId] ??= { kg: 0, value: 0 };
      map[k][e.materialId].kg += e.weightKg;
      map[k][e.materialId].value += e.value;
    }
    return Object.keys(map)
      .sort((a, b) => (a < b ? 1 : -1))
      .map((k) => {
        const cells = map[k];
        const totalKg = Object.values(cells).reduce((s, c) => s + c.kg, 0);
        const totalValue = Object.values(cells).reduce((s, c) => s + c.value, 0);
        return { key: k, cells, totalKg, totalValue };
      });
  }, [filtered, group]);

  const colTotals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const row of matrix) for (const [id, c] of Object.entries(row.cells) as [string, { kg: number; value: number }][]) t[id] = (t[id] ?? 0) + c.kg;
    return t;
  }, [matrix]);
  const grandKg = matrix.reduce((s, r) => s + r.totalKg, 0);
  const grandValue = matrix.reduce((s, r) => s + r.totalValue, 0);

  const exportCSV = () => {
    if (view === 'matrix') {
      const head = ['Period', ...shownMaterials.map((m) => `${m.name} (kg)`), 'Total kg', 'Value wasted (AED)'];
      const rows = matrix.map((r) => [
        groupLabel(r.key, group),
        ...shownMaterials.map((m) => r2(r.cells[m.id]?.kg ?? 0)),
        r2(r.totalKg),
        r2(r.totalValue),
      ]);
      downloadCSV(`scrap-${group}-${from}-${to}.csv`, [head, ...rows]);
    } else {
      const head = ['Date', 'Material', 'Weight (kg)', 'Cost/kg (AED)', 'Value (AED)', 'Note', 'Entered by'];
      const rows = filtered.map((e) => [e.date, e.materialName, e.weightKg, e.costPerKg, e.value, e.note ?? '', e.enteredBy ?? '']);
      downloadCSV(`scrap-log-${from}-${to}.csv`, [head, ...rows]);
    }
  };

  const remove = async (e: ScrapEntry) => {
    if (inStock(e.materialId) - e.weightKg < -0.001) {
      return err('Cannot delete: part of this scrap has already been sold.');
    }
    if (!window.confirm(`Delete ${kg(e.weightKg)} of ${e.materialName} on ${fmtDate(e.date)}?`)) return;
    try {
      await deleteDoc(doc(db, 'scrapEntries', e.id));
      ok('Entry deleted.');
    } catch (x) {
      console.error(x);
      err('Delete failed.');
    }
  };

  return (
    <section className="sm-card">
      <div className="sm-card-head">
        <h3>Date-wise scrap report</h3>
        <button className="sm-btn ghost" onClick={exportCSV} disabled={filtered.length === 0}>
          <Download size={15} /> Export CSV
        </button>
      </div>

      <div className="sm-filters">
        <label>
          View
          <select value={view} onChange={(e) => setView(e.target.value as 'matrix' | 'log')}>
            <option value="matrix">Summary table</option>
            <option value="log">Detailed log</option>
          </select>
        </label>
        {view === 'matrix' && (
          <label>
            Group by
            <select value={group} onChange={(e) => setGroup(e.target.value as Group)}>
              <option value="day">Daily</option>
              <option value="week">Weekly</option>
              <option value="month">Monthly</option>
            </select>
          </label>
        )}
        <label>
          Material
          <select value={matFilter} onChange={(e) => setMatFilter(e.target.value)}>
            <option value="all">All materials</option>
            {materials.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </label>
      </div>

      {filtered.length === 0 ? (
        <div className="sm-muted">No scrap recorded for this selection.</div>
      ) : view === 'matrix' ? (
        <div className="sm-table-wrap">
          <table className="sm-table">
            <thead>
              <tr>
                <th>{group === 'day' ? 'Date' : group === 'week' ? 'Week' : 'Month'}</th>
                {shownMaterials.map((m) => (
                  <th key={m.id} className="r">{m.name} (kg)</th>
                ))}
                <th className="r">Total kg</th>
                <th className="r">Value wasted</th>
              </tr>
            </thead>
            <tbody>
              {matrix.map((r) => (
                <tr key={r.key}>
                  <td><strong>{groupLabel(r.key, group)}</strong></td>
                  {shownMaterials.map((m) => (
                    <td key={m.id} className="r">
                      {r.cells[m.id] ? r.cells[m.id].kg.toFixed(2) : '—'}
                    </td>
                  ))}
                  <td className="r strong">{r.totalKg.toFixed(2)}</td>
                  <td className="r bad">{aed(r.totalValue)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                {shownMaterials.map((m) => (
                  <td key={m.id} className="r">{(colTotals[m.id] ?? 0).toFixed(2)}</td>
                ))}
                <td className="r">{grandKg.toFixed(2)}</td>
                <td className="r">{aed(grandValue)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <div className="sm-table-wrap">
          <table className="sm-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Material</th>
                <th className="r">Weight</th>
                <th className="r">Cost / kg</th>
                <th className="r">Value</th>
                <th>Note</th>
                <th>By</th>
                {canManage && <th />}
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id}>
                  <td>{fmtDate(e.date)}</td>
                  <td><strong>{e.materialName}</strong></td>
                  <td className="r">{kg(e.weightKg)}</td>
                  <td className="r">{aed(e.costPerKg)}</td>
                  <td className="r">{aed(e.value)}</td>
                  <td>{e.note || '—'}</td>
                  <td>{e.enteredBy || '—'}</td>
                  {canManage && (
                    <td className="r">
                      <button className="sm-icon-btn" title="Delete" onClick={() => remove(e)}>
                        <Trash2 size={15} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>Total</td>
                <td className="r">{kg(grandKg)}</td>
                <td />
                <td className="r">{aed(grandValue)}</td>
                <td colSpan={canManage ? 3 : 2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

/* ───────────────────────── Sales ───────────────────────── */

function Sales({
  materials,
  sales,
  inStock,
  userName,
  canManage,
  from,
  to,
  ok,
  err,
}: {
  materials: ScrapMaterial[];
  sales: ScrapSale[];
  inStock: (id: string) => number;
  userName: string;
  canManage: boolean;
  from: string;
  to: string;
  ok: (m: string) => void;
  err: (m: string) => void;
}) {
  const [date, setDate] = useState(todayISO());
  const [buyer, setBuyer] = useState('');
  const [note, setNote] = useState('');
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [rates, setRates] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const lines = materials
    .map((m) => ({
      m,
      w: num(weights[m.id] ?? ''),
      r: num(rates[m.id] ?? ''),
    }))
    .filter((l) => l.w > 0);
  const totalKg = lines.reduce((s, l) => s + l.w, 0);
  const total = lines.reduce((s, l) => s + l.w * l.r, 0);

  const sellAll = (m: ScrapMaterial) => setWeights({ ...weights, [m.id]: String(Math.max(0, inStock(m.id))) });

  const save = async () => {
    if (!buyer.trim()) return err('Enter the buyer / scrap dealer name.');
    if (lines.length === 0) return err('Enter the weight sold for at least one material.');
    for (const l of lines) {
      if (l.w - inStock(l.m.id) > 0.001)
        return err(`${l.m.name}: only ${kg(inStock(l.m.id))} in bin, cannot sell ${kg(l.w)}.`);
      if (l.r <= 0) return err(`${l.m.name}: enter the sale rate per kg.`);
    }
    setSaving(true);
    try {
      const saleLines: ScrapSaleLine[] = lines.map((l) => ({
        materialId: l.m.id,
        materialName: l.m.name,
        weightKg: r2(l.w),
        ratePerKg: r2(l.r),
        amount: r2(l.w * l.r),
      }));
      const sale: Omit<ScrapSale, 'id'> = {
        date,
        buyer: buyer.trim(),
        lines: saleLines,
        total: r2(saleLines.reduce((s, l) => s + l.amount, 0)),
        note: note.trim(),
        createdBy: userName,
        createdAt: Date.now(),
      };
      await addDoc(collection(db, 'scrapSales'), sale);
      setWeights({});
      setRates({});
      setBuyer('');
      setNote('');
      ok(`Sale recorded — ${aed(sale.total)}.`);
    } catch (e) {
      console.error(e);
      err('Save failed. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (s: ScrapSale) => {
    if (!window.confirm(`Delete sale to ${s.buyer} (${aed(s.total)})? The scrap will return to bin stock.`)) return;
    try {
      await deleteDoc(doc(db, 'scrapSales', s.id));
      ok('Sale deleted. Stock restored.');
    } catch (x) {
      console.error(x);
      err('Delete failed.');
    }
  };

  const periodTotal = sales.reduce((s, x) => s + x.total, 0);
  const periodKg = sales.reduce((s, x) => s + x.lines.reduce((a, l) => a + l.weightKg, 0), 0);

  const exportCSV = () => {
    const head = ['Date', 'Buyer', 'Material', 'Weight (kg)', 'Rate/kg (AED)', 'Amount (AED)', 'Note'];
    const rows: (string | number)[][] = [];
    for (const s of sales)
      for (const l of s.lines) rows.push([s.date, s.buyer, l.materialName, l.weightKg, l.ratePerKg, l.amount, s.note ?? '']);
    downloadCSV(`scrap-sales-${from}-${to}.csv`, [head, ...rows]);
  };

  return (
    <>
      <section className="sm-card">
        <div className="sm-card-head">
          <h3>Record scrap sale</h3>
        </div>
        <div className="sm-filters">
          <label>
            Sale date
            <input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value || todayISO())} />
          </label>
          <label>
            Buyer / scrap dealer
            <input type="text" value={buyer} placeholder="Buyer name" onChange={(e) => setBuyer(e.target.value)} />
          </label>
          <label className="grow">
            Note (optional)
            <input type="text" value={note} placeholder="Invoice / receipt no., vehicle…" onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>

        <div className="sm-table-wrap">
          <table className="sm-table">
            <thead>
              <tr>
                <th>Material</th>
                <th className="r">In bin</th>
                <th className="r">Cost / kg</th>
                <th style={{ width: 150 }}>Weight sold (kg)</th>
                <th style={{ width: 140 }}>Rate / kg (AED)</th>
                <th className="r">Amount</th>
              </tr>
            </thead>
            <tbody>
              {materials.map((m) => {
                const w = num(weights[m.id] ?? '');
                const r = num(rates[m.id] ?? '');
                const over = w - inStock(m.id) > 0.001;
                return (
                  <tr key={m.id}>
                    <td><strong>{m.name}</strong></td>
                    <td className="r">
                      {kg(inStock(m.id))}
                      {inStock(m.id) > 0 && (
                        <button className="link" onClick={() => sellAll(m)}>all</button>
                      )}
                    </td>
                    <td className="r">{aed(m.costPerKg)}</td>
                    <td>
                      <input
                        className={`sm-input ${over ? 'invalid' : ''}`}
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={weights[m.id] ?? ''}
                        onChange={(e) => setWeights({ ...weights, [m.id]: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="sm-input"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={rates[m.id] ?? ''}
                        onChange={(e) => setRates({ ...rates, [m.id]: e.target.value })}
                      />
                    </td>
                    <td className="r">{w > 0 && r > 0 ? aed(w * r) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Total</td>
                <td>{kg(totalKg)}</td>
                <td />
                <td className="r">{aed(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="sm-actions">
          <button className="sm-btn primary" disabled={saving || lines.length === 0} onClick={save}>
            {saving ? 'Saving…' : 'Record sale'}
          </button>
        </div>
      </section>

      <section className="sm-card">
        <div className="sm-card-head">
          <h3>Sales history</h3>
          <button className="sm-btn ghost" onClick={exportCSV} disabled={sales.length === 0}>
            <Download size={15} /> Export CSV
          </button>
        </div>
        {sales.length === 0 ? (
          <div className="sm-muted">No scrap sales in this period.</div>
        ) : (
          <>
            <div className="sm-muted" style={{ marginBottom: 10 }}>
              {sales.length} sale(s) · {kg(periodKg)} · received <strong>{aed(periodTotal)}</strong>
            </div>
            {sales.map((s) => (
              <div key={s.id} className="sm-sale">
                <div className="sm-sale-head">
                  <div>
                    <strong>{s.buyer}</strong>
                    <span className="sm-muted"> · {fmtDate(s.date)}{s.createdBy ? ` · by ${s.createdBy}` : ''}</span>
                    {s.note && <div className="sm-muted">{s.note}</div>}
                  </div>
                  <div className="sm-sale-total">
                    {aed(s.total)}
                    {canManage && (
                      <button className="sm-icon-btn" title="Delete sale" onClick={() => remove(s)}>
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>
                <table className="sm-table compact">
                  <thead>
                    <tr>
                      <th>Material</th>
                      <th className="r">Weight</th>
                      <th className="r">Rate / kg</th>
                      <th className="r">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.lines.map((l, i) => (
                      <tr key={i}>
                        <td>{l.materialName}</td>
                        <td className="r">{kg(l.weightKg)}</td>
                        <td className="r">{aed(l.ratePerKg)}</td>
                        <td className="r">{aed(l.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </>
        )}
      </section>
    </>
  );
}

/* ───────────────────────── Materials & cost ───────────────────────── */

function Materials({
  materials,
  ok,
  err,
}: {
  materials: ScrapMaterial[];
  ok: (m: string) => void;
  err: (m: string) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState('');
  const [newCost, setNewCost] = useState('');

  const saveCost = async (m: ScrapMaterial) => {
    const v = drafts[m.id];
    if (v === undefined) return;
    const cost = num(v);
    if (cost < 0) return err('Cost cannot be negative.');
    try {
      await updateDoc(doc(db, 'scrapMaterials', m.id), { costPerKg: r2(cost) });
      setDrafts((d) => {
        const { [m.id]: _omit, ...rest } = d;
        return rest;
      });
      ok(`${m.name}: cost updated. Applies to new entries only; past entries keep their original cost.`);
    } catch (e) {
      console.error(e);
      err('Update failed.');
    }
  };

  const toggleActive = async (m: ScrapMaterial) => {
    try {
      await updateDoc(doc(db, 'scrapMaterials', m.id), { active: !m.active });
    } catch (e) {
      console.error(e);
      err('Update failed.');
    }
  };

  const add = async () => {
    const name = newName.trim();
    if (!name) return err('Enter a material name.');
    if (materials.some((m) => m.name.toLowerCase() === name.toLowerCase())) return err('That material already exists.');
    try {
      await addDoc(collection(db, 'scrapMaterials'), { name, costPerKg: r2(num(newCost)), active: true });
      setNewName('');
      setNewCost('');
      ok(`${name} added.`);
    } catch (e) {
      console.error(e);
      err('Could not add material.');
    }
  };

  return (
    <section className="sm-card">
      <div className="sm-card-head">
        <h3>Materials &amp; cost per kg</h3>
      </div>
      <p className="sm-muted" style={{ marginTop: 0 }}>
        Cost per kg is the value of the material when it becomes waste. It is frozen on each entry, so changing it
        later does not alter past records.
      </p>
      <div className="sm-table-wrap">
        <table className="sm-table">
          <thead>
            <tr>
              <th>Material</th>
              <th style={{ width: 220 }}>Cost / kg (AED)</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {materials.map((m) => (
              <tr key={m.id} className={!m.active ? 'dim' : ''}>
                <td><strong>{m.name}</strong></td>
                <td>
                  <div className="sm-row">
                    <input
                      className="sm-input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={drafts[m.id] ?? String(m.costPerKg)}
                      onChange={(e) => setDrafts({ ...drafts, [m.id]: e.target.value })}
                    />
                    {drafts[m.id] !== undefined && (
                      <button className="sm-btn primary small" onClick={() => saveCost(m)}>Save</button>
                    )}
                  </div>
                </td>
                <td>{m.active ? 'Active' : 'Inactive'}</td>
                <td className="r">
                  <button className="sm-btn ghost small" onClick={() => toggleActive(m)}>
                    {m.active ? 'Deactivate' : 'Activate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h4 style={{ margin: '18px 0 8px' }}>Add new material</h4>
      <div className="sm-filters">
        <label className="grow">
          Name
          <input type="text" value={newName} placeholder="e.g. Resin, Cardboard" onChange={(e) => setNewName(e.target.value)} />
        </label>
        <label>
          Cost / kg (AED)
          <input type="number" min="0" step="0.01" value={newCost} onChange={(e) => setNewCost(e.target.value)} />
        </label>
        <button className="sm-btn primary" onClick={add}>
          <Plus size={15} /> Add
        </button>
      </div>
    </section>
  );
}

/* ───────────────────────── Styles ───────────────────────── */

const CSS = `
.sm-root{--bg:#f4f6f9;--card:#fff;--ink:#1a2333;--muted:#6b7686;--line:#e3e8ef;--brand:#0f5f8a;--brand-d:#0b4a6c;--good:#15803d;--bad:#b91c1c;
  font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--ink);background:var(--bg);padding:16px;border-radius:10px;width:100%;max-width:none;margin:0;align-self:stretch}
.sm-root *{box-sizing:border-box}
.sm-header{margin-bottom:12px}
.sm-title{display:flex;gap:12px;align-items:center;color:var(--brand)}
.sm-title h2{margin:0;font-size:20px;color:var(--ink)}
.sm-title p{margin:2px 0 0;font-size:13px;color:var(--muted)}
.sm-tabs{display:flex;gap:6px;overflow-x:auto;margin-bottom:12px;border-bottom:1px solid var(--line)}
.sm-tabs button{display:flex;gap:6px;align-items:center;padding:10px 14px;border:0;background:none;color:var(--muted);font-weight:600;font-size:14px;cursor:pointer;border-bottom:3px solid transparent;white-space:nowrap}
.sm-tabs button.active{color:var(--brand);border-bottom-color:var(--brand)}
.sm-card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin-bottom:14px;box-shadow:0 1px 2px rgba(16,24,40,.04)}
.sm-card h3{margin:0;font-size:16px}
.sm-card-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap}
.sm-period{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.sm-chips{display:flex;gap:6px;flex-wrap:wrap}
.chip{padding:6px 12px;border-radius:999px;border:1px solid var(--line);background:#fff;font-size:13px;cursor:pointer;color:var(--ink)}
.chip.active{background:var(--brand);color:#fff;border-color:var(--brand)}
.sm-muted{color:var(--muted);font-size:13px}
.sm-row{display:flex;gap:10px;align-items:center}
.sm-row label,.sm-filters label,.sm-inline{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--muted);font-weight:600}
.sm-inline{flex-direction:row;align-items:center;gap:8px}
.sm-filters{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px}
.sm-filters .grow{flex:1;min-width:200px}
.sm-root input[type=text],.sm-root input[type=number],.sm-root input[type=date],.sm-root select,.sm-input{padding:8px 10px;border:1px solid #cfd6e0;border-radius:8px;font-size:14px;background:#fff;color:var(--ink);width:100%;min-width:0}
.sm-filters input,.sm-filters select{width:auto}
.sm-filters .grow input{width:100%}
.sm-input.invalid{border-color:var(--bad);background:#fef2f2}
.sm-root input:focus,.sm-root select:focus{outline:2px solid rgba(15,95,138,.25);border-color:var(--brand)}
.sm-table-wrap{overflow-x:auto}
.sm-table{width:100%;border-collapse:collapse;font-size:14px}
.sm-table th{background:#f0f3f8;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.03em;color:var(--muted);padding:9px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
.sm-table td{padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:middle}
.sm-table tfoot td{background:#f7f9fc;font-weight:700;border-top:2px solid var(--line)}
.sm-table .r{text-align:right;white-space:nowrap}
.sm-table .strong{font-weight:700}
.sm-table .good{color:var(--good);font-weight:600}
.sm-table .bad{color:var(--bad);font-weight:600}
.sm-table tr.dim{opacity:.55}
.sm-table.compact td,.sm-table.compact th{padding:6px 8px;font-size:13px}
.badge{margin-left:8px;font-size:11px;background:#e5e7eb;border-radius:6px;padding:2px 6px;color:#4b5563}
.sm-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:14px}
.sm-kpi{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--brand);border-radius:10px;padding:14px}
.sm-kpi.good{border-left-color:var(--good)}
.sm-kpi.bad{border-left-color:var(--bad)}
.sm-kpi-label{display:flex;gap:6px;align-items:center;font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.03em}
.sm-kpi-value{font-size:22px;font-weight:800;margin-top:6px}
.sm-kpi-sub{font-size:12px;color:var(--muted);margin-top:2px}
.sm-btn{display:inline-flex;gap:6px;align-items:center;justify-content:center;padding:9px 16px;border-radius:8px;border:1px solid transparent;font-weight:600;font-size:14px;cursor:pointer}
.sm-btn.primary{background:var(--brand);color:#fff}
.sm-btn.primary:hover:not(:disabled){background:var(--brand-d)}
.sm-btn.ghost{background:#fff;border-color:#cfd6e0;color:var(--ink)}
.sm-btn.small{padding:5px 10px;font-size:13px}
.sm-btn:disabled{opacity:.5;cursor:not-allowed}
.sm-icon-btn{background:none;border:0;color:var(--bad);cursor:pointer;padding:4px;border-radius:6px}
.sm-icon-btn:hover{background:#fee2e2}
.link{background:none;border:0;color:var(--brand);cursor:pointer;font-size:12px;margin-left:6px;text-decoration:underline}
.sm-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:14px}
.sm-empty{text-align:center;padding:36px 16px;color:var(--muted);display:flex;flex-direction:column;align-items:center;gap:10px}
.sm-toast{position:sticky;top:8px;z-index:20;padding:10px 14px;border-radius:8px;margin-bottom:12px;font-size:14px;font-weight:600}
.sm-toast.ok{background:#dcfce7;color:#14532d;border:1px solid #86efac}
.sm-toast.err{background:#fee2e2;color:#7f1d1d;border:1px solid #fca5a5}
.sm-sale{border:1px solid var(--line);border-radius:8px;padding:12px;margin-bottom:10px}
.sm-sale-head{display:flex;justify-content:space-between;gap:10px;margin-bottom:8px}
.sm-sale-total{font-weight:800;font-size:16px;color:var(--good);display:flex;align-items:center;gap:6px}
@media(max-width:640px){.sm-root{padding:10px}.sm-kpi-value{font-size:18px}}
`;
