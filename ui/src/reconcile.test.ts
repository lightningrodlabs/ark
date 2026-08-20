import { describe, expect, it, vi } from 'vitest';
import { reconcile } from './reconcile';
import type { SyncResult } from './stores/documents.svelte';

function fakeDeps(
  opts: {
    changed?: boolean;
    docsMoved?: boolean;
    treeMoved?: boolean;
    structurePending?: boolean;
    sync?: Partial<SyncResult>;
    busy?: () => boolean;
  } = {},
) {
  const tree = {
    folders: [{ id: 'root' }] as any,
    load: vi.fn(async () => opts.treeMoved ?? false),
    structurePending: opts.structurePending ?? false,
  };
  const syncResult: SyncResult = {
    changed: false,
    upserted: [],
    departed: [],
    fellBack: false,
    ...opts.sync,
  };
  const store = {
    changedSince: vi.fn(async () => opts.changed ?? false),
    load: vi.fn(async () => opts.docsMoved ?? false),
    syncMissing: vi.fn(async () => syncResult),
  };
  const search = { rebuild: vi.fn(), upsert: vi.fn(), remove: vi.fn(), sync: vi.fn() };
  return { tree, store, search, busy: opts.busy };
}

describe('reconcile', () => {
  it('skips the reload on a focus trigger when nothing changed', async () => {
    const deps = fakeDeps({ changed: false });
    const outcome = await reconcile('focus', deps as any);

    expect(outcome).toBe('unchanged');
    expect(deps.store.changedSince).toHaveBeenCalledOnce();
    expect(deps.tree.load).not.toHaveBeenCalled();
    expect(deps.store.syncMissing).not.toHaveBeenCalled();
    expect(deps.store.load).not.toHaveBeenCalled();
    expect(deps.search.rebuild).not.toHaveBeenCalled();
  });

  // Task: focus and timer no longer re-page the whole corpus once the cheap
  // check trips — they fetch only what's missing via store.syncMissing, and
  // apply the delta to the index via upsert/remove rather than rebuild().
  it('fetches only what is missing on a focus trigger when the cheap check moved', async () => {
    const upserted = [{ meta: { title: 'New' } }] as any;
    const departed = [new Uint8Array([9])] as any;
    const deps = fakeDeps({ changed: true, sync: { changed: true, upserted, departed } });
    const outcome = await reconcile('focus', deps as any);

    expect(outcome).toBe('changed');
    expect(deps.store.changedSince).toHaveBeenCalledOnce();
    expect(deps.tree.load).toHaveBeenCalledOnce();
    expect(deps.store.syncMissing).toHaveBeenCalledWith(deps.tree.folders);
    expect(deps.store.load).not.toHaveBeenCalled();
    expect(deps.search.upsert).toHaveBeenCalledOnce();
    expect(deps.search.upsert).toHaveBeenCalledWith(upserted[0]);
    expect(deps.search.remove).toHaveBeenCalledOnce();
    expect(deps.search.remove).toHaveBeenCalledWith(departed[0]);
    expect(deps.search.sync).toHaveBeenCalledOnce();
    expect(deps.search.rebuild).not.toHaveBeenCalled();
  });

  // The ordinary five-minute tick takes the same cheap path focus does.
  // changedSince compares the document total AND trash membership exactly, so
  // it sees every create, trash and restore; the only thing it misses is an
  // amendment, and that is what the 'sweep' source below is for.
  it('takes the cheap path on an ordinary timer tick and skips when nothing changed', async () => {
    const deps = fakeDeps({ changed: false });
    const outcome = await reconcile('timer', deps as any);

    expect(outcome).toBe('unchanged');
    expect(deps.store.changedSince).toHaveBeenCalledOnce();
    expect(deps.store.syncMissing).not.toHaveBeenCalled();
    expect(deps.store.load).not.toHaveBeenCalled();
    expect(deps.search.rebuild).not.toHaveBeenCalled();
  });

  it('syncs only the missing documents on a timer tick when the cheap check moved', async () => {
    const deps = fakeDeps({ changed: true, sync: { changed: true } });
    expect(await reconcile('timer', deps as any)).toBe('changed');
    expect(deps.store.syncMissing).toHaveBeenCalledOnce();
    expect(deps.store.load).not.toHaveBeenCalled();
  });

  it('takes no action when syncMissing finds nothing actually changed', async () => {
    // changedSince() and syncMissing() can disagree at the margin (e.g. a
    // trash/restore swap that resolves back to the recorded total between the
    // two calls) — syncMissing's own `changed` is what gates index work.
    const deps = fakeDeps({ changed: true, sync: { changed: false } });
    expect(await reconcile('focus', deps as any)).toBe('unchanged');
    expect(deps.search.upsert).not.toHaveBeenCalled();
    expect(deps.search.remove).not.toHaveBeenCalled();
    expect(deps.search.sync).not.toHaveBeenCalled();
    expect(deps.search.rebuild).not.toHaveBeenCalled();
  });

  // The pathological case: a cold or badly-behind peer has more missing
  // documents than fetching individually is worth. store.syncMissing falls
  // back to the paged load() itself and reports that via `fellBack`; the
  // index then needs a full rebuild, not upsert/remove, since it cannot know
  // what changed from a delta it never computed.
  it('rebuilds the index when syncMissing falls back to the paged load', async () => {
    const deps = fakeDeps({ changed: true, sync: { changed: true, fellBack: true } });
    expect(await reconcile('focus', deps as any)).toBe('changed');
    expect(deps.search.rebuild).toHaveBeenCalledOnce();
    expect(deps.search.upsert).not.toHaveBeenCalled();
    expect(deps.search.remove).not.toHaveBeenCalled();
  });

  it('does not rebuild when the fallback load found nothing changed', async () => {
    const deps = fakeDeps({ changed: true, sync: { changed: false, fellBack: true } });
    expect(await reconcile('focus', deps as any)).toBe('unchanged');
    expect(deps.search.rebuild).not.toHaveBeenCalled();
  });

  // The gap this closes: changedSince() only looks at the document side, so a
  // node whose folder structure is still arriving (structurePending) would
  // otherwise sit there — every focus/timer tick sees an unchanged document
  // total, returns early, and tree.load() is never retried — until the next
  // unconditional sweep, up to thirty minutes away.
  it('keeps retrying the tree on a focus trigger while structure is pending, even with nothing else changed', async () => {
    const deps = fakeDeps({ changed: false, structurePending: true, sync: { changed: false } });
    const outcome = await reconcile('focus', deps as any);

    expect(deps.store.changedSince).not.toHaveBeenCalled();
    expect(deps.tree.load).toHaveBeenCalledOnce();
    expect(deps.store.syncMissing).toHaveBeenCalledOnce();
    expect(outcome).toBe('unchanged');
  });

  it('keeps retrying the tree on an ordinary timer tick while structure is pending', async () => {
    const deps = fakeDeps({ structurePending: true, sync: { changed: true } });
    expect(await reconcile('timer', deps as any)).toBe('changed');
    expect(deps.tree.load).toHaveBeenCalledOnce();
  });

  it('falls back to the cheap changedSince check once structure is no longer pending', async () => {
    const deps = fakeDeps({ structurePending: false, changed: false });
    expect(await reconcile('focus', deps as any)).toBe('unchanged');
    expect(deps.store.changedSince).toHaveBeenCalledOnce();
    expect(deps.tree.load).not.toHaveBeenCalled();
  });

  it('always fully reloads on a sweep, without consulting changedSince or syncMissing', async () => {
    // The backstop for the one blind spot left: an amendment moves neither the
    // document total nor the trash set, and a hash-list diff cannot see a
    // content change either — only the deep pass that reads every document's
    // `latest` catches it. The sweep pays for a full reload on a longer
    // cadence to guarantee that still converges.
    const deps = fakeDeps({ changed: false, docsMoved: true });
    const outcome = await reconcile('sweep', deps as any);

    expect(outcome).toBe('changed');
    expect(deps.store.changedSince).not.toHaveBeenCalled();
    expect(deps.store.syncMissing).not.toHaveBeenCalled();
    expect(deps.tree.load).toHaveBeenCalledOnce();
    expect(deps.store.load).toHaveBeenCalledWith(deps.tree.folders);
    expect(deps.search.rebuild).toHaveBeenCalledOnce();
  });

  // The whole point of Task A: the sweep still runs, but when it finds the
  // archive unchanged it must leave no trace — no new reactive state, and no
  // index rebuild. Rebuilding takes ~630ms on the 1406-document corpus and
  // replaces every SearchHit, which repaints the view on its own.
  it('does not rebuild the search index when a sweep found nothing changed', async () => {
    const deps = fakeDeps({ docsMoved: false, treeMoved: false });
    const outcome = await reconcile('sweep', deps as any);

    expect(deps.store.load).toHaveBeenCalledOnce();
    expect(deps.search.rebuild).not.toHaveBeenCalled();
    expect(outcome).toBe('unchanged');
  });

  it('rebuilds the index when a sweep found the documents changed', async () => {
    const deps = fakeDeps({ docsMoved: true });
    expect(await reconcile('sweep', deps as any)).toBe('changed');
    expect(deps.search.rebuild).toHaveBeenCalledOnce();
  });

  // A folder rename changes no document, so the index is untouched; the tree
  // store's own reactive field is what carries the change to the view.
  it('reports a tree-only change without rebuilding the index', async () => {
    const deps = fakeDeps({ treeMoved: true, docsMoved: false });
    expect(await reconcile('sweep', deps as any)).toBe('changed');
    expect(deps.search.rebuild).not.toHaveBeenCalled();
  });
});

