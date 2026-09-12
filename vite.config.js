import { defineConfig } from 'vite';

// Serves from the site root. The GitHub Pages workflow builds with
// --base=/soundSpace/ so local builds, `vite preview`, and server.js all work.
export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    sourcemap: true,
    // three.js alone minifies to ~530 kB and can't be split further
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Libraries get their own chunks: they download in parallel and stay
        // cached across deploys that only change app code
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('/three/')) return 'three';
          if (/\/(tone|standardized-audio-context|automation-events)\//.test(id)) return 'tone';
          if (id.includes('/@ffmpeg/')) return 'ffmpeg';
        },
      },
    },
  },
  server: {
    port: 5173,
    open: true,
  },
});
