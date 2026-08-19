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

  it('filters by folder including descendants', () => {
    const index = makeIndex();
    index.setFilings(filings);
    const hits = index.search('', { ...noFilters, folderId: 'bl' });
    expect(hits.map((h) => h.doc.meta.title).sort()).toEqual([
      'Buildings and Land, March',
      'Buildings and Land, May',
    ]);
  });

  it('filters by author', () => {
    const index = makeIndex();
    const mine = encodeHashToBase64(hash(2));
    const hits = index.search('', { ...noFilters, author: mine });
    expect(hits.map((h) => h.doc.meta.title)).toEqual(['Community Life, April']);
  });

  it('filters by date range', () => {
    const hits = makeIndex().search('', { ...noFilters, from: '2021-01-01', to: '2021-12-31' });
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
