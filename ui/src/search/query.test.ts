import { describe, expect, it } from 'vitest';
import { matchesParsed, parseQuery } from './query';

describe('parseQuery', () => {
  it('splits bare words into AND terms', () => {
    expect(parseQuery('well pump')).toEqual({
      terms: ['well', 'pump'],
      phrases: [],
      excluded: [],
      highlight: ['well', 'pump'],
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
    expect(parseQuery('   ').highlight).toEqual([]);
  });
});

// `highlight` is what gets marked wherever a match is shown — the KWIC
// snippets and the opened document. It deliberately differs from `terms`.
describe('parseQuery highlight', () => {
  it('marks a phrase whole rather than word by word', () => {
    const parsed = parseQuery('"well pump"');
    expect(parsed.terms).toEqual(['well', 'pump']);
    expect(parsed.highlight).toEqual(['well pump']);
  });

  it('keeps bare terms alongside a phrase', () => {
    expect(parseQuery('"well pump" repair').highlight).toEqual(['well pump', 'repair']);
  });

  it('never marks an exclusion, in either spelling', () => {
    expect(parseQuery('budget -draft NOT roof').highlight).toEqual(['budget']);
  });

  it('never marks the operators themselves', () => {
    expect(parseQuery('roof OR well').highlight).toEqual(['roof', 'well']);
    expect(parseQuery('roof AND well').highlight).toEqual(['roof', 'well']);
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

// The archive holds a person named Robinhawk as well as a person named Robin.
// Bare `robin` is prefix-matched by MiniSearch and finds both — correctly, and
// that is the useful default (`financ` -> financial, finance, financing). A
// quoted term and an exclusion are the only way to say the *word*, so they are
// the ones anchored at word boundaries.
describe('matchesParsed word boundaries', () => {
  const robin = 'Robin raised the budget question.';
  const robinhawk = 'Robinhawk raised the budget question.';

  it('matches a quoted term as a whole word, not as a substring', () => {
    expect(matchesParsed(robin, parseQuery('"robin"'))).toBe(true);
    expect(matchesParsed(robinhawk, parseQuery('"robin"'))).toBe(false);
  });

  it('excludes a whole word, keeping a document whose only match is longer', () => {
    expect(matchesParsed(robin, parseQuery('budget -robin'))).toBe(false);
    expect(matchesParsed(robinhawk, parseQuery('budget -robin'))).toBe(true);
  });

  it('anchors both ends of a multi-word phrase', () => {
    expect(matchesParsed('the well pump was replaced', parseQuery('"well pump"'))).toBe(true);
    expect(matchesParsed('a stairwell pumpkin patch', parseQuery('"well pump"'))).toBe(false);
  });

  // The boundary either side of a match may be the edge of the text rather
  // than a character, which is where an off-by-one would hide.
  it('matches a phrase flush against the start and the end of the text', () => {
    expect(matchesParsed('Robin', parseQuery('"robin"'))).toBe(true);
    expect(matchesParsed('Robin spoke', parseQuery('"robin"'))).toBe(true);
    expect(matchesParsed('spoke to Robin', parseQuery('"robin"'))).toBe(true);
    expect(matchesParsed('the well pump', parseQuery('"well pump"'))).toBe(true);
    expect(matchesParsed('well pump replaced', parseQuery('"well pump"'))).toBe(true);
  });

  it('excludes on a word flush against the start and the end of the text', () => {
    expect(matchesParsed('Robin', parseQuery('-robin'))).toBe(false);
    expect(matchesParsed('spoke to Robin', parseQuery('-robin'))).toBe(false);
    expect(matchesParsed('Robinhawk', parseQuery('-robin'))).toBe(true);
  });

  it('treats punctuation around a word as a boundary', () => {
    expect(matchesParsed('(Robin) spoke.', parseQuery('"robin"'))).toBe(true);
    expect(matchesParsed('Ann, Robin, and Bo', parseQuery('"robin"'))).toBe(true);
    expect(matchesParsed('spoke to Robin.', parseQuery('"robin"'))).toBe(true);
  });

  it('stays case insensitive on both sides of the boundary', () => {
    expect(matchesParsed('ROBIN spoke', parseQuery('"Robin"'))).toBe(true);
    expect(matchesParsed('ROBINHAWK spoke', parseQuery('"Robin"'))).toBe(false);
    expect(matchesParsed('ROBINHAWK spoke', parseQuery('-Robin'))).toBe(true);
  });
});

// The word-character rule itself, pinned. A word character is a Unicode
// letter, number, combining mark, or underscore. Everything else — space,
// punctuation, apostrophe, hyphen — separates words.
describe('matchesParsed word characters', () => {
  it('counts an accented letter as a word character', () => {
    // "jos" IS a substring of "josé", so this only comes out right if é is a
    // word character. `\b` on ASCII would call the gap after "jos" a boundary
    // and claim the word "Jos" in a document that only has "José".
    expect(matchesParsed('José chaired', parseQuery('"jos"'))).toBe(false);
    expect(matchesParsed('José chaired', parseQuery('"josé"'))).toBe(true);
    expect(matchesParsed('Renée chaired', parseQuery('"renée"'))).toBe(true);
  });

  it('counts a combining mark as a word character, so decomposed text agrees', () => {
    // The same name written NFD: r-e-n-e-<combining acute>-e. Without \p{M}
    // the gap after "rene" would look like a clean boundary.
    expect(matchesParsed('Renée chaired', parseQuery('"rene"'))).toBe(false);
  });

  it('counts a digit as a word character', () => {
    expect(matchesParsed('minutes for 2019', parseQuery('"2019"'))).toBe(true);
    expect(matchesParsed('minutes for 20194', parseQuery('"2019"'))).toBe(false);
  });

  it('counts an underscore as a word character', () => {
    expect(matchesParsed('see robin_hawk', parseQuery('"robin"'))).toBe(false);
  });

  it('lets an apostrophe end a word, so a possessive still matches', () => {
    expect(matchesParsed("Robin's report was filed", parseQuery('"robin"'))).toBe(true);
    expect(matchesParsed("O'Brien chaired", parseQuery('"o\'brien"'))).toBe(true);
    expect(matchesParsed("O'Brien chaired", parseQuery('"brien"'))).toBe(true);
  });

  it('lets a hyphen end a word', () => {
    expect(matchesParsed('Jean-Luc chaired', parseQuery('"jean"'))).toBe(true);
    expect(matchesParsed('Jean-Luc chaired', parseQuery('"jean-luc"'))).toBe(true);
  });

  // A phrase whose own edge is punctuation brings its boundary with it;
  // demanding a second one there would make it unmatchable.
  it('does not demand a boundary where the query itself has punctuation', () => {
    expect(matchesParsed('the (Robin) note', parseQuery('"(robin)"'))).toBe(true);
  });
});
