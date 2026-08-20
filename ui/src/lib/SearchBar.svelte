<script lang="ts">
  import '../shoelace';
  import type { AgentPubKey } from '@holochain/client';
  import type { SearchStore } from '../stores/search.svelte';
  import type { SearchHit } from '../search/index';
  import type { Folder } from '../types';
  import { folderPathLabel } from '../tree/paths';
  import AgentAvatar from './AgentAvatar.svelte';
  import SearchResults from './SearchResults.svelte';

  let {
    search,
    hits,
    searching,
    loading = false,
    loaded = 0,
    total = null,
    locationOf,
    authors,
    selectedFolder,
    folders,
    onSelect,
  }: {
    search: SearchStore;
    hits: SearchHit[];
    /** Whether a query or filter is in play at all. */
    searching: boolean;
    /**
     * Whether the corpus is still being paged in. Search covers the WHOLE
     * archive or it says nothing: an index over the documents that happen to
     * have arrived returns a confident answer about a fraction of the archive
     * with no sign that it did, and there is no honest way to render that.
     * So while this is true the bar answers with its progress instead.
     */
    loading?: boolean;
    /** Documents in memory so far, and how many there will be, for that line. */
    loaded?: number;
    total?: number | null;
    locationOf: (hit: SearchHit) => string;
    /** Distinct authors across the archive: base64 key (for matching against
     * search.author) plus the raw agent key AgentAvatar needs to resolve a
     * profile avatar or fall back to an identicon. */
    authors: { key: string; hash: AgentPubKey }[];
    /** The folder currently selected in the tree, if any. This is only ever
     * the *candidate* for a scope offer below — it is never applied to a
     * search on its own. Search scope comes exclusively from
     * `search.folderScope`, set only when the user clicks the offer. */
    selectedFolder: string | null;
    folders: Folder[];
    onSelect: (hit: SearchHit) => void;
  } = $props();

  // The folder scope offer: shown only while a folder is selected in the tree
  // AND no scope is active yet. Once the user turns it on, the scope latches
  // to that folder id/label and no longer tracks further tree navigation —
  // it changes only when the user dismisses the chip. This is what makes
  // scoping visible and opt-in rather than an invisible side effect of
  // clicking around the tree (see docs/dev — the reported bug).
  let scopeOfferLabel = $derived(selectedFolder ? folderPathLabel(folders, selectedFolder) : null);

  function enableScope() {
    if (!selectedFolder) return;
    search.folderScope = { id: selectedFolder, label: scopeOfferLabel ?? selectedFolder };
  }

  function clearScope() {
    search.folderScope = null;
  }

  // A scoped search that comes up empty must say so and offer the way out,
  // rather than going quiet the same way the unscoped bug did. Only computed
  // when it can matter: a scope is active and the current hits are empty.
  let unscopedFallbackCount = $derived(
    search.folderScope && searching && hits.length === 0 ? search.unscopedCount(folders) : 0,
  );

  let showFilters = $state(false);
  let input: HTMLInputElement | undefined = $state();
  let bar: HTMLElement | undefined = $state();
  /** Set by Escape, and by opening a result. Cleared by editing the query. */
  let dismissed = $state(false);
  let activeIndex = $state(-1);

  const LIST_ID = 'ark-search-results';
  const optionId = (i: number) => `ark-search-option-${i}`;

  /**
   * How many result rows reach the DOM.
   *
   * A one-word query over the reference archive matches nearly all of it —
   * "treasurer" returns 1396 of 1406 — and rendering a row each cost about
   * 400ms to build a list nobody scrolls to the end of. The panel is height
   * capped and scrolls internally, so rows past the cap were never going to
   * be read; the honest thing is to render the best ones and say how many
   * there are in total. Same convention as DocSearch and VS Code's search.
   */
  const MAX_ROWS = 50;
  let visible = $derived(hits.slice(0, MAX_ROWS));
  let capped = $derived(hits.length > visible.length);

  // An empty query with no filters is not a search — nothing to float over the
  // tree. `searching` is the app's own definition of that, reused rather than
  // re-derived so the overlay and the result count can never disagree. A
  // scoped search with zero hits still opens when the same query would find
  // something outside the scope — the fallback prompt below is the whole
  // point, and it must be visible, not hidden behind an empty-looking bar.
  // `loading` opens it too: a query typed during the initial load must get an
  // explicit "not yet, N of M" rather than an empty bar, which reads exactly
  // like "nothing in this archive matches".
  let open = $derived(
    searching && !dismissed && (loading || hits.length > 0 || unscopedFallbackCount > 0),
  );

  // Any change to the query or filters is a fresh search: re-open an overlay
  // Escape closed, and drop an active row that no longer refers to the same
  // result. Reading these three keeps the effect subscribed to them.
  $effect(() => {
    search.query;
    search.from;
    search.to;
    search.author;
    search.includeTrashed;
    dismissed = false;
    activeIndex = -1;
  });

  function move(delta: number) {
    if (visible.length === 0) return;
    dismissed = false;
    const next = activeIndex + delta;
    // Wrap at both ends, so ArrowUp from the input goes straight to the last
    // result the way every command palette does.
    activeIndex = next < 0 ? visible.length - 1 : next >= visible.length ? 0 : next;
  }

  function choose(hit: SearchHit) {
    onSelect(hit);
    dismissed = true;
    activeIndex = -1;
  }

  // Every one of these keys is handled without moving focus: the input keeps
  // it for the whole interaction, and the active row is announced through
  // aria-activedescendant instead. Losing focus to the list would mean the
  // next keystroke no longer edits the query, which is the single most
  // common thing to want next.
  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'Enter') {
      if (activeIndex >= 0 && visible[activeIndex]) {
        event.preventDefault();
        choose(visible[activeIndex]);
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      dismissed = true;
      activeIndex = -1;
    }
  }

  // Dismiss on an outside click — but deliberately NOT on scroll. sl-popup
  // repositions itself while scrolling, and closing instead would snatch the
  // results away the moment someone scrolls the list they are reading.
  $effect(() => {
    if (!open) return;
    const onDocumentPointerDown = (event: MouseEvent) => {
      if (bar && !bar.contains(event.target as Node)) {
        dismissed = true;
        activeIndex = -1;
      }
    };
    document.addEventListener('mousedown', onDocumentPointerDown, true);
    return () => document.removeEventListener('mousedown', onDocumentPointerDown, true);
  });
