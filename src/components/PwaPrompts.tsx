import React, { useEffect, useState } from 'react';
import { Download, RefreshCw, WifiOff, X } from 'lucide-react';

// Three small phone-app helpers, rendered once in main.tsx:
//  1. "Install app" button (Chrome on Android offers it when the app is installable)
//  2. "New version available" banner after a deploy
//  3. "You are offline" banner — saving to the database needs a connection,
//     so people should know when they've lost it instead of wondering why a save failed.

const DISMISS_KEY = 'mat_pwa_install_dismissed';
const DISMISS_DAYS = 7;

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const isStandalone = (): boolean =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true);

const recentlyDismissed = (): boolean => {
  try {
    const t = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return t > 0 && Date.now() - t < DISMISS_DAYS * 86400000;
  } catch { return false; }
};

export const PwaPrompts: React.FC = () => {
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);
  const [updateReady, setUpdateReady] = useState(false);
  const [offline, setOffline] = useState(typeof navigator !== 'undefined' ? navigator.onLine === false : false);

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();                       // keep the event so we can show our own button
      if (isStandalone() || recentlyDismissed()) return;
      setInstallEvent(e as InstallEvent);
    };
    const onInstalled = () => setInstallEvent(null);
    const onUpdate = () => setUpdateReady(true);
    const onOnline = () => setOffline(false);
    const onOffline = () => setOffline(true);

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    window.addEventListener('pwa-update-ready', onUpdate);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
      window.removeEventListener('pwa-update-ready', onUpdate);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const install = async () => {
    if (!installEvent) return;
    try {
      await installEvent.prompt();
      await installEvent.userChoice;
    } catch { /* ignore */ }
    setInstallEvent(null);                      // the browser only lets each event be used once
  };

  const dismissInstall = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* ignore */ }
    setInstallEvent(null);
  };

  return (
    <>
      {offline && (
        <div data-testid="pwa-offline" className="fixed top-0 inset-x-0 z-[9999] flex items-center justify-center gap-2 bg-amber-600 text-white text-xs font-bold py-1.5 px-3">
          <WifiOff className="h-3.5 w-3.5 shrink-0" />
          You're offline — changes can't be saved until you reconnect.
        </div>
      )}

      {updateReady && (
        <div data-testid="pwa-update" className="fixed bottom-4 inset-x-4 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 z-[9999] flex items-center gap-3 bg-slate-800 border border-orange-500/60 text-white text-xs rounded-xl shadow-2xl px-4 py-3">
          <RefreshCw className="h-4 w-4 text-orange-400 shrink-0" />
          <span className="font-semibold">A new version of MAT-ERP is available.</span>
          <button onClick={() => window.location.reload()} data-testid="pwa-reload" className="ml-auto px-3 py-1.5 bg-orange-600 hover:bg-orange-700 rounded-lg font-bold cursor-pointer">Reload</button>
          <button onClick={() => setUpdateReady(false)} title="Later" className="text-slate-400 hover:text-white cursor-pointer"><X className="h-4 w-4" /></button>
        </div>
      )}

      {installEvent && !updateReady && (
        <div className="fixed bottom-4 left-4 z-[9998] flex items-center gap-1 bg-slate-800 border border-slate-600 rounded-full shadow-2xl pl-1 pr-2 py-1">
          <button onClick={install} data-testid="pwa-install" className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white rounded-full text-xs font-bold cursor-pointer">
            <Download className="h-3.5 w-3.5" /> Install app
          </button>
          <button onClick={dismissInstall} data-testid="pwa-install-dismiss" title="Not now" className="text-slate-400 hover:text-white p-1 cursor-pointer"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}
    </>
  );
};
