<script lang="ts">
  import { encodeHashToBase64 } from '@holochain/client';
  import type { FileStorageClient } from '@holochain-open-dev/file-storage';
  import type { ArkClient } from '../ark-client';
  import type { DocumentSummary, DocumentVersion } from '../types';
  import { renderMarkdown } from '../render';
  import VersionHistory from './VersionHistory.svelte';
  import Attachments from './Attachments.svelte';

  // Moss's asset-view render path: exactly one document, read-only, no tree,
  // no search, no editor. `doc` is `null` when the document no longer
  // resolves (trashed, or the asset predates a device that hasn't synced it
  // yet) rather than an error — see `we.ts`'s `getAssetInfo` for the same
  // distinction.
  let {
    doc,
    ark,
    files,
  }: { doc: DocumentSummary | null; ark: ArkClient; files: FileStorageClient } = $props();

  let rendered = $derived(doc ? renderMarkdown(doc.body) : '');

  let versions = $state<DocumentVersion[]>([]);

  // Generation guard, same reasoning as DocumentView's own version fetch: a
  // late-resolving response must not paint over whatever is current by the
  // time it lands. `doc` never actually changes under an asset view (one
  // WAL, one mount), but the guard costs nothing and keeps this in step with
  // the pattern everywhere else `getDocumentVersions` is called.
  let generation = 0;
  $effect(() => {
    const mine = ++generation;
    const original = doc?.original;
    if (!original) {
      versions = [];
      return;
    }
    ark.getDocumentVersions(original).then((v) => {
      if (mine === generation) versions = v;
    });
  });
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
    <!-- Same "more than one version" rule as DocumentView — a document with
         only its original version has no history worth showing. -->
    {#if versions.length > 1}
      <VersionHistory {versions} currentAction={encodeHashToBase64(doc.latest)} />
    {/if}
    <!-- readOnly: no upload input, no Remove button, and the section hides
         itself entirely when there is nothing attached. No onIndexed/
         onUnindexed — this view has no search store to feed, and reusing
         Attachments here must not mean building one just to satisfy a prop. -->
    <Attachments {ark} {files} {doc} readOnly />
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
