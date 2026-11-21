// What each Excel import knows how to read, check and save.
import type { Employee } from '../../types';
import {
  HRProfile, HRDocument, HRTraining, HRPPE, HRVehicle, HRFuelLog, DOC_TYPES, TRAINING_COURSES, PPE_ITEMS,
  newId, bulkUpsertHR, currentAssignment,
} from '../../lib/hrStore';
import { ImportCol, MatchResult, matchEmployee, parseDate, parseNum, cellText } from '../../lib/excelImport';

export type ImportTypeId = 'passport' | 'profile' | 'documents' | 'training' | 'ppe' | 'vehicles' | 'fuel';

export interface ImportCtx {
  employees: Employee[];
  user?: string;
  overwrite: boolean;               // true = replace values already stored; false = only fill blanks
  profiles: HRProfile[];
  docs: HRDocument[];
  training: HRTraining[];
  ppe: HRPPE[];
  vehicles: HRVehicle[];
  logs: HRFuelLog[];
  saveEmployees: (list: Employee[]) => void | Promise<void>;
}

export interface RowResult {
  action: 'add' | 'update' | 'skip' | 'error';
  message?: string;           // reason for skip / error, or a warning
  summary: string;            // short human description shown in the preview
  key?: string;               // detects the same record twice inside the file
  payload?: any;
}

export interface ImportType {
  id: ImportTypeId;
  label: string;
  blurb: string;
  needsEmployee: boolean;
  supportsOverwrite: boolean;
  cols: ImportCol[];
  notes: string[];
  templateFile: string;
  /** Turn one sheet row (already parsed per column) into a result. `emp` is the matched employee (when needed). */
  build: (ctx: ImportCtx, v: Record<string, any>, emp: Employee | undefined, match: MatchResult) => RowResult;
  commit: (ctx: ImportCtx, items: any[]) => Promise<{ added: number; updated: number }>;
}

const T = (key: string, label: string, aliases: string[], example: string, required = false): ImportCol => ({ key, label, aliases, kind: 'text', example, required });
const D = (key: string, label: string, aliases: string[], example: string, required = false): ImportCol => ({ key, label, aliases, kind: 'date', example, required });
const N = (key: string, label: string, aliases: string[], example: string, required = false): ImportCol => ({ key, label, aliases, kind: 'number', example, required });

const BADGE = T('badge', 'Badge No', ['badge', 'badgenumber', 'employeeid', 'empid', 'empno', 'employeeno', 'id', 'staffno', 'card no'], '1023');
const NAME = T('name', 'Employee Name', ['name', 'employee', 'fullname', 'staffname', 'worker'], 'Ali Hassan Khan');

const keep = <T,>(oldV: T | undefined | null, newV: T | undefined, overwrite: boolean): T | undefined =>
  newV === undefined || newV === '' as any ? (oldV ?? undefined) : (overwrite ? newV : (oldV === undefined || oldV === null || (oldV as any) === '' ? newV : oldV));

const canon = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const pick = (list: readonly string[], raw: string, synonyms: Record<string, string> = {}): string => {
  const c = canon(raw);
  if (!c) return '';
  if (synonyms[c]) return synonyms[c];
  return list.find(x => canon(x) === c) || raw.trim();
};
const DOC_SYN: Record<string, string> = { eid: 'Emirates ID', emiratesid: 'Emirates ID', id: 'Emirates ID', labourcard: 'Labour Card', laborcard: 'Labour Card', workpermit: 'Labour Card', insurance: 'Health Insurance', medical: 'Medical Fitness', fitness: 'Medical Fitness', licence: 'Driving License', license: 'Driving License', drivinglicence: 'Driving License', contract: 'Employment Contract', photo: 'Photo', passportcopy: 'Passport', visacopy: 'Visa' };
const PPE_SYN: Record<string, string> = { shoes: 'Safety Shoes', boots: 'Safety Shoes', helmet: 'Safety Helmet', hardhat: 'Safety Helmet', goggles: 'Safety Goggles', mask: 'Dust Mask / Respirator', respirator: 'Dust Mask / Respirator', earplug: 'Ear Plugs', earplugs: 'Ear Plugs', vest: 'Hi-Vis Vest', overall: 'Coverall' };
const COURSE_SYN: Record<string, string> = { hse: 'HSE Safety Induction', safety: 'HSE Safety Induction', firstaid: 'First Aid', fire: 'Fire Safety', iso: 'ISO 9001 Awareness', gmp: 'GMP Awareness', chemical: 'Chemical Handling (GRP / Resin)', forklift: 'Forklift / Crane Operation' };

