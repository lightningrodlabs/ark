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
    // Snapshot before the loop: `documents` is a live prop, and each
    // successful move shrinks the parent's derived list (and so this prop)
    // mid-loop. Iterating and sizing off a fixed copy keeps both the
    // iteration and the failure-message counts accurate regardless of how
    // much the bin has shrunk underneath by the time a later move fails.
    const batch = [...documents];
    const total = batch.length;
    let moved = 0;
    try {
      for (const doc of batch) {
        await onRefile(doc.original, fromFolderId, destination);
        moved += 1;
      }
    } catch (e) {
      const remaining = total - moved;
      alert(
        `Moved ${moved} of ${total} document(s); stopped after a failure. ` +
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
