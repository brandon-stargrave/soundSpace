import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

/** Ship the license notices with the built site, as the MIT terms of the bundled code require. */
function licenseNotices() {
  return {
    name: 'license-notices',
    apply: 'build',
    generateBundle() {
      for (const [source, fileName] of [
        ['LICENSE', 'LICENSE.txt'],
        ['THIRD_PARTY_LICENSES.md', 'THIRD_PARTY_LICENSES.txt'],
      ]) {
        this.emitFile({ type: 'asset', fileName, source: readFileSync(source, 'utf8') });
      }
    },
  };
}

// Serves from the site root. The GitHub Pages workflow builds with
// --base=/soundSpace/ so local builds, `vite preview`, and server.js all work.
export default defineConfig({
  root: '.',
  publicDir: 'public',
  plugins: [licenseNotices()],
  // The ffmpeg wrapper creates its worker with new URL('./worker.js', import.meta.url),
  // which dependency pre-bundling would break in `npm run dev`
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
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
