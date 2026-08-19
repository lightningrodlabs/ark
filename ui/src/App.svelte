<script lang="ts">
  import { onMount, setContext } from 'svelte';
  import { AppWebsocket, encodeHashToBase64, type AppClient } from '@holochain/client';
  import { WeaveClient, initializeHotReload, isWeaveContext } from '@theweave/api';
  import { FileStorageClient } from '@holochain-open-dev/file-storage';
  import { ArkClient } from './ark-client';
  import { clientContext, storeContext } from './contexts';
  import { appletServices } from './we';
  import { TreeStore } from './stores/tree.svelte';
  import { DocumentStore, key } from './stores/documents.svelte';
  import { SearchStore } from './stores/search.svelte';
  import type { ActionHash } from '@holochain/client';
  import type { DocumentSummary } from './types';
  import FolderTree from './lib/FolderTree.svelte';
  import DocumentList from './lib/DocumentList.svelte';
  import DocumentView from './lib/DocumentView.svelte';
  import DocumentEditor from './lib/DocumentEditor.svelte';
  import SearchBar from './lib/SearchBar.svelte';
  import SearchResults from './lib/SearchResults.svelte';

  let ark: ArkClient | undefined = $state();
  let files: FileStorageClient | undefined = $state();
  let error: string | undefined = $state();
  let tree: TreeStore | undefined = $state();
  let store: DocumentStore | undefined = $state();
  let search: SearchStore | undefined = $state();
  let loadingDocs = $state(true);
  let loaded = $state(0);
  let selectedFolder: string | null = $state(null);
  let selectedDoc: DocumentSummary | null = $state(null);
  let editing: 'create' | 'amend' | null = $state(null);

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
      files = new FileStorageClient(client, 'ark');
      tree = new TreeStore(ark);
      await tree.load();
      store = new DocumentStore(ark);
      await store.load(tree.folders, (n) => (loaded = n));
      search = new SearchStore(store);
      search.rebuild();
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

  // Distinct authors across the archive; the search module itself does not
  // know about profiles, so the label is just the key's first eight
  // characters (a <profile-detail> element can replace this later).
  let authors = $derived(
    store
      ? [...new Set([...store.byOriginal.values()].map((d) => encodeHashToBase64(d.author)))].map(
          (k) => ({ key: k, label: k.slice(0, 8) }),
        )
      : [],
  );

  // An empty query with no filters is not a search — it falls through to the
  // ordinary folder-scoped document list.
  let searching = $derived(
    !!search &&
      (search.query.trim() !== '' ||
        !!search.from ||
        !!search.to ||
        !!search.author ||
        search.includeTrashed),
  );

  let searchResults = $derived.by(() => {
    if (!search || !tree || !searching) return [];
    return search.run(selectedFolder, tree.live);
  });

  function selectFolder(id: string | null) {
    selectedFolder = id;
    selectedDoc = null;
    editing = null;
  }

  function newDoc() {
    editing = 'create';
  }

  function amendDoc() {
    editing = 'amend';
  }

  async function trashDoc() {
    if (!ark || !store || !selectedDoc) return;
    const original = selectedDoc.original;
    await ark.trashDocument(original);
    await store.applySignal({ type: 'DocumentTrashed', original });
    search?.sync();
    selectedDoc = null;
  }

  async function onEditorDone(original: ActionHash) {
    if (!store) return;
    await store.refreshDocument(original);
    await store.refreshFilings();
    const doc = store.byOriginal.get(key(original)) ?? null;
    if (doc) search?.upsert(doc);
    search?.sync();
    selectedDoc = doc;
    editing = null;
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
      <div class="list-column">
        <button class="new-doc" onclick={newDoc}>New document</button>
        {#if search}
          <SearchBar {search} resultCount={searchResults.length} {authors} />
        {/if}
        {#if searching}
          <SearchResults
            hits={searchResults}
            onSelect={(doc) => {
              selectedDoc = doc;
              editing = null;
            }}
          />
        {:else}
          <DocumentList
            {documents}
            selected={selectedDoc ? key(selectedDoc.original) : null}
            onSelect={(doc) => {
              selectedDoc = doc;
              editing = null;
            }}
          />
        {/if}
      </div>
      {#if editing === 'create'}
        <DocumentEditor
          {ark}
          mode="create"
          folderId={selectedFolder}
          onDone={onEditorDone}
          onCancel={() => (editing = null)}
        />
      {:else if editing === 'amend' && selectedDoc}
        <DocumentEditor
          {ark}
          mode="amend"
          doc={selectedDoc}
          folderId={selectedFolder}
          onDone={onEditorDone}
          onCancel={() => (editing = null)}
        />
      {:else if selectedDoc && files && search}
        <DocumentView
          doc={selectedDoc}
          {ark}
          {files}
          {search}
          onAmend={amendDoc}
          onTrash={trashDoc}
        />
      {:else}
        <p class="hint">Select a document.</p>
      {/if}
    </div>
  {/if}
</main>

<style>
  .layout { display: flex; }
  .list-column { display: flex; flex-direction: column; }
  .new-doc { margin: 0.5rem; }
  .hint { padding: 1rem; opacity: 0.6; }
</style>
