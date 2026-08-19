<script lang="ts">
  import type { ActionHash } from '@holochain/client';
  import { key } from '../stores/documents.svelte';
  import type { TrashEntry } from '../stores/orphans';

  let {
    entries,
    onRestore,
    onOpen,
  }: {
    entries: TrashEntry[];
    onRestore: (original: ActionHash) => void;
    onOpen: (entry: TrashEntry) => void;
  } = $props();
</script>

<section>
  <h3>Trash</h3>
  {#if entries.length === 0}
    <p class="empty">Nothing in the trash.</p>
  {/if}
  <ul>
    {#each entries as entry (key(entry.doc.original))}
      <li>
        <button class="title" onclick={() => onOpen(entry)}>
          {entry.doc.meta.title ?? '(untitled)'}
        </button>
        <span class="where">{entry.wasIn ? `was in ${entry.wasIn}` : 'was unfiled'}</span>
        <button onclick={() => onRestore(entry.doc.original)}>Restore</button>
      </li>
    {/each}
  </ul>
  <p class="note">Trashed documents are hidden, never destroyed — every version is still stored.</p>
</section>

<style>
  ul { list-style: none; padding: 0; }
  li { display: flex; gap: 0.5rem; align-items: baseline; }
  .title { background: none; border: none; cursor: pointer; text-align: left; }
  .where, .note, .empty { opacity: 0.6; font-size: 0.85em; }
</style>
