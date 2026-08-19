import { defineConfig, devices } from '@playwright/test';

// Runs the real App.svelte component tree against an in-memory stub
// AppClient (harness/stub-client.ts) — no conductor, no display server.
// Headless Chromium needs neither.
const PORT = 5588;

export default defineConfig({
  testDir: './harness',
  testMatch: '**/*.spec.ts',
  outputDir: './harness/__results__',
  fullyParallel: false,
  reporter: [['list']],
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 900 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort --clearScreen false`,
    url: `http://localhost:${PORT}/harness/index.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
