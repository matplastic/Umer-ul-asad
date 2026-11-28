// ───────────────────────────────────────────────────────────
// MAT-ERP — Excel import engine (pure helpers, no UI).
//  • reads .xlsx / .xls / .csv
//  • finds the header row and maps columns by flexible names
//  • parses dates the way a UAE office writes them (dd/mm/yyyy) and Excel serials
//  • matches every row to an employee by BADGE first, then by NAME
//  • builds downloadable templates and "problem rows" reports
// ───────────────────────────────────────────────────────────
import * as XLSX from 'xlsx';

export type ColKind = 'text' | 'number' | 'date' | 'badge';
export interface ImportCol {
  key: string;
  label: string;           // header written into the template
  aliases: string[];       // other header spellings accepted
  kind: ColKind;
  required?: boolean;
  example: string;
}

// ─── Reading ────────────────────────────────────────────────
export type Cell = string | number | boolean | null | undefined | Date;

export async function readWorkbook(file: File): Promise<{ rows: Cell[][]; sheetName: string }> {
  const buf = await file.arrayBuffer();
  // cellDates stays OFF on purpose: date cells then arrive as Excel serial numbers, which we convert
  // ourselves — no time-zone surprises, no US-style "03/04" guessing from formatted text.
  const wb = XLSX.read(buf, { type: 'array', raw: true });
  const name = wb.SheetNames[0];
  if (!name) throw new Error('The file has no sheets.');
  const rows = XLSX.utils.sheet_to_json<Cell[]>(wb.Sheets[name], { header: 1, raw: true, defval: '', blankrows: false });
  return { rows, sheetName: name };
}

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Find the header row (best alias score in the first 20 rows) and map each column key to its index. */
export function mapColumns(rows: Cell[][], cols: ImportCol[]): { headerRow: number; index: Record<string, number>; missing: ImportCol[] } {
  let best = { row: 0, score: -1, index: {} as Record<string, number> };
  const limit = Math.min(rows.length, 20);
  for (let r = 0; r < limit; r++) {
    const headers = (rows[r] || []).map(norm);
    const index: Record<string, number> = {};
    const used = new Set<number>();
    let score = 0;
    // pass 1: exact matches, pass 2: header contains the alias
    for (const pass of [1, 2]) {
      for (const c of cols) {
        if (index[c.key] !== undefined) continue;
        const names = [c.label, ...c.aliases].map(norm).filter(Boolean);
        const hit = headers.findIndex((h, i) => !used.has(i) && h !== '' && names.some(n => (pass === 1 ? h === n : (n.length >= 4 && h.includes(n)))));
        if (hit !== -1) { index[c.key] = hit; used.add(hit); score += pass === 1 ? 2 : 1; }
      }
    }
    if (score > best.score) best = { row: r, score, index };
  }
  return { headerRow: best.row, index: best.index, missing: cols.filter(c => c.required && best.index[c.key] === undefined) };
}

// ─── Value parsing ──────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, '0');
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

const validYmd = (y: number, m: number, d: number) => {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
  const t = new Date(y, m - 1, d);
  return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
};

/** Returns an ISO date (YYYY-MM-DD), '' for an empty cell, or null when the text is not a real date. */
export function parseDate(v: Cell): string | null {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) return validYmd(v.getFullYear(), v.getMonth() + 1, v.getDate());
  if (typeof v === 'number') {
    if (v > 20000 && v < 90000) { const d = XLSX.SSF.parse_date_code(v); return d ? validYmd(d.y, d.m, d.d) : null; }
    return null;
  }
  const s = String(v).trim();
  if (!s) return '';
  if (/^\d{5}(\.\d+)?$/.test(s) && Number(s) > 20000) { const d = XLSX.SSF.parse_date_code(Number(s)); return d ? validYmd(d.y, d.m, d.d) : null; }
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);                      // 2027-03-14
  if (m) return validYmd(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2}|\d{4})$/);                 // 14/03/2027 (day first)
  if (m) { let y = +m[3]; if (m[3].length === 2) y += y < 70 ? 2000 : 1900; return validYmd(y, +m[2], +m[1]); }
  m = s.match(/^(\d{1,2})[-/. ]([A-Za-z]{3,9})[-/. ,]*(\d{2}|\d{4})$/);         // 14-Mar-2027
  if (m && MONTHS[m[2].slice(0, 4).toLowerCase()] || (m && MONTHS[m[2].slice(0, 3).toLowerCase()])) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()] || MONTHS[m[2].slice(0, 4).toLowerCase()];
    let y = +m![3]; if (m![3].length === 2) y += y < 70 ? 2000 : 1900; return validYmd(y, mo, +m![1]);
  }
  m = s.match(/^([A-Za-z]{3,9})[-/. ]+(\d{1,2}),?[-/. ]+(\d{4})$/);              // Mar 14, 2027
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) return validYmd(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]);
  return null;
}

