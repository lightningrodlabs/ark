import { describe, expect, it } from 'vitest';
import { mergeRanges, termRanges } from './terms';

const at = (text: string, ranges: [number, number][]) =>
  ranges.map(([s, e]) => text.slice(s, e));

describe('termRanges', () => {
  it('finds every occurrence of every term', () => {
    const text = 'pump and pump again, plus a well';
    expect(at(text, termRanges(text, ['pump', 'well']))).toEqual(['pump', 'pump', 'well']);
  });

  it('extends a prefix match to the end of the word', () => {
    const text = 'the treasurer reported';
    expect(at(text, termRanges(text, ['treasur']))).toEqual(['treasurer']);
  });

  // termRanges and matchesParsed must agree on where a word ends, or a row
  // highlights one span and the document you land in highlights another.
  // Both take the rule from ./words.
  it('extends a prefix match through an accented letter', () => {
    const text = 'the café reopened';
    expect(at(text, termRanges(text, ['caf']))).toEqual(['café']);
  });

  it('is case insensitive but reports the text as written', () => {
    const text = 'The Treasurer';
    expect(at(text, termRanges(text, ['TREASUR']))).toEqual(['Treasurer']);
  });

  it('matches a multi-word term as one run, which is what a phrase needs', () => {
    const text = 'the well pump was replaced';
    expect(at(text, termRanges(text, ['well pump']))).toEqual(['well pump']);
  });

  it('ignores empty terms and returns nothing for no terms', () => {
    expect(termRanges('anything', ['', '  '.trim()])).toEqual([]);
    expect(termRanges('anything', [])).toEqual([]);
  });

  it('sorts by start offset across terms', () => {
    const text = 'roof then well';
    expect(termRanges(text, ['well', 'roof']).map(([s]) => s)).toEqual([0, 10]);
  });
});

describe('mergeRanges', () => {
  it('joins overlapping runs so a shared prefix is marked once', () => {
    const text = 'the budgets were approved';
    // "budget" and "budgets" both match at the same offset.
    expect(at(text, mergeRanges(termRanges(text, ['budget', 'budgets'])))).toEqual(['budgets']);
  });

  it('leaves disjoint runs alone', () => {
    expect(mergeRanges([[0, 3], [5, 8]])).toEqual([[0, 3], [5, 8]]);
  });

  it('joins runs that merely touch', () => {
    expect(mergeRanges([[0, 3], [3, 8]])).toEqual([[0, 8]]);
  });
});
