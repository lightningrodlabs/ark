<script lang="ts">
  import type { DocumentSummary } from '../types';
  import { key } from '../stores/documents.svelte';

  let {
    documents,
    selected,
    onSelect,
  }: {
    documents: DocumentSummary[];
    selected: string | null;
    onSelect: (doc: DocumentSummary) => void;
  } = $props();

  let sorted = $derived(
    [...documents].sort((a, b) => (b.meta.date ?? '').localeCompare(a.meta.date ?? '')),
  );
</script>

<ul>
  {#each sorted as doc (key(doc.original))}
    <li class:selected={selected === key(doc.original)}>
      <button onclick={() => onSelect(doc)}>
        <span class="title">{doc.meta.title ?? '(untitled)'}</span>
        <span class="date">{doc.meta.date ?? ''}</span>
      </button>
    </li>
  {/each}
  {#if sorted.length === 0}
    <li class="empty">No documents here.</li>
  {/if}
</ul>

<style>
  ul { list-style: none; margin: 0; padding: 0; }
  button { display: flex; justify-content: space-between; width: 100%; gap: 1rem;
           background: none; border: none; text-align: left; padding: 0.4rem; cursor: pointer; }
  .selected { background: rgba(128, 128, 128, 0.2); }
  .date { opacity: 0.6; font-variant-numeric: tabular-nums; }
  .empty { opacity: 0.6; padding: 0.4rem; }
</style>
