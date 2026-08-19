import { describe, expect, it, vi } from 'vitest';
import { DocumentStore, key } from './documents.svelte';
import type { ArkClient } from '../ark-client';
import type { DocumentSummary, Folder, FolderFiling } from '../types';

const hash = (n: number) => new Uint8Array([n, n, n]) as any;

const summary = (n: number, title: string): DocumentSummary => ({
  original: hash(n),
  latest: hash(n),
  author: hash(n),
  created_at: 1000 + n,
  updated_at: 1000 + n,
  body: `body ${n}`,
  meta: { title, date: `2026-08-${String(n).padStart(2, '0')}` },
});

const folders: Folder[] = [
  { id: 'root', name: 'Root', parent: null, order: 0, deleted: false },
  { id: 'child', name: 'Child', parent: 'root', order: 0, deleted: false },
  { id: 'gone', name: 'Gone', parent: null, order: 0, deleted: true },
];

function fakeArk(docs: DocumentSummary[], filings: FolderFiling[], trashed: any[] = []) {
  return {
    getAllDocuments: vi.fn(async (offset: number, limit: number) =>
      docs.slice(offset, offset + limit),
    ),
    getFilings: vi.fn(async (ids: string[]) =>
      ids.map((id) => filings.find((f) => f.folder_id === id) ?? { folder_id: id, documents: [] }),
    ),
    getTrashed: vi.fn(async () => trashed),
    getDocument: vi.fn(async (h: any) => docs.find((d) => key(d.original) === key(h)) ?? null),
  } as unknown as ArkClient;
}

describe('DocumentStore', () => {
  it('loads every document in chunks and reports progress', async () => {
    const docs = Array.from({ length: 250 }, (_, i) => summary(i, `Doc ${i}`));
    const store = new DocumentStore(fakeArk(docs, []), 100);
    const progress: number[] = [];
    await store.load(folders, (n) => progress.push(n));
    expect(store.byOriginal.size).toEqual(250);
    expect(progress).toEqual([100, 200, 250]);
  });

  it('maps documents to folders and counts them per folder including descendants', async () => {
    const docs = [summary(1, 'A'), summary(2, 'B'), summary(3, 'C')];
    const filings: FolderFiling[] = [
      { folder_id: 'root', documents: [hash(1)] },
      { folder_id: 'child', documents: [hash(2)] },
    ];
    const store = new DocumentStore(fakeArk(docs, filings), 100);
    await store.load(folders);

    expect(store.inFolder('root', folders).map((d) => d.meta.title).sort()).toEqual(['A', 'B']);
    expect(store.inFolder('child', folders).map((d) => d.meta.title)).toEqual(['B']);
    expect(store.counts(folders)['root']).toEqual(2);
  });

  it('reports documents with no folder link as unfiled', async () => {
    const docs = [summary(1, 'Filed'), summary(2, 'Loose')];
    const filings: FolderFiling[] = [{ folder_id: 'root', documents: [hash(1)] }];
    const store = new DocumentStore(fakeArk(docs, filings), 100);
    await store.load(folders);
    expect(store.unfiled().map((d) => d.meta.title)).toEqual(['Loose']);
  });

  it('reports documents filed under a tombstoned folder separately from unfiled', async () => {
    const docs = [summary(1, 'Stranded')];
    const filings: FolderFiling[] = [{ folder_id: 'gone', documents: [hash(1)] }];
    const store = new DocumentStore(fakeArk(docs, filings), 100);
    await store.load(folders);
    expect(store.unfiled()).toEqual([]);
    const bins = store.inDeletedFolders(folders);
    expect(bins).toHaveLength(1);
    expect(bins[0].folder.name).toEqual('Gone');
    expect(bins[0].documents.map((d) => d.meta.title)).toEqual(['Stranded']);
  });

  it('excludes trashed documents from folder listings but keeps them readable', async () => {
    const docs = [summary(1, 'Kept'), summary(2, 'Binned')];
    const filings: FolderFiling[] = [{ folder_id: 'root', documents: [hash(1), hash(2)] }];
    const store = new DocumentStore(fakeArk(docs, filings, [hash(2)]), 100);
    await store.load(folders);
    expect(store.inFolder('root', folders).map((d) => d.meta.title)).toEqual(['Kept']);
    expect(store.trashed.has(key(hash(2)))).toBe(true);
    expect(store.byOriginal.get(key(hash(2)))!.body).toEqual('body 2');
  });

  it('lists a trashed document in neither unfiled nor a deleted-folder bin', async () => {
    const docs = [summary(1, 'Trashed and unfiled'), summary(2, 'Trashed and stranded')];
    const filings: FolderFiling[] = [{ folder_id: 'gone', documents: [hash(2)] }];
    const store = new DocumentStore(fakeArk(docs, filings, [hash(1), hash(2)]), 100);
    await store.load(folders);

    // Trash wins over every other state, so neither document may appear twice —
    // a document listed in both trash and a bin cannot be reasoned about.
    expect(store.unfiled()).toEqual([]);
    expect(store.inDeletedFolders(folders)).toEqual([]);
    expect(store.trashed.size).toEqual(2);
  });

  it('patches state from signals without a full reload', async () => {
    const docs = [summary(1, 'One')];
    const ark = fakeArk(docs, [{ folder_id: 'root', documents: [hash(1)] }]);
    const store = new DocumentStore(ark, 100);
    await store.load(folders);

    await store.applySignal({ type: 'DocumentTrashed', original: hash(1) });
    expect(store.trashed.has(key(hash(1)))).toBe(true);

    await store.applySignal({ type: 'DocumentRestored', original: hash(1) });
    expect(store.trashed.has(key(hash(1)))).toBe(false);

    await store.applySignal({
      type: 'DocumentMoved',
      original: hash(1),
      from: 'root',
      to: 'child',
    });
    expect(store.filings.get(key(hash(1)))).toEqual('child');

    docs.push(summary(9, 'Nine'));
    await store.applySignal({ type: 'DocumentCreated', original: hash(9) });
    expect(store.byOriginal.get(key(hash(9)))!.meta.title).toEqual('Nine');
  });
});
