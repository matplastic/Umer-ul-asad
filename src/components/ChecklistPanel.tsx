import React from 'react';
import { ChecklistTemplate } from '../types';
import { ClipboardList, CheckCircle2, XCircle, Camera, AlertTriangle } from 'lucide-react';

interface ChecklistPanelProps {
  template: ChecklistTemplate;
  checklistState: Record<string, boolean>;
  setChecklistState: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  checklistPhotos: Record<string, string>;
  setChecklistPhotos: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  checklistItemNotes: Record<string, string>;
  setChecklistItemNotes: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  overrideReason: string;
  setOverrideReason: (v: string) => void;
  hasFailedRequired: boolean;
}

// Reads a File into a base64 data URL — mirrors the pattern already used
// elsewhere in this app for inspectorPicture uploads, so failed-item photos
// are stored the same way (no new upload infrastructure needed).
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export const ChecklistPanel: React.FC<ChecklistPanelProps> = ({
  template,
  checklistState,
  setChecklistState,
  checklistPhotos,
  setChecklistPhotos,
  checklistItemNotes,
  setChecklistItemNotes,
  overrideReason,
  setOverrideReason,
  hasFailedRequired,
}) => {
  const setItem = (itemId: string, passed: boolean) => {
    setChecklistState(prev => ({ ...prev, [itemId]: passed }));
    // Clear a stale photo/note if the item flips back to passed.
    if (passed) {
      setChecklistPhotos(prev => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
    }
  };

  const handlePhoto = async (itemId: string, file: File | undefined) => {
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    setChecklistPhotos(prev => ({ ...prev, [itemId]: dataUrl }));
  };

  return (
    <div className="space-y-2.5 font-sans">
      <h4 className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-1">
        <ClipboardList className="h-4 w-4 text-indigo-500" />
        {template.name}
      </h4>
      <div className="text-xs text-slate-600 bg-slate-50/55 p-3 rounded-xl border border-slate-100 space-y-3">
        {template.items.map(item => {
          const state = checklistState[item.id];
          return (
            <div key={item.id} className="space-y-1.5 pb-2 border-b border-slate-100 last:border-b-0 last:pb-0">
              <div className="flex items-start justify-between gap-2">
                <span className="flex-1">
                  {item.label}
                  {item.required && <span className="text-rose-500 ml-1">*</span>}
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => setItem(item.id, true)}
                    className={`p-1 rounded-lg border ${state === true ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-200 text-slate-400 hover:border-emerald-300'}`}
                    aria-label="Mark passed"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setItem(item.id, false)}
                    className={`p-1 rounded-lg border ${state === false ? 'bg-rose-500 border-rose-500 text-white' : 'border-slate-200 text-slate-400 hover:border-rose-300'}`}
                    aria-label="Mark failed"
                  >
                    <XCircle className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {state === false && (
                <div className="pl-1 space-y-1.5">
                  <label className="flex items-center gap-2 text-[11px] font-bold text-rose-600 cursor-pointer w-fit">
                    <Camera className="h-3.5 w-3.5" />
                    {checklistPhotos[item.id] ? 'Photo attached — tap to replace' : 'Attach defect photo (optional)'}
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => handlePhoto(item.id, e.target.files?.[0])}
                    />
                  </label>
                  {checklistPhotos[item.id] && (
                    <img src={checklistPhotos[item.id]} alt="Defect evidence" className="h-16 w-16 object-cover rounded-lg border border-rose-200" />
                  )}
                  <input
                    type="text"
                    placeholder="Note (optional)"
                    value={checklistItemNotes[item.id] || ''}
                    onChange={(e) => setChecklistItemNotes(prev => ({ ...prev, [item.id]: e.target.value }))}
                    className="w-full text-xs rounded-lg border border-slate-200 px-2 py-1"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {hasFailedRequired && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-1.5">
          <div className="flex items-center gap-1.5 text-amber-700 font-black text-[11px] uppercase tracking-widest">
            <AlertTriangle className="h-3.5 w-3.5" />
            Required item failed — override justification needed to approve
          </div>
          <textarea
            value={overrideReason}
            onChange={(e) => setOverrideReason(e.target.value)}
            placeholder="Explain why this stage is being approved despite the failed item..."
            className="w-full text-xs rounded-lg border border-amber-200 px-2 py-1.5 min-h-[52px]"
          />
        </div>
      )}
    </div>
  );
};
