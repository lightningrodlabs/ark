import { describe, expect, it } from 'vitest';
import { ArkIndex, type NearMatchMode, type SearchFilters } from './index';
import type { DocumentSummary, Folder } from '../types';

/**
 * Near matches as a three-way choice rather than a switch.
 *
 * The fallback shipped first, and it can only answer "what if nothing
 * matched". It cannot answer the case this mode exists for: the archive
 * ITSELF holds the misspelling. Someone typed `Jeen` into one document in
 * 2011; searching `Jean` finds the correctly spelled ones, and that document
 * is invisible forever. `always` is the mode that surfaces it — at the price
 * of `bean`, `mean` and `sean`, which is why the near ones must stay visibly
 * separate and come last.
 *
 * All fixture text is invented. It reproduces the SHAPES the reference corpus
 * has — a common name with a cloud of near neighbours in ordinary prose, and
 * one typo of that name sitting in the archive — and nothing else.
 */

const hash = (n: number) => new Uint8Array([n, n, n]) as any;

const doc = (n: number, title: string, body: string): DocumentSummary => ({
  original: hash(n),
  latest: hash(n),
  author: hash(n),
  created_at: 0,
  updated_at: 0,
  body,
  meta: { title, date: `2026-01-${String(n).padStart(2, '0')}` },
});

const folders: Folder[] = [
  { id: 'bl', name: 'Buildings and Land', parent: null, order: 0, deleted: false },
];

// Two documents spell `Jean` correctly. One — doc 5 — is the archive's own
// typo, and is the entire reason `always` exists. The rest are the noise
// `always` unavoidably brings with it: each is one edit from `jean`.
const docs = [
  doc(1, 'Buildings and Land, January', 'Jean opened the meeting and read the minutes.'),
  doc(2, 'Buildings and Land, February', 'The bean beds were turned over before the frost.'),
  doc(3, 'Buildings and Land, March', 'A mean of four hours per week was agreed for the rota.'),
  doc(4, 'Sean on the culvert', 'The culvert survey was tabled until the next meeting.'),
  doc(5, 'Buildings and Land, May', 'Jeen confirmed the gutter repairs were finished.'),
  doc(6, 'Buildings and Land, June', 'Jean tabled the fence line report.'),
];

const filtersFor = (nearMatches: NearMatchMode): SearchFilters => ({
  folderId: null,
  folders,
  from: null,
  to: null,
  author: null,
  includeTrashed: false,
  nearMatches,
});

function makeIndex(): ArkIndex {
  const index = new ArkIndex();
  index.rebuild(docs);
  return index;
}

const titles = (hits: { doc: DocumentSummary }[]) => hits.map((h) => h.doc.meta.title);

