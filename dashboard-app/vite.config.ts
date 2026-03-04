import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// Point this at whichever Studio backend you want to develop against.
// Override with STUDIO_PORT env var:  STUDIO_PORT=8791 pnpm dev
const studioPort = process.env.STUDIO_PORT ?? '8790';
const studioTarget = `http://127.0.0.1:${studioPort}`;

// https://vite.dev/config/
export default defineConfig({
  // Must be relative so the dashboard works over file://
  base: './',
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: studioTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    manifest: true,
  },
});
