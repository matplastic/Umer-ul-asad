import React, { useEffect, useMemo, useState } from 'react';
import { BellRing, Mail, Send, RefreshCw, CheckCircle2, AlertTriangle, Save } from 'lucide-react';
import { auth } from '../../lib/googleDrive';
import {
  HRReminderSettings, REMINDER_CATEGORIES, REMINDER_DEFAULTS, subscribeReminderSettings, saveReminderSettings, logAudit, fmtD,
} from '../../lib/hrStore';
import { SectionCard, StatCard, Badge, Empty, inputCls, btnPrimary, btnGhost, runSave, hrToast } from './hrUi';

interface PreviewItem { key: string; category: string; categoryLabel: string; who: string; what: string; date: string; daysLeft: number; bucket: string | null; willSend: boolean; why: string; detail?: string }
interface RunResult { ok?: boolean; items?: PreviewItem[]; summary?: { total: number; expired: number; willSend: number }; emailConfigured?: boolean; recipients?: number; sent?: number; message?: string; skipped?: string; to?: string[] }

const DAY_CHOICES = [90, 60, 45, 30, 21, 14, 7, 3, 1, 0];
const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

async function callApi(action: 'status' | 'preview' | 'test' | 'send', extra: Record<string, unknown> = {}): Promise<RunResult> {
  const user = auth.currentUser;
  if (!user) throw new Error('Your session has expired. Please log out and sign in again.');
  const token = await user.getIdToken();
  const res = await fetch('/.netlify/functions/hr-expiry-run', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ action, ...extra }),
  });
  let data: any = {};
  try { data = await res.json(); } catch { /* not json */ }
  if (!res.ok) throw new Error(data?.error || (res.status === 404 ? 'The reminder service is not deployed yet (functions are published with the site).' : `The reminder service returned an error (${res.status}).`));
  return data as RunResult;
}

// Sample rows for the demo screen (HR Administration)
const DEMO_ITEMS: PreviewItem[] = [
  { key: 'd1', category: 'passport', categoryLabel: 'Passports', who: 'Sample Employee A', what: 'Passport', date: '2026-12-02', daysLeft: 10, bucket: 'T14', willSend: true, why: 'First reminder' },
  { key: 'd2', category: 'visa', categoryLabel: 'Visas', who: 'Sample Employee B', what: 'Visa', date: '2026-11-10', daysLeft: -12, bucket: 'expired', willSend: true, why: 'Still expired' },
  { key: 'd3', category: 'vehicle', categoryLabel: 'Vehicle registration & insurance', who: 'A 12345', what: 'Insurance', date: '2027-01-05', daysLeft: 44, bucket: 'T60', willSend: false, why: 'Already reminded' },
];

