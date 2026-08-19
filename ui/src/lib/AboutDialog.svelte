<script lang="ts">
  import { encodeHashToBase64, type AgentPubKey, type DnaHash } from '@holochain/client';
  import type { FileStorageClient } from '@holochain-open-dev/file-storage';
  import type { ArkClient } from '../ark-client';
  import type { DocumentStore } from '../stores/documents.svelte';
  import type { TreeStore } from '../stores/tree.svelte';
  import { archiveFileName, buildArchive } from '../export/exporter';

  let {
    open = $bindable(false),
    ark,
    files,
    store,
    tree,
    dnaHash,
    agentKey,
    onImport,
  }: {
    open?: boolean;
    ark: ArkClient;
    files: FileStorageClient;
    store: DocumentStore;
    tree: TreeStore;
    // Undefined until appInfo() resolves, and permanently so if this app has
    // no provisioned `ark` cell — shown as such rather than as a blank.
    dnaHash?: DnaHash;
    agentKey?: AgentPubKey;
    onImport: () => void;
  } = $props();

  const version = __ARK_VERSION__;
  const REPO_URL = 'https://github.com/lightningrodlabs/ark';
  const COPYRIGHT_YEAR = 2026;

  let copied = $state<string | null>(null);
  let exporting = $state(false);
  let done = $state(0);
  let total = $state(0);
  let result = $state<{ name: string; documents: number; attachments: number; bytes: number } | null>(
    null,
  );
  let failed = $state<string[]>([]);
  let error = $state<string | null>(null);

  /** Long enough to recognise, short enough not to wrap. Full value is copyable. */
  function short(hash: Uint8Array | undefined): string {
    if (!hash) return 'unavailable';
    const b64 = encodeHashToBase64(hash);
    return `${b64.slice(0, 12)}…${b64.slice(-6)}`;
  }

  // These are what people paste into a bug report, so copy has to actually
  // work. navigator.clipboard is available inside Moss.
  async function copy(label: string, hash: Uint8Array | undefined) {
    if (!hash) return;
    try {
      await navigator.clipboard.writeText(encodeHashToBase64(hash));
      copied = label;
      setTimeout(() => (copied = copied === label ? null : copied), 1500);
    } catch (e) {
      error = `Could not copy to the clipboard: ${e}`;
    }
  }

  function readBytes(blob: Blob): Promise<Uint8Array> {
    // FileReader rather than Blob.arrayBuffer(), for the same reason
    // import/importer.ts uses it: not every Blob implementation this code runs
    // against implements arrayBuffer().
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
  }

  function human(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function runExport() {
    exporting = true;
    result = null;
    failed = [];
    error = null;
    done = 0;
    total = store.byOriginal.size;
    try {
      const archive = await buildArchive(
        {
          documents: [...store.byOriginal.values()],
          // Tombstoned folders included on purpose: a document filed under a
          // deleted folder keeps its path in the export instead of landing in
          // _unfiled. See exporter.pathOf.
          folders: tree.folders,
          filings: store.filings,
          trashed: store.trashed,
        },
        {
          attachmentsOf: async (doc) => {
            const hashes = await ark.getAttachments(doc.original);
            const out: { name: string; bytes: Uint8Array }[] = [];
            for (const hash of hashes) {
              const meta = await files.getFileMetadata(hash);
              out.push({ name: meta.name, bytes: await readBytes(await files.downloadFile(hash)) });
            }
            return out;
          },
          versionsOf: async (doc) => (await ark.getDocumentVersions(doc.original)).length,
          onProgress: (d, t) => {
            done = d;
            total = t;
          },
        },
      );

      const name = archiveFileName();
      // Programmatic <a download>, not window.open — Moss denies window.open
      // for anything but http(s), so a blob: URL opened that way goes nowhere.
      // Same shape as Attachments.svelte's download.
      // `.slice()` copies into a plain ArrayBuffer-backed view: TypeScript's
      // BlobPart will not take a Uint8Array that might sit on a
      // SharedArrayBuffer, which is what fflate's return type allows for.
      const blob = new Blob([archive.bytes.slice().buffer], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      failed = archive.failed;
      result = {
        name,
        documents: archive.documents,
        attachments: archive.attachments,
        bytes: archive.bytes.length,
      };
    } catch (e) {
      error = String(e);
    } finally {
      exporting = false;
    }
  }
</script>

<sl-dialog
  label="About ark"
  open={open}
  onsl-after-hide={() => (open = false)}
  data-testid="about-dialog"
>
  <dl class="facts">
    <dt>Version</dt>
    <dd data-testid="about-version">ark {version}</dd>

    <dt>DNA hash</dt>
    <dd>
      <code data-testid="about-dna">{short(dnaHash)}</code>
      {#if dnaHash}
        <button class="copy" onclick={() => copy('dna', dnaHash)}>
          {copied === 'dna' ? 'Copied' : 'Copy'}
        </button>
      {/if}
    </dd>

    <dt>Your public key</dt>
    <dd>
      <code data-testid="about-agent">{short(agentKey)}</code>
      {#if agentKey}
        <button class="copy" onclick={() => copy('agent', agentKey)}>
          {copied === 'agent' ? 'Copied' : 'Copy'}
        </button>
      {/if}
    </dd>

    <dt>Documents held</dt>
    <dd>{store.byOriginal.size}</dd>
  </dl>

  <div class="actions">
    <button
      onclick={() => {
        open = false;
        onImport();
      }}>Import…</button
    >
    <button onclick={runExport} disabled={exporting} data-testid="about-export">
      {exporting ? `Exporting ${done}/${total}…` : 'Export…'}
    </button>
  </div>

  <p class="note">
    Export writes every document that is not in the trash as markdown with YAML
    front matter, in folders mirroring the tree, attachments beside them, as one
    zip. Only the current version of each document is written; where there were
    earlier ones, the count is recorded in its front matter. What comes out is
    what Import reads back in.
  </p>

  {#if result}
    <p class="result" data-testid="about-export-result">
      Wrote {result.name} — {result.documents} document{result.documents === 1 ? '' : 's'},
      {result.attachments} attachment{result.attachments === 1 ? '' : 's'}, {human(result.bytes)}.
    </p>
  {/if}
  {#if failed.length > 0}
    <p class="failed">{failed.length} item(s) could not be included:</p>
    <ul class="failed-list">
      {#each failed as f}
        <li>{f}</li>
      {/each}
    </ul>
  {/if}
  {#if error}
    <p class="failed" data-testid="about-error">{error}</p>
  {/if}

  <footer class="colophon">
    <span>&copy; {COPYRIGHT_YEAR} Lightningrod Labs</span>
    <!-- Moss denies window.open for everything except http(s), which it hands
         to the OS browser — so an ordinary external link is the one navigation
         that does work from inside the applet. -->
    <a
      href={REPO_URL}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="about-repo">{REPO_URL.replace('https://', '')}</a
    >
  </footer>
</sl-dialog>

<style>
  .colophon {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
    margin-top: 1.25rem;
    padding-top: 0.6rem;
    border-top: 1px solid rgba(128, 128, 128, 0.3);
    font-size: 0.85rem;
    opacity: 0.8;
  }
  .facts {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.35rem 1rem;
    margin: 0 0 1rem;
  }
  .facts dt {
    font-weight: bold;
    white-space: nowrap;
  }
  .facts dd {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    overflow-wrap: anywhere;
  }
  .copy {
    flex: none;
  }
  .actions {
    display: flex;
    gap: 0.5rem;
  }
  .note {
    opacity: 0.7;
    font-size: 0.9em;
  }
  .failed {
    color: #b91c1c;
    font-weight: bold;
  }
  .failed-list {
    list-style: none;
    padding: 0;
  }
</style>
