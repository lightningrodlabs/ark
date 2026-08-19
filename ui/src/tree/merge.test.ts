import { describe, expect, it } from 'vitest';
import { mergeHeads, liveFolders } from './merge';
import type { Folder, TreeHead } from '../types';

const f = (id: string, name: string, parent: string | null = null, deleted = false): Folder => ({
  id,
  name,
  parent,
  order: 0,
  deleted,
});

const head = (action: number[], timestamp: number, folders: Folder[]): TreeHead => ({
  action: new Uint8Array(action) as any,
  timestamp,
  folders,
});

describe('mergeHeads', () => {
  it('returns an empty list for no heads', () => {
    expect(mergeHeads([])).toEqual([]);
  });

  it('keeps folders added concurrently on both branches', () => {
    const a = head([1], 100, [f('base', 'Base'), f('a1', 'Alice folder')]);
    const b = head([2], 100, [f('base', 'Base'), f('b1', 'Bob folder')]);
    const ids = mergeHeads([a, b]).map((x) => x.id).sort();
    expect(ids).toEqual(['a1', 'b1', 'base']);
  });

  it('resolves a concurrent rename to the newer action', () => {
    const older = head([1], 100, [f('x', 'Old name')]);
    const newer = head([2], 200, [f('x', 'New name')]);
    expect(mergeHeads([older, newer])[0].name).toEqual('New name');
    // Order of heads must not matter.
    expect(mergeHeads([newer, older])[0].name).toEqual('New name');
  });

  it('breaks a timestamp tie by action-hash bytes, identically in both orders', () => {
    const a = head([1], 100, [f('x', 'From A')]);
    const b = head([2], 100, [f('x', 'From B')]);
    expect(mergeHeads([a, b])[0].name).toEqual('From B');
    expect(mergeHeads([b, a])[0].name).toEqual('From B');
  });

  it('lets a tombstone from a newer head beat a stale head that still has the folder', () => {
    const stale = head([1], 100, [f('x', 'Still here')]);
    const deleting = head([2], 200, [f('x', 'Still here', null, true)]);
    const merged = mergeHeads([stale, deleting]);
    expect(merged.find((x) => x.id === 'x')!.deleted).toBe(true);
    expect(liveFolders(merged)).toEqual([]);
  });

  it('sorts by order then name', () => {
    const h = head([1], 100, [
      { ...f('b', 'Beta'), order: 1 },
      { ...f('a', 'Alpha'), order: 1 },
      { ...f('c', 'Gamma'), order: 0 },
    ]);
    expect(mergeHeads([h]).map((x) => x.name)).toEqual(['Gamma', 'Alpha', 'Beta']);
  });
});

describe('liveFolders', () => {
  it('removes a subtree under a tombstoned parent', () => {
    const folders = [f('p', 'Parent', null, true), f('c', 'Child', 'p'), f('o', 'Other')];
    expect(liveFolders(folders).map((x) => x.id)).toEqual(['o']);
  });

  it('keeps a folder whose parent is missing entirely', () => {
    const folders = [f('orphan', 'Orphan', 'gone')];
    expect(liveFolders(folders).map((x) => x.id)).toEqual(['orphan']);
  });
});
