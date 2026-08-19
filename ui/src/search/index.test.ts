import { describe, expect, it } from 'vitest';
import { encodeHashToBase64 } from '@holochain/client';
import { ArkIndex } from './index';
import type { DocumentSummary, Folder } from '../types';

const hash = (n: number) => new Uint8Array([n, n, n]) as any;

const doc = (n: number, title: string, body: string, date: string): DocumentSummary => ({
  original: hash(n),
  latest: hash(n),
  author: hash(n),
  created_at: 0,
  updated_at: 0,
  body,
  meta: { title, date },
});

const folders: Folder[] = [
  { id: 'bl', name: 'Buildings and Land', parent: null, order: 0, deleted: false },
  { id: 'bl19', name: '2019', parent: 'bl', order: 0, deleted: false },
  { id: 'cl', name: 'Community Life', parent: null, order: 1, deleted: false },
];

const docs = [
  doc(1, 'Buildings and Land, March', 'The well pump was replaced.', '2019-03-31'),
  doc(2, 'Community Life, April', 'Potluck planning and the roof.', '2021-04-02'),
  doc(3, 'Buildings and Land, May', 'Roof and gutter repairs deferred.', '2022-05-10'),
];

// Filings key by the same base64-encoded hash that ArkIndex.keyOf() and
// DocumentStore.filings use — encodeHashToBase64(hash(n)), not the bare `n`.
const filings = new Map([
  [encodeHashToBase64(hash(1)), 'bl19'],
  [encodeHashToBase64(hash(2)), 'cl'],
  [encodeHashToBase64(hash(3)), 'bl'],
]);

function makeIndex() {
  const index = new ArkIndex();
  index.rebuild(docs);
  return index;
}

const noFilters = {
  folderId: null,
  folders,
  from: null,
  to: null,
  author: null,
  includeTrashed: false,
};

