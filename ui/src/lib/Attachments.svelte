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
  }: {
    ark: ArkClient;
    files: FileStorageClient;
    doc: DocumentSummary;
    onIndexed: (name: string, text: string) => void;
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
    busy = true;
    try {
      const hash = await files.uploadFile(file);
      await ark.attachFile(doc.original, hash);
      await refresh(doc.original, generation);
    } finally {
      busy = false;
      input.value = '';
    }
  }

  async function detach(hash: EntryHash) {
    await ark.detachFile(doc.original, hash);
    await refresh(doc.original, generation);
  }
</script>

<section>
  <h3>Attachments</h3>
  <ul>
    {#each attached as file (encodeHashToBase64(file.hash))}
      <li>
        <button onclick={async () => window.open(URL.createObjectURL(await files.downloadFile(file.hash)))}>
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
