import { describe, expect, it } from 'vitest';
import { segments } from './segments';
import { snippet } from './snippet';

describe('segments', () => {
  it('splits a snippet into unmarked and marked runs', () => {
    const parts = segments({ text: 'the budget was approved', marks: [[4, 10]] });
    expect(parts).toEqual([
      { text: 'the ', marked: false },
      { text: 'budget', marked: true },
      { text: ' was approved', marked: false },
    ]);
  });

  it('marks a run that starts at the beginning', () => {
    expect(segments({ text: 'budget talk', marks: [[0, 6]] })).toEqual([
      { text: 'budget', marked: true },
      { text: ' talk', marked: false },
    ]);
  });

  it('returns one unmarked run when nothing matched', () => {
    expect(segments({ text: 'nothing here', marks: [] })).toEqual([
      { text: 'nothing here', marked: false },
    ]);
  });

  it('drops a mark that overlaps one already emitted', () => {
    // "budget" and "budgets" both match at offset 0; nesting would
    // double-highlight the shared prefix.
    const parts = segments({ text: 'budgets rose', marks: [[0, 7], [0, 6]] });
    expect(parts).toEqual([
      { text: 'budgets', marked: true },
      { text: ' rose', marked: false },
    ]);
  });

  it('round-trips the real snippet output, losing no text', () => {
    const text = 'The treasurer presented the budget for the year and the budget passed.';
    const parts = segments(snippet(text, ['budget']));
    expect(parts.map((p) => p.text).join('')).toEqual(text);
    expect(parts.filter((p) => p.marked).map((p) => p.text)).toEqual(['budget', 'budget']);
  });
})
