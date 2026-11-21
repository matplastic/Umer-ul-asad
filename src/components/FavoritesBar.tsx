import React, { useMemo, useState } from 'react';
import { Star, Settings2, X, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import type { ViewRole } from '../types';
import {
  FAV_REGISTRY, favKey, resolveFav, useFavorites, useCurrentFavTarget,
} from '../lib/favorites';

interface FavoritesBarProps {
  userId: string | undefined;
  /** Portals this account may open — comes from getAllowedRoles(). */
  allowedRoles: ViewRole[];
  currentRole: ViewRole;
  /** Switch portal + open the inner tab. */
  onOpen: (role: ViewRole, tabId: string) => void;
}

export const FavoritesBar: React.FC<FavoritesBarProps> = ({ userId, allowedRoles, currentRole, onOpen }) => {
  const { favs, toggle, move, sync } = useFavorites(userId);
  const current = useCurrentFavTarget();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const allowed = useMemo(() => new Set<ViewRole>(allowedRoles), [allowedRoles]);

  // Only pins for portals this user can open, and that still exist.
  const visible = useMemo(
    () => favs
      .map(k => ({ key: k, info: resolveFav(k) }))
      .filter((x): x is { key: string; info: NonNullable<ReturnType<typeof resolveFav>> } =>
        !!x.info && allowed.has(x.info.role)),
    [favs, allowed],
  );

  const portals = useMemo(
    () => (Object.keys(FAV_REGISTRY) as ViewRole[]).filter(r => allowed.has(r)),
    [allowed],
  );

  if (portals.length === 0 || !userId) return null;

  const currentKey = current && current.role === currentRole ? favKey(current.role, current.tabId) : null;
  const currentInfo = currentKey ? resolveFav(currentKey) : null;
  const currentPinned = !!currentKey && favs.includes(currentKey);
  const q = query.trim().toLowerCase();

  return (
    <div className="relative mb-3" data-testid="favorites-bar">
      <div className="flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50/60 px-3 py-2">
        <Star className="h-4 w-4 shrink-0 fill-amber-400 text-amber-500" aria-hidden />
        <span className="hidden sm:inline shrink-0 text-xs font-bold text-amber-800">Favourites</span>

        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-0.5">
          {visible.length === 0 && (
            <span className="text-xs text-slate-500">
              Nothing pinned yet — open any page and tap the ☆, or use Manage to pick your most-used buttons.
            </span>
          )}
          {visible.map(({ key, info }) => {
            const active = currentKey === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onOpen(info.role, info.tabId)}
                title={`${info.portal} › ${info.label}`}
                aria-current={active ? 'page' : undefined}
                className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                  active
                    ? 'border-amber-500 bg-amber-500 text-white shadow-sm'
                    : 'border-amber-200 bg-white text-slate-700 hover:bg-amber-100'
                }`}
              >
                <span className="opacity-60 mr-1">{info.portal} ›</span>{info.label}
              </button>
            );
          })}
        </div>

        {currentInfo && (
          <button
            type="button"
            onClick={() => toggle(currentKey!)}
            title={currentPinned ? 'Remove this page from favourites' : 'Pin this page to favourites'}
            aria-pressed={currentPinned}
            className="shrink-0 flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 cursor-pointer"
          >
            <Star className={`h-3.5 w-3.5 ${currentPinned ? 'fill-amber-400 text-amber-500' : ''}`} />
            <span className="hidden md:inline">{currentPinned ? 'Pinned' : 'Pin this page'}</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className="shrink-0 flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
        >
          <Settings2 className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Manage</span>
        </button>
      </div>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-4 shadow-xl">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-800">Choose your favourite buttons</h3>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 cursor-pointer">
              <X className="h-4 w-4" />
            </button>
          </div>

          {visible.length > 1 && (
            <div className="mb-3">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Order</p>
              <div className="flex flex-wrap gap-1.5">
                {visible.map(({ key, info }, i) => (
                  <span key={key} className="flex items-center gap-0.5 rounded-lg bg-slate-100 px-1.5 py-1 text-xs text-slate-700">
                    <button type="button" disabled={i === 0} onClick={() => move(key, -1)} aria-label={`Move ${info.label} earlier`} className="rounded p-0.5 hover:bg-slate-200 disabled:opacity-30 cursor-pointer"><ChevronLeft className="h-3 w-3" /></button>
                    {info.label}
                    <button type="button" disabled={i === visible.length - 1} onClick={() => move(key, 1)} aria-label={`Move ${info.label} later`} className="rounded p-0.5 hover:bg-slate-200 disabled:opacity-30 cursor-pointer"><ChevronRight className="h-3 w-3" /></button>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search buttons…"
              className="w-full rounded-lg border border-slate-200 py-2 pl-8 pr-3 text-xs outline-none focus:border-amber-400"
            />
          </div>

          <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
            {portals.map(role => {
              const def = FAV_REGISTRY[role]!;
              const tabs = def.tabs.filter(t => !q || t.label.toLowerCase().includes(q) || def.label.toLowerCase().includes(q));
              if (tabs.length === 0) return null;
              return (
                <div key={role}>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{def.label}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {tabs.map(t => {
                      const k = favKey(role, t.id);
                      const on = favs.includes(k);
                      return (
                        <button
                          key={k}
                          type="button"
                          onClick={() => toggle(k)}
                          aria-pressed={on}
                          className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium cursor-pointer ${
                            on ? 'border-amber-400 bg-amber-50 text-amber-900' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          <Star className={`h-3 w-3 ${on ? 'fill-amber-400 text-amber-500' : 'text-slate-400'}`} />
                          {t.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] text-slate-400">Only portals your account can open are listed.<span className={sync === 'offline' ? 'text-rose-500' : ''}>
              {sync === 'offline' ? ' Offline — saved on this device, will sync when connected.'
                : sync === 'saving' || sync === 'loading' ? ' Syncing to your account…'
                : ' Synced to your account — available on all your devices.'}
            </span></p>
        </div>
      )}
    </div>
  );
};
