import React from 'react';
import { ViewRole, StageId } from '../types';
import { STAGES } from '../data/mockData';
import { Wrench, Shield, Monitor, BarChart3, HardHat, Tv, Cloud, LogOut, ClipboardList, Boxes, UserCog, FileBarChart, Warehouse, ShieldAlert, Menu, X } from 'lucide-react';

interface RoleSelectorProps {
  currentRole: ViewRole;
  selectedStageId: StageId;
  onChangeRole: (role: ViewRole) => void;
  onChangeStage: (stageId: StageId) => void;
  workerTeamId: string;
  onChangeWorkerTeam: (teamId: string) => void;
  allTeams: any[];
  googleUser: { displayName: string | null; email: string | null; photoURL: string | null } | null;
  onGoogleSignIn: () => void;
  onGoogleSignOut: () => void;
  stationLock?: {
    isLocked: boolean;
    role: ViewRole;
    stageId: StageId | null;
    teamId: string | null;
    pin: string;
    allowedRoles?: ViewRole[];
  };
  loggedInUser: { role: ViewRole; displayName: string } | null;
  onLogout: () => void;
  isOpen: boolean;
  onClose: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// TOP BAR — always visible, full width, logo + company name centered.
// The hamburger button on the left is the ONLY way to open the portal list
// (RoleSelector below is now a hidden slide-in drawer, not a permanent sidebar).
// Rendered by App.tsx above the main content, same as before.
// ─────────────────────────────────────────────────────────────────────────────
export const TopBar: React.FC<{ onMenuClick: () => void }> = ({ onMenuClick }) => (
  <header className="sticky top-0 z-30 h-16 shrink-0 w-full bg-slate-900 border-b border-slate-800 flex items-center px-3 sm:px-4">
    <button
      onClick={onMenuClick}
      aria-label="Open portal menu"
      title="Open portal menu"
      className="h-10 w-10 shrink-0 flex items-center justify-center rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white active:scale-95 transition-all cursor-pointer"
    >
      <Menu className="h-6 w-6" />
    </button>

    {/* Logo + name — centered in the bar regardless of hamburger width */}
    <div className="flex-1 flex items-center justify-center gap-2.5 min-w-0 px-2">
      <div className="h-9 w-9 shrink-0 rounded-lg bg-white shadow-[0_4px_10px_rgba(0,0,0,0.35)] ring-1 ring-amber-500/25 flex items-center justify-center p-1">
        <img src="/logo.png" alt="MAT Plastic Industries LLC" className="h-full w-full object-contain" />
      </div>
      <div className="min-w-0 text-center leading-tight">
        <h1 className="text-[12px] sm:text-[13px]
