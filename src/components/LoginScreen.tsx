import React, { useState } from 'react';
import { ViewRole } from '../types';
import { Factory, ShieldAlert, KeyRound, ChevronRight, Info, Eye, EyeOff } from 'lucide-react';
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
    bgIconClass: 'bg-blue-50 text-blue-650',
    description: 'Central controls, full access to daily punches, metrics, targets, team overrides, and database configurations.',
  },
  {
    role: 'planning_department',
    title: 'Planning Department',
    subtitle: 'Scheduling & Direct Stage Excel Sync',
    colorClass: 'from-indigo-600 to-purple-600 shadow-indigo-500/10',
    bgIconClass: 'bg-indigo-50 text-indigo-650',
    description: 'Register production pools, set monthly production targets, configure Excel imports, and release planned tasks.',
  },
  {
    role: 'production_engineer',
    title: 'Production Engineering',
    subtitle: 'Fabrication Releases & Workcell Controls',
    colorClass: 'from-amber-600 to-orange-500 shadow-amber-500/10',
    bgIconClass: 'bg-amber-50 text-amber-650',
    description: 'Trigger primary fabrications, execute work order listings, and manage floor queues.',
  },
  {
    role: 'quality_inspector',
    title: 'Quality Assurance',
    subtitle: 'QA Inspections & Non-Conformance Reports',
    colorClass: 'from-emerald-600 to-teal-600 shadow-emerald-500/10',
    bgIconClass: 'bg-emerald-50 text-emerald-650',
    description: 'Audit finished stages, file rejection counts and inspector pictures, change status to approved.',
  },
  {
    role: 'stage_worker',
    title: 'Stage Shop Floor',
    subtitle: 'Station Workstation & Claiming Queue',
    colorClass: 'from-purple-600 to-pink-600 shadow-purple-500/10',
    bgIconClass: 'bg-purple-50 text-purple-650',
    description: 'Claim production items, record station timers, register start & finish signals for shop floors.',
  },
  {
    role: 'trolley_prod',
    title: 'Trolley Production Supervisor',
    subtitle: 'Trolley Yield & Yield Log Tracker',
    colorClass: 'from-rose-600 to-pink-500 shadow-rose-500/10',
    bgIconClass: 'bg-rose-50 text-rose-650',
    description: 'Independent tracking logs for trolley fabrications, daily yield entries, and output performance reports.',
  },
  {
    role: 'factory_entrance',
    title: 'Factory Entrance TV Monitor',
    subtitle: 'Live Delivery Status Kiosk',
    colorClass: 'from-cyan-600 to-teal-500 shadow-cyan-500/10',
    bgIconClass: 'bg-cyan-50 text-cyan-650',
    description: 'General informational display for drivers and logistics personnel at factory gates.',
  },
  {
    role: 'section_dashboard',
    title: 'Section TV Dashboard',
    subtitle: 'Live Progress Matrix Display',
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
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-between p-4 sm:p-6 md:p-8 font-sans text-slate-100 antialiased selection:bg-indigo-500/40">
      
      {/* Top Banner Identity */}
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

      {/* Main Login Flow Grid */}
      <main className="max-w-6xl w-full mx-auto my-auto grid grid-cols-1 lg:grid-cols-12 gap-8 py-8 items-stretch">
        
        {/* Left Side: Profile Selector (7 columns) */}
        <div className="lg:col-span-7 bg-slate-800/40 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between gap-6 backdrop-blur-md">
          <div className="space-y-2">
            <h2 className="text-base font-black uppercase text-slate-300 tracking-wider flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse"></span>
              Department Portals
            </h2>
            <p className="text-xs text-slate-400">
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
                      ? 'bg-slate-800 border-indigo-500 shadow-lg ring-1 ring-indigo-500'
                      : 'bg-slate-900/40 border-slate-800 hover:bg-slate-800/60 hover:border-slate-700'
                  }`}
                >
                  <div className={`p-2 rounded-lg shrink-0 ${profile.bgIconClass}`}>
                    <KeyRound className="h-4 w-4" />
                  </div>
                  <div className="space-y-0.5">
                    <h3 className="text-sm font-bold text-white group-hover:text-indigo-300 transition-colors">
                      {profile.title}
                    </h3>
                    <p className="text-[11px] text-slate-400 line-clamp-1">{profile.subtitle}</p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Role Description Footer Panel */}
          <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-4 flex gap-3 items-start">
            <Info className="h-4 w-4 text-cyan-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="text-xs font-bold text-slate-200">Role-Based Access Control Rules</h4>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                {selectedProfile 
                  ? selectedProfile.description 
                  : "Management accounts enjoy central bypass access enabling active view role selection on any portal. Non-management department operators are restricted onto their single-screen operational ledger."
                }
              </p>
            </div>
          </div>
        </div>

        {/* Right Side: Keypad Authentication Gate (5 columns) */}
        <div className="lg:col-span-5 bg-gradient-to-b from-slate-800/90 to-slate-900/90 border border-slate-700/60 rounded-2xl p-6 flex flex-col justify-between shadow-2xl relative overflow-hidden group">
          
          {selectedProfile ? (
            <form onSubmit={handleLoginSubmit} className="flex-1 flex flex-col justify-between gap-6">
              
              {/* Header Profile Summary */}
              <div className="flex items-center justify-between border-b border-slate-700/50 pb-4">
                <div>
