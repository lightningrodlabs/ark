import { describe, expect, it, vi } from 'vitest';
import { encodeHashToBase64 } from '@holochain/client';
import { ArkIndex, type SearchFilters, type SearchHit } from './index';
import { generateCorpus } from '../../scripts/generate-corpus';
import { DocumentStore } from '../stores/documents.svelte';
import { SearchStore } from '../stores/search.svelte';
import type { ArkClient } from '../ark-client';
import type { DocumentSummary, Folder } from '../types';

/**
 * The initial load feeds each arriving page into the index instead of
 * rebuilding once at the end. The whole risk of that change is that the index
 * it leaves behind is *almost* the one `rebuild()` would have built — a
 * different ranking, a missing filing, an attachment that never made it in —
 * with nothing visibly wrong to notice. So this file's job is not "incremental
 * indexing returns results": it is that the two indexes answer identically,
 * hit for hit, score for score.
 */

/** Big enough that BM25 has real ranking pressure, small enough to stay fast. */
const CORPUS = 600;
const PAGE = 100;

const docs = generateCorpus(CORPUS, 7);

const folders: Folder[] = [
  { id: 'a', name: 'Committee A', parent: null, order: 0, deleted: false },
  { id: 'a19', name: '2019', parent: 'a', order: 0, deleted: false },
  { id: 'b', name: 'Committee B', parent: null, order: 1, deleted: false },
];

const keyOf = (doc: DocumentSummary) => encodeHashToBase64(doc.original);

/** Every fourth document filed one level down, every seventh nowhere at all. */
const filings = new Map<string, string | null>(
  docs.map((doc, i) => [keyOf(doc), i % 7 === 0 ? null : i % 4 === 0 ? 'a19' : i % 2 ? 'b' : 'a']),
);
const trashed = new Set(docs.filter((_, i) => i % 17 === 0).map(keyOf));

/** Attachment text on a scattering of documents. */
const attachments = new Map<string, { name: string; text: string }>(
  docs
    .filter((_, i) => i % 23 === 0)
    .map((doc, n) => [
      keyOf(doc),
      { name: `scan-${n}.txt`, text: `Scanned appendix ${n}: septic easement and the culvert survey.` },
    ]),
);

const baseFilters: SearchFilters = {
  folderId: null,
  folders,
  from: null,
  to: null,
  author: null,
  includeTrashed: false,
  nearMatches: 'fallback',
};

const queries = [
  'budget',
  'treasur',
  'roof gutter',
  '"well pump"',
  'minutes -draft',
  'septic easement',
  'culvert',
  'approved deferred proposal',
];

const filterCases: { name: string; filters: SearchFilters }[] = [
  { name: 'no filters', filters: baseFilters },
  { name: 'folder scope (with descendants)', filters: { ...baseFilters, folderId: 'a' } },
  { name: 'leaf folder scope', filters: { ...baseFilters, folderId: 'a19' } },
  { name: 'including trashed', filters: { ...baseFilters, includeTrashed: true } },
  { name: 'date range', filters: { ...baseFilters, from: '2010-01-01', to: '2015-12-31' } },
  {
    name: 'author',
    filters: { ...baseFilters, author: encodeHashToBase64(docs[0].author) },
  },
];

/** Everything about a hit that a user can see, in the order it was ranked. */
const shape = (hits: SearchHit[]) =>
  hits.map((hit) => ({
    id: encodeHashToBase64(hit.doc.original),
    score: hit.score,
    field: hit.field,
    attachmentName: hit.attachmentName,
    snippet: hit.snippet,
  }));

/**
 * The index as the old boot built it: whole corpus in one `rebuild()` at the
 * end of the load, attachment text applied afterwards (nothing extracts
 * attachment text during a load — see DocumentView/ImportPanel, the only two
 * callers).
 */
function rebuilt(): ArkIndex {
  const index = new ArkIndex();
  index.rebuild(docs);
  applyAttachments(index);
  index.setFilings(filings);
  index.setTrashed(trashed);
  return index;
}

/**
 * The index as the new boot builds it: filings and trash first (they are one
 * call each and are read before paging starts), then a page at a time.
 * `pages` may repeat itself — that is the overlapping-retry case.
 */
