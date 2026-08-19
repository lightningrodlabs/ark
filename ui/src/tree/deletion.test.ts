import { describe, expect, it } from 'vitest';
import { planFolderDeletion } from './deletion';
import type { Folder, FolderFiling } from '../types';

const f = (id: string, name: string, parent: string | null = null): Folder => ({
  id,
  name,
  parent,
  order: 0,
  deleted: false,
});
const hash = (n: number) => new Uint8Array([n]) as any;

const tree = [f('root', 'Root'), f('child', 'Child', 'root'), f('top', 'Top')];

describe('planFolderDeletion', () => {
  it('moves documents to the parent folder and tombstones the subtree', () => {
    const filings: FolderFiling[] = [
      { folder_id: 'root', documents: [hash(1)] },
      { folder_id: 'child', documents: [hash(2)] },
    ];
    const plan = planFolderDeletion(tree, filings, 'root');
    expect(plan.tombstone.sort()).toEqual(['child', 'root']);
    expect(plan.moves).toEqual([
      { original: hash(1), from: 'root', to: null },
      { original: hash(2), from: 'child', to: null },
    ]);
  });

  it('moves to the parent when one exists', () => {
    const filings: FolderFiling[] = [{ folder_id: 'child', documents: [hash(2)] }];
    const plan = planFolderDeletion(tree, filings, 'child');
    expect(plan.tombstone).toEqual(['child']);
    expect(plan.moves).toEqual([{ original: hash(2), from: 'child', to: 'root' }]);
  });

  it('plans no moves for an empty folder', () => {
    const plan = planFolderDeletion(tree, [{ folder_id: 'top', documents: [] }], 'top');
    expect(plan.moves).toEqual([]);
    expect(plan.tombstone).toEqual(['top']);
  });

  it('returns an empty plan for an unknown folder', () => {
    expect(planFolderDeletion(tree, [], 'ghost')).toEqual({ tombstone: [], moves: [] });
  });
});
