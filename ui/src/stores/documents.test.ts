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
    getAllDocuments: vi.fn(async (offset: number, limit: number) => ({
      total: docs.length,
      documents: docs.slice(offset, offset + limit),
    })),
    getFilings: vi.fn(async (ids: string[]) =>
      ids.map((id) => filings.find((f) => f.folder_id === id) ?? { folder_id: id, documents: [] }),
    ),
    getTrashed: vi.fn(async () => trashed),
    getDocument: vi.fn(async (h: any) => docs.find((d) => key(d.original) === key(h)) ?? null),
  } as unknown as ArkClient;
}

/**
 * A fake whose first page resolves fewer hashes than it is asked for, while
 * still reporting the true total — the shape `docs.slice(offset, offset +
 * limit)` can never produce, because a plain slice cannot be short except at
 * the very end. This is what a peer sees when it holds the AllDocuments link
 * for a document but has not yet gossiped in its entry.
 */
function fakeArkWithGap(docs: DocumentSummary[], unresolved: Set<number>) {
  return {
    getAllDocuments: vi.fn(async (offset: number, limit: number) => ({
      total: docs.length,
      documents: docs
        .slice(offset, offset + limit)
        .filter((_, i) => !unresolved.has(offset + i)),
    })),
    getFilings: vi.fn(async () => []),
    getTrashed: vi.fn(async () => []),
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

  it('keeps paging past a short page that is not the last one, and reports the gap', async () => {
    // 250 documents; the first page (offset 0, limit 100) resolves only 97 of
    // them locally. A page-length-based loop reads that short page as
    // end-of-corpus and stops at 97 — documents 100-249 are never requested.
    // Paging on the reported `total` instead must still fetch every page.
    const docs = Array.from({ length: 250 }, (_, i) => summary(i, `Doc ${i}`));
    const unresolved = new Set([10, 20, 30]);
    const store = new DocumentStore(fakeArkWithGap(docs, unresolved), 100);
    await store.load(folders);

    expect(store.total).toEqual(250);
    expect(store.byOriginal.size).toEqual(247);
    expect(store.missing).toEqual(3);
    // Every document outside the unresolved set made it in, including ones
    // past the short first page.
    for (let i = 0; i < 250; i++) {
      expect(store.byOriginal.has(key(hash(i)))).toEqual(!unresolved.has(i));
    }
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

  it('bins a document filed under a live-flagged child of a tombstoned folder', async () => {
    // FolderTree only tombstones the folder actually deleted, not its
    // children — 'goneChild' below still has deleted: false. A document filed
    // there is in no live folder (the whole subtree is hidden) and is not
    // unfiled (its filing id is truthy), so without ancestry-based selection
    // it would have no bin at all: reachable only through "All documents" or
    // search, with no way to re-file it.
    const withSubtree: Folder[] = [
      ...folders,
      { id: 'goneChild', name: 'Gone Child', parent: 'gone', order: 0, deleted: false },
    ];
    const docs = [summary(1, 'Buried')];
    const filings: FolderFiling[] = [{ folder_id: 'goneChild', documents: [hash(1)] }];
    const store = new DocumentStore(fakeArk(docs, filings), 100);
    await store.load(withSubtree);

    expect(store.unfiled()).toEqual([]);
    const bins = store.inDeletedFolders(withSubtree);
    expect(bins).toHaveLength(1);
    expect(bins[0].folder.id).toEqual('goneChild');
    expect(bins[0].documents.map((d) => d.meta.title)).toEqual(['Buried']);
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

  // The tree renders sub-folders and documents as siblings under one folder
  // node, so it needs what is filed directly here — not the subtree roll-up
  // `inFolder` gives, which would repeat every document at every ancestor.
  it('lists documents filed directly in a folder, newest first, excluding trashed', async () => {
    const docs = [summary(1, 'A'), summary(2, 'B'), summary(3, 'C')];
    const filings: FolderFiling[] = [
      { folder_id: 'root', documents: [hash(1), hash(3)] },
      { folder_id: 'child', documents: [hash(2)] },
    ];
    const store = new DocumentStore(fakeArk(docs, filings, [hash(3)]), 100);
    await store.load(folders);

    // hash(3) is trashed, hash(2) is in the child folder, not this one.
    expect(store.directlyIn('root').map((d) => d.meta.title)).toEqual(['A']);
    expect(store.directlyIn('child').map((d) => d.meta.title)).toEqual(['B']);
    // inFolder rolls the child up into the parent; directlyIn must not.
    expect(store.inFolder('root', folders).map((d) => d.meta.title).sort()).toEqual(['A', 'B']);
  });

  it('sorts documents filed directly in a folder by date, newest first', async () => {
    const docs = [summary(1, 'Oldest'), summary(5, 'Newest'), summary(3, 'Middle')];
    const filings: FolderFiling[] = [
      { folder_id: 'root', documents: [hash(1), hash(5), hash(3)] },
    ];
    const store = new DocumentStore(fakeArk(docs, filings), 100);
    await store.load(folders);
    expect(store.directlyIn('root').map((d) => d.meta.title)).toEqual([
      'Newest',
      'Middle',
      'Oldest',
    ]);
  });

  describe('changedSince', () => {
    it('is false when the remote document total and trash count both match', async () => {
      const docs = [summary(1, 'One'), summary(2, 'Two')];
      const filings: FolderFiling[] = [{ folder_id: 'root', documents: [hash(1), hash(2)] }];
      const ark = fakeArk(docs, filings, [hash(2)]);
      const store = new DocumentStore(ark, 100);
      await store.load(folders);

      expect(await store.changedSince()).toBe(false);
      // Cheap: a limit-0 call for the count, not a full page of documents.
      expect(ark.getAllDocuments).toHaveBeenLastCalledWith(0, 0);
    });

    it('is true when a document was created remotely (total moves)', async () => {
      const docs = [summary(1, 'One')];
      const ark = fakeArk(docs, []);
      const store = new DocumentStore(ark, 100);
      await store.load(folders);

      docs.push(summary(2, 'Two'));
      expect(await store.changedSince()).toBe(true);
    });

    it('is true when the trash count moves, even if the total does not', async () => {
      const docs = [summary(1, 'One'), summary(2, 'Two')];
      const ark = fakeArk(docs, [], []);
      const store = new DocumentStore(ark, 100);
      await store.load(folders);

      ark.getTrashed = async () => [hash(2)] as any;
      expect(await store.changedSince()).toBe(true);
    });

    it('sees a trash/restore swap that leaves the trash count unchanged', async () => {
      // hash(2) is trashed, hash(1) is not. Between two checks, hash(2) is
      // restored and hash(1) is trashed instead: no document was created (the
      // total does not move) and the trash *count* is still 1 — only the
      // *member* changed. `get_trashed` already returns the hashes, not just a
      // count, so comparing membership costs nothing extra and closes what
      // used to be a documented blind spot.
      const docs = [summary(1, 'One'), summary(2, 'Two')];
      const ark = fakeArk(docs, [], [hash(2)]);
      const store = new DocumentStore(ark, 100);
      await store.load(folders);

      ark.getTrashed = async () => [hash(1)] as any;
      expect(await store.changedSince()).toBe(true);
    });

    it('cannot see an amendment, which is what the periodic full sweep is for', async () => {
      // An amendment moves neither the document total nor the trash set, so
      // no counter-or-membership check can catch it. This is the remaining
      // gap the unconditional sweep in reconcile.ts exists to close.
      const docs = [summary(1, 'One')];
      const ark = fakeArk(docs, []);
      const store = new DocumentStore(ark, 100);
      await store.load(folders);

      docs[0] = { ...docs[0], latest: hash(99), body: 'amended' };
      expect(await store.changedSince()).toBe(false);
    });
  });

  describe('reload without change', () => {
    // The five-minute backstop reconcile calls load() again on data that has
    // usually not moved. load() used to assign a brand-new Map to every
    // reactive field every time, so Svelte tore down and repainted the whole
    // view on a timer even when the archive was byte-identical. These specs
    // pin the fix: identical data must leave the reactive fields untouched,
    // by object identity.
    const build = () => {
      const docs = [summary(1, 'One'), summary(2, 'Two'), summary(3, 'Three')];
      const filings: FolderFiling[] = [
        { folder_id: 'root', documents: [hash(1)] },
        { folder_id: 'child', documents: [hash(2)] },
      ];
      const ark = fakeArk(docs, filings, [hash(3)]);
      return { docs, filings, ark, store: new DocumentStore(ark, 2) };
    };

    it('keeps the same byOriginal, filings and trashed objects when nothing changed', async () => {
      const { store } = build();
      await store.load(folders);
      const docsBefore = store.byOriginal;
      const filingsBefore = store.filings;
      const trashedBefore = store.trashed;

      const changed = await store.load(folders);

      expect(changed).toBe(false);
      expect(store.byOriginal).toBe(docsBefore);
      expect(store.filings).toBe(filingsBefore);
      expect(store.trashed).toBe(trashedBefore);
    });

    it('does not reassign byOriginal part-way through paging on a reload', async () => {
      // The corpus is paged 2 at a time, so the old code assigned a growing
      // partial map twice before landing on the full one — each assignment a
      // full repaint showing a truncated archive. A reload must never expose
      // a partial map at all.
      const { store } = build();
      await store.load(folders);
      const docsBefore = store.byOriginal;
      const seen: number[] = [];

      await store.load(folders, () => seen.push(store.byOriginal.size));

      expect(seen.every((n) => n === 3)).toBe(true);
      expect(store.byOriginal).toBe(docsBefore);
    });

    it('does assign a new byOriginal when a document was added', async () => {
      const { docs, store } = build();
      await store.load(folders);
      const docsBefore = store.byOriginal;

      docs.push(summary(4, 'Four'));
      const changed = await store.load(folders);

      expect(changed).toBe(true);
      expect(store.byOriginal).not.toBe(docsBefore);
      expect(store.byOriginal.size).toEqual(4);
    });

    it('does assign a new byOriginal when a document was amended', async () => {
      const { docs, store } = build();
      await store.load(folders);
      const docsBefore = store.byOriginal;

      // Same key, new `latest` — the shape an amendment takes.
      docs[0] = { ...docs[0], latest: hash(99), body: 'amended' };
      const changed = await store.load(folders);

      expect(changed).toBe(true);
      expect(store.byOriginal).not.toBe(docsBefore);
    });

    it('does assign new filings when a document moved folder', async () => {
      const { filings, store } = build();
      await store.load(folders);
      const filingsBefore = store.filings;

      filings[0] = { folder_id: 'root', documents: [] };
      filings[1] = { folder_id: 'child', documents: [hash(1), hash(2)] };
      const changed = await store.load(folders);

      expect(changed).toBe(true);
      expect(store.filings).not.toBe(filingsBefore);
    });

    it('does assign a new trashed set when trash membership moved', async () => {
      const { ark, store } = build();
      await store.load(folders);
      const trashedBefore = store.trashed;

      ark.getTrashed = async () => [hash(2)] as any;
      const changed = await store.load(folders);

      expect(changed).toBe(true);
      expect(store.trashed).not.toBe(trashedBefore);
    });

    it('still assigns progressively on the very first load', async () => {
      // The progressive repaint is what drives the "Loading documents… N"
      // counter on a cold start, and must survive the fix.
      const { store } = build();
      const seen: number[] = [];
      await store.load(folders, () => seen.push(store.byOriginal.size));
      expect(seen).toEqual([2, 3]);
    });
  });

  it('files a peer-created document into its folder without a reload', async () => {
    const docs = [summary(1, 'Mine')];
    const filings: FolderFiling[] = [{ folder_id: 'root', documents: [hash(1)] }];
    const ark = fakeArk(docs, filings);
    const store = new DocumentStore(ark, 100);
    await store.load(folders);

    // A peer creates a document into 'child'. The signal carries only a hash;
    // the filing is a link, so the store has to re-read filings or the document
    // appears in "all documents" but nowhere in the tree.
    docs.push(summary(2, 'Theirs'));
    filings.push({ folder_id: 'child', documents: [hash(2)] });
    await store.applySignal({ type: 'DocumentCreated', original: hash(2) });

    expect(store.inFolder('child', folders).map((d) => d.meta.title)).toEqual(['Theirs']);
  });
});
