import { describe, expect, it, vi } from 'vitest';
import { reconcile } from './reconcile';

function fakeDeps(changed: boolean) {
  const tree = { folders: [{ id: 'root' }] as any, load: vi.fn(async () => {}) };
  const store = {
    changedSince: vi.fn(async () => changed),
    load: vi.fn(async () => {}),
  };
  const search = { rebuild: vi.fn() };
  return { tree, store, search };
}

describe('reconcile', () => {
  it('skips the full reload on a focus trigger when nothing changed', async () => {
    const deps = fakeDeps(false);
    const didReload = await reconcile('focus', deps as any);

    expect(didReload).toBe(false);
    expect(deps.store.changedSince).toHaveBeenCalledOnce();
    expect(deps.tree.load).not.toHaveBeenCalled();
    expect(deps.store.load).not.toHaveBeenCalled();
    expect(deps.search.rebuild).not.toHaveBeenCalled();
  });

  it('does the full reload on a focus trigger when the counts moved', async () => {
    const deps = fakeDeps(true);
    const didReload = await reconcile('focus', deps as any);

    expect(didReload).toBe(true);
    expect(deps.store.changedSince).toHaveBeenCalledOnce();
    expect(deps.tree.load).toHaveBeenCalledOnce();
    expect(deps.store.load).toHaveBeenCalledWith(deps.tree.folders);
    expect(deps.search.rebuild).toHaveBeenCalledOnce();
  });

  it('always does the full reload on a timer trigger, without checking changedSince', async () => {
    // The backstop for the same-count blind spot documents.test.ts
    // demonstrates (changedSince cannot see a swap that nets to no delta):
    // the periodic timer reconcile reloads unconditionally rather than
    // trusting the cheap check.
    const deps = fakeDeps(false);
    const didReload = await reconcile('timer', deps as any);

    expect(didReload).toBe(true);
    expect(deps.store.changedSince).not.toHaveBeenCalled();
    expect(deps.tree.load).toHaveBeenCalledOnce();
    expect(deps.store.load).toHaveBeenCalledWith(deps.tree.folders);
    expect(deps.search.rebuild).toHaveBeenCalledOnce();
  });
});
