import { endOfWord } from './words';

/**
 * Where a set of search terms occurs in a piece of text.
 *
 * Extracted from `snippet()` so the in-document highlight and the KWIC
 * snippets in the result list mark words by exactly the same rule. Two
 * matchers that agree today drift apart later, and the failure mode is
 * quiet: a row highlighting one word and the document you land in
 * highlighting another.
 */

/**
 * [start, end) offsets of every occurrence of every term in `text`, matched
 * the way the index matches: case-insensitively, by prefix, extended to the
 * end of the word — so "treasur" marks the whole of "treasurer".
 *
 * A term containing a space is matched as the literal run it is, which is
 * what makes a quoted phrase highlight as one phrase.
 *
 * Sorted by start offset. Overlaps are left in — two terms sharing a prefix
 * ("budget", "budgets") both match at the same offset — for the caller to
 * resolve: `segments` drops them, `mergeRanges` joins them.
 */
export function termRanges(text: string, terms: string[]): [number, number][] {
  const lower = text.toLowerCase();
  const ranges: [number, number][] = [];

  for (const raw of terms) {
    const term = raw.toLowerCase();
    if (!term) continue;
    let at = lower.indexOf(term);
    while (at >= 0) {
      // Extend to the end of the word so a prefix match highlights the whole
      // word. The rule lives in ./words, shared with the whole-word matching
      // in `matchesParsed` — two definitions of "word" would drift, and the
      // symptom would be a result row marking a different span from the
      // document it opens.
      ranges.push([at, endOfWord(text, at + term.length)]);
      at = lower.indexOf(term, at + term.length);
    }
  }

  ranges.sort((a, b) => a[0] - b[0]);
  return ranges;
}

/**
 * Collapse sorted, possibly overlapping ranges into disjoint ones. The
 * highlight registry would paint overlapping ranges correctly, but a caller
 * that wants to count or assert on what is marked deserves one range per
 * marked run.
 */
export function mergeRanges(ranges: [number, number][]): [number, number][] {
  const merged: [number, number][] = [];
  for (const [start, end] of ranges) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}
