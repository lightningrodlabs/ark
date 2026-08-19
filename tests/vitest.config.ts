import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // One test file at a time. Each file spins real conductors, and running
    // several at once exhausts memory on an ordinary dev machine — which shows
    // up as flaky failures that look like race conditions in the DNA.
    fileParallelism: false,
    threads: false,
    testTimeout: 60 * 1000 * 3,
  },
});
