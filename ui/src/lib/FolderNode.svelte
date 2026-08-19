<script lang="ts">
  import type { Folder } from '../types';
  import FolderNode from './FolderNode.svelte';

  let {
    folder,
    folders,
    selected,
    counts,
    onSelect,
    onRename,
    onDelete,
    onAddChild,
  }: {
    folder: Folder;
    folders: Folder[];
    selected: string | null;
    counts: Record<string, number>;
    onSelect: (id: string) => void;
    onRename: (id: string, name: string) => void;
    onDelete: (id: string) => void;
    onAddChild: (parent: string) => void;
  } = $props();

  let children = $derived(folders.filter((f) => f.parent === folder.id));
  let renaming = $state(false);
  // Deliberately not seeded from `folder.name`: that would capture only the
  // initial value (svelte warns state_referenced_locally), and would go stale
  // when another agent renames the folder. The rename button seeds it instead,
  // so it is always the current name at the moment editing starts.
  let draft = $state('');
</script>

<li>
  <div class="row" class:selected={selected === folder.id}>
    {#if renaming}
      <input
        bind:value={draft}
        onkeydown={(e) => {
          if (e.key === 'Enter') { onRename(folder.id, draft); renaming = false; }
          if (e.key === 'Escape') { draft = folder.name; renaming = false; }
        }}
      />
    {:else}
      <button class="name" onclick={() => onSelect(folder.id)}>
        {folder.name}
        <span class="count">{counts[folder.id] ?? 0}</span>
      </button>
      <button title="Rename" onclick={() => { draft = folder.name; renaming = true; }}>✎</button>
      <button title="New sub-folder" onclick={() => onAddChild(folder.id)}>+</button>
      <button title="Delete" onclick={() => onDelete(folder.id)}>🗑</button>
    {/if}
  </div>
  {#if children.length}
    <ul>
      {#each children as child (child.id)}
        <FolderNode
          folder={child} {folders} {selected} {counts}
          {onSelect} {onRename} {onDelete} {onAddChild}
        />
      {/each}
    </ul>
  {/if}
</li>

<style>
  .row { display: flex; align-items: center; gap: 0.25rem; }
  .row.selected { background: rgba(128, 128, 128, 0.2); }
  .name { flex: 1; text-align: left; background: none; border: none; cursor: pointer; }
  .count { opacity: 0.6; font-size: 0.85em; margin-left: 0.4rem; }
  ul { list-style: none; padding-left: 1rem; margin: 0; }
</style>
