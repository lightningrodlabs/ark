<script lang="ts">
  import type { ActionHash } from '@holochain/client';
  import type { ArkClient } from '../ark-client';
  import type { SignalStore } from '../stores/signals.svelte';
  import type { DocumentSummary, Meta } from '../types';
  import { htmlToMarkdown } from '../paste/gdocs';
  import { renderMarkdown } from '../render';

  let {
    ark,
    signals,
    mode,
    doc,
    folderId,
    onDone,
    onCancel,
  }: {
    ark: ArkClient;
    signals: SignalStore;
    mode: 'create' | 'amend';
    doc?: DocumentSummary;
    folderId: string | null;
    onDone: (original: ActionHash) => void;
    onCancel: () => void;
  } = $props();

  // Captured once at open: the editor seeds local edit state from the
  // document being amended, then owns it — it must not react to later
  // changes to the `doc` prop while the author is mid-edit.
  const initial = (() => doc)();
  let title = $state(initial?.meta.title ?? '');
  let date = $state(initial?.meta.date ?? new Date().toISOString().slice(0, 10));
  let body = $state(initial?.body ?? '');
  let saving = $state(false);
  let error = $state<string | undefined>(undefined);
  let preview = $derived(renderMarkdown(body));

  /**
   * Convert an HTML paste to markdown before it lands in the textarea, so the
   * author sees and can correct exactly what will be committed.
   */
  function onPaste(event: ClipboardEvent) {
    const html = event.clipboardData?.getData('text/html');
    if (!html) return; // plain text and markdown pass through untouched
    event.preventDefault();
    const markdown = htmlToMarkdown(html);
    const target = event.target as HTMLTextAreaElement;
    const start = target.selectionStart;
    const end = target.selectionEnd;
    body = body.slice(0, start) + markdown + body.slice(end);
  }

  async function save() {
    saving = true;
    error = undefined;
    try {
      const meta: Meta = { ...(doc?.meta ?? {}), title, date };
      if (mode === 'create') {
        const original = await ark.createDocument({ body, meta, folder_id: folderId });
        await signals.broadcast({ type: 'DocumentCreated', original });
        onDone(original);
      } else {
        const new_version = await ark.amendDocument({ original: doc!.original, body, meta });
        await signals.broadcast({ type: 'DocumentAmended', original: doc!.original, new_version });
        onDone(doc!.original);
      }
    } catch (e) {
      // Never lose someone's text to a silent rejection. The editor stays open
      // with the body intact so they can retry or copy it out.
      error = `Could not save: ${e}`;
    } finally {
      saving = false;
    }
  }
</script>

<div class="editor">
  <div class="fields">
    <input placeholder="Title" bind:value={title} />
    <input type="date" bind:value={date} />
  </div>
  <div class="panes">
    <textarea bind:value={body} onpaste={onPaste} placeholder="Paste from Google Docs, or write markdown"></textarea>
    <div class="preview">{@html preview}</div>
  </div>
  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}
  <div class="actions">
    <button onclick={save} disabled={saving || !title}>
      {mode === 'create' ? 'Add document' : 'Save amendment'}
    </button>
    <button onclick={onCancel}>Cancel</button>
  </div>
</div>

<style>
  .editor { display: flex; flex-direction: column; gap: 0.5rem; padding: 1rem; height: 100%; }
  .fields { display: flex; gap: 0.5rem; }
  .fields input:first-child { flex: 1; }
  .panes { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; flex: 1; min-height: 20rem; }
  textarea { width: 100%; height: 100%; font-family: ui-monospace, monospace; }
  .preview { overflow: auto; border: 1px solid rgba(128, 128, 128, 0.3); padding: 0.5rem; }
  .error { color: #b00020; margin: 0; }
</style>
