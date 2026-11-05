import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  build: { rollupOptions: { output: { manualChunks(id) {
    if (id.includes('/node_modules/ol/')) return 'map-engine';
    if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react-core';
  } } } },
  server: { port: 5173, strictPort: true },
});
