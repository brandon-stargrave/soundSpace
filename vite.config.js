import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  root: '.',
  publicDir: 'public',
  base: command === 'build' ? '/soundSpace/' : '/',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    port: 5173,
    open: true,
  },
}));
