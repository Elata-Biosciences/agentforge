import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  // Must be relative so the dashboard works over file://
  base: './',
  plugins: [react()],
  build: {
    manifest: true,
  },
});
