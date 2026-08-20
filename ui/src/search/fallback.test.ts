import { describe, expect, it } from 'vitest';
import { ArkIndex, type SearchFilters } from './index';
import type { DocumentSummary, Folder } from '../types';

/**
 * Near matches as a labelled fallback rather than as silent padding.
 *
 * The reported symptom was a missing highlight: results kept coming after the
 * marks stopped. The cause was that every search ran with `fuzzy: 0.2`, so a
 * hit did not have to contain the query at all — the snippet and the
 * in-document highlight both look for the literal string, found nothing, and
 * rendered blank. Half of those results were not answers to the question
 * either: *bean* and *mean* are not *Jean*.
 *
 * All fixture text here is invented. It reproduces the SHAPES the reference
 * corpus has — a personal name one substitution away from a plausible typo,
 * and a common name with a cloud of near neighbours in ordinary prose — and
 * nothing else.
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

// `asif` is one substitution from `asdf`; `qwerty` is one edit from nothing
// here. `bean`, `mean` and `sean` are each one edit from `jean`.
const docs = [
  doc(1, 'Buildings and Land, January', 'Asif walked the fence line and reported no damage.'),
  doc(2, 'Buildings and Land, February', 'Jean opened the meeting and read the minutes.'),
  doc(3, 'Buildings and Land, March', 'The bean beds were turned over before the frost.'),
  doc(4, 'Buildings and Land, April', 'A mean of four hours per week was agreed for the rota.'),
  doc(5, 'Sean on the culvert', 'The culvert survey was tabled until the next meeting.'),
  doc(6, 'Buildings and Land, June', 'Jean confirmed the gutter repairs were finished.'),
];

const noFilters: SearchFilters = {
  folderId: null,
  folders,
  from: null,
  to: null,
  author: null,
  includeTrashed: false,
  nearMatches: true,
};

function makeIndex(): ArkIndex {
  const index = new ArkIndex();
  index.rebuild(docs);
  return index;
}

describe('near-match fallback', () => {
  it('does not pad an exact-match query with near matches', () => {
    // The reported `jean` case: the archive holds `bean`, `mean` and `sean`
    // too, and every one of them used to come back as a result the app could
    // not highlight. A query with real answers gets only its real answers.
    const { hits, nearMatch } = makeIndex().search('jean', noFilters);

    expect(nearMatch).toBeNull();
    expect(hits.map((h) => h.doc.meta.title)).toEqual([
      'Buildings and Land, February',
      'Buildings and Land, June',
    ]);
  });

  it('returns nothing at all for a query nothing is near', () => {
    expect(makeIndex().search('zzzxxx', noFilters).hits).toEqual([]);
    expect(makeIndex().search('zzzxxx', noFilters).nearMatch).toBeNull();
  });

  it('falls back to near matches only when the exact search finds nothing', () => {
    // `asdf` appears nowhere. Before this fix it returned hits anyway — every
    // one of them matching the index term `asif`, none of them containing the
    // query, all of them rendered with an empty snippet.
    const { hits, nearMatch } = makeIndex().search('asdf', noFilters);

    expect(hits.length).toBeGreaterThan(0);
    expect(nearMatch).not.toBeNull();
    expect(nearMatch!.query).toEqual(['asdf']);
    expect(nearMatch!.terms).toEqual(['asif']);
  });

  it('highlights the term that actually matched, not the query', () => {
    const { hits } = makeIndex().search('asdf', noFilters);

    for (const hit of hits) {
      // The whole point: a result the user can see is a result the app can
      // justify. Every hit names what it matched, and marks it.
      expect(hit.highlight).toEqual(['asif']);
      expect(hit.snippet.marks.length).toBeGreaterThan(0);
      const marked = hit.snippet.marks.map(([s, e]) => hit.snippet.text.slice(s, e).toLowerCase());
      expect(marked).toContain('asif');
    }
  });

  it('never returns a hit it cannot mark somewhere', () => {
    // Every term-bearing query, exact or fallback, over every document: no
    // result may reach the user with nothing to point at. "No visible
    // highlight on a returned hit" is the defect class, not a cosmetic issue.
    const index = makeIndex();
    for (const query of ['jean', 'asdf', 'culver', 'sean', 'gutter']) {
      for (const hit of index.search(query, noFilters).hits) {
        expect(hit.highlight.length, `${query} / ${hit.doc.meta.title}`).toBeGreaterThan(0);
        const haystack = `${hit.doc.meta.title ?? ''}\n${hit.doc.body}`.toLowerCase();
        expect(
          hit.highlight.some((t) => haystack.includes(t)),
          `${query} / ${hit.doc.meta.title}`,
        ).toBe(true);
      }
    }
  });

  it('labels the field a near match was found in', () => {
    const index = makeIndex();
    index.setAttachmentText(hash(5), 'ledger.txt', 'Invoice approved for the culvert works.');

    // Body: `asif` is in doc 1's body, not its title.
    expect(index.search('asdf', noFilters).hits[0].field).toEqual('body');

    // Title: `sean` appears only in doc 5's title. A near-match hit used to
    // fall through the literal-inclusion tests and be labelled a title match
    // by accident — right here for the wrong reason, and wrong everywhere
    // else.
    const titleHit = index.search('seen', noFilters).hits.find((h) => h.doc.meta.title === 'Sean on the culvert');
    expect(titleHit?.field).toEqual('title');

    // Attachment: `invoice` is only in the attachment text.
    const attachmentHit = index.search('invoive', noFilters).hits[0];
    expect(attachmentHit.field).toEqual('attachment');
    expect(attachmentHit.attachmentName).toEqual('ledger.txt');
    expect(attachmentHit.snippet.marks.length).toBeGreaterThan(0);
  });

  it('offers no fallback when near matches are turned off', () => {
    const strict = { ...noFilters, nearMatches: false };
    const { hits, nearMatch } = makeIndex().search('asdf', strict);

    expect(hits).toEqual([]);
    expect(nearMatch).toBeNull();

    // And an exact query is completely unaffected by the switch.
    expect(makeIndex().search('jean', strict).hits).toHaveLength(2);
  });

  it('keeps prefix matching, which is not what was turned off', () => {
    // `financ` finding *financial* is the useful behaviour and has nothing to
    // do with fuzziness. It must still be an EXACT hit, with no fallback.
    const { hits, nearMatch } = makeIndex().search('culver', noFilters);
    expect(hits.length).toBeGreaterThan(0);
    expect(nearMatch).toBeNull();
    expect(hits[0].highlight).toEqual(['culver']);
  });

  it('does not fall back for an exclusion-only query', () => {
    // `-jean` is a reason documents are absent, never a query to find near
    // matches for. It has its own path and must keep it.
    const { hits, nearMatch } = makeIndex().search('-jean', noFilters);
    expect(hits.length).toEqual(4);
    expect(nearMatch).toBeNull();
  });

  it('does not fall back for an empty query', () => {
    expect(makeIndex().search('', noFilters)).toEqual({ hits: [], nearMatch: null });
  });
});
