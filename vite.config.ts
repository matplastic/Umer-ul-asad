import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';

// Stamps a unique build id into dist/sw.js so every deploy produces a different
// service-worker file. That's what makes phones notice a new version, install it
// and throw away the previous version's cache.
const stampServiceWorker = () => ({
  name: 'stamp-service-worker',
  apply: 'build' as const,
  closeBundle() {
    const file = path.resolve(__dirname, 'dist/sw.js');
    if (!fs.existsSync(file)) return;
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/__BUILD_ID__/g, Date.now().toString(36)));
  },
});

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), stampServiceWorker()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
