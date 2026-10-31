import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Εγκατάσταση στο κινητό («Προσθήκη στην αρχική οθόνη»). Μόνο online: ο service worker κρατάει την
    // εφαρμογή (HTML/JS/CSS), ποτέ δεδομένα του /api.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Budget',
        short_name: 'Budget',
        description: 'Έσοδα, έξοδα, επενδύσεις και καθαρή περιουσία',
        lang: 'el',
        start_url: '/',
        display: 'standalone',
        background_color: '#f6f6fb',
        theme_color: '#4f46e5',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    // API_PORT: για δοκιμές με δεύτερο server (π.χ. με δοκιμαστική βάση)
    proxy: { '/api': `http://127.0.0.1:${process.env.API_PORT ?? 3001}` },
  },
});
