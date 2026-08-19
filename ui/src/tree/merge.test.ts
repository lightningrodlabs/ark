import { describe, expect, it } from 'vitest';
import { mergeHeads, liveFolders, deadFolders } from './merge';
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

  // Documents the merge behaviour that actually ships, rather than the
  // per-folder merge the code structure suggests. `mergeHeads` resolves a
  // winner per folder id, which reads as though renaming two different
  // folders concurrently could each survive independently. But `TreeStore.save`
  // (ui/src/stores/tree.svelte.ts) always writes the FULL folder list as one
  // head, so every head is a complete snapshot of the tree at that moment —
  // there is no way for a head to carry a rename to folder A without also
  // carrying whatever it last knew about folder B. Per-id resolution then
  // degenerates to whole-tree last-writer-wins: an older head can beat a
  // newer one folder-by-id, but two heads can never each contribute a winning
  // rename to a DIFFERENT folder, because the newer head's version of every
  // folder wins every id, including ones it didn't touch.
  //
  // Fixing this for real needs each `Folder` to carry its own last-modified
  // action so a head can prove which of its folders it actually touched —
  // a schema change, out of scope for this fix wave. This test exists so the
  // limitation is recorded as documented behaviour, not rediscovered as a
  // surprise later.
  it('resolves whole-tree, not per-folder: a concurrent rename of a different folder is lost', () => {
    const base = [f('a', 'Alpha'), f('b', 'Beta')];
    // Alice's head: she renamed 'a', and her head still carries Beta's OLD
    // name because whole-tree snapshots always include every folder.
    const aliceHead = head([1], 200, [f('a', 'Alpha renamed by Alice'), f('b', 'Beta')]);
    // Bob's head, timestamped later: he renamed 'b', and his snapshot still
    // carries Alpha's ORIGINAL name, from before Alice's edit ever reached him.
    const bobHead = head([2], 300, [f('a', 'Alpha'), f('b', 'Beta renamed by Bob')]);

    const merged = mergeHeads([aliceHead, bobHead]);

    // Bob's head is newer, so it wins BOTH ids — including 'a', which Bob
    // never touched. Alice's rename of 'a' is lost even though the two edits
    // targeted different folders and neither peer overwrote the other's
    // intent.
    expect(merged.find((x) => x.id === 'a')!.name).toEqual('Alpha');
    expect(merged.find((x) => x.id === 'b')!.name).toEqual('Beta renamed by Bob');
    expect(base.map((x) => x.name)).toEqual(['Alpha', 'Beta']); // sanity: base unchanged
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

describe('deadFolders', () => {
  it('is the complement of liveFolders, including a live-flagged child of a tombstone', () => {
    const folders = [f('p', 'Parent', null, true), f('c', 'Child', 'p'), f('o', 'Other')];
    expect(deadFolders(folders).map((x) => x.id).sort()).toEqual(['c', 'p']);
    expect(liveFolders(folders).map((x) => x.id)).toEqual(['o']);
  });

  it('does not mark a folder whose parent is merely missing', () => {
    const folders = [f('orphan', 'Orphan', 'gone')];
    expect(deadFolders(folders)).toEqual([]);
  });
});
