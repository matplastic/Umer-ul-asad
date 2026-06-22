import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Automatically handle API routing for Netlify/static hosting when VITE_API_URL is configured
if (typeof window !== 'undefined' && (import.meta as any).env?.VITE_API_URL) {
  const originalFetch = window.fetch;
  window.fetch = function (input, init) {
    if (typeof input === 'string' && input.startsWith('/api/')) {
      const base = (import.meta as any).env.VITE_API_URL.replace(/\/$/, '');
      return originalFetch(`${base}${input}`, init);
    }
    return originalFetch(input, init);
  };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
