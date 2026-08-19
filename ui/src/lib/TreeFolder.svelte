<script lang="ts">
  import type { DocumentStore } from '../stores/documents.svelte';
  import { key } from '../stores/documents.svelte';
  import type { DocumentSummary, Folder } from '../types';
  import TreeFolder from './TreeFolder.svelte';
  import { listen } from './listen';

  let {
    folder,
    folders,
    store,
    counts,
    selectedFolder,
    selectedDoc,
    loadedFolders,
    onLazyLoad,
    onRename,
    onDelete,
    onAddChild,
  }: {
    folder: Folder;
    folders: Folder[];
    store: DocumentStore;
    counts: Record<string, number>;
    selectedFolder: string | null;
    selectedDoc: string | null;
    /** Folders whose contents have been lazily loaded at least once. */
    loadedFolders: Set<string>;
    onLazyLoad: (id: string) => void;
    onRename: (id: string, name: string) => void;
    onDelete: (id: string) => void;
    onAddChild: (parent: string, name: string) => void;
  } = $props();

  let children = $derived(folders.filter((f) => f.parent === folder.id));
  let documents = $derived(store.directlyIn(folder.id));
  let loaded = $derived(loadedFolders.has(folder.id));
  // A folder with nothing inside must not offer an expand affordance. `lazy`
  // forces one on, because Shoelace cannot know whether a lazy item has
  // children until it has asked for them.
  let hasContents = $derived(children.length > 0 || documents.length > 0);

  let item: HTMLElement | undefined = $state();

  // `lazy` is set as a PROPERTY rather than written as an attribute. Shoelace
  // types it with Lit's Boolean converter, for which any attribute at all —
  // including lazy="false" — reads as true, so the attribute form would trap
  // a loaded folder in its loading spinner forever.
  $effect(() => {
    if (item) (item as unknown as { lazy: boolean }).lazy = hasContents && !loaded;
  });

  // Selecting a folder reveals its documents rather than merely highlighting
  // it. Making the association visible on one click is the whole reason the
  // list became a tree; collapsing stays on the chevron so a click never
  // hides what the user just asked to see.
  $effect(() => {
    if (item && selectedFolder === folder.id) {
      (item as unknown as { expanded: boolean }).expanded = true;
    }
  });

  let addingChild = $state(false);

  // The inline "new sub-folder" row is itself a nested sl-tree-item, so it
  // lives in the parent's children slot — which Shoelace keeps hidden while
  // the parent is collapsed. Adding a sub-folder to a folder nobody has opened
  // would otherwise focus an input that cannot be seen.
  $effect(() => {
    if (item && addingChild) {
      (item as unknown as { expanded: boolean }).expanded = true;
      // Also count as loaded: adding the first sub-folder turns an empty
      // folder into one WITH contents, which would otherwise flip `lazy` back
      // on and hide the children the user is in the middle of creating.
      onLazyLoad(folder.id);
    }
  });

  let renaming = $state(false);
  // Not seeded from `folder.name`: that captures only the initial value and
  // goes stale when another agent renames the folder. The menu item seeds it
  // at the moment editing starts.
  let draft = $state('');
  let childDraft = $state('');
  let renameInput: HTMLInputElement | undefined = $state();
  let childInput: HTMLInputElement | undefined = $state();

  $effect(() => {
    if (renaming) renameInput?.focus();
  });
  $effect(() => {
    if (addingChild) childInput?.focus();
  });

  function startRename() {
    draft = folder.name;
    renaming = true;
  }

  function startAddChild() {
    childDraft = '';
    addingChild = true;
  }

  function confirmAddChild() {
    const name = childDraft.trim();
    addingChild = false;
    if (name) onAddChild(folder.id, name);
  }

  // sl-tree binds ArrowUp/ArrowDown/Enter/Home/End for navigation at the tree
  // level, and sl-tree-item toggles selection on Enter. Left unchecked those
  // would hijack every keystroke aimed at these inline inputs — Enter would
  // select the folder instead of confirming the name, and the arrow keys
  // would move focus out of the field mid-edit.
  function keepKeysLocal(event: KeyboardEvent) {
    event.stopPropagation();
  }

  function onMenuSelect(event: Event) {
    const value = (event as CustomEvent<{ item: { value: string } }>).detail?.item?.value;
    if (value === 'rename') startRename();
    else if (value === 'add') startAddChild();
    else if (value === 'delete') onDelete(folder.id);
  }
</script>