// A long import is minutes of `create_document` writes on the same cell this
// reconcile would read from. The five-minute tick lands in the middle of one
// and — correctly — sees that the corpus moved, because the import moved it;
// it then re-fetches and re-indexes against the import's own writes, so the
// import slows and the progress count sits still while it happens. A `sweep`
// is worse still: an unconditional full re-page plus a ~640ms index rebuild.
//
// The app knows when it is busy (ImportPanel reports `running` up to
// App.svelte), so the tick asks rather than guessing.
describe('reconcile while the app is busy', () => {
  for (const source of ['focus', 'timer', 'sweep'] as const) {
    it(`makes no zome call at all on a ${source} tick while busy() is true`, async () => {
      const deps = fakeDeps({ changed: true, docsMoved: true, busy: () => true });
      expect(await reconcile(source, deps as any)).toBe('skipped');

      expect(deps.store.changedSince).not.toHaveBeenCalled();
      expect(deps.tree.load).not.toHaveBeenCalled();
      expect(deps.store.load).not.toHaveBeenCalled();
      expect(deps.store.syncMissing).not.toHaveBeenCalled();
      expect(deps.search.rebuild).not.toHaveBeenCalled();
    });
  }

  // Skipping is only safe because it is temporary: the import refreshes the
  // store itself when it finishes, and the next ordinary tick has to resume
  // the normal schedule rather than stay suppressed.
  it('runs normally on the next tick once busy() goes false', async () => {
    let busy = true;
    const deps = fakeDeps({ changed: true, sync: { changed: true }, busy: () => busy });

    expect(await reconcile('timer', deps as any)).toBe('skipped');
    busy = false;
    expect(await reconcile('timer', deps as any)).toBe('changed');
    expect(deps.store.changedSince).toHaveBeenCalledOnce();
    expect(deps.store.syncMissing).toHaveBeenCalledOnce();
  });

  it('still checks structurePending only after busy(), so a pending tree cannot slip past the guard', async () => {
    const deps = fakeDeps({ structurePending: true, busy: () => true });
    expect(await reconcile('timer', deps as any)).toBe('skipped');
    expect(deps.tree.load).not.toHaveBeenCalled();
  });

  it('runs as usual when no busy predicate was supplied at all', async () => {
    const deps = fakeDeps({ changed: false });
    expect(await reconcile('timer', deps as any)).toBe('unchanged');
    expect(deps.store.changedSince).toHaveBeenCalledOnce();
  });
});
