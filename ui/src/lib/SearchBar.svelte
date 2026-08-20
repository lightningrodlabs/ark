<script lang="ts">
  import '../shoelace';
  import type { AgentPubKey } from '@holochain/client';
  import type { SearchStore } from '../stores/search.svelte';
  import type { NearMatch, SearchHit } from '../search/index';
  import type { Folder } from '../types';
  import { folderPathLabel } from '../tree/paths';
  import AgentAvatar from './AgentAvatar.svelte';
  import SearchResults from './SearchResults.svelte';

  let {
    search,
    hits,
    nearMatch,
    exactCount,
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
    /**
     * Set whenever any of these hits matched something other than what was
     * typed — the fallback firing on an empty search, or `always` appending
     * near matches to a full one. The panel then says so, naming the terms
     * that actually matched. Results the user did not ask for, presented as
     * if they were, is the bug this prop exists to make impossible.
     */
    nearMatch: NearMatch | null;
    /**
     * How many of `hits` matched the query itself. They are the first
     * `exactCount` rows; everything after is a near match. Kept as a count
     * rather than two lists because the list is one list — the user scrolls
     * through it once — but the two halves must never read as the same thing.
     */
    exactCount: number;
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
  let filtersButton: HTMLButtonElement | undefined = $state();
  let filtersPanel: HTMLElement | undefined = $state();
  let input: HTMLInputElement | undefined = $state();
  let bar: HTMLElement | undefined = $state();
  /** Set by Escape, and by opening a result. Cleared by editing the query. */
  let dismissed = $state(false);
  let activeIndex = $state(-1);

  const LIST_ID = 'ark-search-results';
  const FILTERS_ID = 'ark-search-filters';

  /**
   * Whether the filters are narrowing the search right now.
   *
   * A date, an author, or a near-match mode that is not the default: each one
   * changes which results the user sees, and the panel they live in is
   * collapsed most of the time. This app has already shipped one bug where an
   * invisible filter silently emptied the results, so the funnel fills in and
   * the button carries a marker whether or not the panel is open.
   *
   * "Not the default" rather than "narrows", because `always` is the one
   * setting here that WIDENS and still has to show: a session left in it
   * three days ago answers `jean` with `bean`, and the funnel is the only
   * place that can explain why. `never` narrows in the ordinary way.
   *
   * "Include trashed" is deliberately absent — it only ever widens the result
   * set by documents that are labelled as trashed on the row itself, so it
   * can neither hide something nor be mistaken for something else.
   */
  let filtersActive = $derived(
    !!search.from || !!search.to || !!search.author || search.nearMatches !== 'fallback',
  );

  function closeFilters(returnFocus: boolean) {
    showFilters = false;
    if (returnFocus) filtersButton?.focus();
  }

  // Escape closes the panel from inside it, and puts focus back on the button
  // that opened it — otherwise focus is orphaned on an element that no longer
  // exists. Bound imperatively rather than as `onkeydown` on the panel div:
  // the panel is a container, not a control, and a keyboard handler on a
  // static element is exactly what the a11y rules are right to complain
  // about. The controls inside it are the real ones.
  $effect(() => {
    const panel = filtersPanel;
    if (!panel) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      closeFilters(true);
    };
    panel.addEventListener('keydown', onKey);
    return () => panel.removeEventListener('keydown', onKey);
  });
  const optionId = (i: number) => `ark-search-option-${i}`;
  const NEAR_MODE_ID = 'ark-near-mode';

  /**
   * The count, said as two numbers whenever there are two kinds of hit.
   *
   * "270 results" for `jean` is what made half of them look like answers when
   * 135 of them were `bean`, `mean` and `sean`. Merging the two is the thing
   * that has to be impossible, so the exact count and the near count are
   * rendered from separate values and never added together.
   */
  let nearCount = $derived(hits.length - exactCount);
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  let countLine = $derived(
    nearCount > 0
      ? `${plural(exactCount, 'result', 'results')}, ${plural(nearCount, 'near match', 'near matches')}`
      : plural(hits.length, 'result', 'results'),
  );

  /**
   * How many result rows reach the DOM, and how that number grows.
   *
   * A one-word query over the reference archive matches nearly all of it —
   * "treasurer" returns 1396 of 1406 — so the list opens at one page rather
   * than rendering a row per hit for an answer nobody has looked at yet. It
   * was a hard cap, which made everything past the fiftieth hit unreachable:
   * the panel scrolls only over the rows it rendered, and the arrow keys
   * wrapped within them.
   *
   * `search.run()` already returns every hit in memory, so revealing more
   * costs DOM and nothing else — no fetch, no async, no spinner. The list
   * therefore grows on request, three ways that all land on `extend()`:
   * scrolling to the bottom of the panel, the button at the end of the list,
   * and arrowing past the last row. The count line says how many of the total
   * are showing, so a grown list is never mistaken for the whole answer.
   */
  const PAGE = 50;
  let shown = $state(PAGE);
  let visible = $derived(hits.slice(0, shown));
  let more = $derived(hits.length > visible.length);
  /** How many the next extension would add — the last one is usually short. */
  let nextPage = $derived(Math.min(PAGE, hits.length - visible.length));

  /**
   * The panel's own scroll container. The panel is height capped and scrolls
   * internally, so this element — not the window — is what "scrolled near the
   * bottom" is about.
   */
  let scroller: HTMLElement | undefined = $state();
  const NEAR_BOTTOM = 64;
  /**
   * The `scrollHeight` at which the last scroll-driven extension fired.
   *
   * A fling delivers a burst of scroll events, and every one of them reads
   * the same pre-extension `scrollHeight` because the DOM has not been
   * updated yet. Keying off that height makes all but the first a no-op, so
   * one gesture adds one page instead of running straight to 1396 rows.
   * Deliberately not a timer: the thing that makes another extension
   * legitimate is new content, not elapsed time.
   */
  let extendedAtHeight = -1;

  function extend() {
    shown += PAGE;
  }

  /**
   * Treat the current content height as already extended.
   *
   * Focusing an element the browser has to scroll to — which is exactly what
   * Tab onto the "show more" button does — produces a scroll event at the
   * bottom of the container, and without this the list would grow the instant
   * the keyboard reached the button and carry it out from under the focus
   * ring. The button is the deliberate action for that user; reaching it must
   * not pre-empt it.
   */
  function parkScrollTrigger() {
    if (scroller) extendedAtHeight = scroller.scrollHeight;
  }

  // Appending below never moves `scrollTop`, so the rows someone is reading
  // stay exactly where they were — growing a list under the cursor mid-read
  // would be worse than the cap ever was.
  function maybeExtend() {
    if (!scroller || !more) return;
    const { scrollHeight, scrollTop, clientHeight } = scroller;
    if (scrollHeight === extendedAtHeight) return;
    if (scrollHeight - scrollTop - clientHeight > NEAR_BOTTOM) return;
    extendedAtHeight = scrollHeight;
    extend();
  }

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

  /**
   * Reads every input that makes this a *different* search, so an effect that
   * calls it is subscribed to all of them. Two effects need exactly this set
   * and have to run on opposite sides of the DOM update, which is the only
   * reason it is a function rather than a list of statements.
   */
  function searchIdentity() {
    return [
      search.query,
      search.from,
      search.to,
      search.author,
      search.includeTrashed,
      search.nearMatches,
      search.folderScope?.id ?? null,
    ];
  }

  // Any change to the query, the filters or the folder scope is a fresh
  // search: re-open an overlay Escape closed, drop an active row that no
  // longer refers to the same result, and put the list back to one page — a
  // new search inheriting the previous one's grown length would render
  // hundreds of rows for a query the user has not even looked at yet.
  //
  // `$effect.pre` rather than `$effect`: it runs BEFORE the DOM is updated,
  // so the reset lands in the same flush as the new hits. A post-effect would
  // paint one frame of the old length against the new hit list first, which
  // is precisely the hundreds of rows this is here to avoid.
  $effect.pre(() => {
    searchIdentity();
    dismissed = false;
    activeIndex = -1;
    shown = PAGE;
    extendedAtHeight = -1;
  });

  // A new search starts at the top of its own results. Without this the
  // container keeps the scroll offset of the previous, longer list; the
  // browser clamps that offset against the shorter one, and the clamp arrives
  // as a scroll event sitting at the bottom — which extends the fresh list
  // straight back out to the length the reset just undid. Runs AFTER the DOM
  // update, unlike the reset above, because there is nothing to scroll until
  // the shorter list exists.
  $effect(() => {
    searchIdentity();
    if (scroller) scroller.scrollTop = 0;
  });

  function move(delta: number) {
    if (visible.length === 0) return;
    dismissed = false;
    const next = activeIndex + delta;
    if (next >= visible.length) {
      // Past the last rendered row. While hits remain, reveal the next page
      // rather than wrapping: the keyboard has to be able to reach the whole
      // hit list, not just the page the scroll wheel happens to have grown.
      if (more) {
        extend();
        activeIndex = next;
        return;
      }
      // Everything is shown, so wrap as before — what every command palette
      // does, and what makes ArrowUp from the input land on the last result.
      activeIndex = 0;
      return;
    }
    activeIndex = next < 0 ? visible.length - 1 : next;
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
         — set by clicking the offer, cleared by dismissing the chip.

         Both controls stay in the bar rather than folding into the Filters
         panel, and a long folder name is handled by truncating the pixels,
         never by hiding the control: a filter that narrows results with no
         visible sign is the exact bug the chip exists to prevent.

         Truncation is CSS only (`.scope-label` / `.scope-offer` below), so
         the whole path stays in the text content — which is what a screen
         reader reads, and what the dismiss button's own label repeats — and
         `title` puts it on hover for everyone else. -->
    {#if search.folderScope}
      <span class="scope-chip" title={`Search scoped to ${search.folderScope.label}`}>
        <span class="scope-label">in {search.folderScope.label}</span>
        <button
          type="button"
          class="scope-dismiss"
          aria-label={`Remove folder scope ${search.folderScope.label}`}
          onclick={clearScope}
        >
          ✕
        </button>
      </span>
    {:else if scopeOfferLabel}
      <button
        type="button"
        class="scope-offer"
        title={`Scope search to ${scopeOfferLabel}`}
        onclick={enableScope}
      >
        Scope to {scopeOfferLabel}
      </button>
    {/if}
    <!-- A real toggle, not a button whose only state is the panel below it
         ("you can't tell how to close the filters section"). It reports
         `aria-expanded`, closes on a second click, and fills its funnel while
         a filter is actually narrowing the results.

         `aria-controls` names the panel, which is only in the DOM while it is
         open — the ordinary disclosure pattern. Rendering it always and
         hiding it would put a second and third `input[type="date"]` in the
         document permanently, which is a real cost for a collapsed panel.

         The accessible name stays exactly "Filters": the state is carried by
         `aria-expanded` and `title`, not by appending words to the name. -->
    <button
      type="button"
      class="filters-toggle"
      class:open={showFilters}
      class:active={filtersActive}
      title={filtersActive ? 'Filters — some are active' : 'Filters'}
      aria-expanded={showFilters}
      aria-controls={FILTERS_ID}
      bind:this={filtersButton}
      onclick={() => (showFilters ? closeFilters(false) : (showFilters = true))}
    >
      <sl-icon name={filtersActive ? 'funnel-fill' : 'funnel'}></sl-icon>
      Filters
      {#if filtersActive}<span class="filter-dot" aria-hidden="true"></span>{/if}
    </button>
    <!-- "0 results" during the load would be a lie by omission — there is no
         result count yet, only a load. -->
    {#if loading}
      <span class="count">{loaded} of {total ?? '?'} loaded</span>
    {:else}
      <span class="count">{countLine}</span>
    {/if}
  </div>

  {#if showFilters}
    <div class="filters" id={FILTERS_ID} bind:this={filtersPanel}>
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
      <!-- Three choices, not a checkbox. The boolean could say "guess when
           you find nothing" and "never guess", but not the one the feature is
           really for: look for near matches even when there ARE exact ones,
           because the archive contains its own misspellings and no exact
           search can ever reach them.

           Worded without "fuzzy" or "edit distance" — the user should not
           have to know the word to pick the right option. The label is a
           separate element with `for`, rather than a wrapping <label>, so the
           accessible name of the select is exactly "Near matches" and not the
           label text plus every option in it. -->
      <div class="near-mode">
        <label class="filter-label" for={NEAR_MODE_ID}>Near matches</label>
        <select id={NEAR_MODE_ID} bind:value={search.nearMatches}>
          <option value="fallback">Only when nothing matches</option>
          <option value="always">Always</option>
          <option value="never">Never</option>
        </select>
      </div>
      <div class="switches">
        <label><input type="checkbox" bind:checked={search.includeTrashed} /> Include trashed</label>
      </div>
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
            <!-- Both numbers, always, and only while they differ: a grown
                 list must never be mistaken for the whole answer, and a list
                 that IS the whole answer must not imply there is more. -->
            <span class="panel-count">
              {#if more}
                showing {visible.length} of {hits.length} results{nearCount > 0
                  ? ` — ${nearCount} of them near matches`
                  : ''}
              {:else}
                {countLine}
              {/if}
            </span>
            <span class="panel-hint">↑↓ to move · Enter to open · Esc to close</span>
          </div>
          <!-- The scoped-zero-results fallback (item 3 of the search-scope
               fix): a scoped search finding nothing must say so and offer the
               way out, rather than looking exactly like "no matches anywhere",
               which is a milder form of the bug this whole feature exists to
               fix. -->
          <!-- Near matches never arrive unannounced. The rows below matched
               words the user did not type, so the panel names both: what was
               asked for, and what was found instead.

               Two sentences, not one, because the two modes mean different
               things. The fallback fired because there was nothing else to
               show. `always` fired because the user asked it to, on top of
               real answers, and the note has to say where those extra rows
               are rather than implying the real answers are missing. -->
          {#if nearMatch}
            <p class="near-match" data-testid="near-match">
              {#if exactCount === 0}
                No results for “{nearMatch.query.join(' ')}” — showing {plural(
                  nearCount,
                  'near match',
                  'near matches',
                )} for “{nearMatch.terms.join('”, “')}”.
              {:else}
                Also showing {plural(nearCount, 'near match', 'near matches')} for “{nearMatch.terms.join(
                  '”, “',
                )}”, listed after the {plural(exactCount, 'exact result', 'exact results')}.
              {/if}
            </p>
          {/if}
          {#if hits.length === 0 && unscopedFallbackCount > 0}
            <p class="scope-empty">
              No results in {search.folderScope?.label}. {unscopedFallbackCount} found in the whole
              archive.
              <button type="button" onclick={clearScope}>Search everywhere</button>
            </p>
          {/if}
          <!-- The scroll container the list grows inside. It wraps the list
               AND the button so the button travels with the end of the list
               rather than sitting pinned below it, and so `onscroll` observes
               the element that actually scrolls. -->
          <div class="panel-scroll" bind:this={scroller} onscroll={maybeExtend}>
            <SearchResults
              hits={visible}
              {activeIndex}
              listId={LIST_ID}
              {optionId}
              {locationOf}
              onSelect={choose}
              onHover={(i) => (activeIndex = i)}
            />
            <!-- Not optional, and deliberately outside the listbox rather
                 than a row inside it: scroll-triggered loading alone is
                 unreachable by keyboard and invisible to a screen reader,
                 and a <button> among role="option" children would be
                 unreachable a different way. A plain focusable button after
                 the list is both announced and tabbable. -->
            {#if more}
              <button
                type="button"
                class="show-more"
                aria-label={`Show ${nextPage} more results — ${hits.length - visible.length} of ${hits.length} not shown yet`}
                onfocus={parkScrollTrigger}
                onclick={extend}
              >
                Show {nextPage} more
              </button>
            {/if}
          </div>
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
    /* Wrapping and truncation are two different fixes for two different
       problems, and it takes both to keep the input usable: truncation
       handles a long folder name, wrapping handles a narrow screen. Without
       this the row could only compress its children, and the input — the one
       flexible item — absorbed every pixel the scope control took. */
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
    padding: 0.5rem;
  }
  .bar input[type='search'] {
    /* A floor nothing in the bar can push it under. `min-width: 0` let the
       scope chip squeeze it to a few characters; below about this width it
       stops being a search box at all, so the bar wraps instead. */
    flex: 1 1 10rem;
    min-width: 10rem;
    box-sizing: border-box;
    font: inherit;
    padding: 0.3rem 0.5rem;
  }
  .scope-offer,
  .scope-chip {
    flex: none;
    /* Visual truncation only — see the markup: the text content, and so the
       accessible name, still carries the whole folder path. */
    max-width: 14rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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
  /* The chip is a flex row, so the ellipsis has to go on the text itself —
     `overflow` on the chip alone would just clip the ✕ off the end. */
  .scope-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .scope-dismiss {
    /* Never the item that shrinks: the way out of a scope has to stay
       clickable at every width. */
    flex: none;
    background: none;
    border: none;
    padding: 0;
    line-height: 1;
    cursor: pointer;
    font: inherit;
  }
  .near-match {
    margin: 0;
    padding: 0.5rem 0.75rem;
    font-size: 0.85em;
    background: rgba(250, 220, 90, 0.18);
    border-bottom: 1px solid rgba(128, 128, 128, 0.25);
    flex: none;
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
  /* The one thing in the panel that scrolls — the list plus the "show more"
     button that ends it, so the button is reached by scrolling to the end of
     the results rather than sitting pinned below them. `min-height: 0` is
     what lets a flex item shrink below its content and actually scroll. */
  .panel-scroll {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
  }
  .show-more {
    display: block;
    width: 100%;
    box-sizing: border-box;
    padding: 0.6rem 0.75rem;
    font: inherit;
    font-size: 0.9em;
    text-align: center;
    background: none;
    color: inherit;
    border: none;
    border-top: 1px solid rgba(128, 128, 128, 0.25);
    cursor: pointer;
  }
  .show-more:hover,
  .show-more:focus-visible {
    background: rgba(120, 150, 220, 0.18);
  }
  .count {
    opacity: 0.7;
    font-size: 0.9em;
    white-space: nowrap;
  }
  .filters-toggle {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font: inherit;
    font-size: 0.9em;
    padding: 0.25rem 0.6rem;
    border: 1px solid rgba(128, 128, 128, 0.5);
    border-radius: 4px;
    background: none;
    color: inherit;
    cursor: pointer;
  }
  /* Pressed, not merely different: an inset shadow and a filled background,
     so the open state reads as "click me again to close" rather than as a
     colour someone chose. */
  .filters-toggle.open {
    background: rgba(120, 150, 220, 0.28);
    border-color: currentColor;
    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.25);
  }
  /* Redundant with the filled funnel on purpose — the funnel is a 16px
     silhouette and the difference between outline and filled is easy to miss
     at a glance. */
  .filter-dot {
    width: 0.4rem;
    height: 0.4rem;
    border-radius: 50%;
    background: currentColor;
  }
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    align-items: flex-start;
    padding: 0 0.5rem 0.5rem;
    font-size: 0.9em;
  }
  .near-mode {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .switches {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
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
