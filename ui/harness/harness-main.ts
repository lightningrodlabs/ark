// Entry point for the Playwright harness. Mounts the real App.svelte —
// unmodified production code — against an in-memory stub AppClient instead
// of a conductor, via the `window.__ARK_TEST_CLIENT__` seam App.svelte reads
// in onMount. See stub-client.ts for what the stub actually does.
import '../src/app.css';
import { mount } from 'svelte';
import App from '../src/App.svelte';
import { createStubClient } from './stub-client';
import {
  seedReferenceArchive,
  seedPendingStructureArchive,
  seedAssetDocument,
  seedAssetDocumentWithTextAttachment,
  seedAssetDocumentWithImageAttachment,
  seedAssetDocumentWithVersions,
} from './seed';

const client = createStubClient();
const params = new URLSearchParams(location.search);

// `?seed=archive` fills the stub with an archive the shape of the real one
// before the app mounts — thirteen committees, 1406 documents, the largest
// committee holding 280. Used by scale.spec.ts to exercise the tree at the
// size it actually has to work at. Absent by default, so every other spec
// still starts from an empty archive.
if (params.get('seed') === 'archive') {
  await seedReferenceArchive(client);
}

// `?seed=pending-structure` seeds one folder with two documents filed in it,
// then marks the tree's root link as arrived without its entry — the "node
// has documents but not the folder structure" load-phase gap. Used by
// pending-structure.spec.ts. `__ARK_RESOLVE_TREE__` lets a spec simulate the
// entry gossiping in later, mirroring what a reconcile does in production.
if (params.get('seed') === 'pending-structure') {
  await seedPendingStructureArchive(client);
  client.simulateStructurePending();
}
(window as unknown as { __ARK_RESOLVE_TREE__?: () => void }).__ARK_RESOLVE_TREE__ = () =>
  client.resolveStructure();

// Park/release a zome fn, so a spec can assert on what the UI looks like
// while a call is still in flight — see stub-client's stallZomeCalls, and
// pane-header.spec.ts, which uses it to catch a running import.
//
// `?stall=<fn>` does the same from BEFORE the app mounts, which the window
// seam cannot: by the time a spec can call it the corpus has already loaded,
// so the initial-load specs (progressive-load.spec.ts) need the park in place
// first.
//
// `__ARK_RELEASE_ONE__` lets the single parked call through and immediately
// parks the next one, so a spec can walk a long run — a paged load, an import
// — one zome call at a time and assert on what the UI shows in between. The
// re-park lands before the released call's continuation runs, because
// `releaseZomeCalls` only resolves promises: their `await`s resume as
// microtasks after this synchronous function returns.
let stalled: string | null = params.get('stall');
if (stalled) client.stallZomeCalls(stalled);
(window as unknown as { __ARK_STALL__?: (fn: string) => void }).__ARK_STALL__ = (fn) => {
  stalled = fn;
  client.stallZomeCalls(fn);
};
(window as unknown as { __ARK_RELEASE__?: () => void }).__ARK_RELEASE__ = () => {
  stalled = null;
  client.releaseZomeCalls();
};
(window as unknown as { __ARK_RELEASE_ONE__?: () => void }).__ARK_RELEASE_ONE__ = () => {
  const fn = stalled;
  client.releaseZomeCalls();
  if (fn) client.stallZomeCalls(fn);
};

// `?asset=plain` or `?asset=rendered` seeds one known document directly
// against the stub, then sets `__ARK_TEST_ASSET__` so App.svelte's onMount
// takes the Moss asset-rendering branch instead of the normal boot path —
// the seam described in asset-view.spec.ts. The two values differ only in
// `context.view`, mirroring the two WALs the same document gets in real
// Moss (see we.ts / DocumentView's "Add to pocket" controls).
// `?asset=attachment-text` / `?asset=attachment-image` seed the same
// document plus one attachment, for the asset view's reused
// Attachments.svelte (read-only mode — see AssetView.svelte and
// asset-view.spec.ts). `?asset=versions` seeds it amended once, for
// VersionHistory.
const asset = params.get('asset');
if (asset === 'plain' || asset === 'rendered') {
  const hash = await seedAssetDocument(client);
  (window as unknown as { __ARK_TEST_ASSET__?: unknown }).__ARK_TEST_ASSET__ = {
    hash,
    context: asset === 'rendered' ? { view: 'rendered' } : {},
  };
} else if (asset === 'attachment-text') {
  const hash = await seedAssetDocumentWithTextAttachment(client);
  (window as unknown as { __ARK_TEST_ASSET__?: unknown }).__ARK_TEST_ASSET__ = { hash, context: {} };
} else if (asset === 'attachment-image') {
  const hash = await seedAssetDocumentWithImageAttachment(client);
  (window as unknown as { __ARK_TEST_ASSET__?: unknown }).__ARK_TEST_ASSET__ = { hash, context: {} };
} else if (asset === 'versions') {
  const hash = await seedAssetDocumentWithVersions(client);
  (window as unknown as { __ARK_TEST_ASSET__?: unknown }).__ARK_TEST_ASSET__ = { hash, context: {} };
} else if (asset === 'missing') {
  // A hash the stub has never seen — the same shape a trashed or
  // not-yet-synced document produces for a real WAL in Moss.
  (window as unknown as { __ARK_TEST_ASSET__?: unknown }).__ARK_TEST_ASSET__ = {
    hash: new Uint8Array(39),
    context: {},
  };
}

(window as unknown as { __ARK_TEST_CLIENT__?: unknown }).__ARK_TEST_CLIENT__ = client;
(window as unknown as { __ARK_ZOME_CALLS__?: unknown }).__ARK_ZOME_CALLS__ = client.calls;

export default mount(App, { target: document.body });
