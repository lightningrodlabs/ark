<script lang="ts">
  import type { DocumentSummary } from '../types';
  import { renderMarkdown } from '../render';

  // Moss's asset-view render path: exactly one document, read-only, no tree,
  // no search, no editor. `doc` is `null` when the document no longer
  // resolves (trashed, or the asset predates a device that hasn't synced it
  // yet) rather than an error — see `we.ts`'s `getAssetInfo` for the same
  // distinction.
  let { doc }: { doc: DocumentSummary | null } = $props();

  let rendered = $derived(doc ? renderMarkdown(doc.body) : '');
</script>

{#if doc}
  <article class="asset-view">
    <header>
      <h2>{doc.meta.title ?? '(untitled)'}</h2>
      {#if doc.meta.date}<p class="date">{doc.meta.date}</p>{/if}
    </header>
    <!-- The only `{@html}` here, as everywhere else in this app, renders
         `renderMarkdown`'s output and nothing else — see render.ts. -->
    <div class="body">{@html rendered}</div>
  </article>
{:else}
  <p class="missing">This document is no longer available.</p>
{/if}

<style>
  .asset-view {
    padding: 1rem;
    max-width: 46rem;
    /* Opaque background for the same reason App.svelte's <main> is: a
       transparent Moss iframe costs text its subpixel antialiasing. */
    background: var(--sl-color-neutral-0, #fff);
  }
  .date { opacity: 0.7; font-size: 0.9em; margin: 0 0 1rem; }
  .body :global(table) { border-collapse: collapse; }
  .body :global(td), .body :global(th) { border: 1px solid rgba(128, 128, 128, 0.4); padding: 0.25rem 0.5rem; }
  .missing { padding: 1rem; opacity: 0.7; }
</style>
