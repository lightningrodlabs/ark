<script lang="ts">
  import type { EntryHash } from '@holochain/client';
  import { encodeHashToBase64 } from '@holochain/client';
  import type { FileStorageClient } from '@holochain-open-dev/file-storage';
  import type { ArkClient } from '../ark-client';
  import type { DocumentSummary } from '../types';
  import { decodeAttachment, isIndexableText } from '../attachments/text';

  let {
    ark,
    files,
    doc,
    onIndexed,
    onUnindexed,
  }: {
    ark: ArkClient;
    files: FileStorageClient;
    doc: DocumentSummary;
    onIndexed: (name: string, text: string) => void;
    onUnindexed: (name: string) => void;
  } = $props();

  let attached = $state<{ hash: EntryHash; name: string; type: string; size: number }[]>([]);
  let busy = $state(false);

  // Generation guard: switching documents quickly leaves an earlier refresh in
  // flight, and without this a late-resolving fetch could paint the wrong
  // document's attachment list, or attribute its text to the wrong document
  // in the search index.
  let generation = 0;

  async function refresh(original: DocumentSummary['original'], mine: number) {
    const hashes = await ark.getAttachments(original);
    const listed = [];
    for (const hash of hashes) {
      const meta = await files.getFileMetadata(hash);
      if (mine !== generation) return;
      listed.push({ hash, name: meta.name, type: meta.file_type, size: meta.size });
      if (isIndexableText(meta.name, meta.file_type)) {
        const blob = await files.downloadFile(hash);
        if (mine !== generation) return;
        onIndexed(meta.name, decodeAttachment(new Uint8Array(await blob.arrayBuffer())));
      }
    }
    if (mine === generation) attached = listed;
  }

  $effect(() => {
    const mine = ++generation;
    const original = doc.original;
    refresh(original, mine);
  });

  async function upload(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    // Pin the document BEFORE the upload. Reading `doc.original` afterwards
    // attaches the file to whatever document is selected when the upload
    // finishes — and unlike a stale list, this writes a real DHT link every
    // peer sees.
    const original = doc.original;
    busy = true;
    try {
      const hash = await files.uploadFile(file);
      await ark.attachFile(original, hash);
      await refresh(original, generation);
    } finally {
      busy = false;
      input.value = '';
    }
  }

  async function detach(hash: EntryHash) {
    const original = doc.original;
    const detached = attached.find((f) => f.hash === hash);
    await ark.detachFile(original, hash);
    // Drop its text from the index as well, or the file stays searchable under
    // a document that no longer has it — a hit reading "in attachment
    // budget.csv" pointing at an attachment that is gone.
    if (detached) onUnindexed(detached.name);
    await refresh(original, generation);
  }
</script>

<section>
  <h3>Attachments</h3>
  <ul>
    {#each attached as file (encodeHashToBase64(file.hash))}
      <li>
        <button onclick={async () => {
          const url = URL.createObjectURL(await files.downloadFile(file.hash));
          window.open(url);
          // The tab has the blob by now; holding the URL only leaks it.
          setTimeout(() => URL.revokeObjectURL(url), 60_000);
        }}>
          {file.name}
        </button>
        <span class="size">{Math.ceil(file.size / 1024)} KB</span>
        {#if !isIndexableText(file.name, file.type)}<span class="note">not searched</span>{/if}
        <button onclick={() => detach(file.hash)}>Remove</button>
      </li>
    {/each}
  </ul>
  <input type="file" onchange={upload} disabled={busy} />
</section>

<style>
  ul { list-style: none; padding: 0; }
  li { display: flex; gap: 0.5rem; align-items: baseline; }
  .size, .note { opacity: 0.6; font-size: 0.85em; }
</style>
