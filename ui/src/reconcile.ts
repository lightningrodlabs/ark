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
 * Fetches only what changed — the hash list, then just the missing documents
 * — instead of re-paging the whole corpus. Used by `focus` and `timer` once
 * `changedSince()` says something moved.
 *
 * A hash list cannot reveal an amendment (the original action hash is
 * unchanged; only `latest` moves), so this still misses that case exactly as
 * `changedSince()` does — `sweep`'s unconditional full reload is what catches
 * it, on a bounded cadence.
 */
async function syncMissing({ tree, store, search }: ReconcileDeps): Promise<boolean> {
  const treeChanged = await tree.load();
  const result = await store.syncMissing(tree.folders);
  if (result.fellBack) {
    // The delta was too large to fetch document-by-document; store.load()
    // already ran in full, so the index needs the same full treatment.
    if (result.changed) search.rebuild();
  } else if (result.changed) {
    for (const doc of result.upserted) search.upsert(doc);
    for (const hash of result.departed) search.remove(hash);
    search.sync();
  }
  return treeChanged || result.changed;
}

/**
 * Runs a backstop reconcile, cheaply where it can.
 *
 * `focus` and `timer` both check `store.changedSince()` first — two small
 * calls (a limit-0 count and the trash hashes) instead of paging the whole
 * corpus. That check is exact for creates, trashes and restores: it compares
 * the document total against the last recorded total, and trash *membership*
 * rather than merely its size. When it finds a change, they fetch only what
 * is missing via `syncMissing` above, rather than the whole corpus.
 *
 * The one change neither check can see is an amendment, which creates no
 * link on the AllDocuments anchor and touches no trash link. `sweep` is the
 * answer to that: an unconditional full reload on a longer cadence (see
 * `FULL_SWEEP_EVERY` in signals.svelte.ts), which re-reads every document and
 * compares `latest` action hashes. Making the sweep itself incremental is not
 * possible for the same reason: a hash-list diff has no way to notice that a
 * document's content moved when its original hash did not.
 *
 * The five-minute tick used to be the unconditional one, which is why the
 * whole view repainted every five minutes. The guarantee is unchanged — drift
 * still gets corrected on a bounded schedule — but the common case is now a
 * skipped fetch, and the uncommon case is a reload that touches only what
 * changed.
 *
 * Returns whether anything actually changed, mainly so tests can assert on it.
 */
export async function reconcile(source: ReconcileSource, deps: ReconcileDeps): Promise<boolean> {
  if (source === 'sweep') return reloadEverything(deps);
  // `changedSince()` only looks at the document side (the AllDocuments total
  // and trash membership) — it has no way to notice that the folder tree
  // itself is still arriving, since that touches neither. Without this check,
  // a node with `structurePending` true could sit there until the next
  // `sweep` (up to thirty minutes) even while the user keeps refocusing the
  // tab, because every ordinary focus/timer tick would see an unchanged
  // document total and return early before ever calling `tree.load()` again.
  // `syncMissing` always reloads the tree first, so retrying it here is what
  // makes "keep retrying" true rather than aspirational.
  if (deps.tree.structurePending) return syncMissing(deps);
  const changed = await deps.store.changedSince();
  if (!changed) return false;
  return syncMissing(deps);
}
