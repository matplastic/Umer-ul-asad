import React, { useState } from 'react';
import { FileSpreadsheet, Download, Upload } from 'lucide-react';
import { Employee } from '../../types';
import { IMPORT_TYPES, IMPORT_ORDER, ImportTypeId } from './importTypes';
import { downloadTemplate } from '../../lib/excelImport';
import { ExcelImportModal } from './ExcelImport';
import { btnPrimary, btnGhost, SectionCard } from './hrUi';

interface Props { employees: Employee[]; user?: string; saveEmployees?: (list: Employee[]) => void | Promise<void> }

export const ExcelImportHub: React.FC<Props> = ({ employees, user, saveEmployees }) => {
  const [open, setOpen] = useState<ImportTypeId | null>(null);
  return (
    <div className="space-y-4">
      <SectionCard>
        <div className="flex items-start gap-3">
          <FileSpreadsheet className="h-8 w-8 text-emerald-600 shrink-0" />
          <div>
            <div className="font-black text-slate-800">Bring your Excel sheets into the ERP</div>
            <p className="text-sm text-slate-500 mt-1">Upload one sheet for 300 employees instead of typing them one by one. Every row is matched to an employee by <b>badge number</b> first, then by <b>name</b>. You see a preview — what will be added, updated, or is a problem — before anything is saved.</p>
          </div>
        </div>
      </SectionCard>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {IMPORT_ORDER.map(id => {
          const t = IMPORT_TYPES[id];
          return (
            <div key={id} className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col gap-3">
              <div>
                <div className="font-black text-slate-800">{t.label}</div>
                <p className="text-xs text-slate-500 mt-1">{t.blurb}</p>
                <p className="text-[11px] text-slate-400 mt-2">Columns: {t.cols.map(c => c.label).join(' · ')}</p>
              </div>
              <div className="flex gap-2 mt-auto">
                <button className={btnPrimary} onClick={() => setOpen(id)}><Upload className="h-4 w-4" />Upload</button>
                <button className={btnGhost} onClick={() => downloadTemplate(t.templateFile, t.cols, t.notes)}><Download className="h-3.5 w-3.5" />Template</button>
              </div>
            </div>
          );
        })}
      </div>
      {open && <ExcelImportModal employees={employees} user={user} saveEmployees={saveEmployees} initialType={open} onClose={() => setOpen(null)} />}
    </div>
  );
};