const bad = (message: string): RowResult => ({ action: 'error', message, summary: '' });
const dateErr = (label: string, raw: any) => `${label} “${cellText(raw)}” is not a valid date`;
const dateOf = (raw: any): string | null => parseDate(raw);

const plateKey = (p: string) => p.toUpperCase().replace(/[^A-Z0-9]/g, '');
const fmtShort = (iso?: string) => iso || '—';

// ─────────── Passport & visa → Directory ───────────
const passport: ImportType = {
  id: 'passport', label: 'Passport & visa', blurb: 'Passport number, issue and expiry date, nationality and visa expiry → updates the Directory', needsEmployee: true, supportsOverwrite: true,
  templateFile: 'Passport_import_template.xlsx',
  cols: [BADGE, NAME, T('no', 'Passport Number', ['passportno', 'passport', 'passportnumber', 'ppno'], 'AB1234567'), T('country', 'Nationality', ['country', 'passportcountry', 'issuingcountry'], 'Pakistan'),
    D('issue', 'Passport Issue Date', ['issuedate', 'dateofissue', 'issue', 'passportissue', 'issueddate'], '14/03/2019'), D('expiry', 'Passport Expiry Date', ['expirydate', 'dateofexpiry', 'expiry', 'passportexpiry', 'expires', 'validuntil'], '13/03/2029'),
    D('visa', 'Visa Expiry Date', ['visaexpiry', 'visaexp', 'visa'], '30/06/2027')],
  notes: ['Fill Badge No (the number on the attendance badge) and/or the exact Employee Name. Badge is tried first, then the name.', 'Dates can be written 14/03/2029, 14-Mar-2029 or as normal Excel dates (day first).', 'Blank cells never delete anything that is already saved.'],
  build(ctx, v, emp) {
    if (!emp) return bad('Employee not matched');
    const issue = dateOf(v.issue), expiry = dateOf(v.expiry), visa = dateOf(v.visa);
    if (issue === null) return bad(dateErr('Issue date', v.issue));
    if (expiry === null) return bad(dateErr('Expiry date', v.expiry));
    if (visa === null) return bad(dateErr('Visa expiry', v.visa));
    const no = cellText(v.no).toUpperCase(), country = cellText(v.country);
    if (!no && !country && !issue && !expiry && !visa) return bad('No passport or visa details on this row');
    if (issue && expiry && expiry <= issue) return bad('Expiry date is not after the issue date');
    const next: Employee = { ...emp };
    const ow = ctx.overwrite;
    next.passportNumber = (keep(emp.passportNumber, no || undefined, ow) ?? null) as any;
    next.passportCountry = (keep(emp.passportCountry, country || undefined, ow) ?? null) as any;
    next.passportIssueDate = (keep(emp.passportIssueDate, issue || undefined, ow) ?? null) as any;
    next.passportExpiryDate = (keep(emp.passportExpiryDate, expiry || undefined, ow) ?? null) as any;
    next.visaExpiryDate = (keep(emp.visaExpiryDate, visa || undefined, ow) ?? null) as any;
    const changed = (['passportNumber', 'passportCountry', 'passportIssueDate', 'passportExpiryDate', 'visaExpiryDate'] as const).filter(k => (next[k] ?? null) !== (emp[k] ?? null));
    if (changed.length === 0) return { action: 'skip', message: 'Nothing new (already filled)', summary: 'No change', key: emp.id };
    const had = !!(emp.passportNumber || emp.passportExpiryDate);
    return { action: had ? 'update' : 'add', summary: `${next.passportNumber || '—'} · issued ${fmtShort(next.passportIssueDate || undefined)} · expires ${fmtShort(next.passportExpiryDate || undefined)}${visa ? ` · visa ${visa}` : ''}`, key: emp.id, payload: next };
  },
  async commit(ctx, items) {
    await ctx.saveEmployees(items as Employee[]);
    return { added: items.filter(() => true).length, updated: 0 };
  },
};

