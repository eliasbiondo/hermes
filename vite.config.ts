import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { fileURLToPath, URL } from 'node:url';
import manifest from './src/manifest.config';

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      include: ['path', 'stream', 'util', 'events', 'os', 'buffer'],
      globals: { Buffer: true, global: true, process: true },
      protocolImports: true,
    }),
    crx({ manifest }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'esnext',
    sourcemap: true,
    rollupOptions: {
      input: {
        offscreen: fileURLToPath(new URL('./src/offscreen/index.html', import.meta.url)),
        onboarding: fileURLToPath(new URL('./src/onboarding/index.html', import.meta.url)),
        edit: fileURLToPath(new URL('./src/edit/index.html', import.meta.url)),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: { port: 5173 },
  },
});
