<script lang="ts">
  import type { ArkClient } from '../ark-client';
  import type { SignalStore } from '../stores/signals.svelte';
  import type { TreeStore } from '../stores/tree.svelte';
  import { planFolderDeletion } from '../tree/deletion';
  import FolderNode from './FolderNode.svelte';

  let {
    tree,
    ark,
    signals,
    selected,
    counts = {},
    onSelect,
  }: {
    tree: TreeStore;
    ark: ArkClient;
    signals: SignalStore;
    selected: string | null;
    counts?: Record<string, number>;
    onSelect: (id: string | null) => void;
  } = $props();

  let roots = $derived(tree.live.filter((f) => !f.parent || !tree.live.some((p) => p.id === f.parent)));

  // Electron does not implement window.prompt (it returns null unconditionally),
  // so a modal prompt here is a silent no-op in Moss. This inline row is the
  // same pattern FolderNode.svelte already uses for renaming: Enter confirms,
  // Escape cancels, no dialog involved.
  let addingRoot = $state(false);
  let rootDraft = $state('');

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
    // tombstone with no restore path in the UI — so a misclick beside Rename
    // would be unrecoverable even though the documents themselves survive.
    const subtree = plan.tombstone.length > 1 ? ' and its sub-folders' : '';
    const ok = plan.moves.length
      ? confirm(
          `${plan.moves.length} document(s) are in this folder${subtree}. ` +
            `Move them to ${destination} and delete it?`,
        )
      : confirm(`Delete this empty folder${subtree}?`);
    if (!ok) return;

    // Relocate before tombstoning, and stop on the first failure rather than
    // pressing on: a half-moved folder that then vanishes would strand the rest
    // of its documents with nothing on screen to explain it.
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
    if (selected === id) onSelect(null);
  }
</script>

<nav>
  <div class="head">
    <strong>Folders</strong>
    {#if addingRoot}
      <input
        class="add-input"
        bind:value={rootDraft}
        placeholder="New folder name"
        onkeydown={(e) => {
          if (e.key === 'Enter') confirmAddRoot();
          if (e.key === 'Escape') addingRoot = false;
        }}
      />
    {:else}
      <button onclick={startAddRoot}>+</button>
    {/if}
  </div>
  <ul>
    <li>
      <button class:selected={selected === null} onclick={() => onSelect(null)}>All documents</button>
    </li>
    {#each roots as folder (folder.id)}
      <FolderNode
        {folder}
        folders={tree.live}
        {selected}
        {counts}
        onSelect={(id) => onSelect(id)}
        onRename={(id, name) => tree.renameFolder(id, name)}
        onDelete={deleteFolder}
        onAddChild={(parent, name) => tree.addFolder(name, parent)}
      />
    {/each}
  </ul>
</nav>

<style>
  nav { min-width: 16rem; border-right: 1px solid rgba(128, 128, 128, 0.3); padding: 0.5rem; }
  .head { display: flex; justify-content: space-between; align-items: center; }
  ul { list-style: none; padding-left: 0; margin: 0.5rem 0 0; }
  .selected { font-weight: 600; }
</style>