function incremental(pages: DocumentSummary[][]): ArkIndex {
  const index = new ArkIndex();
  index.setFilings(filings);
  index.setTrashed(trashed);
  for (const page of pages) index.upsertAll(page);
  applyAttachments(index);
  return index;
}

/** In document order, the same order both builders see them in. */
function applyAttachments(index: ArkIndex): void {
  for (const doc of docs) {
    const attachment = attachments.get(keyOf(doc));
    if (attachment) index.setAttachmentText(doc.original, attachment.name, attachment.text);
  }
}

function paginate(list: DocumentSummary[], size: number): DocumentSummary[][] {
  const pages: DocumentSummary[][] = [];
  for (let offset = 0; offset < list.length; offset += size) {
    pages.push(list.slice(offset, offset + size));
  }
  return pages;
}

describe('an incrementally built index equals a rebuilt one', () => {
  const pages = paginate(docs, PAGE);

  // Both sides are built FRESH for every comparison, never shared between
  // tests. Searching an index mutates it — MiniSearch cleans up the postings
  // a `discard` left behind lazily, during the first search that walks them —
  // so a reference index reused across tests has been quietly warmed, and
  // comparing a cold index against a warm one fails on differences neither
  // path would ever show a user.
  const compare = (built: ArkIndex, filters: SearchFilters, label: string) => {
    const reference = rebuilt();
    for (const query of queries) {
      expect(shape(built.search(query, filters).hits), `${query} / ${label}`).toEqual(
        shape(reference.search(query, filters).hits),
      );
    }
  };

  it('has a corpus worth comparing over', () => {
    // A comparison over a corpus that answers nothing proves nothing.
    const reference = rebuilt();
    const total = queries.reduce((sum, q) => sum + reference.search(q, baseFilters).hits.length, 0);
    expect(total).toBeGreaterThan(100);
    expect(reference.search('culvert', baseFilters).hits.length).toBeGreaterThan(0);
  });

  for (const { name, filters } of filterCases) {
    it(`answers identically under ${name}`, () => {
      compare(incremental(pages), filters, name);
    });
  }

  it('finds attachment text under its parent document, ranked the same', () => {
    const built = incremental(pages);
    const hits = built.search('culvert', baseFilters).hits;
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.field === 'attachment')).toBe(true);
    expect(shape(hits)).toEqual(shape(rebuilt().search('culvert', baseFilters).hits));
  });

  it('is unchanged by a replayed page', () => {
    // A page that arrives twice — a retry, or a re-page after a short read —
    // must not double-count anything. MiniSearch's `discard` leaves the old
    // posting entries in the inverted index until a vacuum and `termResults`
    // counts them in the document frequency it feeds to BM25, so a pointless
    // discard/add pair does not merely cost time: it moves scores.
    for (const { name, filters } of filterCases) {
      compare(incremental([pages[0], pages[1], pages[1], ...pages.slice(2), pages[0]]), filters, name);
    }
  });

  it('is unchanged by a page whose documents overlap the previous one', () => {
    const overlapping = [docs.slice(0, 150), docs.slice(100, 300), docs.slice(250)];
    compare(incremental(overlapping), baseFilters, 'overlapping pages');
  });

  it('still re-indexes a document whose text actually changed', () => {
    // The idempotence guard must not swallow a real amendment: same original
    // hash, new body.
    const built = incremental(pages);
    // Document 1: neither trashed nor carrying an attachment, so nothing else
    // explains its presence or absence in a result set.
    const amended = { ...docs[1], body: 'The palapa roof was rethatched by the crew.' };
    built.upsert(amended);
    expect(
      built.search('palapa', baseFilters).hits.map((h) => encodeHashToBase64(h.doc.original)),
    ).toEqual([keyOf(docs[1])]);
    // And the old text is gone from it, not merely outranked.
    const before = new Set(
      rebuilt()
        .search('attendance', baseFilters).hits
        .map((h) => encodeHashToBase64(h.doc.original)),
    );
    const after = new Set(
      built.search('attendance', baseFilters).hits.map((h) => encodeHashToBase64(h.doc.original)),
    );
    expect(before.has(keyOf(docs[1]))).toBe(true);
    expect(after.has(keyOf(docs[1]))).toBe(false);
  });
});