// ─────────── Employee HR profile ───────────
const profile: ImportType = {
  id: 'profile', label: 'Employee profile details', blurb: 'Designation, joining date, date of birth, salary, Emirates ID, labour card, emergency contact → Employee 360', needsEmployee: true, supportsOverwrite: true,
  templateFile: 'Employee_profile_import_template.xlsx',
  cols: [BADGE, NAME, T('designation', 'Designation', ['jobtitle', 'position', 'role'], 'Fiberglass Laminator'), T('type', 'Employment Type', ['employmenttype', 'contracttype'], 'Permanent'),
    D('joining', 'Joining Date', ['dateofjoining', 'doj', 'joined', 'joindate'], '01/02/2022'), D('dob', 'Date of Birth', ['dob', 'birthdate', 'dateofbirth'], '12/05/1990'),
    T('gender', 'Gender', ['sex'], 'Male'), T('marital', 'Marital Status', ['maritalstatus'], 'Married'), T('blood', 'Blood Group', ['bloodgroup', 'bloodtype'], 'O+'),
    N('salary', 'Basic Salary', ['basic', 'basicsalary', 'salary'], '1500'),
    T('eid', 'Emirates ID', ['emiratesid', 'eidno', 'emiratesidnumber'], '784-1990-1234567-1'), D('eidExp', 'Emirates ID Expiry', ['eidexpiry', 'emiratesidexpiry'], '10/09/2027'),
    T('lc', 'Labour Card No', ['labourcard', 'labourcardno', 'laborcard', 'workpermitno'], '12345678'), D('lcExp', 'Labour Card Expiry', ['labourcardexpiry', 'laborcardexpiry', 'workpermitexpiry'], '10/09/2027'),
    T('emName', 'Emergency Contact Name', ['emergencyname', 'emergencycontact'], 'Hassan Khan'), T('emRel', 'Emergency Relation', ['emergencyrelation', 'relation'], 'Brother'), T('emPhone', 'Emergency Phone', ['emergencyphone', 'emergencynumber'], '0501234567'),
    T('address', 'UAE Address', ['address', 'accommodation', 'uaeaddress'], 'Sajaa Labour Camp, Sharjah')],
  notes: ['One row per employee. Leave a cell empty to skip that detail.', 'Gender: Male / Female (or M / F).'],
  build(ctx, v, emp) {
    if (!emp) return bad('Employee not matched');
    const dates: Record<string, string | null> = { joining: dateOf(v.joining), dob: dateOf(v.dob), eidExp: dateOf(v.eidExp), lcExp: dateOf(v.lcExp) };
    const labels: Record<string, string> = { joining: 'Joining date', dob: 'Date of birth', eidExp: 'Emirates ID expiry', lcExp: 'Labour card expiry' };
    for (const k of Object.keys(dates)) if (dates[k] === null) return bad(dateErr(labels[k], v[k]));
    const sal = parseNum(v.salary);
    if (sal === null) return bad(`Basic salary “${cellText(v.salary)}” is not a number`);
    const g = canon(cellText(v.gender)); const gender = g.startsWith('m') ? 'Male' : g.startsWith('f') ? 'Female' : undefined;
    if (cellText(v.gender) && !gender) return bad('Gender must be Male or Female');
    const mr = canon(cellText(v.marital)); const marital = mr.startsWith('mar') ? 'Married' : mr.startsWith('s') ? 'Single' : undefined;
    const et = canon(cellText(v.type)); const type = et.startsWith('perm') ? 'Permanent' : et.startsWith('contract') ? 'Contract' : et.startsWith('prob') ? 'Probation' : et.startsWith('daily') ? 'Daily Wage' : undefined;
    const old = ctx.profiles.find(p => p.id === emp.id);
    const ow = ctx.overwrite;
    const base: HRProfile = { ...(old || { id: emp.id }), id: emp.id };
    const set = (k: keyof HRProfile, val: any) => { const nv = keep((base as any)[k], val === '' ? undefined : val, ow); if (nv !== undefined) (base as any)[k] = nv; };
    set('designation', cellText(v.designation) || undefined); set('employmentType', type); set('joiningDate', dates.joining || undefined); set('dob', dates.dob || undefined);
    set('gender', gender); set('maritalStatus', marital); set('bloodGroup', cellText(v.blood).toUpperCase() || undefined); set('basicSalary', sal === '' ? undefined : sal);
    set('emiratesId', cellText(v.eid) || undefined); set('emiratesIdExpiry', dates.eidExp || undefined); set('labourCardNo', cellText(v.lc) || undefined); set('labourCardExpiry', dates.lcExp || undefined);
    set('emergencyName', cellText(v.emName) || undefined); set('emergencyRelation', cellText(v.emRel) || undefined); set('emergencyPhone', cellText(v.emPhone) || undefined); set('uaeAddress', cellText(v.address) || undefined);
    if (JSON.stringify(base) === JSON.stringify(old)) return { action: 'skip', message: 'Nothing new (already filled)', summary: 'No change', key: emp.id };
    base.updatedAt = new Date().toISOString(); base.updatedBy = ctx.user;
    const filled = Object.keys(base).filter(k => !['id', 'updatedAt', 'updatedBy'].includes(k) && (base as any)[k] !== (old as any)?.[k]).length;
    return { action: old ? 'update' : 'add', summary: `${filled} field(s)${base.designation ? ` · ${base.designation}` : ''}${base.joiningDate ? ` · joined ${base.joiningDate}` : ''}`, key: emp.id, payload: base };
  },
  async commit(ctx, items) { await bulkUpsertHR('hrProfiles', items as HRProfile[]); return { added: 0, updated: items.length }; },
};