<sl-tree-item
  bind:this={item}
  data-kind="folder"
  data-id={folder.id}
  data-name={folder.name}
  selected={selectedFolder === folder.id}
  onsl-lazy-load={(e: Event) => {
    e.stopPropagation();
    onLazyLoad(folder.id);
  }}
  onsl-expand={(e: Event) => {
    // Both events matter. `sl-lazy-load` fires only for items still marked
    // lazy; `sl-expand` also covers a folder opened when it had nothing in it
    // yet — which is exactly the folder someone is about to add a sub-folder
    // to. Marking it loaded on either keeps "expanded" and "rendered" the
    // same thing. Nested items bubble, hence the stop.
    e.stopPropagation();
    onLazyLoad(folder.id);
  }}
>
  <div class="row">
    {#if renaming}
      <input
        bind:this={renameInput}
        class="rename-input"
        bind:value={draft}
        onkeydown={(e) => {
          keepKeysLocal(e);
          if (e.key === 'Enter') {
            onRename(folder.id, draft);
            renaming = false;
          }
          if (e.key === 'Escape') {
            draft = folder.name;
            renaming = false;
          }
        }}
        onclick={(e) => e.stopPropagation()}
      />
    {:else}
      <span class="name">{folder.name}</span>
      <span class="count">{counts[folder.id] ?? 0}</span>
      <!-- One button instead of three glyphs per row. The menu is only
           painted on hover or keyboard focus (see .actions below), so an
           ordinary row is just its name and count. -->
      <sl-dropdown
        class="actions"
        hoist
        use:listen={{ click: (e: Event) => e.stopPropagation(), keydown: keepKeysLocal }}
      >
        <sl-icon-button
          slot="trigger"
          name="three-dots-vertical"
          label={`Actions for ${folder.name}`}
        ></sl-icon-button>
        <!-- sl-select rather than a click handler per item: it is Shoelace's
             own selection event, so Enter and Space on a focused item work
             without a second keyboard path of our own. -->
        <sl-menu onsl-select={onMenuSelect}>
          <sl-menu-item value="rename">Rename</sl-menu-item>
          <sl-menu-item value="add">New sub-folder</sl-menu-item>
          <sl-menu-item value="delete">Delete</sl-menu-item>
        </sl-menu>
      </sl-dropdown>
    {/if}
  </div>

  {#if addingChild}
    <sl-tree-item class="draft-item" use:listen={{ click: (e: Event) => e.stopPropagation() }}>
      <input
        bind:this={childInput}
        class="add-input"
        bind:value={childDraft}
        placeholder="New sub-folder name"
        onkeydown={(e) => {
          keepKeysLocal(e);
          if (e.key === 'Enter') confirmAddChild();
          if (e.key === 'Escape') addingChild = false;
        }}
        onclick={(e) => e.stopPropagation()}
      />
    </sl-tree-item>
  {/if}

  {#if loaded}
    {#each children as child (child.id)}
      <TreeFolder
        folder={child}
        {folders}
        {store}
        {counts}
        {selectedFolder}
        {selectedDoc}
        {loadedFolders}
        {onLazyLoad}
        {onRename}
        {onDelete}
        {onAddChild}
      />
    {/each}
    {#each documents as doc (key(doc.original))}
      <sl-tree-item
        data-kind="doc"
        data-id={key(doc.original)}
        selected={selectedDoc === key(doc.original)}
      >
        <span class="doc-title">{doc.meta.title ?? '(untitled)'}</span>
        <span class="doc-date">{doc.meta.date ?? ''}</span>
      </sl-tree-item>
    {/each}
  {/if}
</sl-tree-item>

<style>
  /* Shoelace's label part is `display: flex` but sits in the row as a
     shrink-to-fit flex item, so slotted content that asks for `width: 100%`
     resolves against a container that is itself sizing to that content. The
     row collapses to the width of its whitespace. Letting the part grow is
     what gives the name, the count and the action button a row to live on. */
  sl-tree-item::part(label) {
    flex: 1 1 auto;
    min-width: 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    width: 100%;
    min-width: 0;
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count {
    opacity: 0.55;
    font-size: 0.85em;
    font-variant-numeric: tabular-nums;
  }
  /* Reclaiming the row: the three glyphs are gone, and even the one button
     that replaced them is invisible until the row is pointed at or tabbed to.
     `visibility` rather than `display` so the row never reflows underneath
     the pointer as it arrives. */
  .actions {
    visibility: hidden;
  }
  .row:hover .actions,
  .row:focus-within .actions {
    visibility: visible;
  }
  .doc-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .doc-date {
    opacity: 0.55;
    font-size: 0.85em;
    margin-left: 0.5rem;
    font-variant-numeric: tabular-nums;
  }
  .rename-input,
  .add-input {
    flex: 1;
    min-width: 0;
    font: inherit;
  }
</style>
