// Entry point for the Playwright harness. Mounts the real App.svelte —
// unmodified production code — against an in-memory stub AppClient instead
// of a conductor, via the `window.__ARK_TEST_CLIENT__` seam App.svelte reads
// in onMount. See stub-client.ts for what the stub actually does.
import '../src/app.css';
import { mount } from 'svelte';
import App from '../src/App.svelte';
import { createStubClient } from './stub-client';
import { seedReferenceArchive } from './seed';

const client = createStubClient();

// `?seed=archive` fills the stub with an archive the shape of the real one
// before the app mounts — thirteen committees, 1406 documents, the largest
// committee holding 280. Used by scale.spec.ts to exercise the tree at the
// size it actually has to work at. Absent by default, so every other spec
// still starts from an empty archive.
if (new URLSearchParams(location.search).get('seed') === 'archive') {
  await seedReferenceArchive(client);
}

(window as unknown as { __ARK_TEST_CLIENT__?: unknown }).__ARK_TEST_CLIENT__ = client;

export default mount(App, { target: document.body });
