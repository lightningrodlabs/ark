import { describe, expect, it } from 'vitest';
import { snippet } from './snippet';

const long = `${'filler '.repeat(60)}the well pump was replaced${' filler'.repeat(60)}`;

describe('snippet', () => {
  it('centres on the first matched term', () => {
    const result = snippet(long, ['pump'], 40);
    expect(result.text).toContain('well pump');
    expect(result.text.length).toBeLessThan(long.length);
  });

  it('marks every occurrence of every term', () => {
    const result = snippet('pump and pump again', ['pump']);
    expect(result.marks).toHaveLength(2);
    const [start, end] = result.marks[0];
    expect(result.text.slice(start, end).toLowerCase()).toEqual('pump');
  });

  it('adds ellipses only where text was cut', () => {
    expect(snippet('short text', ['short']).text).toEqual('short text');
    expect(snippet(long, ['pump'], 20).text.startsWith('…')).toBe(true);
  });

  it('falls back to the opening of the text when nothing matches', () => {
    const result = snippet('nothing to see here', ['absent'], 10);
    expect(result.text.startsWith('nothing')).toBe(true);
    expect(result.marks).toEqual([]);
  });

  it('matches terms by prefix', () => {
    const result = snippet('the treasurer reported', ['treasur']);
    expect(result.marks).toHaveLength(1);
  });
});
