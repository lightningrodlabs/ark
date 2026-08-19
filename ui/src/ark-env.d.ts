/**
 * Build-time constants. `__ARK_VERSION__` is `ui/package.json`'s version,
 * substituted by Vite's `define` (see vite.config.ts and vitest.config.ts) so
 * the About dialog can name a version without bundling the manifest.
 */
declare const __ARK_VERSION__: string;
