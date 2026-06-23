import React, { useState } from 'react';
import { ViewRole } from '../types';
import { Factory, KeyRound, Info, ChevronRight, ShieldAlert } from 'lucide-react';
import { dbGetPins } from '../lib/firebaseService';

interface LoginScreenProps {
  onLoginSuccess: (user: { role: ViewRole; displayName: string }) => void;
}

interface UserProfile {
  role: ViewRole;
  title: string;
  subtitle: string;
  colorClass: string;
  bgIconClass: string;
  description: string;
}

const USER_PROFILES: UserProfile[] = [
  {
    role: 'management',
    title: 'Executive Management',
    subtitle: 'Full Central Admin & Data Portal',
    colorClass: 'from-blue-600 to-indigo-600 shadow-blue-500/10',
    bgIconClass: 'bg-blue-50 text-blue-600',
    description:
      'Central controls, full access to daily punches, metrics, targets, team overrides, and database configurations.',
  },
  {
    role: 'planning_department',
    title: 'Planning Department',
    subtitle: 'Scheduling & Direct Stage Excel Sync',
    colorClass: 'from-indigo-600 to-purple-600 shadow-indigo-500/10',
    bgIconClass: 'bg-indigo-50 text-indigo-600',
    description:
      'Register production pools, set monthly production targets, configure Excel imports, and release planned tasks.',
  },
  {
    role: 'production_engineer',
    title: 'Production Engineering',
    subtitle: 'Fabrication Releases & Workcell Controls',
    colorClass: 'from-amber-600 to-orange-500 shadow-amber-500/10',
    bgIconClass: 'bg-amber-50 text-amber-600',
    description:
      'Trigger primary fabrications, execute work order listings, and manage floor queues.',
  },
  {
    role: 'quality_inspector',
    title: 'Quality Assurance',
    subtitle: 'QA Inspections & Non-Conformance Reports',
    colorClass: 'from-emerald-600 to-teal-600 shadow-emerald-500/10',
    bgIconClass: 'bg-emerald-50 text-emerald-600',
    description:
      'Audit finished stages, file rejection counts and inspector pictures, change status to approved.',
  },
  {
    role: 'stage_worker',
    title: 'Stage Shop Floor',
    subtitle: 'Station Workstation & Claiming Queue',
    colorClass: 'from-purple-600 to-pink-600 shadow-purple-500/10',
    bgIconClass: 'bg-purple-50 text-purple-600',
    description:
      'Claim production items, record station timers, register start & finish signals for shop floors.',
  },
  {
    role: 'trolley_prod',
    title: 'Trolley Production Supervisor',
    subtitle: 'Trolley Yield & Yield Log Tracker',
    colorClass: 'from-rose-600 to-pink-500 shadow-rose-500/10',
    bgIconClass: 'bg-rose-50 text-rose-600',
    description:
      'Independent tracking logs for trolley fabrications, daily yield entries, and output performance reports.',
  },
  {
    role: 'factory_entrance',
    title: 'Factory Entrance TV Monitor',
    subtitle: 'Live Delivery Status Kiosk',
    colorClass: 'from-cyan-600 to-teal-500 shadow-cyan-500/10',
    bgIconClass: 'bg-cyan-50 text-cyan-600',
    description:
      'General informational display for drivers and logistics personnel at factory gates.',
  },
  {
    role: 'section_dashboard',
    title: 'Section TV Dashboard',
    subtitle: 'Live Progress Matrix Display',
    colorClass: 'from-teal-600 to-emerald-500 shadow-teal-500/10',
    bgIconClass: 'bg-teal-50 text-teal-600',
    description:
      'Floor monitor dashboard displaying station bottlenecks and live performance OEE metrics.',
  },
];

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess }) => {
  const [selectedProfile, setSelectedProfile] = useState<UserProfile | null>(null);
  const [pinInput, setPinInput] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [pins, setPins] = useState<Record<string, string>>({
    management: '',
    planning_department: '',
    production_engineer: '',
    quality_inspector: '',
    stage_worker: '',
    trolley_prod: '',
    factory_entrance: '',
    section_dashboard: '',
  });

  React.useEffect(() => {
    dbGetPins()
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

    const actualPin = pins[selectedProfile.role];

    if (actualPin && pinInput === actualPin) {
      onLoginSuccess({
        role: selectedProfile.role,
        displayName: selectedProfile.title,
      });
    } else {
      setErrorMsg('Invalid Access PIN. Please input the customized passcode assigned to your department.');
      setPinInput('');
    }
  };

  const keypadKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

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

      {/* Main Grid */}
      <main className="max-w-6xl w-full mx-auto my-auto grid grid-cols-1 lg:grid-cols-12 gap-8 py-8 items-stretch">

        {/* Left: Profile Selector */}
        <div className="lg:col-span-7 bg-slate-800/40 border border-slate-800 rounded-2xl p-6 flex flex-col gap-6 backdrop-blur-md">
          <div className="space-y-1">
            <h2 className="text-base font-black uppercase text-slate-300 tracking-wider flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
              Department Portals
            </h2>
            <p className="text-xs text-slate-400">
              Select your department profile from the register below to access your active portal. Access permissions are strictly audited.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {USER_PROFILES.map(profile => {
              const isSelected = selectedProfile?.role === profile.role;
              return (
                <button
                  key={profile.role}
                  onClick={() => handleProfileSelect(profile)}
                  className={`text-left p-4 rounded-xl border transition-all duration-150 flex items-start gap-3 cursor-pointer group ${
                    isSelected
                      ? 'bg-slate-800 border-indigo-500 shadow-lg ring-1 ring-indigo-500'
                      : 'bg-slate-900/40 border-slate-800 hover:bg-slate-800/60 hover:border-slate-700'
                  }`}
                >
                  <div className={`p-2 rounded-lg shrink-0 ${profile.bgIconClass}`}>
                    <KeyRound className="h-4 w-4" />
                  </div>
                  <div className="space-y-0.5 min-w-0">
                    <h3 className="text-sm font-bold text-white group-hover:text-indigo-300 transition-colors truncate">
                      {profile.title}
                    </h3>
                    <p className="text-[11px] text-slate-400 truncate">{profile.subtitle}</p>
                    {profile.description && (
                      <p className="text-[10px] text-slate-500 line-clamp-1 mt-0.5">{profile.description}</p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Role Description Footer */}
          <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-4 flex gap-3 items-start mt-auto">
            <Info className="h-4 w-4 text-cyan-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="text-xs font-bold text-slate-200">Role-Based Access Control Rules</h4>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                {selectedProfile
                  ? selectedProfile.description
                  : 'Management accounts enjoy central bypass access enabling active view role selection on any portal. Non-management department operators are restricted onto their single-screen operational ledger.'}
              </p>
            </div>
          </div>
        </div>

        {/* Right: Keypad Authentication */}
        <div className="lg:col-span-5 bg-gradient-to-b from-slate-800/90 to-slate-900/90 border border-slate-700/60 rounded-2xl p-6 flex flex-col gap-6 shadow-2xl relative overflow-hidden">

          {/* Decorative gradient border top */}
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 rounded-t-2xl" />

          {selectedProfile ? (
            <form onSubmit={handleLoginSubmit} className="flex flex-col gap-6 flex-1">

              {/* Profile Header */}
              <div className="flex items-center gap-3 border-b border-slate-700/50 pb-4">
                <div className={`p-2 rounded-lg shrink-0 ${selectedProfile.bgIconClass}`}>
                  <KeyRound className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-white">{selectedProfile.title}</h3>
                  <p className="text-[11px] text-indigo-400 font-medium">{selectedProfile.subtitle}</p>
                </div>
              </div>

              {/* PIN Display Dots */}
              <div className="flex flex-col items-center gap-3 py-2">
                <div className="flex items-center gap-4">
                  {[0, 1, 2, 3].map(i => (
                    <div
                      key={i}
                      className={`h-4 w-4 rounded-full border-2 transition-all duration-150 ${
                        i < pinInput.length
                          ? 'bg-cyan-400 border-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.6)]'
                          : 'bg-transparent border-slate-600'
                      }`}
                    />
                  ))}
                </div>
                <p className="text-[10px] tracking-[0.25em] uppercase text-slate-500 font-mono">
                  Enter 4-Digit Access PIN
                </p>
                {errorMsg && (
                  <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 w-full">
                    <ShieldAlert className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
                    <p className="text-[10px] text-red-400 leading-relaxed">{errorMsg}</p>
                  </div>
                )}
              </div>

              {/* Numeric Keypad */}
              <div className="grid grid-cols-3 gap-2.5">
                {keypadKeys.map(num => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => handleKeyPress(num)}
                    className="h-14 rounded-xl bg-slate-800 border border-slate-700 text-white text-xl font-bold hover:bg-slate-700 hover:border-slate-600 active:scale-95 transition-all duration-100 shadow-md"
                  >
                    {num}
                  </button>
                ))}

                {/* Bottom row: CLEAR, 0, DEL */}
                <button
                  type="button"
                  onClick={handleClear}
                  className="h-14 rounded-xl bg-slate-800/60 border border-slate-700 text-slate-400 text-xs font-bold uppercase tracking-widest hover:bg-slate-700 hover:text-white active:scale-95 transition-all duration-100"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => handleKeyPress('0')}
                  className="h-14 rounded-xl bg-slate-800 border border-slate-700 text-white text-xl font-bold hover:bg-slate-700 hover:border-slate-600 active:scale-95 transition-all duration-100 shadow-md"
                >
                  0
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  className="h-14 rounded-xl bg-slate-800/60 border border-slate-700 text-slate-400 text-xs font-bold uppercase tracking-widest hover:bg-slate-700 hover:text-white active:scale-95 transition-all duration-100"
                >
                  Del
                </button>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={pinInput.length !== 4}
                className="w-full h-14 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-white font-black uppercase tracking-widest text-sm flex items-center justify-center gap-2 transition-all duration-150 shadow-lg shadow-indigo-500/20 active:scale-[0.98]"
              >
                Authorize & Sign In
                <ChevronRight className="h-4 w-4" />
              </button>
            </form>
          ) : (
            /* No Profile Selected State */
            <div className="flex-1 flex flex-col items-center justify-center gap-4 py-10 text-center">
              <div className="p-4 bg-slate-800 rounded-2xl border border-slate-700">
                <ShieldAlert className="h-8 w-8 text-slate-500" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-slate-300">No Department Selected</h3>
                <p className="text-xs text-slate-500 max-w-[220px]">
                  Please select a department portal from the left panel to begin authentication.
                </p>
              </div>
            </div>
          )}
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
