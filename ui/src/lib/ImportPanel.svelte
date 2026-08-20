<script lang="ts">
  import type { FileStorageClient } from '@holochain-open-dev/file-storage';
  import type { ArkClient } from '../ark-client';
  import type { DocumentStore } from '../stores/documents.svelte';
  import type { TreeStore } from '../stores/tree.svelte';
  import type { SearchStore } from '../stores/search.svelte';
  import { syncMissing } from '../reconcile';
  import {
    matchAttachments,
    planImport,
    runImport,
    type AttachmentMatch,
    type ImportFile,
    type ImportPlan,
  } from '../import/importer';
  import { readTextFiles, type ReadFailure } from '../import/read-files';

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
    /**
     * Required, not optional: this panel keeps the index in step itself now
     * (see `refresh` below), so a run without one would leave search quietly
     * answering for the archive as it was before the import.
     */
    search: SearchStore;
    onDone: () => void;
    /**
     * Reported up so the pane's close button can be disabled while documents
     * are actually being written — the panel vanishing mid-run is worse than
     * having no close button at all.
     */
    onRunningChange?: (running: boolean) => void;
  } = $props();

  /**
   * The two pickers. `webkitdirectory` cannot be turned on and off on one
   * input, so there are two — and picking with either has to clear the other,
   * or the control the user did not use goes on displaying a stale file count
   * beside the plan it had nothing to do with.
   */
  let folderInput = $state<HTMLInputElement | null>(null);
  let filesInput = $state<HTMLInputElement | null>(null);

  let mdFiles = $state<ImportFile[]>([]);
  // Non-markdown files picked alongside the minutes — attachment candidates,
  // matched against each planned document's front matter, preferring one in
  // the same directory as the document.
  let candidates = $state<{ name: string; file: File }[]>([]);
  let plan = $state<ImportPlan | null>(null);
  /**
   * Reading the picked files is itself a phase with a duration — 1406 markdown
   * files out of the reference archive's 4251 — and it used to be an invisible
   * one. "After choosing the file to import I see the number 4251, but the next
   * step never happens" is what a silent read phase looks like from outside,
   * whether it is slow or has died.
   */
  let reading = $state(false);
  let readDone = $state(0);
  let readTotal = $state(0);
  /** Picked files whose contents could not be read, named so they can be found. */
  let readFailures = $state<ReadFailure[]>([]);
  /** A failure in `choose` itself, rather than in one file's read. */
  let chooseError = $state<string | null>(null);
  let running = $state(false);
  let progress = $state(0);
  /**
   * A run has two halves, and the second one used to be invisible: writing the
   * documents, then reading back what was written. On the reference archive
   * the read-back is many round trips, and a button frozen at `1406/1406`
   * throughout is exactly the "finished, but hung" the import was reported as.
   */
  let phase = $state<'writing' | 'refreshing'>('writing');
  let refreshed = $state(0);
  let refreshTotal = $state(0);
  let summary = $state<{
    created: number;
    skipped: number;
    attached: number;
    attachmentsFailed: string[];
    unmatched: AttachmentMatch['unmatched'];
    error?: string;
  } | null>(null);

  $effect(() => onRunningChange?.(running));

  /**
   * Every markdown file the user picked failed to read — not one of them
   * worked.
   *
   * Worth telling apart from "one file is bad", because it is a different
   * problem with a different owner. A single failure is a file; a clean sweep
   * is the environment. Whoever hits this needs to know which of the two they
   * are looking at before they start hunting for a corrupt file that does not
   * exist — and the packaged applet has already proved it will refuse reads
   * that vite-served dev allows.
   *
   * State rather than `$derived` off `mdFiles`: `go()` clears `mdFiles` when a
   * run finishes, which would turn a single reported failure into "none of
   * them could be read" the moment the import completed.
   */
  let allReadsFailed = $state(false);
  // Set when the read pool gave up part way: a long run of failures with no
  // success between them, so the rest were never attempted.
  let readStoppedEarly = $state(false);
  let readSkipped = $state(0);

  const EMPTY_MATCH: AttachmentMatch = { byImportId: new Map(), unmatched: [] };
  let attachmentMatch = $derived(
    plan ? matchAttachments(plan.create, candidates) : EMPTY_MATCH,
  );

  /**
   * Read what the user picked and plan the import.
   *
   * Every line of this is inside the try. It is an async `onchange` handler, so
   * anything that escapes it is an unhandled rejection with nowhere to go: the
   * live failure was
   * `Uncaught (in promise) NotReadableError: The requested file could not be
   * read...`, after which `plan` was never assigned and the panel rendered
   * nothing new. The user was left looking at the input's own file count with
   * no way to tell a slow read from a dead one. The trigger was starting all
   * 1409 reads at once (see read-files.ts), but the handler had no business
   * swallowing a rejection either way: whatever makes a read fail next, it has
   * to end up on screen.
   */
  async function choose(event: Event) {
    const input = event.target as HTMLInputElement;
    for (const other of [folderInput, filesInput]) {
      if (other && other !== input) other.value = '';
    }
    plan = null;
    summary = null;
    mdFiles = [];
    candidates = [];
    readFailures = [];
    allReadsFailed = false;
    readStoppedEarly = false;
    readSkipped = 0;
    chooseError = null;
    reading = true;
    readDone = 0;
    readTotal = 0;
    try {
      const picked = [...(input.files ?? [])];
      const md = picked.filter((f) => f.name.toLowerCase().endsWith('.md'));
      const rest = picked.filter((f) => !f.name.toLowerCase().endsWith('.md'));
      // Bounded, retried, and reporting per-file failures rather than throwing
      // on the first one — see read-files.ts. A single unreadable file out of
      // 1406 costs the user that file, not the import.
      const { read, failed, stoppedEarly, skipped } = await readTextFiles(md, (done, total) => {
        readDone = done;
        readTotal = total;
      });
      mdFiles = read;
      readFailures = failed;
      readStoppedEarly = stoppedEarly;
      readSkipped = skipped;
      allReadsFailed = failed.length > 0 && read.length === 0;
      candidates = rest.map((f) => ({ name: f.webkitRelativePath || f.name, file: f }));
      plan = planImport(mdFiles, [...store.byOriginal.values()], tree.folders);
    } catch (e) {
      chooseError = String(e);
    } finally {
      reading = false;
    }
  }

  /**
   * Pick up what the run just wrote.
   *
   * This used to be `store.load(tree.folders)` — a re-page of every document
   * in the archive to discover the handful just created, followed by a full
   * index rebuild on top. `syncMissing` reads the hash list and fetches only
   * what is actually missing, updating the index incrementally; it still falls
   * back to the paged load when the delta is larger than one page (a first
   * import of the whole archive), which is the one case where re-paging is
   * genuinely the cheaper answer. Shared with the reconcile backstop rather
   * than reimplemented here: the fallback threshold and what the index needs
   * afterwards are one rule, and two copies of it would drift.
   */
  async function refresh() {
    phase = 'refreshing';
    await syncMissing({ tree, store, search }, (done, total) => {
      refreshed = done;
      refreshTotal = total;
    });
  }

  async function go() {
    if (!plan) return;
    running = true;
    progress = 0;
    phase = 'writing';
    refreshed = 0;
    refreshTotal = 0;
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
          onAttachmentText: (original, name, text) => search.setAttachmentText(original, name, text),
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
      await refresh();
    } catch (e) {
      // A failure partway through must not be a silent unhandled rejection —
      // report how much got created before it, and the error, so the user
      // knows what happened rather than staring at a stuck progress bar.
      runError = String(e);
      // Best-effort: reflect whatever was actually created before the
      // reload, but a second failure here must not mask the first, more
      // informative one or leave the `finally` block from running.
      try {
        await refresh();
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
      phase = 'writing';
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
    Import <code>.md</code> files with YAML front matter. Pick the whole export folder — any
    attachment files named in the front matter are picked up along with it — or pick individual
    files, which is the way to import one document or to narrow down a folder that will not
    import.
  </p>
  <!-- Two controls, because one input cannot be both. `webkitdirectory` makes
       the picker directory-ONLY: with just that input there was no way to
       import a single file, or a hand-picked few — which also left the user
       unable to run the obvious diagnostic when a whole-folder import failed.
       Both routes go through the same `choose`, so the plan, the import and
       the failure reporting are identical either way. -->
  <div class="pickers">
    <label>
      <span>Choose a folder</span>
      <input
        type="file"
        multiple
        webkitdirectory
        class="pick-folder"
        bind:this={folderInput}
        onchange={choose}
      />
    </label>
    <label>
      <span>…or choose individual files</span>
      <input
        type="file"
        multiple
        class="pick-files"
        bind:this={filesInput}
        onchange={choose}
      />
    </label>
  </div>

  {#if reading}
    <p class="reading">Reading {readDone}/{readTotal} file(s)…</p>
  {/if}

  {#if chooseError}
    <p class="failed">The files you picked could not be read: {chooseError}</p>
  {/if}

  {#if allReadsFailed}
    <p class="failed">
      None of the {readFailures.length} markdown file(s) attempted could be read — not one.
      That points at this environment rather than at the files themselves: reading a picked
      file can behave differently in Moss than it does under <code>npm run start:moss</code>. Please
      report it with the message below.
    </p>
    {#if readStoppedEarly}
      <p class="warn">
        Stopped after {readFailures.length} failures in a row without attempting the remaining
        {readSkipped}, rather than spending several minutes failing the same way on every one.
        A smaller selection may work.
      </p>
    {/if}
    <ul class="failed-list">
      {#each readFailures.slice(0, 10) as failure}
        <li>{failure.name} — {failure.error}</li>
      {/each}
      {#if readFailures.length > 10}
        <li>…and {readFailures.length - 10} more.</li>
      {/if}
    </ul>
  {:else if readFailures.length > 0}
    <p class="failed">
      {readFailures.length} file(s) could not be read and will not be imported:
    </p>
    <ul class="failed-list">
      {#each readFailures as failure}
        <li>{failure.name} — {failure.error}</li>
      {/each}
    </ul>
  {/if}

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
      {#if !running}
        Import
      {:else if phase === 'writing'}
        Importing {progress}/{plan.create.length}…
      {:else if refreshTotal}
        Refreshing the archive… {refreshed}/{refreshTotal}
      {:else}
        Refreshing the archive…
      {/if}
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
  .pickers { display: flex; flex-direction: column; gap: 0.5rem; }
  .pickers label { display: flex; flex-direction: column; gap: 0.15rem; }
  .pickers span { font-size: 0.85rem; color: #57534e; }
  .summary, .result, .failed-list { list-style: none; padding: 0; }
  .failed { color: #b91c1c; font-weight: bold; }
  .reading { color: #57534e; }
  .warn { color: #92400e; }
</style>
