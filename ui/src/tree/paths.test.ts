import { describe, expect, it } from 'vitest';
import { descendantIds, folderPath } from './paths';
import type { Folder } from '../types';

const f = (id: string, name: string, parent: string | null = null): Folder => ({
  id,
  name,
  parent,
  order: 0,
  deleted: false,
});

const tree = [
  f('root', 'Buildings and Land'),
  f('a', '2015-2019', 'root'),
  f('b', '2020-2026', 'root'),
  f('a1', 'Q1', 'a'),
  f('other', 'Community Life'),
];

describe('descendantIds', () => {
  it('includes the folder itself and every descendant', () => {
    expect(descendantIds(tree, 'root').sort()).toEqual(['a', 'a1', 'b', 'root']);
  });

  it('returns just the folder for a leaf', () => {
    expect(descendantIds(tree, 'a1')).toEqual(['a1']);
  });

  it('returns an empty list for an unknown id', () => {
    expect(descendantIds(tree, 'nope')).toEqual([]);
  });
});

describe('folderPath', () => {
  it('returns the root-first ancestor chain including the folder', () => {
    expect(folderPath(tree, 'a1').map((x) => x.name)).toEqual([
      'Buildings and Land',
      '2015-2019',
      'Q1',
    ]);
  });

  it('stops at a missing parent rather than looping', () => {
    const broken = [f('x', 'X', 'ghost')];
    expect(folderPath(broken, 'x').map((x) => x.id)).toEqual(['x']);
  });

  it('does not loop on a parent cycle', () => {
    const cyclic = [f('a', 'A', 'b'), f('b', 'B', 'a')];
    expect(folderPath(cyclic, 'a').length).toBeLessThanOrEqual(2);
  });
});
