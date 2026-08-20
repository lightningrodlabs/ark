<script lang="ts">
  import type { FileStorageClient } from '@holochain-open-dev/file-storage';
  import type { ArkClient } from '../ark-client';
  import type { DocumentStore } from '../stores/documents.svelte';
  import type { TreeStore } from '../stores/tree.svelte';
  import type { SearchStore } from '../stores/search.svelte';
  import {
    matchAttachments,
    planImport,
    runImport,
    type AttachmentMatch,
    type ImportFile,
    type ImportPlan,
  } from '../import/importer';

  let {
    ark,
    tree,
    store,
    fileStorage,
    search,
    onDone,
    onRunningChange,
  }: {
    ark: ArkClient;
    tree: TreeStore;
    store: DocumentStore;
    fileStorage: FileStorageClient;
    search?: SearchStore;
    onDone: () => void;
    /**
     * Reported up so the pane's close button can be disabled while documents
     * are actually being written — the panel vanishing mid-run is worse than
     * having no close button at all.
     */
    onRunningChange?: (running: boolean) => void;
  } = $props();

  let mdFiles = $state<ImportFile[]>([]);
  // Non-markdown files picked alongside the minutes — attachment candidates,
  // matched against each planned document's front matter, preferring one in
  // the same directory as the document.
  let candidates = $state<{ name: string; file: File }[]>([]);
  let plan = $state<ImportPlan | null>(null);
  let running = $state(false);
  let progress = $state(0);
  let summary = $state<{
    created: number;
    skipped: number;
    attached: number;
    attachmentsFailed: string[];
    unmatched: AttachmentMatch['unmatched'];
    error?: string;
  } | null>(null);

  $effect(() => onRunningChange?.(running));

  const EMPTY_MATCH: AttachmentMatch = { byImportId: new Map(), unmatched: [] };
  let attachmentMatch = $derived(
    plan ? matchAttachments(plan.create, candidates) : EMPTY_MATCH,
  );

  async function choose(event: Event) {
    const input = event.target as HTMLInputElement;
    const picked = [...(input.files ?? [])];
    const md = picked.filter((f) => f.name.toLowerCase().endsWith('.md'));
    const rest = picked.filter((f) => !f.name.toLowerCase().endsWith('.md'));
    // The relative path (not just the basename) is what lets matchAttachments
    // tell two same-named attachments in different meeting folders apart.
    mdFiles = await Promise.all(
      md.map(async (f) => ({ name: f.webkitRelativePath || f.name, text: await f.text() })),
    );
    candidates = rest.map((f) => ({ name: f.webkitRelativePath || f.name, file: f }));
    plan = planImport(mdFiles, [...store.byOriginal.values()], tree.folders);
    summary = null;
  }

  async function go() {
    if (!plan) return;
    running = true;
    progress = 0;
    let created = 0;
    let attached = 0;
    const attachmentsFailed: string[] = [];
    const attachments = attachmentMatch.byImportId;
    const unmatched = attachmentMatch.unmatched;
    const skippedCount = plan.skipped.length;
    let runError: string | undefined;
    try {
      // Import in slices so a large corpus reports progress rather than hanging.
      for (let i = 0; i < plan.create.length; i += 25) {
        const slice = {
          ...plan,
          create: plan.create.slice(i, i + 25),
          newFolders: i === 0 ? plan.newFolders : [],
        };
        const result = await runImport(slice, {
          ark,
          tree,
          folders: tree.folders,
          files: fileStorage,
          attachments,
          onAttachmentText: (original, name, text) => search?.setAttachmentText(original, name, text),
          // Per document, not per slice. The slice boundary was the only
          // thing that moved this number before, and at 25 documents a step
          // that is minutes of a motionless label on the reference archive —
          // indistinguishable from an import that has hung.
          onProgress: (n) => (progress = i + n),
        });
        created += result.created;
        attached += result.attached;
        attachmentsFailed.push(...result.attachmentsFailed);
      }
      await store.load(tree.folders);
    } catch (e) {
      // A failure partway through must not be a silent unhandled rejection —
      // report how much got created before it, and the error, so the user
      // knows what happened rather than staring at a stuck progress bar.
      runError = String(e);
      // Best-effort: reflect whatever was actually created before the
      // reload, but a second failure here must not mask the first, more
      // informative one or leave the `finally` block from running.
      try {
        await store.load(tree.folders);
      } catch {
        // Reported via runError already; nothing more useful to say.
      }
    } finally {
      summary = {
        created,
        skipped: skippedCount,
        attached,
        attachmentsFailed,
        unmatched,
        error: runError,
      };
      // Clear the plan (and the picked files) regardless of outcome, so a
      // retry must re-pick and re-plan against current state. `plan` was
      // computed against the pre-import snapshot; on a partial failure,
      // pressing Import again with the stale plan would re-create every
      // document already written before import_id-based dedup on the archive
      // ever gets a chance to see them.
      plan = null;
      mdFiles = [];
      candidates = [];
      running = false;
      onDone();
    }
  }
