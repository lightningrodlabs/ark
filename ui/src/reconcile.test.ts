import { describe, expect, it, vi } from 'vitest';
import { reconcile } from './reconcile';

function fakeDeps(opts: { changed?: boolean; docsMoved?: boolean; treeMoved?: boolean } = {}) {
  const tree = {
    folders: [{ id: 'root' }] as any,
    load: vi.fn(async () => opts.treeMoved ?? false),
  };
  const store = {
    changedSince: vi.fn(async () => opts.changed ?? false),
    load: vi.fn(async () => opts.docsMoved ?? false),
  };
  const search = { rebuild: vi.fn() };
  return { tree, store, search };
}

describe('reconcile', () => {
  it('skips the full reload on a focus trigger when nothing changed', async () => {
    const deps = fakeDeps({ changed: false });
    const didReload = await reconcile('focus', deps as any);

    expect(didReload).toBe(false);
    expect(deps.store.changedSince).toHaveBeenCalledOnce();
    expect(deps.tree.load).not.toHaveBeenCalled();
    expect(deps.store.load).not.toHaveBeenCalled();
    expect(deps.search.rebuild).not.toHaveBeenCalled();
  });

  it('does the full reload on a focus trigger when the cheap check moved', async () => {
    const deps = fakeDeps({ changed: true, docsMoved: true });
    const didReload = await reconcile('focus', deps as any);

    expect(didReload).toBe(true);
    expect(deps.store.changedSince).toHaveBeenCalledOnce();
    expect(deps.tree.load).toHaveBeenCalledOnce();
    expect(deps.store.load).toHaveBeenCalledWith(deps.tree.folders);
    expect(deps.search.rebuild).toHaveBeenCalledOnce();
  });

  // The ordinary five-minute tick now takes the same cheap path focus does.
  // changedSince compares the document total AND trash membership exactly, so
  // it sees every create, trash and restore; the only thing it misses is an
  // amendment, and that is what the 'sweep' source below is for. Before this,
  // every tick reloaded the whole corpus and rebuilt the index unconditionally
  // — the visible full redraw every five minutes.
  it('takes the cheap path on an ordinary timer tick and skips when nothing changed', async () => {
    const deps = fakeDeps({ changed: false });
    const didReload = await reconcile('timer', deps as any);

    expect(didReload).toBe(false);
    expect(deps.store.changedSince).toHaveBeenCalledOnce();
    expect(deps.store.load).not.toHaveBeenCalled();
    expect(deps.search.rebuild).not.toHaveBeenCalled();
  });

  it('reloads on a timer tick when the cheap check moved', async () => {
    const deps = fakeDeps({ changed: true, docsMoved: true });
    expect(await reconcile('timer', deps as any)).toBe(true);
    expect(deps.store.load).toHaveBeenCalledOnce();
  });

  it('always reloads on a sweep, without consulting changedSince', async () => {
    // The backstop for the one blind spot left: an amendment moves neither the
    // document total nor the trash set. The sweep pays for a full reload on a
    // longer cadence to guarantee that still converges.
    const deps = fakeDeps({ changed: false, docsMoved: true });
    const didReload = await reconcile('sweep', deps as any);

    expect(didReload).toBe(true);
    expect(deps.store.changedSince).not.toHaveBeenCalled();
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
    const didReload = await reconcile('sweep', deps as any);

    expect(deps.store.load).toHaveBeenCalledOnce();
    expect(deps.search.rebuild).not.toHaveBeenCalled();
    expect(didReload).toBe(false);
  });

  it('rebuilds the index when a sweep found the documents changed', async () => {
    const deps = fakeDeps({ docsMoved: true });
    expect(await reconcile('sweep', deps as any)).toBe(true);
    expect(deps.search.rebuild).toHaveBeenCalledOnce();
  });

  // A folder rename changes no document, so the index is untouched; the tree
  // store's own reactive field is what carries the change to the view.
  it('reports a tree-only change without rebuilding the index', async () => {
    const deps = fakeDeps({ treeMoved: true, docsMoved: false });
    expect(await reconcile('sweep', deps as any)).toBe(true);
    expect(deps.search.rebuild).not.toHaveBeenCalled();
  });
});
