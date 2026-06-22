import React, { useState } from 'react';
import { ViewRole } from '../types';
import { Factory, ShieldAlert, KeyRound, ChevronRight, Info, Eye, EyeOff } from 'lucide-react';

interface LoginScreenProps {
  onLoginSuccess: (user: { role: ViewRole; displayName: string }) => void;
}

interface UserProfile {
  role: ViewRole;
  title: string;
  subtitle: string;
  defaultPin: string;
  colorClass: string;
  bgIconClass: string;
  description: string;
}

const USER_PROFILES: UserProfile[] = [
  {
    role: 'management',
    title: 'Executive Management',
    subtitle: 'Full Central Admin & Data Portal',
    defaultPin: '1234',
    colorClass: 'from-blue-600 to-indigo-600 shadow-blue-500/10',
    bgIconClass: 'bg-blue-50 text-blue-650',
    description: 'Central controls, full access to daily punches, metrics, targets, team overrides, and database configurations.',
  },
  {
    role: 'planning_department',
    title: 'Planning Department',
    subtitle: 'Scheduling & Direct Stage Excel Sync',
    defaultPin: '1111',
    colorClass: 'from-indigo-600 to-purple-600 shadow-indigo-500/10',
    bgIconClass: 'bg-indigo-50 text-indigo-650',
    description: 'Register production pools, set monthly production targets, configure Excel imports, and release planned tasks.',
  },
  {
    role: 'production_engineer',
    title: 'Production Engineering',
    subtitle: 'Fabrication Releases & Workcell Controls',
    defaultPin: '2222',
    colorClass: 'from-amber-600 to-orange-500 shadow-amber-500/10',
    bgIconClass: 'bg-amber-50 text-amber-650',
    description: 'Trigger primary fabrications, execute work order listings, and manage floor queues.',
  },
  {
    role: 'quality_inspector',
    title: 'Quality Assurance',
    subtitle: 'QA Inspections & Non-Conformance Reports',
    defaultPin: '3333',
    colorClass: 'from-emerald-600 to-teal-600 shadow-emerald-500/10',
    bgIconClass: 'bg-emerald-50 text-emerald-650',
    description: 'Audit finished stages, file rejection counts and inspector pictures, change status to approved.',
  },
  {
    role: 'stage_worker',
    title: 'Stage Shop Floor',
    subtitle: 'Station Workstation & Claiming Queue',
    defaultPin: '4444',
    colorClass: 'from-purple-600 to-pink-600 shadow-purple-500/10',
    bgIconClass: 'bg-purple-50 text-purple-650',
    description: 'Claim production items, record station timers, register start & finish signals for shop floors.',
  },
  {
    role: 'trolley_prod',
    title: 'Trolley Production Supervisor',
    subtitle: 'Trolley Yield & Yield Log Tracker',
    defaultPin: '5555',
    colorClass: 'from-rose-600 to-pink-500 shadow-rose-500/10',
    bgIconClass: 'bg-rose-50 text-rose-650',
    description: 'Independent tracking logs for trolley fabrications, daily yield entries, and output performance reports.',
  },
  {
    role: 'factory_entrance',
    title: 'Factory Entrance TV Monitor',
    subtitle: 'Live Delivery Status Kiosk',
    defaultPin: '6666',
    colorClass: 'from-cyan-600 to-teal-500 shadow-cyan-500/10',
    bgIconClass: 'bg-cyan-50 text-cyan-650',
    description: 'General informational display for drivers and logistics personnel at factory gates.',
  },
  {
    role: 'section_dashboard',
    title: 'Section TV Dashboard',
    subtitle: 'Live Progress Matrix Display',
    defaultPin: '7777',
    colorClass: 'from-teal-600 to-emerald-500 shadow-teal-500/10',
    bgIconClass: 'bg-teal-50 text-teal-650',
    description: 'Floor monitor dashboard displaying station bottlenecks and live performance OEE metrics.',
  },
];

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess }) => {
  const [selectedProfile, setSelectedProfile] = useState<UserProfile | null>(null);
  const [pinInput, setPinInput] = useState<string>('');
  const [showPin, setShowPin] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  const [pins, setPins] = useState<Record<string, string>>({
    management: '1234',
    planning_department: '1111',
    production_engineer: '2222',
    quality_inspector: '3333',
    stage_worker: '4444',
    trolley_prod: '5555',
    factory_entrance: '6666',
    section_dashboard: '7777',
  });

  React.useEffect(() => {
    fetch('/api/pins')
      .then(res => res.json())
      .then(data => {
        if (data && typeof data === 'object') {
          setPins(prev => ({ ...prev, ...data }));
        }
      })
      .catch(err => console.error('Error loading latest access PINs:', err));
  }, []);

  const handleProfileSelect = (profile: UserProfile) => {
    setSelectedProfile(profile);
    setPinInput('');
    setErrorMsg(null);
  };

  const handleKeyPress = (num: string) => {
    if (pinInput.length < 4) {
      setPinInput(prev => prev + num);
      setErrorMsg(null);
    }
  };

  const handleDelete = () => {
    setPinInput(prev => prev.slice(0, -1));
  };

  const handleClear = () => {
    setPinInput('');
  };

  const handleLoginSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedProfile) return;

    const actualPin = pins[selectedProfile.role] || selectedProfile.defaultPin;

    if (pinInput === actualPin) {
      onLoginSuccess({
        role: selectedProfile.role,
        displayName: selectedProfile.title,
      });
    } else {
      setErrorMsg('Invalid Access PIN. Please input the customized passcode assigned to your department.');
    }
  };

  // Auto handle quick click entry for faster user validation in iframe
  const handleQuickFill = () => {
    if (selectedProfile) {
      setPinInput(pins[selectedProfile.role] || selectedProfile.defaultPin);
      setErrorMsg(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-between p-4 sm:p-6 md:p-8 font-sans text-slate-100 antialiased selection:bg-indigo-500/40">
      
      {/* Top Banner Identity */}
      <header className="max-w-6xl w-full mx-auto flex items-center justify-between py-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-tr from-cyan-500 to-indigo-650 p-2.5 rounded-xl shadow-inner text-white">
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

      {/* Main Login Flow Grid */}
      <main className="max-w-6xl w-full mx-auto my-auto grid grid-cols-1 lg:grid-cols-12 gap-8 py-8 items-stretch">
        
        {/* Left Side: Profile Selector (7 columns) */}
        <div className="lg:col-span-7 bg-slate-800/40 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between gap-6 backdrop-blur-md">
          <div className="space-y-2">
            <h2 className="text-base font-black uppercase text-slate-350 tracking-wider flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse"></span>
              Department Portals
            </h2>
            <p className="text-xs text-slate-400 text-slate-300">
              Select your department profile from the register below to access your active portal. Access permissions are strictly audited.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 my-2">
            {USER_PROFILES.map(profile => {
              const isSelected = selectedProfile?.role === profile.role;
              return (
                <button
                  key={profile.role}
                  onClick={() => handleProfileSelect(profile)}
                  className={`text-left p-4 rounded-xl border transition-all duration-150 flex items-start gap-3 cursor-pointer group ${
                    isSelected
                      ? 'bg-slate-800 border-indigo-500 shadow-lg shadow-indigo-950/40 scale-[1.02]'
                      : 'bg-slate-850/60 hover:bg-slate-800 border-slate-750 hover:border-slate-700'
                  }`}
                >
                  <div className={`p-2.5 rounded-lg shrink-0 ${profile.bgIconClass} bg-slate-700 text-slate-200 group-hover:scale-105 duration-100`}>
                    <Factory className="h-4.5 w-4.5 stroke-[2.5]" />
                  </div>
                  <div className="space-y-0.5 min-w-0">
                    <p className={`text-xs font-black leading-none ${isSelected ? 'text-white' : 'text-slate-205 text-slate-200'}`}>
                      {profile.title}
                    </p>
                    <p className="text-[10px] text-slate-400 truncate leading-tight">
                      {profile.subtitle}
                    </p>
                    <p className="text-[9px] text-slate-500 line-clamp-1 leading-normal pt-1 group-hover:text-slate-400 transition-colors">
                      {profile.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Quick Notice Badge */}
          <div className="bg-slate-850/60 border border-slate-750 rounded-xl p-3 flex items-start gap-2 text-xs text-slate-400">
            <Info className="h-4.5 w-4.5 text-cyan-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="font-bold text-slate-200 block text-[11px] leading-tight">Role-Based Access Control Rules</span>
              <p className="text-[10px] leading-relaxed">
                Management accounts enjoy central bypass access enabling active view role selection on any portal. Non-management department operators are restricted onto their single-screen operational ledger.
              </p>
            </div>
          </div>
        </div>

        {/* Right Side: Keypad Entry Panel (5 columns) */}
        <div className="lg:col-span-5 bg-slate-850 border border-slate-750 rounded-2xl p-6 flex flex-col justify-between gap-6 shadow-2xl relative overflow-hidden">
          {/* Header gradient banner line */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500" />

          {selectedProfile ? (
            <div className="space-y-5 flex-1 flex flex-col justify-between">
              
              {/* Profile details */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className={`p-2.5 rounded-lg ${selectedProfile.bgIconClass} bg-slate-800`}>
                    <KeyRound className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs font-black text-white">{selectedProfile.title}</p>
                    <p className="text-[10px] text-indigo-400 font-semibold">{selectedProfile.subtitle}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleQuickFill}
                  className="bg-slate-800 hover:bg-slate-750 text-cyan-400 hover:text-cyan-300 font-mono font-bold text-[10px] px-2.5 py-1 rounded-md border border-slate-700 transition-colors"
                >
                  Quick PIN Autoload
                </button>
              </div>

              {/* Pin dots */}
              <div className="space-y-3">
                <div className="flex justify-center items-center gap-4 py-2">
                  {[0, 1, 2, 3].map((idx) => (
                    <div
                      key={idx}
                      className={`h-4.5 w-4.5 rounded-full border-2 transition-all duration-150 ${
                        idx < pinInput.length
                          ? 'bg-gradient-to-tr from-cyan-400 to-indigo-500 border-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.4)] scale-110'
                          : 'border-slate-650 bg-slate-900'
                      }`}
                    />
                  ))}
                </div>
                {errorMsg ? (
                  <p className="text-center text-[10px] text-rose-400 font-bold bg-rose-950/30 border border-rose-900/40 p-2 rounded-lg">
                    {errorMsg}
                  </p>
                ) : (
                  <p className="text-center text-[10px] text-slate-400 font-mono tracking-wide leading-none">
                    ENTER 4-DIGIT ACCESS PIN
                  </p>
                )}
              </div>

              {/* Secure Physical Keypad Grid */}
              <div className="grid grid-cols-3 gap-2 mx-auto w-full max-w-[260px] py-2">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(num => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => handleKeyPress(num)}
                    className="h-12 w-full bg-slate-800 hover:bg-slate-700 active:bg-slate-650 text-white hover:text-cyan-300 text-lg font-bold font-mono rounded-xl transition-all shadow-inner border border-slate-750 flex items-center justify-center cursor-pointer"
                  >
                    {num}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={handleClear}
                  className="h-12 w-full bg-slate-900 hover:bg-slate-800 text-[11px] text-slate-400 hover:text-slate-350 font-bold uppercase rounded-xl transition-all border border-slate-800 flex items-center justify-center cursor-pointer"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => handleKeyPress('0')}
                  className="h-12 w-full bg-slate-800 hover:bg-slate-700 active:bg-slate-650 text-white hover:text-cyan-300 text-lg font-bold font-mono rounded-xl transition-all shadow-inner border border-slate-750 flex items-center justify-center cursor-pointer"
                >
                  0
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  className="h-12 w-full bg-slate-900 hover:bg-slate-800 text-[11px] text-slate-400 hover:text-amber-455 hover:text-amber-400 font-bold uppercase rounded-xl transition-all border border-slate-800 flex items-center justify-center cursor-pointer"
                >
                  Del
                </button>
              </div>

              {/* Login Button Action */}
              <button
                type="button"
                onClick={() => handleLoginSubmit()}
                disabled={pinInput.length !== 4}
                className="w-full bg-gradient-to-r from-blue-600 to-indigo-650 hover:from-blue-500 hover:to-indigo-500 text-white font-black hover:font-bold tracking-wide uppercase text-xs rounded-xl py-3.5 shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-cyan-500/10 active:scale-95"
              >
                <span>Authorize & Sign In</span>
                <ChevronRight className="h-4.5 w-4.5" />
              </button>

            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center space-y-4 py-12">
              <div className="bg-slate-900 p-4 rounded-2xl border border-slate-800 text-slate-400 animate-bounce">
                <ShieldAlert className="h-8 w-8 text-indigo-400" />
              </div>
              <div className="space-y-1 max-w-[280px]">
                <h3 className="text-xs font-black text-slate-201 text-slate-200 uppercase tracking-widest leading-none">
                  Authorization Required
                </h3>
                <p className="text-[11px] text-slate-400 leading-normal">
                  Please pick a department credentials profile from the left matrix list to initiate PIN verification.
                </p>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Verification Instructions Credentials Guide */}
      <section className="max-w-6xl w-full mx-auto bg-slate-950 border border-slate-800/80 rounded-2xl p-5 mb-4 grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
        <div className="md:col-span-4 space-y-1">
          <span className="text-[10px] font-black uppercase text-cyan-400 font-mono tracking-widest block">MAT Reference Box</span>
          <h4 className="text-sm font-black text-white">Temporary Staff Demo PINS</h4>
          <p className="text-[10px] text-slate-400 leading-relaxed">
            For evaluation within safety sandboxes, use these predefined authorization credentials to navigate any workstation portal.
          </p>
        </div>
        <div className="md:col-span-8 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
          {USER_PROFILES.map(item => (
            <div 
              key={item.role} 
              onClick={() => handleProfileSelect(item)}
              className="bg-slate-900 border border-slate-800 hover:border-slate-700 hover:bg-slate-850 p-2.5 rounded-xl flex flex-col justify-between gap-1 cursor-pointer transition-all hover:scale-102"
            >
              <div className="font-semibold text-slate-205 text-slate-200 leading-tight truncate">{item.title}</div>
              <div className="flex items-center justify-between text-[10px] pt-1 border-t border-slate-800/60 mt-1">
                <span className="text-indigo-400 font-mono font-bold">PIN: {item.defaultPin}</span>
                <span className="text-[9px] text-slate-500 font-mono uppercase shrink-0">Click to load</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Footer system status */}
      <footer className="max-w-6xl w-full mx-auto border-t border-slate-800 py-4 text-center text-[10px] text-slate-500 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <p>© 2026 MAT PLASTIC INDUSTRIES LLC • Secure Network Handshake OK • PostgreSQL Connection Live</p>
        <p className="font-mono text-slate-600">CLIENT_SECURE_BYPASS_VERIFICATION_V2</p>
      </footer>
      
    </div>
  );
};