/**
 * The same equivalence, one level up: the actual boot path — `DocumentStore.load`
 * paging, `SearchStore` indexing each page as it lands, filings and trash read
 * around it — against `SearchStore.rebuild()` over the finished corpus. The
 * index-level tests above cannot catch a caller that forgets a page, hands over
 * the wrong list, or leaves the index pointing at a stale filings map.
 */
describe('the boot path leaves the index a rebuild would have left', () => {
  const corpus = docs.slice(0, 300);
  const bootFolders: Folder[] = folders;

  function fakeArk(chunkTotal = corpus.length): ArkClient {
    return {
      getAllDocuments: vi.fn(async (offset: number, limit: number) => ({
        total: chunkTotal,
        documents: corpus.slice(offset, offset + limit),
      })),
      getFilings: vi.fn(async (ids: string[]) =>
        ids.map((id) => ({
          folder_id: id,
          documents: corpus.filter((d) => filings.get(keyOf(d)) === id).map((d) => d.original),
        })),
      ),
      getTrashed: vi.fn(async () => corpus.filter((d) => trashed.has(keyOf(d))).map((d) => d.original)),
    } as unknown as ArkClient;
  }

  async function boot(index: 'incremental' | 'rebuild'): Promise<SearchStore> {
    const store = new DocumentStore(fakeArk(), 50);
    const search = new SearchStore(store);
    if (index === 'incremental') {
      await store.load(bootFolders, (_loaded, _total, documents) => search.upsertAll(documents));
      search.sync();
    } else {
      await store.load(bootFolders);
      search.rebuild();
    }
    return search;
  }

  it('answers every query the same way, filings and trash included', async () => {
    const incrementalBoot = await boot('incremental');
    const rebuildBoot = await boot('rebuild');
    for (const { name, filters } of filterCases) {
      for (const query of queries) {
        incrementalBoot.query = query;
        rebuildBoot.query = query;
        incrementalBoot.includeTrashed = filters.includeTrashed;
        rebuildBoot.includeTrashed = filters.includeTrashed;
        incrementalBoot.from = filters.from;
        rebuildBoot.from = filters.from;
        incrementalBoot.to = filters.to;
        rebuildBoot.to = filters.to;
        incrementalBoot.author = filters.author;
        rebuildBoot.author = filters.author;
        const scope = filters.folderId ? { id: filters.folderId, label: filters.folderId } : null;
        incrementalBoot.folderScope = scope;
        rebuildBoot.folderScope = scope;
        expect(shape(incrementalBoot.run(bootFolders).hits), `${query} / ${name}`).toEqual(
          shape(rebuildBoot.run(bootFolders).hits),
        );
      }
    }
  });

  it('sees a filing that only the load-closing read knows about', async () => {
    // Filings are read before paging starts on a cold load, so they are there
    // as pages land — but a document filed by someone else DURING the load is
    // only in the second read, at the end. `search.sync()` after the load is
    // what makes the index see it, and it is the same thing `rebuild()` used
    // to do on its way out.
    const store = new DocumentStore(fakeArk(), 50);
    const search = new SearchStore(store);
    let reads = 0;
    const late = corpus[0];
    (store as unknown as { ark: ArkClient }).ark = {
      ...fakeArk(),
      getFilings: vi.fn(async (ids: string[]) =>
        ids.map((id) => ({
          folder_id: id,
          documents: corpus
            .filter((d) => (d === late && reads > 0 ? id === 'b' : filings.get(keyOf(d)) === id))
            .map((d) => d.original),
        })),
      ),
      getTrashed: vi.fn(async () => {
        reads += 1;
        return [];
      }),
    } as unknown as ArkClient;

    await store.load(bootFolders, (_loaded, _total, documents) => search.upsertAll(documents));
    search.sync();

    search.query = 'minutes';
    search.folderScope = { id: 'b', label: 'b' };
    const hits = search.run(bootFolders).hits.map((h) => encodeHashToBase64(h.doc.original));
    expect(hits).toContain(keyOf(late));
  });
});
