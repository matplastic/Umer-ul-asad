import React, { useState } from 'react';
import { ShieldAlert, Plus, X, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
export interface QCDefect {
  id: string;
  stageId: string;
  stageName: string;
  poolId: string;
  poolNo: string;
  projectName: string;
  defectType: string;
  severity: 'minor' | 'major' | 'critical';
  status: 'open' | 'on_hold' | 'released' | 'rejected';
  loggedBy: string;
  loggedAt: string;
  releasedBy?: string;
  releasedAt?: string;
  notes?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Defect catalogue — categorised by plastic manufacturing defect families
// ─────────────────────────────────────────────────────────────────────────────
export const DEFECT_TYPES: { category: string; items: string[] }[] = [
  {
    category: 'Surface Defects',
    items: [
      'Scratch / Scuff Mark',
      'Sink Mark',
      'Weld Line / Knit Line',
      'Silver Streaks / Splay Marks',
      'Surface Burn Marks',
      'Orange Peel Texture',
      'Delamination / Peeling',
    ],
  },
  {
    category: 'Dimensional / Structural',
    items: [
      'Dimensional Out of Spec',
      'Warpage / Distortion',
      'Short Shot (Incomplete Fill)',
      'Flash / Burr Overflow',
      'Voids / Bubbles (Internal)',
      'Sink Holes (External)',
    ],
  },
  {
    category: 'Material / Color',
    items: [
      'Color Mismatch',
      'Black Spots / Contamination',
      'Wrong Material Used',
      'Inconsistent Wall Thickness',
    ],
  },
  {
    category: 'Assembly / Fitment',
    items: [
      'Assembly Failure / Misfit',
      'Incorrect Hardware Installed',
      'Seal / Gasket Defect',
      'Pipe / Fitting Leak',
    ],
  },
  {
    category: 'Process / Handling',
    items: [
      'Tool Mark / Ejector Pin Mark',
      'Handling Damage',
      'Incorrect Orientation / Labelling',
      'Missing Component',
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Per-workshop defect catalogue — matches the exact defect rows from the
// paper "Quality Control Report" sheets used on the shop floor for each
// workshop. When a stage has an entry here, QCDefectPanel shows this exact
// list instead of the generic category picker above, so pool-level defect
// logging and the Daily Defect Report portal always stay in sync with the
// same wording ("Bubbles - Pinholes", "Wet spots", etc).
// ─────────────────────────────────────────────────────────────────────────────
export const WORKSHOP_DEFECT_CATALOG: Partial<Record<string, string[]>> = {
  steel_fabrication: [
    'Assembly',
    'Welding',
    'Trim',
    'Lengths (Dimensions)',
    'Angles',
    'Grinding (slag)',
    'Squareness',
    'Planety',
  ],
  steel_primer: [
    'Exposed Steel spots',
    'Wet spots',
    'Sags',
    'Thickness',
  ],
  cladding: [ // GRP Fixing Workshop
    'Leveling',
    'GRP Intersection',
    'Gap between GRP & Steel',
    'Fitting Pipes Gap',
  ],
  lamination: [ // GRP Lamination Workshop
    'Bubbles - Pinholes',
    'Flatness',
    'Leveling',
    'Cracks',
    'Delamination',
    'Dry spots without resin',
  ],
  plumbing: [
    'Routing',
    'Pipes Distance',
    'Pipes Position',
    'PVC Crack',
    'Supports',
    'Leakage',
    'Thickness',
  ],
  mosaic: [
    'Flatness (Inside)', 'Flatness (Outside)',
    'Lippage (Inside)', 'Lippage (Outside)',
    'Leveling (Inside)', 'Leveling (Outside)',
    'Angle (Inside)', 'Angle (Outside)',
    'Joints spacing (Inside)', 'Joints spacing (Outside)',
    'Joints aesthetic (Inside)', 'Joints aesthetic (Outside)',
    'Cleaning (Inside)', 'Cleaning (Outside)',
    'Others',
  ],
};

// Workshop title shown on the paper form header, keyed the same way — used by
// the Daily Defect Report portal so the on-screen title matches the printed sheet.
export const WORKSHOP_TITLES: Partial<Record<string, string>> = {
  steel_fabrication: 'Steel Fabrication Workshop',
  steel_primer: 'Steel Primer Workshop',
  cladding: 'GRP Fixing Workshop',
  lamination: 'GRP Lamination Workshop',
  plumbing: 'Plumbing Inspection',
  mosaic: 'Mosaic Inspection Report',
};

export const DEFECT_SEVERITY_CONFIG = {
  minor:    { label: 'Minor',    color: 'bg-amber-50 text-amber-700 border-amber-200',    dot: 'bg-amber-400' },
  major:    { label: 'Major',    color: 'bg-orange-50 text-orange-700 border-orange-200', dot: 'bg-orange-500' },
  critical: { label: 'Critical', color: 'bg-rose-50 text-rose-700 border-rose-200',       dot: 'bg-rose-600' },
};

export const DEFECT_STATUS_CONFIG = {
  open:     { label: 'Open',     color: 'bg-blue-50 text-blue-700 border-blue-200',        icon: Clock },
  on_hold:  { label: 'On Hold',  color: 'bg-rose-50 text-rose-700 border-rose-200',        icon: ShieldAlert },
  released: { label: 'Released', color: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: CheckCircle2 },
  rejected: { label: 'Rejected', color: 'bg-slate-50 text-slate-500 border-slate-200',    icon: X },
};

// ─────────────────────────────────────────────────────────────────────────────
// QCDefectBadge — tiny status chip shown on pool cards in every portal
// ─────────────────────────────────────────────────────────────────────────────
interface QCDefectBadgeProps {
  defects: QCDefect[];
}

export const QCDefectBadge: React.FC<QCDefectBadgeProps> = ({ defects }) => {
  if (!defects || defects.length === 0) return null;

  const openDefects = defects.filter(d => d.status === 'open' || d.status === 'on_hold');
  const holdDefects = defects.filter(d => d.status === 'on_hold');
  const hasCritical = defects.some(d => d.severity === 'critical' && d.status !== 'released');

  if (openDefects.length === 0) return null;

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black border ${
        hasCritical || holdDefects.length > 0
          ? 'bg-rose-50 text-rose-700 border-rose-200'
          : 'bg-amber-50 text-amber-700 border-amber-200'
      }`}
    >
      <ShieldAlert className="h-3 w-3" />
      {holdDefects.length > 0
        ? `QC HOLD (${holdDefects.length})`
        : `${openDefects.length} Defect${openDefects.length > 1 ? 's' : ''}`}
    </span>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// QCDefectPanel — full panel used inside QualityInspector portal
// ─────────────────────────────────────────────────────────────────────────────
interface QCDefectPanelProps {
  poolId: string;
  poolNo: string;
  projectName: string;
  stageId: string;
  stageName: string;
  inspectorName: string;
  existingDefects: QCDefect[];
  onLogDefect: (defect: QCDefect) => void;
  onUpdateDefectStatus: (defectId: string, newStatus: QCDefect['status'], operatorName: string) => void;
}

export const QCDefectPanel: React.FC<QCDefectPanelProps> = ({
  poolId,
  poolNo,
  projectName,
  stageId,
  stageName,
  inspectorName,
  existingDefects,
  onLogDefect,
  onUpdateDefectStatus,
}) => {
  const [isAdding, setIsAdding] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState(DEFECT_TYPES[0].category);
  const [selectedDefect, setSelectedDefect] = useState('');
  const [severity, setSeverity] = useState<QCDefect['severity']>('minor');
  const [notes, setNotes] = useState('');
  const [putOnHold, setPutOnHold] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const poolDefects = existingDefects.filter(d => d.poolId === poolId && d.stageId === stageId);
  const activeDefects = poolDefects.filter(d => d.status !== 'released' && d.status !== 'rejected');

  const handleSubmit = () => {
    if (!selectedDefect) {
      setErrorMsg('Please select a defect type.');
      return;
    }
    if (!inspectorName) {
      setErrorMsg('No inspector selected. Select an inspector at the top of the page.');
      return;
    }
    setErrorMsg('');

    const newDefect: QCDefect = {
      id: `defect_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      stageId,
      stageName,
      poolId,
      poolNo,
      projectName,
      defectType: selectedDefect,
      severity,
      status: putOnHold ? 'on_hold' : 'open',
      loggedBy: inspectorName,
      loggedAt: new Date().toISOString(),
      notes: notes.trim() || undefined,
    };

    onLogDefect(newDefect);
    setIsAdding(false);
    setSelectedDefect('');
    setSeverity('minor');
    setNotes('');
    setPutOnHold(false);
    setErrorMsg('');
  };

  const workshopList = WORKSHOP_DEFECT_CATALOG[stageId];
  const usingWorkshopList = !!workshopList;

  const currentCategoryItems = workshopList
    || DEFECT_TYPES.find(c => c.category === selectedCategory)?.items
    || [];

  return (
    <div className="border border-slate-100 rounded-xl overflow-hidden">
      {/* Header row */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-amber-500" />
          <span className="text-xs font-black text-slate-700 uppercase tracking-wider">
            Defect Log — {stageName}
          </span>
          {activeDefects.length > 0 && (
            <span className="text-[10px] font-black bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded border border-rose-200">
              {activeDefects.length} Active
            </span>
          )}
        </div>
        {!isAdding && (
          <button
            type="button"
            onClick={() => { setIsAdding(true); setErrorMsg(''); }}
            className="flex items-center gap-1 text-[11px] font-bold bg-amber-500 hover:bg-amber-600 text-white px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            Log Defect
          </button>
        )}
      </div>

      {/* Add-defect form */}
      {isAdding && (
        <div className="p-4 bg-amber-50/40 border-b border-amber-100 space-y-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-black text-amber-800 uppercase tracking-wider">New Defect Entry</span>
            <button
              type="button"
              onClick={() => { setIsAdding(false); setErrorMsg(''); }}
              className="text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Category picker — only shown for stages without an exact workshop list */}
          {!usingWorkshopList && (
          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">Defect Category</label>
            <div className="flex flex-wrap gap-1.5">
              {DEFECT_TYPES.map(cat => (
                <button
                  key={cat.category}
                  type="button"
                  onClick={() => { setSelectedCategory(cat.category); setSelectedDefect(''); }}
                  className={`text-[10px] font-bold px-2 py-1 rounded-lg border transition-colors cursor-pointer ${
                    selectedCategory === cat.category
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {cat.category}
                </button>
              ))}
            </div>
          </div>
          )}

          {/* Defect type dropdown */}
          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">
              Defect Type *{usingWorkshopList && ` (${WORKSHOP_TITLES[stageId] || stageName})`}
            </label>
            <select
              value={selectedDefect}
              onChange={e => setSelectedDefect(e.target.value)}
              className="w-full bg-white border border-slate-200 text-xs text-slate-800 font-medium px-3 py-2 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-400 cursor-pointer"
            >
              <option value="">— Select a defect type —</option>
              {currentCategoryItems.map(item => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </div>

          {/* Severity */}
          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">Severity *</label>
            <div className="flex gap-2">
              {(['minor', 'major', 'critical'] as const).map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSeverity(s)}
                  className={`flex-1 py-1.5 rounded-lg text-[11px] font-black border transition-colors cursor-pointer capitalize ${
                    severity === s
                      ? DEFECT_SEVERITY_CONFIG[s].color + ' ring-1 ring-offset-1 ring-current'
                      : 'bg-white text-slate-400 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="e.g. Located on front panel, bottom-left corner near pipe fitting."
              rows={2}
              className="w-full bg-white border border-slate-200 text-xs text-slate-700 px-3 py-2 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-400 resize-none"
            />
          </div>

          {/* Put on hold toggle */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={putOnHold}
              onChange={e => setPutOnHold(e.target.checked)}
              className="accent-rose-600 h-4 w-4 rounded cursor-pointer"
            />
            <span className="text-xs font-bold text-rose-700">
              Place pool on QC HOLD immediately (blocks next stage)
            </span>
          </label>

          {errorMsg && (
            <div className="flex items-center gap-2 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2 text-xs font-bold text-rose-700">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {errorMsg}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => { setIsAdding(false); setErrorMsg(''); }}
              className="flex-1 py-2 bg-white border border-slate-200 text-slate-600 text-xs font-bold rounded-lg cursor-pointer hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              className="flex-1 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-black rounded-lg cursor-pointer transition-colors"
            >
              Log Defect
            </button>
          </div>
        </div>
      )}

      {/* Existing defects list */}
      {poolDefects.length === 0 ? (
        <div className="py-5 text-center">
          <CheckCircle2 className="h-6 w-6 text-emerald-300 mx-auto mb-1" />
          <p className="text-[11px] text-slate-400 font-medium">No defects logged for this stage.</p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {poolDefects.map(defect => {
            const sevCfg = DEFECT_SEVERITY_CONFIG[defect.severity];
            const stCfg = DEFECT_STATUS_CONFIG[defect.status];
            const StatusIcon = stCfg.icon;

            return (
              <div key={defect.id} className="px-4 py-3 flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-bold text-slate-800">{defect.defectType}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${sevCfg.color}`}>
                      {sevCfg.label}
                    </span>
                    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded border ${stCfg.color}`}>
                      <StatusIcon className="h-3 w-3" />
                      {stCfg.label}
                    </span>
                  </div>
                  {defect.notes && (
                    <p className="text-[11px] text-slate-500 leading-snug">{defect.notes}</p>
                  )}
                  <p className="text-[10px] text-slate-400 font-mono">
                    {defect.loggedBy} · {new Date(defect.loggedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    {defect.releasedBy && ` · Released by ${defect.releasedBy}`}
                  </p>
                </div>

                {/* Status action buttons */}
                <div className="flex gap-1.5 shrink-0">
                  {defect.status === 'open' && (
                    <button
                      type="button"
                      onClick={() => onUpdateDefectStatus(defect.id, 'on_hold', inspectorName)}
                      className="text-[10px] font-bold px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg cursor-pointer transition-colors"
                    >
                      Put On Hold
                    </button>
                  )}
                  {(defect.status === 'open' || defect.status === 'on_hold') && (
                    <button
                      type="button"
                      onClick={() => onUpdateDefectStatus(defect.id, 'released', inspectorName)}
                      className="text-[10px] font-bold px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg cursor-pointer transition-colors"
                    >
                      Release
                    </button>
                  )}
                  {defect.status === 'open' && (
                    <button
                      type="button"
                      onClick={() => onUpdateDefectStatus(defect.id, 'rejected', inspectorName)}
                      className="text-[10px] font-bold px-2 py-1 bg-slate-50 hover:bg-slate-100 text-slate-500 border border-slate-200 rounded-lg cursor-pointer transition-colors"
                    >
                      Dismiss
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
