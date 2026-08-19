import type { DocumentStore } from './stores/documents.svelte';
import type { TreeStore } from './stores/tree.svelte';
import type { SearchStore } from './stores/search.svelte';

/**
 * `focus`  — the applet regained focus (inside Moss, merely switching panes).
 * `timer`  — the ordinary periodic tick.
 * `sweep`  — the occasional unconditional full pass; see below.
 */
export type ReconcileSource = 'focus' | 'timer' | 'sweep';

export interface ReconcileDeps {
  tree: TreeStore;
  store: DocumentStore;
  search: SearchStore;
}

/**
 * Reload the folder tree and page in the whole document corpus, rebuilding the
 * search index only if the corpus actually moved.
 *
 * Both stores now compare before they assign, so a reload over unchanged data
 * touches no reactive state and the view does not repaint. The index rebuild
 * is gated separately because it is the expensive half — ~630ms on the
 * 1406-document reference corpus — and because it replaces every SearchHit,
 * which repaints the results on its own even when the underlying data is
 * identical.
 *
 * Returns whether anything actually changed.
 */
async function reloadEverything({ tree, store, search }: ReconcileDeps): Promise<boolean> {
  const treeChanged = await tree.load();
  const docsChanged = await store.load(tree.folders);
  if (docsChanged) search.rebuild();
  return treeChanged || docsChanged;
}

/**
 * Runs a backstop reconcile, cheaply where it can.
 *
 * `focus` and `timer` both check `store.changedSince()` first — two small
 * calls (a limit-0 count and the trash hashes) instead of paging the whole
 * corpus. That check is exact for creates, trashes and restores: it compares
 * the document total against the last recorded total, and trash *membership*
 * rather than merely its size.
 *
 * The one change it cannot see is an amendment, which creates no link on the
 * AllDocuments anchor and touches no trash link. `sweep` is the answer to
 * that: an unconditional full reload on a longer cadence (see
 * `FULL_SWEEP_EVERY` in signals.svelte.ts), which re-reads every document and
 * compares `latest` action hashes.
 *
 * The five-minute tick used to be the unconditional one, which is why the
 * whole view repainted every five minutes. The guarantee is unchanged — drift
 * still gets corrected on a bounded schedule — but the common case is now a
 * skipped fetch, and the uncommon case is a reload that assigns nothing.
 *
 * Returns whether anything actually changed, mainly so tests can assert on it.
 */
export async function reconcile(source: ReconcileSource, deps: ReconcileDeps): Promise<boolean> {
  if (source !== 'sweep') {
    const changed = await deps.store.changedSince();
    if (!changed) return false;
  }
  return reloadEverything(deps);
}
