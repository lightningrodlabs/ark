import type { DocumentStore } from './stores/documents.svelte';
import type { TreeStore } from './stores/tree.svelte';
import type { SearchStore } from './stores/search.svelte';

/**
 * `focus`  — the applet regained focus (inside Moss, merely switching panes).
 * `timer`  — the ordinary periodic tick.
 * `sweep`  — the occasional unconditional full pass; see below.
 */
export type ReconcileSource = 'focus' | 'timer' | 'sweep';

/**
 * What a pass actually did.
 *
 * `skipped` is not "found nothing": it means the pass made no zome call at
 * all, because `busy()` said the app was in the middle of something. The
 * caller needs to tell the two apart — see `SignalStore.maybeReconcile`, where
 * a skipped tick must not consume the sweep's turn.
 */
export type ReconcileOutcome = 'skipped' | 'unchanged' | 'changed';

export interface ReconcileDeps {
  tree: TreeStore;
  store: DocumentStore;
  search: SearchStore;
  /**
   * "The app is in the middle of something long; do not read the cell."
   *
   * Supplied by the caller (App.svelte wires it to `importRunning`) rather
   * than read from module state, so the rule is testable and so this module
   * still knows nothing about what "busy" happens to mean this month.
   */
  busy?: () => boolean;
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
 * `changedSince()` says something moved, and by ImportPanel to pick up the
 * documents a run just wrote.
 *
 * A hash list cannot reveal an amendment (the original action hash is
 * unchanged; only `latest` moves), so this still misses that case exactly as
 * `changedSince()` does — `sweep`'s unconditional full reload is what catches
 * it, on a bounded cadence.
 *
 * Exported so the import has one of these rather than a second copy: the rule
 * about when a delta is too large to fetch document-by-document, and what the
 * index then needs, is subtle enough that two of it would drift.
 *
 * `onProgress` reports the refresh as it goes (`done` of `total`), for a
 * caller with a label to keep honest — a refresh at corpus scale is many round
 * trips, and silence there is what makes a finished import look hung.
 */
export async function syncMissing(
  { tree, store, search }: ReconcileDeps,
  onProgress?: (done: number, total: number) => void,
): Promise<boolean> {
  const treeChanged = await tree.load();
  const result = await store.syncMissing(tree.folders, onProgress);
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
 * Returns what the pass did, mainly so the caller can tell a skipped tick from
 * one that ran and found nothing.
 */
export async function reconcile(
  source: ReconcileSource,
  deps: ReconcileDeps,
): Promise<ReconcileOutcome> {
  // Before anything, including `sweep` — a sweep is the most expensive tick
  // there is (an unconditional full re-page plus a ~640ms index rebuild), and
  // the whole point is not to spend it against a cell that a long import is
  // already writing to. Five minutes into a 1406-document import the tick
  // fires, `changedSince()` correctly reports that the corpus moved — the
  // import moved it — and the re-fetch then serialises against the import's
  // own writes, which is the import slowing down and the progress count
  // sitting still.
  //
  // Skipping is safe because it is temporary and because nothing depends on
  // this particular tick: the import refreshes the store itself when it
  // finishes, and the next tick resumes the normal schedule. A tick skipped
  // here reports `skipped` so it does not consume the sweep's turn either
  // (see signals.svelte.ts).
  if (deps.busy?.()) return 'skipped';
  if (source === 'sweep') return (await reloadEverything(deps)) ? 'changed' : 'unchanged';
  // `changedSince()` only looks at the document side (the AllDocuments total
  // and trash membership) — it has no way to notice that the folder tree
  // itself is still arriving, since that touches neither. Without this check,
  // a node with `structurePending` true could sit there until the next
  // `sweep` (up to thirty minutes) even while the user keeps refocusing the
  // tab, because every ordinary focus/timer tick would see an unchanged
  // document total and return early before ever calling `tree.load()` again.
  // `syncMissing` always reloads the tree first, so retrying it here is what
  // makes "keep retrying" true rather than aspirational.
  if (deps.tree.structurePending) return (await syncMissing(deps)) ? 'changed' : 'unchanged';
  const changed = await deps.store.changedSince();
  if (!changed) return 'unchanged';
  return (await syncMissing(deps)) ? 'changed' : 'unchanged';
}
