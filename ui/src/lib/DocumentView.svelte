<script lang="ts">
  import { encodeHashToBase64 } from '@holochain/client';
  import type { FileStorageClient } from '@holochain-open-dev/file-storage';
  import type { ArkClient } from '../ark-client';
  import type { SearchStore } from '../stores/search.svelte';
  import type { DocumentSummary, DocumentVersion } from '../types';
  import { renderMarkdown } from '../render';
  import VersionHistory from './VersionHistory.svelte';
  import Attachments from './Attachments.svelte';

  let {
    doc,
    ark,
    files,
    search,
    onAmend,
    onTrash,
  }: {
    doc: DocumentSummary;
    ark: ArkClient;
    files: FileStorageClient;
    search: SearchStore;
    onAmend: () => void;
    onTrash: () => void;
  } = $props();

  let versions = $state<DocumentVersion[]>([]);

  // Generation guard: switching documents quickly leaves the earlier request in
  // flight, and without this an older response can resolve last and paint the
  // wrong document's history.
  let generation = 0;
  $effect(() => {
    const mine = ++generation;
    const original = doc.original;
    ark.getDocumentVersions(original).then((v) => {
      if (mine === generation) versions = v;
    });
  });

  let rendered = $derived(renderMarkdown(doc.body));
  let extraMeta = $derived(
    Object.entries(doc.meta).filter(([k]) => k !== 'title' && k !== 'date'),
  );
</script>

<article>
  <header>
    <h2>{doc.meta.title ?? '(untitled)'}</h2>
    <div class="meta">
      {#if doc.meta.date}<span>{doc.meta.date}</span>{/if}
      <!-- Unknown keys written by a newer UI still display, rather than vanish. -->
      {#each extraMeta as [k, v]}<span>{k}: {v}</span>{/each}
    </div>
    <div class="actions">
      <button onclick={onAmend}>Amend</button>
      <button onclick={onTrash}>Trash</button>
    </div>
  </header>
  <div class="body">{@html rendered}</div>
  {#if versions.length > 1}
    <VersionHistory {versions} currentAction={encodeHashToBase64(doc.latest)} />
  {/if}
  <Attachments
    {ark}
    {files}
    {doc}
    onIndexed={(original, name, text) => search.setAttachmentText(original, name, text)}
    onUnindexed={(original, name) => search.removeAttachmentText(original, name)}
  />
</article>

<style>
  article { padding: 1rem; max-width: 46rem; }
  .meta { display: flex; gap: 1rem; opacity: 0.7; font-size: 0.9em; }
  .actions { display: flex; gap: 0.5rem; margin: 0.5rem 0; }
  .body :global(table) { border-collapse: collapse; }
  .body :global(td), .body :global(th) { border: 1px solid rgba(128,128,128,0.4); padding: 0.25rem 0.5rem; }
</style>
