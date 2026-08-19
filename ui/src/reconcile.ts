import type { DocumentStore } from './stores/documents.svelte';
import type { TreeStore } from './stores/tree.svelte';
import type { SearchStore } from './stores/search.svelte';

export type ReconcileSource = 'focus' | 'timer';

export interface ReconcileDeps {
  tree: TreeStore;
  store: DocumentStore;
  search: SearchStore;
}

/**
 * Full reconcile: reload the folder tree, page in the whole document corpus,
 * and rebuild the search index. Seconds of work on a 1406-document archive —
 * see the "changed" and "focus" callers below for why this only runs when it
 * has to.
 */
async function reloadEverything({ tree, store, search }: ReconcileDeps): Promise<void> {
  await tree.load();
  await store.load(tree.folders);
  search.rebuild();
}

/**
 * Runs a backstop reconcile, cheaply where it can.
 *
 * `focus` fires every time the applet regains focus — inside Moss that
 * includes just switching panes — so it checks `store.changedSince()` first
 * (two small calls) and returns without touching the tree, the document
 * store, or the search index when nothing moved.
 *
 * `timer` fires every `RECONCILE_INTERVAL_MS` regardless of focus and always
 * does the full reload, unconditionally. `changedSince()` compares two
 * counters (document total, trash count) and cannot see a change that nets
 * to no delta in either — e.g. one document trashed and a different one
 * restored in the same window. The timer path is what guarantees that kind
 * of drift still gets corrected, on a five-minute bound, even though the
 * focus path might keep skipping it.
 *
 * Returns whether a full reload happened, mainly so tests can assert on it.
 */
export async function reconcile(source: ReconcileSource, deps: ReconcileDeps): Promise<boolean> {
  if (source === 'focus') {
    const changed = await deps.store.changedSince();
    if (!changed) return false;
  }
  await reloadEverything(deps);
  return true;
}