export function parseNum(v: Cell): number | null | '' {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const s = String(v).replace(/aed|dhs?|,|\s/gi, '');
  if (!s) return '';
  const n = Number(s);
  return isFinite(n) ? n : null;
}

export const cellText = (v: Cell): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  if (v instanceof Date) return parseDate(v) || '';
  return String(v).trim();
};

// ─── Matching rows to employees ─────────────────────────────
export interface PersonLike { id: string; name: string; department?: string }
export type MatchStatus = 'badge' | 'name' | 'name-partial' | 'conflict' | 'ambiguous' | 'none';
export interface MatchResult { status: MatchStatus; emp?: PersonLike; candidates: PersonLike[] }

export const normName = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const tokens = (s: string) => normName(s).split(' ').filter(Boolean);
const canonId = (s: string) => { const t = String(s).trim().toLowerCase(); return /^\d+$/.test(t) ? String(Number(t)) : t; };

function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

function nameCompatible(a: string, b: string): 'exact' | 'partial' | 'fuzzy' | 'no' {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.length || !tb.length) return 'no';
  if (ta.join(' ') === tb.join(' ')) return 'exact';
  const [small, big] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (small.length >= 2 && small.every(t => big.includes(t))) return 'partial';
  // same words in a different order or with one spelling slip
  if (ta.length === tb.length && ta.slice().sort().join(' ') === tb.slice().sort().join(' ')) return 'partial';
  // one or two spelling slips (Mohamed / Mohammed)
  const ja = ta.join(' '), jb = tb.join(' ');
  if (Math.min(ja.length, jb.length) >= 6 && editDistance(ja, jb) <= Math.max(2, Math.round(Math.max(ja.length, jb.length) * 0.12))) return 'fuzzy';
  return 'no';
}

export function matchEmployee(badgeRaw: string, nameRaw: string, employees: PersonLike[]): MatchResult {
  const badge = String(badgeRaw || '').trim();
  const name = String(nameRaw || '').trim();
  const byBadge = badge ? employees.find(e => canonId(e.id) === canonId(badge)) : undefined;
  if (byBadge) {
    if (!name) return { status: 'badge', emp: byBadge, candidates: [byBadge] };
    const c = nameCompatible(byBadge.name, name);
    if (c !== 'no') return { status: 'badge', emp: byBadge, candidates: [byBadge] };   // a valid badge wins over a small spelling difference
    // The badge exists but the name on the sheet is a different person → ask a human.
    const other = employees.filter(e => nameCompatible(e.name, name) !== 'no' && e.id !== byBadge.id);
    return { status: 'conflict', emp: byBadge, candidates: [byBadge, ...other] };
  }
  if (!name) return { status: 'none', candidates: [] };
  const exact = employees.filter(e => nameCompatible(e.name, name) === 'exact');
  if (exact.length === 1) return { status: 'name', emp: exact[0], candidates: exact };
  if (exact.length > 1) return { status: 'ambiguous', candidates: exact };
  const partial = employees.filter(e => ['partial', 'fuzzy'].includes(nameCompatible(e.name, name)));
  if (partial.length === 1) return { status: 'name-partial', emp: partial[0], candidates: partial };
  if (partial.length > 1) return { status: 'ambiguous', candidates: partial };
  return { status: 'none', candidates: [] };
}

// ─── Templates & reports ────────────────────────────────────
export function downloadTemplate(fileName: string, cols: ImportCol[], notes: string[]) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([cols.map(c => c.label), cols.map(c => c.example)]);
  ws['!cols'] = cols.map(c => ({ wch: Math.max(14, c.label.length + 4) }));
  XLSX.utils.book_append_sheet(wb, ws, 'Template');
  const help = XLSX.utils.aoa_to_sheet([
    ['How to use this file'],
    ...notes.map(n => [n]),
    [''],
    ['Columns', 'Required'],
    ...cols.map(c => [c.label, c.required ? 'Yes' : 'No']),
  ]);
  help['!cols'] = [{ wch: 90 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, help, 'Notes');
  XLSX.writeFile(wb, fileName);
}

export function downloadRows(fileName: string, rows: Record<string, unknown>[], sheet = 'Problems') {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), sheet);
  XLSX.writeFile(wb, fileName);
}

/** One workbook with several sheets (header row + data rows each). */
export function downloadWorkbook(fileName: string, sheets: { name: string; headers: string[]; rows: unknown[][]; widths?: number[] }[]) {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet([s.headers, ...s.rows]);
    ws['!cols'] = s.headers.map((h, i) => ({ wch: s.widths?.[i] ?? Math.max(12, Math.min(40, h.length + 4)) }));
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  XLSX.writeFile(wb, fileName);
}

/** A sheet with the given header row and data rows (used for pre-filled import sheets). */
export function downloadSheet(fileName: string, headers: string[], rows: unknown[][], sheet = 'Sheet1') {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = headers.map(h => ({ wch: Math.max(14, h.length + 4) }));
  XLSX.utils.book_append_sheet(wb, ws, sheet);
  XLSX.writeFile(wb, fileName);
}
