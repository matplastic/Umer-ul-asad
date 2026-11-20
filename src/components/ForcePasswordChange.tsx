import React, { useState } from 'react';
import { Lock, Eye, EyeOff } from 'lucide-react';
import { MatLogo } from './MatLogo';
import { changeOwnPassword, validatePasswordStrength, type AuthUser } from '../lib/authClient';

// Shown right after login when the account still has a temporary password
// (mustChangePassword) — e.g. after Management resets everyone's password.
export const ForcePasswordChange: React.FC<{ user: AuthUser; onDone: () => void; onLogout: () => void }> = ({ user, onDone, onLogout }) => {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!current) { setError('Enter your temporary password.'); return; }
    const weak = validatePasswordStrength(next);
    if (weak) { setError(weak); return; }
    if (next === current) { setError('Choose a new password that is different from the temporary one.'); return; }
    if (next !== confirm) { setError('The new passwords do not match.'); return; }
    setSaving(true);
    try {
      await changeOwnPassword(current, next);
      onDone();
    } catch (err: any) {
      setError(err?.message || 'Could not change the password.');
      setSaving(false);
    }
  };

  const input = 'w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-300';
  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-md bg-white rounded-2xl shadow-lg border border-slate-200 p-6 space-y-4">
        <div className="flex items-center gap-3">
          <MatLogo className="h-10 w-auto shrink-0" />
          <div>
            <h1 className="text-base font-black text-slate-800">Set your new password</h1>
            <p className="text-xs text-slate-500">Hello {user.displayName} — you are using a temporary password. Please choose your own before continuing.</p>
          </div>
        </div>
        <label className="block text-xs font-bold text-slate-600">Temporary password
          <input type={show ? 'text' : 'password'} value={current} onChange={e => setCurrent(e.target.value)} autoComplete="current-password" className={`${input} mt-1`} />
        </label>
        <label className="block text-xs font-bold text-slate-600">New password (at least 8 characters)
          <input type={show ? 'text' : 'password'} value={next} onChange={e => setNext(e.target.value)} autoComplete="new-password" className={`${input} mt-1`} />
        </label>
        <label className="block text-xs font-bold text-slate-600">Repeat new password
          <input type={show ? 'text' : 'password'} value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" className={`${input} mt-1`} />
        </label>
        <button type="button" onClick={() => setShow(v => !v)} className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
          {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />} {show ? 'Hide' : 'Show'} passwords
        </button>
        {error && <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700">{error}</div>}
        <div className="flex items-center justify-between gap-3 pt-1">
          <button type="button" onClick={onLogout} className="text-xs font-bold text-slate-500 hover:underline">Log out</button>
          <button type="submit" disabled={saving} className="flex items-center gap-1.5 rounded-xl bg-teal-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-teal-800 disabled:opacity-60">
            <Lock className="h-4 w-4" /> {saving ? 'Saving…' : 'Save and continue'}
          </button>
        </div>
      </form>
    </div>
  );
};