describe('near-match modes', () => {
  it('surfaces a misspelling that lives in the archive itself', () => {
    // The whole reason this mode exists. `Jeen` is in the corpus, not in the
    // query; no exact or prefix search can ever reach it, and the fallback
    // cannot either because `jean` has real answers.
    const { hits, exactCount, nearMatch } = makeIndex().search('jean', filtersFor('always'));

    const typo = hits.find((h) => h.doc.meta.title === 'Buildings and Land, May');
    expect(typo, 'the document spelled Jeen must be reachable from a search for Jean').toBeDefined();
    expect(typo!.near).toBe(true);
    expect(typo!.highlight).toEqual(['jeen']);
    // And it marks the word it actually matched, so the row explains itself.
    const marked = typo!.snippet.marks.map(([s, e]) => typo!.snippet.text.slice(s, e).toLowerCase());
    expect(marked).toContain('jeen');

    // It arrives after the correctly spelled ones, never among them.
    expect(hits.indexOf(typo!)).toBeGreaterThanOrEqual(exactCount);
    expect(nearMatch!.terms).toContain('jeen');
  });

  it('always: exact hits first in their own order, near ones appended and flagged', () => {
    const exactOnly = makeIndex().search('jean', filtersFor('fallback'));
    const { hits, exactCount, nearMatch } = makeIndex().search('jean', filtersFor('always'));

    expect(exactCount).toBe(exactOnly.hits.length);
    // Byte for byte the same rows, in the same order, at the front.
    expect(titles(hits.slice(0, exactCount))).toEqual(titles(exactOnly.hits));
    expect(hits.slice(0, exactCount).every((h) => !h.near)).toBe(true);

    // And the near ones — the noise — are all behind them and all flagged.
    expect(hits.length).toBeGreaterThan(exactCount);
    expect(hits.slice(exactCount).every((h) => h.near)).toBe(true);
    expect(titles(hits.slice(exactCount)).sort()).toEqual(
      ['Buildings and Land, February', 'Buildings and Land, March', 'Buildings and Land, May', 'Sean on the culvert'].sort(),
    );
    expect(nearMatch).not.toBeNull();
    expect(nearMatch!.query).toEqual(['jean']);
  });

  it('always: a document that is both an exact and a near hit appears once, as exact', () => {
    const { hits, exactCount } = makeIndex().search('jean', filtersFor('always'));
    const ids = hits.map((h) => h.doc.meta.title);
    expect(new Set(ids).size).toBe(ids.length);
    // The fuzzy pass returns the exact documents too — prefix and distance-0
    // both still match. They must not come back a second time as near.
    expect(hits.slice(exactCount).map((h) => h.doc.meta.title)).not.toContain(
      'Buildings and Land, January',
    );
  });

  it('always: still reports nothing near when there is nothing near', () => {
    const { hits, exactCount, nearMatch } = makeIndex().search('culvert', filtersFor('always'));
    expect(exactCount).toBe(hits.length);
    expect(nearMatch).toBeNull();
  });

  it('always: a query with no exact hits behaves exactly like the fallback', () => {
    const always = makeIndex().search('zzzxxx', filtersFor('always'));
    const fallback = makeIndex().search('zzzxxx', filtersFor('fallback'));
    expect(always).toEqual(fallback);
  });

  it('fallback: unchanged — no near matches while exact hits exist', () => {
    const { hits, exactCount, nearMatch } = makeIndex().search('jean', filtersFor('fallback'));
    expect(nearMatch).toBeNull();
    expect(exactCount).toBe(hits.length);
    expect(titles(hits).sort()).toEqual(
      ['Buildings and Land, January', 'Buildings and Land, June'].sort(),
    );
    expect(hits.every((h) => !h.near)).toBe(true);
  });

  it('fallback: still falls back when nothing matches exactly', () => {
    const { hits, exactCount, nearMatch } = makeIndex().search('jeon', filtersFor('fallback'));
    expect(exactCount).toBe(0);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.near)).toBe(true);
    expect(nearMatch).not.toBeNull();
  });

  it('never: zero means zero, and no fallback is offered', () => {
    const { hits, exactCount, nearMatch } = makeIndex().search('jeon', filtersFor('never'));
    expect(hits).toEqual([]);
    expect(exactCount).toBe(0);
    expect(nearMatch).toBeNull();

    // An exact query is untouched by the mode.
    const exact = makeIndex().search('jean', filtersFor('never'));
    expect(titles(exact.hits).sort()).toEqual(
      ['Buildings and Land, January', 'Buildings and Land, June'].sort(),
    );
  });

  it('every hit in every mode carries something the app can point at', () => {
    // The standing invariant: a result the user can see is a result the app
    // can explain. `always` doubles the number of rows, so it doubles the
    // number of chances to ship an unmarkable one.
    const index = makeIndex();
    for (const mode of ['fallback', 'always', 'never'] as NearMatchMode[]) {
      for (const query of ['jean', 'jeon', 'culver', 'gutter', 'sean']) {
        for (const hit of index.search(query, filtersFor(mode)).hits) {
          const where = `${mode} / ${query} / ${hit.doc.meta.title}`;
          expect(hit.highlight.length, where).toBeGreaterThan(0);
          const haystack = `${hit.doc.meta.title ?? ''}\n${hit.doc.body}`.toLowerCase();
          expect(hit.highlight.some((t) => haystack.includes(t)), where).toBe(true);
          expect(hit.snippet.marks.length + (hit.field === 'title' ? 1 : 0), where).toBeGreaterThan(
            0,
          );
        }
      }
    }
  });

  it('never and always leave exclusion-only and empty queries alone', () => {
    for (const mode of ['fallback', 'always', 'never'] as NearMatchMode[]) {
      const excluded = makeIndex().search('-jean', filtersFor(mode));
      expect(excluded.hits.length).toBe(4);
      expect(excluded.nearMatch).toBeNull();
      expect(excluded.exactCount).toBe(4);
      expect(makeIndex().search('', filtersFor(mode)).hits).toEqual([]);
    }
  });
});
