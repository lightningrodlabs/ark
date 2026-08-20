<script lang="ts">
  import { onDestroy, onMount, setContext } from 'svelte';
  import {
    AppWebsocket,
    CellType,
    encodeHashToBase64,
    type AgentPubKey,
    type AppClient,
    type DnaHash,
  } from '@holochain/client';
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
  import { listen } from './lib/listen';
  import { trashEntries, type TrashEntry } from './stores/orphans';
  import { folderPathLabel } from './tree/paths';
  import type { SearchHit, SearchOutcome } from './search/index';
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
  import AboutDialog from './lib/AboutDialog.svelte';
  import AssetView from './lib/AssetView.svelte';
  import PaneHeader from './lib/PaneHeader.svelte';

  let ark: ArkClient | undefined = $state();
  let files: FileStorageClient | undefined = $state();
  let error: string | undefined = $state();
  let tree: TreeStore | undefined = $state();
  let store: DocumentStore | undefined = $state();
  let search: SearchStore | undefined = $state();
  let signals: SignalStore | undefined = $state();
  let weaveClient: WeaveClient | undefined;
  let loadingDocs = $state(true);
  let selectedFolder: string | null = $state(null);
  let selectedDoc: DocumentSummary | null = $state(null);
  // The terms to mark inside the open document. Non-empty only when the
  // document was reached from a search hit — a document opened from the tree
  // shows no marks, and a highlight left over from a search three clicks ago
  // is noise, so every other way of selecting a document clears it.
  let docHighlight = $state<string[]>([]);
  let editing: 'create' | 'amend' | null = $state(null);
  let importing = $state(false);
  // Reported up by DocumentEditor and ImportPanel, because only they know.
  // `editorDirty` gates the confirm before a close discards typed text;
  // `importRunning` disables the close button while documents are still
  // being written to the DHT, where losing the panel is worse than having no
  // close button at all.
  let editorDirty = $state(false);
  let importRunning = $state(false);
  let aboutOpen = $state(false);
  // Moss asset-rendering path (see onMount): a single document, read-only,
  // with none of the tree/store/search/signals apparatus ever built. `null`
  // means the document did not resolve (trashed, or not yet synced to this
  // device) rather than an error.
  let isAssetView = $state(false);
  let assetDoc: DocumentSummary | null = $state(null);
  // The ark cell's DNA hash, fetched once at startup — see the "Add to
  // pocket" controls in DocumentView, which need it for every WAL's `hrl[0]`,
  // and the About dialog, which shows it because it is what people quote in a
  // bug report. Pocket controls are still gated on Moss being present, but the
  // hash itself is read everywhere the app boots normally.
  let dnaHash: DnaHash | undefined = $state();
  /** This agent's own key — the other half of what a bug report needs. */
  let agentKey: AgentPubKey | undefined = $state();

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
    // Whether there is a Moss host at all. Separate from `dnaHash`, which is
    // now read on every boot (the About dialog shows it) and so no longer
    // stands in for "we are inside Moss" — a pocket button rendered outside
    // Moss would be a control with nowhere to put anything.
    get inMoss() {
      return !!weaveClient;
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
        // never detected in start:moss.
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
      agentKey = client.myPubKey;
      // Fetched once here, not per "Add to pocket" click — see DocumentView.
      // No longer gated on Moss: the About dialog shows this hash outside Moss
      // too, and appInfo is one cheap call on a path that is already awaiting
      // the whole corpus.
      try {
        const info = await client.appInfo();
        const cell = info?.cell_info[ROLE_NAME]?.find((c) => c.type === CellType.Provisioned);
        if (cell?.type === CellType.Provisioned) dnaHash = cell.value.cell_id[0];
      } catch (e) {
        // A missing DNA hash costs an About line and the pocket controls; it
        // must not stop the archive from loading.
        console.warn('appInfo failed; DNA hash unavailable', e);
      }
      tree = new TreeStore(ark);
      // One call, and it is all the folder pane needs. Awaiting the corpus
      // before rendering anything meant fifteen round trips of a blank page on
      // the reference archive; the tree does not depend on documents having
      // arrived, and the stores below are reactive, so everything is built and
      // handed to the view BEFORE the corpus is paged in. `store.load` then
      // fills it in progressively — see DocumentStore.loading.
      await tree.load();
      store = new DocumentStore(ark);
      search = new SearchStore(store);

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
        (source) =>
          reconcile(source, {
            tree: currentTree,
            store: currentStore,
            search: currentSearch,
            // An import writes for minutes on the cell this reconcile would
            // read from, and refreshes the store itself when it finishes, so
            // a tick landing in the middle of one has nothing to add and
            // everything to slow down. Reported up by ImportPanel; read here
            // at tick time rather than captured, so it is always current.
            busy: () => importRunning,
          }),
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

      // Everything above is synchronous once the tree is in, so the app is on
      // screen by now. Only the corpus is still coming, a page at a time, and
      // `store.byOriginal` grows with each one: folder counts, the document
      // list and the progress banner all follow it without anything here
      // pushing them.
      //
      // Each page is indexed as it lands, so by the time the last one arrives
      // the index is already complete. The work overlaps the round trips that
      // are happening anyway; the separate `rebuild()` pass that used to run
      // here was ~550ms of synchronous main thread at 1406 documents, spent
      // at the one moment the app looks finished and the user reaches for the
      // search box.
      //
      // What does NOT change is when search starts answering. It still needs
      // the WHOLE corpus: an index over the third of the archive that happens
      // to have arrived answers, plausibly and silently, for a third of the
      // archive — the failure this project has already shipped once (see
      // SearchStore.folderScope). `loadingDocs` gates that and is still the
      // last thing to flip.
      await currentStore.load(currentTree.folders, (_loaded, _total, documents) =>
        currentSearch.upsertAll(documents),
      );
      // Filings and trash are read before paging starts and again at the end
      // of the load (a document filed by someone else while we paged is only
      // in the second read). The index holds whatever maps it was last handed,
      // so it is pointed at the final ones here — the same thing `rebuild()`
      // did on its way out.
      currentSearch.sync();
      loadingDocs = false;

      // Started only now: a remote signal or a reconcile landing mid-load
      // would re-read filings and re-page the corpus underneath the load that
      // is already doing exactly that.
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

  // The whole outcome, not just the rows: a result set that came from near
  // matches has to carry that fact to the bar, which says so. Silently
  // returning the rows alone is how "84 results for asdf" looked like an
  // answer in the first place.
  const NO_RESULTS: SearchOutcome = { hits: [], exactCount: 0, nearMatch: null };
  let searchOutcome = $derived.by<SearchOutcome>(() => {
    // No answers at all until the index covers the whole corpus — see the
    // SearchStore.rebuild() call in onMount. A partial index does not return
    // fewer results in some visible way; it returns a confident, wrong answer.
    if (loadingDocs) return NO_RESULTS;
    if (!search || !tree || !searching) return NO_RESULTS;
    // Global by default: folder scope comes only from search.folderScope, an
    // explicit opt-in the user turns on in SearchBar, never from
    // `selectedFolder` — see SearchBar's scope chip.
    return search.run(tree.live);
  });

  function selectFolder(id: string | null) {
    selectedFolder = id;
    selectedDoc = null;
    editing = null;
  }

  function newDoc() {
    editing = 'create';
    editorDirty = false;
    importing = false;
  }

  // Opened from the About dialog, closed from the toolbar button that appears
  // while it is open. Opening also backs out of any open editor/doc view;
  // closing is left to the user (see onImportDone below) rather than happening
  // automatically after a run, so the completed summary — created, skipped,
  // attached, any failures — actually stays on screen to be read.
  function openImport() {
    importing = true;
    editing = null;
    editorDirty = false;
    selectedDoc = null;
  }

  // Nothing to do here any more, and that is the point: ImportPanel's closing
  // refresh now goes through `syncMissing`, which updates the index as it
  // goes (or rebuilds it once, if the delta was big enough to fall back to a
  // paged load). The unconditional `search.rebuild()` that used to live here
  // was a second full pass over the corpus — ~640ms at 1406 documents —
  // immediately after one that had already left the index correct.
  //
  // Deliberately does not close the panel: the summary of what was imported
  // is worth reading, so the pane header's × is what dismisses it.
  function onImportDone() {}

  function amendDoc() {
    editing = 'amend';
    editorDirty = false;
  }

  const DISCARD =
    'Discard this edit? What you have typed has not been saved and will be lost.';

  /**
   * Cancel an edit, keeping whatever was open underneath (the document being
   * amended, or nothing for a create). Same work-losing move as closing the
   * pane, so it asks the same question.
   */
  function cancelEdit() {
    if (editorDirty && !confirm(DISCARD)) return;
    editing = null;
    editorDirty = false;
  }

  /**
   * The pane's close button, and Escape over an open document. Clears every
   * flag the pane branches on rather than just the one that happens to be
   * winning — otherwise closing an import would fall through to whatever
   * document was open before it, and the pane would never reach the hint.
   */
  function closePane() {
    // Belt to the disabled button's braces: an import writing to the DHT must
    // not have its panel pulled out from under it by any route.
    if (importing && importRunning) return;
    if (editing && editorDirty && !confirm(DISCARD)) return;
    importing = false;
    editing = null;
    editorDirty = false;
    selectedDoc = null;
    docHighlight = [];
  }

  function onWindowKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    // Escape closes an open DOCUMENT and nothing else. During an edit or an
    // import it would be a work-losing keystroke on a key people press by
    // reflex, and the search overlay, the folder rename input and the About
    // dialog each claim Escape for themselves before it ever gets here.
    if (paneOccupant !== 'document' || aboutOpen) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName)))
      return;
    closePane();
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
    docHighlight = [];
    editing = null;
  }

  /** `highlight` is passed only by the search bar — see docHighlight. */
  function openDoc(doc: DocumentSummary, highlight: string[] = []) {
    selectedDoc = doc;
    docHighlight = highlight;
    editing = null;
    importing = false;
  }

  /** The tree hands back a document key, not the summary itself. */
  function openDocByKey(k: string) {
    const doc = store?.byOriginal.get(k);
    if (doc) openDoc(doc);
  }

  // Suppressed entirely while structurePending: with the tree not fully
  // arrived, a document filed under a folder id this device does not know
  // about yet reads identically to a genuinely unfiled one (see
  // DocumentStore.unfiled). Showing it here, next to "Move all here", risks
  // re-filing documents that were never actually unfiled.
  // Also suppressed for the whole initial load, for the same reason: a
  // document whose page of the archive has not arrived yet has no filing on
  // this device, which is indistinguishable from never having been filed.
  // Offering "Move all here" over that would re-file documents that were
  // never unfiled.
  let unfiledDocs = $derived(
    store && tree && !tree.structurePending && !loadingDocs ? store.unfiled() : [],
  );
  let deletedBins = $derived(store && tree ? store.inDeletedFolders(tree.folders) : []);
  let trashList = $derived(store && tree ? trashEntries(store, tree.folders) : []);

  // What the right-hand pane is showing, named once. The precedence here is
  // the same as the {#if} chain in the pane below, and has to stay that way:
  // this is what the header titles itself from, so a disagreement would put
  // one occupant's name over another's content. The chain's extra `ark &&
  // store && files` guards are not repeated — inside this branch of the
  // template all three are set — but the flag order is identical.
  type PaneOccupant = 'import' | 'create' | 'amend' | 'document';
  let paneOccupant: PaneOccupant | null = $derived(
    importing
      ? 'import'
      : editing === 'create'
        ? 'create'
        : editing === 'amend' && selectedDoc
          ? 'amend'
          : selectedDoc
            ? 'document'
            : null,
  );

  const titleOf = (doc: DocumentSummary | null) => doc?.meta.title ?? '(untitled)';

  let paneTitle = $derived(
    paneOccupant === 'import'
      ? 'Import markdown'
      : paneOccupant === 'create'
        ? 'New document'
        : paneOccupant === 'amend'
          ? `Amend ${titleOf(selectedDoc)}`
          : paneOccupant === 'document'
            ? titleOf(selectedDoc)
            : '',
  );

  async function onEditorDone(original: ActionHash) {
    if (!store) return;
    await store.refreshDocument(original);
    await store.refreshFilings();
    const doc = store.byOriginal.get(key(original)) ?? null;
    if (doc) search?.upsert(doc);
    search?.sync();
    selectedDoc = doc;
    docHighlight = [];
    editing = null;
    editorDirty = false;
  }
