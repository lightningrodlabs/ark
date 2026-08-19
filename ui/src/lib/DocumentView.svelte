<script lang="ts">
  import { marked } from 'marked';
  import { encodeHashToBase64 } from '@holochain/client';
  import type { ArkClient } from '../ark-client';
  import type { DocumentSummary, DocumentVersion } from '../types';
  import VersionHistory from './VersionHistory.svelte';

  let {
    doc,
    ark,
    onAmend,
    onTrash,
  }: {
    doc: DocumentSummary;
    ark: ArkClient;
    onAmend: () => void;
    onTrash: () => void;
  } = $props();

  let versions = $state<DocumentVersion[]>([]);

  $effect(() => {
    ark.getDocumentVersions(doc.original).then((v) => (versions = v));
  });

  let rendered = $derived(marked.parse(doc.body) as string);
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
</article>

<style>
  article { padding: 1rem; max-width: 46rem; }
  .meta { display: flex; gap: 1rem; opacity: 0.7; font-size: 0.9em; }
  .actions { display: flex; gap: 0.5rem; margin: 0.5rem 0; }
  .body :global(table) { border-collapse: collapse; }
  .body :global(td), .body :global(th) { border: 1px solid rgba(128,128,128,0.4); padding: 0.25rem 0.5rem; }
</style>