describe('ArkIndex', () => {
  it('ranks a title match above a body-only match', () => {
    const hits = makeIndex().search('roof', noFilters);
    expect(hits.length).toBeGreaterThan(0);
    // Both doc 2 and doc 3 mention roof in the body only; adding it to a title
    // must lift that document to the top.
    const index = makeIndex();
    index.upsert(doc(4, 'Roof replacement', 'Unrelated body text.', '2023-01-01'));
    const ranked = index.search('roof', noFilters);
    expect(ranked[0].doc.meta.title).toEqual('Roof replacement');
  });

  it('returns a snippet with the matched term marked', () => {
    const hits = makeIndex().search('pump', noFilters);
    expect(hits[0].snippet.text).toContain('pump');
    expect(hits[0].snippet.marks.length).toBeGreaterThan(0);
  });

  // An empty query used to be a browse: everything passing the filters,
  // ordered by date. That fell through when the box was simply cleared while
  // a filter (or "include trashed") was still set, silently presenting the
  // whole archive as search output — a reported bug. Browsing-by-filter-alone
  // was a deliberate capability and this is the deliberate removal of it: an
  // empty query now always yields zero hits, filters or not.
  it('returns nothing for an empty query, even with a folder filter set', () => {
    const index = makeIndex();
    index.setFilings(filings);
    expect(index.search('', { ...noFilters, folderId: 'bl' })).toEqual([]);
  });

  it('returns nothing for an empty query, even with an author filter set', () => {
    const index = makeIndex();
    const mine = encodeHashToBase64(hash(2));
    expect(index.search('', { ...noFilters, author: mine })).toEqual([]);
  });

  it('returns nothing for an empty query, even with a date range set', () => {
    expect(makeIndex().search('', { ...noFilters, from: '2021-01-01', to: '2021-12-31' })).toEqual(
      [],
    );
  });

  it('returns nothing for an empty query with no filters at all', () => {
    expect(makeIndex().search('', noFilters)).toEqual([]);
  });

  it('returns nothing for an empty query even with includeTrashed set', () => {
    expect(makeIndex().search('', { ...noFilters, includeTrashed: true })).toEqual([]);
  });

  // Coverage that the browse removal above deletes: folder/author/date-range
  // filtering is still exercised, now via an actual search term rather than
  // an empty one, since that is the only way any of these filters get
  // applied any more (besides the exclusion-only path below).
  it('filters a real search by folder, including descendants', () => {
    const index = makeIndex();
    index.setFilings(filings);
    const hits = index.search('buildings', { ...noFilters, folderId: 'bl' });
    expect(hits.map((h) => h.doc.meta.title).sort()).toEqual([
      'Buildings and Land, March',
      'Buildings and Land, May',
    ]);
  });

  // The reported bug: App.svelte used to pass the tree's selected folder
  // straight through as the search filter, so an unscoped search silently
  // inherited whatever was selected in the tree. With no folderId, a document
  // must match regardless of `filings` state — including the exact state a
  // stale or not-yet-loaded tree selection left behind, an empty filings map.
  it('matches regardless of filings state when no folder scope is set', () => {
    const withNoFilings = makeIndex();
    expect(withNoFilings.search('roof', noFilters).length).toBe(2);

    const withFilings = makeIndex();
    withFilings.setFilings(filings);
    expect(withFilings.search('roof', noFilters).length).toBe(2);
  });

  // Companion to the above: scoping must still narrow correctly once a caller
  // actually asks for it. This is the behaviour the fix must not regress.
  it('still narrows to a folder and its descendants when scope is explicitly requested', () => {
    const index = makeIndex();
    index.setFilings(filings);
    const hits = index.search('roof', { ...noFilters, folderId: 'bl' });
    expect(hits.map((h) => h.doc.meta.title).sort()).toEqual(['Buildings and Land, May']);
  });

  // Decision for a document whose folder is not yet known — the tree may
  // still be arriving from other peers. An unscoped search must still find
  // it (never silently exclude); a scoped one excludes it, the same as any
  // other folder mismatch, because "in this folder" cannot be claimed for a
  // location that isn't known yet. The scoped-zero-results fallback in
  // SearchBar is what recovers a document dropped for this reason.
  it('excludes a document of unknown location from a scoped search, never from an unscoped one', () => {
    const index = makeIndex();
    index.upsert(doc(4, 'Buildings and Land, unknown filing', 'Roof survey pending.', '2024-01-01'));
    index.setFilings(filings); // doc 4 has no entry — its filing is not yet known

    expect(index.search('roof', noFilters).map((h) => h.doc.meta.title)).toContain(
      'Buildings and Land, unknown filing',
    );

    const scoped = index.search('roof', { ...noFilters, folderId: 'bl' });
    expect(scoped.map((h) => h.doc.meta.title)).not.toContain('Buildings and Land, unknown filing');
  });

  it('filters a real search by author', () => {
    const index = makeIndex();
    const mine = encodeHashToBase64(hash(2));
    const hits = index.search('roof', { ...noFilters, author: mine });
    expect(hits.map((h) => h.doc.meta.title)).toEqual(['Community Life, April']);
  });

  it('filters a real search by date range', () => {
    const hits = makeIndex().search('roof', { ...noFilters, from: '2021-01-01', to: '2021-12-31' });
    expect(hits.map((h) => h.doc.meta.title)).toEqual(['Community Life, April']);
  });

  it('honours phrase and exclusion in the query', () => {
    const index = makeIndex();
    expect(index.search('"well pump"', noFilters).map((h) => h.doc.meta.title)).toEqual([
      'Buildings and Land, March',
    ]);
    const excluded = index.search('roof -gutter', noFilters);
    expect(excluded.map((h) => h.doc.meta.title)).toEqual(['Community Life, April']);
  });

  it('matches by prefix', () => {
    expect(makeIndex().search('repla', noFilters).length).toBeGreaterThan(0);
  });

  it('applies an exclusion that is the whole query', () => {
    // `-roof` alone means "everything except roof". Treating a term-less query
    // as a plain browse would return the entire archive, exclusion ignored.
    const titles = makeIndex()
      .search('-roof', noFilters)
      .map((h) => h.doc.meta.title);
    expect(titles).toEqual(['Buildings and Land, March']);
  });

  it('combines a whole-query exclusion with a filter', () => {
    const index = makeIndex();
    index.setFilings(filings);
    const hits = index.search('-roof', { ...noFilters, folderId: 'bl' });
    expect(hits.map((h) => h.doc.meta.title)).toEqual(['Buildings and Land, March']);
  });

  it('finds text inside an attachment and names it', () => {
    const index = makeIndex();
    index.setAttachmentText(hash(2), 'budget.csv', 'line item,amount\nwellhouse,4200\n');
    const hits = index.search('wellhouse', noFilters);
    expect(hits).toHaveLength(1);
    expect(hits[0].field).toEqual('attachment');
    expect(hits[0].attachmentName).toEqual('budget.csv');
  });

  it('stops matching an attachment once its text is removed', () => {
    const index = makeIndex();
    index.setAttachmentText(hash(2), 'budget.csv', 'line item,amount\nwellhouse,4200\n');
    expect(index.search('wellhouse', noFilters)).toHaveLength(1);

    // Detaching a file must not leave it searchable under a document that no
    // longer has it.
    index.removeAttachmentText(hash(2), 'budget.csv');
    expect(index.search('wellhouse', noFilters)).toEqual([]);
  });

  it('drops a removed document from results', () => {
    const index = makeIndex();
    index.remove(hash(1));
    expect(index.search('pump', noFilters)).toEqual([]);
  });

  it('excludes trashed documents unless asked', () => {
    const index = makeIndex();
    index.setTrashed(new Set([index.keyOf(hash(1))]));
    expect(index.search('pump', noFilters)).toEqual([]);
    expect(index.search('pump', { ...noFilters, includeTrashed: true })).toHaveLength(1);
  });
});
