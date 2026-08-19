// Entry point for the Playwright harness. Mounts the real App.svelte —
// unmodified production code — against an in-memory stub AppClient instead
// of a conductor, via the `window.__ARK_TEST_CLIENT__` seam App.svelte reads
// in onMount. See stub-client.ts for what the stub actually does.
import '../src/app.css';
import { mount } from 'svelte';
import App from '../src/App.svelte';
import { createStubClient } from './stub-client';

(window as unknown as { __ARK_TEST_CLIENT__?: unknown }).__ARK_TEST_CLIENT__ = createStubClient();

export default mount(App, { target: document.body });
