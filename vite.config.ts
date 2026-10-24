import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// BUTTERFLY — Vite configuration.
// The optional LLM adapter (server/index.ts) listens on :8787; the dev server proxies /api to it.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  optimizeDeps: {
    // Only the app entry: helper pages under scripts/ must not be scanned.
    entries: ['index.html'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
        // The AI adapter is optional: answer 503 quietly instead of logging a stack trace when it is not running.
        configure: (proxy) => {
          proxy.on('error', (_err, _req, res) => {
            const r = res as import('node:http').ServerResponse;
            if (!r.headersSent && typeof r.writeHead === 'function') {
              r.writeHead(503, { 'content-type': 'application/json' });
              r.end(JSON.stringify({ enabled: false, message: 'Serveur IA non démarré — narration IA désactivée' }));
            }
          });
        },
      },
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
