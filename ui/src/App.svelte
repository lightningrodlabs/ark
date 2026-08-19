<script lang="ts">
  import { onDestroy, onMount, setContext } from 'svelte';
  import { AppWebsocket, encodeHashToBase64, type AppClient } from '@holochain/client';
  import { WeaveClient, initializeHotReload, isWeaveContext } from '@theweave/api';
  import { FileStorageClient } from '@holochain-open-dev/file-storage';
  import { ArkClient } from './ark-client';
  import { clientContext, storeContext } from './contexts';
  import { connectClient } from './connect';
  import { appletServices } from './we';
  import { TreeStore } from './stores/tree.svelte';
  import { DocumentStore, key } from './stores/documents.svelte';
  import { SearchStore } from './stores/search.svelte';
  import { SignalStore } from './stores/signals.svelte';
  import { trashEntries, type TrashEntry } from './stores/orphans';
  import type { ActionHash } from '@holochain/client';
  import type { DocumentSummary } from './types';
  import FolderTree from './lib/FolderTree.svelte';
  import DocumentList from './lib/DocumentList.svelte';
  import DocumentView from './lib/DocumentView.svelte';
  import DocumentEditor from './lib/DocumentEditor.svelte';
  import SearchBar from './lib/SearchBar.svelte';
  import SearchResults from './lib/SearchResults.svelte';
  import OrphanBin from './lib/OrphanBin.svelte';
  import TrashView from './lib/TrashView.svelte';
  import ImportPanel from './lib/ImportPanel.svelte';

  let ark: ArkClient | undefined = $state();
  let files: FileStorageClient | undefined = $state();
  let error: string | undefined = $state();
  let tree: TreeStore | undefined = $state();
  let store: DocumentStore | undefined = $state();
  let search: SearchStore | undefined = $state();
  let signals: SignalStore | undefined = $state();
  let weaveClient: WeaveClient | undefined;
  let loadingDocs = $state(true);
  let loaded = $state(0);
  let selectedFolder: string | null = $state(null);
  let selectedDoc: DocumentSummary | null = $state(null);
  let editing: 'create' | 'amend' | null = $state(null);
  let importing = $state(false);

  setContext(clientContext, { get ark() { return ark; } });
  setContext(storeContext, { get store() { return store; } });

  onMount(async () => {
    try {
      let client: AppClient;
      // Test seam: the Playwright harness (ui/harness/) sets this before
      // mounting so the real component tree runs against an in-memory stub
      // instead of a conductor. Absent in production, where this branch never
      // taken and the connection logic below is unchanged.
      const testClient = (window as unknown as { __ARK_TEST_CLIENT__?: AppClient })
        .__ARK_TEST_CLIENT__;
      if (testClient) {
        client = testClient;
      } else {
        // Ordering lives in connect.ts and is unit-tested there: hot reload
        // must be initialised before isWeaveContext() is consulted, or Moss is
        // never detected in applet-dev.
        client = await connectClient({
          isDev: import.meta.env.DEV,
          isWeaveContext,
          initializeHotReload,
          connectWeave: async () => {
            weaveClient = await WeaveClient.connect(appletServices);
            if (weaveClient.renderInfo.type !== 'applet-view')
              throw new Error('Unsupported view');
            return weaveClient.renderInfo.appletClient;
          },
          connectWebsocket: () => AppWebsocket.connect({ defaultTimeout: 240000 }),
        });
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

      const currentStore = store;
      const currentTree = tree;
      const currentSearch = search;
      signals = new SignalStore(
        client,
        ark,
        async (signal) => {
          await currentStore.applySignal(signal);
          if (signal.type === 'TreeUpdated') await currentTree.load();
          if (signal.type === 'DocumentCreated' || signal.type === 'DocumentAmended') {
            const doc = currentStore.byOriginal.get(key(signal.original));
            if (doc) currentSearch.upsert(doc);
          }
          currentSearch.sync();
        },
        async () => {
          await currentTree.load();
          await currentStore.load(currentTree.folders);
          currentSearch.rebuild();
        },
      );
      // A folder add/rename/reparent/delete changes which folder ids exist,
      // but DocumentStore.filings and its cached `lastFolders` (used by
      // refreshFilings after a create/amend) are not otherwise told about it
      // — nothing previously refreshed them for the *local* agent's own tree
      // write (only a remote TreeUpdated signal, or the periodic reconcile,
      // did). Without this, filing a new document into a folder created
      // earlier in the same session queries get_filings with a folder id
      // list that predates the folder, so the document's filing link is
      // never read and it silently drops out of that folder's list.
      currentTree.onUpdate = (action) => {
        void currentStore.loadFilings(currentTree.folders);
        void signals?.broadcast({ type: 'TreeUpdated', action });
      };
      signals.start();
      await signals.refreshPeers(weaveClient, client.myPubKey);
      weaveClient?.onPeerStatusUpdate(() => {
        void signals?.refreshPeers(weaveClient, client.myPubKey);
      });
    } catch (e) {
      error = String(e);
    }
  });

  onDestroy(() => signals?.stop());

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
    importing = false;
  }

  // Toggled from the toolbar. Opening also backs out of any open editor/doc
  // view; closing is left to the user (see onImportDone below) rather than
  // happening automatically after a run, so the completed summary — created,
  // skipped, attached, any failures — actually stays on screen to be read.
  function toggleImport() {
    if (importing) {
      importing = false;
    } else {
      importing = true;
      editing = null;
      selectedDoc = null;
    }
  }

  // ImportPanel has already reloaded the document store and created any new
  // folders by the time onDone fires; only the search index needs rebuilding.
  // Deliberately does not close the panel — see toggleImport.
  function onImportDone() {
    search?.rebuild();
  }

  function amendDoc() {
    editing = 'amend';
  }

  async function trashDoc() {
    if (!ark || !store || !selectedDoc) return;
    const original = selectedDoc.original;
    try {
      await ark.trashDocument(original);
      await store.applySignal({ type: 'DocumentTrashed', original });
      await signals?.broadcast({ type: 'DocumentTrashed', original });
      search?.sync();
      selectedDoc = null;
    } catch (e) {
      alert(`Could not move this document to the trash.\n\n${e}`);
    }
  }

  async function restoreDoc(original: ActionHash) {
    if (!ark || !store) return;
    try {
      await ark.restoreDocument(original);
      await store.applySignal({ type: 'DocumentRestored', original });
      await signals?.broadcast({ type: 'DocumentRestored', original });
      search?.sync();
    } catch (e) {
      alert(`Could not restore this document from the trash.\n\n${e}`);
    }
  }

  // Used both for the Unfiled bin (from = null) and each deleted-folder bin.
  // Re-syncs the search index so a document moved out of a deleted folder
  // stops being found under it.
  async function refileDoc(original: ActionHash, from: string | null, to: string) {
    if (!ark || !store) return;
    await ark.moveDocument({ original, from, to });
    await store.applySignal({ type: 'DocumentMoved', original, from, to });
    await signals?.broadcast({ type: 'DocumentMoved', original, from, to });
    search?.sync();
  }

  function openTrashed(entry: TrashEntry) {
    selectedDoc = entry.doc;
    editing = null;
  }

  function openDoc(doc: DocumentSummary) {
    selectedDoc = doc;
    editing = null;
  }

  let unfiledDocs = $derived(store ? store.unfiled() : []);
  let deletedBins = $derived(store && tree ? store.inDeletedFolders(tree.folders) : []);
  let trashList = $derived(store && tree ? trashEntries(store, tree.folders) : []);

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
  {:else if !store || loadingDocs || !signals}
    <p>Loading documents… {loaded}</p>
  {:else}
    {#if store.missing > 0}
      <p class="missing-note">
        {store.missing} document{store.missing === 1 ? '' : 's'}
        {store.missing === 1 ? 'is' : 'are'} not available on this device yet. They may still be
        syncing from other peers.
      </p>
    {/if}
    <div class="layout">
      <div class="sidebar">
        <FolderTree
          {tree}
          {ark}
          {signals}
          selected={selectedFolder}
          counts={store.counts(tree.live)}
          onSelect={selectFolder}
        />
        <div class="bins">
          {#if unfiledDocs.length > 0}
            <OrphanBin
              title="Unfiled"
              documents={unfiledDocs}
              fromFolderId={null}
              folders={tree.live}
              onRefile={refileDoc}
              onOpen={openDoc}
            />
          {/if}
          {#each deletedBins as bin (bin.folder.id)}
            <OrphanBin
              title={`Deleted folder: ${bin.folder.name}`}
              documents={bin.documents}
              fromFolderId={bin.folder.id}
              folders={tree.live}
              onRefile={refileDoc}
              onOpen={openDoc}
            />
          {/each}
          <TrashView entries={trashList} onRestore={restoreDoc} onOpen={openTrashed} />
        </div>
      </div>
      <div class="list-column">
        <div class="toolbar">
          <button class="new-doc" onclick={newDoc}>New document</button>
          <button class="import" onclick={toggleImport}>{importing ? 'Close import' : 'Import'}</button>
        </div>
        {#if search}
          <SearchBar {search} resultCount={searchResults.length} {authors} />
        {/if}
        {#if searching}
          <SearchResults hits={searchResults} onSelect={openDoc} />
        {:else}
          <DocumentList
            {documents}
            selected={selectedDoc ? key(selectedDoc.original) : null}
            onSelect={openDoc}
          />
        {/if}
      </div>
      {#if importing && ark && store && files}
        <ImportPanel {ark} {tree} {store} fileStorage={files} {search} onDone={onImportDone} />
      {:else if editing === 'create'}
        <DocumentEditor
          {ark}
          {signals}
          mode="create"
          folderId={selectedFolder}
          onDone={onEditorDone}
          onCancel={() => (editing = null)}
        />
      {:else if editing === 'amend' && selectedDoc}
        <DocumentEditor
          {ark}
          {signals}
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
  .sidebar { display: flex; flex-direction: column; }
  .bins { display: flex; flex-direction: column; gap: 0.5rem; padding: 0.5rem; }
  .list-column { display: flex; flex-direction: column; }
  .toolbar { display: flex; gap: 0.5rem; margin: 0.5rem; }
  .new-doc, .import { margin: 0; }
  .hint { padding: 1rem; opacity: 0.6; }
  .missing-note {
    margin: 0.5rem;
    padding: 0.5rem 0.75rem;
    background: #fef3c7;
    color: #92400e;
    border-radius: 4px;
  }
</style>
