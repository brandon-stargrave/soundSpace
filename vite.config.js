import { defineConfig } from 'vite';

// Serves from the site root. The GitHub Pages workflow builds with
// --base=/soundSpace/ so local builds, `vite preview`, and server.js all work.
export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    port: 5173,
    open: true,
  },
});
