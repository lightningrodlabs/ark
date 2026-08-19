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
    onIndexed: (original: DocumentSummary['original'], name: string, text: string) => void;
    onUnindexed: (original: DocumentSummary['original'], name: string) => void;
  } = $props();

  let attached = $state<{ hash: EntryHash; name: string; type: string; size: number }[]>([]);
  let busy = $state(false);

  // Generation guard: switching documents quickly leaves an earlier refresh in
  // flight, and without this a late-resolving fetch could paint the wrong
  // document's attachment list, or attribute its text to the wrong document
  // in the search index. Claiming a generation is only half the guard —
  // `onIndexed`/`onUnindexed` also take `original` as an explicit argument
  // (pinned by the caller before any await) rather than reading `doc.original`
  // themselves, so even a callback that fires after the guard has let a stale
  // call through still cannot attribute text to whatever document happens to
  // be live by then.
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
        onIndexed(original, meta.name, decodeAttachment(new Uint8Array(await blob.arrayBuffer())));
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
    // Claim the generation and pin the document BEFORE any await — including
    // the upload itself. Claiming it later would leave a window where the
    // user has already switched documents (the $effect above has claimed a
    // newer generation and started its own refresh) but this call still holds
    // the old, now-stale generation number; claiming late both fails to guard
    // against that and cancels the newer refresh's own in-flight work.
    const mine = ++generation;
    const original = doc.original;
    busy = true;
    try {
      const hash = await files.uploadFile(file);
      await ark.attachFile(original, hash);
      await refresh(original, mine);
    } finally {
      busy = false;
      input.value = '';
    }
  }

  async function detach(hash: EntryHash) {
    if (busy) return;
    const mine = ++generation;
    const original = doc.original;
    busy = true;
    try {
      const detached = attached.find((f) => f.hash === hash);
      await ark.detachFile(original, hash);
      // Drop its text from the index as well, or the file stays searchable
      // under a document that no longer has it — a hit reading "in
      // attachment budget.csv" pointing at an attachment that is gone.
      // Pinned `original`, not `doc.original`: onUnindexed must forget the
      // text under the document this attachment was actually removed from,
      // even if the user has since switched to a different one.
      if (detached) onUnindexed(original, detached.name);
      await refresh(original, mine);
    } finally {
      busy = false;
    }
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
        <button onclick={() => detach(file.hash)} disabled={busy}>Remove</button>
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
