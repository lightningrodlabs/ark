import { describe, expect, it } from 'vitest';
import { canSaveDocument, folderOptions } from './createFolderPicker';
import type { Folder } from '../types';

const f = (id: string, name: string, parent: string | null = null, order = 0): Folder => ({
  id,
  name,
  parent,
  order,
  deleted: false,
});

describe('folderOptions', () => {
  it('lists roots before children, depth-first', () => {
    const folders = [
      f('root', 'Buildings and Land', null, 0),
      f('other', 'Community Life', null, 1),
      f('a', '2015-2019', 'root', 0),
      f('a1', 'Q1', 'a', 0),
    ];
    expect(folderOptions(folders).map((o) => o.id)).toEqual(['root', 'a', 'a1', 'other']);
  });

  it('indents by depth so the tree shape is visible', () => {
    const folders = [f('root', 'Root'), f('child', 'Child', 'root'), f('grand', 'Grand', 'child')];
    const labels = folderOptions(folders).map((o) => o.label);
    expect(labels.map((l) => l.trimStart())).toEqual(['Root', 'Child', 'Grand']);
    expect(labels.map((l) => l.length - l.trimStart().length)).toEqual([0, 2, 4]);
  });

  it('returns an empty list for an empty archive', () => {
    expect(folderOptions([])).toEqual([]);
  });

  it('orders siblings by their `order` field', () => {
    const folders = [f('b', 'Second', null, 1), f('a', 'First', null, 0)];
    expect(folderOptions(folders).map((o) => o.id)).toEqual(['a', 'b']);
  });
});

describe('canSaveDocument', () => {
  it('blocks an empty title regardless of mode', () => {
    expect(canSaveDocument({ mode: 'create', title: '  ', folderId: 'f1', hasFolders: true })).toBe(
      false,
    );
    expect(canSaveDocument({ mode: 'amend', title: '', folderId: null, hasFolders: true })).toBe(
      false,
    );
  });

  it('requires a folder to create when the archive has folders', () => {
    expect(
      canSaveDocument({ mode: 'create', title: 'Minutes', folderId: null, hasFolders: true }),
    ).toBe(false);
    expect(
      canSaveDocument({ mode: 'create', title: 'Minutes', folderId: 'f1', hasFolders: true }),
    ).toBe(true);
  });

  it('allows creating unfiled when the archive has no folders at all', () => {
    expect(
      canSaveDocument({ mode: 'create', title: 'Minutes', folderId: null, hasFolders: false }),
    ).toBe(true);
  });

  it('never requires a folder to amend, since amend does not touch filing links', () => {
    expect(
      canSaveDocument({ mode: 'amend', title: 'Minutes', folderId: null, hasFolders: true }),
    ).toBe(true);
  });
});
