<script lang="ts">
  import type { FileStorageClient } from '@holochain-open-dev/file-storage';
  import type { ArkClient } from '../ark-client';
  import type { DocumentStore } from '../stores/documents.svelte';
  import type { TreeStore } from '../stores/tree.svelte';
  import {
    matchAttachments,
    planImport,
    runImport,
    type ImportFile,
    type ImportPlan,
  } from '../import/importer';

  let {
    ark,
    tree,
    store,
    fileStorage,
    onDone,
  }: {
    ark: ArkClient;
    tree: TreeStore;
    store: DocumentStore;
    fileStorage: FileStorageClient;
    onDone: () => void;
  } = $props();

  let mdFiles = $state<ImportFile[]>([]);
  // Non-markdown files picked alongside the minutes — attachment candidates,
  // matched against each planned document's front matter by basename.
  let candidates = $state<{ name: string; file: File }[]>([]);
  let plan = $state<ImportPlan | null>(null);
  let running = $state(false);
  let progress = $state(0);
  let summary = $state<{
    created: number;
    skipped: number;
    attached: number;
    attachmentsFailed: string[];
  } | null>(null);

  let attachmentMatches = $derived(
    plan ? matchAttachments(plan.create, candidates) : new Map<string, File[]>(),
  );

  async function choose(event: Event) {
    const input = event.target as HTMLInputElement;
    const picked = [...(input.files ?? [])];
    const md = picked.filter((f) => f.name.toLowerCase().endsWith('.md'));
    const rest = picked.filter((f) => !f.name.toLowerCase().endsWith('.md'));
    mdFiles = await Promise.all(md.map(async (f) => ({ name: f.name, text: await f.text() })));
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
    const attachments = attachmentMatches;
    const skippedCount = plan.skipped.length;
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
        });
        created += result.created;
        attached += result.attached;
        attachmentsFailed.push(...result.attachmentsFailed);
        progress = Math.min(i + 25, plan.create.length);
      }
      await store.load(tree.folders);
      // Clear the plan (and the picked files) so the button cannot be pressed
      // again without re-choosing — a stale plan re-run would re-create every
      // document just imported, in the same session, before import_id-based
      // dedup on the archive ever gets a chance to see them.
      summary = { created, skipped: skippedCount, attached, attachmentsFailed };
      plan = null;
      mdFiles = [];
      candidates = [];
      onDone();
    } finally {
      running = false;
    }
  }
</script>

<section>
  <h3>Import markdown</h3>
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
      <li><strong>{attachmentMatches.size}</strong> document(s) with a matched attachment</li>
    </ul>
    <button onclick={go} disabled={running || plan.create.length === 0}>
      {running ? `Importing ${progress}/${plan.create.length}…` : 'Import'}
    </button>
  {/if}

  {#if summary}
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
  {/if}
</section>

<style>
  .summary, .result, .failed-list { list-style: none; padding: 0; }
  .failed { color: #b91c1c; font-weight: bold; }
</style>