export const ExpiryReminders: React.FC<{ user?: string; demo?: boolean }> = ({ user, demo }) => {
  const [saved, setSaved] = useState<HRReminderSettings>(REMINDER_DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState<HRReminderSettings>(REMINDER_DEFAULTS);
  const [recipientsText, setRecipientsText] = useState('');
  const [status, setStatus] = useState<RunResult | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (demo) { setLoaded(true); return; }
    return subscribeReminderSettings(s => { setSaved(s); setLoaded(true); setDirty(d => { if (!d) { setDraft(s); setRecipientsText(s.recipients.join('\n')); } return d; }); });
  }, [demo]);

  const refreshStatus = async () => {
    if (demo) { setStatus({ ok: true, emailConfigured: true, recipients: 2, summary: { total: 3, expired: 1, willSend: 2 } }); return; }
    try { setStatusErr(null); setStatus(await callApi('status')); } catch (e: any) { setStatus(null); setStatusErr(e?.message || 'Could not reach the reminder service.'); }
  };
  useEffect(() => { refreshStatus(); /* eslint-disable-next-line */ }, [demo]);

  const edit = (patch: Partial<HRReminderSettings>) => { setDraft(d => ({ ...d, ...patch })); setDirty(true); };
  const recipients = useMemo(() => recipientsText.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean), [recipientsText]);
  const badEmails = recipients.filter(r => !isEmail(r));

  const toggleDay = (n: number) => edit({ daysBefore: draft.daysBefore.includes(n) ? draft.daysBefore.filter(x => x !== n) : [...draft.daysBefore, n].sort((a, b) => b - a) });

  const save = async () => {
    if (badEmails.length) { hrToast(`Not a valid e-mail: ${badEmails[0]}`, 'err'); return false; }
    if (draft.daysBefore.length === 0) { hrToast('Choose at least one reminder day', 'err'); return false; }
    const next = { enabled: draft.enabled, recipients, daysBefore: [...draft.daysBefore].sort((a, b) => b - a), categories: draft.categories, reRemindExpiredEveryDays: Math.max(1, Number(draft.reRemindExpiredEveryDays) || 7) };
    if (demo) { setDirty(false); hrToast('Settings saved'); return true; }
    const ok = await runSave(() => saveReminderSettings(next), 'Reminder settings saved');
    if (ok) { setDirty(false); logAudit(user, 'Expiry reminders', `Saved settings (${recipients.length} recipient(s), ${next.daysBefore.join('/')} days)`); refreshStatus(); }
    return ok;
  };

  const run = async (action: 'preview' | 'test' | 'send', extra: Record<string, unknown> = {}) => {
    if (dirty && !(await save())) return;
    setBusy(action + (extra.force ? '-force' : ''));
    try {
      if (demo) {
        if (action === 'preview') setPreview(DEMO_ITEMS); else hrToast(action === 'test' ? 'Test e-mail sent' : 'Reminders sent');
        return;
      }
      const r = await callApi(action, extra);
      if (action === 'preview') { setPreview(r.items || []); setStatus(s => ({ ...(s || {}), ...r, items: undefined })); }
      else if (action === 'test') hrToast(`Test e-mail sent to ${(r.to || []).join(', ')}`);
      else { hrToast(r.sent ? `${r.sent} reminder(s) e-mailed to ${(r.to || []).join(', ')}` : (r.message || 'Nothing new to send')); logAudit(user, 'Expiry reminders', r.sent ? `Sent ${r.sent} reminder(s)${extra.force ? ' (full summary)' : ''}` : 'Checked — nothing new'); refreshStatus(); }
    } catch (e: any) { hrToast(e?.message || 'Something went wrong', 'err'); }
    finally { setBusy(null); }
  };

  const items = preview || [];
  const lastRun = saved.lastRunAt ? new Date(saved.lastRunAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : null;
  const tone = (d: number) => d < 0 ? 'rose' : d <= 7 ? 'amber' : d <= 30 ? 'sky' : 'slate';

  if (!loaded) return <Empty text="Loading…" />;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="E-mail service" value={status ? (status.emailConfigured ? 'Ready' : 'Not set up') : '…'} tone={status?.emailConfigured ? 'emerald' : 'rose'} icon={<Mail className="h-4 w-4" />} sub={status && !status.emailConfigured ? 'RESEND_API_KEY missing' : undefined} />
        <StatCard label="Recipients" value={recipients.length || status?.recipients || 0} tone={(recipients.length || status?.recipients) ? 'violet' : 'amber'} sub={!(recipients.length || status?.recipients) ? 'Add an e-mail below' : undefined} />
        <StatCard label="Schedule" value="Every day" sub="08:00 AM UAE time" tone="slate" icon={<BellRing className="h-4 w-4" />} />
        <StatCard label="Last run" value={lastRun || 'Not yet'} sub={lastRun ? `${saved.lastRunSent ?? 0} sent · ${saved.lastRunDue ?? 0} in window${saved.lastRunNote ? ` · ${saved.lastRunNote}` : ''}` : 'Runs after the next deploy'} tone="slate" />
      </div>
      {statusErr && <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-4 py-3 text-sm"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /><span>{statusErr}</span></div>}

      <SectionCard title="Who gets the e-mails" right={<label className="flex items-center gap-2 text-xs font-bold text-slate-600"><input type="checkbox" className="accent-emerald-600" checked={draft.enabled} onChange={e => edit({ enabled: e.target.checked })} />Reminders ON</label>}>
        <textarea rows={3} className={inputCls + ' resize-none font-mono text-xs'} value={recipientsText} onChange={e => { setRecipientsText(e.target.value); setDirty(true); }} placeholder={'hr.manager@company.com\nops@company.com'} />
        <p className={`text-[11px] mt-1 ${badEmails.length ? 'text-rose-600 font-semibold' : 'text-slate-400'}`}>{badEmails.length ? `Check: ${badEmails.join(', ')}` : 'One e-mail address per line (or separated by commas). Everyone listed gets the same daily summary.'}</p>
      </SectionCard>

      <SectionCard title="When to remind">
        <div className="flex flex-wrap gap-1.5">
          {DAY_CHOICES.map(n => (
            <button key={n} onClick={() => toggleDay(n)} className={`px-3 py-1.5 rounded-full text-xs font-bold border ${draft.daysBefore.includes(n) ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>{n === 0 ? 'On the day' : `${n} days before`}</button>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-3 text-sm text-slate-600">Once expired, remind again every
          <input type="number" min={1} max={60} className={inputCls + ' !w-20'} value={draft.reRemindExpiredEveryDays} onChange={e => edit({ reRemindExpiredEveryDays: Number(e.target.value) })} /> days until renewed.</div>
        <p className="text-[11px] text-slate-400 mt-2">You get ONE e-mail each time something enters a window (for example when a passport reaches "30 days before"), not one every morning. Renewing an item starts a fresh cycle.</p>
      </SectionCard>

      <SectionCard title="What to watch">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1.5">
          {REMINDER_CATEGORIES.map(c => (
            <label key={c.id} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer"><input type="checkbox" className="accent-violet-600" checked={draft.categories[c.id] !== false} onChange={e => edit({ categories: { ...draft.categories, [c.id]: e.target.checked } })} />{c.label}</label>
          ))}
        </div>
      </SectionCard>

      <div className="flex flex-wrap gap-2 items-center">
        <button className={btnPrimary} disabled={!dirty || !!busy} onClick={save}><Save className="h-4 w-4" />Save settings</button>
        <button className={btnGhost} disabled={!!busy} onClick={() => run('preview')}><RefreshCw className={`h-3.5 w-3.5 ${busy === 'preview' ? 'animate-spin' : ''}`} />Check what is due now</button>
        <button className={btnGhost} disabled={!!busy} onClick={() => run('test')}><Mail className="h-3.5 w-3.5" />Send test e-mail</button>
        <button className={btnGhost} disabled={!!busy} onClick={() => run('send')}><Send className="h-3.5 w-3.5" />Send new reminders now</button>
        <button className={btnGhost} disabled={!!busy} onClick={() => run('send', { force: true })}>E-mail the full summary now</button>
        {dirty && <Badge tone="amber">Unsaved changes</Badge>}
      </div>

      {preview && (
        <SectionCard title={`Due now (${items.filter(i => i.bucket).length})`} right={<span className="text-xs text-slate-400">{items.filter(i => i.willSend).length} would be e-mailed on the next run</span>}>
          {items.filter(i => i.bucket).length === 0 ? <div className="flex items-center gap-2 text-sm text-emerald-700 font-semibold py-4 justify-center"><CheckCircle2 className="h-4 w-4" />Nothing is due in the chosen windows.</div> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] uppercase text-slate-400 border-b border-slate-100"><th className="py-2 pr-3">Who / what</th><th className="py-2 pr-3">Item</th><th className="py-2 pr-3">Date</th><th className="py-2 pr-3">Status</th><th className="py-2">E-mail</th></tr></thead>
                <tbody className="divide-y divide-slate-50">
                  {items.filter(i => i.bucket).map(i => (
                    <tr key={i.key}>
                      <td className="py-1.5 pr-3"><div className="font-semibold text-slate-800">{i.who}</div><div className="text-[11px] text-slate-400">{i.categoryLabel}</div></td>
                      <td className="py-1.5 pr-3">{i.what}</td><td className="py-1.5 pr-3 whitespace-nowrap">{fmtD(i.date)}</td>
                      <td className="py-1.5 pr-3"><Badge tone={tone(i.daysLeft) as any}>{i.daysLeft < 0 ? `Expired ${-i.daysLeft}d ago` : i.daysLeft === 0 ? 'Today' : `${i.daysLeft} days left`}</Badge></td>
                      <td className="py-1.5 text-xs">{i.willSend ? <span className="text-emerald-700 font-semibold">Will send · {i.why}</span> : <span className="text-slate-400">{i.why}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}
    </div>
  );
};
