<script lang="ts">
  import { onDestroy, onMount, setContext } from 'svelte';
  import { AppWebsocket, CellType, encodeHashToBase64, type AppClient, type DnaHash } from '@holochain/client';
  import { WeaveClient, initializeHotReload, isWeaveContext, type WAL } from '@theweave/api';
  import { FileStorageClient } from '@holochain-open-dev/file-storage';
  import { ArkClient, ROLE_NAME } from './ark-client';
  import { clientContext, storeContext, weaveContext } from './contexts';
  import { connectClient } from './connect';
  import { appletServices } from './we';
  import { TreeStore } from './stores/tree.svelte';
  import { DocumentStore, key } from './stores/documents.svelte';
  import { SearchStore } from './stores/search.svelte';
  import { SignalStore } from './stores/signals.svelte';
  import { reconcile } from './reconcile';
  import { trashEntries, type TrashEntry } from './stores/orphans';
  import { folderPathLabel } from './tree/paths';
  import type { SearchHit } from './search/index';
  import type { ActionHash } from '@holochain/client';
  import type { DocumentSummary } from './types';
  import './shoelace';
  import ArkTree from './lib/ArkTree.svelte';
  import DocumentView from './lib/DocumentView.svelte';
  import DocumentEditor from './lib/DocumentEditor.svelte';
  import SearchBar from './lib/SearchBar.svelte';
  import OrphanBin from './lib/OrphanBin.svelte';
  import TrashView from './lib/TrashView.svelte';
  import ImportPanel from './lib/ImportPanel.svelte';
  import AssetView from './lib/AssetView.svelte';

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
  // Moss asset-rendering path (see onMount): a single document, read-only,
  // with none of the tree/store/search/signals apparatus ever built. `null`
  // means the document did not resolve (trashed, or not yet synced to this
  // device) rather than an error.
  let isAssetView = $state(false);
  let assetDoc: DocumentSummary | null = $state(null);
  // The ark cell's DNA hash, fetched once at startup — see the "Add to
  // pocket" controls in DocumentView, which need it for every WAL's `hrl[0]`.
  // Only ever set inside Moss; pocket controls are gated on its presence.
  let dnaHash: DnaHash | undefined = $state();

  setContext(clientContext, { get ark() { return ark; } });
  setContext(storeContext, { get store() { return store; } });
  // profilesClient only exists inside Moss (weaveClient.renderInfo, narrowed
  // to the applet-view case in onMount below); hc-spin dev and the e2e
  // harness never set weaveClient, so this getter returns undefined there and
  // AgentAvatar falls back to identicons — see Task A in the dispatch brief.
  setContext(weaveContext, {
    get profilesClient() {
      return weaveClient?.renderInfo.type === 'applet-view'
        ? weaveClient.renderInfo.profilesClient
        : undefined;
    },
    get dnaHash() {
      return dnaHash;
    },
    addToPocket(wal: WAL) {
      void weaveClient?.assets.assetToPocket(wal);
    },
  });

  onMount(async () => {
    try {
      let client: AppClient;
      // Test seam: the Playwright harness (ui/harness/) sets this before
      // mounting so the real component tree runs against an in-memory stub
      // instead of a conductor. Absent in production, where this branch never
      // taken and the connection logic below is unchanged.
      const testClient = (window as unknown as { __ARK_TEST_CLIENT__?: AppClient })
        .__ARK_TEST_CLIENT__;
      // Test seam for the Moss asset-rendering path: the harness has no real
      // weaveClient (see stub-client.ts), so it sets this instead of relying
      // on `weaveClient.renderInfo.view.type === 'asset'` below.
      const testAsset = (
        window as unknown as {
          __ARK_TEST_ASSET__?: { hash: ActionHash; context?: { view?: string } };
        }
      ).__ARK_TEST_ASSET__;
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

      // Branch on the asset view BEFORE any store is built. TreeStore.load()
      // and DocumentStore.load() fetch and index the whole corpus (1406
      // documents in production) — exactly what rendering one document in a
      // Moss pocket must not trigger. See the moss-assets dispatch brief.
      const assetWal: WAL | undefined = testAsset
        ? { hrl: [new Uint8Array(), testAsset.hash], context: testAsset.context }
        : weaveClient?.renderInfo.type === 'applet-view' && weaveClient.renderInfo.view.type === 'asset'
          ? weaveClient.renderInfo.view.wal
          : undefined;
      if (assetWal) {
        ark = new ArkClient(client);
        // Attachments (preview/download) need this too — see AssetView,
        // which reuses Attachments.svelte in read-only mode rather than a
        // second implementation.
        files = new FileStorageClient(client, 'ark');
        assetDoc = (await ark.getDocument(assetWal.hrl[1])) ?? null;
        isAssetView = true;
        return;
      }

      ark = new ArkClient(client);
      files = new FileStorageClient(client, 'ark');
      if (weaveClient) {
        // Fetched once here, not per "Add to pocket" click — see DocumentView.
        const info = await client.appInfo();
        const cell = info?.cell_info[ROLE_NAME]?.find((c) => c.type === CellType.Provisioned);
        if (cell?.type === CellType.Provisioned) dnaHash = cell.value.cell_id[0];
      }
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
        async (source) => {
          await reconcile(source, { tree: currentTree, store: currentStore, search: currentSearch });
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

  // Where a hit lives, for the search overlay's "where is it?" line. Folders
  // are ambiguous by name alone across thirteen committees that each have a
  // "2026", so this is the whole ancestor chain.
  function locationOf(hit: SearchHit): string {
    if (!store || !tree) return '';
    return folderPathLabel(tree.live, store.filings.get(key(hit.doc.original)));
  }

  // Distinct authors across the archive. The search module itself does not
  // know about profiles or identity — it only sees the raw agent key — so
  // SearchBar renders each entry as an <AgentAvatar>, which resolves the key
  // to a Moss profile avatar or an identicon (never as visible hash text).
  let authors = $derived(
    store
      ? [...new Map([...store.byOriginal.values()].map((d) => [encodeHashToBase64(d.author), d.author])).entries()].map(
          ([key, hash]) => ({ key, hash }),
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
    importing = false;
  }

  /** The tree hands back a document key, not the summary itself. */
  function openDocByKey(k: string) {
    const doc = store?.byOriginal.get(k);
    if (doc) openDoc(doc);
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
  <!-- No <h1>ark</h1>: Moss's own tool bar already names the applet directly
       above this iframe, so a second title only cost vertical space in a pane
       that is mostly a list. -->
  {#if isAssetView && ark && files}
    <AssetView doc={assetDoc} {ark} {files} />
  {:else if error}
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

    <!-- Toolbar and search span the full width, above the split. The search
         overlay anchors to an input this wide, which is what gives the KWIC
         snippets room to be readable; anchored inside the tree column they
         would be a few words per line. -->
    <div class="header">
      <div class="toolbar">
        <button class="new-doc" onclick={newDoc}>New document</button>
        <button class="import" onclick={toggleImport}>{importing ? 'Close import' : 'Import'}</button>
      </div>
      {#if search}
        <div class="search-slot">
          <SearchBar
            {search}
            hits={searchResults}
            {searching}
            {locationOf}
            {authors}
            onSelect={(hit) => openDoc(hit.doc)}
          />
        </div>
      {/if}
    </div>

    <!-- sl-split-panel rather than plain flex. The columns used to be sized by
         their content, so opening a document — which changes what is in the
         right-hand pane — resized the left-hand one underneath the pointer.
         A split panel gives both panes a position that only ever moves when
         the divider is dragged. -->
    <sl-split-panel class="layout" position="30" snap="25% 30% 40%">
      <div slot="start" class="pane pane-start">
        <ArkTree
          {tree}
          {store}
          {ark}
          {signals}
          counts={store.counts(tree.live)}
          {selectedFolder}
          selectedDoc={selectedDoc ? key(selectedDoc.original) : null}
          onSelectFolder={selectFolder}
          onOpenDocument={openDocByKey}
        />
        <!-- Bins and Trash stay BELOW the tree rather than becoming nodes in
             it. They are recovery surfaces, not part of the archive's filing
             structure — showing "Unfiled" and "Deleted folder: X" as siblings
             of real committees would imply they are places to file things.
             They also carry bulk controls (a destination picker with "Move all
             here", per-row "Restore") that do not fit a tree row. Both bins
             render only when non-empty, so the usual state is the tree plus a
             short Trash section. -->
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

      <div slot="end" class="pane pane-end">
        {#if importing && ark && store && files}
          <ImportPanel {ark} {tree} {store} fileStorage={files} {search} onDone={onImportDone} />
        {:else if editing === 'create'}
          <DocumentEditor
            {ark}
            {signals}
            mode="create"
            folderId={selectedFolder}
            folders={tree.live}
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
            folders={tree.live}
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
          <!-- Nothing is selected on load: the tree lists real folders only,
               so there is no node that stands for "everything". Documents
               outside every folder stay reachable through the Unfiled bin
               below the tree. -->
          <p class="hint">Select a document from the tree, or create one.</p>
        {/if}
      </div>
    </sl-split-panel>
  {/if}
</main>

<style>
  main {
    display: flex;
    flex-direction: column;
    height: 100vh;
    box-sizing: border-box;
    /* Opaque here too, not just on body: the applet fills the iframe, and a
       transparent root is what made text render without subpixel
       antialiasing — the "fuzzy shadow outlining" on every glyph. See
       app.css for the full reasoning. */
    background: var(--sl-color-neutral-0, #fff);
  }
  .header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: none;
    border-bottom: 1px solid rgba(128, 128, 128, 0.3);
    /* The search overlay lives inside this header and drops down over the
       split panel below. Without a stacking context here the panel — later in
       document order — paints on top of it, and the results become
       unclickable even though they are visible. */
    position: relative;
    z-index: 5;
  }
  .toolbar {
    display: flex;
    gap: 0.5rem;
    margin: 0.5rem;
    flex: none;
  }
  .search-slot {
    flex: 1;
    min-width: 0;
  }
  .new-doc,
  .import {
    margin: 0;
    white-space: nowrap;
  }
  .layout {
    flex: 1;
    min-height: 0;
    /* The divider stays put unless dragged; only these bounds move it, and
       only when the window itself is too narrow to honour the position. */
    --min: 14rem;
    --max: 60%;
  }
  /* Each pane scrolls on its own. Without this the whole page scrolls, and a
     long document in the right-hand pane drags the tree off the top of the
     screen. */
  .pane {
    height: 100%;
    overflow: auto;
    box-sizing: border-box;
  }
  .pane-start {
    border-right: 1px solid rgba(128, 128, 128, 0.3);
  }
  .bins {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.5rem;
  }
  .hint {
    padding: 1rem;
    opacity: 0.6;
  }
  .missing-note {
    margin: 0.5rem;
    padding: 0.5rem 0.75rem;
    background: #fef3c7;
    color: #92400e;
    border-radius: 4px;
    flex: none;
  }
</style>
