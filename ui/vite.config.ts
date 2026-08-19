import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// The version shown in the About dialog. Injected here rather than imported,
// because `import pkg from './package.json'` would pull the whole manifest —
// dependency list included — into the applet bundle to display one string.
const { version } = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
);

export default defineConfig({
  plugins: [svelte()],
  define: { __ARK_VERSION__: JSON.stringify(version) },
  build: { minify: false },
  optimizeDeps: {
    include: ['@holochain-open-dev/elements/dist/elements/display-error.js'],
  },
  resolve: { dedupe: ['@holochain-open-dev/elements'] },
});
