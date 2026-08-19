<script lang="ts">
  import type { SearchHit } from '../search/index';
  import type { DocumentSummary } from '../types';
  import { key } from '../stores/documents.svelte';

  let {
    hits,
    onSelect,
  }: { hits: SearchHit[]; onSelect: (doc: DocumentSummary) => void } = $props();

  /** Split snippet text into marked and unmarked runs. */
  function segments(hit: SearchHit) {
    const out: { text: string; marked: boolean }[] = [];
    let cursor = 0;
    for (const [start, end] of hit.snippet.marks) {
      if (start < cursor) continue;
      if (start > cursor) out.push({ text: hit.snippet.text.slice(cursor, start), marked: false });
      out.push({ text: hit.snippet.text.slice(start, end), marked: true });
      cursor = end;
    }
    if (cursor < hit.snippet.text.length)
      out.push({ text: hit.snippet.text.slice(cursor), marked: false });
    return out;
  }
</script>

<ul>
  {#each hits as hit (key(hit.doc.original))}
    <li>
      <button onclick={() => onSelect(hit.doc)}>
        <div class="head">
          <span class="title">{hit.doc.meta.title ?? '(untitled)'}</span>
          <span class="date">{hit.doc.meta.date ?? ''}</span>
        </div>
        {#if hit.field === 'attachment'}
          <div class="where">in attachment {hit.attachmentName}</div>
        {/if}
        <p class="snippet">
          {#each segments(hit) as segment}{#if segment.marked}<mark>{segment.text}</mark
            >{:else}{segment.text}{/if}{/each}
        </p>
      </button>
    </li>
  {/each}
</ul>

<style>
  ul { list-style: none; margin: 0; padding: 0; }
  button { display: block; width: 100%; text-align: left; background: none; border: none;
           border-bottom: 1px solid rgba(128,128,128,0.2); padding: 0.6rem; cursor: pointer; }
  .head { display: flex; justify-content: space-between; gap: 1rem; }
  .title { font-weight: 600; }
  .date { opacity: 0.6; font-variant-numeric: tabular-nums; }
  .where { font-size: 0.85em; opacity: 0.7; }
  .snippet { margin: 0.3rem 0 0; font-size: 0.9em; opacity: 0.85; }
</style>