// ─────────── Documents (Emirates ID, labour card, insurance, …) ───────────
const documents: ImportType = {
  id: 'documents', label: 'Documents & expiry dates', blurb: 'Emirates ID, labour card, insurance, licences… number, issue and expiry → Documents tracker', needsEmployee: true, supportsOverwrite: true,
  templateFile: 'Documents_import_template.xlsx',
  cols: [BADGE, NAME, T('type', 'Document Type', ['doctype', 'document', 'documentname', 'type'], 'Emirates ID', true), T('no', 'Document Number', ['docno', 'number', 'documentno', 'idnumber'], '784-1990-1234567-1'),
    D('issue', 'Issue Date', ['issuedate', 'dateofissue', 'issued'], '10/09/2022'), D('expiry', 'Expiry Date', ['expirydate', 'dateofexpiry', 'expiry', 'expires', 'validuntil'], '10/09/2027'), T('notes', 'Notes', ['remarks', 'comment'], '')],
  notes: ['One row per document. The same person can have many rows (one for each document type).', 'Document Type examples: Passport, Visa, Emirates ID, Labour Card, Health Insurance, Driving License, Medical Fitness.', 'If that person already has this document type, it is updated instead of added twice.'],
  build(ctx, v, emp) {
    if (!emp) return bad('Employee not matched');
    const type = pick(DOC_TYPES, cellText(v.type), DOC_SYN);
    if (!type) return bad('Document type is missing');
    const issue = dateOf(v.issue), expiry = dateOf(v.expiry);
    if (issue === null) return bad(dateErr('Issue date', v.issue));
    if (expiry === null) return bad(dateErr('Expiry date', v.expiry));
    if (issue && expiry && expiry <= issue) return bad('Expiry date is not after the issue date');
    const no = cellText(v.no), notes = cellText(v.notes);
    if (!no && !issue && !expiry) return bad('No number or dates on this row');
    const old = ctx.docs.find(d => d.employeeId === emp.id && canon(d.docType) === canon(type));
    const ow = ctx.overwrite;
    const rec: HRDocument = old ? { ...old } : { id: newId('doc'), employeeId: emp.id, employeeName: emp.name, docType: type, createdAt: new Date().toISOString(), createdBy: ctx.user };
    rec.docNumber = keep(old?.docNumber, no || undefined, ow); rec.issueDate = keep(old?.issueDate, issue || undefined, ow); rec.expiryDate = keep(old?.expiryDate, expiry || undefined, ow); rec.notes = keep(old?.notes, notes || undefined, ow);
    if (old && JSON.stringify(rec) === JSON.stringify(old)) return { action: 'skip', message: 'Nothing new (already filled)', summary: 'No change', key: `${emp.id}|${canon(type)}` };
    return { action: old ? 'update' : 'add', summary: `${type}${rec.docNumber ? ` · ${rec.docNumber}` : ''} · expires ${fmtShort(rec.expiryDate)}`, key: `${emp.id}|${canon(type)}`, payload: rec };
  },
  async commit(ctx, items) { await bulkUpsertHR('hrDocuments', items as HRDocument[]); return { added: items.filter(i => !ctx.docs.some(d => d.id === i.id)).length, updated: items.filter(i => ctx.docs.some(d => d.id === i.id)).length }; },
};

