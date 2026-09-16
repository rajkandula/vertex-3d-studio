import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

// Static build of the public gallery (GitHub Pages): finished models only —
// no server, no API key, no accounts. The studio itself still builds from vite.config.ts.
export default defineConfig({
  base: '/vertex-3d-studio/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  build: {
    outDir: 'dist-gallery',
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'gallery.html'),
    },
  },
});
