<script lang="ts">
  import type { SearchStore } from '../stores/search.svelte';

  let {
    search,
    resultCount,
    authors,
  }: {
    search: SearchStore;
    resultCount: number;
    /** Distinct authors across the archive, base64 key and display label. */
    authors: { key: string; label: string }[];
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
    <label>
      Author
      <select bind:value={search.author}>
        <option value={null}>Anyone</option>
        {#each authors as author (author.key)}
          <option value={author.key}>{author.label}</option>
        {/each}
      </select>
    </label>
    <label><input type="checkbox" bind:checked={search.includeTrashed} /> Include trashed</label>
  </div>
{/if}

<style>
  .bar { display: flex; gap: 0.5rem; align-items: center; padding: 0.5rem; }
  .bar input[type='search'] { flex: 1; }
  .count { opacity: 0.7; font-size: 0.9em; }
  .filters { display: flex; gap: 1rem; padding: 0 0.5rem 0.5rem; font-size: 0.9em; }
</style>
