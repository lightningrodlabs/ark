import { describe, expect, it, vi } from 'vitest';
import { DocumentStore, key } from './documents.svelte';
import { trashEntries } from './orphans';
import type { ArkClient } from '../ark-client';
import type { DocumentSummary, Folder, FolderFiling } from '../types';

const hash = (n: number) => new Uint8Array([n, n, n]) as any;
const summary = (n: number, title: string): DocumentSummary => ({
  original: hash(n),
  latest: hash(n),
  author: hash(n),
  created_at: n,
  updated_at: n,
  body: `body ${n}`,
  meta: { title },
});

const folders: Folder[] = [
  { id: 'live', name: 'Community Life', parent: null, order: 0, deleted: false },
  { id: 'gone', name: 'Old Committee', parent: null, order: 1, deleted: true },
];

function fakeArk(docs: DocumentSummary[], filings: FolderFiling[], trashed: any[]) {
  return {
    getAllDocuments: vi.fn(async (o: number, l: number) => ({
      total: docs.length,
      documents: docs.slice(o, o + l),
    })),
    getFilings: vi.fn(async (ids: string[]) =>
      ids.map((id) => filings.find((f) => f.folder_id === id) ?? { folder_id: id, documents: [] }),
    ),
    getTrashed: vi.fn(async () => trashed),
    getDocument: vi.fn(async () => null),
  } as unknown as ArkClient;
}

describe('trash and orphans', () => {
  it('names the folder a trashed document was filed in', async () => {
    const docs = [summary(1, 'Binned')];
    const store = new DocumentStore(
      fakeArk(docs, [{ folder_id: 'live', documents: [hash(1)] }], [hash(1)]),
      100,
    );
    await store.load(folders);
    const entries = trashEntries(store, folders);
    expect(entries).toHaveLength(1);
    expect(entries[0].wasIn).toEqual('Community Life');
  });

  it('reports null for a trashed document that was never filed', async () => {
    const docs = [summary(1, 'Loose and binned')];
    const store = new DocumentStore(fakeArk(docs, [], [hash(1)]), 100);
    await store.load(folders);
    expect(trashEntries(store, folders)[0].wasIn).toBeNull();
  });

  it('keeps a trashed document out of the orphan bin for its deleted folder', async () => {
    const docs = [summary(1, 'Trashed and stranded'), summary(2, 'Only stranded')];
    const store = new DocumentStore(
      fakeArk(docs, [{ folder_id: 'gone', documents: [hash(1), hash(2)] }], [hash(1)]),
      100,
    );
    await store.load(folders);

    const bins = store.inDeletedFolders(folders);
    expect(bins[0].documents.map((d) => d.meta.title)).toEqual(['Only stranded']);
    expect(trashEntries(store, folders).map((e) => e.doc.meta.title)).toEqual([
      'Trashed and stranded',
    ]);
  });

  it('names the folder a trashed document was in even after that folder is deleted', async () => {
    const docs = [summary(1, 'Trashed and stranded')];
    const store = new DocumentStore(
      fakeArk(docs, [{ folder_id: 'gone', documents: [hash(1)] }], [hash(1)]),
      100,
    );
    await store.load(folders);
    // Resolving `wasIn` has to look at ALL folders, tombstones included — a
    // trash entry reading "was in (unknown)" is exactly the case where knowing
    // where it came from matters most.
    expect(trashEntries(store, folders)[0].wasIn).toEqual('Old Committee');
  });

  it('names the deleted folder on its bin so it can be re-filed knowingly', async () => {
    const docs = [summary(2, 'Stranded')];
    const store = new DocumentStore(
      fakeArk(docs, [{ folder_id: 'gone', documents: [hash(2)] }], []),
      100,
    );
    await store.load(folders);
    expect(store.inDeletedFolders(folders)[0].folder.name).toEqual('Old Committee');
  });
});
