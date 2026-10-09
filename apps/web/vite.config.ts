import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxy = {
    '/api': {
      target: env.API_PROXY_TARGET || 'http://127.0.0.1:3001',
      changeOrigin: true,
    },
  };

  return {
    plugins: [react()],
    // Pre-bundle the lazily imported ElevenLabs client at startup. Otherwise Vite
    // discovers it on first use, re-bundles, and an open page can be left with a
    // stale module URL ("Failed to fetch dynamically imported module").
    optimizeDeps: { include: ['@elevenlabs/client'] },
    server: {
      host: true,
      port: 3000,
      strictPort: true,
      allowedHosts: ['.trycloudflare.com'],
      proxy,
    },
    preview: { host: true, port: 3000, strictPort: true, proxy },
  };
});
