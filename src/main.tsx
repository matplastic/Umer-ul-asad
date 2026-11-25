import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import './lib/safeStorage';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PwaPrompts } from './components/PwaPrompts';
import { registerServiceWorker } from './lib/registerServiceWorker';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
    <PwaPrompts />
  </StrictMode>,
);

// Installable phone app: cache the app shell (never live data) — see public/sw.js
registerServiceWorker();
