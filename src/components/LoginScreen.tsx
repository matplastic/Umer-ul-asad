import React, { useState } from 'react';
import { ViewRole } from '../types';
import { Factory, User, Lock, ChevronRight, ShieldAlert, Eye, EyeOff } from 'lucide-react';
import { loginWithPassword, type AuthUser } from '../lib/authClient';

interface LoginScreenProps {
  onLoginSuccess: (user: AuthUser) => void;
}

// Cosmetic copy only — the account's role (decided by HR/Management when the
// account was created) is what actually determines which portal opens after
// sign-in, not anything the person picks here.
const ROLE_LABELS: Record<ViewRole, string> = {
  management: 'Executive Management',
  planning_department: 'Planning Department',
  production_engineer: 'Production Engineering',
  quality_inspector: 'Quality Assurance',
  stage_worker: 'Stage Shop Floor',
  trolley_prod: 'Trolley Production Supervisor',
  factory_entrance: 'Factory Entrance TV Monitor',
  section_dashboard: 'Section TV Dashboard',
  hr_portal: 'HR Management Portal',
  store: 'Store & Inventory',
  section_supervisor: 'Section Supervisor',
  reports_analytics: 'Reports & Analytics',
};

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleLoginSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!username.trim() || !password) {
      setErrorMsg('Enter both your username and password.');
      return;
    }
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const user = await loginWithPassword(username.trim(), password);
      onLoginSuccess(user);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Incorrect username or password.');
      setPassword('');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-between p-4 sm:p-6 md:p-8 font-sans text-slate-100 antialiased selection:bg-indigo-500/40">

      {/* Top Banner */}
      <header className="max-w-6xl w-full mx-auto flex items-center justify-between py-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-tr from-cyan-500 to-indigo-600 p-2.5 rounded-xl shadow-inner text-white">
            <Factory className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tight text-white flex items-center gap-1.5 flex-wrap">
              MAT PLASTIC INDUSTRIES LLC
              <span className="text-[10px] text-cyan-400 font-mono uppercase px-2 py-0.5 bg-slate-800 border border-slate-700 rounded-full font-bold">
                ERP Secure Gate
              </span>
            </h1>
            <p className="text-xs text-slate-400">Flow-Based Shop Floor Scheduling & Quality Control</p>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-md w-full mx-auto my-auto py-10">
        <div className="bg-gradient-to-b from-slate-800/90 to-slate-900/90 border border-slate-700/60 rounded-2xl p-7 sm:p-8 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 rounded-t-2xl" />

          <div className="mb-6 space-y-1">
            <h2 className="text-base font-black uppercase text-slate-200 tracking-wider flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
              Sign In
            </h2>
            <p className="text-xs text-slate-400">
              Use the username and password issued to you by HR or Management. Your portal opens automatically based on your assigned role.
            </p>
          </div>

          <form onSubmit={handleLoginSubmit} className="flex flex-col gap-4">
            <div className="space-y-1.5">
              <label className="text-[11px] uppercase tracking-wider font-bold text-slate-400">Username</label>
              <div className="flex items-center gap-2 bg-slate-900/60 border border-slate-700 rounded-xl px-3.5 py-3 focus-within:border-indigo-500 transition-colors">
                <User className="h-4 w-4 text-slate-500 shrink-0" />
                <input
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoFocus
                  value={username}
                  onChange={(e) => { setUsername(e.target.value); setErrorMsg(null); }}
                  placeholder="e.g. j.smith"
                  className="bg-transparent w-full text-sm text-white placeholder-slate-600 outline-none"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] uppercase tracking-wider font-bold text-slate-400">Password</label>
              <div className="flex items-center gap-2 bg-slate-900/60 border border-slate-700 rounded-xl px-3.5 py-3 focus-within:border-indigo-500 transition-colors">
                <Lock className="h-4 w-4 text-slate-500 shrink-0" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setErrorMsg(null); }}
                  placeholder="••••••••"
                  className="bg-transparent w-full text-sm text-white placeholder-slate-600 outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="text-slate-500 hover:text-slate-300 shrink-0"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {errorMsg && (
              <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                <ShieldAlert className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-red-400 leading-relaxed">{errorMsg}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full h-14 mt-2 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-black uppercase tracking-widest text-sm flex items-center justify-center gap-2 transition-all duration-150 shadow-lg shadow-indigo-500/20 active:scale-[0.98]"
            >
              {isSubmitting ? 'Signing in…' : 'Sign In'}
              {!isSubmitting && <ChevronRight className="h-4 w-4" />}
            </button>
          </form>

          <div className="mt-6 bg-slate-900/60 border border-slate-800/80 rounded-xl p-4 flex gap-3 items-start">
            <ShieldAlert className="h-4 w-4 text-cyan-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Don't have an account yet? Ask HR or Management to create one for you from the HR Portal's Accounts tab. Every login is tied to a named person and is logged.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-6xl w-full mx-auto py-4 border-t border-slate-800 flex items-center justify-between">
        <p className="text-[10px] text-slate-600">
          © {new Date().getFullYear()} MAT Plastic Industries LLC — All access is monitored and logged.
        </p>
        <p className="text-[10px] text-slate-700 font-mono">ERP v2.0 · Secure Gate</p>
      </footer>
    </div>
  );
};

export { ROLE_LABELS };