// ─────────── Training certificates ───────────
const training: ImportType = {
  id: 'training', label: 'Training certificates', blurb: 'Course, date completed, expiry, certificate number → Safety & Training', needsEmployee: true, supportsOverwrite: false,
  templateFile: 'Training_import_template.xlsx',
  cols: [BADGE, NAME, T('course', 'Course', ['coursename', 'training', 'trainingname', 'certificate'], 'Fire Safety', true), D('done', 'Completed Date', ['completed', 'date', 'trainingdate', 'completiondate'], '05/06/2026', true),
    D('expiry', 'Valid Until', ['expirydate', 'expiry', 'validuntil', 'expires'], '05/06/2027'), T('cert', 'Certificate No', ['certificateno', 'certno', 'certificatenumber'], 'FS-2291'), T('provider', 'Provider', ['trainer', 'institute', 'company'], 'Civil Defence')],
  notes: ['One row per person per course.', 'Rows already recorded (same person, course and date) are skipped, so importing the same file twice is safe.'],
  build(ctx, v, emp) {
    if (!emp) return bad('Employee not matched');
    const course = pick(TRAINING_COURSES, cellText(v.course), COURSE_SYN);
    if (!course) return bad('Course is missing');
    const done = dateOf(v.done), expiry = dateOf(v.expiry);
    if (done === null || done === '') return bad(done === '' ? 'Completed date is missing' : dateErr('Completed date', v.done));
    if (expiry === null) return bad(dateErr('Valid until', v.expiry));
    if (expiry && expiry < done) return bad('Valid-until date is before the completed date');
    if (ctx.training.some(t => t.employeeId === emp.id && canon(t.course) === canon(course) && t.completedDate === done)) return { action: 'skip', message: 'Already recorded', summary: `${course} · ${done}`, key: `${emp.id}|${canon(course)}|${done}` };
    const rec: HRTraining = { id: newId('tr'), employeeId: emp.id, employeeName: emp.name, course, provider: cellText(v.provider) || undefined, completedDate: done, expiryDate: expiry || undefined, certificateNo: cellText(v.cert) || undefined, createdAt: new Date().toISOString() };
    return { action: 'add', summary: `${course} · ${done}${expiry ? ` → ${expiry}` : ''}`, key: `${emp.id}|${canon(course)}|${done}`, payload: rec };
  },
  async commit(ctx, items) { await bulkUpsertHR('hrTraining', items as HRTraining[]); return { added: items.length, updated: 0 }; },
};

