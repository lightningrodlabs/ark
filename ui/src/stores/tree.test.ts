import { describe, expect, it, vi } from 'vitest';
import { TreeStore } from './tree.svelte';
import type { ArkClient } from '../ark-client';
import type { Folder, TreeHead, TreeSnapshot } from '../types';

const f = (id: string, name: string, parent: string | null = null): Folder => ({
  id,
  name,
  parent,
  order: 0,
  deleted: false,
});

const head = (folders: Folder[], action = [1], timestamp = 100): TreeHead => ({
  action: new Uint8Array(action) as any,
  timestamp,
  folders,
});

function fakeArk(snapshot: TreeSnapshot) {
  return {
    getFolderTree: vi.fn(async () => snapshot),
  } as unknown as ArkClient;
}

describe('TreeStore.structurePending', () => {
  it('is false for a genuinely fresh archive — no roots at all', async () => {
    const store = new TreeStore(fakeArk({ root_count: 0, heads: [] }));
    await store.load();
    expect(store.structurePending).toBe(false);
    expect(store.folders).toEqual([]);
  });

  it('is true when a root link exists but its tip has not resolved', async () => {
    const store = new TreeStore(fakeArk({ root_count: 1, heads: [] }));
    await store.load();
    expect(store.structurePending).toBe(true);
    // No folders are known yet — the caller must not treat this as "no folders".
    expect(store.folders).toEqual([]);
  });

  it('is false once the tree resolves', async () => {
    const store = new TreeStore(
      fakeArk({ root_count: 1, heads: [head([f('f1', 'Committee')])] }),
    );
    await store.load();
    expect(store.structurePending).toBe(false);
    expect(store.folders.map((x) => x.id)).toEqual(['f1']);
  });

  it('is true when one of several roots has not resolved a tip yet', async () => {
    // Two agents created a tree at the same moment before either had synced
    // the other's root — tree_roots() returns two links, but only one root's
    // entry has arrived on this device. root_count and heads.length disagree
    // exactly the same way as the zero-heads case, just partially.
    const store = new TreeStore(
      fakeArk({ root_count: 2, heads: [head([f('a1', 'Alice root')])] }),
    );
    await store.load();
    expect(store.structurePending).toBe(true);
    // Whatever DID resolve is still shown — pending does not mean blank.
    expect(store.folders.map((x) => x.id)).toEqual(['a1']);
  });

  it('is false once every root has resolved, even with more than one root', async () => {
    const store = new TreeStore(
      fakeArk({
        root_count: 2,
        heads: [head([f('a1', 'Alice root')], [1]), head([f('b1', 'Bob root')], [2])],
      }),
    );
    await store.load();
    expect(store.structurePending).toBe(false);
    expect(store.folders.map((x) => x.id).sort()).toEqual(['a1', 'b1']);
  });

  it('clears once a later load resolves the tree', async () => {
    const ark = fakeArk({ root_count: 1, heads: [] });
    const store = new TreeStore(ark);
    await store.load();
    expect(store.structurePending).toBe(true);

    (ark.getFolderTree as ReturnType<typeof vi.fn>).mockResolvedValue({
      root_count: 1,
      heads: [head([f('f1', 'Committee')])],
    });
    await store.load();
    expect(store.structurePending).toBe(false);
    expect(store.folders.map((x) => x.id)).toEqual(['f1']);
  });
});
