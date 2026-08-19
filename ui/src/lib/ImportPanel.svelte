<script lang="ts">
  import type { ArkClient } from '../ark-client';
  import type { DocumentStore } from '../stores/documents.svelte';
  import type { TreeStore } from '../stores/tree.svelte';
  import { planImport, runImport, type ImportFile, type ImportPlan } from '../import/importer';

  let {
    ark,
    tree,
    store,
    onDone,
  }: {
    ark: ArkClient;
    tree: TreeStore;
    store: DocumentStore;
    onDone: () => void;
  } = $props();

  let files = $state<ImportFile[]>([]);
  let plan = $state<ImportPlan | null>(null);
  let running = $state(false);
  let progress = $state(0);

  async function choose(event: Event) {
    const input = event.target as HTMLInputElement;
    const picked = [...(input.files ?? [])].filter((f) => f.name.toLowerCase().endsWith('.md'));
    files = await Promise.all(picked.map(async (f) => ({ name: f.name, text: await f.text() })));
    plan = planImport(files, [...store.byOriginal.values()], tree.folders);
  }

  async function go() {
    if (!plan) return;
    running = true;
    progress = 0;
    try {
      // Import in slices so a large corpus reports progress rather than hanging.
      for (let i = 0; i < plan.create.length; i += 25) {
        const slice = { ...plan, create: plan.create.slice(i, i + 25), newFolders: i === 0 ? plan.newFolders : [] };
        await runImport(slice, { ark, tree, folders: tree.folders });
        progress = Math.min(i + 25, plan.create.length);
      }
      await store.load(tree.folders);
      onDone();
    } finally {
      running = false;
    }
  }
</script>

<section>
  <h3>Import markdown</h3>
  <p>Choose a folder of <code>.md</code> files with YAML front matter.</p>
  <input type="file" multiple webkitdirectory onchange={choose} />

  {#if plan}
    <ul class="summary">
      <li><strong>{plan.create.length}</strong> new document(s)</li>
      <li><strong>{plan.skipped.length}</strong> already present, will be skipped</li>
      <li><strong>{plan.newFolders.length}</strong> folder(s) to create: {plan.newFolders.join(', ')}</li>
    </ul>
    <button onclick={go} disabled={running || plan.create.length === 0}>
      {running ? `Importing ${progress}/${plan.create.length}…` : 'Import'}
    </button>
  {/if}
</section>

<style>
  .summary { list-style: none; padding: 0; }
</style>