</script>

<!-- No heading of its own: the pane header names this panel now (see
     PaneHeader.svelte), and two "Import markdown" titles one above the other
     was the first thing a shared header made redundant. -->
<section>
  <p>
    Choose a folder of <code>.md</code> files with YAML front matter. Any attachment files named
    in the front matter can be selected too — pick the whole export folder.
  </p>
  <input type="file" multiple webkitdirectory onchange={choose} />

  {#if plan}
    <ul class="summary">
      <li><strong>{plan.create.length}</strong> new document(s)</li>
      <li><strong>{plan.skipped.length}</strong> already present, will be skipped</li>
      <li><strong>{plan.newFolders.length}</strong> folder(s) to create: {plan.newFolders.join(', ')}</li>
      <li><strong>{attachmentMatch.byImportId.size}</strong> document(s) with a matched attachment</li>
    </ul>
    {#if attachmentMatch && attachmentMatch.unmatched.length}
      <details class="warn">
        <summary>
          {attachmentMatch.unmatched.length} attachment(s) referenced but not importable
        </summary>
        <ul>
          {#each attachmentMatch.unmatched as u}
            <li>{u.title} — {u.name} ({u.reason})</li>
          {/each}
        </ul>
      </details>
    {/if}
    <button onclick={go} disabled={running || plan.create.length === 0}>
      {running ? `Importing ${progress}/${plan.create.length}…` : 'Import'}
    </button>
  {/if}

  {#if summary}
    {#if summary.error}
      <p class="failed">
        Import stopped after a failure, {summary.created} document(s) were created before it.
        Re-choose the folder to retry — a fresh plan will skip what is already there.
      </p>
      <p class="failed">{summary.error}</p>
    {/if}
    <ul class="result">
      <li>{summary.created} document(s) created</li>
      <li>{summary.skipped} already present, skipped</li>
      <li>{summary.attached} attachment(s) uploaded</li>
    </ul>
    {#if summary.attachmentsFailed.length > 0}
      <p class="failed">{summary.attachmentsFailed.length} attachment(s) failed to upload:</p>
      <ul class="failed-list">
        {#each summary.attachmentsFailed as failure}
          <li>{failure}</li>
        {/each}
      </ul>
    {/if}
    {#if summary.unmatched.length > 0}
      <p class="failed">{summary.unmatched.length} attachment(s) referenced but not imported:</p>
      <ul class="failed-list">
        {#each summary.unmatched as u}
          <li>{u.title} — {u.name} ({u.reason})</li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>

<style>
  /* The pane itself has no padding — each occupant pads itself, at the same
     1rem, and the pane header pads itself to match. Without this the panel
     sits flush against the split-panel divider. */
  section { padding: 1rem; max-width: 46rem; }
  /* The first paragraph's own top margin doubled the header's padding. */
  section > p:first-child { margin-top: 0; }
  .summary, .result, .failed-list { list-style: none; padding: 0; }
  .failed { color: #b91c1c; font-weight: bold; }
  .warn { color: #92400e; }
</style>
