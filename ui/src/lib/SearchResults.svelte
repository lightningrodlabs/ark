<script lang="ts">
  import type { SearchHit } from '../search/index';
  import { segments } from '../search/segments';
  import { mergeRanges, termRanges } from '../search/terms';
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

  /**
   * The title, with whatever this hit matched marked in it.
   *
   * A hit whose term is only in the title used to render with a body snippet
   * and no marks anywhere on the row — a result the app could not point at,
   * which is the same defect as the fuzzy hits that started this. Marked with
   * the hit's own terms, so the row, the snippet and the document the row
   * opens all agree.
   */
  function titleSegments(hit: SearchHit) {
    const text = hit.doc.meta.title ?? '(untitled)';
    return segments({ text, marks: mergeRanges(termRanges(text, hit.highlight)) });
  }

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
    <!-- Where the exact answers stop and the near ones begin. Visual only,
         and aria-hidden, because the row-level badge below is the marker a
         screen reader gets — a divider is unreachable once the list has been
         scrolled past it, and every near row has to be identifiable on its
         own wherever the user happens to be looking. -->
    {#if hit.near && (i === 0 || !hits[i - 1].near)}
      <li class="near-divider" role="presentation" aria-hidden="true">Near matches</li>
    {/if}
    <!-- The whole row is the target, snippet included: a title-only hit area
         makes the line people are actually reading unclickable. -->
    <li
      id={optionId(i)}
      role="option"
      aria-selected={i === activeIndex}
      class="result"
      class:active={i === activeIndex}
      class:near={hit.near}
      use:listen={{ click: () => onSelect(hit), mousemove: () => onHover(i) }}
    >
      <div class="head">
        <span class="title"
          >{#each titleSegments(hit) as segment}{#if segment.marked}<mark>{segment.text}</mark
            >{:else}{segment.text}{/if}{/each}</span
        >
        <!-- Not decoration. In `always` mode this row sits in the same list
             as the real answers, and a near match nobody can tell apart from
             an exact one is worse than no near match at all. Real text, so it
             is read out as well as seen. -->
        {#if hit.near}
          <span class="near-badge">Near match</span>
        {/if}
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
  .result.near {
    border-left: 3px solid rgba(200, 140, 40, 0.6);
  }
  .near-badge {
    flex: none;
    margin-left: auto;
    align-self: center;
    font-size: 0.75em;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0.05rem 0.35rem;
    border-radius: 3px;
    border: 1px solid rgba(200, 140, 40, 0.6);
    color: inherit;
    opacity: 0.85;
  }
  .near-divider {
    padding: 0.35rem 0.75rem;
    font-size: 0.8em;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    opacity: 0.7;
    background: rgba(200, 140, 40, 0.12);
    border-top: 1px solid rgba(200, 140, 40, 0.5);
    border-bottom: 1px solid rgba(200, 140, 40, 0.5);
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
  .title mark,
  .snippet mark {
    background: rgba(250, 220, 90, 0.5);
    color: inherit;
    padding: 0 0.1em;
    border-radius: 2px;
  }
</style>
