import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Mirrors vite.config.ts: components read __ARK_VERSION__, so it has to be
// defined here too or a component test dies on an undefined global.
const { version } = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
);

export default defineConfig({
  plugins: [svelte({ hot: false })],
  define: { __ARK_VERSION__: JSON.stringify(version) },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
