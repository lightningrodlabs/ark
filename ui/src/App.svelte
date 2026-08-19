<script lang="ts">
  import { onMount, setContext } from 'svelte';
  import { AppWebsocket, type AppClient } from '@holochain/client';
  import { WeaveClient, initializeHotReload, isWeaveContext } from '@theweave/api';
  import { ArkClient } from './ark-client';
  import { clientContext, storeContext } from './contexts';
  import { appletServices } from './we';
  import { TreeStore } from './stores/tree.svelte';
  import { DocumentStore, key } from './stores/documents.svelte';
  import type { DocumentSummary } from './types';
  import FolderTree from './lib/FolderTree.svelte';
  import DocumentList from './lib/DocumentList.svelte';
  import DocumentView from './lib/DocumentView.svelte';

  let ark: ArkClient | undefined = $state();
  let error: string | undefined = $state();
  let tree: TreeStore | undefined = $state();
  let store: DocumentStore | undefined = $state();
  let loadingDocs = $state(true);
  let loaded = $state(0);
  let selectedFolder: string | null = $state(null);
  let selectedDoc: DocumentSummary | null = $state(null);

  setContext(clientContext, { get ark() { return ark; } });
  setContext(storeContext, { get store() { return store; } });

  onMount(async () => {
    try {
      let client: AppClient;
      if (import.meta.env.DEV && !isWeaveContext()) {
        await initializeHotReload().catch(() => {});
      }
      if (isWeaveContext()) {
        const weaveClient = await WeaveClient.connect(appletServices);
        if (weaveClient.renderInfo.type !== 'applet-view') throw new Error('Unsupported view');
        client = weaveClient.renderInfo.appletClient;
      } else {
        client = await AppWebsocket.connect({ defaultTimeout: 240000 });
      }
      ark = new ArkClient(client);
      tree = new TreeStore(ark);
      await tree.load();
      store = new DocumentStore(ark);
      await store.load(tree.folders, (n) => (loaded = n));
      loadingDocs = false;
    } catch (e) {
      error = String(e);
    }
  });

  // Root selection ("All documents") shows everything not trashed; a folder
  // selection narrows to that folder's subtree via the store.
  let documents = $derived.by(() => {
    if (!store || !tree) return [];
    const docs = store;
    return selectedFolder === null
      ? [...docs.byOriginal.values()].filter((d) => !docs.trashed.has(key(d.original)))
      : docs.inFolder(selectedFolder, tree.live);
  });

  function selectFolder(id: string | null) {
    selectedFolder = id;
    selectedDoc = null;
  }

  // Editing body/meta is Task 13's editor; this button is wired to it once
  // that lands.
  function amendDoc() {}

  async function trashDoc() {
    if (!ark || !store || !selectedDoc) return;
    const original = selectedDoc.original;
    await ark.trashDocument(original);
    await store.applySignal({ type: 'DocumentTrashed', original });
    selectedDoc = null;
  }
</script>

<main>
  <h1>ark</h1>
  {#if error}
    <p class="error">{error}</p>
  {:else if !tree || !ark}
    <p>Connecting…</p>
  {:else if !store || loadingDocs}
    <p>Loading documents… {loaded}</p>
  {:else}
    <div class="layout">
      <FolderTree
        {tree}
        {ark}
        selected={selectedFolder}
        counts={store.counts(tree.live)}
        onSelect={selectFolder}
      />
      <DocumentList
        {documents}
        selected={selectedDoc ? key(selectedDoc.original) : null}
        onSelect={(doc) => (selectedDoc = doc)}
      />
      {#if selectedDoc}
        <DocumentView doc={selectedDoc} {ark} onAmend={amendDoc} onTrash={trashDoc} />
      {:else}
        <p class="hint">Select a document.</p>
      {/if}
    </div>
  {/if}
</main>

<style>
  .layout { display: flex; }
  .hint { padding: 1rem; opacity: 0.6; }
</style>
