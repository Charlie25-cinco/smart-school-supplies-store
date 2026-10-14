export function registerPwa(): void {
  if (!('serviceWorker' in navigator) || !window.isSecureContext || import.meta.env.DEV) return;
  navigator.serviceWorker.register('/staff/sw.js',{scope:'/staff/'}).catch(() => {
    window.dispatchEvent(new CustomEvent('pwa-status',{detail:'Offline installation is unavailable. Keep this page open and check your connection.'}));
  });
}
