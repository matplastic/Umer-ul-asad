// Registers /sw.js (production builds only) so the app can be installed on a
// phone and opens quickly. See public/sw.js for what is and isn't cached.
//
// Fires a "pwa-update-ready" window event when a newer version has been
// installed while the app is open — PwaPrompts shows a "Reload" banner.
export function registerServiceWorker(): void {
  const isProd = (import.meta as any).env?.PROD;
  if (!isProd || typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        reg.addEventListener('updatefound', () => {
          const incoming = reg.installing;
          if (!incoming) return;
          incoming.addEventListener('statechange', () => {
            // "installed" while an older worker already controls the page = this is an UPDATE, not a first install.
            if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
              window.dispatchEvent(new Event('pwa-update-ready'));
            }
          });
        });
        // Installed apps stay open for days on a phone: look for a new version whenever it's brought back to the front.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {});
        });
      })
      .catch(() => { /* not fatal — the app just won't be installable / cached */ });
  });
}
