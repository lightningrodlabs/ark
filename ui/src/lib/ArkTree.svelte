<script lang="ts">
  // Importing the Shoelace setup here (not only in App) guarantees every
  // custom element used below is REGISTERED before this component first
  // renders. Svelte only assigns custom-element props as properties once the
  // element is defined; until then it falls back to setAttribute, and Lit's
  // Boolean converter reads any attribute at all — `selected="false"`
  // included — as true. Registering first keeps that race from existing.
  import '../shoelace';
  import type { ArkClient } from '../ark-client';
  import type { SignalStore } from '../stores/signals.svelte';
  import type { TreeStore } from '../stores/tree.svelte';
  import type { DocumentStore } from '../stores/documents.svelte';
  import { planFolderDeletion } from '../tree/deletion';
  import TreeFolder from './TreeFolder.svelte';
  import { listen } from './listen';

  let {
    tree,
    store,
    ark,
    signals,
    counts = {},
    selectedFolder,
    selectedDoc,
    onSelectFolder,
    onOpenDocument,
  }: {
    tree: TreeStore;
    store: DocumentStore;
    ark: ArkClient;
    signals: SignalStore;
    counts?: Record<string, number>;
    selectedFolder: string | null;
    /** Base64 key of the open document, or null. */
    selectedDoc: string | null;
    onSelectFolder: (id: string | null) => void;
    onOpenDocument: (key: string) => void;
  } = $props();

  let roots = $derived(
    tree.live.filter((f) => !f.parent || !tree.live.some((p) => p.id === f.parent)),
  );

  /**
   * Which folders have had their contents rendered.
   *
   * Documents are `sl-tree-item`s only once their folder has been expanded.
   * The reference archive is 1406 documents across thirteen committees, and
   * an expanded committee can hold 280; rendering all of them up front would
   * put 1419 custom elements — each with its own shadow root — in the DOM to
   * show thirteen rows. Shoelace's `lazy` gives us the expand affordance and
   * the `sl-lazy-load` event; this set is the "already asked for" half.
   */
  let loadedFolders = $state(new Set<string>());

  // Idempotent by design. Callers fire this from effects, and reassigning the
  // Set unconditionally would hand `$state` a new object every time — which
  // re-runs those effects, which call this again. Svelte catches the runaway
  // as effect_update_depth_exceeded and stops rendering the tree entirely.
  function onLazyLoad(id: string) {
    if (loadedFolders.has(id)) return;
    loadedFolders = new Set([...loadedFolders, id]);
  }


  // Folder selection reveals a folder's documents, so a folder the app
  // selects on its own behalf (e.g. after deleting the one that was open)
  // must be loaded too, not merely highlighted.
  $effect(() => {
    if (selectedFolder && !loadedFolders.has(selectedFolder)) onLazyLoad(selectedFolder);
  });

  function onSelectionChange(event: Event) {
    const detail = (event as CustomEvent<{ selection: HTMLElement[] }>).detail;
    const item = detail?.selection?.[0];
    if (!item) return;
    const kind = item.dataset.kind;
    const id = item.dataset.id;
    if (kind === 'folder' && id) onSelectFolder(id);
    else if (kind === 'doc' && id) onOpenDocument(id);
  }

  let addingRoot = $state(false);
  let rootDraft = $state('');
  let rootInput: HTMLInputElement | undefined = $state();

  $effect(() => {
    if (addingRoot) rootInput?.focus();
  });

  function startAddRoot() {
    addingRoot = true;
    rootDraft = '';
  }

  async function confirmAddRoot() {
    const name = rootDraft.trim();
    addingRoot = false;
    if (name) await tree.addFolder(name, null);
  }

  async function deleteFolder(id: string) {
    const ids = tree.folders.map((f) => f.id);
    const filings = await ark.getFilings(ids);
    const plan = planFolderDeletion(tree.folders, filings, id);
    const target = tree.folders.find((f) => f.id === id);
    const destination = target?.parent
      ? (tree.folders.find((f) => f.id === target.parent)?.name ?? 'its parent folder')
      : 'Unfiled';

    // Always confirm. There is no undo for a folder in the MVP — deletion is a
    // tombstone with no restore path in the UI — so a misclick would be
    // unrecoverable even though the documents themselves survive.
    const subtree = plan.tombstone.length > 1 ? ' and its sub-folders' : '';
    const ok = plan.moves.length
      ? confirm(
          `${plan.moves.length} document(s) are in this folder${subtree}. ` +
            `Move them to ${destination} and delete it?`,
        )
      : confirm(`Delete this empty folder${subtree}?`);
    if (!ok) return;

    // Relocate before tombstoning, and stop on the first failure rather than
    // pressing on: a half-moved folder that then vanishes would strand the
    // rest of its documents with nothing on screen to explain it.
    try {
      for (const move of plan.moves) {
        await ark.moveDocument({ original: move.original, from: move.from, to: move.to });
        await signals.broadcast({
          type: 'DocumentMoved',
          original: move.original,
          from: move.from,
          to: move.to,
        });
      }
    } catch (e) {
      alert(`Could not move the documents out of this folder, so it was not deleted.\n\n${e}`);
      return;
    }
    await tree.deleteFolder(id);
    if (selectedFolder === id) onSelectFolder(null);
  }
</script>

<nav aria-label="Archive">
  <div class="head">
    <strong>Folders</strong>
    {#if addingRoot}
      <input
        bind:this={rootInput}
        class="add-input"
        bind:value={rootDraft}
        placeholder="New folder name"
        onkeydown={(e) => {
          if (e.key === 'Enter') confirmAddRoot();
          if (e.key === 'Escape') addingRoot = false;
        }}
      />
    {:else}
      <sl-icon-button
        name="folder-plus"
        label="New folder"
        use:listen={{ click: startAddRoot }}
      ></sl-icon-button>
    {/if}
  </div>

  <sl-tree selection="single" onsl-selection-change={onSelectionChange}>
    {#each roots as folder (folder.id)}
      <TreeFolder
        {folder}
        folders={tree.live}
        {store}
        {counts}
        selectedFolder={selectedDoc === null ? selectedFolder : null}
        {selectedDoc}
        {loadedFolders}
        {onLazyLoad}
        onRename={(id, name) => tree.renameFolder(id, name)}
        onDelete={deleteFolder}
        onAddChild={(parent, name) => tree.addFolder(name, parent)}
      />
    {/each}
  </sl-tree>
</nav>

<style>
  nav {
    padding: 0.25rem 0.5rem 0.5rem;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    min-height: 2rem;
  }
  .head strong {
    font-size: 0.85em;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    opacity: 0.6;
  }
  .add-input {
    flex: 1;
    min-width: 0;
    font: inherit;
  }
  sl-tree {
    --indent-guide-width: 1px;
  }
</style>
