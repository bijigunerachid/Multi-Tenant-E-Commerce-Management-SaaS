import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    // The browser talks to the API on the same origin, so the session cookie stays
    // first-party and SameSite=Lax works without cross-site exceptions.
    proxy: {
      // API_PROXY_TARGET is read here in Node only; it is never exposed to the browser bundle.
      '/api': {
        target: process.env.API_PROXY_TARGET ?? 'http://localhost:4100',
        changeOrigin: false,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Third-party libraries change far less often than application code; keeping them in
        // their own chunks lets browsers reuse them across deployments.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'vendor-react';
          if (id.includes('react-router')) return 'vendor-router';
          if (id.includes('@tanstack')) return 'vendor-query';
          if (/zod|react-hook-form|@hookform/.test(id)) return 'vendor-forms';
          return 'vendor';
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/tests/setup.js'],
    // Every test starts with fresh mocks: no call counts or implementations leak between tests.
    mockReset: true,
  },
});
