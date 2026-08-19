<script lang="ts">
  import type { AgentPubKey } from '@holochain/client';
  import type { SearchStore } from '../stores/search.svelte';
  import AgentAvatar from './AgentAvatar.svelte';

  let {
    search,
    resultCount,
    authors,
  }: {
    search: SearchStore;
    resultCount: number;
    /** Distinct authors across the archive: base64 key (for matching against
     * search.author) plus the raw agent key AgentAvatar needs to resolve a
     * profile avatar or fall back to an identicon. */
    authors: { key: string; hash: AgentPubKey }[];
  } = $props();
  let showFilters = $state(false);
</script>

<div class="bar">
  <input
    type="search"
    placeholder={'Search — "exact phrase", -exclude, OR'}
    bind:value={search.query}
  />
  <button onclick={() => (showFilters = !showFilters)}>Filters</button>
  <span class="count">{resultCount} result{resultCount === 1 ? '' : 's'}</span>
</div>

{#if showFilters}
  <div class="filters">
    <label>From <input type="date" bind:value={search.from} /></label>
    <label>To <input type="date" bind:value={search.to} /></label>
    <div class="author-filter" role="group" aria-label="Filter by author">
      <span class="filter-label">Author</span>
      <div class="author-toggles">
        <button
          type="button"
          class="anyone"
          class:selected={search.author === null}
          onclick={() => (search.author = null)}
        >
          Anyone
        </button>
        {#each authors as author (author.key)}
          <button
            type="button"
            class="author-toggle"
            class:selected={search.author === author.key}
            aria-pressed={search.author === author.key}
            aria-label="Filter by this author"
            onclick={() => (search.author = search.author === author.key ? null : author.key)}
          >
            <AgentAvatar agent={author.hash} size={22} />
          </button>
        {/each}
      </div>
    </div>
    <label><input type="checkbox" bind:checked={search.includeTrashed} /> Include trashed</label>
  </div>
{/if}

<style>
  .bar { display: flex; gap: 0.5rem; align-items: center; padding: 0.5rem; }
  .bar input[type='search'] { flex: 1; }
  .count { opacity: 0.7; font-size: 0.9em; }
  .filters { display: flex; gap: 1rem; align-items: flex-start; padding: 0 0.5rem 0.5rem; font-size: 0.9em; }
  .author-filter { display: flex; flex-direction: column; gap: 0.25rem; }
  .filter-label { opacity: 0.7; }
  .author-toggles {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    max-width: 16rem;
    max-height: 3.5rem;
    overflow-y: auto;
  }
  .author-toggles button, .anyone {
    background: none;
    border: 1px solid transparent;
    border-radius: 4px;
    padding: 0.15rem;
    cursor: pointer;
    line-height: 1;
  }
  .anyone { padding: 0.15rem 0.4rem; }
  .author-toggles button.selected, .anyone.selected {
    border-color: currentColor;
    background: rgba(128, 128, 128, 0.15);
  }
</style>