</script>

<!-- The popup anchors to this whole block — bar AND the filters row — not to
     the input alone. Anchored to the input, the overlay dropped straight over
     the filter controls the moment a query returned anything, so the author
     and date filters could not be reached while results were showing. -->
<div class="search" bind:this={bar}>
  <div class="bar">
    <input
      bind:this={input}
      type="search"
      placeholder={'Search — "exact phrase", -exclude, OR'}
      bind:value={search.query}
      onkeydown={onKeydown}
      onfocus={() => (dismissed = false)}
      role="combobox"
      aria-expanded={open}
      aria-controls={LIST_ID}
      aria-autocomplete="list"
      aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
      autocomplete="off"
    />
    <!-- Folder scope: an explicit, visible opt-in rather than anything
         inherited from the tree. `search.folderScope` only ever changes here
         — set by clicking the offer, cleared by dismissing the chip. -->
    {#if search.folderScope}
      <span class="scope-chip">
        in {search.folderScope.label}
        <button
          type="button"
          class="scope-dismiss"
          aria-label="Remove folder scope"
          onclick={clearScope}
        >
          ✕
        </button>
      </span>
    {:else if scopeOfferLabel}
      <button type="button" class="scope-offer" onclick={enableScope}>
        Scope to {scopeOfferLabel}
      </button>
    {/if}
    <button class="filters-toggle" onclick={() => (showFilters = !showFilters)}>Filters</button>
    <!-- "0 results" during the load would be a lie by omission — there is no
         result count yet, only a load. -->
    {#if loading}
      <span class="count">{loaded} of {total ?? '?'} loaded</span>
    {:else}
      <span class="count">{hits.length} result{hits.length === 1 ? '' : 's'}</span>
    {/if}
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

  <!-- sync="width" makes the overlay exactly as wide as the search block, so
       the KWIC snippets get the full width of the bar to be readable in.
       auto-size="vertical" caps it against the viewport; the panel's own
       max-height caps it against a very tall screen, and the list scrolls
       inside itself either way. -->
  <sl-popup
    class="search-popup"
    anchor={bar}
    placement="bottom-start"
    active={open}
    sync="width"
    auto-size="vertical"
    auto-size-padding="12"
    flip
    shift
    distance="2"
  >
    {#if open}
      <div class="panel">
        {#if loading}
          <!-- Deliberately the whole panel, not a note above a result list:
               there IS no result list worth showing. Searching a partial
               corpus silently is the one outcome this refuses, so the query
               simply waits, and re-runs on its own once the load finishes. -->
          <p class="search-loading" data-testid="search-loading">
            Still loading the archive — {loaded} of {total ?? '?'} documents. Search covers the
            whole archive, so it runs as soon as the load finishes.
          </p>
        {:else}
          <div class="panel-head">
            <span class="panel-count">
              {hits.length} result{hits.length === 1 ? '' : 's'}{capped
                ? `, showing the first ${visible.length}`
                : ''}
            </span>
            <span class="panel-hint">↑↓ to move · Enter to open · Esc to close</span>
          </div>
          <!-- The scoped-zero-results fallback (item 3 of the search-scope
               fix): a scoped search finding nothing must say so and offer the
               way out, rather than looking exactly like "no matches anywhere",
               which is a milder form of the bug this whole feature exists to
               fix. -->
          {#if hits.length === 0 && unscopedFallbackCount > 0}
            <p class="scope-empty">
              No results in {search.folderScope?.label}. {unscopedFallbackCount} found in the whole
              archive.
              <button type="button" onclick={clearScope}>Search everywhere</button>
            </p>
          {/if}
          <SearchResults
            hits={visible}
            {activeIndex}
            listId={LIST_ID}
            {optionId}
            {locationOf}
            onSelect={choose}
            onHover={(i) => (activeIndex = i)}
          />
        {/if}
      </div>
    {/if}
  </sl-popup>
</div>

<style>
  .search {
    position: relative;
    z-index: 1;
  }
  .bar {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    padding: 0.5rem;
  }
  .bar input[type='search'] {
    flex: 1;
    min-width: 0;
    box-sizing: border-box;
    font: inherit;
    padding: 0.3rem 0.5rem;
  }
  .scope-offer,
  .scope-chip {
    flex: none;
    white-space: nowrap;
    font-size: 0.85em;
    border-radius: 999px;
    padding: 0.2rem 0.6rem;
  }
  .scope-offer {
    background: none;
    border: 1px dashed rgba(128, 128, 128, 0.6);
    cursor: pointer;
  }
  .scope-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    border: 1px solid currentColor;
    background: rgba(120, 150, 220, 0.15);
  }
  .scope-dismiss {
    background: none;
    border: none;
    padding: 0;
    line-height: 1;
    cursor: pointer;
    font: inherit;
  }
  .scope-empty {
    margin: 0;
    padding: 0.5rem 0.75rem;
    font-size: 0.85em;
    border-bottom: 1px solid rgba(128, 128, 128, 0.25);
    flex: none;
  }
  .scope-empty button {
    margin-left: 0.35rem;
  }
  .search-loading {
    margin: 0;
    padding: 0.6rem 0.75rem;
    font-size: 0.9em;
    opacity: 0.8;
  }
  .panel {
    display: flex;
    flex-direction: column;
    /* auto-size caps this against the viewport; the panel's own max-height
       caps it against a very tall screen, and the list scrolls inside itself
       either way. */
    max-height: min(60vh, 28rem);
    overflow: hidden;
    /*
     * `position` is load-bearing, not cosmetic: `z-index` applies only to a
     * POSITIONED element, so on the `position: static` this rule used to have,
     * the `z-index: 10` below was inert and the panel painted in ordinary
     * document order — which is what let tree rows show through and over the
     * results.
     */
    position: relative;
    z-index: 10;
    /*
     * Explicitly opaque on both branches. The previous fallback was `Canvas`,
     * a SYSTEM colour whose value follows `color-scheme` and is not reliably
     * the opaque white it looks like inside a Moss iframe. The token resolves
     * to white from Shoelace's light theme, and `#fff` covers the case where
     * the theme is somehow not in scope; neither can come out transparent.
     * The panel must not inherit its opacity from whatever happens to be
     * behind it.
     */
    background-color: var(--sl-color-neutral-0, #fff);
    color: var(--sl-color-neutral-900, #18181b);
    border: 1px solid rgba(128, 128, 128, 0.35);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  }
  .panel-head {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.35rem 0.75rem;
    font-size: 0.8em;
    opacity: 0.7;
    border-bottom: 1px solid rgba(128, 128, 128, 0.25);
    flex: none;
  }
  .panel :global(.results) {
    overflow-y: auto;
  }
  .count {
    opacity: 0.7;
    font-size: 0.9em;
    white-space: nowrap;
  }
  .filters {
    display: flex;
    gap: 1rem;
    align-items: flex-start;
    padding: 0 0.5rem 0.5rem;
    font-size: 0.9em;
  }
  .author-filter {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .filter-label {
    opacity: 0.7;
  }
  .author-toggles {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    max-width: 16rem;
    max-height: 3.5rem;
    overflow-y: auto;
  }
  .author-toggles button,
  .anyone {
    background: none;
    border: 1px solid transparent;
    border-radius: 4px;
    padding: 0.15rem;
    cursor: pointer;
    line-height: 1;
  }
  .anyone {
    padding: 0.15rem 0.4rem;
  }
  .author-toggles button.selected,
  .anyone.selected {
    border-color: currentColor;
    background: rgba(128, 128, 128, 0.15);
  }
</style>