// ─────────── PPE ───────────
const ppe: ImportType = {
  id: 'ppe', label: 'PPE issued', blurb: 'Safety shoes, helmets, gloves… with quantity and replacement date → PPE issue log', needsEmployee: true, supportsOverwrite: false,
  templateFile: 'PPE_import_template.xlsx',
  cols: [BADGE, NAME, T('item', 'PPE Item', ['item', 'ppe', 'equipment'], 'Safety Shoes', true), N('qty', 'Quantity', ['qty', 'count', 'pieces'], '1'), T('size', 'Size', [], '42'),
    D('issue', 'Issue Date', ['issued', 'date', 'dateissued'], '01/03/2026', true), N('months', 'Replace After (Months)', ['replaceafter', 'months', 'lifemonths'], '6'), D('replace', 'Replace Due Date', ['replacedate', 'duedate', 'replacedue'], '')],
  notes: ['Give either "Replace After (Months)" or an exact "Replace Due Date". Rows already in the log are skipped.'],
  build(ctx, v, emp) {
    if (!emp) return bad('Employee not matched');
    const item = pick(PPE_ITEMS, cellText(v.item), PPE_SYN);
    if (!item) return bad('PPE item is missing');
    const issue = dateOf(v.issue), replace = dateOf(v.replace);
    if (issue === null || issue === '') return bad(issue === '' ? 'Issue date is missing' : dateErr('Issue date', v.issue));
    if (replace === null) return bad(dateErr('Replace due date', v.replace));
    const qty = parseNum(v.qty), months = parseNum(v.months);
    if (qty === null || (qty !== '' && qty <= 0)) return bad('Quantity must be a positive number');
    if (months === null) return bad('Replace-after months must be a number');
    let due = replace || undefined;
    if (!due && months) { const d = new Date(issue + 'T00:00:00'); d.setMonth(d.getMonth() + months); due = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
    if (ctx.ppe.some(p => p.employeeId === emp.id && canon(p.item) === canon(item) && p.issueDate === issue)) return { action: 'skip', message: 'Already recorded', summary: `${item} · ${issue}`, key: `${emp.id}|${canon(item)}|${issue}` };
    const rec: HRPPE = { id: newId('ppe'), employeeId: emp.id, employeeName: emp.name, item, size: cellText(v.size) || undefined, qty: qty === '' ? 1 : qty, issueDate: issue, replaceDueDate: due, issuedBy: ctx.user, createdAt: new Date().toISOString() };
    return { action: 'add', summary: `${item} ×${rec.qty} · ${issue}${due ? ` · replace ${due}` : ''}`, key: `${emp.id}|${canon(item)}|${issue}`, payload: rec };
  },
  async commit(ctx, items) { await bulkUpsertHR('hrPPE', items as HRPPE[]); return { added: items.length, updated: 0 }; },
};

// ─────────── Vehicles ───────────
const vehicles: ImportType = {
  id: 'vehicles', label: 'Company vehicles', blurb: 'Plate, make, engine & chassis number, registration and insurance expiry, and who has it → Fleet', needsEmployee: false, supportsOverwrite: true,
  templateFile: 'Vehicles_import_template.xlsx',
  cols: [T('plate', 'Plate Number', ['plate', 'platenumber', 'vehicleno', 'carnumber', 'regno'], 'A 12345', true), T('emirate', 'Plate Emirate', ['emirate', 'platesource'], 'Dubai'), T('make', 'Make', ['brand', 'manufacturer'], 'Toyota', true), T('model', 'Model', [], 'Hilux', true),
    N('year', 'Year', ['modelyear', 'yearofmanufacture'], '2022'), T('color', 'Colour', ['color'], 'White'), T('vtype', 'Vehicle Type', ['type', 'bodytype'], 'Pickup'), T('fuel', 'Fuel Type', ['fueltype', 'fuel'], 'Petrol'),
    T('engine', 'Engine Number', ['engineno', 'engine'], 'ENG123456'), T('chassis', 'Chassis Number', ['chassisno', 'chassis', 'vin', 'vinnumber'], 'MR0FB3CD123456789'),
    D('regExp', 'Registration Expiry', ['registrationexpiry', 'mulkiyaexpiry', 'regexpiry'], '15/08/2026'), T('insCo', 'Insurance Company', ['insurance', 'insurer'], 'Orient Insurance'), T('policy', 'Policy Number', ['policyno', 'policy'], 'POL-889'), D('insExp', 'Insurance Expiry', ['insuranceexpiry', 'policyexpiry'], '15/08/2026'),
    D('purchase', 'Purchase Date', ['dateofpurchase', 'bought'], '01/01/2022'), T('assigned', 'Assigned To', ['driver', 'employee', 'assignedto', 'allottedto', 'givento'], 'Ali Hassan Khan'), D('given', 'Date Given', ['assigneddate', 'givendate', 'dategiven'], '01/03/2026'), N('startKm', 'Start Km', ['odometer', 'startodometer', 'km'], '45210')],
  notes: ['One row per vehicle. If the plate already exists the vehicle is updated; its assignment history, files and logs stay.', '"Assigned To" can be a badge number or a name. It is only used when the vehicle is not already assigned.'],
  build(ctx, v) {
    const plate = cellText(v.plate).toUpperCase();
    if (!plate) return bad('Plate number is missing');
    const make = cellText(v.make), model = cellText(v.model);
    const old = ctx.vehicles.find(x => plateKey(x.plate) === plateKey(plate));
    if (!old && (!make || !model)) return bad('Make and model are required for a new vehicle');
    const reg = dateOf(v.regExp), ins = dateOf(v.insExp), pur = dateOf(v.purchase), given = dateOf(v.given);
    for (const [lab, val, raw] of [['Registration expiry', reg, v.regExp], ['Insurance expiry', ins, v.insExp], ['Purchase date', pur, v.purchase], ['Date given', given, v.given]] as const) if (val === null) return bad(dateErr(lab, raw));
    const year = parseNum(v.year), startKm = parseNum(v.startKm);
    if (year === null || startKm === null) return bad('Year / start km must be numbers');
    const f = canon(cellText(v.fuel)); const fuel = f.startsWith('die') ? 'Diesel' : f.startsWith('hyb') ? 'Hybrid' : f.startsWith('el') ? 'Electric' : f.startsWith('pet') || f.startsWith('gas') ? 'Petrol' : undefined;
    const t = canon(cellText(v.vtype)); const vtype = (['Car', 'Pickup', 'Van', 'Truck', 'Bus', 'Other'] as const).find(x => canon(x) === t);
    const ow = ctx.overwrite;
    const base: HRVehicle = old ? { ...old } : { id: newId('veh'), plate, make, model, fuelType: 'Petrol', status: 'Active', assignments: [], createdAt: new Date().toISOString() };
    const set = (k: keyof HRVehicle, val: any) => { const nv = keep((base as any)[k], val === '' ? undefined : val, ow || !old); if (nv !== undefined) (base as any)[k] = nv; };
    set('plateEmirate', cellText(v.emirate) || undefined); set('make', make || undefined); set('model', model || undefined); set('year', year === '' ? undefined : year); set('color', cellText(v.color) || undefined);
    set('vehicleType', vtype); set('fuelType', fuel); set('engineNo', cellText(v.engine).toUpperCase() || undefined); set('chassisNo', cellText(v.chassis).toUpperCase() || undefined);
    set('registrationExpiry', reg || undefined); set('insuranceCompany', cellText(v.insCo) || undefined); set('policyNo', cellText(v.policy) || undefined); set('insuranceExpiry', ins || undefined); set('purchaseDate', pur || undefined);
    let note = '';
    const who = cellText(v.assigned);
    if (who && !currentAssignment(base)) {
      const m = matchEmployee(/^\d+$/.test(who) ? who : '', /^\d+$/.test(who) ? '' : who, ctx.employees);
      if (m.emp && (m.status === 'badge' || m.status === 'name' || m.status === 'name-partial')) {
        base.assignments = [...base.assignments, { id: newId('as'), employeeId: m.emp.id, employeeName: m.emp.name, from: given || new Date().toISOString().slice(0, 10), startKm: startKm === '' ? undefined : startKm }];
        note = ` · given to ${m.emp.name}`;
      } else note = ' · (assigned-to not matched, vehicle added unassigned)';
    }
    if (old && JSON.stringify(base) === JSON.stringify(old)) return { action: 'skip', message: 'Nothing new (already filled)', summary: 'No change', key: plateKey(plate) };
    return { action: old ? 'update' : 'add', summary: `${base.make} ${base.model}${base.engineNo ? ` · eng ${base.engineNo}` : ''}${base.chassisNo ? ` · ch ${base.chassisNo.slice(-6)}` : ''}${note}`, key: plateKey(plate), payload: base };
  },
  async commit(ctx, items) { await bulkUpsertHR('hrVehicles', items as HRVehicle[]); return { added: items.filter(i => !ctx.vehicles.some(x => x.id === i.id)).length, updated: items.filter(i => ctx.vehicles.some(x => x.id === i.id)).length }; },
};

// ─────────── Daily km & fuel ───────────
const fuel: ImportType = {
  id: 'fuel', label: 'Daily km & fuel log', blurb: 'Plate, date, driver, odometer or km, liters and fuel cost → Fleet daily log', needsEmployee: false, supportsOverwrite: false,
  templateFile: 'Fuel_log_import_template.xlsx',
  cols: [T('plate', 'Plate Number', ['plate', 'platenumber', 'vehicleno', 'carnumber', 'regno'], 'A 12345', true), D('date', 'Date', ['logdate', 'day'], '15/11/2026', true), BADGE, NAME,
    N('start', 'Start Km', ['startodometer', 'opening', 'odometerstart'], '45210'), N('end', 'End Km', ['endodometer', 'closing', 'odometerend'], '45290'), N('km', 'Km Driven', ['kmdriven', 'distance', 'kms'], '80'),
    N('liters', 'Liters', ['litres', 'fuelliters', 'fuelqty', 'fuel'], '25'), N('cost', 'Fuel Cost', ['fuelcost', 'amount', 'aed', 'cost'], '57.5'), T('station', 'Station', ['petrolstation', 'fuelstation'], 'ADNOC')],
  notes: ['Driver is optional: fill Badge No or Employee Name; if empty the person who had the car that day is used.', 'Give Start Km + End Km, or just Km Driven. Rows already in the log (same car, date, km and liters) are skipped.'],
  build(ctx, v, _emp, match) {
    const plate = cellText(v.plate);
    if (!plate) return bad('Plate number is missing');
    const veh = ctx.vehicles.find(x => plateKey(x.plate) === plateKey(plate));
    if (!veh) return bad(`Vehicle “${plate}” is not in the Fleet — import vehicles first`);
    const date = dateOf(v.date);
    if (date === null || date === '') return bad(date === '' ? 'Date is missing' : dateErr('Date', v.date));
    const s = parseNum(v.start), e = parseNum(v.end), kmIn = parseNum(v.km), liters = parseNum(v.liters), cost = parseNum(v.cost);
    if ([s, e, kmIn, liters, cost].some(x => x === null)) return bad('Km, liters and cost must be numbers');
    let km = 0;
    if (s !== '' && e !== '') { if ((e as number) < (s as number)) return bad('End km is lower than start km'); km = (e as number) - (s as number); }
    else if (kmIn !== '') km = kmIn as number;
    if (km <= 0 && !(liters && (liters as number) > 0)) return bad('Enter the km driven or the fuel filled');
    if (km > 1500) return bad(`${km} km in one day looks wrong — please check`);
    if ((liters as number) > 200) return bad(`${liters} liters in one fill looks wrong — please check`);
    const dup = ctx.logs.some(l => l.vehicleId === veh.id && l.date === date && l.km === km && (l.liters || 0) === ((liters as number) || 0));
    if (dup) return { action: 'skip', message: 'Already in the log', summary: `${veh.plate} · ${date}`, key: `${veh.id}|${date}|${km}|${liters}` };
    // driver: matched person, otherwise whoever had the car that day
    const drv = match.emp && ['badge', 'name', 'name-partial'].includes(match.status) ? match.emp : undefined;
    const fallback = !drv ? veh.assignments.filter(a => a.from <= date && (!a.to || a.to >= date)).sort((a, b) => b.from.localeCompare(a.from))[0] : undefined;
    const rec: HRFuelLog = {
      id: newId('fl'), vehicleId: veh.id, plate: veh.plate, date, employeeId: drv?.id || fallback?.employeeId, employeeName: drv?.name || fallback?.employeeName,
      startKm: s === '' ? undefined : (s as number), endKm: e === '' ? undefined : (e as number), km, liters: liters === '' ? undefined : (liters as number), fuelCost: cost === '' ? undefined : (cost as number),
      station: cellText(v.station) || undefined, createdBy: ctx.user, createdAt: new Date().toISOString(),
    };
    return { action: 'add', summary: `${veh.plate} · ${date} · ${km} km${rec.liters ? ` · ${rec.liters} L` : ''}${rec.employeeName ? ` · ${rec.employeeName}` : ''}`, key: `${veh.id}|${date}|${km}|${liters}`, payload: rec };
  },
  async commit(_ctx, items) { await bulkUpsertHR('hrFuelLogs', items as HRFuelLog[]); return { added: items.length, updated: 0 }; },
};

export const IMPORT_TYPES: Record<ImportTypeId, ImportType> = { passport, profile, documents, training, ppe, vehicles, fuel };
export const IMPORT_ORDER: ImportTypeId[] = ['passport', 'profile', 'documents', 'training', 'ppe', 'vehicles', 'fuel'];
