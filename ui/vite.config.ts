import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  build: { minify: false },
  optimizeDeps: {
    include: ['@holochain-open-dev/elements/dist/elements/display-error.js'],
  },
  resolve: { dedupe: ['@holochain-open-dev/elements'] },
});
