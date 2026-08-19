<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import type { EntryHash } from '@holochain/client';
  import { encodeHashToBase64 } from '@holochain/client';
  import type { FileStorageClient } from '@holochain-open-dev/file-storage';
  import type { ArkClient } from '../ark-client';
  import type { DocumentSummary } from '../types';
  import { decodeAttachment, isIndexableText } from '../attachments/text';
  import { previewMode, type PreviewMode } from '../attachments/preview';

  let {
    ark,
    files,
    doc,
    onIndexed,
    onUnindexed,
    readOnly = false,
  }: {
    ark: ArkClient;
    files: FileStorageClient;
    doc: DocumentSummary;
    // Optional: the asset view has no search store to feed, and must not
    // build one just to satisfy this prop (see `readOnly` below). Every
    // other caller passes both.
    onIndexed?: (original: DocumentSummary['original'], name: string, text: string) => void;
    onUnindexed?: (original: DocumentSummary['original'], name: string) => void;
    // The asset view is a read-only window onto a document: no upload input,
    // no Remove button, and the section itself disappears when there is
    // nothing to show (the main document view always shows it, empty or
    // not, because it is where attachments get added).
    readOnly?: boolean;
  } = $props();

  let attached = $state<{ hash: EntryHash; name: string; type: string; size: number }[]>([]);
  let busy = $state(false);

  // Inline preview state — a toggle, not a permanent expansion: at most one
  // attachment's preview is open at a time, keyed by its base64 hash.
  let previewKey = $state<string | null>(null);
  let previewKind = $state<PreviewMode | null>(null);
  let previewText = $state<string | null>(null);
  let previewUrl = $state<string | null>(null);
  let previewGeneration = 0;

  function closePreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewKey = null;
    previewKind = null;
    previewText = null;
    previewUrl = null;
  }

  onDestroy(closePreview);

  async function togglePreview(file: { hash: EntryHash; name: string; type: string }) {
    const k = encodeHashToBase64(file.hash);
    if (previewKey === k) {
      closePreview();
      return;
    }
    // Claim a generation before the await so a second click (on this file or
    // another) while the download is in flight leaves this call's result
    // discarded rather than clobbering whatever the newer click set up.
    const mine = ++previewGeneration;
    const mode = previewMode(file.name, file.type);
    const blob = await files.downloadFile(file.hash);
    if (mine !== previewGeneration) return;
    closePreview();
    if (mode === 'text') {
      previewText = decodeAttachment(new Uint8Array(await blob.arrayBuffer()));
      if (mine !== previewGeneration) return;
    } else if (mode === 'image') {
      previewUrl = URL.createObjectURL(blob);
    }
    previewKind = mode;
    previewKey = k;
  }

  // Programmatic <a download> click, not window.open — Moss denies every
  // window.open call that isn't http(s):// or a weave deep link (see
  // docs/dev/fix-brief-template.md), which is why the old button did nothing.
  async function download(file: { hash: EntryHash; name: string }) {
    const blob = await files.downloadFile(file.hash);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke once the click has handed the URL to the browser's download
    // machinery rather than mid-click, which can cut a save off before it
    // starts in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

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
      // Read-only callers (the asset view) have nowhere to put indexed text
      // and only ever show one document — downloading every attachment's
      // bytes here just to hand them to a no-op callback would be pure
      // waste, so skip the fetch entirely rather than merely no-op the call.
      if (!readOnly && isIndexableText(meta.name, meta.file_type)) {
        const blob = await files.downloadFile(hash);
        if (mine !== generation) return;
        onIndexed?.(original, meta.name, decodeAttachment(new Uint8Array(await blob.arrayBuffer())));
      }
    }
    if (mine === generation) attached = listed;
  }

  $effect(() => {
    // `doc.original` is the ONLY thing this effect may depend on. Everything
    // below runs untracked because `closePreview()` reads `previewUrl`, and a
    // tracked read there makes the effect re-run whenever a preview opens —
    // which revokes the object URL microseconds after `togglePreview` created
    // it, leaving <img> pointing at a dead blob (ERR_FILE_NOT_FOUND). Text
    // previews survived that because they hold no URL; images did not.
    const original = doc.original;
    untrack(() => {
      const mine = ++generation;
      // A preview open for the previous document's attachment makes no sense
      // once that document is no longer showing.
      closePreview();
      refresh(original, mine);
    });
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
      if (previewKey === encodeHashToBase64(hash)) closePreview();
      await ark.detachFile(original, hash);
      // Drop its text from the index as well, or the file stays searchable
      // under a document that no longer has it — a hit reading "in
      // attachment budget.csv" pointing at an attachment that is gone.
      // Pinned `original`, not `doc.original`: onUnindexed must forget the
      // text under the document this attachment was actually removed from,
      // even if the user has since switched to a different one.
      if (detached) onUnindexed?.(original, detached.name);
      await refresh(original, mine);
    } finally {
      busy = false;
    }
  }
</script>

{#if !readOnly || attached.length > 0}
  <section>
    <h3>Attachments</h3>
    <ul>
      {#each attached as file (encodeHashToBase64(file.hash))}
        {@const key = encodeHashToBase64(file.hash)}
        {@const mode = previewMode(file.name, file.type)}
        <li>
          <div class="row">
            <span class="name">{file.name}</span>
            <span class="size">{Math.ceil(file.size / 1024)} KB</span>
            {#if !readOnly && !isIndexableText(file.name, file.type)}<span class="note">not searched</span>{/if}
            {#if mode !== 'none'}
              <button onclick={() => togglePreview(file)}>
                {previewKey === key ? 'Hide preview' : 'Preview'}
              </button>
            {:else}
              <span class="note">cannot be previewed</span>
            {/if}
            <button onclick={() => download(file)}>Download</button>
            {#if !readOnly}
              <button onclick={() => detach(file.hash)} disabled={busy}>Remove</button>
            {/if}
          </div>
          {#if previewKey === key}
            <div class="preview">
              {#if previewKind === 'text'}
                <pre>{previewText}</pre>
              {:else if previewKind === 'image'}
                <img src={previewUrl} alt={file.name} />
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
    {#if !readOnly}
      <input type="file" onchange={upload} disabled={busy} />
    {/if}
  </section>
{/if}

<style>
  ul { list-style: none; padding: 0; }
  li { display: flex; flex-direction: column; gap: 0.25rem; }
  .row { display: flex; gap: 0.5rem; align-items: baseline; }
  .size, .note { opacity: 0.6; font-size: 0.85em; }
  .preview { max-width: 100%; }
  .preview pre { max-height: 16rem; overflow: auto; background: rgba(128, 128, 128, 0.1); padding: 0.5rem; }
  .preview img { max-width: 100%; max-height: 20rem; }
</style>
