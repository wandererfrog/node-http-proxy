import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works from any static host (GitHub Pages, itch.io, ...).
  base: './',
  build: { chunkSizeWarningLimit: 2000 },
});