</script>

<!-- Escape is handled here rather than on the pane, which is a plain <div>
     and never focused. onWindowKeydown does the narrowing. -->
<svelte:window onkeydown={onWindowKeydown} />

<main>
  <!-- No <h1>ark</h1>: Moss's own tool bar already names the applet directly
       above this iframe, so a second title only cost vertical space in a pane
       that is mostly a list. -->
  {#if isAssetView && ark && files}
    <AssetView doc={assetDoc} {ark} {files} />
  {:else if error}
    <p class="error">{error}</p>
  {:else if !tree || !ark || !store || !search || !signals}
    <!-- Only the connection and the folder tree are waited on here — one zome
         call each. The corpus is NOT: it used to replace the whole app with a
         single line of text for as long as it took to page 1406 documents in,
         which is the regression this branch exists to undo. -->
    <p>Connecting…</p>
  {:else}
    <!-- A node can gossip in a document's filing link before the folder-tree
         entry that names its folder — the tree's root LINK arrives, but not
         yet the entry a resolvable head needs (see TreeStore.structurePending).
         Read literally, that looks like "this archive has no folders", which
         would put every filed document in the Unfiled bin next to "Move all
         here" — real damage to an archive that was never actually unfiled.
         This banner says what is actually going on instead, and the Unfiled
         bin below is suppressed entirely for the same reason. Nothing else is
         gated: documents already on this device stay readable and searchable
         while the structure catches up. -->
    {#if tree.structurePending}
      <p class="structure-pending-note">
        This archive's folder structure has not finished arriving on this
        device yet, so folders and filings below may be incomplete — the
        Unfiled bin is hidden until they catch up so nothing gets re-filed by
        mistake. {store.loaded}
        document{store.loaded === 1 ? '' : 's'} already {store.loaded === 1 ? 'is' : 'are'} on this
        device and stay readable and searchable below. This resolves on its
        own as gossip completes.
      </p>
    {/if}

    <!-- The initial load's only visible cost. Unobtrusive by design: it sits
         beside the app rather than in front of it, and everything below it is
         already usable — folders, the documents paged in so far, opening and
         reading them. Search is the exception and says so itself (SearchBar),
         because an index over part of the corpus answers for part of the
         archive without admitting it. -->
    {#if loadingDocs}
      <p class="loading-note" data-testid="loading-note">
        Loading the archive — {store.loaded} of {store.total ?? '?'} documents. Folders and
        documents below are usable as they arrive; search waits for the whole archive.
      </p>
    {/if}

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
        <!-- The archive box is the app's identity and its only door to
             version info, import and export. Import used to have its own
             toolbar button; two entry points to the same panel is one more
             than there is reason for. -->
        <sl-icon-button
          class="about"
          name="archive"
          label="About ark"
          use:listen={{ click: () => (aboutOpen = true) }}
        ></sl-icon-button>
        <button class="new-doc" onclick={newDoc}>New document</button>
      </div>
      {#if search}
        <!-- `search?.highlightTerms(hit)` below is optional only because the
             narrowing from {#if search} does not follow into a callback —
             there is no search bar to select a hit from before the store
             exists. -->
        <div class="search-slot">
          <SearchBar
            {search}
            hits={searchOutcome.hits}
            nearMatch={searchOutcome.nearMatch}
            exactCount={searchOutcome.exactCount}
            {searching}
            loading={loadingDocs}
            loaded={store.loaded}
            total={store.total}
            {locationOf}
            {authors}
            {selectedFolder}
            folders={tree.live}
            onSelect={(hit) => openDoc(hit.doc, search?.highlightTerms(hit) ?? [])}
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
        <!-- One header for every occupant, so what the pane is showing is
             always named and always closable. The empty hint gets none — a
             header over "select a document" would have nothing to close. -->
        {#if paneOccupant}
          <PaneHeader
            title={paneTitle}
            onClose={closePane}
            closeDisabled={paneOccupant === 'import' && importRunning}
            closeReason="This import is still running — it will finish on its own."
          />
        {/if}
        {#if importing && ark && store && files && search}
          <ImportPanel
            {ark}
            {tree}
            {store}
            fileStorage={files}
            {search}
            onDone={onImportDone}
            onRunningChange={(running) => (importRunning = running)}
          />
        {:else if editing === 'create'}
          <DocumentEditor
            {ark}
            {signals}
            mode="create"
            folderId={selectedFolder}
            folders={tree.live}
            onDone={onEditorDone}
            onCancel={cancelEdit}
            onDirtyChange={(dirty) => (editorDirty = dirty)}
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
            onCancel={cancelEdit}
            onDirtyChange={(dirty) => (editorDirty = dirty)}
          />
        {:else if selectedDoc && files && search}
          <DocumentView
            doc={selectedDoc}
            {ark}
            {files}
            {search}
            highlight={docHighlight}
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

    <!-- Rendered here rather than at the top level because it needs the
         stores: the corpus it exports and the tree it lays out. -->
    {#if files}
      <AboutDialog
        bind:open={aboutOpen}
        {ark}
        {files}
        {store}
        {tree}
        {dnaHash}
        {agentKey}
        onImport={openImport}
      />
    {/if}
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
  .new-doc {
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
  /* A column, so the sticky PaneHeader sits above an occupant that fills the
     rest of the pane. The occupants keep their own padding (all 1rem) — the
     header is their sibling, not their wrapper, so it pads itself to match
     rather than padding them. */
  .pane-end {
    display: flex;
    flex-direction: column;
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
  /* A stronger tone than .missing-note: this is not "a few documents are
     still syncing", it is "do not trust the folder view yet" — the state
     that made a whole archive look Unfiled before this fix existed. */
  .structure-pending-note {
    margin: 0.5rem;
    padding: 0.5rem 0.75rem;
    background: #dbeafe;
    color: #1e3a8a;
    border-radius: 4px;
    flex: none;
  }
  /* Quieter than either of the two above: nothing is wrong, the archive is
     simply still arriving, and this line goes away on its own. */
  .loading-note {
    margin: 0.5rem;
    padding: 0.4rem 0.75rem;
    background: rgba(128, 128, 128, 0.12);
    border-radius: 4px;
    font-size: 0.9em;
    opacity: 0.85;
    flex: none;
  }
</style>
