<script lang="ts">
  import { getContext } from 'svelte';
  import { encodeHashToBase64, type DnaHash } from '@holochain/client';
  import type { WAL } from '@theweave/api';
  import type { FileStorageClient } from '@holochain-open-dev/file-storage';
  import type { ArkClient } from '../ark-client';
  import type { SearchStore } from '../stores/search.svelte';
  import type { DocumentSummary, DocumentVersion } from '../types';
  import { renderMarkdown } from '../render';
  import { applyHighlight } from '../search/highlight';
  import { weaveContext } from '../contexts';
  import VersionHistory from './VersionHistory.svelte';
  import Attachments from './Attachments.svelte';

  let {
    doc,
    ark,
    files,
    search,
    highlight = [],
    onAmend,
    onTrash,
  }: {
    doc: DocumentSummary;
    ark: ArkClient;
    files: FileStorageClient;
    search: SearchStore;
    /** Terms to mark in the body — set only when this document was opened
     * from a search result, empty for every other route in. */
    highlight?: string[];
    onAmend: () => void;
    onTrash: () => void;
  } = $props();

  // Pocket controls need two things, and both are checked: a Moss host to put
  // a WAL into (`inMoss`), and the DNA hash every WAL's `hrl[0]` is built
  // from. They used to be gated on `dnaHash` alone, on the assumption that it
  // was only ever fetched inside Moss — no longer true now that the About
  // dialog shows it on every boot, so outside Moss (hc-spin dev, the e2e
  // harness) that gate would have rendered buttons with nowhere to add to.
  const weave = getContext<
    { dnaHash?: DnaHash; inMoss?: boolean; addToPocket?: (wal: WAL) => void } | undefined
  >(weaveContext);

  // The same document, addable to the pocket as two different WALs — see
  // notebooks/ui/src/elements/markdown-note.ts for the pattern this mirrors.
  // `hrl[1]` is the document's original create action, matching what every
  // other link in this app targets and what `get_document`/`getAssetInfo`
  // expect.
  function addToPocket(context: WAL['context']) {
    if (!weave?.inMoss || !weave.dnaHash || !weave.addToPocket) return;
    weave.addToPocket({ hrl: [weave.dnaHash, doc.original], context });
  }

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

  let bodyEl: HTMLElement | undefined = $state();

  // Mark the search terms over the rendered body. Ranges across the text
  // nodes DOMPurify already sanitised — no markup is built here, so every
  // byte inside {@html} still comes from renderMarkdown alone. The cleanup
  // clears the marks when the terms change, the document changes, or this
  // view goes away.
  $effect(() => {
    // Read to subscribe: a re-render replaces the text nodes the ranges point at.
    rendered;
    return applyHighlight(bodyEl, highlight);
  });

  let extraMeta = $derived(
    Object.entries(doc.meta).filter(([k]) => k !== 'title' && k !== 'date'),
  );
</script>

<article>
  <!-- No <h2> here: the pane header above this view carries the document's
       title (see PaneHeader.svelte / App.svelte). AssetView keeps its own,
       because Moss renders it with no pane around it. -->
  <header>
    <div class="meta">
      {#if doc.meta.date}<span>{doc.meta.date}</span>{/if}
      <!-- Unknown keys written by a newer UI still display, rather than vanish. -->
      {#each extraMeta as [k, v]}<span>{k}: {v}</span>{/each}
    </div>
    <div class="actions">
      <button onclick={onAmend}>Amend</button>
      <button onclick={onTrash}>Trash</button>
      {#if weave?.inMoss && weave?.dnaHash}
        <button onclick={() => addToPocket({})}>Add to pocket</button>
      {/if}
    </div>
  </header>
  <div class="body" bind:this={bodyEl}>{@html rendered}</div>
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
