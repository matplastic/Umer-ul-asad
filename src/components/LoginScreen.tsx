import React, { useState, useEffect } from 'react';
import { ViewRole } from '../types';
import { User, Lock, ChevronRight, ShieldAlert, Eye, EyeOff } from 'lucide-react';
import { loginWithPassword, type AuthUser } from '../lib/authClient';
import { MatLogo } from './MatLogo';

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
  // Splash: show the MAT logo animation for ~3.2 s before revealing the login form.
  // Set to false when idle-logout occurs so returning users skip it.
  const [showSplash, setShowSplash] = useState(!idleLoggedOut);
  useEffect(() => {
    const t1 = setTimeout(() => setWalkerArrived(true), 2600);
    // Bag lands on the floor at 2.5s + 0.5s drop = ~3.0s. Give it a short
    // beat sitting closed on the ground, then open it.
    const t2 = setTimeout(() => setBagOpen(true), 3100);
    // Hide splash after 3.2 s — all logo animations are done by then.
    const t3 = idleLoggedOut ? undefined : setTimeout(() => setShowSplash(false), 3200);
    return () => { clearTimeout(t1); clearTimeout(t2); if (t3) clearTimeout(t3); };
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

  if (showSplash) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '24px',
        background: 'radial-gradient(1200px 700px at 50% 30%, #0e6a6d 0%, #0B4F52 45%, #06322F 100%)',
        fontFamily: "'Segoe UI', Arial, sans-serif", overflow: 'hidden',
      }}>
        <style>{`
          .msp-letters path { fill: #A0A0A0; }
          .msp-letter-m { opacity:0; transform:translateX(-40px); animation: msp-slideL .7s cubic-bezier(.2,.8,.2,1) .5s forwards; }
          .msp-letter-t { opacity:0; transform:translateX(40px);  animation: msp-slideR .7s cubic-bezier(.2,.8,.2,1) .5s forwards; }
          @keyframes msp-slideL { to { opacity:1; transform:translateX(0); } }
          @keyframes msp-slideR { to { opacity:1; transform:translateX(0); } }
          .msp-tri path { fill: #FAE005; }
          .msp-tri {
            opacity: 0; transform-box: fill-box; transform-origin: 50% 100%;
            animation: msp-triIn .8s cubic-bezier(.2,.8,.2,1) 1s forwards, msp-glow 2.6s ease-in-out 2s infinite;
          }
          @keyframes msp-triIn { from { opacity:0; transform:scale(.85) translateY(-10px); } to { opacity:1; transform:scale(1) translateY(0); } }
          @keyframes msp-glow {
            0%,100% { filter: drop-shadow(0 0 0 rgba(250,224,5,0)); }
            50%      { filter: drop-shadow(0 0 16px rgba(250,224,5,.6)); }
          }
          .msp-subtitle { text-align:center; opacity:0; animation: msp-fadeUp .7s ease-out 1.85s forwards; }
          @keyframes msp-fadeUp {
            from { opacity:0; transform:translateY(10px); letter-spacing:6px; }
            to   { opacity:1; transform:translateY(0);    letter-spacing:3px; }
          }
          .msp-name { color:#fff; font-size:clamp(14px,2.6vw,20px); font-weight:700; letter-spacing:3px; margin:0; }
          .msp-rule { width:60px; height:2px; background:#FAE005; margin:14px auto 0; transform:scaleX(0); transform-origin:center; animation: msp-growRule .6s ease-out 2.1s forwards; }
          @keyframes msp-growRule { to { transform:scaleX(1); } }
          .msp-hint { opacity:0; color:rgba(255,255,255,.55); font-size:12px; letter-spacing:2px; animation: msp-fadeUp .7s ease-out 2.35s forwards; }
        `}</style>

        {/* Logo */}
        <div style={{ width: 'min(88vw, 640px)' }}>
          <svg viewBox="0 0 512 315" xmlns="http://www.w3.org/2000/svg" style={{ width:'100%', height:'auto', display:'block', overflow:'visible' }}>
            <g className="msp-letters">
              <g className="msp-letter-m"><g transform="translate(0,315) scale(0.1,-0.1)">
                <path d="M196 1568 c-14 -20 -16 -87 -16 -560 0 -521 1 -538 19 -548 11 -6 87-10 176 -10 152 0 156 1 180 25 24 23 25 29 25 165 0 77 4 140 8 140 14 0 35-29 92 -122 29 -48 58 -89 65 -92 7 -2 20 3 28 12 8 9 99 163 203 342 103 179 222 386 265 460 60 104 77 142 72 160 -11 46 -26 50 -193 50 -110 0 -161 -4-172 -12 -8 -7 -52 -79 -98 -160 -53 -94 -90 -148 -100 -148 -10 0 -49 58-106 158 l-91 157 -171 3 c-167 2 -171 2 -186 -20z"/>
                <path d="M1289 1318 c-12 -24 -90 -164 -173 -313 l-151 -270 0 -65 c0 -91 31 -145 105 -185 48 -25 68 -30 153 -33 l97 -4 0 456 c0 251 -2 456 -5 456 -2 0 -14-19 -26 -42z"/>
              </g></g>
              <g className="msp-letter-t"><g transform="translate(0,315) scale(0.1,-0.1)">
                <path d="M3490 1584 c0 -4 22 -45 49 -93 27 -47 74 -129 103 -181 l55 -95 188 -3 c136 -2 191 -6 197 -15 4 -6 8-166 8 -355 l0 -343 25 -24 c23 -24 28 -25 174 -25 123 0 152 3 165 16 9 8 17 16 18 17 1 1 5 164 8 361 l5 360 30 1 c17 1 115 2 218 3 185 2 188 2 212 27 24 23 25 29 25 167 0 114 -3 148 -16 166 l-15 22 -725 0 c-398 0 -724 -3 -724-6z"/>
              </g></g>
            </g>
            <g className="msp-tri"><g transform="translate(0,315) scale(0.1,-0.1)">
              <path d="M2355 3034 c-72 -25 -139 -99 -226 -251 -13 -23 -62 -109 -108 -190-46 -82 -113 -196 -148 -255 -77 -130 -173 -299 -173 -305 0 -3 -13 -23 -29-46 -26 -39 -173 -288 -245 -417 l-31 -55 2 -522 c1 -287 4 -527 8 -533 4 -7 326 -10 1000 -10 873 0 994 2 999 15 8 21 0 39 -61 132 -29 45 -53 84 -53 86 0 10 -104 175 -126 199 l-24 28 -724 0 c-441 0 -735 4 -750 10 -51 19 -42 86 28 194 18 28 46 74 61 101 15 28 55 97 88 155 33 58 86 150 117 205 32 55 85 148 119 206 33 58 61 111 61 118 0 6 5 11 10 11 6 0 10 4 10 9 0 5 17 38 38 72 21 35 52 89 69 119 56 104 102 167 124 173 26 7 59 -5 80 -29 18 -21 183-296 214 -356 11 -21 23 -38 27 -38 5 0 7 -4 5 -9 -2 -8 38 -82 91 -165 13-22 38 -65 55 -95 16 -31 36 -63 43 -72 8 -8 14 -18 14 -21 0 -8 186 -330 301-523 46 -78 131 -225 189 -327 100 -178 107 -186 140 -192 19 -3 130 -6 246-6 259 0 254 -2 199 103 -20 39 -43 79 -49 87 -7 8 -18 26 -24 40 -7 14 -22 41 -35 61 -38 61 -171 288 -186 317 -7 15 -23 43 -36 62 -12 19 -59 100 -105 180 -45 80 -94 163 -109 185 -14 22 -31 51 -37 65 -10 22 -59 107 -224 390-21 36 -91 157 -155 270 -65 113 -126 217 -136 232 -11 15 -19 29 -19 32 0 3-24 45 -52 93 -29 48 -56 95 -60 105 -4 9 -29 51 -56 95 -27 43 -59 98 -71 122 -38 74 -97 129 -155 145 -59 16 -85 16 -131 0z"/>
            </g></g>
          </svg>
        </div>

        {/* Subtitle */}
        <div className="msp-subtitle">
          <p className="msp-name">PLASTIC&nbsp;&nbsp;INDUSTRIES&nbsp;&nbsp;L.L.C</p>
          <div className="msp-rule" />
        </div>

        {/* Status */}
        <div className="msp-hint">SIGNING YOU IN&hellip;</div>
      </div>
    );
  }

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
          <MatLogo className="h-11 w-auto shrink-0" />
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
