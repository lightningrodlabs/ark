<script lang="ts">
  import type { SearchHit } from '../search/index';
  import { segments } from '../search/segments';
  import { key } from '../stores/documents.svelte';
  import { listen } from './listen';

  let {
    hits,
    activeIndex,
    listId,
    optionId,
    locationOf,
    onSelect,
    onHover,
  }: {
    hits: SearchHit[];
    /** Index of the keyboard-active row; -1 when the pointer is in charge. */
    activeIndex: number;
    listId: string;
    optionId: (index: number) => string;
    /** "Board Minutes / 2026" for the folder the document is filed in. */
    locationOf: (hit: SearchHit) => string;
    onSelect: (hit: SearchHit) => void;
    onHover: (index: number) => void;
  } = $props();

  let list: HTMLElement | undefined = $state();

  // Keep the keyboard-active row in view without moving focus, which stays in
  // the input for the whole interaction. `nearest` rather than `center` so
  // arrowing down one row scrolls by one row instead of recentring the list.
  $effect(() => {
    if (activeIndex < 0 || !list) return;
    const row = list.querySelector(`#${CSS.escape(optionId(activeIndex))}`);
    row?.scrollIntoView({ block: 'nearest' });
  });
</script>

<ul bind:this={list} id={listId} role="listbox" aria-label="Search results" class="results">
  {#each hits as hit, i (key(hit.doc.original) + (hit.attachmentName ?? ''))}
    <!-- The whole row is the target, snippet included: a title-only hit area
         makes the line people are actually reading unclickable. -->
    <li
      id={optionId(i)}
      role="option"
      aria-selected={i === activeIndex}
      class="result"
      class:active={i === activeIndex}
      use:listen={{ click: () => onSelect(hit), mousemove: () => onHover(i) }}
    >
      <div class="head">
        <span class="title">{hit.doc.meta.title ?? '(untitled)'}</span>
        <span class="date">{hit.doc.meta.date ?? ''}</span>
      </div>
      <div class="where">
        <span class="path">{locationOf(hit)}</span>
        {#if hit.field === 'attachment'}
          <span class="attachment">in attachment {hit.attachmentName}</span>
        {/if}
      </div>
      <p class="snippet">
        {#each segments(hit.snippet) as segment}{#if segment.marked}<mark>{segment.text}</mark
          >{:else}{segment.text}{/if}{/each}
      </p>
    </li>
  {/each}
</ul>

<style>
  .results {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .result {
    display: block;
    width: 100%;
    text-align: left;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid rgba(128, 128, 128, 0.2);
    cursor: pointer;
  }
  .result:last-child {
    border-bottom: none;
  }
  .result.active {
    background: rgba(120, 150, 220, 0.18);
  }
  .head {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
  }
  .title {
    font-weight: 600;
  }
  .date {
    opacity: 0.6;
    font-variant-numeric: tabular-nums;
    flex: none;
  }
  .where {
    display: flex;
    gap: 0.5rem;
    font-size: 0.85em;
    opacity: 0.7;
  }
  .attachment::before {
    content: '·';
    margin-right: 0.4rem;
  }
  .snippet {
    margin: 0.25rem 0 0;
    font-size: 0.9em;
    opacity: 0.85;
  }
  .snippet mark {
    background: rgba(250, 220, 90, 0.5);
    color: inherit;
    padding: 0 0.1em;
    border-radius: 2px;
  }
</style>
