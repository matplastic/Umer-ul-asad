import React, { useState, useEffect } from 'react';
import { ViewRole } from '../types';
import { Factory, User, Lock, ChevronRight, ShieldAlert, Eye, EyeOff } from 'lucide-react';
import { loginWithPassword, type AuthUser } from '../lib/authClient';

interface LoginScreenProps {
  onLoginSuccess: (user: AuthUser) => void;
  /** Shows a "you were signed out due to inactivity" notice instead of a
   *  plain sign-in screen — set when useIdleTimeout triggers a logout. */
  idleLoggedOut?: boolean;
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
  factory_supervisor: 'Factory Supervisor',
  factory_entrance: 'Factory Entrance TV Monitor',
  section_dashboard: 'Section TV Dashboard',
  hr_portal: 'HR Management Portal',
  store: 'Store & Inventory',
  section_supervisor: 'Section Supervisor',
  reports_analytics: 'Reports & Analytics',
};

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess, idleLoggedOut }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // One-time walk-in intro: the figure walks in, sets the bag on the floor,
  // then — once it's actually resting on the ground — the bag opens and the
  // sign-in card grows up out of it. `walkerArrived` just freezes the
  // limb-swing keyframes once the walk cycle finishes.
  const [walkerArrived, setWalkerArrived] = useState(false);
  const [bagOpen, setBagOpen] = useState(false);
  useEffect(() => {
    const t1 = setTimeout(() => setWalkerArrived(true), 2600);
    // Bag lands on the floor at 2.5s + 0.5s drop = ~3.0s. Give it a short
    // beat sitting closed on the ground, then open it.
    const t2 = setTimeout(() => setBagOpen(true), 3100);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  // Success state: once credentials check out, we hold the user here and
  // show a "Welcome" moment before actually handing off to onLoginSuccess
  // (which swaps the whole screen for the person's portal).
  const [successUser, setSuccessUser] = useState<AuthUser | null>(null);

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
      setSuccessUser(user);
      setTimeout(() => onLoginSuccess(user), 1500);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Incorrect username or password.');
      setPassword('');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen flex flex-col justify-between p-4 sm:p-6 md:p-8 font-sans text-slate-100 antialiased selection:bg-teal-500/40 overflow-hidden" style={{ background: 'radial-gradient(120% 120% at 50% 0%, #0c2a28 0%, #071815 55%, #030c0b 100%)' }}>
        <style>{`
          @keyframes matAuroraFloat1{ 0%,100%{ transform: translate(0,0) scale(1); } 33%{ transform: translate(80px,60px) scale(1.15); } 66%{ transform: translate(-40px,90px) scale(0.9); } }
          @keyframes matAuroraFloat2{ 0%,100%{ transform: translate(0,0) scale(1); } 50%{ transform: translate(-90px,-70px) scale(1.2); } }
          @keyframes matAuroraFloat3{ 0%,100%{ transform: translate(0,0) scale(1) rotate(0deg); } 50%{ transform: translate(-60px,50px) scale(1.1) rotate(20deg); } }
          @keyframes matAuroraFloat4{ 0%,100%{ transform: translate(0,0) scale(1); } 50%{ transform: translate(70px,-40px) scale(1.15); } }
          @keyframes matCardIn{ 0%{ opacity:0; transform:translateY(180px) scale(0.08); } 55%{ opacity:1; } 100%{ opacity:1; transform:translateY(0) scale(1); } }
          .mat-blob{ position:absolute; border-radius:50%; filter:blur(70px); mix-blend-mode:screen; will-change:transform; pointer-events:none; }

          @keyframes matWalkIn{ 0%{ left:-120px; opacity:0; } 10%{ opacity:1; } 75%,100%{ left:calc(50% - 200px); } }
          @keyframes matLegSwing{ 0%,100%{ transform:rotate(18deg); } 50%{ transform:rotate(-18deg); } }
          @keyframes matArmSwing{ 0%,100%{ transform:rotate(-14deg); } 50%{ transform:rotate(14deg); } }
          @keyframes matBodyBob{ 0%,100%{ transform:translateY(0); } 50%{ transform:translateY(-4px); } }
          @keyframes matBagDrop{ from{ opacity:0; transform:translateX(160px) translateY(-14px) scale(0.9); } to{ opacity:1; transform:translateX(160px) translateY(0) scale(1); } }
          .mat-walker{ position:absolute; bottom:calc(50% - 210px); width:90px; height:210px; left:-120px; animation:matWalkIn 2.6s cubic-bezier(.4,0,.2,1) forwards; pointer-events:none; z-index:4; }
          .mat-walker svg{ width:100%; height:100%; overflow:visible; }
          .mat-leg{ transform-origin:50% 0%; animation:matLegSwing 0.5s ease-in-out infinite; }
          .mat-leg.mat-back{ animation-delay:0.25s; }
          .mat-arm{ transform-origin:50% 0%; animation:matArmSwing 0.5s ease-in-out infinite; }
          .mat-arm.mat-back{ animation-delay:0.25s; }
          .mat-bob{ animation:matBodyBob 0.5s ease-in-out infinite; }
          .mat-walker.mat-arrived .mat-bob, .mat-walker.mat-arrived .mat-leg, .mat-walker.mat-arrived .mat-arm{ animation-play-state:paused; }
          .mat-bag{ position:absolute; bottom:calc(50% - 26px); width:54px; height:40px; opacity:0; transform:translateX(160px); animation:matBagDrop 0.5s ease-out forwards; animation-delay:2.5s; z-index:4; pointer-events:none; }

          @keyframes matBagFlapOpen{ from{ transform:rotate(0deg); } to{ transform:rotate(-118deg); } }
          @keyframes matBagGlow{ from{ opacity:0; transform:scale(0.4) translateY(6px); } 60%{ opacity:1; } to{ opacity:0.9; transform:scale(1) translateY(-38px); } }
          .mat-bag-flap{ transform-origin:20px 12px; transition: transform 0.55s cubic-bezier(.34,1.56,.64,1); }
          /* Bag stays put on the floor (translateX(160px), same resting spot
             the walk-in already dropped it at) — only the flap swings open. */
          .mat-bag.mat-bag-open .mat-bag-flap{ animation:matBagFlapOpen 0.55s cubic-bezier(.34,1.56,.64,1) forwards; animation-delay:0.05s; }
          .mat-bag-glow{ opacity:0; transform-origin:50% 100%; }
          .mat-bag.mat-bag-open .mat-bag-glow{ animation:matBagGlow 0.7s ease-out forwards; animation-delay:0.35s; }

          @keyframes matWelcomeIn{ from{ opacity:0; transform:translateY(10px) scale(0.96); } to{ opacity:1; transform:translateY(0) scale(1); } }
          .mat-welcome-overlay{ animation:matWelcomeIn 0.45s cubic-bezier(.16,1,.3,1) forwards; animation-delay:0.55s; opacity:0; }
        `}</style>

        {/* One-time walk-in intro: figure walks to center, sets the bag down,
            then the login card unfolds — purely decorative, doesn't affect
            the actual sign-in form or its handlers below. */}
        <div className={`mat-walker${walkerArrived ? ' mat-arrived' : ''}`}>
          <svg viewBox="0 0 90 210">
            <g className="mat-arm mat-back" style={{ transformOrigin: '50px 70px' }}>
              <rect x="45" y="70" width="10" height="55" rx="5" fill="#0a3a3c" />
            </g>
            <g className="mat-leg mat-back" style={{ transformOrigin: '50px 140px' }}>
              <rect x="45" y="140" width="12" height="60" rx="6" fill="#062827" />
            </g>
            <g className="mat-bob">
              <g className="mat-leg" style={{ transformOrigin: '38px 140px' }}>
                <rect x="32" y="140" width="12" height="60" rx="6" fill="#0d4b4d" />
              </g>
              <rect x="24" y="55" width="42" height="90" rx="14" fill="#0E7C86" />
              <circle cx="45" cy="35" r="22" fill="#E8B98C" />
              <path d="M23 30 a22 22 0 0 1 44 0 q-4 -10 -22 -10 t-22 10z" fill="#3a2a1e" />
              <g className="mat-arm" style={{ transformOrigin: '34px 70px' }}>
                <rect x="29" y="70" width="10" height="55" rx="5" fill="#14B8AE" />
              </g>
            </g>
          </svg>
        </div>
        <div className={`mat-bag${bagOpen ? ' mat-bag-open' : ''}`}>
          <svg viewBox="0 0 54 60" width="54" height="60" style={{ overflow: 'visible' }}>
            {/* soft glow that rises out of the bag once it opens */}
            <ellipse className="mat-bag-glow" cx="27" cy="14" rx="16" ry="12" fill="#6EE7E0" opacity="0.9" style={{ filter: 'blur(6px)' }} />
            {/* bag body */}
            <rect x="2" y="30" width="50" height="28" rx="4" fill="#E7B96A" />
            <rect x="2" y="30" width="50" height="8" rx="4" fill="#D9A852" />
            {/* handle */}
            <rect x="18" y="22" width="18" height="12" rx="4" fill="none" stroke="#E7B96A" strokeWidth="4" />
            {/* flap that swings open like a lid */}
            <g className="mat-bag-flap">
              <rect x="4" y="26" width="46" height="8" rx="3" fill="#F3CE8E" />
            </g>
          </svg>
        </div>

        {/* Animated aurora background blobs */}
        <div className="mat-blob" style={{ width:520, height:520, top:-120, left:-100, opacity:0.55, background:'radial-gradient(circle at 30% 30%, #14B8AE, transparent 70%)', animation:'matAuroraFloat1 16s ease-in-out infinite' }} />
        <div className="mat-blob" style={{ width:460, height:460, bottom:-140, right:-80, opacity:0.32, background:'radial-gradient(circle at 40% 40%, #E7B96A, transparent 70%)', animation:'matAuroraFloat2 20s ease-in-out infinite' }} />
        <div className="mat-blob" style={{ width:400, height:400, top:'30%', right:'10%', opacity:0.5, background:'radial-gradient(circle at 50% 50%, #0B4F52, transparent 70%)', animation:'matAuroraFloat3 18s ease-in-out infinite' }} />
        <div className="mat-blob" style={{ width:340, height:340, bottom:'10%', left:'8%', opacity:0.4, background:'radial-gradient(circle at 50% 50%, #6EE7E0, transparent 70%)', animation:'matAuroraFloat4 14s ease-in-out infinite' }} />

      {/* Top Banner */}
      <header className="relative z-10 max-w-6xl w-full mx-auto flex items-center justify-between py-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-tr from-teal-400 to-teal-800 p-2.5 rounded-xl shadow-inner text-white">
            <Factory className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tight text-white flex items-center gap-1.5 flex-wrap">
              MAT PLASTIC INDUSTRIES LLC
              <span className="text-[10px] text-teal-300 font-mono uppercase px-2 py-0.5 bg-white/5 border border-white/10 rounded-full font-bold">
                ERP Secure Gate
              </span>
            </h1>
            <p className="text-xs text-slate-400">Flow-Based Shop Floor Scheduling & Quality Control</p>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="relative z-10 max-w-md w-full mx-auto my-auto py-10">
        <div
          className="rounded-2xl p-7 sm:p-8 shadow-2xl relative overflow-hidden border border-white/[0.14]"
          style={{
            background: 'rgba(255,255,255,0.06)',
            backdropFilter: 'blur(22px) saturate(140%)',
            WebkitBackdropFilter: 'blur(22px) saturate(140%)',
            boxShadow: '0 20px 60px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.08)',
            animation: 'matCardIn 0.85s cubic-bezier(.16,1,.3,1) both',
            animationDelay: '3.15s',
            transformOrigin: '50% 100%',
            opacity: 0,
          }}
        >
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-teal-300 via-teal-500 to-amber-400 rounded-t-2xl" />

          {successUser && (
            <div
              className="mat-welcome-overlay absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 text-center px-6"
              style={{
                background: 'rgba(7,24,21,0.82)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
              }}
            >
              <div className="h-14 w-14 rounded-full bg-gradient-to-tr from-teal-400 to-teal-700 flex items-center justify-center shadow-lg shadow-teal-500/30">
                <User className="h-7 w-7 text-white" />
              </div>
              <h3 className="text-xl font-black text-white tracking-tight">
                Welcome, {successUser.displayName || successUser.username}
              </h3>
              <p className="text-xs text-teal-200/80">Opening your {ROLE_LABELS[successUser.role]} portal…</p>
            </div>
          )}

          <div className="mb-6 space-y-1">
            <h2 className="text-base font-black uppercase text-slate-100 tracking-wider flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-teal-400 animate-pulse" />
              Sign In
            </h2>
            <p className="text-xs text-slate-400">
              Use the username and password issued to you by HR or Management. Your portal opens automatically based on your assigned role.
            </p>
          </div>

          {idleLoggedOut && (
            <div className="mb-5 flex items-start gap-2.5 bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs rounded-xl px-3.5 py-3">
              <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
              <span>You were signed out after 30 minutes of inactivity. Sign in again to continue.</span>
            </div>
          )}

          <form onSubmit={handleLoginSubmit} className="flex flex-col gap-4">
            <div className="space-y-1.5">
              <label className="text-[11px] uppercase tracking-wider font-bold text-slate-400">Username</label>
              <div className="flex items-center gap-2 bg-black/20 border border-white/10 rounded-xl px-3.5 py-3 focus-within:border-teal-400 transition-colors">
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
              <div className="flex items-center gap-2 bg-black/20 border border-white/10 rounded-xl px-3.5 py-3 focus-within:border-teal-400 transition-colors">
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
              className="w-full h-14 mt-2 rounded-xl bg-gradient-to-r from-teal-500 to-teal-800 hover:from-teal-400 hover:to-teal-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-black uppercase tracking-widest text-sm flex items-center justify-center gap-2 transition-all duration-150 shadow-lg shadow-teal-500/20 active:scale-[0.98]"
            >
              {isSubmitting ? 'Signing in…' : 'Sign In'}
              {!isSubmitting && <ChevronRight className="h-4 w-4" />}
            </button>
          </form>

          <div className="mt-6 bg-black/20 border border-white/10 rounded-xl p-4 flex gap-3 items-start">
            <ShieldAlert className="h-4 w-4 text-teal-300 shrink-0 mt-0.5" />
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Don't have an account yet? Ask HR or Management to create one for you from the HR Portal's Accounts tab. Every login is tied to a named person and is logged.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 max-w-6xl w-full mx-auto py-4 border-t border-white/10 flex items-center justify-between">
        <p className="text-[10px] text-slate-600">
          © {new Date().getFullYear()} MAT Plastic Industries LLC — All access is monitored and logged.
        </p>
        <p className="text-[10px] text-slate-700 font-mono">ERP v2.0 · Secure Gate</p>
      </footer>
    </div>
  );
};

export { ROLE_LABELS };
