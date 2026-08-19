import { describe, expect, it } from 'vitest';
import { matchesParsed, parseQuery } from './query';

describe('parseQuery', () => {
  it('splits bare words into AND terms', () => {
    expect(parseQuery('well pump')).toEqual({
      terms: ['well', 'pump'],
      phrases: [],
      excluded: [],
      combineWith: 'AND',
    });
  });

  it('extracts quoted phrases and keeps their words as terms', () => {
    const parsed = parseQuery('"well pump" repair');
    expect(parsed.phrases).toEqual(['well pump']);
    expect(parsed.terms).toEqual(['well', 'pump', 'repair']);
  });

  it('reads leading-minus and NOT as exclusions', () => {
    const parsed = parseQuery('budget -draft NOT roof');
    expect(parsed.terms).toEqual(['budget']);
    expect(parsed.excluded).toEqual(['draft', 'roof']);
  });

  it('switches to OR when the query contains OR', () => {
    const parsed = parseQuery('roof OR well');
    expect(parsed.combineWith).toEqual('OR');
    expect(parsed.terms).toEqual(['roof', 'well']);
  });

  it('returns an empty parse for whitespace', () => {
    expect(parseQuery('   ').terms).toEqual([]);
  });
});

describe('matchesParsed', () => {
  const text = 'The well pump was repaired. Roof deferred.';

  it('requires an exact phrase', () => {
    expect(matchesParsed(text, parseQuery('"well pump"'))).toBe(true);
    expect(matchesParsed(text, parseQuery('"pump well"'))).toBe(false);
  });

  it('rejects a document containing an excluded term', () => {
    expect(matchesParsed(text, parseQuery('well -roof'))).toBe(false);
    expect(matchesParsed(text, parseQuery('well -gutter'))).toBe(true);
  });

  it('is case insensitive', () => {
    expect(matchesParsed(text, parseQuery('"WELL PUMP"'))).toBe(true);
  });

  it('accepts everything when the query is empty', () => {
    expect(matchesParsed(text, parseQuery(''))).toBe(true);
  });
});
