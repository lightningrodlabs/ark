<script lang="ts">
  import type { ActionHash } from '@holochain/client';
  import { key } from '../stores/documents.svelte';
  import type { DocumentSummary, Folder } from '../types';

  let {
    title,
    documents,
    fromFolderId,
    folders,
    onRefile,
  }: {
    title: string;
    documents: DocumentSummary[];
    fromFolderId: string | null;
    folders: Folder[];
    onRefile: (original: ActionHash, from: string | null, to: string) => void;
  } = $props();

  let destination = $state('');
  let moving = $state(false);

  // Default to the first live folder, and fall back again if the chosen
  // destination stops being a valid one (e.g. it was deleted while this bin
  // was open). Reading `folders` directly in the $state initializer above
  // would only capture its value at mount, so this runs on every change.
  $effect(() => {
    if (folders.length > 0 && !folders.some((f) => f.id === destination)) {
      destination = folders[0].id;
    }
  });

  // Move one document at a time and stop on the first failure, rather than
  // firing every move at once with nothing to catch a rejection: a partial
  // failure here would otherwise strand the rest with no explanation, the
  // same reasoning the folder-delete flow uses for its own move loop.
  async function moveAll() {
    if (!destination || documents.length === 0 || moving) return;
    moving = true;
    let moved = 0;
    try {
      for (const doc of documents) {
        await onRefile(doc.original, fromFolderId, destination);
        moved += 1;
      }
    } catch (e) {
      const remaining = documents.length - moved;
      alert(
        `Moved ${moved} of ${documents.length} document(s); stopped after a failure. ` +
          `${remaining} document(s) are still here.\n\n${e}`,
      );
    } finally {
      moving = false;
    }
  }
</script>

<section>
  <h3>{title} <span class="count">{documents.length}</span></h3>
  <div class="bulk">
    <select bind:value={destination}>
      {#each folders as folder (folder.id)}
        <option value={folder.id}>{folder.name}</option>
      {/each}
    </select>
    <button disabled={!destination || documents.length === 0 || moving} onclick={moveAll}>
      {moving ? 'Moving…' : 'Move all here'}
    </button>
  </div>
  <ul>
    {#each documents as doc (key(doc.original))}
      <li>{doc.meta.title ?? '(untitled)'} <span class="date">{doc.meta.date ?? ''}</span></li>
    {/each}
  </ul>
</section>

<style>
  ul { list-style: none; padding: 0; }
  .count, .date { opacity: 0.6; font-size: 0.85em; }
  .bulk { display: flex; gap: 0.5rem; margin-bottom: 0.5rem; }
</style>
