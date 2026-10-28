import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    // API_PORT: για δοκιμές με δεύτερο server (π.χ. με δοκιμαστική βάση)
    proxy: { '/api': `http://127.0.0.1:${process.env.API_PORT ?? 3001}` },
  },
});
